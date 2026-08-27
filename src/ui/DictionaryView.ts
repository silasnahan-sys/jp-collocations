/**
 * DictionaryView — mobile-first built-in dictionary viewer.
 *
 * Features:
 *   - Instant lookup with debounced search
 *   - Prefix autocomplete suggestions
 *   - Rich definition rendering (structured content, ruby, tables)
 *   - Pitch accent visualization (mora diagram)
 *   - Frequency badges
 *   - Tag pills
 *   - Dictionary source badges
 *   - Tap-to-expand definitions
 *   - Import dictionary button
 *   - Mobile-first with 48px touch targets, iOS safe areas
 */

import { ItemView, WorkspaceLeaf, Notice, Modal, Setting, Menu } from 'obsidian';
import type { App } from 'obsidian';
import { DictionaryStore } from '../dictionary/DictionaryStore';
import type {
  DictLookupResult,
  DictionaryMeta,
  DictionarySettings,
  YomitanDefinition,
  YomitanStructuredContent,
  YomitanContentNode,
  YomitanPitchInfo,
  YomitanTag,
} from '../dictionary/types';
import { YomitanImporter } from '../dictionary/YomitanImporter';
import { dedupeAgainst, type BigDictHit } from '../dictionary/big-dict';
import { renderEntryParts, renderEntryNodes } from './entry-grammar';
import { summarize, usageNodes } from '../dictionary/shape-index';
import {
  offeredBy, statedRelation, buildCapture, RELATION_SPECS,
  classifyCollocation, COLLOCATION_KINDS,
  type Selection, type SaveRelation,
} from '../dictionary/savable';
import { isExampleLine, exampleJapanese } from '../dictionary/example-capture';
import { ContextEngine } from '../context/ContextEngine';
import type { ContextCard, VaultOccurrence } from '../context/ContextEngine';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../discourse/discourse-grammar';
import { PATTERN_BY_ID, type PatternCategory } from '../discourse/discourse-patterns';
import { JP_COLLOCATIONS_VIEW_TYPE, CollocationView } from './CollocationView';
import { HoverPeek, definitionsPreview } from './hover-peek';
import { NOTE_TYPES, type NoteClass } from '../notes/note-types';
import { classBadge, classDot } from './class-grammar';
import { armDrops, armSelectionEcho, mountSurfaceBar, wideDock, type ViewChrome } from './view-chrome';
import { makeDraggable } from './drag-out';
import { historyDays, searchNotation, panVerdict, Trail, riffleDelay, RIFFLE_HOLD_MS, type DictHistoryStore } from '../dictionary/dict-nav';

export const JP_DICTIONARY_VIEW_TYPE = 'jp-dictionary-view';

/**
 * How a space-separated query was narrowed: `primary` found the candidates,
 * every `filters` term had to appear in them. `primaryHits` counts what the
 * first term found across BOTH stores, so the empty-state can say which half
 * of the query failed — the word, or the narrowing.
 */
interface TermNarrowing {
  primary: string;
  filters: string[];
  primaryHits: number;
}

/** True when a non-empty result set holds nothing but deinflection guesses. */
function allDeinflected(results: DictLookupResult[]): boolean {
  return results.length > 0 && results.every(r => (r.deinflection?.length ?? 0) > 0);
}

export class DictionaryView extends ItemView {
  private dictStore: DictionaryStore;
  private contextEngine: ContextEngine | null;
  private searchInput: HTMLInputElement | null = null;
  private suggestionsEl: HTMLElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;
  private headerActionsEl: HTMLElement | null = null;
  private breadcrumbEl: HTMLElement | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentQuery = '';
  /** Where a query looks — worn as chips on the bar (IMG_1184 t177–186). */
  private searchScope: 'all' | 'head' | 'body' = 'all';
  /** The walk's spine: back AND forward (dict-nav.Trail — one pure organ,
   *  shared grammar with 𝕏). A stop remembers WHERE you were reading. */
  private trail = new Trail<{ word: string; scroll: number; via?: SaveRelation }>();
  private onImport: () => Promise<void>;
  private onSaveEntry: (expression: string, reading: string, exampleSentence?: string) => void;
  /** Universal classify-capture (6分類 → pattern catalog; DESIGN §13). */
  private onClassify: ((expression: string, example?: string, dictMeta?: { dict: string; headword: string }) => void) | null;
  /** §26.3 hover peek — same shared component as the catalog (one grammar). */
  private peek: HoverPeek | null = null;
  /**
   * §28 S1 — which of YOUR catalog patterns contain this headword. A dictionary
   * entry for a word you have already noticed must SAY so, with the same class
   * mark it wears in the lexicon; otherwise looking a word up hides the fact
   * that you own it. Assigned by main.ts (kept off the constructor, which is
   * already six positional params deep).
   */
  patternsIn: ((text: string) => Array<{ id: string; key: string; class: NoteClass; classRatified?: boolean }>) | null = null;
  /** §28 S4 — the door back into the lexicon. */
  openPattern: ((id: string) => void) | null = null;
  /** §29 / §26.3 — the drag road and the identity bar. Late-bound like the
   *  two above, for the same reason: the constructor is already six deep. */
  onDrop: ViewChrome['onDrop'];
  dropCan: ViewChrome['dropCan'];
  openSurface: ViewChrome['openSurface'];
  /** The way OUT — paired with backPeek (assigned via peekChrome). Late-bound
   *  by withCatalogHits like everything above; it was the one chrome field
   *  never assigned, which left this surface's 戻る silently dead. */
  dismiss: ViewChrome['dismiss'];
  /** The ONE shared answer road (peekChrome) — the peek card asks it, so a
   *  tap and a selection can never disagree about what a word means. */
  lookUp: ViewChrome['lookUp'];
  surfaceBadge: ViewChrome['surfaceBadge'];
  /**
   * §27.5 — the CONVERTED dictionaries (vault sidecars), asynchronous.
   *
   * Without this the 辞書 view searched only `DictionaryStore`, so 31
   * dictionaries and 6.1M headwords that the settings screen happily listed as
   * 変換済み were unreachable from the one surface named after them. Assigned by
   * main.ts, like `patternsIn` — the constructor is already six params deep.
   */
  bigDict: {
    lookup: (q: string, limit?: number) => Promise<BigDictHit[]>;
    installed: () => Promise<Array<{ title: string; headwords: number; partial: boolean }>>;
  } | null = null;
  /**
   * Bumped on every search. A sidecar read is one file per installed
   * dictionary, so it can land after the user has typed the next character —
   * the late result must then be dropped rather than painted over the new one.
   */
  private searchGen = 0;

  // ── the navigation grammar (dict-nav.ts; コマ送り items 7/8/16, §30) ──
  /** Persistent dated lookup history — wired by main.ts (withCatalogHits). */
  historyStore: DictHistoryStore | null = null;
  private navBarEl: HTMLElement | null = null;
  private nbPrevEl: HTMLButtonElement | null = null;
  private nbNextEl: HTMLButtonElement | null = null;
  private outlinePop: HTMLElement | null = null;
  private findBarEl: HTMLElement | null = null;
  private findInput: HTMLInputElement | null = null;
  private findCountEl: HTMLElement | null = null;
  private findHits: HTMLElement[] = [];
  private findAt = -1;
  private findTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set by lookupWord, consumed after render: what to light, how to move. */
  private pendingArrive: { light?: string; tempo?: 'descend' | 'flip' } | null = null;
  private historyMode = false;
  /** Installed sidecars, cached after the first look so the home screen is sync. */
  private bigInstalled: Array<{ title: string; headwords: number; partial: boolean }> = [];

  constructor(
    leaf: WorkspaceLeaf,
    dictStore: DictionaryStore,
    onImport: () => Promise<void>,
    onSaveEntry?: (expression: string, reading: string, exampleSentence?: string) => void,
    contextEngine?: ContextEngine,
    onClassify?: (expression: string, example?: string, dictMeta?: { dict: string; headword: string }) => void,
  ) {
    super(leaf);
    this.dictStore = dictStore;
    this.onImport = onImport;
    this.onSaveEntry = onSaveEntry ?? (() => {});
    this.contextEngine = contextEngine ?? null;
    this.onClassify = onClassify ?? null;
  }

  getViewType(): string { return JP_DICTIONARY_VIEW_TYPE; }
  getDisplayText(): string { return 'JP Dictionary'; }
  getIcon(): string { return 'book-open'; }

  async onOpen(): Promise<void> {
    this.buildUI();
    this.renderHome();
    // Which sidecars exist is a vault-folder question, so it is async and the
    // home screen above is drawn before the answer; refreshBigInstalled redraws.
    void this.refreshBigInstalled();
    // §23.5 keyboard hand: / focuses search; j/k walk the capturable example
    // rows; t (🏷️) captures the focused one — the same verbs as elsewhere.
    this.contentEl.setAttr('tabindex', '0');
    this.registerDomEvent(this.contentEl, 'keydown', (e) => this.onExampleKey(e));
    // §26.3 hover peek: dwell over any recursive-lookup word → reading+gloss
    // WITHOUT navigating away (keeps your place in the current entry — the
    // monokakido 飛び込み-without-losing-place feel). Mouse/Pencil only.
    this.peek = new HoverPeek((x, y) => {
      const span = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest?.('.jp-dict-clickable-word');
      const word = span?.textContent?.trim();
      if (!word) return null;
      const hits = this.dictStore.lookup(word);
      if (!hits.length) return null;
      const h = hits[0];
      return {
        headword: h.term.expression,
        reading: h.term.reading,
        deinflection: h.deinflection,
        def: definitionsPreview(h.term.definitions),
      };
    });
    this.peek.attach(this.contentEl, '.jp-dict-clickable-word');
  }

  /**
   * A dictionary's own media path → something the webview can load.
   *
   * The extractor writes each file under the book's sidecar folder using the
   * publisher's own relative path, so no mapping table is needed — and a vault
   * where the images were never extracted simply resolves to undefined, which
   * the renderer treats as "draw nothing" rather than a broken image.
   */
  private mediaMisses = new Set<string>();
  private resolveDictMedia(dictionary: string, src: string): string | undefined {
    const root = 'JP Dictionaries';
    const safe = String(dictionary).replace(/[\\/:*?"<>|#^[\]]/g, '_').trim();
    const path = `${root}/${safe}/media/${src}`;
    if (this.mediaMisses.has(path)) return undefined;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) { this.mediaMisses.add(path); return undefined; }
    return this.app.vault.adapter.getResourcePath(path);
  }

  /**
   * Offer the relations THIS selection can honestly become.
   *
   * Not a fixed menu: `offeredBy` reads the shape the thing was sitting in, so
   * a synonym from a 語群 offers 類語/使い分け/対義語, a comparison cell offers a
   * 判定, and a corpus citation offers 実例 but never 用例 — because provenance
   * is the difference between them. A relation the SOURCE already stated
   * (`⇔うんと`) is applied directly instead of being asked about again.
   */
  private offerCapture(sel: Selection, evt: MouseEvent): void {
    // A relation the source marked (⇔/⇒/＝) leads the menu as a ONE-TAP offer
    // — never a silent commit. The old auto-commit fired on the publisher's
    // glyph alone, and the glyph is not one language: 新英和's ⇒ before
    // 「common divisor」 is a compounds cross-ref, not a 言い換え, so the
    // "stated" relation walked English apparatus straight into the catalog
    // with no hand in the loop (filmed, 2026-08-08). The book still speaks
    // first; the hand still decides.
    const stated = statedRelation(sel.text);
    let offers = offeredBy(sel);
    if (!stated && offers.length === 1) { this.commitCapture(sel, offers[0]); return; }
    // The menu was a 12-item wall of 待つ-examples the eye had to translate
    // (filmed: browsed 6s, abandoned). The surface form already SAYS which
    // collocation relation it instantiates — the particle IS the case frame,
    // the complementizer IS the complement — so that reading leads, named as
    // the form's own, and the teaching list follows for the disagreeing hand.
    const formRead = offers.some((r) => COLLOCATION_KINDS.includes(r))
      ? classifyCollocation(sel.text, sel.headword ?? '') : null;
    if (formRead && offers.includes(formRead)) {
      offers = [formRead, ...offers.filter((r) => r !== formRead)];
    }
    const menu = new Menu();
    if (stated) {
      menu.addItem((i) => i
        .setTitle(`⚡ ${stated.relation}：${stated.target}${sel.headword ? ` ↔ ${sel.headword}` : ''} — 出典の記号から`)
        .onClick(() => this.commitCapture({ ...sel, text: stated.target }, stated.relation)));
      menu.addSeparator();
    }
    for (const rel of offers) {
      const lead = rel === formRead ? `⚡ ${rel} — この形から読める` : `${rel} — ${RELATION_SPECS[rel].hint}`;
      menu.addItem((i) => i
        .setTitle(lead)
        .onClick(() => this.commitCapture(sel, rel)));
    }
    menu.showAtMouseEvent(evt);
  }

  private commitCapture(sel: Selection, rel: SaveRelation): void {
    const cap = buildCapture(sel, rel);
    // The existing capture spine takes (expression, example, dictMeta); the
    // relation and its evidence ride along so nothing the book asserted is lost
    // on the way into the lexicon.
    this.onClassify?.(
      cap.subject,
      [cap.relation, cap.object ? `↔ ${cap.object}` : '', cap.evidence ?? '', cap.cite ?? '']
        .filter(Boolean).join(' · '),
      { dict: sel.dictionary ?? '', headword: sel.headword ?? cap.subject },
    );
    new Notice(`${rel}：${cap.subject}${cap.object ? ` ↔ ${cap.object}` : ''}`);
  }

  private onExampleKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); this.searchInput?.focus(); return; }
    const rows = Array.from(this.contentEl.querySelectorAll<HTMLElement>('.jp-dict-ex-capture'))
      .map((btn) => btn.parentElement)
      .filter((el): el is HTMLElement => !!el);
    if (!rows.length) return;
    const cur = rows.findIndex((r) => r.hasClass('jp-dict-ex--focus'));
    const k = e.key.toLowerCase();
    if (k === 'j' || k === 'k') {
      e.preventDefault();
      const from = cur < 0 ? (k === 'j' ? -1 : rows.length) : cur;
      const next = Math.max(0, Math.min(rows.length - 1, from + (k === 'j' ? 1 : -1)));
      rows.forEach((r) => r.removeClass('jp-dict-ex--focus'));
      rows[next].addClass('jp-dict-ex--focus');
      rows[next].scrollIntoView({ block: 'nearest' });
      return;
    }
    if ((k === 't' || e.key === 'Enter') && cur >= 0) {
      e.preventDefault();
      rows[cur].querySelector<HTMLElement>('.jp-dict-ex-capture')?.click();
    }
  }

  async onClose(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.findTimer) clearTimeout(this.findTimer);
    if (this.outlineAway) {
      document.removeEventListener('pointerdown', this.outlineAway, true);
      this.outlineAway = null;
    }
    this.vpeekEl?.remove(); this.vpeekEl = null;
    this.closePeekCard();
    this.peek?.cancel();
  }

  refresh(): void {
    if (this.currentQuery) this.performLookup(this.currentQuery);
    else this.renderHome();
  }

  /**
   * Public method for programmatic lookup (e.g. from editor selection command).
   *
   * `arrive` is the navigation tempo contract (コマ送り law 3 / DESIGN §30):
   * DESCEND (entering an entry from somewhere else) animates briefly so the
   * hand knows it went DOWN a level; FLIP (moving sideways — neighbour chips,
   * back) is instant, 0 frames, because the hand stayed at the same depth.
   * No `arrive` means flip. `light` is the arrival's cause — the sentence or
   * word that carried you here — and it lands lit in a tan band (item 7:
   * every arrival lights what brought it, not only typed queries).
   */
  lookupWord(word: string, arrive?: { light?: string; tempo?: 'descend' | 'flip' }): void {
    this.historyMode = false;
    this.pendingArrive = arrive ?? null;
    if (this.searchInput) this.searchInput.value = word;
    this.currentQuery = word;
    this.hideSuggestions();
    this.performLookup(word);
  }

  /**
   * Recursive lookup: push current query to history, then look up new word.
   * Used when tapping on Japanese text inside definitions.
   */
  private recursiveLookup(word: string, via?: SaveRelation): void {
    if (this.currentQuery && this.currentQuery !== word) {
      // Remember WHERE you were reading, not just what you were reading.
      // Coming back to the top of a 600-sense entry you had scrolled halfway
      // through is the same as not coming back at all. A new descend burns
      // the forward stack (Trail's law): you left that future.
      this.trail.push({
        word: this.currentQuery,
        scroll: this.resultsEl?.scrollTop ?? 0,
        via,
      });
    }
    this.lastVia = via;
    this.lookupWord(word, { tempo: 'descend' });
    this.renderBreadcrumbs();
  }

  /** The edge that brought us to the CURRENT word. */
  private lastVia: SaveRelation | undefined;

  /** Where the trail stands RIGHT NOW, for a back/forward step to file. */
  private currentStop(): { word: string; scroll: number; via?: SaveRelation } {
    return {
      word: this.currentQuery,
      scroll: this.resultsEl?.scrollTop ?? 0,
      via: this.lastVia,
    };
  }

  /** Navigate back, landing exactly where you left. Backing out is a POP —
   *  the page you return to arrives from the LEFT, the mirror of descend's
   *  push from the right, so the tempo tells the hand which way it moved
   *  through the stack (the iOS grammar the films breathe throughout).
   *  The stop you leave joins the FORWARD stack: 行って戻ってまた行く —
   *  both directions stay free (the films' back-and-forth, made real). */
  goBack(): boolean {
    if (this.historyMode) return false;
    const leaving = this.currentQuery;
    const prev = this.trail.back(this.currentStop());
    if (!prev) return false;
    this.lastVia = prev.via;
    this.lookupWord(prev.word);
    this.restoreScroll(prev.scroll);
    this.renderBreadcrumbs();
    this.slideResults('jp-dict-flick-right', leaving);
    return true;
  }

  /** The mirror: re-descend into the future you backed out of. */
  goForward(): boolean {
    if (this.historyMode) return false;
    const leaving = this.currentQuery;
    const next = this.trail.forward(this.currentStop());
    if (!next) return false;
    this.lastVia = next.via;
    this.lookupWord(next.word);
    this.restoreScroll(next.scroll);
    this.renderBreadcrumbs();
    this.slideResults('jp-dict-flick-left', leaving);
    return true;
  }

  /** The trail's edge-gesture face (view-chrome routes the suite edge drag
   *  through these, trail-first): what a back/forward drag would land on. */
  trailPeekBack(): string | null {
    if (this.historyMode) return null;
    return this.trail.peekBack()?.word ?? null;
  }
  trailPeekForward(): string | null {
    if (this.historyMode) return null;
    return this.trail.peekForward()?.word ?? null;
  }
  /** The page the edge drag rides. */
  pageEl(): HTMLElement | null { return this.resultsEl; }

  private slideResults(cls: string, ghostWord?: string): void {
    if (!this.resultsEl || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = this.resultsEl;
    el.removeClass('jp-dict-flick-left'); el.removeClass('jp-dict-flick-right');
    el.removeClass('jp-dict-flick-up'); el.removeClass('jp-dict-flick-down');
    void el.offsetWidth;
    el.addClass(cls);
    window.setTimeout(() => el.removeClass(cls), 220);
    // f40 — the walk ghost: the headword you LEFT drifts out in the
    // direction the page moved, so the motion SAYS you walked the index
    // (§26.0's one sanctioned animation — it encodes where you came from).
    // One element, opacity+transform only, gone in 360ms.
    if (ghostWord && ghostWord !== this.currentQuery) {
      const host = this.navBarEl?.parentElement;
      if (host) {
        const dir = cls.endsWith('-left') ? 'left' : cls.endsWith('-right') ? 'right'
          : cls.endsWith('-up') ? 'up' : 'down';
        const g = host.createDiv(`jp-dict-walkghost jp-dict-walkghost--${dir}`);
        g.setText(ghostWord);
        window.setTimeout(() => g.remove(), 380);
      }
    }
  }

  /**
   * Put the scroll position back after the results have actually been painted.
   *
   * A sidecar lookup is asynchronous, so setting scrollTop straight after
   * `lookupWord` sets it on the OLD content and the new render resets it to 0 —
   * which is exactly the "returning doesn't get you back to where you were"
   * symptom. Two frames is enough for the synchronous store; the generation
   * check stops a late sidecar result from yanking the view after the user has
   * started scrolling again.
   */
  private restoreScroll(top: number): void {
    if (!top) return;
    const gen = this.searchGen;
    let tries = 0;
    const put = (): void => {
      if (gen !== this.searchGen || !this.resultsEl) return;
      this.resultsEl.scrollTop = top;
      if (++tries < 4 && Math.abs(this.resultsEl.scrollTop - top) > 2) {
        requestAnimationFrame(put);
      }
    };
    requestAnimationFrame(put);
  }

  /** Render breadcrumb navigation for recursive lookups */
  private renderBreadcrumbs(): void {
    if (!this.breadcrumbEl) return;
    this.breadcrumbEl.empty();

    const stops = this.trail.backStops();
    if (stops.length === 0 && this.trail.forwardLength === 0) {
      this.breadcrumbEl.style.display = 'none';
      return;
    }

    this.breadcrumbEl.style.display = 'flex';

    // Back button
    const backBtn = this.breadcrumbEl.createEl('button', {
      text: '◀ 戻る',
      cls: 'jp-dict-back-btn',
    });
    if (stops.length === 0) backBtn.disabled = true;
    backBtn.addEventListener('click', () => this.goBack());

    // The trail is a PATH THROUGH THE RELATION GRAPH, not a list of words.
    // You did not merely arrive at 痛快 — you got there from 爽快 along 類語,
    // and that edge is the most useful thing on the screen: it is the same
    // vocabulary you save with, so the trail reads as lexical reasoning
    // rather than as browser history.
    for (let i = 0; i < stops.length; i++) {
      const hop = stops[i];
      const crumb = this.breadcrumbEl.createEl('span', {
        text: hop.word,
        cls: 'jp-dict-breadcrumb-item',
      });
      crumb.title = `${hop.word} に戻る（読んでいた位置まで）`;
      crumb.addEventListener('click', () => this.jumpBack(i));
      // The edge you travelled, named. `via` belongs to the hop you LEFT, so
      // it labels the arrow leaving it.
      const next = stops[i + 1];
      const via = (next ? next.via : this.lastVia) ?? undefined;
      if (via) {
        const e = this.breadcrumbEl.createSpan({ cls: 'jp-dict-breadcrumb-via', text: via });
        e.title = RELATION_SPECS[via]?.hint ?? '';
      }
      this.breadcrumbEl.createSpan({ text: ' → ', cls: 'jp-dict-breadcrumb-sep' });
    }

    // Current word (not clickable)
    this.breadcrumbEl.createEl('span', {
      text: this.currentQuery,
      cls: 'jp-dict-breadcrumb-current',
    });

    // Forward, when a future exists: the other half of 行き来. Same organ as
    // the right-edge drag, spoken as a chip so the state is VISIBLE.
    const fwd = this.trail.peekForward();
    if (fwd) {
      this.breadcrumbEl.createSpan({ text: ' → ', cls: 'jp-dict-breadcrumb-sep' });
      const f = this.breadcrumbEl.createEl('button', {
        text: `${fwd.word} ▶`, cls: 'jp-dict-fwd-btn',
      });
      f.title = `${fwd.word} へ進む（戻る前にいた項目）`;
      f.addEventListener('click', () => this.goForward());
    }
  }

  /** A crumb tap walks back through EVERY intermediate stop, so the whole
   *  path lands on the forward stack and remains re-walkable. */
  private jumpBack(index: number): void {
    let target: { word: string; scroll: number; via?: SaveRelation } | null = null;
    let cur = this.currentStop();
    while (this.trail.backLength > index) {
      const prev = this.trail.back(cur);
      if (!prev) break;
      target = prev;
      cur = prev;
    }
    if (!target) return;
    this.lastVia = target.via;
    this.lookupWord(target.word);
    this.restoreScroll(target.scroll);
    this.renderBreadcrumbs();
    this.slideResults('jp-dict-flick-right');
  }

  /**
   * Make text elements with Japanese content clickable for recursive lookup.
   * This wraps runs of Japanese characters in <span> elements with click handlers.
   */
  private makeJapaneseClickable(el: HTMLElement): void {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node.textContent && /[\u3040-\u9fff\u30a0-\u30ff]/.test(node.textContent)) {
        textNodes.push(node);
      }
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent ?? '';
      // Split into Japanese runs and non-Japanese runs
      const parts = text.split(/([\u3040-\u9fff\u30a0-\u30ff\u4e00-\u9faf]+)/g);
      if (parts.length <= 1) continue;

      const frag = document.createDocumentFragment();
      for (const part of parts) {
        if (/^[\u3040-\u9fff\u30a0-\u30ff\u4e00-\u9faf]+$/.test(part)) {
          const span = document.createElement('span');
          span.textContent = part;
          span.className = 'jp-dict-clickable-word';
          // A tap that ENDS a selection is not a request to navigate. Every
          // run of Japanese in the entry is a lookup target, so trying to
          // select a phrase — drag across it, release — used to land on
          // whichever word you released over and throw the entry away.
          // Selecting must beat navigating, or the text is not selectable.
          span.addEventListener('pointerdown', (e) => {
            (e.currentTarget as HTMLElement).dataset.jpDownX = String(e.clientX);
            (e.currentTarget as HTMLElement).dataset.jpDownY = String(e.clientY);
          });
          span.addEventListener('click', (e) => {
            const sel = window.getSelection?.();
            if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;
            const el = e.currentTarget as HTMLElement;
            const dx = Math.abs(e.clientX - Number(el.dataset.jpDownX ?? e.clientX));
            const dy = Math.abs(e.clientY - Number(el.dataset.jpDownY ?? e.clientY));
            if (dx > 6 || dy > 6) return;             // a drag, not a tap
            e.preventDefault();
            e.stopPropagation();
            // The filmed grammar (IMG_1184 t125–170): a word tap PEEKS over
            // the page; descent is a choice made on the card. Explicit
            // cross-reference links (entry-grammar's → arrows) still jump —
            // an arrow IS the stated intent to go.
            this.openPeekCard(part, { x: e.clientX, y: e.clientY });
          });
          frag.appendChild(span);
        } else {
          frag.appendChild(document.createTextNode(part));
        }
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }

  // ── The navigation grammar (§30 / コマ送り items 7, 8, 16 + the two
  //    recovered items: in-screen find and the descend/flip tempo) ────────

  /**
   * Runs after every render of the results — the sync store half AND the
   * async sidecar half. Consumes the pending tempo once, then does the three
   * jobs that must never miss a render: light the arrival's cause, refresh
   * the neighbour chips, re-apply an open find.
   */
  private afterRender(): void {
    const a = this.pendingArrive;
    if (a?.tempo === 'descend' && this.resultsEl
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const el = this.resultsEl;
      el.removeClass('jp-dict-descend');
      void el.offsetWidth; // restart when two descends chain back-to-back
      el.addClass('jp-dict-descend');
      window.setTimeout(() => el.removeClass('jp-dict-descend'), 240);
    }
    if (a) a.tempo = undefined; // descend runs once; retries only carry light
    this.applyArrival();
    this.renderNavBar();
    this.renderContinue();
    this.renderVrel();
    this.renderHomophones();
    this.rerunFind();
  }

  /**
   * Land lit from the first frame (item 7): the sentence or word that carried
   * you here sits in a tan band when the screen settles — filmed at 1175
   * f0406 and f10384, the single strongest Monokakido habit. The band goes on
   * the DEEPEST element containing the cause (the sense row, the example
   * line), found by linear descent — cheap, no full-tree scan. Stays pending
   * until some render can satisfy it (the cause may be in a sidecar card that
   * has not answered yet); cleared by the next lookup.
   */
  private applyArrival(): void {
    const light = this.pendingArrive?.light?.trim();
    if (!light || !this.resultsEl) return;
    const target = this.deepestWith(this.resultsEl, light)
      ?? this.deepestWith(this.resultsEl, light.slice(0, 20));
    if (!target) return;
    this.pendingArrive = null;
    this.resultsEl.querySelectorAll('.jp-dict-arrive-band')
      .forEach((el) => el.removeClass('jp-dict-arrive-band'));
    target.addClass('jp-dict-arrive-band');
    target.scrollIntoView({ block: 'center' });
  }

  private deepestWith(root: HTMLElement, text: string): HTMLElement | null {
    if (!text || !(root.textContent ?? '').includes(text)) return null;
    let el: HTMLElement = root;
    descend: for (;;) {
      for (const child of Array.from(el.children)) {
        if ((child.textContent ?? '').includes(text)) {
          el = child as HTMLElement;
          continue descend;
        }
      }
      break;
    }
    return el === root ? null : el;
  }

  /**
   * Neighbours for the current query, arming THROUGH inflection: 食べていた
   * has no place of its own in the walkable order, but its first hit 食べる
   * does — the walk arms on any word the imported shelf can NAME, not only
   * exact keys. Cached per query because the pan asks on every pointermove.
   * (Sidecar-only words still have no place: the 6.1M-term walkable order
   * needs shard-level support and is its own queued build — STATE §8.)
   */
  private nbCache: { q: string; nb: ReturnType<DictionaryStore['neighbors']> } | null = null;
  private currentNeighbors(): ReturnType<DictionaryStore['neighbors']> {
    const q = this.currentQuery;
    if (!q || this.historyMode) return null;
    if (this.nbCache?.q === q) return this.nbCache.nb;
    let nb = this.dictStore.neighbors(q);
    if (!nb) {
      const first = this.dictStore.lookup(q)[0]?.term.expression;
      if (first && first !== q) nb = this.dictStore.neighbors(first);
    }
    this.nbCache = { q, nb };
    return nb;
  }

  /** The bottom-corner chips: who stands beside the current word. */
  private renderNavBar(): void {
    if (!this.navBarEl || !this.nbPrevEl || !this.nbNextEl) return;
    const nb = this.currentNeighbors();
    const set = (btn: HTMLButtonElement, h: { expression: string } | null, arrow: 'prev' | 'next'): void => {
      if (!h) { btn.addClass('jp-dict-nb--void'); btn.disabled = true; btn.setText(''); return; }
      btn.removeClass('jp-dict-nb--void');
      btn.disabled = false;
      btn.setText(arrow === 'prev' ? `〈 ${h.expression}` : `${h.expression} 〉`);
    };
    set(this.nbPrevEl, nb?.prev ?? null, 'prev');
    set(this.nbNextEl, nb?.next ?? null, 'next');
    this.navBarEl.toggleClass('jp-dict-navbar--bare', !nb);
  }

  /**
   * FLIP to a neighbour — sideways moves replace the current place: the
   * breadcrumb trail neither grows nor pops, exactly like turning a page.
   * A chip tap is a hard cut (filmed: f11732→11733, the swap happens between
   * two frames); a pan or flick passes `slide`, and the new page finishes
   * the turn from the direction the hand was already moving.
   */
  flipTo(word: string, slide?: 'left' | 'right' | 'up' | 'down'): void {
    const leaving = this.currentQuery;
    this.lookupWord(word);
    this.renderBreadcrumbs();
    if (slide) {
      this.slideResults(`jp-dict-flick-${slide}`, leaving);
      // The vertical walk is the BOOK: continuing upward off an entry's top
      // lands at the END of the previous one — the page above, read from
      // where it left off — while downward lands at the next one's head.
      if (slide === 'down') this.scrollToEndAfterRender();
    }
  }

  /** After the next render settles, put the scroll at the stack's END. */
  private scrollToEndAfterRender(): void {
    const gen = this.searchGen;
    let tries = 0;
    const put = (): void => {
      if (gen !== this.searchGen || !this.resultsEl) return;
      const el = this.resultsEl;
      el.scrollTop = el.scrollHeight;
      if (++tries < 4) requestAnimationFrame(put);
    };
    requestAnimationFrame(put);
  }

  flipStep(dir: 1 | -1, slide?: 'left' | 'right' | 'up' | 'down'): void {
    if (this.historyMode || !this.currentQuery) return;
    const nb = this.currentNeighbors();
    const target = dir > 0 ? nb?.next : nb?.prev;
    if (!target) return;
    this.flipTo(target.expression, slide);
  }

  /**
   * The kindle-quick page turn, CORRECTED (2026-08-26). The first build was
   * a release-time flick — a discrete swap the hand never felt, the exact
   * mistake the Aug-25 review warned about: a "scrolly" correction answered
   * with a more discrete model. Now the page RIDES THE FINGER:
   *
   *   • TOUCH: axis-lock engages the pan at 14px of horizontal dominance;
   *     the stack follows the finger (compositor transform only), rubber-
   *     bands ×0.35 toward a page that does not exist, and the release asks
   *     `panVerdict` — carried past 28% of the pane, or thrown ≥0.5px/ms,
   *     the turn completes from the direction the hand was moving; anything
   *     less snaps back. `touch-action: pan-y` on the results (styles.css)
   *     is what lets a horizontal touch reach us without fighting the
   *     vertical scroller.
   *   • PEN never pans: on iPadOS a Pencil drag across text IS the
   *     selection gesture, and the films' law 2 says the Pencil points and
   *     selects while the finger scrolls and turns. A pen page-turn stays
   *     the release-time fast flick, which cannot collide with selection
   *     because a non-collapsed selection wins outright.
   *   • Mouse excluded entirely; the 28px edge zones belong to edge-back.
   */
  private armEntryPan(el: HTMLElement): void {
    let id = -1, x0 = 0, y0 = 0, t0 = 0, fromEdge = false, engaged = false, raf = 0, dx = 0;
    const paint = (): void => {
      raf = 0;
      el.style.transform = dx ? `translateX(${dx}px)` : '';
    };
    const reset = (animate: boolean): void => {
      engaged = false;
      id = -1;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (animate && el.style.transform) {
        el.style.transition = 'transform 130ms ease-out';
        el.style.transform = '';
        window.setTimeout(() => { el.style.transition = ''; }, 160);
      } else {
        el.style.transition = '';
        el.style.transform = '';
      }
      dx = 0;
    };
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; t0 = e.timeStamp;
      engaged = false; dx = 0;
      const w = window.innerWidth;
      fromEdge = x0 < 28 || x0 > w - 28;
    }, { passive: true });
    el.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.pointerId !== id || fromEdge) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (!engaged) {
        if (e.pointerType !== 'touch') return;
        if (Math.abs(mx) < 14 || Math.abs(mx) < Math.abs(my) * 1.2) return;
        const sel = window.getSelection?.();
        if (sel && !sel.isCollapsed && sel.toString().trim()) return;
        if (this.historyMode || !this.currentQuery) return;
        engaged = true;
        try { el.setPointerCapture(id); } catch { /* older webview */ }
      }
      const nb = this.currentNeighbors();
      const target = mx < 0 ? nb?.next : nb?.prev;
      dx = target ? mx : mx * 0.35;
      if (!raf) raf = requestAnimationFrame(paint);
    }, { passive: true });
    el.addEventListener('pointerup', (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const mx = e.clientX - x0, my = e.clientY - y0, dt = e.timeStamp - t0;
      if (engaged) {
        // An engaged pan consumed the gesture — the click that follows it is
        // not a second instruction (the pointer-drag lesson).
        const swallow = (c: Event): void => { c.preventDefault(); c.stopPropagation(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener('click', swallow, true), 300);
        const nb = this.currentNeighbors();
        const target = mx < 0 ? nb?.next : nb?.prev;
        const verdict = panVerdict(Math.abs(mx), dt, el.clientWidth || window.innerWidth, !!target);
        reset(verdict === 'snap');
        if (verdict === 'commit' && target) this.flipTo(target.expression, mx < 0 ? 'left' : 'right');
        return;
      }
      reset(false);
      if (fromEdge) return;
      const sel = window.getSelection?.();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      if (dt <= 0 || dt > 350) return;
      if (Math.abs(mx) < 64 || Math.abs(mx) < Math.abs(my) * 1.5) return;
      if (Math.abs(mx) / dt < 0.45) return;
      // Reading direction: flick left = the page turns forward.
      this.flipStep(mx < 0 ? 1 : -1, mx < 0 ? 'left' : 'right');
    }, { passive: true });
    el.addEventListener('pointercancel', (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      reset(true);
    }, { passive: true });
  }

  /**
   * The VERTICAL walk — the dictionary as one continuous book (the user's
   * own correction, 2026-08-27: the films show vertical nav; the previous
   * build recorded at-end continuation as a refusal and answered a vertical
   * ask with a horizontal-only grammar). Kindle-continuous, riding the hand:
   *
   *   • The results scroller keeps its native ↕ scroll. When it stands at an
   *     END as the touch BEGINS, further travel past that end is no longer a
   *     scroll — it is the next page being pulled in. The stack follows the
   *     finger (compositor transform), the incoming headword shows in a peek
   *     band at that end, rubber-bands ×0.35 when no neighbour exists, and
   *     release asks the same `panVerdict` the sideways pan asks (distance
   *     against the pane HEIGHT, or a throw).
   *   • Downward continuation (off the entry's top) lands at the END of the
   *     previous entry — the page above, read from where it left off.
   *   • `overscroll-behavior: contain` (styles.css) keeps the platform's own
   *     bounce from eating the travel. A drag that starts mid-entry and
   *     reaches the end stays a scroll — the walk needs a fresh tug, which
   *     is exactly a book's rhythm (and dodges iOS's mid-gesture claim).
   *   • Touch only. The Pencil selects (law 2); a mouse wheels.
   */
  private vpeekEl: HTMLElement | null = null;
  private armVerticalWalk(el: HTMLElement): void {
    let id = -1, x0 = 0, y0 = 0, t0 = 0, engaged = false, raf = 0, dy = 0;
    let atTop0 = false, atBottom0 = false;
    let target: { expression: string; reading: string } | null = null;
    const paint = (): void => {
      raf = 0;
      el.style.transform = dy ? `translateY(${dy}px)` : '';
      if (this.vpeekEl) {
        const commitPx = (el.clientHeight || window.innerHeight) * 0.28;
        this.vpeekEl.toggleClass('jp-dict-vpeek--armed', Math.abs(dy) > commitPx);
      }
    };
    const dropPeek = (): void => { this.vpeekEl?.remove(); this.vpeekEl = null; };
    const reset = (animate: boolean): void => {
      engaged = false; id = -1; target = null;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (animate && el.style.transform) {
        el.style.transition = 'transform 130ms ease-out';
        el.style.transform = '';
        window.setTimeout(() => { el.style.transition = ''; }, 160);
      } else {
        el.style.transition = '';
        el.style.transform = '';
      }
      dy = 0;
      dropPeek();
    };
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (engaged) return; // a second finger never steals a walk in progress
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; t0 = e.timeStamp;
      dy = 0;
      atTop0 = el.scrollTop <= 0;
      atBottom0 = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    }, { passive: true });
    el.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (!engaged) {
        if (Math.abs(my) < 18 || Math.abs(my) < Math.abs(mx) * 1.2) return;
        // Direction must match the pinned end this touch STARTED at.
        const up = my < 0;
        if (up && !(atBottom0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1)) return;
        if (!up && !(atTop0 && el.scrollTop <= 0)) return;
        const sel = window.getSelection?.();
        if (sel && !sel.isCollapsed && sel.toString().trim()) return;
        if (this.historyMode || !this.currentQuery) return;
        engaged = true;
        try { el.setPointerCapture(id); } catch { /* older webview */ }
        const nb = this.currentNeighbors();
        target = (up ? nb?.next : nb?.prev) ?? null;
        dropPeek();
        const band = this.navBarEl!.parentElement!.createDiv(
          `jp-dict-vpeek jp-dict-vpeek--${up ? 'bottom' : 'top'}`);
        if (target) {
          band.createSpan({ text: up ? '▼' : '▲', cls: 'jp-dict-vpeek-arrow' });
          band.createSpan({ text: target.expression, cls: 'jp-dict-vpeek-expr' });
          if (target.reading && target.reading !== target.expression) {
            band.createSpan({ text: target.reading, cls: 'jp-dict-vpeek-reading' });
          }
        } else {
          band.createSpan({ text: up ? '最後の項目' : '最初の項目', cls: 'jp-dict-vpeek-reading' });
        }
        this.vpeekEl = band;
      }
      dy = target ? my : my * 0.35;
      if (!raf) raf = requestAnimationFrame(paint);
    }, { passive: true });
    el.addEventListener('pointerup', (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      if (!engaged) { id = -1; return; }
      const my = e.clientY - y0, dt = e.timeStamp - t0;
      const swallow = (c: Event): void => { c.preventDefault(); c.stopPropagation(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, true), 300);
      const t = target;
      const verdict = panVerdict(Math.abs(my), dt, el.clientHeight || window.innerHeight, !!t);
      reset(verdict === 'snap');
      if (verdict === 'commit' && t) this.flipTo(t.expression, my < 0 ? 'up' : 'down');
    }, { passive: true });
    el.addEventListener('pointercancel', (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      reset(true);
    }, { passive: true });
  }

  /**
   * The visible half of the vertical walk: the next entry BEGINS at the end
   * of this one, the way a book's next page simply exists below the fold.
   * One slim row after the last card — headword, reading, つづく — tappable,
   * and the standing invitation that makes the at-end tug discoverable
   * without a tutorial (§26.0 test b). Re-placed by afterRender so the
   * async sidecar half cannot strand it mid-stack.
   */
  private renderContinue(): void {
    if (!this.resultsEl) return;
    this.resultsEl.querySelectorAll('.jp-dict-continue').forEach((n) => n.remove());
    if (this.historyMode || !this.currentQuery) return;
    const nb = this.currentNeighbors();
    if (!nb?.next) return;
    const next = nb.next;
    const row = this.resultsEl.createDiv('jp-dict-continue');
    row.createSpan({ text: 'つづく', cls: 'jp-dict-continue-label' });
    row.createSpan({ text: next.expression, cls: 'jp-dict-continue-expr' });
    if (next.reading && next.reading !== next.expression) {
      row.createSpan({ text: next.reading, cls: 'jp-dict-continue-reading' });
    }
    row.createSpan({ text: '▼', cls: 'jp-dict-continue-arrow' });
    row.addEventListener('click', () => this.flipTo(next.expression, 'up'));
  }

  /**
   * 縦の関連 — the filmed 類語 column (IMG_1184 t130–175): related words
   * standing in VERTICAL columns beside the entry, each one pressable.
   * Ours holds what this vault actually knows about the word: homophones,
   * the walkable neighbours, and the 台帳 patterns that contain it (class-
   * dotted — S1's one grammar). A press PEEKS (the card), never jumps —
   * the column is a place to look sideways from, not a list of exits.
   * Wide panes only: on a phone the horizontal homophone row already
   * serves, and a column over a phone's text is an obstruction.
   */
  private renderVrel(): void {
    const host = this.navBarEl?.parentElement;
    if (!host) return;
    host.querySelectorAll('.jp-dict-vrel').forEach((n) => n.remove());
    if (this.historyMode || !this.currentQuery || !this.resultsEl) return;
    if (host.clientWidth < 620) return;
    if (!this.resultsEl.querySelector('.jp-dict-card')) return;

    const q = this.currentQuery;
    const seen = new Set<string>([q]);
    const items: Array<{ word: string; cls?: NoteClass; ratified?: boolean }> = [];
    for (const h of this.dictStore.homophones(q)) {
      if (!seen.has(h.expression) && items.length < 4) { seen.add(h.expression); items.push({ word: h.expression }); }
    }
    const nb = this.currentNeighbors();
    for (const n of [nb?.prev, nb?.next]) {
      if (n && !seen.has(n.expression) && items.length < 6) { seen.add(n.expression); items.push({ word: n.expression }); }
    }
    for (const p of this.patternsIn?.(q) ?? []) {
      if (!seen.has(p.key) && items.length < 10) {
        seen.add(p.key);
        items.push({ word: p.key, cls: p.class, ratified: p.classRatified !== false });
      }
    }
    if (!items.length) return;

    const col = host.createDiv('jp-dict-vrel');
    col.createDiv({ text: '関連', cls: 'jp-dict-vrel-label' });
    for (const it of items) {
      const row = col.createDiv('jp-dict-vrel-item');
      if (it.cls) classDot(row, it.cls, { ratified: it.ratified !== false });
      row.createSpan({ text: it.word });
      row.addEventListener('click', (e) => {
        this.openPeekCard(it.word, { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY });
      });
    }
  }

  /**
   * QUICK NAV — hold a neighbour chip and the dictionary riffles (Monokakido's
   * paddles under a held thumb; the films' walk is chip-chip-chip, never
   * press-wait-press). Steps are hard cuts; the accelerating schedule
   * (dict-nav.riffleDelay) is the feedback. Works for finger, Pencil and
   * mouse alike — a press is the one gesture every device produces.
   */
  private armRiffle(btn: HTMLButtonElement, dir: 1 | -1): void {
    let hold: ReturnType<typeof setTimeout> | null = null;
    let stepT: ReturnType<typeof setTimeout> | null = null;
    let steps = 0;
    const stop = (): void => {
      if (hold) { clearTimeout(hold); hold = null; }
      if (stepT) { clearTimeout(stepT); stepT = null; }
      if (steps > 0) {
        const swallow = (c: Event): void => { c.preventDefault(); c.stopPropagation(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener('click', swallow, true), 300);
      }
      steps = 0;
      btn.removeClass('jp-dict-nb--riffling');
    };
    const step = (): void => {
      this.flipStep(dir); // hard cut — the filmed chip flip
      stepT = setTimeout(step, riffleDelay(steps++));
    };
    btn.addEventListener('pointerdown', () => {
      stop();
      hold = setTimeout(() => {
        btn.addClass('jp-dict-nb--riffling');
        step();
      }, RIFFLE_HOLD_MS);
    }, { passive: true });
    btn.addEventListener('pointerup', stop, { passive: true });
    btn.addEventListener('pointercancel', stop, { passive: true });
    btn.addEventListener('pointerleave', stop, { passive: true });
  }

  /** Pinch-in on the results = collapse to the outline. Two pointers,
   *  distance shrinks past 72%, fires once per touch; all passive. */
  private armPinchOutline(el: HTMLElement): void {
    const pts = new Map<number, { x: number; y: number }>();
    let d0 = 0, fired = false;
    const dist = (): number => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { d0 = dist(); fired = false; }
    }, { passive: true });
    el.addEventListener('pointermove', (e: PointerEvent) => {
      if (!pts.has(e.pointerId) || pts.size !== 2 || fired || !d0) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (dist() < d0 * 0.72) { fired = true; this.toggleOutline(); }
    }, { passive: true });
    const drop = (e: PointerEvent): void => { pts.delete(e.pointerId); if (pts.size < 2) d0 = 0; };
    el.addEventListener('pointerup', drop, { passive: true });
    el.addEventListener('pointercancel', drop, { passive: true });
  }

  /**
   * ≡ — the current screen's own table of contents (item 9): one row per
   * entry card, tap → the card scrolls into view with its header tinted.
   * Opens ABOVE the bar it came from — off-hand, where the popover is
   * readable without the sweep the films measured (170ms per menu).
   */
  private outlineAway: ((e: PointerEvent) => void) | null = null;

  toggleOutline(): void {
    if (this.outlinePop) {
      this.outlinePop.remove();
      this.outlinePop = null;
      if (this.outlineAway) {
        document.removeEventListener('pointerdown', this.outlineAway, true);
        this.outlineAway = null;
      }
      return;
    }
    if (!this.resultsEl || !this.navBarEl) return;
    const cards = Array.from(this.resultsEl.querySelectorAll<HTMLElement>('.jp-dict-card'));
    if (!cards.length) return;
    const pop = this.navBarEl.parentElement!.createDiv('jp-dict-outline-pop');
    this.outlinePop = pop;
    for (const card of cards) {
      const expr = card.querySelector('.jp-dict-card-expression')?.textContent ?? '';
      const reading = card.querySelector('.jp-dict-card-reading')?.textContent ?? '';
      const dict = card.querySelector('.jp-dict-dict-badge')?.textContent ?? '';
      const row = pop.createDiv('jp-dict-outline-row');
      row.createSpan({ text: expr, cls: 'jp-dict-outline-expr' });
      if (reading) row.createSpan({ text: reading, cls: 'jp-dict-outline-reading' });
      row.createSpan({ text: dict, cls: 'jp-dict-outline-dict' });
      row.addEventListener('click', () => {
        this.toggleOutline();
        // Monokakido's ≡ scrolls TO its target over ~200ms with the target
        // tinted — the eye rides the motion to the landing.
        card.scrollIntoView({ block: 'start', behavior: 'smooth' });
        card.addClass('jp-dict-arrive-flash');
        window.setTimeout(() => card.removeClass('jp-dict-arrive-flash'), 1400);
      });
    }
    // Tap anywhere else closes — a popover that traps you is worse than none.
    // The handler lives on the instance so EVERY close path (button, pinch,
    // outside tap) removes it; a leaked capture listener taxes every tap.
    this.outlineAway = (e: PointerEvent): void => {
      if (this.outlinePop && !this.outlinePop.contains(e.target as Node)) this.toggleOutline();
    };
    const away = this.outlineAway;
    window.setTimeout(() => {
      if (this.outlineAway === away) document.addEventListener('pointerdown', away, true);
    }, 0);
  }

  // ── The peek card: the filmed intermediate step (IMG_1184 t125–170) ──
  //
  // Pressing a word in Monokakido raises a floating card OVER the page —
  // summary, category, Find, and 「Show Full Entry」 — and the page never
  // moves. Descent is a choice made ON THE ANSWER, not a consequence of
  // touching a word; that is what makes the walk feel like standing still,
  // and its absence is why every tap here used to cost your place.

  private peekCard: HTMLElement | null = null;
  private peekAway: ((e: PointerEvent) => void) | null = null;

  closePeekCard(): void {
    this.peekCard?.remove();
    this.peekCard = null;
    if (this.peekAway) {
      document.removeEventListener('pointerdown', this.peekAway, true);
      this.peekAway = null;
    }
  }

  openPeekCard(word: string, at: { x: number; y: number }): void {
    this.closePeekCard();
    const host = this.navBarEl?.parentElement;
    if (!host || !word.trim()) return;
    const card = host.createDiv('jp-dict-peekcard');
    this.peekCard = card;

    const head = card.createDiv('jp-dict-peekcard-head');
    head.createSpan({ text: word, cls: 'jp-dict-peekcard-hw' });
    const body = card.createDiv('jp-dict-peekcard-body');
    body.setText('…');

    // Items 12–13's grammar, here too: a word the 台帳 already holds says
    // so on the card, wearing its class mark, and the chip is a door.
    const known = this.patternsIn?.(word) ?? [];
    if (known.length && this.openPattern) {
      const exact = known.find((k) => k.key === word) ?? known[0];
      const chip = card.createDiv('jp-dict-peekcard-known');
      classDot(chip, exact.class, { ratified: exact.classRatified !== false });
      chip.createSpan({
        text: exact.key === word ? 'もう台帳にある' : `台帳に ${known.length}件`,
        cls: 'jp-dict-peekcard-known-label',
      });
      chip.addEventListener('click', () => { this.closePeekCard(); this.openPattern!(exact.id); });
    }

    // The doors, in the filmed order: descend is the MAIN act but never the
    // only one — Find scopes to this word without leaving the page at all.
    const acts = card.createDiv('jp-dict-peekcard-acts');
    const full = acts.createEl('button', { text: '全文を表示', cls: 'jp-dict-peekcard-act jp-dict-peekcard-act--main' });
    full.addEventListener('click', () => {
      this.closePeekCard();
      this.recursiveLookup(word);
    });
    const find = acts.createEl('button', { text: '画面内を検索', cls: 'jp-dict-peekcard-act' });
    find.addEventListener('click', () => {
      this.closePeekCard();
      this.toggleFind(true);
      if (this.findInput) {
        this.findInput.value = word;
        this.findInput.dispatchEvent(new Event('input'));
      }
    });

    // Clamped near the tap, never off the pane.
    const r = host.getBoundingClientRect();
    const W = Math.min(300, r.width - 16);
    card.style.width = `${W}px`;
    card.style.left = `${Math.max(8, Math.min(at.x - r.left - W / 2, r.width - W - 8))}px`;
    card.style.top = `${Math.max(8, Math.min(at.y - r.top + 16, Math.max(8, r.height - 210)))}px`;

    // The ONE shared answer road (view-chrome): a tap, a selection and a
    // hover can never disagree about what a word means.
    if (this.lookUp) {
      void this.lookUp(word).then(
        (d) => {
          if (this.peekCard !== card) return;
          head.empty();
          head.createSpan({ text: d?.headword ?? word, cls: 'jp-dict-peekcard-hw' });
          if (d?.reading && d.reading !== d.headword) {
            head.createSpan({ text: d.reading, cls: 'jp-dict-peekcard-reading' });
          }
          if (d?.deinflection?.length) {
            head.createSpan({ text: `〈${d.deinflection.join('+')}〉`, cls: 'jp-lex-deinflect' });
          }
          body.setText(d?.def ? d.def.slice(0, 220) : '辞書に該当なし');
        },
        () => { if (this.peekCard === card) body.setText('辞書を読めませんでした'); },
      );
    } else {
      // No shared road wired (a bare-constructed view): say so honestly
      // rather than reimplementing a second gloss extractor here (§28 S5 —
      // one answer path, or none).
      body.setText(this.dictStore.lookup(word).length ? '（全文を表示で読む）' : '辞書に該当なし');
    }

    // Tap-away closes with your place untouched (the outline's own rule —
    // instance-owned so every close path removes the capture listener).
    const away = (e: PointerEvent): void => {
      if (this.peekCard === card && !card.contains(e.target as Node)) this.closePeekCard();
    };
    this.peekAway = away;
    window.setTimeout(() => {
      if (this.peekAway === away) document.addEventListener('pointerdown', away, true);
    }, 0);
  }

  // ── In-screen find (the recovered 答え合わせ item): re-find a passage
  //    INSIDE what is already open, instead of a new dictionary query. ──

  toggleFind(open?: boolean): void {
    const want = open ?? !this.findBarEl;
    if (!want) { this.closeFind(); return; }
    if (this.findBarEl) { this.findInput?.focus(); return; }
    if (!this.navBarEl) return;
    const bar = this.navBarEl.parentElement!.createDiv('jp-dict-find-bar');
    this.findBarEl = bar;
    this.findInput = bar.createEl('input', {
      type: 'search', cls: 'jp-dict-find-input',
      placeholder: 'この画面内を検索…',
      attr: { autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' },
    });
    this.findCountEl = bar.createSpan({ cls: 'jp-dict-find-count' });
    const prev = bar.createEl('button', { text: '↑', cls: 'jp-dict-find-step', attr: { 'aria-label': '前へ' } });
    const next = bar.createEl('button', { text: '↓', cls: 'jp-dict-find-step', attr: { 'aria-label': '次へ' } });
    const close = bar.createEl('button', { text: '✕', cls: 'jp-dict-find-step', attr: { 'aria-label': '閉じる' } });
    prev.addEventListener('click', () => this.stepFind(-1));
    next.addEventListener('click', () => this.stepFind(1));
    close.addEventListener('click', () => this.closeFind());
    this.findInput.addEventListener('input', () => {
      if (this.findTimer) clearTimeout(this.findTimer);
      this.findTimer = setTimeout(() => this.runFind(this.findInput?.value ?? ''), 150);
    });
    this.findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.stepFind(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); this.closeFind(); }
    });
    this.findInput.focus();
  }

  private closeFind(): void {
    this.clearFindHits();
    if (this.findTimer) { clearTimeout(this.findTimer); this.findTimer = null; }
    this.findBarEl?.remove();
    this.findBarEl = null;
    this.findInput = null;
    this.findCountEl = null;
  }

  /** A render replaced the DOM under an open find — run it again on the new
   *  content, silently. The hits array only ever points at live nodes. */
  private rerunFind(): void {
    if (!this.findBarEl || !this.findInput) return;
    this.findHits = [];
    this.findAt = -1;
    const q = this.findInput.value;
    if (q.trim()) this.runFind(q, /*keepScroll*/ true);
  }

  private runFind(query: string, keepScroll = false): void {
    this.clearFindHits();
    const q = query.trim();
    if (!q || !this.resultsEl) { this.findCountEl?.setText(''); return; }
    // Collect first, mutate after — splitting text nodes mid-walk invalidates
    // the walker. Latin matches case-insensitively; Japanese matches exactly.
    const walker = document.createTreeWalker(this.resultsEl, NodeFilter.SHOW_TEXT);
    const plan: Array<{ node: Text; idx: number }> = [];
    const lower = q.toLowerCase();
    let n: Text | null;
    while ((n = walker.nextNode() as Text | null)) {
      const hay = n.data;
      let from = 0;
      for (;;) {
        const i = hay.toLowerCase().indexOf(lower, from);
        if (i < 0) break;
        plan.push({ node: n, idx: i });
        from = i + q.length;
        if (plan.length >= 300) break;
      }
      if (plan.length >= 300) break;
    }
    // Wrap back-to-front per node so earlier indices stay valid.
    for (let i = plan.length - 1; i >= 0; i--) {
      const { node, idx } = plan[i];
      const hit = node.splitText(idx);
      hit.splitText(q.length);
      const mark = document.createElement('mark');
      mark.className = 'jp-dict-find-hit';
      node.parentNode?.insertBefore(mark, hit);
      mark.appendChild(hit);
      this.findHits.unshift(mark as unknown as HTMLElement);
    }
    this.findAt = -1;
    this.findCountEl?.setText(this.findHits.length
      ? `${this.findHits.length}件` : '0件');
    if (this.findHits.length && !keepScroll) this.stepFind(1);
  }

  private clearFindHits(): void {
    for (const m of this.findHits) {
      const parent = m.parentNode;
      if (!parent) continue;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    }
    this.findHits = [];
    this.findAt = -1;
  }

  private stepFind(d: 1 | -1): void {
    if (!this.findHits.length) return;
    if (this.findAt >= 0) this.findHits[this.findAt]?.removeClass('jp-dict-find-hit--current');
    this.findAt = (this.findAt + d + this.findHits.length) % this.findHits.length;
    const cur = this.findHits[this.findAt];
    cur.addClass('jp-dict-find-hit--current');
    cur.scrollIntoView({ block: 'center' });
    this.findCountEl?.setText(`${this.findAt + 1}/${this.findHits.length}件`);
  }

  /**
   * A tilde-mode search (〜X = Ends, X〜 = Starts) is answered whole from the
   * in-memory indexes — the sidecars have no ends-scan, and the stats line
   * says so instead of pretending they were asked.
   */
  private renderNotationSearch(nota: { mode: 'ends' | 'starts'; term: string }, query: string): void {
    if (!this.resultsEl || !this.statsEl) return;
    this.searchGen++; // a sidecar answer in flight must not paint over this
    const results = nota.mode === 'ends'
      ? this.dictStore.endsWithSearch(nota.term, 40)
      : this.dictStore.prefixSearch(nota.term, 40);
    const modeName = nota.mode === 'ends' ? '後方一致' : '前方一致';
    this.statsEl.empty();
    this.statsEl.createSpan({
      text: `「${query}」${modeName} ${results.length}件（ローカル辞書のみ）`,
      cls: 'jp-dict-stat-text',
    });
    this.resultsEl.empty();
    if (!results.length) {
      this.renderEmpty(`「${nota.term}」で${nota.mode === 'ends' ? '終わる' : '始まる'}見出し・読みはありません`);
    } else {
      for (const group of this.groupResults(results)) {
        this.renderEntryCard(this.resultsEl, group);
      }
    }
    this.historyStore?.record(query);
    this.afterRender();
  }

  /**
   * Homophone paging (gap item 6): the words that SOUND like this one, as
   * chips over the results — 決行 beside 血行, Monokakido's あさ/あした/ちょう
   * pages. A chip tap is a FLIP: same depth, instant, breadcrumbs untouched.
   */
  private renderHomophones(): void {
    if (!this.resultsEl || !this.currentQuery || this.historyMode) return;
    if (this.resultsEl.querySelector('.jp-dict-homophones')) return;
    if (!this.resultsEl.querySelector('.jp-dict-card')) return;
    const same = this.dictStore.homophones(this.currentQuery);
    if (!same.length) return;
    // A late (sidecar-half) prepend must not shift a page the hand is
    // already reading — only a fresh, unscrolled screen gets the row.
    if (this.resultsEl.scrollTop > 4) return;
    const row = createDiv('jp-dict-homophones');
    row.createSpan({ text: '同音', cls: 'jp-dict-homophones-label' });
    for (const h of same) {
      const chip = row.createEl('button', { cls: 'jp-dict-homophone', attr: { title: h.reading } });
      chip.setText(h.expression);
      chip.addEventListener('click', () => {
        this.lookupWord(h.expression);
        this.renderBreadcrumbs();
      });
    }
    this.resultsEl.prepend(row);
  }

  /**
   * The dated History (item 16) — 1,251 entries deep in Monokakido, a
   * session array here until now. Every row is a door back: tap → the word
   * opens with a descend. Grouped 今日/昨日/M月D日 by dict-nav.historyDays.
   */
  showHistory(): void {
    if (!this.resultsEl || !this.statsEl) return;
    this.searchGen++; // a sidecar answer in flight must not paint over this
    this.historyMode = true;
    this.pendingArrive = null;
    this.hideSuggestions();
    this.closeFind();
    const rows = this.historyStore?.rows() ?? [];
    this.statsEl.empty();
    this.statsEl.createSpan({ text: `履歴 ${rows.length}件`, cls: 'jp-dict-stat-text' });
    this.resultsEl.empty();
    if (!rows.length) {
      this.renderEmpty('まだ履歴がありません — 引いた語がここに日付つきで残ります。');
      this.renderNavBar();
      return;
    }
    const wrap = this.resultsEl.createDiv('jp-dict-hist');
    for (const day of historyDays(rows, Date.now())) {
      wrap.createDiv({ text: day.label, cls: 'jp-dict-hist-day' });
      for (const r of day.rows) {
        const row = wrap.createDiv('jp-dict-hist-row');
        row.createSpan({ text: r.word, cls: 'jp-dict-hist-word' });
        const t = new Date(r.at);
        row.createSpan({
          text: `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`,
          cls: 'jp-dict-hist-time',
        });
        row.addEventListener('click', () => this.lookupWord(r.word, { tempo: 'descend' }));
      }
    }
    this.renderNavBar();
  }

  // ── Build UI ───────────────────────────────────────────────

  private buildUI(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('jp-dict-view');
    // §29 — a word carried in from anywhere gets looked up; a video link
    // carried in is still a video (drop-intent decides, not the surface).
    // Paste is routed here too: the search box keeps its own ⌘V, everywhere
    // else in the view a paste means "do something with this".
    armDrops(container, this, 'dict', { paste: true });
    /**
     * The 辞書 gets the selection layer too — it was the one surface without it,
     * on a premise that turned out to be false.
     *
     * `view-chrome` recorded that 辞書 "already answers a selection with its own
     * relation-typed capture", so wiring the echo here would mean two bars for
     * one gesture. But `offerCapture` is not fired by a selection at all: it
     * hangs off an explicit ⚡ button that `entry-grammar` renders on each part,
     * cell and citation. Selecting free text inside a definition — a word in a
     * gloss you do not know, which is the single most common thing that happens
     * while reading a dictionary — did nothing whatsoever, on the surface whose
     * entire job is answering that question.
     *
     * So the two do not collide, they cover different gestures: press the ⚡ on
     * a part the book itself delimited and you get the relation menu; select
     * arbitrary text and you get its meaning and the ordinary verbs.
     */
    armSelectionEcho(container, this, 'dict');

    // §26.3 — the search box, its suggestions and the identity bar all live
    // under the reaching hand rather than at the top of the screen. Both docks
    // are null on the desktop, so each `?? header` below is the old code.
    //
    // The search box and its completions need WIDTH, so they take the foot bar.
    // Posting them into `edgeDock` is what crammed a text input into a 58px
    // floating rail on the iPad. Where the NAVIGATOR goes is no longer this
    // view's call — `mountSurfaceBar` resolves both docks itself, so a
    // destination lands in the same container on all four surfaces.
    const wide = wideDock(container);

    // Header
    const header = container.createDiv('jp-dict-header');
    mountSurfaceBar(container, this, 'dict', header);
    const titleRow = header.createDiv('jp-dict-title-row');
    titleRow.createEl('h4', { text: '辞書', cls: 'jp-dict-title' });
    this.headerActionsEl = titleRow.createDiv('jp-dict-header-actions');

    // Import button
    const importBtn = this.headerActionsEl.createEl('button', {
      text: '＋ Import',
      cls: 'jp-dict-import-btn',
      attr: { 'aria-label': 'Import Yomitan dictionary' },
    });
    importBtn.addEventListener('click', () => this.showImportDialog());

    // Manage button
    const manageBtn = this.headerActionsEl.createEl('button', {
      text: '⚙',
      cls: 'jp-dict-manage-btn',
      attr: { 'aria-label': 'Manage dictionaries' },
    });
    manageBtn.addEventListener('click', () => this.showManageDialog());

    // Search bar
    const searchRow = (wide ?? header).createDiv('jp-dict-search-row');
    this.searchInput = searchRow.createEl('input', {
      type: 'search',
      placeholder: '検索… (空白=絞り込み ・ 〜X=後方一致 ・ X〜=前方一致)',
      cls: 'jp-dict-search-input',
      attr: {
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
      },
    });
    this.searchInput.addEventListener('input', () => this.onSearchInput());
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.searchInput!.value = '';
        this.currentQuery = '';
        this.hideSuggestions();
        this.renderHome();
      }
    });

    // Clear button
    const clearBtn = searchRow.createEl('button', {
      text: '✕',
      cls: 'jp-dict-clear-btn',
      attr: { 'aria-label': 'Clear search' },
    });
    clearBtn.addEventListener('click', () => {
      if (this.searchInput) this.searchInput.value = '';
      this.currentQuery = '';
      this.hideSuggestions();
      this.renderHome();
      this.searchInput?.focus();
    });

    // The search SCOPES, worn on the bar the way the filmed app wears its
    // Word|Example tabs (IMG_1184 t177–186): where a query looks is a
    // visible mode ON the box, never a remembered setting. すべて keeps
    // today's merged walk; 見出し asks only the headword/reading road;
    // 本文 asks only the entry text (the substring road, made explicit).
    const scopeRow = (wide ?? header).createDiv('jp-dict-scopes');
    const scopes: Array<{ id: 'all' | 'head' | 'body'; label: string }> = [
      { id: 'all', label: 'すべて' },
      { id: 'head', label: '見出し' },
      { id: 'body', label: '本文' },
    ];
    for (const sc of scopes) {
      const chip = scopeRow.createEl('button', { text: sc.label, cls: 'jp-dict-scope' });
      if (this.searchScope === sc.id) chip.addClass('jp-dict-scope--active');
      chip.addEventListener('click', () => {
        this.searchScope = sc.id;
        scopeRow.querySelectorAll('.jp-dict-scope').forEach((c) => c.removeClass('jp-dict-scope--active'));
        chip.addClass('jp-dict-scope--active');
        if (this.currentQuery) this.performLiveSearch(this.currentQuery);
      });
    }

    // Breadcrumb navigation for recursive lookups
    this.breadcrumbEl = container.createDiv('jp-dict-breadcrumbs');
    this.breadcrumbEl.style.display = 'none';

    // Suggestions dropdown. In the dock too when there is one: a list of
    // completions that opens at the top of the screen while you are typing at
    // the bottom of it is a list you have to look away to read.
    this.suggestionsEl = (wide ?? container).createDiv('jp-dict-suggestions');
    this.suggestionsEl.style.display = 'none';

    // Stats
    this.statsEl = container.createDiv('jp-dict-stats');

    // Results
    this.resultsEl = container.createDiv('jp-dict-results');

    // ── The nav bar: controls where the hand rests, content where it isn't
    // (コマ送り law 5). Neighbour chips at the BOTTOM CORNERS — filmed at
    // 1175 f11670: the hand travels ballistically from the headword to the
    // corner chip in 0.2s and the new entry appears where the hand isn't.
    // The mid-cluster holds the screen's own verbs: outline, find, history.
    this.navBarEl = container.createDiv('jp-dict-navbar');
    this.nbPrevEl = this.navBarEl.createEl('button', {
      cls: 'jp-dict-nb jp-dict-nb--prev', attr: { 'aria-label': '前の見出し語' },
    });
    this.nbPrevEl.addEventListener('click', () => this.flipStep(-1));
    this.armRiffle(this.nbPrevEl, -1);
    const mid = this.navBarEl.createDiv('jp-dict-navbar-mid');
    const outlineBtn = mid.createEl('button', {
      text: '≡', cls: 'jp-dict-nb-mid', attr: { 'aria-label': 'この画面の目次' },
    });
    outlineBtn.addEventListener('click', () => this.toggleOutline());
    const findBtn = mid.createEl('button', {
      text: '検索', cls: 'jp-dict-nb-mid jp-dict-nb-mid--find', attr: { 'aria-label': '画面内検索' },
    });
    findBtn.addEventListener('click', () => this.toggleFind());
    const histBtn = mid.createEl('button', {
      text: '⏱', cls: 'jp-dict-nb-mid', attr: { 'aria-label': '履歴' },
    });
    histBtn.addEventListener('click', () => this.showHistory());
    this.nbNextEl = this.navBarEl.createEl('button', {
      cls: 'jp-dict-nb jp-dict-nb--next', attr: { 'aria-label': '次の見出し語' },
    });
    this.nbNextEl.addEventListener('click', () => this.flipStep(1));
    this.armRiffle(this.nbNextEl, 1);
    this.renderNavBar();

    // Kindle-quick sideways paging: the axis tells the hand its stratum —
    // ↕ scrolls within this entry stack, ↔ RIDES THE FINGER to the
    // neighbour (touch pan; pen keeps the fast flick — see armEntryPan).
    this.armEntryPan(this.resultsEl);
    // The VERTICAL walk: at an end, the next tug pulls the neighbouring
    // entry in — the dictionary as one continuous book (Kindle-quick,
    // riding the finger; the user's 2026-08-27 correction).
    this.armVerticalWalk(this.resultsEl);
    // The trail under the hand — left edge back, right edge forward, the
    // PAGE riding the finger — is the suite-level edge gesture (touch-nav
    // via view-chrome), which this view feeds trail-first through its
    // chrome (trailPeekBack/goBack, trailPeekForward/goForward, pageEl).
    // The pinch reflex, answered: pinch-in = collapse to the outline (the
    // splayed-fingers gesture Monokakido left unanswered at 1184 f4602).
    this.armPinchOutline(this.resultsEl);
  }

  // ── Search flow ────────────────────────────────────────────

  private onSearchInput(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    const query = this.searchInput?.value.trim() ?? '';

    if (!query) {
      this.currentQuery = '';
      this.hideSuggestions();
      this.renderHome();
      return;
    }

    // Live search: very short debounce (80ms) for alive feeling
    this.debounceTimer = setTimeout(() => {
      this.currentQuery = query;
      this.performLiveSearch(query);
    }, 80);
  }

  // ── the space-separated query grammar ──────────────────────
  //
  // Filmed (IMG_1197, 131–153s): 「ものの　そうでなけ」typed into this box
  // returned 「見つかりませんでした」 for twenty straight seconds — while the
  // plugin's own X pane advertises 「語をスペース区切りで入力すると、両方を
  // 含むツイートを探します (AND)」 one tab away. Two search boxes in one
  // plugin spoke two languages, and the film shows which one the hand
  // expected. Same grammar now: space (ASCII or 全角) means AND — the first
  // term finds entries, every further term must appear somewhere IN the
  // entry. 「ものの そうでな」 lands on the ものの entry whose example is
  // 「援軍があったからよかったものの、そうでなければ壊滅していた」.
  //
  // Whole-string lookup always runs FIRST: an English phrasal in 英辞郎
  // ("give up") is a headword WITH a space, and splitting it would break the
  // lookup that has always worked. The narrowing engages only when the whole
  // string finds nothing.

  /** How a narrowed search was derived, for the honest empty-message. */
  private static queryTerms(q: string): string[] {
    return q.split(/[\s　]+/).filter(Boolean);
  }

  /** Everything an entry says, flattened once for containment tests. */
  private entryText(r: DictLookupResult): string {
    const defs = r.term.definitions.map((d) => DictionaryStore.definitionToText(d)).join('\n');
    const extra = (r.entryBlocks || r.entryNodes)
      ? JSON.stringify([r.entryBlocks ?? null, r.entryNodes ?? null])
      : '';
    return `${r.term.expression}\n${r.term.reading}\n${defs}\n${extra}`;
  }

  private static bigHitText(h: BigDictHit): string {
    return `${h.entry.expression}\n${h.entry.reading ?? ''}\n${JSON.stringify(h.entry.senses ?? [])}${h.entry.nodes ? JSON.stringify(h.entry.nodes) : ''}`;
  }

  /** Exact-first merge of two local result lists, deduped. */
  private mergeResults(first: DictLookupResult[], second: DictLookupResult[]): DictLookupResult[] {
    const merged = [...first];
    const seen = new Set(first.map(r => `${r.term.expression}|${r.term.reading}|${r.dictionary}`));
    for (const r of second) {
      const key = `${r.term.expression}|${r.term.reading}|${r.dictionary}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(r);
      }
    }
    return merged;
  }

  /**
   * Live search: show inline results as you type (no separate suggestions).
   * Uses substringSearch to catch partial/contains matches.
   */
  private performLiveSearch(query: string): void {
    this.hideSuggestions();
    if (!this.resultsEl || !this.statsEl) return;
    // Typing supersedes any pending arrival, and leaves history mode.
    this.pendingArrive = null;
    this.historyMode = false;
    const gen = ++this.searchGen;

    // The tilde grammar (dict-nav.searchNotation): 〜たなら = Ends,
    // もし〜 = Starts — Monokakido's match modes in the alphabet every
    // notation field already speaks. A mode query is its own complete
    // answer; the ordinary walk below never runs for one.
    const nota = searchNotation(query);
    if (nota) { this.renderNotationSearch(nota, query); return; }

    // Merge: exact results first, then substring-only — unless a scope chip
    // narrows the road (見出し = the headword walk only; 本文 = entry text).
    let merged = this.searchScope === 'head'
      ? this.dictStore.lookup(query)
      : this.searchScope === 'body'
        ? this.dictStore.substringSearch(query, 40)
        : this.mergeResults(
          this.dictStore.lookup(query),
          this.dictStore.substringSearch(query, 20),
        );

    // Whole string found nothing and the query is several terms → the
    // narrowing grammar (see the block comment above).
    let narrowing: TermNarrowing | undefined;
    const terms = DictionaryView.queryTerms(query);
    if (!merged.length && terms.length > 1 && this.searchScope === 'all') {
      const primary = terms[0];
      const filters = terms.slice(1);
      const wide = this.mergeResults(
        this.dictStore.lookup(primary),
        this.dictStore.substringSearch(primary, 40),
      );
      narrowing = { primary, filters, primaryHits: wide.length };
      merged = wide.filter(r => filters.every(f => this.entryText(r).includes(f)));
    }

    if (!this.hasAnyDictionary()) {
      this.statsEl.empty();
      this.statsEl.createSpan({ text: 'No dictionaries imported yet', cls: 'jp-dict-stat-text' });
      this.renderEmpty('Import a Yomitan dictionary to get started. Tap "＋ Import" above.');
      return;
    }

    // "Not found" is only true once the sidecars have answered too — and the
    // provisional state must SAY it is provisional. The old placeholder read
    // 「見つかりませんでした」 while the sidecar search was still in flight,
    // which is a verdict, not a status (filmed: "common" declared missing with
    // 検索中… on the same screen). appendBigResults renders the real verdict.
    if (merged.length === 0) {
      this.renderEmpty(this.bigDict && this.searchScope !== 'body'
        ? `"${query}" — 変換済み辞書を検索中…`
        : this.missMessage(query, narrowing));
    } else {
      this.resultsEl.empty();
      for (const group of this.groupResults(merged)) {
        this.renderEntryCard(this.resultsEl, group);
      }
    }
    this.setStats(query, merged.length, !!this.bigDict && this.searchScope !== 'body', allDeinflected(merged));
    // A live query IS a lookup once it settles — recordLookup's refinement
    // rule collapses の→のば→のばあ into one history row, so recording per
    // debounce is safe (dict-nav.ts rule 1). Re-filter renders with NO
    // motion (コマ送り item 5: the list just changes) — afterRender only
    // animates an explicit descend, and typing cleared that above.
    this.historyStore?.record(query);
    this.afterRender();
    // 本文 scope is a promise about the IMPORTED text; the sidecars answer
    // by headword and would quietly widen the road the chip just narrowed.
    if (this.searchScope !== 'body') void this.appendBigResults(query, gen, merged, narrowing);
  }

  /**
   * The honest "nothing" — which names the term that failed when a narrowed
   * search dies, because 「見つかりませんでした」 alone cannot distinguish
   * "the word isn't in the books" from "your second term has a typo". The
   * film's query died on exactly that: そうでな**げ** for そうでな**け**, and
   * the flat message gave the hand nothing to fix.
   */
  private missMessage(query: string, narrowing?: TermNarrowing): string {
    if (narrowing && narrowing.primaryHits > 0) {
      return `「${narrowing.primary}」は ${narrowing.primaryHits}件 — `
        + `そのうち「${narrowing.filters.join('」「')}」を含む項目はありません`;
    }
    if (narrowing) {
      return `「${narrowing.primary}」が見つかりませんでした (空白区切り = 絞り込み)`;
    }
    return `"${query}" が見つかりませんでした`;
  }

  // ── the converted (sidecar) dictionaries ───────────────────

  /** Any dictionary at all — imported into the blob OR converted to a sidecar. */
  private hasAnyDictionary(): boolean {
    return this.dictStore.hasDictionaries() || this.bigInstalled.length > 0;
  }

  /** One stats line for both halves; `pending` marks a sidecar read in flight.
   *  `guessOnly` marks a result set where NOTHING matched the query directly —
   *  every hit is a deinflection guess. Filmed (IMG_1197 34–36s): 「3 entries
   *  for まない」 over three まる cards read as an assertion that まない IS
   *  まる. A guessed answer must not wear a direct answer's stats line. */
  private setStats(query: string, count: number, pending: boolean, guessOnly = false): void {
    if (!this.statsEl) return;
    this.statsEl.empty();
    // "0 entries" is an assertion; while a read is in flight the honest count
    // is "so far". Only a settled search may claim a number for zero.
    this.statsEl.createSpan({
      text: count === 0
        ? (pending ? `"${query}" — 検索中…` : `"${query}" — no results`)
        : guessOnly
          ? `「${query}」直接一致なし — 活用の逆引き ${count}件`
          : `${count} entries for "${query}"`,
      cls: 'jp-dict-stat-text',
    });
    if (pending) {
      this.statsEl.createSpan({ text: ' · 変換済み辞書を検索中…', cls: 'jp-dict-stat-pending' });
    }
  }

  /** Ask which sidecars are installed, then redraw the home screen with them. */
  private async refreshBigInstalled(): Promise<void> {
    if (!this.bigDict) return;
    try { this.bigInstalled = await this.bigDict.installed(); }
    catch (e) { console.error('[jp-collocations] sidecar list failed:', e); return; }
    if (!this.currentQuery) this.renderHome();
  }

  /**
   * Append the converted dictionaries' hits under whatever the in-memory store
   * already rendered.
   *
   * A sidecar lookup reads one shard file PER installed dictionary, so it can
   * easily land after the user has typed the next character. `gen` is what
   * makes that safe: a late answer for a query that is no longer on screen is
   * dropped rather than painted over the current one.
   */
  private async appendBigResults(
    query: string, gen: number, local: DictLookupResult[],
    narrowing?: TermNarrowing,
  ): Promise<void> {
    if (!this.bigDict) return;
    let hits: BigDictHit[];
    try {
      hits = await this.bigDict.lookup(query, 40);
      // Whole string missed the sidecars too and the query is several terms:
      // the same narrowing grammar as the local half — first term finds the
      // entries, the rest must appear in them.
      if (!hits.length && narrowing) {
        const wide = await this.bigDict.lookup(narrowing.primary, 60);
        narrowing.primaryHits += wide.length;
        hits = wide.filter(h =>
          narrowing.filters.every(f => DictionaryView.bigHitText(h).includes(f)));
      }
    } catch (e) {
      console.error('[jp-collocations] sidecar lookup failed:', e);
      if (gen === this.searchGen) {
        this.setStats(query, local.length, false, allDeinflected(local));
        // the provisional 検索中… placeholder must not outlive the search
        if (!local.length) this.renderEmpty(this.missMessage(query, narrowing));
      }
      return;
    }
    if (gen !== this.searchGen || !this.resultsEl || !this.statsEl) return;

    const extra = dedupeAgainst(hits, local);
    this.setStats(query, local.length + extra.length, false,
      allDeinflected([...local, ...extra]));
    // both halves answered with nothing — NOW "not found" is true
    if (!local.length && !extra.length) {
      this.renderEmpty(this.missMessage(query, narrowing));
      return;
    }
    if (!extra.length) return;

    // The placeholder was provisional — these entries are the answer to it.
    if (!local.length) this.resultsEl.empty();
    for (const group of this.groupResults(extra)) {
      this.renderEntryCard(this.resultsEl, group);
    }
    // The arrival's cause may live in a sidecar card that only now exists —
    // the light must land on the ASYNC half too, or the hold-chip road lights
    // nothing exactly when the word came from the big dictionaries (the
    // aperture-bug class: the mechanism ran, the async door missed it).
    this.afterRender();
  }

  private showSuggestions(prefix: string): void {
    if (!this.suggestionsEl) return;
    const suggestions = this.dictStore.prefixSearch(prefix, 8);

    if (suggestions.length === 0) {
      this.hideSuggestions();
      return;
    }

    this.suggestionsEl.empty();
    this.suggestionsEl.style.display = 'block';

    // Deduplicate by expression
    const seen = new Set<string>();
    for (const s of suggestions) {
      const key = s.term.expression;
      if (seen.has(key)) continue;
      seen.add(key);

      const row = this.suggestionsEl.createDiv('jp-dict-suggest-row');
      row.createSpan({ text: s.term.expression, cls: 'jp-dict-suggest-expr' });
      if (s.term.reading !== s.term.expression) {
        row.createSpan({ text: s.term.reading, cls: 'jp-dict-suggest-reading' });
      }
      if (s.frequency !== undefined) {
        row.createSpan({ text: `${s.frequency}`, cls: 'jp-dict-suggest-freq' });
      }

      row.addEventListener('click', () => {
        if (this.searchInput) this.searchInput.value = s.term.expression;
        this.currentQuery = s.term.expression;
        this.hideSuggestions();
        this.performLookup(s.term.expression);
      });
    }
  }

  private hideSuggestions(): void {
    if (this.suggestionsEl) {
      this.suggestionsEl.empty();
      this.suggestionsEl.style.display = 'none';
    }
  }

  private performLookup(query: string): void {
    this.hideSuggestions();
    if (!this.resultsEl || !this.statsEl) return;
    const gen = ++this.searchGen;

    // The tilde grammar — same branch as the live path.
    const nota = searchNotation(query);
    if (nota) { this.renderNotationSearch(nota, query); return; }

    let results = this.searchScope === 'body'
      ? this.dictStore.substringSearch(query, 40)
      : this.dictStore.lookup(query);

    // Whole string first, then the space-AND grammar — see performLiveSearch.
    let narrowing: TermNarrowing | undefined;
    const terms = DictionaryView.queryTerms(query);
    if (!results.length && terms.length > 1 && this.searchScope === 'all') {
      const primary = terms[0];
      const filters = terms.slice(1);
      const wide = this.mergeResults(
        this.dictStore.lookup(primary),
        this.dictStore.substringSearch(primary, 40),
      );
      narrowing = { primary, filters, primaryHits: wide.length };
      results = wide.filter(r => filters.every(f => this.entryText(r).includes(f)));
    }

    if (!this.hasAnyDictionary()) {
      this.statsEl.empty();
      this.statsEl.createSpan({ text: 'No dictionaries imported yet', cls: 'jp-dict-stat-text' });
      this.renderEmpty('Import a Yomitan dictionary to get started. Tap "＋ Import" above.');
      return;
    }

    if (results.length === 0) {
      // provisional while the sidecars are still reading (same rule as the
      // live path — appendBigResults renders the real verdict)
      this.renderEmpty(this.bigDict && this.searchScope !== 'body'
        ? `"${query}" — 変換済み辞書を検索中…`
        : this.missMessage(query, narrowing));
    } else {
      // Group by sequence & expression for merging related senses
      this.resultsEl.empty();
      for (const group of this.groupResults(results)) {
        this.renderEntryCard(this.resultsEl, group);
      }
    }
    this.setStats(query, results.length, !!this.bigDict && this.searchScope !== 'body', allDeinflected(results));
    this.historyStore?.record(query);
    this.afterRender();
    if (this.searchScope !== 'body') void this.appendBigResults(query, gen, results, narrowing);
  }

  // ── Group results ──────────────────────────────────────────

  private groupResults(results: DictLookupResult[]): DictLookupResult[][] {
    const groups: DictLookupResult[][] = [];
    const groupMap = new Map<string, DictLookupResult[]>();

    for (const r of results) {
      // Group by expression + reading + sequence
      const key = `${r.term.expression}|${r.term.reading}|${r.term.sequence}|${r.dictionary}`;
      if (!groupMap.has(key)) {
        const group: DictLookupResult[] = [];
        groupMap.set(key, group);
        groups.push(group);
      }
      groupMap.get(key)!.push(r);
    }

    return groups;
  }

  // ── Render entry card ──────────────────────────────────────

  private renderEntryCard(parent: HTMLElement, group: DictLookupResult[]): void {
    const primary = group[0];
    const card = parent.createDiv('jp-dict-card');

    // ── Header: expression + reading ─────────────────────────
    //
    // §29: the header is also the grip. Drag the headword onto the 語彙 view
    // and it opens capture already holding the word AND a real sense line — the
    // 辞書→台帳 road that used to be "select, remember it, switch view, retype".
    // The header only, never the definition body: senses are selectable text
    // and selection is this view's own capture verb.
    const headerRow = card.createDiv('jp-dict-card-header');
    makeDraggable(headerRow, () => {
      const sense = this.extractExampleFromDefs(group);
      return {
        kind: 'dict',
        text: sense ? `${primary.term.expression}\n${sense}` : primary.term.expression,
        label: primary.term.expression,
        sub: primary.term.reading !== primary.term.expression ? primary.term.reading : primary.dictionary,
        html: `<b>${primary.term.expression}</b>` +
          (primary.term.reading !== primary.term.expression ? `（${primary.term.reading}）` : '') +
          (sense ? `<br>${sense}` : '') + `<br><small>— ${primary.dictionary}</small>`,
        meta: { dictionary: primary.dictionary, headword: primary.term.expression, reading: primary.term.reading },
      };
    });

    const exprEl = headerRow.createSpan({
      text: primary.term.expression,
      cls: 'jp-dict-card-expression',
    });

    if (primary.term.reading !== primary.term.expression) {
      headerRow.createSpan({
        text: primary.term.reading,
        cls: 'jp-dict-card-reading',
      });
    }

    // Deinflection trail: this hit was reached from an inflected query
    // (食べていた → 食べる) — show HOW so the form is itself a lesson.
    if (primary.deinflection?.length) {
      headerRow.createSpan({
        text: `〈${primary.deinflection.join(' + ')}〉`,
        cls: 'jp-dict-deinflect-badge',
        attr: { title: '入力は活用形でした — 辞書形に戻して照合' },
      });
    }

    // ── Meta row: frequency + tags + dict badge ──────────────
    const metaRow = card.createDiv('jp-dict-card-meta');

    if (primary.frequency !== undefined && this.dictStore.settings.showFrequency) {
      const freqBadge = metaRow.createSpan({ cls: 'jp-dict-freq-badge' });
      freqBadge.createSpan({ text: '⚡', cls: 'jp-dict-freq-icon' });
      freqBadge.createSpan({ text: `${primary.frequency}`, cls: 'jp-dict-freq-value' });
    }

    // Term tags
    for (const tag of primary.tags.slice(0, 5)) {
      const pill = metaRow.createSpan({
        text: tag.notes || tag.name,
        cls: `jp-dict-tag jp-dict-tag--${tag.category || 'default'}`,
        attr: { title: `${tag.name}: ${tag.notes}` },
      });
    }

    // Dictionary badge
    metaRow.createSpan({
      text: primary.dictionary,
      cls: 'jp-dict-dict-badge',
    });

    // ── Pitch accent ─────────────────────────────────────────
    if (primary.pitch && this.dictStore.settings.showPitch) {
      this.renderPitchAccent(card, primary.pitch, primary.term.reading || primary.term.expression);
    }

    // ── The two questions (§27.2, shape-index.ts): 意味は ⇄ 使い方は ────
    // 「意味は」 every book answers; the plugin exists for 「使い方は」 — and
    // the nodes that answer it (使い分け・対比表・語群・文型・実例) live in a
    // handful of specialist books. The toggle exists ONLY when at least one
    // book in this group can answer (§28 S6 — no empty mode to fall into),
    // and the publisher-verbatim badges say who answers with what, before
    // any scrolling.
    const usable = group.filter((r) => r.entryNodes?.length && summarize(r.entryNodes).second);
    let usageOnly = false;

    const optsFor = (result: (typeof group)[number]) => ({
      highlight: this.currentQuery,
      onLookup: (w: string) => this.recursiveLookup(w),
      // The book's own illustrations, if they were extracted. Returning
      // undefined when the file is not there is what makes an un-extracted
      // vault show nothing instead of a broken frame (§28 S6).
      resolveMedia: (src: string) => this.resolveDictMedia(result.dictionary, src),
      headword: result.term.expression,
      // ONE capture verb for everything in the entry — a sense's example, a
      // synonym, a judgement cell and a citation all arrive here, and
      // `offeredBy` decides what each can honestly become. The old
      // example-only callback is deliberately not passed: two capture
      // behaviours on one screen is the drift this design prevents.
      onCapture: (sel: Selection, evt: MouseEvent) => this.offerCapture({
        ...sel, dictionary: result.dictionary, headword: result.term.expression,
      }, evt),
    });

    let usageToggle: HTMLButtonElement | null = null;
    if (usable.length) {
      const qRow = card.createDiv('jp-dict-usage-row');
      usageToggle = qRow.createEl('button', { cls: 'jp-dict-usage-toggle', text: '使い方は ▸' });
      usageToggle.title = 'この語の使い方だけを、持っている全辞書から — 使い分け・対比表・語群・文型・実例（語義は畳まれます）';
      usageToggle.onclick = () => {
        usageOnly = !usageOnly;
        usageToggle!.setText(usageOnly ? '意味は ▸' : '使い方は ▸');
        renderDefs();
      };
      // Publisher-verbatim badges: WHO answers, WITH WHAT. Capped at six with
      // the overflow stated — a silent cap reads as "that's all there is".
      const badges: Array<{ label: string; book: string }> = [];
      for (const r of usable) {
        for (const b of summarize(r.entryNodes!).badges) badges.push({ label: b.label, book: r.dictionary });
      }
      const shown = badges.slice(0, 6);
      for (const b of shown) {
        const chip = qRow.createSpan({ cls: 'jp-dict-usage-badge', text: b.label });
        chip.title = `${b.book} が「${b.label}」を持っています — タップで表示`;
        chip.onclick = () => {
          if (!usageOnly) { usageOnly = true; usageToggle!.setText('意味は ▸'); renderDefs(); }
          // Scope to the badge's OWN book first. The global search stays as
          // the fallback for a book that rendered no usage block, so the jump
          // is never silently wrong and never simply dead.
          const inBook = defsSection.querySelector<HTMLElement>(
            `.jp-dict-usage-book-block[data-jp-book="${CSS.escape(b.book)}"]`);
          const byLabel = (root: ParentNode): Element | undefined =>
            Array.from(root.querySelectorAll('.jp-shape-label')).find((x) => x.textContent === b.label);
          const target = (inBook ? byLabel(inBook) : undefined) ?? byLabel(defsSection);
          target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        };
      }
      if (badges.length > shown.length) {
        qRow.createSpan({ cls: 'jp-dict-usage-badge jp-dict-usage-badge--more', text: `+${badges.length - shown.length}` })
          .title = 'ほかにもあります — 使い方は で全部表示';
      }
    }

    // ── Definitions ──────────────────────────────────────────
    const defsSection = card.createDiv('jp-dict-defs');

    const renderDefs = (): void => {
      defsSection.empty();

      if (usageOnly && usable.length) {
        // The second question, asked of every book that can answer it at once.
        // Books with no usage apparatus simply do not appear — their absence
        // is the fact, and the mode itself is gated on ≥1 answer.
        for (const result of usable) {
          // Each book gets its OWN block, tagged with whose it is. Badges are
          // emitted per (book x labelled node), so two books that both carry a
          // section titled 使い分け produce two identical chips — and with the
          // nodes rendered flat into defsSection, the chip's jump resolved by
          // label TEXT alone, so both chips landed on the first book. The chip
          // has always known its book (b.book); now the DOM does too.
          const block = defsSection.createDiv('jp-dict-usage-book-block');
          block.dataset.jpBook = result.dictionary;
          const head = block.createDiv('jp-dict-usage-book');
          head.createSpan({ text: result.dictionary, cls: 'jp-dict-dict-badge' });
          renderEntryNodes(block, usageNodes(result.entryNodes!), optsFor(result));
        }
        this.makeJapaneseClickable(defsSection);
        this.attachExampleCaptures(defsSection, group);
        return;
      }

      let defIndex = 0;
      for (const result of group) {
        // §26.1 — when the source gave us real structure, typeset it: senses
        // numbered, 〔context〕/《register》 as their own marks, examples as
        // blocks. Only a dictionary whose tree was flattened at conversion falls
        // through to the prose path, and it SHOULD look worse — that is the
        // honest signal that it still needs re-converting (§28 S6).
        const renderOpts = optsFor(result);
        if (result.entryBlocks?.length) {
          renderEntryParts(defsSection, result.entryBlocks, renderOpts);
          // The book's RELATIONS, when it has any a sense list cannot hold — a
          // 類語対比表, a 語群, a corpus citation set. Drawn under the senses
          // because they are about the entry as a whole, not about one sense.
          if (result.entryNodes?.length) {
            renderEntryNodes(defsSection, result.entryNodes, renderOpts);
          }
          continue;
        }
        if (result.entryNodes?.length) {
          renderEntryNodes(defsSection, result.entryNodes, renderOpts);
          continue;
        }
        for (const def of result.term.definitions) {
          defIndex++;
          const defRow = defsSection.createDiv('jp-dict-def-row');
          defRow.createSpan({ text: `${defIndex}.`, cls: 'jp-dict-def-num' });

          const defContent = defRow.createDiv('jp-dict-def-content');
          this.renderDefinition(defContent, def);
        }
      }

      // Make all Japanese text in definitions clickable for recursive lookup
      this.makeJapaneseClickable(defsSection);

      // §22.5: every example sentence is one 🏷️ from the catalog — the
      // dictionary as a mine. Curated stratum; the door leads back here.
      this.attachExampleCaptures(defsSection, group);
    };
    renderDefs();

    // ── Copy button ──────────────────────────────────────────
    const actionsRow = card.createDiv('jp-dict-card-actions');

    const copyBtn = actionsRow.createEl('button', { text: 'Copy', cls: 'jp-dict-action-btn' });
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(primary.term.expression).then(() => {
        new Notice(`Copied: ${primary.term.expression}`);
      });
    });

    const insertBtn = actionsRow.createEl('button', { text: 'Insert', cls: 'jp-dict-action-btn' });
    insertBtn.addEventListener('click', () => {
      const editor = this.app.workspace.activeEditor?.editor;
      if (editor) {
        editor.replaceSelection(primary.term.expression);
        new Notice(`Inserted: ${primary.term.expression}`);
      }
    });

    // Save as collocation entry
    const saveBtn = actionsRow.createEl('button', { text: '💾 Save', cls: 'jp-dict-action-btn jp-dict-save-btn' });
    saveBtn.addEventListener('click', () => {
      // Extract first example sentence from definitions (structured content text)
      const exampleText = this.extractExampleFromDefs(group);
      this.onSaveEntry(
        primary.term.expression,
        primary.term.reading || primary.term.expression,
        exampleText,
      );
      new Notice(`Saved: ${primary.term.expression}`);
      saveBtn.textContent = '✓ Saved';
      saveBtn.disabled = true;
    });

    // Universal classify-capture: file this expression under one of the six
    // note classes (pattern catalog), with a definition example as context.
    if (this.onClassify) {
      const classifyBtn = actionsRow.createEl('button', { text: '🏷️ 分類', cls: 'jp-dict-action-btn' });
      classifyBtn.title = '6分類で台帳へ';
      classifyBtn.addEventListener('click', () => {
        this.onClassify!(primary.term.expression, this.extractExampleFromDefs(group) || undefined,
          { dict: group[0]?.dictionary ?? '辞書', headword: primary.term.expression });
      });
    }

    // ── §28 S1: your catalog, for this headword ──────────────
    // Placed ABOVE the context panel because "you already noticed this" outranks
    // curated senses in a production lexicon (§27.0.1: lived attestations first).
    const mine = this.patternsIn?.(primary.term.expression) ?? [];
    if (mine.length) {
      const row = card.createDiv('jp-dict-mine');
      row.createSpan({ text: '台帳', cls: 'jp-dict-mine-label' });
      for (const p of mine.slice(0, 6)) {
        const b = classBadge(row, p.class, { ratified: p.classRatified });
        b.querySelector('.jp-cls-badge-label')?.setText(p.key);
        b.title = `${NOTE_TYPES[p.class].label} — あなたの台帳にあります（タップで開く）`;
        if (this.openPattern) {
          b.style.cursor = 'pointer';
          b.onclick = () => this.openPattern!(p.id);
        }
      }
    }

    // ── Context Panel (lazy loaded on tap) ───────────────────
    if (this.contextEngine) {
      this.renderContextPanel(card, primary.term.expression);
    }
  }

  // ── Context Panel ──────────────────────────────────────────

  private renderContextPanel(card: HTMLElement, expression: string): void {
    const toggle = card.createDiv('jp-dict-ctx-toggle');
    toggle.createSpan({ text: '🔗 Context', cls: 'jp-dict-ctx-toggle-label' });
    toggle.createSpan({ text: '▸', cls: 'jp-dict-ctx-toggle-arrow' });

    let panelEl: HTMLElement | null = null;
    let loaded = false;

    toggle.addEventListener('click', async () => {
      if (panelEl) {
        const visible = panelEl.style.display !== 'none';
        panelEl.style.display = visible ? 'none' : '';
        toggle.querySelector('.jp-dict-ctx-toggle-arrow')!.textContent = visible ? '▸' : '▾';
        return;
      }
      if (loaded) return;
      loaded = true;
      toggle.querySelector('.jp-dict-ctx-toggle-arrow')!.textContent = '▾';

      panelEl = card.createDiv('jp-dict-ctx-panel');
      panelEl.createDiv({ text: 'Loading…', cls: 'jp-dict-ctx-loading' });

      try {
        const ctx = await this.contextEngine!.getContext(expression);
        panelEl.empty();
        this.fillContextPanel(panelEl, ctx, expression);
      } catch (e) {
        panelEl.empty();
        panelEl.createDiv({ text: 'Failed to load context', cls: 'jp-dict-ctx-error' });
      }
    });
  }

  private fillContextPanel(el: HTMLElement, ctx: ContextCard, expression: string): void {
    // ── Collocations ─────────────────────────────────────────
    // Grouped by RELATION, not by which store it came out of.
    //
    // "コロケーション (12)" as one flat list is the same mistake as a flat sense
    // list: 順番を待つ, 雨が降るのを待つ, 待ち受ける and じっと待つ are four different
    // facts about how 待つ combines, and the grouping is what makes any of them
    // reusable. Within a group the order is EVIDENTIAL (§20.3) — what you
    // actually met comes before what a book asserted.
    const bucket = new Map<SaveRelation, Array<{ surface: string; ex?: string; attested: boolean }>>();
    const put = (surface: string, ex: string | undefined, attested: boolean): void => {
      if (!surface) return;
      const rel = classifyCollocation(surface, expression);
      const list = bucket.get(rel) ?? [];
      list.push({ surface, ex, attested });
      bucket.set(rel, list);
    };
    for (const c of ctx.collocations) put(c.headword, c.exampleSentences?.[0], false);
    for (const s of ctx.surferEntries) put(s.surface, s.exampleSentences?.[0]?.text, true);

    // Specific relations first; plain co-occurrence last, where it belongs.
    const order = [...COLLOCATION_KINDS];
    for (const rel of order) {
      const list = bucket.get(rel);
      if (!list?.length) continue;
      list.sort((a, b) => Number(b.attested) - Number(a.attested));
      const sec = el.createDiv('jp-dict-ctx-section');
      const title = sec.createDiv({ text: `${rel} (${list.length})`, cls: 'jp-dict-ctx-section-title' });
      title.title = RELATION_SPECS[rel].hint;
      for (const it of list.slice(0, 6)) {
        const row = sec.createDiv('jp-dict-ctx-colloc-row');
        // 実 = you met this; 辞 = a dictionary asserted it. The distinction is
        // the whole point of the cascade, so it is visible per row.
        row.createSpan({
          cls: `jp-dict-ctx-evid jp-dict-ctx-evid--${it.attested ? 'lived' : 'curated'}`,
          text: it.attested ? '実' : '辞',
        }).title = it.attested ? '自分が出会った例' : '辞書が挙げた例';
        row.createSpan({ text: it.surface, cls: 'jp-dict-ctx-hw' });
        if (it.ex) row.createDiv({ text: it.ex.slice(0, 100), cls: 'jp-dict-ctx-example' });
      }
    }

    // ── Vault Occurrences ─────────────────────────────────────
    if (ctx.vaultOccurrences.length > 0) {
      const sec = el.createDiv('jp-dict-ctx-section');
      sec.createDiv({ text: `Vault (${ctx.vaultNoteCount} notes)`, cls: 'jp-dict-ctx-section-title' });
      for (const occ of ctx.vaultOccurrences.slice(0, 5)) {
        const row = sec.createDiv('jp-dict-ctx-vault-row');
        const link = row.createEl('a', { text: occ.fileName, cls: 'jp-dict-ctx-vault-link' });
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const file = this.app.vault.getAbstractFileByPath(occ.filePath);
          if (file) {
            this.app.workspace.openLinkText(occ.filePath, '', false);
          }
        });
        if (occ.context) {
          row.createDiv({ text: occ.context, cls: 'jp-dict-ctx-snippet' });
        }
        if (occ.nearbyPatterns.length > 0) {
          const pills = row.createDiv('jp-dict-ctx-pattern-pills');
          for (const pid of occ.nearbyPatterns.slice(0, 3)) {
            const pat = PATTERN_BY_ID.get(pid);
            if (!pat) continue;
            const color = CATEGORY_COLORS[pat.category as PatternCategory] || '#888';
            const pill = pills.createSpan({ text: pat.surface, cls: 'jp-dict-ctx-pattern-pill' });
            pill.style.borderColor = color;
            pill.style.color = color;
          }
        }
      }
    }

    // ── Typed bit-relations (sidecar) ────────────────────────
    if (ctx.bitRelations.length > 0) {
      const sec = el.createDiv('jp-dict-ctx-section');
      sec.createDiv({
        text: `✓ 型付き関係 (${ctx.bitRelations.length}) サイドカー`,
        cls: 'jp-dict-ctx-section-title',
      });
      const list = sec.createDiv('jp-dict-ctx-bitrel-list');
      for (const br of ctx.bitRelations.slice(0, 8)) {
        const row = list.createDiv('jp-dict-ctx-bitrel-row');
        row.dataset.reconciliation = br.reconciliation ?? 'unknown';
        row.title =
          `${br.label.replace(/_/g, ' ')} · reconciliation: ${br.reconciliation ?? 'n/a'} · ` +
          `conf ${(br.confidence ?? 0).toFixed(2)}`;
        row.createSpan({ text: br.label.replace(/_/g, ' '), cls: 'jp-dict-ctx-bitrel-label' });
        const pair = row.createDiv('jp-dict-ctx-bitrel-pair');
        pair.createSpan({
          text: br.sourceSurface,
          cls: br.matchedRole === 'source'
            ? 'jp-dict-ctx-bitrel-endpoint jp-dict-ctx-bitrel-endpoint--matched'
            : 'jp-dict-ctx-bitrel-endpoint',
        });
        pair.createSpan({ text: '→', cls: 'jp-dict-ctx-bitrel-arrow' });
        pair.createSpan({
          text: br.targetSurface,
          cls: br.matchedRole === 'target'
            ? 'jp-dict-ctx-bitrel-endpoint jp-dict-ctx-bitrel-endpoint--matched'
            : 'jp-dict-ctx-bitrel-endpoint',
        });
      }
    }

    // ── Co-occurring Patterns ────────────────────────────────
    if (ctx.coPatterns.length > 0) {
      const sec = el.createDiv('jp-dict-ctx-section');
      sec.createDiv({ text: `共起パターン (${ctx.patternCount})`, cls: 'jp-dict-ctx-section-title' });
      const grid = sec.createDiv('jp-dict-ctx-copat-grid');
      for (const cp of ctx.coPatterns.slice(0, 8)) {
        const chip = grid.createDiv('jp-dict-ctx-copat-chip');
        const color = CATEGORY_COLORS[cp.category as PatternCategory] || '#888';
        chip.style.borderLeft = `3px solid ${color}`;
        chip.createSpan({ text: cp.surface, cls: 'jp-dict-ctx-copat-surface' });
        chip.createSpan({ text: `×${cp.count}`, cls: 'jp-dict-ctx-copat-count' });
      }
    }

    // ── 語法 corpus examples (§22.7) ──────────────────────────
    //
    // Above 𝕏 because these are the only sentences on this card that arrive
    // with a document behind them. The 辞書 could already show you tweets
    // using a word and could not show you the corpus profile frozen onto your
    // own entry for it — the data was one join away from here the whole time.
    const corpusExamples = ctx.examples.filter(e => e.source === 'corpus');
    if (corpusExamples.length > 0) {
      const sec = el.createDiv('jp-dict-ctx-section');
      sec.createDiv({ text: `📊 語法 用例 (${corpusExamples.length})`, cls: 'jp-dict-ctx-section-title' });
      for (const ex of corpusExamples.slice(0, 6)) {
        const row = sec.createDiv('jp-dict-ctx-x-row');
        row.createDiv({ text: ex.text.slice(0, 140), cls: 'jp-dict-ctx-x-text' });
        const meta = row.createDiv('jp-dict-ctx-x-meta');
        // The citation, always — a corpus sentence with no visible source
        // cannot be told from an invented one (§28 S3).
        if (ex.sourceDetail) {
          const cite = meta.createSpan({ text: ex.sourceDetail.slice(0, 60), cls: 'jp-dict-ctx-corpus-cite' });
          cite.title = ex.sourceDetail;
          const url = ex.sourceDetail.match(/https?:\/\/\S+/)?.[0];
          if (url) {
            cite.addClass('jp-dict-ctx-x-link');
            cite.addEventListener('click', () => window.open(url, '_blank'));
          }
        }
      }
    }

    // ── X usage examples ─────────────────────────────────────
    const xExamples = ctx.examples.filter(e => e.source === 'x');
    if (xExamples.length > 0) {
      const sec = el.createDiv('jp-dict-ctx-section');
      sec.createDiv({ text: `𝕏 用例 (${xExamples.length})`, cls: 'jp-dict-ctx-section-title' });
      for (const ex of xExamples.slice(0, 6)) {
        const row = sec.createDiv('jp-dict-ctx-x-row');
        row.createDiv({ text: ex.text.slice(0, 140), cls: 'jp-dict-ctx-x-text' });
        const meta = row.createDiv('jp-dict-ctx-x-meta');
        if (ex.patterns.length > 0) {
          const seen = new Set<string>();
          for (const m of ex.patterns.slice(0, 4)) {
            if (seen.has(m.pattern.id)) continue;
            seen.add(m.pattern.id);
            const color = CATEGORY_COLORS[m.pattern.category as PatternCategory] || '#888';
            const pill = meta.createSpan({ text: m.pattern.surface, cls: 'jp-dict-ctx-pattern-pill' });
            pill.style.borderColor = color;
            pill.style.color = color;
          }
        }
        const link = meta.createEl('a', { text: '↗ X', cls: 'jp-dict-ctx-x-link' });
        link.addEventListener('click', (e) => {
          e.preventDefault();
          if (ex.sourceDetail) window.open(ex.sourceDetail, '_blank');
        });
      }
    }

    // ── Open in Lexicon button ───────────────────────────────
    const navRow = el.createDiv('jp-dict-ctx-nav');
    const lexBtn = navRow.createEl('button', { text: '📖 Open in Lexicon', cls: 'jp-dict-action-btn jp-dict-ctx-lexicon-btn' });
    lexBtn.addEventListener('click', () => {
      this.navigateToLexicon(expression);
    });
  }

  private navigateToLexicon(query: string): void {
    const leaves = this.app.workspace.getLeavesOfType(JP_COLLOCATIONS_VIEW_TYPE);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      (leaves[0].view as CollocationView).openContextCard(query);
    } else {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        leaf.setViewState({ type: JP_COLLOCATIONS_VIEW_TYPE, active: true }).then(() => {
          this.app.workspace.revealLeaf(leaf);
          setTimeout(() => {
            (leaf.view as CollocationView).openContextCard(query);
          }, 200);
        });
      }
    }
  }

  /** §22.5: attach a quiet 🏷️ to each LEAF block that reads as an example
   *  sentence. Leaf-only + containment dedupe so nested structured content
   *  never doubles up. */
  private attachExampleCaptures(root: HTMLElement, group: DictLookupResult[]): void {
    if (!this.onClassify) return;
    const dict = group[0]?.dictionary ?? '辞書';
    const headword = group[0]?.term.expression ?? '';
    const claimed: HTMLElement[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('li, p, div, span'))) {
      if (el.querySelector('li, p, div')) continue;                    // leaves only
      const text = el.textContent?.trim() ?? '';
      if (!isExampleLine(text)) continue;
      const jp = exampleJapanese(text);
      if (jp === headword) continue;                                   // the headword itself is not an example
      if (claimed.some((c) => c.contains(el) || el.contains(c))) continue;
      claimed.push(el);
      const btn = el.createEl('button', { text: '🏷️', cls: 'jp-dict-ex-capture' });
      btn.setAttribute('aria-label', 'この用例を台帳へ（📖 辞書層）（キー: j/k で選択 → t）');
      btn.setAttribute('title', 'この用例を台帳へ（キー: j/k → t）');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onClassify!(jp, text, { dict, headword });
      });
    }
  }

  /** Try to extract an example sentence from structured definitions */
  private extractExampleFromDefs(group: DictLookupResult[]): string | undefined {
    for (const result of group) {
      for (const def of result.term.definitions) {
        const text = this.extractExampleFromContent(def);
        if (text) return text;
      }
    }
    return undefined;
  }

  private extractExampleFromContent(def: YomitanDefinition): string | undefined {
    if (typeof def === 'string') return undefined;
    if (Array.isArray(def)) return undefined;
    if (def.type === 'structured-content' && def.content) {
      return this.findExampleInStructured(def.content);
    }
    return undefined;
  }

  private findExampleInStructured(content: YomitanStructuredContent): string | undefined {
    if (typeof content === 'string') {
      // Heuristic: example sentences tend to be longer and contain Japanese
      if (content.length > 10 && /[\u3040-\u309f]/.test(content) && /[。？！]/.test(content)) {
        return content;
      }
      return undefined;
    }
    if (Array.isArray(content)) {
      for (const child of content) {
        const found = this.findExampleInStructured(child);
        if (found) return found;
      }
      return undefined;
    }
    const node = content as YomitanContentNode;
    // Look for elements with example-related data attributes or classes
    if (node.data?.['content'] === 'example' || node.data?.['sga-type'] === 'example') {
      return this.collectText(node.content);
    }
    if (node.content) {
      return this.findExampleInStructured(node.content);
    }
    return undefined;
  }

  private collectText(content: YomitanStructuredContent | undefined): string | undefined {
    if (!content) return undefined;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(c => this.collectText(c)).filter(Boolean).join('');
    }
    if ((content as YomitanContentNode).content) {
      return this.collectText((content as YomitanContentNode).content);
    }
    return undefined;
  }

  // ── Render definition ──────────────────────────────────────

  private renderDefinition(parent: HTMLElement, def: YomitanDefinition): void {
    if (typeof def === 'string') {
      parent.createSpan({ text: def, cls: 'jp-dict-def-text' });
      return;
    }

    if (Array.isArray(def)) {
      // Deinflection tuple
      parent.createSpan({ text: `→ ${def[0]}`, cls: 'jp-dict-def-deinflect' });
      if (def[1].length > 0) {
        parent.createSpan({ text: ` (${def[1].join(' → ')})`, cls: 'jp-dict-def-rules' });
      }
      return;
    }

    if (def.type === 'text' && def.text) {
      parent.createSpan({ text: def.text, cls: 'jp-dict-def-text' });
      return;
    }

    if (def.type === 'structured-content' && def.content) {
      this.renderStructuredContent(parent, def.content);
      return;
    }

    if (def.type === 'image') {
      parent.createSpan({ text: '[image]', cls: 'jp-dict-def-text jp-dict-def-image' });
      return;
    }

    // Fallback: stringify
    const text = DictionaryStore.definitionToText(def);
    if (text) parent.createSpan({ text, cls: 'jp-dict-def-text' });
  }

  // ── Render structured content ──────────────────────────────

  private renderStructuredContent(parent: HTMLElement, content: YomitanStructuredContent): void {
    if (typeof content === 'string') {
      parent.appendText(content);
      return;
    }

    if (Array.isArray(content)) {
      for (const child of content) {
        this.renderStructuredContent(parent, child);
      }
      return;
    }

    // It's a node object
    const node = content as YomitanContentNode;
    const { tag } = node;

    if (tag === 'br') {
      parent.createEl('br');
      return;
    }

    // Map to safe HTML elements
    const safeTagMap: Record<string, keyof HTMLElementTagNameMap> = {
      span: 'span', div: 'div', ol: 'ol', ul: 'ul', li: 'li',
      ruby: 'ruby', rt: 'rt', rp: 'rp',
      table: 'table', thead: 'thead', tbody: 'tbody', tfoot: 'tfoot',
      tr: 'tr', td: 'td', th: 'th',
      details: 'details', summary: 'summary',
    };

    const htmlTag = safeTagMap[tag];
    if (htmlTag) {
      const el = parent.createEl(htmlTag, { cls: 'jp-dict-sc' });

      // Apply inline styles (limited safe subset)
      if (node.style) {
        this.applyStyles(el, node.style);
      }

      if (node.title) el.title = node.title;

      // data attributes
      if (node.data) {
        for (const [k, v] of Object.entries(node.data)) {
          el.dataset[k] = v;
        }
        // §22.5: example sentences are FIRST-CLASS rows — dictionaries mark
        // them via data attributes (Yomitan: content=example / sga-type=example)
        const dv = Object.values(node.data);
        if (dv.includes('example') || dv.includes('example-sentence') || dv.includes('examples')) {
          el.addClass('jp-dict-sc--example');
        }
      }

      if (node.content) {
        this.renderStructuredContent(el, node.content);
      }
      return;
    }

    // Link tag
    if (tag === 'a' && node.href) {
      // Internal dictionary links start with ?
      if (node.href.startsWith('?')) {
        const linkEl = parent.createEl('a', { cls: 'jp-dict-internal-link' });
        linkEl.textContent = '';
        if (node.content) this.renderStructuredContent(linkEl, node.content);
        linkEl.addEventListener('click', (e) => {
          e.preventDefault();
          const target = node.href!.slice(1); // remove leading ?
          const parts = new URLSearchParams(target);
          const query = parts.get('query') || parts.get('term') || decodeURIComponent(target);
          if (query) {
            this.recursiveLookup(query);
          }
        });
        return;
      }
      // External links — render as text (no external nav from plugin)
      const span = parent.createSpan({ cls: 'jp-dict-ext-link' });
      if (node.content) this.renderStructuredContent(span, node.content);
      return;
    }

    // Image
    if (tag === 'img') {
      parent.createSpan({ text: '[img]', cls: 'jp-dict-def-image' });
      return;
    }

    // Unknown tag — render content as text
    if (node.content) {
      this.renderStructuredContent(parent, node.content);
    }
  }

  private applyStyles(el: HTMLElement, style: Record<string, string | number>): void {
    // Only apply safe CSS properties
    const safe: Record<string, string> = {
      fontStyle: 'font-style',
      fontWeight: 'font-weight',
      fontSize: 'font-size',
      color: 'color',
      backgroundColor: 'background-color',
      textDecorationLine: 'text-decoration-line',
      textDecorationStyle: 'text-decoration-style',
      verticalAlign: 'vertical-align',
      textAlign: 'text-align',
      listStyleType: 'list-style-type',
    };
    for (const [key, cssName] of Object.entries(safe)) {
      if (key in style) {
        el.style.setProperty(cssName, String(style[key]));
      }
    }
  }

  // ── Pitch accent rendering ─────────────────────────────────

  private renderPitchAccent(parent: HTMLElement, pitch: YomitanPitchInfo, reading: string): void {
    const pitchContainer = parent.createDiv('jp-dict-pitch-container');

    for (const p of pitch.pitches) {
      const moraRow = pitchContainer.createDiv('jp-dict-pitch-row');

      // Split reading into morae
      const morae = this.splitMorae(reading);
      const position = typeof p.position === 'number' ? p.position : -1;

      // Pitch pattern: determine high/low for each mora
      for (let i = 0; i < morae.length; i++) {
        const mora = morae[i];
        const isHigh = this.isMoraHigh(i, position, morae.length);
        const moraEl = moraRow.createSpan({
          text: mora,
          cls: `jp-dict-pitch-mora ${isHigh ? 'jp-dict-pitch-high' : 'jp-dict-pitch-low'}`,
        });

        // Draw connector line
        if (i < morae.length - 1) {
          const nextHigh = this.isMoraHigh(i + 1, position, morae.length);
          if (isHigh !== nextHigh) {
            moraRow.createSpan({ cls: 'jp-dict-pitch-drop' });
          }
        }
      }

      // Label
      if (position === 0) {
        moraRow.createSpan({ text: '(平板)', cls: 'jp-dict-pitch-label' });
      } else if (position === 1) {
        moraRow.createSpan({ text: '(頭高)', cls: 'jp-dict-pitch-label' });
      } else if (position === morae.length) {
        moraRow.createSpan({ text: '(尾高)', cls: 'jp-dict-pitch-label' });
      } else if (position > 0) {
        moraRow.createSpan({ text: '(中高)', cls: 'jp-dict-pitch-label' });
      }
    }
  }

  private isMoraHigh(index: number, downstep: number, totalMorae: number): boolean {
    if (downstep === 0) {
      // Heiban: first mora low, rest high
      return index > 0;
    }
    if (downstep === 1) {
      // Atamadaka: first mora high, rest low
      return index === 0;
    }
    // Nakadaka / Odaka: first mora low, high until downstep, then low
    return index > 0 && index < downstep;
  }

  private splitMorae(text: string): string[] {
    const morae: string[] = [];
    const small = new Set('ゃゅょャュョぁぃぅぇぉァィゥェォっッ');
    for (let i = 0; i < text.length; i++) {
      if (i > 0 && small.has(text[i])) {
        morae[morae.length - 1] += text[i];
      } else {
        morae.push(text[i]);
      }
    }
    return morae;
  }

  // ── Home / empty states ────────────────────────────────────

  private renderHome(): void {
    if (!this.resultsEl || !this.statsEl) return;

    this.statsEl.empty();
    this.resultsEl.empty();

    if (!this.hasAnyDictionary()) {
      this.statsEl.createSpan({ text: 'No dictionaries loaded', cls: 'jp-dict-stat-text' });

      const empty = this.resultsEl.createDiv('jp-dict-empty-state');
      empty.createDiv({ cls: 'jp-dict-empty-icon', text: '📚' });
      empty.createEl('h5', { text: 'Import a Yomitan Dictionary' });
      empty.createEl('p', {
        text: 'Import .zip files exported from Yomitan/Yomichan (JMdict, JMnedict, KANJIDIC, etc.).',
        cls: 'jp-dict-empty-desc',
      });
      const importBtn = empty.createEl('button', {
        text: '＋ Import Dictionary',
        cls: 'jp-dict-import-btn jp-dict-import-btn--large',
      });
      importBtn.addEventListener('click', () => this.showImportDialog());
      return;
    }

    // Show dictionary stats — BOTH halves. The converted dictionaries are the
    // overwhelming majority of what is installed here (6.1M headwords against
    // the imported store's tens of thousands); a count that omitted them would
    // be the same lie the search results used to tell.
    const dicts = this.dictStore.getDictionaryList();
    const total = this.dictStore.getTotalTermCount();
    const bigTerms = this.bigInstalled.reduce((n, d) => n + d.headwords, 0);
    const nDicts = dicts.length + this.bigInstalled.length;
    this.statsEl.createSpan({
      text: `${nDicts} dict${nDicts !== 1 ? 's' : ''} · ${(total + bigTerms).toLocaleString()} terms`,
      cls: 'jp-dict-stat-text',
    });

    // Dictionary cards
    const home = this.resultsEl.createDiv('jp-dict-home');
    home.createEl('p', {
      text: 'Type to search across all imported dictionaries.',
      cls: 'jp-dict-home-hint',
    });

    // Where you have been — the home screen answers it before you type
    // (item 16). Eight recent doors; the full dated list is one tap away.
    const recent = this.historyStore?.rows().slice(0, 8) ?? [];
    if (recent.length) {
      const sec = home.createDiv('jp-dict-hist jp-dict-hist--home');
      const head = sec.createDiv('jp-dict-hist-day');
      head.setText('最近');
      const all = head.createEl('button', { text: 'すべての履歴 ⏱', cls: 'jp-dict-hist-all' });
      all.addEventListener('click', () => this.showHistory());
      for (const r of recent) {
        const row = sec.createDiv('jp-dict-hist-row');
        row.createSpan({ text: r.word, cls: 'jp-dict-hist-word' });
        row.addEventListener('click', () => this.lookupWord(r.word, { tempo: 'descend' }));
      }
    }

    // §27.5 the converted sidecars, biggest first (BigDictStore's order).
    for (const d of this.bigInstalled) {
      const card = home.createDiv('jp-dict-info-card');
      const row = card.createDiv('jp-dict-info-row');
      row.createSpan({ text: '🗄️', cls: 'jp-dict-info-icon' });
      const info = row.createDiv('jp-dict-info-text');
      info.createEl('strong', { text: d.title });
      info.createSpan({
        text: ` · ${d.headwords.toLocaleString()} 語`,
        cls: 'jp-dict-info-count',
      });
      const badges = card.createDiv('jp-dict-info-badges');
      badges.createSpan({ text: '変換済み', cls: 'jp-dict-info-badge' });
      // §12: a repaired or still-converting meta holds a RUNNING total, so it
      // must not be presented as a settled install.
      if (d.partial) {
        badges.createSpan({
          text: '暫定（変換中/修復済み）',
          cls: 'jp-dict-info-badge jp-dict-info-badge--partial',
          attr: { title: '件数は途中経過です。変換が完了すると確定します。' },
        });
      }
    }

    for (const meta of dicts) {
      const dictCard = home.createDiv('jp-dict-info-card');
      const row = dictCard.createDiv('jp-dict-info-row');
      row.createSpan({ text: '📖', cls: 'jp-dict-info-icon' });
      const info = row.createDiv('jp-dict-info-text');
      info.createEl('strong', { text: meta.title });
      info.createSpan({ text: ` · ${meta.termCount.toLocaleString()} terms`, cls: 'jp-dict-info-count' });

      if (meta.description) {
        dictCard.createEl('p', {
          text: meta.description.slice(0, 120) + (meta.description.length > 120 ? '…' : ''),
          cls: 'jp-dict-info-desc',
        });
      }

      const badges = dictCard.createDiv('jp-dict-info-badges');
      if (meta.hasFrequency) badges.createSpan({ text: '⚡ Frequency', cls: 'jp-dict-info-badge' });
      if (meta.hasPitch) badges.createSpan({ text: '🎵 Pitch', cls: 'jp-dict-info-badge' });
      badges.createSpan({ text: `v${meta.revision}`, cls: 'jp-dict-info-badge' });
    }
    this.renderNavBar();
  }

  private renderEmpty(message: string): void {
    if (!this.resultsEl) return;
    this.resultsEl.empty();
    this.resultsEl.createDiv({ text: message, cls: 'jp-dict-empty' });
  }

  // ── Import dialog ──────────────────────────────────────────

  private showImportDialog(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.multiple = true;
    input.onchange = async () => {
      const files = input.files;
      if (!files || files.length === 0) return;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          new Notice(`Importing ${file.name}…`, 0);
          const buf = await file.arrayBuffer();
          const importer = new YomitanImporter();
          const data = await importer.import(buf, (msg) => {
            new Notice(msg, 3000);
          });
          // §27.5 / AUDIT §18: a dictionary this large cannot live in the
          // plugin data blob. On 2026-07-25 one did, reached 239MB, its
          // whole-file rewrite was truncated, and the plugin stopped loading.
          // Say so BEFORE importing rather than after the damage.
          if (data.terms.length > DictionaryStore.BLOB_TERM_LIMIT) {
            new Notice(
              `「${data.meta.title}」は ${data.terms.length.toLocaleString()} 語 — 大きすぎるため` +
              `プラグインのデータに保存できません（${DictionaryStore.BLOB_TERM_LIMIT.toLocaleString()}語まで）。\n` +
              `設定 → 大型辞書 で「Yomitan書き出しフォルダ」を指定し、金庫内シャードに変換してください。`,
              15000,
            );
            continue;
          }
          this.dictStore.addDictionary(data);
          await this.onImport();
          new Notice(`✓ Imported "${data.meta.title}" (${data.meta.termCount.toLocaleString()} terms)`, 5000);
        } catch (err) {
          console.error('Dictionary import error:', err);
          new Notice(`Failed to import ${file.name}: ${(err as Error).message}`, 8000);
        }
      }

      this.renderHome();
    };
    input.click();
  }

  // ── Manage dialog ──────────────────────────────────────────

  private showManageDialog(): void {
    new DictManageModal(this.app, this.dictStore, async () => {
      await this.onImport();
      this.renderHome();
    }).open();
  }
}

// ── Manage Modal ─────────────────────────────────────────────

class DictManageModal extends Modal {
  private dictStore: DictionaryStore;
  private onSave: () => Promise<void>;

  constructor(app: App, dictStore: DictionaryStore, onSave: () => Promise<void>) {
    super(app);
    this.dictStore = dictStore;
    this.onSave = onSave;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('jp-dict-manage-modal');
    contentEl.createEl('h2', { text: 'Manage Dictionaries' });

    const dicts = this.dictStore.getDictionaryList();

    if (dicts.length === 0) {
      contentEl.createEl('p', { text: 'No dictionaries imported.', cls: 'jp-dict-empty' });
      return;
    }

    for (const meta of dicts) {
      const isEnabled = this.dictStore.settings.enabledDictionaries.includes(meta.title);

      new Setting(contentEl)
        .setName(meta.title)
        .setDesc(`${meta.termCount.toLocaleString()} terms · v${meta.revision}`)
        .addToggle(t => t.setValue(isEnabled).onChange(async (v) => {
          if (v) {
            if (!this.dictStore.settings.enabledDictionaries.includes(meta.title)) {
              this.dictStore.settings.enabledDictionaries.push(meta.title);
            }
          } else {
            this.dictStore.settings.enabledDictionaries =
              this.dictStore.settings.enabledDictionaries.filter(t => t !== meta.title);
          }
          await this.onSave();
        }))
        .addButton(b => b.setButtonText('Remove').setWarning().onClick(async () => {
          this.dictStore.removeDictionary(meta.title);
          await this.onSave();
          this.onOpen(); // refresh
        }));
    }

    // Settings
    contentEl.createEl('h3', { text: 'Display' });

    new Setting(contentEl)
      .setName('Show pitch accent')
      .addToggle(t => t.setValue(this.dictStore.settings.showPitch).onChange(async (v) => {
        this.dictStore.settings.showPitch = v;
        await this.onSave();
      }));

    new Setting(contentEl)
      .setName('Show frequency')
      .addToggle(t => t.setValue(this.dictStore.settings.showFrequency).onChange(async (v) => {
        this.dictStore.settings.showFrequency = v;
        await this.onSave();
      }));

    new Setting(contentEl)
      .setName('Max results')
      .addSlider(s => s.setLimits(10, 200, 10)
        .setValue(this.dictStore.settings.maxResults)
        .setDynamicTooltip()
        .onChange(async (v) => {
          this.dictStore.settings.maxResults = v;
          await this.onSave();
        }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
