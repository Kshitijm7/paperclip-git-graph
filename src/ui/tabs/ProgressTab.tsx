import { useState } from "react";
import { useHostNavigation } from "@paperclipai/plugin-sdk/ui";
import type { ActivityData } from "../../shared/types.js";
import { relativeDate } from "../theme.js";
import { prBadge, sortIssues, stageBadge, stageSegments, type IssueSort } from "./helpers.js";
import { Pill, TrunkDelta } from "./Pill.js";
import { CompareSelect } from "./CompareSelect.js";

interface ProgressTabProps {
  activity: ActivityData | null;
  loading: boolean;
  onCompareChange: (branch: string) => void;
}

const COLUMNS = "minmax(64px, 0.5fr) minmax(0, 2.6fr) minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 0.8fr)";
const STEPS = ["Branch", "Commits", "Pull request", "Merged"];

export function ProgressTab({ activity, loading, onCompareChange }: ProgressTabProps) {
  const hostNavigation = useHostNavigation();
  const [sort, setSort] = useState<IssueSort>("staleness");
  const [hideMerged, setHideMerged] = useState(false);

  if (loading && !activity) return <div style={{ padding: 16 }} className="gg-dim">Loading progress...</div>;

  const issues = sortIssues(activity?.issues ?? [], sort, hideMerged);
  const trunk = activity?.trunk ?? "trunk";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", padding: "8px 14px", borderBottom: "1px solid var(--gg-border)" }}>
        <select className="gg-input" value={sort} onChange={(e) => setSort(e.target.value as IssueSort)}>
          <option value="staleness">Oldest update first</option>
          <option value="stage">Least progress first</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={hideMerged} onChange={(e) => setHideMerged(e.target.checked)} />
          Hide merged
        </label>
        <CompareSelect trunk={trunk} branches={activity?.branches ?? []} onChange={onCompareChange} />
        <span className="gg-dim" style={{ marginLeft: "auto", fontSize: 12 }}>{issues.length} issues</span>
      </div>

      {issues.length === 0 ? (
        <div style={{ padding: 16 }} className="gg-dim">
          No agent has pushed to this repo yet. Assign an issue and the branch shows here.
        </div>
      ) : (
        <div style={{ overflowY: "auto", overflowX: "hidden", flex: 1 }}>
          <div className="gg-table">
            <div className="gg-table-head" style={{ gridTemplateColumns: COLUMNS }}>
              <span>Issue</span>
              <span>Title and branch</span>
              <span>Agent</span>
              <span>Stage</span>
              <span>Compared to {trunk}</span>
              <span>Pull request</span>
              <span>Updated</span>
            </div>
            {issues.map((issue, idx) => {
              const stage = stageBadge(issue.stage);
              const filled = stageSegments(issue.stage);
              return (
                <div key={`${issue.issueIdentifier}:${issue.branch}:${idx}`} className="gg-table-row" style={{ gridTemplateColumns: COLUMNS }}>
                  <a className="gg-link gg-mono" {...hostNavigation.linkProps(`/issues/${issue.issueIdentifier}`)}>
                    {issue.issueIdentifier}
                  </a>
                  <span title={`${issue.title ?? ""}\n${issue.branch}`}>
                    <span className="gg-ell" style={{ display: "block" }}>{issue.title ?? issue.branch}</span>
                    {issue.title && <span className="gg-sub gg-mono">{issue.branch}</span>}
                  </span>
                  <span className={issue.agentName ? "gg-ell" : "gg-ell gg-dim"} title={issue.agentName}>{issue.agentName ?? "Unassigned"}</span>
                  <span title={STEPS.map((step, i) => `${i < filled ? "done" : "todo"}: ${step}`).join(", ")}>
                    <Pill badge={stage} />
                    <span style={{ display: "flex", gap: 3, marginTop: 4 }}>
                      {STEPS.map((step, i) => (
                        <span key={step} style={{ width: 22, height: 4, borderRadius: 2, background: i < filled ? stage.color : "var(--gg-border)" }} />
                      ))}
                    </span>
                  </span>
                  <span><TrunkDelta ahead={issue.aheadOfTrunk} behind={issue.behindTrunk} trunk={trunk} /></span>
                  <span>
                    {issue.pr ? (
                      <a href={issue.pr.url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "inherit", textDecoration: "none" }}>
                        <span className="gg-mono">#{issue.pr.number}</span>
                        <Pill badge={prBadge(issue.pr.state)} />
                      </a>
                    ) : (
                      <Pill badge={prBadge(undefined)} />
                    )}
                  </span>
                  <span className="gg-dim" title={issue.updatedAt}>{issue.updatedAt ? relativeDate(issue.updatedAt) : "-"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
