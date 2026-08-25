/**
 * Bridge between the tategaki reader and the jp-collocations lexicon.
 *
 * Everything here is duck-typed against the host plugin. The other agents are
 * still moving `CollocationStore` / `SearchEngine` around, so this module only
 * ever asks "does this object have the method I need?" and degrades to a plain
 * reader when it does not. Nothing in `src/tategaki/` imports the store types
 * directly, which is what keeps the module drop-in.
 */

/** The subset of `CollocationEntry` the reader actually displays. */
export interface LexEntry {
  id?: string;
  headword?: string;
  headwordReading?: string;
  collocate?: string;
  fullPhrase?: string;
  headwordPOS?: string;
  collocatePOS?: string;
  pattern?: string;
  exampleSentences?: string[];
  tags?: string[];
  notes?: string;
  frequency?: number;
}

interface StoreLike {
  getAll?: () => LexEntry[];
  getByHeadword?: (headword: string) => LexEntry[];
  size?: () => number;
}

interface EngineLike {
  quickSearch?: (query: string, maxResults?: number) => Array<{ entry: LexEntry; score: number }>;
  search?: (options: { query: string; maxResults?: number }) => Array<{ entry: LexEntry; score: number }>;
}

/** Whatever object holds the lexicon — normally the plugin instance. */
export interface LexiconHost {
  store?: StoreLike;
  engine?: EngineLike;
}

/** One occurrence of a lexicon phrase inside a run of text. */
export interface PhraseHit {
  start: number;
  end: number;
  phrase: string;
  entryIds: string[];
}

const KANA_RE = /[ぁ-ゟ゠-ヿー]/;
const SENTENCE_BREAK_RE = /[。、．，！？!?「」『』（）()\s]/;

/**
 * Longest-match scanner over the lexicon phrases.
 *
 * Bucketed by first character, so a scan is O(text length × bucket size) rather
 * than O(text length × lexicon size) — fast enough to run on every render on a
 * phone with a few thousand entries.
 */
export class PhraseMatcher {
  private buckets = new Map<string, Array<{ phrase: string; ids: string[]; conjugable: boolean }>>();
  private phraseCount = 0;

  /** Register a phrase. Trailing-kana phrases also match conjugated forms. */
  add(phrase: string, entryId: string | undefined, minLength = 2): void {
    const clean = phrase?.trim();
    if (!clean || clean.length < minLength) return;

    const head = clean[0];
    const bucket = this.buckets.get(head) ?? [];
    const existing = bucket.find(b => b.phrase === clean);
    if (existing) {
      if (entryId && !existing.ids.includes(entryId)) existing.ids.push(entryId);
      return;
    }

    // 風が吹く also occurs as 風が吹いた / 風が吹きました, so a phrase ending in
    // kana is matched by its stem plus a following kana tail.
    const conjugable = clean.length >= 3 && KANA_RE.test(clean[clean.length - 1]);
    bucket.push({ phrase: clean, ids: entryId ? [entryId] : [], conjugable });
    bucket.sort((a, b) => b.phrase.length - a.phrase.length);
    this.buckets.set(head, bucket);
    this.phraseCount++;
  }

  size(): number {
    return this.phraseCount;
  }

  isEmpty(): boolean {
    return this.phraseCount === 0;
  }

  /** Non-overlapping, longest-first matches over `text`. */
  match(text: string): PhraseHit[] {
    if (this.phraseCount === 0 || !text) return [];
    const hits: PhraseHit[] = [];
    let i = 0;

    while (i < text.length) {
      const bucket = this.buckets.get(text[i]);
      if (!bucket) { i++; continue; }

      let matched: PhraseHit | null = null;
      for (const candidate of bucket) {
        const { phrase, conjugable } = candidate;
        if (text.startsWith(phrase, i)) {
          matched = { start: i, end: i + phrase.length, phrase, entryIds: candidate.ids };
          break;
        }
        if (conjugable) {
          const stem = phrase.slice(0, -1);
          if (stem.length >= 2 && text.startsWith(stem, i)) {
            const end = this.extendOverInflection(text, i + stem.length);
            if (end > i + stem.length) {
              matched = { start: i, end, phrase, entryIds: candidate.ids };
              break;
            }
          }
        }
      }

      if (matched) {
        hits.push(matched);
        i = matched.end;
      } else {
        i++;
      }
    }

    return hits;
  }

  /** Consume the kana tail of a conjugated form (吹い-た, 吹き-ました, …). */
  private extendOverInflection(text: string, from: number): number {
    let end = from;
    const limit = Math.min(text.length, from + 5);
    while (end < limit) {
      const ch = text[end];
      if (!KANA_RE.test(ch) || SENTENCE_BREAK_RE.test(ch)) break;
      end++;
    }
    return end;
  }
}

export interface BridgeOptions {
  /** Cap on entries pulled into the matcher, to keep highlighting cheap. */
  maxEntries?: number;
  /** Minimum phrase length worth highlighting. */
  minPhraseLength?: number;
}

/**
 * Read-only façade over the lexicon.
 *
 * Construct it with a getter rather than the host itself so the reader keeps
 * working if the plugin swaps its store out at runtime (import, re-seed, …).
 */
export class CollocationBridge {
  private getHost: () => LexiconHost | null;
  private matcherCache: PhraseMatcher | null = null;
  private matcherStamp = "";
  private expandForms: ((phrase: string) => string[]) | null = null;

  constructor(getHost: () => LexiconHost | null) {
    this.getHost = getHost;
  }

  /** True when a lexicon is reachable — the UI hides lookup affordances otherwise. */
  isAvailable(): boolean {
    const host = this.getHost();
    return Boolean(host?.store?.getAll || host?.engine?.quickSearch || host?.engine?.search);
  }

  /**
   * Optional hook for `src/utils/grammar.ts`: pass a function that expands a
   * phrase into its conjugated forms and the matcher will use it instead of the
   * built-in kana-tail heuristic. Left unset, the heuristic applies.
   */
  setFormExpander(expander: ((phrase: string) => string[]) | null): void {
    this.expandForms = expander;
    this.invalidate();
  }

  /** Drop the cached matcher — call after the lexicon changes. */
  invalidate(): void {
    this.matcherCache = null;
    this.matcherStamp = "";
  }

  private entries(): LexEntry[] {
    const store = this.getHost()?.store;
    try {
      return store?.getAll?.() ?? [];
    } catch {
      return [];
    }
  }

  /** Build (or reuse) the phrase matcher for the current lexicon contents. */
  getMatcher(options: BridgeOptions = {}): PhraseMatcher {
    const maxEntries = options.maxEntries ?? 4000;
    const minLength = options.minPhraseLength ?? 2;
    const entries = this.entries();
    const stamp = `${entries.length}:${maxEntries}:${minLength}:${this.expandForms ? "x" : "-"}`;

    if (this.matcherCache && this.matcherStamp === stamp) return this.matcherCache;

    const matcher = new PhraseMatcher();
    const capped = entries.length > maxEntries ? entries.slice(0, maxEntries) : entries;

    for (const entry of capped) {
      const phrase = entry.fullPhrase || `${entry.headword ?? ""}${entry.collocate ?? ""}`;
      matcher.add(phrase, entry.id, minLength);
      if (this.expandForms) {
        for (const form of this.expandForms(phrase)) matcher.add(form, entry.id, minLength);
      }
    }

    this.matcherCache = matcher;
    this.matcherStamp = stamp;
    return matcher;
  }

  /** Resolve entry ids recorded on a highlight back to entries. */
  entriesByIds(ids: string[]): LexEntry[] {
    if (ids.length === 0) return [];
    const wanted = new Set(ids);
    return this.entries().filter(entry => entry.id && wanted.has(entry.id));
  }

  /**
   * Look a tapped string up. Tries, in order: exact headword, the search
   * engine, then a substring sweep of the lexicon.
   */
  lookup(term: string, maxResults = 12): LexEntry[] {
    const query = term.trim();
    if (!query) return [];
    const host = this.getHost();
    const results: LexEntry[] = [];
    const seen = new Set<string>();

    const push = (entry: LexEntry | undefined): void => {
      if (!entry) return;
      const key = entry.id ?? entry.fullPhrase ?? "";
      if (!key || seen.has(key)) return;
      seen.add(key);
      results.push(entry);
    };

    try {
      for (const entry of host?.store?.getByHeadword?.(query) ?? []) push(entry);
    } catch { /* store shape changed — fall through to the engine */ }

    if (results.length < maxResults) {
      try {
        const engine = host?.engine;
        const found = engine?.quickSearch
          ? engine.quickSearch(query, maxResults)
          : engine?.search?.({ query, maxResults }) ?? [];
        for (const result of found) push(result?.entry);
      } catch { /* engine shape changed — fall through to the sweep */ }
    }

    if (results.length === 0) {
      for (const entry of this.entries()) {
        const phrase = entry.fullPhrase ?? "";
        if (phrase.includes(query) || (entry.headword ?? "").includes(query)) {
          push(entry);
          if (results.length >= maxResults) break;
        }
      }
    }

    return results.slice(0, maxResults);
  }

  /** Longest lexicon phrase starting at `text[0]` — used for tap-to-lookup. */
  longestPhraseAt(text: string, options: BridgeOptions = {}): PhraseHit | null {
    const matcher = this.getMatcher(options);
    const hits = matcher.match(text.slice(0, 24));
    const first = hits[0];
    return first && first.start === 0 ? first : null;
  }

  /** Total lexicon size, for the empty-state copy. */
  size(): number {
    const store = this.getHost()?.store;
    try {
      return store?.size?.() ?? store?.getAll?.().length ?? 0;
    } catch {
      return 0;
    }
  }
}

/** Best-effort display phrase for an entry. */
export function entryPhrase(entry: LexEntry): string {
  return entry.fullPhrase || `${entry.headword ?? ""}${entry.collocate ?? ""}` || entry.headword || "";
}
