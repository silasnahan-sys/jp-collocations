/**
 * LibraryView.ts — the reconciliation library sidebar (DESIGN §8.5).
 *
 * Lists anchored reconciliation callouts as block-EMBEDS (`![[file#^id]]`, never
 * copies — invariant #1), filterable by Big-5 class and by needs-review. Each
 * row lets you set the note's KIND (the Big-5 router) which rewrites the callout
 * keyword in the source Markdown and re-renders.
 */

import { ItemView, WorkspaceLeaf, MarkdownRenderer, Notice } from 'obsidian';
import type { ReconLibrary } from '../notes/recon-library.ts';
import type { LibraryEntry } from '../notes/annotate.ts';
import { NOTE_TYPES, NOTE_CLASSES, type NoteClass } from '../notes/note-types.ts';

export const JP_RECON_LIBRARY_VIEW_TYPE = 'jp-recon-library-view';

export interface LibraryViewDeps {
  library: ReconLibrary;
  /** Rewrite the callout class in the source file + persist, then resolve. */
  onRetype: (entry: LibraryEntry, cls: NoteClass) => Promise<void>;
  /** Open the source file at the callout block. */
  openBlock: (entry: LibraryEntry) => Promise<void>;
}

type Filter = 'all' | NoteClass | 'needs-review';

export class LibraryView extends ItemView {
  private filter: Filter = 'all';

  constructor(leaf: WorkspaceLeaf, private deps: LibraryViewDeps) {
    super(leaf);
  }

  getViewType(): string { return JP_RECON_LIBRARY_VIEW_TYPE; }
  getDisplayText(): string { return '照合ライブラリ'; }
  getIcon(): string { return 'library'; }

  async onOpen(): Promise<void> {
    this.render();
  }

  /** Called by the plugin after a reconciliation run to refresh. */
  refresh(): void {
    if (this.contentEl) this.render();
  }

  private matches(e: LibraryEntry): boolean {
    if (this.filter === 'all') return true;
    if (this.filter === 'needs-review') return e.status === 'needs-review';
    return e.noteClass === this.filter;
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('jp-recon-library');

    const entries = this.deps.library.all();
    const shown = entries.filter((e) => this.matches(e));

    // header
    const header = root.createDiv({ cls: 'jp-recon-header' });
    header.createEl('div', { text: `照合ライブラリ — ${entries.length}件`, cls: 'jp-recon-title' });

    // filter chips
    const chips = header.createDiv({ cls: 'jp-recon-chips' });
    const chip = (label: string, f: Filter, color?: string) => {
      const b = chips.createEl('button', { text: label });
      b.style.cssText = `font-size:11px;padding:2px 8px;margin:2px;border-radius:10px;cursor:pointer;border:1px solid var(--background-modifier-border);${
        this.filter === f ? `background:${color ?? 'var(--interactive-accent)'};color:#fff;` : 'background:transparent;'}`;
      b.onclick = () => { this.filter = f; this.render(); };
    };
    chip(`すべて ${entries.length}`, 'all');
    for (const c of NOTE_CLASSES) {
      const n = entries.filter((e) => e.noteClass === c).length;
      chip(`${NOTE_TYPES[c].emoji} ${n}`, c, NOTE_TYPES[c].color);
    }
    const nr = entries.filter((e) => e.status === 'needs-review').length;
    chip(`🔶 ${nr}`, 'needs-review', '#d9832b');

    if (!shown.length) {
      root.createEl('p', { text: entries.length ? '該当なし' : 'まだ照合ノートがありません。「Reconcile Notes Against Source Transcript」を実行してください。', cls: 'jp-recon-empty' });
      return;
    }

    const list = root.createDiv({ cls: 'jp-recon-list' });
    for (const e of shown) this.renderEntry(list, e);
  }

  private renderEntry(parent: HTMLElement, e: LibraryEntry): void {
    const def = NOTE_TYPES[e.noteClass];
    const card = parent.createDiv({ cls: 'jp-recon-card' });
    card.style.cssText = `border:1px solid var(--background-modifier-border);border-left:3px solid ${def.color};border-radius:6px;margin:6px 0;padding:8px;`;

    // top row: class picker + timestamp + open
    const top = card.createDiv();
    top.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px;';

    const select = top.createEl('select');
    select.style.cssText = 'font-size:11px;';
    for (const c of NOTE_CLASSES) {
      const opt = select.createEl('option', { text: `${NOTE_TYPES[c].emoji} ${NOTE_TYPES[c].label}`, value: c });
      if (c === e.noteClass) opt.selected = true;
    }
    select.onchange = async () => {
      try {
        await this.deps.onRetype(e, select.value as NoteClass);
        this.render();
      } catch (err) {
        new Notice(`種別変更に失敗: ${String(err)}`);
      }
    };

    const ts = top.createSpan({ text: e.tStartSec != null ? `~${Math.floor(e.tStartSec / 60)}:${String(e.tStartSec % 60).padStart(2, '0')}` : '' });
    ts.style.cssText = 'font-size:11px;color:var(--text-muted);font-family:var(--font-monospace);';
    if (e.status === 'needs-review') {
      const b = top.createSpan({ text: '🔶要確認' });
      b.style.cssText = 'font-size:10px;color:#d9832b;';
    }
    const open = top.createEl('button', { text: '↪ 原文' });
    open.style.cssText = 'font-size:10px;margin-left:auto;cursor:pointer;';
    open.onclick = () => this.deps.openBlock(e).catch((err) => new Notice(String(err)));

    // block embed (reference, not a copy)
    const embed = card.createDiv({ cls: 'jp-recon-embed' });
    void MarkdownRenderer.render(this.app, `![[${e.file}#^${e.blockId}]]`, embed, e.file, this);
  }
}
