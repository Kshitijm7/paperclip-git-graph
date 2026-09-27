import type { PluginContext } from "@paperclipai/plugin-sdk";
import { DEFAULT_BRANCH_PATTERN, DEFAULT_COMMIT_LIMIT, DEFAULT_FETCH_INTERVAL_MINUTES } from "../manifest.js";
import { THEME_PRESETS } from "../shared/types.js";
import type { PluginSettings } from "../shared/types.js";

export type { PluginSettings };

export const DEFAULTS: PluginSettings = {
  githubRepo: "",
  fetchIntervalMinutes: DEFAULT_FETCH_INTERVAL_MINUTES,
  commitLimit: DEFAULT_COMMIT_LIMIT,
  branchPattern: DEFAULT_BRANCH_PATTERN,
  githubToken: null,
  githubAuth: "auto",
  theme: "paperclip",
  trunk: "",
  remote: "",
  farBehindCommits: 20,
  staleDays: 3,
  hungRunMinutes: 60,
  timelineHours: 24
};

export const GENERIC_ISSUE_PATTERN = "(?<issue>[A-Z][A-Z0-9]+-\\d+)";

export function patternForPrefix(prefix: string | null | undefined): string {
  if (!prefix || !/^[A-Za-z0-9]+$/.test(prefix)) return GENERIC_ISSUE_PATTERN;
  return `(?<issue>${prefix}-\\d+)`;
}

function positive(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const GITHUB_AUTH_MODES = new Set(["auto", "secret", "gh-cli", "none"]);

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
  if (!branchPattern) {
    const company = await ctx.companies.get(companyId).catch(() => null);
    resolvedBranchPattern = patternForPrefix(company?.issuePrefix);
  } else if (!isValidPattern(branchPattern)) {
    if (!warnedCompanies.has(companyId)) {
      warnedCompanies.add(companyId);
      ctx.logger.warn("Invalid branchPattern in config, falling back to default", { companyId, branchPattern });
    }
    const company = await ctx.companies.get(companyId).catch(() => null);
    resolvedBranchPattern = patternForPrefix(company?.issuePrefix);
  }

  return {
    githubRepo: typeof raw.githubRepo === "string" ? raw.githubRepo : DEFAULTS.githubRepo,
    fetchIntervalMinutes: Number.isFinite(fetchIntervalMinutes) && fetchIntervalMinutes > 0 ? fetchIntervalMinutes : DEFAULTS.fetchIntervalMinutes,
    commitLimit: Number.isFinite(commitLimit) && commitLimit > 0 ? commitLimit : DEFAULTS.commitLimit,
    branchPattern: resolvedBranchPattern,
    githubToken: raw.githubToken ?? DEFAULTS.githubToken,
    githubAuth: typeof raw.githubAuth === "string" && GITHUB_AUTH_MODES.has(raw.githubAuth) ? (raw.githubAuth as PluginSettings["githubAuth"]) : DEFAULTS.githubAuth,
    theme: typeof raw.theme === "string" && (THEME_PRESETS as string[]).includes(raw.theme) ? (raw.theme as PluginSettings["theme"]) : DEFAULTS.theme,
    trunk: typeof raw.trunk === "string" ? raw.trunk.trim() : DEFAULTS.trunk,
    remote: typeof raw.remote === "string" ? raw.remote.trim() : DEFAULTS.remote,
    farBehindCommits: positive(raw.farBehindCommits, DEFAULTS.farBehindCommits),
    staleDays: positive(raw.staleDays, DEFAULTS.staleDays),
    hungRunMinutes: positive(raw.hungRunMinutes, DEFAULTS.hungRunMinutes),
    timelineHours: Math.min(168, positive(raw.timelineHours, DEFAULTS.timelineHours))
  };
}
