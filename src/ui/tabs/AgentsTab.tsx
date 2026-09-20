import type { ActivityData } from "../../shared/types.js";
import { prStateVar, relativeDate } from "../theme.js";
import { agentHueColor, sortAgents } from "./helpers.js";

interface AgentsTabProps {
  activity: ActivityData | null;
  loading: boolean;
}

export function AgentsTab({ activity, loading }: AgentsTabProps) {
  if (loading && !activity) return <div style={{ padding: 16 }} className="gg-dim">Loading agents...</div>;

  const agents = sortAgents(activity?.agents ?? []);
  if (agents.length === 0)
    return (
      <div style={{ padding: 16 }} className="gg-dim">
        No agent has pushed to this repo yet. Assign an issue and the branch shows here.
      </div>
    );

  return (
    <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
      {agents.map((agent) => {
        const hue = agentHueColor(agent.agentId);
        const netAheadBehind =
          agent.aheadOfTrunk != null || agent.behindTrunk != null
            ? `+${agent.aheadOfTrunk ?? 0} / -${agent.behindTrunk ?? 0}`
            : null;
        return (
          <div
            key={agent.agentId}
            className="gg-panel"
            style={{
              borderLeft: `3px solid ${hue}`,
              border: "1px solid var(--gg-border)",
              borderLeftWidth: 3,
              borderRadius: "var(--gg-radius)",
              background: "var(--gg-panel)",
              padding: "8px 10px",
              display: "grid",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="gg-ell" style={{ fontWeight: 600 }}>{agent.agentName}</span>
              <span className="gg-chip" style={{ marginLeft: "auto" }}>{agent.agentStatus}</span>
            </div>
            {agent.branch ? (
              <span className="gg-mono gg-ell gg-dim" title={agent.branch}>{agent.branch}</span>
            ) : (
              <span className="gg-dim">no branch</span>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              {agent.lastCommitAt && <span className="gg-dim">{relativeDate(agent.lastCommitAt)}</span>}
              {netAheadBehind && <span className="gg-mono gg-dim">{netAheadBehind}</span>}
            </div>
            {agent.lastCommitSubject && <span className="gg-ell" title={agent.lastCommitSubject}>{agent.lastCommitSubject}</span>}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {agent.pr ? (
                <span className="gg-chip" style={{ color: prStateVar[agent.pr.state] ?? "var(--gg-fg-dim)" }}>
                  #{agent.pr.number} {agent.pr.state} · {agent.pr.reviewers.length} reviewers
                </span>
              ) : (
                <span className="gg-dim">no PR</span>
              )}
            </div>
            {agent.lastRunStatus && (
              <span className="gg-dim">
                last run {agent.lastRunStatus}
                {agent.lastRunAt ? ` · ${relativeDate(agent.lastRunAt)}` : ""}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
