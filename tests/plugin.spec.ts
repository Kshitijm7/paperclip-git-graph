import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import { ACTION_KEYS, DATA_KEYS, FOLDER_KEY } from "../src/shared/types.js";
import type { RepoSnapshot } from "../src/shared/types.js";
import { createFakeDb } from "./fake-db.js";

describe("manifest", () => {
  it("declares every capability the worker and UI use", () => {
    for (const capability of [
      "local.folders",
      "projects.read",
      "issues.read",
      "issue.comments.read",
      "agents.read",
      "http.outbound",
      "secrets.read-ref",
      "jobs.schedule",
      "plugin.state.read",
      "plugin.state.write",
      "ui.page.register",
      "ui.sidebar.register",
      "ui.dashboardWidget.register",
      "events.subscribe"
    ]) {
      expect(manifest.capabilities).toContain(capability);
    }
  });

  it("declares the repo folder, the fetch job and the three UI slots", () => {
    expect(manifest.localFolders?.[0]).toMatchObject({
      folderKey: FOLDER_KEY,
      displayName: "Git repository",
      access: "read",
      requiredDirectories: [".git"]
    });
    expect(manifest.jobs).toEqual([expect.objectContaining({ jobKey: "fetch", schedule: "*/15 * * * *" })]);
    expect(manifest.ui?.slots?.map((slot) => [slot.type, slot.id, slot.exportName])).toEqual([
      ["page", "graph", "GraphPage"],
      ["sidebar", "nav", "SidebarLink"],
      ["dashboardWidget", "summary", "SummaryWidget"]
    ]);
    expect(manifest.ui?.slots?.[0].routePath).toBe("git-graph");
  });

  it("exposes the configurable settings the worker reads", () => {
    const properties = (manifest.instanceConfigSchema as { properties: Record<string, Record<string, unknown>> }).properties;
    expect(Object.keys(properties).sort()).toEqual([
      "branchPattern",
      "commitLimit",
      "fetchIntervalMinutes",
      "githubAuth",
      "githubRepo",
      "githubToken",
      "theme",
      "trunk"
    ]);
    expect(properties.githubToken.format).toBe("secret-ref");
    expect(properties.fetchIntervalMinutes.default).toBe(15);
    expect(properties.commitLimit.default).toBe(400);
  });
});

describe("worker registration", () => {
  it("registers the contract's data keys and actions", async () => {
    const harness = createTestHarness({ manifest });
    await plugin.definition.setup(harness.ctx);

    for (const key of Object.values(DATA_KEYS)) {
      await expect(harness.getData(key, {})).rejects.toThrow(/companyId is required/);
    }
    for (const key of Object.values(ACTION_KEYS)) {
      await expect(harness.performAction(key, {})).rejects.toThrow(/companyId is required/);
    }
  });
});

describe("scheduled fetch job", () => {
  it("iterates every company and resolves without an unbound folder throwing", async () => {
    const harness = createTestHarness({ manifest });
    await plugin.definition.setup(harness.ctx);
    harness.seed({
      companies: [
        { id: "company-a", name: "A" } as never,
        { id: "company-b", name: "B" } as never
      ]
    });

    await expect(harness.runJob("fetch")).resolves.toBeUndefined();

    expect(harness.getState({ scopeKind: "company", scopeId: "company-a", stateKey: "fetchedAt" })).toBeUndefined();
    expect(harness.getState({ scopeKind: "company", scopeId: "company-b", stateKey: "fetchedAt" })).toBeUndefined();
  });
});

describe("status github block", () => {
  it("reports mode 'none' without touching secrets or gh cli when githubAuth is 'none'", async () => {
    const harness = createTestHarness({ manifest });
    await plugin.definition.setup(harness.ctx);
    harness.setConfig({ githubAuth: "none" });

    const status = (await harness.getData(DATA_KEYS.status, { companyId: "company-a" })) as {
      github: { mode: string; ok: boolean };
    };
    expect(status.github).toEqual({ mode: "none", ok: false });
  });
});

describe("onValidateConfig", () => {
  it("accepts an empty config with a default-interval warning", async () => {
    const result = await plugin.definition.onValidateConfig!({});
    expect(result.ok).toBe(true);
    expect(result.warnings?.[0]).toContain("15");
  });

  it("rejects an out-of-range interval, a bad repo slug and a broken pattern", async () => {
    const result = await plugin.definition.onValidateConfig!({
      fetchIntervalMinutes: 0,
      githubRepo: "not-a-slug",
      branchPattern: "^agent/(["
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(3);
  });

  it("accepts a valid config", async () => {
    const result = await plugin.definition.onValidateConfig!({
      fetchIntervalMinutes: 30,
      githubRepo: "Kshitijm7/paperclip-git-graph",
      branchPattern: "^agent/(?<issue>[A-Z]+-\\d+)-"
    });
    expect(result.ok).toBe(true);
  });
});

describe("branch ownership entities and tool", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gg-plugin-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
    writeFileSync(join(dir, "a.txt"), "1");
    execFileSync("git", ["add", "a.txt"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "first"], { cwd: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("upserts one git-branch entity per branch and exposes them through the git_graph_branches tool", async () => {
    const harness = createTestHarness({ manifest });
    (harness.ctx as { db: unknown }).db = createFakeDb("test_ns");
    await plugin.definition.setup(harness.ctx);

    await harness.performAction(ACTION_KEYS.bindFolder, { companyId: "company-1", path: dir });

    const branches = await harness.getData(DATA_KEYS.branches, { companyId: "company-1" });
    expect(branches).toEqual([expect.objectContaining({ branch: "main" })]);

    const entities = await harness.ctx.entities.list({ entityType: "git-branch", scopeKind: "company", scopeId: "company-1" });
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({ externalId: "main", title: "main", status: "no-pr" });

    const result = await harness.executeTool("git_graph_branches", { companyId: "company-1" });
    expect(result.content).toContain("main");
    expect(result.data).toEqual([expect.objectContaining({ branch: "main" })]);
  });
});

describe("snapshot fast path", () => {
  let dir: string;

  function commit(message: string) {
    writeFileSync(join(dir, "a.txt"), message);
    execFileSync("git", ["add", "a.txt"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gg-fastpath-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
    for (let i = 0; i < 6; i += 1) commit(`commit ${i}`);
  });

  afterEach(() => {
    // Windows can hold a git.exe handle open for a moment after the subprocess exits.
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; the OS temp dir gets swept eventually
    }
  });

  it("never calls the ownership/PR loader on a snapshot read, only when refresh-ownership runs", async () => {
    const harness = createTestHarness({ manifest });
    (harness.ctx as { db: unknown }).db = createFakeDb("test_ns");
    await plugin.definition.setup(harness.ctx);
    await harness.performAction(ACTION_KEYS.bindFolder, { companyId: "company-1", path: dir });

    const issuesListSpy = vi.spyOn(harness.ctx.issues, "list");

    // Miss path (nothing persisted yet): rebuilds commits/refs from git but skips ownership.
    const first = (await harness.getData(DATA_KEYS.snapshot, { companyId: "company-1" })) as RepoSnapshot;
    expect(first.commits.length).toBe(6);
    expect(issuesListSpy).not.toHaveBeenCalled();

    // Hit path (refsHash unchanged): served from the DB tables, still no ownership recompute.
    const second = (await harness.getData(DATA_KEYS.snapshot, { companyId: "company-1" })) as RepoSnapshot;
    expect(second.commits.length).toBe(6);
    expect(issuesListSpy).not.toHaveBeenCalled();

    await harness.performAction(ACTION_KEYS.refreshOwnership, { companyId: "company-1" });
    expect(issuesListSpy).toHaveBeenCalled();
  });

  it("honours offset/limit and reports total from the stored commit count", async () => {
    const harness = createTestHarness({ manifest });
    (harness.ctx as { db: unknown }).db = createFakeDb("test_ns");
    await plugin.definition.setup(harness.ctx);
    await harness.performAction(ACTION_KEYS.bindFolder, { companyId: "company-1", path: dir });

    await harness.getData(DATA_KEYS.snapshot, { companyId: "company-1" }); // warms the DB cache

    const page = (await harness.getData(DATA_KEYS.snapshot, { companyId: "company-1", offset: 2, limit: 2 })) as RepoSnapshot;
    expect(page.commits).toHaveLength(2);
    expect(page.commits[0].subject).toBe("commit 3");
    expect(page.total).toBe(6);
  });
});
