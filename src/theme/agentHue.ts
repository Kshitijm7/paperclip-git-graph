import type { BranchOwnership, GitCommit, GitRef } from "../shared/types.js";
import { AGENT_HUES, type ThemePresetConfig } from "./presets.js";

// Stable hash, not crypto: same agentId always lands on the same ring slot across snapshots.
export function hueForAgent(agentId: string): number {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  return hash % AGENT_HUES.length;
}

// Walk from each owned branch tip along first parents, tagging every commit with that agent's
// hue slot until a commit already claimed (by an earlier, presumably more "current" tip) is hit.
export function buildAgentLaneMap(
  commits: GitCommit[],
  refs: GitRef[],
  ownershipByBranch: Map<string, BranchOwnership>,
): Map<string, number> {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const claimed = new Map<string, number>();

  for (const ref of refs) {
    if (ref.kind !== "local" && ref.kind !== "head") continue;
    const owner = ownershipByBranch.get(ref.name.replace(/^origin\//, ""));
    if (!owner?.agentId) continue;
    const hueIdx = hueForAgent(owner.agentId);

    let sha: string | undefined = ref.sha;
    while (sha && !claimed.has(sha)) {
      claimed.set(sha, hueIdx);
      const commit = bySha.get(sha);
      if (!commit || commit.parents.length === 0) break;
      sha = commit.parents[0];
    }
  }
  return claimed;
}

export function laneColorFor(
  commit: GitCommit,
  agentLaneMap: Map<string, number> | undefined,
  layoutColorIndex: number,
  preset: ThemePresetConfig,
): string {
  if (preset.laneRule === "index") {
    return preset.lanePalette[layoutColorIndex % preset.lanePalette.length]!;
  }
  const hueIdx = agentLaneMap?.get(commit.sha);
  return hueIdx === undefined ? preset.laneChromaMuted : preset.lanePalette[hueIdx]!;
}

export function colorForAgent(agentId: string, preset: ThemePresetConfig): string {
  return preset.lanePalette[hueForAgent(agentId)]!;
}
