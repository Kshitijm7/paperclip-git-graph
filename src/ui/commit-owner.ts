import type { BranchOwnership, CommitProvenance, GitCommit } from "../shared/types.js";

// The agent on a commit comes from its recorded run, never from whoever holds the issue now.
export function ownerFor(
  commit: GitCommit,
  ownerByBranch: Map<string, BranchOwnership>,
  commitAgents: Record<string, CommitProvenance> = {}
): BranchOwnership | undefined {
  let branchOwner: BranchOwnership | undefined;
  for (const name of commit.refs) {
    branchOwner = ownerByBranch.get(name) ?? ownerByBranch.get(name.slice(name.indexOf("/") + 1));
    if (branchOwner) break;
  }
  if (!branchOwner) return undefined;
  const run = commitAgents[commit.sha];
  const agent = run && { agentId: run.agentId, agentName: run.agentName ?? "an agent" };
  const { agentId: _id, agentName: _name, agentStatus: _status, ...rest } = branchOwner;
  return { ...rest, ...agent };
}
