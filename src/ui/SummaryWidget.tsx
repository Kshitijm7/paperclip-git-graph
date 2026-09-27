import { useEffect, useState } from "react";
import {
  useHostNavigation,
  usePluginAction,
  usePluginData,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";
import { ACTION_KEYS, DATA_KEYS_V2, type ActivityData } from "../shared/types.js";
import { CSS, prStateVar, relativeDate } from "./theme.js";
import { agentHueColor, sortAgents } from "./tabs/helpers.js";
import { GIT_GRAPH_ROUTE } from "./SidebarLink.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function SummaryWidget({ context }: PluginWidgetProps) {
  const companyId = context.companyId ?? "";
  const hostNavigation = useHostNavigation();
  const { data: fresh, loading, refresh } = usePluginData<ActivityData>(DATA_KEYS_V2.activity, { companyId });
  const refreshOwnership = usePluginAction(ACTION_KEYS.refreshOwnership);
  const [refreshing, setRefreshing] = useState(false);

  async function refreshNow() {
    setRefreshing(true);
    try {
      await refreshOwnership({ companyId });
    } finally {
      setRefreshing(false);
      refresh();
    }
  }
  const [cached, setCached] = useState<ActivityData | null>(() => readCached(companyId));
  useEffect(() => {
    if (!fresh) return;
    setCached(fresh);
    writeCached(companyId, fresh);
  }, [fresh, companyId]);
  const activity = fresh ?? cached;

  const agents = sortAgents(activity?.agents ?? []);
  const active = agents.filter((a) => a.branch).length;
  const openPrs = agents.filter((a) => a.pr && (a.pr.state === "open" || a.pr.state === "draft")).length;
  const mergedThisWeek = agents.filter(
    (a) => a.pr?.state === "merged" && Date.now() - new Date(a.pr.updatedAt).getTime() < WEEK_MS,
  ).length;
  const top = agents.slice(0, 5);
  const lastEvent = activity?.events[0];
  const lastAgentName = lastEvent?.agentId ? agents.find((a) => a.agentId === lastEvent.agentId)?.agentName : undefined;
  const lastSummary = lastEvent && lastAgentName && lastEvent.agentId ? lastEvent.summary.replace(lastEvent.agentId, lastAgentName) : lastEvent?.summary;
  const graphRoute = context.companyPrefix ? `/${context.companyPrefix}${GIT_GRAPH_ROUTE}` : GIT_GRAPH_ROUTE;

  return (
    <div className="gg-root" style={{ display: "grid", gap: 12, background: "none" }}>
      <style>{CSS}</style>

      {loading && !activity ? (
        <span className="gg-dim">Loading git graph...</span>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            <Stat label={active === 1 ? "agent active" : "agents active"} value={active} />
            <Stat label={openPrs === 1 ? "open PR" : "open PRs"} value={openPrs} />
            <Stat label="merged this week" value={mergedThisWeek} />
          </div>

          {top.length === 0 ? (
            <span className="gg-dim">No agent is holding a branch right now.</span>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "3px minmax(0, 11rem) minmax(0, 1fr) 6.5rem", columnGap: 10, rowGap: 6, alignItems: "center" }}>
              {top.map((a) => (
                <div key={a.agentId} style={{ display: "contents" }} title={a.issueTitle ?? a.branch}>
                  <span style={{ background: agentHueColor(a.agentId), height: 16, borderRadius: 2 }} />
                  <span className="gg-ell">{a.agentName}</span>
                  <span className="gg-ell gg-dim gg-mono" style={{ fontSize: 12 }}>{a.branch ?? ""}</span>
                  <span
                    className="gg-mono"
                    style={{ textAlign: "right", fontSize: 12, color: a.pr ? (prStateVar[a.pr.state] ?? "var(--gg-fg-dim)") : "var(--gg-fg-dim)" }}
                  >
                    {a.pr ? `#${a.pr.number} ${a.pr.state}` : "no PR"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {activity && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span className="gg-dim" style={{ fontSize: 12 }}>
                Updated {relativeDate(activity.generatedAt)}
                {loading || refreshing ? " · refreshing" : ""}
              </span>
              <button className="gg-btn" disabled={refreshing} onClick={() => void refreshNow()}>
                {refreshing ? "Refreshing" : "Refresh"}
              </button>
            </div>
          )}

          {lastEvent && (
            <span className="gg-dim gg-ell" title={lastEvent.summary}>
              {relativeDate(lastEvent.at)} Â· {lastEvent.summary}
            </span>
          )}
        </>
      )}

      <a className="gg-link" style={{ justifySelf: "start" }} {...hostNavigation.linkProps(graphRoute)}>
        Open Git Graph
      </a>
    </div>
  );
}

function cacheKey(companyId: string) {
  return `git-graph:widget:${companyId}`;
}

function readCached(companyId: string): ActivityData | null {
  try {
    const raw = localStorage.getItem(cacheKey(companyId));
    return raw ? (JSON.parse(raw) as ActivityData) : null;
  } catch {
    return null;
  }
}

function writeCached(companyId: string, data: ActivityData): void {
  try {
    localStorage.setItem(cacheKey(companyId), JSON.stringify(data));
  } catch {
    return;
  }
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span style={{ display: "grid", gap: 2, padding: "8px 10px", border: "1px solid var(--gg-border)", borderRadius: 6 }}>
      <strong style={{ fontSize: 22, lineHeight: 1.1 }}>{value}</strong>
      <span className="gg-dim gg-ell" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
    </span>
  );
}
