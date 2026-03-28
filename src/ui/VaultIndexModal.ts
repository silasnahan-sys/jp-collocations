import { Modal, Setting, Notice, ButtonComponent } from "obsidian";
import type { App } from "obsidian";
import type { CollocationStore } from "../data/CollocationStore.ts";
import type { PluginSettings } from "../types.ts";
import { VaultIndexer } from "../data/VaultIndexer.ts";

export class VaultIndexModal extends Modal {
  private store: CollocationStore;
  private settings: PluginSettings;
  private onComplete: () => void;
  private wordListInput: HTMLTextAreaElement | null = null;
  private useAllHeadwords = false;
  private progressEl: HTMLElement | null = null;
  private startBtn: ButtonComponent | null = null;
  private indexer: VaultIndexer | null = null;
  private running = false;

  constructor(
    app: App,
    store: CollocationStore,
    settings: PluginSettings,
    onComplete: () => void
  ) {
    super(app);
    this.store = store;
    this.settings = settings;
    this.onComplete = onComplete;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jp-vault-index-modal");

    contentEl.createEl("h2", { text: "Vault Indexer — Index Vault for Collocations" });
    contentEl.createEl("p", {
      text: "Scans every note in your vault for occurrences of target words and auto-generates collocation entries.",
      cls: "jp-vault-index-desc",
    });

    // Word list option
    new Setting(contentEl)
      .setName("Use all lexicon headwords")
      .setDesc("Index every headword already in the lexicon. If off, provide a custom word list below.")
      .addToggle(t => {
        t.setValue(false).onChange(v => {
          this.useAllHeadwords = v;
          if (this.wordListInput) {
            this.wordListInput.disabled = v;
            this.wordListInput.style.opacity = v ? "0.4" : "1";
          }
        });
      });

    contentEl.createEl("p", { text: "Custom word list (one word per line):", cls: "jp-vault-index-label" });
    this.wordListInput = contentEl.createEl("textarea", { cls: "jp-vault-index-wordlist" });
    this.wordListInput.rows = 6;
    this.wordListInput.placeholder = "日本語\n英語\n...";

    // Settings
    new Setting(contentEl)
      .setName("Skip already-indexed words")
      .setDesc("Skip words that already have entries sourced from vault indexing.")
      .addToggle(t => t.setValue(this.settings.vaultIndexSkipIndexed).onChange(v => {
        this.settings.vaultIndexSkipIndexed = v;
      }));

    new Setting(contentEl)
      .setName("Max sentences per word")
      .setDesc("Maximum number of example sentences to import per word.")
      .addSlider(s =>
        s.setLimits(1, 50, 1)
          .setValue(this.settings.vaultIndexMaxSentencesPerWord)
          .setDynamicTooltip()
          .onChange(v => { this.settings.vaultIndexMaxSentencesPerWord = v; })
      );

    // Progress
    this.progressEl = contentEl.createDiv({ cls: "jp-vault-index-progress" });
    this.progressEl.hide();

    // Buttons
    const btnRow = contentEl.createDiv({ cls: "jp-vault-index-btn-row" });
    new ButtonComponent(btnRow)
      .setButtonText("Cancel")
      .onClick(() => {
        if (this.running && this.indexer) this.indexer.abort();
        this.close();
      });
    this.startBtn = new ButtonComponent(btnRow)
      .setButtonText("Start Indexing")
      .setCta()
      .onClick(() => this.startIndexing());
  }

  private async startIndexing(): Promise<void> {
    if (this.running) return;

    const useAll = this.useAllHeadwords;
    let words: string[];

    if (useAll) {
      words = Array.from(new Set(this.store.getAll().map(e => e.headword))).filter(Boolean);
    } else {
      const raw = this.wordListInput?.value ?? "";
      words = raw.split("\n").map(w => w.trim()).filter(Boolean);
    }

    if (words.length === 0) {
      new Notice("No words to index. Please enter a word list or toggle 'use all headwords'.");
      return;
    }

    this.running = true;
    this.startBtn?.setDisabled(true);
    this.startBtn?.setButtonText("Indexing…");
    this.progressEl?.show();
    this.progressEl!.setText(`Starting — scanning ${this.app.vault.getMarkdownFiles().length} notes…`);

    this.indexer = new VaultIndexer(this.app, this.store, this.settings);
    try {
      const result = await this.indexer.indexVault(words, p => {
        this.progressEl?.setText(
          `[${p.wordIndex + 1}/${p.totalWords}] ${p.word} — ${p.sentencesFound} entries added so far…`
        );
      });

      this.onComplete();
      new Notice(
        `✅ Vault indexing complete.\n${result.entriesAdded} entries added from ${result.filesScanned} files.`,
        6000
      );
      this.close();
    } catch (e) {
      new Notice("Vault indexing failed: " + String(e));
      this.running = false;
      this.startBtn?.setDisabled(false);
      this.startBtn?.setButtonText("Start Indexing");
    }
  }

  onClose(): void {
    if (this.running && this.indexer) this.indexer.abort();
    this.contentEl.empty();
  }
}
