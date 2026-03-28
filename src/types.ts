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
  discourseIndexPath: "jp-collocations-discourse-index.json",
  maxContextsPerCollocation: 20,
  autoCleanOldContexts: true,
  showDiscourseContexts: true,
  vaultIndexMaxSentencesPerWord: 10,
  vaultIndexSkipIndexed: true,
};

export interface StoreStats {
  total: number;
  byPOS: Record<string, number>;
  bySource: Record<string, number>;
}

// ────────────────────────────────────────────────────────────────
// Discourse Grammar Types (bridge contract with jp-sentence-surfer)
// ────────────────────────────────────────────────────────────────

export type DiscourseCategory =
  | 'topic-initiation'
  | 'reasoning'
  | 'modality'
  | 'connective'
  | 'confirmation'
  | 'rephrasing'
  | 'filler'
  | 'quotation';

export type DiscourseGranularity =
  | 'morpheme'
  | 'bunsetsu'
  | 'clause'
  | 'utterance'
  | 'turn'
  | 'exchange'
  | 'topic-segment';

export interface DiscourseMarker {
  id: string;
  surface: string;
  category: DiscourseCategory;
  position: 'initial' | 'medial' | 'final' | 'any';
  charStart: number;
  charEnd: number;
}

export interface DiscourseContext {
  chunkText: string;
  cleanText: string;
  granularity: DiscourseGranularity;
  markers: DiscourseMarker[];
  relatedCollocations: string[];
  source: {
    file: string;
    lineStart: number;
    lineEnd: number;
    ytTimestamp?: string;
    ytUrl?: string;
  };
  capturedAt: string;
  contextBefore?: string;
  contextAfter?: string;
  patternTags: string[];
}

export interface SurferCollocationEntry {
  expression: string;
  reading?: string;
  meaning?: string;
  exampleSentence?: string;
  exampleSource?: string;
  discourseContexts: DiscourseContext[];
  tags: string[];
}

export interface CollocationMatch {
  collocationId: string;
  expression: string;
  matchStart: number;
  matchEnd: number;
}

/** Persisted record stored inside discourse-index.json */
export interface DiscourseChunkRecord {
  id: string;
  context: DiscourseContext;
  collocationIds: string[];
}

/** Top-level shape of discourse-index.json */
export interface DiscourseIndex {
  chunks: Record<string, DiscourseChunkRecord>;
  byMarker: Record<string, string[]>;     // surface → chunkIds
  byCategory: Record<string, string[]>;  // category → chunkIds
  byCollocation: Record<string, string[]>; // collocationId → chunkIds
}

export interface DiscourseStats {
  totalChunks: number;
  byCategory: Record<string, number>;
  topMarkers: Array<{ surface: string; count: number }>;
  topCollocations: Array<{ id: string; contextCount: number }>;
}

/** Extended plugin settings including discourse features */
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
  // Discourse settings
  discourseIndexPath: string;
  maxContextsPerCollocation: number;
  autoCleanOldContexts: boolean;
  showDiscourseContexts: boolean;
  // Vault indexer settings
  vaultIndexMaxSentencesPerWord: number;
  vaultIndexSkipIndexed: boolean;
}
