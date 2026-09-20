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

    expect(g.paths).toHaveLength(1);
    expect(g.links).toHaveLength(0);
    const xs = new Set(g.dots.map((d) => d.center.x));
    expect(xs.size).toBe(1);
    expect(g.dots[0]!.type).toBe("head");
    expect(g.rowOf).toEqual({ c: 0, b: 1, a: 2 });
  });

  it("gives a branch and merge two lanes and one link", () => {
    // h is the side branch tip listed above the merge, so the lane for s already
    // exists when m is laid out and the second parent becomes a link, not a lane.
    const commits = [
      commit("h", ["s"]),
      commit("m", ["t", "s"]),
      commit("t", ["b"]),
      commit("s", ["b"]),
      commit("b", []),
    ];
    const g = generateGraph(commits);

    expect(g.dots.find((d) => d.sha === "m")!.type).toBe("merge");
    expect(g.links).toHaveLength(1);
    expect(g.links[0]!.start).toEqual(g.dots.find((d) => d.sha === "m")!.center);
    expect(g.paths.length).toBeGreaterThanOrEqual(2);
    const lanes = new Set(g.dots.map((d) => d.center.x));
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
    expect(generateGraph(commits, { firstParentOnly: true }).links).toHaveLength(0);
  });

  it("starts a fresh lane for an orphan root", () => {
    const commits = [commit("b2", ["b1"], true), commit("b1", []), commit("o", [])];
    const g = generateGraph(commits);

    const orphan = g.dots.find((d) => d.sha === "o")!;
    expect(orphan.type).toBe("default");
    expect(orphan.center.x).toBe(g.dots[0]!.center.x);
    expect(g.links).toHaveLength(0);
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
      expect(found[0]!.center.y).toBe(g.rowOf[c.sha]! + 0.5);
    }
  });
});
