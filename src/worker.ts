import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import manifest, { DEFAULT_FETCH_INTERVAL_MINUTES } from "./manifest.js";
import { ACTION_KEYS, DATA_KEYS, DATA_KEYS_V2, FOLDER_KEY } from "./shared/types.js";
import type { BranchOwnership, CachedSnapshotMeta, GraphQuery, PullRequestInfo, RepoSnapshot } from "./shared/types.js";
import { countCommits, fetchAll, gitVersion, readCommits, readHead, readRefs, readRefsHash, readWorktrees } from "./worker/git.js";
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
import {
  persistOwnership,
  persistSnapshot,
  readCommitWindow,
  readPersistedRefs,
  readPersistedSnapshot,
  readSnapshotMetaLight
} from "./worker/cache.js";
import { diffPrEvents, diffRefEvents, emitRepoChanged, appendEvents, registerLiveUpdates } from "./worker/live.js";
import { buildActivity, invalidateActivityCache } from "./worker/activity.js";

const CACHE_TTL_MS = 20_000;
const REMOTE_TTL_MS = 5 * 60_000;
const GH_STATUS_TTL_MS = 5 * 60_000;
const COMMENT_ISSUE_CAP = 30;
const OWNERSHIP_STALE_MS = 5 * 60_000;
const ACTIVE_STATUS_PATTERN = /in.?progress|in.?review/i;

let context: PluginContext | null = null;
const snapshotCache = new Map<string, { at: number; snapshot: RepoSnapshot; meta: CachedSnapshotMeta | null }>();
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

  const active = issues.filter((issue) => ACTIVE_STATUS_PATTERN.test(issue.status));
  const scanTargets = active.length > 0 ? active : issues;
  const comments: CommentLike[] = [];
  for (const issue of scanTargets.slice(0, COMMENT_ISSUE_CAP)) {
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

  const ownership = buildOwnership({
    refs,
    issues,
    agents,
    pullRequests,
    commentHits,
    branchPattern: cfg.branchPattern
  });
  await syncBranchEntities(ctx, companyId, ownership);
  return ownership;
}

async function syncBranchEntities(ctx: PluginContext, companyId: string, ownership: BranchOwnership[]): Promise<void> {
  for (const entry of ownership) {
    await ctx.entities.upsert({
      entityType: "git-branch",
      scopeKind: "company",
      scopeId: companyId,
      externalId: entry.branch,
      title: entry.branch,
      status: entry.pr?.state ?? "no-pr",
      data: entry as unknown as Record<string, unknown>
    });
  }
}

function isDefaultShape(query: GraphQuery): boolean {
  return !query.branch && !query.firstParentOnly;
}

function snapshotCacheKey(companyId: string, limit: number, offset: number, firstParentOnly: boolean, branch: string | null): string {
  return `${companyId}|${JSON.stringify([limit, offset, firstParentOnly, branch])}`;
}

function invalidateSnapshotCache(companyId: string): void {
  const prefix = `${companyId}|`;
  for (const key of snapshotCache.keys()) {
    if (key.startsWith(prefix)) snapshotCache.delete(key);
  }
}

function isOwnershipStale(ownershipRefreshedAt: string | null | undefined): boolean {
  if (!ownershipRefreshedAt) return true;
  return Date.now() - new Date(ownershipRefreshedAt).getTime() > OWNERSHIP_STALE_MS;
}

/** Heavy path: PR lookup, comment scan, entity upsert. Persists ownership only, never rebuilds commits/refs. */
async function refreshOwnershipInternal(ctx: PluginContext, companyId: string): Promise<BranchOwnership[]> {
  const { status, path } = await repoPath(ctx, companyId);
  if (!path || !status.healthy) return [];
  const cfg = await resolveConfig(ctx, companyId);
  const refs = await readRefs(path);
  const ownership = await loadOwnership(ctx, companyId, path, refs, cfg, true);
  await persistOwnership(ctx, companyId, ownership, new Date().toISOString());
  invalidateSnapshotCache(companyId);
  invalidateActivityCache(companyId);
  return ownership;
}

function scheduleOwnershipRefreshIfStale(ctx: PluginContext, companyId: string, ownershipRefreshedAt: string | null | undefined): void {
  if (!isOwnershipStale(ownershipRefreshedAt)) return;
  void refreshOwnershipInternal(ctx, companyId).catch((error) =>
    ctx.logger.warn("Lazy ownership refresh failed", { companyId, message: (error as Error).message })
  );
}

/** Non-default query shape (a specific branch or first-parent-only): reads git directly, never touches the shared commits/refs tables. */
async function buildScopedSnapshot(ctx: PluginContext, query: GraphQuery, cfg: PluginSettings, limit: number, offset: number, path: string): Promise<RepoSnapshot> {
  const companyId = query.companyId;
  const base: RepoSnapshot = {
    folderKey: FOLDER_KEY,
    path,
    healthy: true,
    problems: [],
    fetchedAt: await fetchedAt(ctx, companyId),
    generatedAt: new Date().toISOString(),
    head: null,
    refs: [],
    commits: [],
    worktrees: [],
    ownership: [],
    truncated: false
  };
  try {
    const firstParentOnly = query.firstParentOnly ?? false;
    const [refs, commits, total, existing] = await Promise.all([
      readRefs(path),
      readCommits(path, limit, firstParentOnly, query.branch, offset),
      countCommits(path, firstParentOnly, query.branch),
      readSnapshotMetaLight(ctx, companyId)
    ]);
    scheduleOwnershipRefreshIfStale(ctx, companyId, existing?.extra.ownershipRefreshedAt);
    return {
      ...base,
      head: await readHead(path),
      refs,
      commits,
      total,
      worktrees: await readWorktrees(path),
      ownership: existing?.extra.ownership ?? [],
      truncated: offset + commits.length < total
    };
  } catch (error) {
    return { ...base, healthy: false, problems: [...base.problems, (error as Error).message] };
  }
}

/** Default-shape query: DB commits/refs table on a refsHash hit, a full git rebuild otherwise. Never recomputes ownership. */
async function loadDefaultSnapshot(
  ctx: PluginContext,
  companyId: string,
  cfg: PluginSettings,
  offset: number,
  limit: number,
  path: string
): Promise<{ snapshot: RepoSnapshot; meta: CachedSnapshotMeta; cached: boolean }> {
  const refsHash = await readRefsHash(path);
  const existing = await readSnapshotMetaLight(ctx, companyId);
  const previousOwnership = existing?.extra.ownership ?? [];
  const ownershipRefreshedAt = existing?.extra.ownershipRefreshedAt ?? null;

  if (existing && existing.meta.refsHash === refsHash) {
    const storedCount = existing.meta.commitCount;
    if (offset + limit > storedCount && storedCount >= cfg.commitLimit) {
      const neededLimit = Math.min(offset + limit, 5000);
      const [refs, commits, head, worktrees] = await Promise.all([
        readRefs(path),
        readCommits(path, neededLimit),
        readHead(path),
        readWorktrees(path)
      ]);
      const rebuilt: RepoSnapshot = {
        folderKey: FOLDER_KEY,
        path,
        healthy: true,
        problems: [],
        fetchedAt: existing.extra.fetchedAt ?? null,
        generatedAt: new Date().toISOString(),
        head,
        refs,
        commits,
        worktrees,
        ownership: previousOwnership,
        truncated: commits.length >= neededLimit
      };
      const meta = await persistSnapshot(ctx, companyId, rebuilt, refsHash, neededLimit, ownershipRefreshedAt);
      scheduleOwnershipRefreshIfStale(ctx, companyId, ownershipRefreshedAt);
      return {
        snapshot: { ...rebuilt, commits: rebuilt.commits.slice(offset, offset + limit), total: meta.commitCount },
        meta,
        cached: false
      };
    }

    const [commits, refs] = await Promise.all([readCommitWindow(ctx, companyId, offset, limit), readPersistedRefs(ctx, companyId)]);
    const snapshot: RepoSnapshot = {
      folderKey: existing.extra.folderKey ?? FOLDER_KEY,
      path: existing.extra.path ?? path,
      healthy: existing.extra.healthy ?? true,
      problems: existing.extra.problems ?? [],
      fetchedAt: existing.extra.fetchedAt ?? null,
      generatedAt: existing.meta.generatedAt,
      head: existing.meta.headSha ? { sha: existing.meta.headSha, branch: refs.find((ref) => ref.isCurrent)?.name ?? null } : null,
      refs,
      commits,
      total: storedCount,
      worktrees: existing.extra.worktrees ?? [],
      ownership: previousOwnership,
      truncated: existing.extra.truncated ?? false
    };
    scheduleOwnershipRefreshIfStale(ctx, companyId, ownershipRefreshedAt);
    return { snapshot, meta: existing.meta, cached: true };
  }

  const rebuildLimit = Math.min(Math.max(offset + limit, cfg.commitLimit), 5000);
  const [refs, commits, head, worktrees] = await Promise.all([
    readRefs(path),
    readCommits(path, rebuildLimit),
    readHead(path),
    readWorktrees(path)
  ]);
  const rebuilt: RepoSnapshot = {
    folderKey: FOLDER_KEY,
    path,
    healthy: true,
    problems: [],
    fetchedAt: await fetchedAt(ctx, companyId),
    generatedAt: new Date().toISOString(),
    head,
    refs,
    commits,
    worktrees,
    ownership: previousOwnership,
    truncated: commits.length >= rebuildLimit
  };
  const meta = await persistSnapshot(ctx, companyId, rebuilt, refsHash, rebuildLimit, ownershipRefreshedAt);
  scheduleOwnershipRefreshIfStale(ctx, companyId, ownershipRefreshedAt);
  return {
    snapshot: { ...rebuilt, commits: rebuilt.commits.slice(offset, offset + limit), total: meta.commitCount },
    meta,
    cached: false
  };
}

/** Fast path: memory cache -> DB-backed default snapshot (or scoped git read) -> notify. Never runs PR/comment lookups. */
async function loadSnapshot(
  ctx: PluginContext,
  query: GraphQuery,
  force = false
): Promise<{ snapshot: RepoSnapshot; meta: CachedSnapshotMeta | null; cached: boolean }> {
  const companyId = query.companyId;
  const cfg = await resolveConfig(ctx, companyId);
  const limit = query.limit ?? cfg.commitLimit;
  const offset = query.offset ?? 0;
  const firstParentOnly = query.firstParentOnly ?? false;
  const memKey = snapshotCacheKey(companyId, limit, offset, firstParentOnly, query.branch ?? null);

  const memCached = snapshotCache.get(memKey);
  if (!force && memCached && Date.now() - memCached.at < CACHE_TTL_MS) {
    return { snapshot: memCached.snapshot, meta: memCached.meta, cached: true };
  }

  const { status, path } = await repoPath(ctx, companyId);
  if (!path || !status.healthy) {
    const snapshot: RepoSnapshot = {
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
    return { snapshot, meta: null, cached: false };
  }

  if (isDefaultShape(query)) {
    try {
      const result = await loadDefaultSnapshot(ctx, companyId, cfg, offset, limit, path);
      snapshotCache.set(memKey, { at: Date.now(), snapshot: result.snapshot, meta: result.meta });
      return result;
    } catch (error) {
      const message = (error as Error).message.split("\n")[0].slice(0, 300);
      ctx.logger.warn("Default snapshot read failed, falling back to a scoped rebuild", { companyId, message });
    }
  }

  const snapshot = await buildScopedSnapshot(ctx, query, cfg, limit, offset, path);
  const meta: CachedSnapshotMeta | null = snapshot.healthy
    ? { headSha: snapshot.head?.sha ?? null, refsHash: "", generatedAt: snapshot.generatedAt, commitCount: snapshot.commits.length }
    : null;
  snapshotCache.set(memKey, { at: Date.now(), snapshot, meta });
  return { snapshot, meta, cached: false };
}

async function buildSnapshot(ctx: PluginContext, query: GraphQuery): Promise<RepoSnapshot> {
  return (await loadSnapshot(ctx, query)).snapshot;
}

/** Rebuilds, persists, diffs refs/PRs against the previous persisted copy, appends events, and notifies the UI. */
async function refreshAndNotify(ctx: PluginContext, companyId: string, reason: "run" | "fetch" | "config"): Promise<void> {
  const { status, path } = await repoPath(ctx, companyId);
  if (!path || !status.healthy) return;
  const previous = await readPersistedSnapshot(ctx, companyId);
  const { snapshot: rebuilt, meta: rebuiltMeta } = await loadSnapshot(ctx, { companyId }, true);
  if (!rebuiltMeta) return;
  const ownership = await refreshOwnershipInternal(ctx, companyId);
  const snapshot: RepoSnapshot = { ...rebuilt, ownership };
  const meta: CachedSnapshotMeta = { ...rebuiltMeta, ownershipRefreshedAt: new Date().toISOString() };

  const oldRefs = new Map((previous?.snapshot.refs ?? []).map((ref) => [ref.name, ref.sha]));
  const newRefs = new Map(snapshot.refs.map((ref) => [ref.name, ref.sha]));
  const oldPrs = (previous?.snapshot.ownership ?? []).map((entry) => entry.pr).filter(Boolean) as PullRequestInfo[];
  const newPrs = snapshot.ownership.map((entry) => entry.pr).filter(Boolean) as PullRequestInfo[];
  const newEvents = [...diffRefEvents(oldRefs, newRefs), ...diffPrEvents(oldPrs, newPrs)];
  await appendEvents(ctx, companyId, newEvents);

  for (const event of newEvents) {
    if (event.kind === "pr.merged") {
      await ctx.activity.log({ companyId, message: event.summary, entityType: "git-branch", metadata: { prNumber: event.prNumber } });
    }
  }

  const openPrs = newPrs.filter((pr) => pr.state === "open" || pr.state === "draft").length;
  await ctx.metrics.write("git_graph.open_prs", openPrs, { companyId });
  await ctx.metrics.write("git_graph.branches", newRefs.size, { companyId });
  await ctx.metrics.write("git_graph.commits_24h", commitsInLast24h(snapshot.commits), { companyId });

  emitRepoChanged(ctx, companyId, reason, meta);
}

function commitsInLast24h(commits: RepoSnapshot["commits"]): number {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return commits.filter((commit) => new Date(commit.date).getTime() >= cutoff).length;
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
  invalidateSnapshotCache(companyId);
  await appendEvents(ctx, companyId, [
    { id: `fetch:${companyId}:${at}`, at, kind: "fetch", summary: "Fetched all remotes" }
  ]);
  await ctx.activity.log({ companyId, message: "Fetched all remotes", entityType: "git-repo" });
  await refreshAndNotify(ctx, companyId, "fetch");
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
        offset: typeof params.offset === "number" ? params.offset : undefined,
        firstParentOnly: params.firstParentOnly === true,
        branch: typeof params.branch === "string" ? params.branch : undefined
      });
    });

    ctx.data.register(DATA_KEYS_V2.meta, async (params) => {
      const companyId = requireCompanyId(params);
      const { meta, cached } = await loadSnapshot(ctx, { companyId });
      return { ...(meta ?? { headSha: null, refsHash: "", generatedAt: new Date().toISOString(), commitCount: 0 }), cached };
    });

    ctx.data.register(DATA_KEYS_V2.activity, async (params) => {
      const companyId = requireCompanyId(params);
      const { status, path } = await repoPath(ctx, companyId);
      if (!path || !status.healthy) {
        return { trunk: (await resolveConfig(ctx, companyId)).trunk, agents: [], issues: [], events: [], generatedAt: new Date().toISOString() };
      }
      const cfg = await resolveConfig(ctx, companyId);
      const { snapshot } = await loadSnapshot(ctx, { companyId });
      const agents = await ctx.agents.list({ companyId, limit: 200 });
      return buildActivity(
        ctx,
        companyId,
        path,
        cfg.trunk,
        snapshot.refs,
        snapshot.commits,
        snapshot.ownership,
        agents.map((agent) => ({ id: agent.id, name: agent.name, status: agent.status }))
      );
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
      invalidateSnapshotCache(companyId);
      if (status.healthy) {
        await pushRecent(ctx, companyId, status.realPath ?? status.path ?? path.trim());
        await ctx.activity.log({ companyId, message: `Bound git repository at ${status.realPath ?? path.trim()}`, entityType: "git-repo" });
      }
      return status;
    });

    ctx.tools.register(
      "git_graph_branches",
      {
        displayName: "Git Graph Branches",
        description: "List repository branches with their owning agent, issue and PR state.",
        parametersSchema: {
          type: "object",
          properties: { companyId: { type: "string", description: "Company UUID. Defaults to the run's own company." } }
        }
      },
      async (params, runCtx) => {
        const companyId = typeof (params as Record<string, unknown>)?.companyId === "string"
          ? (params as Record<string, string>).companyId
          : runCtx.companyId;
        const { status, path } = await repoPath(ctx, companyId);
        if (!path || !status.healthy) return { content: "No repository is bound for this company.", data: [] };
        const cfg = await resolveConfig(ctx, companyId);
        const ownership = await loadOwnership(ctx, companyId, path, await readRefs(path), cfg);
        const lines = ownership.map((entry) => `${entry.branch}\t${entry.agentName ?? "-"}\t${entry.pr?.state ?? "no-pr"}`);
        return { content: ["branch\tagent\tpr", ...lines].join("\n"), data: ownership };
      }
    );

    ctx.actions.register(ACTION_KEYS.refreshOwnership, async (params) => {
      const companyId = requireCompanyId(params);
      const { status, path } = await repoPath(ctx, companyId);
      if (!path || !status.healthy) return { ok: false, ownership: [] as BranchOwnership[] };
      const ownership = await refreshOwnershipInternal(ctx, companyId);
      return { ok: true, ownership };
    });

    ctx.jobs.register("fetch", async () => {
      for (const company of await ctx.companies.list({ limit: 100 }).catch(() => [])) {
        await runFetch(ctx, company.id);
      }
    });

    registerLiveUpdates(ctx, { onRefsChanged: (companyId) => refreshAndNotify(ctx, companyId, "run") });
  },

  multiCompanyConfig: true,

  async onConfigChanged(_newConfig, changeContext) {
    const companyId = changeContext?.companyId;
    if (!companyId || !context) return;
    invalidateSnapshotCache(companyId);
    invalidateActivityCache(companyId);
    await refreshAndNotify(context, companyId, "config");
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
