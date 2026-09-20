import { describe, expect, it } from "vitest";
import { dedupeCommitsBySha, isEndOfPages, isNearBottom, mergeCommitPage } from "../src/ui/pagination.js";
import type { GitCommit } from "../src/shared/types.js";

function commit(sha: string): GitCommit {
  return { sha, parents: [], author: "a", email: "a@x.com", date: "2026-01-01T00:00:00.000Z", subject: sha, refs: [], isHead: false };
}

describe("dedupeCommitsBySha", () => {
  it("keeps first occurrence and drops later duplicates", () => {
    const out = dedupeCommitsBySha([commit("a"), commit("b"), commit("a")]);
    expect(out.map((c) => c.sha)).toEqual(["a", "b"]);
  });

  it("returns empty for empty input", () => {
    expect(dedupeCommitsBySha([])).toEqual([]);
  });
});

describe("mergeCommitPage", () => {
  it("appends a new page after the existing merged list", () => {
    const merged = mergeCommitPage([commit("a"), commit("b")], [commit("c"), commit("d")]);
    expect(merged.map((c) => c.sha)).toEqual(["a", "b", "c", "d"]);
  });

  it("dedupes when the worker returns overlapping rows (offset not yet implemented)", () => {
    const merged = mergeCommitPage([commit("a"), commit("b")], [commit("a"), commit("b"), commit("c")]);
    expect(merged.map((c) => c.sha)).toEqual(["a", "b", "c"]);
  });
});

describe("isNearBottom", () => {
  const rowHeight = 26;
  const viewportHeight = 520;

  it("is false when far from the bottom", () => {
    expect(isNearBottom(0, viewportHeight, 26 * 1000, rowHeight)).toBe(false);
  });

  it("is true within the threshold of the bottom", () => {
    const contentHeight = 26 * 1000;
    const scrollTop = contentHeight - viewportHeight - 10 * rowHeight; // 10 rows from bottom
    expect(isNearBottom(scrollTop, viewportHeight, contentHeight, rowHeight)).toBe(true);
  });

  it("is false right at the threshold boundary plus one row", () => {
    const contentHeight = 26 * 1000;
    const scrollTop = contentHeight - viewportHeight - 21 * rowHeight;
    expect(isNearBottom(scrollTop, viewportHeight, contentHeight, rowHeight, 20)).toBe(false);
  });

  it("handles content shorter than the viewport", () => {
    expect(isNearBottom(0, viewportHeight, 26 * 3, rowHeight)).toBe(true);
  });
});

describe("isEndOfPages", () => {
  it("is true when fewer rows are returned than requested", () => {
    expect(isEndOfPages(40, 120, 0)).toBe(true);
  });

  it("is false when a full page is returned and total is unknown", () => {
    expect(isEndOfPages(120, 120, 0)).toBe(false);
  });

  it("is true once offset + returned reaches the known total", () => {
    expect(isEndOfPages(120, 120, 480, 600)).toBe(true);
  });

  it("is false when a full page is returned and total is still ahead", () => {
    expect(isEndOfPages(120, 120, 0, 600)).toBe(false);
  });
});
