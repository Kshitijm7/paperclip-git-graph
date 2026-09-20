import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import type { ThemePreset } from "../shared/types.js";
import { tokens, type Tokens } from "./tokens.js";
import { resolvePreset, type ThemePresetConfig } from "./presets.js";
import { CSS as BASE_CSS } from "../ui/theme.js";

export interface ThemeContextValue {
  presetName: ThemePreset;
  preset: ThemePresetConfig;
  tokens: Tokens;
  css: string;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function presetCss(name: string, preset: ThemePresetConfig): string {
  const sel = `[data-gg-preset="${name}"]`;
  const chipRadius =
    preset.chipStyle === "pill" ? "999px" : preset.chipStyle === "rounded" ? "8px" : "var(--gg-radius)";
  const chipBorder = preset.chipStyle === "outline" ? "1px solid var(--gg-border)" : "1px solid transparent";
  return `
${sel} .gg-row, ${sel} .gg-head { height: ${preset.rowHeight}px; }
${sel} .gg-chip, ${sel} .gg-badge { border-radius: ${chipRadius}; border: ${chipBorder}; background: ${
    preset.chipStyle === "outline" ? "transparent" : "var(--gg-hover)"
  }; }
`;
}

export function ThemeProvider({
  presetName,
  children,
}: {
  presetName: ThemePreset | string | undefined;
  children: ReactNode;
}) {
  const value = useMemo<ThemeContextValue>(() => {
    const preset = resolvePreset(presetName);
    const name = (presetName as ThemePreset) ?? "paperclip";
    return { presetName: name, preset, tokens, css: BASE_CSS + presetCss(name, preset) };
  }, [presetName]);

  return createElement(ThemeContext.Provider, { value }, createElement("style", null, value.css), children);
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside a ThemeProvider");
  return ctx;
}

export { resolvePreset } from "./presets.js";
export type { ThemePresetConfig } from "./presets.js";
export { hueForAgent, laneColorFor, buildAgentLaneMap, colorForAgent } from "./agentHue.js";
