import { describe, expect, it } from "vitest";
import {
  agentHueColor,
  groupByDay,
  hashAgentHue,
  sortAgents,
  sortIssues,
  stageSegments,
} from "../src/ui/tabs/helpers.js";
import type { AgentGitCard, GitEvent, IssueProgress } from "../src/shared/types.js";

describe("hashAgentHue", () => {
  it("returns a stable index in 0..7 for the same id", () => {
    const a = hashAgentHue("agent-1");
    const b = hashAgentHue("agent-1");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(8);
  });

  it("differs across distinct ids (not a constant)", () => {
    const hues = new Set(["a", "b", "c", "d", "e", "f"].map(hashAgentHue));
    expect(hues.size).toBeGreaterThan(1);
  });
});

describe("agentHueColor", () => {
  it("renders an oklch string with the same H for the same id", () => {
    const c1 = agentHueColor("agent-1");
    const c2 = agentHueColor("agent-1");
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^oklch\(62% 0\.16 \d+\)$/);
  });
});

describe("stageSegments", () => {
  it("maps each stage to its filled segment count out of 4", () => {
    expect(stageSegments("no-branch")).toBe(0);
    expect(stageSegments("in-progress")).toBe(2);
    expect(stageSegments("pr-draft")).toBe(3);
    expect(stageSegments("pr-open")).toBe(3);
    expect(stageSegments("closed")).toBe(3);
    expect(stageSegments("merged")).toBe(4);
  });
});

function agent(partial: Partial<AgentGitCard>): AgentGitCard {
  return { agentId: "id", agentName: "name", agentStatus: "active", ...partial };
}

describe("sortAgents", () => {
  it("puts agents with a branch before agents without one", () => {
    const result = sortAgents([agent({ agentId: "no-branch" }), agent({ agentId: "has-branch", branch: "agent/x" })]);
    expect(result[0]!.agentId).toBe("has-branch");
    expect(result[1]!.agentId).toBe("no-branch");
  });

  it("orders agents with branches by last commit descending", () => {
    const result = sortAgents([
      agent({ agentId: "older", branch: "b1", lastCommitAt: "2026-09-01T00:00:00Z" }),
      agent({ agentId: "newer", branch: "b2", lastCommitAt: "2026-09-10T00:00:00Z" }),
    ]);
    expect(result.map((a) => a.agentId)).toEqual(["newer", "older"]);
  });
});

function issue(partial: Partial<IssueProgress>): IssueProgress {
  return {
    issueIdentifier: "X-1",
    branch: "b",
    commits: 0,
    aheadOfTrunk: 0,
    behindTrunk: 0,
    stage: "in-progress",
    ...partial,
  };
}

describe("sortIssues", () => {
  it("sorts by staleness ascending (oldest updatedAt first) by default", () => {
    const result = sortIssues(
      [
        issue({ issueIdentifier: "new", updatedAt: "2026-09-10T00:00:00Z" }),
        issue({ issueIdentifier: "old", updatedAt: "2026-09-01T00:00:00Z" }),
      ],
      "staleness",
      false,
    );
    expect(result.map((i) => i.issueIdentifier)).toEqual(["old", "new"]);
  });

  it("sorts by stage progress when asked", () => {
    const result = sortIssues(
      [issue({ issueIdentifier: "merged", stage: "merged" }), issue({ issueIdentifier: "fresh", stage: "no-branch" })],
      "stage",
      false,
    );
    expect(result.map((i) => i.issueIdentifier)).toEqual(["fresh", "merged"]);
  });

  it("hides merged issues when the filter is on", () => {
    const result = sortIssues(
      [issue({ issueIdentifier: "merged", stage: "merged" }), issue({ issueIdentifier: "open", stage: "pr-open" })],
      "staleness",
      true,
    );
    expect(result.map((i) => i.issueIdentifier)).toEqual(["open"]);
  });
});

function event(partial: Partial<GitEvent>): GitEvent {
  return { id: "e", at: "2026-09-10T00:00:00Z", kind: "commit", summary: "s", ...partial };
}

describe("groupByDay", () => {
  it("groups consecutive events from the same day and keeps newest-first order", () => {
    const groups = groupByDay([
      event({ id: "1", at: "2026-09-10T12:00:00Z" }),
      event({ id: "2", at: "2026-09-10T08:00:00Z" }),
      event({ id: "3", at: "2026-09-09T23:00:00Z" }),
    ]);
    expect(groups.map((g) => g.day)).toEqual(["2026-09-10", "2026-09-09"]);
    expect(groups[0]!.events.map((e) => e.id)).toEqual(["1", "2"]);
    expect(groups[1]!.events.map((e) => e.id)).toEqual(["3"]);
  });

  it("returns an empty array for no events", () => {
    expect(groupByDay([])).toEqual([]);
  });
});
