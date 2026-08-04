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
import type { BigDictHit, BigFrameHit } from '../dictionary/big-dict.ts';
import { unifiedSearch, autocomplete, linkLegacy, type UnifiedEntry, type SearchMode } from '../lexicon/unified-search.ts';
import { buildContextTree, buildUsageProfile, type ContextTree, type ContextLeaf, type UsageProfile } from '../lexicon/context-tree.ts';
import { foldParadigms, paradigmSurface, type Paradigm } from '../lexicon/paradigm.ts';
import { renderXUsage } from './x-usage-panel.ts';
import type { XUsage } from '../x/usage.ts';
import { knowledgeBox } from './knowledge-box.ts';
import { HoverPeek, definitionsPreview } from './hover-peek.ts';
import { attachDropRouter } from './drop-router.ts';
import { attachSelectionEcho } from './selection-echo.ts';
import { thumbDock } from './view-chrome.ts';
import { pointerDragActive } from './pointer-drag.ts';
import { makeDraggable } from './drag-out.ts';
import type { DropIntent } from '../notes/drop-intent.ts';
import type { GohoFrame, GohoMeasured, GohoExample } from '../scraper/goho.ts';

/** Host of a URL, for citing a corpus sentence whose document has no title. */
const hostOf = (url?: string): string => {
  if (!url) return '';
  try { return new URL(url).host.replace(/^www\d*\./, ''); } catch { return ''; }
};

type SrcFilter = 'yt' | 'x' | 'web' | 'manual';

/**
 * How many rows one list render will build.
 *
 * Not a performance number — an honesty number. Whatever it is, hitting it
 * means the list is showing a PREFIX, and the stat line has to say so rather
 * than printing the cap as if it were the total (§28 S6). 600 clears the
 * current catalog with room to grow; the day it stops doing so, the line above
 * the list will be the thing that says it.
 */
const LIST_LIMIT = 600;

/** What the 並び row offers. `auto` defers to whether a query is running. */
type SortMode = 'auto' | 'kana' | 'new' | 'count' | 'cls';

/** How the 語法 box ranks its collocate chips. */
type GohoSort = 'freq' | 'dice';

/**
 * Collocation rows one frame shows before you ask for the rest.
 *
 * Not a storage limit — the frame holds `FRAME_ITEMS` either way. It is a DOM
 * limit: six frames at 24 rows is 144 rows, each of which is a flex row with
 * four children AND a drag source with its own listeners. That is enough to
 * make an entry detail visibly slow to open and to scroll, on a surface whose
 * whole promise is that it answers instantly. Twelve reads as a list; the rest
 * are one tap away and the count says how many.
 */
const GOHO_PAGE = 12;
/** `auto` resolved against the current query — never `auto` itself. */
type EffectiveSort = 'kana' | 'new' | 'count' | 'cls' | 'score';

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
  /**
   * §29 — the drag road. Anything carried onto this panel (from Apple Notes
   * across a Stage Manager seam, from Safari, from another plugin surface) is
   * classified by `drop-intent` and executed by main.ts. The panel's only
   * contribution is `where`: which entry the nib was over, because that is the
   * one fact the executor cannot derive.
   */
  onDrop?: (intent: DropIntent, files: File[], where?: { patternId?: string }) => void;
  /** Capabilities, so a target that cannot run is never drawn (§28 S6). */
  dropCan?: () => { ocr?: boolean; x?: boolean };
  /**
   * §29.2 — the 𝕏 corpus panel for this entry. Absent (or null) when the
   * corpus has nothing on it, which renders as no box rather than an empty one.
   */
  xUsage?: (p: PatternEntry) => XUsage | null;
  /** Attach ONE concordance line as a 用例 — a window, never a whole tweet. */
  attachXLine?: (p: PatternEntry, quote: string, url: string, handle: string) => void;
  openUrl?: (url: string) => void;
  /** ── §20.3: the 用例 finder cascade ── */
  /** Tier A: run every finder for this entry NOW; returns NEW suggestion counts. */
  findExamples: (p: PatternEntry) => Promise<{ swept: number; x: number }>;
  /** Tier B: open the X view with a prefilled live query for this pattern. */
  searchXFor: (p: PatternEntry) => void;
  /** Tier C: 生成 scaffold (absent = no API key configured). */
  generateScaffold?: (p: PatternEntry) => Promise<number>;
  /** §22.7: fetch + freeze the 語法プロフィール (absent = corpus disabled). */
  fetchGoho?: (p: PatternEntry) => Promise<boolean>;
  /**
   * §22.7 drill: fetch ONE indexed pattern's collocations and freeze them.
   *
   * The index names every way the word attaches; this opens one of them. A
   * rate-limited round trip, so it happens when you ask, not up front for
   * twenty patterns you will not read.
   */
  drillPattern?: (p: PatternEntry, patternId: string) => Promise<boolean>;
  /** §22.7 drill: fetch ONE collocation's attested sentences and freeze them. */
  drillExamples?: (
    p: PatternEntry,
    frameLabel: string,
    collocation: { id: string; text: string; freq: number },
  ) => Promise<boolean>;
  /** §22.7: capture a corpus example as a curated-stratum attestation. */
  captureCorpus?: (
    p: PatternEntry,
    example: string,
    /** the document the sentence actually came from, when the source said. */
    prov?: { sourceName?: string; url?: string },
  ) => void;
  /**
   * §27.5 — the big vault-sidecar dictionaries. ASYNC by nature: each query is
   * a file read, so the panel renders first and fills this in when it lands.
   * Absent = none converted yet, and the section simply never appears.
   */
  bigDict?: {
    lookup: (q: string, limit?: number) => Promise<BigDictHit[]>;
    frame: (frame: string, limit?: number) => Promise<BigFrameHit[]>;
  };
  /** One-tap capture of a curated reach-for candidate, class hint pre-selected. */
  onCaptureCandidate?: (surface: string, intention: string, cls: NoteClass, dictionary: string) => void;
}

export class LexiconPanel {
  private query = '';
  private mode: SearchMode = 'prefix';       // monokakido default: 前方一致
  /**
   * §20.1 — how the list is ordered, as an explicit choice rather than an
   * emergent property of whether the search box happens to be empty.
   *
   * `auto` keeps the old behaviour (relevance while searching, 五十音 while
   * browsing) because that is the right default; the other modes exist because
   * the two questions a catalog gets asked most — "what did I add lately" and
   * "what have I actually seen a lot of" — had no answer at all before.
   */
  private sort: SortMode = 'auto';
  /** Roomier type for reading rather than scanning (§20.1 readability). */
  private roomy = false;
  private classes = new Set<NoteClass>();
  private sources = new Set<SrcFilter>();
  private selectedId: string | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  /** §29.1 — which paradigm families are expanded. Ids, not indices, so the
   *  state survives re-sorting and re-filtering. */
  private openParadigms = new Set<string>();
  /** list scroll position, restored on back-from-detail (§20.1). */
  private listScroll = 0;
  private restoreScroll = false;
  /** last Tier-A run for the open entry: 0 total → show Tier-B assignments. */
  private lastFind: { id: string; total: number } | null = null;
  private findBusy = false;
  /** guards a late shard read from landing on a newer query. */
  private bigToken = 0;

  private container: HTMLElement | null = null;
  private audio: HTMLAudioElement | null = null;
  private playingKey: string | null = null;
  /** §22.7 — how the 語法 box ranks its chips. Defaults to what the source
   *  shipped; see the toggle for why it is offered rather than applied. */
  private gohoSort: GohoSort = 'freq';
  /** Which 語法 frames have been expanded past `GOHO_PAGE`. Keyed by pattern id
   *  or head line, so the state survives a re-sort. */
  private gohoOpen = new Set<string>();

  constructor(private app: App, private deps: LexiconDeps) {}

  /** Full render into `container` (state is preserved across calls). */
  render(container: HTMLElement): void {
    this.container = container;
    container.empty();
    container.addClass('jp-lex');
    container.toggleClass('jp-lex--roomy', this.roomy);
    // §23.5 keyboard hand: attach once per container
    const c = container as HTMLElement & { _lexKeys?: boolean };
    if (!c._lexKeys) {
      c._lexKeys = true;
      container.tabIndex = 0;
      container.addEventListener('keydown', (e) => this.onKey(e));
      // §29 Pencil hand: the surface blooms into targets when you carry
      // something over it. On a detail it can take the phrase as a 用例; on the
      // list it classifies; a YouTube link is a video wherever it lands.
      if (this.deps.onDrop) {
        const surface = (): 'entry' | 'lexicon' => (this.selectedId ? 'entry' : 'lexicon');
        const entryKey = (): string | undefined =>
          this.selectedId ? this.deps.patterns().find((p) => p.id === this.selectedId)?.key : undefined;
        const can = (): { ocr?: boolean; x?: boolean } => this.deps.dropCan?.() ?? {};
        attachDropRouter(container, {
          surface, entryKey, can,
          run: (intent, files) => this.deps.onDrop!(intent, files, { patternId: this.selectedId ?? undefined }),
        });
        // §26.3 step 4 — highlight part of a 用例 and act on it in place. The
        // detail view is full of other people's sentences; the useful unit is
        // usually a fragment of one, and there was no verb for a fragment.
        attachSelectionEcho(container, {
          surface, entryKey, can,
          run: (intent) => this.deps.onDrop!(intent, [], { patternId: this.selectedId ?? undefined }),
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
      limit: LIST_LIMIT,
    });
    results = this.sortedResults(results, !this.query.trim());
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
        // A carry has taken this press. Both gestures drive the row's
        // transform, and two things animating one property fight over it —
        // the carry started first and it wins.
        if (pointerDragActive()) { row.style.transform = ''; return; }
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
    // search row — §26.3: docked under the thumb on a phone, where the most
    // used control on this surface belongs. `thumbDock` is null everywhere
    // else, so on desktop and iPad this is the row exactly where it was.
    const dock = thumbDock(root);
    const searchRow = (dock ?? root).createDiv('jp-lex-searchrow');
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
    this.renderSortRow(root);

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

  /**
   * §20.1 — the order, said out loud.
   *
   * The list used to be sorted one way while searching and another way while
   * browsing, with no way to ask for either deliberately. That is fine as a
   * default and useless as the only option: "the twelve things I added this
   * week" and "the things I have actually met twenty times" are the two views a
   * catalog of your own noticing is for, and neither was reachable.
   */
  private renderSortRow(root: HTMLElement): void {
    const row = root.createDiv('jp-lex-sortrow');
    row.createSpan({ text: '並び', cls: 'jp-lex-sortlabel' });
    const defs: Array<[SortMode, string, string]> = [
      ['auto', '既定', '検索中は関連度、一覧は五十音'],
      ['kana', '五十音', '見出しの読み順（漢字始まりは末尾の 漢 に）'],
      ['new', '新着', '最近さわったものから'],
      ['count', '用例', '確定用例の多いものから'],
      ['cls', '分類', 'レンズごとにまとめ、その中は五十音'],
    ];
    for (const [id, label, title] of defs) {
      const b = row.createEl('button', {
        text: label,
        attr: { title },
        cls: 'jp-lex-sort' + (this.sort === id ? ' jp-lex-sort--active' : ''),
      });
      b.onclick = () => { this.sort = id; this.rerender(); };
    }
    // Reading vs scanning. Same rows, bigger type and more air — the catalog is
    // read on a tablet as often as it is scanned on a laptop.
    const roomy = row.createEl('button', {
      text: this.roomy ? '👁 ゆったり' : '👁 標準',
      attr: { title: '字を大きく、行間を広く（読むとき向け）' },
      cls: 'jp-lex-sort jp-lex-sort--roomy' + (this.roomy ? ' jp-lex-sort--active' : ''),
    });
    roomy.onclick = () => { this.roomy = !this.roomy; this.rerender(); };
  }

  /** Rank order for 分類 grouping — the lens order the rest of the UI uses. */
  private clsRank(cls?: NoteClass): number {
    const i = cls ? NOTE_CLASSES.indexOf(cls) : -1;
    return i < 0 ? NOTE_CLASSES.length : i;
  }

  /** When this entry was last touched, for 新着. */
  private touchedAt(e: UnifiedEntry): number {
    const p = e.pattern;
    if (p) return p.updatedAt ?? p.createdAt ?? Math.max(0, ...(p.attestations ?? []).map((a) => a.addedAt ?? 0));
    // The legacy lexicon stamps updatedAt/createdAt, not addedAt — reading the
    // latter gave every collocation the same 0 and sorted them arbitrarily.
    return e.collocation?.updatedAt ?? e.collocation?.createdAt ?? 0;
  }

  /**
   * The effective order. `auto` means two different things depending on whether
   * there is a query, and everything downstream — the comparator, the group
   * headers, the あかさたな rail — has to agree about which one is in force. One
   * function, so they cannot drift: headers keyed off a different answer than
   * the sort produces scatter 「か」 through relevance-ordered results.
   */
  private resolveSort(browse: boolean): EffectiveSort {
    return this.sort === 'auto' ? (browse ? 'kana' : 'score') : this.sort;
  }

  /**
   * One place that decides list order, so the visible list and the h/l
   * neighbour walk cannot disagree — a detail pane that says "next: X" and then
   * a list that puts X somewhere else is worse than no neighbours at all.
   */
  private sortedResults(results: UnifiedEntry[], browse: boolean): UnifiedEntry[] {
    const kana = (a: UnifiedEntry, b: UnifiedEntry) =>
      this.kanaGroup(a.headword).localeCompare(this.kanaGroup(b.headword), 'ja') ||
      a.headword.localeCompare(b.headword, 'ja');
    const mode = this.resolveSort(browse);
    if (mode === 'score') return results;      // unifiedSearch already ranked it
    const out = [...results];
    if (mode === 'kana') out.sort(kana);
    else if (mode === 'new') out.sort((a, b) => this.touchedAt(b) - this.touchedAt(a) || kana(a, b));
    else if (mode === 'count') out.sort((a, b) => b.attestationCount - a.attestationCount || kana(a, b));
    else if (mode === 'cls') out.sort((a, b) => this.clsRank(a.cls) - this.clsRank(b.cls) || kana(a, b));
    return out;
  }

  /** Section header text for the current grouping, or null when ungrouped.
   *  Relevance order has no headers: the sequence is not grouped by anything. */
  private groupOf(e: UnifiedEntry, browse: boolean): string | null {
    const mode = this.resolveSort(browse);
    if (mode === 'kana') return this.kanaGroup(e.headword);
    if (mode === 'cls') return e.cls ? `${NOTE_TYPES[e.cls].emoji} ${NOTE_TYPES[e.cls].label}` : '— 未分類';
    return null;
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
      limit: LIST_LIMIT,
    });
    results = this.sortedResults(results, browse);

    // dictionary hits (only when actively querying and no class/source facet)
    const dict = this.query.trim() && this.classes.size === 0 && this.sources.size === 0
      ? this.deps.dictLookup(this.query.trim()) : [];

    // §28 S6 — a count that silently reports the CAP as the answer is a number
    // counting a failure as a result. `unifiedSearch` stops at LIST_LIMIT, so
    // landing exactly on it means there may be more and the line has to say so.
    const capped = results.length >= LIST_LIMIT;
    stats.createSpan({
      text: (capped ? `${LIST_LIMIT}語以上（上位のみ）` : `${results.length}語`) +
        (dict.length ? ` ・ 辞書 ${dict.length}` : ''),
      cls: 'jp-lex-stat-text',
    });

    if (results.length === 0 && dict.length === 0) {
      body.createDiv({ cls: 'jp-lex-empty', text: this.query ? '該当なし' : 'まだ何もありません。台帳にパターンを貯めるか、辞書を取り込んでください。' });
      return;
    }

    /**
     * Section headers, sticky at the top of the list.
     *
     * The 五十音 rail already existed and already scrolled to `data-kana`
     * anchors — but there was nothing to land ON, so tapping か dropped you into
     * an undifferentiated wall of rows with no way to tell you had arrived. The
     * header is the thing the rail was always pointing at.
     */
    /**
     * §29.1 — the 談話 shelf, folded.
     *
     * 31 of the catalog's 32 discourse entries are sentence-final variants of
     * five or six things (ですね/んですね/ますね/ですよね/よね/だよね/…), and as
     * a flat list they read as noise. `foldParadigms` groups them on what the
     * user's OWN concordance says each form does, with a short declared
     * spelling table as a second axis and the corpus vetoing it on
     * disagreement. Only while BROWSING: once there is a query, the flat list
     * of matches is the answer and folding it would hide the hit.
     */
    const fold = browse ? foldParadigms(results) : null;
    const rows: Array<UnifiedEntry | Paradigm> = fold
      ? [...fold.paradigms, ...fold.loose].sort((a, b) => {
        const key = (x: UnifiedEntry | Paradigm): UnifiedEntry => 'members' in x ? x.members[0] : x;
        return results.indexOf(key(a)) - results.indexOf(key(b));
      })
      : results;

    let group: string | null = null;
    for (const r of rows) {
      const lead = 'members' in r ? r.members[0] : r;
      const g = this.groupOf(lead, browse);
      if (g && g !== group) {
        group = g;
        const h = body.createDiv({ text: g, cls: 'jp-lex-group' });
        h.setAttribute('data-kana', g);
      }
      if ('members' in r) this.renderParadigm(body, r);
      else this.renderRow(body, r);
    }

    if (dict.length) {
      const dsec = body.createDiv('jp-lex-dictsec');
      dsec.createDiv({ cls: 'jp-lex-dictsec-title', text: '📖 辞書' });
      for (const d of dict.slice(0, 6)) this.renderDictRow(dsec, d);
    }

    // ── §27.5 the BIG dictionaries (vault sidecars) ────────────────────────
    // These live in files, so the answer arrives after this render returns. A
    // placeholder is reserved now and filled when the shard read resolves —
    // the panel never blocks on disk, and a slow read degrades to "nothing
    // extra appeared" rather than a frozen list.
    if (this.query.trim() && this.deps.bigDict) {
      const slot = body.createDiv('jp-lex-bigsec');
      void this.fillBigDict(slot, this.query.trim());
    }

    // あかさたな scrubber. The rail belongs to 五十音 order, whether that came
    // from the default or from asking for it — not to "the search box is empty".
    if (this.resolveSort(browse) === 'kana' && listWrap && results.length > 8) {
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

  /**
   * A family row: one line for what six spellings all do, opening into the six.
   *
   * Deliberately NOT a merged entry. Every member keeps its id, its ✓/✕ history
   * and its own detail page (§28 S1) — this row is a lens, and tapping it just
   * shows you the rows that were always there. The basis is printed because a
   * grouping the user cannot audit is a grouping they have to trust blindly,
   * and §12 says never to ask for that.
   */
  private renderParadigm(body: HTMLElement, p: Paradigm): void {
    const open = this.openParadigms.has(p.id);
    const row = body.createDiv('jp-lex-row jp-lex-par');
    row.setAttribute('data-kana', this.kanaGroup(p.members[0].headword));
    const rail = row.createSpan({ cls: 'jp-lex-row-rail' });
    rail.style.background = classColor('discourse');
    const main = row.createDiv('jp-lex-row-main');
    const top = main.createDiv('jp-lex-row-top');
    top.createSpan({ text: open ? '▾' : '▸', cls: 'jp-lex-par-twisty' });
    top.createSpan({ text: paradigmSurface(p), cls: 'jp-lex-row-hw jp-lex-par-hw' });
    top.createSpan({ text: `${p.members.length}語`, cls: 'jp-lex-par-count' });
    main.createDiv({
      cls: 'jp-lex-par-why',
      text: p.basis === 'move'
        // The move IS the meaning of the grouping, so it leads.
        ? `${p.label} — 走査${p.sightings.toLocaleString()}件がそう言っています`
        : '書き方のちがいだけ（けれども・けども・けど など）',
    });
    const meta = row.createDiv('jp-lex-row-meta');
    if (p.attestations) meta.createSpan({ text: `×${p.attestations}`, cls: 'jp-lex-row-count' });
    row.addEventListener('click', () => {
      this.listScroll = body.scrollTop;
      if (open) this.openParadigms.delete(p.id); else this.openParadigms.add(p.id);
      this.restoreScroll = true;
      this.rerender();
    });
    if (!open) return;
    const kids = body.createDiv('jp-lex-par-kids');
    for (const m of p.members) this.renderRow(kids, m);
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
    // §22.7 — this row is here because its frozen 語法 profile matched, not
    // because anything the user wrote did. Saying so is the difference between
    // "you noticed this" and "a corpus lists this under something you noticed";
    // an unmarked row would quietly claim the first (§28 S3).
    if (e.viaCorpus) {
      top.createSpan({
        text: '📊', cls: 'jp-lex-row-corpus',
        attr: { title: '一致したのは語法プロフィール（コーパス）— あなたの記録ではありません' },
      });
    }
    if (e.gloss) main.createDiv({ text: e.gloss, cls: 'jp-lex-row-gloss' });
    // the embedded entry: ONE real usage line — just enough context, no more
    if (e.example) {
      main.createDiv({
        text: `「${e.example}」`,
        cls: 'jp-lex-row-ex' + (e.viaCorpus ? ' jp-lex-row-ex--corpus' : ''),
      });
    }
    const meta = row.createDiv('jp-lex-row-meta');
    for (const s of e.sources) meta.createSpan({ text: { yt: '▶', x: '𝕏', web: '🌐', manual: '✍' }[s], cls: 'jp-lex-row-src' });
    if (e.attestationCount) meta.createSpan({ text: `×${e.attestationCount}`, cls: 'jp-lex-row-count' });
    row.addEventListener('click', () => {
      this.listScroll = body.scrollTop;
      if (e.kind === 'pattern') { this.selectedId = e.id; this.stopAudio(); this.rerender(); }
      else if (e.collocation) this.renderCollocationDetail(e.collocation);
    });
    // §29 the other direction: carry the entry out — into Apple Notes across
    // the Stage Manager seam, into an editor pane, onto another surface. Its
    // one real usage line goes with it, because a headword alone is a word and
    // a headword with its line is a thing you can use.
    makeDraggable(row, () => ({
      kind: 'entry',
      text: e.example ? `${e.headword}\n「${e.example}」` : e.headword,
      label: e.headword,
      sub: e.reading ?? e.gloss,
      html: `<b>${e.headword}</b>${e.reading ? `（${e.reading}）` : ''}${e.gloss ? ` — ${e.gloss}` : ''}` +
        (e.example ? `<blockquote>${e.example}</blockquote>` : ''),
      meta: { patternId: e.kind === 'pattern' ? e.id : undefined, cls: e.cls },
    }));
  }

  /**
   * §27.2 — the production half, from the vault sidecars.
   *
   * Two questions, kept visibly separate because they ARE separate: what does
   * this mean (senses, the look-up half) and what do I reach for (candidates,
   * the frame half). The reach-for list is the one §27.0.1 says the plugin
   * exists for, so it is rendered first and each candidate is one tap into
   * capture with its class hint pre-selected — a curated-stratum catalog object
   * (§27.6), never a separate kind of thing.
   *
   * `token` guards against a stale write: the user keeps typing while a shard
   * read is in flight, and the late answer for an old query must not land.
   */
  private async fillBigDict(slot: HTMLElement, query: string): Promise<void> {
    const big = this.deps.bigDict;
    if (!big) return;
    const token = ++this.bigToken;
    let entries: BigDictHit[] = [];
    let candidates: BigFrameHit[] = [];
    try {
      [entries, candidates] = await Promise.all([big.lookup(query, 8), big.frame(query, 12)]);
    } catch (err) {
      if (token !== this.bigToken || !slot.isConnected) return;
      slot.createDiv({ cls: 'jp-lex-big-error', text: `大型辞書の読み込みに失敗: ${String(err)}` });
      return;
    }
    if (token !== this.bigToken || !slot.isConnected) return;   // superseded
    if (!entries.length && !candidates.length) return;          // silence, not an empty box

    if (candidates.length) {
      const sec = slot.createDiv('jp-lex-bigsec-block');
      sec.createDiv({ cls: 'jp-lex-dictsec-title', text: '🟠 言うなら（型から）' });
      for (const { dictionary, candidate: c } of candidates.slice(0, 8)) {
        const row = sec.createDiv('jp-lex-cand');
        const top = row.createDiv('jp-lex-cand-top');
        classDot(top, c.classHint as NoteClass, { ratified: false });
        top.createSpan({ text: c.surface, cls: 'jp-lex-cand-surface' });
        if (c.shape) top.createSpan({ text: c.shape, cls: 'jp-lex-cand-shape' });
        const meta = row.createDiv('jp-lex-cand-meta');
        if (c.situation) meta.createSpan({ text: `〔${c.situation}〕`, cls: 'jp-lex-cand-situation' });
        meta.createSpan({ text: c.intention, cls: 'jp-lex-cand-intention' });
        meta.createSpan({ text: dictionary, cls: 'jp-lex-cand-dict' });
        if (this.deps.onCaptureCandidate) {
          const cap = row.createEl('button', { text: '🏷️', cls: 'jp-lex-cand-capture' });
          cap.title = `${NOTE_TYPES[c.classHint as NoteClass].label}として台帳へ（提案 — 確定はあなた）`;
          cap.onclick = (e) => {
            e.stopPropagation();
            this.deps.onCaptureCandidate!(c.surface, c.intention, c.classHint as NoteClass, dictionary);
          };
        }
      }
    }

    if (entries.length) {
      const sec = slot.createDiv('jp-lex-bigsec-block');
      sec.createDiv({ cls: 'jp-lex-dictsec-title', text: '📚 大型辞書' });
      for (const { dictionary, entry, deinflection } of entries.slice(0, 6)) {
        const row = sec.createDiv('jp-lex-dict-row');
        const top = row.createDiv('jp-lex-row-top');
        top.createSpan({ text: entry.expression, cls: 'jp-lex-row-hw' });
        if (entry.reading && entry.reading !== entry.expression) {
          top.createSpan({ text: entry.reading, cls: 'jp-lex-row-reading' });
        }
        // The query was inflected and this hit is the deinflected form — say so,
        // in the same 〈…〉 badge the small-dictionary rows use (renderDictRow).
        // Without it 食べた silently shows 食べる with nothing marking the step.
        if (deinflection?.length) top.createSpan({ text: `〈${deinflection.join('+')}〉`, cls: 'jp-lex-deinflect' });
        top.createSpan({ text: dictionary, cls: 'jp-lex-cand-dict' });
        const gloss = entry.senses.map((s) => s.gloss).filter(Boolean).join(' / ');
        if (gloss) row.createDiv({ text: gloss.slice(0, 140), cls: 'jp-lex-row-gloss' });
      }
    }
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
    // §20.1 — a word the sweep met thousands of times is answered with a
    // PROFILE, not a queue. Rendered above the tree because for those entries it
    // IS the entry: 「ですね」 has no confirmed 用例 and never will.
    const profile = buildUsageProfile(p);
    if (profile) this.renderUsageProfile(root, profile);

    /**
     * §29.2 — how X writes it, in the entry rather than in another view.
     *
     * The 𝕏 corpus was reachable only by leaving for the 𝕏 view with a
     * prefilled query, which means it answered a question you had to already
     * be asking. Here it answers the question you are demonstrably asking: you
     * are looking at this entry. Same renderer as the 𝕏 view (§28 S1 — one
     * object, one presentation, whichever door you came through), and the two
     * boxes sit next to each other on purpose: the 使われ方 profile is YOUR
     * corpus of watched video, this is contemporary written Japanese from
     * strangers. Where they agree is worth more than either alone.
     */
    const xu = this.deps.xUsage?.(p);
    if (xu) {
      renderXUsage(root, xu, {
        openUrl: (url) => this.deps.openUrl?.(url),
        onCapture: (quote, url, handle) => this.deps.attachXLine?.(p, quote, url, handle),
      });
    }

    const tree = buildContextTree(p, this.deps.patterns());
    const terms = [p.key, ...(p.payload.parts ?? []), p.payload.halo ?? '', p.payload.lemma ?? ''].filter((t) => t.length >= 2);
    this.renderTree(root, tree, p.id, terms, profile);

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
    if (goho && (goho.frames?.length || goho.collocates.length || goho.examples.length)) {
      const total = goho.sourceTotal ? ` · ${goho.sourceTotal.toLocaleString()}例` : '';
      const g = knowledgeBox(root, `語法 — ${goho.source}（取得済み固定）${total}`, 'goho');

      // 頻度 vs 結合度 — offered, not applied.
      //
      // The two answer different questions and the box has no business picking:
      // 「風を」 tops the frequency list because を is common, while
      // 「クーラーの風」 is rare and is nevertheless the pairing that IS the word.
      // logDice separates them, which is the whole reason to consult a corpus
      // rather than a word list. Frequency stays the default because it is the
      // order the source shipped, and re-ranking silently would be the panel
      // overriding measured data with a preference (cf. `resolve()` refusing to
      // prefer 名詞 over 形容動詞 for 風).
      if ((goho.frames ?? []).some((f) => f.measured?.length)) {
        const sortRow = g.createDiv('jp-lex-goho-sort');
        const defs: Array<[GohoSort, string, string]> = [
          ['freq', '頻度', 'コーパスでの出現回数が多い順'],
          ['dice', '結合度', 'logDice の高い順 — 「その語だからこその組み合わせ」が上に来ます'],
        ];
        for (const [m, label, title] of defs) {
          const b = sortRow.createEl('button', {
            text: label, attr: { title },
            cls: 'jp-lex-goho-sortbtn' + (this.gohoSort === m ? ' is-on' : ''),
          });
          b.onclick = () => { this.gohoSort = m; this.rerender(); };
        }
      }

      /**
       * §22.7 — the GRAMMAR half, as the corpus itself organises it.
       *
       * NINJAL-LWP's own 語彙プロファイル is three panels: every way the word
       * attaches, grouped into categories, on the left; that way's collocations
       * in the middle; that collocation's 用例 on the right. This box used to be
       * a flat list of the six most frequent ways, which meant 風's 助詞＋形容詞,
       * 助動詞, 接頭辞・接尾辞 and 動詞連用形＋風 categories were not truncated —
       * they were absent, with nothing on screen to say so.
       *
       * The index is now frozen whole (one request), so every way is named and
       * ranked here whether or not it has been opened. An unopened row is a
       * labelled hole, not a gap: it says what it is, how often it happens, and
       * that a tap will fetch it (§27.0.2 — a hole is held open on purpose, and
       * it is legible).
       */
      const drilled = new Map<string, GohoFrame>();
      for (const f of goho.frames ?? []) if (f.patternId) drilled.set(f.patternId, f);

      if (goho.index?.length) {
        // Category order follows the index's own frequency ranking — the first
        // category to appear is the one holding the word's commonest behaviour,
        // which is the order the site presents too.
        const byCat = new Map<string, typeof goho.index>();
        for (const row of goho.index) {
          const cat = row.category || 'その他';
          if (!byCat.has(cat)) byCat.set(cat, []);
          byCat.get(cat)!.push(row);
        }
        for (const [cat, rows] of byCat) {
          const catFreq = rows.reduce((n, r) => n + r.freq, 0);
          const catHead = g.createDiv('jp-lex-goho-cat');
          catHead.createSpan({ text: cat, cls: 'jp-lex-goho-cat-name' });
          catHead.createSpan({
            text: `${rows.length}通り · ${catFreq.toLocaleString()}回`,
            cls: 'jp-lex-goho-cat-count',
          });
          for (const row of rows) {
            const frame = drilled.get(row.id);
            const box = g.createDiv(`jp-lex-goho-frame${frame ? '' : ' jp-lex-goho-frame--shut'}`);
            const head = box.createDiv('jp-lex-goho-frame-head');
            head.createSpan({ text: row.name, cls: 'jp-lex-goho-arrow' });
            // The share as a BAR, not only a number: 88.2% and 3.1% are the
            // shape of the word's behaviour, and a bar is read at a glance
            // where two decimal figures are compared by arithmetic.
            const bar = head.createDiv('jp-lex-goho-bar');
            bar.createDiv('jp-lex-goho-bar-fill').style.width =
              `${Math.max(1, Math.min(100, row.share))}%`;
            bar.title = `${row.name} — コーパス中 ${row.freq.toLocaleString()}回 · ${p.key}の全用例の${row.share}%`;
            head.createSpan({ text: `${row.share}%`, cls: 'jp-lex-goho-share' });
            head.createSpan({ text: `${row.freq.toLocaleString()}回`, cls: 'jp-lex-goho-count' });

            if (frame) {
              this.renderGohoFrameBody(box, p, goho, frame);
            } else if (this.deps.drillPattern) {
              const open = box.createEl('button', {
                cls: 'jp-lex-goho-open',
                text: '＋ 共起語を取得',
                attr: { title: `${row.name} の共起語をコーパスから取得します（1リクエスト）` },
              });
              open.onclick = async () => {
                open.disabled = true;
                open.setText('取得中…');
                try { await this.deps.drillPattern!(p, row.id); } catch (e) { new Notice(String(e)); }
                this.rerender();
              };
            } else {
              // No drill available (TWC off, or a profile frozen by Hyogen).
              // The row still states what exists rather than pretending it does not.
              box.createDiv({ cls: 'jp-lex-goho-shut-note', text: '未取得' });
            }
          }
        }
      }

      // Frames the index does not account for: Hyogen's sections, and profiles
      // frozen before the index existed. They keep the original head, because
      // their identity is a direction and a sense rather than a pattern id.
      for (const f of (goho.frames ?? []).filter((x) => !x.patternId || !goho.index?.length)) {
        const box = g.createDiv('jp-lex-goho-frame');
        const head = box.createDiv('jp-lex-goho-frame-head');
        // 'unmarked' means the source made no positional claim (TWC's 近接動詞
        // lists words that merely co-occur). Showing 「走る～」 there would
        // assert something no one said, so the head stands bare and the frame's
        // own label carries the meaning.
        const arrow = f.direction === 'head-final' ? `～${p.key}`
          : f.direction === 'compound' ? `${p.key}＋`
          : f.direction === 'unmarked' ? p.key : `${p.key}～`;
        head.createSpan({ text: arrow, cls: 'jp-lex-goho-arrow' });
        if (f.pos) head.createSpan({ text: f.pos, cls: 'jp-lex-goho-pos' });
        if (f.sense !== undefined) head.createSpan({ text: `語義${f.sense}`, cls: 'jp-lex-goho-sense' });
        // The grammar verbatim — 「風＋助詞」 says something 「風～」 cannot.
        if (f.label && f.label !== arrow) head.createSpan({ text: f.label, cls: 'jp-lex-goho-label' });
        // The share is what turns a list of behaviours into a profile: 88% and
        // 5% are not two equal facts about the word.
        if (f.share !== undefined) {
          const s = head.createSpan({ text: `${f.share}%`, cls: 'jp-lex-goho-share' });
          s.title = f.freq !== undefined
            ? `この付き方はコーパス中 ${f.freq.toLocaleString()}回 — ${p.key}の全用例の${f.share}%`
            : `${p.key}の全用例の${f.share}%`;
        }
        // The count lives in the body now, once, so a frame cannot print it
        // twice with two different roundings (§28 S6 is about one true number,
        // not about mentioning it often).
        this.renderGohoFrameBody(box, p, goho, f);
      }

      // The particle facets: the rest of the corpus, reachable rather than lost.
      if (goho.facets?.length && this.deps.openUrl) {
        const fr = g.createDiv('jp-lex-goho-facets');
        fr.createSpan({ text: '絞込み', cls: 'jp-lex-goho-facets-label' });
        for (const f of goho.facets) {
          const a = fr.createEl('button', { text: f.label, cls: 'jp-lex-goho-facet' });
          a.title = `${f.label} だけを ${goho.source} で見る`;
          a.onclick = () => this.deps.openUrl!(f.url);
        }
      }

      // Legacy/flat profiles (fetched before frames existed) still render.
      if (!goho.frames?.length && goho.collocates.length) {
        const chips = g.createDiv('jp-lex-goho-chips');
        for (const c of goho.collocates) {
          const chip = chips.createEl('button', { text: c, cls: 'jp-lex-goho-chip' });
          chip.onclick = () => this.deps.openDict(c);
        }
      }
      // ── 用例 ────────────────────────────────────────────────────────────
      //
      // ONE row shape for both kinds of evidence, differing only by the marker
      // that states which it is. They are NOT the same claim — 「」 is a
      // sentence somebody wrote in a document TWC names and links; 〈〉 is a
      // phrase Hyogen lists on the word's page — and a reader who cannot tell
      // them apart cannot tell either from an invented one (§28 S3). Two
      // separate loops rendering two different-looking rows was how this
      // drifted: the second one had become unreachable, so Hyogen's phrases
      // were stored and never shown at all.
      const shownEx: GohoExample[] = goho.sourced?.length
        ? goho.sourced
        // Profiles frozen before `sourced` existed carry only flat strings.
        : goho.examples.map((text) => ({ text, kind: 'phrase' as const }));
      if (shownEx.length) {
        const attested = shownEx.filter((e) => (e.kind ?? (e.url ? 'attested' : 'phrase')) === 'attested').length;
        g.createDiv({
          cls: 'jp-lex-goho-exhead',
          text: attested === shownEx.length ? `用例 ${shownEx.length}件（出典つき）`
            : attested === 0 ? `用例 ${shownEx.length}件（${goho.source}の収録句）`
            : `用例 ${shownEx.length}件（うち出典つき ${attested}件）`,
        });
      }
      /**
       * Grouped under the collocation they attest, the way the corpus's own
       * right-hand panel is headed 「のをいる 22,351件」.
       *
       * A sentence is evidence for ONE pairing. Eight of them in a flat list
       * under a whole word reads as eight facts about the word; under their
       * collocation they read as what they are — and the count says how many
       * more the corpus holds behind the ones taken.
       */
      const exGroups = new Map<string, GohoExample[]>();
      for (const ex of shownEx) {
        const key = ex.collocate ?? '';
        if (!exGroups.has(key)) exGroups.set(key, []);
        exGroups.get(key)!.push(ex);
      }
      for (const [collocate, group] of exGroups) {
        if (collocate) {
          const head = g.createDiv('jp-lex-goho-exgroup');
          head.createSpan({ text: collocate, cls: 'jp-lex-goho-exgroup-word' });
          const held = (goho.frames ?? [])
            .flatMap((f) => f.measured ?? [])
            .find((m) => m.text === collocate)?.freq;
          if (held) {
            head.createSpan({
              text: `${group.length} / ${held.toLocaleString()}件`,
              cls: 'jp-lex-goho-exgroup-count',
              attr: { title: `コーパスは「${collocate}」の用例を ${held.toLocaleString()}件もっています` },
            });
          }
        }
        for (const ex of group) {
        const kind = ex.kind ?? (ex.url ? 'attested' : 'phrase');
        const row = g.createDiv(`jp-lex-goho-ex jp-lex-goho-ex--${kind}`);
        const quote = row.createSpan({ cls: 'jp-lex-leaf-quote jp-lex-tappable' });
        const [open, close] = kind === 'attested' ? ['「', '」'] : ['〈', '〉'];
        const [s, e] = ex.span ?? [0, 0];
        if (e > s && e <= ex.text.length) {
          // The corpus supplies the highlight offsets, so the panel never has
          // to guess where the collocation sits in the sentence.
          quote.appendText(`${open}${ex.text.slice(0, s)}`);
          quote.createSpan({ text: ex.text.slice(s, e), cls: 'jp-lex-goho-hit' });
          quote.appendText(`${ex.text.slice(e)}${close}`);
        } else {
          quote.setText(`${open}${ex.text}${close}`);
        }
        // Which way of attaching this sentence is evidence FOR. Recorded at
        // fetch time because it cannot be recovered afterwards — TWC's grid is
        // lemmatised and its sentences are surface.
        if (ex.frame) row.createSpan({ text: ex.frame, cls: 'jp-lex-goho-exframe' });
        // ~1 sentence in 8 has no document title in the corpus. The host is
        // coarser provenance, but it is still provenance, and an example whose
        // origin is invisible cannot be told from an invented one (§28 S3).
        const cited = ex.source || hostOf(ex.url);
        if (cited) {
          const cite = row.createSpan({ text: cited, cls: 'jp-lex-goho-cite' });
          cite.title = ex.url ? `${cited}\n${ex.url}` : cited;
          if (ex.url && this.deps.openUrl) {
            cite.addClass('jp-lex-tappable');
            cite.onclick = () => this.deps.openUrl!(ex.url!);
          }
        }
        if (this.deps.captureCorpus) {
          const cap = row.createEl('button', {
            text: '🏷️', cls: 'jp-lex-leaf-btn',
            attr: { title: kind === 'attested'
              ? 'この用例を台帳へ（📊 コーパス層 — 出典つき）'
              : `この句を台帳へ（📊 コーパス層 — ${goho.source}の収録句）` },
          });
          cap.onclick = () => this.deps.captureCorpus!(p, ex.text, { sourceName: ex.source, url: ex.url });
        }
        // §29 — carry the sentence out. `text/html` gives it as a blockquote
        // with its citation attached, so it arrives in Apple Notes already
        // knowing where it came from rather than as an anonymous string.
        makeDraggable(row, () => ({
          kind: 'quote',
          text: ex.text,
          label: ex.text,
          sub: cited || goho.source,
          meta: { headword: p.key, source: cited || goho.source, url: ex.url, frame: ex.frame },
        }));
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

  /**
   * One frame's chips in the box's current order, each carrying its measures.
   *
   * `measured` is parallel to `items` by construction, but only where the
   * source HAS association measures — so the pairing is re-checked per row
   * rather than assumed, and a source without them (Hyogen) falls through with
   * `m` undefined and its page order intact. Sorting a list that has nothing to
   * sort by would silently reorder Hyogen's items for no reason.
   */
  /**
   * What attaches THIS way — the middle panel of the corpus's own profile.
   *
   * Two renderings, because the two sources are carrying different things and
   * flattening them to one shape is what made the box feel unlike either.
   *
   * A **measured** source (TWC) gets rows: the collocation, its frequency, MI
   * and logDice. Three numbers per item is a table, and a table is right here —
   * that is what the site shows, and comparing 「風を」(freq 145, MI 4.11)
   * against 「クーラーの風」(freq 3, MI 9.2) is the entire reason to consult a
   * corpus instead of a word list. Each row can fetch its own 用例.
   *
   * An **unmeasured** source (Hyogen) gets a flowing block, because that is
   * what its items are: 青空文庫 phrases, listed the way the site lists them.
   * Rendering 24 of them as bordered chips turned language into a spreadsheet
   * with nothing to put in the columns.
   */
  private renderGohoFrameBody(
    box: HTMLElement,
    p: PatternEntry,
    goho: NonNullable<PatternEntry['payload']['goho']>,
    f: GohoFrame,
  ): void {
    const all = this.gohoChipOrder(f);
    const measured = all.some((r) => r.m);
    // Bounded DOM — see GOHO_PAGE. The key survives a re-sort because it is the
    // frame's identity, not its position.
    const key = f.patternId || f.label;
    const openAll = this.gohoOpen.has(key);
    const rows = openAll ? all : all.slice(0, GOHO_PAGE);

    // How much of this pattern is on screen, against how much exists. `total`
    // is the corpus's own 種類 count now, so this is exact rather than a hedge.
    // Counts what is actually VISIBLE, not what is held — a number describing
    // rows the reader cannot see is the §28 S6 problem in miniature.
    if (f.total > rows.length) {
      box.createDiv({
        cls: 'jp-lex-goho-count',
        text: `${rows.length} / ${f.total.toLocaleString()}${f.atLeast ? '+' : ''}種類を表示`,
      });
    }

    if (!measured) {
      const block = box.createDiv('jp-lex-goho-block');
      for (const { text: it } of rows) {
        const item = block.createSpan({ text: it, cls: 'jp-lex-goho-phrase jp-lex-tappable' });
        item.title = `${it} — 台帳へ取り込む（📊 コーパス層）`;
        item.onclick = () => this.deps.captureCorpus
          ? this.deps.captureCorpus(p, it)
          : this.deps.openDict(it);
        makeDraggable(item, () => ({
          kind: 'entry', text: it, label: it, sub: goho.source,
          meta: { headword: p.key, frame: f.label, source: goho.source },
        }));
      }
      this.gohoMoreButton(box, key, all.length - rows.length);
      return;
    }

    // Which collocations already have their sentences, so a row can say so
    // rather than offering to fetch what is already held.
    const haveEx = new Set((goho.sourced ?? []).map((e) => e.collocate).filter(Boolean) as string[]);

    const grid = box.createDiv('jp-lex-goho-grid');
    for (const { text: it, m } of rows) {
      const row = grid.createDiv('jp-lex-goho-row');
      const word = row.createSpan({ text: it, cls: 'jp-lex-goho-word jp-lex-tappable' });
      word.title = `${it} — 台帳へ取り込む（📊 コーパス層）`;
      word.onclick = () => this.deps.captureCorpus
        ? this.deps.captureCorpus(p, it)
        : this.deps.openDict(it);
      if (m) {
        row.createSpan({ text: m.freq.toLocaleString(), cls: 'jp-lex-goho-num jp-lex-goho-num--freq' });
        row.createSpan({ text: m.mi.toFixed(2), cls: 'jp-lex-goho-num' });
        row.createSpan({ text: m.logDice.toFixed(2), cls: 'jp-lex-goho-num' });
        // The 用例 for THIS pairing, on request. The corpus holds `m.freq` of
        // them; the profile takes a page and says so.
        if (this.deps.drillExamples && m.id && !haveEx.has(it)) {
          const b = row.createEl('button', {
            text: '用例', cls: 'jp-lex-goho-exbtn',
            attr: { title: `「${it}」の用例を取得（コーパスに ${m.freq.toLocaleString()}件）` },
          });
          b.onclick = async () => {
            b.disabled = true;
            b.setText('…');
            try {
              await this.deps.drillExamples!(p, f.label, { id: m.id!, text: it, freq: m.freq });
            } catch (e) { new Notice(String(e)); }
            this.rerender();
          };
        } else if (haveEx.has(it)) {
          row.createSpan({ text: '✓用例', cls: 'jp-lex-goho-hasex', attr: { title: '用例は取り込み済みです' } });
        }
      }
      makeDraggable(row, () => ({
        kind: 'entry', text: it, label: it,
        sub: m ? `${goho.source} · ${m.freq.toLocaleString()}回` : goho.source,
        meta: { headword: p.key, frame: f.label, source: goho.source },
      }));
    }
    this.gohoMoreButton(box, key, all.length - rows.length);
  }

  /** "…and the other N held" — only when there are some, never as a stub. */
  private gohoMoreButton(box: HTMLElement, key: string, hidden: number): void {
    if (hidden <= 0) return;
    const b = box.createEl('button', {
      cls: 'jp-lex-goho-more',
      text: `もっと見る（あと${hidden}件）`,
      attr: { title: 'この付き方について取得済みの残りを表示します（追加の通信はありません）' },
    });
    b.onclick = () => { this.gohoOpen.add(key); this.rerender(); };
  }

  private gohoChipOrder(f: GohoFrame): Array<{ text: string; m?: GohoMeasured }> {
    const rows = f.items.map((text, i) => {
      const m = f.measured?.[i];
      return { text, m: m && m.text === text ? m : undefined };
    });
    if (this.gohoSort !== 'dice' || !rows.some((r) => r.m)) return rows;
    return [...rows].sort((a, b) => (b.m?.logDice ?? -Infinity) - (a.m?.logDice ?? -Infinity));
  }

  /**
   * 使われ方 — what a high-frequency word DOES, drawn as a distribution.
   *
   * The ✓/✕ spine is the right interface for a noticing the sweep found nine
   * times. It is the wrong one for 「ですね」, whose 3,565 sightings the panel
   * used to show as twelve rows and an implied backlog of 3,553. Nobody clears
   * that, and nobody should: the question for a word this common is not "is
   * sighting #2,004 genuine" but "what is this word for" — which the sweep
   * already answered on every one of them and nothing read back.
   *
   * Each row carries its real lines, so the claim stays checkable rather than
   * becoming a statistic the user has to take on faith (§12).
   */
  private renderUsageProfile(root: HTMLElement, prof: UsageProfile): void {
    const pct = (n: number): string => `${Math.round(n * 100)}%`;
    const body = knowledgeBox(root, `📊 使われ方 — 走査 ${prof.total.toLocaleString()}件から`, 'goho');

    if (prof.positions.length) {
      const posTotal = prof.positions.reduce((n, p) => n + p.count, 0) || 1;
      body.createDiv({
        cls: 'jp-lex-usage-pos',
        text: '位置: ' + prof.positions.map((p) => `${p.label} ${pct(p.count / posTotal)}`).join(' ・ '),
      });
    }

    for (const m of prof.moves) {
      const row = body.createDiv('jp-lex-usage-row');
      const head = row.createDiv('jp-lex-usage-head');
      head.createSpan({ text: m.label, cls: 'jp-lex-usage-label' });
      head.createSpan({ text: `${m.count.toLocaleString()}（${pct(m.share)}）`, cls: 'jp-lex-usage-count' });
      // The bar is the same number said twice — but a 53% and a 4% are not
      // distinguishable at a glance as digits, and that glance is the point.
      const bar = row.createDiv('jp-lex-usage-bar');
      bar.createDiv('jp-lex-usage-fill').style.width = `${(m.share * 100).toFixed(1)}%`;
      for (const ex of m.examples) {
        const q = row.createDiv({ text: `「${ex}」`, cls: 'jp-lex-usage-ex jp-lex-tappable' });
        q.addEventListener('click', (evt) => this.tapLookup(evt));
      }
    }
  }

  private renderTree(root: HTMLElement, tree: ContextTree, patternId: string, terms: string[], profile?: UsageProfile | null): void {
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
      // Say the true size. The list is capped at twelve, so on a profiled entry
      // the old header read "候補 12" over a pile of 3,565 — which is not a
      // small imprecision, it is the difference between a chore and a lie.
      sum.createSpan({
        text: profile
          ? '❓ 走査の抜粋（この語は多すぎて全件は捌けません）'
          : '❓ 候補（走査の提案 — ✓確定 / ✕否認）',
        cls: 'jp-lex-tree-label',
      });
      sum.createSpan({
        text: profile ? `${tree.candidates.length} / ${profile.total.toLocaleString()}` : `${tree.candidates.length}`,
        cls: 'jp-lex-tree-count',
      });
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
    // §29: a CONFIRMED 用例 can be carried out, and it takes its door back with
    // it (§28 S2) — the quote arrives in Notes already citing the video and the
    // second. Candidate rows are deliberately excluded: they own the horizontal
    // swipe (✓/✕), and a drag would fight it for the same gesture.
    if (!(leaf.suggested && candidateOf)) {
      const at = leaf.tStartSec != null
        ? `${Math.floor(leaf.tStartSec / 60)}:${String(Math.floor(leaf.tStartSec % 60)).padStart(2, '0')}`
        : undefined;
      const where = leaf.att.scene?.sourceName ?? leaf.file?.split('/').pop()?.replace(/\.md$/, '');
      const cite = [where, at].filter(Boolean).join(' ');
      makeDraggable(row, () => ({
        kind: 'quote',
        text: leaf.quote,
        sub: cite || undefined,
        html: `<blockquote>${leaf.quote}${cite ? `<br><small>— ${cite}` : ''}` +
          `${leaf.att.scene?.deepLink ? ` <a href="${leaf.att.scene.deepLink}">↪</a>` : ''}${cite ? '</small>' : ''}</blockquote>`,
        meta: {
          file: leaf.file, tSec: leaf.tStartSec ?? undefined,
          videoId: leaf.att.videoId ?? undefined, deepLink: leaf.att.scene?.deepLink,
        },
      }));
    }
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
