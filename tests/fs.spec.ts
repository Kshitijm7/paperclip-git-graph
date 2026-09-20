import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { browseDirectory, isRepoDir, mergeRecent } from "../src/worker/fs.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gg-fs-"));
  mkdirSync(join(dir, "repo-one", ".git"), { recursive: true });
  mkdirSync(join(dir, "plain-folder"));
  mkdirSync(join(dir, ".hidden"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("isRepoDir", () => {
  it("is true when a .git directory exists", () => {
    expect(isRepoDir(join(dir, "repo-one"))).toBe(true);
  });

  it("is false for a plain folder", () => {
    expect(isRepoDir(join(dir, "plain-folder"))).toBe(false);
  });
});

describe("browseDirectory", () => {
  it("lists subfolders, skipping hidden dirs, marking isRepo", async () => {
    const result = await browseDirectory(dir);
    expect(result.error).toBeUndefined();
    expect(result.entries.map((e) => e.name)).toEqual(["plain-folder", "repo-one"]);
    expect(result.entries.find((e) => e.name === "repo-one")?.isRepo).toBe(true);
    expect(result.entries.find((e) => e.name === "plain-folder")?.isRepo).toBe(false);
  });

  it("refuses relative paths", async () => {
    const result = await browseDirectory("relative/path");
    expect(result.error).toBeTruthy();
    expect(result.entries).toEqual([]);
  });

  it("returns an error field instead of throwing on a missing path", async () => {
    const result = await browseDirectory(join(dir, "does-not-exist"));
    expect(result.error).toBeTruthy();
    expect(result.entries).toEqual([]);
  });
});

describe("mergeRecent", () => {
  it("puts the newest path first", () => {
    const result = mergeRecent([{ path: "/a", boundAt: "t1" }], "/b", "t2");
    expect(result.map((r) => r.path)).toEqual(["/b", "/a"]);
  });

  it("dedupes by moving a re-bound path to the front", () => {
    const existing = [
      { path: "/a", boundAt: "t1" },
      { path: "/b", boundAt: "t2" }
    ];
    const result = mergeRecent(existing, "/a", "t3");
    expect(result).toEqual([
      { path: "/a", boundAt: "t3" },
      { path: "/b", boundAt: "t2" }
    ]);
  });

  it("caps the list at 10 entries", () => {
    const existing = Array.from({ length: 10 }, (_, i) => ({ path: `/p${i}`, boundAt: `t${i}` }));
    const result = mergeRecent(existing, "/new", "tNew");
    expect(result).toHaveLength(10);
    expect(result[0].path).toBe("/new");
    expect(result.some((r) => r.path === "/p9")).toBe(false);
  });
});
