// Pure helpers for GraphPage's lazy-loaded commit table. No React/host imports so they stay easy to unit test.
import type { GitCommit } from "../shared/types.js";

/** Keeps first occurrence order; drops later duplicates (worker may return sha it already sent). */
export function dedupeCommitsBySha(commits: GitCommit[]): GitCommit[] {
  const seen = new Set<string>();
  const out: GitCommit[] = [];
  for (const c of commits) {
    if (seen.has(c.sha)) continue;
    seen.add(c.sha);
    out.push(c);
  }
  return out;
}

/** Appends a newly fetched page to the already-merged commit list, deduping by sha. */
export function mergeCommitPage(existing: GitCommit[], incoming: GitCommit[]): GitCommit[] {
  return dedupeCommitsBySha([...existing, ...incoming]);
}

/** True when the scroll position is within `thresholdRows` of the bottom of the rendered content. */
export function isNearBottom(
  scrollTop: number,
  viewportHeight: number,
  contentHeight: number,
  rowHeight: number,
  thresholdRows = 20,
): boolean {
  if (rowHeight <= 0) return false;
  const remaining = contentHeight - (scrollTop + viewportHeight);
  return remaining <= thresholdRows * rowHeight;
}

/** True when a page returned fewer rows than requested, or the offset has reached the known total. */
export function isEndOfPages(returnedCount: number, requestedLimit: number, offset: number, total?: number): boolean {
  if (returnedCount < requestedLimit) return true;
  if (typeof total === "number" && offset + returnedCount >= total) return true;
  return false;
}
