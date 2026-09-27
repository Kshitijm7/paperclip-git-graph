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

export const TONE = {
  green: "oklch(62% 0.16 145)",
  blue: "oklch(64% 0.14 245)",
  purple: "oklch(62% 0.17 300)",
  amber: "oklch(72% 0.15 70)",
  red: "var(--destructive)",
  muted: "var(--muted-foreground)",
} as const;

export interface Badge {
  label: string;
  color: string;
}

const STAGE_BADGE: Record<IssueProgress["stage"], Badge> = {
  "no-branch": { label: "Not started", color: TONE.muted },
  "in-progress": { label: "In progress", color: TONE.amber },
  "pr-draft": { label: "Draft PR", color: TONE.muted },
  "pr-open": { label: "In review", color: TONE.blue },
  closed: { label: "Closed", color: TONE.red },
  merged: { label: "Merged", color: TONE.purple },
};

export function stageBadge(stage: IssueProgress["stage"]): Badge {
  return STAGE_BADGE[stage] ?? STAGE_BADGE["no-branch"];
}

export function prBadge(state: string | undefined): Badge {
  if (state === "open") return { label: "Open", color: TONE.green };
  if (state === "merged") return { label: "Merged", color: TONE.purple };
  if (state === "closed") return { label: "Closed", color: TONE.red };
  if (state === "draft") return { label: "Draft", color: TONE.muted };
  return { label: "No PR", color: TONE.muted };
}

export function agentStatusBadge(status: string | undefined): Badge {
  if (status === "running" || status === "active") return { label: "Running", color: TONE.green };
  if (status === "error" || status === "failed") return { label: "Error", color: TONE.red };
  if (status === "paused") return { label: "Paused", color: TONE.amber };
  return { label: "Idle", color: TONE.muted };
}

export function runBadge(status: string | undefined): Badge | null {
  if (status === "run.started") return { label: "Run started", color: TONE.blue };
  if (status === "run.finished") return { label: "Run finished", color: TONE.green };
  if (status === "run.failed") return { label: "Run failed", color: TONE.red };
  return null;
}

export const EVENT_BADGE: Record<GitEvent["kind"], Badge> = {
  "run.started": { label: "Run started", color: TONE.blue },
  "run.finished": { label: "Run finished", color: TONE.green },
  "run.failed": { label: "Run failed", color: TONE.red },
  "branch.created": { label: "Branch created", color: TONE.blue },
  "branch.updated": { label: "New commits", color: TONE.amber },
  "branch.deleted": { label: "Branch deleted", color: TONE.muted },
  commit: { label: "Commit", color: TONE.amber },
  "pr.opened": { label: "PR opened", color: TONE.green },
  "pr.merged": { label: "PR merged", color: TONE.purple },
  "pr.closed": { label: "PR closed", color: TONE.red },
  fetch: { label: "Fetched", color: TONE.muted },
};

export function dayLabel(day: string, now = new Date()): string {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
