import { describe, expect, it } from "vitest";
import { deriveStage, resolveTrunk } from "../src/worker/activity.js";
import type { GitRef, PullRequestInfo } from "../src/shared/types.js";

function pr(state: PullRequestInfo["state"]): PullRequestInfo {
  return { number: 1, title: "t", url: "u", state, author: "a", headRef: "h", baseRef: "b", reviewers: [], updatedAt: "" };
}

describe("resolveTrunk", () => {
  const refs: GitRef[] = [
    { name: "develop", kind: "local", sha: "a", isCurrent: true },
    { name: "main", kind: "local", sha: "b", isCurrent: false },
    { name: "agent/MYS-1-x", kind: "local", sha: "c", isCurrent: false }
  ];

  it("uses the configured trunk when it exists", () => {
    expect(resolveTrunk("develop", refs)).toBe("develop");
  });

  it("falls back to main when the configured trunk is absent", () => {
    expect(resolveTrunk("release", refs)).toBe("main");
  });

  it("falls back to the configured value when neither it nor main exists", () => {
    const noMain: GitRef[] = [{ name: "trunk", kind: "local", sha: "a", isCurrent: true }];
    expect(resolveTrunk("release", noMain)).toBe("release");
  });
});

describe("deriveStage", () => {
  it("is no-branch with zero commits and no PR", () => {
    expect(deriveStage({ merged: false, commits: 0 })).toBe("no-branch");
  });

  it("is in-progress with commits ahead and no PR", () => {
    expect(deriveStage({ merged: false, commits: 3 })).toBe("in-progress");
  });

  it("is pr-open when the PR is open", () => {
    expect(deriveStage({ merged: false, commits: 3, pr: pr("open") })).toBe("pr-open");
  });

  it("is pr-draft when the PR is a draft", () => {
    expect(deriveStage({ merged: false, commits: 1, pr: pr("draft") })).toBe("pr-draft");
  });

  it("is merged when the PR reports merged", () => {
    expect(deriveStage({ merged: false, commits: 5, pr: pr("merged") })).toBe("merged");
  });

  it("is closed when the PR reports closed", () => {
    expect(deriveStage({ merged: false, commits: 5, pr: pr("closed") })).toBe("closed");
  });

  it("is merged when the branch is an ancestor of trunk, regardless of PR state", () => {
    expect(deriveStage({ merged: true, commits: 0, pr: pr("open") })).toBe("merged");
  });
});
