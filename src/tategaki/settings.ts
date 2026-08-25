import type { Plugin } from "obsidian";

/**
 * Settings for the 縦書き (tategaki / vertical writing) module.
 *
 * These are stored *inside* the host plugin's settings object under the
 * `tategaki` key, so the host's existing `saveData(this.settings)` call
 * persists them automatically and no edit to `types.ts` is required.
 * If the host plugin has no `settings` field (e.g. it gets restructured),
 * the helpers below fall back to a direct `loadData()` / `saveData()` merge.
 */
export interface TategakiSettings {
  /** Master switch — when false the view still opens but renders horizontally. */
  enabled: boolean;

  // ── Typography ──────────────────────────────────────────────────────────
  /** Base glyph size in px. Pinch-to-zoom writes back to this. */
  fontSize: number;
  /** Unitless line-height. In tategaki this is the *column gap*. */
  lineHeight: number;
  fontFamily: "mincho" | "gothic" | "custom";
  customFontFamily: string;
  /** Padding around the text block, in px. */
  padding: number;
  /** Subtle warm paper tint behind the text. */
  paperTexture: boolean;

  // ── Japanese typesetting ────────────────────────────────────────────────
  /** Render ruby (furigana) from `{漢字|かんじ}` / `漢字《かんじ》` syntax. */
  showFurigana: boolean;
  /** Rotate 2-digit numbers upright (縦中横). */
  tateChuYoko: boolean;
  /** Set Latin runs upright instead of rotated 90°. */
  uprightLatin: boolean;
  /** Render `**bold**` as 圏点 (sesame dots) — the tategaki convention. */
  boutenForBold: boolean;

  // ── Mobile reading ──────────────────────────────────────────────────────
  /** `scroll` = free momentum scrolling, `page` = snap one screen at a time. */
  pageMode: "scroll" | "page";
  /** Show the touch-sized toolbar above the text. */
  showToolbar: boolean;
  /** Tap the left/right thirds of the screen to turn a page (page mode). */
  tapZones: boolean;
  /** Pinch with two fingers to resize the text. */
  pinchZoom: boolean;
  /** Re-render when the active note changes. */
  followActiveFile: boolean;
  /** Remember reading position per file. */
  rememberPosition: boolean;
  /** Short vibration on page turn / lookup, where the device supports it. */
  hapticFeedback: boolean;

  // ── jp-collocations integration ─────────────────────────────────────────
  /** Tap a word to look it up in the collocation lexicon. */
  tapToLookup: boolean;
  /** Underline collocations from the lexicon that occur in the text. */
  highlightCollocations: boolean;
  /** Cap on lexicon entries used for highlighting (keeps scanning cheap). */
  maxHighlightEntries: number;

  // ── Advanced ────────────────────────────────────────────────────────────
  /** Opt-in: apply vertical writing to the markdown editor itself. */
  editorVerticalMode: boolean;
  /** Characters rendered per animation frame for long notes. */
  chunkSize: number;
  /** Reading position per file path (0..1 from the start of the text). */
  positions: Record<string, number>;
}

export const DEFAULT_TATEGAKI_SETTINGS: TategakiSettings = {
  enabled: true,

  fontSize: 19,
  lineHeight: 1.85,
  fontFamily: "mincho",
  customFontFamily: "",
  padding: 18,
  paperTexture: false,

  showFurigana: true,
  tateChuYoko: true,
  uprightLatin: false,
  boutenForBold: true,

  pageMode: "scroll",
  showToolbar: true,
  tapZones: true,
  pinchZoom: true,
  followActiveFile: true,
  rememberPosition: true,
  hapticFeedback: true,

  tapToLookup: true,
  highlightCollocations: true,
  maxHighlightEntries: 4000,

  editorVerticalMode: false,
  chunkSize: 4000,
  positions: {},
};

/** Bounds used by the zoom controls and the settings sliders. */
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 40;
export const LINE_HEIGHT_MIN = 1.2;
export const LINE_HEIGHT_MAX = 3.0;

/** The host plugin, duck-typed so this module never hard-depends on it. */
interface SettingsHost extends Plugin {
  settings?: Record<string, unknown>;
  saveSettings?: () => Promise<void>;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Merge stored values over the defaults, discarding anything malformed. */
export function normaliseSettings(raw: unknown): TategakiSettings {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Partial<TategakiSettings>;
  const merged: TategakiSettings = { ...DEFAULT_TATEGAKI_SETTINGS, ...stored };

  merged.fontSize = clampNumber(merged.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX, DEFAULT_TATEGAKI_SETTINGS.fontSize);
  merged.lineHeight = clampNumber(merged.lineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX, DEFAULT_TATEGAKI_SETTINGS.lineHeight);
  merged.padding = clampNumber(merged.padding, 0, 80, DEFAULT_TATEGAKI_SETTINGS.padding);
  merged.maxHighlightEntries = clampNumber(merged.maxHighlightEntries, 0, 50000, DEFAULT_TATEGAKI_SETTINGS.maxHighlightEntries);
  merged.chunkSize = clampNumber(merged.chunkSize, 500, 50000, DEFAULT_TATEGAKI_SETTINGS.chunkSize);
  if (merged.pageMode !== "scroll" && merged.pageMode !== "page") {
    merged.pageMode = DEFAULT_TATEGAKI_SETTINGS.pageMode;
  }
  if (merged.fontFamily !== "mincho" && merged.fontFamily !== "gothic" && merged.fontFamily !== "custom") {
    merged.fontFamily = DEFAULT_TATEGAKI_SETTINGS.fontFamily;
  }
  if (!merged.positions || typeof merged.positions !== "object") {
    merged.positions = {};
  }
  return merged;
}

/** Read tategaki settings from wherever the host keeps its data. */
export async function loadTategakiSettings(plugin: Plugin): Promise<TategakiSettings> {
  const host = plugin as SettingsHost;
  const inline = host.settings?.["tategaki"];
  if (inline !== undefined) return normaliseSettings(inline);

  try {
    const data = (await plugin.loadData()) as Record<string, unknown> | null;
    return normaliseSettings(data?.["tategaki"]);
  } catch {
    return { ...DEFAULT_TATEGAKI_SETTINGS };
  }
}

/**
 * Persist tategaki settings.
 *
 * Preferred path: write into `plugin.settings.tategaki` and let the host's own
 * `saveSettings()` flush it, so we never race the host's write of its own keys.
 */
export async function saveTategakiSettings(plugin: Plugin, settings: TategakiSettings): Promise<void> {
  const host = plugin as SettingsHost;

  if (host.settings && typeof host.settings === "object") {
    host.settings["tategaki"] = settings;
    if (typeof host.saveSettings === "function") {
      await host.saveSettings();
      return;
    }
  }

  try {
    const data = ((await plugin.loadData()) as Record<string, unknown> | null) ?? {};
    data["tategaki"] = settings;
    await plugin.saveData(data);
  } catch {
    // Storage is unavailable (read-only vault, sync conflict) — keep the
    // in-memory settings so the session still behaves as the user set it.
  }
}
