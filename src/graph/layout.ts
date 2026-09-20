// Port of SourceGit Models/CommitGraph.cs (MIT). Highlighting modes are dropped; every
// element carries `highlighted: true` so the field stays available for later.
import type { GitCommit } from "../shared/types.js";

export interface Point {
  x: number;
  y: number;
}

export interface GraphPath {
  points: Point[];
  color: number;
}

export interface GraphLink {
  start: Point;
  control: Point;
  end: Point;
  color: number;
}

export type DotType = "default" | "head" | "merge";

export interface GraphDot {
  center: Point;
  color: number;
  type: DotType;
  sha: string;
}

export interface GraphLayout {
  paths: GraphPath[];
  links: GraphLink[];
  dots: GraphDot[];
  rowOf: Record<string, number>;
  laneWidth: number;
}

export interface LayoutOptions {
  firstParentOnly?: boolean;
  headSha?: string;
}

// laneWidth tracks offsetX as lanes are laid out, but link start/control/end points can sit at an
// offsetX recorded on an earlier row; this walks every point directly so nothing is undercounted.
export function maxGraphX(layout: Pick<GraphLayout, "paths" | "links" | "dots">): number {
  let max = 0;
  for (const p of layout.paths) for (const pt of p.points) if (pt.x > max) max = pt.x;
  for (const l of layout.links) {
    if (l.start.x > max) max = l.start.x;
    if (l.control.x > max) max = l.control.x;
    if (l.end.x > max) max = l.end.x;
  }
  for (const d of layout.dots) if (d.center.x > max) max = d.center.x;
  return max;
}

export const UNIT_WIDTH = 12;
export const UNIT_HEIGHT = 1;

// s_defaultPenColors (orange, forest green, turquoise, olive, magenta, red, khaki, lime,
// royal blue, teal), darkened where the raw colour washes out on white.
export const GRAPH_COLORS = [
  "#e8952b",
  "#3f9142",
  "#1fb6c9",
  "#8a8a23",
  "#c24bc2",
  "#d93025",
  "#b89b3a",
  "#5aa626",
  "#4169e1",
  "#1f8a8a",
];

class ColorPicker {
  private queue: number[] = [];

  next(): number {
    if (this.queue.length === 0) {
      for (let i = 0; i < GRAPH_COLORS.length; i++) this.queue.push(i);
    }
    return this.queue.shift()!;
  }

  recycle(idx: number): void {
    if (!this.queue.includes(idx)) this.queue.push(idx);
  }
}

class PathHelper {
  path: GraphPath;
  next: string;
  lastX: number;
  private lastY: number;
  private endY = 0;

  constructor(next: string, color: number, start: Point, to?: Point) {
    this.next = next;
    this.path = { color, points: [start] };
    if (to) {
      this.path.points.push(to);
      this.lastX = to.x;
      this.lastY = to.y;
    } else {
      this.lastX = start.x;
      this.lastY = start.y;
    }
  }

  private add(x: number, y: number): void {
    if (this.endY < y) {
      this.path.points.push({ x, y });
      this.endY = y;
    }
  }

  pass(x: number, y: number, halfHeight: number): void {
    if (x > this.lastX) {
      this.add(this.lastX, this.lastY);
      this.add(x, y - halfHeight);
    } else if (x < this.lastX) {
      this.add(this.lastX, y - halfHeight);
      y += halfHeight;
      this.add(x, y);
    }
    this.lastX = x;
    this.lastY = y;
  }

  goto(x: number, y: number, halfHeight: number): void {
    if (x > this.lastX) {
      this.add(this.lastX, this.lastY);
      this.add(x, y - halfHeight);
    } else if (x < this.lastX) {
      let minY = y - halfHeight;
      if (minY > this.lastY) minY -= halfHeight;
      this.add(this.lastX, minY);
      this.add(x, y);
    }
    this.lastX = x;
    this.lastY = y;
  }

  end(x: number, y: number, halfHeight: number): void {
    if (x > this.lastX) {
      this.add(this.lastX, this.lastY);
      this.add(x, y - halfHeight);
    } else if (x < this.lastX) {
      this.add(this.lastX, y - halfHeight);
    }
    this.add(x, y);
    this.lastX = x;
    this.lastY = y;
  }
}

export function generateGraph(commits: GitCommit[], options: LayoutOptions = {}): GraphLayout {
  const halfWidth = UNIT_WIDTH / 2;
  const halfHeight = UNIT_HEIGHT / 2;
  const firstParentOnly = options.firstParentOnly ?? false;

  const paths: GraphPath[] = [];
  const links: GraphLink[] = [];
  const dots: GraphDot[] = [];
  const rowOf: Record<string, number> = {};

  const unsolved: PathHelper[] = [];
  const colorPicker = new ColorPicker();
  let offsetY = -halfHeight;
  let laneWidth = UNIT_WIDTH;

  commits.forEach((commit, row) => {
    rowOf[commit.sha] = row;
    offsetY += UNIT_HEIGHT;

    let major: PathHelper | null = null;
    let offsetX = 4 - halfWidth;
    const maxOffsetOld = unsolved.length > 0 ? unsolved[unsolved.length - 1]!.lastX : offsetX + UNIT_WIDTH;
    const ended: PathHelper[] = [];

    for (const l of unsolved) {
      if (l.next === commit.sha) {
        if (major === null) {
          offsetX += UNIT_WIDTH;
          major = l;
          if (commit.parents.length > 0) {
            major.next = commit.parents[0]!;
            major.goto(offsetX, offsetY, halfHeight);
          } else {
            major.end(offsetX, offsetY, halfHeight);
            ended.push(l);
          }
        } else {
          l.end(major.lastX, offsetY, halfHeight);
          ended.push(l);
        }
      } else {
        offsetX += UNIT_WIDTH;
        l.pass(offsetX, offsetY, halfHeight);
      }
    }

    for (const l of ended) {
      colorPicker.recycle(l.path.color);
      unsolved.splice(unsolved.indexOf(l), 1);
    }

    if (major === null) {
      offsetX += UNIT_WIDTH;
      if (commit.parents.length > 0) {
        major = new PathHelper(commit.parents[0]!, colorPicker.next(), { x: offsetX, y: offsetY });
        unsolved.push(major);
        paths.push(major.path);
      }
    }

    const position: Point = { x: major ? major.lastX : offsetX, y: offsetY };
    const dotColor = major ? major.path.color : 0;
    const isHead = options.headSha ? commit.sha === options.headSha : commit.isHead;
    dots.push({
      center: position,
      color: dotColor,
      type: isHead ? "head" : commit.parents.length > 1 ? "merge" : "default",
      sha: commit.sha,
    });

    if (!firstParentOnly) {
      for (let j = 1; j < commit.parents.length; j++) {
        const parentHash = commit.parents[j]!;
        const parent = unsolved.find((x) => x.next === parentHash);
        if (parent) {
          links.push({
            start: position,
            end: { x: parent.lastX, y: offsetY + halfHeight },
            control: { x: parent.lastX, y: position.y },
            color: parent.path.color,
          });
        } else {
          offsetX += UNIT_WIDTH;
          const l = new PathHelper(parentHash, colorPicker.next(), position, {
            x: offsetX,
            y: position.y + halfHeight,
          });
          unsolved.push(l);
          paths.push(l.path);
        }
      }
    }

    laneWidth = Math.max(laneWidth, Math.max(offsetX, maxOffsetOld) + halfWidth + 2);
  });

  const endY = (commits.length - 0.5) * UNIT_HEIGHT;
  unsolved.forEach((path, i) => {
    if (path.path.points.length === 1 && Math.abs(path.path.points[0]!.y - endY) < 0.0001) return;
    path.end((i + 0.5) * UNIT_WIDTH + 4, endY + halfHeight, halfHeight);
  });

  return { paths, links, dots, rowOf, laneWidth };
}
