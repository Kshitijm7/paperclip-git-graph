import type { ThemePreset } from "../shared/types.js";

export type ChipStyle = "outline" | "pill" | "rounded";
export type LaneRule = "agent" | "index";
export type DotStyle = "ring" | "filled" | "small";

export interface ThemePresetConfig {
  rowHeight: number;
  chipStyle: ChipStyle;
  laneRule: LaneRule;
  lanePalette: string[]; // 8 oklch strings, ring order matches AGENT_HUES
  laneChromaMuted: string;
  dotStyle: DotStyle;
  density: string;
}

// Same 8-hue ring as the layout's lane-index colors, just re-chromed per preset.
export const AGENT_HUES = [25, 70, 140, 200, 250, 290, 330, 10];

function ring(chroma: number, lightness: number): string[] {
  return AGENT_HUES.map((h) => `oklch(${lightness}% ${chroma} ${h})`);
}

export const PRESETS: Record<ThemePreset, ThemePresetConfig> = {
  paperclip: {
    rowHeight: 26,
    chipStyle: "outline",
    laneRule: "agent",
    lanePalette: ring(0.16, 62),
    laneChromaMuted: "var(--muted-foreground)",
    dotStyle: "ring",
    density: "SourceGit-tight rows; refs and owner chip sit in fixed columns so the subject never moves.",
  },
  sourcegit: {
    rowHeight: 24,
    chipStyle: "pill",
    laneRule: "index",
    lanePalette: ring(0.17, 65),
    laneChromaMuted: "var(--muted-foreground)",
    dotStyle: "filled",
    density: "Densest preset; ref pills sit inline before the subject, lanes hue by lane index.",
  },
  gitlens: {
    rowHeight: 28,
    chipStyle: "rounded",
    laneRule: "agent",
    lanePalette: ring(0.15, 63),
    laneChromaMuted: "var(--muted-foreground)",
    dotStyle: "ring",
    density: "Rounded chips in their own column; room reserved above the table for a minimap strip.",
  },
  fork: {
    rowHeight: 30,
    chipStyle: "rounded",
    laneRule: "agent",
    lanePalette: ring(0.08, 72),
    laneChromaMuted: "var(--muted-foreground)",
    dotStyle: "small",
    density: "Airiest preset; pastel lanes, author initials, detail panel leads with the committer.",
  },
};

export function resolvePreset(name: string | undefined | null): ThemePresetConfig {
  return PRESETS[(name as ThemePreset) ?? "paperclip"] ?? PRESETS.paperclip;
}
