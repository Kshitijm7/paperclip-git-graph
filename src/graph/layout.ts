import type { GitCommit } from "../shared/types.js";

export type DotType = "default" | "head" | "merge";

// An edge from the dot centre band of `row` at `lane` to the centre band of `row + 1` at `toLane`.
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

export const UNIT_WIDTH = 16;
export const LANE_MARGIN = 10;

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
    let col = lanes.indexOf(commit.sha);
    if (col === -1) {
      col = firstFreeSlot(lanes);
      laneColors[col] = colorPicker.next();
    }
    const color = laneColors[col]!;
    for (let i = 0; i < lanes.length; i++) {
      if (i !== col && lanes[i] === commit.sha) {
        lanes[i] = null;
        colorPicker.recycle(laneColors[i]!);
      }
    }

    const isHead = options.headSha ? commit.sha === options.headSha : commit.isHead;
    dots.push({ row, lane: col, color, type: isHead ? "head" : commit.parents.length > 1 ? "merge" : "default", sha: commit.sha });

    const parents = firstParentOnly ? commit.parents.slice(0, 1) : commit.parents;
    const fromDot = new Map<number, number>();
    lanes[col] = parents[0] ?? null;
    if (parents.length > 0) fromDot.set(col, color);
    else colorPicker.recycle(color);
    for (const parentSha of parents.slice(1)) {
      let lane = lanes.indexOf(parentSha);
      if (lane === -1) {
        lane = firstFreeSlot(lanes);
        lanes[lane] = parentSha;
        laneColors[lane] = colorPicker.next();
      }
      fromDot.set(lane, laneColors[lane]!);
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    const next = commits[row + 1];
    const nextCol = next ? lanes.indexOf(next.sha) : -1;
    for (let i = 0; i < lanes.length; i++) {
      const sha = lanes[i];
      if (sha === null || !next) continue;
      const toLane = sha === next.sha && nextCol !== -1 ? nextCol : i;
      const fromLane = fromDot.has(i) ? col : i;
      segments.push({ row, lane: fromLane, toLane, color: laneColors[i]! });
      maxLaneUsed = Math.max(maxLaneUsed, i, fromLane, toLane);
    }
    maxLaneUsed = Math.max(maxLaneUsed, col);
  });

  return { segments, dots, rowOf, laneWidth: laneX(maxLaneUsed) + LANE_MARGIN };
}
