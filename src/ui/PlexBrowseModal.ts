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
import { episodeLabel, playableItems, sortPlexItems, watchState, type PlexItem, type PlexItemsResult } from '../notes/plex.ts';
import { fmtDur } from '../notes/srt.ts';

export interface PlexBrowseDeps {
  /** library sections (TV / films). */
  sections: () => Promise<PlexItemsResult>;
  /** everything in a section. */
  sectionItems: (key: string) => Promise<PlexItemsResult>;
  /** every episode under a show, flat — seasons are a level you rarely want. */
  episodes: (ratingKey: string) => Promise<PlexItemsResult>;
  /** server-side search across the library. */
  search: (query: string) => Promise<PlexItemsResult>;
  /** So the browser can flag episodes already transcribed, before the click. */
  hasTranscript?: (ratingKey: string) => boolean;
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
  /** keyboard cursor into the visible rows (§23.5). */
  private focusIdx = -1;

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
    // §23.5 same keyboard hand as every other list surface: j/k walks, ⏎ opens,
    // ⌫ goes back up a level. Twenty-six episodes is a lot of mouse travel.
    this.scope.register([], 'ArrowDown', () => { this.walk(1); return false; });
    this.scope.register([], 'ArrowUp', () => { this.walk(-1); return false; });
    contentEl.addEventListener('keydown', (e) => this.onKey(e));
    const hints = contentEl.createDiv('jp-dm-keys jp-plexbrowse-keys');
    for (const [key, label] of [['j/k', '移動'], ['⏎', '開く'], ['⌫', '戻る']] as const) {
      const chip = hints.createSpan('jp-dm-key');
      chip.createEl('kbd', { text: key });
      chip.createSpan({ text: label });
    }
    this.reset();
    window.setTimeout(() => this.searchEl.focus(), 0);
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // ⌫ in an empty search box means "up a level", not "delete nothing".
    if (e.key === 'Backspace' && (!typing || !this.searchEl.value)) {
      if (this.stack.length > 1) { e.preventDefault(); this.stack.pop(); void this.paint(); }
      return;
    }
    if (typing) {
      if (e.key === 'Enter' && this.focusIdx >= 0) { e.preventDefault(); this.activate(); }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'j' || k === 'k') { e.preventDefault(); this.walk(k === 'j' ? 1 : -1); return; }
    if (e.key === 'Enter') { e.preventDefault(); this.activate(); }
  }

  private rows(): HTMLElement[] {
    return Array.from(this.listEl.querySelectorAll<HTMLElement>('.jp-plexbrowse-row'));
  }

  private walk(delta: number): void {
    const rows = this.rows();
    if (!rows.length) return;
    const from = this.focusIdx ?? -1;
    const next = Math.max(0, Math.min(rows.length - 1,
      from < 0 ? (delta > 0 ? 0 : rows.length - 1) : from + delta));
    rows.forEach((r) => r.removeClass('is-focus'));
    rows[next].addClass('is-focus');
    rows[next].scrollIntoView({ block: 'nearest' });
    this.focusIdx = next;
  }

  private activate(): void {
    this.rows()[this.focusIdx ?? -1]?.click();
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
    const raw = this.stack.length === 1 && this.searchEl.value.trim() === ''
      ? res.items.filter((i) => i.type === 'show' || i.type === 'movie' || !!i.key)
      : playableItems(res.items).length ? playableItems(res.items) : res.items;
    // /allLeaves comes back in library-scan order, which interleaves seasons and
    // puts episode 10 before episode 2.
    const items = sortPlexItems(raw);

    if (!items.length) {
      this.listEl.createDiv({ text: '該当なし', cls: 'jp-plexbrowse-empty' });
      return;
    }
    // Season dividers, so a three-season show reads as three seasons.
    let season: number | null = null;
    for (const item of items) {
      if (item.type === 'episode' && item.parentIndex != null && item.parentIndex !== season) {
        season = item.parentIndex;
        this.listEl.createDiv({ text: `シーズン ${season}`, cls: 'jp-plexbrowse-season' });
      }
      this.renderRow(item);
    }
    this.focusIdx = -1;
  }

  private renderRow(item: PlexItem): void {
    const isEpisode = item.type === 'episode' || item.type === 'movie';
    const row = this.listEl.createDiv('jp-plexbrowse-row' + (isEpisode ? ' is-leaf' : ''));
    const main = row.createDiv('jp-plexbrowse-main');
    const titleRow = main.createDiv('jp-plexbrowse-title');
    titleRow.createSpan({
      text: isEpisode ? episodeLabel(item) : item.title,
      cls: 'jp-plexbrowse-titletext',
    });
    /**
     * §25.4 — the two things worth knowing before you click: have I already made
     * a transcript from this, and have I already watched it. Without the first,
     * picking an episode you already did costs a round trip that ends in
     * 「既にあります」 — an avoidable dead end, and the most common one here.
     */
    if (isEpisode && item.ratingKey && this.deps.hasTranscript?.(item.ratingKey)) {
      const flag = titleRow.createSpan({ text: '📄', cls: 'jp-plexbrowse-flag is-have' });
      flag.title = 'このエピソードのトランスクリプトは既にあります（開きます）';
    }
    const seen = isEpisode ? watchState(item) : null;
    if (seen) {
      const flag = titleRow.createSpan({
        text: seen === 'seen' ? '✓' : '◐',
        cls: 'jp-plexbrowse-flag is-' + seen,
      });
      flag.title = seen === 'seen' ? '視聴済み' : `途中（${fmtDur(item.viewOffsetSec || 0)}）`;
    }
    const sub: string[] = [];
    if (item.grandparentTitle && isEpisode) sub.push(item.grandparentTitle);
    if (item.year) sub.push(String(item.year));
    if (item.leafCount != null) sub.push(`${item.leafCount}話`);
    if (isEpisode && item.durationSec) sub.push(fmtDur(item.durationSec));
    if (sub.length) main.createDiv({ text: sub.join(' · '), cls: 'jp-plexbrowse-sub' });

    row.onclick = async () => {
      if (isEpisode) {
        row.addClass('is-busy');
        const label = row.createSpan({ text: ' 取得中…', cls: 'jp-plexbrowse-busy' });
        try {
          const msg = await this.deps.openEpisode(item);
          // The notice carries the outcome; closing on success gets the modal
          // out of the way of the note that just opened. 📺 marks every
          // outcome that took over the screen — a created note, an existing
          // one reopened, or the jimaku picker now waiting for a choice.
          if (msg.startsWith('📺')) this.close();
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
