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
  contextDataFilePath: string;
  /** Number of surrounding sentences to include in a context chunk. */
  contextRadius: number;
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
  contextDataFilePath: "jp-collocations-contexts.json",
  contextRadius: 3,
};

export interface StoreStats {
  total: number;
  byPOS: Record<string, number>;
  bySource: Record<string, number>;
}

// ── Discourse Grammar (談話文法) Types ─────────────────────────

/** A single discourse "bit" — an atomic grammar-thought unit within a chunk. */
export interface DiscourseBit {
  id: string;
  text: string;
  speaker: string;
  /** Colour key for connection lines/underlines linking related bits. */
  connectionGroup: number;
  /** Label describing the discourse function (e.g. 話題化, 例示, 付加疑問文). */
  discourseLabel: string;
  startOffset: number;
  endOffset: number;
}

/** A directional relationship between two discourse bits. */
export interface DiscourseRelation {
  fromBitId: string;
  toBitId: string;
  /** e.g. "topic-continuation", "example", "tag-question", "reaction" */
  relationType: string;
  /** Same colour key used in the connected bits. */
  connectionGroup: number;
}

/** A context chunk extracted around a collocation or phrase. */
export interface ContextChunk {
  id: string;
  /** Raw text of the chunk. */
  rawText: string;
  /** Parsed discourse bits within this chunk. */
  bits: DiscourseBit[];
  /** Relations between bits. */
  relations: DiscourseRelation[];
  /** Vault file path the chunk was extracted from. */
  sourceFile: string;
  /** The highlighted / selected phrase that triggered the chunk creation. */
  selectedPhrase: string;
  createdAt: number;
}

/** An indexed context entry stored in the Lexicon. */
export interface ContextEntry {
  id: string;
  /** Link back to the original collocation, if any. */
  collocationId: string | null;
  /** Link to the context chunk. */
  chunkId: string;
  /** The specific bit ids that were spoilered in card mode. */
  highlightedBitIds: string[];
  /** Markdown-formatted context for display. */
  formattedMarkdown: string;
  tags: string[];
  createdAt: number;
}

export type ViewMode = "search" | "grammar" | "connections" | "forms" | "sources" | "discourse" | "contexts";
