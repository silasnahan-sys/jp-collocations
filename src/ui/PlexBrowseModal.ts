/**
 * PlexBrowseModal — pick an episode from the Plex library (DESIGN §25.4).
 *
 * The Plex integration used to have exactly one way in: whatever is playing
 * RIGHT NOW, fuzzy-matched against the open note's title. That makes the
 * plugin's TV support conditional on standing in front of the TV — you could
 * not prepare an episode, revisit last night's, or work from a phone. This is
 * the other door.
 *
 * All Plex knowledge stays in `notes/plex.ts`; all transport stays in main.ts.
 * The modal is handed four fetchers and an action, and knows only that items
 * have titles and that some of them contain others.
 */

import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import { episodeLabel, playableItems, type PlexItem, type PlexItemsResult } from '../notes/plex.ts';

export interface PlexBrowseDeps {
  /** library sections (TV / films). */
  sections: () => Promise<PlexItemsResult>;
  /** everything in a section. */
  sectionItems: (key: string) => Promise<PlexItemsResult>;
  /** every episode under a show, flat — seasons are a level you rarely want. */
  episodes: (ratingKey: string) => Promise<PlexItemsResult>;
  /** server-side search across the library. */
  search: (query: string) => Promise<PlexItemsResult>;
  /** the point of the whole thing: subtitle → transcript note. */
  openEpisode: (item: PlexItem) => Promise<string>;
}

interface Level {
  label: string;
  load: () => Promise<PlexItemsResult>;
}

export class PlexBrowseModal extends Modal {
  private stack: Level[] = [];
  private listEl!: HTMLElement;
  private crumbEl!: HTMLElement;
  private searchEl!: HTMLInputElement;
  private token = 0;

  constructor(app: App, private deps: PlexBrowseDeps) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('jp-plexbrowse');
    contentEl.createEl('h3', { text: '📺 Plex から選ぶ' });

    const searchRow = contentEl.createDiv('jp-plexbrowse-search');
    this.searchEl = searchRow.createEl('input', {
      type: 'text',
      attr: { placeholder: '作品名で検索（空欄なら一覧）', enterkeyhint: 'search' },
    });
    let debounce: number | null = null;
    this.searchEl.addEventListener('input', () => {
      if (debounce != null) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        const q = this.searchEl.value.trim();
        if (!q) { this.reset(); return; }
        // A search REPLACES the stack: it is a new starting point, not a step
        // deeper, so Back from a search result returns to the library root.
        this.stack = [{ label: `「${q}」`, load: () => this.deps.search(q) }];
        void this.paint();
      }, 350);
    });

    this.crumbEl = contentEl.createDiv('jp-plexbrowse-crumb');
    this.listEl = contentEl.createDiv('jp-plexbrowse-list');
    this.reset();
    window.setTimeout(() => this.searchEl.focus(), 0);
  }

  onClose(): void { this.contentEl.empty(); }

  private reset(): void {
    this.stack = [{ label: 'ライブラリ', load: () => this.deps.sections() }];
    void this.paint();
  }

  private async paint(): Promise<void> {
    const mine = ++this.token;
    const level = this.stack[this.stack.length - 1];

    this.crumbEl.empty();
    this.stack.forEach((l, i) => {
      if (i) this.crumbEl.createSpan({ text: ' › ', cls: 'jp-plexbrowse-sep' });
      const isLast = i === this.stack.length - 1;
      const c = this.crumbEl.createSpan({
        text: l.label,
        cls: 'jp-plexbrowse-crumb-item' + (isLast ? ' is-current' : ''),
      });
      if (!isLast) {
        c.onclick = () => { this.stack = this.stack.slice(0, i + 1); void this.paint(); };
      }
    });

    this.listEl.empty();
    this.listEl.createDiv({ text: '読み込み中…', cls: 'jp-plexbrowse-empty' });
    const res = await level.load();
    if (mine !== this.token) return;              // superseded by a newer click
    this.listEl.empty();

    if (!res.ok) {
      this.listEl.createDiv({ text: res.error, cls: 'jp-plexbrowse-error' });
      return;
    }
    // Sections come back as directories; content as metadata. Keep the ones
    // that lead somewhere, in a stable, readable order.
    const items = this.stack.length === 1 && this.searchEl.value.trim() === ''
      ? res.items.filter((i) => i.type === 'show' || i.type === 'movie' || !!i.key)
      : playableItems(res.items).length ? playableItems(res.items) : res.items;

    if (!items.length) {
      this.listEl.createDiv({ text: '該当なし', cls: 'jp-plexbrowse-empty' });
      return;
    }
    for (const item of items) this.renderRow(item);
  }

  private renderRow(item: PlexItem): void {
    const isEpisode = item.type === 'episode' || item.type === 'movie';
    const row = this.listEl.createDiv('jp-plexbrowse-row' + (isEpisode ? ' is-leaf' : ''));
    const main = row.createDiv('jp-plexbrowse-main');
    main.createDiv({
      text: isEpisode ? episodeLabel(item) : item.title,
      cls: 'jp-plexbrowse-title',
    });
    const sub: string[] = [];
    if (item.grandparentTitle && isEpisode) sub.push(item.grandparentTitle);
    if (item.year) sub.push(String(item.year));
    if (item.leafCount != null) sub.push(`${item.leafCount}話`);
    if (sub.length) main.createDiv({ text: sub.join(' · '), cls: 'jp-plexbrowse-sub' });

    row.onclick = async () => {
      if (isEpisode) {
        row.addClass('is-busy');
        const label = row.createSpan({ text: ' 取得中…', cls: 'jp-plexbrowse-busy' });
        try {
          const msg = await this.deps.openEpisode(item);
          // The notice carries the outcome; closing on success gets the modal
          // out of the way of the note that just opened.
          if (/トランスクリプト/.test(msg)) this.close();
          else label.setText('');
        } catch (e) {
          new Notice(String(e instanceof Error ? e.message : e), 10000);
          label.setText('');
        } finally {
          row.removeClass('is-busy');
        }
        return;
      }
      // a section → its contents; a show → its episodes, flat
      const next: Level = item.ratingKey && item.type === 'show'
        ? { label: item.title, load: () => this.deps.episodes(item.ratingKey!) }
        : item.key
          ? { label: item.title, load: () => this.deps.sectionItems(item.key!) }
          : { label: item.title, load: async () => ({ ok: true, items: [] }) };
      this.stack.push(next);
      void this.paint();
    };
  }
}
