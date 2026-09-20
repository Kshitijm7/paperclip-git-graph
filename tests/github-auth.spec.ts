import { describe, expect, it, vi } from "vitest";
import { detectGhCli, resolveGithubToken } from "../src/worker/github-auth.js";
import type { PluginSettings } from "../src/shared/types.js";

function ctxWith(secretToken: string | null) {
  return {
    secrets: {
      resolve: vi.fn(async () => {
        if (secretToken === null) throw new Error("no secret");
        return secretToken;
      })
    },
    logger: { warn: vi.fn() }
  } as any;
}

const baseSettings: PluginSettings = {
  githubRepo: "",
  fetchIntervalMinutes: 15,
  commitLimit: 400,
  branchPattern: "^agent/(?<issue>[A-Z]+-\\d+)-",
  githubToken: null,
  githubAuth: "auto"
};

describe("resolveGithubToken", () => {
  it("prefers the configured secret in auto mode", async () => {
    const ctx = ctxWith("secret-token");
    const exec = vi.fn(async () => ({ stdout: "gh-token\n", stderr: "" }));
    const token = await resolveGithubToken(ctx, "co-1", { ...baseSettings, githubToken: {} }, exec);
    expect(token).toBe("secret-token");
    expect(exec).not.toHaveBeenCalled();
  });

  it("falls back to gh cli in auto mode when no secret is configured", async () => {
    const ctx = ctxWith(null);
    const exec = vi.fn(async () => ({ stdout: "gh-token\n", stderr: "" }));
    const token = await resolveGithubToken(ctx, "co-1", baseSettings, exec);
    expect(token).toBe("gh-token");
  });

  it("returns null in auto mode when neither secret nor gh cli is available", async () => {
    const ctx = ctxWith(null);
    const exec = vi.fn(async () => {
      throw new Error("gh not found");
    });
    const token = await resolveGithubToken(ctx, "co-none", baseSettings, exec);
    expect(token).toBeNull();
  });

  it("mode 'secret' never calls gh cli", async () => {
    const ctx = ctxWith(null);
    const exec = vi.fn(async () => ({ stdout: "gh-token\n", stderr: "" }));
    const token = await resolveGithubToken(ctx, "co-1", { ...baseSettings, githubAuth: "secret" }, exec);
    expect(token).toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });

  it("mode 'gh-cli' never resolves the secret", async () => {
    const ctx = ctxWith("secret-token");
    const exec = vi.fn(async () => ({ stdout: "gh-token\n", stderr: "" }));
    const token = await resolveGithubToken(ctx, "co-2", { ...baseSettings, githubAuth: "gh-cli", githubToken: {} }, exec);
    expect(token).toBe("gh-token");
    expect(ctx.secrets.resolve).not.toHaveBeenCalled();
  });

  it("mode 'none' never checks either source", async () => {
    const ctx = ctxWith("secret-token");
    const exec = vi.fn(async () => ({ stdout: "gh-token\n", stderr: "" }));
    const token = await resolveGithubToken(ctx, "co-3", { ...baseSettings, githubAuth: "none", githubToken: {} }, exec);
    expect(token).toBeNull();
    expect(ctx.secrets.resolve).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("detectGhCli", () => {
  it("reports the logged-in login when gh is authenticated", async () => {
    const exec = vi.fn(async (_file: string, args: string[]) => {
      if (args[0] === "auth") return { stdout: "token\n", stderr: "" };
      return { stdout: "kshitijm7\n", stderr: "" };
    });
    expect(await detectGhCli(exec)).toEqual({ available: true, login: "kshitijm7" });
  });

  it("reports unavailable when gh is not installed or not logged in", async () => {
    const exec = vi.fn(async () => {
      throw new Error("command not found");
    });
    const status = await detectGhCli(exec);
    expect(status.available).toBe(false);
    expect(status.error).toContain("command not found");
  });
});
