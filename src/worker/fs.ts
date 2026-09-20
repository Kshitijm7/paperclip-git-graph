import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { isAbsolute, join, dirname, resolve } from "node:path";
import type { PluginContext, Project } from "@paperclipai/plugin-sdk";
import type { BrowseEntry, BrowseResult, RecentRepo, RootEntry, WorkspaceCandidate } from "../shared/types.js";

const RECENT_KEY = "recent-repos";
const RECENT_CAP = 10;
const BROWSE_CAP = 500;
const SKIP_DIRS = new Set(["node_modules"]);

export function isRepoDir(path: string): boolean {
  return existsSync(join(path, ".git"));
}

function projectPaths(project: Project): string[] {
  const paths = new Set<string>();
  const codebasePath = project.codebase?.effectiveLocalFolder ?? project.codebase?.localFolder;
  if (codebasePath && isAbsolute(codebasePath)) paths.add(resolve(codebasePath));
  for (const workspace of project.workspaces ?? []) {
    if (workspace.cwd && isAbsolute(workspace.cwd)) paths.add(resolve(workspace.cwd));
  }
  return [...paths];
}

export async function listWorkspaceCandidates(ctx: PluginContext, companyId: string): Promise<WorkspaceCandidate[]> {
  const projects = await ctx.projects.list({ companyId, limit: 200 }).catch(() => []);
  const candidates: WorkspaceCandidate[] = [];
  for (const project of projects) {
    for (const path of projectPaths(project)) {
      candidates.push({ name: project.name, path, projectName: project.name, isRepo: isRepoDir(path) });
    }
  }
  return candidates;
}

export async function getRecent(ctx: PluginContext, companyId: string): Promise<RecentRepo[]> {
  const value = await ctx.state.get({ scopeKind: "company", scopeId: companyId, stateKey: RECENT_KEY });
  return Array.isArray(value) ? (value as RecentRepo[]) : [];
}

export function mergeRecent(existing: RecentRepo[], path: string, boundAt: string): RecentRepo[] {
  const deduped = existing.filter((entry) => entry.path !== path);
  return [{ path, boundAt }, ...deduped].slice(0, RECENT_CAP);
}

export async function pushRecent(ctx: PluginContext, companyId: string, path: string): Promise<void> {
  const existing = await getRecent(ctx, companyId);
  const updated = mergeRecent(existing, path, new Date().toISOString());
  await ctx.state.set({ scopeKind: "company", scopeId: companyId, stateKey: RECENT_KEY }, updated);
}

export function listRoots(): RootEntry[] {
  if (platform() === "win32") {
    const roots: RootEntry[] = [];
    for (let code = 65; code <= 90; code += 1) {
      const letter = String.fromCharCode(code);
      const path = `${letter}:\\`;
      if (existsSync(path)) roots.push({ label: `${letter}:`, path });
    }
    return roots;
  }
  return [
    { label: "/", path: "/" },
    { label: "~", path: homedir() }
  ];
}

export async function browseDirectory(path: string): Promise<BrowseResult> {
  if (!isAbsolute(path)) {
    return { path, parent: null, entries: [], error: "path must be absolute" };
  }
  const normalized = resolve(path);
  const parent = dirname(normalized) === normalized ? null : dirname(normalized);
  try {
    const dirents = await readdir(normalized, { withFileTypes: true });
    const entries: BrowseEntry[] = dirents
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name))
      .map((entry) => {
        const entryPath = join(normalized, entry.name);
        return { name: entry.name, path: entryPath, isRepo: isRepoDir(entryPath) };
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, BROWSE_CAP);
    return { path: normalized, parent, entries };
  } catch (error) {
    return { path: normalized, parent, entries: [], error: (error as Error).message };
  }
}
