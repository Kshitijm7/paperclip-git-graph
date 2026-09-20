import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { BranchOwnership, CachedSnapshotMeta, GitCommit, GitRef, GitWorktree, PullRequestInfo, RepoSnapshot } from "../shared/types.js";
import { readRefsHash } from "./git.js";

const CHUNK_SIZE = 500;

export interface StoredSnapshot {
  meta: CachedSnapshotMeta;
  snapshot: RepoSnapshot;
}

interface ExtraJson {
  worktrees: GitWorktree[];
  ownership: BranchOwnership[];
  path: string | null;
  healthy: boolean;
  problems: string[];
  fetchedAt: string | null;
  folderKey: string;
  truncated: boolean;
  ownershipRefreshedAt: string | null;
}

function placeholders(rowCount: number, colCount: number, startAt = 1): string {
  const rows: string[] = [];
  let n = startAt;
  for (let r = 0; r < rowCount; r += 1) {
    const cols: string[] = [];
    for (let c = 0; c < colCount; c += 1) {
      cols.push(`$${n}`);
      n += 1;
    }
    rows.push(`(${cols.join(", ")})`);
  }
  return rows.join(", ");
}

/** Builds VALUES rows for the commits insert, casting the parents column to text[] so drizzle binds it as one array param instead of expanding it into per-element placeholders. */
function commitPlaceholders(rowCount: number, startAt = 1): string {
  const rows: string[] = [];
  let n = startAt;
  for (let r = 0; r < rowCount; r += 1) {
    const cols = [`$${n}`, `$${n + 1}`, `$${n + 2}`, `$${n + 3}::text[]`, `$${n + 4}`, `$${n + 5}`, `$${n + 6}`, `$${n + 7}`, `$${n + 8}`];
    rows.push(`(${cols.join(", ")})`);
    n += 9;
  }
  return rows.join(", ");
}

/** Postgres text[] array literal, e.g. {"a","b"}. */
function pgTextArray(values: string[]): string {
  const escaped = values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return `{${escaped.join(",")}}`;
}

export async function readPersistedSnapshot(ctx: PluginContext, companyId: string): Promise<StoredSnapshot | null> {
  const namespace = ctx.db.namespace;
  const metaRows = await ctx.db.query<{
    head_sha: string | null;
    refs_hash: string;
    generated_at: string;
    commit_count: number;
    extra_json: ExtraJson;
  }>(`SELECT head_sha, refs_hash, generated_at, commit_count, extra_json FROM ${namespace}.snapshot_meta WHERE company_id = $1`, [companyId]);
  const metaRow = metaRows[0];
  if (!metaRow) return null;

  const commitRows = await ctx.db.query<{
    sha: string;
    parents: string[];
    author: string;
    email: string;
    date: string;
    subject: string;
    is_head: boolean;
  }>(
    `SELECT sha, parents, author, email, date, subject, is_head FROM ${namespace}.commits WHERE company_id = $1 ORDER BY position ASC`,
    [companyId]
  );

  const refRows = await ctx.db.query<{
    name: string;
    kind: GitRef["kind"];
    sha: string;
    upstream: string | null;
    ahead: number | null;
    behind: number | null;
    is_current: boolean;
  }>(`SELECT name, kind, sha, upstream, ahead, behind, is_current FROM ${namespace}.refs WHERE company_id = $1`, [companyId]);

  const refsByCommit = new Map<string, string[]>();
  for (const ref of refRows) {
    const list = refsByCommit.get(ref.sha) ?? [];
    list.push(ref.name);
    refsByCommit.set(ref.sha, list);
  }

  const commits: GitCommit[] = commitRows.map((row) => ({
    sha: row.sha,
    parents: row.parents ?? [],
    author: row.author,
    email: row.email,
    date: row.date,
    subject: row.subject,
    refs: refsByCommit.get(row.sha) ?? [],
    isHead: row.is_head
  }));

  const refs: GitRef[] = refRows.map((row) => ({
    name: row.name,
    kind: row.kind,
    sha: row.sha,
    isCurrent: row.is_current,
    upstream: row.upstream ?? undefined,
    ahead: row.ahead ?? undefined,
    behind: row.behind ?? undefined
  }));

  const extra = metaRow.extra_json ?? ({} as ExtraJson);
  const headSha = metaRow.head_sha;
  const head = headSha ? { sha: headSha, branch: refs.find((ref) => ref.isCurrent)?.name ?? null } : null;

  const snapshot: RepoSnapshot = {
    folderKey: extra.folderKey ?? "repo",
    path: extra.path ?? null,
    healthy: extra.healthy ?? true,
    problems: extra.problems ?? [],
    fetchedAt: extra.fetchedAt ?? null,
    generatedAt: metaRow.generated_at,
    head,
    refs,
    commits,
    worktrees: extra.worktrees ?? [],
    ownership: extra.ownership ?? [],
    truncated: extra.truncated ?? false
  };

  const meta: CachedSnapshotMeta = {
    headSha,
    refsHash: metaRow.refs_hash,
    generatedAt: metaRow.generated_at,
    commitCount: metaRow.commit_count,
    ownershipRefreshedAt: extra.ownershipRefreshedAt ?? null
  };

  return { meta, snapshot };
}

/** Lightweight meta-row read for the snapshot fast path: no commits/refs join. */
export async function readSnapshotMetaLight(
  ctx: PluginContext,
  companyId: string
): Promise<{ meta: CachedSnapshotMeta; extra: ExtraJson } | null> {
  const namespace = ctx.db.namespace;
  const rows = await ctx.db.query<{
    head_sha: string | null;
    refs_hash: string;
    generated_at: string;
    commit_count: number;
    extra_json: ExtraJson;
  }>(`SELECT head_sha, refs_hash, generated_at, commit_count, extra_json FROM ${namespace}.snapshot_meta WHERE company_id = $1`, [companyId]);
  const row = rows[0];
  if (!row) return null;
  const extra = row.extra_json ?? ({} as ExtraJson);
  return {
    meta: {
      headSha: row.head_sha,
      refsHash: row.refs_hash,
      generatedAt: row.generated_at,
      commitCount: row.commit_count,
      ownershipRefreshedAt: extra.ownershipRefreshedAt ?? null
    },
    extra
  };
}

export async function readPersistedRefs(ctx: PluginContext, companyId: string): Promise<GitRef[]> {
  const namespace = ctx.db.namespace;
  const refRows = await ctx.db.query<{
    name: string;
    kind: GitRef["kind"];
    sha: string;
    upstream: string | null;
    ahead: number | null;
    behind: number | null;
    is_current: boolean;
  }>(`SELECT name, kind, sha, upstream, ahead, behind, is_current FROM ${namespace}.refs WHERE company_id = $1`, [companyId]);
  return refRows.map((row) => ({
    name: row.name,
    kind: row.kind,
    sha: row.sha,
    isCurrent: row.is_current,
    upstream: row.upstream ?? undefined,
    ahead: row.ahead ?? undefined,
    behind: row.behind ?? undefined
  }));
}

/** Paginated commit read for the DB-backed snapshot fast path. Decorations come from the refs table. */
export async function readCommitWindow(
  ctx: PluginContext,
  companyId: string,
  offset: number,
  limit: number
): Promise<GitCommit[]> {
  const namespace = ctx.db.namespace;
  const commitRows = await ctx.db.query<{
    sha: string;
    parents: string[];
    author: string;
    email: string;
    date: string;
    subject: string;
    is_head: boolean;
  }>(
    `SELECT sha, parents, author, email, date, subject, is_head FROM ${namespace}.commits WHERE company_id = $1 ORDER BY position ASC OFFSET $2 LIMIT $3`,
    [companyId, offset, limit]
  );
  const refRows = await ctx.db.query<{ name: string; sha: string }>(
    `SELECT name, sha FROM ${namespace}.refs WHERE company_id = $1`,
    [companyId]
  );
  const refsByCommit = new Map<string, string[]>();
  for (const ref of refRows) {
    const list = refsByCommit.get(ref.sha) ?? [];
    list.push(ref.name);
    refsByCommit.set(ref.sha, list);
  }
  return commitRows.map((row) => ({
    sha: row.sha,
    parents: row.parents ?? [],
    author: row.author,
    email: row.email,
    date: row.date,
    subject: row.subject,
    refs: refsByCommit.get(row.sha) ?? [],
    isHead: row.is_head
  }));
}

/** Patches just the ownership slice + refresh timestamp, without touching commits/refs. */
export async function persistOwnership(
  ctx: PluginContext,
  companyId: string,
  ownership: BranchOwnership[],
  ownershipRefreshedAt: string
): Promise<void> {
  const namespace = ctx.db.namespace;
  const existing = await readSnapshotMetaLight(ctx, companyId);
  if (!existing) return;
  const extra: ExtraJson = { ...existing.extra, ownership, ownershipRefreshedAt };

  const pullRequests: PullRequestInfo[] = ownership.map((entry) => entry.pr).filter((pr): pr is PullRequestInfo => Boolean(pr));
  await ctx.db.execute(`DELETE FROM ${namespace}.pull_requests WHERE company_id = $1`, [companyId]);
  if (pullRequests.length > 0) {
    const params: unknown[] = [];
    for (const pr of pullRequests) {
      params.push(companyId, pr.number, pr.title, pr.url, pr.state, pr.author, pr.headRef, pr.baseRef, pr.reviewers, pr.checks ?? null, pr.updatedAt || null);
    }
    const sql = `INSERT INTO ${namespace}.pull_requests (company_id, number, title, url, state, author, head_ref, base_ref, reviewers, checks, updated_at) VALUES ${placeholders(pullRequests.length, 11)} ON CONFLICT (company_id, number) DO UPDATE SET title = EXCLUDED.title, url = EXCLUDED.url, state = EXCLUDED.state, author = EXCLUDED.author, head_ref = EXCLUDED.head_ref, base_ref = EXCLUDED.base_ref, reviewers = EXCLUDED.reviewers, checks = EXCLUDED.checks, updated_at = EXCLUDED.updated_at`;
    await ctx.db.execute(sql, params);
  }

  await ctx.db.execute(
    `UPDATE ${namespace}.snapshot_meta SET extra_json = $2 WHERE company_id = $1`,
    [companyId, JSON.stringify(extra)]
  );
}

export async function persistSnapshot(
  ctx: PluginContext,
  companyId: string,
  snapshot: RepoSnapshot,
  refsHash: string,
  commitLimit: number,
  ownershipRefreshedAt: string | null = null
): Promise<CachedSnapshotMeta> {
  const namespace = ctx.db.namespace;
  const commits = snapshot.commits.slice(0, commitLimit);

  await ctx.db.execute(`DELETE FROM ${namespace}.commits WHERE company_id = $1`, [companyId]);
  for (let i = 0; i < commits.length; i += CHUNK_SIZE) {
    const chunk = commits.slice(i, i + CHUNK_SIZE);
    const params: unknown[] = [];
    for (let j = 0; j < chunk.length; j += 1) {
      const commit = chunk[j];
      params.push(companyId, commit.sha, i + j, pgTextArray(commit.parents), commit.author, commit.email, commit.date, commit.subject, commit.isHead);
    }
    const sql = `INSERT INTO ${namespace}.commits (company_id, sha, position, parents, author, email, date, subject, is_head) VALUES ${commitPlaceholders(chunk.length)} ON CONFLICT (company_id, sha) DO UPDATE SET position = EXCLUDED.position, parents = EXCLUDED.parents, author = EXCLUDED.author, email = EXCLUDED.email, date = EXCLUDED.date, subject = EXCLUDED.subject, is_head = EXCLUDED.is_head`;
    try {
      await ctx.db.execute(sql, params);
    } catch (err) {
      const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
      throw new Error(`Commits insert failed (rows=${chunk.length}): ${message}`);
    }
  }

  await ctx.db.execute(`DELETE FROM ${namespace}.refs WHERE company_id = $1`, [companyId]);
  if (snapshot.refs.length > 0) {
    const params: unknown[] = [];
    for (const ref of snapshot.refs) {
      params.push(companyId, ref.name, ref.kind, ref.sha, ref.upstream ?? null, ref.ahead ?? null, ref.behind ?? null, ref.isCurrent);
    }
    const sql = `INSERT INTO ${namespace}.refs (company_id, name, kind, sha, upstream, ahead, behind, is_current) VALUES ${placeholders(snapshot.refs.length, 8)} ON CONFLICT (company_id, name) DO UPDATE SET kind = EXCLUDED.kind, sha = EXCLUDED.sha, upstream = EXCLUDED.upstream, ahead = EXCLUDED.ahead, behind = EXCLUDED.behind, is_current = EXCLUDED.is_current`;
    await ctx.db.execute(sql, params);
  }

  const pullRequests: PullRequestInfo[] = snapshot.ownership.map((entry) => entry.pr).filter((pr): pr is PullRequestInfo => Boolean(pr));
  await ctx.db.execute(`DELETE FROM ${namespace}.pull_requests WHERE company_id = $1`, [companyId]);
  if (pullRequests.length > 0) {
    const params: unknown[] = [];
    for (const pr of pullRequests) {
      params.push(companyId, pr.number, pr.title, pr.url, pr.state, pr.author, pr.headRef, pr.baseRef, pr.reviewers, pr.checks ?? null, pr.updatedAt || null);
    }
    const sql = `INSERT INTO ${namespace}.pull_requests (company_id, number, title, url, state, author, head_ref, base_ref, reviewers, checks, updated_at) VALUES ${placeholders(pullRequests.length, 11)} ON CONFLICT (company_id, number) DO UPDATE SET title = EXCLUDED.title, url = EXCLUDED.url, state = EXCLUDED.state, author = EXCLUDED.author, head_ref = EXCLUDED.head_ref, base_ref = EXCLUDED.base_ref, reviewers = EXCLUDED.reviewers, checks = EXCLUDED.checks, updated_at = EXCLUDED.updated_at`;
    await ctx.db.execute(sql, params);
  }

  const extra: ExtraJson = {
    worktrees: snapshot.worktrees,
    ownership: snapshot.ownership,
    path: snapshot.path,
    healthy: snapshot.healthy,
    problems: snapshot.problems,
    fetchedAt: snapshot.fetchedAt,
    folderKey: snapshot.folderKey,
    truncated: commits.length >= commitLimit,
    ownershipRefreshedAt
  };

  const meta: CachedSnapshotMeta = {
    headSha: snapshot.head?.sha ?? null,
    refsHash,
    generatedAt: snapshot.generatedAt,
    commitCount: commits.length,
    ownershipRefreshedAt
  };

  await ctx.db.execute(
    `INSERT INTO ${namespace}.snapshot_meta (company_id, head_sha, refs_hash, generated_at, commit_count, extra_json) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (company_id) DO UPDATE SET head_sha = EXCLUDED.head_sha, refs_hash = EXCLUDED.refs_hash, generated_at = EXCLUDED.generated_at, commit_count = EXCLUDED.commit_count, extra_json = EXCLUDED.extra_json`,
    [companyId, meta.headSha, meta.refsHash, meta.generatedAt, meta.commitCount, JSON.stringify(extra)]
  );

  return meta;
}

export { readRefsHash };
