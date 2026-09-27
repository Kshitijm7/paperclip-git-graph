import type { CSSProperties } from "react";
import type { Badge } from "./helpers.js";

export function Pill({ badge, title }: { badge: Badge; title?: string }) {
  return (
    <span className="gg-pill" title={title ?? badge.label} style={{ "--pill": badge.color } as CSSProperties}>
      {badge.label}
    </span>
  );
}

export function TrunkDelta({ ahead, behind, trunk }: { ahead?: number; behind?: number; trunk: string }) {
  if (ahead == null && behind == null) return <span className="gg-dim">-</span>;
  return (
    <span title={`${ahead ?? 0} commits not in ${trunk}, ${behind ?? 0} commits in ${trunk} not on this branch`}>
      <span className="gg-num-ahead">{ahead ?? 0} ahead</span>
      <span className="gg-dim"> · </span>
      <span className={behind ? "gg-num-behind" : "gg-dim"}>{behind ?? 0} behind</span>
    </span>
  );
}
