import { describe, expect, it } from "vitest";
import { hueForAgent, buildAgentLaneMap, laneColorFor } from "../src/theme/agentHue.js";
import { resolvePreset, PRESETS } from "../src/theme/presets.js";
import type { BranchOwnership, GitCommit, GitRef } from "../src/shared/types.js";

function commit(sha: string, parents: string[]): GitCommit {
  return {
    sha,
    parents,
    author: "a",
    email: "a@example.com",
    date: "2026-09-20T00:00:00Z",
    subject: sha,
    refs: [],
    isHead: false,
  };
}

function ref(name: string, sha: string): GitRef {
  return { name, kind: "local", sha, isCurrent: false };
}

function owner(branch: string, agentId: string): BranchOwnership {
  return { branch, agentId, sources: [] };
}

describe("hueForAgent", () => {
  it("is stable for the same id", () => {
    expect(hueForAgent("agent-1")).toBe(hueForAgent("agent-1"));
  });

  it("spreads a handful of ids over the 8-hue ring", () => {
    const ids = ["agent-1", "agent-2", "agent-3", "agent-4", "agent-5", "agent-6"];
    const hues = new Set(ids.map(hueForAgent));
    for (const h of hues) expect(h).toBeGreaterThanOrEqual(0);
    for (const h of hues) expect(h).toBeLessThan(8);
    expect(hues.size).toBeGreaterThan(1);
  });
});

describe("buildAgentLaneMap / laneColorFor", () => {
  it("assigns the tip agent's hue along first parents and stops at an already-claimed commit", () => {
    // b is claimed first (by feature's earlier walk order via refs array), so main's walk
    // through c -> b should stop at b rather than overwrite it.
    const commits = [commit("c", ["b"]), commit("b", ["a"]), commit("a", [])];
    const refs = [ref("feature", "b"), ref("main", "c")];
    const ownershipByBranch = new Map([
      ["feature", owner("feature", "agent-feature")],
      ["main", owner("main", "agent-main")],
    ]);

    const map = buildAgentLaneMap(commits, refs, ownershipByBranch);

    expect(map.get("b")).toBe(hueForAgent("agent-feature"));
    expect(map.get("a")).toBe(hueForAgent("agent-feature"));
    expect(map.get("c")).toBe(hueForAgent("agent-main"));
  });

  it("leaves commits with no owning agent unmapped, resolved to the muted token", () => {
    const commits = [commit("z", [])];
    const map = buildAgentLaneMap(commits, [], new Map());
    expect(map.has("z")).toBe(false);

    const preset = PRESETS.paperclip;
    expect(laneColorFor(commits[0]!, map, 0, preset)).toBe(preset.laneChromaMuted);
  });

  it("uses the layout color index instead of agent hues when the preset rule is 'index'", () => {
    const preset = PRESETS.sourcegit;
    const c = commit("s", []);
    expect(laneColorFor(c, new Map([["s", 5]]), 2, preset)).toBe(preset.lanePalette[2]);
  });
});

describe("resolvePreset", () => {
  it("returns the named preset", () => {
    expect(resolvePreset("gitlens")).toBe(PRESETS.gitlens);
  });

  it("falls back to paperclip for unknown or missing names", () => {
    expect(resolvePreset(undefined)).toBe(PRESETS.paperclip);
    expect(resolvePreset("not-a-preset")).toBe(PRESETS.paperclip);
  });
});
