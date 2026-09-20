// Pure helpers shared by the tabs. No React, no host imports, so vitest can hit them directly.
import type { AgentGitCard, GitEvent, IssueProgress } from "../../shared/types.js";

// Local 8-hue ring per plan.md; theme.ts owns GRAPH_COLORS for the graph lanes, this is the
// agent-identity ring reused across the Agents cards, Progress bars and Activity rows.
const AGENT_HUES = [25, 70, 140, 200, 250, 290, 330, 10];

export function hashAgentHue(agentId: string): number {
  let h = 0;
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) >>> 0;
  return h % AGENT_HUES.length;
}

export function agentHueColor(agentId: string, lightness = 62): string {
  return `oklch(${lightness}% 0.16 ${AGENT_HUES[hashAgentHue(agentId)]})`;
}

// 4 segments: branch, commits, PR, merged.
const STAGE_SEGMENTS: Record<IssueProgress["stage"], number> = {
  "no-branch": 0,
  "in-progress": 2,
  "pr-draft": 3,
  "pr-open": 3,
  closed: 3,
  merged: 4,
};

export function stageSegments(stage: IssueProgress["stage"]): number {
  return STAGE_SEGMENTS[stage] ?? 0;
}

export function sortAgents(agents: AgentGitCard[]): AgentGitCard[] {
  return [...agents].sort((a, b) => {
    if (Boolean(a.branch) !== Boolean(b.branch)) return a.branch ? -1 : 1;
    const at = a.lastCommitAt ? new Date(a.lastCommitAt).getTime() : 0;
    const bt = b.lastCommitAt ? new Date(b.lastCommitAt).getTime() : 0;
    return bt - at;
  });
}

export type IssueSort = "staleness" | "stage";

export function sortIssues(issues: IssueProgress[], sort: IssueSort, hideMerged: boolean): IssueProgress[] {
  const filtered = hideMerged ? issues.filter((i) => i.stage !== "merged") : issues;
  return [...filtered].sort((a, b) => {
    if (sort === "stage") return stageSegments(a.stage) - stageSegments(b.stage);
    const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return at - bt; // staleness: oldest updatedAt first
  });
}

export interface DayGroup {
  day: string; // "YYYY-MM-DD"
  events: GitEvent[];
}

export function groupByDay(events: GitEvent[]): DayGroup[] {
  const groups: DayGroup[] = [];
  let current: DayGroup | null = null;
  for (const event of events) {
    const day = event.at.slice(0, 10);
    if (!current || current.day !== day) {
      current = { day, events: [] };
      groups.push(current);
    }
    current.events.push(event);
  }
  return groups;
}

export const EVENT_ICON: Record<GitEvent["kind"], string> = {
  "run.started": "▶",
  "run.finished": "✓",
  "run.failed": "✕",
  "branch.created": "⌥",
  "branch.updated": "↻",
  "branch.deleted": "✖",
  commit: "●",
  "pr.opened": "⬆",
  "pr.merged": "⧉",
  "pr.closed": "✖",
  fetch: "↓",
};
