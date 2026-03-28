import { Modal, Setting, Notice } from "obsidian";
import type { App } from "obsidian";
import type { CollocationStore } from "../data/CollocationStore.ts";
import type { VaultIndexResult } from "../types.ts";
import { VaultIndexer } from "../indexer/VaultIndexer.ts";

export class VaultIndexModal extends Modal {
  private store: CollocationStore;
  private onComplete: (result: VaultIndexResult) => void;
  private indexer: VaultIndexer | null = null;

  // UI references
  private wordInput!: HTMLTextAreaElement;
  private useAllChecked = false;
  private skipExistingChecked = true;
  private maxPerWordInput!: HTMLInputElement;
  private statusEl!: HTMLElement;
  private runBtn!: HTMLButtonElement;
  private cancelBtn!: HTMLButtonElement;
  private resultsEl!: HTMLElement;

  constructor(
    app: App,
    store: CollocationStore,
    onComplete: (result: VaultIndexResult) => void,
  ) {
    super(app);
    this.store = store;
    this.onComplete = onComplete;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jp-vault-index-modal");

    contentEl.createEl("h2", { text: "Vault-Wide Indexing" });
    contentEl.createEl("p", {
      text: "Scan every note in your vault for occurrences of Japanese words, " +
        "automatically generating collocation entries with source context.",
      cls: "jp-vault-index-desc",
    });

    // ── Target words ─────────────────────────────────────────────────────────
    const wordSection = contentEl.createDiv("jp-vault-index-section");
    wordSection.createEl("label", {
      text: "Target words (one per line)",
      cls: "jp-vault-index-label",
    });
    this.wordInput = wordSection.createEl("textarea", {
      cls: "jp-vault-index-textarea",
    });
    this.wordInput.placeholder = "e.g.\nそもそも\n構造\n面白い";
    this.wordInput.rows = 5;

    // ── Options ───────────────────────────────────────────────────────────────
    const optionsSection = contentEl.createDiv("jp-vault-index-section");

    new Setting(optionsSection)
      .setName("Use all lexicon headwords")
      .setDesc("Ignore the word list above and index every headword already in the lexicon")
      .addToggle(t => {
        t.setValue(false).onChange(v => {
          this.useAllChecked = v;
          this.wordInput.disabled = v;
          this.wordInput.style.opacity = v ? "0.4" : "1";
        });
      });

    new Setting(optionsSection)
      .setName("Skip already-indexed words")
      .setDesc("Do not re-index headwords that already have vault-index entries")
      .addToggle(t => {
        t.setValue(true).onChange(v => { this.skipExistingChecked = v; });
      });

    new Setting(optionsSection)
      .setName("Max sentences per word")
      .setDesc("Stop collecting context for a word after this many sentences (1–100)")
      .addText(t => {
        this.maxPerWordInput = t.inputEl;
        t.setValue("20");
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.inputEl.max = "100";
        t.inputEl.style.width = "5rem";
      });

    // ── Status ───────────────────────────────────────────────────────────────
    this.statusEl = contentEl.createDiv({ cls: "jp-vault-index-status" });

    // ── Results ──────────────────────────────────────────────────────────────
    this.resultsEl = contentEl.createDiv({ cls: "jp-vault-index-results" });

    // ── Buttons ──────────────────────────────────────────────────────────────
    const btnRow = contentEl.createDiv("jp-vault-index-btn-row");

    this.runBtn = btnRow.createEl("button", {
      text: "Start Indexing",
      cls: "mod-cta jp-vault-index-run-btn",
    });
    this.runBtn.addEventListener("click", () => this.startIndexing());

    this.cancelBtn = btnRow.createEl("button", {
      text: "Cancel",
      cls: "jp-vault-index-cancel-btn",
    });
    this.cancelBtn.style.display = "none";
    this.cancelBtn.addEventListener("click", () => this.cancelIndexing());
  }

  onClose(): void {
    this.indexer?.abort();
    const { contentEl } = this;
    contentEl.empty();
  }

  private async startIndexing(): Promise<void> {
    const useAll = this.useAllChecked;
    const skipExisting = this.skipExistingChecked;
    const maxPerWord = Math.max(1, Math.min(100, parseInt(this.maxPerWordInput.value, 10) || 20));

    let targetWords: string[] | undefined;
    if (!useAll) {
      const raw = this.wordInput.value.split("\n")
        .map(w => w.trim())
        .filter(w => w.length > 0);
      if (raw.length === 0) {
        new Notice("Please enter at least one target word, or enable 'Use all lexicon headwords'.");
        return;
      }
      targetWords = raw;
    }

    // UI state: running
    this.runBtn.disabled = true;
    this.runBtn.textContent = "Indexing…";
    this.cancelBtn.style.display = "";
    this.statusEl.empty();
    this.resultsEl.empty();
    this.setStatus("Starting…");

    this.indexer = new VaultIndexer(this.app, this.store);

    try {
      const result = await this.indexer.run(
        { targetWords, skipExisting, maxPerWord },
        msg => this.setStatus(msg),
      );
      this.renderResults(result);
      this.onComplete(result);
    } catch (err) {
      this.setStatus(`Error: ${String(err)}`);
      console.error("[JP Collocations] Vault indexer error:", err);
    } finally {
      this.runBtn.disabled = false;
      this.runBtn.textContent = "Start Indexing";
      this.cancelBtn.style.display = "none";
      this.indexer = null;
    }
  }

  private cancelIndexing(): void {
    this.indexer?.abort();
    this.setStatus("Cancelling…");
    this.cancelBtn.disabled = true;
  }

  private setStatus(msg: string): void {
    this.statusEl.empty();
    this.statusEl.createSpan({ text: msg, cls: "jp-vault-index-status-text" });
  }

  private renderResults(result: VaultIndexResult): void {
    this.resultsEl.empty();
    if (result.added === 0) {
      this.resultsEl.createEl("p", {
        text: "No new entries were added.",
        cls: "jp-vault-index-result-empty",
      });
      return;
    }

    this.resultsEl.createEl("h4", { text: "Indexing complete", cls: "jp-vault-index-result-title" });

    const ul = this.resultsEl.createEl("ul", { cls: "jp-vault-index-result-list" });
    ul.createEl("li", { text: `Notes scanned: ${result.scanned}` });
    ul.createEl("li", { text: `Sentence matches: ${result.matches}` });
    ul.createEl("li", { text: `New entries added: ${result.added}` });

    if (result.words.length > 0) {
      ul.createEl("li", { text: `Words processed: ${result.words.join("、")}` });
    }
  }
}
