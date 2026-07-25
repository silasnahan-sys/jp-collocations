import { DEFAULT_X_SETTINGS, type XSettings } from "./x/x-types.ts";
import { DEFAULT_AUDIO_EXTRACTION, type AudioExtractionConfig } from "./notes/audio-extractor.ts";
import { DEFAULT_YT_HISTORY_SETTINGS, type YtHistorySettings } from "./notes/yt-history-client.ts";
import { DEFAULT_VOICE_SYNC, type VoiceSyncSettings } from "./notes/voice-lab.ts";
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
  /** ⚠ SECRET — Anthropic API key for the handwriting-OCR stage (stored in the
   *  plugin-data blob exactly like the X cookies; never logged). '' = disabled. */
  ocrApiKey: string;
  /** Override the pinned OCR model ('' → Haiku default in claude-client.ts). */
  ocrModel: string;
  /** Override the escalation model ('' → Opus default in claude-client.ts). */
  ocrEscalationModel: string;
}

export const DEFAULT_NOTES_CONFIG: NotesPipelineConfig = {
  transcriptFolder: 'Transcripts',
  langPref: 'ja',
  preferManual: true,
  useYtdlpTranscripts: true,
  maxHistoryVideos: 20,
  ocrApiKey: '',
  ocrModel: '',
  ocrEscalationModel: '',
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

/** §25.5 発話セッション: the user's self-rating rubric — DATA, editable;
 *  the practice may outgrow 0–4 and the schema must not entrench it. */
export interface SpeakSettings {
  aspects: string[];
  goalPoints: number;
}

/** §25.4 Plex/TV co-viewing (HANDOFF item A): FollowAlong clock (b) syncs from
 *  the server's session viewOffset, and marks cut clips from the Plex Part URL.
 *  The TOKEN is a SECRET — scrubbed from the persisted blob to device-local
 *  storage exactly like the X cookies. Empty baseUrl OR token = adapter dormant. */
export interface PlexSettings {
  /** e.g. http://192.168.1.20:32400 — reachable from this device on the LAN. */
  baseUrl: string;
  /** ⚠ SECRET — X-Plex-Token. '' = disabled (kept device-local, never synced). */
  token: string;
  /** seconds of lead-in / tail when cutting a clip at a mark. */
  clipPreSec: number;
  clipPostSec: number;
}

export const DEFAULT_PLEX_SETTINGS: PlexSettings = {
  baseUrl: '',
  token: '',
  clipPreSec: 4,
  clipPostSec: 4,
};

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
  voiceSync: VoiceSyncSettings;
  /** SRS: how many fresh (unseen) catalog cards to introduce per session. */
  srsNewPerSession: number;
  /** §25.5 発話セッション rubric. */
  speak: SpeakSettings;
  /** §25.4 Plex/TV co-viewing adapter (clock (b) + clip cutting). */
  plex: PlexSettings;
  /**
   * §27.5 big-dictionary sidecars. Absolute path to an EXTRACTED Yomitan export
   * folder (index.json + term_bank_*.json) — desktop only, and deliberately
   * outside the vault: 英辞郎 extracts to 522MB and syncing that would be
   * absurd. The converted shards DO live in the vault, under `bigDictRoot`.
   */
  bigDict: { exportFolder: string; root: string };
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
  voiceSync: { ...DEFAULT_VOICE_SYNC },
  srsNewPerSession: 20,
  speak: {
    aspects: ['一貫性', '文脈適合', '独自の寄与', '簡潔さ', '正確さ', '一発で言えたか'],
    goalPoints: 30,
  },
  plex: { ...DEFAULT_PLEX_SETTINGS },
  bigDict: { exportFolder: '', root: 'JP Dictionaries' },
};

export interface StoreStats {
  total: number;
  byPOS: Record<string, number>;
  bySource: Record<string, number>;
}
