import {
  useHostNavigation,
  usePluginData,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";
import { DATA_KEYS, type BranchOwnership, type RepoSnapshot } from "../shared/types.js";
import { CSS, prStateVar, relativeDate } from "./theme.js";
import { GIT_GRAPH_ROUTE } from "./SidebarLink.js";

export function SummaryWidget({ context }: PluginWidgetProps) {
  const companyId = context.companyId ?? "";
  const hostNavigation = useHostNavigation();
  const { data: snapshot, loading } = usePluginData<RepoSnapshot>(DATA_KEYS.snapshot, {
    companyId,
    limit: 200,
  });
  const { data: branches } = usePluginData<BranchOwnership[]>(DATA_KEYS.branches, { companyId });

  const ownership = branches ?? snapshot?.ownership ?? [];
  const localBranches = (snapshot?.refs ?? []).filter((r) => r.kind === "local").length;
  const openPrs = ownership.filter((o) => o.pr && (o.pr.state === "open" || o.pr.state === "draft")).length;
  const working = ownership.filter((o) => o.agentName).slice(0, 8);

  return (
    <div className="gg-root" style={{ display: "grid", gap: 10, background: "none" }}>
      <style>{CSS}</style>

      {loading && !snapshot ? (
        <span className="gg-dim">Loading git graph...</span>
      ) : (
        <>
          <div style={{ display: "flex", gap: 18, alignItems: "baseline" }}>
            <Stat label="local branches" value={localBranches} />
            <Stat label="open PRs" value={openPrs} />
            <span className="gg-dim" style={{ marginLeft: "auto" }}>
              fetched {snapshot?.fetchedAt ? relativeDate(snapshot.fetchedAt) : "never"}
            </span>
          </div>

          {working.length === 0 ? (
            <span className="gg-dim">No agent is holding a branch right now.</span>
          ) : (
            <div style={{ display: "grid", gap: 2 }}>
              {working.map((o) => (
                <div
                  key={o.branch}
                  className="gg-row"
                  style={{
                    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr) auto",
                    gap: 8,
                    padding: "0 6px",
                    borderRadius: 4,
                  }}
                  title={o.issueTitle ?? o.branch}
                >
                  <span className="gg-ell">{o.agentName}</span>
                  <span className="gg-ell gg-dim gg-mono">{o.branch}</span>
                  <span
                    className="gg-mono"
                    style={{ color: o.pr ? (prStateVar[o.pr.state] ?? "var(--gg-fg-dim)") : "var(--gg-fg-dim)" }}
                  >
                    {o.pr ? `#${o.pr.number} ${o.pr.state}` : "no PR"}
                  </span>
                </div>
              ))}
            </div>
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
