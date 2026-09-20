import { useState } from "react";
import { useHostNavigation } from "@paperclipai/plugin-sdk/ui";
import type { ActivityData } from "../../shared/types.js";
import { prStateVar, relativeDate } from "../theme.js";
import { agentHueColor, sortIssues, stageSegments, type IssueSort } from "./helpers.js";

interface ProgressTabProps {
  activity: ActivityData | null;
  loading: boolean;
}

export function ProgressTab({ activity, loading }: ProgressTabProps) {
  const hostNavigation = useHostNavigation();
  const [sort, setSort] = useState<IssueSort>("staleness");
  const [hideMerged, setHideMerged] = useState(false);

  if (loading && !activity) return <div style={{ padding: 16 }} className="gg-dim">Loading progress...</div>;

  const issues = sortIssues(activity?.issues ?? [], sort, hideMerged);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", borderBottom: "1px solid var(--gg-border)" }}>
        <select className="gg-input" value={sort} onChange={(e) => setSort(e.target.value as IssueSort)}>
          <option value="staleness">Sort: staleness</option>
          <option value="stage">Sort: stage</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={hideMerged} onChange={(e) => setHideMerged(e.target.checked)} />
          Hide merged
        </label>
      </div>

      {issues.length === 0 ? (
        <div style={{ padding: 16 }} className="gg-dim">
          No agent has pushed to this repo yet. Assign an issue and the branch shows here.
        </div>
      ) : (
        <div style={{ overflow: "auto", flex: 1 }}>
          {issues.map((issue) => {
            const filled = stageSegments(issue.stage);
            const hue = issue.agentName ? agentHueColor(issue.agentName) : "var(--gg-border)";
            return (
              <div
                key={issue.issueIdentifier}
                className="gg-row"
                style={{ gridTemplateColumns: "110px minmax(0,1.4fr) 110px 90px 70px 90px 70px 100px", padding: "0 10px", height: 30 }}
              >
                <a className="gg-link gg-mono" {...hostNavigation.linkProps(`/issues/${issue.issueIdentifier}`)}>
                  {issue.issueIdentifier}
                </a>
                <span className="gg-ell" title={issue.title}>{issue.title ?? issue.branch}</span>
                <span className="gg-ell gg-dim">{issue.agentName ?? ""}</span>
                <div style={{ display: "flex", gap: 2 }}>
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      style={{
                        width: 16,
                        height: 6,
                        borderRadius: 2,
                        background: i < filled ? hue : "var(--gg-border)",
                      }}
                    />
                  ))}
                </div>
                <span className="gg-mono gg-dim">{issue.commits}</span>
                <span className="gg-mono gg-dim">
                  +{issue.aheadOfTrunk} / -{issue.behindTrunk}
                </span>
                {issue.pr ? (
                  <span className="gg-chip" style={{ color: prStateVar[issue.pr.state] ?? "var(--gg-fg-dim)" }}>
                    #{issue.pr.number}
                  </span>
                ) : (
                  <span className="gg-dim">no PR</span>
                )}
                <span className="gg-dim">{issue.updatedAt ? relativeDate(issue.updatedAt) : ""}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
