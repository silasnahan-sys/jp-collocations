import { Plugin, WorkspaceLeaf, Notice } from "obsidian";
import type { PluginSettings } from "./types.ts";
import { DEFAULT_SETTINGS } from "./types.ts";
import { CollocationStore } from "./data/CollocationStore.ts";
import { SearchEngine } from "./search/SearchEngine.ts";
import { HyogenScraper } from "./scraper/HyogenScraper.ts";
import { CollocationView, JP_COLLOCATIONS_VIEW_TYPE } from "./ui/CollocationView.ts";
import { SearchModal } from "./ui/SearchModal.ts";
import { AddEntryModal } from "./ui/AddEntryModal.ts";
import { SettingsTab } from "./ui/SettingsTab.ts";
import { TextClassifier } from "./classifier/TextClassifier.ts";
import { ClassifyModal } from "./ui/ClassifyModal.ts";
import { DictionaryView, DICTIONARY_VIEW_TYPE } from "./ui/DictionaryView.ts";
import { DiscourseStore } from "./data/DiscourseStore.ts";
import { ContextStore } from "./data/ContextStore.ts";
import { DiscourseAnalyzer } from "./discourse/DiscourseAnalyzer.ts";
import { DiscourseCardView, DISCOURSE_CARD_VIEW_TYPE } from "./ui/DiscourseCardView.ts";
import { ContextLexiconView, CONTEXT_LEXICON_VIEW_TYPE } from "./ui/ContextLexiconView.ts";

export default class JPCollocationsPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  store!: CollocationStore;
  engine!: SearchEngine;
  private scraper: HyogenScraper | null = null;
  discourseStore!: DiscourseStore;
  contextStore!: ContextStore;
  private discourseAnalyzer: DiscourseAnalyzer = new DiscourseAnalyzer();

  async onload(): Promise<void> {
    await this.loadSettings();

    // Data store
    const dataPath = `${this.app.vault.configDir}/plugins/jp-collocations/${this.settings.dataFilePath}`;
    this.store = new CollocationStore(this.app, dataPath);
    await this.store.load();

    // Search engine
    this.engine = new SearchEngine(this.store);

    // Discourse store
    const discoursePath = `${this.app.vault.configDir}/plugins/jp-collocations/discourse-index.json`;
    this.discourseStore = new DiscourseStore(this.app, discoursePath);
    await this.discourseStore.load();

    // Context store
    this.contextStore = new ContextStore();

    // Register views
    this.registerView(JP_COLLOCATIONS_VIEW_TYPE, leaf =>
      new CollocationView(leaf, this.store, this.engine, this.settings)
    );

    this.registerView(DICTIONARY_VIEW_TYPE, leaf =>
      new DictionaryView(leaf, this.app)
    );

    this.registerView(DISCOURSE_CARD_VIEW_TYPE, leaf =>
      new DiscourseCardView(leaf)
    );

    this.registerView(CONTEXT_LEXICON_VIEW_TYPE, leaf =>
      new ContextLexiconView(leaf, this.contextStore)
    );

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
      id: "open-dictionary",
      name: "Open Dictionary",
      callback: () => this.openDictionaryView(),
    });

    this.addCommand({
      id: "open-discourse-cards",
      name: "Open Discourse Cards",
      callback: () => this.openDiscourseCardView(),
    });

    this.addCommand({
      id: "open-context-lexicon",
      name: "Open Context Lexicon",
      callback: () => this.openContextLexiconView(),
    });

    this.addCommand({
      id: "analyse-selected-discourse",
      name: "Analyse Selected Text (Discourse)",
      editorCallback: (editor) => {
        const selected = editor.getSelection();
        if (!selected || !selected.trim()) {
          new Notice("Select annotated text with || boundaries first!");
          return;
        }
        const graph = this.discourseAnalyzer.analyze(selected.trim());
        this.contextStore.ingestGraph(graph, "editor-selection");
        new Notice(`Analysed ${graph.bits.length} discourse bits.`);
        this.refreshContextViews();
      },
    });

    this.addCommand({
      id: "import-yomitan-dictionary",
      name: "Import Yomitan Dictionary",
      callback: () => this.importYomitanDictionary(),
    });

    this.addCommand({
      id: "fetch-hyogen",
      name: "Fetch from Hyogen",
      callback: () => this.fetchFromHyogen(),
    });

    // Ribbon icon
    this.addRibbonIcon("languages", "JP Collocations", () => this.openLexiconView());
  }

  async onunload(): Promise<void> {
    this.scraper?.abort();
    this.app.workspace.detachLeavesOfType(JP_COLLOCATIONS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(DICTIONARY_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(DISCOURSE_CARD_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(CONTEXT_LEXICON_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async openLexiconView(): Promise<void> {
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

  private async openDictionaryView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DICTIONARY_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: DICTIONARY_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  private async importYomitanDictionary(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(DICTIONARY_VIEW_TYPE);
    if (leaves.length === 0) {
      await this.openDictionaryView();
    }
    const leaf = this.app.workspace.getLeavesOfType(DICTIONARY_VIEW_TYPE)[0];
    if (leaf?.view instanceof DictionaryView) {
      (leaf.view as DictionaryView).importDictionary();
    }
  }

  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(JP_COLLOCATIONS_VIEW_TYPE)) {
      (leaf.view as CollocationView).refresh();
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

  private async openDiscourseCardView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DISCOURSE_CARD_VIEW_TYPE);
    if (existing.length > 0) { this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: DISCOURSE_CARD_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  private async openContextLexiconView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(CONTEXT_LEXICON_VIEW_TYPE);
    if (existing.length > 0) { this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: CONTEXT_LEXICON_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  private refreshContextViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(CONTEXT_LEXICON_VIEW_TYPE)) {
      (leaf.view as ContextLexiconView).refresh();
    }
  }

  // ─── Bridge API for jp-sentence-surfer ───────────────────────────────────
  /** Query stored discourse chunks. */
  queryDiscourseChunks(opts: Parameters<DiscourseStore["queryChunks"]>[0]) {
    return this.discourseStore.queryChunks(opts);
  }
  /** Count chunks by category. */
  getDiscourseCategoryCounts() {
    return this.discourseStore.countByCategory();
  }
  /** Get all stored chunks. */
  getAllDiscourseChunks() {
    return this.discourseStore.exportAll();
  }
  /** Analyse raw annotated text and ingest into context store. */
  analyseDiscourseText(text: string, source?: string) {
    const graph = this.discourseAnalyzer.analyze(text, undefined, source);
    this.contextStore.ingestGraph(graph, source ?? "bridge");
    return graph;
  }
  /** Get context bits by category. */
  getContextBitsByCategory(category: import("./types.ts").DiscourseCategory) {
    return this.contextStore.getByCategory(category);
  }
  /** Get context bits by speaker. */
  getContextBitsBySpeaker(speaker: string) {
    return this.contextStore.getBySpeaker(speaker);
  }
  /** Get total discourse store size. */
  getDiscourseStoreSize() {
    return this.discourseStore.size();
  }
  /** Get total context store size. */
  getContextStoreSize() {
    return this.contextStore.size();
  }
}
