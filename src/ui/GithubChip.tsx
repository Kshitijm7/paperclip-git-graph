import { useState } from "react";
import type { StatusGithub } from "../shared/types.js";

const PLUGIN_MANIFEST_ID = "paperclip-git-graph";

async function saveGithubAuth(companyId: string, githubAuth: string) {
  const response = await fetch(`/api/plugins/${PLUGIN_MANIFEST_ID}/config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ companyId, configJson: { githubAuth } })
  });
  if (!response.ok) throw new Error(`Save failed (${response.status})`);
}

export function GithubChip({ companyId, github }: { companyId: string; github: StatusGithub }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label =
    github.mode === "gh-cli" && github.ok
      ? `GitHub: ${github.login ?? "gh CLI"} via gh`
      : github.mode === "secret" && github.ok
        ? "GitHub: token"
        : "GitHub: not connected";
  const color = github.ok ? "var(--gg-green)" : "var(--gg-fg-dim)";

  async function useGhCli() {
    setSaving(true);
    setError(null);
    try {
      await saveGithubAuth(companyId, "gh-cli");
      setOpen(false);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button className="gg-btn" style={{ color }} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div
          className="gg-panel"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 10,
            marginTop: 4,
            padding: 12,
            width: 300,
            display: "grid",
            gap: 8,
            border: "1px solid var(--gg-border)",
            borderRadius: 6,
            background: "var(--gg-panel)"
          }}
        >
          <div style={{ fontSize: 12 }}>
            Connect GitHub to fetch pull requests for private repos and avoid rate limits. Use your local{" "}
            <code>gh</code> CLI login, or add a token in plugin settings.
          </div>
          {github.mode === "gh-cli" && github.login ? (
            <button className="gg-btn" disabled={saving} onClick={() => void useGhCli()}>
              {saving ? "Connecting..." : `Use my gh login (${github.login})`}
            </button>
          ) : (
            <div className="gg-dim" style={{ fontSize: 12 }}>
              Install GitHub CLI and run <code>gh auth login</code>, or add a token in{" "}
              <a className="gg-link" href={`/settings/plugins/${PLUGIN_MANIFEST_ID}`}>
                Plugin settings
              </a>
              .
            </div>
          )}
          {error && <span style={{ color: "var(--gg-red)", fontSize: 12 }}>{error}</span>}
        </div>
      )}
    </div>
  );
}
