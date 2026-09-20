import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import { ACTION_KEYS, DATA_KEYS, FOLDER_KEY } from "../src/shared/types.js";

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
      "githubRepo",
      "githubToken"
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
