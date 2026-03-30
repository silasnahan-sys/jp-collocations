export enum PartOfSpeech {
  Noun = "名詞",
  Verb = "動詞",
  Adjective_i = "い形容詞",
  Adjective_na = "な形容詞",
  Adverb = "副詞",
  Particle = "助詞",
  AuxVerb = "助動詞",
  Conjunction = "接続詞",
  Interjection = "感動詞",
  Prefix = "接頭詞",
  Suffix = "接尾詞",
  Expression = "表現",
  Other = "その他",
}

export enum CollocationSource {
  Hyogen = "hyogen.info",
  Manual = "manual",
  Import = "import",
  Classified = "classified",
}

export interface CollocationEntry {
  id: string;
  headword: string;
  headwordReading: string;
  collocate: string;
  fullPhrase: string;
  headwordPOS: PartOfSpeech;
  collocatePOS: PartOfSpeech;
  pattern: string;
  exampleSentences: string[];
  source: CollocationSource;
  tags: string[];
  notes: string;
  frequency: number;
  createdAt: number;
  updatedAt: number;
}

export interface CollocationIndex {
  byHeadword: Map<string, string[]>;
  byPOS: Map<string, string[]>;
  byPattern: Map<string, string[]>;
  byTag: Map<string, string[]>;
}

export interface SearchOptions {
  query: string;
  posFilter?: PartOfSpeech[];
  tagFilter?: string[];
  sourceFilter?: CollocationSource[];
  patternFilter?: string;
  fuzzy?: boolean;
  maxResults?: number;
  sortBy?: "headword" | "frequency" | "createdAt" | "updatedAt";
  sortDir?: "asc" | "desc";
}

export interface SearchResult {
  entry: CollocationEntry;
  score: number;
}

export interface PluginSettings {
  hyogenEnabled: boolean;
  hyogenRateLimit: number;
  hyogenWordList: string[];
  defaultSortOrder: "headword" | "frequency" | "createdAt" | "updatedAt";
  entriesPerPage: number;
  showReadings: boolean;
  fuzzySearchSensitivity: number;
  maxResults: number;
  dataFilePath: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  hyogenEnabled: false,
  hyogenRateLimit: 2000,
  hyogenWordList: [],
  defaultSortOrder: "frequency",
  entriesPerPage: 50,
  showReadings: true,
  fuzzySearchSensitivity: 0.6,
  maxResults: 100,
  dataFilePath: "jp-collocations-data.json",
};

export interface StoreStats {
  total: number;
  byPOS: Record<string, number>;
  bySource: Record<string, number>;
}

// ─── Discourse Grammar Types ─────────────────────────────────────────────────

/** Eight high-level categories grounded in 石黒圭, 佐久間まゆみ, メイナード泉子. */
export type DiscourseCategory =
  | "hedging"
  | "epistemic"
  | "interactional"
  | "causal-logical"
  | "enumerative"
  | "referential"
  | "stance"
  | "structural";

/** 33 fine-grained discourse functions. */
export type DiscourseFunction =
  // hedging (4)
  | "hedge-softening"
  | "hedge-approximation"
  | "hedge-quotative"
  | "hedge-deflation"
  // epistemic (5)
  | "epistemic-certainty"
  | "epistemic-speculation"
  | "epistemic-evidential"
  | "epistemic-concession"
  | "epistemic-continuation-blend"
  // interactional (5)
  | "interaction-pivot"
  | "interaction-backChannel"
  | "interaction-repair"
  | "interaction-co-construction"
  | "interaction-acknowledgement"
  // causal-logical (4)
  | "causal-reason"
  | "causal-concessive"
  | "causal-cascade"
  | "causal-result"
  // enumerative (3)
  | "enum-parallel"
  | "enum-discontinuous"
  | "enum-alternative"
  // referential (4)
  | "ref-deictic"
  | "ref-fuzzy-chain"
  | "ref-anaphora"
  | "ref-split-morpheme"
  // stance (4)
  | "stance-framing"
  | "stance-cap"
  | "stance-assertion"
  | "stance-trail-off"
  // structural (4)
  | "struct-connector-compound"
  | "struct-extended-reasoning"
  | "struct-cascade-speculation"
  | "struct-boundary";

/** Per-category colour tokens (CSS hex). */
export const CATEGORY_COLOURS: Record<DiscourseCategory, string> = {
  "hedging":        "#f0a500",
  "epistemic":      "#7c5cbf",
  "interactional":  "#e05c5c",
  "causal-logical": "#3a86ff",
  "enumerative":    "#06a77d",
  "referential":    "#f77f00",
  "stance":         "#c77dff",
  "structural":     "#4cc9f0",
};

/** A persisted discourse chunk stored in discourse-index.json. */
export interface StoredChunk {
  id: string;
  surface: string;
  category: DiscourseCategory;
  functions: DiscourseFunction[];
  collocations: string[];        // CollocationEntry ids
  source: string;                // e.g. video ID or note path
  timestamp?: string;            // e.g. "[08:15]"
  bits: string[];                // bit texts in order
  notes: string;
  createdAt: number;
  updatedAt: number;
}
