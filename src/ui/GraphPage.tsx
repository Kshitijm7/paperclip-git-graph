import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { GRAPH_COLORS, generateGraph, maxGraphX, type GraphLayout } from "../graph/layout.js";
import { CSS, ROW_HEIGHT, prStateVar, relativeDate, shortDate } from "./theme.js";
import { Welcome, type StatusData } from "./Welcome.js";
import { GithubChip } from "./GithubChip.js";

// PluginHostContext has no pluginId field (checked plugin-sdk/dist/ui/types.d.ts), so the manifest id is hardcoded here.
const PLUGIN_MANIFEST_ID = "paperclip-git-graph";
const LIMITS = [200, 400, 1000];
const VIEWPORT_HEIGHT = 520;
const OVERSCAN = 8;
const AUTHOR_WIDTH = 140;
const SHA_WIDTH = 80;
const TIME_WIDTH = 110;
const GRID = (graphWidth: number) =>
  `${graphWidth}px minmax(0, 1fr) ${AUTHOR_WIDTH}px ${SHA_WIDTH}px ${TIME_WIDTH}px`;

export function GraphPage({ context }: PluginPageProps) {
  const companyId = context.companyId ?? "";
  const [limit, setLimit] = useState(400);
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
  const observerRef = useRef<ResizeObserver | null>(null);
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
    firstParentOnly,
    branch: branch || undefined,
  });
  const branchesQuery = usePluginData<BranchOwnership[]>(DATA_KEYS.branches, { companyId });

  const fetchAction = usePluginAction(ACTION_KEYS.fetch);
  const refreshOwnership = usePluginAction(ACTION_KEYS.refreshOwnership);

  const snapshot = snapshotQuery.data;
  const commits = useMemo(() => snapshot?.commits ?? [], [snapshot]);
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
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN);
  const visible = rows.slice(start, end);
  const selectedCommit = commits.find((c) => c.sha === selected) ?? null;

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

  if (snapshotQuery.loading && !snapshot)
    return (
      <div className="gg-root" style={{ padding: 16 }}>
        <style>{CSS}</style>Loading commit graph...
      </div>
    );

  if (snapshotQuery.error && !snapshot)
    return (
      <div className="gg-root" style={{ padding: 16 }}>
        <style>{CSS}</style>
        <span style={{ color: "var(--gg-red)" }}>{snapshotQuery.error.message}</span>
      </div>
    );

  const status = statusQuery.data;
  if (!snapshot?.path || (status && (!status.configured || !status.healthy))) {
    return (
      <Welcome
        companyId={companyId}
        status={status ?? null}
        onBound={() => {
          statusQuery.refresh();
          snapshotQuery.refresh();
          branchesQuery.refresh();
        }}
      />
    );
  }

  return (
    <div className="gg-root" style={{ display: "flex", height: "100%", minHeight: 620 }}>
      <style>{CSS}</style>

      <Sidebar
        snapshot={snapshot}
        ownerByBranch={ownerByBranch}
        filter={sideFilter}
        onFilter={setSideFilter}
        selectedBranch={branch}
        onSelectBranch={setBranch}
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
          <button className="gg-btn" style={{ whiteSpace: "nowrap", flexShrink: 0 }} disabled={busy} onClick={() => void run(() => refreshOwnership({ companyId }))}>
            Refresh ownership
          </button>
          <select className="gg-input" style={{ flexShrink: 0 }} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {LIMITS.map((n) => (
              <option key={n} value={n}>
                {n} commits
              </option>
            ))}
          </select>
          <label style={{ display: "flex", gap: 5, alignItems: "center", whiteSpace: "nowrap", flexShrink: 0 }}>
            <input
              type="checkbox"
              checked={firstParentOnly}
              onChange={(e) => setFirstParentOnly(e.target.checked)}
            />
            first parent
          </label>
          <input
            className="gg-input"
            style={{ minWidth: 160, flex: 1 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subject, author, sha"
          />
          <span className="gg-dim gg-ell gg-mono" style={{ marginLeft: "auto" }} title={snapshot.path}>
            {snapshot.path}
          </span>
          <span
            className="gg-badge"
            title={snapshot.problems.join("\n") || "No problems reported"}
            style={{ color: snapshot.healthy ? "var(--gg-green)" : "var(--gg-red)", whiteSpace: "nowrap", flexShrink: 0 }}
          >
            {snapshot.healthy ? "healthy" : `${snapshot.problems.length} problems`}
          </span>
          <span className="gg-dim" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
            fetched {snapshot.fetchedAt ? relativeDate(snapshot.fetchedAt) : "never"}
          </span>
        </div>

        {status?.config && (
          <SettingsBar
            companyId={companyId}
            config={status.config}
            github={status.github}
            onSaved={() => statusQuery.refresh()}
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
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          style={{ flex: 1, minHeight: 200, height: VIEWPORT_HEIGHT, overflow: "auto" }}
        >
          <div style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}>
            <div style={{ position: "absolute", top: start * ROW_HEIGHT, left: 0, right: 0 }}>
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
                />
              ))}
            </div>
          </div>
          {rows.length === 0 && (
            <div className="gg-dim" style={{ padding: 16 }}>
              No commit matches this filter.
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
  );
}

function SettingsBar({
  companyId,
  config,
  github,
  onSaved,
}: {
  companyId: string;
  config: { effective: PluginSettings; saved: boolean };
  github?: StatusGithub;
  onSaved: () => void;
}) {
  const hostNavigation = useHostNavigation();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { githubRepo, fetchIntervalMinutes, commitLimit } = config.effective;

  async function saveDefaults() {
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
        alignItems: "center",
        gap: 8,
        padding: "4px 8px",
        borderBottom: "1px solid var(--gg-border)",
        background: "var(--gg-panel)",
        fontSize: 12,
      }}
    >
      <span className="gg-dim gg-ell" style={{ maxWidth: 220 }} title={githubRepo || "auto-detected from origin"}>
        {githubRepo || "repo: auto-detected"}
      </span>
      <span className="gg-dim">fetch every {fetchIntervalMinutes}m</span>
      <span className="gg-dim">{commitLimit} commit cap</span>
      {!config.saved && <span className="gg-badge">Defaults (not saved)</span>}
      {github && <GithubChip companyId={companyId} github={github} />}
      <button className="gg-btn" disabled={saving} onClick={() => void saveDefaults()}>
        {saving ? "Saving..." : "Save defaults"}
      </button>
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
  filter,
  onFilter,
  selectedBranch,
  onSelectBranch,
}: {
  snapshot: RepoSnapshot;
  ownerByBranch: Map<string, BranchOwnership>;
  filter: string;
  onFilter: (v: string) => void;
  selectedBranch: string;
  onSelectBranch: (v: string) => void;
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

  return (
    <div
      style={{
        width: 268,
        flex: "0 0 268px",
        borderRight: "1px solid var(--gg-border)",
        background: "var(--gg-panel)",
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
      }}
    >
      <div style={{ padding: 8 }}>
        <input
          className="gg-input"
          style={{ width: "100%" }}
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          placeholder="Filter branches, tags, worktrees"
        />
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
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  bold?: boolean;
  selected?: boolean;
  owner?: BranchOwnership;
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
      <span style={{ display: "flex" }}>{icon}</span>
      <span className="gg-ell" style={{ fontWeight: bold ? 700 : 400 }}>
        {label}
      </span>
      {owner ? <OwnerPill owner={owner} compact /> : <span />}
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
}) {
  const owner = ownerFor(commit, ownerByBranch);
  return (
    <div
      className="gg-row"
      aria-selected={selected ? "true" : "false"}
      style={{ gridTemplateColumns: GRID(graphColWidth) }}
      onClick={onSelect}
    >
      <div style={{ height: ROW_HEIGHT, width: graphColWidth, overflow: "hidden" }}>
        {layout && (
          <div style={{ transform: `translateX(${-graphScrollLeft}px)` }}>
            <GraphCell layout={layout} row={row} width={graphWidth} />
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, paddingLeft: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, overflow: "hidden" }}>
          {commit.isHead && <RefBadge name="HEAD" kind="head" />}
          {commit.refs.map((name) => (
            <RefBadge key={name} name={name} kind={refByName.get(name)?.kind ?? "local"} />
          ))}
          {owner && <OwnerPill owner={owner} />}
        </div>
        <Subject text={commit.subject} prUrlByNumber={prUrlByNumber} />
      </div>
      <div className="gg-ell gg-dim">{commit.author}</div>
      <div className="gg-mono gg-dim gg-ell">{commit.sha.slice(0, 10)}</div>
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

// "fix:", "feature(ui)!:" and similar lead the subject in bold, the way SourceGit renders them.
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

function GraphCell({ layout, row, width }: { layout: GraphLayout; row: number; width: number }) {
  const top = row * ROW_HEIGHT;
  const lo = row - 1;
  const hi = row + 2;
  const inWindow = (y: number) => y >= lo && y <= hi;

  return (
    <svg width={width} height={ROW_HEIGHT} style={{ display: "block", overflow: "hidden" }}>
      <g transform={`translate(0, ${-top})`}>
        {layout.paths.map((p, i) => {
          // Path points are monotonic in y, so first and last bound the whole polyline.
          const first = p.points[0]!.y;
          const last = p.points[p.points.length - 1]!.y;
          if (p.points.length < 2 || last < lo || first > hi) return null;
          return (
            <polyline
              key={i}
              fill="none"
              strokeWidth={2}
              stroke={GRAPH_COLORS[p.color % GRAPH_COLORS.length]}
              points={p.points.map((pt) => `${pt.x},${pt.y * ROW_HEIGHT}`).join(" ")}
            />
          );
        })}
        {layout.links.map((l, i) =>
          inWindow(l.start.y) || inWindow(l.end.y) ? (
            <path
              key={i}
              fill="none"
              strokeWidth={2}
              stroke={GRAPH_COLORS[l.color % GRAPH_COLORS.length]}
              d={`M ${l.start.x} ${l.start.y * ROW_HEIGHT} Q ${l.control.x} ${l.control.y * ROW_HEIGHT} ${l.end.x} ${l.end.y * ROW_HEIGHT}`}
            />
          ) : null,
        )}
        {layout.dots.map((d) => {
          if (!inWindow(d.center.y)) return null;
          const color = GRAPH_COLORS[d.color % GRAPH_COLORS.length];
          const cy = d.center.y * ROW_HEIGHT;
          if (d.type === "merge")
            return (
              <circle
                key={d.sha}
                cx={d.center.x}
                cy={cy}
                r={3.5}
                fill="var(--gg-bg)"
                stroke={color}
                strokeWidth={2}
              />
            );
          if (d.type === "head")
            return (
              <g key={d.sha}>
                <circle cx={d.center.x} cy={cy} r={6} fill="none" stroke={color} strokeWidth={1.5} opacity={0.55} />
                <circle cx={d.center.x} cy={cy} r={3.5} fill={color} />
              </g>
            );
          return <circle key={d.sha} cx={d.center.x} cy={cy} r={2.5} fill={color} />;
        })}
      </g>
    </svg>
  );
}

function RefBadge({ name, kind }: { name: string; kind: GitRef["kind"] }) {
  const icon = kind === "remote" ? <CloudIcon /> : kind === "tag" ? <TagIcon /> : <CheckIcon />;
  const color =
    kind === "head" ? "var(--gg-green)" : kind === "tag" ? "var(--gg-fg-dim)" : "var(--gg-fg)";
  return (
    <span className="gg-badge gg-mono" title={`${kind}: ${name}`} style={{ color }}>
      {icon}
      <span className="gg-ell">{name}</span>
    </span>
  );
}

function OwnerPill({ owner, compact }: { owner: BranchOwnership; compact?: boolean }) {
  const hostNavigation = useHostNavigation();
  const pr = owner.pr;
  const stateColor = pr ? (prStateVar[pr.state] ?? "var(--gg-fg-dim)") : "var(--gg-fg-dim)";
  const hover = ownershipTooltip(owner);

  return (
    <span className="gg-badge" title={hover} style={{ borderColor: stateColor }}>
      {!compact && owner.agentName && <span className="gg-ell">{owner.agentName}</span>}
      {owner.issueIdentifier && (
        <a className="gg-link gg-mono" {...hostNavigation.linkProps(`/issues/${owner.issueIdentifier}`)}>
          {owner.issueIdentifier}
        </a>
      )}
      {pr && (
        <a
          className="gg-mono"
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: stateColor, fontWeight: 600, textDecoration: "none" }}
        >
          #{pr.number}
        </a>
      )}
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

  return (
    <div
      style={{
        borderTop: "1px solid var(--gg-border)",
        background: "var(--gg-panel)",
        maxHeight: 280,
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

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "96px minmax(0, 1fr)",
          gap: "6px 14px",
          margin: 0,
          padding: 12,
        }}
      >
        <Field label="Author">
          {commit.author} <span className="gg-dim">{commit.email}</span>
          <span className="gg-dim"> · {shortDate(commit.date)}</span>
        </Field>
        <Field label="SHA">
          <span className="gg-mono">{commit.sha}</span>
        </Field>
        <Field label="Parents">
          <span className="gg-mono gg-dim">{commit.parents.join("  ") || "none (root commit)"}</span>
        </Field>
        <Field label="Refs">
          <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}>
            {commit.refs.length === 0 && <span className="gg-dim">none</span>}
            {commit.refs.map((name) => (
              <RefBadge key={name} name={name} kind={refByName.get(name)?.kind ?? "local"} />
            ))}
          </span>
        </Field>
        <Field label="Message">
          <span style={{ whiteSpace: "pre-wrap" }}>{commit.subject}</span>
        </Field>
        <Field label="Ownership">
          {!owner ? (
            <span className="gg-dim">No agent, issue or PR is linked to a branch on this commit.</span>
          ) : (
            <div style={{ display: "grid", gap: 4 }}>
              <div>
                {owner.issueIdentifier ? (
                  <a className="gg-link gg-mono" {...hostNavigation.linkProps(`/issues/${owner.issueIdentifier}`)}>
                    {owner.issueIdentifier}
                  </a>
                ) : (
                  <span className="gg-dim">no issue</span>
                )}{" "}
                {owner.issueTitle} {owner.issueStatus && <span className="gg-dim">({owner.issueStatus})</span>}
              </div>
              <div>
                {owner.agentName ?? "unassigned"}{" "}
                {owner.agentStatus && <span className="gg-dim">({owner.agentStatus})</span>}{" "}
                <span className="gg-dim gg-mono">on {owner.branch}</span>
              </div>
              {pr && (
                <div>
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
                  {pr.reviewers.length > 0 && (
                    <span className="gg-dim"> · reviewers {pr.reviewers.join(", ")}</span>
                  )}
                  {pr.checks && <span className="gg-dim"> · checks {pr.checks}</span>}
                </div>
              )}
              <div className="gg-dim">
                {owner.sources.map((s) => `${s.kind} (${s.detail})`).join("  ·  ") || "no sources recorded"}
              </div>
            </div>
          )}
        </Field>
      </dl>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt
        className="gg-dim"
        style={{ textAlign: "right", textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em" }}
      >
        {label}
      </dt>
      <dd style={{ margin: 0, minWidth: 0 }}>{children}</dd>
    </>
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
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" style={{ color: "var(--gg-green)" }}>
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
