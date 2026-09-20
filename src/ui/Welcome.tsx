import { useState } from "react";
import { usePluginAction, usePluginData } from "@paperclipai/plugin-sdk/ui";
import { ACTION_KEYS, DATA_KEYS, type BrowseResult, type RepoCandidates, type StatusConfig, type StatusGithub } from "../shared/types.js";
import { CSS } from "./theme.js";
import { GithubChip } from "./GithubChip.js";

export interface StatusData {
  configured: boolean;
  path: string | null;
  healthy: boolean;
  problems: string[];
  config?: StatusConfig;
  github?: StatusGithub;
}

interface WelcomeProps {
  companyId: string;
  status: StatusData | null;
  onBound: () => void;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--gg-border)", borderRadius: 6, padding: 12, display: "grid", gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--gg-fg-dim)" }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

export function Welcome({ companyId, status, onBound }: WelcomeProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ target: string; message: string } | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [browsePath, setBrowsePath] = useState("");
  const [manualPath, setManualPath] = useState("");

  const candidatesQuery = usePluginData<RepoCandidates>(DATA_KEYS.candidates, { companyId });
  const bindAction = usePluginAction(ACTION_KEYS.bindFolder);

  async function bind(target: string, path: string) {
    setBusy(target);
    setError(null);
    try {
      const result = (await bindAction({ companyId, path })) as StatusData;
      if (!result.healthy) {
        setError({ target, message: result.problems.join("; ") || "Repository folder is not healthy" });
        return;
      }
      onBound();
    } catch (err) {
      setError({ target, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  function openBrowser(startPath: string) {
    setBrowsing(true);
    setBrowsePath(startPath);
    setManualPath(startPath);
  }

  const candidates = candidatesQuery.data;

  return (
    <div className="gg-root" style={{ padding: 24, display: "grid", gap: 16, maxWidth: 720 }}>
      <style>{CSS}</style>
      <div>
        <h2 style={{ margin: 0, fontSize: 16 }}>Git Graph</h2>
        <p className="gg-dim" style={{ margin: "4px 0 0" }}>
          Pick the repository this company works in. The graph, branch owners and pull requests come from it.
        </p>
      </div>

      {status?.github && <GithubChip companyId={companyId} github={status.github} />}

      {status && status.path && !status.healthy && (
        <div style={{ color: "var(--gg-red)" }}>
          Bound path {status.path} is not healthy: {status.problems.join("; ") || "unknown problem"}
        </div>
      )}

      <Card title="Project workspaces">
        {candidatesQuery.loading && <span className="gg-dim">Loading workspaces...</span>}
        {!candidatesQuery.loading && (candidates?.workspaces.length ?? 0) === 0 && (
          <span className="gg-dim">No project workspaces with a local path were found.</span>
        )}
        {candidates?.workspaces.map((ws) => (
          <div key={ws.path} className="gg-row" style={{ gridTemplateColumns: "1fr auto auto", padding: "4px 0" }}>
            <div style={{ overflow: "hidden" }}>
              <div className="gg-ell">{ws.projectName}</div>
              <div className="gg-dim gg-mono gg-ell">{ws.path}</div>
            </div>
            {ws.isRepo && <span className="gg-badge" style={{ color: "var(--gg-green)" }}>repo</span>}
            <button className="gg-btn" disabled={busy === ws.path} onClick={() => void bind(ws.path, ws.path)}>
              {busy === ws.path ? "Binding..." : "Use this"}
            </button>
            {error?.target === ws.path && <div style={{ color: "var(--gg-red)", gridColumn: "1 / -1" }}>{error.message}</div>}
          </div>
        ))}
      </Card>

      <Card title="Recent">
        {candidatesQuery.loading && <span className="gg-dim">Loading recent repositories...</span>}
        {!candidatesQuery.loading && (candidates?.recent.length ?? 0) === 0 && (
          <span className="gg-dim">No repositories bound yet.</span>
        )}
        {candidates?.recent.map((r) => (
          <div key={r.path} className="gg-row" style={{ gridTemplateColumns: "1fr auto", padding: "4px 0" }}>
            <span className="gg-dim gg-mono gg-ell">{r.path}</span>
            <button className="gg-btn" disabled={busy === r.path} onClick={() => void bind(r.path, r.path)}>
              {busy === r.path ? "Binding..." : "Use"}
            </button>
            {error?.target === r.path && <div style={{ color: "var(--gg-red)", gridColumn: "1 / -1" }}>{error.message}</div>}
          </div>
        ))}
      </Card>

      <Card title="Browse">
        {!browsing && (
          <button className="gg-btn" onClick={() => openBrowser(candidates?.roots[0]?.path ?? "")}>
            Browse
          </button>
        )}
        {browsing && (
          <BrowsePanel
            companyId={companyId}
            initialPath={browsePath}
            roots={candidates?.roots ?? []}
            busy={busy}
            error={error}
            manualPath={manualPath}
            onManualPathChange={setManualPath}
            onBind={bind}
          />
        )}
      </Card>
    </div>
  );
}

interface BrowsePanelProps {
  companyId: string;
  initialPath: string;
  roots: RepoCandidates["roots"];
  busy: string | null;
  error: { target: string; message: string } | null;
  manualPath: string;
  onManualPathChange: (path: string) => void;
  onBind: (target: string, path: string) => Promise<void>;
}

function BrowsePanel({ companyId, initialPath, roots, busy, error, manualPath, onManualPathChange, onBind }: BrowsePanelProps) {
  const [browsePath, setBrowsePath] = useState(initialPath);
  const browseQuery = usePluginData<BrowseResult>(DATA_KEYS.browse, { companyId, path: browsePath });
  const browse = browseQuery.data;

  function navigate(path: string) {
    setBrowsePath(path);
    onManualPathChange(path);
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button className="gg-btn" disabled={!browse?.parent} onClick={() => browse?.parent && navigate(browse.parent)}>
          Up
        </button>
        <select className="gg-input" value="" onChange={(e) => e.target.value && navigate(e.target.value)}>
          <option value="">Jump to root...</option>
          {roots.map((root) => (
            <option key={root.path} value={root.path}>
              {root.label}
            </option>
          ))}
        </select>
        <span className="gg-dim gg-mono gg-ell">{browse?.path ?? browsePath}</span>
      </div>

      {browseQuery.loading && <span className="gg-dim">Loading folders...</span>}
      {browse?.error && <div style={{ color: "var(--gg-red)" }}>{browse.error}</div>}
      {browse && !browse.error && browse.entries.length === 0 && <span className="gg-dim">No subfolders here.</span>}
      <div style={{ maxHeight: 220, overflowY: "auto", display: "grid" }}>
        {browse?.entries.map((entry) => (
          <div
            key={entry.path}
            className="gg-row"
            style={{ gridTemplateColumns: "16px 1fr auto", padding: "2px 0", cursor: "pointer" }}
            onDoubleClick={() => navigate(entry.path)}
          >
            <span>{entry.isRepo ? "\u2387" : "\u{1F4C1}"}</span>
            <span className="gg-ell">{entry.name}</span>
            {entry.isRepo && (
              <button className="gg-btn" disabled={busy === entry.path} onClick={() => void onBind(entry.path, entry.path)}>
                {busy === entry.path ? "Binding..." : "Select"}
              </button>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="gg-input"
          style={{ flex: 1 }}
          value={manualPath}
          onChange={(e) => onManualPathChange(e.target.value)}
          placeholder="G:\\MyProject\\your-repo"
        />
        <button
          className="gg-btn"
          disabled={busy === manualPath || !manualPath.trim()}
          onClick={() => void onBind(manualPath, manualPath.trim())}
        >
          {busy === manualPath ? "Binding..." : "Bind this folder"}
        </button>
      </div>
      {error?.target === manualPath && <div style={{ color: "var(--gg-red)" }}>{error.message}</div>}
    </div>
  );
}
