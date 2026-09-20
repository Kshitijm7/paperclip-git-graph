import { describe, expect, it } from "vitest";
import type { GitRef } from "../src/shared/types.js";
import {
  branchNames,
  buildOwnership,
  mapPullRequests,
  matchIssueIdentifier,
  parseOwnerRepo,
  scanCommentsForBranches
} from "../src/worker/ownership.js";

const PATTERN = "^agent/(?<issue>[A-Z]+-\\d+)-";

const refs: GitRef[] = [
  { name: "develop", kind: "local", sha: "a1", isCurrent: true },
  { name: "agent/MYS-12-add-graph", kind: "local", sha: "b1", isCurrent: false },
  { name: "origin/agent/MYS-12-add-graph", kind: "remote", sha: "b1", isCurrent: false },
  { name: "origin/agent/MYS-99-orphan", kind: "remote", sha: "c1", isCurrent: false },
  { name: "origin/HEAD", kind: "remote", sha: "a1", isCurrent: false },
  { name: "v1.0.0", kind: "tag", sha: "a1", isCurrent: false }
];

const issues = [
  { id: "iss-1", identifier: "MYS-12", title: "Add graph", status: "in_progress", assigneeAgentId: "agt-1" },
  { id: "iss-2", identifier: "MYS-40", title: "Hotfix", status: "done", assigneeAgentId: null }
];

const agents = [{ id: "agt-1", name: "Frontend", status: "working" }];

describe("branchNames", () => {
  it("dedupes origin/x against x and drops tags and origin/HEAD", () => {
    expect(branchNames(refs)).toEqual(["agent/MYS-12-add-graph", "agent/MYS-99-orphan", "develop"]);
  });
});

describe("matchIssueIdentifier", () => {
  it("captures the named group", () => {
    expect(matchIssueIdentifier("agent/MYS-12-add-graph", PATTERN)).toBe("MYS-12");
    expect(matchIssueIdentifier("develop", PATTERN)).toBeUndefined();
    expect(matchIssueIdentifier("agent/MYS-12-x", "([")).toBeUndefined();
  });
});

describe("parseOwnerRepo", () => {
  it("handles ssh and https remotes", () => {
    expect(parseOwnerRepo("git@github.com:Kshitijm7/paperclip-git-graph.git")).toBe("Kshitijm7/paperclip-git-graph");
    expect(parseOwnerRepo("https://github.com/Kshitijm7/paperclip-git-graph")).toBe("Kshitijm7/paperclip-git-graph");
    expect(parseOwnerRepo("https://gitlab.com/a/b.git")).toBeNull();
    expect(parseOwnerRepo(null)).toBeNull();
  });
});

describe("mapPullRequests", () => {
  it("derives merged and draft states", () => {
    const prs = mapPullRequests([
      { number: 1, title: "a", html_url: "u1", state: "closed", merged_at: "2026-09-01T00:00:00Z", head: { ref: "agent/MYS-12-add-graph" }, base: { ref: "develop" }, user: { login: "kshitij" }, updated_at: "2026-09-01T00:00:00Z" },
      { number: 2, title: "b", html_url: "u2", state: "open", merged_at: null, draft: true, head: { ref: "x" }, base: { ref: "develop" }, user: { login: "bot" }, requested_reviewers: [{ login: "rev" }], updated_at: "2026-09-02T00:00:00Z" },
      { number: 3, title: "c", html_url: "u3", state: "closed", merged_at: null, head: { ref: "y" }, base: { ref: "develop" }, user: {}, updated_at: "2026-09-03T00:00:00Z" },
      { title: "no number" }
    ]);
    expect(prs.map((pr) => pr.state)).toEqual(["merged", "draft", "closed"]);
    expect(prs[1].reviewers).toEqual(["rev"]);
  });
});

describe("scanCommentsForBranches", () => {
  it("finds branch names in comment bodies and keeps the first hit", () => {
    const hits = scanCommentsForBranches([
      { id: "c1", issueId: "iss-2", body: "pushed to agent/MYS-99-orphan, tests green." },
      { id: "c2", issueId: "iss-1", body: "also agent/MYS-99-orphan" },
      { id: "c3", issueId: "iss-1", body: "no branch here" }
    ]);
    expect(hits.get("agent/MYS-99-orphan")).toEqual({ issueId: "iss-2", commentId: "c1" });
    expect(hits.size).toBe(1);
  });
});

describe("buildOwnership", () => {
  const pullRequests = mapPullRequests([
    { number: 34, title: "Add graph", html_url: "u", state: "open", merged_at: null, head: { ref: "agent/MYS-12-add-graph" }, base: { ref: "develop" }, user: { login: "kshitij" }, updated_at: "2026-09-10T00:00:00Z" }
  ]);

  it("resolves issue, agent and PR and records every source", () => {
    const owned = buildOwnership({ refs, issues, agents, pullRequests, branchPattern: PATTERN });
    const graph = owned.find((o) => o.branch === "agent/MYS-12-add-graph")!;
    expect(graph).toMatchObject({
      issueIdentifier: "MYS-12",
      issueId: "iss-1",
      issueTitle: "Add graph",
      issueStatus: "in_progress",
      agentId: "agt-1",
      agentName: "Frontend",
      agentStatus: "working"
    });
    expect(graph.pr?.number).toBe(34);
    expect(graph.sources.map((s) => s.kind)).toEqual(["branch-name", "github-pr"]);
  });

  it("leaves an unmatched branch bare", () => {
    const owned = buildOwnership({ refs, issues, agents, pullRequests, branchPattern: PATTERN });
    const develop = owned.find((o) => o.branch === "develop")!;
    expect(develop.sources).toEqual([]);
    expect(develop.issueId).toBeUndefined();
  });

  it("falls back to a run-log comment when the branch name resolves to no issue", () => {
    const owned = buildOwnership({
      refs,
      issues,
      agents,
      pullRequests: [],
      commentHits: scanCommentsForBranches([{ id: "c1", issueId: "iss-2", body: "on agent/MYS-99-orphan now" }]),
      branchPattern: PATTERN
    });
    const orphan = owned.find((o) => o.branch === "agent/MYS-99-orphan")!;
    expect(orphan.issueId).toBe("iss-2");
    expect(orphan.issueIdentifier).toBe("MYS-40");
    expect(orphan.sources.map((s) => s.kind)).toEqual(["branch-name", "run-log"]);
    expect(orphan.sources[1].detail).toBe("comment c1 on MYS-40");
  });

  it("prefers the most recently updated PR for a head ref", () => {
    const duplicates = mapPullRequests([
      { number: 1, title: "old", html_url: "u1", state: "closed", merged_at: null, head: { ref: "develop" }, base: { ref: "main" }, user: {}, updated_at: "2026-01-01T00:00:00Z" },
      { number: 2, title: "new", html_url: "u2", state: "open", merged_at: null, head: { ref: "develop" }, base: { ref: "main" }, user: {}, updated_at: "2026-09-01T00:00:00Z" }
    ]);
    const owned = buildOwnership({ refs, issues, agents, pullRequests: duplicates, branchPattern: PATTERN });
    expect(owned.find((o) => o.branch === "develop")!.pr?.number).toBe(2);
  });
});
