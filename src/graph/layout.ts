import type { GitCommit } from "../shared/types.js";

export type DotType = "default" | "head" | "merge";

// A connector drawn across one row: from lane at the row's top edge to toLane at its bottom edge.
// lane === toLane is a straight vertical pass-through; lane !== toLane is a diagonal merge/branch.
export interface GraphSegment {
  row: number;
  lane: number;
  toLane: number;
  color: number;
}

export interface GraphDot {
  row: number;
  lane: number;
  color: number;
  type: DotType;
  sha: string;
}

export interface GraphLayout {
  segments: GraphSegment[];
  dots: GraphDot[];
  rowOf: Record<string, number>;
  laneWidth: number;
}

export interface LayoutOptions {
  firstParentOnly?: boolean;
  headSha?: string;
}

export const UNIT_WIDTH = 12;
export const LANE_MARGIN = 8;

export function laneX(lane: number): number {
  return LANE_MARGIN + lane * UNIT_WIDTH;
}

export function maxGraphX(layout: Pick<GraphLayout, "segments" | "dots">): number {
  let maxLane = 0;
  for (const d of layout.dots) if (d.lane > maxLane) maxLane = d.lane;
  for (const s of layout.segments) {
    if (s.lane > maxLane) maxLane = s.lane;
    if (s.toLane > maxLane) maxLane = s.toLane;
  }
  return laneX(maxLane) + LANE_MARGIN;
}

// Consumed by index; matches the 8 lane hues defined in ui/theme.ts.
export const GRAPH_COLORS_COUNT = 8;

class ColorPicker {
  private queue: number[] = [];

  next(): number {
    if (this.queue.length === 0) {
      for (let i = 0; i < GRAPH_COLORS_COUNT; i++) this.queue.push(i);
    }
    return this.queue.shift()!;
  }

  recycle(idx: number): void {
    if (!this.queue.includes(idx)) this.queue.push(idx);
  }
}

function firstFreeSlot(lanes: (string | null)[]): number {
  const idx = lanes.indexOf(null);
  if (idx !== -1) return idx;
  lanes.push(null);
  return lanes.length - 1;
}

export function generateGraph(commits: GitCommit[], options: LayoutOptions = {}): GraphLayout {
  const firstParentOnly = options.firstParentOnly ?? false;

  const segments: GraphSegment[] = [];
  const dots: GraphDot[] = [];
  const rowOf: Record<string, number> = {};

  const lanes: (string | null)[] = [];
  const laneColors: number[] = [];
  const colorPicker = new ColorPicker();
  let maxLaneUsed = 0;

  commits.forEach((commit, row) => {
    rowOf[commit.sha] = row;

    let laneIdx = lanes.indexOf(commit.sha);
    if (laneIdx === -1) {
      laneIdx = firstFreeSlot(lanes);
      laneColors[laneIdx] = colorPicker.next();
    }
    const color = laneColors[laneIdx]!;
    maxLaneUsed = Math.max(maxLaneUsed, laneIdx);

    // Other lanes also waiting for this commit converge into it.
    for (let i = 0; i < lanes.length; i++) {
      if (i !== laneIdx && lanes[i] === commit.sha) {
        segments.push({ row, lane: i, toLane: laneIdx, color: laneColors[i]! });
        lanes[i] = null;
        colorPicker.recycle(laneColors[i]!);
      }
    }

    // Unrelated active lanes just pass straight through this row.
    for (let i = 0; i < lanes.length; i++) {
      if (i !== laneIdx && lanes[i] !== null) {
        segments.push({ row, lane: i, toLane: i, color: laneColors[i]! });
      }
    }

    const isHead = options.headSha ? commit.sha === options.headSha : commit.isHead;
    dots.push({
      row,
      lane: laneIdx,
      color,
      type: isHead ? "head" : commit.parents.length > 1 ? "merge" : "default",
      sha: commit.sha,
    });

    if (commit.parents.length > 0) {
      lanes[laneIdx] = commit.parents[0]!;
      segments.push({ row, lane: laneIdx, toLane: laneIdx, color });
    } else {
      lanes[laneIdx] = null;
      colorPicker.recycle(color);
    }

    if (!firstParentOnly) {
      for (let j = 1; j < commit.parents.length; j++) {
        const parentSha = commit.parents[j]!;
        const existingLane = lanes.indexOf(parentSha);
        if (existingLane !== -1) {
          segments.push({ row: row + 1, lane: laneIdx, toLane: existingLane, color: laneColors[existingLane]! });
        } else {
          const newLane = firstFreeSlot(lanes);
          laneColors[newLane] = colorPicker.next();
          lanes[newLane] = parentSha;
          maxLaneUsed = Math.max(maxLaneUsed, newLane);
          segments.push({ row: row + 1, lane: laneIdx, toLane: newLane, color: laneColors[newLane]! });
        }
      }
    }
  });

  const laneWidth = laneX(maxLaneUsed) + LANE_MARGIN;
  return { segments, dots, rowOf, laneWidth };
}
