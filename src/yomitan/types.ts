// ─── Yomitan Dictionary Types ────────────────────────────────────────────────

export type DictionaryLanguage = "ja" | "en" | "ja-en" | "en-ja";

export type DictionaryCategory =
  | "国語辞典"
  | "漢和辞典"
  | "古語辞典"
  | "類語辞典"
  | "アクセント"
  | "漢字"
  | "専門用語"
  | "英和・和英";

export interface DictionaryMeta {
  /** Short abbreviation used as the tile label (e.g. "G5", "KNEJ") */
  abbreviation: string;
  /** Primary display name (Japanese) */
  jaTitle: string;
  /** English display name, present for bilingual dicts */
  enTitle?: string;
  /** Tile / badge signature colour (hex) */
  color: string;
  /** Category for section grouping */
  category: DictionaryCategory;
  /** Language direction */
  language: DictionaryLanguage;
  /** Publisher / series (optional) */
  publisher?: string;
}

// ─── Yomitan Term Entry ───────────────────────────────────────────────────────

export type TermGender = "masculine" | "feminine" | "neuter" | null;

export interface TermDefinitionContent {
  type: "text" | "structured-content" | "image";
  text?: string;
  content?: unknown;
}

export interface TermDefinition {
  type: "term";
  /** Dictionary name this entry belongs to */
  dictionary: string;
  /** Part-of-speech / type tags */
  tags: string[];
  /** Definition content items */
  content: TermDefinitionContent[];
  /** Sequence number within the dictionary */
  sequence?: number;
}

export interface TermEntry {
  /** Surface form / headword */
  term: string;
  /** Reading (hiragana/katakana) */
  reading: string;
  /** Definition groups */
  definitions: TermDefinition[];
  /** Source dictionary name (from index.json "title") */
  dictionary: string;
  /** Frequency score (higher = more common) */
  frequency?: number;
  /** Pitch accent patterns */
  pitchAccent?: PitchAccentEntry[];
}

export interface PitchAccentEntry {
  reading: string;
  /** Mora position of accent drop (0 = flat) */
  position: number;
  tags?: string[];
}

// ─── Yomitan Kanji Entry ─────────────────────────────────────────────────────

export interface KanjiEntry {
  character: string;
  onyomi: string[];
  kunyomi: string[];
  tags: string[];
  meanings: string[];
  stats: Record<string, string>;
  dictionary: string;
}

// ─── Import / Storage ────────────────────────────────────────────────────────

export interface DictionaryIndex {
  /** Yomitan index.json "title" field — used as DB key */
  title: string;
  format: number;
  revision: string;
  sequenced?: boolean;
  description?: string;
  attribution?: string;
}

export interface ImportedDictionary {
  meta: DictionaryMeta;
  index: DictionaryIndex;
  /** Total number of term entries */
  termCount: number;
  importedAt: number;
}

// ─── Search ──────────────────────────────────────────────────────────────────

export type SearchMode = "all" | "monolingual" | "bilingual";

export interface YomitanSearchOptions {
  query: string;
  mode?: SearchMode;
  maxResults?: number;
  dictionaries?: string[];
}

export interface YomitanSearchResult {
  entry: TermEntry;
  score: number;
  /** The registered DictionaryMeta for this result, if available */
  meta?: DictionaryMeta;
}
