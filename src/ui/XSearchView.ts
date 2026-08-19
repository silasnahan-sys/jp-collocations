/**
 * XSearchView — the X (Twitter) advanced-search dictionary.
 *
 * A monokakido-inspired, mobile-first view (44–48px touch targets, iOS safe
 * areas, instant live-as-you-type local search) over a growing corpus of
 * scraped tweets. You type required terms in the main box — space-separated
 * terms become an AND query ("tweets with BOTH 以前の AND でさえ") — optionally
 * refine with the 詳細 (advanced) panel, and:
 *
 *   - typing searches the cached corpus instantly (offline, no network),
 *   - pressing 検索 / Enter fires a live X scrape and merges new tweets in,
 *   - each result is a tweet card with matched terms highlighted and actions
 *     to save the phrase as a collocation, copy, insert, or open on X.
 *
 * The scrape transport (cookies → GraphQL) lives entirely in XClient; this view
 * only knows the stable XTweet schema.
 */

import { ItemView, WorkspaceLeaf, Notice, Modal, Setting, MarkdownView } from 'obsidian';
import type { App, Editor } from 'obsidian';
import type { XCorpusStore } from '../x/XCorpusStore';
import { XClient, XScrapeError } from '../x/XClient';
import type { XSettings, XSearchQuery, XSearchProduct, XTweet, SavedQuery } from '../x/x-types';
import { emptyQuery } from '../x/x-types';
import { parseTerms, highlightTerms, isEmptyQuery } from '../x/query-builder';
import { runSavedQuery, runAllSavedQueries, extractTweetId } from '../x/saved-queries';
import { exportTweetsToVault } from '../x/export-notes';
import { formatTweetCallout, shouldCollapse } from '../x/tweet-format';
import { XSaveCollocationModal, XCollectionPickerModal, selectionWithin } from './XSaveModals';
import { detectPatterns, CATEGORY_COLORS, CATEGORY_LABELS } from '../discourse/discourse-grammar';
import type { PatternCategory } from '../discourse/discourse-patterns';
import { NOTE_TYPES, type NoteClass } from '../notes/note-types';
import { classBadge } from './class-grammar';
import { armDrops, mountSurfaceBar, wideDock, type ViewChrome } from './view-chrome';
import { buildXUsage } from '../x/usage';
import { renderXUsage } from './x-usage-panel';
import { makeDraggable } from './drag-out';

type SortMode = 'latest' | 'likes' | 'retweets';

export const JP_X_VIEW_TYPE = 'jp-x-search-view';

/** Callbacks the view needs from the plugin. */
export interface XViewDeps {
  corpus: XCorpusStore;
  client: XClient;
  getSettings: () => XSettings;
  saveSettings: () => Promise<void>;
  /**
   * Persist a picked phrase as a collocation/usage entry with the tweet as its
   * example. `parts` are the (possibly gapped) pieces the surface was built
   * from, e.g. ['この', 'も', 'まで'] for この…も…まで.
   */
  onSaveCollocation: (surface: string, exampleText: string, sourceUrl: string, parts?: string[]) => void;
  /**
   * Open the universal classify-capture (6分類 → pattern catalog; DESIGN §13).
   * `selection` is the highlighted run inside the card body, if any.
   */
  onClassify?: (tweet: XTweet, selection: string | null) => void;
  /**
   * §28 S1: which of YOUR catalog patterns occur in this text. The X corpus is
   * a view of the same lexicon, not a separate world — so a tweet carrying a
   * pattern you have noticed wears that pattern's class mark here too.
   */
  patternsIn?: (text: string) => Array<{ id: string; key: string; class: NoteClass; classRatified?: boolean }>;
  /** Open a catalog pattern in the lexicon (the door back — §28 S4). */
  openPattern?: (id: string) => void;
  /** §29.2 — capture one concordance line (not the whole tweet) as a 用例.
   *  `hit` = the matched surface, so the capture arrives already about it. */
  onCaptureLine?: (quote: string, url: string, handle: string, hit?: string) => void;
  /** §29 the drag road + §26.3 the identity bar (see ui/view-chrome.ts). */
  onDrop?: ViewChrome['onDrop'];
  dropCan?: ViewChrome['dropCan'];
  openSurface?: ViewChrome['openSurface'];
  dismiss?: ViewChrome['dismiss'];
  surfaceBadge?: ViewChrome['surfaceBadge'];
}

export class XSearchView extends ItemView {
  private deps: XViewDeps;

  private query: XSearchQuery;
  private mainInput: HTMLInputElement | null = null;
  private chipsEl: HTMLElement | null = null;
  private advancedEl: HTMLElement | null = null;
  private advancedOpen = false;
  private statusEl: HTMLElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private loadMoreEl: HTMLElement | null = null;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private liveCursor: string | null = null;
  private liveBusy = false;
  private sortMode: SortMode = 'latest';
  /** When set, results come from saved-query co-occurrence rather than the term box. */
  private coocActive = false;

  constructor(leaf: WorkspaceLeaf, deps: XViewDeps) {
    super(leaf);
    this.deps = deps;
    const s = deps.getSettings();
    this.query = emptyQuery(s.defaultLang, s.defaultProduct);
  }

  getViewType(): string { return JP_X_VIEW_TYPE; }
  getDisplayText(): string { return 'X Search'; }
  getIcon(): string { return 'search'; }

  async onOpen(): Promise<void> {
    this.buildUI();
    this.renderLocal();
  }

  async onClose(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  /**
   * Programmatic search (e.g. from the "search selection on X" command).
   * `live` fires a live X scrape; pass false to show cached/just-ingested
   * results only (the iOS co-occurrence round trip already has the tweets, and
   * a live scrape would 404 on mobile).
   */
  searchFor(text: string, live = true): void {
    if (this.mainInput) this.mainInput.value = text;
    this.collectMainTerms();
    this.renderChips();
    this.renderLocal();
    if (live) void this.runLive(true);
  }

  // ── UI scaffold ────────────────────────────────────────────

  private buildUI(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('jp-x-view');
    // §29 — drop a post URL here and it joins the corpus; drop a phrase and it
    // becomes the query. Paste too: this view's whole job is "here, look at
    // this", and ⌘V is that sentence on a keyboard.
    armDrops(container, this.deps, 'x', { paste: true });

    // §26.3 — the query row belongs under the reaching hand and needs WIDTH,
    // so it takes the foot bar; `wide` is null on the desktop, which is what
    // each `?? header` below preserves. Posting it into the rail instead was
    // the iPad bug. The navigator's container is `mountSurfaceBar`'s call now.
    const wide = wideDock(container);

    // Header
    const header = container.createDiv('jp-x-header');
    mountSurfaceBar(container, this.deps, 'x', header);
    const titleRow = header.createDiv('jp-x-title-row');
    titleRow.createEl('h4', { text: '𝕏 検索辞書', cls: 'jp-x-title' });
    const actions = titleRow.createDiv('jp-x-header-actions');

    const savedBtn = actions.createEl('button', {
      text: '📑',
      cls: 'jp-x-icon-btn',
      attr: { 'aria-label': 'Saved queries' },
    });
    savedBtn.addEventListener('click', () => this.openSavedQueriesModal());

    const urlBtn = actions.createEl('button', {
      text: '🔗',
      cls: 'jp-x-icon-btn',
      attr: { 'aria-label': 'Add tweet by URL' },
    });
    urlBtn.addEventListener('click', () => this.openAddByUrlModal());

    const authBtn = actions.createEl('button', {
      text: '🔑',
      cls: 'jp-x-icon-btn',
      attr: { 'aria-label': 'X login cookies' },
    });
    authBtn.addEventListener('click', () => this.openAuthModal());

    const importBtn = actions.createEl('button', {
      text: '⤓',
      cls: 'jp-x-icon-btn',
      attr: { 'aria-label': 'Import / export corpus (JSONL)' },
    });
    importBtn.addEventListener('click', () => this.openCorpusModal());

    // Main search row
    const searchRow = (wide ?? header).createDiv('jp-x-search-row');
    this.mainInput = searchRow.createEl('input', {
      type: 'search',
      placeholder: '語をスペース区切りで（AND）… 例: 以前の でさえ',
      cls: 'jp-x-search-input',
      attr: { autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search' },
    });
    this.mainInput.addEventListener('input', () => this.onInput());
    this.mainInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.collectMainTerms();
        this.renderChips();
        this.renderLocal();
        void this.runLive(true);
      } else if (e.key === 'Escape') {
        this.mainInput!.value = '';
        this.collectMainTerms();
        this.renderChips();
        this.renderLocal();
      }
    });

    const goBtn = searchRow.createEl('button', { text: '検索', cls: 'jp-x-go-btn' });
    goBtn.addEventListener('click', () => {
      this.collectMainTerms();
      this.renderChips();
      this.renderLocal();
      void this.runLive(true);
    });

    // Required-term chips — they belong WITH the input that produces them, so
    // they travel to the dock with it. 並び替え and 詳細検索 stay in the header:
    // they are set once and then read, not touched while typing.
    this.chipsEl = (wide ?? header).createDiv('jp-x-chips');

    // Sort control
    const sortRow = header.createDiv('jp-x-sortrow');
    sortRow.createSpan({ text: '並び替え', cls: 'jp-x-sort-label' });
    const sorts: Array<{ id: SortMode; label: string }> = [
      { id: 'latest', label: '新着' },
      { id: 'likes', label: '❤' },
      { id: 'retweets', label: '🔁' },
    ];
    for (const so of sorts) {
      const b = sortRow.createEl('button', { text: so.label, cls: 'jp-x-sort-btn' });
      if (this.sortMode === so.id) b.addClass('jp-x-sort-btn--active');
      b.addEventListener('click', () => {
        this.sortMode = so.id;
        sortRow.querySelectorAll('.jp-x-sort-btn').forEach(el => el.removeClass('jp-x-sort-btn--active'));
        b.addClass('jp-x-sort-btn--active');
        this.renderLocal();
      });
    }

    // Advanced toggle + panel
    const advToggle = header.createDiv('jp-x-adv-toggle');
    advToggle.createSpan({ text: '詳細検索', cls: 'jp-x-adv-toggle-label' });
    const advArrow = advToggle.createSpan({ text: '▸', cls: 'jp-x-adv-arrow' });
    this.advancedEl = header.createDiv('jp-x-advanced');
    this.advancedEl.style.display = 'none';
    this.buildAdvancedPanel(this.advancedEl);
    advToggle.addEventListener('click', () => {
      this.advancedOpen = !this.advancedOpen;
      this.advancedEl!.style.display = this.advancedOpen ? '' : 'none';
      advArrow.textContent = this.advancedOpen ? '▾' : '▸';
    });

    // Status line + results
    this.statusEl = container.createDiv('jp-x-status');
    this.resultsEl = container.createDiv('jp-x-results');
    this.loadMoreEl = container.createDiv('jp-x-loadmore');
  }

  private buildAdvancedPanel(panel: HTMLElement): void {
    // Product tabs (Latest / Top / Media)
    const tabRow = panel.createDiv('jp-x-tabrow');
    const products: Array<{ id: XSearchProduct; label: string }> = [
      { id: 'Latest', label: '最新' },
      { id: 'Top', label: '話題' },
      { id: 'Media', label: 'メディア' },
    ];
    const tabBtns = new Map<XSearchProduct, HTMLElement>();
    for (const p of products) {
      const btn = tabRow.createEl('button', { text: p.label, cls: 'jp-x-tab' });
      if (this.query.product === p.id) btn.addClass('jp-x-tab--active');
      btn.addEventListener('click', () => {
        this.query.product = p.id;
        for (const [, b] of tabBtns) b.removeClass('jp-x-tab--active');
        btn.addClass('jp-x-tab--active');
      });
      tabBtns.set(p.id, btn);
    }

    const textField = (label: string, placeholder: string, get: () => string, set: (v: string) => void) => {
      const row = panel.createDiv('jp-x-field');
      row.createSpan({ text: label, cls: 'jp-x-field-label' });
      const input = row.createEl('input', {
        type: 'text', cls: 'jp-x-field-input',
        attr: { placeholder, autocapitalize: 'off', spellcheck: 'false' },
      });
      input.value = get();
      input.addEventListener('input', () => { set(input.value.trim()); this.renderLocal(); });
      return input;
    };

    textField('いずれか (OR)', 'スペース区切り', () => this.query.anyTerms.join(' '),
      (v) => { this.query.anyTerms = parseTerms(v); });
    textField('除外 (NOT)', 'スペース区切り', () => this.query.noneTerms.join(' '),
      (v) => { this.query.noneTerms = parseTerms(v); });
    textField('言語', 'ja / en / 空=全', () => this.query.lang, (v) => { this.query.lang = v; });
    textField('投稿者 from:', '@なし', () => this.query.fromUser, (v) => { this.query.fromUser = v; });
    textField('宛先 to:', '@なし', () => this.query.toUser, (v) => { this.query.toUser = v; });

    const numField = (label: string, get: () => number, set: (v: number) => void) => {
      const row = panel.createDiv('jp-x-field');
      row.createSpan({ text: label, cls: 'jp-x-field-label' });
      const input = row.createEl('input', { type: 'number', cls: 'jp-x-field-input', attr: { min: '0', inputmode: 'numeric' } });
      input.value = String(get() || '');
      input.addEventListener('input', () => { set(Number(input.value) || 0); this.renderLocal(); });
    };
    numField('最小いいね', () => this.query.minFaves, (v) => { this.query.minFaves = v; });
    numField('最小RT', () => this.query.minRetweets, (v) => { this.query.minRetweets = v; });

    textField('期間 since:', 'YYYY-MM-DD', () => this.query.since, (v) => { this.query.since = v; });
    textField('期間 until:', 'YYYY-MM-DD', () => this.query.until, (v) => { this.query.until = v; });
  }

  // ── Query collection ───────────────────────────────────────

  private collectMainTerms(): void {
    this.query.allTerms = parseTerms(this.mainInput?.value ?? '');
  }

  private renderChips(): void {
    if (!this.chipsEl) return;
    this.chipsEl.empty();
    if (this.query.allTerms.length === 0) {
      this.chipsEl.style.display = 'none';
      return;
    }
    this.chipsEl.style.display = 'flex';
    this.query.allTerms.forEach((term, i) => {
      if (i > 0) this.chipsEl!.createSpan({ text: 'AND', cls: 'jp-x-chip-and' });
      const chip = this.chipsEl!.createSpan({ cls: 'jp-x-chip' });
      chip.createSpan({ text: term, cls: 'jp-x-chip-text' });
      const x = chip.createSpan({ text: '×', cls: 'jp-x-chip-x' });
      x.addEventListener('click', () => {
        this.query.allTerms.splice(i, 1);
        if (this.mainInput) {
          this.mainInput.value = this.query.allTerms
            .map(t => (/\s/.test(t) ? `"${t}"` : t)).join(' ');
        }
        this.renderChips();
        this.renderLocal();
      });
    });
  }

  // ── Local (offline corpus) search ──────────────────────────

  private onInput(): void {
    this.coocActive = false;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.collectMainTerms();
      this.renderChips();
      this.renderLocal();
    }, 110);
  }

  private applySort(rows: XTweet[]): XTweet[] {
    const sorted = [...rows];
    if (this.sortMode === 'likes') sorted.sort((a, b) => b.favoriteCount - a.favoriteCount);
    else if (this.sortMode === 'retweets') sorted.sort((a, b) => b.retweetCount - a.retweetCount);
    else sorted.sort((a, b) => b.createdAt - a.createdAt);
    return sorted;
  }

  private renderLocal(): void {
    if (!this.resultsEl || !this.statusEl) return;
    const total = this.deps.corpus.size();

    // Co-occurrence mode: results come from saved-query provenance (≥2 ids).
    if (this.coocActive) {
      this.renderCooccurrence();
      return;
    }

    if (isEmptyQuery(this.query)) {
      this.renderHome();
      return;
    }

    const results = this.applySort(this.deps.corpus.search(this.query, 300));
    const live = this.deps.client.isConfigured();
    this.statusEl.empty();
    this.statusEl.createSpan({
      text: `ローカル ${results.length}件 / コーパス ${total}件` +
        (live ? '' : '・ライブ取得オフ（🔑で設定）'),
      cls: 'jp-x-status-text',
    });

    this.resultsEl.empty();
    if (this.loadMoreEl) this.loadMoreEl.empty();

    if (results.length === 0) {
      const empty = this.resultsEl.createDiv('jp-x-empty');
      empty.createDiv({ cls: 'jp-x-empty-icon', text: '🔍' });
      empty.createDiv({
        text: total === 0
          ? 'コーパスは空です。検索すると X から取得して貯まります。'
          : 'キャッシュに該当なし。検索でライブ取得します。',
        cls: 'jp-x-empty-text',
      });
      return;
    }

    /**
     * §29.2 — the corpus panel, above the feed.
     *
     * The view is named 検索辞書 and behaved like a search box: a reverse-
     * chronological list of whole tweets, which is what Twitter already is.
     * What this local corpus has that Twitter does not is that it is FROZEN
     * and COUNTABLE — so it can say how often, with what, in what shape, and
     * by how many different people. The KWIC alignment underneath is the part
     * a card feed structurally cannot do: stacked on the phrase, the recurring
     * left and right environment becomes visible at a glance.
     *
     * Only for a single-term query. Two terms have no single column to align
     * on, and faking one would put the concordance's whole claim on a
     * coin-flip about which term mattered.
     */
    const single = this.query.allTerms.length === 1 && !this.query.anyTerms.length
      ? this.query.allTerms[0].trim() : '';
    if (single) {
      const u = buildXUsage(this.deps.corpus.getAll(), single, total);
      renderXUsage(this.resultsEl, u, {
        openUrl: (url) => window.open(url, '_blank'),
        onCapture: this.deps.onCaptureLine
          ? (quote, url, handle, hit) => this.deps.onCaptureLine!(quote, url, handle, hit)
          : undefined,
      });
    }

    const terms = highlightTerms(this.query);
    for (const t of results) this.renderTweetCard(this.resultsEl, t, terms);
  }

  private renderCooccurrence(): void {
    if (!this.resultsEl || !this.statusEl) return;
    const ids = this.deps.getSettings().savedQueries.map(q => q.id);
    const rows = this.applySort(this.deps.corpus.tweetsMatchingQueries(ids, 2));
    this.statusEl.empty();
    this.statusEl.createSpan({
      text: `★ 共起（保存検索を2つ以上含む）${rows.length}件`,
      cls: 'jp-x-status-text',
    });
    this.resultsEl.empty();
    if (this.loadMoreEl) this.loadMoreEl.empty();

    if (rows.length === 0) {
      const empty = this.resultsEl.createDiv('jp-x-empty');
      empty.createDiv({ cls: 'jp-x-empty-icon', text: '★' });
      empty.createDiv({
        text: '複数の保存検索に同時ヒットしたツイートはまだありません。📑から保存検索を実行してください。',
        cls: 'jp-x-empty-text',
      });
      return;
    }
    for (const t of rows) this.renderTweetCard(this.resultsEl, t, []);
  }

  private renderHome(): void {
    if (!this.resultsEl || !this.statusEl) return;
    this.statusEl.empty();
    this.resultsEl.empty();
    if (this.loadMoreEl) this.loadMoreEl.empty();

    const stats = this.deps.corpus.stats();
    this.statusEl.createSpan({ text: `コーパス ${stats.count}件`, cls: 'jp-x-status-text' });

    const home = this.resultsEl.createDiv('jp-x-home');
    home.createDiv({ cls: 'jp-x-home-icon', text: '𝕏' });
    home.createEl('h5', { text: 'X 用例検索辞書' });
    home.createEl('p', {
      text: '語をスペース区切りで入力すると、両方を含むツイートを探します（AND）。例: 以前の でさえ',
      cls: 'jp-x-home-hint',
    });
    if (!this.deps.client.isConfigured()) {
      const warn = home.createDiv('jp-x-home-warn');
      warn.createSpan({ text: '⚠ ライブ取得には X のログインクッキーが必要です。' });
      const setup = warn.createEl('button', { text: '🔑 クッキー設定', cls: 'jp-x-go-btn jp-x-home-setup' });
      setup.addEventListener('click', () => this.openAuthModal());
    }
    // No-auth backbone: even without cookies (or when X blocks live scraping),
    // the corpus can grow via single-tweet capture and JSONL import.
    const noauth = home.createDiv('jp-x-home-hint jp-x-home-faint');
    noauth.createSpan({ text: 'クッキー不要で貯める: ' });
    const byUrl = noauth.createEl('a', { text: '🔗 URLで追加', href: '#' });
    byUrl.addEventListener('click', e => { e.preventDefault(); new XAddByUrlModal(this.app, this.deps, () => this.renderLocal()).open(); });
    noauth.createSpan({ text: '　/　' });
    const imp = noauth.createEl('a', { text: '⤓ JSONL取り込み', href: '#' });
    imp.addEventListener('click', e => { e.preventDefault(); new XCorpusModal(this.app, this.deps, () => this.renderLocal()).open(); });
    if (stats.count > 0 && stats.newest) {
      home.createEl('p', {
        text: `最新ツイート: ${formatDate(stats.newest)}`,
        cls: 'jp-x-home-hint jp-x-home-faint',
      });
    }
  }

  // ── Live scrape ────────────────────────────────────────────

  private async runLive(reset: boolean, triedDiscovery = false): Promise<void> {
    if (isEmptyQuery(this.query)) return;
    if (this.liveBusy) return;

    const issue = this.deps.client.configIssue();
    if (issue) {
      new Notice(`X: ${issue}`, 5000);
      return;
    }
    if (reset) this.liveCursor = null;

    this.liveBusy = true;
    this.setLoading(true);
    try {
      const { tweets, cursor } = await this.deps.client.search(
        this.query,
        reset ? undefined : this.liveCursor ?? undefined,
      );
      const added = this.deps.corpus.addTweets(tweets);
      this.liveCursor = cursor;
      new Notice(
        `X: ${tweets.length}件取得（新規 ${added}件）` + (cursor ? '・続きあり' : ''),
        4000,
      );
      this.renderLocal();
      this.renderLoadMore();
    } catch (e) {
      // Self-heal a 404 once. Two independent causes: (1) X rotated its web-app
      // shell → our request signature is stale; rebuild the signer. (2) the
      // queryId went stale → rediscover it. Do both, then retry a single time.
      if (e instanceof XScrapeError && e.status === 404 && !triedDiscovery) {
        this.liveBusy = false;
        this.setLoading(false);
        this.deps.client.resetTxnGen(); // force a fresh signature on retry
        const outcome = await this.recoverQueryId();
        new Notice(
          outcome === 'updated'
            ? '検索ID を更新し、署名を再生成して再検索します…'
            : '署名 (x-client-transaction-id) を再生成して再検索します…',
          4000,
        );
        void this.runLive(reset, true);
        return;
      }
      const msg = e instanceof XScrapeError ? e.message : (e as Error).message;
      new Notice(`X 取得エラー: ${msg}`, 10000);
    } finally {
      this.liveBusy = false;
      this.setLoading(false);
    }
  }

  /**
   * Discover the current SearchTimeline queryId and persist it IF it changed.
   *   'updated'         — id was stale; replaced → caller should retry.
   *   'already-current' — id already correct → the 404 is NOT an id problem.
   *   'failed'          — couldn't discover an id.
   */
  private async recoverQueryId(): Promise<'updated' | 'already-current' | 'failed'> {
    new Notice('検索IDを確認中（最新IDを自動取得）…', 3000);
    try {
      const prev = (this.deps.getSettings().searchQueryId || '').trim();
      const id = await this.deps.client.discoverSearchQueryId();
      if (!id) {
        new Notice('queryId を自動取得できませんでした。🔑→詳細で手動設定してください。', 8000);
        return 'failed';
      }
      if (id === prev) return 'already-current';
      this.deps.getSettings().searchQueryId = id;
      await this.deps.saveSettings();
      new Notice(`✓ 検索IDを更新しました（${id}）。再検索します。`, 4000);
      return 'updated';
    } catch {
      new Notice('queryId の自動取得に失敗しました。', 6000);
      return 'failed';
    }
  }

  private renderLoadMore(): void {
    if (!this.loadMoreEl) return;
    this.loadMoreEl.empty();
    if (!this.liveCursor) return;
    const btn = this.loadMoreEl.createEl('button', { text: 'もっと読み込む', cls: 'jp-x-loadmore-btn' });
    btn.addEventListener('click', () => void this.runLive(false));
  }

  private setLoading(on: boolean): void {
    this.containerEl.toggleClass('jp-x-loading', on);
  }

  // ── Tweet card ─────────────────────────────────────────────

  private renderTweetCard(parent: HTMLElement, t: XTweet, terms: string[]): void {
    const card = parent.createDiv('jp-x-card');

    // Header: author + handle + date — and the drag handle.
    //
    // Deliberately the HEAD and not the card: `draggable` suppresses starting a
    // text selection inside the element, and selecting a run of a tweet is this
    // view's primary capture verb (`selectionWithin`). A header grip keeps both.
    const head = card.createDiv('jp-x-card-head');
    makeDraggable(head, () => ({
      kind: 'tweet',
      text: t.text,
      label: t.text,
      sub: `@${t.authorHandle}`,
      html: `<blockquote>${t.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}` +
        `<br><small>— <a href="${t.url}">@${t.authorHandle}</a></small></blockquote>`,
      meta: { tweetId: t.id, url: t.url, handle: t.authorHandle },
    }));
    const who = head.createDiv('jp-x-card-who');
    who.createSpan({ text: t.authorName || t.authorHandle, cls: 'jp-x-card-name' });
    const handle = who.createSpan({ text: '@' + t.authorHandle, cls: 'jp-x-card-handle' });
    handle.addEventListener('click', () => {
      this.coocActive = false;
      this.query.fromUser = t.authorHandle;
      this.renderLocal();
      new Notice(`from:@${t.authorHandle} で絞り込み`);
    });
    // Co-occurrence badge: this tweet hit ≥2 saved queries.
    if ((t.matchedQueries?.length ?? 0) >= 2) {
      head.createSpan({
        text: `★${t.matchedQueries!.length}`,
        cls: 'jp-x-cooc-badge',
        attr: { title: `保存検索 ${t.matchedQueries!.join(', ')} に同時ヒット` },
      });
    }
    head.createSpan({ text: formatDate(t.createdAt), cls: 'jp-x-card-date' });

    // Body with highlighted matched terms — real, selectable text with the
    // tweet's own linebreaks (pre-wrap). Long tweets start collapsed.
    const body = card.createDiv('jp-x-card-body');
    highlightInto(body, t.text, terms);
    if (shouldCollapse(t.text)) {
      body.addClass('jp-x-card-body--clamped');
      const expander = card.createDiv({ text: '▾ 全文を表示', cls: 'jp-x-expand-btn' });
      expander.addEventListener('click', () => {
        const expanding = body.hasClass('jp-x-card-body--clamped');
        body.toggleClass('jp-x-card-body--clamped', !expanding);
        expander.setText(expanding ? '▴ たたむ' : '▾ 全文を表示');
        if (expanding) {
          // Jump to the matched term the user actually searched for.
          const hl = body.querySelector('.jp-x-hl');
          if (hl) (hl as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      });
    }

    // Media thumbnails (URLs straight off X's CDN; click opens the full size).
    if (t.media?.length) {
      const mediaRow = card.createDiv('jp-x-card-media');
      for (const m of t.media) {
        const cell = mediaRow.createDiv(
          'jp-x-media' + (m.type !== 'photo' ? ' jp-x-media--video' : ''),
        );
        const img = cell.createEl('img', {
          attr: { src: m.thumb, loading: 'lazy', alt: m.type, referrerpolicy: 'no-referrer' },
        });
        img.addEventListener('error', () => cell.remove());
        cell.addEventListener('click', () => window.open(m.url, '_blank'));
      }
    }

    // ── YOUR catalog, found in this tweet (DESIGN §28 S1: identity continuity).
    // A tweet holding a pattern you have already noticed must SHOW that it does,
    // with the same class mark that pattern wears in the lexicon and the 台帳 —
    // otherwise the X corpus reads as a separate world instead of the same one.
    const mine = this.deps.patternsIn?.(t.text) ?? [];
    if (mine.length) {
      const row = card.createDiv('jp-x-card-mine');
      for (const p of mine.slice(0, 6)) {
        const b = classBadge(row, p.class, { ratified: p.classRatified });
        b.prepend(document.createTextNode(''));
        b.querySelector('.jp-cls-badge-label')?.setText(p.key);
        b.addClass('jp-x-mine-badge');
        b.onclick = () => this.deps.openPattern?.(p.id);
        b.style.cursor = this.deps.openPattern ? 'pointer' : 'default';
        b.title = `${NOTE_TYPES[p.class].label} — 台帳のパターン（タップで開く）`;
      }
    }

    // Discourse-pattern pills — the plugin's signature analysis, applied to the tweet.
    const patterns = detectPatterns(t.text);
    if (patterns.length > 0) {
      const pills = card.createDiv('jp-x-card-patterns');
      const seen = new Set<string>();
      for (const m of patterns) {
        if (seen.has(m.pattern.id)) continue;
        seen.add(m.pattern.id);
        if (seen.size > 6) break;
        const cat = m.pattern.category as PatternCategory;
        const color = CATEGORY_COLORS[cat] ?? '#888';
        const pill = pills.createSpan({ text: m.matchedText, cls: 'jp-x-pat-pill' });
        pill.style.borderColor = color;
        pill.style.color = color;
        pill.title = `${m.pattern.gloss} — ${CATEGORY_LABELS[cat] ?? cat}`;
      }
    }

    // Metrics
    const metrics = card.createDiv('jp-x-card-metrics');
    metrics.createSpan({ text: `❤ ${compact(t.favoriteCount)}`, cls: 'jp-x-metric' });
    metrics.createSpan({ text: `🔁 ${compact(t.retweetCount)}`, cls: 'jp-x-metric' });
    metrics.createSpan({ text: `💬 ${compact(t.replyCount)}`, cls: 'jp-x-metric' });
    if (t.viewCount != null) metrics.createSpan({ text: `👁 ${compact(t.viewCount)}`, cls: 'jp-x-metric' });
    if (t.lang && t.lang !== 'und') metrics.createSpan({ text: t.lang, cls: 'jp-x-metric jp-x-metric-lang' });

    // Actions
    const actions = card.createDiv('jp-x-card-actions');
    this.actionBtn(actions, '💾 保存', 'コロケーションとして保存（本文を選択してから押すとそこから開始）', () => {
      // Seed the parts list: an active selection inside THIS card wins;
      // otherwise start from the searched terms that actually occur here.
      const sel = selectionWithin(body);
      const seed = sel ? [sel] : terms.filter(term => t.text.includes(term));
      new XSaveCollocationModal(this.app, this.deps, t, seed).open();
    });
    if (this.deps.onClassify) {
      this.actionBtn(actions, '🏷️ 分類', '6分類で台帳へ（本文を選択してから押すとその範囲を分類）', () => {
        const sel = selectionWithin(body);
        this.deps.onClassify!(t, sel || null);
      });
    }
    this.actionBtn(actions, '📚', 'コレクション（哲学/筋トレ…のノート）に追加', () => {
      new XCollectionPickerModal(this.app, this.deps, formatTweetCallout(t)).open();
    });
    this.actionBtn(actions, '⧉ コピー', '本文をコピー', () => {
      navigator.clipboard.writeText(t.text).then(() => new Notice('コピーしました'));
    });
    this.actionBtn(actions, '↧ 挿入', 'エディタに [!x-tweet] コールアウトとして挿入', () => {
      const editor = this.getTargetEditor();
      if (editor) {
        editor.replaceSelection(formatTweetCallout(t) + '\n');
        new Notice('挿入しました');
      } else {
        new Notice('挿入先のノートが見つかりません。ノートを開いてから試してください。', 5000);
      }
    });
    this.actionBtn(actions, '→ノート', 'Vault にノートとして保存', async () => {
      const folder = this.deps.getSettings().exportFolder;
      const r = await exportTweetsToVault(this.app, [t], folder);
      new Notice(r.written ? `ノート作成: ${r.folder}` : 'すでに存在します');
    });
    this.actionBtn(actions, '↗ X', 'X で開く', () => window.open(t.url, '_blank'));
  }

  /**
   * The editor to insert into. `workspace.activeEditor` is null while this
   * sidebar view holds focus (the click that got us here focused the sidebar),
   * so fall back to the most recently active markdown leaf in the main pane —
   * that's what "insert into my note" means from a sidebar.
   */
  private getTargetEditor(): Editor | null {
    const active = this.app.workspace.activeEditor?.editor;
    if (active) return active;
    const leaf = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
    const view = leaf?.view;
    if (view instanceof MarkdownView) return view.editor;
    return null;
  }

  private actionBtn(parent: HTMLElement, label: string, title: string, onClick: () => void): void {
    const btn = parent.createEl('button', { text: label, cls: 'jp-x-action-btn', attr: { title } });
    // Keep any text selection in the card body alive through the button press
    // (a plain click clears it before the handler runs on some platforms).
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', onClick);
  }

  // ── Auth modal (quick cookie entry, mobile-friendly) ───────

  private openAuthModal(): void {
    new XAuthModal(this.app, this.deps, () => { this.renderLocal(); }).open();
  }

  private openCorpusModal(): void {
    new XCorpusModal(this.app, this.deps, () => { this.renderLocal(); }).open();
  }

  private openSavedQueriesModal(): void {
    new XSavedQueriesModal(this.app, this.deps, (showCooc) => {
      if (showCooc) { this.coocActive = true; this.renderLocal(); }
      else this.renderLocal();
    }).open();
  }

  private openAddByUrlModal(): void {
    new XAddByUrlModal(this.app, this.deps, () => { this.renderLocal(); }).open();
  }
}

// ── Highlighting ─────────────────────────────────────────────

/** Render text into `el`, wrapping every occurrence of any term in <mark>. */
function highlightInto(el: HTMLElement, text: string, terms: string[]): void {
  const needles = terms.filter(Boolean);
  if (needles.length === 0) {
    el.appendText(text);
    return;
  }
  const lc = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const term of [...needles].sort((a, b) => b.length - a.length)) {
    const needle = term.toLowerCase();
    let i = 0;
    while ((i = lc.indexOf(needle, i)) !== -1) {
      ranges.push([i, i + term.length]);
      i += term.length;
    }
  }
  if (ranges.length === 0) {
    el.appendText(text);
    return;
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  // Merge overlaps.
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  let pos = 0;
  for (const [s, e] of merged) {
    if (s > pos) el.appendText(text.slice(pos, s));
    el.createSpan({ text: text.slice(s, e), cls: 'jp-x-hl' });
    pos = e;
  }
  if (pos < text.length) el.appendText(text.slice(pos));
}

// ── Formatting helpers ───────────────────────────────────────

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function compact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

// ── Cookie / auth modal ──────────────────────────────────────

class XAuthModal extends Modal {
  private deps: XViewDeps;
  private onSaved: () => void;
  constructor(app: App, deps: XViewDeps, onSaved: () => void) {
    super(app);
    this.deps = deps;
    this.onSaved = onSaved;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('jp-x-modal');
    contentEl.createEl('h2', { text: 'X ログインクッキー' });
    contentEl.createEl('p', {
      text: 'x.com にログインしたブラウザの開発者ツール → Application → Cookies から ' +
        'auth_token と ct0 をコピーして貼り付けてください。端末内にのみ保存されます。',
      cls: 'jp-x-modal-desc',
    });

    const s = this.deps.getSettings();

    new Setting(contentEl)
      .setName('ライブ取得を有効化')
      .setDesc('オフにするとキャッシュのみで検索します')
      .addToggle(t => t.setValue(s.enabled).onChange(v => { s.enabled = v; }));

    new Setting(contentEl)
      .setName('auth_token')
      .addText(t => {
        t.setValue(s.authToken).onChange(v => { s.authToken = v.trim(); });
        t.inputEl.type = 'password';
        t.inputEl.style.width = '100%';
      });

    new Setting(contentEl)
      .setName('ct0 (csrf)')
      .addText(t => {
        t.setValue(s.csrfToken).onChange(v => { s.csrfToken = v.trim(); });
        t.inputEl.type = 'password';
        t.inputEl.style.width = '100%';
      });

    const adv = contentEl.createEl('details', { cls: 'jp-x-modal-adv' });
    adv.createEl('summary', { text: '詳細（通常は変更不要）' });
    let queryIdText: import('obsidian').TextComponent | null = null;
    new Setting(adv)
      .setName('SearchTimeline queryId')
      .setDesc('検索が 404 になったら更新')
      .addText(t => { queryIdText = t; t.setValue(s.searchQueryId).onChange(v => { s.searchQueryId = v.trim(); }); })
      .addButton(b => b.setButtonText('自動取得').onClick(async () => {
        b.setDisabled(true);
        b.setButtonText('取得中…');
        await this.deps.saveSettings(); // ensure cookies are persisted for the fetch
        try {
          const id = await this.deps.client.discoverSearchQueryId();
          if (id) {
            s.searchQueryId = id;
            queryIdText?.setValue(id);
            await this.deps.saveSettings();
            new Notice(`✓ queryId を取得しました（${id}）`);
          } else {
            new Notice('queryId を取得できませんでした。クッキーを確認してください。', 7000);
          }
        } catch (e) {
          new Notice(`取得失敗: ${(e as Error).message}`, 7000);
        } finally {
          b.setDisabled(false);
          b.setButtonText('自動取得');
        }
      }));
    new Setting(adv)
      .setName('Bearer token')
      .addText(t => t.setValue(s.bearerToken).onChange(v => { s.bearerToken = v.trim(); }));

    const btnRow = contentEl.createDiv('jp-x-modal-btnrow');
    const testBtn = btnRow.createEl('button', { text: '接続テスト', cls: 'jp-x-action-btn' });
    const saveBtn = btnRow.createEl('button', { text: '保存', cls: 'jp-x-go-btn' });

    testBtn.addEventListener('click', async () => {
      await this.deps.saveSettings();
      testBtn.disabled = true;
      testBtn.textContent = 'テスト中…';
      const probe = () => this.deps.client.search(
        { ...emptyQuery(s.defaultLang, 'Latest'), allTerms: ['日本語'] },
      );
      try {
        let r;
        try {
          r = await probe();
        } catch (e) {
          // Auto-recover a stale operation id once, then retry the probe.
          if (e instanceof XScrapeError && e.status === 404) {
            testBtn.textContent = 'queryId 取得中…';
            const id = await this.deps.client.discoverSearchQueryId();
            if (id) {
              s.searchQueryId = id;
              queryIdText?.setValue(id);
              await this.deps.saveSettings();
              r = await probe();
              new Notice(`✓ queryId を更新して接続成功（${id}）`);
            } else {
              throw e;
            }
          } else {
            throw e;
          }
        }
        if (r) new Notice(`✓ 接続成功（${r.tweets.length}件取得）`);
      } catch (e) {
        const msg = e instanceof XScrapeError ? e.message : (e as Error).message;
        new Notice(`✗ ${msg}`, 8000);
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = '接続テスト';
      }
    });

    saveBtn.addEventListener('click', async () => {
      await this.deps.saveSettings();
      new Notice('X 設定を保存しました');
      this.onSaved();
      this.close();
    });
  }

  onClose(): void { this.contentEl.empty(); }
}

// ── Corpus import/export modal ───────────────────────────────

class XCorpusModal extends Modal {
  private deps: XViewDeps;
  private onChanged: () => void;
  constructor(app: App, deps: XViewDeps, onChanged: () => void) {
    super(app);
    this.deps = deps;
    this.onChanged = onChanged;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('jp-x-modal');
    contentEl.createEl('h2', { text: 'X コーパス' });

    const stats = this.deps.corpus.stats();
    contentEl.createEl('p', {
      text: `保存済み ${stats.count}件` +
        (stats.newest ? `・最新 ${formatDate(stats.newest)}` : ''),
      cls: 'jp-x-modal-desc',
    });

    new Setting(contentEl)
      .setName('JSONL を取り込む')
      .setDesc('CLI の tweets-YYYY-MM.jsonl などを統合（重複は自動マージ）')
      .addButton(b => b.setButtonText('ファイル選択').onClick(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.jsonl,.json,.txt';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          const text = await file.text();
          const { added, parsed } = this.deps.corpus.importJsonl(text);
          await this.deps.corpus.save();
          new Notice(`取り込み: ${parsed}件中 ${added}件を新規追加`);
          this.onChanged();
          this.onOpen();
        };
        input.click();
      }));

    new Setting(contentEl)
      .setName('JSONL を書き出す')
      .setDesc('CLI 互換フォーマットでコーパスをエクスポート')
      .addButton(b => b.setButtonText('エクスポート').onClick(() => {
        const data = this.deps.corpus.exportJsonl();
        const blob = new Blob([data], { type: 'application/x-ndjson' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'x-corpus.jsonl';
        a.click();
        URL.revokeObjectURL(url);
        new Notice('エクスポートしました');
      }));

    new Setting(contentEl)
      .setName('Vault ノートに書き出す')
      .setDesc(`全ツイートを ${this.deps.getSettings().exportFolder} にノート化（プラグインが自動索引）`)
      .addButton(b => b.setButtonText('ノート化').onClick(async () => {
        const all = this.deps.corpus.getAll();
        if (all.length === 0) { new Notice('コーパスが空です'); return; }
        const r = await exportTweetsToVault(this.app, all, this.deps.getSettings().exportFolder);
        new Notice(`ノート ${r.written}件作成（${r.skipped}件は既存）→ ${r.folder}`);
      }));

    new Setting(contentEl)
      .setName('コーパスを消去')
      .setDesc('保存済みツイートをすべて削除します')
      .addButton(b => b.setButtonText('消去').setWarning().onClick(async () => {
        this.deps.corpus.clear();
        await this.deps.corpus.save();
        new Notice('コーパスを消去しました');
        this.onChanged();
        this.onOpen();
      }));
  }

  onClose(): void { this.contentEl.empty(); }
}

// ── Saved queries (phrases.yaml model) ───────────────────────

class XSavedQueriesModal extends Modal {
  private deps: XViewDeps;
  /** onDone(showCooc): refresh view; if showCooc, switch to co-occurrence view. */
  private onDone: (showCooc: boolean) => void;
  private running = false;

  constructor(app: App, deps: XViewDeps, onDone: (showCooc: boolean) => void) {
    super(app);
    this.deps = deps;
    this.onDone = onDone;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('jp-x-modal');
    contentEl.createEl('h2', { text: '保存した検索（フレーズ辞書）' });
    contentEl.createEl('p', {
      text: '概念ごとに表記ゆれ（surface_or）をまとめて登録します。実行すると各表記を個別に検索し、' +
        'ヒットしたツイートにこの検索IDを付与。2つ以上の保存検索に同時ヒットしたツイートが「★共起」です。',
      cls: 'jp-x-modal-desc',
    });

    const s = this.deps.getSettings();
    const list = contentEl.createDiv('jp-x-sq-list');

    for (const sq of s.savedQueries) {
      const row = new Setting(list)
        .setName(`${sq.label} (${sq.id})`)
        .setDesc(`${sq.surfaceOr.join(' / ')} · コーパス内 ${this.deps.corpus.countByQuery(sq.id)}件`);
      row.addButton(b => b.setButtonText('実行').onClick(async () => {
        if (this.running) return;
        await this.runOne(sq);
      }));
      row.addButton(b => b.setButtonText('編集').onClick(() => this.openEditor(sq)));
      row.addButton(b => b.setButtonText('削除').setWarning().onClick(async () => {
        s.savedQueries = s.savedQueries.filter(q => q.id !== sq.id);
        await this.deps.saveSettings();
        this.onOpen();
      }));
    }

    if (s.savedQueries.length === 0) {
      list.createEl('p', { text: 'まだ保存検索がありません。', cls: 'jp-x-modal-desc' });
    }

    const btnRow = contentEl.createDiv('jp-x-modal-btnrow');
    const addBtn = btnRow.createEl('button', { text: '＋ 新規', cls: 'jp-x-action-btn' });
    addBtn.addEventListener('click', () => this.openEditor(null));

    if (s.savedQueries.length > 0) {
      const runAllBtn = btnRow.createEl('button', { text: '全実行', cls: 'jp-x-action-btn' });
      runAllBtn.addEventListener('click', () => this.runAll());
      const coocBtn = btnRow.createEl('button', { text: '★ 共起を表示', cls: 'jp-x-go-btn' });
      coocBtn.addEventListener('click', () => { this.onDone(true); this.close(); });
    }
  }

  private async runOne(sq: SavedQuery): Promise<void> {
    const issue = this.deps.client.configIssue();
    if (issue) { new Notice(`X: ${issue}`, 5000); return; }
    this.running = true;
    new Notice(`「${sq.label}」を取得中…`);
    const s = this.deps.getSettings();
    const r = await runSavedQuery(this.deps.client, this.deps.corpus, sq, {
      lang: s.defaultLang, product: s.defaultProduct,
    });
    await this.deps.corpus.save();
    this.running = false;
    new Notice(`「${sq.label}」: ${r.fetched}件取得（新規 ${r.added}）` +
      (r.errors.length ? `・${r.errors.length}件エラー` : ''));
    this.onDone(false);
    this.onOpen();
  }

  private async runAll(): Promise<void> {
    const issue = this.deps.client.configIssue();
    if (issue) { new Notice(`X: ${issue}`, 5000); return; }
    this.running = true;
    const s = this.deps.getSettings();
    const results = await runAllSavedQueries(
      this.deps.client, this.deps.corpus, s.savedQueries,
      { lang: s.defaultLang, product: s.defaultProduct },
      (done, total, cur) => new Notice(`(${done + 1}/${total}) ${cur}…`, 1500),
    );
    await this.deps.corpus.save();
    this.running = false;
    const added = results.reduce((a, r) => a + r.added, 0);
    new Notice(`全実行完了: 新規 ${added}件`);
    this.onDone(false);
    this.onOpen();
  }

  private openEditor(existing: SavedQuery | null): void {
    new XSavedQueryEditor(this.app, this.deps, existing, async () => {
      await this.deps.saveSettings();
      this.onOpen();
    }).open();
  }

  onClose(): void { this.contentEl.empty(); }
}

class XSavedQueryEditor extends Modal {
  private deps: XViewDeps;
  private existing: SavedQuery | null;
  private onSaved: () => Promise<void>;

  constructor(app: App, deps: XViewDeps, existing: SavedQuery | null, onSaved: () => Promise<void>) {
    super(app);
    this.deps = deps;
    this.existing = existing;
    this.onSaved = onSaved;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('jp-x-modal');
    contentEl.createEl('h2', { text: this.existing ? '保存検索を編集' : '保存検索を追加' });

    const draft: SavedQuery = this.existing
      ? { ...this.existing, surfaceOr: [...this.existing.surfaceOr] }
      : { id: '', label: '', surfaceOr: [], minFaves: 0 };

    new Setting(contentEl).setName('ラベル').addText(t =>
      t.setValue(draft.label).onChange(v => { draft.label = v; }));
    new Setting(contentEl).setName('ID').setDesc('英数字のユニークID（共起の識別に使用）')
      .addText(t => t.setValue(draft.id).onChange(v => { draft.id = v.trim(); }));
    new Setting(contentEl).setName('表記ゆれ surface_or').setDesc('1行に1つ。各表記を個別に検索')
      .addTextArea(t => {
        t.setValue(draft.surfaceOr.join('\n')).onChange(v => {
          draft.surfaceOr = v.split('\n').map(x => x.trim()).filter(Boolean);
        });
        t.inputEl.rows = 4;
        t.inputEl.style.width = '100%';
      });
    new Setting(contentEl).setName('最小いいね').addText(t => {
      t.inputEl.type = 'number';
      t.setValue(String(draft.minFaves ?? 0)).onChange(v => { draft.minFaves = Number(v) || 0; });
    });

    const btnRow = contentEl.createDiv('jp-x-modal-btnrow');
    btnRow.createEl('button', { text: 'キャンセル', cls: 'jp-x-action-btn' })
      .addEventListener('click', () => this.close());
    btnRow.createEl('button', { text: '保存', cls: 'jp-x-go-btn' })
      .addEventListener('click', async () => {
        if (!draft.id || !draft.label || draft.surfaceOr.length === 0) {
          new Notice('ラベル・ID・表記ゆれを入力してください');
          return;
        }
        const s = this.deps.getSettings();
        const idx = s.savedQueries.findIndex(q => q.id === (this.existing?.id ?? draft.id));
        if (idx >= 0) s.savedQueries[idx] = draft;
        else s.savedQueries.push(draft);
        await this.onSaved();
        this.close();
      });
  }

  onClose(): void { this.contentEl.empty(); }
}

// ── Add tweet by URL (no-auth syndication capture) ───────────

class XAddByUrlModal extends Modal {
  private deps: XViewDeps;
  private onChanged: () => void;
  constructor(app: App, deps: XViewDeps, onChanged: () => void) {
    super(app);
    this.deps = deps;
    this.onChanged = onChanged;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('jp-x-modal');
    contentEl.createEl('h2', { text: 'ツイートを URL で追加' });
    contentEl.createEl('p', {
      text: 'ツイートの URL か ID を貼り付けてください。公開ツイートはクッキー不要で取得できます。',
      cls: 'jp-x-modal-desc',
    });

    let value = '';
    new Setting(contentEl).setName('URL / ID').addText(t => {
      t.inputEl.style.width = '100%';
      t.setPlaceholder('https://x.com/user/status/1234567890');
      t.onChange(v => { value = v; });
    });

    const btnRow = contentEl.createDiv('jp-x-modal-btnrow');
    btnRow.createEl('button', { text: 'キャンセル', cls: 'jp-x-action-btn' })
      .addEventListener('click', () => this.close());
    const addBtn = btnRow.createEl('button', { text: '取得して追加', cls: 'jp-x-go-btn' });
    addBtn.addEventListener('click', async () => {
      const id = extractTweetId(value);
      if (!id) { new Notice('有効なツイート URL/ID ではありません'); return; }
      addBtn.disabled = true;
      addBtn.textContent = '取得中…';
      try {
        const tweet = await this.deps.client.fetchTweetById(id);
        if (!tweet) { new Notice('ツイートを取得できませんでした'); return; }
        const added = this.deps.corpus.addTweets([tweet]);
        await this.deps.corpus.save();
        new Notice(added ? `追加: @${tweet.authorHandle}` : 'すでにコーパスにあります');
        this.onChanged();
        this.close();
      } catch (e) {
        new Notice(`取得エラー: ${(e as Error).message}`, 6000);
      } finally {
        addBtn.disabled = false;
        addBtn.textContent = '取得して追加';
      }
    });
  }

  onClose(): void { this.contentEl.empty(); }
}
