import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import { persistSnapshot, readPersistedSnapshot, readRefsHash } from "../src/worker/cache.js";
import { appendEvents, diffPrEvents, diffRefEvents, readEvents } from "../src/worker/live.js";
import type { GitEvent, PullRequestInfo, RepoSnapshot } from "../src/shared/types.js";
import { createFakeDb } from "./fake-db.js";

function harnessWithDb() {
  const harness = createTestHarness({ manifest });
  (harness.ctx as { db: unknown }).db = createFakeDb("test_ns");
  return harness;
}

let dir: string;

function run(args: string[]) {
  execFileSync("git", args, { cwd: dir });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gg-cache-"));
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  writeFileSync(join(dir, "a.txt"), "1");
  run(["add", "a.txt"]);
  run(["commit", "-q", "-m", "first"]);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fakeSnapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    folderKey: "repo",
    path: dir,
    healthy: true,
    problems: [],
    fetchedAt: null,
    generatedAt: new Date().toISOString(),
    head: { sha: "aaa", branch: "main" },
    refs: [],
    commits: [],
    worktrees: [],
    ownership: [],
    truncated: false,
    ...overrides
  };
}

describe("readRefsHash", () => {
  it("changes when a ref moves and stays stable otherwise", async () => {
    const before = await readRefsHash(dir);
    expect(await readRefsHash(dir)).toBe(before);

    writeFileSync(join(dir, "a.txt"), "2");
    run(["add", "a.txt"]);
    run(["commit", "-q", "-m", "second"]);

    const after = await readRefsHash(dir);
    expect(after).not.toBe(before);
  });
});

describe("persistSnapshot / readPersistedSnapshot", () => {
  it("is a miss before anything is stored", async () => {
    const harness = harnessWithDb();
    expect(await readPersistedSnapshot(harness.ctx, "company-1")).toBeNull();
  });

  it("round-trips a snapshot and reports a hit once the refsHash matches", async () => {
    const harness = harnessWithDb();
    const refsHash = await readRefsHash(dir);
    const snapshot = fakeSnapshot();

    const meta = await persistSnapshot(harness.ctx, "company-1", snapshot, refsHash, 400);
    expect(meta.refsHash).toBe(refsHash);
    expect(meta.commitCount).toBe(0);

    const stored = await readPersistedSnapshot(harness.ctx, "company-1");
    expect(stored?.meta.refsHash).toBe(refsHash);
    expect(stored?.snapshot.path).toBe(dir);
  });

  it("reports a miss once the refsHash no longer matches (a ref moved)", async () => {
    const harness = harnessWithDb();
    const refsHash = await readRefsHash(dir);
    await persistSnapshot(harness.ctx, "company-1", fakeSnapshot(), refsHash, 400);

    writeFileSync(join(dir, "a.txt"), "2");
    run(["add", "a.txt"]);
    run(["commit", "-q", "-m", "second"]);
    const newHash = await readRefsHash(dir);

    const stored = await readPersistedSnapshot(harness.ctx, "company-1");
    expect(stored?.meta.refsHash).not.toBe(newHash);
  });

  it("truncates stored commits to the configured limit and drops emails past the size budget", async () => {
    const harness = harnessWithDb();
    const bigSubject = "x".repeat(2000);
    const commits = Array.from({ length: 10 }, (_, i) => ({
      sha: `sha${i}`,
      parents: [],
      author: "a",
      email: "a@example.com",
      date: new Date().toISOString(),
      subject: bigSubject,
      refs: [],
      isHead: i === 0
    }));
    const meta = await persistSnapshot(harness.ctx, "company-1", fakeSnapshot({ commits }), "hash", 3);
    expect(meta.commitCount).toBe(3);
    const stored = await readPersistedSnapshot(harness.ctx, "company-1");
    expect(stored?.snapshot.commits).toHaveLength(3);
  });
});

describe("events table", () => {
  it("caps reads at 200 entries, newest by timestamp first", async () => {
    const harness = harnessWithDb();
    const batch1: GitEvent[] = Array.from({ length: 150 }, (_, i) => ({
      id: `a-${i}`,
      at: new Date(i).toISOString(),
      kind: "fetch",
      summary: `event ${i}`
    }));
    await appendEvents(harness.ctx, "company-1", batch1);
    const batch2: GitEvent[] = Array.from({ length: 100 }, (_, i) => ({
      id: `b-${i}`,
      at: new Date(1000 + i).toISOString(),
      kind: "fetch",
      summary: `event b${i}`
    }));
    await appendEvents(harness.ctx, "company-1", batch2);

    const events = await readEvents(harness.ctx, "company-1");
    expect(events).toHaveLength(200);
    expect(events[0].summary).toBe("event b99");
  });
});

describe("diffRefEvents", () => {
  it("emits created, updated and deleted events from a ref map diff", () => {
    const before = new Map([
      ["develop", "sha1"],
      ["agent/MYS-1-x", "sha2"],
      ["gone-branch", "sha3"]
    ]);
    const after = new Map([
      ["develop", "sha1-new"],
      ["agent/MYS-1-x", "sha2"],
      ["agent/MYS-2-y", "sha4"]
    ]);
    const events = diffRefEvents(before, after);
    expect(events.find((e) => e.kind === "branch.updated")?.branch).toBe("develop");
    expect(events.find((e) => e.kind === "branch.created")?.branch).toBe("agent/MYS-2-y");
    expect(events.find((e) => e.kind === "branch.deleted")?.branch).toBe("gone-branch");
    expect(events.some((e) => e.branch === "agent/MYS-1-x")).toBe(false);
  });
});

describe("diffPrEvents", () => {
  function pr(overrides: Partial<PullRequestInfo>): PullRequestInfo {
    return {
      number: 1,
      title: "t",
      url: "u",
      state: "open",
      author: "a",
      headRef: "h",
      baseRef: "b",
      reviewers: [],
      updatedAt: "",
      ...overrides
    };
  }

  it("reports an opened PR that did not exist before", () => {
    const events = diffPrEvents([], [pr({ number: 5, state: "open" })]);
    expect(events).toEqual([expect.objectContaining({ kind: "pr.opened", prNumber: 5 })]);
  });

  it("reports merged and closed transitions but not unrelated state", () => {
    const before = [pr({ number: 1, state: "open" }), pr({ number: 2, state: "open" })];
    const after = [pr({ number: 1, state: "merged" }), pr({ number: 2, state: "closed" })];
    const events = diffPrEvents(before, after);
    expect(events).toEqual([
      expect.objectContaining({ kind: "pr.merged", prNumber: 1 }),
      expect.objectContaining({ kind: "pr.closed", prNumber: 2 })
    ]);
  });

  it("stays quiet when nothing changed", () => {
    const prs = [pr({ number: 1, state: "open" })];
    expect(diffPrEvents(prs, prs)).toEqual([]);
  });
});
