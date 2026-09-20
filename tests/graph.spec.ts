import { describe, expect, it } from "vitest";
import { generateGraph } from "../src/graph/layout.js";
import type { GitCommit } from "../src/shared/types.js";

function commit(sha: string, parents: string[], isHead = false): GitCommit {
  return {
    sha,
    parents,
    author: "a",
    email: "a@example.com",
    date: "2026-09-20T00:00:00Z",
    subject: `commit ${sha}`,
    refs: [],
    isHead,
  };
}

describe("generateGraph", () => {
  it("keeps linear history on one lane", () => {
    const commits = [commit("c", ["b"], true), commit("b", ["a"]), commit("a", [])];
    const g = generateGraph(commits);

    const lanes = new Set(g.dots.map((d) => d.lane));
    expect(lanes.size).toBe(1);
    expect(g.segments.every((s) => s.lane === s.toLane)).toBe(true);
    expect(g.dots[0]!.type).toBe("head");
    expect(g.rowOf).toEqual({ c: 0, b: 1, a: 2 });
  });

  it("gives a branch and merge two lanes and one diagonal connector", () => {
    // h is the side branch tip listed above the merge, so the lane for s already
    // exists when m is laid out and the second parent joins that lane instead of a new one.
    const commits = [
      commit("h", ["s"]),
      commit("m", ["t", "s"]),
      commit("t", ["b"]),
      commit("s", ["b"]),
      commit("b", []),
    ];
    const g = generateGraph(commits);

    const mDot = g.dots.find((d) => d.sha === "m")!;
    expect(mDot.type).toBe("merge");
    const diagonals = g.segments.filter((s) => s.lane !== s.toLane);
    expect(diagonals.length).toBeGreaterThanOrEqual(1);
    expect(diagonals.some((s) => s.lane === mDot.lane)).toBe(true);
    const lanes = new Set(g.dots.map((d) => d.lane));
    expect(lanes.size).toBe(2);
    expect(g.laneWidth).toBeGreaterThan(12);
  });

  it("drops the second parent under firstParentOnly", () => {
    const commits = [
      commit("m", ["t", "s"]),
      commit("t", ["b"]),
      commit("s", ["b"]),
      commit("b", []),
    ];
    const g = generateGraph(commits, { firstParentOnly: true });
    // m's second parent creates no lane or connector; t and s still converge into b's lane on their own.
    const diagonals = g.segments.filter((s) => s.lane !== s.toLane);
    expect(diagonals).toHaveLength(1);
  });

  it("starts a fresh lane for an orphan root, reusing a freed slot", () => {
    const commits = [commit("b2", ["b1"], true), commit("b1", []), commit("o", [])];
    const g = generateGraph(commits);

    const orphan = g.dots.find((d) => d.sha === "o")!;
    expect(orphan.type).toBe("default");
    expect(orphan.lane).toBe(g.dots[0]!.lane);
    expect(g.segments.some((s) => s.lane !== s.toLane)).toBe(false);
  });

  it("emits exactly one dot per commit at its own row", () => {
    const commits = [
      commit("m", ["t", "s"]),
      commit("t", ["b"]),
      commit("s", ["b"]),
      commit("b", ["root"]),
      commit("root", []),
      commit("orphan", []),
    ];
    const g = generateGraph(commits);

    expect(g.dots).toHaveLength(commits.length);
    for (const c of commits) {
      const found = g.dots.filter((d) => d.sha === c.sha);
      expect(found).toHaveLength(1);
      expect(found[0]!.row).toBe(g.rowOf[c.sha]!);
    }
  });
});
