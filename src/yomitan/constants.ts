export const DICTIONARY_COLORS: Record<string, string> = {
  "大辞林":              "#2563eb",
  "大辞林4":             "#2563eb",
  "大辞林 第四版":       "#2563eb",
  "大辞泉":              "#0891b2",
  "デジタル大辞泉":      "#0891b2",
  "明鏡国語辞典":        "#16a34a",
  "明鏡":                "#16a34a",
  "日本国語大辞典":      "#7c3aed",
  "精選版 日本国語大辞典": "#7c3aed",
  "三省堂国語辞典":      "#dc2626",
  "新明解国語辞典":      "#ea580c",
  "新明解":              "#ea580c",
  "全訳漢辞海":          "#854d0e",
  "角川新字源":          "#92400e",
  "旺文社 全訳古語辞典": "#065f46",
  "三省堂 全訳読解古語辞典": "#064e3b",
  "角川類語新辞典":      "#6d28d9",
  "日本語シソーラス":    "#4c1d95",
  "NHK日本語発音アクセント辞典": "#be185d",
  "NHK":                 "#be185d",
  "漢検 漢字辞典":       "#1e3a5f",
  "有斐閣 法律用語辞典": "#374151",
  "有斐閣 現代心理学辞典": "#1f2937",
};

export const DEFAULT_DICTIONARY_COLOR = "#6b7280";

export const DICTIONARY_CATEGORIES: Record<string, string[]> = {
  "国語辞典": ["大辞林", "大辞泉", "デジタル大辞泉", "明鏡国語辞典", "日本国語大辞典", "精選版 日本国語大辞典", "三省堂国語辞典", "新明解国語辞典"],
  "漢和辞典": ["全訳漢辞海", "角川新字源"],
  "古語辞典": ["旺文社 全訳古語辞典", "三省堂 全訳読解古語辞典"],
  "類語辞典": ["角川類語新辞典", "日本語シソーラス"],
  "アクセント辞典": ["NHK日本語発音アクセント辞典", "NHK"],
  "漢字辞典": ["漢検 漢字辞典"],
  "専門用語": ["有斐閣 法律用語辞典", "有斐閣 現代心理学辞典"],
};

export const DICT_VIEW_TYPE = "yomitan-dictionary-view";

export const YOMITAN_STORE_DB = "yomitan-dictionaries";
export const YOMITAN_STORE_VERSION = 1;

export const MAX_HISTORY = 100;
export const MAX_SUGGESTIONS = 8;
