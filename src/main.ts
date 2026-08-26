import { Plugin, WorkspaceLeaf, Notice, TFile, Platform, FileSystemAdapter, Menu, Modal, MarkdownView, normalizePath, requestUrl, arrayBufferToBase64 } from "obsidian";
// §26.3 step 6 — going TO and FROM. The stack logic is pure; this file supplies
// the workspace.
import {
  toggle as navToggle, goTo as navGoTo, back as navBackStep, presentation,
  mouseIntent, type Place,
} from "./ui/suite-nav";
import { posture, watchViewport } from "./ui/posture";
import {
  feedWheel, idleGesture, stepIndex, clampDensity, densityScale, densityLabel,
  DENSITY_DEFAULT, type GestureState,
} from "./ui/input-map";
import type { PluginSettings, CollocationEntry } from "./types";
import { DEFAULT_SETTINGS, DEFAULT_NOTES_CONFIG, DEFAULT_PLEX_SETTINGS, DEFAULT_JIMAKU_SETTINGS, DEFAULT_POSTURE_SETTINGS, PartOfSpeech, CollocationSource } from "./types";
// §26.3 — how the device is held, and the Pencil affordances that follow.
import { configurePosture, watchForPen, applyPostureClasses } from "./ui/posture";
import { PenProbeModal } from "./ui/PenProbeModal";
import { CollocationStore } from "./data/CollocationStore";
import { DataManager, type BlobFileIO } from "./data/data-manager";
import { stripDerivedIndexes, extractSecrets, scrubSettingsForPersist, SECRET_LS_KEYS } from "./data/blob-migrations";
import { SearchEngine } from "./search/SearchEngine";
import { HyogenScraper } from "./scraper/HyogenScraper";
import { hyogenExamples } from "./scraper/hyogen-parse";
import { normalizeJapanese } from "./utils/japanese";
import { abortPointerDrag } from "./ui/pointer-drag";
import { definitionsPreview, type PeekData } from "./ui/hover-peek";
import type { ViewChrome } from "./ui/view-chrome";
import { TsukubaWebCorpusScraper } from "./scraper/TsukubaWebCorpusScraper";
import { CollocationView, JP_COLLOCATIONS_VIEW_TYPE, setCollocationViewResolver } from "./ui/CollocationView";
import { SearchModal } from "./ui/SearchModal";
import { AddEntryModal } from "./ui/AddEntryModal";
import { SettingsTab } from "./ui/SettingsTab";
import { CaptureModal, type CaptureContext, type CaptureDeps } from "./ui/CaptureModal";
import { injectClassGrammar } from "./ui/class-grammar";
import { DiscourseGoldStore, toJsonl } from "./notes/discourse-gold";
import { SrsStore } from "./srs/srs-store";
import { ReviewView, JP_REVIEW_VIEW_TYPE } from "./ui/ReviewView";
// AUDIT §6.5 / punch #8 — ratification as a BYPRODUCT of study.
import { RatifyStore } from "./study/ratify-store";
import {
  nextProbe, bestClaimProbe, answerOf, openCounts, report as ratifyReport, drillRow, componentRow,
  MIN_FOR_PRECISION, MEASUREMENT_EVERY, DISPOSE,
  type Probe, type Verdict, type RatifyData,
} from "./study/ratify";
import { isReviewable } from "./srs/review-cards";
import { CardPreviewModal } from "./ui/CardPreviewModal";
import { generatePhraseInContextCard, generateRelationChunkCards, setCardGenResolver } from "./srs/card-generator";
import { extractCollocations } from "./srs/collocation-extractor";
import { DictionaryView, JP_DICTIONARY_VIEW_TYPE } from "./ui/DictionaryView";
import { DictionaryStore } from "./dictionary/DictionaryStore";
import type { DictLookupResult } from "./dictionary/types";
import { XCorpusStore } from "./x/XCorpusStore";
import { XClient } from "./x/XClient";
import { XSearchView, JP_X_VIEW_TYPE, type XViewDeps } from "./ui/XSearchView";
import { emptyQuery, DEFAULT_X_SETTINGS } from "./x/x-types";
// §29.2 — X as a corpus: KWIC windows, spread, and the adjacent environment.
import { buildXUsage, kwicQuote, type XUsage } from "./x/usage";
import { parseTerms } from "./x/query-builder";
import type { Oracle } from "./x/relevance";
import { deinflect } from "./dictionary/deinflect";
import {
  buildBrowserCaptureUrl,
  decodeCaptureData,
  X_CAPTURE_ACTION,
} from "./x/mobile-capture";
import { getDiscourseExtensions, toggleDiscourseVisualization, toggleVisualization, visualizationActive, setEditorContext } from "./ui/EditorDecorations";
import { getReadingModePostProcessor, setReadingResolver } from "./ui/ReadingModeHighlighter";
import {
  expandSelection,
  renderSelectionToolbar,
  SELECTION_MODES,
  type SelectionMode,
} from "./ui/SelectionModes";
import { analyzeRelations, summarizeRelations } from "./discourse/sentence-relations";
import { SurferBridge } from "./surfer-bridge";
import { makeRelationsResolver, type RelationsResolver } from "./discourse/relations-resolver";
import { setGrammarSetResolver } from "./srs/grammar-set-engine";
import { ContextEngine } from "./context/ContextEngine";
import { readingSource, proseLines, tweetLines, sweepableTweets } from "./notes/medium-lines";
import { reconcileMultiAsync, reconcileOne, parseTranscriptLines, frontmatterSources, frontmatterMedium, isCaptureNote, frontmatterAny, bodyVideoId, extractNotePhrases, looksGenerated, CAPTION_STAMP_RE, type ReconciledResult } from "./notes/pipeline";
import { makeDictionaryReadingResolver } from "./notes/reading-resolver";
import { LibraryView, JP_RECON_LIBRARY_VIEW_TYPE } from "./ui/LibraryView";
import { ReconLibrary } from "./notes/recon-library";
import { PatternStore, sweepTerms, patternIdFor, derivePattern, attestationKey, type Attestation, type PatternEntry, type Medium } from "./notes/pattern-store";
// §27.5 big-dictionary sidecars (the blob never sees 2.36M entries).
import { importEijiro, type BankSource } from "./dictionary/import-eijiro";
import { vaultSidecarIO, nodeBankSource, nodeChunkSource } from "./dictionary/sidecar-io";
import {
  bufferedSidecarIO, repairSidecarMeta, verifyAllSidecars, describeSidecarProblem, resolveBigDictRoot,
  buildIntentIndex, readMeta, writeMeta,
} from "./dictionary/sidecar";
import { importDexie, skipTitles } from "./dictionary/import-dexie";
import { BigDictStore } from "./dictionary/big-dict";
import { toFrame } from "./dictionary/frames";
// The move concordance (DISCOURSE-VERDICT §11 fail branch → §12 result).
import { transcriptToTurns } from "./discourse/calculus/turns.mjs";
import {
  buildConcordance as buildConcordanceRows, uptakeProfile, toAttestations,
  type ConcordanceRow,
} from "./discourse/concordance.mjs";
import { sweepEntry, sweepableClass, sweepMuted, findTermAll } from "./notes/sweep-match";
import { chunkLine } from "./notes/discovery";
import { PipelineView, JP_PIPELINE_VIEW_TYPE } from "./ui/PipelineView";
import { DiscourseModeView, JP_DISCOURSE_MODE_VIEW_TYPE, type FileSeg, type FileRel, type FileReadings } from "./ui/DiscourseModeView";
import { detectPatterns } from "./discourse/discourse-grammar";
import { buildAnchoredEntries, entryToResult, retypeInMarkdown, blockIdFor, type LibraryEntry } from "./notes/annotate";
import type { MatcherLine } from "./notes/local-matcher";
import { stripAnchors, planAnchors, applyAnchors, type AnchorPlan } from "./notes/transcript-anchor";
import { DEFAULT_NOTE_CLASS } from "./notes/note-types";
import { renderCatalogJsonl, renderCatalogMd, parseCatalogJsonl } from "./notes/catalog-mirror";
import { buildReconCards, renderCardsFile } from "./notes/cards";
import { parseYouTubeId, deepLinkProvider } from "./notes/audio-provider";
import { downloadFullAudio, clipFromLocal, clipWindow, detectTools, clipNameFor, nodeRuntimeAvailable, requireStrategy, probeBinary, nodeReq, run as runTool, ffmpegBinFrom } from "./notes/audio-extractor";
import { parsePlexSessions, pickPlexSession, plexSessionsUrl, plexPartUrl, buildPlexClipArgs, buildPlexStillArgs, plexStreamUrl, plexMetadataUrl, parseStreams, pickSubtitleStream, subtitleRefusal, describeSubtitles, parsePlexItems, plexSectionsUrl, plexSectionItemsUrl, plexLeavesUrl, plexSearchUrl, episodeLabel, explainPlexTransportError, type PlexSessionsResult, type PlexStream, type PlexItemsResult } from "./notes/plex";
import { parsePlexMediaMeta, type PlexMediaMeta } from "./notes/plex";
import { plexControlUrl, plexControlHeaders, type PlexCommand } from "./notes/plex";
import { PlexBrowseModal } from "./ui/PlexBrowseModal";
import { jimakuSearchUrl, jimakuFilesUrl, jimakuHeaders, jimakuDownloadHeaders, parseJimakuEntries, parseJimakuFiles, pickJimakuEntry, pickJimakuFile, jimakuFileRefusal, jimakuQueryFor, describeJimakuEntry, episodeNumberFrom, type JimakuEntriesResult, type JimakuFilesResult, type JimakuEntry, type JimakuFile } from "./notes/jimaku";
import { JimakuPickModal } from "./ui/JimakuPickModal";
import { YouTubeTranscriptAdapter, TranscriptError, type HttpClient, type Transcript, type TranscriptFetchConfig, type YtdlpTranscriptConfig } from "./notes/transcript";
import { ocrImage, mergeOcrPhrases, imageHash, ocrMarker, planTiles, tileUpscale } from "./notes/ocr-reconciler";
import { detectSpeechTools, enrichClip, voiceSyncSidecarName, extractRefWav, DEFAULT_VOICE_SYNC, type VoiceSyncData } from "./notes/voice-lab";
import { registerVoiceSync } from "./ui/VoiceSyncRenderer";
import { API_URL as CLAUDE_API_URL, API_VERSION as CLAUDE_API_VERSION, type ClaudeHttp, type VisionImage } from "./notes/claude-client";
import { buildScaffoldBody, parseScaffoldResponse } from "./notes/scaffold";
import { suggestClass } from "./notes/class-suggester";
import { srtToNote, fmtStamp } from "./notes/srt";
import { parseWhisperSegments, parseDiarTurns, speakerStampLines } from "./notes/voice-lab";
import { profileFromFrames, FRAME_ITEMS } from "./scraper/goho";
import { MANGA_MODEL, MANGA_PROMPT, parseMangaOcr } from "./notes/manga-ocr";
import { buildVisionBody } from "./notes/claude-client";
import { parsePodcastFeed, podcastNote } from "./notes/podcast-rss";
import { componentKeyOf, type ComponentVerdict } from "./ui/DiscourseModeView";
import { ImportModal } from "./ui/ImportModal";
import { InboxStore, markCard, imageCard, pairedCard, shapeDrop, type MarkRef, type InboxCard } from "./notes/inbox";
import { HoldStore, DEFAULT_HOLD_KNOBS, type HeldChip, type HoldKnobs } from "./notes/hold";
import { DictHistoryStore } from "./dictionary/dict-nav";
import { HoldDock } from "./ui/hold-dock";
// §29 — the drag road. `drop-intent` decides what arrived; `runDropIntent`
// below hands it to the same code the equivalent command already calls.
import { dropIntents, titleFromFilename, type DropIntent } from "./notes/drop-intent";
import { dropBytes } from "./ui/drop-router";
import { SURFACE_LABEL, type Surface } from "./ui/surface-bar";
import { ReachStore, reachStats, type ReachData, type Reach, type Incoming } from "./notes/reach";
import { ReachModal } from "./ui/ReachModal";
import { TrayView, JP_TRAY_VIEW_TYPE, type TrayDoor } from "./ui/TrayView";
import { discoverCollocations, type DiscoverySource, type Discovery } from "./notes/discovery";
import { DiscoveryModal } from "./ui/DiscoveryModal";
import { SpeakStore } from "./notes/speak-session";
import { FollowAlongView, JP_FOLLOW_VIEW_TYPE } from "./ui/FollowAlongView";
import { PLAYER_MODEL, PLAYER_PROMPT, parsePlayerShot, matchEpisodeNote } from "./notes/player-shot";

/**
 * How many sightings ONE auto-swept entry may write. The gesture's job is
 * discovery, not exhaustive attestation: measured on a 123-transcript vault,
 * 「気になる」 finds 135 sightings and 「っていうのは」 238, and writing those on a
 * single drop would bury the ✓✕ queue under one phrase. The manual full sweep
 * is still there for exhaustive work, and the Notice always states the total
 * when the cap bites.
 */
const AUTO_SWEEP_CAP = 12;

/** One source transcript in a (possibly multi-video) reconcile run. */
interface ReconSource {
  tFile: TFile;
  videoId: string | null;
  pristine: string;
  lines: MatcherLine[];
  /** The phrases that matched THIS transcript best. */
  results: ReconciledResult[];
  plan: AnchorPlan;
}
interface ReconPrep { file: TFile; sources: ReconSource[] }

/**
 * §25.4b — one subtitle attempt, from either source. `why` is written to be
 * shown verbatim: when both sources fail, the user is told what each of them
 * had, which is the difference between "no subtitles" and "the only track is
 * PGS pictures / jimaku has this show but not this episode".
 */
type SubtitleFetch =
  | {
    ok: true;
    source: "plex" | "jimaku";
    text: string;
    lang?: string;
    codec?: string;
    jimaku?: { entryId?: number; fileName?: string; url?: string };
  }
  | { ok: false; why: string; ambiguous?: boolean };
import { renderTranscriptFile, transcriptFileBaseName } from "./notes/transcript-assembly";
import { parseHistory, type WatchedVideo } from "./notes/yt-history";
import { YtHistoryClient, YtHistoryError, DEFAULT_YT_HISTORY_SETTINGS } from "./notes/yt-history-client";
import { HistoryRangeModal } from "./ui/HistoryRangeModal";
import { NOTE_TYPES, type NoteClass } from "./notes/note-types";
import type {
  SurferCollocationEntry,
  DiscourseContext,
  DiscourseCategory,
  CollocationMatch,
  DiscourseStats,
  AnalysisResult,
  VariationTreeResult,
  KWICResult,
  ConstellationResult,
  VaultProfileResult,
  TranscriptAnalysisResult,
} from "./surfer-types";

/**
 * The inverse of `openSurfaceRaw` — which surface is this leaf?
 *
 * Needed so that leaving a surface can RECORD it, which is what makes
 * 辞書 → 𝕏 → back land on 辞書 instead of on the note. Only the six the
 * surface bar knows about; anything else is not a place the suite navigates.
 */
const SURFACE_BY_VIEW_TYPE: Record<string, Surface> = {
  [JP_COLLOCATIONS_VIEW_TYPE]: "lexicon",
  [JP_DICTIONARY_VIEW_TYPE]: "dict",
  [JP_X_VIEW_TYPE]: "x",
  [JP_TRAY_VIEW_TYPE]: "tray",
  [JP_REVIEW_VIEW_TYPE]: "review",
  [JP_PIPELINE_VIEW_TYPE]: "capture",
};

/** Label for each surface's own command, so a hotkey (and therefore a
 *  driver-mapped Elecom/Logi button) can reach it. */
/** Bar order — what a two-finger swipe steps along. */
const SURFACE_ORDER: Surface[] = ["lexicon", "dict", "x", "tray", "review", "capture"];

const SURFACE_COMMANDS: { id: Surface; name: string }[] = [
  { id: "lexicon", name: "語彙" },
  { id: "dict", name: "辞書" },
  { id: "x", name: "𝕏 検索" },
  { id: "tray", name: "トレイ" },
  { id: "review", name: "復習" },
  { id: "capture", name: "⚡ 取り込み" },
];

export default class JPCollocationsPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  store!: CollocationStore;
  engine!: SearchEngine;
  private scraper: HyogenScraper | null = null;
  private twcScraper: TsukubaWebCorpusScraper | null = null;

  /** Dictionary store for imported Yomitan dictionaries */
  dictStore!: DictionaryStore;
  reconLibrary!: ReconLibrary;
  patternStore!: PatternStore;
  /** 🔴 training data: labeled discourse examples from classify-captures (DESIGN §13.2). */
  goldStore!: DiscourseGoldStore;
  /** SRS review state for the catalog deck (pattern = card unit). */
  srsStore!: SrsStore;
  /** §6.5 — the ONE place every human ✓/✕ lands, whatever surface made it. */
  ratifyStore!: RatifyStore;
  /** 談話モード per-file segmentation (human-ratified turns/speakers). */
  private discourseSeg: Record<string, FileSeg> = {};
  /** §23.4-5 gold v2 layer-3: the drawn arrows (→/↳/↧) per transcript. */
  private discourseRel: Record<string, FileRel> = {};
  /** §23.4-6 gold v2 layer-4: plural lens-tagged readings per transcript. */
  private discourseReadings: Record<string, FileReadings> = {};
  /** §23.3 gold v2 layer-2: every component pill accept/reject, keyed
   *  file|componentKey. Grows from ordinary 談話モード use. */
  private componentGold: Record<string, ComponentVerdict & { at: number }> = {};

  /** Growing, offline-searchable corpus of scraped tweets (the X dictionary). */
  xCorpus!: XCorpusStore;
  /** Scraper for X's GraphQL SearchTimeline (cookie-authenticated). */
  private xClient!: XClient;

  /** Bridge for jp-sentence-surfer- integration */
  private surferBridge!: SurferBridge;

  /** Context engine — the hivemind connecting all data sources */
  contextEngine!: ContextEngine;

  /** The one owner of the plugin-data blob (AUDIT §1) — every store persists
   *  through this; loadData/saveData are never called after onload. */
  private dm!: DataManager;

  /** 収集トレイ (§22.8) — the drag-drop inbox. */
  private inboxStore!: InboxStore;
  private holdStore!: HoldStore;
  private holdDock!: HoldDock;
  private dictHistory!: DictHistoryStore;
  /** 現在線 — when the tray was last stood in front of. */
  private trayVisitAt = 0;
  /** §27.5 — the converted big dictionaries (vault sidecars, async lookup). */
  private bigDict!: BigDictStore;
  /**
   * Which dictionary conversion is running, if any. Two conversions write the
   * SAME shard folders, and the backup pass resets a dictionary on its first
   * batch — so starting the zip conversion while the backup pass is live can
   * delete the other's finished output mid-write. One at a time, and the
   * refusal says what is already running.
   */
  private conversionRunning: string | null = null;
  /** §27.0.2 — the open wants: what you are reaching for but cannot yet say. */
  private reachStore!: ReachStore;
  /** §25.5 発話セッション record (`_speakSessions`). */
  private speakStore!: SpeakStore;

  /** Shared sidecar-aware relations resolver — initialised in onload(). */
  private relationsResolver!: RelationsResolver;
  /** sweepTerms() memo, keyed by pattern id. Cleared whenever the catalog is
   *  written, so a retyped/edited pattern never serves a stale term list. */
  private sweepTermsCache = new Map<string, string[]>();
  /** Status-bar item showing sidecar coverage for the current session. */
  private sidecarStatusEl: HTMLElement | null = null;

  /**
   * Where the sharded dictionaries actually live, resolved once at load.
   *
   * Measured 2026-08-06: the shelf is 51,016 shard files in a vault holding
   * 636 notes. Obsidian registers and watches every file it can see, so the
   * folder is best named with a leading dot — Obsidian skips those entirely,
   * while `vault.adapter` (which is the ONLY way this plugin touches the
   * shelf, `getResourcePath` for dictionary media included) reads them exactly
   * as before.
   *
   * This is resolved rather than configured because the setting rides in the
   * synced blob while the FOLDER may or may not have travelled with it. A
   * device that has `JP Dictionaries` and a device that has `.JP Dictionaries`
   * must both work off one synced setting, so whichever is actually on disk
   * wins. See `resolveBigDictRoot`.
   */
  private bigDictRoot = "JP Dictionaries";

  /** Where you have been, newest last. See `src/ui/suite-nav.ts` — the rules
   *  that keep this a stack rather than a log live there and are golden-tested. */
  private navStack: Place[] = [];

  /** Touchpad reducer state. See `ui/input-map.ts` for why it needs any. */
  private gesture: GestureState = idleGesture();
  /** Live text scale for the plugin's surfaces, 0–4. Persisted. */
  private density = DENSITY_DEFAULT;

  async onload(): Promise<void> {
    // Publish the 6-class taxonomy into CSS (--jp-cls-*) before any view renders,
    // so a stylesheet rule and a JS-built element cannot disagree about what a
    // class color is. NOTE_TYPES stays the single source; this is its only exit.
    injectClassGrammar(document);

    // ── Canonical blob: one owner, serialized debounced writes, .bak ──
    const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/jp-collocations`;
    const blobIO: BlobFileIO = {
      read: async (p) => (await this.app.vault.adapter.exists(p)) ? this.app.vault.adapter.read(p) : null,
      write: (p, text) => this.app.vault.adapter.write(p, text),
      remove: async (p) => { if (await this.app.vault.adapter.exists(p)) await this.app.vault.adapter.remove(p); },
    };
    // Heavy store keys get their own file. Measured 2026-08-06 on the live
    // vault: data.json was 15.17MB and EVERY debounced save rewrote all of it
    // twice (bak + main). Marking one card cost ~30MB of IO — invisible on a
    // desktop NVMe, seconds of main-thread stall in Obsidian for iPadOS.
    this.dm = new DataManager(
      blobIO,
      normalizePath(`${pluginDir}/data.json`),
      normalizePath(`${pluginDir}/data.json.bak`),
      800,
      { dir: normalizePath(pluginDir) },
    );
    const loadRes = await this.dm.load();
    if (loadRes.restoredFromBackup) new Notice("jp-collocations: data.json が破損 — バックアップから復元しました");
    else if (loadRes.corrupt) new Notice("jp-collocations: data.json が破損、バックアップなし — 空の状態で開始します");
    // A partition the manifest promised and no file could supply. The store
    // will start from its default; that default must NEVER be written back
    // over the missing file, so DataManager refuses those writes and we say so
    // rather than letting the session look healthy (§28 S6).
    if (loadRes.missingPartitions.length) {
      new Notice(
        `jp-collocations: データ分割ファイルが見つかりません — ${loadRes.missingPartitions.join(", ")}\n`
        + `該当ストアは書き込みを拒否します（空の状態で上書きしないため）。`,
        0,
      );
    }

    // one-time migrations, in ONE write: derived indexes out of the blob
    // (99.5% of the historical 62MB); secrets out of the synced file into
    // device-local storage. When secrets were extracted, realign .bak too —
    // the rolling backup is one generation behind and would otherwise keep
    // the secret-bearing version alive in a synced file.
    let secretsExtracted = false;
    const migrated = this.dm.mutate((blob) => {
      const strippedIndexes = stripDerivedIndexes(blob);
      const { changed, secrets } = extractSecrets(blob);
      for (const [field, lsKey] of Object.entries(SECRET_LS_KEYS)) {
        const v = secrets[field as keyof typeof secrets];
        if (v && !this.app.loadLocalStorage(lsKey)) this.app.saveLocalStorage(lsKey, v);
      }
      secretsExtracted = changed;
      return strippedIndexes || changed;
    });
    void migrated.then(() => { if (secretsExtracted) return this.dm.alignBackup(); });
    // Split the heavy keys out NOW, at load, rather than under the user's
    // first tap. No-op once the layout is already right. The main file's
    // rolling .bak catches the whole pre-split blob on this first write, so
    // the previous single-file shape survives one generation.
    void this.dm.repartition();
    // the yt-dlp cookie jar used to live inside the vault (synced) — remove it;
    // it regenerates at its new device-local home on next use
    for (const legacy of ["_yt_cookies.txt", "_yt_cookies.txt.meta"]) {
      void this.app.vault.adapter.remove(normalizePath(`${pluginDir}/${legacy}`)).catch(() => {});
    }

    this.loadSettings();

    /**
     * §26.3 — establish the posture before anything renders.
     *
     * The body classes decide fingertip sizing for the whole stylesheet, so
     * they have to be on before the first view paints or the first frame is
     * laid out at desktop dimensions and reflows. `watchForPen` latches the
     * first stylus event anywhere in the app; `penNativeDrag` is a measurement
     * the drag layer makes during real use and hands back here so it survives
     * a reload instead of being relearned every launch.
     */
    configurePosture({
      hand: this.settings.posture.hand,
      override: this.settings.posture.override,
      penNativeDrag: this.settings.posture.penNativeDrag,
      ...(this.settings.posture.touchNativeDrag
        ? { touchNativeDrag: this.settings.posture.touchNativeDrag }
        : {}),
      onDragVerdict: (pointer, v) => {
        const key = pointer === 'pen' ? 'penNativeDrag' : 'touchNativeDrag';
        if (this.settings.posture[key] === v) return;
        this.settings.posture[key] = v;
        void this.saveSettings();
      },
      ...(this.settings.posture.rail ? { rail: this.settings.posture.rail } : {}),
      onRail: (r) => {
        this.settings.posture.rail = { ...r };
        void this.saveSettings();
      },
    });
    applyPostureClasses();
    // Restore the text scale before the first surface paints, or it lays out at
    // 1× and then jumps.
    this.density = clampDensity(this.settings.posture?.density ?? DENSITY_DEFAULT);
    this.applyDensity();
    this.register(watchForPen());

    const stored = this.dm.snapshot() as Record<string, any>;

    // ── Surfer Bridge Init ───────────────────────────────────
    this.surferBridge = new SurferBridge((data) => this.dm.setKey("_surferBridge", data), this.app);
    if (stored._surferBridge) {
      this.surferBridge.load(stored._surferBridge);
    } else if (stored._surferEntries) {
      // Backward compat: migrate from old format
      this.surferBridge.load({ entries: stored._surferEntries });
    }
    // Discourse/KWIC indexes are memory-only now: rebuild from vault text in
    // the idle-batched background pass (quietly — this is routine, not an event).
    if (this.surferBridge.needsReindex) {
      this.app.workspace.onLayoutReady(() => this.backgroundIndexVault());
    }

    // ── Auto-index on file open (200ms debounce) ─────────────
    //
    // THE TAB LAG.
    //
    // `active-leaf-change` fires for every leaf, including one plugin surface
    // to another — and `getActiveFile()` keeps returning the last markdown file
    // while a plugin view is focused. So moving 辞書 → 語彙 → 𝕏 re-read, re-
    // cleaned and re-`detectPatterns`'d the same note each time, rebuilt both
    // pattern indexes, re-read the sidecar off disk, and scheduled a write —
    // all on the main thread, all to produce byte-for-byte what was already in
    // memory. On an iPad that is the entire felt cost of switching tabs.
    //
    // Nothing about a file changes because you looked at a different pane. The
    // guard is therefore identity, not throttling: same path, same mtime, same
    // content — so there is nothing to recompute and we do not. Editing the
    // note bumps `mtime` and the next leaf change indexes it normally.
    let indexTimer: ReturnType<typeof setTimeout> | null = null;
    let indexedAt: { path: string; mtime: number } | null = null;
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
        if (indexTimer) clearTimeout(indexTimer);
        indexTimer = setTimeout(() => {
          if (!leaf) return;
          const file = this.app.workspace.getActiveFile();
          if (!file || file.extension !== 'md') return;
          const mtime = file.stat?.mtime ?? 0;
          if (indexedAt && indexedAt.path === file.path && indexedAt.mtime === mtime) return;
          indexedAt = { path: file.path, mtime };
          this.app.vault.cachedRead(file).then(content => {
            void this.surferBridge.indexFileWithSidecar(file.path, content);
          });
        }, 200);
      })
    );

    // Data store
    const dataPath = `${this.app.vault.configDir}/plugins/jp-collocations/${this.settings.dataFilePath}`;
    this.store = new CollocationStore(this.app, dataPath);
    await this.store.load();

    // Search engine
    this.engine = new SearchEngine(this.store);

    // ── Dictionary Store Init ────────────────────────────────
    this.dictStore = new DictionaryStore(this.app, (data) => this.dm.setKey("_dictStore", data));
    if (stored._dictStore) {
      this.dictStore.loadFromData(stored._dictStore);
    }

    // ── Reconciliation library (anchored callout index) ──────
    this.reconLibrary = new ReconLibrary(() => this.dm.setKey("_reconLibrary", this.reconLibrary.toData()));
    if (stored._reconLibrary) this.reconLibrary.loadFromData(stored._reconLibrary);

    // ── Pattern lexicon (the catalog the noticings accumulate into) ──
    // Every persist also refreshes the vault-native mirror (files-over-app:
    // the corpus survives the plugin; see writeMirror / DESIGN §19).
    this.patternStore = new PatternStore((data) => {
      // Every catalog write invalidates the sweepTerms memo — one place, so a
      // new write path can never forget and serve stale terms.
      this.sweepTermsCache.clear();
      this.scheduleMirror();
      return this.dm.setKey("_patternStore", data);
    });
    this.patternStore.load(stored?._patternStore);
    // one-time migration: fold every existing library anchor into the catalog.
    // Gate on "never persisted", NOT on size 0 — a user who deletes their last
    // pattern must not have all of them resurrected on the next reload.
    if (!stored?._patternStore && this.reconLibrary.all().length) {
      void this.patternStore.recordMany(this.reconLibrary.all().map((e) => ({
        note: e.note,
        att: e.anchorId ? {
          source: "yt" as const, file: e.file, tStartSec: e.tStartSec,
          blockId: e.blockId, anchorId: e.anchorId, quote: e.reconciled, addedAt: Date.now(),
        } : null,
      })));
    }

    // ── Discourse gold store (🔴 training data from classify-captures) ──
    this.goldStore = new DiscourseGoldStore((data) => {
      this.scheduleMirror();
      return this.dm.setKey("_discourseGold", data);
    });
    this.goldStore.load(stored?._discourseGold);
    // initial mirror once the workspace is up (idempotent: unchanged files
    // are not rewritten, so routine startups write nothing)
    this.app.workspace.onLayoutReady(() => this.scheduleMirror());

    // ── SRS deck (review state over the pattern catalog) ──
    this.srsStore = new SrsStore((data) => this.dm.setKey("_srsDeck", data));
    this.srsStore.load(stored?._srsDeck);

    // ── the ratification ledger (§6.5): one row per human judgement, whatever
    //    surface produced it. Starts empty by design — see ratify-store.ts.
    this.ratifyStore = new RatifyStore((data) => this.dm.setKey("_ratifications", data));
    this.ratifyStore.load((stored as { _ratifications?: RatifyData } | undefined)?._ratifications);

    // ── 談話モード segmentation (human-ratified turn breaks/speakers = the
    //    training corpus the over-segmenting speaker detection lacks) ──
    this.discourseSeg = stored?._discourseSeg ?? {};
    // layer-2 component gold (§23.3): pill verdicts, one record per suggestion
    this.componentGold = stored?._componentGold ?? {};
    // layer-3 gold (§23.4-5): human-drawn arrows between turns
    this.discourseRel = stored?._discourseRel ?? {};
    // layer-4 gold (§23.4-6): plural lens-tagged readings — human-only
    this.discourseReadings = stored?._readingsGold ?? {};

    // ── 収集トレイ (§22.8): the drag-drop inbox — quarantine, never loss ──
    this.inboxStore = new InboxStore((data) => this.dm.setKey("_inbox", data));
    this.inboxStore.load(stored?._inbox);

    // ── the hold (PHYSICS Move 1, 掴む・運ぶ・置く): specimens in hand ──
    // Persisted because NOTHING IS EVER MID-AIR: a chip held when Obsidian
    // closed is still held when it reopens. Body-mounted dock, so the carry
    // survives every view switch by construction (the Calendar grammar).
    this.holdStore = new HoldStore((data) => this.dm.setKey("_hold", data), this.holdKnobs());
    this.holdStore.load(stored?._hold);

    // ── the 辞書's dated history (§30 nav grammar): a lookup is a fact about
    // your study and facts survive restarts — Monokakido's counter read
    // 1,251; the session array died with every reload.
    this.dictHistory = new DictHistoryStore((data) => this.dm.setKey("_dictHistory", data));
    this.dictHistory.load((stored as { _dictHistory?: unknown } | undefined)?._dictHistory);
    this.holdDock = new HoldDock({
      chips: () => this.holdStore.all(),
      knobs: () => this.holdKnobs(),
      toTray: (chip) => void this.landHeldChip(chip),
      classify: (chip) => {
        // The chip stays held while the modal is open — a cancelled modal
        // must not have consumed the specimen (law 1). Toss or ✕ afterwards.
        new CaptureModal(this.app, {
          text: chip.text,
          example: chip.sentence,
          source: {
            kind: chip.surface === "x" ? "x" : "manual",
            // medium only where the surface IS the medium — a grab from a
            // transcript view filed as 'note' would be fabricated provenance,
            // the §28 S2 seam (2026-08-20 review). Absent is honest.
            ...(chip.surface === "x" ? { medium: "x" as const }
              : chip.surface === "dict" ? { medium: "dict" as const } : {}),
            sourceName: `掴み・${chip.surface}`,
          },
        }, this.makeCaptureDeps()).open();
      },
      // The chip's SCENE rides into the dictionary too: the sentence it was
      // grabbed with lands lit in the tan band (辞書 arrival grammar).
      lookup: (chip) => void this.openDictionaryView(chip.text, { light: chip.sentence }),
      discard: (chip) => { this.holdStore.release(chip.id); this.holdDock.render(); },
      // 鋳造 (§2.3) — the twin seats beside its sibling; a cap overflow still
      // lands in the tray, never the void (law 1).
      mint: (chip) => {
        const r = this.holdStore.mint(chip.id);
        if (r?.evicted) void this.landHeldChip(r.evicted, /*rerender*/ false);
        this.holdDock.render();
      },
    });
    this.holdDock.mount();

    // §27.0.2 — the plugin holds what you have caught; this holds what you are
    // still REACHING FOR. Tiny (a sentence and a few offers), so unlike the
    // dictionaries it genuinely belongs in the blob.
    // §27.5 READ side: the converted sidecars, discovered from the vault
    // folders. Construction is free — nothing is read until first query.
    this.bigDictRoot = await resolveBigDictRoot(
      (p) => this.app.vault.adapter.exists(normalizePath(p)),
      this.settings.bigDict?.root || "JP Dictionaries",
    );
    this.bigDict = new BigDictStore(
      vaultSidecarIO(this.app),
      this.bigDictRoot,
      // One query reads one shard per installed dictionary (31 here), so the
      // cache has to span a whole query or nothing is ever reused. Phones get
      // a third of the budget.
      { cacheBytes: (Platform.isMobile ? 8 : 24) * 1024 * 1024 },
    );

    this.reachStore = new ReachStore((data) => this.dm.setKey("_reaches", data));
    this.reachStore.load((stored as { _reaches?: ReachData } | undefined)?._reaches);
    // 現在線 (§2.5) — the tray's reading position, one number in the blob.
    this.trayVisitAt = Number((stored as { _trayVisit?: unknown } | undefined)?._trayVisit) || 0;
    this.registerView(JP_TRAY_VIEW_TYPE, (leaf) => new TrayView(leaf, {
      store: this.inboxStore,
      lastVisit: () => this.trayVisitAt,
      markVisit: (t) => { this.trayVisitAt = t; void this.dm.setKey("_trayVisit", t); },
      // §30 — the front door. Every road that used to require knowing which of
      // 60 palette entries matched the medium in your hand.
      doors: () => this.trayDoors(),
      openCapture: (ctx) => new CaptureModal(this.app, ctx, this.makeCaptureDeps()).open(),
      saveImage: (name, data) => this.saveInboxImage(name, data),
      // §22.2 manga: spread-aware bubble OCR (pinned model, bbox-validated)
      ocrManga: this.settings.notes.ocrApiKey ? (vaultPath) => this.ocrMangaImage(vaultPath) : undefined,
      // §25.3: a player screenshot becomes a precise podcast mark
      recognizePlayer: this.settings.notes.ocrApiKey
        ? (card) => this.recognizePlayerShot(card)
        : undefined,
      // §25.1 harvest: a mark re-manifests its transcript moment
      resolveMarkContext: (mark) => this.resolveMarkContext(mark),
      // §25.4: and can still have its scene cut, long after the watch ended
      clipForMark: Platform.isDesktopApp ? (card) => this.cutClipForMarkCard(card) : undefined,
      setMarkNote: async (id: string, text: string) => { await this.inboxStore.setMarkNote(id, text); },
      // §28 S1: a dropped phrase you have already noticed says so —
      // patternsIn/openPattern now arrive via peekChrome() below, one wiring
      // for every echo-armed surface (items 12–13).
      // §27.0.2 — the holes, held beside the stream that might fill them
      reaches: () => this.reachStore.all(),
      openReach: () => new ReachModal(this.app, async (want, gloss) => {
        await this.reachStore.add(want, Date.now(), gloss);
        this.refreshTrayViews();
      }).open(),
      onRecognize: async (id, i) => {
        const r = await this.reachStore.recognizeOffer(id, i, Date.now());
        if (r?.filled) new Notice(`「${r.want}」 → 「${r.filled.surface}」`, 8000);
      },
      onRejectOffer: async (id, i) => { await this.reachStore.rejectOffer(id, i); },
      onAbandonReach: async (id) => { await this.reachStore.abandonReach(id, Date.now()); },
      onDrop: (intent, files) => void this.runDropIntent(intent, files),
      dropCan: () => this.dropCapabilities(),
      openSurface: (s) => void this.openSurface(s),
      dismiss: () => void this.navBack(),
      ...this.peekChrome(),
      surfaceBadge: (s) => this.surfaceBadge(s),
    }));

    // ── 発話セッション store + 鑑賞モード view (§25.2/§25.5) ──
    this.speakStore = new SpeakStore((data) => this.dm.setKey("_speakSessions", data));
    this.speakStore.load(stored?._speakSessions);
    this.registerView(JP_FOLLOW_VIEW_TYPE, (leaf) => new FollowAlongView(leaf, {
      parse: parseTranscriptLines,
      // 鑑賞モード has no identity bar — a navigator across the top of the thing
      // you are watching is chrome over the content — so it had no way out at
      // all. The edge drag is its only exit, and it has to be wired here.
      dismiss: () => void this.navBack(),
      backPeek: () => this.navPeek(),
      // This view wires its chrome by hand, so it does not get `peekChrome()`'s
      // bundle — and the drop road it DOES arm was therefore the only one in
      // the plugin running without an oracle, falling back to the guess
      // `resource-url.ts` exists to replace.
      inVault: (c) => this.resolveVaultPath(c),
      // §6.5 — the 予測 answer the panel used to discard on close.
      recordDrill: (scope, caseId, claim, picked) => {
        void this.ratifyStore.record(drillRow(scope, caseId, claim, picked, Date.now()));
      },
      // Returns the tray card id so 鑑賞モード can write a clip back onto the
      // very card the mark became, instead of holding it only in memory.
      addTrayMark: async (m) => {
        // Resolve the line AT MARK TIME. A mark used to store only where and
        // when, so the tray showed 98 identical 「（メモなし）」 rows and none of
        // them were ever harvested — you could not tell them apart without
        // opening the capture modal on each one to find out what you had
        // flagged. The transcript is already open and parsed at this exact
        // moment, so this is the cheapest it will ever be; `TrayView`'s
        // backfill exists only for the marks made before this line did.
        // A failure here must never cost you the mark itself.
        let lineText: string | undefined;
        try {
          const ctx = await this.resolveMarkContext(m);
          lineText = (ctx?.example ?? '').trim();
        } catch { /* the mark is worth more than its caption */ }
        const card = markCard(lineText === undefined ? m : { ...m, lineText }, Date.now());
        await this.inboxStore.add(card);
        this.refreshTrayViews();
        return card.id;
      },
      marksForFile: (path) => this.inboxStore.marksForFile(path ?? undefined).map((c) => ({
        cardId: c.id,
        tSec: c.mark?.tSec ?? null,
        lineIndex: null,
        lineText: '',
        seed: c.content ?? c.mark?.seed ?? null,
        at: c.createdAt,
        ...(c.clip ? { clip: c.clip } : {}),
      })),
      attachMarkClip: (cardId, clip) =>
        this.inboxStore.setMarkClip(cardId, clip).then(() => { this.refreshTrayViews(); }),
      setMarkNote: (cardId, text) =>
        this.inboxStore.setMarkNote(cardId, text).then(() => { this.refreshTrayViews(); }),
      speak: this.speakStore,
      aspects: () => this.settings.speak.aspects,
      goalPoints: () => this.settings.speak.goalPoints,
      // §26.3 — the Pencil's own verb: hold the nib over a word in a subtitle
      // and the dictionary answers without a tap, a pause, or losing the line.
      dictLookup: (q) => this.dictStore.lookup(q),
      // §25.4 — writing a note stops the show; closing it starts it again.
      autoPauseOnWrite: () => this.settings.posture.autoPauseOnWrite,
      openCapture: (ctx) => new CaptureModal(this.app, ctx, this.makeCaptureDeps()).open(),
      mediumOf: (file) => {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        const src = String(fm.source ?? "");
        const medium = (["podcast", "tv", "book", "note", "manga"].includes(src) ? src : "yt") as MarkRef["medium"];
        return { medium, sourceName: fm.show ?? fm.title ?? undefined };
      },
      // §25.4 Plex clock (b) + clips — dormant until baseUrl + token are set.
      plexEnabled: () => !!(this.settings.plex.baseUrl.trim() && this.settings.plex.token.trim()),
      plexPoll: () => this.fetchPlexSessions(),
      plexClip: (partKey, atSec, label) => this.cutPlexClip(partKey, atSec, label),
      /**
       * §25.4 — which Plex item this note was cut from, straight off its own
       * frontmatter. The 🎬 cutter needs a Part key and nothing else; reading it
       * here means clips exist for any note that has one, rather than only while
       * a poll happens to be running.
       */
      plexIdentity: (file) => {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        return {
          partKey: fm.plex_part_key ? String(fm.plex_part_key) : null,
          ratingKey: fm.plex_rating_key ? String(fm.plex_rating_key) : null,
        };
      },
      // §25.4c — relay a transport command to the client playing the session.
      plexCommand: (targetId, command, params) => this.plexControl(targetId, command, params),
      // §25.4b: a fetched subtitle can be shifted from the video it belongs
      // to. The offset lives in the note, not in memory, so the correction
      // survives closing the view — and is visible/editable as plain YAML.
      subOffset: (file) => {
        const v = this.app.metadataCache.getFileCache(file)?.frontmatter?.sub_offset_sec;
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : 0;
      },
      saveSubOffset: async (path, sec) => {
        const f = this.app.vault.getFileByPath(path);
        if (!f) return;
        await this.app.fileManager.processFrontMatter(f, (fm) => {
          fm.sub_offset_sec = Math.round(sec * 10) / 10;
        });
      },
      onDrop: (intent, files) => void this.runDropIntent(intent, files),
      dropCan: () => this.dropCapabilities(),
    }));

    // ── X Search corpus + client ─────────────────────────────
    this.xCorpus = new XCorpusStore((data) => this.dm.setKey("_xCorpus", data));
    if (stored._xCorpus) this.xCorpus.loadFromData(stored._xCorpus);
    this.xClient = new XClient(() => this.settings.x);

    // ── Context Engine Init ─────────────────────────────────
    // xCorpus is passed so the unified context card surfaces real X usage.
    this.contextEngine = new ContextEngine(
      this.app,
      this.dictStore,
      this.store,
      this.surferBridge,
      this.xCorpus,
      // §22.7 — the frozen 語法 profiles, so a lookup anywhere in the plugin
      // reaches the corpus sentences instead of only the 語彙 panel's own box.
      this.patternStore,
    );

    // Register views
    this.registerView(JP_COLLOCATIONS_VIEW_TYPE, leaf =>
      this.withChrome(new CollocationView(leaf, this.store, this.engine, this.settings, this.contextEngine, this.dictStore, {
        patterns: () => this.patternStore.all(),
        collocations: () => this.store.getAll(),
        dictLookup: (q) => this.dictStore.lookup(q),
        resolveClip: (att) => this.resolveAttestationClip(att),
        openAttestation: (att) => this.openAttestation(att),
        onReclassify: (p) => this.openCaptureForPattern(p),
        setClass: (id, cls) => this.patternStore.setClass(id, cls),
        deletePattern: (id) => this.patternStore.remove(id),
        openDict: (word) => this.openDictionaryView(word),
        ratifyAttestation: (id, att) => this.patternStore.ratifyAttestation(id, attestationKey(att)),
        rejectAttestation: (id, att) => this.patternStore.rejectAttestation(id, attestationKey(att)),
        parseLines: (md) => parseTranscriptLines(stripAnchors(md)),
        loadSeg: (path) => this.discourseSeg[path] ?? null,
        // §22.2 manga context: neighbor bubbles live on the OCR'd tray card
        bubblesFor: (img) => this.inboxStore.all().find((c) => c.kind === "image" && c.content === img)?.bubbles ?? null,
        // §29 the drag road — one executor, the panel supplies only `where`
        onDrop: (intent, files, where) => void this.runDropIntent(intent, files, where),
        dropCan: () => this.dropCapabilities(),
        // §29.2 — the 𝕏 corpus, answered inside the entry
        xUsage: (p) => this.xUsageFor(p),
        openUrl: (url) => window.open(url, "_blank"),
        attachXLine: (p, quote, url, handle) => void this.attachXLine(p, quote, url, handle),
        findExamples: (p) => this.findExamplesFor(p),
        searchXFor: (p) => this.openXView(sweepTerms(p).map((t) => `"${t}"`).join(" ") || p.key),
        generateScaffold: this.settings.notes.ocrApiKey ? (p) => this.generateScaffoldFor(p) : undefined,
        // §22.7: per-entry corpus enrichment — every enabled adapter answers
        // for THIS key, results merged, fetched once and frozen
        // §22.7 — the 語法プロフィール: how this word attaches, and what
        // attaches that way. Hyogen is the corpus adapter (no 利用規約, no 転載
        // restriction, 青空文庫-derived); its structured profile carries the
        // direction / sense / POS / particle-facet grammar that the old flat
        // `collocates: string[]` threw away.
        // §22.7 drill-down: the index says HOW the word attaches; these two open
        // one way, and then one collocation inside it. Each freezes what it
        // finds through `extendGoho`, which is fill-only — so the profile gets
        // deeper where you look without anything already recorded being
        // rewritten (§2.4 survives; only coverage grows).
        drillPattern: this.settings.twcEnabled ? async (p, patternId) => {
          const pat = p.payload.goho?.index?.find((t) => t.id === patternId);
          if (!pat) return false;
          const word = p.payload.lemma ?? p.key;
          const progress = new Notice(`語法: ${pat.name} を取得中…`, 0);
          try {
            const twc = new TsukubaWebCorpusScraper(this.app, this.store, {
              rateLimit: this.settings.twcRateLimit,
              onProgress: (msg) => progress.setMessage(`語法: ${msg}`),
            });
            const senses = await twc.resolve(word);
            if (!senses[0]) { new Notice(`語法: 「${word}」は TWC の見出し語にありません`, 5000); return false; }
            await sleep(this.settings.twcRateLimit);
            const frame = await twc.drillPattern(senses[0].id, {
              id: pat.id, name: pat.name, freq: pat.freq, share: pat.share, category: pat.category,
            });
            if (!frame) { new Notice(`語法: ${pat.name} は共起語が返りませんでした`, 5000); return false; }
            const ok = await this.patternStore.extendGoho(p.id, { frame });
            if (ok) new Notice(`${pat.name}: ${frame.total.toLocaleString()}種類のうち ${frame.items.length}件を展開`, 5000);
            return ok;
          } catch (e) {
            new Notice(`語法の取得に失敗: ${e instanceof Error ? e.message : String(e)}`, 8000);
            return false;
          } finally { progress.hide(); }
        } : undefined,

        drillExamples: this.settings.twcEnabled ? async (p, frameLabel, colloc) => {
          const word = p.payload.lemma ?? p.key;
          const progress = new Notice(`用例: 「${colloc.text}」を取得中…`, 0);
          try {
            const twc = new TsukubaWebCorpusScraper(this.app, this.store, {
              rateLimit: this.settings.twcRateLimit,
              onProgress: (msg) => progress.setMessage(msg),
            });
            const senses = await twc.resolve(word);
            if (!senses[0]) return false;
            await sleep(this.settings.twcRateLimit);
            const rows = await twc.drillExamples(senses[0].id, colloc, frameLabel);
            const ok = await this.patternStore.extendGoho(p.id, {
              examples: rows.map((e) => ({
                text: e.text, source: e.source, url: e.url, span: e.span, ref: e.ref,
                kind: 'attested' as const, frame: e.frame, collocate: e.collocate,
              })),
            });
            new Notice(ok
              ? `「${colloc.text}」の用例 ${rows.length}件を取り込みました（全${colloc.freq.toLocaleString()}件中）`
              : `「${colloc.text}」の用例は取得済みです`, 5000);
            return ok;
          } catch (e) {
            new Notice(`用例の取得に失敗: ${e instanceof Error ? e.message : String(e)}`, 8000);
            return false;
          } finally { progress.hide(); }
        } : undefined,

        fetchGoho: (this.settings.hyogenEnabled || this.settings.twcEnabled)
          ? (p) => this.freezeGoho(p)
          : undefined,
        captureCorpus: (p, example, prov, colloc) => {
          // §28 S2 — when the corpus told us which document a sentence came
          // from, that is the provenance, not the adapter's name. "corpus" as a
          // sourceName is what we fall back to, never what we prefer.
          //
          // Two different things arrive here. A 用例 row is a SENTENCE: the
          // headword is the 見出し and the sentence is its attestation. A
          // 語法プロフィール row is a COLLOCATION — 「クーラーの風」 — and it
          // used to come down the sentence road, which filed the headword as
          // the 見出し and demoted the pair to an example. The pair is the
          // whole content of a 連語, so that road could never produce one;
          // 🔵 has zero entries ever recorded (PRINCIPLE-2026-08-05) and this
          // is the mechanism. Now the pair IS the capture, 🔵 is the offered
          // class (a hint, never a verdict — the hand still taps), and the
          // frame it attaches by rides as provenance.
          //
          // Deliberately NOT carried: freq / MI / logDice. There is no payload
          // field for association measures and inventing one here would be a
          // schema change without a golden. The row still shows them, and the
          // frozen goho profile still holds them on the headword's entry.
          new CaptureModal(this.app, {
            text: colloc?.surface ?? p.key,
            example: colloc ? undefined : example,
            classHint: colloc ? "collocation" : undefined,
            source: {
              kind: "web", medium: "corpus",
              sourceName: prov?.sourceName ?? p.payload.goho?.source ?? "corpus",
              loc: prov?.url ?? (colloc?.frame ? `${p.key} — ${colloc.frame}` : p.key),
            },
          }, this.makeCaptureDeps()).open();
        },
        // §27.5 — the vault sidecars, queried asynchronously. Both halves:
        // lookup answers "what does this mean", frame answers "what do I reach
        // for", and the panel keeps them visibly separate because they are.
        bigDict: {
          lookup: (q, limit) => this.bigDict.lookup(q, limit),
          frame: (f, limit) => this.bigDict.frame(f, limit),
        },
        // §27.6 — a curated candidate IS a catalog object at the curated
        // stratum, so capturing one goes down the SAME road as everything else
        // (§28 S5), with the shape-derived class as a suggestion only.
        onCaptureCandidate: (surface, intention, cls, dictionary) => {
          new CaptureModal(this.app, {
            text: surface,
            example: intention,
            classHint: cls,
            source: { kind: "manual", medium: "dict", sourceName: dictionary, loc: intention },
          }, this.makeCaptureDeps()).open();
        },
      }))
    );
    this.registerView(JP_DICTIONARY_VIEW_TYPE, leaf =>
      this.withCatalogHits(new DictionaryView(leaf, this.dictStore, async () => {
        await this.dictStore.save();
        this.refreshDictionaryViews();
      }, (expression, reading, example) => {
        this.saveEntryFromDict(expression, reading, example);
      }, this.contextEngine, (expression, example, dictMeta) => {
        new CaptureModal(this.app, {
          text: expression,
          example,
          // §22.5: a dictionary capture is CURATED stratum — medium 'dict',
          // the entry as the scene address (door back into the dictionary)
          source: dictMeta
            ? { kind: "manual", medium: "dict", sourceName: dictMeta.dict, loc: dictMeta.headword }
            : { kind: "manual" },
        }, this.makeCaptureDeps()).open();
      }))
    );
    this.registerView(JP_X_VIEW_TYPE, leaf => new XSearchView(leaf, this.makeXDeps()));
    this.registerView(JP_RECON_LIBRARY_VIEW_TYPE, leaf => new LibraryView(leaf, {
      library: this.reconLibrary,
      onRetype: (entry, cls) => this.retypeReconNote(entry, cls),
      openBlock: (entry) => this.app.workspace.openLinkText(`${entry.file}#^${entry.anchorId ?? entry.blockId}`, "", false).then(() => undefined),
      resolveClip: (entry) => this.resolveEntryClip(entry),
      parseLines: (md) => parseTranscriptLines(stripAnchors(md)),
      loadSeg: (path) => this.discourseSeg[path] ?? null,
      patterns: () => this.patternStore.all(),
      onPatternClass: (id, cls) => this.patternStore.setClass(id, cls),
      onPatternDelete: (id) => this.patternStore.remove(id),
      openAttestation: (att) => this.openAttestation(att),
      onXJoin: (p) => this.xJoinPattern(p),
      onSweep: () => this.sweepCatalog(),
      onApprove: (entry) => this.approveEntry(entry),
      onRetry: (entry, newNote) => this.retryEntry(entry, newNote),
      onSetStatus: (entry, status) => { this.reconLibrary.setStatus(entry.blockId, status); this.refreshReconLibrary(); },
      goldInfo: () => this.goldInfo(),
    }));

    // ── SRS review view ──
    this.registerView(JP_REVIEW_VIEW_TYPE, leaf => new ReviewView(leaf, {
      srs: this.srsStore,
      patterns: () => this.patternStore.all(),
      goldFor: (patternId) => this.goldStore.all().find((g) => g.patternId === patternId) ?? null,
      resolveClip: (att) => this.resolveAttestationClip(att),
      openAttestation: (att) => this.openAttestation(att),
      newPerSession: () => this.settings.srsNewPerSession ?? 20,
      // §6.5 — one judgement per graded card, on the pattern just studied;
      // falling back to the best claim the deck cannot reach (see bestClaimProbe).
      nextProbe: (p, seq) => {
        const data = this.ratifyStore.data();
        return nextProbe(p, data, { seq }) ?? bestClaimProbe(this.patternStore.all(), data);
      },
      answerProbe: (probe, verdict, answer) => this.answerProbe(probe, verdict, answer),
      openCounts: () => openCounts(this.patternStore.all(), this.ratifyStore.data()),
    }));

    // ── ⚡ capture flow (the YT pipeline as ONE designed surface) ──
    this.registerView(JP_PIPELINE_VIEW_TYPE, (leaf) => new PipelineView(leaf, {
      transcriptFolder: () => this.settings.notes.transcriptFolder || "Transcripts",
      fetchLiveHistory: () => this.fetchLiveHistoryCommand(),
      fetchByVideoUrl: (u) => this.fetchTranscriptByUrl(u),
      runPipelineOn: (note) => this.runPipelineOnFile(note),
      openReview: () => { void this.openReviewView(); },
      hasOcrKey: () => !!this.settings.notes.ocrApiKey,
    }));

    // ── 談話モード (turns/speakers/breaks as a manipulable surface) ──
    this.registerView(JP_DISCOURSE_MODE_VIEW_TYPE, (leaf) => new DiscourseModeView(leaf, {
      transcriptFolder: () => this.settings.notes.transcriptFolder || "Transcripts",
      parseLines: (md) => parseTranscriptLines(stripAnchors(md)),
      loadSeg: (path) => this.discourseSeg[path] ?? null,
      saveSeg: (path, seg) => {
        this.discourseSeg[path] = seg;
        return this.dm.setKey("_discourseSeg", this.discourseSeg);
      },
      loadRel: (path) => this.discourseRel[path] ?? null,
      saveRel: (path, rel) => {
        this.discourseRel[path] = rel;
        return this.dm.setKey("_discourseRel", this.discourseRel);
      },
      loadReadings: (path) => this.discourseReadings[path] ?? null,
      saveReadings: (path, r) => {
        this.discourseReadings[path] = r;
        return this.dm.setKey("_readingsGold", this.discourseReadings);
      },
      // pattern pills only — §23 component pills (echo/aizuchi/reaction/return
      // + the one-tap split) live in the view itself now
      suggestPatterns: (text) => {
        const seen = new Set<string>();
        return detectPatterns(text)
          .filter((m) => m.matchedText.length >= 2 && !seen.has(m.matchedText) && (seen.add(m.matchedText), true))
          .map((m) => ({ label: m.matchedText, text: m.matchedText }));
      },
      openCapture: (ctx) => new CaptureModal(this.app, ctx, this.makeCaptureDeps()).open(),
      // §23.3 layer-2 gold: component pill verdicts persist in the blob
      onComponentVerdict: (v) => { void this.recordComponentVerdict(v); },
      componentVerdictFor: (file, key) => this.componentGold[file + "|" + key]?.verdict ?? null,
    }));

    // Settings tab
    this.addSettingTab(new SettingsTab(
      this.app,
      this,
      this.settings,
      this.store,
      () => this.scraper,
      async () => { await this.saveSettings(); }
    ));

    // ── §26.3 step 6: going TO and FROM ──────────────────────────────────
    // One command per surface, each a TOGGLE: press it away from 辞書 to go
    // there, press it again to land back on the sentence you left, cursor and
    // scroll intact. Commands rather than raw key handlers because a command
    // is what Obsidian's hotkey UI can rebind — and therefore what an Elecom
    // or Logitech button mapped to a keystroke in its own driver lands on.
    // Buttons above 4 never reach a webview, so this is the only path that can
    // work for them, and it needs no driver integration at all.
    for (const { id, name } of SURFACE_COMMANDS) {
      this.addCommand({
        id: `go-${id}`,
        name: `${name} へ／から戻る`,
        callback: () => { void this.openSurface(id); },
      });
    }
    this.addCommand({
      id: "nav-back",
      name: "戻る（直前の場所へ）",
      callback: () => { void this.navBack(); },
    });

    // ── the input layer ──────────────────────────────────────────────────
    // Every gesture below is ALSO a command, and that is the whole trick.
    // Three- and four-finger touchpad swipes never reach a webview — Windows
    // and iPadOS consume them first — and no mouse button above 4 does either.
    // But Windows Settings → Touchpad → Advanced gestures will bind a swipe to
    // a custom shortcut, and Elecom Mouse Assistant / Logi Options+ will bind a
    // button to a keystroke. Both then land here. A command is the only
    // integration point that hardware we cannot hear from can reach.
    this.addCommand({ id: "surface-next", name: "次の面へ", callback: () => this.stepSurface(1) });
    this.addCommand({ id: "surface-prev", name: "前の面へ", callback: () => this.stepSurface(-1) });
    this.addCommand({ id: "density-up", name: "表示を大きく", callback: () => void this.stepDensity(1) });
    this.addCommand({ id: "density-down", name: "表示を小さく", callback: () => void this.stepDensity(-1) });
    this.addCommand({
      id: "density-reset", name: "表示の大きさを標準に戻す",
      callback: () => void this.stepDensity(0, true),
    });

    // Two-finger pan and pinch DO arrive, as `wheel` — the one multi-finger
    // family we can own outright. `passive: false` because a recognised swipe
    // must not also scroll the thing underneath it.
    //
    // Bound to OUR PANES, never to `document`. This listener was originally on
    // `document` with the pane test inside the handler, which is far too late:
    // a non-passive wheel listener on `document` declares that ANY scroll
    // anywhere might be cancelled, so the compositor must wait for this
    // JavaScript before scrolling the editor, the settings pane, the file
    // explorer — everything. The fast scroll path was off across the whole
    // app, and it was felt directly as scrolling that would not glide.
    // Scoped to our own panes, ordinary scrolling keeps its fast path and only
    // the surfaces that actually want the gesture pay for it.
    const wheelBound = new WeakSet<HTMLElement>();
    const onWheel = (e: WheelEvent): void => {
      const r = feedWheel(this.gesture, {
        deltaX: e.deltaX, deltaY: e.deltaY, ctrlKey: e.ctrlKey, at: e.timeStamp,
      });
      this.gesture = r.state;
      if (!r.gesture) return;
      e.preventDefault();
      if (r.gesture.kind === "density-step") void this.stepDensity(r.gesture.by);
      else this.stepSurface(r.gesture.by);
    };
    const bindWheel = (): void => {
      // A finger never produces `wheel`, so on tablet and phone this listener
      // is pure cost against the one thing it would slow down. Desk only.
      if (posture() !== "desk") return;
      for (const pane of Array.from(document.querySelectorAll<HTMLElement>(
        '.workspace-leaf-content[data-type^="jp-"]'))) {
        if (wheelBound.has(pane)) continue;
        wheelBound.add(pane);   // the listener dies with the node on close
        pane.addEventListener("wheel", onWheel, { passive: false });
      }
    };
    this.registerEvent(this.app.workspace.on("layout-change", bindWheel));
    this.app.workspace.onLayoutReady(bindWheel);

    // Rotation. Until now `applyPostureClasses()` ran once at load, so turning
    // the iPad left every ergonomic in the shape it had at launch.
    this.register(watchViewport(() => {
      this.applyDensity();          // re-assert ours; the classes re-apply themselves
      for (const leaf of this.app.workspace.getLeavesOfType(JP_DICTIONARY_VIEW_TYPE)) {
        (leaf.view as { onResize?: () => void })?.onResize?.();
      }
    }));

    // The thumb pair is the only extra mouse button a webview receives. Guarded
    // to OUR surfaces: inside the 辞書 the back button returns you, in the
    // editor Obsidian's own back/forward keeps working untouched.
    this.registerDomEvent(document, "mousedown", (e: MouseEvent) => {
      if (mouseIntent(e.button) !== "back") return;
      const type = this.app.workspace.getMostRecentLeaf()?.view?.getViewType?.();
      if (!type || !SURFACE_BY_VIEW_TYPE[type]) return;   // not ours — hands off
      e.preventDefault();
      e.stopPropagation();
      void this.navBack();
    });

    // Commands
    this.addCommand({
      id: "open-lexicon",
      name: "Open Lexicon",
      callback: () => this.openLexiconView(),
    });

    this.addCommand({
      id: "search",
      name: "Search",
      hotkeys: [],
      callback: () => new SearchModal(this.app, this.engine).open(),
    });

    // ── PHYSICS Move 1: the grab's command twins (invariant 9 — never a ──
    // gesture without its command) and the FIRST default hotkeys in the
    // plugin. The mice (Elecom/Logi) ride the hotkey layer per suite-nav.ts;
    // until these two lines, 74 commands offered them nothing to ride. This
    // is also the founding trigger's Obsidian-reachable form: capture-at-
    // attention from wherever the selection is, one hardware chord away.
    this.addCommand({
      id: "hold-selection",
      name: "選択を持つ — hold the current selection",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "h" }],
      callback: () => {
        // Editor selection FIRST: opening the command palette focuses its
        // input, which collapses the DOCUMENT selection — so a palette
        // invocation always saw "" and the command's only working route was
        // the hotkey (2026-08-20 review). CodeMirror keeps its selection as
        // editor state, palette or not.
        const text = (this.app.workspace.activeEditor?.editor?.getSelection()
          ?? window.getSelection()?.toString() ?? "").trim();
        if (!text) { new Notice("選択がありません — 語をなぞってから", 4000); return; }
        this.holdText(text, "editor");
      },
    });
    this.addCommand({
      id: "hold-toss-newest",
      name: "持っている一番新しいものをトレイへ — toss newest held chip",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "j" }],
      callback: () => {
        const chip = this.holdStore.newest();
        if (!chip) { new Notice("何も持っていません", 4000); return; }
        void this.landHeldChip(chip);
      },
    });
    // 鋳造 (§2.3) — the ⧉ verb's command twin.
    this.addCommand({
      id: "hold-mint",
      name: "持っている一番新しいものを複製 — mint a twin beside it",
      callback: () => {
        const chip = this.holdStore.newest();
        if (!chip) { new Notice("何も持っていません", 4000); return; }
        const r = this.holdStore.mint(chip.id);
        if (r?.evicted) void this.landHeldChip(r.evicted, false);
        this.holdDock.render();
      },
    });

    this.addCommand({
      id: "add-entry",
      name: "Add Entry",
      callback: () => new AddEntryModal(this.app, this.store, () => this.refreshViews()).open(),
    });

    this.addCommand({
      id: "classify-selected",
      name: "分類キャプチャ: Classify Selection into the Catalog (6分類)",
      editorCallback: (editor) => {
        const selected = editor.getSelection();
        if (!selected || selected.trim().length === 0) {
          new Notice("テキストを選択してから実行してください");
          return;
        }
        const file = this.app.workspace.getActiveFile();
        const ctx = this.buildCaptureContext(
          selected.trim(),
          editor.getValue(),
          editor.getCursor("from").line,
          file?.path ?? null,
        );
        new CaptureModal(this.app, ctx, this.makeCaptureDeps()).open();
      },
    });

    this.addCommand({
      id: "discourse-gold-export",
      name: "談話ゴールド: Export Discourse Training Data (JSONL)",
      callback: () => void this.exportDiscourseGold(),
    });

    this.addCommand({
      id: "import-data",
      name: "旧・連語ストアに読み込む (Import Legacy Collocations)",
      callback: () => this.importData(),
    });

    this.addCommand({
      id: "export-data",
      name: "旧・連語ストアだけを書き出す (Export Legacy Collocations — NOT the catalog)",
      callback: () => this.exportData(),
    });

    this.addCommand({
      id: "fetch-hyogen",
      name: "Fetch from Hyogen",
      callback: () => this.fetchFromHyogen(),
    });

    this.addCommand({
      id: "fetch-twc",
      name: "Fetch Collocations from TWC (筑波ウェブコーパス)",
      editorCallback: (editor) => {
        const selected = editor.getSelection().trim();
        if (!selected) {
          new Notice("検索語を選択してください");
          return;
        }
        this.fetchFromTWC([selected]);
      },
    });

    this.addCommand({
      id: "fetch-twc-wordlist",
      name: "Fetch TWC Collocations (Word List)",
      callback: () => this.fetchFromTWCWordlist(),
    });

    // SRS Card commands
    this.addCommand({
      id: "generate-srs-from-selection",
      name: "Generate SRS Cards from Selection",
      editorCallback: (editor) => {
        const selected = editor.getSelection();
        if (!selected || selected.trim().length === 0) {
          new Notice("テキストを選択してください");
          return;
        }
        const file = this.app.workspace.getActiveFile();
        new CardPreviewModal(
          this.app,
          selected,
          [],
          file?.path,
          this.settings.srs,
        ).open();
      },
    });

    // Card Type 1: Phrase-in-context cloze card from selection
    this.addCommand({
      id: "generate-phrase-in-context",
      name: "Phrase-in-Context Card from Selection (穴埋め)",
      editorCallback: async (editor) => {
        const selected = editor.getSelection();
        if (!selected || selected.trim().length === 0) {
          new Notice("テキストを選択してください");
          return;
        }
        const file = this.app.workspace.getActiveFile();
        let fullText = selected;
        let selStart = 0;
        if (file) {
          fullText = await this.app.vault.cachedRead(file);
          const cursor = editor.getCursor('from');
          selStart = editor.posToOffset(cursor);
        }
        const card = generatePhraseInContextCard(
          selected, fullText, selStart, file?.path, this.settings.srs,
        );
        // Open preview with just this card using injectedCards param
        new CardPreviewModal(
          this.app, '', [], file?.path, this.settings.srs, [card],
        ).open();
      },
    });

    this.addCommand({
      id: "generate-srs-from-file",
      name: "Generate SRS Cards from Current File",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice("ファイルを開いてください");
          return;
        }
        const content = await this.app.vault.cachedRead(file);
        new CardPreviewModal(
          this.app,
          content,
          [],
          file.path,
          this.settings.srs,
        ).open();
      },
    });

    this.addCommand({
      id: "generate-srs-collocations",
      name: "Generate SRS Cards from All Collocations",
      callback: () => {
        const entries = this.store.exportAll();
        new CardPreviewModal(
          this.app,
          '',
          entries,
          undefined,
          this.settings.srs,
        ).open();
      },
    });

    // Reconciliation pipeline (DESIGN §5/§10): match a notes file against its
    // source transcript and anchor the matches INSIDE the transcript itself —
    // typed callouts wrapping the real lines (no separate report file). All
    // embeds (library, cards) then point at ![[transcript#^recon-…]].
    this.addCommand({
      id: "reconcile-notes-transcript",
      name: "Reconcile Notes Against Source Transcript",
      callback: async () => { await this.runReconcileFlow(); },
    });

    // The other half of the ingest gate: `looksGenerated` now stops this junk
    // arriving, but the entries that arrived BEFORE it existed are still in the
    // index and no amount of correct filtering removes them.
    this.addCommand({
      id: "purge-generated-catalog-entries",
      name: "台帳から生成物エントリを取り除く（プレビュー付き）",
      callback: async () => { await this.purgeGeneratedPatterns(); },
    });

    // ⚡ the one-shot flow: OCR (if images) → reconcile → cards → audio clips
    // (audio only when the opt-in setting is on — same behavior, one button).
    this.addCommand({
      id: "run-recon-pipeline",
      name: "⚡ Full Pipeline: OCR → Reconcile → Cards → Audio Clips",
      callback: async () => { await this.runFullPipeline(); },
    });

    // History → capture note in one step: sources: prefilled from the latest
    // watch-history fetch (only videos whose transcripts exist). Paste the
    // handwriting image and hit ⚡ — no manual frontmatter.
    this.addCommand({
      id: "new-capture-note",
      name: "New Capture Note from Latest Watch History (paste image → ⚡)",
      callback: async () => { await this.newCaptureNote(); },
    });

    // The source-agnostic sibling: whatever transcript is open — Plex, jimaku,
    // YouTube, hand-pasted .srt — gets a capture note pointing at it. Without
    // this the TV road ends at the transcript and ⚡ is unreachable from it.
    this.addCommand({
      id: "capture-note-from-transcript",
      name: "📝 このトランスクリプトからキャプチャノートを作成（→ ⚡）",
      callback: async () => { await this.captureNoteFromTranscript(); },
    });

    // Speaker-synced clip enrichment (whisper + diarization, desktop, opt-in).
    registerVoiceSync(this, {
      saveSidecar: async (f, data) => { await this.app.vault.modify(f, JSON.stringify(data)); },
      enrollSpeaker: (clipFile, data, spk, name) => this.enrollVoice(clipFile, data, spk, name),
      knownNames: () => this.settings.voiceSync.profiles.map((p) => p.name),
    });
    this.addCommand({
      id: "enrich-clips-voicesync",
      name: "Enrich Clips with VoiceSync (whisper + speaker ID, desktop)",
      callback: async () => { await this.enrichClipsVoiceSync(); },
    });
    // Named voices exist → re-run identification over EVERY clip (overwrites
    // sidecars; manual per-clip corrections are re-derived from the profiles).
    this.addCommand({
      id: "reidentify-voicesync",
      name: "Re-identify Speakers in All Clips (apply voice profiles)",
      callback: async () => { await this.enrichClipsVoiceSync(true); },
    });

    this.addCommand({
      id: "ocr-reconcile-handwriting",
      name: "OCR Handwritten Note Images + Reconcile (Claude vision)",
      callback: async () => { await this.ocrThenReconcile(); },
    });

    // Cards + timestamp anchoring (DESIGN §11): turn reconciled spans into
    // fade-in cloze cards that link back to the transcript block + YouTube moment.
    this.addCommand({
      id: "generate-recon-cards",
      name: "Generate Timestamp-Anchored Cards from Notes",
      callback: async () => {
        const prep = await this.prepareReconcile();
        if (!prep) return;
        // Anchor every source transcript first (idempotent) so each card's
        // embed target exists, keeping the per-source combined plan.
        const plans = new Map<string, AnchorPlan>();
        for (const src of prep.sources) plans.set(src.tFile.path, await this.annotateTranscript(prep.file, src));
        const written = await this.writeReconCards(prep, plans);
        if (!written) { new Notice("アンカー可能な照合スパンがありません（要確認のみ？）"); return; }
        const withVid = prep.sources.some((s) => s.videoId);
        new Notice(`カード生成: ${written.count}件${withVid ? "（YouTube リンク付き）" : "（原文リンクのみ）"}`);
        await this.app.workspace.getLeaf(false).openFile(written.outFile);
      },
    });

    // Desktop-only: download MP3 clips for the reconciled spans (DESIGN §12 Tier 1).
    this.addCommand({
      id: "download-recon-audio-clips",
      name: "Download Audio Clips for Reconciled Notes (desktop, yt-dlp)",
      callback: () => this.downloadReconClips(),
    });

    // Diagnostics: write an environment/tools report so failures are visible.
    this.addCommand({
      id: "diagnose-audio-tools",
      name: "Diagnose Audio Tools (writes a report)",
      callback: () => this.diagnoseAudioTools(),
    });

    // ── YouTube transcript + history ingestion (DESIGN §8 Step 2) ──────────────
    // Fetch the transcript of a video (id from selection / frontmatter / clipboard),
    // freeze it as a note, and point the active notes file at it.
    this.addCommand({
      id: "fetch-yt-transcript",
      name: "Fetch YouTube Transcript into a Note",
      callback: () => this.fetchTranscriptCommand(),
    });

    // Ingest a watch-history export (Takeout JSON/HTML or pasted URLs) and fetch a
    // frozen transcript for each video — the full history→transcripts pipeline.
    this.addCommand({
      id: "fetch-yt-history-transcripts",
      name: "Fetch Transcripts from Watch History / URL List",
      callback: () => this.fetchHistoryTranscriptsCommand(),
    });

    // Live watch history (cookie auth): pick a date range, pull the videos you
    // watched then — complete + cross-device, no copy-paste (DESIGN §4).
    this.addCommand({
      id: "fetch-yt-history-live",
      name: "Fetch Watch History by Date Range (cookie)",
      callback: () => this.fetchLiveHistoryCommand(),
    });

    // Health check: ping each ingestion adapter, write a report (no silent failures).
    this.addCommand({
      id: "recon-health-check",
      name: "Reconciliation Health Check (adapters)",
      callback: () => this.reconHealthCheck(),
    });

    this.addCommand({
      id: "open-tray",
      name: "⤵ 収集トレイを開く",
      callback: () => { void this.openTray(); },
    });

    this.addCommand({
      id: "import-podcast",
      name: "🎙 取り込み: Podcast エピソード（RSS → mp3 + ノート）",
      callback: () => {
        new ImportModal(this.app, {
          title: "🎙 Podcast エピソードを取り込む",
          hint: "RSS フィード URL を貼り付け → 最新エピソードの mp3 をダウンロードし、source: podcast ノートを作成。書き起こしは ⚙ whisper 段階（音声はローカルなのでクリップはYTより速い）。",
          fields: [
            { key: "feed", label: "フィード URL", required: true, placeholder: "https://anchor.fm/s/…/podcast/rss" },
            { key: "pick", label: "何本目（1=最新）", placeholder: "1" },
          ],
          pasteLabel: "（このインポートはURLだけでOK）",
          pasteOptional: true,
          submitLabel: "エピソード取得",
          onSubmit: async (v) => {
            const resp = await requestUrl({ url: v.feed, method: "GET", throw: false });
            if (resp.status !== 200) throw new Error(`フィード取得失敗: HTTP ${resp.status}`);
            const feed = parsePodcastFeed(resp.text);
            if (!feed.episodes.length) throw new Error("エピソードが見つかりません");
            const idx = Math.max(1, Number(v.pick) || 1) - 1;
            const ep = feed.episodes[Math.min(idx, feed.episodes.length - 1)];
            const audioResp = await requestUrl({ url: ep.audioUrl, method: "GET", throw: false });
            if (audioResp.status !== 200) throw new Error(`音声取得失敗: HTTP ${audioResp.status}`);
            const folder = "Podcasts";
            if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder).catch(() => {});
            const safe = ep.title.replace(/[\\/:*?"<>|]/g, "").slice(0, 60);
            const audioPath = normalizePath(`${folder}/${safe}.mp3`);
            await this.app.vault.createBinary(audioPath, audioResp.arrayBuffer);
            const notePath = normalizePath(`${folder}/${safe}.md`);
            await this.app.vault.create(notePath, podcastNote(feed.show, ep, audioPath));
            void this.app.workspace.openLinkText(notePath, "", false);
            const mb = (audioResp.arrayBuffer.byteLength / 1048576).toFixed(1);
            return `🎙 ${feed.show}「${ep.title}」 (${mb}MB) → ${notePath}`;
          },
        }).open();
      },
    });

    this.addCommand({
      id: "podcast-transcribe",
      name: "🎙 Podcast: ⚙ whisper で書き起こし（デスクトップ）",
      callback: () => void this.transcribePodcastNote(),
    });

    this.addCommand({
      id: "import-srt",
      name: "📺 取り込み: 字幕 (.srt/.vtt) → トランスクリプト（jimaku など）",
      callback: () => {
        new ImportModal(this.app, {
          title: "📺 字幕を取り込む",
          hint: "jimaku 等の .srt / .vtt の中身を貼り付け。標準トランスクリプトになり、照合・走査・談話モード・⚡がそのまま使えます。(.ass は .srt に変換してから)",
          fields: [
            { key: "title", label: "エピソード名", required: true, placeholder: "例: 進撃の巨人 S1E01" },
            { key: "show", label: "番組名（任意）", placeholder: "例: 進撃の巨人" },
          ],
          pasteLabel: "ここに .srt / .vtt の中身を貼り付け",
          submitLabel: "トランスクリプト作成",
          onSubmit: async (v, paste) => {
            const { content, cueCount } = srtToNote({ srt: paste, title: v.title, sourceName: v.show || undefined });
            if (cueCount < 5) throw new Error("字幕を解析できませんでした（cue が5件未満）");
            const folder = this.settings.notes.transcriptFolder || "Transcripts";
            if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder).catch(() => {});
            const path = `${folder}/${v.title.replace(/[\\/:*?"<>|]/g, "")}.md`;
            await this.app.vault.create(path, content);
            void this.app.workspace.openLinkText(path, "", false);
            return `📺 ${cueCount}行のトランスクリプトを作成: ${path}`;
          },
        }).open();
      },
    });

    this.addCommand({
      id: "import-written",
      name: "📕 取り込み: Kindle ハイライト / note.com 記事 → 読書ノート",
      callback: () => {
        new ImportModal(this.app, {
          title: "📕 書き物を取り込む",
          hint: "Kindle のノートブック書き出し、または note.com 記事本文を貼り付け。段落が文脈の単位になり、選択キャプチャが scene（書名・場所・URL）を運びます。",
          fields: [
            { key: "title", label: "タイトル（書名/記事名）", required: true },
            { key: "url", label: "URL（note.com など・任意）", placeholder: "https://note.com/…" },
          ],
          pasteLabel: "本文/ハイライトをここに貼り付け",
          submitLabel: "読書ノート作成",
          onSubmit: async (v, paste) => {
            const medium = v.url?.includes("note.com") ? "note" : "book";
            const fm = [
              "---",
              `source: ${medium}`,
              `${medium === "book" ? "book_title" : "site"}: "${v.title.replace(/"/g, "'")}"`,
              ...(v.url ? [`url: "${v.url}"`] : []),
              "---", "", `# ${v.title}`, "",
            ];
            const body = paste.replace(/\r\n?/g, "\n").trim();
            const folder = this.settings.notes.transcriptFolder || "Transcripts";
            if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder).catch(() => {});
            const path = `${folder}/${v.title.replace(/[\\/:*?"<>|]/g, "")}.md`;
            await this.app.vault.create(path, [...fm, body, ""].join("\n"));
            void this.app.workspace.openLinkText(path, "", false);
            return `${medium === "book" ? "📕" : "📝"} 読書ノートを作成: ${path}`;
          },
        }).open();
      },
    });

    this.addCommand({
      id: "discover-collocations",
      name: "台帳: 💡 発見 — よく聞くのにまだ台帳にない連語",
      callback: () => void this.runDiscovery(),
    });

    this.addCommand({
      id: "restore-catalog-from-mirror",
      name: "台帳: Restore Catalog from Vault Mirror (catalog.jsonl)",
      callback: async () => {
        const path = `${JPCollocationsPlugin.MIRROR_FOLDER}/catalog.jsonl`;
        const f = this.app.vault.getAbstractFileByPath(path);
        if (!(f instanceof TFile)) { new Notice(`${path} が見つかりません`); return; }
        const entries = parseCatalogJsonl(await this.app.vault.cachedRead(f));
        if (!entries.length) { new Notice("ミラーに有効なエントリがありません"); return; }
        const n = await this.patternStore.importReplace(entries);
        this.refreshReconLibrary();
        new Notice(`台帳を復元しました: ${n}件`);
      },
    });

    /**
     * §26.3 — settle the Pencil questions on observation, not on documentation.
     *
     * Whether this webview hands a pen press to native HTML5 drag, and whether
     * the Pencil reports hover before it lands, are the two facts the whole
     * tablet carry design rests on, and neither is knowable from here. Same
     * house rule as `golden/twc.mjs`: measure it, then decide.
     */
    this.addCommand({
      id: "pen-probe",
      name: "✎ 調査: ペン／ドラッグの実測（iPad）",
      callback: () => new PenProbeModal(this.app).open(),
    });

    this.addCommand({
      id: "debug-dump",
      name: "🩺 Debug: dump storage + engine state (clipboard)",
      callback: async () => {
        const blob = this.dm.snapshot();
        const keySizes = Object.entries(blob)
          .map(([k, v]) => [k, JSON.stringify(v)?.length ?? 0] as const)
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `  ${k}: ${n >= 1024 ? `${(n / 1024).toFixed(0)}KB` : `${n}B`}`);
        const lines = [
          `jp-collocations debug dump — ${new Date().toISOString()}`,
          `platform: ${Platform.isDesktopApp ? "desktop" : "mobile"}`,
          `blob writes this session: ${this.dm.writes}`,
          `blob keys by size:`, ...keySizes,
          `patternStore: ${this.patternStore.size()} entries`,
          `xCorpus: ${this.xCorpus.size()} tweets`,
          `reconLibrary: ${this.reconLibrary.all().length} entries`,
          `srs deck: ${JSON.stringify(this.srsStore.counts(this.patternStore.all().filter(isReviewable).map((e) => e.id)))}`,
          `gold examples: ${this.goldStore.all().length}`,
          `dictionaries: ${this.dictStore.getDictionaryList().length} (${this.dictStore.getTotalTermCount()} terms)`,
          `surferBridge entries: ${this.surferBridge.getAllEntries().length}, needsReindex: ${this.surferBridge.needsReindex}`,
          `discourseSeg files: ${Object.keys(this.discourseSeg).length}`,
          `secrets present (device-local): x.auth=${!!this.settings.x.authToken} x.ct0=${!!this.settings.x.csrfToken} yt.cookie=${!!this.settings.ytHistory.cookie} ocrKey=${!!this.settings.notes.ocrApiKey}`,
        ];
        const text = lines.join("\n");
        await navigator.clipboard.writeText(text);
        console.log(text);
        new Notice("🩺 診断をクリップボードにコピーしました");
      },
    });

    this.addCommand({
      id: "catalog-sweep-transcripts",
      name: "台帳: Sweep All Transcripts for Pattern Sightings",
      callback: async () => { await this.sweepCatalog(); },
    });

    this.addCommand({
      id: "build-discourse-concordance",
      name: "談話: Build Move Concordance from Transcripts",
      callback: async () => { await this.buildConcordance(); },
    });

    // §6.5 — the readout the ledger exists to make possible. A note, not a
    // Notice: these are numbers to argue with over weeks, and a toast that
    // vanishes in five seconds cannot be argued with.
    this.addCommand({
      id: "study-ratification-report",
      name: "復習: 照合の記録を書き出す（精度・食い違い・未確定）",
      callback: async () => {
        const path = "照合レポート.md";
        const body = this.ratificationReport();
        const f = this.app.vault.getFileByPath(path);
        if (f) await this.app.vault.modify(f, body);
        else await this.app.vault.create(path, body);
        void this.app.workspace.openLinkText(path, "", false);
      },
    });

    this.addCommand({
      id: "convert-big-dictionary",
      name: "辞書: Convert Yomitan Export → Vault Sidecars (desktop)",
      callback: async () => { await this.convertBigDictionary(); },
    });

    this.addCommand({
      id: "convert-dexie-backup",
      name: "辞書: Convert Yomitan Backup (all dictionaries, desktop)",
      callback: async () => { await this.convertDexieBackup(); },
    });

    this.addCommand({
      id: "repair-big-dictionaries",
      name: "辞書: 変換済み辞書を検査・修復（meta.json 再生成＋シャード破損の検出）",
      callback: async () => { await this.repairBigDictionaries(); },
    });

    this.addCommand({
      id: "build-intent-index",
      name: "辞書: 意図索引を構築（英語の願いから引けるようにする §27.2）",
      callback: async () => { await this.buildIntentIndexes(); },
    });

    this.addCommand({
      id: "plex-subtitle-transcript",
      name: "📺 Plex: 再生中のエピソードの字幕 → トランスクリプト",
      callback: async () => { await this.plexSubtitleToTranscript(); },
    });

    this.addCommand({
      id: "plex-browse",
      name: "📺 Plex: ライブラリから選ぶ（字幕 → トランスクリプト）",
      callback: () => { this.openPlexBrowse(); },
    });

    // §25.4b — the same road without a Plex server: jimaku on its own.
    // Seeded from the open note, so 「今これを見ている」 needs no retyping.
    this.addCommand({
      id: "jimaku-subtitle-transcript",
      name: "📺 jimaku: 日本語字幕を探して取り込む",
      callback: () => {
        const f = this.app.workspace.getActiveFile();
        const fm = f ? this.app.metadataCache.getFileCache(f)?.frontmatter : undefined;
        const show = (fm?.show as string) ?? (fm?.title as string) ?? f?.basename ?? "";
        const ep = episodeNumberFrom(String(fm?.title ?? f?.basename ?? ""));
        this.openJimakuPicker({
          query: jimakuQueryFor({ show: fm?.show as string, title: show }),
          episode: (fm?.episode as number) ?? ep.episode,
          season: (fm?.season as number) ?? ep.season,
        }, {
          ...(fm?.plex_rating_key ? { ratingKey: String(fm.plex_rating_key) } : {}),
          ...(fm?.plex_part_key ? { partKey: String(fm.plex_part_key) } : {}),
        });
      },
    });

    // §27.0.2 — record a want you cannot yet say. The one place the plugin
    // holds a HOLE rather than a catch.
    this.addCommand({
      id: "open-reach",
      name: "願い: Hold a Reach (a meaning you can't yet say)",
      callback: () => new ReachModal(this.app, async (want, gloss) => {
        const r = await this.reachStore.add(want, Date.now(), gloss);
        new Notice(`願い「${r.want}」を保持しました — 届いたものが並べられます`, 6000);
        this.refreshTrayViews();
      }).open(),
    });

    // PHYSICS §5 — the reach's sister door, for a SHAPE instead of a meaning:
    // a wondering filed as a catalog entry with attestations: [] and
    // standing: true. The 願い holds a want in your own words and waits for
    // co-presence; a 問い holds a Japanese shape (もし〜たなら) and gets the
    // full class-aware sweep — anchors, gaps, confidence — on every arrival,
    // exempt from the ✕ mute (sweep-match.ts). onSaved already runs the
    // auto-sweep, so filing the question IS asking it, immediately.
    this.addCommand({
      id: "file-standing-question",
      name: "問い: File a Standing Question (a shape you haven't seen yet)",
      callback: () => new CaptureModal(this.app, {
        text: "",
        source: { kind: "manual" },
        standing: true,
      }, this.makeCaptureDeps()).open(),
    });

    this.addCommand({
      id: "open-srs-review",
      name: "復習: Open SRS Review (catalog deck)",
      callback: () => this.openReviewView(),
    });

    // Dictionary commands
    this.addCommand({
      id: "open-dictionary",
      name: "Open Dictionary",
      callback: () => this.openDictionaryView(),
    });

    // §30 nav grammar — every gesture with its command twin (invariant 9):
    // the corner chips, the flick, the pinch, the ⏱ and 検索 buttons all
    // land here too, so a keyboard or a mapped mouse button reaches them.
    this.addCommand({
      id: "dict-neighbor-next",
      name: "辞書: 次の見出し語へ (flip next)",
      callback: () => this.activeDictView()?.flipStep(1),
    });
    this.addCommand({
      id: "dict-neighbor-prev",
      name: "辞書: 前の見出し語へ (flip prev)",
      callback: () => this.activeDictView()?.flipStep(-1),
    });
    this.addCommand({
      id: "dict-history",
      name: "辞書: 履歴 (dated lookup history)",
      callback: async () => {
        if (!this.activeDictView()) await this.openDictionaryView();
        setTimeout(() => this.activeDictView()?.showHistory(), 120);
      },
    });
    this.addCommand({
      id: "dict-outline",
      name: "辞書: この画面の目次 (outline)",
      callback: () => this.activeDictView()?.toggleOutline(),
    });
    this.addCommand({
      id: "dict-find",
      name: "辞書: 画面内検索 (find in screen)",
      callback: () => this.activeDictView()?.toggleFind(true),
    });

    this.addCommand({
      id: "dictionary-lookup",
      name: "Look Up Selected Word in Dictionary",
      editorCallback: (editor) => {
        const selected = editor.getSelection().trim();
        if (!selected) {
          new Notice("テキストを選択してください");
          return;
        }
        this.openDictionaryView(selected);
      },
    });

    // Ribbon icons
    // ONE ribbon icon for the whole plugin (AUDIT §4): the hub menu reaches
    // every surface; each also stays reachable via the command palette.
    // §30 — the ribbon OPENS THE TRAY. It used to open a menu of nine surfaces,
    // which asked "where are you going?" at the moment you are holding
    // something and want to put it down. The tray is the answer to "put this
    // somewhere", and it now carries every road on it (see trayDoors), so the
    // menu it replaced is still one surface away — on the right-click, and
    // still whole in the command palette.
    const ribbon = this.addRibbonIcon("torii-gate", "JP Collocations — 収集トレイ（右クリックで全surface）", () => {
      void this.openTray();
    });
    this.registerDomEvent(ribbon, "contextmenu", (evt: MouseEvent) => {
      evt.preventDefault();
      const menu = new Menu();
      const add = (title: string, icon: string, cb: () => void) =>
        menu.addItem((i) => i.setTitle(title).setIcon(icon).onClick(cb));
      add("収集トレイ", "inbox", () => { void this.openTray(); });
      add("⚡ キャプチャフロー", "zap", () => this.openPipelineView());
      add("語彙・台帳", "languages", () => this.openLexiconView());
      add("復習 (SRS)", "layers", () => this.openReviewView());
      add("辞書", "book-open", () => this.openDictionaryView());
      add("𝕏 検索", "search", () => this.openXView());
      add("談話モード", "messages-square", () => this.openDiscourseMode());
      add("鑑賞モード（今ここ）", "eye", () => { void this.openFollowAlong(); });
      add("照合ライブラリ", "library", () => this.openReconLibrary());
      menu.addSeparator();
      add("照合パイプライン実行（OCR→照合→カード→音声）", "sparkles", () => { void this.runFullPipeline(); });
      menu.showAtMouseEvent(evt);
    });

    this.addCommand({
      id: "open-capture-flow",
      name: "⚡ キャプチャフロー（動画→手書き→カード→復習）",
      callback: () => this.openPipelineView(),
    });

    this.addCommand({
      id: "open-discourse-mode",
      name: "談話モード（ターン・話者・パターンを直接さわる）",
      callback: () => this.openDiscourseMode(),
    });

    this.addCommand({
      id: "open-follow-along",
      name: "鑑賞モード（今ここ — 追従・マーク・発話セッション）",
      callback: () => void this.openFollowAlong(),
    });

    this.addCommand({
      id: "device-diagnostic",
      name: "📱 デバイス診断（この端末で何が動くか）",
      callback: () => void this.deviceDiagnostic(),
    });

    // ── X (Twitter) search dictionary ────────────────────────
    this.addCommand({
      id: "open-x-search",
      name: "Open X Search",
      callback: () => this.openXView(),
    });

    this.addCommand({
      id: "x-search-selection",
      name: "Search Selection on X",
      editorCallback: (editor) => {
        const sel = editor.getSelection().trim();
        if (!sel) {
          new Notice("テキストを選択してください");
          return;
        }
        this.openXView(sel);
      },
    });

    // iOS co-occurrence lookup: round-trips through Scriptable so the logged-in
    // browser engine signs X's requests for us. Query comes from the editor
    // selection if present, else the clipboard ("copy two words → run").
    this.addCommand({
      id: "x-cooc-mobile",
      name: "X 共起チェック（モバイル / Scriptable）",
      callback: async () => {
        const editor = this.app.workspace.activeEditor?.editor;
        let raw = editor?.getSelection()?.trim() ?? "";
        if (!raw) {
          try {
            raw = (await navigator.clipboard.readText()).trim();
          } catch {
            raw = "";
          }
        }
        await this.xCoocMobile(raw);
      },
    });

    // The other side of the round trip: Scriptable opens
    // obsidian://jp-x-capture?n=…&data=<base64 jsonl> when it's done.
    this.registerObsidianProtocolHandler(X_CAPTURE_ACTION, (params) => {
      void this.handleXCapture(params);
    });

    // ── §21: the universal capture port — obsidian://jpc-capture ──
    // ONE entry for every outside app (manga reader, Kindle, podcasts, TV
    // subs): an iOS Shortcut / share sheet builds this URL and the classify
    // modal opens prefilled, suggester preselected, source-tagged. This is
    // the primitive every per-app integration rides on.
    //   obsidian://jpc-capture?text=…&example=…&source=manual&url=…&label=…
    this.registerObsidianProtocolHandler("jpc-capture", (params) => {
      const text = (params.text ?? "").trim();
      const example = (params.example ?? "").trim();
      if (!text && !example) { new Notice("jpc-capture: text か example が必要です"); return; }
      const kind = (["yt", "x", "web", "manual"] as const).find((k) => k === params.source) ?? "manual";
      new CaptureModal(this.app, {
        text: text || example,
        example: example || undefined,
        source: { kind, url: (params.url ?? "").trim() || undefined },
      }, this.makeCaptureDeps()).open();
    });

    // ── Selection mode commands (sentence surfing) ───────────
    let activeSelMode: SelectionMode = 'sentence';

    // Status bar: selection mode toolbar (visible on mobile)
    const selToolbarEl = this.addStatusBarItem();
    selToolbarEl.addClass('jp-sel-status-bar');
    const updateToolbar = () => {
      renderSelectionToolbar(selToolbarEl, activeSelMode, (mode) => {
        activeSelMode = mode;
        updateToolbar();
      });
    };
    updateToolbar();

    // Status bar: sidecar coverage indicator (informational; updated every 5s).
    this.sidecarStatusEl = this.addStatusBarItem();
    this.sidecarStatusEl.addClass('jp-status-bar-sidecar');
    const updateSidecarStatus = () => {
      if (!this.sidecarStatusEl) return;
      const s = this.surferBridge.getCoverageStats();
      const ratio = s.indexed > 0 ? `${s.applied}/${s.indexed}` : '0/0';
      this.sidecarStatusEl.setText(`📊 ${ratio} sidecars`);
      const reasonLines = Object.entries(s.byReason)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');
      this.sidecarStatusEl.title =
        `Sidecars applied: ${ratio}` +
        (reasonLines ? `\nUnapplied breakdown:\n${reasonLines}` : '');
    };
    updateSidecarStatus();
    this.registerInterval(window.setInterval(updateSidecarStatus, 5000));

    this.addCommand({
      id: "sidecar-coverage",
      name: "Show Sidecar Coverage Breakdown",
      callback: () => {
        const s = this.surferBridge.getCoverageStats();
        const ratio = s.indexed > 0 ? `${s.applied}/${s.indexed}` : '0/0';
        const reasonLines = Object.entries(s.byReason)
          .map(([k, v]) => `  ${k}: ${v}`)
          .join('\n');
        new Notice(
          `Sidecar coverage: ${ratio} applied` +
          (reasonLines ? `\nUnapplied:\n${reasonLines}` : '\n(all applied)'),
          10000,
        );
      },
    });

    this.addCommand({
      id: "cycle-selection-mode",
      name: "Cycle Selection Mode (文↔節↔句↔文法↔穴埋め)",
      editorCallback: () => {
        const modes: SelectionMode[] = ['sentence', 'clause', 'phrase', 'pattern', 'blank'];
        const idx = modes.indexOf(activeSelMode);
        activeSelMode = modes[(idx + 1) % modes.length];
        const cfg = SELECTION_MODES.find(m => m.id === activeSelMode)!;
        new Notice(`${cfg.icon} ${cfg.label} (${cfg.labelEn})`);
        updateToolbar();
      },
    });

    this.addCommand({
      id: "smart-select",
      name: "Smart Select at Cursor (uses active mode)",
      editorCallback: (editor) => {
        const cursorPos = editor.getCursor();
        const offset = editor.posToOffset(cursorPos);
        const text = editor.getValue();
        const result = expandSelection(text, offset, activeSelMode);
        if (result) {
          const from = editor.offsetToPos(result.start);
          const to = editor.offsetToPos(result.end);
          editor.setSelection(from, to);

          // If in 'blank' mode, auto-trigger phrase-in-context card
          if (activeSelMode === 'blank') {
            const file = this.app.workspace.getActiveFile();
            const card = generatePhraseInContextCard(
              result.selected, text, result.start, file?.path, this.settings.srs,
            );
            new CardPreviewModal(
              this.app, '', [], file?.path, this.settings.srs, [card],
            ).open();
          }
        } else {
          new Notice('選択対象が見つかりません');
        }
      },
    });

    // ── Editor Decoration Extension (discourse visualization) ─
    // Inject the sidecar-aware resolver + active-file lookup BEFORE the
    // extension is registered so the first rebuild already uses it. The same
    // resolver is shared with the card-generation pipeline so SRS cards
    // surface sidecar relations when available and fall back honestly when not.
    {
      const resolver = makeRelationsResolver(this.surferBridge);
      this.relationsResolver = resolver;
      setEditorContext({
        resolver,
        getActiveFilePath: () => this.app.workspace.getActiveFile()?.path,
      });
      setCardGenResolver(resolver);
      setGrammarSetResolver(resolver);
      setReadingResolver(resolver);
      setCollocationViewResolver(resolver);
    }
    this.registerEditorExtension(getDiscourseExtensions());

    // ── Reading Mode Highlighting (discourse patterns in rendered HTML) ─
    this.registerMarkdownPostProcessor(getReadingModePostProcessor());

    // Toggle reading mode highlighting
    this.addCommand({
      id: "toggle-reading-mode-highlight",
      name: "Toggle Reading Mode Discourse Highlight",
      callback: () => {
        this.settings.readingModeHighlight = !this.settings.readingModeHighlight;
        this.saveSettings();
        // Toggle CSS class on body to enable/disable
        document.body.toggleClass('jp-reading-hl-off', !this.settings.readingModeHighlight);
        new Notice(`読書モードハイライト: ${this.settings.readingModeHighlight ? 'ON' : 'OFF'}`);
      },
    });

    // Apply initial state
    if (!this.settings.readingModeHighlight) {
      document.body.addClass('jp-reading-hl-off');
    }

    // ── Vault-wide auto-index on startup ─────────────────────
    if (this.settings.autoIndexOnStartup) {
      this.app.workspace.onLayoutReady(() => {
        this.backgroundIndexVault();
      });
    }

    // Toggle discourse visualization
    this.addCommand({
      id: "toggle-discourse-visualization",
      name: "Toggle Discourse Visualization",
      editorCallback: (editor) => {
        // @ts-ignore — access CM6 view from Obsidian editor
        const cmView = (editor as any).cm;
        if (!cmView) { new Notice("この編集ビューでは切り替えられません"); return; }
        toggleDiscourseVisualization(cmView);
        // Read the field back with the FIELD, not with a boolean. This used to
        // be `cmView.state.field(cmView.state.field !== undefined)` — i.e.
        // `state.field(true)` — which CM6 answers with
        // `RangeError: Field is not present in this state`. The dispatch above
        // had already landed, so the toggle worked and the command then threw:
        // no Notice, a console exception, and a state change with no feedback.
        const active = cmView.state.field(visualizationActive, false) === true;
        new Notice('談話文法可視化：' + (active ? 'ON' : 'OFF'));
      },
    });

    // Purge + rebuild the discourse/KWIC indexes with the current engine.
    this.addCommand({
      id: "rebuild-discourse-indexes",
      name: "Rebuild Discourse Indexes (談話インデックス再構築)",
      callback: () => {
        this.surferBridge.purgeIndexes();
        const total = this.app.vault.getMarkdownFiles().length;
        new Notice(`インデックスを破棄しました。${total} ファイルをバックグラウンドで再解析します`);
        this.backgroundIndexVault();
      },
    });

    // Analyze relations in selection
    this.addCommand({
      id: "analyze-relations",
      name: "Analyze Discourse Relations in Selection",
      editorCallback: (editor) => {
        const text = editor.getSelection().trim() || editor.getValue();
        const filePath = this.app.workspace.getActiveFile()?.path;
        const resolved = this.relationsResolver(text, { filePath });
        const summary = summarizeRelations(resolved.relations);
        const sourceTag = resolved.source === 'sidecar' ? '[sidecar]' : '[heuristic]';
        new Notice(
          `${sourceTag} 関係検出: ${resolved.relations.length}件\n${summary}\nチャンク: ${resolved.chunks.length}`,
          8000,
        );
      },
    });

    // Command for surfer to dispatch
    this.addCommand({
      id: "open-dictionary-selection",
      name: "Look Up Selection in Dictionary (Surfer Bridge)",
      editorCallback: (editor) => {
        const sel = editor.getSelection().trim();
        if (sel) this.openDictionaryView(sel);
      },
    });
  }

  // ── Surfer Bridge Public API ─────────────────────────────
  // These methods are called by jp-sentence-surfer- via:
  //   this.app.plugins.plugins['jp-collocations'].methodName(args)

  // ── Dictionary lookup (called from surfer toolbar) ─────────

  /** Open the dictionary view and look up a word */
  lookupWord(term: string): void {
    this.openDictionaryView(term);
  }

  /** Look up in dictionary and return results directly */
  dictionaryLookup(term: string) {
    return this.dictStore.lookup(term);
  }

  /** Open the lexicon/collocations panel */
  openLexicon(): void {
    this.openLexiconView();
  }

  // ── Write methods ──────────────────────────────────────────

  /** Add or update a discourse/collocation entry from Surfer */
  async addEntryFromSurfer(entry: SurferCollocationEntry): Promise<void> {
    await this.surferBridge.addEntry(entry);
  }

  /** Append discourse context (markers, granularity, chunk) to an existing entry */
  async addDiscourseContext(id: string, ctx: DiscourseContext): Promise<void> {
    await this.surferBridge.addDiscourseContext(id, ctx);
  }

  /** Save an example sentence against an existing entry */
  async saveExampleSentence(id: string, text: string, source: string): Promise<void> {
    await this.surferBridge.saveExampleSentence(id, text, source);
  }

  /** Index a file's discourse markers (called on file open/edit) */
  indexFileDiscourse(filePath: string, content: string): void {
    this.surferBridge.indexFile(filePath, content);
  }

  /** Save a dictionary word as a collocation entry */
  saveEntryFromDict(expression: string, reading: string, example?: string): void {
    const id = `dict-${expression}-${Date.now()}`;
    const entry: SurferCollocationEntry = {
      id,
      surface: expression,
      reading,
      capturedAt: new Date().toISOString(),
      exampleSentences: example ? [{ text: example, source: 'dictionary' }] : [],
    };
    this.surferBridge.addEntry(entry);
  }

  // ── Discourse analysis methods ─────────────────────────────

  /** Full discourse analysis of text: patterns, flows, templates, register */
  analyzeText(text: string): AnalysisResult {
    return this.surferBridge.analyzeText(text);
  }

  /** Segment unsegmented text (like YT transcripts) at discourse boundaries */
  segmentText(text: string): string[] {
    return this.surferBridge.segmentText(text);
  }

  // ── Transcript methods ─────────────────────────────────────────

  /** Full transcript analysis: speakers, turns, discourse patterns per speaker */
  analyzeTranscript(text: string): TranscriptAnalysisResult {
    return this.surferBridge.analyzeTranscriptText(text);
  }

  /** Smart analysis: auto-detects transcript vs plain text */
  smartAnalyze(text: string): AnalysisResult | TranscriptAnalysisResult {
    return this.surferBridge.smartAnalyzeText(text);
  }

  /** Analyze sentence-level relations (intra/cross sentence, cross-speaker) */
  analyzeRelationsPublic(text: string, filePath?: string) {
    return this.relationsResolver(text, { filePath });
  }

  /** Clean a selection that may contain timestamps/URLs/formatting */
  cleanSelection(text: string): string {
    return this.surferBridge.cleanSelectionText(text);
  }

  /** Check if text is transcript format */
  isTranscriptFormat(text: string): boolean {
    return this.surferBridge.isTranscript(text);
  }

  // ── Query methods ──────────────────────────────────────────

  /** Scan text for all known surfer collocation surfaces; returns matches with offsets */
  findCollocationsInText(text: string): CollocationMatch[] {
    return this.surferBridge.findInText(text);
  }

  /** Find entries whose surface or discourse-context markers match a given surface */
  searchByDiscourseMarker(surface: string): SurferCollocationEntry[] {
    return this.surferBridge.searchByMarker(surface);
  }

  /** Return all entries matching a discourse category */
  searchByCategory(category: DiscourseCategory | string): SurferCollocationEntry[] {
    return this.surferBridge.searchByCategory(category);
  }

  /** Return every surfer-originated entry */
  getAllEntries(): SurferCollocationEntry[] {
    return this.surferBridge.getAllEntries();
  }

  /** Aggregate stats: totals by category, position, top co-occurrences */
  getDiscourseStats(): DiscourseStats {
    return this.surferBridge.getStats();
  }

  // ── KWIC methods ───────────────────────────────────────────

  /** Get KWIC concordance records for a pattern ID */
  searchKWIC(patternId: string): KWICResult {
    return this.surferBridge.searchKWIC(patternId);
  }

  /** Get KWIC records for a surface form */
  searchKWICBySurface(surface: string): KWICResult {
    return this.surferBridge.searchKWICBySurface(surface);
  }

  /** Search KWIC left/right context for a string */
  searchKWICContext(query: string): KWICResult {
    return this.surferBridge.searchKWICContext(query);
  }

  // ── Variation tree methods ─────────────────────────────────

  /** Get the variation tree containing a given pattern */
  getVariationTree(patternId: string): VariationTreeResult | null {
    return this.surferBridge.getVariationTree(patternId);
  }

  /** Get all variation trees for the full pattern database */
  getAllVariationTrees(): VariationTreeResult[] {
    return this.surferBridge.getAllVariationTrees();
  }

  // ── Co-occurrence / constellation methods ──────────────────

  /** Get strongest co-occurrence associations for a pattern */
  getConstellationFor(patternId: string, limit?: number): ConstellationResult | null {
    return this.surferBridge.getConstellationFor(patternId, limit);
  }

  /** Get top co-occurrence pairs from the index */
  getTopCoOccurrencePairs(limit?: number) {
    return this.surferBridge.getTopCoOccurrencePairs(limit);
  }

  // ── Pattern database methods ───────────────────────────────

  /** Search the built-in discourse pattern database */
  searchPatterns(query: string) {
    return this.surferBridge.searchPatterns(query);
  }

  /** Get a specific pattern by ID */
  getPatternById(id: string) {
    return this.surferBridge.getPatternById(id);
  }

  /** Get total pattern count in the database */
  getPatternCount(): number {
    return this.surferBridge.getPatternCount();
  }

  // ── Vault-wide profiling ───────────────────────────────────

  /** Build a discourse profile across provided texts */
  buildVaultProfile(texts: string[]): VaultProfileResult {
    return this.surferBridge.buildVaultProfile(texts);
  }

  // ── Card generation API (for surfer) ─────────────────────────

  /** Generate a phrase-in-context cloze card from selected text */
  generatePhraseCard(selection: string, fullText: string, selStart: number, sourceFile?: string) {
    return generatePhraseInContextCard(selection, fullText, selStart, sourceFile, this.settings.srs);
  }

  /** Generate relation-chunk cards for a block of text */
  generateRelationCards(text: string, sourceFile?: string) {
    return generateRelationChunkCards(text, sourceFile, this.settings.srs);
  }

  /** Extract collocations from text */
  extractCollocationsFromText(text: string) {
    return extractCollocations(text);
  }

  /** Get available selection modes */
  getSelectionModes() {
    return SELECTION_MODES;
  }

  /** Expand selection at cursor position using a specific mode */
  expandSelectionAt(text: string, offset: number, mode: SelectionMode) {
    return expandSelection(text, offset, mode);
  }

  /** Open card preview modal with provided cards */
  openCardPreview(cards: any[], sourceFile?: string) {
    new CardPreviewModal(
      this.app, '', [], sourceFile, this.settings.srs, cards,
    ).open();
  }

  async onunload(): Promise<void> {
    if (this.mirrorTimer) { clearTimeout(this.mirrorTimer); await this.writeMirror(); }
    await this.dm.flush(); // land any debounced blob write before we die
    this.holdDock?.unmount(); // body-mounted; chips themselves persist in the blob
    this.scraper?.abort();
    this.twcScraper?.abort();
    // A carry still in flight holds a document-level scroll blocker that would
    // outlive this plugin — see `abortPointerDrag`.
    abortPointerDrag();
    this.app.workspace.detachLeavesOfType(JP_COLLOCATIONS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(JP_DICTIONARY_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(JP_X_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(JP_RECON_LIBRARY_VIEW_TYPE);
  }

  // ── Universal classify-capture (DESIGN §13) ─────────────────

  /** The dependency bundle every capture surface shares. */
  /**
   * §30 — the front door's rows.
   *
   * Every road here already existed as a command; the problem was that finding
   * the right one meant knowing which of 60 palette entries matched the medium
   * in your hand. Nothing is moved or removed — the commands stay, and these
   * are the same roads made visible on the surface you are already looking at
   * when you have something to put away.
   *
   * Ingest doors are invoked by command id (the convention CollocationView
   * already uses) rather than by calling the handlers directly, so the large
   * ImportModal callbacks stay in exactly one place and cannot drift from what
   * the palette does.
   */
  private trayDoors(): TrayDoor[] {
    const cmd = (id: string) => () => {
      const ok = (this.app as any).commands?.executeCommandById(`jp-collocations:${id}`);
      if (!ok) new Notice(`コマンドが見つかりません: ${id}`, 6000);
    };
    const plexOff = !(this.settings.plex.baseUrl.trim() && this.settings.plex.token.trim())
      ? "設定 → Plex に baseUrl と X-Plex-Token を入力してください" : undefined;

    return [
      // ── 入れる: one row per medium, in the shape that medium deserves ──
      { kind: "in", label: "YouTube 履歴", icon: "history", run: cmd("fetch-yt-history-live") },
      { kind: "in", label: "YouTube URL", icon: "link", run: cmd("fetch-yt-transcript") },
      { kind: "in", label: "Plex", icon: "tv", run: cmd("plex-browse"), disabled: plexOff },
      // §25.4b — the same TV road WITHOUT a Plex server. It was palette-only
      // while Plex sat on the tray, so the door that needs no server was the one
      // you could not find, and a Plex-less setup read as "no TV support".
      { kind: "in", label: "jimaku 字幕", icon: "subtitles", run: cmd("jimaku-subtitle-transcript") },
      { kind: "in", label: "字幕 .srt", icon: "captions", run: cmd("import-srt") },
      { kind: "in", label: "Podcast", icon: "podcast", run: cmd("import-podcast") },
      { kind: "in", label: "Kindle・note", icon: "book-open-text", run: cmd("import-written") },
      { kind: "in", label: "𝕏", icon: "search", run: cmd("open-x-search") },

      // ── 開く: where it goes once it is in ──
      { kind: "go", label: "⚡ キャプチャ", icon: "zap", run: () => this.openPipelineView() },
      { kind: "go", label: "語彙・台帳", icon: "languages", run: () => this.openLexiconView() },
      { kind: "go", label: "復習", icon: "layers", run: () => this.openReviewView() },
      { kind: "go", label: "辞書", icon: "book-open", run: () => this.openDictionaryView() },
      { kind: "go", label: "鑑賞モード", icon: "eye", run: () => { void this.openFollowAlong(); } },
      { kind: "go", label: "談話モード", icon: "messages-square", run: () => this.openDiscourseMode() },
      { kind: "go", label: "照合ライブラリ", icon: "library", run: () => this.openReconLibrary() },
      // §27.0.2 — the one door that puts nothing down and takes nothing out.
      // A want has no other entry point in the UI, and the tray is exactly where
      // you are when you notice you cannot say something.
      { kind: "go", label: "願い", icon: "sparkle", run: cmd("open-reach") },
    ];
  }

  makeCaptureDeps(): CaptureDeps {
    return {
      recordClassified: (opts) => this.patternStore.recordClassified(opts),
      addGold: (g) => this.goldStore.add(g),
      // The classify gesture is also the moment to go looking: one entry against
      // every transcript costs ~100ms warm, and it turns "I flicked a phrase in"
      // into "here are the other places you have already heard it."
      onSaved: (entry) => { this.refreshReconLibrary(); void this.autoSweepAfterCapture(entry); },
      // §21: calibrated by the user's own suggested-vs-chosen record —
      // every past capture makes the next preselection smarter. The evidence
      // object carries what the modal knows beyond the span (example, prior
      // turns, medium); the lexeme probe lets 🔵/🟢 signals check their
      // components against the dictionaries the vault actually has.
      suggestClass: (ev) => suggestClass(
        {
          ...ev,
          lexeme: this.dictStore.hasDictionaries()
            ? (s) => this.dictStore.lookup(s).length > 0
            : undefined,
        },
        this.patternStore.all()
          .filter((p) => p.classRatified)
          .map((p) => ({ suggested: p.classSuggested, chosen: p.class })),
      ),
      // §22.4 TokenCanvas: deinflection-backed token validation + faint
      // pentimento spans (discovery chunker over the example line)
      canvasProbe: (s) => this.dictStore.hasDictionaries() && this.dictStore.lookup(s).length > 0,
      spanSuggestions: (text) => {
        const out: Array<{ start: number; end: number; label: string }> = [];
        for (const surface of new Set(chunkLine(text))) {
          for (const o of findTermAll(text, surface)) {
            out.push({ start: o.span.start, end: o.span.end, label: '💡 連語候補' });
            break;
          }
        }
        return out.slice(0, 4);
      },
    };
  }

  /**
   * Build the capture context for an editor selection. Transcript files
   * (stamped lines) yield REAL turns — prior/following stamped lines with the
   * span's timestamp — which is what makes 🔴 captures parser-grade training
   * data. Other notes fall back to surrounding non-empty lines; a `url:`/
   * `source:` frontmatter (note.com exports, web clips) marks the capture as
   * kind 'web'.
   */
  buildCaptureContext(text: string, fullText: string, cursorLine: number, filePath: string | null): CaptureContext {
    const rawLines = fullText.split("\n");

    // §22: the note declares its medium in frontmatter (source: tv / book /
    // note / podcast — written by the importers) — captures carry the scene.
    const fmHead = fullText.slice(0, 800);
    const fmMedium = fmHead.match(/^source:\s*(tv|book|note|podcast|manga)\s*$/m)?.[1] as
      | "tv" | "book" | "note" | "podcast" | "manga" | undefined;
    const fmName = fmHead.match(/^(?:show|book_title|site):\s*"?([^"\n]+?)"?\s*$/m)?.[1]
      ?? fmHead.match(/^title:\s*"?([^"\n]+?)"?\s*$/m)?.[1];

    // stamped transcript lines with their raw line numbers
    const stamped: Array<{ lineNo: number; tStartSec: number; text: string }> = [];
    for (let i = 0; i < rawLines.length; i++) {
      const m = rawLines[i].match(CAPTION_STAMP_RE);
      if (!m) continue;
      const h = m[1] ? +m[1] : 0;
      const body = (m[4] || "").trim();
      if (body) stamped.push({ lineNo: i, tStartSec: h * 3600 + +m[2] * 60 + +m[3], text: body });
    }

    if (stamped.length >= 5) {
      // nearest stamped line at or above the cursor
      let idx = -1;
      for (let i = 0; i < stamped.length; i++) { if (stamped[i].lineNo <= cursorLine) idx = i; else break; }
      if (idx >= 0) {
        return {
          text,
          example: stamped[idx].text,
          contextBefore: stamped.slice(Math.max(0, idx - 5), idx).map((l) => l.text),
          contextAfter: stamped.slice(idx + 1, idx + 4).map((l) => l.text),
          source: {
            kind: "yt", file: filePath ?? undefined, tStartSec: stamped[idx].tStartSec,
            ...(fmMedium ? { medium: fmMedium, sourceName: fmName } : {}),
          },
        };
      }
    }

    // non-transcript: surrounding non-empty, non-heading lines as weak context
    const isBody = (s: string) => { const t = s.trim(); return !!t && !t.startsWith("#") && t !== "---"; };
    const before: string[] = [];
    for (let i = cursorLine - 1; i >= 0 && before.length < 3; i--) if (isBody(rawLines[i])) before.unshift(rawLines[i].trim());
    const after: string[] = [];
    for (let i = cursorLine + 1; i < rawLines.length && after.length < 3; i++) if (isBody(rawLines[i])) after.push(rawLines[i].trim());
    const example = isBody(rawLines[cursorLine] ?? "") ? rawLines[cursorLine].trim() : undefined;

    // web capture: the note carries its origin URL in frontmatter
    const fmUrl = fmHead.match(/^(?:url|source|link):\s*"?(https?:\/\/\S+?)"?\s*$/m)?.[1];
    if (fmMedium === "book" || fmMedium === "note") {
      // written medium (§22.2): paragraph context, kindle loc if present
      const loc = fmHead.match(/^loc:\s*"?([^"\n]+?)"?\s*$/m)?.[1];
      return {
        text, example, contextBefore: before, contextAfter: after,
        source: {
          kind: fmUrl ? "web" : "manual", url: fmUrl, file: filePath ?? undefined,
          medium: fmMedium, sourceName: fmName, loc,
        },
      };
    }
    return {
      text,
      example,
      contextBefore: before,
      contextAfter: after,
      source: fmUrl
        ? { kind: "web", url: fmUrl, file: filePath ?? undefined }
        : { kind: "manual", file: filePath ?? undefined },
    };
  }

  /** Re-open the classify-capture modal for an existing catalog pattern
   *  (edit payload / add a second lens). Seeds from its first attestation. */
  openCaptureForPattern(p: PatternEntry): void {
    const a = p.attestations[0];
    const source: CaptureContext["source"] = a
      ? (a.source === "yt" ? { kind: "yt", file: a.file, tStartSec: a.tStartSec }
        : a.source === "x" ? { kind: "x", url: a.file }
        : a.source === "web" ? { kind: "web", url: a.file }
        : { kind: "manual", file: a.file })
      : { kind: "manual" };
    new CaptureModal(this.app, {
      text: p.note,
      example: a?.quote,
      source,
    }, this.makeCaptureDeps()).open();
  }

  /** Export the 🔴 gold examples + class choices as JSONL (the parser-building input). */
  async exportDiscourseGold(): Promise<void> {
    const examples = this.goldStore.all();
    const stats = this.goldStore.stats();
    const goldPath = normalizePath("discourse-gold.jsonl");
    await this.app.vault.adapter.write(goldPath, toJsonl(examples) + (examples.length ? "\n" : ""));

    const choices = this.patternStore.all()
      .filter((p) => p.classRatified)
      .map((p) => JSON.stringify({
        key: p.key, keyKind: p.keyKind, note: p.note,
        suggested: p.classSuggested ?? null, chosen: p.class,
      }));
    await this.app.vault.adapter.write(normalizePath("class-choices.jsonl"), choices.join("\n") + (choices.length ? "\n" : ""));

    // §23 LAYER 2 — the component verdicts. These were being collected with
    // full turn context by DiscourseModeView's pills and written to
    // `_componentGold`, where they had exactly two readers: the write itself and
    // the "have I already judged this?" lookup. The layer DESIGN §23 calls "the
    // parser's honest ceiling" was producing gold with no exit and no consumer.
    // It is the one gold whose claims are decidable from the skeleton alone, so
    // it is the one most worth being able to train or measure against.
    const comps = Object.entries(this.componentGold).map(([key, v]) => JSON.stringify({
      key, file: v.file, line: v.line, tStartSec: v.tStartSec ?? null,
      kind: v.kind, unitText: v.unitText, echoed: v.echoed ?? null, evidence: v.evidence ?? null,
      verdict: v.verdict, prevText: v.prevText, turnText: v.turnText, at: v.at,
    }));
    await this.app.vault.adapter.write(
      normalizePath("component-gold.jsonl"), comps.join("\n") + (comps.length ? "\n" : ""));
    const acc = comps.length
      ? Object.values(this.componentGold).filter((v) => v.verdict === "accept").length
      : 0;

    const a = stats.actAgreement;
    const rate = a.graded ? `${Math.round((a.agreed / a.graded) * 100)}% (${a.agreed}/${a.graded})` : "—";
    new Notice(
      `談話ゴールド ${stats.total}件 → discourse-gold.jsonl\n` +
      `パーサのムーブ一致率: ${rate}\n` +
      `分類選択 ${choices.length}件 → class-choices.jsonl\n` +
      `§23 層2 部品判定 ${comps.length}件（採用 ${acc}）→ component-gold.jsonl`,
      9000,
    );
  }

  // ── X Search wiring ──────────────────────────────────────────

  /** Assemble the dependency bundle the X search view needs. */
  /**
   * §29 rung 0's oracle. isWord is STRICT — an exact surface hit with no
   * deinflection trail — because the swallower's NAME is shown to the hand,
   * and 満足する reads as a word where 満足して reads as a typo. lookup()
   * already marks deinflected hits, so strictness costs one predicate.
   */
  private xOracle(): Oracle | undefined {
    if (!this.dictStore.hasDictionaries()) return undefined;
    return {
      deinflect: (s) => deinflect(s),
      // Same truth as lookup(s).some(r => !r.deinflection) — an exact surface
      // hit — but without the deinflection FALLBACK lookup() runs on every
      // miss, and this oracle's calls are almost all misses (く足して…). The
      // boundary test's per-keystroke cost is dominated by exactly that.
      isWord: (s) => this.dictStore.hasExactSurface(s),
    };
  }

  private makeXDeps(): XViewDeps {
    return {
      corpus: this.xCorpus,
      client: this.xClient,
      getSettings: () => this.settings.x,
      saveSettings: () => this.saveSettings(),
      // §29 rung 1 — the query IS a catalog entry, or it is not. When it is,
      // that entry’s class decides what "relevant" means for this list; when
      // it is not, no ordering claim is made and the list is left alone.
      probeFor: (q) => {
        const key = q.trim();
        const e = this.patternStore.all().find((p) => p.key === key);
        return e ? { cls: e.class, key: e.key, payload: e.payload } : undefined;
      },
      // §29 rung 0 — rebuilt per deps call, so importing a dictionary
      // arms the boundary test without a reload.
      oracle: this.xOracle(),
      // §29.2 — a concordance line goes down the SAME road every capture does
      // (§28 S5): the classify modal, with the window as the example and the
      // post as the scene. Not a side channel that writes straight to a store.
      onCaptureLine: (quote, url, handle, hit) => {
        new CaptureModal(this.app, {
          // the concordance line was found BY a query — the capture is already
          // about that surface, so it arrives as the 見出し instead of asking
          // the flick keyboard to retype what the machine just matched.
          text: hit ?? "",
          example: quote,
          source: { kind: "x", medium: "x", url, sourceName: handle ? `@${handle}` : "X" },
        }, this.makeCaptureDeps()).open();
      },
      onSaveCollocation: (surface, example, sourceUrl, parts) => {
        const now = Date.now();
        const id = `x-${now}-${Math.random().toString(36).slice(2, 7)}`;
        // 1) The visible lexicon — this is what CollocationView + search show.
        //    A gapped surface (この…も…まで) keeps its first part as headword.
        const p = parts && parts.length > 0 ? parts : [surface];
        this.store.add({
          id,
          headword: p[0] ?? surface,
          headwordReading: "",
          collocate: p.slice(1).join("…"),
          fullPhrase: surface,
          headwordPOS: PartOfSpeech.Expression,
          collocatePOS: PartOfSpeech.Expression,
          pattern: surface,
          exampleSentences: [example],
          source: CollocationSource.Manual,
          tags: ["x"],
          notes: sourceUrl,
          frequency: 1,
          createdAt: now,
          updatedAt: now,
        });
        this.refreshViews();
        // 2) The discourse/context layer (context cards, resolver joins).
        void this.addEntryFromSurfer({
          id: `${id}-ctx`,
          surface,
          capturedAt: new Date().toISOString(),
          exampleSentences: [{ text: example, source: `x:${sourceUrl}` }],
        });
        // 3) The pattern catalog — tweets must not bypass the unified index
        //    (DESIGN §13.4). Class stays a suggestion until ratified.
        void this.patternStore.record(surface, {
          // §28 S2: the door back. `file` alone identified the tweet but left
          // the renderers guessing at the medium; scene.deepLink is the door.
          source: "x", medium: "x", file: sourceUrl, tStartSec: null,
          scene: { deepLink: sourceUrl, sourceName: "X" },
          quote: example, addedAt: now,
        });
      },
      onClassify: (tweet, selection) => {
        new CaptureModal(this.app, {
          text: selection ?? tweet.text,
          example: tweet.text,
          source: { kind: "x", url: tweet.url },
        }, this.makeCaptureDeps()).open();
      },
      // §28 S1: the X corpus is a view of the SAME lexicon. A tweet holding a
      // pattern already in the 台帳 wears that pattern's class mark here too
      // (patternsIn/openPattern ride in on peekChrome() below).
      onDrop: (intent, files) => void this.runDropIntent(intent, files),
      dropCan: () => this.dropCapabilities(),
      openSurface: (s) => void this.openSurface(s),
      dismiss: () => void this.navBack(),
      ...this.peekChrome(),
      surfaceBadge: (s) => this.surfaceBadge(s),
    };
  }

  /**
   * iOS: launch a two-or-more-term co-occurrence lookup. `raw` is freeform
   * ("今まで 勘案したら" / quoted phrases). Opens the x.com search in the
   * default browser (Orion), where the JP-X-Cooc userscript scrapes the
   * results and calls back into `handleXCapture`. (x.com's SPA won't run in an
   * embedded WebView, so a real browser is required on iOS.)
   */
  async xCoocMobile(raw: string): Promise<void> {
    const terms = parseTerms(raw);
    if (terms.length < 2) {
      new Notice("共起チェックには2語以上必要です（例: 今まで 勘案したら）。語を選択するかコピーしてから実行してください。", 7000);
      return;
    }
    const s = this.settings.x;
    const query = emptyQuery(s.defaultLang, "Latest");
    query.allTerms = terms;
    const { url, rawQuery } = buildBrowserCaptureUrl({
      query,
      vaultName: this.app.vault.getName(),
    });
    new Notice(`X 共起チェック: ${rawQuery} …（ブラウザで取得して戻ります）`, 5000);
    try {
      window.open(url, "_blank");
    } catch {
      new Notice("ブラウザを開けませんでした。", 6000);
    }
  }

  /** Receive the Scriptable capture callback: ingest tweets, then show the answer. */
  async handleXCapture(params: Record<string, string>): Promise<void> {
    const n = parseInt(params.n ?? "0", 10) || 0;
    const total = parseInt(params.total ?? "0", 10) || 0;
    let added = 0;
    if (params.data) {
      try {
        const jsonl = decodeCaptureData(params.data);
        const res = this.xCorpus.importJsonl(jsonl);
        added = res.added;
        await this.xCorpus.save();
      } catch (e) {
        new Notice(`取り込みエラー: ${(e as Error).message}`, 6000);
        return;
      }
    }
    if (n === 0) {
      new Notice(`共起なし（${total}件中で両方を含むツイートは見つかりませんでした）`, 7000);
      return;
    }
    new Notice(`共起 ${n}件（新規 ${added}件 / 走査 ${total}件）`, 5000);
    // Show the matches in the normal view, local-only (no live scrape on mobile).
    const q = params.q ?? "";
    await this.openXView(q || undefined, false);
  }

  /** Open (or reveal) the X search view, optionally seeding a query. */
  async openXView(query?: string, live = true): Promise<void> {
    const leaf = this.surfaceLeaf(JP_X_VIEW_TYPE) ?? undefined;
    {
      if (leaf && leaf.view?.getViewType() !== JP_X_VIEW_TYPE) await leaf.setViewState({ type: JP_X_VIEW_TYPE, active: true });
    }
    if (leaf) {
      this.app.workspace.revealLeaf(leaf);
      if (query) {
        const target = leaf;
        setTimeout(() => (target.view as XSearchView).searchFor(query, live), 150);
      }
    }
  }

  // ── Surfer integration: call surfer commands from collocations ─

  /** Get the jp-sentence-surfer plugin instance if available */
  getSurferPlugin(): any | null {
    const plugins = (this.app as any).plugins as
      | { plugins: Record<string, any> }
      | undefined;
    return plugins?.plugins?.['jp-sentence-surfer'] ?? null;
  }

  /** Check if jp-sentence-surfer is available */
  isSurferAvailable(): boolean {
    return this.getSurferPlugin() !== null;
  }

  loadSettings(): void {
    // settingsSlice EXCLUDES the _store keys — this.settings never carries
    // store snapshots again (the old shape let saveSettings revert every
    // store to its plugin-load state).
    const stored = this.dm.settingsSlice() as Partial<PluginSettings>;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    // settings.x / settings.notes gain fields over time; the shallow merge above
    // replaces whole default sub-objects with stored ones, so backfill new keys.
    this.settings.x = { ...DEFAULT_X_SETTINGS, ...(stored?.x ?? {}) };
    this.settings.notes = { ...DEFAULT_NOTES_CONFIG, ...(stored?.notes ?? {}) };
    this.settings.ytHistory = { ...DEFAULT_YT_HISTORY_SETTINGS, ...(stored?.ytHistory ?? {}) };
    this.settings.voiceSync = { ...DEFAULT_VOICE_SYNC, ...(stored?.voiceSync ?? {}) };
    this.settings.plex = { ...DEFAULT_PLEX_SETTINGS, ...(stored?.plex ?? {}) };
    this.settings.jimaku = { ...DEFAULT_JIMAKU_SETTINGS, ...(stored?.jimaku ?? {}) };
    this.settings.posture = { ...DEFAULT_POSTURE_SETTINGS, ...(stored?.posture ?? {}) };
    // Secrets live device-local (never in the synced blob); the runtime
    // settings object carries the real values, the persisted copy carries ''.
    const ls = (k: string): string => (this.app.loadLocalStorage(k) as string | null) ?? "";
    if (!this.settings.x.authToken) this.settings.x.authToken = ls(SECRET_LS_KEYS.xAuthToken);
    if (!this.settings.x.csrfToken) this.settings.x.csrfToken = ls(SECRET_LS_KEYS.xCsrfToken);
    if (!this.settings.ytHistory.cookie) this.settings.ytHistory.cookie = ls(SECRET_LS_KEYS.ytCookie);
    if (!this.settings.notes.ocrApiKey) this.settings.notes.ocrApiKey = ls(SECRET_LS_KEYS.ocrApiKey);
    if (!this.settings.plex.token) this.settings.plex.token = ls(SECRET_LS_KEYS.plexToken);
    if (!this.settings.jimaku.apiKey) this.settings.jimaku.apiKey = ls(SECRET_LS_KEYS.jimakuApiKey);
  }

  async saveSettings(): Promise<void> {
    const { scrubbed, secrets } = scrubSettingsForPersist(this.settings as unknown as Record<string, unknown>);
    this.app.saveLocalStorage(SECRET_LS_KEYS.xAuthToken, secrets.xAuthToken ?? null);
    this.app.saveLocalStorage(SECRET_LS_KEYS.xCsrfToken, secrets.xCsrfToken ?? null);
    this.app.saveLocalStorage(SECRET_LS_KEYS.ytCookie, secrets.ytCookie ?? null);
    this.app.saveLocalStorage(SECRET_LS_KEYS.ocrApiKey, secrets.ocrApiKey ?? null);
    this.app.saveLocalStorage(SECRET_LS_KEYS.plexToken, secrets.plexToken ?? null);
    this.app.saveLocalStorage(SECRET_LS_KEYS.jimakuApiKey, secrets.jimakuApiKey ?? null);
    await this.dm.setSettings(scrubbed);
  }

  async openTray(): Promise<void> {
    const leaf = this.surfaceLeaf(JP_TRAY_VIEW_TYPE);
    if (!leaf) return;
    if (leaf.view?.getViewType() !== JP_TRAY_VIEW_TYPE) {
      await leaf.setViewState({ type: JP_TRAY_VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  // ── §29 the drop road: one executor for every dragged-in thing ────────────
  //
  // §28 S5 says every medium funnels into the same capture path. Dragging is a
  // medium — the iPad's native one — so it gets no store, no view and no
  // parallel pipeline of its own: `drop-intent.ts` decides what arrived, and
  // this method hands it to the exact code the corresponding command already
  // calls. If a drop can do something a command cannot, one of the two is a bug.

  /** Save a dropped/picked image into the vault and return its path. */
  private async saveInboxImage(name: string, data: ArrayBuffer): Promise<string> {
    const folder = "attachments";
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder).catch(() => {});
    const ext = name.split(".").pop() || "png";
    const path = normalizePath(`${folder}/inbox-${Date.now()}-${Math.floor(Math.random() * 1e4)}.${ext}`);
    await this.app.vault.createBinary(path, data);
    return path;
  }

  /** §22.2 manga: spread-aware bubble OCR (pinned model, bbox-validated). */
  private async ocrMangaImage(vaultPath: string): Promise<Array<{ text: string; bbox: [number, number, number, number] }>> {
    const f = this.app.vault.getFileByPath(vaultPath);
    if (!f) throw new Error("画像が見つかりません");
    const buf = await this.app.vault.readBinary(f);
    const ext = vaultPath.split(".").pop()?.toLowerCase();
    const mediaType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
    const resp = await requestUrl({
      url: CLAUDE_API_URL, method: "POST", throw: false,
      headers: { "x-api-key": this.settings.notes.ocrApiKey, "anthropic-version": CLAUDE_API_VERSION, "content-type": "application/json" },
      body: buildVisionBody({
        apiKey: this.settings.notes.ocrApiKey, model: MANGA_MODEL,
        images: [{ base64: arrayBufferToBase64(buf), mediaType }],
        prompt: MANGA_PROMPT,
      }),
    });
    const r = parseMangaOcr(resp.status, resp.text);
    if (!r.ok) throw new Error(r.error);
    return r.bubbles;
  }

  /** The transcript note already frozen for a video id, if there is one. */
  private findTranscriptByVideoId(videoId: string): TFile | null {
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (fm && parseYouTubeId(String(fm.video ?? fm.videoId ?? "")) === videoId) return f;
    }
    return null;
  }

  /** What every surface's drop router reports capability-wise. */
  dropCapabilities(): { ocr: boolean; x: boolean } {
    return { ocr: !!this.settings.notes.ocrApiKey, x: !this.xClient.configIssue() };
  }

  /**
   * Every file in a carry came back empty. Salvage the drop rather than lose it.
   *
   * The same DataTransfer that promised a file it could not produce usually
   * also carried `text/plain` — Apple Notes ships recognised handwriting text
   * alongside the strokes, and a manga panel arrives with its OCR line. Taking
   * that is a real capture, not a consolation prize, so it is worth saying
   * plainly what landed and what did not.
   *
   * When there is genuinely nothing left, the message names the two gestures
   * that DO work on this device instead of printing a DOM exception at someone
   * holding a Pencil (§28 S6: say what failed, and where it would have worked).
   */
  private async salvageDrop(p: DropIntent["payload"], n: number): Promise<void> {
    const text = (p.url ?? p.text ?? "").trim();
    if (text) {
      const fresh = await this.inboxStore.add(shapeDrop(text, Date.now()));
      this.refreshTrayViews();
      new Notice(fresh ? "⤵ 画像は受け取れませんでしたが、文字はトレイへ" : "同じ内容が既にあります", 8000);
      void this.openTray();
      return;
    }
    new Notice(
      `⤵ ${n}件を受け取れませんでした — 送り元がファイルを渡しきる前に指が離れています。\n` +
      `トレイの上で一拍おいてから離すか、コピーして「📋クリップボードから」で入れてください。`,
      12000,
    );
    void this.openTray();
  }

  /**
   * Execute one routed drop. `where.patternId` is the entry the user dropped
   * ONTO — the only piece of context a surface knows and this method cannot
   * derive.
   */
  async runDropIntent(intent: DropIntent, files: File[], where?: { patternId?: string }): Promise<void> {
    const p = intent.payload;
    const pick = (): File[] => (p.fileIdx ?? []).map((i) => files[i]).filter(Boolean);
    try {
      switch (intent.action) {
        case "yt-transcript": {
          if (!p.videoId) return;
          const existing = this.findTranscriptByVideoId(p.videoId);
          if (existing) {
            new Notice(`すでに取得済みです → ${existing.basename}`, 6000);
            await this.app.workspace.getLeaf(false).openFile(existing);
            return;
          }
          await this.fetchTranscriptFor(p.videoId);
          return;
        }
        case "yt-mark": {
          // A link with a second in it points at a MOMENT. Fetch the transcript
          // if we don't have it, then leave a mark that can re-manifest the
          // line — a bare bookmark with no text would be an orphan (§28 S2).
          if (!p.videoId) return;
          let file = this.findTranscriptByVideoId(p.videoId);
          if (!file) file = await this.fetchTranscriptFor(p.videoId);
          await this.inboxStore.add(markCard({
            medium: "yt",
            file: file?.path,
            tSec: p.tSec ?? 0,
            sourceName: file?.basename,
            wallClock: Date.now(),
          }, Date.now()));
          this.refreshTrayViews();
          new Notice(`📍 ${fmtStamp(p.tSec ?? 0)} をトレイにマークしました${file ? `（${file.basename}）` : ""}`, 6000);
          void this.openTray();
          return;
        }
        case "x-post": {
          if (!p.tweetId) return;
          const issue = this.xClient.configIssue();
          if (issue) { new Notice(`𝕏: ${issue}`, 8000); return; }
          const notice = new Notice("𝕏 投稿を取得中…", 0);
          try {
            const tweet = await this.xClient.fetchTweetById(p.tweetId);
            notice.hide();
            if (!tweet) { new Notice("投稿を取得できませんでした（削除・鍵アカウントの可能性）", 8000); return; }
            const added = this.xCorpus.addTweets([tweet]);
            await this.xCorpus.save();
            new Notice(added ? `𝕏 @${tweet.authorHandle} をコーパスへ` : "すでにコーパスにあります", 6000);
            await this.openXView(undefined, false);
          } catch (e) { notice.hide(); throw e; }
          return;
        }
        case "subtitle": {
          let srt = p.srt ?? "";
          let title = p.title ?? "";
          const f = pick()[0];
          if (f) { srt = await f.text(); title = title || titleFromFilename(f.name); }
          if (!srt.trim()) { new Notice("字幕の中身が読めませんでした", 6000); return; }
          if (!title) title = `字幕 ${new Date().toISOString().slice(0, 10)}`;
          const { content, cueCount } = srtToNote({ srt, title });
          if (cueCount < 5) { new Notice("字幕を解析できませんでした（cue が5件未満）", 8000); return; }
          const folder = this.settings.notes.transcriptFolder || "Transcripts";
          if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder).catch(() => {});
          const path = normalizePath(`${folder}/${title.replace(/[\\/:*?"<>|]/g, "")}.md`);
          const out = this.app.vault.getFileByPath(path) ?? await this.app.vault.create(path, content);
          new Notice(`📺 ${cueCount}行のトランスクリプト → ${out.basename}`, 8000);
          await this.app.workspace.getLeaf(false).openFile(out);
          return;
        }
        case "history": {
          const { videos, source } = parseHistory(p.text ?? "");
          if (!videos.length) { new Notice("視聴履歴として読めませんでした", 8000); return; }
          const cap = Math.max(1, this.settings.notes.maxHistoryVideos || 20);
          await this.fetchTranscriptsForVideos(videos.slice(0, cap), { source, detected: videos.length, openLog: true });
          return;
        }
        case "image-pair": {
          // One carry, one card. The image is the evidence and the text is
          // what it says; splitting them here would just recreate the pairing
          // work by hand that this action exists to remove.
          const chosen = pick();
          const said = (p.text ?? "").trim();
          let added = 0;
          let unreadable = 0;
          // A selection that spanned a picture and its sentence: the image is
          // already in the vault, so there is nothing to read and nothing to
          // save — only the pairing was ever missing. Confirmed once more here
          // because the tray renders a card by asking the vault for the path,
          // and a card whose path resolves to nothing is a broken image with
          // no explanation attached (§28 S6).
          for (const path of p.imagePaths ?? []) {
            const real = this.resolveVaultPath(path);
            if (!real) { unreadable++; continue; }
            if (await this.inboxStore.add(pairedCard(real, said, Date.now()))) added++;
          }
          for (const f of chosen) {
            const data = await dropBytes(f);
            if (!data) { unreadable++; continue; }
            const path = await this.saveInboxImage(f.name, data);
            if (await this.inboxStore.add(pairedCard(path, said, Date.now()))) added++;
          }
          // The picture never materialised, but the words did — and the words
          // alone are still a capture worth keeping (§28 S6).
          if (!added && unreadable) { await this.salvageDrop(p, unreadable); return; }
          this.refreshTrayViews();
          new Notice(added ? `🖼 ${added}件を文つきでトレイへ` : "同じ内容が既にあります", 6000);
          void this.openTray();
          return;
        }
        case "image-ocr":
        case "image-tray": {
          const chosen = pick();
          let added = 0;
          let unreadable = 0;
          const paths: string[] = [];
          // A picture that is already in the vault — carried out of a note, or
          // out of the tray and back — needs no saving, only a card. Without
          // this branch such a carry produced 「📷 0枚をトレイへ」, which is a
          // report of success on a drop that did nothing (§28 S6).
          for (const held of p.imagePaths ?? []) {
            const real = this.resolveVaultPath(held);
            if (!real) { unreadable++; continue; }
            if (await this.inboxStore.add(imageCard(real, Date.now()))) { added++; paths.push(real); }
          }
          for (const f of chosen) {
            const data = await dropBytes(f);
            // A promised file the platform never materialised. Skipping it and
            // carrying on is the whole point: one dead payload used to take the
            // entire carry with it.
            if (!data) { unreadable++; continue; }
            const path = await this.saveInboxImage(f.name, data);
            if (await this.inboxStore.add(imageCard(path, Date.now()))) { added++; paths.push(path); }
          }
          if (!added && unreadable) { await this.salvageDrop(p, unreadable); return; }
          this.refreshTrayViews();
          new Notice(added ? `📷 ${added}枚をトレイへ` : "同じ内容が既にあります", 5000);
          void this.openTray();
          if (intent.action === "image-ocr" && this.settings.notes.ocrApiKey) {
            let ok = 0;
            const failed: string[] = [];
            const prog = new Notice(`🔎 OCR 0/${paths.length}…`, 0);
            for (const [i, path] of paths.entries()) {
              prog.setMessage(`🔎 OCR ${i + 1}/${paths.length}…`);
              try {
                await this.inboxStore.setBubbles((await this.inboxStore.all().find((c) => c.content === path))!.id,
                  await this.ocrMangaImage(path));
                ok++;
              } catch (e) { failed.push(`${path.split("/").pop()}: ${String(e)}`); }
            }
            prog.hide();
            this.refreshTrayViews();
            new Notice(failed.length ? `🔎 ${ok}枚OK / ${failed.length}枚失敗\n${failed.join("\n")}` : `🔎 ${ok}枚の吹き出しを抽出`, 8000);
          }
          return;
        }
        case "attest": {
          // The payoff of the whole gesture: a line carried in from Notes
          // becomes a CONFIRMED 用例 on the entry you dropped it on. Confirmed,
          // not suggested — a hand carried it here, and §28 S3's provisionality
          // rule is about MACHINE output, not about yours.
          const entry = where?.patternId ? this.patternStore.byId(where.patternId) : undefined;
          const text = (p.text ?? "").trim();
          if (!entry || !text) return;
          const n = await this.patternStore.addAttestations([{
            id: entry.id,
            att: {
              source: "manual", medium: "note", quote: text, addedAt: Date.now(),
              matchKind: "drop", scene: { sourceName: "手渡し" },
            },
          }]);
          this.refreshViews();
          new Notice(n ? `📎 「${entry.key}」に用例を追加しました` : "同じ用例がすでにあります", 6000);
          return;
        }
        case "capture": {
          const text = (p.text ?? "").trim();
          if (!text) return;
          // A word is the notation; a sentence is the EVIDENCE for a notation
          // you have yet to name. Prefilling the wrong field is what makes a
          // capture modal feel like a form instead of a catch.
          const short = [...text].length <= 40 && !/[。！？\n]/.test(text);
          new CaptureModal(this.app, {
            text: short ? text : "",
            example: short ? undefined : text,
            source: { kind: "manual", sourceName: "ドロップ" },
          }, this.makeCaptureDeps()).open();
          return;
        }
        case "lookup": {
          await this.openDictionaryView((p.text ?? "").trim());
          return;
        }
        case "x-search": {
          await this.openXView(`"${(p.text ?? "").trim()}"`);
          return;
        }
        case "reach": {
          const want = (p.text ?? "").trim();
          if (!want) return;
          await this.reachStore.add(want, Date.now());
          this.refreshTrayViews();
          new Notice(`🕯 願い「${want}」を保持しました — 届いたものが並べられます`, 8000);
          void this.openTray();
          return;
        }
        case "link":
        case "tray": {
          const chosen = pick();
          if (chosen.length) {
            let added = 0;
            let unreadable = 0;
            for (const f of chosen) {
              const data = await dropBytes(f);
              if (!data) { unreadable++; continue; }
              const path = await this.saveInboxImage(f.name, data);
              if (await this.inboxStore.add(imageCard(path, Date.now()))) added++;
            }
            // `!unreadable` with nothing added means every file was already
            // here — a duplicate, not a failure, and it keeps its old wording.
            if (added || !unreadable) {
              this.refreshTrayViews();
              new Notice(added ? `⤵ ${added}件をトレイへ` : "同じ内容が既にあります", 5000);
              void this.openTray();
              return;
            }
            await this.salvageDrop(p, unreadable);
            return;
          }
          const text = (p.url ?? p.text ?? "").trim();
          if (!text) return;
          const fresh = await this.inboxStore.add(shapeDrop(text, Date.now()));
          this.refreshTrayViews();
          new Notice(fresh ? "⤵ トレイへ" : "同じ内容が既にあります", 5000);
          void this.openTray();
          return;
        }
      }
    } catch (e) {
      // §28 S6: say what failed, where it would have happened, verbatim.
      console.error("[jp-collocations] drop failed:", e);
      new Notice(`${intent.icon} ${intent.label} に失敗しました\n${String(e)}`, 12000);
    }
  }

  /**
   * §29.2 — the 𝕏 corpus profile for one catalog entry.
   *
   * Probes the entry's longest sweep term: a 🟠 link entry has several parts
   * and a concordance needs ONE column to align on, so aligning on the most
   * distinctive part is the only choice that produces a readable stack. Null
   * when the corpus has nothing, which renders as no box at all.
   */
  xUsageFor(p: PatternEntry): XUsage | null {
    const terms = sweepTerms(p);
    if (!terms.length) return null;
    const probe = terms.reduce((a, b) => (b.length > a.length ? b : a), terms[0]);
    const u = buildXUsage(this.xCorpus.getAll(), probe, this.xCorpus.size());
    return u.hits ? u : null;
  }

  /**
   * Attach ONE concordance line as a 用例 — the window, not the tweet.
   *
   * Confirmed rather than suggested, unlike the bulk corpus join: this one the
   * user picked by hand off a line they could read, which is the whole of the
   * §28 S3 distinction. The hand is the classifier.
   */
  async attachXLine(p: PatternEntry, quote: string, url: string, handle: string): Promise<void> {
    const n = await this.patternStore.addAttestations([{
      id: p.id,
      att: {
        source: "x", medium: "x", file: url, quote, addedAt: Date.now(),
        scene: { deepLink: url, sourceName: handle ? `@${handle}` : "X" },
      },
    }]);
    this.refreshViews();
    new Notice(n ? `📎 「${p.key}」に 𝕏 の用例を追加しました` : "同じ用例がすでにあります", 5000);
  }

  /** §26.3 step 5 — where the identity bar sends you. */
  /**
   * ONE leaf-picking rule for every surface.
   *
   * Five of the six used to call `getRightLeaf(false)` unconditionally. That is
   * a resizable panel on a desktop and a FIXED NARROW DRAWER on mobile, so a
   * 1366px iPad was rendering the 辞書 in a phone-width column — the "shrunk
   * up" complaint, and not the views' fault at all. Off the desk, a surface now
   * takes the main pane at full width; `suite-nav` makes that safe by making
   * the way back one press.
   *
   * An already-open leaf always wins, so toggling never accumulates tabs.
   */
  private surfaceLeaf(viewType: string): WorkspaceLeaf | null {
    const existing = this.app.workspace.getLeavesOfType(viewType)[0];
    if (existing) return existing;
    return presentation(posture(), window.innerWidth) === "side"
      ? this.app.workspace.getRightLeaf(false)
      : this.app.workspace.getLeaf("tab");
  }

  /** Raw navigation: put me on that surface. No history — see `openSurface`. */
  private async openSurfaceRaw(s: Surface): Promise<void> {
    if (s === "lexicon") { await this.openLexiconView(); return; }
    if (s === "dict") { await this.openDictionaryView(); return; }
    if (s === "x") { await this.openXView(undefined, false); return; }
    if (s === "tray") { await this.openTray(); return; }
    if (s === "review") { await this.openReviewView(); return; }
    if (s === "capture") { await this.openPipelineView(); return; }
  }

  /**
   * THE verb (§26.3 step 6). Press it away from a surface and you go there;
   * press it while you are there and you land back where you summoned it from,
   * cursor and scroll intact. One binding, both directions — which is what
   * "go to and from" costs, and why the surface bar routes through here.
   */
  async openSurface(s: Surface): Promise<void> {
    const r = navToggle(this.navStack, s, this.capturePlace());
    this.navStack = r.stack;
    if (r.to) await this.restorePlace(r.to);
    else await this.openSurfaceRaw(s);          // nowhere behind — stay put, don't blank
  }

  /**
   * Move along the bar. Clamped, never wrapped — on a gesture (unlike a menu)
   * a wrap reads as a misfire, while stopping tells you where the end is.
   *
   * Deliberately NOT the toggle: a swipe is a traversal, and if it toggled you
   * could never swipe past the surface you are standing on.
   */
  private stepSurface(by: number): void {
    const cur = this.capturePlace();
    const at = cur?.kind === "surface" ? SURFACE_ORDER.indexOf(cur.surface) : -1;
    // From the editor, either direction enters at the near end rather than
    // doing nothing — a swipe that appears dead is worse than one that guesses.
    const next = at < 0 ? (by > 0 ? 0 : SURFACE_ORDER.length - 1) : stepIndex(SURFACE_ORDER.length, at, by);
    if (next === at) return;                       // already at the end; let it be felt
    this.navStack = navGoTo(this.navStack, { kind: "surface", surface: SURFACE_ORDER[next] }, undefined);
    void this.openSurfaceRaw(SURFACE_ORDER[next]);
  }

  /** Text scale for the plugin's own surfaces. `reset` overrides `by`. */
  private async stepDensity(by: number, reset = false): Promise<void> {
    const next = clampDensity(reset ? DENSITY_DEFAULT : this.density + by);
    if (next === this.density && !reset) return;
    this.density = next;
    this.applyDensity();
    new Notice(`表示 ${densityLabel(next)}`, 900);
    this.settings.posture = { ...(this.settings.posture ?? {}), density: next };
    await this.saveSettings();
  }

  /**
   * One custom property, consumed by one stylesheet rule. Multiplicative on the
   * theme's own text size rather than absolute px, so a vault already running
   * large text stays proportional instead of being overridden.
   */
  private applyDensity(): void {
    document.body?.style.setProperty("--jp-scale", String(densityScale(this.density)));
  }

  /** Step back one place. Bound to a command and to mouse button 3. */
  async navBack(): Promise<void> {
    const cur = this.capturePlace();
    if (cur) this.navStack = navGoTo(this.navStack, cur);
    const r = navBackStep(this.navStack);
    if (!r.to) { new Notice("戻る先がありません"); return; }
    this.navStack = r.stack;
    await this.restorePlace(r.to);
  }

  /**
   * What `navBack` would land on, NAMED — so the edge drag can say where it
   * goes before you commit to it, and can decline to arm at all when there is
   * nowhere behind you.
   *
   * Mirrors `navBack`'s own first two steps rather than reading the raw stack.
   * `navBack` refreshes the current place before stepping, and a peek that
   * skipped that would name the wrong destination on a re-entry — a gesture
   * that promises 辞書 and delivers the note is worse than no gesture.
   */
  navPeek(): string | null {
    const cur = this.capturePlace();
    const stack = cur ? navGoTo(this.navStack, cur) : this.navStack;
    const r = navBackStep(stack);
    if (!r.to) return null;
    if (r.to.kind === "editor") {
      const base = r.to.path.split("/").pop() ?? "";
      return base.replace(/\.md$/i, "") || "ノート";
    }
    return SURFACE_LABEL[r.to.surface] ?? null;
  }

  /** Where am I right now, with enough state to be PUT BACK rather than
   *  merely re-opened? Null when it is something the suite does not own. */
  private capturePlace(): Place | null {
    const md = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (md?.file) {
      const cur = md.editor?.getCursor();
      let scroll: number | undefined;
      try { scroll = md.editor?.getScrollInfo()?.top; } catch { /* no editor yet */ }
      return { kind: "editor", path: md.file.path, line: cur?.line, ch: cur?.ch, scroll };
    }
    const type = this.app.workspace.getMostRecentLeaf()?.view?.getViewType?.();
    const s = type ? SURFACE_BY_VIEW_TYPE[type] : undefined;
    return s ? { kind: "surface", surface: s } : null;
  }

  private async restorePlace(p: Place): Promise<void> {
    if (p.kind === "surface") { await this.openSurfaceRaw(p.surface); return; }
    const f = this.app.vault.getAbstractFileByPath(p.path);
    if (!(f instanceof TFile)) return;                       // renamed or deleted
    const open = this.app.workspace.getLeavesOfType("markdown")
      .find((l) => (l.view as MarkdownView).file?.path === p.path);
    const leaf = open ?? this.app.workspace.getLeaf(false);
    if (!open) await leaf.openFile(f);
    this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (!(view instanceof MarkdownView) || p.line == null) return;
    // after the leaf paints, or setCursor lands on a document that is not laid
    // out yet and the scroll is discarded
    window.setTimeout(() => {
      try {
        view.editor.setCursor({ line: p.line ?? 0, ch: p.ch ?? 0 });
        if (p.scroll != null) view.editor.scrollTo(0, p.scroll);
      } catch { /* the leaf moved on; nothing to restore onto */ }
    }, 0);
  }

  /** Live counts for the identity bar. A zero renders as no badge at all. */
  surfaceBadge(s: Surface): number | undefined {
    if (s === "tray") return this.inboxStore.all().length || undefined;
    if (s === "review") {
      const ids = this.patternStore.all().map((e) => e.id);
      const c = this.srsStore.counts(ids);
      return (c.due + c.learn) || undefined;
    }
    return undefined;
  }

  /** §25.2 鑑賞モード: open FollowAlong on a transcript note (active file by
   *  default). Soft-gates on timestamps — the view warns rather than refuses. */
  async openFollowAlong(file?: TFile): Promise<void> {
    const f = file ?? this.app.workspace.getActiveFile();
    if (!f) { new Notice("トランスクリプトのノートを開いてから実行してください"); return; }
    const existing = this.app.workspace.getLeavesOfType(JP_FOLLOW_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: JP_FOLLOW_VIEW_TYPE, active: true, state: { file: f.path } });
    this.app.workspace.revealLeaf(leaf);
  }

  /** §25.4 Plex clock (b): poll /status/sessions. All transport lives here; all
   *  Plex knowledge lives in notes/plex.ts. Returns sessions or a verbatim error
   *  so FollowAlong can degrade soft to the manual clock (c). */
  async fetchPlexSessions(): Promise<PlexSessionsResult> {
    const { baseUrl, token } = this.settings.plex;
    if (!baseUrl.trim() || !token.trim()) return { ok: false, error: "Plex の baseUrl / token が未設定です。" };
    let resp;
    try {
      resp = await requestUrl({ url: plexSessionsUrl(baseUrl, token), method: "GET", headers: { Accept: "application/json" }, throw: false });
    } catch (e) {
      // A transport failure is never an auth failure — see the helper.
      return { ok: false, error: explainPlexTransportError(baseUrl, (e as Error).message) };
    }
    return parsePlexSessions(resp.status, resp.text ?? "");
  }

  /**
   * §25.4 — the subtitle of what is playing, as a transcript note.
   *
   * This is the piece the Plex integration was missing. The server knows which
   * episode is on AND carries its subtitle tracks; until now nothing asked, so
   * Plex contributed a clock and a clip cutter over a transcript you had to
   * source from jimaku by hand and paste into a modal. That manual step was the
   * seam: everything downstream — reconcile, sweep, 談話モード, ⚡ — already
   * worked, but only if you had already done the one thing the plugin could
   * have done for you.
   *
   * No new transcript machinery: `srtToNote` produces the same note the manual
   * import does, so a Plex episode is not a different kind of object. The
   * server's ids go into its frontmatter, which is what lets the note find its
   * media again tomorrow instead of only while it happens to be playing.
   */
  async plexSubtitleToTranscript(): Promise<string> {
    const { baseUrl, token } = this.settings.plex;
    if (!baseUrl.trim() || !token.trim()) {
      new Notice("設定 → Plex に baseUrl と X-Plex-Token を入力してください。", 8000);
      return "plex not configured";
    }
    const notice = new Notice("Plex: 再生中のエピソードを探しています…", 0);
    try {
      const res = await this.fetchPlexSessions();
      if (!res.ok) { new Notice(res.error, 10000); return res.error; }
      if (!res.sessions.length) {
        const m = "Plex で再生中の作品がありません。再生してからもう一度実行してください。";
        new Notice(m, 8000); return m;
      }
      // One session → that one. Several → the one matching the open note.
      const active = this.app.workspace.getActiveFile();
      const cache = active ? this.app.metadataCache.getFileCache(active)?.frontmatter : undefined;
      const session = pickPlexSession(res.sessions, {
        title: (cache?.title as string) ?? active?.basename,
        show: cache?.show as string | undefined,
      }) ?? (res.sessions.length === 1 ? res.sessions[0] : null);
      if (!session) {
        const m = `Plex で${res.sessions.length}件再生中です。どれか判別できないので、`
          + `対象のノートを開いてから実行してください（${res.sessions.map((s) => s.title).join("、")}）。`;
        new Notice(m, 12000); return m;
      }

      return await this.plexTranscriptFor({
        ratingKey: session.ratingKey,
        title: session.title,
        show: session.show,
        partKey: session.partKey,
        streams: session.streams,
        episodeIndex: session.episodeIndex,
        seasonIndex: session.seasonIndex,
      }, notice);
    } finally {
      notice.hide();
    }
  }

  /**
   * Subtitle → transcript note for ONE episode, however it was chosen: the
   * live session, or a pick out of the library browser. Shared deliberately —
   * two ways in must not mean two kinds of transcript note (§28 S5, one road).
   */
  async plexTranscriptFor(
    ep: {
      ratingKey?: string; title: string; show?: string; partKey?: string;
      streams?: PlexStream[]; episodeIndex?: number; seasonIndex?: number;
    },
    notice?: Notice,
  ): Promise<string> {
    const say = (m: string): void => { notice?.setMessage(m); };

    // Already have this episode? Open it. A second transcript of the same
    // media is not a fresh start — it is a fork that silently orphans every
    // mark, capture and clip made against the first one (§28 S2: a noticing
    // must not lose reachability). The check is first because it also saves
    // the download.
    if (ep.ratingKey) {
      const existing = this.findTranscriptByRatingKey(ep.ratingKey);
      if (existing) {
        void this.app.workspace.openLinkText(existing.path, "", false);
        const m = `📺 このエピソードのトランスクリプトは既にあります: ${existing.path}`;
        new Notice(m + "\n（別の字幕で作り直すには jimaku の選択画面から）", 8000);
        return m;
      }
    }

    // A session response does not always carry Part.Stream[]; the metadata
    // endpoint does — and it also carries the partKey (the clip door) and the
    // episode NUMBER (what an external subtitle source must be asked for).
    let streams = ep.streams ?? [];
    let partKey = ep.partKey;
    let episodeIndex = ep.episodeIndex;
    let seasonIndex = ep.seasonIndex;
    if (ep.ratingKey && (!streams.some((s) => s.streamType === 3) || !partKey || episodeIndex == null)) {
      say("Plex: エピソード情報を問い合わせ中…");
      const meta = await this.fetchPlexMeta(ep.ratingKey);
      if (meta) {
        if (!streams.some((s) => s.streamType === 3)) streams = meta.streams;
        partKey = partKey ?? meta.partKey;
        episodeIndex = episodeIndex ?? meta.episodeIndex;
        seasonIndex = seasonIndex ?? meta.seasonIndex;
      }
    }
    // Last resort for the episode number: the title itself ("S01E04", 第4話).
    if (episodeIndex == null) {
      const fromTitle = episodeNumberFrom(ep.title);
      episodeIndex = fromTitle.episode;
      seasonIndex = seasonIndex ?? fromTitle.season;
    }

    const jm = this.settings.jimaku;
    const jimakuOn = !!jm.apiKey.trim() && jm.mode !== "off";
    const jimakuFirst = jimakuOn && jm.mode === "always";
    const why: string[] = [];

    // Two sources, one road. Which is tried first is a setting, because the
    // muxed track is guaranteed to be in sync while jimaku's is guaranteed to
    // be Japanese — neither is always the better answer.
    let got = jimakuFirst ? null : await this.plexEmbeddedSubtitle(streams, say);
    if (!got?.ok && !jimakuFirst && got) why.push(got.why);

    if (!got?.ok && jimakuOn) {
      const j = await this.jimakuSubtitleFor(
        { show: ep.show, title: ep.title, episode: episodeIndex, season: seasonIndex }, say,
      );
      if (j.ok) got = j;
      else {
        why.push(j.why);
        // Ambiguous is not failure: it is a question. Hand it to the picker
        // rather than guessing at a transcript that would look correct.
        if (j.ambiguous) {
          this.openJimakuPicker({
            query: jimakuQueryFor(ep), episode: episodeIndex, season: seasonIndex,
          }, { ratingKey: ep.ratingKey, partKey, title: ep.title, show: ep.show, seasonIndex });
          return `📺 jimaku: 候補が複数あります — 選んでください`;
        }
      }
    }
    if (!got?.ok && jimakuFirst) {
      const p = await this.plexEmbeddedSubtitle(streams, say);
      if (p.ok) got = p; else why.push(p.why);
    }

    if (!got?.ok) {
      // Say what each source had and why none of it was usable — an empty
      // transcript with no explanation is the failure this replaces (§28 S6).
      const list = describeSubtitles(streams);
      const tail = !jimakuOn && jm.mode !== "off"
        ? "\n設定 → jimaku に API キーを入れると、Plex に日本語字幕がない作品も取り込めます。"
        : "";
      const m = `${ep.title}: ${why.join("\n") || "字幕を選べませんでした。"}`
        + (list.length ? `\n${list.join("\n")}` : "") + tail;
      new Notice(m, 20000);
      return m;
    }

    return await this.writeTranscriptNote({
      srt: got.text,
      title: ep.title || "Plex episode",
      show: ep.show,
      subSource: got.source,
      episode: { season: seasonIndex, episode: episodeIndex },
      plex: { ratingKey: ep.ratingKey, partKey, lang: got.lang },
      jimaku: got.jimaku,
      // A subtitle that did not come out of the video file can be time-shifted
      // from it; the field exists so 鑑賞モード's ⌖ has somewhere to write.
      subOffsetSec: got.source === "jimaku" ? 0 : undefined,
      codec: got.codec,
    });
  }

  /** A transcript note already made from this Plex episode, if there is one. */
  private findTranscriptByRatingKey(ratingKey: string): TFile | null {
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (fm && String(fm.plex_rating_key ?? "") === ratingKey) return f;
    }
    return null;
  }

  /** Source A: the subtitle muxed into the media Plex is serving. */
  private async plexEmbeddedSubtitle(
    streams: PlexStream[], say: (m: string) => void,
  ): Promise<SubtitleFetch> {
    const { baseUrl, token } = this.settings.plex;
    const langPref = (this.settings.notes.langPref || "ja")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const pick = pickSubtitleStream(streams, { langPref: [...langPref, "jpn", "japanese"] });
    if (!pick?.key) {
      return { ok: false, why: `Plex: ${subtitleRefusal(streams) ?? "字幕を選べませんでした。"}` };
    }
    say(`Plex: 字幕を取得中… (${pick.languageCode ?? pick.language ?? "?"}/${pick.codec ?? "?"})`);
    try {
      const r = await requestUrl({ url: plexStreamUrl(baseUrl, pick.key, token), method: "GET", throw: false });
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      return {
        ok: true, source: "plex", text: r.text ?? "",
        lang: pick.languageCode ?? pick.language, codec: pick.codec,
      };
    } catch (e) {
      return { ok: false, why: `Plex: 字幕の取得に失敗 (${(e as Error).message})` };
    }
  }

  /**
   * Source B: jimaku.cc.
   *
   * Auto only where auto is honest — one clearly-matching work AND one file
   * that names the episode. Anything else returns `ambiguous`, and the caller
   * opens the picker. The machine is a recall machine (DESIGN §12): a
   * confidently wrong release here reads as a perfectly normal transcript.
   */
  private async jimakuSubtitleFor(
    ref: { show?: string; title: string; episode?: number; season?: number },
    say: (m: string) => void,
  ): Promise<SubtitleFetch> {
    const query = jimakuQueryFor(ref);
    if (!query) return { ok: false, why: "jimaku: 検索できる作品名がありません。" };
    say(`jimaku: 「${query}」を検索中…`);
    const found = await this.jimakuSearch(query);
    if (!found.ok) return { ok: false, why: `jimaku: ${found.error}` };
    if (!found.entries.length) {
      return { ok: false, why: `jimaku: 「${query}」が見つかりません。`, ambiguous: true };
    }
    const entryPick = pickJimakuEntry(found.entries, query, ref.season);
    if (!entryPick.entry || !entryPick.confident) {
      return {
        ok: false, ambiguous: true,
        why: `jimaku: 「${query}」の候補が${found.entries.length}件あり、確定できません。`,
      };
    }
    say(`jimaku: ${entryPick.entry.name} のファイル一覧…`);
    const files = await this.jimakuFiles(entryPick.entry.id, ref.episode);
    if (!files.ok) return { ok: false, why: `jimaku: ${files.error}` };
    const filePick = pickJimakuFile(files.files, { episode: ref.episode });
    if (!filePick.file || !filePick.confident) {
      const refusal = jimakuFileRefusal(files.files, ref.episode);
      return {
        ok: false, ambiguous: !refusal || filePick.ranked.length > 0,
        why: `jimaku: ${refusal ?? `${entryPick.entry.name} に候補が${filePick.ranked.length}件あり、確定できません。`}`,
      };
    }
    say(`jimaku: ${filePick.file.name} を取得中…`);
    const text = await this.fetchJimakuFile(filePick.file);
    if (!text.ok) return { ok: false, why: `jimaku: ${text.error}` };
    return {
      ok: true, source: "jimaku", text: text.text, lang: "ja",
      jimaku: { entryId: entryPick.entry.id, fileName: filePick.file.name, url: filePick.file.url },
    };
  }

  /**
   * Write the standard transcript note. ONE writer for every subtitle source,
   * so a jimaku episode and a Plex episode are the same kind of object and
   * everything downstream — 照合・走査・談話モード・⚡ — needs to know nothing
   * about where the text came from (§28 S5).
   */
  async writeTranscriptNote(opts: {
    srt: string; title: string; show?: string;
    subSource: "plex" | "jimaku";
    episode?: { season?: number; episode?: number };
    plex?: { ratingKey?: string; partKey?: string; lang?: string };
    jimaku?: { entryId?: number; fileName?: string; url?: string };
    subOffsetSec?: number;
    codec?: string;
  }): Promise<string> {
    const { content, cueCount } = srtToNote({
      srt: opts.srt, title: opts.title, sourceName: opts.show, subSource: opts.subSource,
      episode: opts.episode, plex: opts.plex, jimaku: opts.jimaku, subOffsetSec: opts.subOffsetSec,
    });
    if (cueCount < 5) {
      const m = `字幕を解析できませんでした（${cueCount}行）。`
        + (opts.codec ? `形式: ${opts.codec}。` : "")
        + "別のトラック / 別のファイルを選ぶか、.srt を手動で取り込んでください。";
      new Notice(m, 15000); return m;
    }
    const folder = this.settings.notes.transcriptFolder || "Transcripts";
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {});
    }
    const safe = `${opts.show ? `${opts.show} — ` : ""}${opts.title}`.replace(/[\\/:*?"<>|]/g, "");
    let path = `${folder}/${safe}.md`;
    if (this.app.vault.getAbstractFileByPath(path)) {
      // Never clobber a transcript that may already carry marks.
      path = `${folder}/${safe} (${new Date().toISOString().slice(11, 16).replace(":", "")}).md`;
    }
    await this.app.vault.create(path, content);
    void this.app.workspace.openLinkText(path, "", false);
    const via = opts.subSource === "jimaku" ? `jimaku: ${opts.jimaku?.fileName ?? ""}` : "Plex 内蔵字幕";
    const msg = `📺 ${cueCount}行のトランスクリプトを作成: ${path}`;
    new Notice(`${msg}\n（${via}）`, 8000);
    return msg;
  }

  /** §25.4 — pick an episode from the library instead of from live playback. */
  openPlexBrowse(): void {
    const { baseUrl, token } = this.settings.plex;
    if (!baseUrl.trim() || !token.trim()) {
      new Notice("設定 → Plex に baseUrl と X-Plex-Token を入力してください。", 8000);
      return;
    }
    const get = async (url: string): Promise<PlexItemsResult> => {
      try {
        const r = await requestUrl({
          url, method: "GET", headers: { Accept: "application/json" }, throw: false,
        });
        return parsePlexItems(r.status, r.text ?? "");
      } catch (e) {
        return { ok: false, error: explainPlexTransportError(baseUrl, (e as Error).message) };
      }
    };
    new PlexBrowseModal(this.app, {
      sections: () => get(plexSectionsUrl(baseUrl, token)),
      sectionItems: (key) => get(plexSectionItemsUrl(baseUrl, key, token)),
      episodes: (ratingKey) => get(plexLeavesUrl(baseUrl, ratingKey, token)),
      search: (q) => get(plexSearchUrl(baseUrl, q, token)),
      // So the browser can flag episodes you have already transcribed instead of
      // letting you find out after a round trip.
      hasTranscript: (ratingKey) => !!this.findTranscriptByRatingKey(ratingKey),
      openEpisode: (item) => this.plexTranscriptFor({
        ratingKey: item.ratingKey,
        title: item.type === "episode" ? episodeLabel(item) : item.title,
        show: item.grandparentTitle,
        episodeIndex: item.type === "episode" ? item.index : undefined,
        seasonIndex: item.parentIndex,
      }),
    }).open();
  }

  /** `/library/metadata/{ratingKey}` → streams, partKey and episode numbers. */
  async fetchPlexMeta(ratingKey: string): Promise<PlexMediaMeta | null> {
    const { baseUrl, token } = this.settings.plex;
    try {
      const r = await requestUrl({
        url: plexMetadataUrl(baseUrl, ratingKey, token), method: "GET",
        headers: { Accept: "application/json" }, throw: false,
      });
      return parsePlexMediaMeta(r.status, r.text ?? "");
    } catch {
      return null;
    }
  }

  /** `/library/metadata/{ratingKey}` → the Part's streams. Kept as the narrow
   *  door for the plugin-to-plugin API; internally use `fetchPlexMeta`. */
  async fetchPlexStreams(ratingKey: string): Promise<PlexStream[]> {
    return (await this.fetchPlexMeta(ratingKey))?.streams ?? [];
  }

  // ── §25.4b jimaku.cc — subtitles for media that carries none ──────────────
  // Transport only. Every URL, every field name and every choice among files
  // lives in notes/jimaku.ts; this layer moves bytes and nothing else.

  /**
   * Search jimaku for a work.
   *
   * TWO requests, merged: the API's `anime` filter defaults to true, so a
   * live-action drama is invisible to the default search — and live action is
   * precisely the half of a library whose files have no Japanese track muxed
   * in, i.e. the reason this code exists at all. Anime results rank first
   * only by score, not by which request found them.
   */
  async jimakuSearch(query: string): Promise<JimakuEntriesResult> {
    const key = this.settings.jimaku.apiKey;
    if (!key.trim()) return { ok: false, error: "API キーが未設定です。" };
    const one = async (anime: boolean): Promise<JimakuEntriesResult> => {
      try {
        const r = await requestUrl({
          url: jimakuSearchUrl({ query, anime }), method: "GET",
          headers: jimakuHeaders(key), throw: false,
        });
        return parseJimakuEntries(r.status, r.text ?? "", r.headers as Record<string, string>);
      } catch (e) {
        return { ok: false, error: `jimaku.cc に接続できません（${(e as Error).message}）。` };
      }
    };
    const [anime, live] = await Promise.all([one(true), one(false)]);
    if (!anime.ok && !live.ok) return anime;             // same failure both ways
    const seen = new Set<number>();
    const entries: JimakuEntry[] = [];
    for (const r of [anime, live]) {
      if (!r.ok) continue;
      for (const e of r.entries) if (!seen.has(e.id)) { seen.add(e.id); entries.push(e); }
    }
    return { ok: true, entries };
  }

  async jimakuFiles(entryId: number, episode?: number): Promise<JimakuFilesResult> {
    const key = this.settings.jimaku.apiKey;
    if (!key.trim()) return { ok: false, error: "API キーが未設定です。" };
    try {
      const r = await requestUrl({
        url: jimakuFilesUrl(entryId, episode), method: "GET",
        headers: jimakuHeaders(key), throw: false,
      });
      const res = parseJimakuFiles(r.status, r.text ?? "", r.headers as Record<string, string>);
      // The episode filter is documented best-effort: an empty answer for one
      // episode does not mean the entry is empty. Re-ask without it rather
      // than reporting "no files" for a directory that has 24 of them.
      if (res.ok && !res.files.length && episode != null) return await this.jimakuFiles(entryId);
      return res;
    } catch (e) {
      return { ok: false, error: `jimaku.cc に接続できません（${(e as Error).message}）。` };
    }
  }

  /** Download one subtitle body. */
  async fetchJimakuFile(file: JimakuFile): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    try {
      const r = await requestUrl({
        url: file.url, method: "GET",
        headers: jimakuDownloadHeaders(file.url, this.settings.jimaku.apiKey), throw: false,
      });
      if (r.status !== 200) return { ok: false, error: `ダウンロードに失敗 (HTTP ${r.status})` };
      const text = r.text ?? "";
      if (!text.trim()) return { ok: false, error: "ダウンロードしたファイルが空です。" };
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: `ダウンロードに失敗（${(e as Error).message}）。` };
    }
  }

  /**
   * The picker. `attach` carries whatever Plex identity the caller already
   * had, so a jimaku-sourced transcript still knows which media it belongs to
   * — that is what keeps the clock and the 🎬 clip cutter working on a note
   * whose text came from somewhere else entirely (§28: provenance survives
   * the boundary).
   */
  openJimakuPicker(
    seed: { query?: string; episode?: number; season?: number },
    attach: { ratingKey?: string; partKey?: string; title?: string; show?: string; seasonIndex?: number } = {},
  ): void {
    if (!this.settings.jimaku.apiKey.trim()) {
      new Notice("設定 → jimaku に API キーを入力してください（jimaku.cc → プロフィール → API キー）。", 10000);
      return;
    }
    new JimakuPickModal(this.app, {
      seed,
      search: (q) => this.jimakuSearch(q),
      files: (id, ep) => this.jimakuFiles(id, ep),
      choose: async (entry: JimakuEntry, file: JimakuFile) => {
        const got = await this.fetchJimakuFile(file);
        if (!got.ok) { new Notice(`jimaku: ${got.error}`, 10000); return got.error; }
        const ep = episodeNumberFrom(file.name).episode ?? seed.episode;
        // Title: keep the Plex episode's own name when this was launched from
        // an episode, so the note matches the library rather than the upload.
        const title = attach.title
          ?? `${describeJimakuEntry(entry).split("（")[0]}${ep != null ? ` 第${ep}話` : ""}`;
        return await this.writeTranscriptNote({
          srt: got.text, title, show: attach.show ?? entry.japaneseName ?? entry.name,
          subSource: "jimaku",
          episode: { season: attach.seasonIndex ?? seed.season, episode: ep },
          ...(attach.ratingKey || attach.partKey
            ? { plex: { ratingKey: attach.ratingKey, partKey: attach.partKey, lang: "ja" } } : {}),
          jimaku: { entryId: entry.id, fileName: file.name, url: file.url },
          subOffsetSec: 0,
        });
      },
    }).open();
  }

  /** §25.4 clip cutting at a mark: cut an audio clip (+still frame) from the Plex
   *  Part URL at a timestamp. DESKTOP ONLY (ffmpeg). Writes into the transcript
   *  folder's `_clips` subfolder; returns vault-relative paths, or null on any
   *  failure — degrade-soft, never throws into the co-viewing surface. */
  async cutPlexClip(partKey: string, atSec: number, label: string): Promise<{ audio?: string; still?: string } | null> {
    if (!Platform.isDesktopApp) { new Notice("クリップ切り出しはデスクトップのみ対応です。"); return null; }
    const { baseUrl, token, clipPreSec, clipPostSec } = this.settings.plex;
    if (!baseUrl.trim() || !token.trim() || !partKey) return null;
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return null;
    const vaultRoot = adapter.getBasePath();
    const folderRel = normalizePath(`${this.settings.notes.transcriptFolder || "Transcripts"}/_clips`);
    try { if (!(await adapter.exists(folderRel))) await adapter.mkdir(folderRel); } catch { /* best-effort */ }
    const url = plexPartUrl(baseUrl, partKey, token);
    const ff = ffmpegBinFrom(this.settings.audioExtraction.ffmpegPath);
    const fmt = this.settings.audioExtraction.audioFormat;
    const safe = label.replace(/[^\w぀-ヿ一-鿿]+/g, "_").slice(0, 40) || "mark";
    const stamp = Math.floor(atSec);
    const nodePath = nodeReq<{ join(...p: string[]): string }>("path");
    const start = Math.max(0, atSec - (clipPreSec || 0));
    const end = atSec + (clipPostSec || 0) + 1;
    const out: { audio?: string; still?: string } = {};

    const audioRel = `${folderRel}/plex_${safe}_${stamp}.${fmt}`;
    const aRes = await runTool(ff, buildPlexClipArgs(url, start, end, nodePath.join(vaultRoot, audioRel), fmt), 120_000).catch(() => null);
    if (aRes && aRes.code === 0) out.audio = audioRel;

    const stillRel = `${folderRel}/plex_${safe}_${stamp}.jpg`;
    const sRes = await runTool(ff, buildPlexStillArgs(url, atSec, nodePath.join(vaultRoot, stillRel)), 60_000).catch(() => null);
    if (sRes && sRes.code === 0) out.still = stillRel;

    if (!out.audio && !out.still) { new Notice("クリップの切り出しに失敗しました（ffmpeg / サーバー接続を確認）。"); return null; }
    new Notice(`📺 クリップを保存: ${out.audio ?? out.still}`);
    return out;
  }

  /**
   * §25.4c — ask the server to relay a playback command to the client that owns
   * the session (Plex Companion). Transport only; every URL and header lives in
   * notes/plex.ts.
   *
   * Failure is expected and normal: a client can have remote control off, or be
   * a product that never supported it. The caller degrades to moving only the
   * transcript, so this reports rather than throws.
   */
  async plexControl(
    targetId: string | null | undefined,
    command: PlexCommand,
    params?: Record<string, string | number | undefined>,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const { baseUrl, token } = this.settings.plex;
    if (!baseUrl.trim() || !token.trim()) return { ok: false, error: "Plex 未設定" };
    if (!targetId) return { ok: false, error: "クライアント不明" };
    try {
      const r = await requestUrl({
        url: plexControlUrl(baseUrl, command, token, targetId, params),
        method: "GET",
        headers: plexControlHeaders(),
        throw: false,
      });
      if (r.status >= 200 && r.status < 300) return { ok: true };
      return { ok: false, error: `HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, error: (e as { message?: string })?.message ?? String(e) };
    }
  }

  /**
   * §25.4 — cut the scene at a tray mark.
   *
   * The Part key is read off the transcript note the mark was made against, not
   * off a live session, so a mark you dropped last week still cuts. Stored on
   * the card, which is what 🏷️分類 then carries into the attestation.
   */
  async cutClipForMarkCard(card: InboxCard): Promise<{ audio?: string; still?: string } | null> {
    const m = card.mark;
    if (!m?.file || m.tSec == null) {
      new Notice("このマークには元ノートと時刻がないので切り出せません。", 6000);
      return null;
    }
    const f = this.app.vault.getFileByPath(m.file);
    if (!f) {
      new Notice(`元のトランスクリプトが見つかりません: ${m.file}`, 8000);
      return null;
    }
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    const partKey = fm.plex_part_key ? String(fm.plex_part_key) : "";
    if (!partKey) {
      new Notice(
        `このノートには plex_part_key がないので Plex から切り出せません（${f.basename}）。\n` +
        `Plex 由来のトランスクリプトなら、作り直すと付きます。`,
        10000,
      );
      return null;
    }
    const label = card.content || m.sourceName || "mark";
    const clip = await this.cutPlexClip(partKey, m.tSec, label);
    if (clip) {
      await this.inboxStore.setMarkClip(card.id, clip);
      this.refreshTrayViews();
    }
    return clip ?? null;
  }

  /**
   * Remove catalog entries that are the plugin's own output, re-ingested.
   *
   * `looksGenerated` is the SAME predicate the ingest gate uses, deliberately:
   * a filter that only guards new writes leaves the existing junk in the index
   * forever, and a second copy of the rule would drift from the first.
   *
   * Shows every candidate before touching anything. This deletes user data —
   * even when that data is furniture — so it asks, and it says exactly what it
   * found rather than a count. Entries carrying confirmed attestations are
   * reported separately and NEVER auto-removed: a ✓ is a human judgement, and
   * one of those on a junk-looking key means the key is not junk.
   */
  private async purgeGeneratedPatterns(): Promise<void> {
    const all = this.patternStore.all();
    const hits = all.filter((p) => looksGenerated(p.key));
    if (!hits.length) {
      new Notice("生成物エントリは見つかりませんでした（台帳はきれいです）。", 6000);
      return;
    }
    const confirmed = hits.filter((p) => (p.attestations ?? []).some((a) => !a.status));
    const removable = hits.filter((p) => !(p.attestations ?? []).some((a) => !a.status));

    const modal = new Modal(this.app);
    modal.titleEl.setText(`🧹 生成物エントリ ${hits.length}件`);
    const c = modal.contentEl;
    c.createEl("p", {
      text: `台帳 ${all.length}件のうち ${hits.length}件が、プラグイン自身の出力（原文アンカー・`
        + `YouTube リンク・訂正マーク・クローズ問題文など）を見出しとして取り込んだものです。`,
    });
    if (confirmed.length) {
      c.createEl("p", {
        text: `うち ${confirmed.length}件は確定用例を持つため残します（✓ はあなたの判断です）。`,
      });
    }
    const list = c.createDiv();
    list.style.maxHeight = "40vh";
    list.style.overflowY = "auto";
    list.style.margin = "8px 0";
    for (const p of removable) {
      const row = list.createDiv();
      row.style.fontSize = "0.8rem";
      row.style.padding = "3px 0";
      row.style.borderBottom = "1px solid var(--background-modifier-border)";
      row.setText(`${p.class} — ${p.key.slice(0, 70)}${p.key.length > 70 ? "…" : ""}`);
    }
    const acts = c.createDiv();
    acts.style.display = "flex";
    acts.style.gap = "8px";
    acts.style.justifyContent = "flex-end";
    const cancel = acts.createEl("button", { text: "やめる" });
    cancel.onclick = () => modal.close();
    const go = acts.createEl("button", { text: `${removable.length}件を取り除く`, cls: "mod-warning" });
    go.onclick = async () => {
      go.disabled = true;
      for (const p of removable) await this.patternStore.remove(p.id);
      modal.close();
      this.refreshViews();
      new Notice(`🧹 ${removable.length}件を取り除きました`
        + (confirmed.length ? `（確定用例つき ${confirmed.length}件は残しました）` : ""), 8000);
    };
    modal.open();
  }

  /** §25.1 harvest: re-manifest a mark's moment as capture context. */
  async resolveMarkContext(mark: MarkRef): Promise<CaptureContext | null> {
    if (!mark.file || mark.tSec == null) return null;
    const f = this.app.vault.getFileByPath(mark.file);
    if (!f) return null;
    const lines = parseTranscriptLines(await this.app.vault.cachedRead(f));
    let idx = -1;
    for (const l of lines) {
      if (l.tStartSec != null && l.tStartSec <= mark.tSec) idx = l.index;
      else if (l.tStartSec != null && l.tStartSec > mark.tSec) break;
    }
    if (idx < 0) return null;
    const before = lines.slice(Math.max(0, idx - 3), idx);
    const after = lines.slice(idx + 1, idx + 4);
    return {
      text: mark.seed ?? "",
      example: lines[idx].text,
      contextBefore: before.map((l) => l.text),
      contextAfter: after.map((l) => l.text),
      speakers: [...before, lines[idx], ...after].map((l) => l.speaker ?? null),
      source: {
        kind: "yt", file: mark.file, tStartSec: mark.tSec,
        medium: mark.medium, sourceName: mark.sourceName,
      },
    };
  }

  /** §25.3: read show/episode/elapsed off a player screenshot → precise mark
   *  card against the matching `source: podcast` transcript note. */
  async recognizePlayerShot(card: InboxCard): Promise<void> {
    const f = this.app.vault.getFileByPath(card.content);
    if (!f) throw new Error("画像が見つかりません");
    const buf = await this.app.vault.readBinary(f);
    const ext = card.content.split(".").pop()?.toLowerCase();
    const mediaType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
    const resp = await requestUrl({
      url: CLAUDE_API_URL, method: "POST", throw: false,
      headers: { "x-api-key": this.settings.notes.ocrApiKey, "anthropic-version": CLAUDE_API_VERSION, "content-type": "application/json" },
      body: buildVisionBody({
        apiKey: this.settings.notes.ocrApiKey, model: PLAYER_MODEL,
        images: [{ base64: arrayBufferToBase64(buf), mediaType }],
        prompt: PLAYER_PROMPT,
      }),
    });
    const r = parsePlayerShot(resp.status, resp.text);
    if (!r.ok) throw new Error(r.error);
    // candidate episodes: every `source: podcast` note in the vault
    const candidates = this.app.vault.getMarkdownFiles()
      .map((file) => ({ file, fm: this.app.metadataCache.getFileCache(file)?.frontmatter }))
      .filter((x) => x.fm?.source === "podcast")
      .map((x) => ({ path: x.file.path, title: String(x.fm?.title ?? x.file.basename), show: x.fm?.show ? String(x.fm.show) : undefined }));
    const matched = matchEpisodeNote(r.shot.episode, candidates);
    await this.inboxStore.add(markCard({
      medium: "podcast",
      file: matched?.path,
      tSec: r.shot.elapsedSec ?? undefined,
      sourceName: r.shot.show ?? matched?.show ?? r.shot.episode,
      wallClock: card.createdAt,
    }, Date.now()));
    await this.inboxStore.remove(card.id);   // the screenshot's job is done
    new Notice(matched
      ? `🎧 ${r.shot.episode}${r.shot.elapsedSec != null ? ` @ ${fmtStamp(r.shot.elapsedSec)}` : ""} → マーク`
      : `🎧 マーク作成（一致するトランスクリプトなし — 「🎙 Podcast」で取り込むと照合できます）`);
  }

  /** §28 S1/S4 — give a view the catalog-identity pair in one place. */
  /** §26.3 — hand a view the identity bar's wiring. */
  /**
   * The ANSWER half of a selection — one implementation, every surface.
   *
   * Wired into `ViewChrome` rather than into any one view on purpose: a phrase
   * highlighted on 𝕏, in the 受け皿, in a 鑑賞 mark or in the 語彙 must say the
   * same thing, because "what does this mean" is not a per-surface question.
   * §28 S5's claim about data, made about lookup.
   *
   * Local store FIRST: it is in memory and answers in the same tick, so the
   * common case never shows the waiting state at all. The sharded shelf — the
   * one holding the 35 books — is the fallback, and it is the only one of the
   * two worth an await.
   */
  private async lookUpPhrase(text: string, sentence?: string): Promise<PeekData | null> {
    const q = text.trim();
    if (!q) return null;
    const direct = this.peekOfLocal(this.dictStore.lookup(q));
    // An EXACT hit on what the hand selected is the answer, full stop.
    if (direct && !direct.deinflection?.length) return direct;
    // Anything else the bare string yields is a deinflection GUESS, and the
    // guess can be junk when the selection knife cut mid-word: filmed
    // (IMG_1197 34–36s), まない selected out of 気が進まない, the ない→る rule
    // validated まる, and the echo answered a word the user never touched.
    // The characters the knife left behind are sitting in the sentence —
    // grow the selection back through them first, longest extension first,
    // and let a real dictionary hit on 進まない (→ 進む) outrank the junk.
    const grown = sentence ? await this.lookUpGrown(q, sentence) : null;
    if (grown) return grown;
    if (direct) return direct;
    const hit = (await this.bigDict.lookup(q, 1))[0];
    if (!hit) return null;
    return {
      headword: hit.entry.expression,
      ...(hit.entry.reading ? { reading: hit.entry.reading } : {}),
      ...(hit.deinflection ? { deinflection: hit.deinflection } : {}),
      def: definitionsPreview(hit.entry.senses ?? []),
    };
  }

  /** First local hit as a peek, or null. */
  private peekOfLocal(local: DictLookupResult[]): PeekData | null {
    const h = local[0];
    if (!h) return null;
    return {
      headword: h.term.expression,
      reading: h.term.reading,
      deinflection: h.deinflection,
      def: definitionsPreview(h.term.definitions),
    };
  }

  /**
   * Try the selection with 1–4 of its own preceding characters restored,
   * longest first, stopping at anything that ends a word's territory
   * (punctuation, brackets, whitespace). A candidate only wins by being a
   * REAL entry — the same validation every deinflection candidate passes —
   * so growth can only replace junk with attested words, never invent.
   */
  private async lookUpGrown(q: string, sentence: string): Promise<PeekData | null> {
    const idx = sentence.indexOf(q);
    if (idx <= 0) return null;
    const stop = /[\s、。．，！？!?…‥「」『』（）()［］\[\]〈〉《》・：;；]/;
    const grownForms: string[] = [];
    for (let ext = 1; ext <= 4 && idx - ext >= 0; ext++) {
      const ch = sentence[idx - ext];
      if (stop.test(ch)) break;
      grownForms.unshift(sentence.slice(idx - ext, idx) + q);
    }
    // longest first — the most specific surface the sentence supports
    for (const form of grownForms) {
      const peek = this.peekOfLocal(this.dictStore.lookup(form));
      if (peek) return peek;
    }
    for (const form of grownForms) {
      const hit = (await this.bigDict.lookup(form, 1))[0];
      if (!hit) continue;
      return {
        headword: hit.entry.expression,
        ...(hit.entry.reading ? { reading: hit.entry.reading } : {}),
        ...(hit.deinflection ? { deinflection: hit.deinflection } : {}),
        def: definitionsPreview(hit.entry.senses ?? []),
      };
    }
    return null;
  }

  /** The two peek deps every chrome-armed surface gets, spread in at each site. */
  /**
   * The chrome every surface shares. `backPeek` rides along here rather than
   * beside each `dismiss` because this is spread at exactly the same three
   * sites — and a surface that gets `dismiss` without `backPeek` silently has
   * no edge gesture, which is the one failure mode the invariant cannot
   * survive. Coupling them at one line makes that unforgettable.
   */
  private peekChrome(): Pick<ViewChrome, "lookUp" | "openWord" | "backPeek" | "inVault" | "hold"> & {
    // NonNullable: the chrome contract admits null so a VIEW FIELD can start
    // unwired, but what THIS builder hands out is always the real closure —
    // deps interfaces that take `?: fn` must not be poisoned by the union.
    patternsIn: NonNullable<ViewChrome["patternsIn"]>;
    openPattern: NonNullable<ViewChrome["openPattern"]>;
  } {
    return {
      lookUp: (text, sentence) => this.lookUpPhrase(text, sentence),
      openWord: (hw) => void this.openDictionaryView(hw),
      backPeek: () => this.navPeek(),
      inVault: (c) => this.resolveVaultPath(c),
      // Move 1 (掴む): every echo-armed surface grabs identically, wired once.
      hold: (text, surface, sentence) => this.holdText(text, surface, sentence),
      // Items 12–13: the echo carries 台帳 state on every surface, wired once.
      patternsIn: (text) => this.patternsIn(text),
      openPattern: (id) => void this.openLexiconAt(id),
    };
  }

  /** Feel knobs for the hold — settings override the defaults, never guessed. */
  private holdKnobs(): HoldKnobs {
    return { ...DEFAULT_HOLD_KNOBS, ...this.settings.hold };
  }

  /** 掴む: lift a phrase into the dock. An overflowing hold hands its oldest
   *  chip to gravity — the tray — never to the void. */
  private holdText(text: string, surface: string, sentence?: string): void {
    const t = text.trim();
    if (!t) return;
    const { evicted } = this.holdStore.hold(t, surface, sentence);
    if (evicted) void this.landHeldChip(evicted, /*rerender*/ false);
    this.holdDock.render();
  }

  /** 置く: a held chip lands in the tray as a scene-carrying card. The object
   *  visibly leaves the dock and the tray badge ticks — the world is the
   *  record; no toast chases it.
   *
   *  The sentence rides as the card's `said` field — the slot the tray already
   *  has for "what the sender said this means" — NEVER concatenated into the
   *  content. The first version did `text\nsentence`, and the 2026-08-20
   *  review traced where that lands: TrayView's 分類 passes content as
   *  ctx.text, splitPatternParts' whitespace branch splits on the \n, and the
   *  modal opens pre-filled as a 🟠 link between the specimen and its own
   *  sentence — the gravity road minting exactly the unmatchable entry class
   *  Move 0 was written to kill. Scene is a field, not a suffix. */
  private async landHeldChip(chip: HeldChip, rerender = true): Promise<void> {
    this.holdStore.release(chip.id);
    const card = shapeDrop(chip.text, Date.now(), `掴み・${chip.surface}`);
    if (chip.sentence) card.said = chip.sentence;
    await this.inboxStore.add(card);
    this.refreshTrayViews();
    if (rerender) this.holdDock.render();
  }

  /**
   * A candidate path or link text → the path the vault really holds, or null.
   *
   * The only thing in the plugin that can answer "where does the vault root
   * fall inside this absolute path", which is what a rendered image's resource
   * URL forces you to ask. Two roads because the DOM offers two kinds of
   * candidate: an exact tail sliced out of the URL, and the shortest-form link
   * text of the embed (`![[パネル.png]]`), which only the metadata index can
   * expand to a real file.
   */
  private resolveVaultPath(candidate: string): string | null {
    const c = candidate.trim();
    if (!c) return null;
    const direct = this.app.vault.getAbstractFileByPath(normalizePath(c));
    if (direct instanceof TFile) return direct.path;
    return this.app.metadataCache.getFirstLinkpathDest(c, "")?.path ?? null;
  }

  private withChrome(v: CollocationView): CollocationView {
    v.chrome = {
      openSurface: (s) => void this.openSurface(s),
      dismiss: () => void this.navBack(),
      // the selection-echo's action half — without onDrop the arming call
      // returns early and 語彙 stays selection-deaf (it did, until 2026-08-19)
      onDrop: (intent, files) => void this.runDropIntent(intent, files),
      dropCan: () => this.dropCapabilities(),
      ...this.peekChrome(),
      surfaceBadge: (s) => this.surfaceBadge(s),
    };
    return v;
  }

  private withCatalogHits(v: DictionaryView): DictionaryView {
    v.patternsIn = (text) => this.patternsIn(text);
    v.openPattern = (id) => void this.openLexiconAt(id);
    v.onDrop = (intent, files) => void this.runDropIntent(intent, files);
    v.dropCan = () => this.dropCapabilities();
    v.openSurface = (s) => void this.openSurface(s);
    // 辞書 was the one chromed surface never given `dismiss`, and everything
    // downstream failed SILENTLY: armEdgeBack returns early without it, and
    // the rendered 「閉じて戻る」 button ran `chrome.dismiss?.()` — an
    // optional-call on nothing. A dead back button on the most-entered
    // surface, invisible to every golden because the button existed and the
    // handler ran. backPeek (its required pair) arrives from peekChrome below.
    v.dismiss = () => void this.navBack();
    v.surfaceBadge = (s) => this.surfaceBadge(s);
    // §30 nav grammar: the dated history is plugin state, not view state —
    // every 辞書 leaf shares one past.
    v.historyStore = this.dictHistory;
    Object.assign(v, this.peekChrome());
    // §27.5 — the converted dictionaries. Same store the 語彙 panel queries, so
    // 辞書 and 語彙 cannot disagree about what is installed.
    v.bigDict = {
      lookup: (q, limit) => this.bigDict.lookup(q, limit),
      installed: () => this.listBigDictionaries(),
    };
    return v;
  }

  /**
   * §27.4 — convert EVERY dictionary out of Yomitan's single backup file.
   *
   * The zip path does one dictionary at a time. This is the other case: one
   * 12.7GB JSON holding all of them, which no parser can load, so it streams
   * and routes rows to their dictionaries as they pass. Measured on the user's
   * real file: 4,015,521 rows in 185s at a peak buffer under 1MB — memory does
   * not track the file.
   *
   * The registry filter matters: that backup carries 97 distinct titles on its
   * terms table against 36 registered dictionaries, the surplus being orphans
   * of removed or superseded ones. They are skipped and counted, never
   * converted into junk folders and never silently dropped.
   */
  async convertDexieBackup(): Promise<string> {
    if (this.conversionRunning) return this.refuseSecondConversion();
    const path = this.settings.bigDict?.backupFile?.trim();
    if (!path) {
      new Notice("設定 → 大型辞書 に、Yomitanのバックアップ(.json)のパスを入力してください。", 8000);
      return "no backup file configured";
    }
    let src: { chunks: AsyncIterable<string>; size: number };
    try {
      src = nodeChunkSource(path);
    } catch (err) {
      new Notice(String(err instanceof Error ? err.message : err), 10000);
      return String(err);
    }

    // Dictionaries already converted from a zip must not be redone: the backup
    // pass resets a dictionary on its first batch, so without this it would
    // delete a finished 英辞郎 (657MB, 2.36M headwords) and rebuild it from
    // rows it has no better version of. Only COMPLETE non-backup conversions
    // are protected, so re-running the backup still refreshes its own output.
    await this.bigDict.refresh();
    const done = this.bigDict.installed()
      .filter((d) => !d.partial && d.revision !== "dexie" && d.revision !== "repaired")
      .map((d) => d.title);

    this.conversionRunning = "バックアップ";
    const notice = new Notice("バックアップを読み込み中…", 0);
    const io = bufferedSidecarIO(vaultSidecarIO(this.app));
    const gb = (n: number) => (n / 1073741824).toFixed(2);
    try {
      const res = await importDexie(io, src.chunks, {
        root: this.bigDictRoot,
        skip: done.length ? skipTitles(done) : undefined,
        onProgress: (p) => {
          notice.setMessage(
            `辞書バックアップ ${gb(p.bytes)}/${gb(src.size)}GB — ${p.dictionaries}辞書 / ` +
            `${p.rows.toLocaleString()}語（${p.current}）`,
          );
        },
      });
      await io.flush();
      this.bigDict.invalidate();
      const msg =
        `バックアップ変換完了: ${res.dictionaries.length}辞書 / ${res.rows.toLocaleString()}見出し` +
        `（${(res.ms / 1000).toFixed(0)}秒）` +
        (res.skipped.length ? ` — 変換済みのためスキップ: ${res.skipped.join("、")}` : "") +
        (res.orphans ? ` — 登録外の辞書 ${res.orphans.toLocaleString()}語はスキップ` : "") +
        (res.unparseable ? ` / 解析不能 ${res.unparseable}語` : "");
      new Notice(msg, 15000);
      return msg;
    } catch (err) {
      // Everything read so far is already on disk WITH meta (written per
      // batch), so a failure here costs the remainder of the file, not the run.
      await io.flush().catch(() => {});
      this.bigDict.invalidate();
      const msg = `バックアップ変換に失敗: ${String(err instanceof Error ? err.message : err)}` +
        "（ここまでに変換した辞書は使えます）";
      new Notice(msg, 12000);
      return msg;
    } finally {
      this.conversionRunning = null;
      notice.hide();
    }
  }

  /** One conversion at a time — both write the same folders. */
  private refuseSecondConversion(): string {
    const msg = `${this.conversionRunning}の変換が実行中です。終わってから実行してください（同じフォルダに書き込むため）。`;
    new Notice(msg, 8000);
    return msg;
  }

  /**
   * §27.5 — make converted dictionaries findable again after an interrupted run.
   *
   * Discovery requires `meta.json`, and conversions used to write it only after
   * the entire 12.7GB backup had been read. A run that was killed — or merely
   * still going — therefore left gigabytes of perfectly good shards that the
   * plugin could not see: on this vault, 30 dictionaries and 1.8GB hidden by 30
   * missing 150-byte files. `importDexie` now writes meta as it goes, so this is
   * the rescue path for anything converted before that, and after a crash.
   *
   * It also VERIFIES, because repair alone cannot: a folder with readable meta
   * is skipped, so a dictionary that lost shards while keeping its meta was
   * reported here as 正常 — which is how 英辞郎 came to serve 36% of its
   * reach-for index with no error anywhere. See `verifySidecar`.
   */
  async repairBigDictionaries(): Promise<string> {
    if (this.conversionRunning) return this.refuseSecondConversion();
    this.conversionRunning = "修復";
    const notice = new Notice("辞書フォルダを検査中…", 0);
    const io = vaultSidecarIO(this.app);
    try {
      const res = await repairSidecarMeta(io, this.bigDictRoot, {
        onProgress: (p) => {
          notice.setMessage(
            `辞書を修復中 ${p.done}/${p.total} — ${p.title}（${(p.bytes / 1048576).toFixed(0)}MB 読込）`,
          );
        },
      });
      // Rebuilding meta is only half of "is this dictionary usable". A folder
      // whose meta reads fine is SKIPPED by the repair above, so damage that
      // left meta intact — a half-finished drop, a shard lost to a sync
      // conflict — used to be reported here as 正常. Verification is one
      // listFiles per folder, so it runs every time (§28 S6).
      notice.setMessage("辞書を検査中…");
      const verdicts = await verifyAllSidecars(io, this.bigDictRoot);
      const broken = verdicts.filter((v) => !v.ok);

      this.bigDict.invalidate();
      const repairedMsg = res.repaired.length
        ? `${res.repaired.length}辞書を復旧: ` +
          res.repaired.slice(0, 4).map((r) => `${r.title} ${r.headwords.toLocaleString()}語`).join("、") +
          (res.repaired.length > 4 ? ` ほか${res.repaired.length - 4}辞書` : "") +
          "（未完了の可能性があるため「暫定」表示です）"
        : "";
      const brokenMsg = broken.length
        ? `⚠️ ${broken.length}辞書に破損: ` +
          broken.slice(0, 3).map((v) => `【${v.title}】${describeSidecarProblem(v.problems[0])}`).join(" ／ ") +
          (broken.length > 3 ? ` ほか${broken.length - 3}辞書` : "") +
          " — 再変換が必要です"
        : "";
      const msg = [repairedMsg, brokenMsg].filter(Boolean).join("\n") ||
        `復旧が必要な辞書はありません（${verdicts.length}辞書を検査、すべて正常）。`;
      new Notice(msg, broken.length ? 30000 : 15000);
      return msg;
    } catch (err) {
      const msg = `辞書の修復に失敗: ${String(err instanceof Error ? err.message : err)}`;
      new Notice(msg, 12000);
      return msg;
    } finally {
      this.conversionRunning = null;
      notice.hide();
    }
  }

  /**
   * §27.2 — build the meaning-side index for every converted dictionary.
   *
   * No re-import and no source archive: the English is already stored on every
   * frame row, so this re-keys data the vault holds. That is the whole reason
   * the missing entry points were never a data problem — the intention key was
   * computed at import, dropped at write, and blanked again at read.
   */
  async buildIntentIndexes(): Promise<string> {
    if (this.conversionRunning) return this.refuseSecondConversion();
    this.conversionRunning = "意図索引";
    const notice = new Notice("意図索引を構築中…", 0);
    const io = bufferedSidecarIO(vaultSidecarIO(this.app));
    try {
      await this.bigDict.refresh();
      const installed = this.bigDict.installed();
      const built: string[] = [];
      let keys = 0, candidates = 0;
      for (const d of installed) {
        const res = await buildIntentIndex(io, d.dir, {
          shards: d.shards,
          onProgress: (p) => {
            notice.setMessage(
              `意図索引 ${d.title} — ${p.pass}/${p.passes}周目 ${p.shard}/${p.of}シャード`,
            );
          },
        });
        await io.flush();
        if (!res.keys) continue;
        const meta = await readMeta(io, d.dir);
        if (meta) await writeMeta(io, d.dir, { ...meta, intents: res.keys });
        built.push(`${d.title} ${res.keys.toLocaleString()}件`);
        keys += res.keys;
        candidates += res.candidates;
      }
      await io.flush();
      this.bigDict.invalidate();
      const msg = built.length
        ? `意図索引を構築: ${keys.toLocaleString()}項目 / ${candidates.toLocaleString()}候補 — ` +
          built.slice(0, 3).join("、") + (built.length > 3 ? ` ほか${built.length - 3}辞書` : "")
        : "意図索引を作れる辞書がありません（reachFor を持つ辞書が必要です）。";
      new Notice(msg, 15000);
      return msg;
    } catch (err) {
      await io.flush().catch(() => {});
      this.bigDict.invalidate();
      const msg = `意図索引の構築に失敗: ${String(err instanceof Error ? err.message : err)}`;
      new Notice(msg, 12000);
      return msg;
    } finally {
      this.conversionRunning = null;
      notice.hide();
    }
  }

  /** What is installed, for the settings list. Cheap: one meta.json each. */
  async listBigDictionaries(): Promise<Array<{
    title: string; headwords: number; frames: number; dir: string;
    partial: boolean; revision: string;
  }>> {
    await this.bigDict.refresh();
    return this.bigDict.installed();
  }

  /**
   * §28 S1 — which of YOUR catalog patterns occur in this text.
   *
   * The one implementation behind every "you have already noticed this" mark:
   * the X card, the tray card, the dictionary panel. Without it each surface
   * shows the same phrase as an unrelated object and identity continuity is
   * broken by construction.
   *
   * Called once per rendered card, so it is O(cards × patterns). `sweepTerms()`
   * does real string work and only changes when a pattern's key/payload does,
   * so it is memoized by id and cleared from PatternStore's persist callback;
   * class/classRatified are read live so a retype shows up immediately.
   */
  patternsIn(text: string): Array<{ id: string; key: string; class: NoteClass; classRatified?: boolean }> {
    const hits: Array<{ id: string; key: string; class: NoteClass; classRatified?: boolean }> = [];
    if (!text) return hits;
    for (const p of this.patternStore.all()) {
      let terms = this.sweepTermsCache.get(p.id);
      if (!terms) { terms = sweepTerms(p); this.sweepTermsCache.set(p.id, terms); }
      if (terms.length && terms.every((t) => text.includes(t))) {
        hits.push({ id: p.id, key: p.key, class: p.class, classRatified: p.classRatified });
      }
    }
    return hits;
  }

  /**
   * §28 S4 — open the lexicon focused on ONE catalog pattern. This is what makes
   * a class mark on a foreign surface (an X card, a tray item) an action: the
   * same object, re-rendered where its full context lives.
   */
  async openLexiconAt(id: string): Promise<void> {
    await this.openLexiconView();
    const leaf = this.app.workspace.getLeavesOfType(JP_COLLOCATIONS_VIEW_TYPE)[0];
    const view = leaf?.view as CollocationView | undefined;
    view?.openPattern?.(id);
  }

  async openLexiconView(): Promise<void> {
    const leaf = this.surfaceLeaf(JP_COLLOCATIONS_VIEW_TYPE);
    if (!leaf) return;
    if (leaf.view?.getViewType() !== JP_COLLOCATIONS_VIEW_TYPE) {
      await leaf.setViewState({ type: JP_COLLOCATIONS_VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  /**
   * Background vault indexing — resilient, non-blocking, phone-friendly.
   *
   * Strategy:
   *   - Batch 2 files at a time (tiny batches for mobile)
   *   - requestIdleCallback-based scheduling (falls back to setTimeout)
   *   - Skip already-indexed files
   *   - Skip very large files (>50KB) to avoid jank
   *   - Stop if plugin is unloading
   */
  private backgroundIndexVault(): void {
    const files = this.app.vault.getMarkdownFiles();
    const indexed = new Set(this.surferBridge.getIndexedFiles());
    const unindexed = files.filter(f => !indexed.has(f.path));

    if (unindexed.length === 0) return;

    let i = 0;
    const batchSize = 2;
    const maxFileSize = 50_000; // skip files >50KB
    let stopped = false;

    // Track unload to stop
    this.register(() => { stopped = true; });

    const scheduleNext = () => {
      if (stopped || i >= unindexed.length) return;

      const run = async () => {
        if (stopped) return;
        const end = Math.min(i + batchSize, unindexed.length);
        for (; i < end; i++) {
          if (stopped) return;
          const file = unindexed[i];
          try {
            const stat = (file as any).stat;
            if (stat && stat.size > maxFileSize) continue;
            const content = await this.app.vault.cachedRead(file);
            if (content.length > 10 && content.length <= maxFileSize) {
              this.surferBridge.indexFile(file.path, content);
            }
          } catch { /* skip unreadable */ }
        }
        scheduleNext();
      };

      // Use requestIdleCallback on browsers that have it (mobile Safari doesn't)
      if (typeof (window as any).requestIdleCallback === 'function') {
        (window as any).requestIdleCallback(run, { timeout: 200 });
      } else {
        setTimeout(run, 80);
      }
    };

    scheduleNext();
  }

  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(JP_COLLOCATIONS_VIEW_TYPE)) {
      (leaf.view as CollocationView).refresh();
    }
  }

  private refreshDictionaryViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(JP_DICTIONARY_VIEW_TYPE)) {
      (leaf.view as DictionaryView).refresh();
    }
  }

  private refreshTrayViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(JP_TRAY_VIEW_TYPE)) {
      (leaf.view as TrayView).refresh?.();
    }
  }

  /**
   * §27.0.2 collision watcher — run the open reaches against whatever just
   * landed in the attested stream. Offers only; nothing is ever filled here.
   * Juxtaposition is capped low: the point is to set two things side by side,
   * not to bury a want under everything that arrived today.
   */
  /**
   * One catalog entry, as things that just ARRIVED in the attested stream.
   *
   * Two details that decide whether a collision can happen at all:
   *
   *  - **`frameKey`.** `collide` can make a `frame` offer — "this realizes the
   *    型 you were circling" — but only if the incoming item carries one, and
   *    the previous (only) caller supplied none, so that entire offer reason was
   *    unreachable from production. A 💠 entry IS a frame; a 🟠 link is one too
   *    once its parts are joined. `toFrame` normalizes both into the same key
   *    space the dictionary's reach-for query uses, so a want circling a shape
   *    can meet a phrase that realizes it.
   *  - **The quote AND the key.** A want is often written about the shape
   *    («that "at some point" feeling»), not about the words, so offering only
   *    the quote means a token match can never land on the pattern itself.
   */
  private incomingFrom(p: PatternEntry): Array<{ surface: string; source?: Reach['offers'][number]['source']; frameKey?: string; at: number }> {
    const frame = p.payload.frame ?? (p.payload.parts?.length ? p.payload.parts.join('～') : undefined);
    const frameKey = frame ? toFrame(frame).key : undefined;
    const now = Date.now();
    type Item = { surface: string; source?: Reach['offers'][number]['source']; frameKey?: string; at: number };
    const out: Item[] = p.attestations.map((a) => ({
      surface: a.quote,
      source: {
        ...(a.file ? { file: a.file } : {}),
        ...(a.tStartSec != null ? { tStartSec: a.tStartSec } : {}),
        medium: a.medium ?? a.source,
        ...(a.scene?.deepLink ? { deepLink: a.scene.deepLink } : {}),
      },
      ...(frameKey ? { frameKey } : {}),
      at: a.addedAt,
    }));
    // The pattern itself is an arrival too — 「どっかのタイミングで」 is the thing
    // that fills the want, not the sentence it was heard in.
    out.push({ surface: p.key, source: { medium: 'manual' }, ...(frameKey ? { frameKey } : {}), at: now });
    return out;
  }

  /**
   * The SHELF as arrivals (§27.2).
   *
   * Every other arrival is something the user met — an attestation, a pattern.
   * A want written in English can never collide with any of them: it cannot
   * token-match a Japanese surface and it carries no slot, so before the
   * meaning-side index existed there was literally no path from "undergo" to a
   * Japanese phrase, and the reach on this vault sat open with zero offers.
   *
   * So the dictionary is asked directly, once per open want. The candidates
   * arrive as ordinary `Incoming` and go through the same `collide` as
   * everything else — they are OFFERS, judged by the same hand, and the
   * dictionary that filed each one is carried as its provenance (§28 S2).
   */
  private async intentionArrivals(): Promise<Incoming[]> {
    const open = this.reachStore.open();
    if (!open.length || !this.bigDict.hasIntentIndex()) return [];
    const now = Date.now();
    const out: Incoming[] = [];
    for (const r of open) {
      for (const want of [r.want, r.gloss]) {
        if (!want?.trim()) continue;
        for (const hit of await this.bigDict.intention(want, 12)) {
          out.push({
            surface: hit.candidate.surface,
            source: { medium: hit.dictionary },
            intentionKey: hit.candidate.intentionKey,
            intention: hit.candidate.intention,
            ...(hit.candidate.frameKey ? { frameKey: hit.candidate.frameKey } : {}),
            at: now,
          });
        }
      }
    }
    return out;
  }

  private async watchReaches(incoming: Incoming[]): Promise<void> {
    if (!this.reachStore.open().length) return;
    incoming = [...incoming, ...(await this.intentionArrivals())];
    if (!incoming.length) return;
    const made = await this.reachStore.watch(incoming, { juxtaposeLimit: 2 });
    if (made) {
      const s = reachStats(this.reachStore.all());
      new Notice(`願い: ${made}件の候補が届きました（${s.waiting}件が見定め待ち）`, 6000);
      this.refreshTrayViews();
    }
  }

  async openReconLibrary(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(JP_RECON_LIBRARY_VIEW_TYPE);
    if (existing.length) { this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: JP_RECON_LIBRARY_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private refreshReconLibrary(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(JP_RECON_LIBRARY_VIEW_TYPE)) {
      (leaf.view as LibraryView).refresh();
    }
  }

  /** Retype a note (Big-5 router): rewrite the callout class in the source file + persist. */
  private async retypeReconNote(entry: LibraryEntry, cls: NoteClass): Promise<void> {
    // The callout keyword in the file is keyed by the block that ENDS in the
    // anchor id (the cluster block). For a clustered secondary entry the class
    // lives only in the library (the callout keeps its lead item's class).
    const target = entry.anchorId ?? entry.blockId;
    const isLead = !entry.anchorId || entry.anchorId === entry.blockId;
    const f = this.app.vault.getAbstractFileByPath(entry.file);
    if (f instanceof TFile && isLead) {
      const md = await this.app.vault.read(f);
      const next = retypeInMarkdown(md, target, cls);
      if (next !== md) await this.app.vault.modify(f, next);
    }
    this.reconLibrary.setClass(entry.blockId, cls);
  }

  /** Shared reconcile prep for the reconcile + cards + clip commands. Strips
   *  any existing anchors before parsing so matching runs on the PRISTINE
   *  transcript (idempotent re-runs), then plans the context windows /
   *  clusters / clip ranges. Shows a Notice and returns null on any failure so
   *  callers just `if (!prep) return`. */
  /** The standard reconcile flow (text path): prepare → annotate every source
   *  transcript → report → jump to the first anchor. Shared by the text command
   *  and the OCR command's hand-off. */
  private async runReconcileFlow(): Promise<void> {
    const prep = await this.prepareReconcile();
    if (!prep) return;

    let total = 0, auto = 0, anchored = 0;
    let firstLink: string | null = null;
    for (const src of prep.sources) {
      const combined = await this.annotateTranscript(prep.file, src);
      total += src.results.length;
      auto += src.results.filter((r) => r.status === "auto").length;
      anchored += src.plan.items.length;
      if (!firstLink && src.plan.items[0]) {
        const id = combined.anchorIdOf.get(src.plan.items[0].id);
        firstLink = id ? `${src.tFile.path}#^${id}` : src.tFile.path;
      }
    }
    const perSrc = prep.sources.length > 1
      ? "\n" + prep.sources.map((s) => `  ${s.tFile.basename}: ${s.results.length}件`).join("\n")
      : "";
    new Notice(
      `照合完了: ${total}件（auto ${auto} / 要確認 ${total - auto}）\n` +
      `文字起こしに ${anchored} 箇所をアンカーしました — 照合ライブラリで種別を設定できます${perSrc}`,
    );
    await this.app.workspace.openLinkText(firstLink ?? prep.sources[0].tFile.path, "", false);
  }

  /**
   * The handwriting stage (DESIGN §5): OCR every image embedded in the active
   * notes file via Claude vision (Haiku, one Opus escalation), materialize the
   * extracted phrases INTO the file under idempotent `%% ocr:<hash> %%` markers,
   * then hand off to the ordinary text reconcile flow. Re-running skips images
   * already extracted; the user corrects misreads by editing the lines.
   */
  private async ocrThenReconcile(): Promise<void> {
    const cfg = this.settings.notes;
    if (!cfg.ocrApiKey) {
      new Notice("Anthropic API キーが未設定です（設定 → 手書きOCR）。console.anthropic.com で発行できます。", 10000);
      return;
    }
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice("ノートファイルを開いてください"); return; }
    const content = await this.app.vault.read(file);
    if (!frontmatterSources(content).length) {
      new Notice(
        "これはキャプチャノートではありません。frontmatter に `sources: [[文字起こし]]`"
        + "（複数可: カンマ/リスト）が必要です。\n"
        + "文字起こしを開いて「📝 このトランスクリプトからキャプチャノートを作成」を実行すると一発で作れます。",
        12000);
      return;
    }
    const images = this.findEmbeddedImages(content, file);
    if (!images.length) {
      new Notice("埋め込み画像が見つかりません。手書きページの画像（写真/スクリーンショット）をこのノートに埋め込んでください。", 10000);
      return;
    }
    const r = await this.ocrMaterialize(file, content, images);
    if (r.added === 0 && !(r.alreadyDone && !r.failed)) return;
    await this.runReconcileFlow();
  }

  /** OCR every un-processed embedded image and write the phrases into the notes
   *  file. Idempotent per image (`%% ocr:<hash> %%`). Pure extraction — no
   *  reconcile; callers chain whatever comes next. */
  private async ocrMaterialize(
    file: TFile, contentIn: string, images: TFile[],
  ): Promise<{ added: number; alreadyDone: number; failed: number }> {
    const cfg = this.settings.notes;
    const http: ClaudeHttp = {
      post: async (url, body, headers) => {
        const r = await requestUrl({ url, method: "POST", body, headers, throw: false });
        return { status: r.status, text: r.text };
      },
    };
    let content = contentIn;
    let added = 0, alreadyDone = 0, failed = 0;
    for (const img of images) {
      const buf = await this.app.vault.readBinary(img);
      const hash = imageHash(new Uint8Array(buf));
      if (content.includes(ocrMarker(hash))) { alreadyDone++; continue; }
      const busy = new Notice(`OCR中… ${img.name}`, 0);
      let res;
      try {
        const tiles = await this.prepareImageTiles(buf, img.extension.toLowerCase());
        if (tiles.length > 1) busy.setMessage(`OCR中… ${img.name}（縦長ページ → ${tiles.length} タイル）`);
        res = await ocrImage(http, { apiKey: cfg.ocrApiKey, model: cfg.ocrModel, escalationModel: cfg.ocrEscalationModel }, tiles);
      } finally { busy.hide(); }
      if (!res.page || !res.page.phrases.length) {
        failed++;
        new Notice(`OCR失敗（${img.name}）: ${res.error ?? "フレーズが読み取れませんでした"}`, 12000);
        continue;
      }
      const merged = mergeOcrPhrases(content, res.page, img.name, hash);
      content = merged.md;
      added += merged.added;
      const low = res.page.phrases.filter((p) => p.confidence < 0.6).length;
      new Notice(
        `${img.name}: ${merged.added} フレーズ抽出（${res.modelUsed}${res.escalated ? "・エスカレーション" : ""}）` +
        (low ? `\n⚠️ 低確信 ${low} 件 — ノート内の行を直接修正できます` : ""),
      );
    }
    if (added > 0) await this.app.vault.modify(file, content);
    return { added, alreadyDone, failed };
  }

  /**
   * ⚡ ONE command for the whole flow, opt-outs intact:
   *   1. OCR any un-processed handwriting images (skipped without an API key
   *      or images — text-only notes files work the same).
   *   2. Reconcile against every source transcript + write anchors.
   *   3. Audio clips per anchor — ONLY when the opt-in audio setting is on
   *      and this is desktop (that command regenerates the cards itself).
   *   4. Otherwise, generate the cards without audio.
   */
  private async runFullPipeline(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice("ノートファイルを開いてください"); return; }
    const content = await this.app.vault.read(file);
    if (!frontmatterSources(content).length) {
      new Notice(
        "これはキャプチャノートではありません。frontmatter に `sources: [[文字起こし]]`"
        + "（複数可: カンマ/リスト）が必要です。\n"
        + "文字起こしを開いて「📝 このトランスクリプトからキャプチャノートを作成」を実行すると一発で作れます。",
        12000);
      return;
    }

    // 1 — OCR (optional stage)
    const images = this.findEmbeddedImages(content, file);
    if (images.length && this.settings.notes.ocrApiKey) {
      await this.ocrMaterialize(file, content, images);
    }

    // 2 — reconcile + anchor ONCE (writes anchors, records catalog patterns).
    const prep = await this.prepareReconcile();
    if (!prep) return;
    const plans = new Map<string, AnchorPlan>();
    for (const src of prep.sources) plans.set(src.tFile.path, await this.annotateTranscript(prep.file, src));

    // 3 — write cards NOW with deep-link audio, so you can study in ~1 minute
    //     instead of waiting out the whole clip download. Local mp3 clips (if
    //     enabled) upgrade these same cards in the background below.
    const written = await this.writeReconCards(prep, plans);
    if (written) await this.app.workspace.getLeaf(false).openFile(written.outFile);

    // The patterns this run created/touched — the one-tap review focus set.
    const runIds = new Set<string>();
    for (const src of prep.sources) for (const r of src.results) runIds.add(patternIdFor(derivePattern(r.note)));

    const total = prep.sources.reduce((n, s) => n + s.results.length, 0);
    const anchored = prep.sources.reduce((n, s) => n + s.plan.items.length, 0);
    const audioReady = Platform.isDesktopApp && this.settings.audioExtraction.enabled
      && this.app.vault.adapter instanceof FileSystemAdapter && nodeRuntimeAvailable()
      && prep.sources.some((s) => s.videoId);

    this.pipelineHandoff(written?.count ?? 0, total, anchored, runIds, audioReady);

    // 4 — audio in the BACKGROUND (not awaited): cards already exist with
    //     deep-links; downloaded clips re-embed on completion. The user studies
    //     immediately rather than staring at a 15-minute spinner.
    if (audioReady) {
      void (async () => {
        try {
          const res = await this.downloadClipsFor(prep, plans);
          if (this.settings.voiceSync.enabled) {
            try { await this.enrichClipsVoiceSync(); } catch (e) { console.error("[jp-collocations] voicesync:", e); }
          }
          // Regenerate so the fresh local clips embed (present sidesteps index lag).
          const up = res.present.size || this.settings.voiceSync.enabled
            ? await this.writeReconCards(prep, plans, res.present)
            : null;
          if (res.done > 0 || res.failed > 0) {
            new Notice(
              `🎧 音声クリップ: ✓${res.done}${res.failed ? ` / 失敗${res.failed}` : ""}` +
              (up ? `\nカードに埋め込みました（${up.count}枚）` : "") +
              (res.failed ? `\nログ: ${normalizePath((this.settings.audioExtraction.outputFolder || "JP Audio Clips") + "/_download-log.md")}` : ""),
              res.failed ? 12000 : 7000,
            );
          }
        } catch (e) {
          console.error("[jp-collocations] background audio failed:", e);
          new Notice("音声クリップの取得に失敗しました（カードは利用可能です）。", 8000);
        }
      })();
    }
  }

  /** ⚡'s closing summary: a tappable Notice that drops you straight into
   *  reviewing exactly the cards this run created. */
  private pipelineHandoff(cardCount: number, total: number, anchored: number, runIds: Set<string>, audioPending: boolean): void {
    const reviewable = [...runIds].filter((id) => {
      const p = this.patternStore.byId(id);
      return p && isReviewable(p);
    });
    const msg =
      `⚡ 完了: ${total}件照合 / ${anchored}箇所アンカー / カード${cardCount}枚` +
      (audioPending ? `\n🎧 音声はバックグラウンド取得中（カードは今すぐ使えます）` : "") +
      (!audioPending && !this.settings.audioExtraction.enabled ? `\n（音声クリップは設定でオフ）` : "") +
      (reviewable.length ? `\n▶ タップで ${reviewable.length}枚を今すぐ復習` : "");
    const n = new Notice(msg, 12000);
    if (reviewable.length) {
      n.noticeEl.style.cursor = "pointer";
      n.noticeEl.addEventListener("click", () => { void this.openReviewView(reviewable); });
    }
  }

  /** History → capture note: read the NEWEST `_watch-history_*` note, map its
   *  videos to already-fetched transcripts, and create a notes file with
   *  `sources:` prefilled — the user just pastes the handwriting image and ⚡. */
  private async newCaptureNote(): Promise<void> {
    const hist = this.app.vault.getMarkdownFiles()
      .filter((f) => f.basename.startsWith("_watch-history"))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)[0];
    if (!hist) {
      new Notice("視聴履歴ノートがありません。先に「Fetch Watch History by Date Range」を実行してください。", 10000);
      return;
    }
    const md = await this.app.vault.cachedRead(hist);
    const ids = [...new Set([...md.matchAll(/youtu\.be\/([\w-]{11})/g)].map((m) => m[1]))];
    const all = this.app.vault.getMarkdownFiles();
    const links: string[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const t = all.find((f) => f.basename.includes(`(${id})`) && !f.basename.startsWith("_"));
      if (t) links.push(`  - "[[${t.basename}]]"`);
      else missing.push(id);
    }
    if (!links.length) {
      new Notice(`この履歴（${hist.basename}）の文字起こしがまだありません。履歴ノートを開いて「Fetch Transcripts from Watch History / URL List」を実行してください。`, 12000);
      return;
    }
    const day = new Date().toISOString().slice(0, 10);
    let path = `Capture ${day}.md`;
    for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = `Capture ${day} (${i}).md`;
    const body = [
      "---",
      "sources:",
      ...links,
      "---",
      "",
      `> [!tip] 手書きページの画像をこの下に貼り付けて、⚡（リボンの ✨）を実行`,
      missing.length ? `> ⚠ 文字起こし未取得: ${missing.map((m) => `https://youtu.be/${m}`).join(" ")}` : "",
      "",
    ].filter((l) => l !== "").join("\n") + "\n";
    const file = await this.app.vault.create(path, body);
    await this.app.workspace.getLeaf(false).openFile(file);
    new Notice(`キャプチャノート作成: ${links.length} 本の動画とリンク済み${missing.length ? `（未取得 ${missing.length} 本）` : ""}。画像を貼って ⚡`, 10000);
  }

  /**
   * Capture note for the transcript that is open right now — the missing rung
   * between a transcript and ⚡.
   *
   * `newCaptureNote()` above only ever reaches YouTube: it needs a
   * `_watch-history` note and matches `youtu.be/<11 chars>` against filenames.
   * A Plex or jimaku transcript carries `plex_rating_key` / `jimaku_entry` and
   * no video id, so it could never be reached — the TV road built a transcript
   * and then dead-ended, because `runFullPipeline()` requires a capture note
   * whose frontmatter names it in `sources:`, and nothing could write one.
   *
   * So this deliberately knows nothing about where the transcript came from.
   * The one thing it checks is the one thing the pipeline actually needs:
   * that `parseTranscriptLines` can get stamped lines out of the file. Plex,
   * jimaku, YouTube and a hand-pasted .srt are all served by the same rung.
   */
  private async captureNoteFromTranscript(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice("文字起こしノートを開いてから実行してください。", 8000); return; }

    const md = await this.app.vault.cachedRead(file);
    // `isCaptureNote` — i.e. `frontmatterSources().length > 0`. This used to be
    // a hand-rolled plural-only regex right here, because `frontmatterSources`
    // matched the SINGULAR `source:` too and so classified every Plex/jimaku
    // transcript (`source: tv`) as an existing capture note — refusing the exact
    // case this command was added for. The shared function is now plural-only
    // (pipeline.ts `frontmatterSources` / `frontmatterMedium`), so the workaround
    // and its private parse are gone. golden/capture-rung.mjs still pins it.
    if (isCaptureNote(md)) {
      new Notice("このノートは既にキャプチャノートです（sources: があります）。画像を貼って ⚡ を実行してください。", 10000);
      return;
    }
    // The pipeline anchors marks to timestamps; a transcript with none would
    // produce a capture note that silently reconciles nothing. Refuse loudly.
    const stamped = parseTranscriptLines(md).filter((l) => l.tStartSec != null).length;
    if (stamped < 5) {
      new Notice(
        `このノートからタイムスタンプ付きの行が読み取れません（${stamped}行）。`
        + "字幕から作った文字起こしノートを開いて実行してください。", 12000);
      return;
    }

    const title = frontmatterAny(md, ["title"]) || file.basename;
    const safe = title.replace(/[\\/:*?"<>|]/g, "").trim() || file.basename;
    let path = `Capture ${safe}.md`;
    for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = `Capture ${safe} (${i}).md`;

    const body = [
      "---",
      "sources:",
      `  - "[[${file.basename}]]"`,
      "---",
      "",
      "> [!tip] 手書きページの画像をこの下に貼り付けて、⚡（リボンの ✨）を実行",
      "",
    ].join("\n") + "\n";

    const created = await this.app.vault.create(path, body);
    await this.app.workspace.getLeaf(false).openFile(created);
    new Notice(`キャプチャノート作成: ${created.basename}\n（${stamped}行の文字起こしとリンク済み）画像を貼って ⚡`, 9000);
  }

  /** Enrich every clip in the audio folder that lacks a `.voicesync.json`
   *  sidecar: whisper re-transcription (clean JP, per-token timing) + speaker
   *  diarization (overlap-aware). ~20s per 30s clip on CPU. */
  /** Voice profiles as absolute paths for the enrollment concat. */
  private voiceProfilesAbs(): { name: string; absWav: string; durSec: number }[] {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return [];
    const base = adapter.getBasePath();
    return this.settings.voiceSync.profiles.map((p) => ({ name: p.name, absWav: `${base}/${p.refWav}`, durSec: p.durSec }));
  }

  /** Name a speaker AND enroll their voice: extract the longest clean segment
   *  as a 16k reference wav, register the profile — every future clip (and any
   *  re-identify run) then auto-names this person. */
  private async enrollVoice(clipFile: TFile, data: VoiceSyncData, spk: string, name: string): Promise<void> {
    data.speakers[spk] = name;
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;      // name saved; enrollment needs desktop
    const segs = data.segments.filter((s) => s.spk === spk).sort((a, b) => (b.t1 - b.t0) - (a.t1 - a.t0));
    const longest = segs[0];
    if (!longest || longest.t1 - longest.t0 < 1.5) {
      new Notice(`「${name}」: 区間が短すぎて声を登録できません（名前のみ保存）`, 6000);
      return;
    }
    const folder = normalizePath(`${this.settings.audioExtraction.outputFolder || "JP Audio Clips"}/_voices`);
    if (!this.app.vault.getAbstractFileByPath(folder)) { try { await this.app.vault.createFolder(folder); } catch { /* exists */ } }
    const rel = `${folder}/${name.replace(/[\\/:*?"<>|#^[\]]/g, "_")}.wav`;
    const base = adapter.getBasePath();
    const det = detectTools();
    const dur = Math.min(10, longest.t1 - longest.t0);
    const ok = await extractRefWav(
      this.settings.audioExtraction.ffmpegPath || det.ffmpeg,
      `${base}/${clipFile.path}`, longest.t0, longest.t0 + dur, `${base}/${rel}`);
    if (!ok) { new Notice(`「${name}」: 声の抽出に失敗（名前のみ保存）`, 6000); return; }
    this.settings.voiceSync.profiles = [
      ...this.settings.voiceSync.profiles.filter((p) => p.name !== name),
      { name, refWav: rel, durSec: dur },
    ];
    await this.saveSettings();
    new Notice(`🗣 「${name}」の声を登録しました`);
  }

  private async enrichClipsVoiceSync(force = false): Promise<void> {
    if (!Platform.isDesktopApp) { new Notice("VoiceSync はデスクトップ版のみ対応です。"); return; }
    if (!this.settings.voiceSync.enabled) { new Notice("設定 →「VoiceSync（話者同期）」を有効にしてください。"); return; }
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) { new Notice("ローカルファイルシステムが利用できません。"); return; }
    const tools = detectSpeechTools(this.settings.voiceSync.toolsDir);
    if (!tools.ready) {
      new Notice("音声解析ツールが見つかりません。設定 →「VoiceSync」の手順で whisper.cpp と sherpa-onnx を配置してください。", 12000);
      return;
    }
    const folder = normalizePath(this.settings.audioExtraction.outputFolder || "JP Audio Clips");
    const dir = this.app.vault.getAbstractFileByPath(folder);
    const clips = this.app.vault.getFiles().filter((f) =>
      f.path.startsWith(folder + "/") && f.extension === "mp3" && !f.name.startsWith("_srcaudio"));
    if (!dir || !clips.length) { new Notice(`クリップがありません（${folder}）。先に音声クリップを取得してください。`); return; }
    const todo = force ? clips
      : clips.filter((c) => !this.app.vault.getAbstractFileByPath(`${folder}/${voiceSyncSidecarName(c.name)}`));
    if (!todo.length) { new Notice("すべてのクリップは解析済みです。"); return; }

    const det = detectTools();
    const base = adapter.getBasePath();
    const tmp = this.desktopTmpDir() ?? base;
    const profiles = this.voiceProfilesAbs();
    let done = 0, failed = 0;
    const progress = new Notice(`VoiceSync 解析中… 0/${todo.length}${profiles.length ? `（登録済みの声 ${profiles.length} 名で識別）` : ""}`, 0);
    try {
      for (const clip of todo) {
        const r = await enrichClip(tools, this.settings.audioExtraction.ffmpegPath || det.ffmpeg, `${base}/${clip.path}`, clip.name, tmp, profiles,
          this.settings.voiceSync.clusterThreshold || 0.55);
        if (r.data) {
          await adapter.write(`${folder}/${voiceSyncSidecarName(clip.name)}`, JSON.stringify(r.data));
          done++;
        } else {
          failed++;
          console.error("[jp-collocations] voicesync failed:", clip.name, r.error);
        }
        progress.setMessage(`VoiceSync 解析中… ${done + failed}/${todo.length}（✓${done} 失敗${failed}）`);
      }
    } finally { progress.hide(); }
    new Notice(`VoiceSync: ✓${done} / 失敗${failed}${failed ? "（詳細はコンソール）" : ""}\nカードを再生成すると話者同期プレーヤーが埋め込まれます。`, 10000);
  }

  /** The library's persistent player: entry → its downloaded clip's app:// URL. */
  private async resolveEntryClip(entry: LibraryEntry): Promise<{ src: string; label: string } | null> {
    if (entry.tStartSec == null) return null;
    const tAbstract = this.app.vault.getAbstractFileByPath(entry.file);
    if (!(tAbstract instanceof TFile)) return null;
    const tContent = await this.app.vault.cachedRead(tAbstract);
    const videoId = this.resolveVideoId(tAbstract, tAbstract, tContent);
    if (!videoId) return null;
    const name = clipNameFor({ videoId, startSec: entry.tStartSec }, this.settings.audioExtraction);
    const clip = this.app.metadataCache.getFirstLinkpathDest(name, "");
    if (!clip) return null;
    return { src: this.app.vault.getResourcePath(clip), label: name };
  }

  /** Attestation → downloaded clip (shared by the review view + lexicon tree). */
  async resolveAttestationClip(att: Attestation): Promise<{ src: string; label: string } | null> {
    if (att.source !== "yt" || att.tStartSec == null || !att.file) return null;
    const tAbstract = this.app.vault.getAbstractFileByPath(att.file);
    if (!(tAbstract instanceof TFile)) return null;
    const tContent = await this.app.vault.cachedRead(tAbstract);
    const videoId = att.videoId ?? this.resolveVideoId(tAbstract, tAbstract, tContent);
    if (!videoId) return null;
    const name = clipNameFor({ videoId, startSec: att.tStartSec }, this.settings.audioExtraction);
    const clip = this.app.metadataCache.getFirstLinkpathDest(name, "");
    if (!clip) return null;
    return { src: this.app.vault.getResourcePath(clip), label: name };
  }

  /** Open an attestation's source: transcript block, tweet URL, or web page. */
  openAttestation(att: Attestation): Promise<void> {
    if ((att.source === "x" || att.source === "web") && att.file && /^https?:/.test(att.file)) {
      window.open(att.file); return Promise.resolve();
    }
    if (!att.file) return Promise.resolve();
    const sub = att.anchorId ?? att.blockId;
    return this.app.workspace.openLinkText(sub ? `${att.file}#^${sub}` : att.file, "", false).then(() => undefined);
  }

  /** The catalog header's 🔴 gold scoreboard (shared library + review). */
  /** §23.3 layer-2 gold: persist one component-pill verdict (idempotent per
   *  suggestion — a re-tap overwrites, keeping the latest human word). */
  private async recordComponentVerdict(v: ComponentVerdict): Promise<void> {
    const key = v.file + "|" + componentKeyOf({ kind: v.kind, unitText: v.unitText }, v.turnText);
    this.componentGold[key] = { ...v, at: Date.now() };
    await this.dm.setKey("_componentGold", this.componentGold);
    // …and mirror it into the ledger, so a measurement reads ONE place (§6.5).
    // `_componentGold` stays the layer-2 store — it holds the turn text and the
    // evidence span, which the ledger deliberately does not.
    await this.ratifyStore.record(componentRow(v.file, key, v.kind, v.verdict === "accept", Date.now()));
  }

  /**
   * Apply one study probe's answer (AUDIT §6.5).
   *
   * Order matters: the SIDE EFFECT lands first, so a ✓ genuinely confirms the
   * attestation and the pattern becomes reviewable in the same gesture, and the
   * ledger row second. Doing it the other way round would leave a ledger that
   * claims a judgement the catalog never received if the write failed.
   *
   * Returns the sentence worth showing, or null when there is nothing to say —
   * a probe that produces a Notice on every tap is a chore wearing a new hat.
   */
  async answerProbe(probe: Probe, verdict: Verdict, answer?: string): Promise<string | null> {
    const p = this.patternStore.all().find((x) => x.id === probe.patternId);
    let msg: string | null = null;

    if (verdict !== "skip" && p) {
      if (probe.kind === "sighting") {
        // The reward, stated at the moment it is earned: a pattern whose only
        // material was a suggestion cannot be reviewed at all (`pickAttestation`
        // takes confirmed sightings only), so this ✓ is what puts it in the deck.
        const hadMaterial = p.attestations.some((a) => !a.status);
        if (verdict === "yes") {
          await this.patternStore.ratifyAttestation(p.id, probe.subject);
          msg = hadMaterial ? "✓ 実例を確定しました" : "✓ 実例を確定 — このカードが復習に入りました";
        } else {
          await this.patternStore.rejectAttestation(p.id, probe.subject);
          msg = "✕ 除外 — 掃き出しは二度と提案しません";
        }
      } else if (probe.kind === "class") {
        // A ✕ that only said "go and fix it elsewhere" would leave all 255 open
        // class suggestions exactly where they are; the view offers the six
        // classes inline, so a disagreement completes here.
        if (answer === DISPOSE) {
          await this.patternStore.remove(p.id);
          msg = `🗑 「${p.key}」を台帳から削除しました`;
        } else {
          const cls = (verdict === "no" && answer ? answer : p.class) as NoteClass;
          await this.patternStore.setClass(p.id, cls);
          msg = verdict === "yes"
            ? "✓ 分類を確定しました"
            : `✓ ${NOTE_TYPES[cls].emoji} ${NOTE_TYPES[cls].label} に付け替えました`;
        }
      } else if (probe.kind === "move") {
        msg = verdict === "yes"
          ? `✓ 「${p.key}」の見え方 ${probe.covers}件を一度に確定しました`
          : "✕ この見え方は当てにならない、と記録しました";
      }
    }

    await this.ratifyStore.record(answerOf(probe, verdict, Date.now(), "review", answer));
    this.refreshReconLibrary();
    return msg;
  }

  /**
   * The readout §6.5 exists to make possible: what the ledger can and cannot
   * say yet. Deliberately blunt about the second half — every number here was
   * previously the model grading its own output, and the point is not to
   * replace that with a friendlier number but with a falsifiable one.
   */
  private ratificationReport(): string {
    const data = this.ratifyStore.data();
    const r = ratifyReport(data);
    const open = openCounts(this.patternStore.all(), data);
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const prop = (p: { n: number; yes: number; pct: number; lo: number; hi: number } | null, floor: number) =>
      p ? `${pct(p.pct)}（${p.yes}/${p.n}、95%区間 ${pct(p.lo)}–${pct(p.hi)}）`
        : `— まだ言えません（${floor}件必要）`;

    const L: string[] = [];
    L.push(`## 照合の記録 — ${r.total}件`);
    L.push("");
    L.push("### 掃き出しの精度（一様抽出のみ）");
    L.push(`${prop(r.sweepPrecision, MIN_FOR_PRECISION)}　　一様抽出 ${r.randomN}件（${MEASUREMENT_EVERY}問に1問）`);
    L.push("");
    L.push("この数字だけが「精度」と呼べます。下の行は**わざと迷う側に寄せて**選んだ標本なので、");
    L.push("低く出るのが正常であり、上の数字と混ぜてはいけません。");
    L.push(`　不確実性抽出: ${prop(r.sweepBiased, MIN_FOR_PRECISION)}`);
    L.push("");
    L.push("### 語がしていること（語法ラベルの一致）");
    L.push(`${prop(r.moveAgreement, 5)}　　確定した見え方 ${r.moveCovers}件ぶん`);
    L.push("");
    L.push("### 分類の提案がそのまま通った割合");
    L.push(prop(r.classAgreement, MIN_FOR_PRECISION));
    L.push("");
    L.push("### 予測ドリル — 学習者と計算の一致率");
    L.push(prop(r.drillAgreement, MIN_FOR_PRECISION));
    L.push("**これはパーサの正解率ではありません。** 凍結点で食い違ったとき、どちらが正しいかを");
    L.push("決める第三者はいません。使い道は下の「食い違いの型」— 同じ拒み方が繰り返されている所です。");
    if (r.drillSplits.length) {
      L.push("");
      for (const s of r.drillSplits) L.push(`　${s.claim} と言われて「${s.answer}」と答えた: ${s.n}回`);
    }
    L.push("");
    L.push("### 談話モードの部品判定");
    L.push(prop(r.componentAgreement, 5));
    L.push("");
    L.push(`### まだ開いているもの — ${open.total}問`);
    L.push(`　語法の見え方 ${open.move}問 → 実例 ${open.covered.toLocaleString()}件ぶんが決まります`);
    L.push(`　未確定の分類 ${open.class}問`);
    L.push(`　個別の実例 ${open.sighting}問（語法でまとめられない分だけ）`);
    L.push("");
    L.push("復習で1枚採点するごとに1問だけ出ます。別途の作業はありません。");
    return L.join("\n");
  }

  goldInfo(): { total: number; agreementPct: number | null } {
    const s = this.goldStore.stats();
    return {
      total: s.total,
      agreementPct: s.actAgreement.graded
        ? Math.round((s.actAgreement.agreed / s.actAgreement.graded) * 100)
        : null,
    };
  }

  /** Open (or reveal) the SRS review view. With `focusIds`, jump straight into
   *  a session over exactly those patterns (the ⚡ run's fresh cards). */
  async openReviewView(focusIds?: string[]): Promise<void> {
    await this.srsStore.prune(new Set(this.patternStore.all().map((p) => p.id)));
    const leaf = this.surfaceLeaf(JP_REVIEW_VIEW_TYPE);
    if (leaf && leaf.view?.getViewType() !== JP_REVIEW_VIEW_TYPE) {
      await leaf.setViewState({ type: JP_REVIEW_VIEW_TYPE, active: true });
    }
    if (leaf) {
      this.app.workspace.revealLeaf(leaf);
      const view = leaf.view as ReviewView;
      if (focusIds && focusIds.length) view.reviewSpecific(focusIds);
      else view.refresh();
    }
  }

  /** Local image embeds (`![[…]]` and `![](…)`) in a notes file, resolved to files. */
  private findEmbeddedImages(content: string, file: TFile): TFile[] {
    const out: TFile[] = [];
    const seen = new Set<string>();
    const patterns = [
      /!\[\[([^\]|#\n]+?\.(?:png|jpe?g|webp|gif))(?:\|[^\]\n]*)?\]\]/gi,
      /!\[[^\]\n]*\]\(([^)\s]+?\.(?:png|jpe?g|webp|gif))\)/gi,
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        let link = m[1];
        try { link = decodeURIComponent(link); } catch { /* keep raw */ }
        if (/^https?:/i.test(link)) continue;   // remote images: not our OCR input
        const f = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
        if (f && !seen.has(f.path)) { seen.add(f.path); out.push(f); }
      }
    }
    return out;
  }

  /** Vision payload(s) for one page image. Tall Apple-Notes strips are TILED
   *  along the long axis at native resolution (the API downsizes any image to
   *  ≤1568px on its long side — a 280×3090 strip sent whole comes back 142px
   *  wide and illegible); the tiles go into ONE message in reading order.
   *  Oversized short sides are downscaled first. Degrades soft to the raw
   *  bytes as a single image if the DOM decode fails. */
  private async prepareImageTiles(buf: ArrayBuffer, ext: string): Promise<VisionImage[]> {
    const mediaType: VisionImage["mediaType"] =
      ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
    const MAX_DIM = 1400;
    try {
      const bmp = await createImageBitmap(new Blob([buf], { type: mediaType }));
      const shortSide = Math.min(bmp.width, bmp.height);
      const scale = shortSide > MAX_DIM ? MAX_DIM / shortSide : 1;
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      // Narrow strips get magnified (2–3×) — tiles are planned smaller so the
      // UPSCALED long side still fits the model's useful resolution.
      const up = tileUpscale(Math.min(w, h), MAX_DIM);
      const tiles = planTiles(w, h, { maxDim: Math.floor(MAX_DIM / up) });
      if (tiles.length === 1 && scale === 1 && up === 1 && buf.byteLength <= 3_500_000) {
        bmp.close();
        return [{ base64: arrayBufferToBase64(buf), mediaType }];   // small page: send verbatim
      }
      const out: VisionImage[] = [];
      for (const t of tiles) {
        const canvas = document.createElement("canvas");
        canvas.width = t.w * up; canvas.height = t.h * up;
        const ctx = canvas.getContext("2d");
        if (!ctx) break;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        // draw the tile's source region (undo the scale to find it in the bitmap)
        ctx.drawImage(bmp, t.x / scale, t.y / scale, t.w / scale, t.h / scale, 0, 0, t.w * up, t.h * up);
        // PNG: pen strokes stay crisp (JPEG ringing eats thin handwriting)
        const dataUrl = canvas.toDataURL("image/png");
        out.push({ base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mediaType: "image/png" });
      }
      bmp.close();
      if (out.length) return out;
    } catch { /* decode failed (unsupported codec?) → send raw */ }
    return [{ base64: arrayBufferToBase64(buf), mediaType }];
  }

  private async prepareReconcile(): Promise<ReconPrep | null> {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice("ノートファイルを開いてください"); return null; }
    const content = await this.app.vault.cachedRead(file);
    const srcRefs = frontmatterSources(content);
    if (!srcRefs.length) { new Notice(
        "これはキャプチャノートではありません。frontmatter に `sources: [[文字起こし]]`"
        + "（複数可: カンマ/リスト）が必要です。\n"
        + "文字起こしを開いて「📝 このトランスクリプトからキャプチャノートを作成」を実行すると一発で作れます。",
        12000); return null; }

    // Resolve every referenced transcript (a page can span several videos).
    const heads: { tFile: TFile; pristine: string; lines: MatcherLine[]; videoId: string | null }[] = [];
    for (const src of srcRefs) {
      const tFile = this.app.metadataCache.getFirstLinkpathDest(src, file.path);
      if (!tFile) { new Notice(`文字起こしが見つかりません: ${src}`); return null; }
      const tContent = await this.app.vault.cachedRead(tFile);
      const pristine = stripAnchors(tContent);
      const lines = parseTranscriptLines(pristine);
      if (!lines.length) { new Notice(`文字起こしに行が見つかりません: ${tFile.basename}`); return null; }
      heads.push({ tFile, pristine, lines, videoId: this.resolveVideoId(file, tFile, tContent, content) });
    }

    const notes = extractNotePhrases(content);
    if (!notes.length) { new Notice("照合するメモが見つかりません"); return null; }

    // Real transcripts are 100k+ chars — run note-by-note with progress, never
    // blocking the UI thread. Each phrase goes to whichever transcript matches best.
    const progress = new Notice(`照合中… 0/${notes.length}${heads.length > 1 ? `（${heads.length} 動画）` : ""}`, 0);
    let grouped: ReconciledResult[][];
    try {
      grouped = await reconcileMultiAsync(notes, heads.map((h) => h.lines),
        makeDictionaryReadingResolver(this.dictStore),
        (done, total) => progress.setMessage(`照合中… ${done}/${total}`));
    } finally { progress.hide(); }

    const sources: ReconSource[] = heads.map((h, i) => ({
      ...h,
      results: grouped[i],
      // Only confident, non-trivial spans are written INTO a transcript.
      // needs-review results still reach the library (unanchored rows) for
      // human triage — they never pollute the frozen source text.
      plan: planAnchors(grouped[i].filter((r) => this.anchorable(r)), h.lines),
    }));
    return { file, sources };
  }

  /** May this result be anchored into the transcript / carded / clipped?
   *  auto (confident + unambiguous) AND long enough to be a real quote — a
   *  2–3 char fragment matches "perfectly" all over a 3-hour transcript. */
  private anchorable(r: ReconciledResult): boolean {
    return r.status === "auto" && !!r.best && r.note.trim().length >= 4;
  }

  // ── Needs-review triage (P4): ≤2 clicks from flagged to resolved ─────────

  /** Re-anchor ONE result into its transcript alongside the file's existing
   *  anchors (shared by approve and edit-retry). The transcript is stripped to
   *  pristine and fully re-planned so clusters stay correct. */
  private async reanchorSingle(entry: LibraryEntry, r: ReconciledResult): Promise<boolean> {
    const tFile = this.app.vault.getAbstractFileByPath(entry.file);
    if (!(tFile instanceof TFile)) { new Notice(`ファイルが見つかりません: ${entry.file}`); return false; }
    const md = await this.app.vault.read(tFile);
    const pristine = stripAnchors(md);
    const lines = parseTranscriptLines(pristine);
    const newBlockId = blockIdFor(r);

    const priorClass = this.reconLibrary.classMapForFile(entry.file);
    priorClass.set(newBlockId, entry.noteClass);
    const foreign = this.reconLibrary.forFile(entry.file)
      .filter((e) => e.blockId !== entry.blockId && e.blockId !== newBlockId && e.anchorId)
      .map((e) => entryToResult(e))
      .filter((x): x is ReconciledResult => x !== null);
    const combined = planAnchors([r, ...foreign], lines);
    if (!combined.anchorIdOf.get(newBlockId)) { new Notice("アンカー計画に失敗しました（スパン不明）"); return false; }
    await this.app.vault.modify(tFile, applyAnchors(pristine, combined, (id) => priorClass.get(id) ?? DEFAULT_NOTE_CLASS));

    // clustering may have moved neighbours' anchors — keep their embeds live
    for (const fr of foreign) {
      const anchor = combined.anchorIdOf.get(blockIdFor(fr));
      if (anchor) this.reconLibrary.setAnchorId(blockIdFor(fr), anchor);
    }
    if (newBlockId !== entry.blockId) this.reconLibrary.remove(entry.blockId);
    const built = buildAnchoredEntries([r], combined, entry.file, entry.sourceNote ?? "", priorClass);
    this.reconLibrary.upsertMany(built);
    // the catalog gains/updates its attestation for this sighting
    const now = Date.now();
    await this.patternStore.record(r.note, {
      source: "yt", file: entry.file, videoId: this.resolveVideoId(tFile, tFile, pristine),
      tStartSec: r.tStartSec, blockId: newBlockId, anchorId: combined.anchorIdOf.get(newBlockId),
      quote: r.reconciled, addedAt: now,
    }, now);
    this.refreshReconLibrary();
    return true;
  }

  /** Triage ✅: trust the best candidate of a needs-review entry and anchor it. */
  async approveEntry(entry: LibraryEntry): Promise<boolean> {
    const r = entryToResult(entry);
    if (!r) { new Notice("候補スパンがありません — ✏️ で書き直して再照合してください"); return false; }
    r.status = "auto";
    const ok = await this.reanchorSingle(entry, r);
    if (ok) new Notice(`✅ 採用: 「${r.reconciled}」 ~${Math.floor((r.tStartSec ?? 0) / 60)}:${String((r.tStartSec ?? 0) % 60).padStart(2, "0")}`);
    return ok;
  }

  /** Triage ✏️: re-match a corrected reading of the note against the transcript. */
  async retryEntry(entry: LibraryEntry, newNote: string): Promise<"anchored" | "needs-review" | "not-found"> {
    const note = newNote.trim();
    if (!note) return "not-found";
    const tFile = this.app.vault.getAbstractFileByPath(entry.file);
    if (!(tFile instanceof TFile)) { new Notice(`ファイルが見つかりません: ${entry.file}`); return "not-found"; }
    const pristine = stripAnchors(await this.app.vault.read(tFile));
    const r = reconcileOne(note, parseTranscriptLines(pristine));
    if (!r.best) {
      new Notice(`「${note}」— 対応箇所が見つかりません`);
      return "not-found";
    }
    if (r.status === "auto" && note.length >= 4) {
      const ok = await this.reanchorSingle(entry, r);
      if (ok) { new Notice(`✅ 照合成功: 「${r.reconciled}」(${(r.confidence * 100).toFixed(0)}%)`); return "anchored"; }
      return "needs-review";
    }
    // still ambiguous/uncertain — update the entry so ✅ can adopt the new best
    this.reconLibrary.remove(entry.blockId);
    this.reconLibrary.upsertMany([{
      ...entry, blockId: blockIdFor(r), note: r.note, reconciled: r.reconciled,
      tStartSec: r.tStartSec, status: "needs-review", confidence: r.confidence,
      corrections: r.corrections.length, anchorId: undefined,
      spanStartLine: r.best.startLine, spanEndLine: r.best.endLine,
    }]);
    this.refreshReconLibrary();
    new Notice(`🔶 まだ曖昧です (${(r.confidence * 100).toFixed(0)}%) — 最有力: 「${r.reconciled}」。✅で採用できます`);
    return "needs-review";
  }

  // ── Corpus joins (P3): the catalog reaches OUT into the corpora ──────────

  /** 𝕏 join: offline co-occurrence search of the X corpus for this pattern —
   *  a 🟠 link means "a tweet containing EVERY component" (the bundle's ★
   *  concept, but within one pattern). Hits become `source:'x'` attestations.
   *  Purely offline: no network, no cookies. Returns tweets newly attached. */
  async xJoinPattern(p: PatternEntry): Promise<number> {
    const terms = sweepTerms(p);
    if (!terms.length) { new Notice("検索できる語がありません（2文字以上の成分が必要）"); return 0; }
    const q = emptyQuery(this.settings.x.defaultLang || "ja");
    q.allTerms = terms;
    const tweets = this.xCorpus.search(q, 50);
    const before = this.patternStore.byId(p.id)?.attestations.length ?? 0;
    const now = Date.now();
    /**
     * §29.2 — a WINDOW around the hit, marked suggested.
     *
     * Both halves of this were wrong before. The quote was the whole tweet:
     * mean length in this corpus is 533 characters, p90 of what actually landed
     * in the catalog was 4,691, and the longest 用例 filed under 「だよね」 was a
     * 9,721-character marketing thread. You cannot see a phrase working inside
     * 9,721 characters, which makes it a haystack rather than a scene (§22).
     * And it was recorded CONFIRMED — a machine substring match wearing the
     * weight of a ratified fact, which is precisely what §28 S3 forbids. The
     * hand is the classifier; a corpus join is a recall machine.
     */
    const longest = terms.reduce((a, b) => (b.length > a.length ? b : a), terms[0]);
    await this.patternStore.recordMany(tweets.map((t) => {
      const line = buildXUsage([t], longest, 1).lines[0];
      return {
        note: p.note,
        // §28 S2: carry the door back. The corpus join used to leave `medium`
        // and `scene` empty, so a tweet attached here rendered without the X
        // affordances the same tweet gets when captured by hand.
        att: {
          source: "x" as const, medium: "x" as const, file: t.url,
          scene: { deepLink: t.url, sourceName: t.authorHandle ? `@${t.authorHandle}` : "X" },
          quote: line ? kwicQuote(line) : t.text.replace(/\s+/g, " ").trim().slice(0, 140),
          addedAt: now, status: "suggested" as const, matchKind: "x-corpus",
        },
      };
    }), now);
    const added = (this.patternStore.byId(p.id)?.attestations.length ?? 0) - before;
    new Notice(tweets.length
      ? `𝕏 ${terms.join("+")} — コーパス内 ${tweets.length}件（新規 ${added}件）`
      : `𝕏 コーパスに「${terms.join("」+「")}」の共起なし（コーパス ${this.xCorpus.size()}件中）`);
    return added;
  }

  /**
   * CLASS-AWARE sweep of one transcript file (DESIGN §15). Two tiers:
   *   1. near-verbatim reconcile (≥0.9) — CONFIRMED attestation. The only tier
   *      allowed to assert truth, because there the unit IS the surface.
   *   2. the class-appropriate structural matcher (🔵 components / 🟠 link /
   *      💠 frame / 🟢 halo, deinflection-aware) — SUGGESTED attestation,
   *      quarantined until the user runs the semantic test (✓/✕ in 語彙).
   * All adds are BY ENTRY ID — no key re-derivation, so lemma-keyed 🟢 and
   * class-sibling entries keep their identity. Read-only on the transcript.
   */
  private async sweepOneTranscript(f: TFile, mdIn?: string): Promise<{ confirmed: number; suggested: number; isTranscript: boolean }> {
    const md = mdIn ?? await this.app.vault.cachedRead(f);
    // Only genuine caption transcripts (timestamped lines) — the untimed
    // fallback of parseTranscriptLines would "match" any prose note.
    if (!CAPTION_STAMP_RE.test(md)) return { confirmed: 0, suggested: 0, isTranscript: false };
    const lines = parseTranscriptLines(md);
    if (lines.length < 5 || lines[0].tStartSec == null) return { confirmed: 0, suggested: 0, isTranscript: false };
    const videoId = this.resolveVideoId(f, f, md);
    // §22: a swept TV/podcast/book transcript carries its medium + show name
    // so its attestations group under the right scene (📺/🎙), not under ▶.
    const fmMedium = md.slice(0, 400).match(/^source:\s*(tv|podcast|book|note|manga)\s*$/m)?.[1] as
      "tv" | "podcast" | "book" | "note" | "manga" | undefined;
    const fmShow = md.slice(0, 400).match(/^(?:show|book_title|site):\s*"?([^"\n]+?)"?\s*$/m)?.[1];
    const sceneTag = fmMedium ? { medium: fmMedium, ...(fmShow ? { scene: { sourceName: fmShow } } : {}) } : {};
    const now = Date.now();
    const batch: { id: string; att: Attestation }[] = [];
    let confirmedCount = 0;
    for (const p of this.patternStore.all()) {
      if (p.class === "discourse") continue;            // responsivity test — not sweepable
      if (p.attestations.some((a) => a.file === f.path && !a.status)) continue; // already confirmed here
      // Tier 1 — the reconcile gate (auto + ≥0.7) assumes the note was written
      // ABOUT this video. A global sweep has no such prior: a 4-char fragment
      // "auto"-matches partial spans in every 3-hour transcript (そうなら →
      // 「そうな」@0.80 everywhere — measured). Only near-verbatim is real.
      const r = reconcileOne(p.note, lines);
      if (this.anchorable(r) && r.confidence >= 0.9) {
        batch.push({ id: p.id, att: {
          source: "yt", file: f.path, videoId, tStartSec: r.tStartSec,
          quote: r.reconciled, addedAt: now, ...sceneTag,
        } });
        confirmedCount++;
        continue;
      }
      // Tier 2 — structural candidates for the classes that define a parse
      if (!sweepableClass(p.class)) continue;
      if (sweepMuted(p)) continue; // the user's ✕s proved this entry coincidence-prone
      if (p.attestations.some((a) => a.file === f.path)) continue; // already suggested here
      for (const c of sweepEntry(p, lines)) {
        batch.push({ id: p.id, att: {
          source: "yt", file: f.path, videoId, tStartSec: c.tStartSec, quote: c.quote,
          addedAt: now, status: "suggested", matchKind: c.matchKind, confidence: c.confidence, ...sceneTag,
        } });
      }
    }
    const added = batch.length ? await this.patternStore.addAttestations(batch, now) : 0;
    return { confirmed: Math.min(confirmedCount, added), suggested: Math.max(0, added - confirmedCount), isTranscript: true };
  }

  /**
   * AUTO-SWEEP — the one-entry sweep, run the moment a card is classified.
   *
   * The full sweep (`sweepCatalog`) is pattern-major: every entry against every
   * transcript. That is the right shape for a periodic pass and the wrong shape
   * for a gesture — measured on this vault (302 patterns × 123 transcripts),
   * Tier 1's `reconcileOne` alone costs 1.1–4.8 s **per entry**, so the full
   * sweep is minutes. It therefore sits 38th in a list of 60 commands and is
   * effectively never run, which is why a phrase flicked into the tray never
   * found the four other places you had already heard it.
   *
   * This is the inverse: ONE entry against every transcript, cheap enough to
   * run unprompted.
   *
   * Two decisions make it cheap, and the second is the important one:
   *
   *  • Parsed transcripts are cached by (path, mtime), so the second drop of a
   *    session pays nothing to read 7.5 MB again. (Measured: 171 ms cold for
   *    123 transcripts / 103k lines.)
   *
   *  • **Tier 2 only.** `sweepEntry` — the class-aware structural matcher —
   *    costs ~100 ms for one entry across the whole vault. Tier 1's fuzzy
   *    `reconcileOne` is 10–50× that and is deliberately NOT run here. This is
   *    a correctness argument before a speed one: Tier 1 writes CONFIRMED
   *    attestations, and a confirmed attestation is a claim about meaning that
   *    the project reserves for a human (§28 / DISCOURSE-VERDICT §12 —
   *    "volume is not evidence"). Everything this produces is
   *    `status:'suggested'`, awaiting one-tap ✓/✕ in the 語彙 tab. A prefilter
   *    was tried to make Tier 1 affordable and rejected: it silently lost 2 of
   *    46 real hits on 気になる, and a sweep that quietly misses attestations is
   *    worse than one that does not claim them.
   */
  private sweepCache = new Map<string, {
    mtime: number;
    /** null = this file is not a transcript. Cached deliberately — 480 of this
     *  vault's 604 notes are not transcripts, and re-reading them on every drop
     *  is the bulk of the cold cost. mtime still guards it, so a note EDITED
     *  into a transcript is picked up rather than being negatively cached
     *  forever. */
    rec: {
      lines: ReturnType<typeof parseTranscriptLines>;
      videoId: string | null;
      sceneTag: Record<string, unknown>;
      /** which Attestation.source this medium writes — 'yt' for captioned
       *  video, 'web' for prose. */
      attSource?: "yt" | "web";
    } | null;
  }>();

  /** Parsed transcript for a file, or null if it is not one. */
  /**
   * A transcript's own account of where it came from.
   *
   * ONE derivation, shared by the sweep and the concordance, because they were
   * disagreeing: `sweepRecord` read `source:` out of the frontmatter while
   * `buildConcordance` hard-coded `yt`. Two writers producing attestations with
   * contradictory provenance for the same file is the seam §28 S2 forbids.
   *
   * `source` stays the coarse four-value bucket the `Attestation` type allows;
   * `medium` carries the truth. A deep link is emitted ONLY for a real videoId —
   * a Plex episode has no youtu.be URL and claiming one is worse than omitting it.
   */
  private transcriptProvenance(md: string, videoId: string | null): {
    source: "yt" | "web"; medium: Medium; deepLink?: string;
  } {
    const fm = md.slice(0, 400);
    const declared = fm.match(/^source:\s*(yt|tv|podcast|book|note|manga|x|web)\s*$/m)?.[1] as Medium | undefined;
    const medium: Medium = declared ?? (videoId ? "yt" : "web");
    return {
      // Only a YouTube transcript is honestly `source:'yt'`; everything else
      // buckets to 'web' so the lexicon's source facet stops filing TV under
      // YouTube.
      source: medium === "yt" ? "yt" : "web",
      medium,
      ...(videoId ? { deepLink: `https://youtu.be/${videoId}` } : {}),
    };
  }

  /** 番組名 / 書名 / site, as the transcript declares it. */
  private transcriptSourceName(md: string): string | undefined {
    return md.slice(0, 400).match(/^(?:show|book_title|site|title):\s*"?([^"\n]+?)"?\s*$/m)?.[1]?.trim() || undefined;
  }

  private async sweepRecord(f: TFile) {
    const hit = this.sweepCache.get(f.path);
    if (hit && hit.mtime === f.stat.mtime) return hit.rec;

    const miss = (): null => { this.sweepCache.set(f.path, { mtime: f.stat.mtime, rec: null }); return null; };
    const md = await this.app.vault.cachedRead(f);

    // §6.7-3 — a reading note (Kindle / note.com) is prose with no timestamps.
    // It was ALREADY being handed to the sweep — `import-written` writes these
    // into the transcript folder — and was dropped for want of a caption stamp.
    // The matcher never needed one (`lines[i].tStartSec ?? null`); only the line
    // producer did.
    const reading = readingSource(md);
    if (reading) {
      const lines = proseLines(md);
      if (lines.length < 3) return miss();
      const rec = {
        lines, videoId: null,
        sceneTag: {
          medium: reading.medium,
          ...(reading.sourceName || reading.url
            ? { scene: { ...(reading.sourceName ? { sourceName: reading.sourceName } : {}),
                         ...(reading.url ? { deepLink: reading.url } : {}) } }
            : {}),
        } as Record<string, unknown>,
        attSource: "web" as const,
      };
      this.sweepCache.set(f.path, { mtime: f.stat.mtime, rec });
      return rec;
    }

    if (!CAPTION_STAMP_RE.test(md)) return miss();
    const lines = parseTranscriptLines(md);
    if (lines.length < 5 || lines[0].tStartSec == null) return miss();
    const fmMedium = md.slice(0, 400).match(/^source:\s*(tv|podcast|book|note|manga)\s*$/m)?.[1] as
      "tv" | "podcast" | "book" | "note" | "manga" | undefined;
    const fmShow = md.slice(0, 400).match(/^(?:show|book_title|site):\s*"?([^"\n]+?)"?\s*$/m)?.[1];
    const rec = {
      lines,
      videoId: this.resolveVideoId(f, f, md),
      sceneTag: (fmMedium ? { medium: fmMedium, ...(fmShow ? { scene: { sourceName: fmShow } } : {}) } : {}) as Record<string, unknown>,
      attSource: "yt" as const,
    };
    // Bound the cache: mobile has far less headroom and a session rarely
    // touches more than a few dozen transcripts. Evicting the oldest key is
    // enough — this is a warm-start optimisation, not a correctness mechanism.
    const cap = Platform.isMobile ? 60 : 400;
    if (this.sweepCache.size >= cap) this.sweepCache.delete(this.sweepCache.keys().next().value as string);
    this.sweepCache.set(f.path, { mtime: f.stat.mtime, rec });
    return rec;
  }

  /**
   * Sweep ONE entry across every transcript. Returns what it found so the
   * caller can say so — a silent background write would be the "no silent
   * caps" rule broken in the other direction.
   */
  async autoSweepEntry(p: PatternEntry): Promise<{ sightings: number; files: number; found: number; skipped: string | null }> {
    if (p.class === "discourse") return { sightings: 0, files: 0, found: 0, skipped: "discourse" };
    if (!sweepableClass(p.class)) return { sightings: 0, files: 0, found: 0, skipped: "class" };
    if (sweepMuted(p)) return { sightings: 0, files: 0, found: 0, skipped: "muted" };

    const files = this.app.vault.getMarkdownFiles().filter((f) => !f.path.endsWith("-cards.md"));
    const seen = new Set(p.attestations.map((a) => a.file));
    const now = Date.now();
    const found: { file: string; att: Attestation }[] = [];
    for (const f of files) {
      if (seen.has(f.path)) continue;                 // already attested here
      const rec = await this.sweepRecord(f);
      if (!rec) continue;
      for (const c of sweepEntry(p, rec.lines)) {
        found.push({ file: f.path, att: {
          source: rec.attSource ?? "yt", file: f.path, videoId: rec.videoId,
          tStartSec: c.tStartSec, quote: c.quote,
          addedAt: now, status: "suggested", matchKind: c.matchKind, confidence: c.confidence,
          ...rec.sceneTag,
        } });
      }
    }

    // §6.7-3 — the X corpus is not a file, so it is swept separately: tweets
    // live in the plugin blob, not the vault. Japanese-only (X returns a lot of
    // English, and no Japanese collocation is attested by an English tweet), and
    // the tweet URL is the `file` key so the "already attested here" test and
    // the door back both work exactly as they do for a transcript path.
    for (const tw of sweepableTweets(this.xCorpus.getAll())) {
      if (seen.has(tw.url)) continue;
      for (const c of sweepEntry(p, tweetLines(tw.text))) {
        found.push({ file: tw.url, att: {
          source: "x", medium: "x", file: tw.url, videoId: null, tStartSec: null, quote: c.quote,
          addedAt: now, status: "suggested", matchKind: c.matchKind, confidence: c.confidence,
          scene: { deepLink: tw.url, ...(tw.authorHandle ? { sourceName: `@${tw.authorHandle}` } : {}) },
        } });
      }
    }

    // CAP, and say so. Measured on this vault: 「気になる」 finds 135 sightings
    // across 74 files and 「っていうのは」 238 across 96. Writing all of those on
    // a single drop would bury the ✓✕ queue under one phrase — the "volume is
    // not evidence" failure this project keeps having to unlearn. The gesture's
    // job is DISCOVERY ("you have heard this elsewhere, here is where"), not
    // exhaustive attestation; the manual full sweep remains for the latter.
    // Highest confidence first, one per file before any file gets a second, so
    // the sample spans the corpus instead of piling up in the longest video.
    const byFile = new Map<string, typeof found>();
    for (const x of found) {
      if (!byFile.has(x.file)) byFile.set(x.file, []);
      byFile.get(x.file)!.push(x);
    }
    for (const list of byFile.values()) list.sort((a, b) => (b.att.confidence ?? 0) - (a.att.confidence ?? 0));
    const ordered: typeof found = [];
    for (let round = 0; ordered.length < found.length; round++) {
      const tier: typeof found = [];
      for (const list of byFile.values()) if (list[round]) tier.push(list[round]);
      if (!tier.length) break;
      // Rank WITHIN the round by confidence, not by the order sources happened
      // to be visited. Without this the map's insertion order decides: files are
      // swept before the X corpus, so with 74 transcript hits the cap of 12 was
      // reached before a single tweet was considered, and a whole medium would
      // have been silently unreachable.
      tier.sort((a, b) => (b.att.confidence ?? 0) - (a.att.confidence ?? 0));
      ordered.push(...tier);
    }
    const capped = ordered.slice(0, AUTO_SWEEP_CAP);

    const added = capped.length
      ? await this.patternStore.addAttestations(capped.map((x) => ({ id: p.id, att: x.att })), now)
      : 0;
    return {
      sightings: added,
      files: new Set(capped.map((x) => x.file)).size,
      found: found.length,
      skipped: null,
    };
  }

  /**
   * The gesture-side wrapper: sweep, then SAY something. Non-blocking by
   * construction — the modal has already closed and the card is already in the
   * catalog, so this only ever adds.
   */
  async autoSweepAfterCapture(p: PatternEntry): Promise<void> {
    try {
      const r = await this.autoSweepEntry(p);
      if (r.skipped || !r.sightings) return;      // silence is right when there is nothing to say
      // The cap is stated whenever it bites — a truncated result presented as a
      // total reads as "that's all there is", which is the one thing it isn't.
      const more = r.found > r.sightings ? `（全${r.found}件中の上位${r.sightings}件）` : "";
      const n = new Notice(
        `🔍 「${p.key}」を ${r.files}本の文字起こしで ${r.sightings}件発見${more}\n` +
        `タップで語彙タブを開いて ✓/✕`, 9000);
      n.noticeEl.style.cursor = "pointer";
      n.noticeEl.addEventListener("click", () => { void this.openLexiconAt(p.id); });
      this.refreshReconLibrary();
      // §27.0.2 — THIS is where a collision can happen. The watcher used to be
      // called only from `sweepCatalog`, the full sweep that costs minutes and
      // never gets run, so an open 願い could sit for weeks while captures
      // landed past it every day. What just arrived is what a want collides
      // with, so the watcher runs on arrival.
      await this.watchReaches(this.incomingFrom(p));
    } catch (e) {
      console.error("[jp-collocations] auto-sweep failed", e);
    }
  }

  /** Transcript sweep: run EVERY catalog pattern against EVERY transcript in
   *  the vault, so a pattern noticed on one page accumulates sightings from
   *  videos where it was never hand-written. Swept attestations carry
   *  time+quote but no anchor (they upgrade in place if later hand-anchored). */
  async sweepCatalog(): Promise<string> {
    if (!this.patternStore.size()) return "台帳が空です";
    const files = this.app.vault.getMarkdownFiles().filter((f) => !f.path.endsWith("-cards.md"));
    const notice = new Notice("台帳走査中…", 0);
    let transcripts = 0, confirmed = 0, suggested = 0;
    try {
      for (const f of files) {
        const res = await this.sweepOneTranscript(f);
        if (!res.isTranscript) continue;
        transcripts++;
        confirmed += res.confirmed;
        suggested += res.suggested;
        notice.setMessage(`台帳走査中… ${transcripts} transcripts / 確定+${confirmed} 候補+${suggested}`);
        await new Promise((r) => setTimeout(r, 0)); // keep the UI thread alive
      }
    } finally {
      notice.hide();
    }
    const msg = `走査完了: transcripts ${transcripts}件 → 確定 +${confirmed} / 候補 +${suggested}${suggested ? "（候補は語彙タブで ✓/✕）" : ""}`;
    new Notice(msg, 6000);
    this.refreshReconLibrary();
    // §27.0.2: the sweep is the incoming attested stream — exactly where a
    // collision can happen. The watcher OFFERS against the open wants; the
    // recognition is the user's and happens in the tray.
    await this.watchReaches(this.patternStore.all().flatMap((p) =>
      p.attestations.slice(-2).map((a) => ({
        surface: a.quote,
        source: { file: a.file, tStartSec: a.tStartSec, medium: a.medium ?? a.source, deepLink: a.scene?.deepLink },
        at: a.addedAt,
      }))));
    return msg;
  }

  /**
   * §27.5/§27.7 step 3 — convert an extracted Yomitan export into vault
   * sidecars. Desktop only, and deliberately so: the export is 522MB and lives
   * outside the vault. The big dictionaries must never enter the plugin data
   * blob (AUDIT §18 recorded a 62MB blob from exactly that mistake), so this
   * writes sharded JSONL that syncs like any other vault file and uninstalls by
   * deleting the folder.
   */
  async convertBigDictionary(): Promise<string> {
    if (this.conversionRunning) return this.refuseSecondConversion();
    const folder = this.settings.bigDict?.exportFolder?.trim();
    if (!folder) {
      new Notice("設定 → 大型辞書 に、展開したYomitan辞書フォルダのパスを入力してください。", 8000);
      return "no export folder configured";
    }
    let src: BankSource;
    try {
      src = nodeBankSource(folder);
    } catch (err) {
      new Notice(String(err instanceof Error ? err.message : err), 10000);
      return String(err);
    }

    this.conversionRunning = "辞書";
    const notice = new Notice("辞書変換の準備中…", 0);
    let cancelled = false;
    // Coalesce the ~242,000 shard appends into a few dozen large writes —
    // without this the run times out (see bufferedSidecarIO).
    const io = bufferedSidecarIO(vaultSidecarIO(this.app));
    try {
      const res = await importEijiro(io, src, {
        root: this.bigDictRoot,
        shouldStop: () => cancelled,
        onProgress: (p) => {
          notice.setMessage(
            `辞書変換 ${p.bank}/${p.banks} — ${p.headwords.toLocaleString()}見出し / ${p.frames.toLocaleString()}フレーム`,
          );
        },
      });
      // §28 S6: a partial import says so, in place, with the failures named.
      await io.flush();            // the tail of every shard is still in memory
      this.bigDict.invalidate();   // a re-convert must be visible immediately
      const msg = res.failed.length
        ? `${res.title}: ${res.headwords.toLocaleString()}見出し変換（${res.failed.length}バンク失敗: ${res.failed.slice(0, 3).join(", ")}）— 不完全です`
        : `${res.title}: ${res.headwords.toLocaleString()}見出し / ${res.frames.toLocaleString()}フレーム → ${res.dir}（${(res.ms / 1000).toFixed(1)}秒）`;
      new Notice(msg, 12000);
      return msg;
    } catch (err) {
      const msg = `辞書変換に失敗: ${String(err instanceof Error ? err.message : err)}`;
      new Notice(msg, 12000);
      return msg;
    } finally {
      this.conversionRunning = null;
      notice.hide();
    }
  }

  /**
   * THE MOVE CONCORDANCE (DISCOURSE-VERDICT §11 fail branch, §12 result).
   *
   * M1 measured 21.5% against a pre-registered 25%, so the board is finished as
   * a route to a parser and the direction is the concordance: a timestamped,
   * provenance-carrying index of interactional MARKER INSTANCES, with the move
   * label demoted to a hint.
   *
   * It is deliberately NOT a new store (DESIGN §28 S5 — one road in). Each
   * marker becomes a 🔴 discourse entry in the catalog you already have, and
   * every occurrence an attestation with `status:'suggested'`, so it inherits
   * the lexicon's context tree, ✓✕ ratification, clip playback and source
   * jumps for free — and so ratification happens as a byproduct of study
   * rather than as homework (§28 S3, the corollary that 0/109 taught us).
   */
  async buildConcordance(): Promise<string> {
    const files = this.app.vault.getMarkdownFiles().filter((f) => !f.path.endsWith("-cards.md"));
    const notice = new Notice("談話コンコーダンス作成中…", 0);
    const now = Date.now();
    let transcripts = 0, instances = 0;
    const merged = new Map<string, ConcordanceRow[]>();
    try {
      for (const f of files) {
        const md = await this.app.vault.cachedRead(f);
        if (!CAPTION_STAMP_RE.test(md)) continue;
        transcripts++;
        const { turns } = transcriptToTurns(md);
        const videoId = this.resolveVideoId(f, f, md);
        // The medium comes from the transcript's OWN frontmatter, never from a
        // constant. This loop walks EVERY stamped markdown file in the vault —
        // Plex episodes, jimaku subtitles, whisper'd podcasts, hand-pasted .srt —
        // and used to stamp `medium:'yt'` on all of them. That is where most of
        // the catalog's suggested attestations came from, so most of the corpus
        // asserted a medium it did not have and offered no door back in the
        // medium it actually had (§28 S2). `deepLink` is emitted only when a
        // videoId really exists.
        const rows = buildConcordanceRows(turns, {
          source: {
            ...this.transcriptProvenance(md, videoId),
            file: f.path,
            videoId,
            sourceName: this.transcriptSourceName(md) ?? f.basename,
          },
        });
        instances += rows.length;
        for (const r of rows) {
          const list = merged.get(r.marker) ?? [];
          list.push(r);
          merged.set(r.marker, list);
        }
        notice.setMessage(`談話コンコーダンス作成中… ${transcripts}本 / ${instances}例`);
        await new Promise((r) => setTimeout(r, 0));   // keep the UI thread alive
      }

      // One catalog entry per marker; every occurrence a SUGGESTED attestation.
      for (const [marker, rows] of merged) {
        const entry = { marker, rows, opIds: new Map<string, number>(), count: rows.length,
          ...uptakeProfile(rows) };
        const atts = toAttestations(entry, now) as unknown as Attestation[];
        // The CLASS is asserted — a final particle is 🔴 by definition, it is
        // responsivity-defined (§7 v2). The MOVE is not asserted at all.
        const pattern = await this.patternStore.recordClassified({
          note: marker, cls: "discourse", att: atts[0] ?? null,
        }, now);
        if (atts.length > 1) {
          await this.patternStore.addAttestations(
            atts.slice(1).map((att) => ({ id: pattern.id, att })), now);
        }
      }
    } finally {
      notice.hide();
    }
    const msg = merged.size
      ? `コンコーダンス: transcripts ${transcripts}本 → ${merged.size}マーカー / ${instances}例（語彙タブの🔴で ✓/✕）`
      : `コンコーダンス: 字幕付き transcript が見つかりません（[MM:SS] 行が必要）`;
    new Notice(msg, 8000);
    this.refreshReconLibrary();
    return msg;
  }

  /**
   * Write the typed callouts into the transcript file itself and sync the
   * library. The transcript's annotation layer is rebuilt as a deterministic
   * function of (pristine transcript + this run + every OTHER notes file's
   * persisted entries for this transcript), so re-running one notes file never
   * duplicates its own anchors nor destroys another run's. Returns the
   * combined plan — its anchor ids are what embeds must target.
   */
  private async annotateTranscript(file: TFile, src: ReconSource): Promise<AnchorPlan> {
    const { tFile, results, pristine, lines } = src;
    const priorClass = this.reconLibrary.classMapForFile(tFile.path);

    // Re-anchor other notes files' entries alongside this run (frozen
    // transcript → their persisted line indexes are still valid).
    const currentIds = new Set(results.map((r) => blockIdFor(r)));
    const foreign = this.reconLibrary.forFile(tFile.path)
      .filter((e) => e.sourceNote && e.sourceNote !== file.path && e.anchorId && !currentIds.has(e.blockId))
      .map((e) => entryToResult(e))
      .filter((r): r is ReconciledResult => r !== null);

    const combined = planAnchors([...results.filter((r) => this.anchorable(r)), ...foreign], lines);
    const annotated = applyAnchors(pristine, combined, (id) => priorClass.get(id) ?? DEFAULT_NOTE_CLASS);
    await this.app.vault.modify(tFile, annotated);

    this.reconLibrary.removeForSourceNote(tFile.path, file.path);
    this.reconLibrary.upsertMany(buildAnchoredEntries(results, combined, tFile.path, file.path, priorClass));

    // Catalog layer: every note is a SIGHTING of a pattern — anchored results
    // attach an attestation (video+time+anchor), unanchored ones still create/
    // touch their entry so the pattern accumulates across videos and runs.
    const now = Date.now();
    await this.patternStore.recordMany(results.map((r) => {
      const blockId = blockIdFor(r);
      const anchorId = combined.anchorIdOf.get(blockId);
      const att: Attestation | null = anchorId && r.best ? {
        source: "yt", file: tFile.path, videoId: src.videoId, tStartSec: r.tStartSec,
        blockId, anchorId, quote: r.reconciled, addedAt: now,
      } : null;
      return { note: r.note, att };
    }), now);
    // Clusters may have re-formed around foreign entries — keep their embeds live.
    for (const f of foreign) {
      const id = blockIdFor(f);
      const anchor = combined.anchorIdOf.get(id);
      if (anchor) this.reconLibrary.setAnchorId(id, anchor);
    }
    this.refreshReconLibrary();
    return combined;
  }

  /** Resolve the source media's YouTube id. Prefers the RAW frontmatter of the
   *  transcript/notes we just read (robust to a stale metadataCache right after an
   *  edit); falls back to the cache. Keys: video / videoId / youtube / url. */
  private resolveVideoId(file: TFile, tFile: TFile, transcriptMd?: string, notesMd?: string): string | null {
    const KEYS = ["video", "videoId", "youtube", "url", "source_url"];
    const raw = (transcriptMd && frontmatterAny(transcriptMd, KEYS)) || (notesMd && frontmatterAny(notesMd, KEYS)) || null;
    const fromRaw = parseYouTubeId(raw);
    if (fromRaw) return fromRaw;
    // Fallback: Obsidian's parsed frontmatter cache.
    const fm = this.app.metadataCache.getFileCache(tFile)?.frontmatter ?? {};
    const nfm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const idField = fm.videoId ?? fm.video ?? fm.youtube ?? fm.url ?? fm.source_url
      ?? nfm.videoId ?? nfm.video ?? nfm.youtube ?? nfm.url;
    const fromCache = parseYouTubeId(typeof idField === "string" ? idField : null);
    if (fromCache) return fromCache;
    // Last resort: transcripts copied from browser tools have no frontmatter but
    // every caption stamp is a `[MM:SS](https://youtu.be/<id>?t=N)` link.
    return (transcriptMd && bodyVideoId(transcriptMd)) || (notesMd && bodyVideoId(notesMd)) || null;
  }

  /** Build + write the `-cards.md` file (DESIGN §11). Cards embed the anchored
   *  block INSIDE the transcript (`![[transcript#^recon-…]]` — the real lines
   *  with context), so `plan` must be the combined plan annotateTranscript
   *  returned. `freshClips` are clip basenames just written to disk that
   *  Obsidian may not have indexed yet, so the embed resolves immediately
   *  after a download. Returns null if no cards. */
  private async writeReconCards(
    prep: ReconPrep, plans: Map<string, AnchorPlan>, freshClips?: Set<string>,
  ): Promise<{ outFile: TFile; count: number } | null> {
    // A clip counts as present if we just wrote it OR Obsidian already indexed it.
    const localExists = (name: string) =>
      (freshClips?.has(name) ?? false) || !!this.app.metadataCache.getFirstLinkpathDest(name, "");
    const fmt = this.settings.audioExtraction.audioFormat || "mp3";
    const audioFolder = normalizePath(this.settings.audioExtraction.outputFolder || "JP Audio Clips");
    const voiceSyncFor = (clipName: string) =>
      !!this.app.vault.getAbstractFileByPath(`${audioFolder}/${voiceSyncSidecarName(clipName)}`);
    const all: ReturnType<typeof buildReconCards> = [];
    for (const src of prep.sources) {
      const plan = plans.get(src.tFile.path) ?? src.plan;
      const classMap = this.reconLibrary.classMapForFile(src.tFile.path);
      // Only spans that actually got anchored — a card must never embed a
      // block id that does not exist in the transcript.
      const carded = src.results.filter((r) => plan.anchorIdOf.has(blockIdFor(r)));
      all.push(...buildReconCards(carded, src.tFile.path, blockIdFor, {
        videoId: src.videoId,
        transcriptRef: `[[${src.tFile.basename}]]`,
        audio: deepLinkProvider(localExists, fmt),
        classOf: (id) => classMap.get(id),
        anchorIdOf: (id) => plan.anchorIdOf.get(id),
        voiceSyncFor,
      }));
    }
    if (!all.length) return null;
    const label = prep.sources.map((s) => s.tFile.basename).join(" + ");
    const ref = prep.sources.map((s) => `[[${s.tFile.basename}]]`).join(", ");
    const out = renderCardsFile(all, { transcriptRef: ref, sourceLabel: label });
    const outPath = prep.file.path.replace(/\.md$/, "") + "-cards.md";
    const existing = this.app.vault.getAbstractFileByPath(outPath);
    const outFile = existing instanceof TFile
      ? (await this.app.vault.modify(existing, out), existing)
      : await this.app.vault.create(outPath, out);
    return { outFile, count: all.length };
  }

  /** 📱 One-screen capability report for THIS device — the mobile field-check.
   *  No binary probes (that's the audio diagnostic, desktop-only); everything
   *  here runs on iOS. Answers: which stages of the flow work on this device? */
  private async deviceDiagnostic(): Promise<void> {
    const s = this.settings;
    const yes = (b: unknown): string => (b ? "✅" : "—");
    const kind = Platform.isDesktopApp ? "デスクトップ"
      : Platform.isPhone ? "スマホ" : Platform.isTablet ? "タブレット" : "モバイル";
    const L: string[] = [
      "# 📱 デバイス診断",
      "",
      `- 端末: **${kind}**${Platform.isIosApp ? " (iOS)" : Platform.isAndroidApp ? " (Android)" : ""}`,
      "",
      "## ⚡ フローの各段階",
      `- ① 視聴履歴の取得 (cookie): ${yes(s.ytHistory?.cookie)}${s.ytHistory?.cookie ? "" : " — 設定に youtube.com の Cookie を貼り付け"}`,
      "- ① 文字起こしの取得: ✅（requestUrl — 全端末対応）",
      `- ② 手書きOCR (API キー): ${yes(s.notes.ocrApiKey)}${s.notes.ocrApiKey ? ` — model \`${s.notes.ocrModel}\`` : " — 設定 → 手書きOCR"}`,
      "- ③ 照合・アンカー・カード生成: ✅（全端末対応）",
      "- ④ 語彙・SRS復習・台帳: ✅（全端末対応）",
      "",
      "## 🎧 音声",
      Platform.isDesktopApp && nodeRuntimeAvailable()
        ? "- ローカル mp3 クリップ: ✅（yt-dlp — 詳細は音声ツール診断）"
        : "- ローカル mp3 クリップ: — この端末では **deep-link 音声**（タップで YouTube アプリの該当秒へ）。デスクトップで 🎬 クリップ取得を実行すると、同期後この端末でも mp3 が鳴ります。",
      "",
      "## 📚 データ（同期確認）",
      `- 台帳パターン: ${this.patternStore.size()}件`,
      `- 𝕏 コーパス: ${this.xCorpus.size()}件（オフライン検索は全端末対応）`,
      `- SRS デッキ設定: 新規 ${s.srsNewPerSession ?? 20}枚/回`,
      "",
      // The mobile slowdown is a WRITE-SIZE problem, and write size is the one
      // thing this report could not previously show. Measured 2026-08-06: a
      // single 15.17MB data.json meant ~30MB of IO for every debounced save.
      // These lines are how you check, ON THE DEVICE, that the split landed.
      "## 💾 保存の重さ（モバイルの引っかかりはここ）",
      ...(await this.storageWeightLines()),
    ];
    const path = "_診断.md";
    const body = L.join("\n");
    const ex = this.app.vault.getAbstractFileByPath(path);
    const outFile = ex instanceof TFile
      ? (await this.app.vault.modify(ex, body), ex)
      : await this.app.vault.create(path, body);
    await this.app.workspace.getLeaf(false).openFile(outFile);
  }

  /**
   * What a save actually costs on THIS device, in files and bytes.
   *
   * The typical save is the one that matters: a mark, an SRS answer, a
   * settings toggle. Those write the main file only, so its size IS the cost
   * of studying. A partitioned store is listed separately because it is paid
   * only when that store changes — the corpus no longer rides along on every
   * keystroke.
   */
  private async storageWeightLines(): Promise<string[]> {
    const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/jp-collocations`;
    const kb = async (p: string): Promise<number> => {
      try {
        const st = await this.app.vault.adapter.stat(normalizePath(p));
        return st ? Math.round(st.size / 1024) : 0;
      } catch { return 0; }
    };
    const main = await kb(`${pluginDir}/data.json`);
    const parts = this.dm.partitionedKeys();
    const L = [`- 通常の保存 1回 = **${main} KB** ×2（本体 + .bak）— data.json`];
    if (!parts.length) {
      L.push("- 分割ファイル: なし（全ストアが data.json 内）");
    } else {
      L.push("- 分割済みストア（そのストアを触ったときだけ書く）:");
      for (const key of parts) {
        const size = await kb(this.dm.partPath(key));
        L.push(`    - \`${key}\` — ${size >= 1024 ? `${(size / 1024).toFixed(1)} MB` : `${size} KB`}`);
      }
    }
    const bad = this.dm.quarantinedKeys();
    if (bad.length) L.push(`- ⚠️ 読めない分割ファイル: ${bad.join(", ")} — 書き込みを拒否中`);
    L.push(`- 保存回数（今セッション）: 本体 ${this.dm.writes} / 分割 ${this.dm.partWrites}`);
    return L;
  }

  /** Write an environment + tools report to the vault. Independent of the
   *  reconcile pipeline, so it always produces a pasteable artifact telling us
   *  exactly why the download command bails (runtime, enable, paths, or yt-dlp). */
  private async diagnoseAudioTools(): Promise<void> {
    const cfg = this.settings.audioExtraction;
    const L: string[] = ["# 音声ツール診断 (audio tools diagnostic)", ""];
    L.push(`- Platform.isDesktopApp: **${Platform.isDesktopApp}**`);
    L.push(`- nodeRuntimeAvailable: **${nodeRuntimeAvailable()}** (require strategy: \`${requireStrategy()}\`)`);
    const adapter = this.app.vault.adapter;
    L.push(`- FileSystemAdapter: **${adapter instanceof FileSystemAdapter}**`);
    L.push(`- setting enabled: **${cfg.enabled}**`);
    L.push(`- output folder: \`${cfg.outputFolder}\``);
    L.push(`- configured paths: ytdlp=\`${cfg.ytdlpPath || "(blank)"}\` ffmpeg=\`${cfg.ffmpegPath || "(blank)"}\` js=\`${cfg.jsRuntime || "(blank)"}\``);

    let det: ReturnType<typeof detectTools> | null = null;
    try {
      det = detectTools();
      L.push(`- detectTools: ytdlp=\`${det.ytdlp || "(none)"}\` ffmpeg=\`${det.ffmpeg || "(none)"}\` js=\`${det.jsRuntime || "(deno auto)"}\``);
      L.push(`  - notes: ${det.notes.join(" / ")}`);
    } catch (e) {
      L.push(`- detectTools THREW: \`${String(e)}\``);
    }

    // Actually try to run the tools.
    const ytBin = cfg.ytdlpPath || det?.ytdlp || "yt-dlp";
    const yv = await probeBinary(ytBin, ["--version"]);
    L.push("", `## yt-dlp probe (\`${ytBin} --version\`)`, `- ok: **${yv.ok}** code: ${yv.code}`, `- stdout: \`${yv.stdout}\``, `- stderr/err: \`${yv.stderr || yv.error || ""}\``);

    const ffBin = cfg.ffmpegPath ? (cfg.ffmpegPath.replace(/[\\/]$/, "") + "/ffmpeg") : (det?.ffmpeg ? det.ffmpeg + "/ffmpeg" : "ffmpeg");
    const fv = await probeBinary(ffBin, ["-version"]);
    L.push("", `## ffmpeg probe (\`${ffBin} -version\`)`, `- ok: **${fv.ok}** code: ${fv.code}`, `- stdout: \`${fv.stdout.split("\n")[0] || ""}\``, `- stderr/err: \`${fv.stderr || fv.error || ""}\``);

    const folder = normalizePath(cfg.outputFolder || "JP Audio Clips");
    if (!this.app.vault.getAbstractFileByPath(folder)) { try { await this.app.vault.createFolder(folder); } catch { /* exists */ } }
    const path = `${folder}/_diagnostics.md`;
    const body = L.join("\n");
    const ex = this.app.vault.getAbstractFileByPath(path);
    let outFile: TFile;
    try {
      outFile = ex instanceof TFile ? (await this.app.vault.modify(ex, body), ex) : await this.app.vault.create(path, body);
      await this.app.workspace.getLeaf(false).openFile(outFile);
    } catch (e) {
      new Notice(`診断ファイルの書き込みに失敗: ${String(e)}\n${body.slice(0, 300)}`, 15000);
      return;
    }
    new Notice(`診断レポートを書き出しました: ${path}`, 6000);
  }

  /**
   * DESKTOP-ONLY: download an MP3 clip for each reconciled span via yt-dlp
   * (DESIGN §12 Tier 1), then AUTO-REGENERATE the cards so the clips embed in one
   * step. Opt-in + ToS-gated. Auto-detects yt-dlp/ffmpeg/deno. Never fakes success
   * — an empty/failed clip is reported, with the command for a manual run.
   */
  /**
   * The clip-download CORE: given an already-reconciled prep + anchor plans,
   * download the audio once per video and cut each anchored span. Returns the
   * clip basenames now on disk (fresh or pre-existing). Writes the log ONLY on
   * failure (a clean run leaves nothing in the vault); does NOT write cards or
   * run voicesync — the caller decides when. Assumes desktop guards already
   * passed (used by both the standalone command and the ⚡ background stage).
   */
  private async downloadClipsFor(
    prep: ReconPrep, plans: Map<string, AnchorPlan>,
  ): Promise<{ present: Set<string>; done: number; failed: number; skipped: number; anyTargets: boolean }> {
    const present = new Set<string>();
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return { present, done: 0, failed: 0, skipped: 0, anyTargets: false };
    const cfg = this.settings.audioExtraction;
    const withVideo = prep.sources.filter((s) => s.videoId);
    if (!withVideo.length) return { present, done: 0, failed: 0, skipped: 0, anyTargets: false };

    const det = detectTools();
    const active = {
      ...cfg,
      ytdlpPath: cfg.ytdlpPath || det.ytdlp,
      ffmpegPath: cfg.ffmpegPath || det.ffmpeg,
      jsRuntime: cfg.jsRuntime || det.jsRuntime,
      // YouTube bot-walls anonymous audio downloads; the stored history cookie passes.
      cookieHeader: this.settings.ytHistory?.cookie || undefined,
      cookieJarAbs: this.cookieJarAbs(),
    };

    const folder = normalizePath(cfg.outputFolder || "JP Audio Clips");
    if (!this.app.vault.getAbstractFileByPath(folder)) { try { await this.app.vault.createFolder(folder); } catch { /* exists */ } }
    const base = adapter.getBasePath();

    const log: string[] = [
      `# 音声クリップ取得ログ（失敗時のみ保存）`,
      ``,
      `- videos: ${withVideo.map((s) => `\`${s.videoId}\``).join(", ")} · format: \`${active.audioFormat}\``,
      `- yt-dlp: \`${active.ytdlpPath || "(PATH) yt-dlp"}\` · ffmpeg: \`${active.ffmpegPath || "(PATH)"}\``,
      `- detect: ${det.notes.join(" / ")}`,
      ``,
    ];
    const logPath = `${folder}/_download-log.md`;

    let done = 0, failed = 0, skipped = 0, anyTargets = false;

    for (const src of withVideo) {
      const videoId = src.videoId as string;
      const combined = plans.get(src.tFile.path) as AnchorPlan;
      const planItem = new Map(combined.items.map((it) => [it.id, it]));

      const timed = src.results.filter((r) => planItem.has(blockIdFor(r)) && r.tStartSec != null);
      if (!timed.length) continue;
      anyTargets = true;

      // Which spans still need a clip (skip ones already on disk).
      const todo = timed.filter((r) => {
        const name = clipNameFor({ videoId, startSec: r.tStartSec as number }, active);
        if (this.app.metadataCache.getFirstLinkpathDest(name, "")) { present.add(name); return false; }
        return true;
      });
      skipped += timed.length - todo.length;
      if (!todo.length) continue;

      log.push(`## ${src.tFile.basename} (\`${videoId}\`) — targets: ${timed.length}`, ``);

      // STEP 1 — download the audio ONCE per video (one nsig solve, one
      // connection). Cutting per-section from the network is what hangs on
      // long videos; this avoids it.
      const dl = new Notice(`音声をダウンロード中…（${videoId}）`, 0);
      const full = await downloadFullAudio(active, videoId, `${base}/${folder}`);
      dl.hide();
      if (!full.ok) {
        failed += todo.length;
        log.push(`- ❌ 音声ダウンロード失敗: ${full.error ?? ""}`, `  - cmd: \`${full.command}\``, ...(full.stderrTail ? ["  - stderr:", "  ~~~", ...full.stderrTail.split("\n").map((l) => "  " + l), "  ~~~"] : []));
        continue;                                    // other videos may still succeed
      }
      const srcVaultPath = `${folder}/${full.srcPath.split(/[\\/]/).pop()}`;

      // STEP 2 — cut every clip LOCALLY with ffmpeg (no network → cannot hang).
      const progress = new Notice(`クリップを切り出し中… 0/${todo.length}（${src.tFile.basename}）`, 0);
      for (let i = 0; i < todo.length; i++) {
        const r = todo[i];
        // The clip range = the anchored context window (what you hear is what
        // the embed shows). Falls back to the legacy fixed window if unplanned.
        const it = planItem.get(blockIdFor(r));
        const [s, e] = it && it.clipStartSec != null && it.clipEndSec != null
          ? [it.clipStartSec, Math.max(it.clipStartSec + 1, it.clipEndSec)]
          : clipWindow({ videoId, startSec: r.tStartSec as number }, active);
        const name = clipNameFor({ videoId, startSec: r.tStartSec as number }, active);
        try {
          const res = await clipFromLocal(active, full.srcPath, s, e, `${base}/${folder}/${name}`);
          if (res.ok) {
            present.add(name); done++;
          } else {
            failed++;
            log.push(`- ❌ ${name}: ${res.error ?? ""}`, `  - cmd: \`${res.command}\``, ...(res.stderrTail ? ["  - stderr:", "  ~~~", ...res.stderrTail.split("\n").map((l) => "  " + l), "  ~~~"] : []));
            console.error("[jp-collocations] clip failed:", res.command, "\n", res.error, "\n", res.stderrTail);
          }
        } catch (err) {
          failed++;
          log.push(`- ❌ ${name}: 例外 ${String(err)}`);
        }
        progress.setMessage(`クリップを切り出し中… ${i + 1}/${todo.length}（✓${done} 失敗${failed}）`);
      }
      progress.hide();

      // Remove the large temp source audio (clips are self-contained).
      try { await adapter.remove(srcVaultPath); } catch { /* leave it */ }
    }

    // Keep the vault tidy: only persist the log when something failed;
    // otherwise remove any stale log a previous failed run left behind.
    const existingLog = this.app.vault.getAbstractFileByPath(logPath);
    if (failed > 0) {
      try {
        const body = log.join("\n");
        if (existingLog instanceof TFile) await this.app.vault.modify(existingLog, body);
        else await this.app.vault.create(logPath, body);
      } catch (e) { console.error("[jp-collocations] log write failed:", e); }
    } else if (existingLog instanceof TFile) {
      try { await this.app.vault.delete(existingLog); } catch { /* leave it */ }
    }

    return { present, done, failed, skipped, anyTargets };
  }

  /** Standalone command: reconcile, download clips, then regenerate cards with
   *  the fresh local clips embedded. (⚡ uses the cards-first path instead.) */
  private async downloadReconClips(): Promise<void> {
    if (!Platform.isDesktopApp) { new Notice("音声クリップの取得はデスクトップ版のみ対応です。"); return; }
    if (!this.settings.audioExtraction.enabled) { new Notice("設定 →「音声クリップ (yt-dlp)」を有効にしてください（yt-dlp/ffmpeg 必須・YouTube ToS 注意）。"); return; }
    if (!(this.app.vault.adapter instanceof FileSystemAdapter)) { new Notice("ローカルファイルシステムが利用できません。"); return; }
    if (!nodeRuntimeAvailable()) { new Notice("Node ランタイムに接続できません（このデスクトップ版では child_process を利用できません）。"); return; }

    const prep = await this.prepareReconcile();
    if (!prep) return;
    if (!prep.sources.some((s) => s.videoId)) { new Notice("YouTube 動画 ID が必要です。文字起こしの frontmatter に `video: <URL>` を追加してください。"); return; }

    // Anchor every source transcript first (idempotent) — clips + cards share
    // the plans, so each audio range covers exactly the context window its embed shows.
    const plans = new Map<string, AnchorPlan>();
    for (const src of prep.sources) plans.set(src.tFile.path, await this.annotateTranscript(prep.file, src));

    const res = await this.downloadClipsFor(prep, plans);
    if (!res.anyTargets) { new Notice("ダウンロード対象（auto かつ時刻付き）の照合スパンがありません。"); return; }

    if (this.settings.voiceSync.enabled) {
      try { await this.enrichClipsVoiceSync(); } catch (e) { console.error("[jp-collocations] voicesync:", e); }
    }

    let written: { outFile: TFile; count: number } | null = null;
    try {
      written = await this.writeReconCards(prep, plans, res.present);
      if (written) await this.app.workspace.getLeaf(false).openFile(written.outFile);
    } catch (e) {
      console.error("[jp-collocations] card regen failed:", e);
    }

    new Notice(
      `クリップ取得: ✓${res.done} / スキップ${res.skipped} / 失敗${res.failed}` +
      (written ? `\nカード更新: ${written.count}件` : "") +
      (res.failed ? `\nログ: ${normalizePath((this.settings.audioExtraction.outputFolder || "JP Audio Clips") + "/_download-log.md")}` : ""),
      res.failed ? 15000 : 8000,
    );
  }

  // ── Transcript + history ingestion (DESIGN §4/§8 Step 2) ────────────────────

  /** An Obsidian-requestUrl-backed HTTP client for the transcript adapter
   *  (mobile-safe, bypasses CORS — same transport as XClient). */
  private makeHttpClient(): HttpClient {
    const call = async (url: string, method: "GET" | "POST", headers?: Record<string, string>, body?: string) => {
      const r = await requestUrl({ url, method, headers, body, throw: false });
      return { status: r.status, text: r.text ?? "" };
    };
    return {
      get: (url, headers) => call(url, "GET", headers),
      post: (url, body, headers) => call(url, "POST", headers, body),
    };
  }

  // ── §22 🎙 whisper full-episode transcription (desktop) ────
  // Same VERIFIED recipe as the clip re-transcription (voice-lab, -oj natural
  // segments, never -ml 1): mp3 → 16k mono wav → whisper-cli → stamped lines.
  // The result is honestly ⚙-generated: `generated: whisper` in frontmatter.
  private async transcribePodcastNote(): Promise<void> {
    const f = this.app.workspace.getActiveFile();
    if (!f) { new Notice("Podcast ノートを開いてください"); return; }
    const md = await this.app.vault.cachedRead(f);
    if (!/^source:\s*podcast\s*$/m.test(md)) { new Notice("source: podcast のノートではありません"); return; }
    const audio = md.match(/^audio:\s*"?([^"\n]+?)"?\s*$/m)?.[1];
    if (!audio) { new Notice("frontmatter に audio: がありません"); return; }
    if (!Platform.isDesktopApp || !nodeRuntimeAvailable() || !(this.app.vault.adapter instanceof FileSystemAdapter)) {
      new Notice("書き起こしはデスクトップ専用です（📱では取り込み済みノートを読むだけ）"); return;
    }
    const tools = detectSpeechTools(this.settings.voiceSync.toolsDir);
    if (!tools.whisperCli || !tools.whisperModel) { new Notice("whisper が見つかりません（🩺 デバイス診断で確認）"); return; }
    const det = detectTools();
    const ffmpegBin = det.ffmpeg ? `${det.ffmpeg}/ffmpeg.exe` : "ffmpeg";

    const base = this.app.vault.adapter.getBasePath();
    const absAudio = `${base}/${audio}`;
    const os = nodeReq<{ tmpdir(): string }>("os");
    const path = nodeReq<{ join(...p: string[]): string }>("path");
    const fsm = nodeReq<{ readFileSync(p: string, e: string): string; rmSync(p: string, o?: { force?: boolean }): void }>("fs");
    const cp = nodeReq<{ execFile(bin: string, args: string[], opts: { maxBuffer: number; timeout: number }, cb: (err: Error | null, stdout?: string, stderr?: string) => void): void }>("child_process");
    const run = (bin: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> =>
      new Promise((res, rej) => cp.execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs },
        (err, stdout, stderr) => (err ? rej(err) : res({ stdout: stdout ?? "", stderr: stderr ?? "" }))));

    const stamp = Date.now();
    const wav = path.join(os.tmpdir(), `jpc-pod-${stamp}.wav`);
    const prefix = path.join(os.tmpdir(), `jpc-pod-${stamp}`);
    const busy = new Notice("⚙ 書き起こし中…（エピソード長により数分〜十数分）", 0);
    try {
      await run(ffmpegBin, ["-y", "-loglevel", "error", "-i", absAudio, "-ar", "16000", "-ac", "1", wav], 10 * 60_000);
      await run(tools.whisperCli, ["-m", tools.whisperModel, "-l", "ja", "-oj", "-of", prefix, wav], 45 * 60_000);
      const segs = parseWhisperSegments(fsm.readFileSync(`${prefix}.json`, "utf8"));
      if (segs.length < 3) { new Notice("書き起こし結果が空に近いです — 音声を確認してください"); return; }

      // §23.4-3 sherpa tier: local audio means WHO-speaks-WHEN is a diarization
      // answer — letter the segments by voice, and 談話モード reads the letters
      // back as layer-1 truth. Without the sherpa tools the transcript simply
      // stays unlettered (never guess voices from text).
      let lines = segs.map((s) => `${fmtStamp(s.t0)} ${s.text}`);
      let genTag = "whisper";
      let voices = 0;
      if (tools.diarBin && tools.segModel && tools.embModel) {
        busy.setMessage("⚙ 話者分離中…（sherpa-onnx）");
        try {
          const d = await run(tools.diarBin, [
            `--segmentation.pyannote-model=${tools.segModel}`,
            `--embedding.model=${tools.embModel}`,
            `--clustering.cluster-threshold=${this.settings.voiceSync.clusterThreshold}`,
            wav,
          ], 45 * 60_000);
          const turns = parseDiarTurns(d.stdout + "\n" + d.stderr);
          if (turns.length) {
            lines = speakerStampLines(segs, turns);
            genTag = "whisper+sherpa";
            voices = new Set(turns.map((t) => t.spk)).size;
          }
        } catch (e) {
          console.error("[jp-collocations] diarization skipped:", e);
        }
      }
      const body = md
        .replace(/^generated: pending$/m, `generated: ${genTag}`)
        .replace(/\n> \[!info\] ⚙ 書き起こし待ち[\s\S]*?\n\n/,
          `\n## 書き起こし（⚙ ${genTag === "whisper+sherpa" ? "whisper＋話者分離 — 機械聴取" : "whisper — 機械聴取"}）\n\n${lines.join("\n")}\n\n`);
      await this.app.vault.modify(f, body);
      new Notice(`⚙ ${segs.length}セグメントを書き起こしました` +
        (voices ? `（話者${voices}人を検出 — 談話モードがそのまま読みます）` : " — 照合・走査・⚡がそのまま使えます"));
    } catch (e) {
      new Notice(`書き起こし失敗: ${String(e).slice(0, 200)}`, 8000);
    } finally {
      busy.hide();
      try { fsm.rmSync(wav, { force: true }); fsm.rmSync(`${prefix}.json`, { force: true }); } catch { /* tmp */ }
    }
  }

  // ── §21 💡 discovery: exposure the catalog never captured ──

  private async runDiscovery(): Promise<void> {
    const notice = new Notice("💡 発見を集計中…", 0);
    try {
      const sources: DiscoverySource[] = [];
      for (const f of this.app.vault.getMarkdownFiles().filter((x) => !x.path.endsWith("-cards.md"))) {
        const md = await this.app.vault.cachedRead(f);
        if (!CAPTION_STAMP_RE.test(md)) continue;
        const lines = parseTranscriptLines(md);
        if (lines.length < 5 || lines[0].tStartSec == null) continue;
        sources.push({ file: f.path, lines });
      }
      // the X corpus is exposure too — one source, tweet per line
      const tweets = this.xCorpus.getAll();
      if (tweets.length) {
        sources.push({ file: "x:corpus", lines: tweets.map((t, index) => ({ index, text: t.text })) });
      }
      const items = discoverCollocations({
        sources,
        knownKeys: this.patternStore.all().map((p) => p.key),
        dismissed: (this.dm.get("_discoveryDismissed") as string[] | undefined) ?? [],
      });
      new DiscoveryModal(this.app, {
        items,
        onCapture: (d) => this.captureDiscovery(d),
        onDismiss: async (d) => {
          const cur = (this.dm.get("_discoveryDismissed") as string[] | undefined) ?? [];
          await this.dm.setKey("_discoveryDismissed", [...new Set([...cur, d.surface])]);
        },
      }).open();
    } finally {
      notice.hide();
    }
  }

  private captureDiscovery(d: Discovery): void {
    const fromX = d.example.file === "x:corpus";
    new CaptureModal(this.app, {
      text: d.surface,
      example: d.example.line,
      source: fromX
        ? { kind: "x" }
        : { kind: "yt", file: d.example.file, tStartSec: d.example.tStartSec },
    }, this.makeCaptureDeps()).open();
  }

  // ── §20.3 the 用例 finder cascade ──────────────────────────

  /**
   * Tier A: run every finder for ONE entry, now. The explicit button
   * deliberately bypasses sweepMuted (an explicit ask outranks the mute) but
   * keeps every other rule: candidates land as status:'suggested' through
   * addAttestations, so rejected sightings never come back and nothing
   * touches the confirmed tree without a ✓.
   */
  async findExamplesFor(p: PatternEntry): Promise<{ swept: number; x: number }> {
    let swept = 0;
    if (sweepableClass(p.class)) {
      const now = Date.now();
      const batch: { id: string; att: Attestation }[] = [];
      const files = this.app.vault.getMarkdownFiles().filter((f) => !f.path.endsWith("-cards.md"));
      for (const f of files) {
        const md = await this.app.vault.cachedRead(f);
        if (!CAPTION_STAMP_RE.test(md)) continue;
        const lines = parseTranscriptLines(md);
        if (lines.length < 5 || lines[0].tStartSec == null) continue;
        if (p.attestations.some((a) => a.file === f.path)) continue;
        const videoId = this.resolveVideoId(f, f, md);
        for (const c of sweepEntry(p, lines)) {
          batch.push({ id: p.id, att: {
            source: "yt", file: f.path, videoId, tStartSec: c.tStartSec, quote: c.quote,
            addedAt: now, status: "suggested", matchKind: c.matchKind, confidence: c.confidence,
          } });
        }
      }
      swept = batch.length ? await this.patternStore.addAttestations(batch, now) : 0;
    }
    const x = await this.xJoinPattern(p).catch(() => 0);
    return { swept, x };
  }

  /**
   * Tier C: 生成 scaffold — pinned model, schema-validated, and every line
   * re-validated by the sweep's own matcher before it may be stored. Marked
   * 生成 in every rendering; auto-retired by the store on the first real
   * attestation. Returns how many lines survived validation.
   */
  async generateScaffoldFor(p: PatternEntry): Promise<number> {
    const apiKey = this.settings.notes.ocrApiKey;
    if (!apiKey) return 0;
    const http: ClaudeHttp = {
      post: async (url, body, headers) => {
        const r = await requestUrl({ url, method: "POST", body, headers, throw: false });
        return { status: r.status, text: r.text };
      },
    };
    const resp = await http.post(CLAUDE_API_URL, buildScaffoldBody(p), {
      "x-api-key": apiKey,
      "anthropic-version": CLAUDE_API_VERSION,
      "content-type": "application/json",
    });
    const parsed = parseScaffoldResponse(p, resp.status, resp.text);
    if (!parsed.ok) throw new Error(parsed.error);
    await this.patternStore.setScaffold(p.id, parsed.examples);
    return parsed.examples.length;
  }

  // ── Vault-native mirror (DESIGN §19): catalog + gold as plain files ──

  /** Folder for the mirror files. Fixed name — it appears in the restore
   *  command text and the mirror's own header. */
  static readonly MIRROR_FOLDER = "JP Lexicon";

  private mirrorTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleMirror(): void {
    if (this.mirrorTimer) clearTimeout(this.mirrorTimer);
    this.mirrorTimer = setTimeout(() => { void this.writeMirror(); }, 5000);
  }

  private async writeMirror(): Promise<void> {
    try {
      const folder = JPCollocationsPlugin.MIRROR_FOLDER;
      if (!this.app.vault.getAbstractFileByPath(folder)) {
        await this.app.vault.createFolder(folder).catch(() => {});
      }
      const writeIfChanged = async (path: string, text: string): Promise<void> => {
        const f = this.app.vault.getAbstractFileByPath(path);
        if (f instanceof TFile) {
          if (await this.app.vault.cachedRead(f) === text) return;
          await this.app.vault.modify(f, text);
        } else {
          await this.app.vault.create(path, text);
        }
      };
      const entries = this.patternStore.all();
      await writeIfChanged(`${folder}/catalog.jsonl`, renderCatalogJsonl(entries));
      await writeIfChanged(`${folder}/catalog.md`, renderCatalogMd(entries));
      await writeIfChanged(`${folder}/discourse-gold.jsonl`, toJsonl(this.goldStore.all()));
    } catch (e) {
      console.error("[jp-collocations] mirror write failed", e);
    }
  }

  /** OS temp dir for yt-dlp subtitle scratch files (desktop only; null otherwise). */
  private desktopTmpDir(): string | null {
    if (!Platform.isDesktopApp || !nodeRuntimeAvailable()) return null;
    try { return nodeReq<{ tmpdir(): string }>("os").tmpdir(); } catch { return null; }
  }

  /** Build the transcript adapter from settings: HTTP tier always; yt-dlp tier on
   *  desktop when enabled (reuses the audio tool paths, auto-detected if blank). */
  /** Stable absolute path for the persistent yt-dlp cookie jar (desktop only).
   *  Device-local, OUTSIDE the vault — session cookies must never ride along
   *  with vault sync (AUDIT §2). */
  private cookieJarAbs(): string | undefined {
    if (!Platform.isDesktopApp || !nodeRuntimeAvailable()) return undefined;
    try {
      const os = nodeReq<{ homedir(): string }>("os");
      const path = nodeReq<{ join(...p: string[]): string }>("path");
      const fs = nodeReq<{ mkdirSync(p: string, o?: { recursive: boolean }): void }>("fs");
      const dir = path.join(os.homedir(), ".jp-collocations");
      fs.mkdirSync(dir, { recursive: true });
      return path.join(dir, "yt_cookies.txt");
    } catch {
      return undefined;
    }
  }

  private makeTranscriptAdapter(): YouTubeTranscriptAdapter {
    const n = this.settings.notes;
    const cfg: TranscriptFetchConfig = {
      langPref: (n.langPref || "ja").split(",").map((s) => s.trim()).filter(Boolean),
      preferManual: n.preferManual,
    };
    let ytdlp: YtdlpTranscriptConfig | null = null;
    const tmp = this.desktopTmpDir();
    if (n.useYtdlpTranscripts && tmp) {
      const det = detectTools();
      ytdlp = {
        enabled: true,
        ytdlpPath: this.settings.audioExtraction.ytdlpPath || det.ytdlp,
        jsRuntime: this.settings.audioExtraction.jsRuntime || det.jsRuntime,
        tmpDirAbs: tmp,
        // Pass the history cookie when present — YouTube bot-walls anonymous
        // fetches intermittently and the logged-in cookie sails through.
        cookieHeader: this.settings.ytHistory?.cookie || undefined,
        cookieJarAbs: this.cookieJarAbs(),
      };
    }
    return new YouTubeTranscriptAdapter(this.makeHttpClient(), cfg, ytdlp);
  }

  /** Resolve a video id to fetch: editor selection → active-file frontmatter →
   *  clipboard. Returns null with a Notice already shown if nothing resolves. */
  private async resolveVideoIdToFetch(): Promise<string | null> {
    const sel = this.app.workspace.activeEditor?.editor?.getSelection()?.trim();
    const fromSel = parseYouTubeId(sel);
    if (fromSel) return fromSel;

    const file = this.app.workspace.getActiveFile();
    if (file) {
      const content = await this.app.vault.cachedRead(file);
      const raw = frontmatterAny(content, ["video", "videoId", "youtube", "url", "source_url"]);
      const fromFm = parseYouTubeId(raw);
      if (fromFm) return fromFm;
    }
    try {
      const clip = await navigator.clipboard.readText();
      const fromClip = parseYouTubeId(clip?.trim());
      if (fromClip) return fromClip;
    } catch { /* clipboard blocked */ }

    new Notice("YouTube の URL/ID を選択するか、メモの frontmatter に `video:` を入れるか、クリップボードにコピーしてください。", 8000);
    return null;
  }

  /** Write a fetched transcript as a frozen note; returns the file (never re-fetches
   *  an existing one — invariant #4). `overwrite` forces a rewrite. */
  private async writeTranscriptFile(t: Transcript, overwrite = false): Promise<TFile> {
    const folder = normalizePath(this.settings.notes.transcriptFolder || "Transcripts");
    if (!this.app.vault.getAbstractFileByPath(folder)) { try { await this.app.vault.createFolder(folder); } catch { /* exists */ } }
    const path = normalizePath(`${folder}/${transcriptFileBaseName(t)}.md`);
    const body = renderTranscriptFile(t);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      if (overwrite) await this.app.vault.modify(existing, body);
      return existing;
    }
    return await this.app.vault.create(path, body);
  }

  /** Stamp `sources:` into a notes file's frontmatter if it has none, so the
   *  reconcile command finds the transcript. Non-destructive otherwise.
   *
   *  Writes the PLURAL list form — the shape every other writer uses and the one
   *  `frontmatterSources` accepts unconditionally. This used to write the
   *  singular `source: [[basename]]`, which is the shape that forced
   *  `frontmatterSources` to match `sources?` and so let the ⚡ gate mistake
   *  every `source: tv` transcript for a capture note. Notes already carrying
   *  the legacy singular still resolve (see pipeline.ts); nothing new adds to
   *  the pile. */
  private async ensureSourceFrontmatter(file: TFile, basename: string): Promise<boolean> {
    const content = await this.app.vault.read(file);
    if (frontmatterSources(content).length) return false;         // already linked — leave it
    const entry = `sources:\n  - "[[${basename}]]"`;
    let next: string;
    const fm = content.match(/^(﻿?---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/);
    if (fm) {
      next = fm[1] + fm[2] + `\n${entry}` + fm[3] + content.slice(fm[0].length);
    } else {
      next = `---\n${entry}\n---\n\n` + content;
    }
    await this.app.vault.modify(file, next);
    return true;
  }

  /** Flow-view seam: fetch ONE transcript from a pasted URL/id. Freezes on an
   *  existing note for the same video; auto-sweeps the fresh transcript. */
  private async fetchTranscriptByUrl(url: string): Promise<TFile | null> {
    const videoId = parseYouTubeId(url.trim());
    if (!videoId) { new Notice("YouTube の URL/ID を認識できませんでした"); return null; }
    const folder = normalizePath(this.settings.notes.transcriptFolder || "Transcripts");
    const existing = this.app.vault.getMarkdownFiles().find(
      (f) => f.path.startsWith(folder + "/") && (f.path.includes(`(${videoId})`) || f.basename === videoId),
    );
    if (existing) return existing;
    const notice = new Notice(`文字起こしを取得中… (${videoId})`, 0);
    try {
      const t = await this.makeTranscriptAdapter().fetch(videoId);
      if (!t) { new Notice(`この動画には字幕がありません (${videoId})`, 8000); return null; }
      const outFile = await this.writeTranscriptFile(t, false);
      if (this.patternStore.size()) {
        try {
          const r = await this.sweepOneTranscript(outFile);
          if (r.confirmed || r.suggested) this.refreshReconLibrary();
        } catch (e) { console.error("[jp-collocations] auto-sweep:", e); }
      }
      new Notice(`文字起こし取得: ${t.lines.length}行 → ${outFile.basename}`, 6000);
      return outFile;
    } catch (e) {
      const msg = e instanceof TranscriptError ? e.message : String(e);
      new Notice(`取得失敗: ${msg}`, 10000);
      return null;
    } finally { notice.hide(); }
  }

  /** Flow-view seam: ⚡ on a specific capture note (the pipeline reads the active file). */
  private async runPipelineOnFile(f: TFile): Promise<void> {
    await this.app.workspace.getLeaf(false).openFile(f);
    await this.runFullPipeline();
  }

  async openPipelineView(): Promise<void> {
    const leaf = this.surfaceLeaf(JP_PIPELINE_VIEW_TYPE);
    if (!leaf) return;
    if (leaf.view?.getViewType() !== JP_PIPELINE_VIEW_TYPE) {
      await leaf.setViewState({ type: JP_PIPELINE_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Open 談話モード; if the active file is a transcript, load it directly. */
  async openDiscourseMode(file?: TFile): Promise<void> {
    // capture BEFORE opening the view (which steals active-file focus)
    const folder = normalizePath(this.settings.notes.transcriptFolder || "Transcripts");
    const active = this.app.workspace.getActiveFile();
    const target = file ?? (active && active.path.startsWith(folder + "/") ? active : null);
    const existing = this.app.workspace.getLeavesOfType(JP_DISCOURSE_MODE_VIEW_TYPE);
    const leaf = existing[0] ?? this.app.workspace.getLeaf(true);
    if (!existing.length) await leaf.setViewState({ type: JP_DISCOURSE_MODE_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
    if (target && leaf.view instanceof DiscourseModeView) await leaf.view.setFile(target);
  }

  private async fetchTranscriptCommand(): Promise<void> {
    const videoId = await this.resolveVideoIdToFetch();
    if (!videoId) return;
    await this.fetchTranscriptFor(videoId);
  }

  /**
   * Fetch + freeze one video's transcript and open it. Split out of the command
   * so a DROPPED YouTube link takes the identical road (§28 S5) — the command
   * only owns the "which video did you mean" question, which a drop answers by
   * construction.
   */
  async fetchTranscriptFor(videoId: string): Promise<TFile | null> {
    const notesFile = this.app.workspace.getActiveFile();

    const adapter = this.makeTranscriptAdapter();
    const notice = new Notice(`文字起こしを取得中… (${videoId})`, 0);
    let t: Transcript | null;
    try {
      t = await adapter.fetch(videoId);
    } catch (e) {
      notice.hide();
      const msg = e instanceof TranscriptError ? e.message : String(e);
      new Notice(`文字起こしの取得に失敗しました。\n${msg}\n\n手動の場合: 字幕テキストを ${this.settings.notes.transcriptFolder} に貼り付け、frontmatter に \`video: ${videoId}\` を追加してください。`, 20000);
      return null;
    }
    notice.hide();
    if (!t) { new Notice(`この動画には字幕がありません (${videoId})。スキップしました。`, 10000); return null; }

    const outFile = await this.writeTranscriptFile(t, true);
    let linked = false;
    if (notesFile && notesFile.path !== outFile.path && notesFile.extension === "md") {
      try { linked = await this.ensureSourceFrontmatter(notesFile, outFile.basename); } catch { /* */ }
    }
    new Notice(
      `文字起こし取得: ${t.lines.length}行（${t.source} / ${t.lang}）→ ${outFile.basename}` +
      (linked ? `\nメモに source: [[${outFile.basename}]] を設定しました。` : `\nメモの frontmatter に \`source: [[${outFile.basename}]]\` を追加して照合してください。`),
      12000,
    );
    await this.app.workspace.getLeaf(false).openFile(outFile);
    return outFile;
  }

  private async fetchHistoryTranscriptsCommand(): Promise<void> {
    // Source text: the active file if it parses as history, else the clipboard.
    let text = "";
    const active = this.app.workspace.getActiveFile();
    if (active) {
      const c = await this.app.vault.cachedRead(active);
      if (parseHistory(c).videos.length) text = c;
    }
    if (!text) { try { text = (await navigator.clipboard.readText()) ?? ""; } catch { /* */ } }
    const { videos, source } = parseHistory(text);
    if (!videos.length) {
      new Notice("視聴履歴が見つかりません。Google Takeout の watch-history.json/html を開くか、YouTube の URL 一覧をクリップボードにコピーしてください。", 12000);
      return;
    }
    const cap = Math.max(1, this.settings.notes.maxHistoryVideos || 20);
    await this.fetchTranscriptsForVideos(videos.slice(0, cap), { source, detected: videos.length, openLog: true });
  }

  /**
   * Fetch + freeze a transcript for each video (skipping ones already on disk and
   * ones without captions), writing a run log. Shared by the history-note command
   * and the live date-range command. Returns the tallies.
   */
  private async fetchTranscriptsForVideos(
    list: WatchedVideo[],
    opts: { source: string; detected: number; openLog?: boolean },
  ): Promise<{ fetched: number; noCaps: number; failed: number; existed: number; logPath: string }> {
    const overflow = opts.detected - list.length;
    const adapter = this.makeTranscriptAdapter();
    const folder = normalizePath(this.settings.notes.transcriptFolder || "Transcripts");
    const log: string[] = [
      `# 視聴履歴→文字起こし 取得ログ`,
      ``,
      `- source: \`${opts.source}\` · 検出 ${opts.detected}件 · 取得対象 ${list.length}件${overflow > 0 ? ` (上限で ${overflow}件スキップ — 設定 maxHistoryVideos)` : ""}`,
      ``,
    ];
    let fetched = 0, noCaps = 0, failed = 0, existed = 0;
    const newFiles: TFile[] = [];
    const progress = new Notice(`文字起こしを取得中… 0/${list.length}`, 0);
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const THROTTLE_MS = 3500;     // spacing between network fetches (avoid YouTube 429)
    const MAX_RETRIES = 3;        // on 429, back off and retry this many times
    let didNetFetch = false;

    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      progress.setMessage(`文字起こしを取得中… ${i + 1}/${list.length}（✓${fetched} 字幕なし${noCaps} 失敗${failed}）`);
      // Freeze: if a transcript note already exists for this id, don't re-fetch.
      const existingBase = this.app.vault.getMarkdownFiles().find(
        (f) => f.path.startsWith(folder + "/") && (f.path.includes(`(${v.id})`) || f.basename === v.id),
      );
      if (existingBase) { existed++; log.push(`- ⏭ ${v.id} 既存: [[${existingBase.basename}]]`); continue; }

      // Space out real network fetches; YouTube 429s a rapid burst of timedtext pulls.
      if (didNetFetch) await sleep(THROTTLE_MS);
      didNetFetch = true;

      let attempt = 0, settled = false;
      while (!settled) {
        try {
          const t = await adapter.fetch(v.id);
          if (!t) { noCaps++; log.push(`- ⚪ ${v.id} 字幕なし — スキップ (${v.title})`); settled = true; break; }
          if (!t.title || t.title === v.id) t.title = v.title || t.title;
          const outFile = await this.writeTranscriptFile(t, false);
          fetched++;
          newFiles.push(outFile);
          log.push(`- ✅ ${v.id} → [[${outFile.basename}]] (${t.lines.length}行 / ${t.source})`);
          settled = true;
        } catch (e) {
          const msg = e instanceof TranscriptError ? e.message : String(e);
          const is429 = /\b429\b|Too Many Requests/i.test(msg);
          if (is429 && attempt < MAX_RETRIES) {
            attempt++;
            const backoff = 20000 * attempt;   // 20s, 40s, 60s
            progress.setMessage(`レート制限(429) — ${backoff / 1000}秒待って再試行 ${attempt}/${MAX_RETRIES}（${v.id}）`);
            await sleep(backoff);
            continue;                            // retry same video
          }
          failed++;
          log.push(`- ❌ ${v.id} 失敗: ${msg}`);
          settled = true;
        }
      }
    }
    progress.hide();

    // AUTO-SWEEP the just-fetched transcripts: every pattern already in the
    // catalog gets its sighting here without a manual sweep — passive growth.
    // Confirmed only when near-verbatim; structural finds land as 候補 (✓/✕).
    let sweepLine = "";
    if (newFiles.length && this.patternStore.size()) {
      let conf = 0, sug = 0;
      for (const f of newFiles) {
        try {
          const r = await this.sweepOneTranscript(f);
          conf += r.confirmed;
          sug += r.suggested;
        } catch (e) { console.error("[jp-collocations] auto-sweep:", e); }
      }
      if (conf || sug) {
        sweepLine = `\n台帳自動走査: 確定 +${conf} / 候補 +${sug}`;
        log.push(``, `- 🔎 台帳自動走査: 確定 +${conf} / 候補 +${sug}`);
        this.refreshReconLibrary();
      }
    }

    if (!this.app.vault.getAbstractFileByPath(folder)) { try { await this.app.vault.createFolder(folder); } catch { /* */ } }
    const logPath = normalizePath(`${folder}/_history-fetch-log.md`);
    try {
      const ex = this.app.vault.getAbstractFileByPath(logPath);
      const outLog = log.join("\n");
      const logFile = ex instanceof TFile ? (await this.app.vault.modify(ex, outLog), ex) : await this.app.vault.create(logPath, outLog);
      if (opts.openLog) await this.app.workspace.getLeaf(false).openFile(logFile);
    } catch (e) { console.error("[jp-collocations] history log write failed:", e); }

    new Notice(`文字起こし: ✓${fetched} / 既存${existed} / 字幕なし${noCaps} / 失敗${failed}${sweepLine}\nログ: ${logPath}`, 15000);
    return { fetched, noCaps, failed, existed, logPath };
  }

  /** Live watch-history client (cookie auth over the Obsidian requestUrl transport). */
  private makeHistoryClient(): YtHistoryClient {
    return new YtHistoryClient(this.makeHttpClient(), () => this.settings.ytHistory);
  }

  private async fetchLiveHistoryCommand(): Promise<void> {
    const client = this.makeHistoryClient();
    const issue = client.configIssue();
    if (issue) {
      new Notice(`${issue}\n設定 →「視聴履歴（Cookie）」に youtube.com の Cookie を貼り付けてください。`, 14000);
      return;
    }
    new HistoryRangeModal(this.app, { maxVideos: this.settings.notes.maxHistoryVideos || 50 }, async (range) => {
      const progress = new Notice("視聴履歴を取得中… 0件", 0);
      let res;
      try {
        res = await client.listWatched(range, {
          maxVideos: range.maxVideos,
          onProgress: (found, pages) => progress.setMessage(`視聴履歴を取得中… ${found}件（${pages}ページ）`),
        });
      } catch (e) {
        progress.hide();
        const msg = e instanceof YtHistoryError ? e.message : String(e);
        new Notice(`視聴履歴の取得に失敗しました。\n${msg}\n\n代替: Google Takeout の watch-history.json を「履歴→文字起こし」で読み込めます。`, 20000);
        return;
      }
      progress.hide();
      // The range can be "right" while YouTube's own feed has nothing there —
      // history recording paused, or watching signed-out/another profile.
      const fmtDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      const staleHint = res.feedNewestMs && res.feedNewestMs < range.until - 86_400_000
        ? `\n⚠ YouTube の履歴フィード自体の最新が ${fmtDay(res.feedNewestMs)} です — それ以降の視聴が記録されていません。\n` +
          `youtube.com/feed/history に最近の動画が並ぶか、再生履歴が一時停止されていないか（myactivity.google.com）を確認してください。`
        : "";
      if (!res.videos.length) {
        new Notice(`この期間に視聴した動画が見つかりませんでした（${res.pages}ページ確認）。${staleHint}`, staleHint ? 25000 : 12000);
        return;
      }
      if (staleHint) new Notice(staleHint.trim(), 25000);
      const noteFile = await this.writeHistoryNote(res.videos, range, res);
      await this.app.workspace.getLeaf(false).openFile(noteFile);

      if (range.alsoTranscripts) {
        // One step: go straight on to fetch a frozen transcript for each video.
        await this.fetchTranscriptsForVideos(res.videos, { source: 'watch-history', detected: res.videos.length, openLog: false });
      } else {
        new Notice(
          `視聴履歴: ${res.videos.length}件（${res.pages}ページ / ${res.stopped}）→ ${noteFile.basename}\n` +
          `次: このノートで「Fetch Transcripts…」を実行すると文字起こしを取得します。`,
          16000,
        );
      }
    }).open();
  }

  /** Write a watch-history range as a paste-parseable note (URLs → the transcript
   *  fetch command re-ingests it). Idempotent per-range filename. */
  private async writeHistoryNote(videos: WatchedVideo[], range: { since: number; until: number }, meta: { pages: number; stopped: string }): Promise<TFile> {
    const folder = normalizePath(this.settings.notes.transcriptFolder || "Transcripts");
    if (!this.app.vault.getAbstractFileByPath(folder)) { try { await this.app.vault.createFolder(folder); } catch { /* */ } }
    const d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const out: string[] = [
      "---",
      `watch_history: ${d(range.since)} … ${d(range.until)}`,
      `count: ${videos.length}`,
      `fetched_pages: ${meta.pages}`,
      "---",
      "",
      `# 視聴履歴 ${d(range.since)} 〜 ${d(range.until)}`,
      "",
      `> ${videos.length}件（${meta.stopped}）。各行の URL は「Fetch Transcripts…」でそのまま文字起こしできます。`,
      "",
    ];
    for (const v of videos) {
      const when = v.watchedAt ? d(v.watchedAt) : "??";
      out.push(`- [ ] ${when} — [${v.title.replace(/[[\]]/g, "")}](${v.url})`);
    }
    out.push("");
    const path = normalizePath(`${folder}/_watch-history_${d(range.since)}_${d(range.until)}.md`);
    const body = out.join("\n");
    const ex = this.app.vault.getAbstractFileByPath(path);
    return ex instanceof TFile ? (await this.app.vault.modify(ex, body), ex) : await this.app.vault.create(path, body);
  }

  /** Ping each ingestion adapter and write a health report (invariant #7). */
  private async reconHealthCheck(): Promise<void> {
    const n = this.settings.notes;
    const L: string[] = ["# 照合パイプライン ヘルスチェック", "", `_${new Date().toISOString()}_`, ""];

    // ── コア状態: 機構は揃っているか、欠けているのはデータだけか ──
    L.push("## コア状態（機構 vs データ）");
    // 談話パーサー: run the full engine live on a probe sentence right now.
    try {
      const { analyzeDiscourse } = await import("./discourse/engine");
      const probe = analyzeDiscourse("忙しいから、時間がないんですよ。");
      const hits = probe.sentences.flatMap((s) => s.hits.map((h) => h.opId));
      L.push(`- 談話パーサー: **engine v2 稼働** ✅ (${probe.operatorCount} operators / ${probe.triggerCount} triggers · probe hits: ${hits.join("・") || "none"})`);
    } catch (e) {
      L.push(`- 談話パーサー: ❌ engine 起動失敗 — ${String(e)}`);
    }
    {
      const idxFiles = this.surferBridge.getIndexedFiles().length;
      L.push(this.surferBridge.needsReindex
        ? `- 談話インデックス: ⏳ 旧パーサー製のため破棄済み → バックグラウンド再構築中（現在 ${idxFiles} ファイル）`
        : `- 談話インデックス: ${idxFiles} ファイル（engine v2 製）${idxFiles === 0 ? " ⚠ 空 — 「Rebuild Discourse Indexes」を実行" : " ✅"}`);
    }
    L.push(this.dictStore.hasDictionaries()
      ? `- 辞書: ✅ ${this.dictStore.getDictionaryList().length} 冊 · ${this.dictStore.getTotalTermCount()} 語 → 同音異義補正 有効`
      : `- 辞書: ⚠ **未インポート（データ欠落）** — Yomitan ZIP を取り込むと照合の同音異義補正が有効化（機構はゴールデン 10/10 検証済み）`);
    {
      const xs = this.xCorpus.stats();
      L.push(xs.count > 0
        ? `- X コーパス: ✅ ${xs.count} ツイート`
        : `- X コーパス: ⚠ **空（データ欠落）** — Cookie 設定 + 検索実行で蓄積が始まる`);
    }
    L.push(this.reconLibrary.count() > 0
      ? `- 照合ライブラリ: ✅ ${this.reconLibrary.count()} 件`
      : `- 照合ライブラリ: ⚠ **0 件（未実行）** — ノートに \`source:\` を付けて「Reconcile Notes Against Source Transcript」を実行`);
    {
      const folder0 = normalizePath(n.transcriptFolder || "Transcripts");
      const tfiles = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder0 + "/") && !f.basename.startsWith("_")).length;
      L.push(`- 文字起こし: ${tfiles} 本（\`${folder0}/\`）`);
    }
    L.push("");

    L.push("## 環境");
    L.push(`- Platform.isDesktopApp: **${Platform.isDesktopApp}**`);
    L.push(`- nodeRuntimeAvailable: **${nodeRuntimeAvailable()}** (\`${requireStrategy()}\`)`);
    L.push(`- transcriptFolder: \`${n.transcriptFolder}\` · langPref: \`${n.langPref}\` · preferManual: ${n.preferManual}`);
    L.push(`- useYtdlpTranscripts: **${n.useYtdlpTranscripts}** · maxHistoryVideos: ${n.maxHistoryVideos}`);

    // Tier A — yt-dlp subtitle fetch
    L.push("", "## Tier A — yt-dlp 字幕取得（デスクトップ）");
    const tmp = this.desktopTmpDir();
    if (n.useYtdlpTranscripts && tmp) {
      const det = detectTools();
      const bin = this.settings.audioExtraction.ytdlpPath || det.ytdlp || "yt-dlp";
      const v = await probeBinary(bin, ["--version"]);
      L.push(`- yt-dlp (\`${bin}\`): ok=**${v.ok}** code=${v.code} version=\`${v.stdout}\` ${v.error ? "err=`" + v.error + "`" : ""}`);
      L.push(`- JS runtime: \`${this.settings.audioExtraction.jsRuntime || det.jsRuntime || "(deno auto)"}\``);
      L.push(`- tmp dir: \`${tmp}\``);
    } else {
      L.push(`- 無効またはデスクトップ外（HTTP tier のみ）。`);
    }

    // Tier B — HTTP timedtext reachability
    L.push("", "## Tier B — HTTP timedtext（モバイル/フォールバック）");
    try {
      const http = this.makeHttpClient();
      const r = await http.get("https://www.youtube.com/oembed?url=https://youtu.be/Zdfhde6iasg&format=json");
      L.push(`- YouTube 到達性 (oembed): HTTP **${r.status}** ${r.status === 200 ? "✅" : "⚠"}`);
      L.push("- 注意: timedtext は PO トークンゲートにより空を返すことがある（その場合は Tier A か手動貼り付け）。");
    } catch (e) {
      L.push(`- ❌ 到達不可: ${String(e)}`);
    }

    // Live watch history (cookie) — make the REAL call and report the outcome, and
    // dump the raw first page so the parser can be confirmed/fixed against real data.
    L.push("", "## 視聴履歴（Cookie / InnerTube）");
    const hc = this.makeHistoryClient();
    const hIssue = hc.configIssue();
    if (hIssue) {
      L.push(`- 未設定: ${hIssue}`);
    } else {
      try {
        const raw = await hc.fetchRaw();
        const { extractHistoryPage } = await import("./notes/yt-history-client");
        const page = extractHistoryPage(raw, Date.now());
        L.push(`- 接続: ✅ HTTP 200 · loggedOut=**${page.loggedOut}** · 先頭ページ動画数=**${page.videos.length}** · 次ページ=${page.continuation ? "あり" : "なし"}`);
        if (page.videos.length) {
          L.push("- サンプル:");
          for (const v of page.videos.slice(0, 5)) L.push(`  - ${v.watchedAt ? new Date(v.watchedAt).toISOString().slice(0, 10) : "??"} · ${v.id} · ${v.title.slice(0, 40)}`);
        }
        // Raw dump (first ~200KB) so a parser mismatch can be diagnosed precisely.
        try {
          const dumpPath = normalizePath(`${normalizePath(n.transcriptFolder || "Transcripts")}/_history-raw.json`);
          const dump = JSON.stringify(raw).slice(0, 200000);
          const exd = this.app.vault.getAbstractFileByPath(dumpPath);
          if (exd instanceof TFile) await this.app.vault.modify(exd, dump); else await this.app.vault.create(dumpPath, dump);
          L.push(`- 生レスポンスを保存: \`${dumpPath}\`（解析不一致時の診断用）`);
        } catch { /* */ }
      } catch (e) {
        L.push(`- ❌ ${e instanceof YtHistoryError ? e.message : String(e)}`);
      }
    }

    // Tier C — manual paste always available
    L.push("", "## Tier C — 手動貼り付け", "- 常に利用可能（字幕テキストを貼り、frontmatter に `video:` を付ける）。");

    const folder = normalizePath(n.transcriptFolder || "Transcripts");
    if (!this.app.vault.getAbstractFileByPath(folder)) { try { await this.app.vault.createFolder(folder); } catch { /* */ } }
    const path = normalizePath(`${folder}/_health-check.md`);
    const body = L.join("\n");
    try {
      const ex = this.app.vault.getAbstractFileByPath(path);
      const outFile = ex instanceof TFile ? (await this.app.vault.modify(ex, body), ex) : await this.app.vault.create(path, body);
      await this.app.workspace.getLeaf(false).openFile(outFile);
    } catch (e) {
      new Notice(`ヘルスチェックの書き込みに失敗: ${String(e)}`, 12000);
      return;
    }
    new Notice(`ヘルスチェックを書き出しました: ${path}`, 6000);
  }

  async openDictionaryView(query?: string, arrive?: { light?: string }): Promise<void> {
    const leaf = this.surfaceLeaf(JP_DICTIONARY_VIEW_TYPE) ?? undefined;
    if (leaf && leaf.view?.getViewType() !== JP_DICTIONARY_VIEW_TYPE) {
      await leaf.setViewState({ type: JP_DICTIONARY_VIEW_TYPE, active: true });
    }
    if (leaf) {
      this.app.workspace.revealLeaf(leaf);
      if (query) {
        // Trigger lookup after view is ready. Arriving from another surface
        // is a DESCEND, and whatever carried you (a held chip's sentence)
        // lands lit — the arrival grammar, not just a query echo.
        setTimeout(() => {
          const view = leaf!.view as DictionaryView;
          view.lookupWord(query, { tempo: "descend", light: arrive?.light });
        }, 100);
      }
    }
  }

  /** The 辞書 leaf a command should speak to, if one is open. */
  private activeDictView(): DictionaryView | null {
    for (const leaf of this.app.workspace.getLeavesOfType(JP_DICTIONARY_VIEW_TYPE)) {
      if (leaf.view instanceof DictionaryView) return leaf.view;
    }
    return null;
  }

  private importData(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const parsed = JSON.parse(text);
        const count = this.store.bulkImport(parsed);
        new Notice(`Imported ${count} entries.`);
        this.refreshViews();
      } catch {
        new Notice("Failed to parse JSON file.");
      }
    };
    input.click();
  }

  /**
   * Export the LEGACY collocation store — and say so.
   *
   * This was called "Export Data" and exported `store.exportAll()`: the ~220
   * seed collocations, and nothing else. Not `_patternStore` (the catalog and
   * its ~18k attestations), not `_srsDeck`, `_ratify`, `_reaches`, `_xCorpus`,
   * `_inbox`, `_discourseGold` or `_componentGold`. A user reaching for a button
   * named "Export Data" before a reinstall would have got the least valuable
   * store in the plugin and no warning that the rest was missing.
   *
   * The corpus itself is safe — `writeMirror` keeps `JP Lexicon/catalog.jsonl`
   * on a 5s debounce — so the fix is honesty about scope, plus a pointer at the
   * thing that actually holds everything.
   */
  private exportData(): void {
    const entries = this.store.exportAll();
    const data = JSON.stringify(entries, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jp-collocations-legacy-collocations.json";
    a.click();
    URL.revokeObjectURL(url);
    new Notice(
      `旧・連語ストアのみ ${entries.length}件を書き出しました。\n` +
      `台帳（${this.patternStore.size()}件）・復習・𝕏コーパス等は含まれません — ` +
      `そちらは ${JPCollocationsPlugin.MIRROR_FOLDER}/catalog.jsonl に自動保存されています。`,
      12000,
    );
  }

  private async fetchFromHyogen(): Promise<void> {
    if (!this.settings.hyogenEnabled) {
      new Notice("Hyogen scraping is disabled. Enable it in settings first.");
      return;
    }
    if (this.settings.hyogenWordList.length === 0) {
      new Notice("No words configured. Add words to the scrape list in settings.");
      return;
    }
    // Same road as TWC and as the panel's own button (§28 S5): the words name
    // catalog entries and each gets a frozen profile. The old body called
    // `scraper.run()`, which wrote up to 40 flat rows PER SECTION into the
    // legacy store with the section label as their gloss — the 語彙 list filling
    // with corpus output above the user's own noticings.
    const { found, missing } = this.entriesForWords(this.settings.hyogenWordList);
    if (!found.length) {
      new Notice("語法: 設定の語に対応する台帳エントリがありません。", 8000);
      return;
    }
    let ok = 0, already = 0;
    for (const p of found) {
      if (p.payload.goho) { already++; continue; }
      if (await this.freezeGoho(p)) ok++;
    }
    const parts = [`語法: ${ok}語を取得`];
    if (already) parts.push(`${already}語は取得済み（固定）`);
    if (missing.length) parts.push(`台帳になし: ${missing.slice(0, 5).join("・")}${missing.length > 5 ? "…" : ""}`);
    new Notice(parts.join(" / "), 8000);
    this.refreshViews();
  }

  /**
   * §22.7 — fetch a 語法プロフィール for ONE catalog entry and freeze it.
   *
   * §28 S5 says every medium funnels into the same path, and this is that path
   * for the corpus. The 語彙 panel's button, the `fetch-twc` command and the
   * word-list command all end here, so a profile means the same thing however
   * you asked for it — a frozen structure hanging off an entry you classified,
   * never a pile of rows.
   *
   * NINJAL-LWP first when it is on: it is the only source that says how OFTEN
   * each way of attaching is used and whether a pairing is selective (MI /
   * logDice) rather than merely frequent. Hyogen answers when TWC is off or
   * does not have the word — it has the 青空文庫 phrases TWC's grid does not.
   */
  private async freezeGoho(p: PatternEntry): Promise<boolean> {
    const word = p.payload.lemma ?? p.key;
    try {
      if (this.settings.twcEnabled) {
        // A few rate-limited round trips. ONE Notice, updated in place, so the
        // wait reads as progress rather than as a hang (§28 S6).
        const progress = new Notice(`語法: 「${word}」を照会中…`, 0);
        const twc = new TsukubaWebCorpusScraper(this.app, this.store, {
          rateLimit: this.settings.twcRateLimit,
          onProgress: (msg) => progress.setMessage(`語法: ${msg}`),
        });
        let prof: Awaited<ReturnType<typeof twc.profile>>;
        try { prof = await twc.profile(word); } finally { progress.hide(); }
        if (prof?.frames.length) {
          const shown = prof.frames.length;
          const profile = profileFromFrames(
            {
              frames: prof.frames,
              // EVERY way the word attaches, drilled or not — the site's own
              // left-hand panel. One request gets all of them, so keeping six
              // and discarding fourteen was never a saving; it just deleted
              // whole categories (助詞＋形容詞, 助動詞, 接頭辞・接尾辞) silently.
              index: prof.patterns.map((t) => ({
                id: t.id, name: t.name, category: t.category, freq: t.freq, share: t.share,
              })),
              // The other word spelled the same way stays reachable — 風 is
              // 形容動詞 フウ (80,779例) and 名詞 カゼ (322例) in this corpus.
              facets: [
                { label: `全${prof.patterns.length}パターンを見る`, url: prof.url },
                ...prof.alternates.map((a) => ({
                  label: `${a.headword}〈${a.yomi}・${a.pos}〉${a.freq.toLocaleString()}例`,
                  url: TsukubaWebCorpusScraper.pageFor(a.id),
                })),
              ],
              total: prof.headword.freq,
              // `attested`: TWC names the document AND links it, so each of
              // these is a citation, not a listing (cf. Hyogen's `phrase`
              // items). `frame`/`collocate` are what the batch was requested
              // for — the pairing cannot be recovered from the text afterwards.
              examples: prof.examples.map((e) => ({
                text: e.text, source: e.source, url: e.url, span: e.span, ref: e.ref,
                kind: 'attested' as const, frame: e.frame, collocate: e.collocate,
              })),
            },
            p.key, "NINJAL-LWP for TWC", Date.now(),
          );
          const ok = await this.patternStore.setGoho(p.id, profile);
          if (ok) {
            const ex = profile.sourced?.length ? ` · 用例${profile.sourced.length}件（出典つき）` : "";
            // Say WHICH lemma was profiled — with a homograph the reading is
            // the difference between two different words.
            const alt = prof.alternates.length ? ` ／ 別語義${prof.alternates.length}件は絞込みから` : "";
            new Notice(
              `語法プロフィール〈${prof.headword.yomi}・${prof.headword.pos}〉: ` +
              `${prof.patterns.length}通りの付き方を記録（${shown}件を展開済み — ` +
              `残りは項目をタップで取得）· ` +
              `${prof.headword.freq.toLocaleString()}例${ex}${alt}`,
              7000);
          }
          return ok;
        }
        if (!this.settings.hyogenEnabled) {
          new Notice(`語法: 「${word}」は TWC の見出し語にありません`, 6000);
          return false;
        }
      }

      if (!this.settings.hyogenEnabled) return false;
      const hy = await new HyogenScraper(this.app, this.store, { rateLimit: 0 }).profile(word);
      if (!hy.total) {
        new Notice(`語法: 「${word}」は Hyogen に見つかりませんでした`, 6000);
        return false;
      }
      // Hyogen's items ARE its 青空文庫 phrases — the one thing TWC's grid does
      // not carry.
      const hyEx = hyogenExamples(hy, HyogenScraper.pageFor(word));
      const profile = profileFromFrames(
        { frames: hy.sections, facets: hy.facets, total: hy.total, examples: hyEx },
        p.key, "hyogen", Date.now(),
      );
      const ok = await this.patternStore.setGoho(p.id, profile);
      if (ok) {
        const ex = hyEx.length ? ` · 用例${hyEx.length}件（青空文庫）` : "";
        new Notice(
          `語法プロフィール: ${hy.sections.length}通りの付き方 / ${hy.total.toLocaleString()}例（表示は各${FRAME_ITEMS}件）${ex}`,
          7000);
      }
      return ok;
    } catch (e) {
      // §28 S6 — say what failed, where the thing would have been.
      console.error("[jp-collocations] goho fetch failed:", e);
      new Notice(`語法の取得に失敗: ${e instanceof Error ? e.message : String(e)}`, 8000);
      return false;
    }
  }

  /**
   * The catalog entries these words name, if any.
   *
   * Deliberately does NOT create one for a word with no entry. The corpus is a
   * recall machine and the hand is the classifier (§12): manufacturing a
   * catalog entry out of a scrape would be the machine filing a noticing you
   * never had, and the six classes are human-assigned by construction. A word
   * with no entry is reported, not invented.
   */
  private entriesForWords(words: string[]): { found: PatternEntry[]; missing: string[] } {
    const norm = (s: string): string => normalizeJapanese(s).replace(/\s+/g, "");
    const byKey = new Map<string, PatternEntry>();
    for (const e of this.patternStore.all()) {
      for (const k of [e.key, e.payload.lemma ?? ""]) {
        const n = norm(k);
        if (n && !byKey.has(n)) byKey.set(n, e);
      }
    }
    const found: PatternEntry[] = [];
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const w of words) {
      const hit = byKey.get(norm(w));
      if (hit && !seen.has(hit.id)) { seen.add(hit.id); found.push(hit); }
      else if (!hit) missing.push(w);
    }
    return { found, missing };
  }

  /**
   * Fetch 語法 profiles for words, onto the entries that are those words.
   *
   * This used to call `scraper.run()`, which wrote up to `MAX_FRAMES ×
   * maxPerPattern` = **120 flat `CollocationEntry` rows per word** into the
   * legacy store — 600+ corpus rows sitting above the user's own noticings in
   * the 語彙 list, each showing its raw `freq=… MI=… logDice=… — URL` string as
   * its gloss. That is the §28 stratum order inverted in the most visible
   * surface in the plugin, and the same data in a worse shape than the frozen
   * profile already holds it in.
   *
   * The corpus is still fully reachable: it is indexed for search (badged 📊),
   * it contributes to every context card, and it is the 語法 box on the entry.
   */
  private async fetchFromTWC(words: string[]): Promise<void> {
    if (!this.settings.twcEnabled) {
      new Notice("TWC検索は無効です。設定で有効にしてください。");
      return;
    }
    const { found, missing } = this.entriesForWords(words);
    if (!found.length) {
      new Notice(
        `語法: 「${words.join("・")}」に対応する台帳エントリがありません。` +
        `先に分類して台帳に入れてください（コーパスは台帳を作りません）`, 8000);
      return;
    }
    let ok = 0, already = 0;
    for (const p of found) {
      if (p.payload.goho) { already++; continue; }   // §2.4 — frozen, never re-fetched
      if (await this.freezeGoho(p)) ok++;
    }
    const parts = [`語法: ${ok}語を取得`];
    if (already) parts.push(`${already}語は取得済み（固定）`);
    if (missing.length) parts.push(`台帳になし: ${missing.slice(0, 5).join("・")}${missing.length > 5 ? "…" : ""}`);
    new Notice(parts.join(" / "), 8000);
    this.refreshViews();
  }

  private async fetchFromTWCWordlist(): Promise<void> {
    // The catalog's own keys — the words you have actually noticed. Reading
    // headwords out of the legacy store would ask the corpus about rows the
    // corpus itself put there on a previous run.
    const keys = this.patternStore.all()
      .filter((e) => !e.payload.goho)
      .slice(0, 50)
      .map((e) => e.payload.lemma ?? e.key);
    if (keys.length === 0) {
      new Notice("語法を未取得の台帳エントリがありません。", 6000);
      return;
    }
    await this.fetchFromTWC(keys);
  }
}
