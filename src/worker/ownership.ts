import type { BranchOwnership, GitRef, OwnershipSource, PullRequestInfo } from "../shared/types.js";
import { readOriginUrl } from "./git.js";

export interface IssueLike {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  assigneeAgentId: string | null;
}

export interface AgentLike {
  id: string;
  name: string;
  status: string;
}

export interface CommentLike {
  id: string;
  issueId: string;
  body: string;
}

const BRANCH_IN_TEXT = /\bagent\/[A-Za-z0-9._/-]+/g;

export function branchNames(refs: GitRef[]): string[] {
  const seen = new Set<string>();
  for (const ref of refs) {
    if (ref.kind === "local") seen.add(ref.name);
    else if (ref.kind === "remote") {
      const short = ref.name.split("/").slice(1).join("/");
      if (short && short !== "HEAD") seen.add(short);
    }
  }
  return [...seen].sort();
}

export function matchIssueIdentifier(branch: string, pattern: string): string | undefined {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    return undefined;
  }
  const match = regex.exec(branch);
  if (!match) return undefined;
  return match.groups?.issue ?? match[1];
}

export function parseOwnerRepo(remoteUrl: string | null | undefined): string | null {
  if (!remoteUrl) return null;
  const match = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

export function mapPullRequests(raw: unknown[]): PullRequestInfo[] {
  const out: PullRequestInfo[] = [];
  for (const entry of raw) {
    const pr = entry as Record<string, any>;
    if (typeof pr?.number !== "number") continue;
    out.push({
      number: pr.number,
      title: String(pr.title ?? ""),
      url: String(pr.html_url ?? ""),
      state: pr.merged_at ? "merged" : pr.draft ? "draft" : pr.state === "closed" ? "closed" : "open",
      author: String(pr.user?.login ?? ""),
      headRef: String(pr.head?.ref ?? ""),
      baseRef: String(pr.base?.ref ?? ""),
      reviewers: Array.isArray(pr.requested_reviewers)
        ? pr.requested_reviewers.map((r: Record<string, unknown>) => String(r?.login ?? "")).filter(Boolean)
        : [],
      updatedAt: String(pr.updated_at ?? "")
    });
  }
  return out;
}

export function scanCommentsForBranches(comments: CommentLike[]): Map<string, { issueId: string; commentId: string }> {
  const hits = new Map<string, { issueId: string; commentId: string }>();
  for (const comment of comments) {
    for (const found of comment.body.match(BRANCH_IN_TEXT) ?? []) {
      const branch = found.replace(/[.,;:)\]]+$/, "");
      if (!hits.has(branch)) hits.set(branch, { issueId: comment.issueId, commentId: comment.id });
    }
  }
  return hits;
}

export interface BuildOwnershipInput {
  refs: GitRef[];
  issues: IssueLike[];
  agents: AgentLike[];
  pullRequests: PullRequestInfo[];
  commentHits?: Map<string, { issueId: string; commentId: string }>;
  branchPattern: string;
}

export function buildOwnership(input: BuildOwnershipInput): BranchOwnership[] {
  const byIdentifier = new Map(input.issues.filter((i) => i.identifier).map((i) => [i.identifier as string, i]));
  const byIssueId = new Map(input.issues.map((i) => [i.id, i]));
  const agentsById = new Map(input.agents.map((a) => [a.id, a]));
  const prByHead = new Map<string, PullRequestInfo>();
  for (const pr of input.pullRequests) {
    const existing = prByHead.get(pr.headRef);
    if (!existing || (pr.updatedAt ?? "") > (existing.updatedAt ?? "")) prByHead.set(pr.headRef, pr);
  }

  return branchNames(input.refs).map((branch) => {
    const sources: OwnershipSource[] = [];
    const ownership: BranchOwnership = { branch, sources };

    const identifier = matchIssueIdentifier(branch, input.branchPattern);
    let issue = identifier ? byIdentifier.get(identifier) : undefined;
    if (identifier) {
      ownership.issueIdentifier = identifier;
      sources.push({ kind: "branch-name", detail: branch });
    }

    if (!issue) {
      const hit = input.commentHits?.get(branch);
      const fromComment = hit ? byIssueId.get(hit.issueId) : undefined;
      if (hit && fromComment) {
        issue = fromComment;
        ownership.issueIdentifier = fromComment.identifier ?? ownership.issueIdentifier;
        sources.push({
          kind: "run-log",
          detail: `comment ${hit.commentId} on ${fromComment.identifier ?? fromComment.id}`
        });
      }
    }

    if (issue) {
      ownership.issueId = issue.id;
      ownership.issueTitle = issue.title;
      ownership.issueStatus = issue.status;
      if (issue.assigneeAgentId) {
        ownership.agentId = issue.assigneeAgentId;
        const agent = agentsById.get(issue.assigneeAgentId);
        if (agent) {
          ownership.agentName = agent.name;
          ownership.agentStatus = agent.status;
        }
      }
    }

    const pr = prByHead.get(branch);
    if (pr) {
      ownership.pr = pr;
      sources.push({ kind: "github-pr", detail: `PR #${pr.number}` });
    }

    return ownership;
  });
}

export async function resolveRepoSlug(cwd: string, configuredRepo?: string): Promise<string | null> {
  const configured = (configuredRepo ?? "").trim();
  if (configured) return configured;
  return parseOwnerRepo(await readOriginUrl(cwd));
}

export async function fetchPullRequests(
  slug: string,
  token: string | null,
  doFetch: typeof fetch = fetch
): Promise<PullRequestInfo[]> {
  const headers: Record<string, string> = {
    "User-Agent": "paperclip-git-graph",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await doFetch(`https://api.github.com/repos/${slug}/pulls?state=all&per_page=100`, { headers });
  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    throw new Error(`GitHub returned ${response.status} for ${slug} (ratelimit-remaining=${remaining ?? "unknown"})`);
  }
  return mapPullRequests((await response.json()) as unknown[]);
}
