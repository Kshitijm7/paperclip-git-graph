import { tokens } from "../theme/tokens.js";

// Paperclip host theme only: no background or palette of our own, every color comes from
// theme/tokens.ts, itself a host CSS variable or a color-mix over one. Host vars are defined on
// :root and swapped by a .dark ancestor class, so this file never branches on prefers-color-scheme.
export const CSS = `
.gg-root {
  --gg-bg: transparent;
  --gg-panel: ${tokens.surface};
  --gg-panel-fg: ${tokens.surfaceForeground};
  --gg-border: ${tokens.border};
  --gg-fg: ${tokens.foreground};
  --gg-fg-dim: ${tokens.mutedForeground};
  --gg-hover: ${tokens.accent};
  --gg-selected: ${tokens.selected};
  --gg-link: ${tokens.primary};
  --gg-red: ${tokens.destructive};
  --gg-radius: ${tokens.radius};
  color: var(--gg-fg);
  background: var(--gg-bg);
  font-size: 13px;
}
.gg-new {
  animation: gg-slide-in 160ms ease-out;
}
@keyframes gg-slide-in {
  from { transform: translateY(-6px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .gg-new { animation: none; }
}

.gg-root * { box-sizing: border-box; }
.gg-mono { font-family: ui-monospace, "SFMono-Regular", "Cascadia Mono", Consolas, monospace; }
.gg-dim { color: var(--gg-fg-dim); }
.gg-ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gg-link { color: var(--gg-link); text-decoration: none; }
.gg-link:hover { text-decoration: underline; }

.gg-input {
  background: var(--background);
  color: var(--gg-fg);
  border: 1px solid var(--input);
  border-radius: var(--gg-radius);
  padding: 3px 7px;
  font: inherit;
  height: 24px;
}
.gg-input:focus-visible { outline: 2px solid var(--ring); outline-offset: -1px; }
.gg-btn {
  background: var(--gg-panel);
  color: var(--gg-fg);
  border: 1px solid var(--gg-border);
  border-radius: var(--gg-radius);
  padding: 3px 10px;
  font: inherit;
  height: 24px;
  cursor: pointer;
}
.gg-btn:hover:not(:disabled) { background: var(--gg-hover); }
.gg-btn:disabled { opacity: 0.55; cursor: default; }
.gg-btn-amber { color: oklch(60% 0.17 70); border-color: oklch(60% 0.17 70); }

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
  column-gap: 12px;
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
  column-gap: 12px;
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
  background: transparent;
  border-radius: var(--gg-radius);
  padding: 0 5px;
  height: 17px;
  font-size: 11px;
  max-width: 180px;
  min-width: 0;
  flex-shrink: 1;
}
.gg-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--gg-border);
  background: transparent;
  border-radius: var(--gg-radius);
  padding: 0 5px;
  height: 16px;
  font-size: 10.5px;
  max-width: 160px;
}
.gg-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--pill);
  background: color-mix(in oklch, var(--pill) 14%, transparent);
}
.gg-pill::before {
  content: "";
  flex: 0 0 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--pill);
}
.gg-table { display: grid; min-width: 0; }
.gg-table-head, .gg-table-row {
  display: grid;
  align-items: center;
  column-gap: 12px;
  padding: 0 14px;
  min-width: 0;
}
.gg-table-head {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 32px;
  background: var(--gg-panel);
  border-bottom: 1px solid var(--gg-border);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--gg-fg-dim);
}
.gg-table-row {
  min-height: 44px;
  padding-top: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid color-mix(in oklch, var(--gg-border) 60%, transparent);
}
.gg-table-row:hover { background: var(--gg-hover); }
.gg-table-row > *, .gg-table-head > * { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gg-sub { display: block; font-size: 11.5px; color: var(--gg-fg-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gg-num-ahead { color: oklch(62% 0.15 145); }
.gg-num-behind { color: oklch(70% 0.15 70); }
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

.gg-popover {
  position: absolute;
  z-index: 10;
  background: var(--popover);
  border: 1px solid var(--gg-border);
  border-radius: var(--gg-radius);
  box-shadow: 0 4px 16px color-mix(in oklch, var(--foreground) 12%, transparent);
}
`;

export const ROW_HEIGHT = 26;

// 8 hues, evenly spread, same chroma and lightness so no lane color reads as more important.
export const GRAPH_COLORS = [
  "oklch(65% 0.17 25)",
  "oklch(65% 0.17 70)",
  "oklch(65% 0.17 140)",
  "oklch(65% 0.17 200)",
  "oklch(65% 0.17 250)",
  "oklch(65% 0.17 290)",
  "oklch(65% 0.17 330)",
  "oklch(65% 0.17 10)",
];

// Shared with prStateVar.open: one "healthy / connected / current" green across the plugin.
export const okColor = tokens.prState.open;

export const prStateVar: Record<string, string> = { ...tokens.prState };

export function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, (Date.now() - then) / 1000);
  const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (secs < 60) return "just now";
  if (secs < 3600) return ago(Math.floor(secs / 60), "minute");
  if (secs < 86400) return ago(Math.floor(secs / 3600), "hour");
  if (secs < 86400 * 30) return ago(Math.floor(secs / 86400), "day");
  if (secs < 86400 * 365) return ago(Math.floor(secs / (86400 * 30)), "month");
  return ago(Math.floor(secs / (86400 * 365)), "year");
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace("T", " ").slice(0, 19);
}
