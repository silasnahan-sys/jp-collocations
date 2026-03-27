import { Plugin, WorkspaceLeaf, Notice } from "obsidian";
import type { PluginSettings } from "./types.ts";
import { DEFAULT_SETTINGS } from "./types.ts";
import { CollocationStore } from "./data/CollocationStore.ts";
import { ContextStore } from "./data/ContextStore.ts";
import { SearchEngine } from "./search/SearchEngine.ts";
import { HyogenScraper } from "./scraper/HyogenScraper.ts";
import { CollocationView, JP_COLLOCATIONS_VIEW_TYPE } from "./ui/CollocationView.ts";
import { SearchModal } from "./ui/SearchModal.ts";
import { AddEntryModal } from "./ui/AddEntryModal.ts";
import { SettingsTab } from "./ui/SettingsTab.ts";
import { TextClassifier } from "./classifier/TextClassifier.ts";
import { ClassifyModal } from "./ui/ClassifyModal.ts";
import { DiscourseAnalyzer } from "./discourse/DiscourseAnalyzer.ts";
import { VaultIndexer } from "./data/VaultIndexer.ts";

export default class JPCollocationsPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  store!: CollocationStore;
  contextStore!: ContextStore;
  engine!: SearchEngine;
  private scraper: HyogenScraper | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Data store
    const dataPath = `${this.app.vault.configDir}/plugins/jp-collocations/${this.settings.dataFilePath}`;
    this.store = new CollocationStore(this.app, dataPath);
    await this.store.load();

    // Context store (discourse grammar / context chunks)
    const contextPath = `${this.app.vault.configDir}/plugins/jp-collocations/${this.settings.contextDataFilePath}`;
    this.contextStore = new ContextStore(this.app, contextPath);
    await this.contextStore.load();

    // Search engine
    this.engine = new SearchEngine(this.store);

    // Register view
    this.registerView(JP_COLLOCATIONS_VIEW_TYPE, leaf =>
      new CollocationView(leaf, this.store, this.engine, this.settings, this.contextStore)
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
      id: "create-discourse-card",
      name: "Create Discourse Card from Selection",
      editorCallback: (editor) => {
        const selected = editor.getSelection();
        if (!selected || selected.trim().length === 0) {
          new Notice("Select some transcript/text first!");
          return;
        }
        this.createDiscourseChunk(selected.trim(), null);
      },
    });

    this.addCommand({
      id: "index-phrase-vault",
      name: "Index Selected Phrase across Vault",
      editorCallback: async (editor) => {
        const selected = editor.getSelection();
        if (!selected || selected.trim().length === 0) {
          new Notice("Select a phrase to index first!");
          return;
        }
        const phrase = selected.trim();
        new Notice(`Indexing "${phrase}" across vault…`);
        const indexer = new VaultIndexer(this.app, this.contextStore, this.settings.contextRadius);
        const count = await indexer.indexPhrase(phrase, null);
        new Notice(`Found ${count} occurrences. Created context entries.`);
        this.refreshViews();
      },
    });

    // Ribbon icon
    this.addRibbonIcon("languages", "JP Collocations", () => this.openLexiconView());
  }

  async onunload(): Promise<void> {
    this.scraper?.abort();
    this.app.workspace.detachLeavesOfType(JP_COLLOCATIONS_VIEW_TYPE);
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

  private createDiscourseChunk(text: string, collocationId: string | null): void {
    const analyzer = new DiscourseAnalyzer();
    const analysis = analyzer.analyse(text);

    const chunk = {
      id: this.contextStore.generateId("chunk"),
      rawText: text,
      bits: analysis.bits,
      relations: analysis.relations,
      sourceFile: this.app.workspace.getActiveFile()?.path ?? "unknown",
      selectedPhrase: text.length > 40 ? text.slice(0, 40) + "…" : text,
      createdAt: Date.now(),
    };
    this.contextStore.addChunk(chunk);

    // Create a context entry
    const formattedMarkdown = analyzer.formatChunkMarkdown(text, chunk.selectedPhrase, analysis.bits);
    const entry = {
      id: this.contextStore.generateId("ctx"),
      collocationId,
      chunkId: chunk.id,
      highlightedBitIds: analysis.bits.map(b => b.id),
      formattedMarkdown,
      tags: Array.from(new Set([
        ...analysis.bits.filter(b => b.category).map(b => b.category!),
        ...analysis.bits.flatMap(b => b.functions.map(f => String(f))),
      ])),
      createdAt: Date.now(),
    };
    this.contextStore.addEntry(entry);

    new Notice(`Created discourse chunk with ${analysis.bits.length} bits and ${analysis.relations.length} connections.`);
    this.refreshViews();
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
