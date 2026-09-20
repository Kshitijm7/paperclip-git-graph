import type { PluginContext } from "@paperclipai/plugin-sdk";
import type {
  ActivityData,
  AgentGitCard,
  BranchOwnership,
  GitCommit,
  GitRef,
  IssueProgress,
  PullRequestInfo
} from "../shared/types.js";
import { readAheadBehindMap, readMergedBranches } from "./git.js";
import { readEvents, readLastRuns } from "./live.js";

const ACTIVITY_TTL_MS = 30_000;
const BRANCH_CAP = 200;

const activityCache = new Map<string, { at: number; data: ActivityData }>();

export function invalidateActivityCache(companyId: string): void {
  activityCache.delete(companyId);
}

export interface AgentLikeForActivity {
  id: string;
  name: string;
  status: string;
}

export function resolveTrunk(configuredTrunk: string, refs: GitRef[]): string {
  const names = new Set(refs.filter((ref) => ref.kind === "local").map((ref) => ref.name));
  if (names.has(configuredTrunk)) return configuredTrunk;
  if (names.has("main")) return "main";
  return configuredTrunk;
}

export function deriveStage(input: {
  merged: boolean;
  commits: number;
  pr?: PullRequestInfo;
}): IssueProgress["stage"] {
  if (input.merged) return "merged";
  if (input.pr) {
    if (input.pr.state === "merged") return "merged";
    if (input.pr.state === "closed") return "closed";
    if (input.pr.state === "draft") return "pr-draft";
    if (input.pr.state === "open") return "pr-open";
  }
  if (input.commits === 0) return "no-branch";
  return "in-progress";
}

function tipCommitForBranch(branch: string, commits: GitCommit[]): GitCommit | undefined {
  return commits.find((commit) => commit.refs.includes(branch));
}

export async function buildActivity(
  ctx: PluginContext,
  companyId: string,
  cwd: string,
  trunkConfig: string,
  refs: GitRef[],
  commits: GitCommit[],
  ownership: BranchOwnership[],
  agents: AgentLikeForActivity[]
): Promise<ActivityData> {
  const cached = activityCache.get(companyId);
  if (cached && Date.now() - cached.at < ACTIVITY_TTL_MS) return cached.data;

  const trunk = resolveTrunk(trunkConfig, refs);
  const localBranches = [...new Set(refs.filter((ref) => ref.kind === "local").map((ref) => ref.name))].slice(0, BRANCH_CAP);
  const lastRuns = await readLastRuns(ctx, companyId);
  const ownershipByBranch = new Map(ownership.map((entry) => [entry.branch, entry]));

  const aheadBehindMap = await readAheadBehindMap(cwd, trunk);
  const mergedBranches = await readMergedBranches(cwd, trunk);

  const branchStats = new Map<string, { ahead: number; behind: number; merged: boolean; tip?: GitCommit }>();
  for (const branch of localBranches) {
    if (branch === trunk) continue;
    const counts = aheadBehindMap.get(branch) ?? { ahead: 0, behind: 0 };
    const merged = mergedBranches.has(branch);
    branchStats.set(branch, { ...counts, merged, tip: tipCommitForBranch(branch, commits) });
  }

  const agentCards: AgentGitCard[] = agents.map((agent) => {
    const owned = ownership.filter((entry) => entry.agentId === agent.id);
    let best: { branch: string; tip?: GitCommit } | undefined;
    for (const entry of owned) {
      const stats = branchStats.get(entry.branch);
      const tip = stats?.tip;
      if (!best || (tip && (!best.tip || tip.date > best.tip.date))) best = { branch: entry.branch, tip };
    }
    const ownedEntry = best ? ownershipByBranch.get(best.branch) : undefined;
    const stats = best ? branchStats.get(best.branch) : undefined;
    const lastRun = lastRuns[agent.id];
    return {
      agentId: agent.id,
      agentName: agent.name,
      agentStatus: agent.status,
      branch: best?.branch,
      issueIdentifier: ownedEntry?.issueIdentifier,
      issueTitle: ownedEntry?.issueTitle,
      lastCommitAt: best?.tip?.date,
      lastCommitSubject: best?.tip?.subject,
      aheadOfTrunk: stats?.ahead,
      behindTrunk: stats?.behind,
      pr: ownedEntry?.pr,
      lastRunAt: lastRun?.at,
      lastRunStatus: lastRun?.status
    };
  });

  const issues: IssueProgress[] = [];
  for (const entry of ownership) {
    if (!entry.issueIdentifier || entry.branch === trunk) continue;
    const stats = branchStats.get(entry.branch);
    const commitsAhead = stats?.ahead ?? 0;
    issues.push({
      issueIdentifier: entry.issueIdentifier,
      issueId: entry.issueId,
      title: entry.issueTitle,
      status: entry.issueStatus,
      agentName: entry.agentName,
      branch: entry.branch,
      commits: commitsAhead,
      aheadOfTrunk: commitsAhead,
      behindTrunk: stats?.behind ?? 0,
      pr: entry.pr,
      stage: deriveStage({ merged: stats?.merged ?? false, commits: commitsAhead, pr: entry.pr }),
      updatedAt: stats?.tip?.date
    });
  }

  const events = await readEvents(ctx, companyId);

  const data: ActivityData = { trunk, agents: agentCards, issues, events, generatedAt: new Date().toISOString() };
  activityCache.set(companyId, { at: Date.now(), data });
  return data;
}
