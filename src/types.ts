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

/**
 * §25.4b jimaku.cc — Japanese subtitles for the shows whose files do not carry
 * them. Plex can only offer what is muxed into the media, which for most
 * live-action and a lot of older anime is nothing; this is the other source.
 * The KEY is a SECRET, kept device-local exactly like the Plex token.
 */
export interface JimakuSettings {
  /** ⚠ SECRET — jimaku.cc API key. '' = the whole adapter stays dormant. */
  apiKey: string;
  /**
   * `fallback` — ask jimaku only when Plex has no usable Japanese track
   * (the default: the muxed track is guaranteed to be in sync).
   * `always`   — prefer jimaku even when Plex has one (better transcripts for
   *              shows whose muxed track is a burned-in-style or partial rip).
   * `off`      — never reach the network for subtitles.
   */
  mode: 'fallback' | 'always' | 'off';
}

export const DEFAULT_JIMAKU_SETTINGS: JimakuSettings = {
  apiKey: '',
  mode: 'fallback',
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
  /** §25.4b jimaku.cc — the subtitle source for media that carries none. */
  jimaku: JimakuSettings;
  /**
   * §27.5 big-dictionary sidecars. Absolute path to an EXTRACTED Yomitan export
   * folder (index.json + term_bank_*.json) — desktop only, and deliberately
   * outside the vault: 英辞郎 extracts to 522MB and syncing that would be
   * absurd. The converted shards DO live in the vault, under `bigDictRoot`.
   */
  bigDict: { exportFolder: string; root: string; backupFile: string };
  /** §26.3 — how this device is HELD, and what follows from that. */
  posture: PostureSettings;
}

/**
 * §26.3 — the ergonomics that cannot be detected, only told.
 *
 * Posture itself is detected (`ui/posture.ts`); these three are the parts no
 * API reports. Handedness decides which edge the tablet rail sits on, and
 * getting it wrong puts every control under the hand that is holding the
 * Pencil. `penNativeDrag` is a MEASUREMENT the plugin makes at runtime and
 * writes back, so the drag commit does not have to relearn the platform on
 * every launch — see `posture.ts` for why it is learned rather than assumed.
 */
export interface PostureSettings {
  /** Which hand holds the Pencil / does the reaching. */
  hand: 'right' | 'left';
  /** Force a layout posture when the platform flags are wrong. */
  override: 'auto' | 'desk' | 'thumb' | 'slate';
  /** §25.4 — pause what is playing while a note is being written. */
  autoPauseOnWrite: boolean;
  /** Learned, not configured: does a pen reach native HTML5 drag here. */
  penNativeDrag: 'unknown' | 'yes' | 'no';
  /** The same measurement for a fingertip — a separate fact, separately
   *  observed. Optional so an existing settings file upgrades silently. */
  touchNativeDrag?: 'unknown' | 'yes' | 'no';
  /**
   * Where the user last parked the tablet's floating rail, and whether they
   * folded it away. Remembered rather than reset, because a rail that returns
   * to the middle of the page every launch is one nobody bothers to move
   * twice. Absent until they move it — the default comes from handedness.
   */
  rail?: { edge: 'left' | 'right'; y: number; collapsed: boolean };
  /**
   * Text scale for the plugin's surfaces, 0–4 (2 = 1×). A live control rather
   * than a setting you find once — pinch, or a hotkey — because a Pencil at a
   * desk and a thumb on a couch want different sizes of the same view.
   */
  density: number;
}

export const DEFAULT_POSTURE_SETTINGS: PostureSettings = {
  hand: 'right',
  override: 'auto',
  density: 2,               // exactly 1× — nothing resizes itself on first run
  // ON by default. The alternative is the behaviour that shipped — the show
  // keeps playing while you type with your eyes down — and nobody watching a
  // drama wants that; it is the single change most likely to be missed if it
  // has to be found in settings first.
  autoPauseOnWrite: true,
  penNativeDrag: 'unknown',
};

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
  jimaku: { ...DEFAULT_JIMAKU_SETTINGS },
  bigDict: { exportFolder: '', root: 'JP Dictionaries', backupFile: '' },
  posture: { ...DEFAULT_POSTURE_SETTINGS },
};

export interface StoreStats {
  total: number;
  byPOS: Record<string, number>;
  bySource: Record<string, number>;
}
