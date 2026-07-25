/**
 * Types for Yomitan/Yomichan dictionary import and display.
 * Supports format versions 1–3.
 */

// ── Index (index.json) ──────────────────────────────────────

export interface YomitanIndex {
  title: string;
  revision: string;
  format?: number;
  version?: number;
  sequenced?: boolean;
  author?: string;
  url?: string;
  description?: string;
  attribution?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  frequencyMode?: 'occurrence-based' | 'rank-based';
}

// ── Term bank entry (term_bank_N.json) ──────────────────────

/**
 * A single definition can be:
 *   - plain string
 *   - structured content object { type: "text", text: "..." }
 *   - structured content object { type: "structured-content", content: ... }
 *   - deinflection tuple [uninflected, rules[]]
 */
export type YomitanDefinition = string | YomitanStructuredDef | YomitanDeinflection;

export interface YomitanStructuredDef {
  type: 'text' | 'structured-content' | 'image';
  text?: string;
  content?: YomitanStructuredContent;
  path?: string;
}

/** Structured content can be a string, array, or element node */
export type YomitanStructuredContent =
  | string
  | YomitanStructuredContent[]
  | YomitanContentNode;

export interface YomitanContentNode {
  tag: string;
  content?: YomitanStructuredContent;
  data?: Record<string, string>;
  style?: Record<string, string | number>;
  lang?: string;
  href?: string;
  title?: string;
  open?: boolean;
  // img-specific
  path?: string;
  width?: number;
  height?: number;
  alt?: string;
  description?: string;
  // table-specific
  colSpan?: number;
  rowSpan?: number;
}

export type YomitanDeinflection = [string, string[]];

/**
 * Raw term entry tuple from term_bank JSON:
 * [expression, reading, defTags, rules, score, definitions, sequence, termTags]
 */
export type YomitanTermTuple = [
  string,       // expression
  string,       // reading (empty = same as expression)
  string,       // definition tags (space-separated)
  string,       // deinflection rules (space-separated)
  number,       // score (popularity)
  YomitanDefinition[], // definitions
  number,       // sequence number
  string,       // term tags (space-separated)
];

// ── Tag bank entry (tag_bank_N.json) ────────────────────────

/** [name, category, order, notes, score] */
export type YomitanTagTuple = [string, string, number, string, number];

export interface YomitanTag {
  name: string;
  category: string;
  order: number;
  notes: string;
  score: number;
}

// ── Term meta bank entry (term_meta_bank_N.json) ────────────

export interface YomitanFreqMeta {
  value: number;
  displayValue?: string;
}

export interface YomitanPitchInfo {
  reading: string;
  pitches: Array<{
    position: number | string;
    nasal?: number | number[];
    devoice?: number | number[];
    tags?: string[];
  }>;
}

// ── Parsed / indexed term for storage ───────────────────────

export interface DictionaryTerm {
  /** Index within the dictionary for fast reference */
  id: number;
  expression: string;
  reading: string;
  definitionTags: string[];
  rules: string[];
  score: number;
  definitions: YomitanDefinition[];
  sequence: number;
  termTags: string[];
}

export interface DictionaryMeta {
  title: string;
  revision: string;
  format: number;
  author: string;
  description: string;
  termCount: number;
  tagCount: number;
  hasFrequency: boolean;
  hasPitch: boolean;
  importedAt: number;
}

export interface DictionaryData {
  meta: DictionaryMeta;
  tags: Map<string, YomitanTag>;
  terms: DictionaryTerm[];
  /** expression → term ids for O(1) lookup */
  expressionIndex: Map<string, number[]>;
  /** reading → term ids */
  readingIndex: Map<string, number[]>;
  /** frequency data: expression → frequency value */
  frequencies: Map<string, number>;
  /** pitch data: expression → pitches */
  pitches: Map<string, YomitanPitchInfo>;
}

// ── Dictionary settings ─────────────────────────────────────

export interface DictionarySettings {
  /** List of imported dictionary titles (in priority order) */
  enabledDictionaries: string[];
  /** Max results per lookup */
  maxResults: number;
  /** Show pitch accent */
  showPitch: boolean;
  /** Show frequency */
  showFrequency: boolean;
  /** Compact mode for mobile */
  compactMode: boolean;
}

export const DEFAULT_DICTIONARY_SETTINGS: DictionarySettings = {
  enabledDictionaries: [],
  maxResults: 50,
  showPitch: true,
  showFrequency: true,
  compactMode: false,
};

// ── Lookup result ───────────────────────────────────────────

export interface DictLookupResult {
  term: DictionaryTerm;
  dictionary: string;
  tags: YomitanTag[];
  frequency?: number;
  pitch?: YomitanPitchInfo;
  /**
   * Set when this hit came from deinflecting the query: the inflection trail
   * back to the queried surface (e.g. ['progressive', 'past'] for 食べていた).
   */
  deinflection?: string[];
}
