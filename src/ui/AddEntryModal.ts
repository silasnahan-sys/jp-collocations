import { Modal, Notice, Setting } from "obsidian";
import type { App } from "obsidian";
import type { CollocationEntry } from "../types.ts";
import { PartOfSpeech, CollocationSource } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";
import { detectPOS } from "../utils/grammar.ts";

export class AddEntryModal extends Modal {
  private store: CollocationStore;
  private onSave: () => void;
  private existing?: CollocationEntry;

  // Form state
  private headword = "";
  private headwordReading = "";
  private collocate = "";
  private fullPhrase = "";
  private headwordPOS: PartOfSpeech = PartOfSpeech.Noun;
  private collocatePOS: PartOfSpeech = PartOfSpeech.Verb;
  private pattern = "";
  private exampleSentences = "";
  private tags = "";
  private notes = "";
  private frequency = 50;

  constructor(app: App, store: CollocationStore, onSave: () => void, existing?: CollocationEntry) {
    super(app);
    this.store = store;
    this.onSave = onSave;
    this.existing = existing;
    if (existing) {
      this.headword = existing.headword;
      this.headwordReading = existing.headwordReading;
      this.collocate = existing.collocate;
      this.fullPhrase = existing.fullPhrase;
      this.headwordPOS = existing.headwordPOS;
      this.collocatePOS = existing.collocatePOS;
      this.pattern = existing.pattern;
      this.exampleSentences = existing.exampleSentences.join("\n");
      this.tags = existing.tags.join(", ");
      this.notes = existing.notes;
      this.frequency = existing.frequency;
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jp-col-modal");
    contentEl.createEl("h2", { text: this.existing ? "Edit Entry" : "Add Collocation Entry" });

    new Setting(contentEl)
      .setName("Headword *")
      .setDesc("Main word (e.g. 風)")
      .addText(t => t.setValue(this.headword).onChange(v => {
        this.headword = v;
        this.headwordPOS = detectPOS(v);
      }));

    new Setting(contentEl)
      .setName("Reading")
      .setDesc("Hiragana reading (e.g. かぜ)")
      .addText(t => t.setValue(this.headwordReading).onChange(v => { this.headwordReading = v; }));

    new Setting(contentEl)
      .setName("Collocate *")
      .setDesc("Collocating word/phrase (e.g. が吹く)")
      .addText(t => t.setValue(this.collocate).onChange(v => { this.collocate = v; }));

    new Setting(contentEl)
      .setName("Full Phrase")
      .setDesc("Complete phrase (auto-generated if empty)")
      .addText(t => t.setValue(this.fullPhrase).onChange(v => { this.fullPhrase = v; }));

    new Setting(contentEl)
      .setName("Headword POS")
      .addDropdown(d => {
        for (const pos of Object.values(PartOfSpeech)) d.addOption(pos, pos);
        d.setValue(this.headwordPOS).onChange(v => { this.headwordPOS = v as PartOfSpeech; });
      });

    new Setting(contentEl)
      .setName("Collocate POS")
      .addDropdown(d => {
        for (const pos of Object.values(PartOfSpeech)) d.addOption(pos, pos);
        d.setValue(this.collocatePOS).onChange(v => { this.collocatePOS = v as PartOfSpeech; });
      });

    new Setting(contentEl)
      .setName("Pattern")
      .setDesc("Grammar pattern (e.g. N+が+V)")
      .addText(t => t.setValue(this.pattern).onChange(v => { this.pattern = v; }));

    new Setting(contentEl)
      .setName("Example Sentences")
      .setDesc("One per line")
      .addTextArea(t => {
        t.setValue(this.exampleSentences).onChange(v => { this.exampleSentences = v; });
        t.inputEl.rows = 3;
      });

    new Setting(contentEl)
      .setName("Tags")
      .setDesc("Comma-separated tags")
      .addText(t => t.setValue(this.tags).onChange(v => { this.tags = v; }));

    new Setting(contentEl)
      .setName("Notes")
      .addTextArea(t => {
        t.setValue(this.notes).onChange(v => { this.notes = v; });
        t.inputEl.rows = 2;
      });

    new Setting(contentEl)
      .setName("Frequency")
      .setDesc("1-100 importance score")
      .addSlider(s => s.setLimits(1, 100, 1).setValue(this.frequency).setDynamicTooltip()
        .onChange(v => { this.frequency = v; }));

    const btnRow = contentEl.createDiv("jp-col-modal-btns");
    const saveBtn = btnRow.createEl("button", { text: this.existing ? "Save Changes" : "Add Entry", cls: "mod-cta" });
    saveBtn.addEventListener("click", () => this.handleSave());

    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private handleSave(): void {
    if (!this.headword.trim() || !this.collocate.trim()) {
      new Notice("Headword and Collocate are required.");
      return;
    }
    const now = Date.now();
    const phrase = this.fullPhrase.trim() || (this.headword + this.collocate);

    const entry: CollocationEntry = {
      id: this.existing?.id ?? this.store.generateId(),
      headword: this.headword.trim(),
      headwordReading: this.headwordReading.trim(),
      collocate: this.collocate.trim(),
      fullPhrase: phrase,
      headwordPOS: this.headwordPOS,
      collocatePOS: this.collocatePOS,
      pattern: this.pattern.trim(),
      exampleSentences: this.exampleSentences.split("\n").map(s => s.trim()).filter(Boolean),
      source: this.existing?.source ?? CollocationSource.Manual,
      tags: this.tags.split(",").map(t => t.trim()).filter(Boolean),
      notes: this.notes.trim(),
      frequency: this.frequency,
      createdAt: this.existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (this.existing) {
      this.store.update(entry);
      new Notice(`Updated: ${phrase}`);
    } else {
      this.store.add(entry);
      new Notice(`Added: ${phrase}`);
    }
    this.onSave();
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
