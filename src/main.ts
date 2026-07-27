import { Plugin, WorkspaceLeaf, Notice, TFile, Platform, FileSystemAdapter, Menu, normalizePath, requestUrl, arrayBufferToBase64 } from "obsidian";
import type { PluginSettings, CollocationEntry } from "./types";
import { DEFAULT_SETTINGS, DEFAULT_NOTES_CONFIG, DEFAULT_PLEX_SETTINGS, PartOfSpeech, CollocationSource } from "./types";
import { CollocationStore } from "./data/CollocationStore";
import { DataManager, type BlobFileIO } from "./data/data-manager";
import { stripDerivedIndexes, extractSecrets, scrubSettingsForPersist, SECRET_LS_KEYS } from "./data/blob-migrations";
import { SearchEngine } from "./search/SearchEngine";
import { HyogenScraper } from "./scraper/HyogenScraper";
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
import { isReviewable } from "./srs/review-cards";
import { CardPreviewModal } from "./ui/CardPreviewModal";
import { generatePhraseInContextCard, generateRelationChunkCards, setCardGenResolver } from "./srs/card-generator";
import { extractCollocations } from "./srs/collocation-extractor";
import { DictionaryView, JP_DICTIONARY_VIEW_TYPE } from "./ui/DictionaryView";
import { DictionaryStore } from "./dictionary/DictionaryStore";
import { XCorpusStore } from "./x/XCorpusStore";
import { XClient } from "./x/XClient";
import { XSearchView, JP_X_VIEW_TYPE, type XViewDeps } from "./ui/XSearchView";
import { emptyQuery, DEFAULT_X_SETTINGS } from "./x/x-types";
import { parseTerms } from "./x/query-builder";
import {
  buildBrowserCaptureUrl,
  decodeCaptureData,
  X_CAPTURE_ACTION,
} from "./x/mobile-capture";
import { getDiscourseExtensions, toggleDiscourseVisualization, toggleVisualization, setEditorContext } from "./ui/EditorDecorations";
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
import { reconcileMultiAsync, reconcileOne, parseTranscriptLines, frontmatterSources, frontmatterAny, bodyVideoId, extractNotePhrases, CAPTION_STAMP_RE, type ReconciledResult } from "./notes/pipeline";
import { makeDictionaryReadingResolver } from "./notes/reading-resolver";
import { LibraryView, JP_RECON_LIBRARY_VIEW_TYPE } from "./ui/LibraryView";
import { ReconLibrary } from "./notes/recon-library";
import { PatternStore, sweepTerms, patternIdFor, derivePattern, attestationKey, type Attestation, type PatternEntry } from "./notes/pattern-store";
// §27.5 big-dictionary sidecars (the blob never sees 2.36M entries).
import { importEijiro, type BankSource } from "./dictionary/import-eijiro";
import { vaultSidecarIO, nodeBankSource, nodeChunkSource } from "./dictionary/sidecar-io";
import { bufferedSidecarIO, repairSidecarMeta } from "./dictionary/sidecar";
import { importDexie, skipTitles } from "./dictionary/import-dexie";
import { BigDictStore } from "./dictionary/big-dict";
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
import { parsePlexSessions, pickPlexSession, plexSessionsUrl, plexPartUrl, buildPlexClipArgs, buildPlexStillArgs, type PlexSessionsResult } from "./notes/plex";
import { YouTubeTranscriptAdapter, TranscriptError, type HttpClient, type Transcript, type TranscriptFetchConfig, type YtdlpTranscriptConfig } from "./notes/transcript";
import { ocrImage, mergeOcrPhrases, imageHash, ocrMarker, planTiles, tileUpscale } from "./notes/ocr-reconciler";
import { detectSpeechTools, enrichClip, voiceSyncSidecarName, extractRefWav, DEFAULT_VOICE_SYNC, type VoiceSyncData } from "./notes/voice-lab";
import { registerVoiceSync } from "./ui/VoiceSyncRenderer";
import { API_URL as CLAUDE_API_URL, API_VERSION as CLAUDE_API_VERSION, type ClaudeHttp, type VisionImage } from "./notes/claude-client";
import { buildScaffoldBody, parseScaffoldResponse } from "./notes/scaffold";
import { suggestClass } from "./notes/class-suggester";
import { srtToNote, fmtStamp } from "./notes/srt";
import { parseWhisperSegments, parseDiarTurns, speakerStampLines } from "./notes/voice-lab";
import { normalizeProfile } from "./scraper/goho";
import { MANGA_MODEL, MANGA_PROMPT, parseMangaOcr } from "./notes/manga-ocr";
import { buildVisionBody } from "./notes/claude-client";
import { parsePodcastFeed, podcastNote } from "./notes/podcast-rss";
import { componentKeyOf, type ComponentVerdict } from "./ui/DiscourseModeView";
import { ImportModal } from "./ui/ImportModal";
import { InboxStore, markCard, type MarkRef, type InboxCard } from "./notes/inbox";
import { ReachStore, reachStats, type ReachData, type Reach } from "./notes/reach";
import { ReachModal } from "./ui/ReachModal";
import { TrayView, JP_TRAY_VIEW_TYPE } from "./ui/TrayView";
import { discoverCollocations, type DiscoverySource, type Discovery } from "./notes/discovery";
import { DiscoveryModal } from "./ui/DiscoveryModal";
import { SpeakStore } from "./notes/speak-session";
import { FollowAlongView, JP_FOLLOW_VIEW_TYPE } from "./ui/FollowAlongView";
import { PLAYER_MODEL, PLAYER_PROMPT, parsePlayerShot, matchEpisodeNote } from "./notes/player-shot";

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
import { renderTranscriptFile, transcriptFileBaseName } from "./notes/transcript-assembly";
import { parseHistory, type WatchedVideo } from "./notes/yt-history";
import { YtHistoryClient, YtHistoryError, DEFAULT_YT_HISTORY_SETTINGS } from "./notes/yt-history-client";
import { HistoryRangeModal } from "./ui/HistoryRangeModal";
import type { NoteClass } from "./notes/note-types";
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
    };
    this.dm = new DataManager(blobIO, normalizePath(`${pluginDir}/data.json`), normalizePath(`${pluginDir}/data.json.bak`));
    const loadRes = await this.dm.load();
    if (loadRes.restoredFromBackup) new Notice("jp-collocations: data.json が破損 — バックアップから復元しました");
    else if (loadRes.corrupt) new Notice("jp-collocations: data.json が破損、バックアップなし — 空の状態で開始します");

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
    // the yt-dlp cookie jar used to live inside the vault (synced) — remove it;
    // it regenerates at its new device-local home on next use
    for (const legacy of ["_yt_cookies.txt", "_yt_cookies.txt.meta"]) {
      void this.app.vault.adapter.remove(normalizePath(`${pluginDir}/${legacy}`)).catch(() => {});
    }

    this.loadSettings();
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
    let indexTimer: ReturnType<typeof setTimeout> | null = null;
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
        if (indexTimer) clearTimeout(indexTimer);
        indexTimer = setTimeout(() => {
          if (!leaf) return;
          const file = this.app.workspace.getActiveFile();
          if (!file || file.extension !== 'md') return;
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

    // §27.0.2 — the plugin holds what you have caught; this holds what you are
    // still REACHING FOR. Tiny (a sentence and a few offers), so unlike the
    // dictionaries it genuinely belongs in the blob.
    // §27.5 READ side: the converted sidecars, discovered from the vault
    // folders. Construction is free — nothing is read until first query.
    this.bigDict = new BigDictStore(
      vaultSidecarIO(this.app),
      this.settings.bigDict?.root || "JP Dictionaries",
      // One query reads one shard per installed dictionary (31 here), so the
      // cache has to span a whole query or nothing is ever reused. Phones get
      // a third of the budget.
      { cacheBytes: (Platform.isMobile ? 8 : 24) * 1024 * 1024 },
    );

    this.reachStore = new ReachStore((data) => this.dm.setKey("_reaches", data));
    this.reachStore.load((stored as { _reaches?: ReachData } | undefined)?._reaches);
    this.registerView(JP_TRAY_VIEW_TYPE, (leaf) => new TrayView(leaf, {
      store: this.inboxStore,
      openCapture: (ctx) => new CaptureModal(this.app, ctx, this.makeCaptureDeps()).open(),
      saveImage: async (name, data) => {
        const folder = "attachments";
        if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder).catch(() => {});
        const ext = name.split(".").pop() || "png";
        const path = normalizePath(`${folder}/inbox-${Date.now()}.${ext}`);
        await this.app.vault.createBinary(path, data);
        return path;
      },
      // §22.2 manga: spread-aware bubble OCR (pinned model, bbox-validated)
      ocrManga: this.settings.notes.ocrApiKey ? async (vaultPath) => {
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
      } : undefined,
      // §25.3: a player screenshot becomes a precise podcast mark
      recognizePlayer: this.settings.notes.ocrApiKey
        ? (card) => this.recognizePlayerShot(card)
        : undefined,
      // §25.1 harvest: a mark re-manifests its transcript moment
      resolveMarkContext: (mark) => this.resolveMarkContext(mark),
      // §28 S1: a dropped phrase you have already noticed says so
      patternsIn: (text) => this.patternsIn(text),
      openPattern: (id) => void this.openLexiconAt(id),
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
    }));

    // ── 発話セッション store + 鑑賞モード view (§25.2/§25.5) ──
    this.speakStore = new SpeakStore((data) => this.dm.setKey("_speakSessions", data));
    this.speakStore.load(stored?._speakSessions);
    this.registerView(JP_FOLLOW_VIEW_TYPE, (leaf) => new FollowAlongView(leaf, {
      parse: parseTranscriptLines,
      addTrayMark: async (m) => { await this.inboxStore.add(markCard(m, Date.now())); },
      speak: this.speakStore,
      aspects: () => this.settings.speak.aspects,
      goalPoints: () => this.settings.speak.goalPoints,
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
    );

    // Register views
    this.registerView(JP_COLLOCATIONS_VIEW_TYPE, leaf =>
      new CollocationView(leaf, this.store, this.engine, this.settings, this.contextEngine, this.dictStore, {
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
        // §23.5 cross-surface drop: tray card → 語彙 view = capture
        onDropCapture: (text, sourceName) => {
          const short = text.length <= 40;
          new CaptureModal(this.app, {
            text: short ? text : "",
            example: short ? undefined : text,
            source: { kind: "manual", sourceName },
          }, this.makeCaptureDeps()).open();
        },
        findExamples: (p) => this.findExamplesFor(p),
        searchXFor: (p) => this.openXView(sweepTerms(p).map((t) => `"${t}"`).join(" ") || p.key),
        generateScaffold: this.settings.notes.ocrApiKey ? (p) => this.generateScaffoldFor(p) : undefined,
        // §22.7: per-entry corpus enrichment — every enabled adapter answers
        // for THIS key, results merged, fetched once and frozen
        fetchGoho: (this.settings.hyogenEnabled || this.settings.twcEnabled) ? async (p) => {
          const word = p.payload.lemma ?? p.key;
          const entries: CollocationEntry[] = [];
          const sources: string[] = [];
          if (this.settings.hyogenEnabled) {
            try {
              const got = await new HyogenScraper(this.app, this.store, { rateLimit: 0 }).profileWord(word);
              if (got.length) { entries.push(...got); sources.push("hyogen"); }
            } catch (e) { console.error("[jp-collocations] hyogen goho failed:", e); }
          }
          if (this.settings.twcEnabled) {
            try {
              const got = await new TsukubaWebCorpusScraper(this.app, this.store, { rateLimit: 0 }).profileWord(word);
              if (got.length) { entries.push(...got); sources.push("twc"); }
            } catch (e) { console.error("[jp-collocations] twc goho failed:", e); }
          }
          const profile = normalizeProfile(entries, p.key, sources.join("+") || "corpus", Date.now());
          return this.patternStore.setGoho(p.id, profile);
        } : undefined,
        captureCorpus: (p, example) => {
          new CaptureModal(this.app, {
            text: p.key,
            example,
            source: { kind: "web", medium: "corpus", sourceName: p.payload.goho?.source ?? "corpus", loc: p.key },
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
      })
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
      name: "Import Data",
      callback: () => this.importData(),
    });

    this.addCommand({
      id: "export-data",
      name: "Export Data",
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
      name: "辞書: 変換済み辞書を修復（meta.json を再生成して検索可能に）",
      callback: async () => { await this.repairBigDictionaries(); },
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
    this.addRibbonIcon("torii-gate", "JP Collocations", (evt) => {
      const menu = new Menu();
      const add = (title: string, icon: string, cb: () => void) =>
        menu.addItem((i) => i.setTitle(title).setIcon(icon).onClick(cb));
      add("⚡ キャプチャフロー", "zap", () => this.openPipelineView());
      add("語彙・台帳", "languages", () => this.openLexiconView());
      add("復習 (SRS)", "layers", () => this.openReviewView());
      add("辞書", "book-open", () => this.openDictionaryView());
      add("𝕏 検索", "search", () => this.openXView());
      add("談話モード", "messages-square", () => this.openDiscourseMode());
      add("鑑賞モード（今ここ）", "eye", () => { void this.openFollowAlong(); });
      add("収集トレイ", "inbox", () => { void this.openTray(); });
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
        if (cmView) {
          toggleDiscourseVisualization(cmView);
          const active = cmView.state.field(
            // re-import avoided by checking directly
            cmView.state.field !== undefined
          );
          new Notice('談話文法可視化：' + (active ? 'ON' : 'OFF'));
        }
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
    this.scraper?.abort();
    this.twcScraper?.abort();
    this.app.workspace.detachLeavesOfType(JP_COLLOCATIONS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(JP_DICTIONARY_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(JP_X_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(JP_RECON_LIBRARY_VIEW_TYPE);
  }

  // ── Universal classify-capture (DESIGN §13) ─────────────────

  /** The dependency bundle every capture surface shares. */
  makeCaptureDeps(): CaptureDeps {
    return {
      recordClassified: (opts) => this.patternStore.recordClassified(opts),
      addGold: (g) => this.goldStore.add(g),
      onSaved: () => this.refreshReconLibrary(),
      // §21: calibrated by the user's own suggested-vs-chosen record —
      // every past capture makes the next preselection smarter.
      suggestClass: (note) => suggestClass(
        note,
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

    const a = stats.actAgreement;
    const rate = a.graded ? `${Math.round((a.agreed / a.graded) * 100)}% (${a.agreed}/${a.graded})` : "—";
    new Notice(
      `談話ゴールド ${stats.total}件 → discourse-gold.jsonl\n` +
      `パーサのムーブ一致率: ${rate}\n` +
      `分類選択 ${choices.length}件 → class-choices.jsonl`,
      9000,
    );
  }

  // ── X Search wiring ──────────────────────────────────────────

  /** Assemble the dependency bundle the X search view needs. */
  private makeXDeps(): XViewDeps {
    return {
      corpus: this.xCorpus,
      client: this.xClient,
      getSettings: () => this.settings.x,
      saveSettings: () => this.saveSettings(),
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
      // pattern already in the 台帳 wears that pattern's class mark here too.
      patternsIn: (text) => this.patternsIn(text),
      openPattern: (id) => this.openLexiconAt(id),
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
    let leaf: WorkspaceLeaf | undefined;
    const existing = this.app.workspace.getLeavesOfType(JP_X_VIEW_TYPE);
    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = this.app.workspace.getRightLeaf(false) ?? undefined;
      if (leaf) await leaf.setViewState({ type: JP_X_VIEW_TYPE, active: true });
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
    // Secrets live device-local (never in the synced blob); the runtime
    // settings object carries the real values, the persisted copy carries ''.
    const ls = (k: string): string => (this.app.loadLocalStorage(k) as string | null) ?? "";
    if (!this.settings.x.authToken) this.settings.x.authToken = ls(SECRET_LS_KEYS.xAuthToken);
    if (!this.settings.x.csrfToken) this.settings.x.csrfToken = ls(SECRET_LS_KEYS.xCsrfToken);
    if (!this.settings.ytHistory.cookie) this.settings.ytHistory.cookie = ls(SECRET_LS_KEYS.ytCookie);
    if (!this.settings.notes.ocrApiKey) this.settings.notes.ocrApiKey = ls(SECRET_LS_KEYS.ocrApiKey);
    if (!this.settings.plex.token) this.settings.plex.token = ls(SECRET_LS_KEYS.plexToken);
  }

  async saveSettings(): Promise<void> {
    const { scrubbed, secrets } = scrubSettingsForPersist(this.settings as unknown as Record<string, unknown>);
    this.app.saveLocalStorage(SECRET_LS_KEYS.xAuthToken, secrets.xAuthToken ?? null);
    this.app.saveLocalStorage(SECRET_LS_KEYS.xCsrfToken, secrets.xCsrfToken ?? null);
    this.app.saveLocalStorage(SECRET_LS_KEYS.ytCookie, secrets.ytCookie ?? null);
    this.app.saveLocalStorage(SECRET_LS_KEYS.ocrApiKey, secrets.ocrApiKey ?? null);
    this.app.saveLocalStorage(SECRET_LS_KEYS.plexToken, secrets.plexToken ?? null);
    await this.dm.setSettings(scrubbed);
  }

  async openTray(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(JP_TRAY_VIEW_TYPE);
    if (existing.length > 0) { this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: JP_TRAY_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
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
      return { ok: false, error: `Plex サーバーに接続できません: ${(e as Error).message}` };
    }
    return parsePlexSessions(resp.status, resp.text ?? "");
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
  private withCatalogHits(v: DictionaryView): DictionaryView {
    v.patternsIn = (text) => this.patternsIn(text);
    v.openPattern = (id) => void this.openLexiconAt(id);
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
        root: this.settings.bigDict?.root || "JP Dictionaries",
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
   */
  async repairBigDictionaries(): Promise<string> {
    if (this.conversionRunning) return this.refuseSecondConversion();
    this.conversionRunning = "修復";
    const notice = new Notice("辞書フォルダを検査中…", 0);
    const io = vaultSidecarIO(this.app);
    try {
      const res = await repairSidecarMeta(io, this.settings.bigDict?.root || "JP Dictionaries", {
        onProgress: (p) => {
          notice.setMessage(
            `辞書を修復中 ${p.done}/${p.total} — ${p.title}（${(p.bytes / 1048576).toFixed(0)}MB 読込）`,
          );
        },
      });
      this.bigDict.invalidate();
      const msg = res.repaired.length
        ? `${res.repaired.length}辞書を復旧: ` +
          res.repaired.slice(0, 4).map((r) => `${r.title} ${r.headwords.toLocaleString()}語`).join("、") +
          (res.repaired.length > 4 ? ` ほか${res.repaired.length - 4}辞書` : "") +
          "（未完了の可能性があるため「暫定」表示です）"
        : `復旧が必要な辞書はありません（${res.alreadyOk.length}辞書は正常）。`;
      new Notice(msg, 15000);
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
    const existing = this.app.workspace.getLeavesOfType(JP_COLLOCATIONS_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: JP_COLLOCATIONS_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
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
  private async watchReaches(incoming: Array<{ surface: string; source?: Reach['offers'][number]['source']; frameKey?: string; at: number }>): Promise<void> {
    if (!this.reachStore.open().length || !incoming.length) return;
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
      new Notice("frontmatter に `source: [[transcript]]`（複数可: カンマ/リスト）を追加してください");
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
      new Notice("frontmatter に `source: [[transcript]]`（複数可: カンマ/リスト）を追加してください");
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
    let leaf = this.app.workspace.getLeavesOfType(JP_REVIEW_VIEW_TYPE)[0];
    if (!leaf) {
      const right = this.app.workspace.getRightLeaf(false);
      if (right) { await right.setViewState({ type: JP_REVIEW_VIEW_TYPE, active: true }); leaf = right; }
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
    if (!srcRefs.length) { new Notice("frontmatter に `source: [[transcript]]`（複数可: カンマ/リスト）を追加してください"); return null; }

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
    await this.patternStore.recordMany(tweets.map((t) => ({
      note: p.note,
      // §28 S2: carry the door back. The corpus join used to leave `medium`
      // and `scene` empty, so a tweet attached here rendered without the X
      // affordances the same tweet gets when captured by hand.
      att: {
        source: "x" as const, medium: "x" as const, file: t.url,
        scene: { deepLink: t.url, sourceName: t.authorHandle ? `@${t.authorHandle}` : "X" },
        quote: t.text.replace(/\s+/g, " ").trim(), addedAt: now,
      },
    })), now);
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
        root: this.settings.bigDict?.root || "JP Dictionaries",
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
        const rows = buildConcordanceRows(turns, {
          source: {
            source: "yt", medium: "yt", file: f.path, videoId,
            sourceName: f.basename,
            ...(videoId ? { deepLink: `https://youtu.be/${videoId}` } : {}),
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
    ];
    const path = "_診断.md";
    const body = L.join("\n");
    const ex = this.app.vault.getAbstractFileByPath(path);
    const outFile = ex instanceof TFile
      ? (await this.app.vault.modify(ex, body), ex)
      : await this.app.vault.create(path, body);
    await this.app.workspace.getLeaf(false).openFile(outFile);
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

  /** Stamp `source: [[basename]]` into a notes file's frontmatter if it has none,
   *  so the reconcile command finds the transcript. Non-destructive otherwise. */
  private async ensureSourceFrontmatter(file: TFile, basename: string): Promise<boolean> {
    const content = await this.app.vault.read(file);
    if (frontmatterSources(content).length) return false;         // already linked — leave it
    let next: string;
    const fm = content.match(/^(﻿?---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/);
    if (fm) {
      next = fm[1] + fm[2] + `\nsource: [[${basename}]]` + fm[3] + content.slice(fm[0].length);
    } else {
      next = `---\nsource: [[${basename}]]\n---\n\n` + content;
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
    const existing = this.app.workspace.getLeavesOfType(JP_PIPELINE_VIEW_TYPE);
    const leaf = existing[0] ?? this.app.workspace.getLeaf(true);
    if (!existing.length) await leaf.setViewState({ type: JP_PIPELINE_VIEW_TYPE, active: true });
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
      return;
    }
    notice.hide();
    if (!t) { new Notice(`この動画には字幕がありません (${videoId})。スキップしました。`, 10000); return; }

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

  async openDictionaryView(query?: string): Promise<void> {
    let leaf: WorkspaceLeaf | undefined;
    const existing = this.app.workspace.getLeavesOfType(JP_DICTIONARY_VIEW_TYPE);
    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = this.app.workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: JP_DICTIONARY_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      this.app.workspace.revealLeaf(leaf);
      if (query) {
        // Trigger lookup after view is ready
        setTimeout(() => {
          const view = leaf!.view as DictionaryView;
          view.lookupWord(query);
        }, 100);
      }
    }
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

  private exportData(): void {
    const data = JSON.stringify(this.store.exportAll(), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jp-collocations-export.json";
    a.click();
    URL.revokeObjectURL(url);
    new Notice("Exported collocations.");
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
    if (this.scraper?.isRunning()) {
      new Notice("Scraper is already running.");
      return;
    }
    this.scraper = new HyogenScraper(this.app, this.store, {
      rateLimit: this.settings.hyogenRateLimit,
      onProgress: msg => new Notice(msg, 3000),
      onEntry: () => this.refreshViews(),
    });
    this.scraper.enqueue(this.settings.hyogenWordList);
    new Notice(`Starting Hyogen scrape for ${this.settings.hyogenWordList.length} words...`);
    const count = await this.scraper.run();
    new Notice(`Hyogen scrape complete. Added ${count} new entries.`);
    this.refreshViews();
  }

  private async fetchFromTWC(words: string[]): Promise<void> {
    if (!this.settings.twcEnabled) {
      new Notice("TWC検索は無効です。設定で有効にしてください。");
      return;
    }
    if (this.twcScraper?.isRunning()) {
      new Notice("TWCスクレーパーは実行中です。");
      return;
    }
    this.twcScraper = new TsukubaWebCorpusScraper(this.app, this.store, {
      rateLimit: this.settings.twcRateLimit,
      onProgress: msg => new Notice(msg, 3000),
      onEntry: () => this.refreshViews(),
    });
    this.twcScraper.enqueue(words);
    new Notice(`TWC: ${words.length}語の共起プロファイルを取得中...`);
    const count = await this.twcScraper.run();
    new Notice(`TWC完了: ${count}件の共起データを追加しました。`);
    this.refreshViews();
  }

  private async fetchFromTWCWordlist(): Promise<void> {
    // Collect headwords from existing store entries
    const entries = this.store.exportAll();
    const headwords = [...new Set(entries.map(e => e.headword))].slice(0, 50);
    if (headwords.length === 0) {
      new Notice("語彙データがありません。先にエントリを追加してください。");
      return;
    }
    await this.fetchFromTWC(headwords);
  }
}
