/**
 * LibraryView.ts — the reconciliation library sidebar (DESIGN §8.5).
 *
 * Lists anchored reconciliation callouts as block-EMBEDS (`![[file#^id]]`, never
 * copies — invariant #1), filterable by Big-5 class and by needs-review. Each
 * row lets you set the note's KIND (the Big-5 router) which rewrites the callout
 * keyword in the source Markdown and re-renders.
 */

import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import type { ReconLibrary } from '../notes/recon-library.ts';
import type { LibraryEntry } from '../notes/annotate.ts';
import type { PatternEntry, Attestation } from '../notes/pattern-store.ts';
import type { MatcherLine } from '../notes/local-matcher.ts';
import type { SegLike } from '../notes/context-window.ts';
import { renderContextWindow } from './ContextWindow.ts';
import { NOTE_TYPES, NOTE_CLASSES, type NoteClass } from '../notes/note-types.ts';
import { classChips, applyClassRail, classColor } from './class-grammar.ts';

export const JP_RECON_LIBRARY_VIEW_TYPE = 'jp-recon-library-view';

export interface LibraryViewDeps {
  library: ReconLibrary;
  /** Rewrite the callout class in the source file + persist, then resolve. */
  onRetype: (entry: LibraryEntry, cls: NoteClass) => Promise<void>;
  /** Open the source file at the callout block. */
  openBlock: (entry: LibraryEntry) => Promise<void>;
  /** Resolve the entry's downloaded audio clip (app:// URL), or null if none. */
  resolveClip?: (entry: LibraryEntry) => Promise<{ src: string; label: string } | null>;
  /** ── ContextWindow (§20.2) ── */
  parseLines?: (md: string) => MatcherLine[];
  loadSeg?: (path: string) => SegLike | null;
  /** ── the pattern catalog (台帳) ── */
  patterns?: () => PatternEntry[];
  onPatternClass?: (id: string, cls: NoteClass) => Promise<void>;
  onPatternDelete?: (id: string) => Promise<void>;
  openAttestation?: (att: Attestation) => Promise<void>;
  /** Offline X-corpus co-occurrence join for one pattern (returns tweets newly attached). */
  onXJoin?: (p: PatternEntry) => Promise<number>;
  /** Sweep every vault transcript for sightings of every catalog pattern. */
  onSweep?: () => Promise<string>;
  /** ── needs-review triage ── */
  onApprove?: (entry: LibraryEntry) => Promise<boolean>;
  onRetry?: (entry: LibraryEntry, newNote: string) => Promise<'anchored' | 'needs-review' | 'not-found'>;
  onSetStatus?: (entry: LibraryEntry, status: LibraryEntry['status']) => void;
  /** 🔴 gold-data scoreboard for the catalog header (DESIGN §13.2). */
  goldInfo?: () => { total: number; agreementPct: number | null };
}

type AttSourceFilter = 'all' | 'yt' | 'x' | 'web' | 'manual';

type Filter = 'all' | NoteClass | 'needs-review' | 'commentary';

export class LibraryView extends ItemView {
  private filter: Filter = 'all';
  private mode: 'anchors' | 'catalog' = 'anchors';
  // ── catalog facets (class × source × free text) ──
  private catClass: 'all' | NoteClass = 'all';
  private catSource: AttSourceFilter = 'all';
  private catQuery = '';
  // ── persistent audio player: lives in the SIDEBAR, so scrolling (or even
  //    closing) the cards/transcript pane never cuts playback — Obsidian
  //    unloads embedded <audio> elements as they leave the viewport, which is
  //    why in-file players stop abruptly. This one is a detached Audio object.
  private audio: HTMLAudioElement | null = null;
  private playingKey: string | null = null;
  private playerBar: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private deps: LibraryViewDeps) {
    super(leaf);
  }

  getViewType(): string { return JP_RECON_LIBRARY_VIEW_TYPE; }
  getDisplayText(): string { return '照合ライブラリ'; }
  getIcon(): string { return 'library'; }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.stopAudio();
  }

  private stopAudio(): void {
    if (this.audio) { this.audio.pause(); this.audio.src = ''; }
    this.audio = null;
    this.playingKey = null;
    this.updatePlayerBar(null);
  }

  private updatePlayerBar(label: string | null): void {
    if (!this.playerBar) return;
    this.playerBar.empty();
    if (!label) { this.playerBar.style.display = 'none'; return; }
    this.playerBar.style.display = 'flex';
    this.playerBar.createSpan({ text: `🔊 ${label}` }).style.cssText =
      'font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
    const stop = this.playerBar.createEl('button', { text: '⏹ 停止' });
    stop.style.cssText = 'font-size:10px;cursor:pointer;';
    stop.onclick = () => { this.stopAudio(); this.render(); };
  }

  private async toggleClip(e: LibraryEntry, btn: HTMLButtonElement): Promise<void> {
    const key = e.blockId;
    if (this.playingKey === key) { this.stopAudio(); btn.setText('🔊'); return; }
    const clip = await this.deps.resolveClip?.(e);
    if (!clip) {
      new Notice('音声クリップが未取得です — 「Download Audio Clips for Reconciled Notes」を実行してください。', 6000);
      return;
    }
    this.stopAudio();
    this.audio = new Audio(clip.src);
    this.playingKey = key;
    this.updatePlayerBar(clip.label);
    btn.setText('⏸');
    this.audio.onended = () => { if (this.playingKey === key) { this.stopAudio(); btn.setText('🔊'); } };
    this.audio.play().catch((err) => { new Notice(`再生に失敗: ${String(err)}`); this.stopAudio(); });
  }

  /** Called by the plugin after a reconciliation run to refresh. */
  refresh(): void {
    if (this.contentEl) this.render();
  }

  private matches(e: LibraryEntry): boolean {
    if (this.filter === 'all') return true;
    if (this.filter === 'needs-review') return e.status === 'needs-review';
    if (this.filter === 'commentary') return e.status === 'commentary';
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
    const title = header.createDiv({ cls: 'jp-recon-title' });
    title.style.cssText = 'display:flex;gap:8px;align-items:center;';
    title.createSpan({ text: this.mode === 'anchors' ? `照合ライブラリ — ${entries.length}件` : `パターン台帳 — ${this.deps.patterns?.().length ?? 0}語` });
    if (this.deps.patterns) {
      const sw = title.createEl('button', { text: this.mode === 'anchors' ? '📒 台帳' : '⚓ アンカー' });
      sw.style.cssText = 'font-size:10px;margin-left:auto;cursor:pointer;';
      sw.title = this.mode === 'anchors'
        ? 'パターン台帳へ（同じパターンの目撃が動画をまたいで1エントリに集約）'
        : 'アンカー一覧へ';
      sw.onclick = () => { this.mode = this.mode === 'anchors' ? 'catalog' : 'anchors'; this.render(); };
    }
    if (this.mode === 'catalog') { this.renderCatalog(root); return; }

    // persistent audio bar (survives main-pane scrolling/unloading)
    this.playerBar = header.createDiv();
    this.playerBar.style.cssText = 'display:none;gap:6px;align-items:center;padding:4px 6px;margin:4px 0;border:1px solid var(--background-modifier-border);border-radius:6px;background:var(--background-secondary);';
    if (this.playingKey && this.audio) this.updatePlayerBar(this.audio.src.split('/').pop() ?? '再生中');

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
      chip(`${NOTE_TYPES[c].emoji} ${n}`, c, classColor(c));
    }
    const nr = entries.filter((e) => e.status === 'needs-review').length;
    chip(`🔶 ${nr}`, 'needs-review', '#d9832b');
    const cm = entries.filter((e) => e.status === 'commentary').length;
    if (cm) chip(`💬 ${cm}`, 'commentary', '#888');

    if (!shown.length) {
      root.createEl('p', { text: entries.length ? '該当なし' : 'まだ照合ノートがありません。「Reconcile Notes Against Source Transcript」を実行してください。', cls: 'jp-recon-empty' });
      return;
    }

    const list = root.createDiv({ cls: 'jp-recon-list' });
    for (const e of shown) this.renderEntry(list, e);
  }

  /** A pattern matches the active catalog facets (class × source × text). */
  private catMatches(p: PatternEntry): boolean {
    if (this.catClass !== 'all' && p.class !== this.catClass) return false;
    if (this.catSource !== 'all' && !p.attestations.some((a) => a.source === this.catSource)) return false;
    if (this.catQuery) {
      const q = this.catQuery;
      const hay = [p.key, p.note, p.payload.gloss ?? '', p.payload.lemma ?? '',
        ...p.attestations.map((a) => a.quote)].join('\n');
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  /** 台帳: one row per PATTERN, attestations accumulated across sources. */
  private renderCatalog(root: HTMLElement): void {
    const all = this.deps.patterns?.() ?? [];

    // ── stats header: what the catalog holds + the 🔴 parser scoreboard ──
    const stats = root.createDiv();
    stats.style.cssText = 'font-size:11px;color:var(--text-muted);margin:2px 0 4px;';
    const attTotal = all.reduce((n, p) => n + p.attestations.length, 0);
    const bySrc = { yt: 0, x: 0, web: 0, manual: 0 } as Record<string, number>;
    for (const p of all) for (const a of p.attestations) bySrc[a.source] = (bySrc[a.source] ?? 0) + 1;
    let statLine = `${all.length}語 / 目撃${attTotal}件（▶${bySrc.yt} 𝕏${bySrc.x} 🌐${bySrc.web} ✍${bySrc.manual}）`;
    const gold = this.deps.goldInfo?.();
    if (gold && gold.total > 0) {
      statLine += ` ・ 🔴ゴールド${gold.total}件` + (gold.agreementPct != null ? `（パーサ一致 ${gold.agreementPct}%）` : '');
    }
    stats.setText(statLine);

    // ── facet bar: class chips × source chips × search ──
    const facets = root.createDiv();
    facets.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin:2px 0 6px;';
    const chip = (label: string, active: boolean, color: string | null, onClick: () => void, title?: string) => {
      const b = facets.createEl('button', { text: label });
      b.style.cssText = `font-size:10.5px;padding:1px 7px;border-radius:10px;cursor:pointer;border:1px solid var(--background-modifier-border);${
        active ? `background:${color ?? 'var(--interactive-accent)'};color:#fff;` : 'background:transparent;'}`;
      if (title) b.title = title;
      b.onclick = onClick;
    };
    chip(`すべて ${all.length}`, this.catClass === 'all', null, () => { this.catClass = 'all'; this.render(); });
    for (const c of NOTE_CLASSES) {
      const n = all.filter((p) => p.class === c).length;
      if (!n && this.catClass !== c) continue;
      chip(`${NOTE_TYPES[c].emoji} ${n}`, this.catClass === c, classColor(c),
        () => { this.catClass = this.catClass === c ? 'all' : c; this.render(); }, NOTE_TYPES[c].label);
    }
    const srcDefs: Array<{ id: AttSourceFilter; label: string; title: string }> = [
      { id: 'yt', label: '▶', title: 'YouTube文字起こしの目撃を含む' },
      { id: 'x', label: '𝕏', title: 'ツイート用例を含む' },
      { id: 'web', label: '🌐', title: 'ウェブ記事（note.com等）の目撃を含む' },
      { id: 'manual', label: '✍', title: '手動キャプチャを含む' },
    ];
    for (const s of srcDefs) {
      if (!bySrc[s.id] && this.catSource !== s.id) continue;
      chip(s.label, this.catSource === s.id, '#666',
        () => { this.catSource = this.catSource === s.id ? 'all' : s.id; this.render(); }, s.title);
    }
    const search = facets.createEl('input', { type: 'search', attr: { placeholder: '台帳を検索…' } });
    search.style.cssText = 'font-size:11px;flex:1;min-width:90px;padding:1px 6px;';
    search.value = this.catQuery;
    search.addEventListener('input', () => {
      this.catQuery = search.value.trim();
      // re-render only the list so the input keeps focus
      listEl.empty();
      renderList();
    });

    if (this.deps.onSweep && all.length) {
      const sweep = facets.createEl('button', { text: '🔍 走査' });
      sweep.style.cssText = 'font-size:10.5px;cursor:pointer;';
      sweep.title = '保管庫内のすべての文字起こしから、台帳の全パターンの目撃（サイティング）を収集します（ファイルは変更しません）';
      sweep.onclick = async () => {
        sweep.disabled = true; sweep.setText('🔍 走査中…');
        try { await this.deps.onSweep!(); } catch (err) { new Notice(String(err)); }
        this.render();
      };
    }

    if (!all.length) {
      root.createEl('p', { text: 'まだパターンがありません。⚡ の実行、または任意のテキスト選択 → 「分類キャプチャ」で貯まります。', cls: 'jp-recon-empty' });
      return;
    }

    const listEl = root.createDiv({ cls: 'jp-recon-list' });
    const renderList = () => {
      const shown = all.filter((p) => this.catMatches(p));
      if (!shown.length) {
        listEl.createEl('p', { text: '該当なし', cls: 'jp-recon-empty' });
        return;
      }
      for (const p of shown) this.renderCatalogEntry(listEl, p);
    };
    renderList();
  }

  private renderCatalogEntry(list: HTMLElement, p: PatternEntry): void {
    {
      const card = list.createDiv({ cls: 'jp-recon-card' });
      card.style.cssText = 'border:1px solid var(--background-modifier-border);border-radius:6px;margin:6px 0;padding:8px;';
      applyClassRail(card, p.class);

      const top = card.createDiv();
      top.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;';
      const key = top.createSpan({ text: p.key });
      key.style.cssText = 'font-weight:600;';
      const kindBadge = { link: '🔗', frame: '⬚', surface: '' }[p.keyKind];
      if (kindBadge) top.createSpan({ text: kindBadge }).style.cssText = 'font-size:11px;';
      const count = top.createSpan({ text: `×${p.attestations.length}` });
      count.style.cssText = 'font-size:11px;color:var(--text-muted);font-family:var(--font-monospace);';
      if (this.deps.onXJoin) {
        const xb = top.createEl('button', { text: '𝕏' });
        xb.style.cssText = 'font-size:10px;margin-left:auto;cursor:pointer;';
        xb.title = p.keyKind === 'link'
          ? '𝕏コーパスで共起検索（全成分を含むツイート → 用例として添付）'
          : '𝕏コーパスで検索（この表現を含むツイート → 用例として添付）';
        xb.onclick = async () => {
          xb.disabled = true;
          try { await this.deps.onXJoin!(p); } catch (err) { new Notice(String(err)); }
          this.render();
        };
      }
      const del = top.createEl('button', { text: '🗑' });
      del.style.cssText = `font-size:10px;cursor:pointer;${this.deps.onXJoin ? '' : 'margin-left:auto;'}`;
      del.onclick = async () => { await this.deps.onPatternDelete?.(p.id); this.render(); };

      // The class control: one tap, same chips as every other surface. It both
      // SHOWS the class and SETS it, so there is no separate badge to keep in
      // sync — and no <select>, which cost two taps and a picker sheet on phone.
      const chips = classChips(card, {
        value: p.class,
        ratified: p.classRatified,
        compact: true,
        onPick: async (cls) => {
          await this.deps.onPatternClass?.(p.id, cls);
          applyClassRail(card, cls);           // the rail follows immediately
          chips.el.removeClass('jp-cls-chips--suggested');
        },
      });
      chips.el.style.marginTop = '6px';

      if (p.note !== p.key) {
        const noteEl = card.createDiv({ text: `メモ: ${p.note}` });
        noteEl.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:2px;';
      }

      // class-shaped payload badges (ClassifyModal captures carry these)
      const payloadBits: string[] = [];
      if (p.payload.lemma) payloadBits.push(`レンマ: ${p.payload.lemma}`);
      if (p.payload.halo) payloadBits.push(`ハロー: ${p.payload.halo}`);
      if (p.payload.gloss) payloadBits.push(`⟶ ${p.payload.gloss}`);
      if (payloadBits.length) {
        const pl = card.createDiv({ text: payloadBits.join('　') });
        pl.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:2px;';
      }

      if (!p.attestations.length) {
        card.createDiv({ text: '（未アンカー — 文字起こしで見つかっていません）' })
          .style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:4px;';
        return;
      }
      const atts = card.createDiv();
      atts.style.cssText = 'margin-top:4px;';
      for (const a of p.attestations) {
        const row = atts.createDiv();
        row.style.cssText = 'display:flex;gap:6px;align-items:baseline;font-size:11.5px;padding:2px 0;border-top:1px dashed var(--background-modifier-border);';
        const src = a.source === 'x' ? '𝕏 ツイート'
          : a.source === 'web' ? '🌐 ' + ((a.file ?? '').replace(/^https?:\/\//, '').split('/')[0] || 'ウェブ')
          : (a.file ?? '').split('/').pop()?.replace(/\.md$/, '') ?? a.source;
        const t = a.tStartSec != null ? `${Math.floor(a.tStartSec / 60)}:${String(a.tStartSec % 60).padStart(2, '0')}` : '';
        // an unanchored yt sighting came from the 🔍 sweep, not the user's pen
        const mark = a.source === 'yt' && !a.anchorId ? '🔍' : '';
        const jump = row.createEl('a', { text: `${mark}${src.slice(0, 22)}${src.length > 22 ? '…' : ''} ${t}` });
        jump.style.cssText = 'white-space:nowrap;cursor:pointer;';
        jump.onclick = () => void this.deps.openAttestation?.(a).catch((err) => new Notice(String(err)));
        const q = row.createSpan({ text: a.quote.slice(0, 34) });
        q.style.cssText = 'color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      }
    }
  }

  private renderEntry(parent: HTMLElement, e: LibraryEntry): void {
    const card = parent.createDiv({ cls: 'jp-recon-card' });
    card.style.cssText = 'border:1px solid var(--background-modifier-border);border-radius:6px;margin:6px 0;padding:8px;';
    applyClassRail(card, e.noteClass);

    // top row: timestamp + status; the class control gets its own row below
    const top = card.createDiv();
    top.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px;';

    const ts = top.createSpan({ text: e.tStartSec != null ? `~${Math.floor(e.tStartSec / 60)}:${String(e.tStartSec % 60).padStart(2, '0')}` : '' });
    ts.style.cssText = 'font-size:11px;color:var(--text-muted);font-family:var(--font-monospace);';
    if (e.status === 'needs-review') {
      const b = top.createSpan({ text: '🔶要確認' });
      b.style.cssText = 'font-size:10px;color:#d9832b;';
    }
    if (e.status === 'commentary') {
      const b = top.createSpan({ text: '💬コメント' });
      b.style.cssText = 'font-size:10px;color:var(--text-muted);';
      b.title = '文字起こしの引用ではなく自分の書き込みとして保持中（クリックで要確認に戻す）';
      b.style.cursor = 'pointer';
      b.onclick = () => { this.deps.onSetStatus?.(e, 'needs-review'); this.render(); };
      card.style.opacity = '0.75';
    }
    const play = top.createEl('button', { text: this.playingKey === e.blockId ? '⏸' : '🔊' });
    play.style.cssText = 'font-size:10px;margin-left:auto;cursor:pointer;';
    play.title = '音声クリップを再生（サイドバー再生 — スクロールしても止まりません）';
    play.onclick = () => void this.toggleClip(e, play);

    const open = top.createEl('button', { text: '↪ 原文' });
    open.style.cssText = 'font-size:10px;cursor:pointer;';
    open.onclick = () => this.deps.openBlock(e).catch((err) => new Notice(String(err)));

    // The class control — identical chips to the catalog, the capture modal and
    // the lexicon panel. Retyping rewrites the callout keyword in the source
    // Markdown, so the rail moves the moment the write lands.
    const chips = classChips(card, {
      value: e.noteClass,
      compact: true,
      onPick: async (cls) => {
        try {
          await this.deps.onRetype(e, cls);
          applyClassRail(card, cls);
        } catch (err) {
          new Notice(`種別変更に失敗: ${String(err)}`);
          chips.set(e.noteClass);            // the write failed — put the mark back
        }
      },
    });
    chips.el.style.margin = '2px 0 6px';

    // DESIGN §20.2: the real context window — ±2 turns around the anchored
    // span (ratified 談話モード turns/speakers when present), inflection-aware
    // highlight — instead of a raw one-line block embed. Degrades to the
    // stored quote, never to a broken embed.
    const embed = card.createDiv({ cls: 'jp-recon-embed' });
    if (e.status === 'commentary') {
      const p = embed.createDiv();
      p.style.cssText = 'font-size:12px;color:var(--text-muted);';
      p.setText(`💬 「${e.note}」`);
    } else if (!e.anchorId && e.status === 'needs-review') {
      // unanchored triage entry: the candidate line IS the content
      const p = embed.createDiv();
      p.style.cssText = 'font-size:12px;color:var(--text-muted);';
      p.setText(`「${e.note}」→ 最有力: 「${e.reconciled || 'なし'}」 (${(e.confidence * 100).toFixed(0)}%)`);
    } else if (this.deps.parseLines) {
      void renderContextWindow(embed, {
        source: 'yt', file: e.file, tStartSec: e.tStartSec,
        anchorId: e.anchorId, quote: e.reconciled || e.note, addedAt: 0,
      }, [e.reconciled, e.note], {
        app: this.app,
        parseLines: this.deps.parseLines,
        loadSeg: this.deps.loadSeg ?? (() => null),
      });
    } else {
      const p = embed.createDiv();
      p.style.cssText = 'font-size:12px;color:var(--text-muted);';
      p.setText(`「${e.reconciled || e.note}」`);
    }

    // ── triage row: flagged entries resolve in ≤2 clicks ──
    if (e.status === 'needs-review' && (this.deps.onApprove || this.deps.onRetry || this.deps.onSetStatus)) {
      this.renderTriage(card, e);
    }
  }

  /** ✅ adopt best candidate / ✏️ correct & re-match / 💬 keep as own remark. */
  private renderTriage(card: HTMLElement, e: LibraryEntry): void {
    const row = card.createDiv();
    row.style.cssText = 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;';
    const mkBtn = (text: string, title: string) => {
      const b = row.createEl('button', { text });
      b.style.cssText = 'font-size:10.5px;cursor:pointer;';
      b.title = title;
      return b;
    };
    if (this.deps.onApprove && e.spanStartLine != null) {
      const ok = mkBtn('✅ この照合で採用', '最有力候補を信じてアンカーを書き込みます');
      ok.onclick = async () => {
        ok.disabled = true;
        try { await this.deps.onApprove!(e); } catch (err) { new Notice(String(err)); }
        this.render();
      };
    }
    if (this.deps.onRetry) {
      const edit = mkBtn('✏️ 修正して再照合', 'メモを書き直して（OCR誤読など）この文字起こしに再照合');
      edit.onclick = () => {
        // inline editor replaces the button row — sidebar-friendly, no modal
        row.empty();
        const input = row.createEl('input', { type: 'text', value: e.note });
        input.style.cssText = 'flex:1;min-width:120px;font-size:12px;';
        const go = row.createEl('button', { text: '再照合' });
        go.style.cssText = 'font-size:10.5px;cursor:pointer;';
        const run = async () => {
          go.disabled = true;
          try { await this.deps.onRetry!(e, input.value); } catch (err) { new Notice(String(err)); }
          this.render();
        };
        go.onclick = () => void run();
        input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') void run(); });
        input.focus();
        input.select();
      };
    }
    if (this.deps.onSetStatus) {
      const keep = mkBtn('💬 コメントとして保持', '引用ではなく自分の書き込みとして残します（要確認から外れます）');
      keep.onclick = () => { this.deps.onSetStatus!(e, 'commentary'); this.render(); };
    }
  }
}
