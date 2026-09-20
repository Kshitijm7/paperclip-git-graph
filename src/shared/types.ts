// Contract between worker (data producers) and UI (consumers). Keep serializable.

export interface GitRef {
  name: string;            // "develop", "origin/agent/MYS-12-foo", "v1.2.0"
  kind: "local" | "remote" | "tag" | "head";
  sha: string;
  isCurrent: boolean;      // HEAD points here
  upstream?: string;       // for local branches
  ahead?: number;
  behind?: number;
}

export interface GitCommit {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  date: string;            // ISO
  subject: string;
  refs: string[];          // ref names that point at this commit
  isHead: boolean;
}

export interface GitWorktree {
  path: string;
  branch: string | null;
  sha: string;
}

export interface OwnershipSource {
  kind: "branch-name" | "github-pr" | "run-log";
  detail: string;          // e.g. "agent/MYS-12-foo", "PR #34", "comment abc on MYS-12"
}

export interface BranchOwnership {
  branch: string;          // short local name, no "origin/"
  issueIdentifier?: string;   // "MYS-12"
  issueId?: string;
  issueTitle?: string;
  issueStatus?: string;
  agentId?: string;
  agentName?: string;
  agentStatus?: string;
  pr?: PullRequestInfo;
  sources: OwnershipSource[];
}

export interface PullRequestInfo {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged" | "draft";
  author: string;
  headRef: string;
  baseRef: string;
  reviewers: string[];
  checks?: "success" | "failure" | "pending" | "none";
  updatedAt: string;
}

export interface RepoSnapshot {
  folderKey: string;
  path: string | null;
  healthy: boolean;
  problems: string[];
  fetchedAt: string | null;      // last `git fetch` run by the plugin
  generatedAt: string;
  head: { sha: string; branch: string | null } | null;
  refs: GitRef[];
  commits: GitCommit[];          // topo order, newest first, window [offset, offset+limit)
  total?: number;                // total commits available for the query
  worktrees: GitWorktree[];
  ownership: BranchOwnership[];
  truncated: boolean;
}

export interface GraphQuery {
  companyId: string;
  limit?: number;          // default 400
  offset?: number;         // for lazy loading; default 0
  firstParentOnly?: boolean;
  branch?: string;         // restrict to one ref; default all
}

export interface WorkspaceCandidate {
  name: string;
  path: string;
  projectName: string;
  isRepo: boolean;
}

export interface RecentRepo {
  path: string;
  boundAt: string;
}

export interface RootEntry {
  label: string;
  path: string;
}

export interface RepoCandidates {
  workspaces: WorkspaceCandidate[];
  recent: RecentRepo[];
  roots: RootEntry[];
}

export interface BrowseEntry {
  name: string;
  path: string;
  isRepo: boolean;
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
  error?: string;
}

export type GithubAuthMode = "auto" | "secret" | "gh-cli" | "none";

export interface PluginSettings {
  githubRepo: string;
  fetchIntervalMinutes: number;
  commitLimit: number;
  branchPattern: string;
  githubToken: unknown | null;
  githubAuth: GithubAuthMode;
  theme: ThemePreset;
  trunk: string;
}

export interface StatusConfig {
  effective: PluginSettings;
  saved: boolean;
}

export interface StatusGithub {
  mode: "secret" | "gh-cli" | "none";
  login?: string;
  repo?: string;
  ok: boolean;
  error?: string;
}

export const DATA_KEYS = {
  snapshot: "snapshot",
  status: "status",
  branches: "branches",
  candidates: "candidates",
  browse: "browse",
} as const;

export const ACTION_KEYS = {
  fetch: "fetch",
  bindFolder: "bind-folder",
  refreshOwnership: "refresh-ownership",
} as const;

export const FOLDER_KEY = "repo";

// Wave 2 contract: cache, live updates, admin views.

export interface CachedSnapshotMeta {
  headSha: string | null;
  refsHash: string;          // hash of all ref names + shas; changes when anything moves
  generatedAt: string;
  commitCount: number;
  ownershipRefreshedAt?: string | null;
}

export type GitEventKind =
  | "run.started" | "run.finished" | "run.failed"
  | "branch.created" | "branch.updated" | "branch.deleted"
  | "commit" | "pr.opened" | "pr.merged" | "pr.closed" | "fetch";

export interface GitEvent {
  id: string;
  at: string;
  kind: GitEventKind;
  branch?: string;
  sha?: string;
  agentId?: string;
  agentName?: string;
  issueIdentifier?: string;
  prNumber?: number;
  summary: string;
}

export interface AgentGitCard {
  agentId: string;
  agentName: string;
  agentStatus: string;
  branch?: string;
  issueIdentifier?: string;
  issueTitle?: string;
  lastCommitAt?: string;
  lastCommitSubject?: string;
  aheadOfTrunk?: number;
  behindTrunk?: number;
  pr?: PullRequestInfo;
  lastRunAt?: string;
  lastRunStatus?: string;
}

export interface IssueProgress {
  issueIdentifier: string;
  issueId?: string;
  title?: string;
  status?: string;
  agentName?: string;
  branch: string;
  commits: number;
  aheadOfTrunk: number;
  behindTrunk: number;
  pr?: PullRequestInfo;
  stage: "no-branch" | "in-progress" | "pr-open" | "pr-draft" | "merged" | "closed";
  updatedAt?: string;
}

export interface ActivityData {
  trunk: string;              // e.g. "develop"
  agents: AgentGitCard[];
  issues: IssueProgress[];
  events: GitEvent[];         // newest first, capped
  generatedAt: string;
}

export interface RepoChangedEvent {
  type: "repo.changed";
  companyId: string;
  reason: "fetch" | "run" | "job" | "config" | "manual";
  meta: CachedSnapshotMeta;
}

export const STREAM_CHANNEL = "repo";
export const DATA_KEYS_V2 = { activity: "activity", meta: "meta" } as const;

// Theme presets: only accents, lane palette, chip style and density vary; surfaces stay host tokens.
export type ThemePreset = "paperclip" | "sourcegit" | "gitlens" | "fork";
export const THEME_PRESETS: ThemePreset[] = ["paperclip", "sourcegit", "gitlens", "fork"];
