import { describe, expect, it } from "vitest";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { BranchOwnership, GitCommit } from "../src/shared/types.js";
import { ownerFor } from "../src/ui/commit-owner.js";
import { attributeMovedTips, readProvenance, recordProvenance } from "../src/worker/provenance.js";
import { createFakeDb } from "./fake-db.js";

const tip: GitCommit = { sha: "abc123", parents: [], author: "dev", email: "", date: "2026-09-25T00:00:00Z", subject: "work", refs: ["agent/ABC-12"], isHead: false };

function branchOwner(agentId: string, agentName: string): Map<string, BranchOwnership> {
  return new Map([["agent/ABC-12", { branch: "agent/ABC-12", issueIdentifier: "ABC-12", agentId, agentName, sources: [] }]]);
}

describe("ownerFor", () => {
  it("keeps commit attribution stable when the issue is reassigned and the tip does not move", () => {
    const commitAgents = { abc123: { agentId: "a", agentName: "Agent A", at: "2026-09-25T00:00:00Z" } };
    const before = ownerFor(tip, branchOwner("a", "Agent A"), commitAgents);
    const after = ownerFor(tip, branchOwner("b", "Agent B"), commitAgents);
    expect(before?.agentName).toBe("Agent A");
    expect(after?.agentName).toBe("Agent A");
    expect(after?.issueIdentifier).toBe("ABC-12");
  });

  it("does not credit the current assignee when no run is recorded for the commit", () => {
    const owner = ownerFor(tip, branchOwner("b", "Agent B"));
    expect(owner?.agentId).toBeUndefined();
    expect(owner?.issueIdentifier).toBe("ABC-12");
  });
});

describe("attributeMovedTips", () => {
  const oldRefs = new Map([["main", "m1"], ["agent/ABC-12", "old"]]);
  const newRefs = new Map([["main", "m1"], ["agent/ABC-12", "abc123"], ["agent/ABC-13", "def456"]]);

  it("credits moved and new tips to the single agent that finished", () => {
    const out = attributeMovedTips([{ agentId: "a", runId: "r1", at: "t" }], oldRefs, newRefs);
    expect([...out.keys()].sort()).toEqual(["abc123", "def456"]);
    expect(out.get("abc123")?.runId).toBe("r1");
  });

  it("records nothing when two agents finished in the same window", () => {
    const runs = [{ agentId: "a", at: "t" }, { agentId: "b", at: "t" }];
    expect(attributeMovedTips(runs, oldRefs, newRefs).size).toBe(0);
  });
});

describe("recordProvenance", () => {
  it("keeps the first recorded run for a sha", async () => {
    const ctx = { db: createFakeDb("test_ns") } as unknown as PluginContext;
    await recordProvenance(ctx, "c1", new Map([["abc123", { agentId: "a", at: "2026-09-25T00:00:00Z" }]]));
    await recordProvenance(ctx, "c1", new Map([["abc123", { agentId: "b", at: "2026-09-26T00:00:00Z" }]]));
    expect((await readProvenance(ctx, "c1")).abc123.agentId).toBe("a");
  });
});
