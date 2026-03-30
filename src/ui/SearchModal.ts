import { SuggestModal, Notice } from "obsidian";
import type { App } from "obsidian";
import type { CollocationEntry } from "../types.ts";
import { CollocationStrength } from "../types.ts";
import type { SearchEngine } from "../search/SearchEngine.ts";

const STRENGTH_SYMBOL: Record<CollocationStrength, string> = {
  [CollocationStrength.Weak]: "▱",
  [CollocationStrength.Moderate]: "▰▱",
  [CollocationStrength.Strong]: "▰▰▱",
  [CollocationStrength.Fixed]: "▰▰▰",
};

export class SearchModal extends SuggestModal<CollocationEntry> {
  private engine: SearchEngine;

  constructor(app: App, engine: SearchEngine) {
    super(app);
    this.engine = engine;
    this.setPlaceholder("Search Japanese collocations...");
    this.setInstructions([
      { command: "↑↓", purpose: "navigate" },
      { command: "↵", purpose: "insert into editor" },
      { command: "esc", purpose: "close" },
    ]);
  }

  getSuggestions(query: string): CollocationEntry[] {
    if (!query.trim()) {
      return this.engine.quickSearch("", 20).map(r => r.entry);
    }
    return this.engine.quickSearch(query, 20).map(r => r.entry);
  }

  renderSuggestion(entry: CollocationEntry, el: HTMLElement): void {
    const row = el.createDiv("jp-col-suggest-row");

    const left = row.createDiv("jp-col-suggest-left");
    left.createSpan({ cls: "jp-col-suggest-headword", text: entry.headword });
    if (entry.headwordReading) {
      left.createSpan({ cls: "jp-col-suggest-reading", text: `（${entry.headwordReading}）` });
    }
    left.createSpan({ cls: "jp-col-suggest-collocate", text: " " + entry.collocate });

    const right = row.createDiv("jp-col-suggest-right");
    right.createSpan({ cls: "jp-col-suggest-pos", text: entry.headwordPOS });
    if (entry.pattern) {
      right.createSpan({ cls: "jp-col-suggest-pattern", text: entry.pattern });
    }

    // Register badge
    if (entry.register) {
      right.createSpan({
        cls: `jp-col-badge jp-coll-register-${entry.register}`,
        text: entry.register,
      });
    }

    // JLPT badge
    if (entry.jlptLevel) {
      right.createSpan({
        cls: `jp-col-badge jp-coll-jlpt-${entry.jlptLevel.toLowerCase()}`,
        text: entry.jlptLevel,
      });
    }

    // Strength indicator
    if (entry.strength) {
      right.createSpan({
        cls: "jp-col-suggest-strength",
        text: STRENGTH_SYMBOL[entry.strength] ?? "",
        title: entry.strength,
      });
    }
  }

  onChooseSuggestion(entry: CollocationEntry): void {
    const editor = this.app.workspace.activeEditor?.editor;
    if (editor) {
      editor.replaceSelection(entry.fullPhrase);
      new Notice(`Inserted: ${entry.fullPhrase}`);
    } else {
      navigator.clipboard.writeText(entry.fullPhrase).then(() => {
        new Notice(`Copied: ${entry.fullPhrase}`);
      }).catch(() => {
        new Notice("No active editor. Clipboard copy failed.");
      });
    }
  }
}
