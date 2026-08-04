/**
 * TsukubaWebCorpusScraper.ts — NINJAL-LWP for TWC, the transport layer.
 *
 * Parsing lives in `twc-parse.ts` (pure, golden-tested). This file does the two
 * things that cannot be tested against a fixture: the CSRF handshake, and the
 * request sequence.
 *
 * ## What was wrong, and why it never announced itself
 *
 * The previous implementation fetched `/search/?q=風&options=exact` and scraped
 * the returned HTML for `<table>` rows. That page holds no data — the 語彙
 * プロファイル is drawn by three jqGrid panels that POST for their own JSON.
 * So the scraper's real behaviour was: request a page that cannot contain the
 * answer, parse nothing out of it, and report success with zero entries.
 *
 * Worse is what happens if you find the JSON endpoints but call them the obvious
 * way. `GET /collocation/N.25644.J001/` returns **HTTP 200 with well-formed
 * JSON** — the global first page of a 43-million-row table, every row belonging
 * to こと. No error, no empty result, no signal of any kind. A parser written
 * against that response looks like it works and quietly files こと's collocates
 * under 風. The endpoints are POST-only and CSRF-guarded; that is the whole
 * difference, and `parseCollocates` re-checks the key on every row so this
 * particular lie can never reach the store again.
 *
 * ## Shape (DESIGN §22.7)
 *
 * Enrichment, not bulk. `profile()` answers for ONE user-initiated word in
 * 2 + N requests, rate-limited, and the result is frozen into `payload.goho`.
 * Nothing here crawls, and `MAX_PATTERNS` bounds N regardless of what is asked.
 *
 * Terms (「ご利用にあたって」, re-read 2026-08-02): the corpus is published for
 * 教育・研究目的, results may be machine-processed, and publication of research
 * using it should cite TWC and notify jp-kyoten@un.tsukuba.ac.jp. Every 用例 the
 * site shows carries its source page and URL. There is no clause forbidding
 * retrieval of search results; the site itself ships `/collocation_download/`.
 */

import type { App } from 'obsidian';
import { requestUrl } from 'obsidian';
import type { CollocationEntry } from '../types.ts';
import { PartOfSpeech, CollocationSource } from '../types.ts';
import type { CollocationStore } from '../data/CollocationStore.ts';
import { MAX_FRAMES } from './goho.ts';
import {
  parseHeadwords, parsePatterns, parseCollocates, parseExamples, collocationKey, toFrame,
  groupExamplesByCollocation, citationsByCollocation, posOfId,
  type TwcHeadword, type TwcPattern, type TwcFrame, type TwcExample,
} from './twc-parse.ts';

const BASE = 'https://tsukubawebcorpus.jp';

// ── Types ────────────────────────────────────────────────────

/** Everything one word's lookup yields, ready for `profileFromFrames`. */
export interface TWCWordProfile {
  headword: TwcHeadword;
  /**
   * The OTHER lemmas TWC holds under the same spelling.
   *
   * 風 is two words in this corpus: 形容動詞 フウ (80,779) and 名詞 カゼ (322).
   * Profiling one and saying nothing about the other would quietly answer a
   * different question than the one asked, so the alternates travel with the
   * result and the panel offers them.
   */
  alternates: TwcHeadword[];
  /** every way the word attaches, ranked by corpus frequency. */
  patterns: TwcPattern[];
  /** the frames actually fetched — `patterns.length` may be larger (§28 S6). */
  frames: TwcFrame[];
  /** attested sentences, each with the document and URL it came from. */
  examples: TwcExample[];
  /** the page a reader can open to see everything this profile truncated. */
  url: string;
}

export interface TWCScraperOptions {
  /** Milliseconds between requests (default: 3000 — be respectful) */
  rateLimit: number;
  /** Max collocations to extract per pattern type */
  maxPerPattern: number;
  /** Callback for progress updates */
  onProgress?: (msg: string) => void;
  /** Callback per new entry */
  onEntry?: (entry: CollocationEntry) => void;
}

const DEFAULT_TWC_OPTIONS: TWCScraperOptions = {
  rateLimit: 3000,
  maxPerPattern: 20,
};

/**
 * How many ways-of-attaching are drilled into per word.
 *
 * 走る has 87 patterns and の has 50; drilling all of them is one request each
 * for a profile that shows `MAX_FRAMES`. Fetching more than are kept costs the
 * user a rate-limited round trip per discarded frame, so this tracks it exactly.
 * The rest stay reachable through `url`.
 */
/**
 * How many ways-of-attaching the FIRST fetch drills into.
 *
 * Lower than it was, and deliberately: the index now captures all of them in
 * one request, so the initial fetch only has to put enough on screen to be
 * worth reading. The rest are named, ranked and one tap away, which is both
 * cheaper and more honest than picking six and discarding fourteen.
 */
export const MAX_PATTERNS = 3;
/** Kept for callers that still cap a frozen frame list. */
export { MAX_FRAMES };
/**
 * Rows asked for per pattern.
 *
 * The profile displays `FRAME_ITEMS` (24), so 1,000 would be ~40× the payload
 * for the same panel — 走る's frames really do return 1,000 rows each. The rows
 * arrive frequency-ranked, so 100 is ample headroom for choosing the top 24, and
 * when a pattern has more the `complete` flag says so instead of the count
 * quietly becoming a cap.
 */
const ROWS = 100;
/** The pattern list is small (87 for 走る, 50 for の) and is the profile's index,
 *  so it is fetched whole. */
const PATTERN_ROWS = 1000;

/**
 * Examples. The profile freezes 8, and sentences from different ways of
 * attaching teach more than eight from one, so a few small batches beat one
 * large one — and each batch is a request the user waits for.
 */
const EXAMPLE_BATCHES = 3;
const EXAMPLE_PER_BATCH = 4;
const EXAMPLE_TARGET = 8;
const EXAMPLE_ROWS = 20;

// ── Scraper Class ────────────────────────────────────────────

export class TsukubaWebCorpusScraper {
  private app: App;
  private store: CollocationStore;
  private options: TWCScraperOptions;
  private queue: string[] = [];
  private running = false;
  private aborted = false;

  constructor(app: App, store: CollocationStore, options?: Partial<TWCScraperOptions>) {
    this.app = app;
    this.store = store;
    this.options = { ...DEFAULT_TWC_OPTIONS, ...options };
  }

  // ── Queue management ─────────────────────────────────────

  enqueue(words: string[]): void {
    for (const w of words) {
      const trimmed = w.trim();
      if (trimmed && !this.queue.includes(trimmed)) {
        this.queue.push(trimmed);
      }
    }
  }

  abort(): void {
    this.aborted = true;
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  queueLength(): number {
    return this.queue.length;
  }

  // ── Main run loop ────────────────────────────────────────

  async run(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    this.aborted = false;
    let count = 0;

    while (this.queue.length > 0 && !this.aborted) {
      const word = this.queue.shift()!;
      this.options.onProgress?.(`TWC: fetching profile for「${word}」...`);

      try {
        const profile = await this.profile(word);
        if (!profile) {
          this.options.onProgress?.(`TWC:「${word}」は見出し語にありません`);
        } else {
          const entries = this.profileToEntries(profile);
          for (const entry of entries) {
            this.store.add(entry);
            this.options.onEntry?.(entry);
            count++;
          }
          this.options.onProgress?.(
            `TWC: ${word} → ${entries.length} collocations extracted`,
          );
        }
      } catch (err) {
        // §28 S6 — a failure says so; it does not pass for an empty corpus.
        this.options.onProgress?.(`TWC error for「${word}」: ${err}`);
      }

      if (this.queue.length > 0 && !this.aborted) {
        await this.delay(this.options.rateLimit);
      }
    }

    this.running = false;
    return count;
  }

  /** §22.7: on-demand profile for ONE word — parsed entries WITHOUT touching
   *  the legacy store (same adapter shape as HyogenScraper.profileWord). The
   *  corpus serves the catalog; the catalog never serves the corpus. */
  async profileWord(word: string): Promise<CollocationEntry[]> {
    const profile = await this.profile(word);
    return profile ? this.profileToEntries(profile) : [];
  }

  // ── The lookup ───────────────────────────────────────────

  /**
   * One word → its full 語彙プロファイル, in 2 + N requests.
   *
   * Returns null when TWC simply does not have the word, which is a fact about
   * the corpus and not an error — the caller says so rather than showing an
   * empty box that looks like a bug.
   */
  async profile(word: string, limit = MAX_PATTERNS): Promise<TWCWordProfile | null> {
    // `resolve` returns every lemma spelled this way, most-attested first. The
    // corpus's own frequency decides which one is profiled — overriding it with
    // a guess about which sense "must" be meant would be inventing data — and
    // the rest are handed back so nothing is silently chosen away.
    const senses = await this.resolve(word);
    const headword = senses[0];
    if (!headword) return null;
    const alternates = senses.slice(1);
    const url = `${BASE}/headword/${headword.id}/`;

    // The site rate-limits bursts with a 403; every request is spaced, not just
    // the drill-downs.
    // A profile is ~11 rate-limited round trips. Silence for half a minute
    // reads as a hang, so every step says where it is.
    const say = (msg: string) => this.options.onProgress?.(msg);
    say(`${word}〈${headword.yomi}・${headword.pos}〉— 付き方を取得中…`);

    await this.delay(this.options.rateLimit);
    const patterns = await this.patterns(headword.id, url);
    const frames: TwcFrame[] = [];
    // The collocate each frame is best represented by — its most frequent one —
    // remembered so the example pass knows what to ask for, and so the
    // sentences it returns can be stamped with the pairing they attest.
    const topOf: Array<{ id: string; text: string; freq: number; frame: string }> = [];
    const drill = patterns.slice(0, limit);
    for (const [i, pattern] of drill.entries()) {
      if (this.aborted) break;
      say(`${pattern.name} — 共起語 ${i + 1}/${drill.length}…`);
      await this.delay(this.options.rateLimit);
      const list = await this.collocates(headword.id, pattern.id, url);
      // A pattern the corpus counts but whose drill-down comes back empty is a
      // rejected request, not an empty pattern — do not publish it as one.
      if (!list.rows.length) continue;
      frames.push(toFrame(headword.pos, pattern, list));
      const top = list.rows.reduce((a, b) => (b.freq > a.freq ? b : a));
      // `id` is the row's whole `collocation_id` (`H007.00001`) — the example
      // key is headwordId + '.' + that, i.e. `N.25644.H007.00001`.
      topOf.push({ id: top.id, text: top.text, freq: top.freq, frame: pattern.name });
    }

    // One example batch per frame, most-attested frames first, until there are
    // enough to fill the profile. Sentences drawn from DIFFERENT ways of
    // attaching are worth more than eight from the same one.
    const examples: TwcExample[] = [];
    for (const top of topOf.slice(0, EXAMPLE_BATCHES)) {
      if (this.aborted || examples.length >= EXAMPLE_TARGET) break;
      say(`「${top.text}」の用例を取得中…（${examples.length}/${EXAMPLE_TARGET}件）`);
      await this.delay(this.options.rateLimit);
      try {
        const got = await this.examples(headword.id, top.id, top.freq, url);
        if (got.mismatch) {
          console.warn('[jp-collocations] TWC examples refused for', top.text,
            '— record count did not match the collocate frequency');
          continue;
        }
        // Stamp the pairing we ASKED for onto every sentence that came back.
        // The response cannot tell us — and the two texts cannot be matched
        // afterwards, because the grid is lemmatised and the sentences are
        // surface. This is the same discipline as verifying on `records`
        // instead of on the highlighted string.
        examples.push(...got.rows.slice(0, EXAMPLE_PER_BATCH).map((r) => ({
          ...r, collocationId: top.id, collocate: top.text, frame: top.frame,
        })));
      } catch (e) {
        // Examples are enrichment on top of enrichment: losing them must not
        // cost the frames, which are the part nothing else in the plugin has.
        console.warn('[jp-collocations] TWC examples failed for', top.text, e);
      }
    }

    return { headword, alternates, patterns, frames, examples, url };
  }

  /**
   * ONE pattern's collocations, on demand — the middle panel of the site's own
   * 語彙プロファイル.
   *
   * The counterpart to freezing the index whole: the index says 風 attaches 20
   * ways and how often each is used, and this answers "what attaches THAT way"
   * for the one you actually opened. A single rate-limited request, so the
   * profile deepens where you look instead of paying up front for 20 drills
   * whose results are mostly never read.
   */
  async drillPattern(headwordId: string, pattern: TwcPattern): Promise<TwcFrame | null> {
    const url = TsukubaWebCorpusScraper.pageFor(headwordId);
    this.options.onProgress?.(`${pattern.name} — 共起語を取得中…`);
    const list = await this.collocates(headwordId, pattern.id, url);
    // A pattern the corpus counts but whose drill-down comes back empty is a
    // rejected request, not an empty pattern — do not publish it as one.
    if (!list.rows.length) return null;
    return toFrame(posOfId(headwordId), pattern, list);
  }

  /**
   * ONE collocation's attested sentences — the site's right-hand panel.
   *
   * `expectFreq` is that collocation's own corpus frequency; `parseExamples`
   * verifies the response against it, because identity here is a number and
   * never a string (the grid is lemmatised, the sentences are surface).
   */
  async drillExamples(
    headwordId: string,
    collocation: { id: string; text: string; freq: number },
    frameLabel: string,
  ): Promise<TwcExample[]> {
    const url = TsukubaWebCorpusScraper.pageFor(headwordId);
    this.options.onProgress?.(`「${collocation.text}」の用例を取得中…`);
    const got = await this.examples(headwordId, collocation.id, collocation.freq, url);
    if (got.mismatch) {
      throw new Error(`用例の件数が共起頻度と一致しません（${collocation.text}）— 取り込みを中止しました`);
    }
    // Stamped with the pairing we asked for; it cannot be recovered afterwards.
    return got.rows.map((r) => ({
      ...r, collocationId: collocation.id, collocate: collocation.text, frame: frameLabel,
    }));
  }

  /** The TWC page for one lemma — where the profile's truncations stay reachable. */
  static pageFor(headwordId: string): string {
    return `${BASE}/headword/${headwordId}/`;
  }

  /** 風 → `N.25644`. Exact-surface only: a `contains` match would return 風景
   *  and 風呂, which are different words rather than other senses. */
  async resolve(word: string): Promise<TwcHeadword[]> {
    const json = await this.post(`${BASE}/headwordlist_all/`, {
      nd: '1', rows: '50', page: '1', _search: 'true',
      filters: JSON.stringify({
        groupOp: 'AND', rules: [{ field: 'headword', op: 'eq', data: word }],
      }),
    }, `${BASE}/`);
    return parseHeadwords(json, word);
  }

  /** Every way the word attaches, with corpus frequency and share. */
  async patterns(headwordId: string, referer: string): Promise<TwcPattern[]> {
    const json = await this.post(`${BASE}/patternfreqorder/${headwordId}/`, {
      headword_id: headwordId, nd: '1', rows: String(PATTERN_ROWS), page: '1',
    }, referer);
    return parsePatterns(json);
  }

  /**
   * The attested sentences behind ONE collocate, each with its document + URL.
   *
   * `expectFreq` is the collocate's corpus frequency; the response's `records`
   * equals it exactly, so a batch that disagrees is not the collocation we
   * asked for and `parseExamples` refuses it.
   */
  async examples(headwordId: string, collocationId: string, expectFreq: number, referer: string) {
    // The instance key is three parts: N.00002 . C007 . 00005
    const key = `${headwordId}.${collocationId}`;
    const json = await this.post(`${BASE}/example/${key}/`, {
      // NB `headword_collocation_id`, the same field name the collocation grid
      // uses — NOT `collocation_id`, despite the value being a collocation id.
      // Taken from `loadExample` in the site's own LWP.headword.min.js.
      headword_collocation_id: key, nd: '1', rows: String(EXAMPLE_ROWS), page: '1',
    }, referer);
    return parseExamples(json, expectFreq);
  }

  /** The collocates of ONE way, with freq / MI / logDice. */
  async collocates(headwordId: string, patternId: string, referer: string) {
    const key = collocationKey(headwordId, patternId);
    const json = await this.post(`${BASE}/collocation/${key}/`, {
      headword_collocation_id: key, _search: 'true', nd: '1',
      rows: String(ROWS), page: '1', sidx: 'freq', sord: 'desc',
    }, referer);
    return parseCollocates(json, key);
  }

  // ── Transport ────────────────────────────────────────────

  /**
   * The one thing that is load-bearing: **the method must be POST.**
   *
   * Measured 2026-08-02, holding everything else constant. GET with the exact
   * same parameters returns 200 and こと's collocates; POST with no cookie, no
   * CSRF token and no headers beyond Content-Type returns the right word. There
   * is no session to establish — `GET /` sets no cookie and the pages carry no
   * `csrfmiddlewaretoken` — so nothing here pretends to establish one. A
   * handshake that provably obtains nothing is a request the user pays for and
   * a failure mode that can fire for no reason.
   *
   * `X-Requested-With` and `Referer` are sent because the site's own jqGrid
   * sends them and both were verified harmless; neither is required. If TWC
   * ever does turn CSRF on, these POSTs get a legible 403 rather than silently
   * wrong data — which is the failure mode worth having.
   */
  private async post(url: string, fields: Record<string, string>, referer: string): Promise<unknown> {
    const body = Object.entries(fields)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const resp = await requestUrl({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': referer,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'ja',
      },
      body,
      throw: false,
    });
    // 403 here is the site's rate limiter ("temporarily unavailable"), reached
    // in testing by bursting — hence the delay between every request below.
    if (resp.status === 403) {
      throw new Error('TWCがアクセスを一時的に拒否しました（間隔を空けて再試行してください）');
    }
    if (resp.status !== 200) throw new Error(`TWC ${resp.status}: ${url}`);
    try {
      return JSON.parse(resp.text);
    } catch {
      // The site answers errors with an HTML page; saying so beats a parse crash.
      throw new Error(`TWCがJSONを返しませんでした: ${url}`);
    }
  }

  // ── Convert profile to store entries ─────────────────────

  private profileToEntries(profile: TWCWordProfile): CollocationEntry[] {
    const entries: CollocationEntry[] = [];
    const now = Date.now();
    const pos = this.mapPOS(profile.headword.pos);

    // Sentences are attached to the collocate they actually attest — an example
    // is evidence for one pairing, not decoration for the whole word. Both joins
    // are pure and pinned in golden/twc.mjs; see `groupExamplesByCollocation`
    // for why they key on the id and never on the text.
    const byCollocation = groupExamplesByCollocation(profile.examples);
    const citeOf = citationsByCollocation(profile.examples);

    for (const frame of profile.frames) {
      for (const m of frame.measured.slice(0, this.options.maxPerPattern)) {
        entries.push({
          id: this.store.generateId(),
          headword: profile.headword.headword,
          headwordReading: profile.headword.yomi,
          collocate: m.text.split(profile.headword.headword).join('').trim() || m.text,
          fullPhrase: m.text,
          headwordPOS: pos,
          collocatePOS: PartOfSpeech.Other,
          pattern: frame.label,
          exampleSentences: m.id ? byCollocation.get(m.id) ?? [] : [],
          source: CollocationSource.Import, // TWC-sourced
          tags: ['twc', `twc-pattern:${frame.label}`, `twc-dir:${frame.direction}`],
          notes: `freq=${m.freq} MI=${m.mi.toFixed(2)} logDice=${m.logDice.toFixed(2)} — ${profile.url}`
            + (m.id && citeOf.has(m.id) ? `\n用例出典: ${citeOf.get(m.id)}` : ''),
          // The corpus's own frequency, log-scaled into the store's 1–100 field
          // so ranking stays meaningful across four orders of magnitude.
          frequency: Math.min(100, Math.max(1, Math.round(Math.log10(Math.max(1, m.freq) ) * 20))),
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return entries;
  }

  // ── Helpers ──────────────────────────────────────────────

  private mapPOS(pos: string): PartOfSpeech {
    const map: Record<string, PartOfSpeech> = {
      '名詞': PartOfSpeech.Noun,
      '動詞': PartOfSpeech.Verb,
      'い形容詞': PartOfSpeech.Adjective_i,
      'イ形容詞': PartOfSpeech.Adjective_i,
      'な形容詞': PartOfSpeech.Adjective_na,
      'ナ形容詞': PartOfSpeech.Adjective_na,
      '形容詞': PartOfSpeech.Adjective_i,
      '形容動詞': PartOfSpeech.Adjective_na,
      '副詞': PartOfSpeech.Adverb,
      '助詞': PartOfSpeech.Particle,
      '接続詞': PartOfSpeech.Conjunction,
      '感動詞': PartOfSpeech.Interjection,
    };
    return map[pos] ?? PartOfSpeech.Other;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
