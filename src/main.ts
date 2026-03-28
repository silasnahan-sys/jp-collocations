import { Plugin, WorkspaceLeaf, Notice } from "obsidian";
import type { PluginSettings, CollocationEntry, DiscourseContext, DiscourseCategory, SurferCollocationEntry, CollocationMatch } from "./types.ts";
import { DEFAULT_SETTINGS, PartOfSpeech, CollocationSource } from "./types.ts";
import { CollocationStore } from "./data/CollocationStore.ts";
import { DiscourseStore } from "./data/DiscourseStore.ts";
import { SearchEngine } from "./search/SearchEngine.ts";
import { HyogenScraper } from "./scraper/HyogenScraper.ts";
import { CollocationView, JP_COLLOCATIONS_VIEW_TYPE } from "./ui/CollocationView.ts";
import { SearchModal } from "./ui/SearchModal.ts";
import { AddEntryModal } from "./ui/AddEntryModal.ts";
import { SettingsTab } from "./ui/SettingsTab.ts";
import { TextClassifier } from "./classifier/TextClassifier.ts";
import { ClassifyModal } from "./ui/ClassifyModal.ts";

export default class JPCollocationsPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  store!: CollocationStore;
  discourseStore!: DiscourseStore;
  engine!: SearchEngine;
  private scraper: HyogenScraper | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Data store
    const dataPath = `${this.app.vault.configDir}/plugins/jp-collocations/${this.settings.dataFilePath}`;
    this.store = new CollocationStore(this.app, dataPath);
    await this.store.load();

    // Discourse store
    const discourseDataPath = `${this.app.vault.configDir}/plugins/jp-collocations/discourse-index.json`;
    this.discourseStore = new DiscourseStore(this.app, discourseDataPath);
    await this.discourseStore.load();

    // Search engine
    this.engine = new SearchEngine(this.store);

    // Register view
    this.registerView(JP_COLLOCATIONS_VIEW_TYPE, leaf =>
      new CollocationView(leaf, this.store, this.engine, this.settings)
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

  // ── Bridge API (callable by jp-sentence-surfer) ───────────────────────────

  /**
   * Upsert a collocation entry originating from jp-sentence-surfer.
   * If an existing entry already matches the expression, it is updated
   * (examples, tags, reading, meaning merged); otherwise a new entry is
   * created.  Any discourse contexts carried by the entry are stored in the
   * DiscourseStore and linked to the returned collocation ID.
   * @returns The collocation ID (new or existing).
   */
  async addEntryFromSurfer(entry: SurferCollocationEntry): Promise<string> {
    const existing = this.store.getAll().find(
      e => e.fullPhrase === entry.expression || e.headword === entry.expression
    );

    let collocationId: string;

    if (existing) {
      collocationId = existing.id;
      const updated: CollocationEntry = { ...existing };
      if (entry.exampleSentence && !updated.exampleSentences.includes(entry.exampleSentence)) {
        updated.exampleSentences = [...updated.exampleSentences, entry.exampleSentence];
      }
      const newTags = entry.tags.filter(t => !updated.tags.includes(t));
      if (newTags.length > 0) updated.tags = [...updated.tags, ...newTags];
      if (entry.reading && !updated.headwordReading) updated.headwordReading = entry.reading;
      if (entry.meaning && !updated.notes) updated.notes = entry.meaning;
      this.store.update(updated);
    } else {
      collocationId = this.store.generateId();
      const newEntry: CollocationEntry = {
        id: collocationId,
        headword: entry.expression,
        headwordReading: entry.reading ?? "",
        collocate: "",
        fullPhrase: entry.expression,
        headwordPOS: PartOfSpeech.Expression,
        collocatePOS: PartOfSpeech.Other,
        pattern: "",
        exampleSentences: entry.exampleSentence ? [entry.exampleSentence] : [],
        source: CollocationSource.Import,
        tags: [...entry.tags],
        notes: entry.meaning ?? "",
        frequency: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.store.add(newEntry);
    }

    for (const ctx of entry.discourseContexts) {
      this.discourseStore.addContext(collocationId, ctx);
    }

    this.refreshViews();
    return collocationId;
  }

  /**
   * Attach a single DiscourseContext to an existing collocation entry.
   * Duplicate contexts (same chunkText + source file) are silently ignored.
   */
  async addDiscourseContext(collocationId: string, context: DiscourseContext): Promise<void> {
    this.discourseStore.addContext(collocationId, context);
  }

  /**
   * Append an example sentence (and its source citation) to an existing
   * collocation entry.  Duplicate sentences are silently ignored.
   */
  async saveExampleSentence(collocationId: string, sentence: string, source: string): Promise<void> {
    const entry = this.store.getById(collocationId);
    if (!entry) return;
    if (!entry.exampleSentences.includes(sentence)) {
      const updated: CollocationEntry = {
        ...entry,
        exampleSentences: [...entry.exampleSentences, sentence],
        notes: entry.notes || source,
      };
      this.store.update(updated);
    }
  }

  /**
   * Scan `text` for all known collocation expressions (fullPhrase and
   * headword) and return every match with its character offsets.
   * Overlapping matches at the same position and collocation ID are
   * deduplicated via a `collocationId:offset` key.
   */
  findCollocationsInText(text: string): CollocationMatch[] {
    const matches: CollocationMatch[] = [];
    const seen = new Set<string>();
    for (const entry of this.store.getAll()) {
      const phrases = [entry.fullPhrase, entry.headword].filter(Boolean);
      for (const phrase of phrases) {
        let start = 0;
        while (true) {
          const idx = text.indexOf(phrase, start);
          if (idx === -1) break;
          const key = `${entry.id}:${idx}`;
          if (!seen.has(key)) {
            seen.add(key);
            matches.push({
              collocationId: entry.id,
              expression: phrase,
              matchStart: idx,
              matchEnd: idx + phrase.length,
            });
          }
          start = idx + 1;
        }
      }
    }
    return matches;
  }

  /**
   * Return all collocation entries that have at least one DiscourseContext
   * whose markers include a marker with the given `surface` form (the
   * textual representation of the discourse marker, e.g. "でも", "つまり").
   */
  searchByDiscourseMarker(surface: string): SurferCollocationEntry[] {
    return this.discourseStore
      .getCollocationIdsByMarker(surface)
      .map(id => this.toSurferEntry(id))
      .filter((e): e is SurferCollocationEntry => e !== null);
  }

  /**
   * Return all collocation entries that appear in a DiscourseContext whose
   * markers belong to the given `category` (one of the 8 DiscourseCategory
   * values in the 談話文法 taxonomy, e.g. 'connective', 'filler').
   */
  searchByCategory(category: DiscourseCategory): SurferCollocationEntry[] {
    return this.discourseStore
      .getCollocationIdsByCategory(category)
      .map(id => this.toSurferEntry(id))
      .filter((e): e is SurferCollocationEntry => e !== null);
  }

  /**
   * Return every collocation entry in the store as SurferCollocationEntry
   * objects, each hydrated with its associated DiscourseContexts.
   */
  getAllEntries(): SurferCollocationEntry[] {
    return this.store
      .getAll()
      .map(e => this.toSurferEntry(e.id))
      .filter((e): e is SurferCollocationEntry => e !== null);
  }

  /**
   * Return aggregate statistics about stored discourse contexts:
   * - `markerFrequency`: count of contexts per marker surface form
   * - `categoryFrequency`: count of contexts per DiscourseCategory
   * - `totalContexts`: total number of stored context chunks
   */
  getDiscourseStats(): { markerFrequency: Record<string, number>; categoryFrequency: Record<string, number>; totalContexts: number } {
    return this.discourseStore.getStats();
  }

  private toSurferEntry(collocationId: string): SurferCollocationEntry | null {
    const entry = this.store.getById(collocationId);
    if (!entry) return null;
    return {
      expression: entry.fullPhrase || entry.headword,
      reading: entry.headwordReading || undefined,
      meaning: entry.notes || undefined,
      exampleSentence: entry.exampleSentences[0] ?? undefined,
      exampleSource: undefined,
      discourseContexts: this.discourseStore.getContextsByCollocation(collocationId),
      tags: [...entry.tags],
    };
  }
}
