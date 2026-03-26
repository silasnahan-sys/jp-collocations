import { Modal, Notice, Setting } from "obsidian";
import type { App } from "obsidian";
import { PartOfSpeech, CollocationSource } from "../types.ts";
import type { CollocationEntry } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";
import type { ClassificationResult } from "../classifier/TextClassifier.ts";

export class ClassifyModal extends Modal {
  private result: ClassificationResult;
  private store: CollocationStore;
  private onSave: () => void;

  // Editable form state (pre-filled from classifier)
  private headword: string;
  private collocate: string;
  private fullPhrase: string;
  private headwordPOS: PartOfSpeech;
  private collocatePOS: PartOfSpeech;
  private pattern: string;
  private tags: string[];
  private notes: string;
  private frequency: number;

  constructor(
    app: App,
    result: ClassificationResult,
    store: CollocationStore,
    onSave: () => void,
  ) {
    super(app);
    this.result = result;
    this.store = store;
    this.onSave = onSave;

    // Initialise editable state from classifier result
    this.headword = result.headword;
    this.collocate = result.collocate;
    this.fullPhrase = result.fullPhrase;
    this.headwordPOS = result.headwordPOS;
    this.collocatePOS = result.collocatePOS;
    this.pattern = result.pattern;
    this.tags = [...result.tags];
    this.notes = result.notes;
    this.frequency = result.frequency;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jp-col-modal");
    contentEl.addClass("jp-col-classify-modal");

    // Title
    contentEl.createEl("h2", { text: "Classify Selected Text" });

    // Original text box
    const origBox = contentEl.createDiv("jp-col-classify-original");
    origBox.createEl("span", { text: "Selected: ", cls: "jp-col-classify-label" });
    origBox.createEl("strong", { text: this.result.originalText });

    // Normalised form (if different)
    if (this.result.normalisedText !== this.result.originalText) {
      const normBox = contentEl.createDiv("jp-col-classify-normalised");
      normBox.createEl("span", { text: "Standard form: ", cls: "jp-col-classify-label" });
      normBox.createEl("span", { text: this.result.normalisedText, cls: "jp-col-classify-norm-text" });
    }

    // Confidence bar
    const confRow = contentEl.createDiv("jp-col-classify-conf");
    confRow.createEl("span", { text: `Classification confidence: ${this.result.confidence}%`, cls: "jp-col-classify-label" });
    const bar = confRow.createDiv("jp-col-conf-bar");
    const fill = bar.createDiv("jp-col-conf-fill");
    fill.style.width = `${this.result.confidence}%`;
    fill.style.backgroundColor = this.result.confidence >= 70 ? "#4caf50"
      : this.result.confidence >= 40 ? "#ff9800" : "#f44336";

    contentEl.createEl("hr");

    // -----------------------------------------------------------------------
    // Editable fields
    // -----------------------------------------------------------------------
    new Setting(contentEl)
      .setName("Headword")
      .setDesc("Main entry word")
      .addText(t => t.setValue(this.headword).onChange(v => { this.headword = v; }));

    new Setting(contentEl)
      .setName("Collocate")
      .setDesc("Collocating element (particle + verb, etc.)")
      .addText(t => t.setValue(this.collocate).onChange(v => { this.collocate = v; }));

    new Setting(contentEl)
      .setName("Full Phrase")
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
      .setDesc("Grammar pattern (e.g. N+を+V)")
      .addText(t => t.setValue(this.pattern).onChange(v => { this.pattern = v; }));

    // Tag chips
    const tagSetting = new Setting(contentEl)
      .setName("Tags")
      .setDesc("Click to toggle; edit the text field to add more");

    const tagChipRow = contentEl.createDiv("jp-col-tag-chips");
    // Use a direct reference to the underlying input element to avoid type complexity
    let tagInputEl: HTMLInputElement | null = null;

    const renderChips = () => {
      tagChipRow.empty();
      for (const tag of this.tags) {
        const chip = tagChipRow.createEl("span", { text: tag, cls: "jp-col-tag-chip active" });
        chip.addEventListener("click", () => {
          this.tags = this.tags.filter(t => t !== tag);
          renderChips();
          if (tagInputEl) tagInputEl.value = this.tags.join(", ");
        });
      }
    };
    renderChips();

    tagSetting.addText(t => {
      tagInputEl = t.inputEl;
      t.setValue(this.tags.join(", ")).onChange(v => {
        this.tags = v.split(",").map(x => x.trim()).filter(Boolean);
        renderChips();
      });
    });

    new Setting(contentEl)
      .setName("Notes")
      .addTextArea(t => {
        t.setValue(this.notes).onChange(v => { this.notes = v; });
        t.inputEl.rows = 2;
      });

    new Setting(contentEl)
      .setName("Frequency / Importance")
      .setDesc("1–100")
      .addSlider(s => s.setLimits(1, 100, 1).setValue(this.frequency).setDynamicTooltip()
        .onChange(v => { this.frequency = v; }));

    // -----------------------------------------------------------------------
    // Buttons
    // -----------------------------------------------------------------------
    const btnRow = contentEl.createDiv("jp-col-modal-btns");

    const saveBtn = btnRow.createEl("button", { text: "Save Entry", cls: "mod-cta" });
    saveBtn.addEventListener("click", () => this.handleSave());

    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private handleSave(): void {
    const hw = this.headword.trim();
    const col = this.collocate.trim();
    if (!hw) {
      new Notice("Headword is required.");
      return;
    }
    const now = Date.now();
    const entry: CollocationEntry = {
      id: this.store.generateId(),
      headword: hw,
      headwordReading: "",
      collocate: col,
      fullPhrase: this.fullPhrase.trim() || (hw + col),
      headwordPOS: this.headwordPOS,
      collocatePOS: this.collocatePOS,
      pattern: this.pattern.trim(),
      exampleSentences: [this.result.originalText].filter(Boolean),
      source: CollocationSource.Classified,
      tags: this.tags,
      notes: this.notes.trim(),
      frequency: this.frequency,
      createdAt: now,
      updatedAt: now,
    };

    this.store.add(entry);
    new Notice(`Saved: ${entry.fullPhrase}`);
    this.onSave();
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
