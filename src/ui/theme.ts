// SourceGit palette as CSS variables. Light is the default; dark comes from prefers-color-scheme
// and from any host-set theme attribute or class, since the plugin UI mounts inside the host DOM.
export const CSS = `
.gg-root {
  --gg-bg: #ffffff;
  --gg-panel: #f5f5f5;
  --gg-border: #e0e0e0;
  --gg-fg: #1f1f1f;
  --gg-fg-dim: #666666;
  --gg-hover: rgba(0, 0, 0, 0.05);
  --gg-selected: rgba(59, 130, 246, 0.14);
  --gg-link: #2563eb;
  --gg-green: #2e9e4f;
  --gg-purple: #7c4dff;
  --gg-red: #d93025;
  --gg-grey: #8b8b8b;
  color: var(--gg-fg);
  background: var(--gg-bg);
  font-size: 13px;
}
@media (prefers-color-scheme: dark) {
  .gg-root {
    --gg-bg: #1f1f1f;
    --gg-panel: #2b2b2b;
    --gg-border: #333333;
    --gg-fg: #dddddd;
    --gg-fg-dim: #9a9a9a;
    --gg-hover: rgba(255, 255, 255, 0.06);
    --gg-selected: rgba(59, 130, 246, 0.22);
    --gg-link: #6ea8fe;
    --gg-green: #4caf50;
    --gg-purple: #b39ddb;
    --gg-red: #ef5350;
    --gg-grey: #9a9a9a;
  }
}
[data-theme="light"] .gg-root, .light .gg-root {
  --gg-bg: #ffffff;
  --gg-panel: #f5f5f5;
  --gg-border: #e0e0e0;
  --gg-fg: #1f1f1f;
  --gg-fg-dim: #666666;
  --gg-hover: rgba(0, 0, 0, 0.05);
  --gg-selected: rgba(59, 130, 246, 0.14);
  --gg-link: #2563eb;
}
[data-theme="dark"] .gg-root, .dark .gg-root {
  --gg-bg: #1f1f1f;
  --gg-panel: #2b2b2b;
  --gg-border: #333333;
  --gg-fg: #dddddd;
  --gg-fg-dim: #9a9a9a;
  --gg-hover: rgba(255, 255, 255, 0.06);
  --gg-selected: rgba(59, 130, 246, 0.22);
  --gg-link: #6ea8fe;
  --gg-green: #4caf50;
  --gg-purple: #b39ddb;
  --gg-red: #ef5350;
}

.gg-root * { box-sizing: border-box; }
.gg-mono { font-family: ui-monospace, "SFMono-Regular", "Cascadia Mono", Consolas, monospace; }
.gg-dim { color: var(--gg-fg-dim); }
.gg-ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gg-link { color: var(--gg-link); text-decoration: none; }
.gg-link:hover { text-decoration: underline; }

.gg-input {
  background: var(--gg-bg);
  color: var(--gg-fg);
  border: 1px solid var(--gg-border);
  border-radius: 4px;
  padding: 3px 7px;
  font: inherit;
  height: 24px;
}
.gg-input:focus-visible { outline: 2px solid var(--gg-link); outline-offset: -1px; }
.gg-btn {
  background: var(--gg-panel);
  color: var(--gg-fg);
  border: 1px solid var(--gg-border);
  border-radius: 4px;
  padding: 3px 10px;
  font: inherit;
  height: 24px;
  cursor: pointer;
}
.gg-btn:hover:not(:disabled) { background: var(--gg-hover); }
.gg-btn:disabled { opacity: 0.55; cursor: default; }

.gg-group {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: 0;
  color: var(--gg-fg);
  font: inherit;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 11px;
  padding: 5px 8px;
  cursor: pointer;
}
.gg-group:hover { background: var(--gg-hover); }

.gg-side-row {
  width: 100%;
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  padding: 3px 8px 3px 16px;
  cursor: pointer;
  height: 24px;
}
.gg-side-row:hover { background: var(--gg-hover); }
.gg-side-row[aria-selected="true"] { background: var(--gg-selected); }

.gg-row {
  display: grid;
  align-items: center;
  height: 26px;
  cursor: default;
  border-bottom: 1px solid transparent;
  overflow: hidden;
}
.gg-row:hover { background: var(--gg-hover); }
.gg-row[aria-selected="true"] { background: var(--gg-selected); }

.gg-head {
  display: grid;
  align-items: center;
  height: 26px;
  background: var(--gg-panel);
  border-bottom: 1px solid var(--gg-border);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--gg-fg-dim);
  overflow: hidden;
}

.gg-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--gg-border);
  background: var(--gg-panel);
  border-radius: 4px;
  padding: 0 5px;
  height: 17px;
  font-size: 11px;
  max-width: 220px;
}
.gg-tab {
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--gg-fg-dim);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 6px 2px;
  cursor: pointer;
}
.gg-tab[aria-selected="true"] { color: var(--gg-link); border-bottom-color: var(--gg-link); }
`;

export const ROW_HEIGHT = 26;

export const prStateVar: Record<string, string> = {
  open: "var(--gg-green)",
  draft: "var(--gg-grey)",
  merged: "var(--gg-purple)",
  closed: "var(--gg-red)",
};

export function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, (Date.now() - then) / 1000);
  if (secs < 60) return `${Math.floor(secs)} seconds ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)} minutes ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} hours ago`;
  if (secs < 86400 * 30) return `${Math.floor(secs / 86400)} days ago`;
  if (secs < 86400 * 365) return `${Math.floor(secs / (86400 * 30))} months ago`;
  return `${Math.floor(secs / (86400 * 365))} years ago`;
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace("T", " ").slice(0, 19);
}
