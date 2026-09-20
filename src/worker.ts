import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import manifest, { DEFAULT_FETCH_INTERVAL_MINUTES } from "./manifest.js";
import { ACTION_KEYS, DATA_KEYS, FOLDER_KEY } from "./shared/types.js";
import type { BranchOwnership, GraphQuery, PullRequestInfo, RepoSnapshot } from "./shared/types.js";
import { fetchAll, gitVersion, readCommits, readHead, readRefs, readWorktrees } from "./worker/git.js";
import { browseDirectory, listRoots, listWorkspaceCandidates, pushRecent, getRecent } from "./worker/fs.js";
import { DEFAULTS, resolveConfig, type PluginSettings } from "./worker/config.js";
import { detectGhCli, resolveGithubToken } from "./worker/github-auth.js";
import type { StatusGithub } from "./shared/types.js";
import {
  buildOwnership,
  fetchPullRequests,
  resolveRepoSlug,
  scanCommentsForBranches,
  type AgentLike,
  type CommentLike,
  type IssueLike
} from "./worker/ownership.js";

const CACHE_TTL_MS = 20_000;
const REMOTE_TTL_MS = 5 * 60_000;
const GH_STATUS_TTL_MS = 5 * 60_000;
const COMMENT_ISSUE_CAP = 50;

let context: PluginContext | null = null;
const snapshotCache = new Map<string, { at: number; key: string; snapshot: RepoSnapshot }>();
let ghStatusCache: { at: number; status: Awaited<ReturnType<typeof detectGhCli>> } | null = null;

async function cachedGhStatus() {
  if (ghStatusCache && Date.now() - ghStatusCache.at < GH_STATUS_TTL_MS) return ghStatusCache.status;
  const status = await detectGhCli();
  ghStatusCache = { at: Date.now(), status };
  return status;
}

async function buildGithubStatus(ctx: PluginContext, companyId: string, cfg: PluginSettings, cwd: string | null): Promise<StatusGithub> {
  const slug = cwd ? await resolveRepoSlug(cwd, cfg.githubRepo || undefined).catch(() => null) : null;
  const hasSecret = Boolean(cfg.githubToken && typeof cfg.githubToken === "object");
  const mode = cfg.githubAuth ?? "auto";

  if (mode === "secret" || (mode === "auto" && hasSecret)) {
    return { mode: "secret", repo: slug ?? undefined, ok: hasSecret };
  }
  if (mode === "gh-cli" || mode === "auto") {
    const gh = await cachedGhStatus();
    if (gh.available) return { mode: "gh-cli", login: gh.login, repo: slug ?? undefined, ok: true };
    if (mode === "gh-cli") return { mode: "gh-cli", repo: slug ?? undefined, ok: false, error: gh.error };
  }
  return { mode: "none", repo: slug ?? undefined, ok: false };
}

function requireCompanyId(params: Record<string, unknown>): string {
  const companyId = params.companyId;
  if (typeof companyId !== "string" || !companyId) throw new Error("companyId is required");
  return companyId;
}

async function isConfigSaved(ctx: PluginContext, companyId: string): Promise<boolean> {
  try {
    return (await ctx.config.get(companyId)) != null;
  } catch {
    return false;
  }
}

async function fetchedAt(ctx: PluginContext, companyId: string): Promise<string | null> {
  const value = await ctx.state.get({ scopeKind: "company", scopeId: companyId, stateKey: "fetchedAt" });
  return typeof value === "string" ? value : null;
}

async function repoPath(ctx: PluginContext, companyId: string) {
  const status = await ctx.localFolders.status(companyId, FOLDER_KEY);
  return { status, path: status.realPath ?? status.path };
}

async function loadPullRequests(
  ctx: PluginContext,
  companyId: string,
  cwd: string,
  cfg: PluginSettings,
  force: boolean
): Promise<PullRequestInfo[]> {
  const slug = await resolveRepoSlug(cwd, cfg.githubRepo || undefined);
  if (!slug) return [];
  const key = { scopeKind: "company" as const, scopeId: companyId, stateKey: `prs:${slug}` };
  const cached = (await ctx.state.get(key)) as { at?: number; prs?: PullRequestInfo[] } | null;
  if (!force && cached?.at && Date.now() - cached.at < REMOTE_TTL_MS) return cached.prs ?? [];

  const token = await resolveGithubToken(ctx, companyId, cfg);

  try {
    const prs = await fetchPullRequests(slug, token, (url, init) => ctx.http.fetch(url as string, init));
    await ctx.state.set(key, { at: Date.now(), prs });
    return prs;
  } catch (error) {
    ctx.logger.warn("GitHub pull request lookup failed", { slug, message: (error as Error).message });
    return cached?.prs ?? [];
  }
}

async function loadCommentHits(ctx: PluginContext, companyId: string, issues: IssueLike[], force: boolean) {
  const key = { scopeKind: "company" as const, scopeId: companyId, stateKey: "comments" };
  const cached = (await ctx.state.get(key)) as { at?: number; hits?: Record<string, { issueId: string; commentId: string }> } | null;
  if (!force && cached?.at && Date.now() - cached.at < REMOTE_TTL_MS) return new Map(Object.entries(cached.hits ?? {}));

  const comments: CommentLike[] = [];
  for (const issue of issues.slice(0, COMMENT_ISSUE_CAP)) {
    try {
      const list = await ctx.issues.listComments(issue.id, companyId);
      for (const comment of list) comments.push({ id: comment.id, issueId: comment.issueId, body: comment.body ?? "" });
    } catch {
      break;
    }
  }
  const hits = scanCommentsForBranches(comments);
  await ctx.state.set(key, { at: Date.now(), hits: Object.fromEntries(hits) });
  return hits;
}

async function loadOwnership(
  ctx: PluginContext,
  companyId: string,
  cwd: string,
  refs: Awaited<ReturnType<typeof readRefs>>,
  cfg: PluginSettings,
  force = false
): Promise<BranchOwnership[]> {
  const issues = (await ctx.issues.list({ companyId, limit: 500 })).map(
    (issue): IssueLike => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      status: issue.status,
      assigneeAgentId: issue.assigneeAgentId
    })
  );
  const agents = (await ctx.agents.list({ companyId, limit: 200 })).map(
    (agent): AgentLike => ({ id: agent.id, name: agent.name, status: agent.status })
  );
  const pullRequests = await loadPullRequests(ctx, companyId, cwd, cfg, force);
  const commentHits = await loadCommentHits(ctx, companyId, issues, force);

  return buildOwnership({
    refs,
    issues,
    agents,
    pullRequests,
    commentHits,
    branchPattern: cfg.branchPattern
  });
}

async function buildSnapshot(ctx: PluginContext, query: GraphQuery): Promise<RepoSnapshot> {
  const companyId = query.companyId;
  const cfg = await resolveConfig(ctx, companyId);
  const limit = query.limit ?? cfg.commitLimit;
  const cacheKey = JSON.stringify([limit, query.firstParentOnly ?? false, query.branch ?? null]);
  const cached = snapshotCache.get(companyId);
  if (cached && cached.key === cacheKey && Date.now() - cached.at < CACHE_TTL_MS) return cached.snapshot;

  const { status, path } = await repoPath(ctx, companyId);
  const base: RepoSnapshot = {
    folderKey: FOLDER_KEY,
    path,
    healthy: status.healthy,
    problems: status.problems.map((problem) => problem.message),
    fetchedAt: await fetchedAt(ctx, companyId),
    generatedAt: new Date().toISOString(),
    head: null,
    refs: [],
    commits: [],
    worktrees: [],
    ownership: [],
    truncated: false
  };
  if (!path || !status.healthy) return base;

  try {
    const refs = await readRefs(path);
    const commits = await readCommits(path, limit, query.firstParentOnly ?? false, query.branch);
    const snapshot: RepoSnapshot = {
      ...base,
      head: await readHead(path),
      refs,
      commits,
      worktrees: await readWorktrees(path),
      ownership: await loadOwnership(ctx, companyId, path, refs, cfg),
      truncated: commits.length >= limit
    };
    snapshotCache.set(companyId, { at: Date.now(), key: cacheKey, snapshot });
    return snapshot;
  } catch (error) {
    return { ...base, healthy: false, problems: [...base.problems, (error as Error).message] };
  }
}

async function runFetch(ctx: PluginContext, companyId: string) {
  const { status, path } = await repoPath(ctx, companyId);
  if (!path || !status.healthy) return { ok: false, message: "Repository folder is not bound or not healthy" };
  try {
    await fetchAll(path);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  const at = new Date().toISOString();
  await ctx.state.set({ scopeKind: "company", scopeId: companyId, stateKey: "fetchedAt" }, at);
  snapshotCache.delete(companyId);
  return { ok: true, fetchedAt: at };
}

const plugin = definePlugin({
  async setup(ctx) {
    context = ctx;

    ctx.data.register(DATA_KEYS.status, async (params) => {
      const companyId = requireCompanyId(params);
      const { status, path } = await repoPath(ctx, companyId);
      let version: string | null = null;
      let problem: string | null = null;
      try {
        version = await gitVersion(path ?? process.cwd());
      } catch (error) {
        problem = (error as Error).message;
      }
      const effective = await resolveConfig(ctx, companyId);
      return {
        configured: status.configured,
        path,
        healthy: status.healthy,
        problems: status.problems.map((p) => p.message).concat(problem ? [problem] : []),
        folder: status,
        fetchedAt: await fetchedAt(ctx, companyId),
        gitVersion: version,
        config: { effective, saved: await isConfigSaved(ctx, companyId) },
        github: await buildGithubStatus(ctx, companyId, effective, path)
      };
    });

    ctx.data.register(DATA_KEYS.branches, async (params) => {
      const companyId = requireCompanyId(params);
      const { status, path } = await repoPath(ctx, companyId);
      if (!path || !status.healthy) return [];
      const cfg = await resolveConfig(ctx, companyId);
      return loadOwnership(ctx, companyId, path, await readRefs(path), cfg);
    });

    ctx.data.register(DATA_KEYS.snapshot, async (params) => {
      const companyId = requireCompanyId(params);
      return buildSnapshot(ctx, {
        companyId,
        limit: typeof params.limit === "number" ? params.limit : undefined,
        firstParentOnly: params.firstParentOnly === true,
        branch: typeof params.branch === "string" ? params.branch : undefined
      });
    });

    ctx.data.register(DATA_KEYS.candidates, async (params) => {
      const companyId = requireCompanyId(params);
      const [workspaces, recent] = await Promise.all([listWorkspaceCandidates(ctx, companyId), getRecent(ctx, companyId)]);
      return { workspaces, recent, roots: listRoots() };
    });

    ctx.data.register(DATA_KEYS.browse, async (params) => {
      requireCompanyId(params);
      const path = params.path;
      if (typeof path !== "string" || !path.trim()) throw new Error("path is required");
      return browseDirectory(path.trim());
    });

    ctx.actions.register(ACTION_KEYS.fetch, async (params) => runFetch(ctx, requireCompanyId(params)));

    ctx.actions.register(ACTION_KEYS.bindFolder, async (params) => {
      const companyId = requireCompanyId(params);
      const path = params.path;
      if (typeof path !== "string" || !path.trim()) throw new Error("path is required");
      const status = await ctx.localFolders.configure({
        companyId,
        folderKey: FOLDER_KEY,
        path: path.trim(),
        access: "read",
        requiredDirectories: [".git"]
      });
      snapshotCache.delete(companyId);
      if (status.healthy) await pushRecent(ctx, companyId, status.realPath ?? status.path ?? path.trim());
      return status;
    });

    ctx.actions.register(ACTION_KEYS.refreshOwnership, async (params) => {
      const companyId = requireCompanyId(params);
      const { status, path } = await repoPath(ctx, companyId);
      if (!path || !status.healthy) return { ok: false, ownership: [] as BranchOwnership[] };
      snapshotCache.delete(companyId);
      const cfg = await resolveConfig(ctx, companyId);
      const ownership = await loadOwnership(ctx, companyId, path, await readRefs(path), cfg, true);
      return { ok: true, ownership };
    });

    ctx.jobs.register("fetch", async () => {
      for (const company of await ctx.companies.list({ limit: 100 }).catch(() => [])) {
        await runFetch(ctx, company.id);
      }
    });
  },

  multiCompanyConfig: true,

  async onConfigChanged(_newConfig, changeContext) {
    const companyId = changeContext?.companyId;
    if (companyId) snapshotCache.delete(companyId);
  },

  async onHealth() {
    if (!context) return { status: "error" as const, message: "Worker not initialised" };
    const companies = await context.companies.list({ limit: 25 }).catch(() => []);
    const details: Record<string, unknown> = {};
    let unhealthy = 0;
    for (const company of companies) {
      const status = await context.localFolders.status(company.id, FOLDER_KEY).catch(() => null);
      details[company.id] = status ? { configured: status.configured, healthy: status.healthy } : { error: true };
      if (!status?.healthy) unhealthy += 1;
    }
    if (companies.length === 0) return { status: "ok" as const, message: "No companies to check", details };
    if (unhealthy === companies.length) {
      return { status: "degraded" as const, message: "No company has a healthy repository folder bound", details };
    }
    return { status: "ok" as const, message: `${companies.length - unhealthy} repository folder(s) healthy`, details };
  },

  async onValidateConfig(cfg) {
    const errors: string[] = [];
    const interval = cfg.fetchIntervalMinutes;
    if (interval !== undefined && (typeof interval !== "number" || !Number.isFinite(interval) || interval < 1 || interval > 1440)) {
      errors.push("fetchIntervalMinutes must be a number between 1 and 1440");
    }
    const repo = cfg.githubRepo;
    if (repo !== undefined && repo !== "" && (typeof repo !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(repo))) {
      errors.push("githubRepo must look like owner/name");
    }
    const pattern = cfg.branchPattern;
    if (typeof pattern === "string" && pattern) {
      try {
        new RegExp(pattern);
      } catch {
        errors.push("branchPattern is not a valid regular expression");
      }
    }
    const warnings = interval === undefined ? [`fetchIntervalMinutes defaults to ${DEFAULT_FETCH_INTERVAL_MINUTES}`] : [];
    return errors.length ? { ok: false, errors } : { ok: true, warnings };
  }
});

export { manifest };
export default plugin;
runWorker(plugin, import.meta.url);
