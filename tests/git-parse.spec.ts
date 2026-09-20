import { describe, expect, it } from "vitest";
import { parseAheadBehindOutput, parseCommits, parseRefs, parseTrack, parseWorktrees, shortRefName } from "../src/worker/git.js";

const U = "\u001f";
const R = "\u001e";

describe("parseRefs", () => {
  it("maps local, remote and tag refs", () => {
    const stdout = [
      `refs/heads/develop${U}aaa111${U}origin/develop${U}[ahead 2, behind 1]${U}*`,
      `refs/remotes/origin/agent/MYS-12-foo${U}bbb222${U}${U}${U}`,
      `refs/tags/v1.2.0${U}ccc333${U}${U}${U}`
    ].join(R) + R;
    const refs = parseRefs(stdout);
    expect(refs).toHaveLength(3);
    expect(refs[0]).toMatchObject({ name: "develop", kind: "local", isCurrent: true, upstream: "origin/develop", ahead: 2, behind: 1 });
    expect(refs[1]).toMatchObject({ name: "origin/agent/MYS-12-foo", kind: "remote", isCurrent: false });
    expect(refs[1].ahead).toBeUndefined();
    expect(refs[2]).toMatchObject({ name: "v1.2.0", kind: "tag" });
  });

  it("ignores blank records and unknown ref namespaces", () => {
    expect(parseRefs(`${R}refs/stash${U}ddd${U}${U}${U}${R}`)).toEqual([]);
  });
});

describe("parseTrack", () => {
  it("returns nothing for gone or empty tracking", () => {
    expect(parseTrack("[gone]")).toEqual({});
    expect(parseTrack("")).toEqual({});
    expect(parseTrack("[behind 4]")).toEqual({ behind: 4 });
  });
});

describe("parseCommits", () => {
  it("keeps subjects containing separators-adjacent punctuation", () => {
    const stdout =
      `abc123${U}def456 ghi789${U}Kshitij Mittal${U}k@example.com${U}2026-09-20T10:00:00+05:30${U}fix: handle a, comma and | pipe${U}HEAD -> develop, origin/develop, tag: v1.2.0${R}` +
      `def456${U}${U}Agent Bot${U}bot@example.com${U}2026-09-19T09:00:00+05:30${U}initial commit${U}${R}`;
    const commits = parseCommits(stdout);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      sha: "abc123",
      parents: ["def456", "ghi789"],
      author: "Kshitij Mittal",
      subject: "fix: handle a, comma and | pipe",
      isHead: true
    });
    expect(commits[0].refs).toEqual(["develop", "origin/develop", "v1.2.0"]);
    expect(commits[1]).toMatchObject({ parents: [], refs: [], isHead: false });
  });
});

describe("parseWorktrees", () => {
  it("reads the porcelain format including detached entries", () => {
    const stdout = [
      "worktree G:/MyProject/repo",
      "HEAD aaa111",
      "branch refs/heads/develop",
      "",
      "worktree G:/MyProject/repo-wt",
      "HEAD bbb222",
      "detached",
      ""
    ].join("\n");
    expect(parseWorktrees(stdout)).toEqual([
      { path: "G:/MyProject/repo", branch: "develop", sha: "aaa111" },
      { path: "G:/MyProject/repo-wt", branch: null, sha: "bbb222" }
    ]);
  });
});

describe("parseAheadBehindOutput", () => {
  it("parses ref, sha and ahead-behind counts from for-each-ref output", () => {
    const stdout = [
      `develop${U}aaa111${U}0 0`,
      `agent/MYS-1-x${U}bbb222${U}2 5`,
      `origin/agent/MYS-1-x${U}bbb222${U}2 5`
    ].join("\n");
    const map = parseAheadBehindOutput(stdout);
    expect(map.get("develop")).toEqual({ ahead: 0, behind: 0 });
    expect(map.get("agent/MYS-1-x")).toEqual({ ahead: 2, behind: 5 });
    expect(map.get("origin/agent/MYS-1-x")).toEqual({ ahead: 2, behind: 5 });
  });

  it("ignores blank lines and lines missing the ahead-behind field", () => {
    expect(parseAheadBehindOutput(`\nfoo${U}bbb222\n`)).toEqual(new Map());
  });
});

describe("shortRefName", () => {
  it("strips the ref namespace", () => {
    expect(shortRefName("refs/remotes/origin/agent/MYS-1-x")).toBe("origin/agent/MYS-1-x");
    expect(shortRefName("refs/tags/v1.0.0^{}")).toBe("v1.0.0");
  });
});
