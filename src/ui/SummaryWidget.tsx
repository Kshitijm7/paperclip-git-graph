import {
  useHostNavigation,
  usePluginData,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";
import { DATA_KEYS_V2, type ActivityData } from "../shared/types.js";
import { CSS, prStateVar, relativeDate } from "./theme.js";
import { agentHueColor, sortAgents } from "./tabs/helpers.js";
import { GIT_GRAPH_ROUTE } from "./SidebarLink.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function SummaryWidget({ context }: PluginWidgetProps) {
  const companyId = context.companyId ?? "";
  const hostNavigation = useHostNavigation();
  const { data: activity, loading } = usePluginData<ActivityData>(DATA_KEYS_V2.activity, { companyId });

  const agents = sortAgents(activity?.agents ?? []);
  const active = agents.filter((a) => a.branch).length;
  const openPrs = agents.filter((a) => a.pr && (a.pr.state === "open" || a.pr.state === "draft")).length;
  const mergedThisWeek = agents.filter(
    (a) => a.pr?.state === "merged" && Date.now() - new Date(a.pr.updatedAt).getTime() < WEEK_MS,
  ).length;
  const top = agents.slice(0, 5);
  const lastEvent = activity?.events[0];

  return (
    <div className="gg-root" style={{ display: "grid", gap: 10, background: "none" }}>
      <style>{CSS}</style>

      {loading && !activity ? (
        <span className="gg-dim">Loading git graph...</span>
      ) : (
        <>
          <div style={{ display: "flex", gap: 18, alignItems: "baseline" }}>
            <Stat label="agents active" value={active} />
            <Stat label="open PRs" value={openPrs} />
            <Stat label="merged this week" value={mergedThisWeek} />
          </div>

          {top.length === 0 ? (
            <span className="gg-dim">No agent is holding a branch right now.</span>
          ) : (
            <div style={{ display: "grid", gap: 2 }}>
              {top.map((a) => (
                <div
                  key={a.agentId}
                  className="gg-row"
                  style={{
                    gridTemplateColumns: "3px minmax(0, 1fr) minmax(0, 1.4fr) auto",
                    gap: 8,
                    padding: "0 6px",
                    borderRadius: 4,
                  }}
                  title={a.issueTitle ?? a.branch}
                >
                  <span style={{ background: agentHueColor(a.agentId), height: 14, borderRadius: 1 }} />
                  <span className="gg-ell">{a.agentName}</span>
                  <span className="gg-ell gg-dim gg-mono">{a.branch ?? ""}</span>
                  <span
                    className="gg-mono"
                    style={{ color: a.pr ? (prStateVar[a.pr.state] ?? "var(--gg-fg-dim)") : "var(--gg-fg-dim)" }}
                  >
                    {a.pr ? `#${a.pr.number} ${a.pr.state}` : "no PR"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {lastEvent && (
            <span className="gg-dim gg-ell" title={lastEvent.summary}>
              {relativeDate(lastEvent.at)} · {lastEvent.summary}
            </span>
          )}
        </>
      )}

      <a className="gg-link" {...hostNavigation.linkProps(GIT_GRAPH_ROUTE)}>
        Open Git Graph
      </a>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 5, alignItems: "baseline" }}>
      <strong style={{ fontSize: 20 }}>{value}</strong>
      <span className="gg-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
    </span>
  );
}
