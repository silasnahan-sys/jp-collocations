// ─── Yomitan Dictionary Registry ─────────────────────────────────────────────
// Contains all known Monokakido-collection dictionaries with metadata.
// The "abbreviation" is the canonical short code used as tile label and DB key.

import type { DictionaryMeta } from "./types.ts";

// ── Monolingual Japanese Dictionaries (国語) ──────────────────────────────────
const MONOLINGUAL_DICTS: DictionaryMeta[] = [
  // 国語辞典
  {
    abbreviation: "大辞林4",
    jaTitle: "大辞林 第四版",
    color: "#2E6DA4",
    category: "国語辞典",
    language: "ja",
    publisher: "三省堂",
  },
  {
    abbreviation: "大辞泉",
    jaTitle: "デジタル大辞泉",
    color: "#1A8C5B",
    category: "国語辞典",
    language: "ja",
    publisher: "小学館",
  },
  {
    abbreviation: "明鏡3",
    jaTitle: "明鏡国語辞典 第三版",
    color: "#3E8C3A",
    category: "国語辞典",
    language: "ja",
    publisher: "大修館書店",
  },
  {
    abbreviation: "日国",
    jaTitle: "日本国語大辞典 第二版",
    color: "#8B1A1A",
    category: "国語辞典",
    language: "ja",
    publisher: "小学館",
  },
  {
    abbreviation: "三国7",
    jaTitle: "三省堂国語辞典 第七版",
    color: "#E05C00",
    category: "国語辞典",
    language: "ja",
    publisher: "三省堂",
  },
  {
    abbreviation: "三国8",
    jaTitle: "三省堂国語辞典 第八版",
    color: "#C44D00",
    category: "国語辞典",
    language: "ja",
    publisher: "三省堂",
  },
  {
    abbreviation: "新明解8",
    jaTitle: "新明解国語辞典 第八版",
    color: "#D4282E",
    category: "国語辞典",
    language: "ja",
    publisher: "三省堂",
  },
  // 漢和辞典
  {
    abbreviation: "漢辞海3",
    jaTitle: "全訳漢辞海 第三版",
    color: "#7B5C00",
    category: "漢和辞典",
    language: "ja",
    publisher: "三省堂",
  },
  {
    abbreviation: "漢辞海4",
    jaTitle: "全訳漢辞海 第四版",
    color: "#996A00",
    category: "漢和辞典",
    language: "ja",
    publisher: "三省堂",
  },
  {
    abbreviation: "新字源",
    jaTitle: "角川新字源 改訂新版",
    color: "#5B3A7A",
    category: "漢和辞典",
    language: "ja",
    publisher: "角川書店",
  },
  // 古語辞典
  {
    abbreviation: "旺古4",
    jaTitle: "旺文社古語辞典 第四版",
    color: "#6B5B3A",
    category: "古語辞典",
    language: "ja",
    publisher: "旺文社",
  },
  {
    abbreviation: "旺古5",
    jaTitle: "旺文社古語辞典 第五版",
    color: "#7D6A42",
    category: "古語辞典",
    language: "ja",
    publisher: "旺文社",
  },
  {
    abbreviation: "三読古5",
    jaTitle: "三省堂 全訳読解古語辞典 第五版",
    color: "#4A6B3A",
    category: "古語辞典",
    language: "ja",
    publisher: "三省堂",
  },
  // 類語辞典
  {
    abbreviation: "角川類語",
    jaTitle: "角川類語新辞典",
    color: "#9B3A6B",
    category: "類語辞典",
    language: "ja",
    publisher: "角川書店",
  },
  {
    abbreviation: "シソーラス2",
    jaTitle: "日本語シソーラス 第二版",
    color: "#6B3A9B",
    category: "類語辞典",
    language: "ja",
    publisher: "大修館書店",
  },
  // アクセント
  {
    abbreviation: "NHKアクセント",
    jaTitle: "NHK日本語発音アクセント新辞典",
    color: "#C47000",
    category: "アクセント",
    language: "ja",
    publisher: "NHK出版",
  },
  // 漢字
  {
    abbreviation: "漢検2",
    jaTitle: "漢検漢字辞典 第二版",
    color: "#4A4A8B",
    category: "漢字",
    language: "ja",
    publisher: "日本漢字能力検定協会",
  },
  // 専門用語
  {
    abbreviation: "有斐法5",
    jaTitle: "有斐閣 法律用語辞典 第五版",
    color: "#3A6B5B",
    category: "専門用語",
    language: "ja",
    publisher: "有斐閣",
  },
  {
    abbreviation: "有斐心",
    jaTitle: "有斐閣 現代心理学辞典",
    color: "#5B6B3A",
    category: "専門用語",
    language: "ja",
    publisher: "有斐閣",
  },
];

// ── Bilingual Dictionaries (英和・和英) ───────────────────────────────────────
const BILINGUAL_DICTS: DictionaryMeta[] = [
  {
    abbreviation: "ACE3",
    jaTitle: "エースクラウン英和辞典",
    color: "#E8A435",
    category: "英和・和英",
    language: "en-ja",
    publisher: "三省堂",
  },
  {
    abbreviation: "G5",
    jaTitle: "ジーニアス英和辞典 第5版",
    enTitle: "Genius English-Japanese Dictionary 5th ed.",
    color: "#1B7A6E",
    category: "英和・和英",
    language: "en-ja",
    publisher: "大修館書店",
  },
  {
    abbreviation: "G6",
    jaTitle: "ジーニアス英和辞典 第6版",
    enTitle: "Genius English-Japanese Dictionary 6th ed.",
    color: "#1B9A8E",
    category: "英和・和英",
    language: "en-ja",
    publisher: "大修館書店",
  },
  {
    abbreviation: "KCEJ",
    jaTitle: "研究社 コンパスローズ英和辞典",
    enTitle: "Compass Rose English-Japanese Dictionary",
    color: "#C45B28",
    category: "英和・和英",
    language: "en-ja",
    publisher: "研究社",
  },
  {
    abbreviation: "CCJAD",
    jaTitle: "COBUILD上級英和辞典",
    enTitle: "COBUILD Advanced Dictionary of American English, English/Japanese",
    color: "#5B3E8A",
    category: "英和・和英",
    language: "en-ja",
    publisher: "HarperCollins / 旺文社",
  },
  {
    abbreviation: "KEC",
    jaTitle: "新編 英和活用大辞典",
    enTitle: "The Kenkyusha Dictionary of English Collocations",
    color: "#8B4513",
    category: "英和・和英",
    language: "en-ja",
    publisher: "研究社",
  },
  {
    abbreviation: "KNEJ",
    jaTitle: "研究社 新英和大辞典 第6版",
    enTitle: "Kenkyusha's New English-Japanese Dictionary 6th ed.",
    color: "#2C5F8A",
    category: "英和・和英",
    language: "en-ja",
    publisher: "研究社",
  },
  {
    abbreviation: "KNJE",
    jaTitle: "研究社 新和英大辞典 第5版",
    enTitle: "Kenkyusha's New Japanese-English Dictionary 5th ed.",
    color: "#6B2D5B",
    category: "英和・和英",
    language: "ja-en",
    publisher: "研究社",
  },
  {
    abbreviation: "GDAI",
    jaTitle: "大修館書店 ジーニアス英和大辞典",
    enTitle: "Taishukan's Unabridged Genius English-Japanese Dictionary",
    color: "#0D7377",
    category: "英和・和英",
    language: "en-ja",
    publisher: "大修館書店",
  },
  {
    abbreviation: "GQE",
    jaTitle: "研究社 英語の数量表現辞典 増補改訂版",
    enTitle: "Kenkyusha's Guide to Quantitative Expressions in English",
    color: "#7B6B3A",
    category: "英和・和英",
    language: "en-ja",
    publisher: "研究社",
  },
  {
    abbreviation: "OLEX",
    jaTitle: "旺文社 オーレックス英和辞典 第2版",
    color: "#D4442E",
    category: "英和・和英",
    language: "en-ja",
    publisher: "旺文社",
  },
  {
    abbreviation: "Readers",
    jaTitle: "研究社 リーダーズ英和辞典 第3版",
    enTitle: "Kenkyusha's Readers English-Japanese Dictionary 3rd ed.",
    color: "#8B1A1A",
    category: "英和・和英",
    language: "en-ja",
    publisher: "研究社",
  },
  {
    abbreviation: "RHEJ",
    jaTitle: "小学館 ランダムハウス英和大辞典 第2版",
    enTitle: "Random House English-Japanese Dictionary 2nd ed.",
    color: "#2E4057",
    category: "英和・和英",
    language: "en-ja",
    publisher: "小学館",
  },
  {
    abbreviation: "SOEJCD",
    jaTitle: "小学館 オックスフォード英語コロケーション辞典",
    enTitle: "Shogakukan-Oxford English-Japanese Collocations Dictionary",
    color: "#4A7C59",
    category: "英和・和英",
    language: "en-ja",
    publisher: "小学館",
  },
  {
    abbreviation: "SOEJT",
    jaTitle: "小学館 オックスフォード英語類語辞典",
    enTitle: "Shogakukan-Oxford English-Japanese Learner's Thesaurus",
    color: "#5C7C4A",
    category: "英和・和英",
    language: "en-ja",
    publisher: "小学館",
  },
  {
    abbreviation: "WISDOM3",
    jaTitle: "ウィズダム英和辞典 第4版 + 和英辞典 第3版",
    enTitle: "Wisdom English-Japanese Dictionary 4th ed. + Japanese-English 3rd ed.",
    color: "#1B3A5C",
    category: "英和・和英",
    language: "en-ja",
    publisher: "三省堂",
  },
];

/** All known dictionaries, monolingual first then bilingual */
export const KNOWN_DICTIONARIES: DictionaryMeta[] = [
  ...MONOLINGUAL_DICTS,
  ...BILINGUAL_DICTS,
];

/** Look up metadata by abbreviation (case-insensitive) */
export function getDictMeta(abbreviation: string): DictionaryMeta | undefined {
  const lower = abbreviation.toLowerCase();
  return KNOWN_DICTIONARIES.find(d => d.abbreviation.toLowerCase() === lower);
}

/** Look up metadata by Yomitan index title (fuzzy match against jaTitle/enTitle/abbreviation) */
export function getDictMetaByTitle(title: string): DictionaryMeta | undefined {
  const t = title.toLowerCase();
  return KNOWN_DICTIONARIES.find(d =>
    d.abbreviation.toLowerCase() === t ||
    d.jaTitle.toLowerCase().includes(t) ||
    t.includes(d.abbreviation.toLowerCase()) ||
    (d.enTitle && (d.enTitle.toLowerCase().includes(t) || t.includes(d.enTitle.toLowerCase().split(" ")[0])))
  );
}

/** Category display order */
export const CATEGORY_ORDER: string[] = [
  "国語辞典",
  "漢和辞典",
  "古語辞典",
  "類語辞典",
  "アクセント",
  "漢字",
  "専門用語",
  "英和・和英",
];

/** Signature colours keyed by abbreviation */
export const DICT_COLORS: Record<string, string> = Object.fromEntries(
  KNOWN_DICTIONARIES.map(d => [d.abbreviation, d.color])
);
