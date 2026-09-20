import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitCommit, GitRef, GitWorktree } from "../shared/types.js";

const run = promisify(execFile);

const UNIT = "";
const RECORD = "";

export class GitError extends Error {}

export async function git(cwd: string, args: string[], timeoutMs = 20000): Promise<string> {
  try {
    const { stdout } = await run("git", args, { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    return stdout;
  } catch (error) {
    throw new GitError(describeGitFailure(error, args));
  }
}

function describeGitFailure(error: unknown, args: string[]): string {
  const err = error as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
  const stderr = (err?.stderr ?? "").trim();
  if (err?.code === "ENOENT") return "git binary not found on PATH. Install git and restart Paperclip.";
  if (err?.killed) return `git ${args[0]} timed out.`;
  if (/not a git repository/i.test(stderr)) return "The bound folder is not a git repository (no .git directory).";
  if (/dubious ownership/i.test(stderr)) return `git refused the repository as unsafe. ${stderr}`;
  if (stderr) return `git ${args[0]} failed: ${stderr.split("\n")[0]}`;
  return `git ${args[0]} failed: ${err?.message ?? "unknown error"}`;
}

export async function gitVersion(cwd: string): Promise<string> {
  return (await git(cwd, ["--version"], 5000)).trim();
}

export async function readRefs(cwd: string): Promise<GitRef[]> {
  const format = ["%(refname)", "%(objectname)", "%(upstream:short)", "%(upstream:track)", "%(HEAD)"].join("%1f");
  const out = await git(cwd, ["for-each-ref", `--format=${format}%1e`, "refs/heads", "refs/remotes", "refs/tags"]);
  return parseRefs(out);
}

export function parseRefs(stdout: string): GitRef[] {
  const refs: GitRef[] = [];
  for (const record of stdout.split(RECORD)) {
    const line = record.replace(/^[\r\n]+/, "");
    if (!line.trim()) continue;
    const [refname, sha, upstream, track, head] = line.split(UNIT);
    const kind = refKind(refname);
    if (!kind) continue;
    const ref: GitRef = {
      name: shortRefName(refname),
      kind,
      sha,
      isCurrent: head === "*"
    };
    if (upstream) ref.upstream = upstream;
    const counts = parseTrack(track ?? "");
    if (counts.ahead !== undefined) ref.ahead = counts.ahead;
    if (counts.behind !== undefined) ref.behind = counts.behind;
    refs.push(ref);
  }
  return refs;
}

function refKind(refname: string): GitRef["kind"] | null {
  if (refname.startsWith("refs/heads/")) return "local";
  if (refname.startsWith("refs/remotes/")) return "remote";
  if (refname.startsWith("refs/tags/")) return "tag";
  return null;
}

export function shortRefName(refname: string): string {
  return refname.replace(/^refs\/(heads|remotes|tags)\//, "").replace(/\^\{\}$/, "");
}

export function parseTrack(track: string): { ahead?: number; behind?: number } {
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  const result: { ahead?: number; behind?: number } = {};
  if (ahead) result.ahead = Number(ahead[1]);
  if (behind) result.behind = Number(behind[1]);
  return result;
}

export async function readCommits(
  cwd: string,
  limit: number,
  firstParentOnly = false,
  branch?: string
): Promise<GitCommit[]> {
  const args = [
    "log",
    "--topo-order",
    "--date=iso-strict",
    `--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1e`,
    `--max-count=${limit}`
  ];
  if (firstParentOnly) args.push("--first-parent");
  if (branch) args.push(branch);
  else args.push("--all");
  return parseCommits(await git(cwd, args, 60000));
}

export function parseCommits(stdout: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const record of stdout.split(RECORD)) {
    const line = record.replace(/^[\r\n]+/, "");
    if (!line.trim()) continue;
    const [sha, parents, author, email, date, subject, decorations] = line.split(UNIT);
    const refs = (decorations ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.replace(/^HEAD -> /, "").replace(/^tag: /, ""));
    commits.push({
      sha,
      parents: (parents ?? "").split(" ").filter(Boolean),
      author,
      email,
      date,
      subject: subject ?? "",
      refs,
      isHead: /(^|,)\s*HEAD(\s|->|$)/.test(decorations ?? "")
    });
  }
  return commits;
}

export async function readWorktrees(cwd: string): Promise<GitWorktree[]> {
  return parseWorktrees(await git(cwd, ["worktree", "list", "--porcelain"]));
}

export function parseWorktrees(stdout: string): GitWorktree[] {
  const trees: GitWorktree[] = [];
  let current: Partial<GitWorktree> | null = null;
  const flush = () => {
    if (current?.path) trees.push({ path: current.path, branch: current.branch ?? null, sha: current.sha ?? "" });
    current = null;
  };
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: line.slice(9) };
    } else if (line.startsWith("HEAD ") && current) {
      current.sha = line.slice(5);
    } else if (line.startsWith("branch ") && current) {
      current.branch = shortRefName(line.slice(7));
    } else if (line === "detached" && current) {
      current.branch = null;
    }
  }
  flush();
  return trees;
}

export async function fetchAll(cwd: string): Promise<void> {
  await git(cwd, ["fetch", "--all", "--prune"], 120000);
}

export async function readHead(cwd: string): Promise<{ sha: string; branch: string | null }> {
  const sha = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  const branch = (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  return { sha, branch: branch === "HEAD" ? null : branch };
}

export async function readOriginUrl(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ["remote", "get-url", "origin"])).trim() || null;
  } catch {
    return null;
  }
}
