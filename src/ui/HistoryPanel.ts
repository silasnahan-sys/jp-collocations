// ─── History Panel ───────────────────────────────────────────────────────────
// Tracks and displays the search history for the dictionary viewer.

import type { App } from "obsidian";

export interface HistoryEntry {
  query: string;
  timestamp: number;
}

const MAX_HISTORY = 100;

export class HistoryPanel {
  private history: HistoryEntry[] = [];
  private readonly storageKey = "yomitan-history";

  constructor(private readonly app: App) {}

  async load(): Promise<void> {
    try {
      const path = `${this.app.vault.configDir}/plugins/jp-collocations/${this.storageKey}.json`;
      if (await this.app.vault.adapter.exists(path)) {
        const raw = await this.app.vault.adapter.read(path);
        this.history = JSON.parse(raw) as HistoryEntry[];
      }
    } catch {
      this.history = [];
    }
  }

  async save(): Promise<void> {
    const path = `${this.app.vault.configDir}/plugins/jp-collocations/${this.storageKey}.json`;
    await this.app.vault.adapter.write(path, JSON.stringify(this.history, null, 2));
  }

  push(query: string): void {
    if (!query.trim()) return;
    // Deduplicate — move to front if already present
    this.history = this.history.filter(h => h.query !== query);
    this.history.unshift({ query, timestamp: Date.now() });
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(0, MAX_HISTORY);
    }
    this.save();
  }

  getAll(): HistoryEntry[] {
    return [...this.history];
  }

  clear(): void {
    this.history = [];
    this.save();
  }

  /** Render the history panel into the given container */
  renderPanel(container: HTMLElement, onQueryClick: (query: string) => void): void {
    container.empty();
    const all = this.getAll();
    if (all.length === 0) {
      const empty = container.createDiv({ cls: "mkd-panel-empty" });
      empty.createDiv({ cls: "mkd-panel-empty-icon", text: "🕐" });
      empty.createDiv({ cls: "mkd-panel-empty-text", text: "履歴がありません" });
      return;
    }

    const header = container.createDiv({ cls: "mkd-history-header" });
    header.createSpan({ text: "最近の検索" });
    header.createSpan({ cls: "mkd-history-clear", text: "全消去" }).addEventListener("click", () => {
      this.clear();
      this.renderPanel(container, onQueryClick);
    });

    for (const entry of all) {
      const row = container.createDiv({ cls: "mkd-history-row" });
      row.createSpan({ cls: "mkd-history-icon", text: "🕐" });
      row.createSpan({ cls: "mkd-history-query", text: entry.query });
      const date = new Date(entry.timestamp);
      row.createSpan({
        cls: "mkd-history-time",
        text: date.toLocaleDateString("ja-JP", { month: "short", day: "numeric" }),
      });
      row.addEventListener("click", () => onQueryClick(entry.query));
    }
  }
}
