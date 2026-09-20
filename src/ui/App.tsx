import { useEffect, useMemo, useRef, useState } from "react";
import { usePluginData, usePluginStream, type PluginPageProps } from "@paperclipai/plugin-sdk/ui";
import { DATA_KEYS_V2, STREAM_CHANNEL, type ActivityData, type CachedSnapshotMeta, type RepoChangedEvent } from "../shared/types.js";
import { CSS, okColor, relativeDate } from "./theme.js";
import { GraphPage as GraphPageInner } from "./GraphPage.js";
import { AgentsTab } from "./tabs/AgentsTab.js";
import { ProgressTab } from "./tabs/ProgressTab.js";
import { ActivityTab } from "./tabs/ActivityTab.js";
import { LiveContext } from "./tabs/LiveContext.js";

const TABS = ["Graph", "Agents", "Progress", "Activity"] as const;
type Tab = (typeof TABS)[number];
const STORAGE_KEY = "gg-active-tab";
const NEW_EVENT_WINDOW_MS = 4000;
const STREAM_CONNECT_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 20000;
type LiveMode = "connecting" | "live" | "polling" | "offline";

function readStoredTab(): Tab {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return (TABS as readonly string[]).includes(stored ?? "") ? (stored as Tab) : "Graph";
  } catch {
    return "Graph";
  }
}

export function App({ context }: PluginPageProps) {
  const companyId = context.companyId ?? "";
  const [tab, setTab] = useState<Tab>(readStoredTab);
  const [revision, setRevision] = useState(0);
  const [newEventIds, setNewEventIds] = useState<ReadonlySet<string>>(new Set());
  const seenEventAt = useRef(0);

  const activityQuery = usePluginData<ActivityData>(DATA_KEYS_V2.activity, { companyId });
  const stream = usePluginStream<RepoChangedEvent>(STREAM_CHANNEL, { companyId });
  const metaQuery = usePluginData<CachedSnapshotMeta>(DATA_KEYS_V2.meta, { companyId });
  const [mode, setMode] = useState<LiveMode>("connecting");
  const prevMetaRef = useRef<{ refsHash: string; generatedAt: string } | null>(null);
  const lastUpdateAtRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, tab);
    } catch {
      // per-viewer convenience only; ignore quota/private-mode failures
    }
  }, [tab]);

  useEffect(() => {
    const event = stream.lastEvent;
    if (!event || event.companyId !== companyId) return;
    setRevision((r) => r + 1);
    activityQuery.refresh();
    seenEventAt.current = Date.now();
    lastUpdateAtRef.current = new Date().toISOString();
  }, [stream.lastEvent, companyId]);

  useEffect(() => {
    if (!activityQuery.data || seenEventAt.current === 0) return;
    const freshCutoff = seenEventAt.current - 1000;
    const fresh = activityQuery.data.events.filter((e) => new Date(e.at).getTime() >= freshCutoff);
    setNewEventIds(new Set(fresh.map((e) => e.id)));
    const timeout = setTimeout(() => setNewEventIds(new Set()), NEW_EVENT_WINDOW_MS);
    return () => clearTimeout(timeout);
  }, [activityQuery.data]);

  // Stream host returns 501 here (no SSE support), so fall back to polling the cheap "meta" key
  // if the connection doesn't come up within a few seconds, or errors out outright.
  useEffect(() => {
    if (stream.connected) {
      setMode("live");
      return;
    }
    if (stream.error) {
      setMode("polling");
      return;
    }
    const timer = setTimeout(() => setMode((m) => (m === "live" ? m : "polling")), STREAM_CONNECT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [stream.connected, stream.error]);

  useEffect(() => {
    if (mode !== "polling") return;
    const interval = setInterval(() => metaQuery.refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [mode]);

  useEffect(() => {
    if (mode === "polling" && metaQuery.error) setMode("offline");
  }, [mode, metaQuery.error]);

  useEffect(() => {
    if (!metaQuery.data) return;
    const cur = { refsHash: metaQuery.data.refsHash, generatedAt: metaQuery.data.generatedAt };
    const prev = prevMetaRef.current;
    if (prev && (prev.refsHash !== cur.refsHash || prev.generatedAt !== cur.generatedAt)) {
      setRevision((r) => r + 1);
      activityQuery.refresh();
      lastUpdateAtRef.current = new Date().toISOString();
    }
    prevMetaRef.current = cur;
  }, [metaQuery.data]);

  const liveLabel = useMemo(() => {
    const label = mode === "live" ? "Live" : mode === "polling" ? "Polling" : mode === "offline" ? "Offline" : "Connecting";
    const at = lastUpdateAtRef.current;
    return at ? `${label} · last update ${relativeDate(at)}` : `${label} · no updates yet`;
  }, [mode, stream.lastEvent, metaQuery.data]);

  const dotColor = mode === "live" ? okColor : mode === "polling" ? "oklch(65% 0.15 240)" : "var(--gg-fg-dim)";

  return (
    <LiveContext.Provider value={revision}>
      <div className="gg-root" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 620 }}>
        <style>{CSS}</style>
        <div
          role="tablist"
          style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 10px", borderBottom: "1px solid var(--gg-border)" }}
        >
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className="gg-tab"
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
          <span
            title={liveLabel}
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
            <span className="gg-dim">{mode === "live" ? "Live" : mode === "polling" ? "Polling" : mode === "offline" ? "Offline" : ""}</span>
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          {tab === "Graph" && <GraphPageInner context={context} />}
          {tab === "Agents" && <AgentsTab activity={activityQuery.data} loading={activityQuery.loading} />}
          {tab === "Progress" && <ProgressTab activity={activityQuery.data} loading={activityQuery.loading} />}
          {tab === "Activity" && (
            <ActivityTab activity={activityQuery.data} loading={activityQuery.loading} newEventIds={newEventIds} />
          )}
        </div>
      </div>
    </LiveContext.Provider>
  );
}
