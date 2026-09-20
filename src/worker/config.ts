import type { PluginContext } from "@paperclipai/plugin-sdk";
import { DEFAULT_BRANCH_PATTERN, DEFAULT_COMMIT_LIMIT, DEFAULT_FETCH_INTERVAL_MINUTES } from "../manifest.js";
import type { PluginSettings } from "../shared/types.js";

export type { PluginSettings };

export const DEFAULTS: PluginSettings = {
  githubRepo: "",
  fetchIntervalMinutes: DEFAULT_FETCH_INTERVAL_MINUTES,
  commitLimit: DEFAULT_COMMIT_LIMIT,
  branchPattern: DEFAULT_BRANCH_PATTERN,
  githubToken: null
};

const warnedCompanies = new Set<string>();

function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export async function resolveConfig(ctx: PluginContext, companyId: string): Promise<PluginSettings> {
  let raw: Record<string, unknown> | null = null;
  try {
    raw = (await ctx.config.get(companyId)) as Record<string, unknown> | null;
  } catch {
    raw = null;
  }
  raw = raw ?? {};

  const fetchIntervalMinutes = Number(raw.fetchIntervalMinutes);
  const commitLimit = Number(raw.commitLimit);
  const branchPattern = typeof raw.branchPattern === "string" && raw.branchPattern ? raw.branchPattern : DEFAULTS.branchPattern;

  let resolvedBranchPattern = branchPattern;
  if (!isValidPattern(branchPattern)) {
    if (!warnedCompanies.has(companyId)) {
      warnedCompanies.add(companyId);
      ctx.logger.warn("Invalid branchPattern in config, falling back to default", { companyId, branchPattern });
    }
    resolvedBranchPattern = DEFAULTS.branchPattern;
  }

  return {
    githubRepo: typeof raw.githubRepo === "string" ? raw.githubRepo : DEFAULTS.githubRepo,
    fetchIntervalMinutes: Number.isFinite(fetchIntervalMinutes) && fetchIntervalMinutes > 0 ? fetchIntervalMinutes : DEFAULTS.fetchIntervalMinutes,
    commitLimit: Number.isFinite(commitLimit) && commitLimit > 0 ? commitLimit : DEFAULTS.commitLimit,
    branchPattern: resolvedBranchPattern,
    githubToken: raw.githubToken ?? DEFAULTS.githubToken
  };
}
