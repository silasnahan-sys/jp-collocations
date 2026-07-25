/**
 * TrayView — the 収集トレイ (§22.8): a narrow, Stage-Manager-shaped drop
 * target. Anything flicked from any app lands as an unprocessed card —
 * quarantine like sweep candidates: nothing enters the catalog without
 * classification, nothing dropped is ever lost.
 *
 * Per-kind cards (content-aware, shaped on arrival by inbox.ts):
 *   dialogue — turns with speaker chips; tap a TURN to classify it with the
 *              other turns + speakers as real context (scene-complete)
 *   sentence / word / text — 🏷️ classify (TokenCanvas renders over it)
 *   url — open + classify-with-provenance
 *   image — thumbnail + open (OCR arrives with the manga stage, §22.9)
 */

import { ItemView, WorkspaceLeaf, Notice, normalizePath } from 'obsidian';
import type { InboxStore, InboxCard, ReadingSession, MarkRef } from '../notes/inbox.ts';
import { shapeDrop, imageCard, sessionGroups } from '../notes/inbox.ts';
import { fmtStamp } from '../notes/srt.ts';
import type { CaptureContext } from './CaptureModal.ts';
import { NOTE_TYPES, type NoteClass } from '../notes/note-types.ts';
import { classBadge, applyClassRail } from './class-grammar.ts';

export const JP_TRAY_VIEW_TYPE = 'jp-tray-view';

export interface TrayDeps {
  store: InboxStore;
  openCapture: (ctx: CaptureContext) => void;
  /** save a dropped image into the vault; returns its path. */
  saveImage: (name: string, data: ArrayBuffer) => Promise<string>;
  /** §22.2 manga: OCR an image card's bubbles (absent = no API key). */
  ocrManga?: (vaultPath: string) => Promise<Array<{ text: string; bbox: [number, number, number, number] }>>;
  /** §25.3 podcast: recognize a player screenshot → converts the image card
   *  to a precise mark card (main owns the vision call + episode match). */
  recognizePlayer?: (card: InboxCard) => Promise<void>;
  /** §25.1 harvest: re-manifest a mark's moment as capture context (reads
   *  the transcript at tSec). Null = file/moment unresolvable. */
  resolveMarkContext?: (mark: MarkRef) => Promise<CaptureContext | null>;
  /** §28 S1: catalog patterns occurring in this card's text — "you have
   *  already noticed this", wearing the same class mark as everywhere else. */
  patternsIn?: (text: string) => Array<{ id: string; key: string; class: NoteClass; classRatified?: boolean }>;
  /** §28 S4: the door back into the lexicon. */
  openPattern?: (id: string) => void;
}

export class TrayView extends ItemView {
  /** §23.5 keyboard hand: focused card id (j/k walk). */
  private focusId: string | null = null;

  constructor(leaf: WorkspaceLeaf, private deps: TrayDeps) {
    super(leaf);
  }

  getViewType(): string { return JP_TRAY_VIEW_TYPE; }
  getDisplayText(): string { return '収集トレイ'; }
  getIcon(): string { return 'inbox'; }

  async onOpen(): Promise<void> {
    this.contentEl.setAttr('tabindex', '0');
    this.registerDomEvent(this.contentEl, 'keydown', (e) => this.onKey(e));
    this.render();
  }

  /** The on-screen card order (§25.7): the feed interleaves 読書セッション
   *  groups (at their newest shot's position, cards in shot order) with the
   *  other cards newest-first — so j/k walks what the eye sees. */
  private visibleOrder(): InboxCard[] {
    const all = this.deps.store.all();
    const groups = sessionGroups(all);
    const items: Array<{ at: number; cards: InboxCard[] }> = groups.map((g) => ({ at: g.end, cards: g.cards }));
    for (const c of all) {
      if (c.kind !== 'image') items.push({ at: c.createdAt, cards: [c] });
    }
    items.sort((a, b) => b.at - a.at);
    return items.flatMap((i) => i.cards);
  }

  // §23.5: j/k walk cards, ⏎/e classify, x/Delete remove — same verbs as the
  // other surfaces, hints visible in the header row.
  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const cards = this.visibleOrder();
    if (!cards.length) return;
    const cur = Math.max(0, cards.findIndex((c) => c.id === this.focusId));
    const k = e.key.toLowerCase();
    const go = (fn: () => unknown) => { e.preventDefault(); void fn(); };
    if (k === 'j' || k === 'k') {
      return go(() => {
        const next = Math.max(0, Math.min(cards.length - 1, cur + (k === 'j' ? 1 : -1)));
        this.focusId = cards[next].id;
        this.render();
        this.contentEl.querySelector('.jp-tray-card--focus')?.scrollIntoView({ block: 'nearest' });
      });
    }
    const c = cards[cur];
    if (!c) return;
    if (k === 'x' || e.key === 'Delete' || e.key === 'Backspace') {
      return go(async () => { await this.deps.store.remove(c.id); this.focusId = null; this.render(); });
    }
    if (k === 'e' || e.key === 'Enter') {
      return go(() => {
        // the card's primary classify action (first turn/bubble for dialogue)
        const card = this.contentEl.querySelector<HTMLElement>('.jp-tray-card--focus');
        const btn = card?.querySelector<HTMLElement>('.jp-tray-classify') ?? card?.querySelector<HTMLElement>('.jp-tray-turn');
        if (btn) btn.click();
      });
    }
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('jp-tray');

    // ── the drop zone ──
    const zone = root.createDiv('jp-tray-zone');
    zone.createDiv({ text: '⤵', cls: 'jp-tray-zone-icon' });
    zone.createDiv({ text: 'ここにドロップ', cls: 'jp-tray-zone-label' });
    zone.createDiv({ text: 'マンガのコマ・辞書の用例・ツイート・記事の一節 — 何でも。落としたものは失われません。', cls: 'jp-tray-zone-sub' });
    const zoneBtns = zone.createDiv('jp-tray-zone-btns');
    const pasteBtn = zoneBtns.createEl('button', { text: '📋 クリップボードから', cls: 'jp-tray-paste' });
    pasteBtn.onclick = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text.trim()) { new Notice('クリップボードが空です'); return; }
        await this.addText(text);
      } catch { new Notice('クリップボードを読めませんでした'); }
    };
    // §25.7 session ingest: one visit to the photo picker, multi-select the
    // evening's screenshots. No Shortcuts, no setup — the picker is the path.
    const pickBtn = zoneBtns.createEl('button', { text: '📷 スクショ取り込み', cls: 'jp-tray-paste' });
    const picker = zone.createEl('input', { type: 'file', attr: { accept: 'image/*', multiple: 'true' } });
    picker.style.display = 'none';
    picker.onchange = async () => {
      const files = Array.from(picker.files ?? []);
      picker.value = '';
      if (!files.length) return;
      let added = 0;
      for (const f of files) {
        try {
          const path = await this.deps.saveImage(f.name, await f.arrayBuffer());
          if (await this.deps.store.add(imageCard(path, Date.now()))) added++;
        } catch (err) { new Notice(`取り込み失敗: ${f.name} — ${String(err)}`); }
      }
      if (added) new Notice(`📷 ${added}枚をトレイへ`);
      this.render();
    };
    pickBtn.onclick = () => picker.click();

    // §23.5 keyboard hints, visible in place
    const keys = root.createDiv('jp-dm-keys jp-tray-keys');
    for (const [key, label] of [['j/k', '移動'], ['⏎/e', '分類'], ['x', '削除']] as const) {
      const chip = keys.createSpan('jp-dm-key');
      chip.createEl('kbd', { text: key });
      chip.createSpan({ text: label });
    }

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.addClass('jp-tray-zone--over'); });
    zone.addEventListener('dragleave', () => zone.removeClass('jp-tray-zone--over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.removeClass('jp-tray-zone--over');
      void this.handleDrop(e);
    });

    // ── the cards: 読書セッション groups interleaved into the feed (§25.7) ──
    const list = root.createDiv('jp-tray-list');
    const all = this.deps.store.all();
    if (!all.length) {
      list.createDiv({ cls: 'jp-tray-empty', text: 'トレイは空です。Stage Manager で隣のアプリからドラッグ、またはクリップボードから。' });
    }
    const groups = sessionGroups(all);
    const feed: Array<{ at: number; group?: ReadingSession; card?: InboxCard }> = [
      ...groups.map((g) => ({ at: g.end, group: g })),
      ...all.filter((c) => c.kind !== 'image').map((c) => ({ at: c.createdAt, card: c })),
    ].sort((a, b) => b.at - a.at);
    for (const item of feed) {
      if (item.card) { this.renderCard(list, item.card); continue; }
      const g = item.group!;
      if (g.cards.length < 2) { this.renderCard(list, g.cards[0]); continue; }
      this.renderSession(list, g);
    }
  }

  /** A 読書セッション: header (date + count + batch OCR) over the shots in
   *  reading order. Screenshot time IS the session identity — no schema. */
  private renderSession(list: HTMLElement, g: ReadingSession): void {
    const wrap = list.createDiv('jp-tray-session');
    const head = wrap.createDiv('jp-tray-session-head');
    const d = new Date(g.start);
    head.createSpan({
      text: `📚 読書セッション · ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} · ${g.cards.length}枚`,
      cls: 'jp-tray-session-title',
    });
    const pending = g.cards.filter((c) => !c.bubbles);
    if (pending.length && this.deps.ocrManga) {
      const btn = head.createEl('button', { text: `🔎 全ページOCR（${pending.length}枚）`, cls: 'jp-tray-session-ocr' });
      btn.onclick = async () => {
        btn.disabled = true;
        let ok = 0;
        const failed: string[] = [];
        for (const [i, c] of pending.entries()) {
          btn.setText(`🔎 ${i + 1}/${pending.length}…`);
          try {
            const bubbles = await this.deps.ocrManga!(c.content);
            await this.deps.store.setBubbles(c.id, bubbles);
            ok++;
          } catch (err) { failed.push(`${c.content.split('/').pop()}: ${String(err)}`); }
        }
        new Notice(failed.length
          ? `🔎 ${ok}枚OK / ${failed.length}枚失敗\n${failed.join('\n')}`
          : `🔎 ${ok}枚の吹き出しを抽出`);
        this.render();
      };
    }
    for (const c of g.cards) this.renderCard(wrap, c);
  }

  private async handleDrop(e: DragEvent): Promise<void> {
    const dt = e.dataTransfer;
    if (!dt) return;
    let added = 0;
    for (const file of Array.from(dt.files ?? [])) {
      if (!file.type.startsWith('image/')) continue;
      const path = await this.deps.saveImage(file.name, await file.arrayBuffer());
      if (await this.deps.store.add(imageCard(path, Date.now()))) added++;
    }
    if (!added) {
      const uri = dt.getData('text/uri-list').split('\n')[0]?.trim();
      const text = uri || dt.getData('text/plain');
      if (text?.trim()) { await this.addText(text); return; }
    }
    if (added) { new Notice(`⤵ ${added}件をトレイへ`); this.render(); }
  }

  private async addText(text: string): Promise<void> {
    const card = shapeDrop(text, Date.now());
    const fresh = await this.deps.store.add(card);
    new Notice(fresh ? `⤵ トレイへ（${{ url: 'URL', dialogue: '対話', sentence: '文', word: '語', text: 'テキスト', image: '画像' }[card.kind]}）` : '同じ内容が既にあります');
    this.render();
  }

  private renderCard(list: HTMLElement, c: InboxCard): void {
    const card = list.createDiv('jp-tray-card' + (c.id === this.focusId ? ' jp-tray-card--focus' : ''));
    card.addEventListener('pointerdown', () => { this.focusId = c.id; }, { capture: true });
    // §23.5 cross-surface drop: drag a text card ONTO the 語彙 view → capture
    // there with tray provenance (the card stays — quarantine until classified)
    if (c.kind !== 'image') {
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', c.content);
        e.dataTransfer?.setData('application/x-jpc-tray', c.origin ?? '');
        card.addClass('jp-tray-card--dragging');
      });
      card.addEventListener('dragend', () => card.removeClass('jp-tray-card--dragging'));
    }
    const head = card.createDiv('jp-tray-card-head');
    head.createSpan({
      text: { image: '🖼', url: '🔗', dialogue: '💬', sentence: '📄', word: '🔤', text: '📃', mark: '📍' }[c.kind],
      cls: 'jp-tray-card-kind',
    });
    if (c.origin) head.createSpan({ text: c.origin, cls: 'jp-tray-card-origin' });
    const del = head.createEl('button', { text: '🗑', cls: 'jp-tray-card-del' });
    del.onclick = async () => { await this.deps.store.remove(c.id); this.render(); };

    // §28 S1: a tray card is uncaptured, but the phrase in it may already BE in
    // the catalog. Showing that with the same class mark turns "another inbox
    // item" into "you have met this before" — and gives the rail its identity
    // before it is classified, rather than after.
    if (c.kind !== 'image') {
      const mine = this.deps.patternsIn?.(c.content) ?? [];
      if (mine.length) {
        applyClassRail(card, mine[0].class);
        const row = card.createDiv('jp-tray-card-mine');
        for (const p of mine.slice(0, 4)) {
          const b = classBadge(row, p.class, { ratified: p.classRatified });
          b.querySelector('.jp-cls-badge-label')?.setText(p.key);
          b.title = `${NOTE_TYPES[p.class].label} — 台帳にあります（タップで開く）`;
          if (this.deps.openPattern) {
            b.style.cursor = 'pointer';
            b.onclick = (e) => { e.stopPropagation(); this.deps.openPattern!(p.id); };
          }
        }
      }
    }

    const body = card.createDiv('jp-tray-card-body');
    switch (c.kind) {
      case 'image': {
        // the panel IS the context (§22.2): image with bubble overlay; each
        // OCR'd bubble is tappable → classify with the panel+bbox as scene
        const wrap = body.createDiv('jp-tray-imgwrap');
        const img = wrap.createEl('img', { cls: 'jp-tray-img' });
        img.src = this.app.vault.adapter.getResourcePath(normalizePath(c.content));
        img.onclick = () => void this.app.workspace.openLinkText(c.content, '', false);
        if (c.bubbles?.length) {
          for (const b of c.bubbles) {
            const box = wrap.createDiv('jp-tray-bbox');
            box.style.left = `${b.bbox[0] / 10}%`;
            box.style.top = `${b.bbox[1] / 10}%`;
            box.style.width = `${b.bbox[2] / 10}%`;
            box.style.height = `${b.bbox[3] / 10}%`;
            box.title = b.text;
          }
          c.bubbles.forEach((b, i) => {
            const row = body.createDiv('jp-tray-turn');
            row.createSpan({ text: String(i + 1), cls: 'jp-tray-speaker' });
            row.createSpan({ text: b.text, cls: 'jp-tray-turn-text' });
            row.onclick = () => this.deps.openCapture({
              text: b.text,
              example: b.text,
              contextBefore: (c.bubbles ?? []).slice(Math.max(0, i - 3), i).map((x) => x.text),
              contextAfter: (c.bubbles ?? []).slice(i + 1, i + 3).map((x) => x.text),
              source: { kind: 'manual', medium: 'manga', sourceName: c.origin ?? 'マンガ', image: c.content, bbox: b.bbox },
            });
          });
        } else if (this.deps.ocrManga) {
          const acts = body.createDiv('jp-tray-card-actions');
          const ocr = acts.createEl('button', { text: '🔎 OCR（吹き出し抽出）', cls: 'jp-tray-classify' });
          ocr.onclick = async () => {
            ocr.disabled = true;
            ocr.setText('🔎 抽出中…');
            try {
              const bubbles = await this.deps.ocrManga!(c.content);
              await this.deps.store.setBubbles(c.id, bubbles);
              new Notice(`🗨 ${bubbles.length}個の吹き出し`);
            } catch (e) { new Notice(String(e)); }
            this.render();
          };
          // §25.3: a screenshot of a PLAYER instead of a page → precise mark
          if (this.deps.recognizePlayer) {
            const rec = acts.createEl('button', { text: '🎧 プレイヤー認識', cls: 'jp-tray-classify' });
            rec.onclick = async () => {
              rec.disabled = true;
              rec.setText('🎧 認識中…');
              try { await this.deps.recognizePlayer!(c); } catch (e) { new Notice(String(e)); }
              this.render();
            };
          }
        } else {
          body.createDiv({ text: 'OCR には API キーが必要です（設定 → 手書きOCR）', cls: 'jp-tray-card-note' });
        }
        break;
      }
      case 'mark': {
        // §25.1 harvest: the mark re-manifests its moment via 🏷️
        const m = c.mark;
        const row = body.createDiv('jp-tray-mark');
        if (m?.tSec != null) row.createSpan({ text: fmtStamp(m.tSec), cls: 'jp-tray-mark-stamp' });
        if (m?.loc) row.createSpan({ text: m.loc, cls: 'jp-tray-mark-stamp' });
        row.createSpan({ text: c.content || '（シードなし）', cls: c.content ? 'jp-tray-mark-seed' : 'jp-tray-mark-seed jp-tray-mark-seed--none' });
        break;
      }
      case 'url': {
        body.createEl('a', { text: c.content, href: c.content, cls: 'jp-tray-url' });
        break;
      }
      case 'dialogue': {
        // tap a TURN → classify THAT turn, the others ride as real context
        (c.lines ?? []).forEach((line, i) => {
          const row = body.createDiv('jp-tray-turn');
          if (line.speaker) row.createSpan({ text: line.speaker, cls: 'jp-tray-speaker' });
          row.createSpan({ text: line.text, cls: 'jp-tray-turn-text' });
          row.onclick = () => this.deps.openCapture({
            text: line.text,
            example: line.text,
            contextBefore: (c.lines ?? []).slice(0, i).map((l) => l.text),
            contextAfter: (c.lines ?? []).slice(i + 1).map((l) => l.text),
            speakers: (c.lines ?? []).map((l) => l.speaker ?? null),
            source: { kind: 'manual', sourceName: c.origin },
          });
        });
        break;
      }
      default:
        body.createDiv({ text: c.content, cls: 'jp-tray-text' });
    }

    if (c.kind === 'mark') {
      const act = card.createDiv('jp-tray-card-actions');
      const tag = act.createEl('button', { text: '🏷️ 分類', cls: 'jp-tray-classify' });
      tag.onclick = async () => {
        const m = c.mark;
        if (m && this.deps.resolveMarkContext) {
          const ctx = await this.deps.resolveMarkContext(m);
          if (ctx) { this.deps.openCapture(ctx); return; }
        }
        this.deps.openCapture({
          text: c.content,
          source: { kind: 'manual', sourceName: c.origin, medium: m?.medium, file: m?.file, tStartSec: m?.tSec ?? null },
        });
      };
    } else if (c.kind === 'sentence' || c.kind === 'word' || c.kind === 'text') {
      const act = card.createDiv('jp-tray-card-actions');
      const tag = act.createEl('button', { text: '🏷️ 分類', cls: 'jp-tray-classify' });
      tag.onclick = () => this.deps.openCapture({
        text: c.kind === 'word' ? c.content : '',
        example: c.kind === 'word' ? undefined : c.content,
        source: { kind: 'manual', sourceName: c.origin },
      });
    } else if (c.kind === 'url') {
      const act = card.createDiv('jp-tray-card-actions');
      const tag = act.createEl('button', { text: '🏷️ 分類', cls: 'jp-tray-classify' });
      tag.onclick = () => this.deps.openCapture({
        text: '',
        source: { kind: 'web', url: c.content, sourceName: c.origin },
      });
    }
  }
}
