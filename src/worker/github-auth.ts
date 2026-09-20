import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { PluginSettings } from "../shared/types.js";

const execFile = promisify(execFileCb);
const GH_TIMEOUT_MS = 5_000;
const GH_CACHE_TTL_MS = 10 * 60_000;

export interface GhCliStatus {
  available: boolean;
  login?: string;
  error?: string;
}

export type ExecFileFn = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

const defaultExec: ExecFileFn = (file, args) => execFile(file, args, { timeout: GH_TIMEOUT_MS });

export async function detectGhCli(exec: ExecFileFn = defaultExec): Promise<GhCliStatus> {
  try {
    await exec("gh", ["auth", "token"]);
  } catch (error) {
    return { available: false, error: (error as Error).message };
  }
  try {
    const { stdout } = await exec("gh", ["api", "user", "--jq", ".login"]);
    return { available: true, login: stdout.trim() || undefined };
  } catch (error) {
    return { available: true, error: (error as Error).message };
  }
}

interface CachedToken {
  token: string;
  at: number;
}

const ghTokenCache = new Map<string, CachedToken>();

async function ghCliToken(exec: ExecFileFn, cacheKey: string): Promise<string | null> {
  const cached = ghTokenCache.get(cacheKey);
  if (cached && Date.now() - cached.at < GH_CACHE_TTL_MS) return cached.token;
  try {
    const { stdout } = await exec("gh", ["auth", "token"]);
    const token = stdout.trim();
    if (!token) return null;
    ghTokenCache.set(cacheKey, { token, at: Date.now() });
    return token;
  } catch {
    return null;
  }
}

export async function resolveGithubToken(
  ctx: PluginContext,
  companyId: string,
  settings: PluginSettings,
  exec: ExecFileFn = defaultExec
): Promise<string | null> {
  const ref = settings.githubToken;
  const mode = settings.githubAuth ?? "auto";

  if (mode === "secret" || mode === "auto") {
    if (ref && typeof ref === "object") {
      try {
        const token = await ctx.secrets.resolve(ref as never, { companyId, configPath: "githubToken" });
        if (token) return token;
      } catch {
        ctx.logger.warn("Could not resolve githubToken secret", { companyId });
      }
    }
    if (mode === "secret") return null;
  }

  if (mode === "gh-cli" || mode === "auto") {
    const token = await ghCliToken(exec, companyId);
    if (token) return token;
  }

  return null;
}
