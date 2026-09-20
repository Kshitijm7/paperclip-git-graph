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
  commits: GitCommit[];          // topo order, newest first, capped by `limit`
  worktrees: GitWorktree[];
  ownership: BranchOwnership[];
  truncated: boolean;
}

export interface GraphQuery {
  companyId: string;
  limit?: number;          // default 400
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

export interface PluginSettings {
  githubRepo: string;
  fetchIntervalMinutes: number;
  commitLimit: number;
  branchPattern: string;
  githubToken: unknown | null;
}

export interface StatusConfig {
  effective: PluginSettings;
  saved: boolean;
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
