import { Plugin, WorkspaceLeaf, Notice } from "obsidian";
import type { PluginSettings, SurferCollocationEntry, DiscourseContext, CollocationMatch, DiscourseStats } from "./types.ts";
import { DEFAULT_SETTINGS, PartOfSpeech, CollocationSource } from "./types.ts";
import { CollocationStore } from "./data/CollocationStore.ts";
import { DiscourseStore } from "./data/DiscourseStore.ts";
import { VaultIndexer } from "./data/VaultIndexer.ts";
import { SearchEngine } from "./search/SearchEngine.ts";
import { HyogenScraper } from "./scraper/HyogenScraper.ts";
import { CollocationView, JP_COLLOCATIONS_VIEW_TYPE } from "./ui/CollocationView.ts";
import { SearchModal } from "./ui/SearchModal.ts";
import { AddEntryModal } from "./ui/AddEntryModal.ts";
import { SettingsTab } from "./ui/SettingsTab.ts";
import { TextClassifier } from "./classifier/TextClassifier.ts";
import { ClassifyModal } from "./ui/ClassifyModal.ts";
import { VaultIndexModal } from "./ui/VaultIndexModal.ts";
import { DiscourseStatsView, DISCOURSE_STATS_VIEW_TYPE } from "./ui/DiscourseStatsView.ts";
import {
  GrammarBrowserView, GRAMMAR_BROWSER_VIEW_TYPE,
  ConnectionMapView, CONNECTION_MAP_VIEW_TYPE,
  FormVariationsView, FORM_VARIATIONS_VIEW_TYPE,
  SourceContextView, SOURCE_CONTEXT_VIEW_TYPE,
} from "./ui/MultiViews.ts";

export default class JPCollocationsPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  store!: CollocationStore;
  discourseStore!: DiscourseStore;
  engine!: SearchEngine;
  private scraper: HyogenScraper | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Data store
    const pluginDir = `${this.app.vault.configDir}/plugins/jp-collocations`;
    const dataPath = `${pluginDir}/${this.settings.dataFilePath}`;
    this.store = new CollocationStore(this.app, dataPath);
    await this.store.load();

    // Discourse store
    const discoursePath = `${pluginDir}/${this.settings.discourseIndexPath}`;
    this.discourseStore = new DiscourseStore(
      this.app,
      discoursePath,
      this.settings.maxContextsPerCollocation
    );
    await this.discourseStore.load();

    // Search engine
    this.engine = new SearchEngine(this.store);

    // Register views
    this.registerView(JP_COLLOCATIONS_VIEW_TYPE, leaf =>
      new CollocationView(leaf, this.store, this.engine, this.settings, this.discourseStore)
    );
    this.registerView(DISCOURSE_STATS_VIEW_TYPE, leaf =>
      new DiscourseStatsView(leaf, this.discourseStore)
    );
    this.registerView(GRAMMAR_BROWSER_VIEW_TYPE, leaf =>
      new GrammarBrowserView(leaf, this.store, this.engine, this.settings)
    );
    this.registerView(CONNECTION_MAP_VIEW_TYPE, leaf =>
      new ConnectionMapView(leaf, this.store)
    );
    this.registerView(FORM_VARIATIONS_VIEW_TYPE, leaf =>
      new FormVariationsView(leaf, this.store)
    );
    this.registerView(SOURCE_CONTEXT_VIEW_TYPE, leaf =>
      new SourceContextView(leaf, this.store)
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
      id: "fetch-hyogen",
      name: "Fetch from Hyogen",
      callback: () => this.fetchFromHyogen(),
    });

    this.addCommand({
      id: "index-vault",
      name: "Index Vault for Collocations",
      callback: () => {
        new VaultIndexModal(this.app, this.store, this.settings, () => this.refreshViews()).open();
      },
    });

    this.addCommand({
      id: "open-discourse-stats",
      name: "Open Discourse Statistics",
      callback: () => this.openView(DISCOURSE_STATS_VIEW_TYPE),
    });

    this.addCommand({
      id: "open-grammar-browser",
      name: "Open Grammar Browser",
      callback: () => this.openView(GRAMMAR_BROWSER_VIEW_TYPE),
    });

    this.addCommand({
      id: "open-connection-map",
      name: "Open Connection Map",
      callback: () => this.openView(CONNECTION_MAP_VIEW_TYPE),
    });

    // Ribbon icon
    this.addRibbonIcon("languages", "JP Collocations", () => this.openLexiconView());
  }

  async onunload(): Promise<void> {
    this.scraper?.abort();
    this.app.workspace.detachLeavesOfType(JP_COLLOCATIONS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(DISCOURSE_STATS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(GRAMMAR_BROWSER_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(CONNECTION_MAP_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(FORM_VARIATIONS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(SOURCE_CONTEXT_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ── Bridge API — callable by jp-sentence-surfer via ──────────────
  // app.plugins.plugins['jp-collocations'].<method>()
  // ─────────────────────────────────────────────────────────────────

  /**
   * Add or update a collocation entry received from jp-sentence-surfer.
   */
  addEntryFromSurfer(entry: SurferCollocationEntry): string {
    const existing = this.store.getByHeadword(entry.expression);
    if (existing.length > 0) {
      // Update example sentence on first match if provided
      const e = { ...existing[0] };
      if (entry.exampleSentence && !e.exampleSentences.includes(entry.exampleSentence)) {
        e.exampleSentences = [entry.exampleSentence, ...e.exampleSentences].slice(0, 5);
        e.updatedAt = Date.now();
        this.store.update(e);
      }
      // Add any new discourse contexts
      for (const ctx of entry.discourseContexts) {
        this.discourseStore.addContext(ctx, [e.id]);
      }
      this.refreshViews();
      return e.id;
    }

    const { CollocationSource: CS, PartOfSpeech: POS } = { CollocationSource, PartOfSpeech };
    const now = Date.now();
    const newEntry = {
      id: this.store.generateId(),
      headword: entry.expression,
      headwordReading: entry.reading ?? "",
      collocate: "",
      fullPhrase: entry.expression,
      headwordPOS: POS.Expression,
      collocatePOS: POS.Other,
      pattern: "surfer-import",
      exampleSentences: entry.exampleSentence ? [entry.exampleSentence] : [],
      source: CS.Import,
      tags: entry.tags,
      notes: entry.meaning ?? "",
      frequency: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.store.add(newEntry);

    for (const ctx of entry.discourseContexts) {
      this.discourseStore.addContext(ctx, [newEntry.id]);
    }

    this.refreshViews();
    return newEntry.id;
  }

  /**
   * Attach a single DiscourseContext to a collocation entry by ID.
   */
  addDiscourseContext(collocationId: string, context: DiscourseContext): string | null {
    const chunkId = this.discourseStore.addContext(context, [collocationId]);
    if (chunkId) this.refreshViews();
    return chunkId;
  }

  /**
   * Save or update the example sentence for a collocation entry.
   */
  saveExampleSentence(collocationId: string, sentence: string, source?: string): boolean {
    const entry = this.store.getById(collocationId);
    if (!entry) return false;
    const updated = { ...entry };
    if (!updated.exampleSentences.includes(sentence)) {
      updated.exampleSentences = [sentence, ...updated.exampleSentences].slice(0, 5);
    }
    if (source && !updated.notes.includes(source)) {
      updated.notes = updated.notes ? updated.notes + "\n" + source : source;
    }
    this.store.update(updated);
    return true;
  }

  /**
   * Find all collocation entries whose headword or fullPhrase appears in text.
   */
  findCollocationsInText(text: string): CollocationMatch[] {
    const matches: CollocationMatch[] = [];
    for (const entry of this.store.getAll()) {
      const needle = entry.fullPhrase || entry.headword;
      let idx = 0;
      while ((idx = text.indexOf(needle, idx)) !== -1) {
        matches.push({
          collocationId: entry.id,
          expression: needle,
          matchStart: idx,
          matchEnd: idx + needle.length,
        });
        idx += needle.length;
      }
    }
    return matches.sort((a, b) => a.matchStart - b.matchStart);
  }

  /**
   * Search discourse chunks by marker surface form.
   */
  searchByDiscourseMarker(surface: string) {
    return this.discourseStore.getChunksByMarker(surface);
  }

  /**
   * Search discourse chunks by category.
   */
  searchByCategory(category: string) {
    return this.discourseStore.getChunksByCategory(category);
  }

  /**
   * Return all collocation entries.
   */
  getAllEntries() {
    return this.store.getAll();
  }

  /**
   * Return discourse statistics.
   */
  getDiscourseStats(): DiscourseStats {
    return this.discourseStore.getStats();
  }

  // ── Private helpers ──────────────────────────────────────────────

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

  private async openView(viewType: string): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(viewType);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: viewType, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(JP_COLLOCATIONS_VIEW_TYPE)) {
      (leaf.view as CollocationView).refresh();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(DISCOURSE_STATS_VIEW_TYPE)) {
      (leaf.view as DiscourseStatsView).refresh();
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
}
