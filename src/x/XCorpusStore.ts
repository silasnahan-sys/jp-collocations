/**
 * XCorpusStore — the growing, offline-searchable corpus of captured tweets.
 *
 * Every tweet the scraper sees is merged in here and persisted (under
 * `_xCorpus` in the plugin data blob). Search runs entirely locally so the
 * "dictionary" works without network for anything seen before; the view fires
 * a live scrape in parallel and merges new tweets back in.
 *
 * Multi-term co-occurrence search ("tweets with BOTH 以前の AND でさえ") is exact
 * substring matching over NFKC-normalised text. A character-bigram inverted
 * index narrows candidates first so search stays fast as the corpus grows; the
 * index is rebuilt on load rather than serialised.
 */

import type { XTweet, XSearchQuery, XCorpusData } from './x-types';
import { normTerm } from './query-builder';
import { normalizeJapanese } from '../utils/japanese';

const CORPUS_VERSION = 1;

type PersistFn = (data: XCorpusData) => Promise<void>;

export class XCorpusStore {
  private tweets: Map<string, XTweet> = new Map();
  /** id → NFKC-normalised text, for matching. Not serialised. */
  private normText: Map<string, string> = new Map();
  /** character-bigram → set of tweet ids. Not serialised. */
  private bigramIndex: Map<string, Set<string>> = new Map();
  private persistFn: PersistFn;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(persistFn: PersistFn) {
    this.persistFn = persistFn;
  }

  // ── Load / Save ────────────────────────────────────────────

  loadFromData(saved: XCorpusData | undefined): void {
    if (!saved?.tweets) return;
    for (const t of saved.tweets) {
      this.tweets.set(t.id, t);
      this.indexTweet(t);
    }
  }

  serialize(): XCorpusData {
    return { version: CORPUS_VERSION, tweets: [...this.tweets.values()] };
  }

  /** Debounced persistence (matches the other stores' write pattern). */
  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.persistFn(this.serialize());
      this.saveTimer = null;
    }, 600);
  }

  async save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.persistFn(this.serialize());
  }

  // ── Mutation ───────────────────────────────────────────────

  /**
   * Merge scraped tweets in. Returns the count of *newly added* tweets (ones
   * not already in the corpus) so the UI can show "+N new".
   */
  addTweets(incoming: XTweet[]): number {
    let added = 0;
    for (const t of incoming) {
      const existing = this.tweets.get(t.id);
      if (existing) {
        // Refresh volatile metrics, keep earliest capture, union provenance.
        existing.favoriteCount = t.favoriteCount;
        existing.retweetCount = t.retweetCount;
        existing.replyCount = t.replyCount;
        existing.quoteCount = t.quoteCount;
        existing.viewCount = t.viewCount ?? existing.viewCount;
        if (t.media?.length) {
          existing.media = t.media;
          existing.hasMedia = true;
        }
        existing.queries = [...new Set([...existing.queries, ...t.queries])];
        if (t.matchedQueries?.length) {
          existing.matchedQueries = [
            ...new Set([...(existing.matchedQueries ?? []), ...t.matchedQueries]),
          ];
        }
      } else {
        this.tweets.set(t.id, t);
        this.indexTweet(t);
        added++;
      }
    }
    if (incoming.length > 0) this.scheduleSave();
    return added;
  }

  clear(): void {
    this.tweets.clear();
    this.normText.clear();
    this.bigramIndex.clear();
    this.scheduleSave();
  }

  // ── Bundle JSONL interop ───────────────────────────────────
  //
  // The companion CLI (_tmp_pipeline/twitter) caches tweets as one JSON object
  // per line: { id, createdAt(ISO), author, authorName, text, likeCount,
  // retweetCount, replyCount, quoteCount, matchedQueries[], firstSeenAt, ... }.
  // These let the plugin corpus and the CLI cache exchange data losslessly.

  /** Import the CLI cache JSONL (or our own export). Returns newly added count. */
  importJsonl(text: string): { added: number; parsed: number } {
    const incoming: XTweet[] = [];
    let parsed = 0;
    for (const line of text.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      let rec: any;
      try {
        rec = JSON.parse(s);
      } catch {
        continue;
      }
      if (!rec?.id) continue;
      parsed++;
      const id = String(rec.id);
      const handle = String(rec.author ?? rec.authorHandle ?? '').replace(/^@/, '');
      const created = Date.parse(rec.createdAt ?? rec.created_at ?? '');
      const captured = Date.parse(rec.firstSeenAt ?? '') || Date.now();
      incoming.push({
        id,
        url: rec.url || (handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/status/${id}`),
        text: String(rec.text ?? rec.rawText ?? ''),
        authorHandle: handle,
        authorName: String(rec.authorName ?? handle),
        createdAt: Number.isNaN(created) ? captured : created,
        lang: String(rec.lang ?? 'und'),
        favoriteCount: Number(rec.likeCount ?? rec.favoriteCount ?? 0) || 0,
        retweetCount: Number(rec.retweetCount ?? 0) || 0,
        replyCount: Number(rec.replyCount ?? 0) || 0,
        quoteCount: Number(rec.quoteCount ?? 0) || 0,
        hasMedia: !!rec.hasMedia || (Array.isArray(rec.media) && rec.media.length > 0),
        media: Array.isArray(rec.media) && rec.media.length > 0
          ? rec.media
              .filter((m: any) => m && typeof m.thumb === 'string' && typeof m.url === 'string')
              .map((m: any) => ({
                type: m.type === 'video' || m.type === 'animated_gif' ? m.type : 'photo',
                thumb: m.thumb,
                url: m.url,
              }))
          : undefined,
        capturedAt: captured,
        queries: Array.isArray(rec.queries) ? rec.queries.map(String) : [],
        matchedQueries: Array.isArray(rec.matchedQueries) ? rec.matchedQueries.map(String) : [],
      });
    }
    const added = this.addTweets(incoming);
    return { added, parsed };
  }

  /** Export the corpus as bundle-compatible JSONL (one tweet per line). */
  exportJsonl(): string {
    const lines: string[] = [];
    for (const t of this.tweets.values()) {
      lines.push(JSON.stringify({
        id: t.id,
        url: t.url,
        createdAt: new Date(t.createdAt).toISOString(),
        author: t.authorHandle,
        authorName: t.authorName,
        text: t.text,
        lang: t.lang,
        likeCount: t.favoriteCount,
        retweetCount: t.retweetCount,
        replyCount: t.replyCount,
        quoteCount: t.quoteCount,
        matchedQueries: t.matchedQueries ?? [],
        firstSeenAt: new Date(t.capturedAt).toISOString(),
        hasMedia: t.hasMedia,
        ...(t.media?.length ? { media: t.media } : {}),
      }));
    }
    return lines.join('\n') + (lines.length ? '\n' : '');
  }

  // ── Indexing ───────────────────────────────────────────────

  private indexTweet(t: XTweet): void {
    const norm = normalizeJapanese(t.text);
    this.normText.set(t.id, norm);
    for (const bg of bigrams(norm)) {
      let set = this.bigramIndex.get(bg);
      if (!set) {
        set = new Set();
        this.bigramIndex.set(bg, set);
      }
      set.add(t.id);
    }
  }

  // ── Search ─────────────────────────────────────────────────

  /**
   * Offline search over the corpus, ordered newest-first. Honours the same
   * fields as the live query: AND (allTerms), OR (anyTerms), exclude
   * (noneTerms), plus lang / from / min_faves / min_retweets / since / until.
   */
  search(q: XSearchQuery, limit = 100): XTweet[] {
    const candidates = this.candidateIds(q);
    const out: XTweet[] = [];
    for (const id of candidates) {
      const tweet = this.tweets.get(id);
      if (tweet && this.matches(tweet, q)) out.push(tweet);
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out.slice(0, limit);
  }

  /** Narrow to a candidate id set using the bigram index, else everything. */
  private candidateIds(q: XSearchQuery): Iterable<string> {
    // Use the longest required term (>=2 chars) as the selective probe.
    let probe = '';
    for (const t of q.allTerms) {
      const n = normTerm(t);
      if (n.length >= 2 && n.length > probe.length) probe = n;
    }
    if (!probe) return this.tweets.keys();

    const grams = bigrams(probe);
    if (grams.length === 0) return this.tweets.keys();

    // Intersect postings of each bigram (start from the rarest for speed).
    let working: Set<string> | null = null;
    const sorted = grams
      .map(g => this.bigramIndex.get(g) ?? new Set<string>())
      .sort((a, b) => a.size - b.size);
    for (const set of sorted) {
      if (set.size === 0) return []; // a bigram absent everywhere → no matches
      if (working === null) {
        working = new Set(set);
      } else {
        for (const id of working) if (!set.has(id)) working.delete(id);
      }
      if (working.size === 0) return [];
    }
    return working ?? this.tweets.keys();
  }

  /** Full predicate match for one tweet against a query. */
  private matches(t: XTweet, q: XSearchQuery): boolean {
    const text = this.normText.get(t.id) ?? normalizeJapanese(t.text);

    for (const term of q.allTerms) {
      if (!text.includes(normTerm(term))) return false;
    }
    if (q.anyTerms.length > 0) {
      const hit = q.anyTerms.some(term => text.includes(normTerm(term)));
      if (!hit) return false;
    }
    for (const term of q.noneTerms) {
      if (text.includes(normTerm(term))) return false;
    }

    if (q.lang && t.lang && t.lang !== q.lang) return false;
    if (q.fromUser && t.authorHandle.toLowerCase() !== q.fromUser.replace(/^@/, '').toLowerCase()) {
      return false;
    }
    if (q.minFaves > 0 && t.favoriteCount < q.minFaves) return false;
    if (q.minRetweets > 0 && t.retweetCount < q.minRetweets) return false;
    if (q.minReplies > 0 && t.replyCount < q.minReplies) return false;

    if (q.since) {
      const lower = Date.parse(q.since + 'T00:00:00Z');
      if (!Number.isNaN(lower) && t.createdAt < lower) return false;
    }
    if (q.until) {
      const upper = Date.parse(q.until + 'T00:00:00Z');
      if (!Number.isNaN(upper) && t.createdAt >= upper) return false;
    }
    return true;
  }

  // ── Saved-query provenance search ──────────────────────────

  /**
   * Tweets whose `matchedQueries` intersect `ids` in at least `minCount`
   * distinct ids — newest first. minCount=2 yields cross-query co-occurrence
   * (the bundle's ★ "multiple-phrase hit"). Empty `ids` matches any tagged id.
   */
  tweetsMatchingQueries(ids: string[], minCount = 1): XTweet[] {
    const want = new Set(ids);
    const out: XTweet[] = [];
    for (const t of this.tweets.values()) {
      const tags = t.matchedQueries ?? [];
      if (tags.length === 0) continue;
      const hit = want.size === 0
        ? new Set(tags).size
        : tags.filter(q => want.has(q)).length;
      if (hit >= minCount) out.push(t);
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }

  /** How many corpus tweets carry a given saved-query id. */
  countByQuery(id: string): number {
    let n = 0;
    for (const t of this.tweets.values()) {
      if (t.matchedQueries?.includes(id)) n++;
    }
    return n;
  }

  // ── Stats / access ─────────────────────────────────────────

  size(): number {
    return this.tweets.size;
  }

  get(id: string): XTweet | undefined {
    return this.tweets.get(id);
  }

  getAll(): XTweet[] {
    return [...this.tweets.values()];
  }

  /** Oldest / newest capture span and tweet-date span, for the home screen. */
  stats(): { count: number; oldest: number | null; newest: number | null } {
    let oldest: number | null = null;
    let newest: number | null = null;
    for (const t of this.tweets.values()) {
      if (oldest === null || t.createdAt < oldest) oldest = t.createdAt;
      if (newest === null || t.createdAt > newest) newest = t.createdAt;
    }
    return { count: this.tweets.size, oldest, newest };
  }
}

/** All adjacent character bigrams of a string (length-2 windows). */
function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}
