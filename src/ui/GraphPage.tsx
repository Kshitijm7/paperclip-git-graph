import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyValueList,
  useHostNavigation,
  usePluginAction,
  usePluginData,
  type PluginPageProps,
} from "@paperclipai/plugin-sdk/ui";
import {
  ACTION_KEYS,
  DATA_KEYS,
  type BranchOwnership,
  type GitCommit,
  type GitRef,
  type PluginSettings,
  type RepoSnapshot,
  type StatusGithub,
} from "../shared/types.js";
import { generateGraph, laneX, maxGraphX, type GraphLayout } from "../graph/layout.js";
import { okColor, prStateVar, relativeDate, shortDate } from "./theme.js";
import { Welcome, type StatusData } from "./Welcome.js";
import { GithubChip } from "./GithubChip.js";
import { ThemeProvider, buildAgentLaneMap, colorForAgent, laneColorFor, resolvePreset } from "../theme/index.js";
import type { ThemePresetConfig } from "../theme/presets.js";
import { THEME_PRESETS } from "../shared/types.js";
import { useLiveRevision } from "./tabs/LiveContext.js";
import { dedupeCommitsBySha, isEndOfPages, isNearBottom } from "./pagination.js";

// PluginHostContext has no pluginId field (checked plugin-sdk/dist/ui/types.d.ts), so the manifest id is hardcoded here.
const PLUGIN_MANIFEST_ID = "paperclip-git-graph";
const LIMITS = [120, 200, 400, 1000];
const PAGE_LOAD_THRESHOLD_ROWS = 20;
const VIEWPORT_HEIGHT = 520;
const OVERSCAN = 8;
const AUTHOR_WIDTH = 140;
const SHA_WIDTH = 72;
const TIME_WIDTH = 96;
const GRID = (graphWidth: number) =>
  `${graphWidth}px minmax(0, 1fr) ${AUTHOR_WIDTH}px ${SHA_WIDTH}px ${TIME_WIDTH}px`;

export function GraphPage({ context }: PluginPageProps) {
  const companyId = context.companyId ?? "";
  const [limit, setLimit] = useState(120); // repurposed as page size for lazy loading
  const [offset, setOffset] = useState(0);
  const [pages, setPages] = useState<Map<number, GitCommit[]>>(new Map());
  const [endReached, setEndReached] = useState(false);
  const [firstParentOnly, setFirstParentOnly] = useState(false);
  const [branch, setBranch] = useState("");
  const [search, setSearch] = useState("");
  const [sideFilter, setSideFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [graphScrollLeft, setGraphScrollLeft] = useState(0);
  const [tableWidth, setTableWidth] = useState(800);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [themeOverride, setThemeOverride] = useState<string | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const prevShasRef = useRef<Set<string>>(new Set());
  const prevGeneratedAtRef = useRef<string | null>(null);
  const prevHeadShaRef = useRef<string | null>(null);
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const [newShas, setNewShas] = useState<Set<string>>(new Set());
  const liveRevision = useLiveRevision();
  // callback ref: the table mounts after the welcome screen, so a mount-time effect would miss it
  const tableRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!el) return;
    observerRef.current = new ResizeObserver((entries) => setTableWidth(entries[0]!.contentRect.width));
    observerRef.current.observe(el);
  }, []);

  const statusQuery = usePluginData<StatusData>(DATA_KEYS.status, { companyId });
  const snapshotQuery = usePluginData<RepoSnapshot>(DATA_KEYS.snapshot, {
    companyId,
    limit,
    offset,
    firstParentOnly,
    branch: branch || undefined,
  });
  const branchesQuery = usePluginData<BranchOwnership[]>(DATA_KEYS.branches, { companyId });

  const fetchAction = usePluginAction(ACTION_KEYS.fetch);
  const refreshOwnership = usePluginAction(ACTION_KEYS.refreshOwnership);

  const snapshot = snapshotQuery.data;

  // Filters, page size, or a live-revision bump start a fresh sequence of pages from offset 0.
  useEffect(() => {
    setPages(new Map());
    setEndReached(false);
    setOffset(0);
  }, [limit, firstParentOnly, branch, liveRevision]);

  // Record each page as it arrives, keyed by the offset it was requested at.
  useEffect(() => {
    if (!snapshot) return;
    setPages((prev) => {
      if (prev.has(offset)) return prev;
      const next = new Map(prev);
      next.set(offset, snapshot.commits);
      return next;
    });
    if (isEndOfPages(snapshot.commits.length, limit, offset, snapshot.total)) setEndReached(true);
  }, [snapshot, offset, limit]);

  // Reset scroll to top only when the head actually moved (a new commit landed), not on every poll.
  useEffect(() => {
    if (!snapshot || offset !== 0) return;
    const headSha = snapshot.head?.sha ?? null;
    if (prevHeadShaRef.current !== null && prevHeadShaRef.current !== headSha) {
      setScrollTop(0);
      if (scrollElRef.current) scrollElRef.current.scrollTop = 0;
    }
    prevHeadShaRef.current = headSha;
  }, [snapshot, offset]);

  const commits = useMemo(() => {
    if (pages.size === 0) return snapshot?.commits ?? [];
    const ordered = [...pages.keys()].sort((a, b) => a - b).flatMap((k) => pages.get(k)!);
    return dedupeCommitsBySha(ordered);
  }, [pages, snapshot]);
  const ownership = branchesQuery.data ?? snapshot?.ownership ?? [];

  const layout = useMemo(() => generateGraph(commits, { firstParentOnly }), [commits, firstParentOnly]);
  const refByName = useMemo(() => {
    const map = new Map<string, GitRef>();
    for (const r of snapshot?.refs ?? []) map.set(r.name, r);
    return map;
  }, [snapshot]);
  const prUrlByNumber = useMemo(() => {
    const map = new Map<number, string>();
    for (const o of ownership) if (o.pr) map.set(o.pr.number, o.pr.url);
    return map;
  }, [ownership]);
  const ownerByBranch = useMemo(() => {
    const map = new Map<string, BranchOwnership>();
    for (const o of ownership) map.set(o.branch, o);
    return map;
  }, [ownership]);

  const status = statusQuery.data;
  const presetName = themeOverride ?? status?.config?.effective.theme;
  const preset = resolvePreset(presetName);
  const rowHeight = preset.rowHeight;
  const agentLaneMap = useMemo(
    () => buildAgentLaneMap(commits, snapshot?.refs ?? [], ownerByBranch),
    [commits, snapshot, ownerByBranch],
  );

  // Only mark rows added since the last snapshot generation as "new"; a fresh mount is not a change.
  useEffect(() => {
    if (!snapshot) return;
    const currentShas = new Set(commits.map((c) => c.sha));
    if (prevGeneratedAtRef.current && prevGeneratedAtRef.current !== snapshot.generatedAt) {
      const added = new Set<string>();
      for (const sha of currentShas) if (!prevShasRef.current.has(sha)) added.add(sha);
      setNewShas(added);
    }
    prevGeneratedAtRef.current = snapshot.generatedAt;
    prevShasRef.current = currentShas;
  }, [snapshot?.generatedAt, commits]);

  const needle = search.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!needle) return commits;
    return commits.filter(
      (c) =>
        c.subject.toLowerCase().includes(needle) ||
        c.author.toLowerCase().includes(needle) ||
        c.sha.toLowerCase().startsWith(needle),
    );
  }, [commits, needle]);

  const filtering = rows.length !== commits.length;
  const rawGraphWidth = Math.max(layout.laneWidth, maxGraphX(layout));
  const graphWidth = filtering ? 12 : Math.max(40, Math.round(rawGraphWidth) + 12);
  const graphCap = Math.max(40, Math.round(Math.min(tableWidth * 0.4, tableWidth - AUTHOR_WIDTH - SHA_WIDTH - TIME_WIDTH - 160)));
  const graphColWidth = Math.min(graphWidth, graphCap);
  const graphScrollable = graphWidth > graphColWidth;
  const maxGraphScroll = Math.max(0, graphWidth - graphColWidth);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + VIEWPORT_HEIGHT) / rowHeight) + OVERSCAN);
  const visible = rows.slice(start, end);
  const selectedCommit = commits.find((c) => c.sha === selected) ?? null;
  const isFirstLoad = snapshotQuery.loading && pages.size === 0 && !snapshot;
  const isLoadingMore = snapshotQuery.loading && pages.size > 0;

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    setScrollTop(el.scrollTop);
    if (endReached || snapshotQuery.loading) return;
    if (!isNearBottom(el.scrollTop, VIEWPORT_HEIGHT, el.scrollHeight, rowHeight, PAGE_LOAD_THRESHOLD_ROWS)) return;
    const nextOffset = offset + limit;
    if (pages.has(nextOffset)) return;
    setOffset(nextOffset);
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      snapshotQuery.refresh();
      branchesQuery.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (isFirstLoad)
    return (
      <ThemeProvider presetName={presetName}>
        <div className="gg-root" style={{ display: "flex", height: "100%", minHeight: 620 }}>
          <div style={{ width: 220, flex: "0 0 220px", borderRight: "1px solid var(--gg-border)", background: "var(--gg-panel)" }} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ height: 36, borderBottom: "1px solid var(--gg-border)", background: "var(--gg-panel)" }} />
            <div style={{ padding: 8, display: "grid", gap: 6 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="gg-skeleton-row"
                  style={{ height: 20, borderRadius: "var(--gg-radius)", background: "var(--gg-hover)", opacity: 0.5 }}
                />
              ))}
            </div>
          </div>
        </div>
      </ThemeProvider>
    );

  if (snapshotQuery.error && !snapshot)
    return (
      <ThemeProvider presetName={presetName}>
        <div className="gg-root" style={{ padding: 16 }}>
          <span style={{ color: "var(--gg-red)" }}>{snapshotQuery.error.message}</span>
        </div>
      </ThemeProvider>
    );

  if (!snapshot?.path || (status && (!status.configured || !status.healthy))) {
    return (
      <ThemeProvider presetName={presetName}>
        <Welcome
          companyId={companyId}
          status={status ?? null}
          onBound={() => {
            statusQuery.refresh();
            snapshotQuery.refresh();
            branchesQuery.refresh();
          }}
        />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider presetName={presetName}>
    <div className="gg-root" data-gg-preset={presetName ?? "paperclip"} style={{ display: "flex", height: "100%", minHeight: 620 }}>
      <Sidebar
        snapshot={snapshot}
        ownerByBranch={ownerByBranch}
        preset={preset}
        filter={sideFilter}
        onFilter={setSideFilter}
        selectedBranch={branch}
        onSelectBranch={setBranch}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
      />

      <div ref={tableRef} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            height: 36,
            display: "flex",
            flexWrap: "nowrap",
            alignItems: "center",
            gap: 8,
            padding: "0 8px",
            borderBottom: "1px solid var(--gg-border)",
            background: "var(--gg-panel)",
            overflow: "hidden",
          }}
        >
          <button className="gg-btn" style={{ whiteSpace: "nowrap", flexShrink: 0 }} disabled={busy} onClick={() => void run(() => fetchAction({ companyId }))}>
            {busy ? "Working" : "Fetch"}
          </button>
          <select
            className="gg-input"
            style={{ flexShrink: 0, maxWidth: 160 }}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">All branches</option>
            {snapshot.refs.filter((r) => r.kind === "local").map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
          <input
            className="gg-input"
            style={{ minWidth: 140, flex: 1 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subject, author, sha"
          />
          <span className="gg-dim gg-ell gg-mono" style={{ marginLeft: "auto", maxWidth: 260 }} title={snapshot.path}>
            {snapshot.path}
          </span>
          <span
            aria-label={snapshot.healthy ? "healthy" : `${snapshot.problems.length} problems`}
            title={snapshot.problems.join("\n") || "No problems reported"}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: snapshot.healthy ? okColor : "var(--gg-red)",
              flexShrink: 0,
            }}
          />
          <span className="gg-dim" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
            {snapshot.fetchedAt ? relativeDate(snapshot.fetchedAt) : "never fetched"}
          </span>
          {status?.github && !status.github.ok && (
            <GithubChip companyId={companyId} github={status.github} amber />
          )}
          <button
            className="gg-btn"
            aria-expanded={settingsOpen ? "true" : "false"}
            style={{ flexShrink: 0 }}
            onClick={() => setSettingsOpen((o) => !o)}
          >
            {"⋯"}
          </button>
        </div>

        {settingsOpen && (
          <SettingsStrip
            companyId={companyId}
            limit={limit}
            onLimit={setLimit}
            firstParentOnly={firstParentOnly}
            onFirstParentOnly={setFirstParentOnly}
            busy={busy}
            onRefreshOwnership={() => void run(() => refreshOwnership({ companyId }))}
            config={status?.config}
            github={status?.github}
            onSaved={() => statusQuery.refresh()}
            theme={presetName}
            onThemeChange={(theme) => setThemeOverride(theme)}
          />
        )}


        {actionError && (
          <div style={{ color: "var(--gg-red)", padding: "4px 8px" }}>{actionError}</div>
        )}

        <div className="gg-head" style={{ gridTemplateColumns: GRID(graphColWidth) }}>
          <span style={{ gridColumn: "1 / span 2", paddingLeft: 8, display: "flex", alignItems: "center", gap: 6 }}>
            Graph &amp; subject
            {graphScrollable && (
              <input
                type="range"
                aria-label="Scroll graph lanes"
                min={0}
                max={maxGraphScroll}
                value={graphScrollLeft}
                onChange={(e) => setGraphScrollLeft(Number(e.target.value))}
                style={{ width: graphColWidth - 8 }}
              />
            )}
          </span>
          <span>Author</span>
          <span>SHA</span>
          <span style={{ textAlign: "right" }}>Commit time</span>
        </div>

        <div
          ref={scrollElRef}
          onScroll={handleScroll}
          style={{ flex: 1, minHeight: 200, height: VIEWPORT_HEIGHT, overflow: "auto" }}
        >
          <div style={{ height: rows.length * rowHeight, position: "relative" }}>
            <div style={{ position: "absolute", top: start * rowHeight, left: 0, right: 0 }}>
              {visible.map((commit, i) => (
                <Row
                  key={commit.sha}
                  commit={commit}
                  row={start + i}
                  graphWidth={graphWidth}
                  graphColWidth={graphColWidth}
                  graphScrollLeft={graphScrollLeft}
                  layout={filtering ? null : layout}
                  refByName={refByName}
                  ownerByBranch={ownerByBranch}
                  prUrlByNumber={prUrlByNumber}
                  selected={commit.sha === selected}
                  onSelect={() => setSelected(commit.sha)}
                  preset={preset}
                  agentLaneMap={agentLaneMap}
                  isNew={newShas.has(commit.sha)}
                />
              ))}
            </div>
          </div>
          {rows.length === 0 && (
            <div className="gg-dim" style={{ padding: 16 }}>
              No commit matches this filter.
            </div>
          )}
          {isLoadingMore && !filtering && (
            <div className="gg-dim" style={{ padding: 8, textAlign: "center", fontSize: 12 }}>
              Loading more...
            </div>
          )}
          {endReached && !filtering && rows.length > 0 && (
            <div className="gg-dim" style={{ padding: 8, textAlign: "center", fontSize: 12 }}>
              End of history
            </div>
          )}
        </div>

        {selectedCommit && (
          <DetailPanel
            commit={selectedCommit}
            refByName={refByName}
            ownerByBranch={ownerByBranch}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
    </ThemeProvider>
  );
}

function SettingsStrip({
  companyId,
  limit,
  onLimit,
  firstParentOnly,
  onFirstParentOnly,
  busy,
  onRefreshOwnership,
  config,
  github,
  onSaved,
  theme,
  onThemeChange,
}: {
  companyId: string;
  limit: number;
  onLimit: (n: number) => void;
  firstParentOnly: boolean;
  onFirstParentOnly: (v: boolean) => void;
  busy: boolean;
  onRefreshOwnership: () => void;
  config?: { effective: PluginSettings; saved: boolean };
  github?: StatusGithub;
  onSaved: () => void;
  theme?: string;
  onThemeChange: (theme: string) => void;
}) {
  const hostNavigation = useHostNavigation();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingTheme, setSavingTheme] = useState(false);

  async function saveTheme(next: string) {
    onThemeChange(next); // optimistic: re-render before the round trip completes
    setSavingTheme(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/plugins/${PLUGIN_MANIFEST_ID}/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId, configJson: { theme: next } }),
      });
      if (!response.ok) throw new Error(`Save failed (${response.status})`);
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTheme(false);
    }
  }

  async function saveDefaults() {
    if (!config) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { githubToken, ...effectiveWithoutSecret } = config.effective;
      const response = await fetch(`/api/plugins/${PLUGIN_MANIFEST_ID}/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId, configJson: effectiveWithoutSecret }),
      });
      if (!response.ok) throw new Error(`Save failed (${response.status})`);
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderBottom: "1px solid var(--gg-border)",
        background: "var(--gg-panel)",
        fontSize: 12,
      }}
    >
      <select className="gg-input" value={limit} onChange={(e) => onLimit(Number(e.target.value))}>
        {LIMITS.map((n) => (
          <option key={n} value={n}>
            {n} per page
          </option>
        ))}
      </select>
      <label style={{ display: "flex", gap: 5, alignItems: "center", whiteSpace: "nowrap" }}>
        <input type="checkbox" checked={firstParentOnly} onChange={(e) => onFirstParentOnly(e.target.checked)} />
        first parent
      </label>
      <button className="gg-btn" disabled={busy} onClick={onRefreshOwnership}>
        Refresh ownership
      </button>
      <label style={{ display: "flex", gap: 5, alignItems: "center", whiteSpace: "nowrap" }}>
        Theme
        <select
          className="gg-input"
          disabled={savingTheme}
          value={theme ?? "paperclip"}
          onChange={(e) => void saveTheme(e.target.value)}
        >
          {THEME_PRESETS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      {config && (
        <>
          <span className="gg-dim gg-ell" style={{ maxWidth: 220 }} title={config.effective.githubRepo || "auto-detected from origin"}>
            {config.effective.githubRepo || "repo: auto-detected"}
          </span>
          <span className="gg-dim">fetch every {config.effective.fetchIntervalMinutes}m</span>
          <span className="gg-dim">{config.effective.commitLimit} commit cap</span>
          {!config.saved && <span className="gg-badge">Defaults (not saved)</span>}
          <button className="gg-btn" disabled={saving} onClick={() => void saveDefaults()}>
            {saving ? "Saving..." : "Save defaults"}
          </button>
        </>
      )}
      {github?.ok && <GithubChip companyId={companyId} github={github} />}
      <a
        className="gg-link"
        {...hostNavigation.linkProps(`/settings/plugins/${PLUGIN_MANIFEST_ID}`)}
        style={{ marginLeft: "auto" }}
      >
        Plugin settings
      </a>
      {saveError && <span style={{ color: "var(--gg-red)" }}>{saveError}</span>}
    </div>
  );
}

function Sidebar({
  snapshot,
  ownerByBranch,
  preset,
  filter,
  onFilter,
  selectedBranch,
  onSelectBranch,
  collapsed,
  onToggleCollapsed,
}: {
  snapshot: RepoSnapshot;
  ownerByBranch: Map<string, BranchOwnership>;
  preset: ThemePresetConfig;
  filter: string;
  onFilter: (v: string) => void;
  selectedBranch: string;
  onSelectBranch: (v: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    local: true,
    remote: true,
    tag: false,
    worktree: false,
  });
  const needle = filter.trim().toLowerCase();
  const match = (name: string) => !needle || name.toLowerCase().includes(needle);
  const refs = (kind: GitRef["kind"]) => snapshot.refs.filter((r) => r.kind === kind && match(r.name));
  const worktrees = snapshot.worktrees.filter((w) => match(w.branch ?? w.path));

  function group(key: string, label: string, count: number, body: React.ReactNode) {
    return (
      <Fragment key={key}>
        <button
          className="gg-group"
          aria-expanded={open[key] ? "true" : "false"}
          onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
        >
          <Chevron open={Boolean(open[key])} />
          {label} ({count})
        </button>
        {open[key] && body}
      </Fragment>
    );
  }

  if (collapsed) {
    return (
      <div
        style={{
          flex: "0 0 28px",
          width: 28,
          borderRight: "1px solid var(--gg-border)",
          background: "var(--gg-panel)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          paddingTop: 8,
        }}
      >
        <button className="gg-btn" title="Show branches" onClick={onToggleCollapsed}>
          <Chevron open={false} />
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        width: 220,
        flex: "0 0 220px",
        borderRight: "1px solid var(--gg-border)",
        background: "var(--gg-panel)",
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
      }}
    >
      <div style={{ padding: 8, display: "flex", gap: 6 }}>
        <input
          className="gg-input"
          style={{ width: "100%" }}
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          placeholder="Filter branches, tags, worktrees"
        />
        <button className="gg-btn" title="Collapse" onClick={onToggleCollapsed} style={{ flexShrink: 0 }}>
          <Chevron open={true} />
        </button>
      </div>
      {selectedBranch && (
        <button className="gg-btn" style={{ margin: "0 8px 8px" }} onClick={() => onSelectBranch("")}>
          Clear branch filter
        </button>
      )}

      {group(
        "local",
        "Local branches",
        refs("local").length,
        refs("local").map((r) => (
          <SideRow
            key={r.name}
            icon={r.isCurrent ? <CheckIcon /> : <BranchIcon />}
            label={r.name}
            bold={r.isCurrent}
            selected={selectedBranch === r.name}
            owner={ownerByBranch.get(r.name)}
            preset={preset}
            onClick={() => onSelectBranch(selectedBranch === r.name ? "" : r.name)}
          />
        )),
      )}
      {group(
        "remote",
        "Remotes",
        refs("remote").length,
        refs("remote").map((r) => (
          <SideRow
            key={r.name}
            icon={<CloudIcon />}
            label={r.name}
            selected={selectedBranch === r.name}
            owner={ownerByBranch.get(r.name.replace(/^[^/]+\//, ""))}
            preset={preset}
            onClick={() => onSelectBranch(selectedBranch === r.name ? "" : r.name)}
          />
        )),
      )}
      {group(
        "tag",
        "Tags",
        refs("tag").length,
        refs("tag").map((r) => (
          <SideRow
            key={r.name}
            icon={<TagIcon />}
            label={r.name}
            selected={selectedBranch === r.name}
            onClick={() => onSelectBranch(selectedBranch === r.name ? "" : r.name)}
          />
        )),
      )}
      {group(
        "worktree",
        "Worktrees",
        worktrees.length,
        worktrees.map((w) => (
          <SideRow key={w.path} icon={<BranchIcon />} label={w.branch ?? w.path} title={w.path} />
        )),
      )}
    </div>
  );
}

function SideRow({
  icon,
  label,
  title,
  bold,
  selected,
  owner,
  preset,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  bold?: boolean;
  selected?: boolean;
  owner?: BranchOwnership;
  preset?: ThemePresetConfig;
  onClick?: () => void;
}) {
  return (
    <button
      className="gg-side-row"
      aria-selected={selected ? "true" : "false"}
      title={title ?? label}
      onClick={onClick}
      disabled={!onClick}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
        {icon}
        {owner?.agentId && preset && (
          <span
            aria-hidden="true"
            title={owner.agentName ?? undefined}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: colorForAgent(owner.agentId, preset),
              flexShrink: 0,
            }}
          />
        )}
      </span>
      <span className="gg-ell" style={{ fontWeight: bold ? 700 : 400 }}>
        {label}
      </span>
      {owner ? <OwnerPill owner={owner} variant="compact" preset={preset ?? resolvePreset(undefined)} /> : <span />}
    </button>
  );
}

function Row({
  commit,
  row,
  graphWidth,
  graphColWidth,
  graphScrollLeft,
  layout,
  refByName,
  ownerByBranch,
  prUrlByNumber,
  selected,
  onSelect,
  preset,
  agentLaneMap,
  isNew,
}: {
  commit: GitCommit;
  row: number;
  graphWidth: number;
  graphColWidth: number;
  graphScrollLeft: number;
  layout: GraphLayout | null;
  refByName: Map<string, GitRef>;
  ownerByBranch: Map<string, BranchOwnership>;
  prUrlByNumber: Map<number, string>;
  selected: boolean;
  onSelect: () => void;
  preset: ThemePresetConfig;
  agentLaneMap: Map<string, number>;
  isNew: boolean;
}) {
  const owner = ownerFor(commit, ownerByBranch);
  return (
    <div
      className={isNew ? "gg-row gg-new" : "gg-row"}
      aria-selected={selected ? "true" : "false"}
      style={{ gridTemplateColumns: GRID(graphColWidth), height: preset.rowHeight }}
      onClick={onSelect}
    >
      <div style={{ height: preset.rowHeight, width: graphColWidth, overflow: "hidden" }}>
        {layout && (
          <div style={{ transform: `translateX(${-graphScrollLeft}px)` }}>
            <GraphCell layout={layout} row={row} width={graphWidth} preset={preset} agentLaneMap={agentLaneMap} />
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, paddingLeft: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, overflow: "hidden", flexShrink: 0 }}>
          {commit.isHead && <RefBadge name="HEAD" kind="head" />}
          {commit.refs.map((name) => (
            <RefBadge key={name} name={name} kind={refByName.get(name)?.kind ?? "local"} />
          ))}
        </div>
        <Subject text={commit.subject} prUrlByNumber={prUrlByNumber} />
        {owner && <OwnerPill owner={owner} variant="row" preset={preset} />}
      </div>
      <div className="gg-ell gg-dim">{commit.author}</div>
      <div className="gg-mono gg-dim gg-ell">{commit.sha.slice(0, 7)}</div>
      <div className="gg-dim gg-ell" style={{ textAlign: "right" }}>{relativeDate(commit.date)}</div>
    </div>
  );
}

function ownerFor(commit: GitCommit, ownerByBranch: Map<string, BranchOwnership>) {
  for (const name of commit.refs) {
    const hit = ownerByBranch.get(name.replace(/^origin\//, ""));
    if (hit) return hit;
  }
  return undefined;
}

// "fix:", "feature(ui)!:" and similar conventional-commit prefixes lead the subject in bold.
const CONVENTIONAL = /^([a-z]+(?:\([^)]*\))?!?):\s+/i;
const TOKEN = /([A-Z][A-Z0-9]+-\d+|#\d+)/g;

function Subject({ text, prUrlByNumber }: { text: string; prUrlByNumber: Map<number, string> }) {
  const hostNavigation = useHostNavigation();
  const m = CONVENTIONAL.exec(text);
  const prefix = m ? m[1] : null;
  const rest = m ? text.slice(m[0].length) : text;

  return (
    <span className="gg-ell" style={{ minWidth: 0, flex: 1 }} title={text}>
      {prefix && <strong>{prefix}: </strong>}
      {rest.split(TOKEN).map((part, i) =>
        /^[A-Z][A-Z0-9]+-\d+$/.test(part) ? (
          <a key={i} className="gg-link" {...hostNavigation.linkProps(`/issues/${part}`)}>
            {part}
          </a>
        ) : /^#\d+$/.test(part) && prUrlByNumber.has(Number(part.slice(1))) ? (
          <a
            key={i}
            className="gg-link"
            href={prUrlByNumber.get(Number(part.slice(1)))}
            target="_blank"
            rel="noopener noreferrer"
          >
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </span>
  );
}

function GraphCell({
  layout,
  row,
  width,
  preset,
  agentLaneMap,
}: {
  layout: GraphLayout;
  row: number;
  width: number;
  preset: ThemePresetConfig;
  agentLaneMap: Map<string, number>;
}) {
  const rowHeight = preset.rowHeight;
  const top = row * rowHeight;
  const lo = row - 1;
  const hi = row + 1;
  const segments = layout.segments.filter((s) => s.row >= lo && s.row <= hi);
  const dots = layout.dots.filter((d) => d.row >= lo && d.row <= hi);
  const dotRadius = preset.dotStyle === "small" ? 2 : preset.dotStyle === "filled" ? 3 : 2.5;

  // Segments carry only a lane-index color; approximate the agent hue via the row's own commit.
  const colorForIndex = (idx: number, sha?: string) =>
    sha ? laneColorFor({ sha } as GitCommit, agentLaneMap, idx, preset) : preset.lanePalette[idx % preset.lanePalette.length]!;

  return (
    <svg width={width} height={rowHeight} style={{ display: "block", overflow: "hidden" }}>
      <g transform={`translate(0, ${-top})`}>
        {segments.map((s, i) => {
          const color = colorForIndex(s.color, layout.dots.find((d) => d.row === s.row)?.sha);
          const y0 = s.row * rowHeight;
          const y1 = y0 + rowHeight;
          const x0 = laneX(s.lane);
          const x1 = laneX(s.toLane);
          if (x0 === x1) return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={color} strokeWidth={2} />;
          return (
            <path
              key={i}
              fill="none"
              strokeWidth={2}
              stroke={color}
              d={`M ${x0} ${y0} Q ${x0} ${y1} ${(x0 + x1) / 2} ${y1} L ${x1} ${y1}`}
            />
          );
        })}
        {dots.map((d) => {
          const color = colorForIndex(d.color, d.sha);
          const cx = laneX(d.lane);
          const cy = d.row * rowHeight + rowHeight / 2;
          if (d.type === "merge")
            return <circle key={d.sha} cx={cx} cy={cy} r={dotRadius + 1} fill="var(--gg-panel)" stroke={color} strokeWidth={2} />;
          if (d.type === "head" && preset.dotStyle === "ring")
            return (
              <g key={d.sha}>
                <circle cx={cx} cy={cy} r={dotRadius + 2.5} fill="none" stroke={color} strokeWidth={1.5} opacity={0.55} />
                <circle cx={cx} cy={cy} r={dotRadius} fill={color} />
              </g>
            );
          return <circle key={d.sha} cx={cx} cy={cy} r={dotRadius} fill={color} />;
        })}
      </g>
    </svg>
  );
}

function RefBadge({ name, kind }: { name: string; kind: GitRef["kind"] }) {
  const icon = kind === "remote" ? <CloudIcon /> : kind === "tag" ? <TagIcon /> : <CheckIcon />;
  const color = kind === "head" ? okColor : kind === "tag" ? "var(--gg-fg-dim)" : "var(--gg-fg)";
  return (
    <span className="gg-badge gg-mono" title={`${kind}: ${name}`} style={{ color }}>
      {icon}
      <span className="gg-ell">{name}</span>
    </span>
  );
}

// compact: sidebar row, issue key only, full context in the title tooltip.
// row: right-aligned "KEY · Agent · PR #n" chip after a commit's subject.
function OwnerPill({
  owner,
  variant,
  preset,
}: {
  owner: BranchOwnership;
  variant: "compact" | "row";
  preset: ThemePresetConfig;
}) {
  const hostNavigation = useHostNavigation();
  const pr = owner.pr;
  const stateColor = pr ? (prStateVar[pr.state] ?? "var(--gg-fg-dim)") : "var(--gg-fg-dim)";
  const agentColor = owner.agentId ? colorForAgent(owner.agentId, preset) : null;
  const hover = ownershipTooltip(owner);
  const key = owner.issueIdentifier;

  if (variant === "compact") {
    return (
      <span className="gg-chip gg-mono" title={hover}>
        {key ? (
          <a className="gg-link" {...hostNavigation.linkProps(`/issues/${key}`)} title={owner.agentName ?? undefined}>
            {key}
          </a>
        ) : (
          <span className="gg-dim" title={owner.agentName ?? undefined}>
            {owner.agentName ?? "owned"}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="gg-chip gg-dim" title={hover} style={{ marginLeft: "auto", flexShrink: 0 }}>
      {agentColor && <span style={{ width: 6, height: 6, borderRadius: "50%", background: agentColor, flexShrink: 0 }} />}
      {pr && <span style={{ width: 6, height: 6, borderRadius: "50%", background: stateColor, flexShrink: 0 }} />}
      {[key, owner.agentName, pr ? `PR #${pr.number}` : null].filter(Boolean).join(" · ") || "unowned"}
    </span>
  );
}

function ownershipTooltip(owner: BranchOwnership): string {
  return [
    `Branch: ${owner.branch}`,
    owner.issueTitle ? `Issue: ${owner.issueTitle}` : null,
    owner.issueStatus ? `Issue status: ${owner.issueStatus}` : null,
    owner.agentName ? `Agent: ${owner.agentName}` : null,
    owner.agentStatus ? `Agent status: ${owner.agentStatus}` : null,
    owner.pr ? `PR #${owner.pr.number} (${owner.pr.state}): ${owner.pr.title}` : null,
    owner.pr?.reviewers.length ? `Reviewers: ${owner.pr.reviewers.join(", ")}` : null,
    owner.pr?.checks ? `Checks: ${owner.pr.checks}` : null,
    owner.sources.length ? `Sources: ${owner.sources.map((s) => `${s.kind} (${s.detail})`).join("; ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function DetailPanel({
  commit,
  refByName,
  ownerByBranch,
  onClose,
}: {
  commit: GitCommit;
  refByName: Map<string, GitRef>;
  ownerByBranch: Map<string, BranchOwnership>;
  onClose: () => void;
}) {
  const hostNavigation = useHostNavigation();
  const owner = ownerFor(commit, ownerByBranch);
  const pr = owner?.pr;

  const pairs = [
    {
      label: "Author",
      value: (
        <>
          {commit.author} <span className="gg-dim">{commit.email}</span>
          <span className="gg-dim"> · {shortDate(commit.date)}</span>
        </>
      ),
    },
    { label: "SHA", value: <span className="gg-mono">{commit.sha}</span> },
    {
      label: "Parents",
      value: <span className="gg-mono gg-dim">{commit.parents.join("  ") || "none (root commit)"}</span>,
    },
    {
      label: "Refs",
      value: (
        <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}>
          {commit.refs.length === 0 && <span className="gg-dim">none</span>}
          {commit.refs.map((name) => (
            <RefBadge key={name} name={name} kind={refByName.get(name)?.kind ?? "local"} />
          ))}
        </span>
      ),
    },
    { label: "Message", value: <span style={{ whiteSpace: "pre-wrap" }}>{commit.subject}</span> },
  ];

  const ownershipPairs = !owner
    ? [{ label: "Ownership", value: <span className="gg-dim">No agent, issue or PR linked to a branch here.</span> }]
    : [
        {
          label: "Issue",
          value: owner.issueIdentifier ? (
            <>
              <a className="gg-link gg-mono" {...hostNavigation.linkProps(`/issues/${owner.issueIdentifier}`)}>
                {owner.issueIdentifier}
              </a>{" "}
              {owner.issueTitle} {owner.issueStatus && <span className="gg-dim">({owner.issueStatus})</span>}
            </>
          ) : (
            <span className="gg-dim">no issue</span>
          ),
        },
        {
          label: "Agent",
          value: (
            <>
              {owner.agentName ?? "unassigned"}{" "}
              {owner.agentStatus && <span className="gg-dim">({owner.agentStatus})</span>}{" "}
              <span className="gg-dim gg-mono">on {owner.branch}</span>
            </>
          ),
        },
        ...(pr
          ? [
              {
                label: "Pull request",
                value: (
                  <>
                    <a
                      className="gg-link gg-mono"
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: prStateVar[pr.state] ?? "var(--gg-link)" }}
                    >
                      #{pr.number}
                    </a>{" "}
                    {pr.title} <span className="gg-dim">({pr.state})</span>
                    {pr.reviewers.length > 0 && <span className="gg-dim"> · reviewers {pr.reviewers.join(", ")}</span>}
                    {pr.checks && <span className="gg-dim"> · checks {pr.checks}</span>}
                  </>
                ),
              },
            ]
          : []),
        {
          label: "Sources",
          value: <span className="gg-dim">{owner.sources.map((s) => `${s.kind} (${s.detail})`).join("  ·  ") || "none"}</span>,
        },
      ];

  return (
    <div
      style={{
        borderTop: "1px solid var(--gg-border)",
        background: "var(--gg-panel)",
        height: 240,
        overflow: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "0 12px",
          borderBottom: "1px solid var(--gg-border)",
        }}
      >
        <button className="gg-tab" aria-selected="true">
          Information
        </button>
        <button className="gg-btn" style={{ marginLeft: "auto" }} onClick={onClose}>
          Close
        </button>
      </div>

      <div style={{ padding: 12, display: "grid", gap: 12 }}>
        <KeyValueList pairs={pairs} />
        <div>
          <div className="gg-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            Ownership
          </div>
          <KeyValueList pairs={ownershipPairs} />
        </div>
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d={open ? "M1 3 L5 7 L9 3" : "M3 1 L7 5 L3 9"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" style={{ color: okColor }}>
      <circle cx="6" cy="6" r="5.2" fill="currentColor" />
      <path d="M3.4 6.2 L5.2 8 L8.6 4.4" fill="none" stroke="var(--gg-panel)" strokeWidth="1.5" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M3.5 2 V10 M3.5 6 H7 A1.5 1.5 0 0 0 8.5 4.5 V3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg width="12" height="11" viewBox="0 0 14 12" aria-hidden="true">
      <path
        d="M4 9 A2.4 2.4 0 0 1 4.2 4.2 A3 3 0 0 1 10 4.4 A2.3 2.3 0 0 1 10 9 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1.5 1.5 H6 L10.5 6 L6 10.5 L1.5 6 Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="4" r="0.9" fill="currentColor" />
    </svg>
  );
}
