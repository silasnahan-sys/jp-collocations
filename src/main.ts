import { Plugin, WorkspaceLeaf, Notice, TFile, Platform, FileSystemAdapter, normalizePath } from "obsidian";
import type { PluginSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { CollocationStore } from "./data/CollocationStore";
import { SearchEngine } from "./search/SearchEngine";
import { HyogenScraper } from "./scraper/HyogenScraper";
import { TsukubaWebCorpusScraper } from "./scraper/TsukubaWebCorpusScraper";
import { CollocationView, JP_COLLOCATIONS_VIEW_TYPE, setCollocationViewResolver } from "./ui/CollocationView";
import { SearchModal } from "./ui/SearchModal";
import { AddEntryModal } from "./ui/AddEntryModal";
import { SettingsTab } from "./ui/SettingsTab";
import { TextClassifier } from "./classifier/TextClassifier";
import { ClassifyModal } from "./ui/ClassifyModal";
import { CardPreviewModal } from "./ui/CardPreviewModal";
import { generatePhraseInContextCard, generateRelationChunkCards, setCardGenResolver } from "./srs/card-generator";
import { extractCollocations } from "./srs/collocation-extractor";
import { DictionaryView, JP_DICTIONARY_VIEW_TYPE } from "./ui/DictionaryView";
import { DictionaryStore } from "./dictionary/DictionaryStore";
import { XCorpusStore } from "./x/XCorpusStore";
import { XClient } from "./x/XClient";
import { XSearchView, JP_X_VIEW_TYPE, type XViewDeps } from "./ui/XSearchView";
import { emptyQuery } from "./x/x-types";
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
import { reconcile, parseTranscriptLines, frontmatterSource, frontmatterAny, extractNotePhrases, type ReconciledResult } from "./notes/pipeline";
import { makeDictionaryReadingResolver } from "./notes/reading-resolver";
import { LibraryView, JP_RECON_LIBRARY_VIEW_TYPE } from "./ui/LibraryView";
import { ReconLibrary } from "./notes/recon-library";
import { renderAnchoredFile, buildEntries, retypeInMarkdown, blockIdFor, type LibraryEntry } from "./notes/annotate";
import { buildReconCards, renderCardsFile } from "./notes/cards";
import { parseYouTubeId, deepLinkProvider } from "./notes/audio-provider";
import { extractClip, detectTools, clipNameFor, type ExtractRequest } from "./notes/audio-extractor";
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

  /** Growing, offline-searchable corpus of scraped tweets (the X dictionary). */
  xCorpus!: XCorpusStore;
  /** Scraper for X's GraphQL SearchTimeline (cookie-authenticated). */
  private xClient!: XClient;

  /** Bridge for jp-sentence-surfer- integration */
  private surferBridge!: SurferBridge;

  /** Context engine — the hivemind connecting all data sources */
  contextEngine!: ContextEngine;

  /** Shared sidecar-aware relations resolver — initialised in onload(). */
  private relationsResolver!: RelationsResolver;
  /** Status-bar item showing sidecar coverage for the current session. */
  private sidecarStatusEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // ── Surfer Bridge Init ───────────────────────────────────
    this.surferBridge = new SurferBridge(async (data) => {
      const existing = await this.loadData();
      await this.saveData({ ...existing, _surferBridge: data });
    }, this.app);
    // Restore persisted surfer bridge state (entries + indexes)
    const stored = await this.loadData();
    if (stored?._surferBridge) {
      this.surferBridge.load(stored._surferBridge);
    } else if (stored?._surferEntries) {
      // Backward compat: migrate from old format
      this.surferBridge.load({ entries: stored._surferEntries });
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
    this.dictStore = new DictionaryStore(this.app, async (data) => {
      const existing = await this.loadData();
      await this.saveData({ ...existing, _dictStore: data });
    });
    if (stored?._dictStore) {
      this.dictStore.loadFromData(stored._dictStore);
    }

    // ── Reconciliation library (anchored callout index) ──────
    this.reconLibrary = new ReconLibrary(async () => {
      const existing = await this.loadData();
      await this.saveData({ ...existing, _reconLibrary: this.reconLibrary.toData() });
    });
    if (stored?._reconLibrary) this.reconLibrary.loadFromData(stored._reconLibrary);

    // ── X Search corpus + client ─────────────────────────────
    this.xCorpus = new XCorpusStore(async (data) => {
      const existing = await this.loadData();
      await this.saveData({ ...existing, _xCorpus: data });
    });
    if (stored?._xCorpus) this.xCorpus.loadFromData(stored._xCorpus);
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
      new CollocationView(leaf, this.store, this.engine, this.settings, this.contextEngine, this.dictStore)
    );
    this.registerView(JP_DICTIONARY_VIEW_TYPE, leaf =>
      new DictionaryView(leaf, this.dictStore, async () => {
        await this.dictStore.save();
        this.refreshDictionaryViews();
      }, (expression, reading, example) => {
        this.saveEntryFromDict(expression, reading, example);
      }, this.contextEngine)
    );
    this.registerView(JP_X_VIEW_TYPE, leaf => new XSearchView(leaf, this.makeXDeps()));
    this.registerView(JP_RECON_LIBRARY_VIEW_TYPE, leaf => new LibraryView(leaf, {
      library: this.reconLibrary,
      onRetype: (entry, cls) => this.retypeReconNote(entry, cls),
      openBlock: (entry) => this.app.workspace.openLinkText(`${entry.file}#^${entry.blockId}`, "", false).then(() => undefined),
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
      name: "Classify Selected Text",
      editorCallback: (editor) => {
        const selected = editor.getSelection();
        if (!selected || selected.trim().length === 0) {
          new Notice("Select some Japanese text first!");
          return;
        }
        const classifier = new TextClassifier();
        const result = classifier.classify(selected.trim());
        new ClassifyModal(this.app, result, this.store, () => this.refreshViews()).open();
      },
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
    // source transcript and write a reconciled report.
    this.addCommand({
      id: "reconcile-notes-transcript",
      name: "Reconcile Notes Against Source Transcript",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) { new Notice("ノートファイルを開いてください"); return; }
        const content = await this.app.vault.cachedRead(file);

        const src = frontmatterSource(content);
        if (!src) { new Notice("frontmatter に `source: [[transcript]]` を追加してください"); return; }

        const tFile = this.app.metadataCache.getFirstLinkpathDest(src, file.path);
        if (!tFile) { new Notice(`文字起こしが見つかりません: ${src}`); return; }

        const lines = parseTranscriptLines(await this.app.vault.cachedRead(tFile));
        if (!lines.length) { new Notice("文字起こしに行が見つかりません（字幕なし？）"); return; }

        const notes = extractNotePhrases(content);
        if (!notes.length) { new Notice("照合するメモが見つかりません"); return; }

        const readingOf = makeDictionaryReadingResolver(this.dictStore);
        const results = reconcile(notes, lines, readingOf);

        const outPath = file.path.replace(/\.md$/, "") + "-reconciled.md";
        const priorClass = this.reconLibrary.classMapForFile(outPath);
        const anchored = renderAnchoredFile(results, {
          sourceLabel: tFile.basename,
          transcriptRef: `[[${tFile.basename}]]`,
          priorClass,
        });

        const existing = this.app.vault.getAbstractFileByPath(outPath);
        const outFile = existing instanceof TFile
          ? (await this.app.vault.modify(existing, anchored), existing)
          : await this.app.vault.create(outPath, anchored);

        this.reconLibrary.removeForFile(outPath);
        this.reconLibrary.upsertMany(buildEntries(results, outPath, priorClass));
        this.refreshReconLibrary();

        const auto = results.filter((r) => r.status === "auto").length;
        new Notice(`照合完了: ${results.length}件（auto ${auto} / 要確認 ${results.length - auto}）— 照合ライブラリに追加`);
        await this.app.workspace.getLeaf(false).openFile(outFile);
      },
    });

    // Cards + timestamp anchoring (DESIGN §11): turn reconciled spans into
    // fade-in cloze cards that link back to the transcript block + YouTube moment.
    this.addCommand({
      id: "generate-recon-cards",
      name: "Generate Timestamp-Anchored Cards from Notes",
      callback: async () => {
        const prep = await this.prepareReconcile();
        if (!prep) return;
        const { file, tFile, videoId, results } = prep;
        const written = await this.writeReconCards(file, tFile, videoId, results);
        if (!written) { new Notice("アンカー可能な照合スパンがありません（要確認のみ？）"); return; }
        new Notice(`カード生成: ${written.count}件${videoId ? "（YouTube リンク付き）" : "（原文リンクのみ）"}`);
        await this.app.workspace.getLeaf(false).openFile(written.outFile);
      },
    });

    // Desktop-only: download MP3 clips for the reconciled spans (DESIGN §12 Tier 1).
    this.addCommand({
      id: "download-recon-audio-clips",
      name: "Download Audio Clips for Reconciled Notes (desktop, yt-dlp)",
      callback: () => this.downloadReconClips(),
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
    this.addRibbonIcon("languages", "JP Collocations", () => this.openLexiconView());
    this.addRibbonIcon("book-open", "JP Dictionary", () => this.openDictionaryView());
    this.addRibbonIcon("search", "X Search", () => this.openXView());
    this.addRibbonIcon("library", "照合ライブラリ", () => this.openReconLibrary());

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
    this.scraper?.abort();
    this.twcScraper?.abort();
    this.app.workspace.detachLeavesOfType(JP_COLLOCATIONS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(JP_DICTIONARY_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(JP_X_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(JP_RECON_LIBRARY_VIEW_TYPE);
  }

  // ── X Search wiring ──────────────────────────────────────────

  /** Assemble the dependency bundle the X search view needs. */
  private makeXDeps(): XViewDeps {
    return {
      corpus: this.xCorpus,
      client: this.xClient,
      getSettings: () => this.settings.x,
      saveSettings: () => this.saveSettings(),
      onSaveCollocation: (surface, example, sourceUrl) => {
        const id = `x-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        void this.addEntryFromSurfer({
          id,
          surface,
          capturedAt: new Date().toISOString(),
          exampleSentences: [{ text: example, source: `x:${sourceUrl}` }],
        });
      },
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

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
    const f = this.app.vault.getAbstractFileByPath(entry.file);
    if (f instanceof TFile) {
      const md = await this.app.vault.read(f);
      const next = retypeInMarkdown(md, entry.blockId, cls);
      if (next !== md) await this.app.vault.modify(f, next);
    }
    this.reconLibrary.setClass(entry.blockId, cls);
  }

  /** Shared reconcile prep for the cards + clip commands. Shows a Notice and
   *  returns null on any failure so callers just `if (!prep) return`. */
  private async prepareReconcile(): Promise<{ file: TFile; tFile: TFile; videoId: string | null; results: ReconciledResult[] } | null> {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice("ノートファイルを開いてください"); return null; }
    const content = await this.app.vault.cachedRead(file);
    const src = frontmatterSource(content);
    if (!src) { new Notice("frontmatter に `source: [[transcript]]` を追加してください"); return null; }
    const tFile = this.app.metadataCache.getFirstLinkpathDest(src, file.path);
    if (!tFile) { new Notice(`文字起こしが見つかりません: ${src}`); return null; }
    const tContent = await this.app.vault.cachedRead(tFile);
    const lines = parseTranscriptLines(tContent);
    if (!lines.length) { new Notice("文字起こしに行が見つかりません（字幕なし？）"); return null; }
    const notes = extractNotePhrases(content);
    if (!notes.length) { new Notice("照合するメモが見つかりません"); return null; }
    const results = reconcile(notes, lines, makeDictionaryReadingResolver(this.dictStore));
    return { file, tFile, videoId: this.resolveVideoId(file, tFile, tContent, content), results };
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
    return parseYouTubeId(typeof idField === "string" ? idField : null);
  }

  /** Build + write the `-cards.md` file (DESIGN §11). `freshClips` are clip
   *  basenames just written to disk that Obsidian may not have indexed yet, so
   *  the embed resolves immediately after a download. Returns null if no cards. */
  private async writeReconCards(
    file: TFile, tFile: TFile, videoId: string | null, results: ReconciledResult[], freshClips?: Set<string>,
  ): Promise<{ outFile: TFile; count: number } | null> {
    const anchoredFile = file.path.replace(/\.md$/, "") + "-reconciled.md";
    const classMap = this.reconLibrary.classMapForFile(anchoredFile);
    // A clip counts as present if we just wrote it OR Obsidian already indexed it.
    const localExists = (name: string) =>
      (freshClips?.has(name) ?? false) || !!this.app.metadataCache.getFirstLinkpathDest(name, "");
    const cards = buildReconCards(results, anchoredFile, blockIdFor, {
      videoId,
      transcriptRef: `[[${tFile.basename}]]`,
      audio: deepLinkProvider(localExists),
      classOf: (id) => classMap.get(id),
    });
    if (!cards.length) return null;
    const out = renderCardsFile(cards, { transcriptRef: `[[${tFile.basename}]]`, sourceLabel: tFile.basename });
    const outPath = file.path.replace(/\.md$/, "") + "-cards.md";
    const existing = this.app.vault.getAbstractFileByPath(outPath);
    const outFile = existing instanceof TFile
      ? (await this.app.vault.modify(existing, out), existing)
      : await this.app.vault.create(outPath, out);
    return { outFile, count: cards.length };
  }

  /**
   * DESKTOP-ONLY: download an MP3 clip for each reconciled span via yt-dlp
   * (DESIGN §12 Tier 1), then AUTO-REGENERATE the cards so the clips embed in one
   * step. Opt-in + ToS-gated. Auto-detects yt-dlp/ffmpeg/deno. Never fakes success
   * — an empty/failed clip is reported, with the command for a manual run.
   */
  private async downloadReconClips(): Promise<void> {
    if (!Platform.isDesktopApp) { new Notice("音声クリップの取得はデスクトップ版のみ対応です。"); return; }
    const cfg = this.settings.audioExtraction;
    if (!cfg.enabled) { new Notice("設定 →「音声クリップ (yt-dlp)」を有効にしてください（yt-dlp/ffmpeg 必須・YouTube ToS 注意）。"); return; }

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) { new Notice("ローカルファイルシステムが利用できません。"); return; }

    const prep = await this.prepareReconcile();
    if (!prep) return;
    const { file, tFile, videoId } = prep;
    if (!videoId) { new Notice("YouTube 動画 ID が必要です。文字起こしの frontmatter に `video: <URL>` を追加してください。"); return; }

    const timed = prep.results.filter((r) => r.status === "auto" && r.best && r.tStartSec != null);
    if (!timed.length) { new Notice("ダウンロード対象（auto かつ時刻付き）の照合スパンがありません。"); return; }

    // Fill any blank tool paths from auto-detection.
    const det = detectTools();
    const active = {
      ...cfg,
      ytdlpPath: cfg.ytdlpPath || det.ytdlp,
      ffmpegPath: cfg.ffmpegPath || det.ffmpeg,
      jsRuntime: cfg.jsRuntime || det.jsRuntime,
    };

    const folder = normalizePath(cfg.outputFolder || "JP Audio Clips");
    if (!this.app.vault.getAbstractFileByPath(folder)) { try { await this.app.vault.createFolder(folder); } catch { /* exists */ } }
    const base = adapter.getBasePath();

    new Notice(`音声クリップを取得中… ${timed.length}件（yt-dlp）`);
    const present = new Set<string>();          // clip basenames now on disk (fresh or pre-existing)
    let done = 0, skipped = 0, failed = 0;
    const errors: string[] = [];
    for (const r of timed) {
      const req: ExtractRequest = { videoId, startSec: r.tStartSec as number };
      const name = clipNameFor(req, active);
      if (this.app.metadataCache.getFirstLinkpathDest(name, "")) { present.add(name); skipped++; continue; }
      const res = await extractClip(req, active, `${base}/${folder}/${name}`);
      if (res.ok) {
        present.add(name);
        done++;
      } else {
        failed++;
        if (errors.length < 3) errors.push(`${name}: ${res.error ?? ""}`);
        console.error("[jp-collocations] clip failed:", res.command, "\n", res.error, "\n", res.stderrTail);
      }
    }

    // Auto-regenerate the cards so the just-downloaded clips embed immediately
    // (passing `present` sidesteps Obsidian's async file-index lag).
    const written = await this.writeReconCards(file, tFile, videoId, prep.results, present);
    if (written) await this.app.workspace.getLeaf(false).openFile(written.outFile);

    const tail = errors.length ? `\n${errors.join("\n")}` : "";
    new Notice(
      `クリップ取得: ✓${done} / スキップ${skipped} / 失敗${failed}` +
      (written ? `\nカード更新: ${written.count}件（音声埋め込み済み）` : "") + tail,
      failed ? 12000 : 6000,
    );
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
