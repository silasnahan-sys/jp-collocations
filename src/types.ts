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
  discourseIndexPath: string;
  maxContextsPerCollocation: number;
  autoCleanOldContexts: boolean;
  showDiscourseContexts: boolean;
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
  discourseIndexPath: "discourse-index.json",
  maxContextsPerCollocation: 50,
  autoCleanOldContexts: false,
  showDiscourseContexts: true,
};

export interface StoreStats {
  total: number;
  byPOS: Record<string, number>;
  bySource: Record<string, number>;
}

// ── Discourse Grammar Types ────────────────────────────────────────────────

/** Discourse marker found in a captured chunk */
export interface DiscourseMarker {
  id: string;
  surface: string;           // the actual text (e.g., "わけだから")
  category: DiscourseCategory;
  position: 'initial' | 'medial' | 'final' | 'any';
  charStart: number;         // position within the chunk text
  charEnd: number;
}

export type DiscourseCategory =
  | 'topic-initiation'    // 話題開始
  | 'reasoning'           // 理由・説明
  | 'modality'            // 文末モダリティ
  | 'connective'          // 接続・展開
  | 'confirmation'        // 確認・同意要求
  | 'rephrasing'          // 言い換え・修正
  | 'filler'              // フィラー・ヘッジ
  | 'quotation';          // 引用・伝聞

export type DiscourseGranularity =
  | 'morpheme' | 'bunsetsu' | 'clause' | 'utterance'
  | 'turn' | 'exchange' | 'topic-segment';

/** Full discourse context attached to a chunk capture */
export interface DiscourseContext {
  chunkText: string;
  cleanText: string;         // without timestamps
  granularity: DiscourseGranularity;
  markers: DiscourseMarker[];
  relatedCollocations: string[];  // IDs of collocations found in this chunk
  source: {
    file: string;          // vault file path
    lineStart: number;
    lineEnd: number;
    ytTimestamp?: string;  // e.g., "12:34"
    ytUrl?: string;        // YouTube URL
  };
  capturedAt: string;        // ISO timestamp
  contextBefore?: string;    // preceding chunk for context
  contextAfter?: string;     // following chunk for context
  patternTags: string[];     // auto-generated tags like "reasoning-chain", "topic-shift"
}

/** Entry format for surfer bridge */
export interface SurferCollocationEntry {
  expression: string;
  reading?: string;
  meaning?: string;
  exampleSentence?: string;
  exampleSource?: string;
  discourseContexts: DiscourseContext[];
  tags: string[];
}

/** Result when searching collocations in text */
export interface CollocationMatch {
  collocationId: string;
  expression: string;
  matchStart: number;
  matchEnd: number;
}

/** Discourse index file structure for fast multi-dimensional queries */
export interface DiscourseIndex {
  chunks: DiscourseChunkRecord[];
  markerToChunkIds: Record<string, string[]>;
  categoryToChunkIds: Record<string, string[]>;
  collocationToChunkIds: Record<string, string[]>;
}

export interface DiscourseChunkRecord {
  id: string;
  collocationId: string;
  context: DiscourseContext;
}

export interface DiscourseSettings {
  discourseIndexPath: string;
  maxContextsPerCollocation: number;
  autoCleanOldContexts: boolean;
  showDiscourseContexts: boolean;
}

export const DEFAULT_DISCOURSE_SETTINGS: DiscourseSettings = {
  discourseIndexPath: "discourse-index.json",
  maxContextsPerCollocation: 50,
  autoCleanOldContexts: false,
  showDiscourseContexts: true,
};
