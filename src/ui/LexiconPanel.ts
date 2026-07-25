/**
 * LexiconPanel — the monokakido-style unified lexicon (DESIGN §13 follow-up).
 *
 * One instant search over the whole knowledge base: the six-class catalog
 * (the user's own noticings), the legacy collocation lexicon, and the
 * dictionary (deinflection-aware). Live autocomplete, class/source facets, and
 * a drill-down detail view whose CONTEXT TREE is built from real located
 * attestations (context-tree.ts) — grouped by video / tweet-set / web, deduped
 * and capped, with per-leaf 🎧 clip playback and ↪ source jumps. No raw-vault
 * indexOf snippets, no junk.
 *
 * This is a renderer (not an ItemView); CollocationView's 辞書 tab mounts it
 * into its result container. Audio uses a detached <audio> so playback
 * survives re-renders.
 */

import { Notice, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import type { PatternEntry, Attestation } from '../notes/pattern-store.ts';
import type { CollocationEntry } from '../types.ts';
import type { DictLookupResult } from '../dictionary/types.ts';
import type { MatcherLine } from '../notes/local-matcher.ts';
import type { SegLike } from '../notes/context-window.ts';
import { renderContextWindow } from './ContextWindow.ts';
import { NOTE_TYPES, NOTE_CLASSES, type NoteClass } from '../notes/note-types.ts';
import { classChips, classDot, applyClassRail, classColor } from './class-grammar.ts';
import { unifiedSearch, autocomplete, linkLegacy, type UnifiedEntry, type SearchMode } from '../lexicon/unified-search.ts';
import { buildContextTree, type ContextTree, type ContextLeaf } from '../lexicon/context-tree.ts';
import { knowledgeBox } from './knowledge-box.ts';
import { HoverPeek, definitionsPreview } from './hover-peek.ts';

type SrcFilter = 'yt' | 'x' | 'web' | 'manual';

export interface LexiconDeps {
  patterns: () => PatternEntry[];
  collocations: () => CollocationEntry[];
  dictLookup: (q: string) => DictLookupResult[];
  resolveClip: (att: Attestation) => Promise<{ src: string; label: string } | null>;
  openAttestation: (att: Attestation) => Promise<void>;
  /** open the classify-capture modal on a pattern (re-lens / edit payload). */
  onReclassify: (p: PatternEntry) => void;
  setClass: (id: string, cls: NoteClass) => Promise<void>;
  deletePattern: (id: string) => Promise<void>;
  openDict: (word: string) => void;
  /** ✓ a suggested sighting → confirmed attestation (enters the tree). */
  ratifyAttestation: (patternId: string, att: Attestation) => Promise<void>;
  /** ✕ a suggested sighting → removed + remembered as a negative example. */
  rejectAttestation: (patternId: string, att: Attestation) => Promise<void>;
  /** ── §20.2: real context windows on leaves ── */
  parseLines: (md: string) => MatcherLine[];
  loadSeg: (path: string) => SegLike | null;
  /** §22.2 manga: OCR'd bubbles of a stored panel (for the manga context renderer). */
  bubblesFor?: (imagePath: string) => Array<{ text: string; bbox: [number, number, number, number] }> | null;
  /** §23.5 cross-surface drop: a tray card (or any text) dropped ONTO the 語彙
   *  view opens capture over it. */
  onDropCapture?: (text: string, sourceName?: string) => void;
  /** ── §20.3: the 用例 finder cascade ── */
  /** Tier A: run every finder for this entry NOW; returns NEW suggestion counts. */
  findExamples: (p: PatternEntry) => Promise<{ swept: number; x: number }>;
  /** Tier B: open the X view with a prefilled live query for this pattern. */
  searchXFor: (p: PatternEntry) => void;
  /** Tier C: 生成 scaffold (absent = no API key configured). */
  generateScaffold?: (p: PatternEntry) => Promise<number>;
  /** §22.7: fetch + freeze the 語法プロフィール (absent = corpus disabled). */
  fetchGoho?: (p: PatternEntry) => Promise<boolean>;
  /** §22.7: capture a corpus example as a curated-stratum attestation. */
  captureCorpus?: (p: PatternEntry, example: string) => void;
}

export class LexiconPanel {
  private query = '';
  private mode: SearchMode = 'prefix';       // monokakido default: 前方一致
  private classes = new Set<NoteClass>();
  private sources = new Set<SrcFilter>();
  private selectedId: string | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  /** list scroll position, restored on back-from-detail (§20.1). */
  private listScroll = 0;
  private restoreScroll = false;
  /** last Tier-A run for the open entry: 0 total → show Tier-B assignments. */
  private lastFind: { id: string; total: number } | null = null;
  private findBusy = false;

  private container: HTMLElement | null = null;
  private audio: HTMLAudioElement | null = null;
  private playingKey: string | null = null;

  constructor(private app: App, private deps: LexiconDeps) {}

  /** Full render into `container` (state is preserved across calls). */
  render(container: HTMLElement): void {
    this.container = container;
    container.empty();
    container.addClass('jp-lex');
    // §23.5 keyboard hand: attach once per container
    const c = container as HTMLElement & { _lexKeys?: boolean };
    if (!c._lexKeys) {
      c._lexKeys = true;
      container.tabIndex = 0;
      container.addEventListener('keydown', (e) => this.onKey(e));
      // §23.5 Pencil hand: a tray card dragged onto the 語彙 view = capture
      if (this.deps.onDropCapture) {
        container.addEventListener('dragover', (e) => {
          if (!e.dataTransfer?.types.includes('text/plain')) return;
          e.preventDefault();
          container.addClass('jp-lex--dropover');
        });
        container.addEventListener('dragleave', () => container.removeClass('jp-lex--dropover'));
        container.addEventListener('drop', (e) => {
          container.removeClass('jp-lex--dropover');
          const text = e.dataTransfer?.getData('text/plain')?.trim();
          if (!text) return;
          e.preventDefault();
          const origin = e.dataTransfer?.getData('application/x-jpc-tray') || undefined;
          this.deps.onDropCapture!(text, origin);
        });
      }
      // §26.3 hover peek — the mouse/Pencil-hover superpower: dwell over a
      // Japanese word inside any quote → dictionary preview BEFORE committing.
      // Touch never triggers this (tap = 飛び込み stays); degrades silently.
      // Shared component, identical to the dictionary's peek (§26.0 prop 4).
      this.peek = new HoverPeek((x, y) => {
        const hit = this.wordAt(x, y);
        if (!hit) return null;
        return {
          headword: hit.term.expression,
          reading: hit.term.reading,
          deinflection: hit.deinflection,
          def: definitionsPreview(hit.term.definitions),
        };
      });
      this.peek.attach(container, '.jp-lex-tappable');
    }
    if (this.selectedId) this.renderDetail(container);
    else this.renderList(container);
  }

  // ── §23.5 keyboard hand (hints rendered in place) ──────────
  // /=検索 j/k=移動 ⏎=開く（候補行では✓） x=✕ — DOM-driven so the list and
  // the detail candidate leaves share one walker.
  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const root = this.container;
    if (!root) return;
    if (e.key === '/') {
      e.preventDefault();
      root.querySelector<HTMLInputElement>('.jp-lex-search')?.focus();
      return;
    }
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.jp-lex-row, .jp-lex-leaf'));
    if (!rows.length) return;
    const cur = rows.findIndex((r) => r.hasClass('jp-lex-krow--focus'));
    const k = e.key.toLowerCase();
    if (k === 'j' || k === 'k') {
      e.preventDefault();
      const from = cur < 0 ? (k === 'j' ? -1 : rows.length) : cur;
      const next = Math.max(0, Math.min(rows.length - 1, from + (k === 'j' ? 1 : -1)));
      rows.forEach((r) => r.removeClass('jp-lex-krow--focus'));
      rows[next].addClass('jp-lex-krow--focus');
      rows[next].scrollIntoView({ block: 'nearest' });
      return;
    }
    // §26.3 space-walking keys: h/l = neighbor entry while in a detail
    if ((k === 'h' || k === 'l') && this.selectedId) {
      const nb = this.neighborsOf(this.selectedId);
      const to = k === 'h' ? nb.prev : nb.next;
      if (to) { e.preventDefault(); this.walkTo(to.id); }
      return;
    }
    if (cur < 0) return;
    const row = rows[cur];
    if (e.key === 'Enter') {
      e.preventDefault();
      const yes = row.querySelector<HTMLElement>('.jp-lex-cand-yes');
      if (yes) yes.click();      // candidate leaf: ⏎ = ✓（談話モードと同じ）
      else row.click();          // list row: open
      return;
    }
    if (k === 'x') {
      const no = row.querySelector<HTMLElement>('.jp-lex-cand-no');
      if (no) { e.preventDefault(); no.click(); }
    }
  }

  // ── §26.3 space-walking: the catalog as an INDEX you move through ────────

  /** Neighbors of an entry in the CURRENT list order (same query/mode/facets
   *  and gojūon browse sort the list itself shows — locality is real). */
  private neighborsOf(id: string): { prev?: { id: string; headword: string }; next?: { id: string; headword: string } } {
    let results = unifiedSearch({
      patterns: this.deps.patterns(),
      collocations: this.deps.collocations(),
      classes: [...this.classes],
      sources: [...this.sources],
      query: this.query,
      mode: this.mode,
      limit: 300,
    });
    if (!this.query.trim()) {
      results = [...results].sort((a, b) =>
        this.kanaGroup(a.headword).localeCompare(this.kanaGroup(b.headword), 'ja') ||
        a.headword.localeCompare(b.headword, 'ja'));
    }
    const pats = results.filter((r) => r.kind === 'pattern');
    const i = pats.findIndex((r) => r.id === id);
    if (i < 0) return {};
    return {
      prev: i > 0 ? { id: pats[i - 1].id, headword: pats[i - 1].headword } : undefined,
      next: i < pats.length - 1 ? { id: pats[i + 1].id, headword: pats[i + 1].headword } : undefined,
    };
  }

  private walkTo(id: string): void {
    this.selectedId = id;
    this.stopAudio();
    this.rerender();
  }

  /**
   * §28 S4: open this panel directly on one catalog entry. The door back that a
   * class badge on any other surface (X card, tray, dictionary) needs in order
   * to be an action rather than decoration.
   */
  openAt(id: string): void {
    this.selectedId = id;
    this.stopAudio();
    if (this.container) this.render(this.container);
  }

  private renderKeyHints(parent: HTMLElement, hints: ReadonlyArray<readonly [string, string]>): void {
    const keys = parent.createDiv('jp-dm-keys jp-lex-keys');
    for (const [key, label] of hints) {
      const chip = keys.createSpan('jp-dm-key');
      chip.createEl('kbd', { text: key });
      chip.createSpan({ text: label });
    }
  }

  /** §23.5 Pencil hand: horizontal swipe on a candidate row — right=✓ left=✕.
   *  Only claims clearly-horizontal drags so the list still scrolls. */
  private bindSwipe(row: HTMLElement, onYes: () => void, onNo: () => void): void {
    row.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const pid = e.pointerId, x0 = e.clientX, y0 = e.clientY;
      let claimed = false;
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (!claimed) {
          if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          claimed = true;
          try { row.setPointerCapture(pid); } catch { /* */ }
        }
        row.style.transform = `translateX(${dx}px)`;
        row.toggleClass('jp-lex-swipe-yes', dx > 60);
        row.toggleClass('jp-lex-swipe-no', dx < -60);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        row.removeEventListener('pointermove', onMove);
        row.removeEventListener('pointerup', onUp);
        row.removeEventListener('pointercancel', onUp);
        const dx = ev.clientX - x0;
        row.style.transform = '';
        row.removeClass('jp-lex-swipe-yes');
        row.removeClass('jp-lex-swipe-no');
        if (!claimed) return;
        if (dx > 60) onYes();
        else if (dx < -60) onNo();
      };
      row.addEventListener('pointermove', onMove);
      row.addEventListener('pointerup', onUp);
      row.addEventListener('pointercancel', onUp);
    });
  }

  dispose(): void { this.stopAudio(); this.cancelPeek(); }

  private stopAudio(): void {
    if (this.audio) { this.audio.pause(); this.audio.src = ''; this.audio = null; }
    this.playingKey = null;
  }

  private rerender(): void { if (this.container) this.render(this.container); }

  // ── list view ──────────────────────────────────────────────
  private renderList(root: HTMLElement): void {
    // search row
    const searchRow = root.createDiv('jp-lex-searchrow');
    const input = searchRow.createEl('input', {
      type: 'search',
      cls: 'jp-lex-search',
      attr: { placeholder: '辞書・台帳・語を検索…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search' },
    });
    input.value = this.query;
    const acEl = searchRow.createDiv('jp-lex-ac');
    acEl.style.display = 'none';

    input.addEventListener('input', () => {
      this.query = input.value;
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.refreshListBody(root, acEl, input), 90);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { input.value = ''; this.query = ''; this.refreshListBody(root, acEl, input); }
      else if (e.key === 'Enter') { acEl.style.display = 'none'; this.refreshListBody(root, acEl, input); }
    });

    // search-mode chips (§20.1): 前方一致 / 含む / 用例全文
    const modeRow = searchRow.createDiv('jp-lex-modes');
    const modeDefs: Array<[SearchMode, string, string]> = [
      ['prefix', '前方', '前方一致 — 見出しの頭から'],
      ['contains', '含む', '見出しに含まれる'],
      ['quotes', '用例', '確定用例の全文を検索'],
    ];
    for (const [m, label, title] of modeDefs) {
      const b = modeRow.createEl('button', {
        text: label, attr: { title },
        cls: 'jp-lex-mode' + (this.mode === m ? ' jp-lex-mode--active' : ''),
      });
      b.onclick = () => { this.mode = m; this.rerender(); };
    }

    // facets
    const facets = root.createDiv('jp-lex-facets');
    this.renderFacets(facets);

    // §23.5: the keyboard hand, discoverable in place
    this.renderKeyHints(root, [['/', '検索'], ['j/k', '移動'], ['⏎', '開く']]);

    // stats + list body (+ あかさたな rail in browse mode)
    const stats = root.createDiv('jp-lex-stats');
    const listWrap = root.createDiv('jp-lex-listwrap');
    const body = listWrap.createDiv('jp-lex-list');
    this.fillList(body, stats, listWrap);

    // keep references for incremental refresh
    (root as HTMLElement & { _lexBody?: HTMLElement; _lexStats?: HTMLElement })._lexBody = body;
    (root as HTMLElement & { _lexBody?: HTMLElement; _lexStats?: HTMLElement })._lexStats = stats;
  }

  private refreshListBody(root: HTMLElement, acEl: HTMLElement, input: HTMLInputElement): void {
    // autocomplete dropdown
    const ac = autocomplete({ patterns: this.deps.patterns(), collocations: this.deps.collocations(), classes: [...this.classes], sources: [...this.sources], query: this.query });
    acEl.empty();
    if (ac.length && this.query.trim()) {
      acEl.style.display = '';
      for (const s of ac) {
        const row = acEl.createDiv('jp-lex-ac-row');
        if (s.cls) this.dot(row, s.cls);
        row.createSpan({ text: s.headword, cls: 'jp-lex-ac-hw' });
        if (s.attestationCount) row.createSpan({ text: `×${s.attestationCount}`, cls: 'jp-lex-ac-count' });
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = s.headword; this.query = s.headword;
          acEl.style.display = 'none';
          if (s.kind === 'pattern') { this.selectedId = s.id; this.rerender(); }
          else this.rerenderListOnly(root);
        });
      }
    } else {
      acEl.style.display = 'none';
    }
    this.rerenderListOnly(root);
  }

  private rerenderListOnly(root: HTMLElement): void {
    const r = root as HTMLElement & { _lexBody?: HTMLElement; _lexStats?: HTMLElement };
    if (r._lexBody && r._lexStats) this.fillList(r._lexBody, r._lexStats, r._lexBody.parentElement ?? undefined);
  }

  private renderFacets(facets: HTMLElement): void {
    const chip = (label: string, active: boolean, color: string | null, onClick: () => void, title?: string) => {
      const b = facets.createEl('button', { cls: 'jp-lex-chip' + (active ? ' jp-lex-chip--active' : '') });
      b.setText(label);
      if (active && color) { b.style.borderColor = color; b.style.color = color; }
      if (title) b.title = title;
      b.onclick = onClick;
    };
    const pats = this.deps.patterns();
    chip('すべて', this.classes.size === 0 && this.sources.size === 0, null, () => { this.classes.clear(); this.sources.clear(); this.rerender(); });
    for (const c of NOTE_CLASSES) {
      const n = pats.filter((p) => p.class === c).length;
      if (!n && !this.classes.has(c)) continue;
      chip(`${NOTE_TYPES[c].emoji} ${n}`, this.classes.has(c), classColor(c), () => {
        this.classes.has(c) ? this.classes.delete(c) : this.classes.add(c);
        this.rerender();
      }, NOTE_TYPES[c].label);
    }
    const srcDefs: Array<[SrcFilter, string, string]> = [['yt', '▶', 'YouTube'], ['x', '𝕏', 'ツイート'], ['web', '🌐', 'ウェブ'], ['manual', '✍', '手動']];
    for (const [id, label, title] of srcDefs) {
      chip(label, this.sources.has(id), '#666', () => {
        this.sources.has(id) ? this.sources.delete(id) : this.sources.add(id);
        this.rerender();
      }, title);
    }
  }

  /** gojūon group for the scrubber rail; kanji-initial keys go under 漢. */
  private kanaGroup(headword: string): string {
    const c = (headword.normalize('NFC')[0] ?? '').replace(/[ァ-ヶ]/, (k) => String.fromCharCode(k.charCodeAt(0) - 0x60));
    if (c >= 'ぁ' && c <= 'お') return 'あ';
    if (c >= 'か' && c <= 'ご') return 'か';
    if (c >= 'さ' && c <= 'ぞ') return 'さ';
    if (c >= 'た' && c <= 'ど') return 'た';
    if (c >= 'な' && c <= 'の') return 'な';
    if (c >= 'は' && c <= 'ぽ') return 'は';
    if (c >= 'ま' && c <= 'も') return 'ま';
    if (c >= 'ゃ' && c <= 'よ') return 'や';
    if (c >= 'ら' && c <= 'ろ') return 'ら';
    if (c >= 'ゎ' && c <= 'ん') return 'わ';
    return '漢';
  }

  private fillList(body: HTMLElement, stats: HTMLElement, listWrap?: HTMLElement): void {
    body.empty();
    stats.empty();
    listWrap?.querySelector('.jp-lex-rail')?.remove();
    const browse = !this.query.trim();
    let results = unifiedSearch({
      patterns: this.deps.patterns(),
      collocations: this.deps.collocations(),
      classes: [...this.classes],
      sources: [...this.sources],
      query: this.query,
      mode: this.mode,
      limit: 300,
    });
    // browse mode = the monokakido INDEX: gojūon order + scrubber rail
    if (browse) {
      results = [...results].sort((a, b) =>
        this.kanaGroup(a.headword).localeCompare(this.kanaGroup(b.headword), 'ja') ||
        a.headword.localeCompare(b.headword, 'ja'));
    }

    // dictionary hits (only when actively querying and no class/source facet)
    const dict = this.query.trim() && this.classes.size === 0 && this.sources.size === 0
      ? this.deps.dictLookup(this.query.trim()) : [];

    stats.createSpan({ text: `${results.length}語` + (dict.length ? ` ・ 辞書 ${dict.length}` : ''), cls: 'jp-lex-stat-text' });

    if (results.length === 0 && dict.length === 0) {
      body.createDiv({ cls: 'jp-lex-empty', text: this.query ? '該当なし' : 'まだ何もありません。台帳にパターンを貯めるか、辞書を取り込んでください。' });
      return;
    }

    for (const e of results) this.renderRow(body, e);

    if (dict.length) {
      const dsec = body.createDiv('jp-lex-dictsec');
      dsec.createDiv({ cls: 'jp-lex-dictsec-title', text: '📖 辞書' });
      for (const d of dict.slice(0, 6)) this.renderDictRow(dsec, d);
    }

    // あかさたな scrubber (browse mode only)
    if (browse && listWrap && results.length > 8) {
      const rail = listWrap.createDiv('jp-lex-rail');
      const present = new Set(results.map((e) => this.kanaGroup(e.headword)));
      for (const g of ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ', '漢']) {
        const item = rail.createDiv({ text: g, cls: 'jp-lex-rail-item' + (present.has(g) ? '' : ' jp-lex-rail-item--empty') });
        if (present.has(g)) {
          item.onclick = () => {
            body.querySelector(`[data-kana="${g}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          };
        }
      }
    }

    if (this.restoreScroll) {
      this.restoreScroll = false;
      body.scrollTop = this.listScroll;
    }
  }

  private renderRow(body: HTMLElement, e: UnifiedEntry): void {
    // monokakido index row (§20.1): class color as a thin left RAIL, dense
    // headword-first typography, separation by whitespace not borders.
    const row = body.createDiv('jp-lex-row');
    row.setAttribute('data-kana', this.kanaGroup(e.headword));
    const rail = row.createSpan({ cls: 'jp-lex-row-rail' });
    rail.style.background = e.cls ? classColor(e.cls) : 'var(--background-modifier-border)';
    if (e.cls) rail.title = NOTE_TYPES[e.cls].label;
    const main = row.createDiv('jp-lex-row-main');
    const top = main.createDiv('jp-lex-row-top');
    top.createSpan({ text: e.headword, cls: 'jp-lex-row-hw' });
    if (e.reading) top.createSpan({ text: e.reading, cls: 'jp-lex-row-reading' });
    if (e.merged) top.createSpan({ text: '📚', cls: 'jp-lex-row-merged', attr: { title: '旧レキシコンの文法ノートと統合済み' } });
    if (e.gloss) main.createDiv({ text: e.gloss, cls: 'jp-lex-row-gloss' });
    // the embedded entry: ONE real usage line — just enough context, no more
    if (e.example) main.createDiv({ text: `「${e.example}」`, cls: 'jp-lex-row-ex' });
    const meta = row.createDiv('jp-lex-row-meta');
    for (const s of e.sources) meta.createSpan({ text: { yt: '▶', x: '𝕏', web: '🌐', manual: '✍' }[s], cls: 'jp-lex-row-src' });
    if (e.attestationCount) meta.createSpan({ text: `×${e.attestationCount}`, cls: 'jp-lex-row-count' });
    row.addEventListener('click', () => {
      this.listScroll = body.scrollTop;
      if (e.kind === 'pattern') { this.selectedId = e.id; this.stopAudio(); this.rerender(); }
      else if (e.collocation) this.renderCollocationDetail(e.collocation);
    });
  }

  private renderDictRow(parent: HTMLElement, d: DictLookupResult): void {
    const row = parent.createDiv('jp-lex-dict-row');
    const top = row.createDiv('jp-lex-row-top');
    top.createSpan({ text: d.term.expression, cls: 'jp-lex-row-hw' });
    if (d.term.reading && d.term.reading !== d.term.expression) top.createSpan({ text: d.term.reading, cls: 'jp-lex-row-reading' });
    if (d.deinflection?.length) top.createSpan({ text: `〈${d.deinflection.join('+')}〉`, cls: 'jp-lex-deinflect' });
    const def = d.term.definitions.map((x) => (typeof x === 'string' ? x : ('text' in x ? (x as { text?: string }).text : ''))).filter(Boolean).join(' / ');
    if (def) row.createDiv({ text: def.slice(0, 120), cls: 'jp-lex-row-gloss' });
    row.addEventListener('click', () => this.deps.openDict(d.term.expression));
  }

  private dot(parent: HTMLElement, cls: NoteClass, ratified = true): void {
    classDot(parent, cls, { ratified });
  }

  // ── detail view ────────────────────────────────────────────
  private renderDetail(root: HTMLElement): void {
    const p = this.deps.patterns().find((x) => x.id === this.selectedId);
    if (!p) { this.selectedId = null; this.renderList(root); return; }
    const def = NOTE_TYPES[p.class];

    // back — restores the list scroll position (§20.1)
    const back = root.createEl('button', { cls: 'jp-lex-back', text: '← 一覧へ' });
    back.onclick = () => { this.selectedId = null; this.restoreScroll = true; this.stopAudio(); this.rerender(); };
    this.renderKeyHints(root, [['j/k', '移動'], ['h/l', '前後の語'], ['⏎', '✓'], ['x', '✕']]);

    // legacy link hoisted: the reading belongs UNDER the headword (§26.1
    // entry anatomy), not in an appendix.
    const legacy = linkLegacy([p], this.deps.collocations()).get(p.id);

    // header — the entry-article headword block (§26.2)
    const head = root.createDiv('jp-lex-detail-head');
    applyClassRail(head, p.class);
    const titleRow = head.createDiv('jp-lex-detail-titlerow');
    this.dot(titleRow, p.class, p.classRatified);
    titleRow.createSpan({ text: p.key, cls: 'jp-lex-detail-hw' });
    // The class control — same chips as the library, the catalog and capture.
    // An entry-article headword block is exactly where the type is decided, so
    // the control lives here rather than behind a dropdown (§26.1 anatomy).
    classChips(head, {
      value: p.class,
      ratified: p.classRatified,
      compact: true,
      onPick: async (cls) => { await this.deps.setClass(p.id, cls); this.rerender(); },
    }).el.addClass('jp-lex-detail-classchips');
    if (legacy?.headwordReading) head.createDiv({ text: legacy.headwordReading, cls: 'jp-lex-detail-reading' });
    // boxed badges row (f12/f40 grammar: shape-coded, data-bearing only)
    const confirmed = p.attestations.filter((a) => !a.status).length;
    const badges = head.createDiv('jp-lex-detail-badges');
    badges.createSpan({ text: def.label, cls: 'jp-lex-badge', attr: { style: `border-color:${def.color};color:${def.color}` } });
    if (confirmed) badges.createSpan({ text: `用例${confirmed}`, cls: 'jp-lex-badge' });
    if (p.payload.family) badges.createSpan({ text: `${p.payload.family}族`, cls: 'jp-lex-badge' });

    // §26.3 space-walking: neighbor pills (thumb corners) + header swipe
    const nb = this.neighborsOf(p.id);
    if (nb.prev || nb.next) {
      const pills = root.createDiv('jp-lex-nbpills');
      if (nb.prev) {
        const b = pills.createEl('button', { cls: 'jp-lex-nbpill jp-lex-nbpill--prev' });
        b.createSpan({ text: '‹ ' });
        b.createSpan({ text: nb.prev.headword, cls: 'jp-lex-nbpill-hw' });
        b.onclick = () => this.walkTo(nb.prev!.id);
      }
      if (nb.next) {
        const b = pills.createEl('button', { cls: 'jp-lex-nbpill jp-lex-nbpill--next' });
        b.createSpan({ text: nb.next.headword, cls: 'jp-lex-nbpill-hw' });
        b.createSpan({ text: ' ›' });
        b.onclick = () => this.walkTo(nb.next!.id);
      }
      // swipe the HEADER (not the body — the body scrolls) to walk
      let sx: number | null = null;
      head.addEventListener('touchstart', (e) => { sx = e.touches[0]?.clientX ?? null; }, { passive: true });
      head.addEventListener('touchend', (e) => {
        if (sx == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? sx) - sx;
        sx = null;
        if (dx > 60 && nb.prev) this.walkTo(nb.prev.id);
        else if (dx < -60 && nb.next) this.walkTo(nb.next.id);
      }, { passive: true });
    }

    // drill: the class-defining payload
    const payloadBits: string[] = [];
    if (p.payload.parts?.length) payloadBits.push('成分: ' + p.payload.parts.join(' 〜 '));
    if (p.payload.frame) payloadBits.push('型: ' + p.payload.frame);
    if (p.payload.lemma) payloadBits.push('レンマ: ' + p.payload.lemma);
    if (p.payload.halo) payloadBits.push('ハロー: ' + p.payload.halo);
    if (p.payload.gloss) payloadBits.push('⟶ ' + p.payload.gloss);
    if (p.note !== p.key) payloadBits.push('メモ: ' + p.note);
    if (payloadBits.length) {
      const pl = head.createDiv('jp-lex-detail-payload');
      for (const b of payloadBits) pl.createDiv({ text: b, cls: 'jp-lex-detail-payload-line' });
    }

    // actions
    const actions = head.createDiv('jp-lex-detail-actions');
    const act = (label: string, title: string, fn: () => void) => {
      const b = actions.createEl('button', { text: label, cls: 'jp-lex-act', attr: { title } });
      b.onclick = fn;
    };
    act('🏷️ 分類・編集', '分類キャプチャで種別/ペイロードを編集', () => this.deps.onReclassify(p));
    act('📖 辞書', '辞書で引く', () => this.deps.openDict(p.payload.lemma ?? p.key));
    // §20.3 Tier A: every finder, one button, all landing in the ✓✕ spine
    act(this.findBusy ? '🔎 検索中…' : '🔎 用例を探す', '全コーパスを今すぐ走査（transcripts + 𝕏）— 提案は候補に入ります', async () => {
      if (this.findBusy) return;
      this.findBusy = true;
      this.rerender();
      try {
        const r = await this.deps.findExamples(p);
        const total = r.swept + r.x;
        this.lastFind = { id: p.id, total };
        new Notice(total
          ? `候補: 走査 ${r.swept}件 ・ 𝕏 ${r.x}件 — ❓候補で ✓✕ してください`
          : '見つかりませんでした — 聞きに行きましょう（下の提案へ）');
      } catch (err) {
        new Notice(`検索失敗: ${String(err)}`);
      } finally {
        this.findBusy = false;
        this.rerender();
      }
    });
    act('📋', 'コピー', () => navigator.clipboard.writeText(p.key).then(() => new Notice('コピーしました')));
    act('🗑', '台帳から削除', async () => { await this.deps.deletePattern(p.id); this.selectedId = null; this.rerender(); });

    // §20.1: 用例 ARE the entry — the context tree is the BODY, directly
    // under the header; grammar notes and everything else come after.
    const tree = buildContextTree(p, this.deps.patterns());
    const terms = [p.key, ...(p.payload.parts ?? []), p.payload.halo ?? '', p.payload.lemma ?? ''].filter((t) => t.length >= 2);
    this.renderTree(root, tree, p.id, terms);

    // §26.2 似ている表現 — the ACE CROWN 似ている単語 box (f40) composed
    // from the user's OWN captures: cross-lemma family members, or the same
    // lemma's other gestures (one lemma licenses several gestures, §7).
    // Members differ precisely in their image — that difference IS the row.
    const sibs = this.deps.patterns().filter((x) =>
      x.id !== p.id && (
        (p.payload.family && x.payload.family === p.payload.family) ||
        (!p.payload.family && p.class === 'rhet_collocation' && p.payload.lemma && x.payload.lemma === p.payload.lemma)
      ));
    if (sibs.length) {
      const title = p.payload.family
        ? `似ている表現 — ${p.payload.family}族（像で使い分け）`
        : `同じレンマの別の身振り — ${p.payload.lemma}`;
      const body = knowledgeBox(root, title, 'family');
      for (const s of [p, ...sibs]) {
        const row = body.createDiv('jp-kbox-family-row' + (s.id === p.id ? ' is-self' : ''));
        row.createSpan({ text: s.key, cls: 'jp-kbox-family-hw' });
        const desc = s.payload.gloss ?? s.payload.halo ?? '';
        if (desc) row.createSpan({ text: desc, cls: 'jp-kbox-family-desc' });
        if (s.id !== p.id) row.onclick = () => this.walkTo(s.id);
      }
    }

    // §26.2 the personal ❗ box — the user's own demonstrated near-misses
    // (✕'d sightings), ×-marked like ACE CROWN's anti-readings (f40). No
    // commercial dictionary can render this; it grows from honest ✕ use.
    if (p.rejectedExamples?.length) {
      const body = knowledgeBox(root, '❗ 違うと判定した形（あなたの✕の記録）', 'warn');
      for (const q of p.rejectedExamples.slice(-3).reverse()) {
        const row = body.createDiv('jp-kbox-warn-row');
        row.createSpan({ text: '×', cls: 'jp-kbox-warn-x' });
        row.createSpan({ text: `「${q}」`, cls: 'jp-kbox-warn-quote' });
      }
    }

    // §20.3 Tier B: a dry Tier-A run turns into a capture assignment —
    // the gap grows the corpus instead of getting papered over.
    if (this.lastFind?.id === p.id && this.lastFind.total === 0) {
      const asg = root.createDiv('jp-lex-assign');
      asg.createDiv({ cls: 'jp-lex-tree-title', text: '🎯 聞きに行く（コーパスにはまだ無い）' });
      const row = asg.createDiv('jp-lex-assign-row');
      const xBtn = row.createEl('button', { text: '𝕏 でライブ検索', cls: 'jp-lex-act' });
      xBtn.onclick = () => this.deps.searchXFor(p);
      if (this.deps.generateScaffold && !p.attestations.some((a) => !a.status)) {
        const gen = row.createEl('button', { text: '⚗ 生成スキャフォールド', cls: 'jp-lex-act', attr: { title: '実例が入るまでの仮例文（生成マーク付き・SRSのみ・実例が入ると自動引退）' } });
        gen.onclick = async () => {
          gen.disabled = true;
          try {
            const n = await this.deps.generateScaffold!(p);
            new Notice(n ? `生成: ${n}文（検証済み） — 実例が入ると自動引退します` : '生成失敗（検証で全滅）');
          } catch (err) { new Notice(`生成失敗: ${String(err)}`); }
          this.rerender();
        };
      }
    }

    // §22.7 語法プロフィール — corpus enrichment, fetched once and frozen
    const goho = p.payload.goho;
    if (goho && (goho.collocates.length || goho.examples.length)) {
      const g = knowledgeBox(root, `語法 — ${goho.source}（取得済み固定）`, 'goho');
      if (goho.collocates.length) {
        const chips = g.createDiv('jp-lex-goho-chips');
        for (const c of goho.collocates) {
          const chip = chips.createEl('button', { text: c, cls: 'jp-lex-goho-chip' });
          chip.onclick = () => this.deps.openDict(c);
        }
      }
      for (const ex of goho.examples) {
        const row = g.createDiv('jp-lex-goho-ex');
        row.createSpan({ text: `「${ex}」`, cls: 'jp-lex-leaf-quote jp-lex-tappable' });
        if (this.deps.captureCorpus) {
          const cap = row.createEl('button', { text: '🏷️', cls: 'jp-lex-leaf-btn', attr: { title: 'この用例を台帳へ（📊 コーパス層）' } });
          cap.onclick = () => this.deps.captureCorpus!(p, ex);
        }
      }
    } else if (goho) {
      // fetched but empty: no box (a box must carry data, §26.0 test e) —
      // one quiet line records the frozen fetch so it isn't re-offered.
      root.createDiv({ cls: 'jp-lex-empty', text: '語法: コーパスに該当なし（取得済み — 再取得しません）' });
    } else if (this.deps.fetchGoho) {
      const btn = root.createEl('button', { text: '📊 語法を取得（コーパス）', cls: 'jp-lex-act' });
      btn.onclick = async () => {
        btn.disabled = true;
        btn.setText('📊 取得中…');
        try {
          const ok = await this.deps.fetchGoho!(p);
          if (!ok) new Notice('語法を取得できませんでした');
        } catch (e) { new Notice(String(e)); }
        this.rerender();
      };
    }

    // 生成 scaffold (§20.3 Tier C): visibly synthetic, never in the tree
    if (p.payload.scaffold?.length) {
      const sc = knowledgeBox(root, '仮例文 — 生成（実例が入ると自動引退）', 'gen');
      for (const line of p.payload.scaffold) {
        const r = sc.createDiv('jp-lex-scaffold-line');
        r.createSpan({ text: '生成', cls: 'jp-lex-gen-badge' });
        r.createSpan({ text: line, cls: 'jp-lex-leaf-quote' });
      }
    }

    // 📚 the linked legacy collocation entry — its grammar notes join the
    // pattern's real attestations (the two worlds, one page)
    if (legacy) {
      const lg = root.createDiv('jp-lex-legacy-block');
      lg.createDiv({ cls: 'jp-lex-tree-title', text: '📚 文法ノート（旧レキシコン）' });
      if (legacy.headwordReading) lg.createDiv({ text: legacy.headwordReading, cls: 'jp-lex-detail-payload-line' });
      const bits: string[] = [];
      if (legacy.headwordPOS) bits.push(`品詞: ${legacy.headwordPOS}`);
      if (legacy.pattern) bits.push(`型: ${legacy.pattern}`);
      if (legacy.notes) bits.push(legacy.notes);
      for (const b of bits) lg.createDiv({ text: b, cls: 'jp-lex-detail-payload-line' });
      for (const ex of (legacy.exampleSentences ?? []).slice(0, 3)) {
        const exEl = lg.createDiv({ text: `「${ex}」`, cls: 'jp-lex-row-ex jp-lex-tappable' });
        exEl.addEventListener('click', (evt) => this.tapLookup(evt));
      }
    }
  }

  /**
   * 飛び込み (§20.1): tap a word inside a quote → longest-match dictionary
   * lookup from the tapped character (deinflection-validated by the dict
   * layer). No tokenizer guessing — if the dictionary can't resolve it,
   * nothing happens.
   */
  private tapLookup(evt: MouseEvent): void {
    const hit = this.wordAt(evt.clientX, evt.clientY);
    if (hit) this.deps.openDict(hit.term.expression);
  }

  /** Longest dictionary-validated word at a screen point (shared by tap
   *  飛び込み and hover peek — no tokenizer guessing, dictionary or nothing). */
  private wordAt(x: number, y: number): DictLookupResult | null {
    const range = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null })
      .caretRangeFromPoint?.(x, y);
    const node = range?.startContainer;
    if (!range || !node || node.nodeType !== Node.TEXT_NODE) return null;
    const text = node.textContent ?? '';
    const off = Math.min(range.startOffset, Math.max(0, text.length - 1));
    for (let n = Math.min(8, text.length - off); n >= 1; n--) {
      const probe = text.slice(off, off + n).trim();
      if (!probe || !/[぀-ヿ㐀-䶿一-鿿]/.test(probe)) continue;
      const hits = this.deps.dictLookup(probe);
      if (hits.length) return hits[0];
    }
    return null;
  }

  // ── §26.3 hover peek (shared component; mouse/Pencil only, never touch) ──
  private peek: HoverPeek | null = null;
  private cancelPeek(): void { this.peek?.cancel(); }

  private renderTree(root: HTMLElement, tree: ContextTree, patternId: string, terms: string[]): void {
    const sec = root.createDiv('jp-lex-tree');
    sec.createDiv({ cls: 'jp-lex-tree-title', text: `用例 (${tree.totalLeaves})` });
    if (tree.totalLeaves === 0) {
      sec.createDiv({ cls: 'jp-lex-empty', text: 'まだ用例がありません。🔎 用例を探す、⚡ 照合、𝕏 join で集まります。' });
    }
    for (const g of tree.groups) {
      const grp = sec.createEl('details', { cls: 'jp-lex-tree-group' });
      grp.open = true;
      const sum = grp.createEl('summary', { cls: 'jp-lex-tree-sum' });
      sum.createSpan({ text: g.label, cls: 'jp-lex-tree-label' });
      sum.createSpan({ text: `${g.leaves.length}${g.overflow ? `+${g.overflow}` : ''}`, cls: 'jp-lex-tree-count' });
      for (const leaf of g.leaves) this.renderLeaf(grp, leaf, terms);
    }

    // 候補 — machine-suggested sightings, quarantined until the user runs the
    // semantic test. Collapsed by default; each row is one tap to ✓/✕.
    if (tree.candidates.length) {
      const cand = sec.createEl('details', { cls: 'jp-lex-tree-group jp-lex-cand-group' });
      const sum = cand.createEl('summary', { cls: 'jp-lex-tree-sum' });
      sum.createSpan({ text: '❓ 候補（走査の提案 — ✓確定 / ✕否認）', cls: 'jp-lex-tree-label' });
      sum.createSpan({ text: `${tree.candidates.length}`, cls: 'jp-lex-tree-count' });
      for (const leaf of tree.candidates) this.renderLeaf(cand, leaf, terms, patternId);
    }

    // constellation
    if (tree.constellation.length) {
      const con = root.createDiv('jp-lex-constellation');
      con.createDiv({ cls: 'jp-lex-tree-title', text: '🔗 共起（同じ動画に出た他のパターン）' });
      const grid = con.createDiv('jp-lex-con-grid');
      for (const c of tree.constellation) {
        const chip = grid.createEl('button', { cls: 'jp-lex-con-chip' });
        chip.createSpan({ text: c.key, cls: 'jp-lex-con-key' });
        chip.createSpan({ text: `×${c.sharedFiles}`, cls: 'jp-lex-con-count' });
        chip.onclick = () => { this.selectedId = c.patternId; this.stopAudio(); this.rerender(); };
      }
    }
  }

  private renderLeaf(parent: HTMLElement, leaf: ContextLeaf, terms: string[], candidateOf?: string): void {
    const row = parent.createDiv('jp-lex-leaf');
    if (leaf.suggested && candidateOf) {
      row.addClass('jp-lex-leaf-cand');
      const kind = leaf.att.matchKind ? ` (${leaf.att.matchKind}${leaf.att.confidence != null ? ` ${(leaf.att.confidence * 100).toFixed(0)}%` : ''})` : '';
      row.createSpan({ text: '❓', cls: 'jp-lex-leaf-mark', attr: { title: `走査の提案${kind} — 本物か判断してください` } });
    } else if (leaf.swept) row.createSpan({ text: '🔍', cls: 'jp-lex-leaf-mark', attr: { title: '走査で発見（自分のアンカーではない）' } });
    const q = row.createSpan({ text: leaf.quote, cls: 'jp-lex-leaf-quote jp-lex-tappable', attr: { title: '語をタップ → 辞書（飛び込み）' } });
    q.addEventListener('click', (evt) => { evt.stopPropagation(); this.tapLookup(evt); });
    const meta = row.createDiv('jp-lex-leaf-meta');
    // §20.2: expand the leaf into its REAL context (±2 turns, ratified
    // speakers when available, inflection-aware highlight, audio in place)
    const isManga = (leaf.att.medium ?? leaf.att.source) === 'manga' && !!leaf.att.scene?.image;
    if ((leaf.source === 'yt' && leaf.file) || isManga) {
      const expand = meta.createEl('button', { cls: 'jp-lex-leaf-btn', attr: { title: isManga ? '文脈を開く（コマ画像）' : '文脈を開く（前後のターン）' } });
      setIcon(expand, 'chevrons-up-down');
      let ctxEl: HTMLElement | null = null;
      expand.onclick = (e) => {
        e.stopPropagation();
        if (ctxEl) { ctxEl.remove(); ctxEl = null; return; }
        ctxEl = parent.createDiv('jp-lex-leaf-ctx');
        row.insertAdjacentElement('afterend', ctxEl);
        void renderContextWindow(ctxEl, leaf.att, terms, {
          app: this.app,
          parseLines: this.deps.parseLines,
          loadSeg: this.deps.loadSeg,
          bubblesFor: this.deps.bubblesFor,
          onAudio: leaf.clipEligible ? (att, btn) => { void this.toggleClip(leaf, btn as HTMLButtonElement); } : undefined,
          onOpen: (att) => { void this.deps.openAttestation(att).catch((err) => new Notice(String(err))); },
        });
      };
    }
    if (leaf.tStartSec != null) {
      meta.createSpan({ text: `${Math.floor(leaf.tStartSec / 60)}:${String(Math.floor(leaf.tStartSec % 60)).padStart(2, '0')}`, cls: 'jp-lex-leaf-time' });
    }
    if (leaf.clipEligible) {
      const play = meta.createEl('button', { cls: 'jp-lex-leaf-btn', attr: { title: '音声クリップを再生' } });
      setIcon(play, this.playingKey === this.leafKey(leaf) ? 'pause' : 'play');
      play.onclick = (e) => { e.stopPropagation(); void this.toggleClip(leaf, play); };
    }
    const jump = meta.createEl('button', { cls: 'jp-lex-leaf-btn', attr: { title: '出典を開く' } });
    setIcon(jump, leaf.source === 'x' || leaf.source === 'web' ? 'external-link' : 'corner-down-right');
    jump.onclick = (e) => { e.stopPropagation(); void this.deps.openAttestation(leaf.att).catch((err) => new Notice(String(err))); };
    if (leaf.suggested && candidateOf) {
      const yes = meta.createEl('button', { text: '✓', cls: 'jp-lex-leaf-btn jp-lex-cand-yes', attr: { title: '本物 — 確定用例にする（キー: ⏎ / 右スワイプ）' } });
      yes.onclick = async (e) => { e.stopPropagation(); await this.deps.ratifyAttestation(candidateOf, leaf.att); new Notice('✓ 確定しました'); this.rerender(); };
      const no = meta.createEl('button', { text: '✕', cls: 'jp-lex-leaf-btn jp-lex-cand-no', attr: { title: '違う — 否認（再提案されません）（キー: x / 左スワイプ）' } });
      no.onclick = async (e) => { e.stopPropagation(); await this.deps.rejectAttestation(candidateOf, leaf.att); this.rerender(); };
      // §23.5 Pencil hand: swipe the row — right=✓ left=✕
      this.bindSwipe(row,
        () => { void this.deps.ratifyAttestation(candidateOf, leaf.att).then(() => { new Notice('✓ 確定しました'); this.rerender(); }); },
        () => { void this.deps.rejectAttestation(candidateOf, leaf.att).then(() => this.rerender()); });
    }
  }

  private leafKey(leaf: ContextLeaf): string { return `${leaf.file ?? leaf.url ?? ''}|${leaf.tStartSec ?? ''}`; }

  private async toggleClip(leaf: ContextLeaf, btn: HTMLButtonElement): Promise<void> {
    const key = this.leafKey(leaf);
    if (this.playingKey === key) { this.stopAudio(); setIcon(btn, 'play'); return; }
    const clip = await this.deps.resolveClip(leaf.att);
    if (!clip) { new Notice('音声クリップが未取得です（Download Audio Clips を実行）', 5000); return; }
    this.stopAudio();
    this.audio = new Audio(clip.src);
    this.playingKey = key;
    setIcon(btn, 'pause');
    this.audio.onended = () => { if (this.playingKey === key) { this.stopAudio(); setIcon(btn, 'play'); } };
    this.audio.play().catch(() => new Notice('再生に失敗しました'));
  }

  // ── legacy collocation detail (kept usable) ──
  private renderCollocationDetail(c: CollocationEntry): void {
    if (!this.container) return;
    const root = this.container;
    root.empty();
    const back = root.createEl('button', { cls: 'jp-lex-back', text: '← 一覧へ' });
    back.onclick = () => this.rerender();
    const head = root.createDiv('jp-lex-detail-head');
    const titleRow = head.createDiv('jp-lex-detail-titlerow');
    titleRow.createSpan({ text: '📚', cls: 'jp-lex-row-legacy' });
    titleRow.createSpan({ text: c.fullPhrase || c.headword, cls: 'jp-lex-detail-hw' });
    if (c.headwordReading) head.createDiv({ text: c.headwordReading, cls: 'jp-lex-detail-payload-line' });
    const bits: string[] = [];
    if (c.headwordPOS) bits.push(`品詞: ${c.headwordPOS}`);
    if (c.pattern) bits.push(`型: ${c.pattern}`);
    if (c.notes) bits.push(c.notes);
    if (bits.length) { const pl = head.createDiv('jp-lex-detail-payload'); for (const b of bits) pl.createDiv({ text: b, cls: 'jp-lex-detail-payload-line' }); }
    const actions = head.createDiv('jp-lex-detail-actions');
    const dictBtn = actions.createEl('button', { text: '📖 辞書', cls: 'jp-lex-act' });
    dictBtn.onclick = () => this.deps.openDict(c.headword);
    if (c.exampleSentences?.length) {
      const sec = root.createDiv('jp-lex-tree');
      sec.createDiv({ cls: 'jp-lex-tree-title', text: `用例 (${c.exampleSentences.length})` });
      for (const ex of c.exampleSentences) sec.createDiv({ text: ex, cls: 'jp-lex-leaf-quote jp-lex-legacy-ex' });
    }
  }
}
