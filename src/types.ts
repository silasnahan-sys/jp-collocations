import { DEFAULT_X_SETTINGS, type XSettings } from "./x/x-types.ts";
import { DEFAULT_AUDIO_EXTRACTION, type AudioExtractionConfig } from "./notes/audio-extractor.ts";
import { DEFAULT_YT_HISTORY_SETTINGS, type YtHistorySettings } from "./notes/yt-history-client.ts";
export type { XSettings };
export type { AudioExtractionConfig };
export type { YtHistorySettings };

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

export type SpeakerFormat = 'icon' | 'letter' | 'number';

/** Notes-reconciliation pipeline config: YouTube transcript fetch + history import
 *  (DESIGN §8 Step 2 fragile adapters). Tool paths are shared with `audioExtraction`. */
export interface NotesPipelineConfig {
  /** Vault folder fetched transcripts are written into (each a frozen note). */
  transcriptFolder: string;
  /** Preferred caption language(s), comma-separated, best first. e.g. "ja". */
  langPref: string;
  /** Prefer a human-authored caption track over the auto (ASR) one. */
  preferManual: boolean;
  /** Desktop: fetch captions via yt-dlp (robust; solves YouTube's JS challenge). */
  useYtdlpTranscripts: boolean;
  /** Safety cap on how many videos one history import will fetch. */
  maxHistoryVideos: number;
}

export const DEFAULT_NOTES_CONFIG: NotesPipelineConfig = {
  transcriptFolder: 'Transcripts',
  langPref: 'ja',
  preferManual: true,
  useYtdlpTranscripts: true,
  maxHistoryVideos: 20,
};

export interface SRSSettings {
  tagPrefix: string;
  speakerFormat: SpeakerFormat;
  includeTimestamps: boolean;
  includeRegister: boolean;
  includeRelations: boolean;
  includeEnglish: boolean;
  maxBitsPerCard: number;
  outputFolder: string;
}

export interface PluginSettings {
  hyogenEnabled: boolean;
  hyogenRateLimit: number;
  hyogenWordList: string[];
  twcEnabled: boolean;
  twcRateLimit: number;
  defaultSortOrder: "headword" | "frequency" | "createdAt" | "updatedAt";
  entriesPerPage: number;
  showReadings: boolean;
  fuzzySearchSensitivity: number;
  maxResults: number;
  dataFilePath: string;
  srs: SRSSettings;
  readingModeHighlight: boolean;
  autoIndexOnStartup: boolean;
  x: XSettings;
  /** Desktop-only yt-dlp/ffmpeg audio clip extraction (DESIGN §12 Tier 1). */
  audioExtraction: AudioExtractionConfig;
  /** YouTube transcript fetch + watch-history import (DESIGN §8 Step 2). */
  notes: NotesPipelineConfig;
  /** Live watch-history scrape via cookie auth (DESIGN §4 YtHistoryAdapter). */
  ytHistory: YtHistorySettings;
}

export const DEFAULT_SRS_SETTINGS: SRSSettings = {
  tagPrefix: 'flashcards/jp',
  speakerFormat: 'icon',
  includeTimestamps: false,
  includeRegister: true,
  includeRelations: true,
  includeEnglish: false,
  maxBitsPerCard: 6,
  outputFolder: 'JP SRS Cards',
};

export const DEFAULT_SETTINGS: PluginSettings = {
  hyogenEnabled: false,
  hyogenRateLimit: 2000,
  hyogenWordList: [],
  twcEnabled: false,
  twcRateLimit: 3000,
  defaultSortOrder: "frequency",
  entriesPerPage: 50,
  showReadings: true,
  fuzzySearchSensitivity: 0.6,
  maxResults: 100,
  dataFilePath: "jp-collocations-data.json",
  srs: { ...DEFAULT_SRS_SETTINGS },
  readingModeHighlight: true,
  autoIndexOnStartup: true,
  x: { ...DEFAULT_X_SETTINGS },
  audioExtraction: { ...DEFAULT_AUDIO_EXTRACTION },
  notes: { ...DEFAULT_NOTES_CONFIG },
  ytHistory: { ...DEFAULT_YT_HISTORY_SETTINGS },
};

export interface StoreStats {
  total: number;
  byPOS: Record<string, number>;
  bySource: Record<string, number>;
}
