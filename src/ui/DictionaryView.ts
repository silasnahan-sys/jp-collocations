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
import { classBadge } from './class-grammar';
import { armDrops, armSelectionEcho, mountSurfaceBar, wideDock, type ViewChrome } from './view-chrome';
import { makeDraggable } from './drag-out';

export const JP_DICTIONARY_VIEW_TYPE = 'jp-dictionary-view';

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
  /** Lookup history for recursive navigation */
  private lookupHistory: Array<{ word: string; scroll: number; via?: SaveRelation }> = [];
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
    const stated = statedRelation(sel.text);
    if (stated) {
      this.commitCapture({ ...sel, text: stated.target }, stated.relation);
      return;
    }
    const offers = offeredBy(sel);
    if (offers.length === 1) { this.commitCapture(sel, offers[0]); return; }
    const menu = new Menu();
    for (const rel of offers) {
      menu.addItem((i) => i
        .setTitle(`${rel} — ${RELATION_SPECS[rel].hint}`)
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
    this.peek?.cancel();
  }

  refresh(): void {
    if (this.currentQuery) this.performLookup(this.currentQuery);
    else this.renderHome();
  }

  /** Public method for programmatic lookup (e.g. from editor selection command) */
  lookupWord(word: string): void {
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
      // through is the same as not coming back at all.
      this.lookupHistory.push({
        word: this.currentQuery,
        scroll: this.resultsEl?.scrollTop ?? 0,
        via,
      });
    }
    this.lastVia = via;
    this.lookupWord(word);
    this.renderBreadcrumbs();
  }

  /** The edge that brought us to the CURRENT word. */
  private lastVia: SaveRelation | undefined;

  /** Navigate back, landing exactly where you left. */
  private goBack(): void {
    const prev = this.lookupHistory.pop();
    if (!prev) return;
    this.lookupWord(prev.word);
    this.restoreScroll(prev.scroll);
    this.renderBreadcrumbs();
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

    if (this.lookupHistory.length === 0) {
      this.breadcrumbEl.style.display = 'none';
      return;
    }

    this.breadcrumbEl.style.display = 'flex';

    // Back button
    const backBtn = this.breadcrumbEl.createEl('button', {
      text: '◀ 戻る',
      cls: 'jp-dict-back-btn',
    });
    backBtn.addEventListener('click', () => this.goBack());

    // The trail is a PATH THROUGH THE RELATION GRAPH, not a list of words.
    // You did not merely arrive at 痛快 — you got there from 爽快 along 類語,
    // and that edge is the most useful thing on the screen: it is the same
    // vocabulary you save with, so the trail reads as lexical reasoning
    // rather than as browser history.
    for (let i = 0; i < this.lookupHistory.length; i++) {
      const hop = this.lookupHistory[i];
      const crumb = this.breadcrumbEl.createEl('span', {
        text: hop.word,
        cls: 'jp-dict-breadcrumb-item',
      });
      crumb.title = `${hop.word} に戻る（読んでいた位置まで）`;
      crumb.addEventListener('click', () => {
        const target = this.lookupHistory[i];
        this.lookupHistory = this.lookupHistory.slice(0, i);
        this.lookupWord(target.word);
        this.restoreScroll(target.scroll);
        this.renderBreadcrumbs();
      });
      // The edge you travelled, named. `via` belongs to the hop you LEFT, so
      // it labels the arrow leaving it.
      const next = this.lookupHistory[i + 1];
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
            this.recursiveLookup(part);
          });
          frag.appendChild(span);
        } else {
          frag.appendChild(document.createTextNode(part));
        }
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }
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
      placeholder: '検索… (漢字・ひらがな・カタカナ)',
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

  /**
   * Live search: show inline results as you type (no separate suggestions).
   * Uses substringSearch to catch partial/contains matches.
   */
  private performLiveSearch(query: string): void {
    this.hideSuggestions();
    if (!this.resultsEl || !this.statsEl) return;
    const gen = ++this.searchGen;

    // Use substring search for fuzzy live results
    const results = this.dictStore.substringSearch(query, 20);

    // Also get exact match results for higher-quality display
    const exactResults = this.dictStore.lookup(query);

    // Merge: exact results first, then substring-only
    const merged = [...exactResults];
    const seen = new Set(exactResults.map(r => `${r.term.expression}|${r.term.reading}|${r.dictionary}`));
    for (const r of results) {
      const key = `${r.term.expression}|${r.term.reading}|${r.dictionary}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(r);
      }
    }

    if (!this.hasAnyDictionary()) {
      this.statsEl.empty();
      this.statsEl.createSpan({ text: 'No dictionaries imported yet', cls: 'jp-dict-stat-text' });
      this.renderEmpty('Import a Yomitan dictionary to get started. Tap "＋ Import" above.');
      return;
    }

    // "Not found" is only true once the sidecars have answered too, so the
    // placeholder goes up as a PROVISIONAL state that appendBigResults clears.
    if (merged.length === 0) {
      this.renderEmpty(`"${query}" が見つかりませんでした`);
    } else {
      this.resultsEl.empty();
      for (const group of this.groupResults(merged)) {
        this.renderEntryCard(this.resultsEl, group);
      }
    }
    this.setStats(query, merged.length, !!this.bigDict);
    void this.appendBigResults(query, gen, merged);
  }

  // ── the converted (sidecar) dictionaries ───────────────────

  /** Any dictionary at all — imported into the blob OR converted to a sidecar. */
  private hasAnyDictionary(): boolean {
    return this.dictStore.hasDictionaries() || this.bigInstalled.length > 0;
  }

  /** One stats line for both halves; `pending` marks a sidecar read in flight. */
  private setStats(query: string, count: number, pending: boolean): void {
    if (!this.statsEl) return;
    this.statsEl.empty();
    this.statsEl.createSpan({
      text: count === 0 && !pending ? `"${query}" — no results` : `${count} entries for "${query}"`,
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
  ): Promise<void> {
    if (!this.bigDict) return;
    let hits: BigDictHit[];
    try {
      hits = await this.bigDict.lookup(query, 40);
    } catch (e) {
      console.error('[jp-collocations] sidecar lookup failed:', e);
      if (gen === this.searchGen) this.setStats(query, local.length, false);
      return;
    }
    if (gen !== this.searchGen || !this.resultsEl || !this.statsEl) return;

    const extra = dedupeAgainst(hits, local);
    this.setStats(query, local.length + extra.length, false);
    if (!extra.length) return;

    // The placeholder was provisional — these entries are the answer to it.
    if (!local.length) this.resultsEl.empty();
    for (const group of this.groupResults(extra)) {
      this.renderEntryCard(this.resultsEl, group);
    }
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

    const results = this.dictStore.lookup(query);

    if (!this.hasAnyDictionary()) {
      this.statsEl.empty();
      this.statsEl.createSpan({ text: 'No dictionaries imported yet', cls: 'jp-dict-stat-text' });
      this.renderEmpty('Import a Yomitan dictionary to get started. Tap "＋ Import" above.');
      return;
    }

    if (results.length === 0) {
      this.renderEmpty(`"${query}" が見つかりませんでした`);
    } else {
      // Group by sequence & expression for merging related senses
      this.resultsEl.empty();
      for (const group of this.groupResults(results)) {
        this.renderEntryCard(this.resultsEl, group);
      }
    }
    this.setStats(query, results.length, !!this.bigDict);
    void this.appendBigResults(query, gen, results);
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

    // ── Definitions ──────────────────────────────────────────
    const defsSection = card.createDiv('jp-dict-defs');

    let defIndex = 0;
    for (const result of group) {
      // §26.1 — when the source gave us real structure, typeset it: senses
      // numbered, 〔context〕/《register》 as their own marks, examples as
      // blocks. Only a dictionary whose tree was flattened at conversion falls
      // through to the prose path, and it SHOULD look worse — that is the
      // honest signal that it still needs re-converting (§28 S6).
      const renderOpts = {
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
      };
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
