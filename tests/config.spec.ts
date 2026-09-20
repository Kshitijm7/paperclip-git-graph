import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import { DEFAULTS, resolveConfig } from "../src/worker/config.js";

describe("resolveConfig", () => {
  it("applies every default when the stored config is null", async () => {
    const harness = createTestHarness({ manifest, config: null as unknown as Record<string, unknown> });
    const resolved = await resolveConfig(harness.ctx, "company-1");
    expect(resolved).toEqual(DEFAULTS);
  });

  it("layers a partial config over the defaults field by field", async () => {
    const harness = createTestHarness({ manifest, config: { commitLimit: 50, githubRepo: "org/repo" } });
    const resolved = await resolveConfig(harness.ctx, "company-1");
    expect(resolved.commitLimit).toBe(50);
    expect(resolved.githubRepo).toBe("org/repo");
    expect(resolved.fetchIntervalMinutes).toBe(DEFAULTS.fetchIntervalMinutes);
    expect(resolved.branchPattern).toBe(DEFAULTS.branchPattern);
  });

  it("falls back to the default branch pattern and does not throw on a broken regex", async () => {
    const harness = createTestHarness({ manifest, config: { branchPattern: "^agent/([" } });
    const resolved = await resolveConfig(harness.ctx, "company-1");
    expect(resolved.branchPattern).toBe(DEFAULTS.branchPattern);
    expect(harness.logs.some((l) => l.level === "warn" && l.message.includes("branchPattern"))).toBe(true);
  });
});
