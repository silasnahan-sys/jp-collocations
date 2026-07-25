/**
 * XSaveModals — the two save flows out of the X search view.
 *
 * XSaveCollocationModal — build a collocation FROM a tweet: select runs of the
 * tweet text and add them as parts; parts join into a (possibly gapped)
 * surface like この…も…まで. Saves to the lexicon and/or a collection file.
 * This is the manual precursor of the planned note-type-assisted selection
 * (rhetorical collocations); assisted suggestions will pre-seed the same parts
 * list later.
 *
 * XCollectionPickerModal — choose (or create) a collection note and append a
 * canonical [!x-tweet] callout block to it. Collections are real vault files
 * (Philosophy.md, Lifting.md, …) under settings.x.collectionsFolder.
 */

import { Modal, Notice, Setting } from 'obsidian';
import type { App, TFile } from 'obsidian';
import type { XTweet } from '../x/x-types';
import type { XViewDeps } from './XSearchView';
import { formatTweetCallout, joinCollocationParts } from '../x/tweet-format';
import { listCollections, appendToCollection, safeCollectionName } from '../x/collections';

// ── Collection picker ────────────────────────────────────────

export class XCollectionPickerModal extends Modal {
  private deps: XViewDeps;
  private block: string;
  private onDone?: (file: TFile) => void;

  /** `block` is the markdown appended to whichever collection gets picked. */
  constructor(app: App, deps: XViewDeps, block: string, onDone?: (file: TFile) => void) {
    super(app);
    this.deps = deps;
    this.block = block;
    this.onDone = onDone;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('jp-x-modal');
    contentEl.createEl('h2', { text: '📚 コレクションに追加' });

    const s = this.deps.getSettings();
    const folder = s.collectionsFolder || 'JP Collections';
    contentEl.createEl('p', {
      text: `コレクションは「${folder}/」内の普通のノートです。追加した内容はそのファイルに書き込まれ、自由に編集できます。`,
      cls: 'jp-x-modal-desc',
    });

    const files = listCollections(this.app, folder);

    // Last-used collection pinned on top for one-tap re-save.
    const last = s.lastCollection;
    if (last && files.some(f => f.path === last)) {
      const btn = contentEl.createEl('button', {
        text: `⭐ ${last.split('/').pop()?.replace(/\.md$/, '')} に追加`,
        cls: 'jp-x-go-btn jp-x-collection-pin',
      });
      btn.addEventListener('click', () => void this.pick(last));
    }

    const list = contentEl.createDiv('jp-x-collection-list');
    if (files.length === 0) {
      list.createEl('p', {
        text: 'まだコレクションがありません。下で新規作成してください（例: 哲学 / 筋トレ / 語り口）。',
        cls: 'jp-x-modal-desc',
      });
    }
    for (const f of files) {
      const row = list.createEl('button', { cls: 'jp-x-collection-row' });
      row.createSpan({ text: f.basename, cls: 'jp-x-collection-name' });
      row.createSpan({
        text: f.path.slice(0, -3) === `${folder}/${f.basename}` ? '' : f.path,
        cls: 'jp-x-collection-path',
      });
      row.addEventListener('click', () => void this.pick(f.path));
    }

    // Create-new row.
    let newName = '';
    new Setting(contentEl)
      .setName('新しいコレクション')
      .setDesc('名前だけで OK（.md は自動）')
      .addText(t => {
        t.setPlaceholder('例: 哲学');
        t.onChange(v => { newName = v; });
        t.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); void this.createAndPick(newName, folder); }
        });
      })
      .addButton(b => b.setButtonText('作成して追加').setCta().onClick(() =>
        void this.createAndPick(newName, folder)));
  }

  private async createAndPick(name: string, folder: string): Promise<void> {
    const clean = safeCollectionName(name);
    if (!clean) { new Notice('コレクション名を入力してください'); return; }
    await this.pick(`${folder}/${clean}.md`);
  }

  private async pick(path: string): Promise<void> {
    try {
      const file = await appendToCollection(this.app, path, this.block);
      const s = this.deps.getSettings();
      s.lastCollection = file.path;
      await this.deps.saveSettings();
      const linkEl = new Notice(`✓ ${file.basename} に追加しました（タップで開く）`, 5000);
      linkEl.noticeEl.addEventListener('click', () => {
        void this.app.workspace.openLinkText(file.path, '', false);
      });
      this.onDone?.(file);
      this.close();
    } catch (e) {
      new Notice(`コレクションへの追加に失敗: ${(e as Error).message}`, 7000);
    }
  }

  onClose(): void { this.contentEl.empty(); }
}

// ── Save-collocation modal (selection parts) ─────────────────

export class XSaveCollocationModal extends Modal {
  private deps: XViewDeps;
  private tweet: XTweet;
  private parts: string[];
  private surfaceInput: HTMLInputElement | null = null;
  /** Once the user hand-edits the surface, stop auto-syncing it from parts. */
  private surfaceDirty = false;
  private partsEl: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;

  constructor(app: App, deps: XViewDeps, tweet: XTweet, seedParts: string[] = []) {
    super(app);
    this.deps = deps;
    this.tweet = tweet;
    this.parts = seedParts.map(p => p.trim()).filter(Boolean);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('jp-x-modal');
    contentEl.createEl('h2', { text: '💾 コロケーションを保存' });
    contentEl.createEl('p', {
      text: '本文を選択 → 「＋ 選択を追加」でパーツを積み上げます。離れた語も追加すれば この…も…まで のような飛び石コロケーションになります。',
      cls: 'jp-x-modal-desc',
    });

    // Selectable tweet text (real text, JP linebreaks preserved).
    this.textEl = contentEl.createDiv('jp-x-save-text');
    this.textEl.setText(this.tweet.text);

    // Add-part controls. mousedown+preventDefault keeps the user's text
    // selection alive through the button press (crucial on mobile).
    const addRow = contentEl.createDiv('jp-x-save-addrow');
    const addSelBtn = addRow.createEl('button', { text: '＋ 選択を追加', cls: 'jp-x-go-btn' });
    addSelBtn.addEventListener('mousedown', (e) => e.preventDefault());
    addSelBtn.addEventListener('click', () => {
      const sel = selectionWithin(this.textEl);
      if (!sel) { new Notice('本文の一部を選択してから押してください'); return; }
      this.addPart(sel);
    });
    const manual = addRow.createEl('input', {
      type: 'text', cls: 'jp-x-field-input',
      attr: { placeholder: '手入力で追加…', autocapitalize: 'off', spellcheck: 'false' },
    });
    manual.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && manual.value.trim()) {
        e.preventDefault();
        this.addPart(manual.value.trim());
        manual.value = '';
      }
    });

    this.partsEl = contentEl.createDiv('jp-x-chips jp-x-parts');

    // Surface (editable; auto-built from parts until hand-edited).
    const surfRow = contentEl.createDiv('jp-x-field jp-x-surface-row');
    surfRow.createSpan({ text: '見出し', cls: 'jp-x-field-label' });
    this.surfaceInput = surfRow.createEl('input', {
      type: 'text', cls: 'jp-x-field-input',
      attr: { placeholder: 'この…も…まで', autocapitalize: 'off', spellcheck: 'false' },
    });
    this.surfaceInput.addEventListener('input', () => { this.surfaceDirty = true; });

    const btnRow = contentEl.createDiv('jp-x-modal-btnrow');
    btnRow.createEl('button', { text: 'キャンセル', cls: 'jp-x-action-btn' })
      .addEventListener('click', () => this.close());
    const collBtn = btnRow.createEl('button', { text: '📚 コレクションへ', cls: 'jp-x-action-btn' });
    collBtn.addEventListener('click', () => this.saveToCollection());
    const saveBtn = btnRow.createEl('button', { text: '💾 辞書に保存', cls: 'jp-x-go-btn' });
    saveBtn.addEventListener('click', () => this.saveToLexicon());

    this.renderParts();
  }

  private surface(): string {
    return (this.surfaceInput?.value ?? '').trim();
  }

  private addPart(p: string): void {
    const clean = p.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (this.parts.includes(clean)) { new Notice('同じパーツが既にあります'); return; }
    this.parts.push(clean);
    this.renderParts();
  }

  private renderParts(): void {
    if (!this.partsEl) return;
    this.partsEl.empty();
    this.partsEl.style.display = this.parts.length ? 'flex' : 'none';
    this.parts.forEach((p, i) => {
      if (i > 0) this.partsEl!.createSpan({ text: '…', cls: 'jp-x-part-gap' });
      const chip = this.partsEl!.createSpan({ cls: 'jp-x-chip' });
      chip.createSpan({ text: p, cls: 'jp-x-chip-text' });
      const x = chip.createSpan({ text: '×', cls: 'jp-x-chip-x' });
      x.addEventListener('click', () => {
        this.parts.splice(i, 1);
        this.renderParts();
      });
    });
    if (!this.surfaceDirty && this.surfaceInput) {
      this.surfaceInput.value = joinCollocationParts(this.parts);
    }
  }

  private saveToLexicon(): void {
    const surface = this.surface();
    if (!surface) { new Notice('パーツを追加するか見出しを入力してください'); return; }
    this.deps.onSaveCollocation(surface, this.tweet.text, this.tweet.url, this.parts);
    new Notice(`💾 保存: ${surface}`);
    this.close();
  }

  private saveToCollection(): void {
    const surface = this.surface();
    const block = formatTweetCallout(this.tweet, {
      collocations: surface ? [surface] : [],
    });
    new XCollectionPickerModal(this.app, this.deps, block, () => {
      // Also record in the lexicon when a surface was built — one action, both homes.
      if (surface) this.deps.onSaveCollocation(surface, this.tweet.text, this.tweet.url, this.parts);
    }).open();
    this.close();
  }

  onClose(): void { this.contentEl.empty(); }
}

// ── Selection helper ─────────────────────────────────────────

/** The current text selection, iff it lives inside `el`. */
export function selectionWithin(el: HTMLElement | null): string {
  if (!el) return '';
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return '';
  const { anchorNode, focusNode } = sel;
  if (!anchorNode || !focusNode) return '';
  if (!el.contains(anchorNode) || !el.contains(focusNode)) return '';
  return sel.toString().trim();
}
