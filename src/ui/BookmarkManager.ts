// ─── Bookmark Manager ────────────────────────────────────────────────────────
// Manages saved (bookmarked) dictionary entries in Obsidian plugin storage.

import type { App } from "obsidian";
import type { TermEntry } from "../yomitan/types.ts";

export interface Bookmark {
  id: string;
  entry: TermEntry;
  savedAt: number;
  folder?: string;
}

export class BookmarkManager {
  private bookmarks: Bookmark[] = [];
  private readonly storageKey = "yomitan-bookmarks";

  constructor(private readonly app: App) {}

  async load(): Promise<void> {
    try {
      const pluginDir = `${this.app.vault.configDir}/plugins/jp-collocations`;
      const path = `${pluginDir}/${this.storageKey}.json`;
      if (await this.app.vault.adapter.exists(path)) {
        const raw = await this.app.vault.adapter.read(path);
        this.bookmarks = JSON.parse(raw) as Bookmark[];
      }
    } catch {
      this.bookmarks = [];
    }
  }

  async save(): Promise<void> {
    const pluginDir = `${this.app.vault.configDir}/plugins/jp-collocations`;
    const path = `${pluginDir}/${this.storageKey}.json`;
    await this.app.vault.adapter.write(path, JSON.stringify(this.bookmarks, null, 2));
  }

  add(entry: TermEntry, folder?: string): Bookmark {
    const existing = this.findByEntry(entry);
    if (existing) return existing;
    const bm: Bookmark = {
      id: `bm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      entry,
      savedAt: Date.now(),
      folder,
    };
    this.bookmarks.push(bm);
    this.save();
    return bm;
  }

  remove(id: string): void {
    this.bookmarks = this.bookmarks.filter(b => b.id !== id);
    this.save();
  }

  getAll(): Bookmark[] {
    return [...this.bookmarks].sort((a, b) => b.savedAt - a.savedAt);
  }

  findByEntry(entry: TermEntry): Bookmark | undefined {
    return this.bookmarks.find(
      b => b.entry.term === entry.term && b.entry.dictionary === entry.dictionary,
    );
  }

  isBookmarked(entry: TermEntry): boolean {
    return !!this.findByEntry(entry);
  }

  /** Render the bookmarks panel into the given container */
  renderPanel(container: HTMLElement, onEntryClick: (entry: TermEntry) => void): void {
    container.empty();
    const all = this.getAll();
    if (all.length === 0) {
      const empty = container.createDiv({ cls: "mkd-panel-empty" });
      empty.createDiv({ cls: "mkd-panel-empty-icon", text: "🔖" });
      empty.createDiv({ cls: "mkd-panel-empty-text", text: "しおりがありません" });
      return;
    }
    for (const bm of all) {
      const row = container.createDiv({ cls: "mkd-bookmark-row" });
      const info = row.createDiv({ cls: "mkd-bookmark-info" });
      info.createSpan({ cls: "mkd-bookmark-term", text: bm.entry.term });
      info.createSpan({ cls: "mkd-bookmark-dict", text: bm.entry.dictionary });
      row.createSpan({ cls: "mkd-bookmark-remove", text: "✕" }).addEventListener("click", (e) => {
        e.stopPropagation();
        this.remove(bm.id);
        row.remove();
      });
      row.addEventListener("click", () => onEntryClick(bm.entry));
    }
  }
}
