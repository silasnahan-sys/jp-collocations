import type { App } from "obsidian";
import { requestUrl } from "obsidian";
import type { CollocationEntry } from "../types.ts";
import { PartOfSpeech, CollocationSource } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";
import { parseHyogenProfile, collocateOf, type HyogenProfile } from "./hyogen-parse.ts";

interface ScraperOptions {
  rateLimit: number; // ms between requests
  onProgress?: (msg: string) => void;
  onEntry?: (entry: CollocationEntry) => void;
}

export class HyogenScraper {
  private app: App;
  private store: CollocationStore;
  private options: ScraperOptions;
  private queue: string[] = [];
  private running = false;
  private aborted = false;

  constructor(app: App, store: CollocationStore, options: ScraperOptions) {
    this.app = app;
    this.store = store;
    this.options = { ...{ rateLimit: 2000 }, ...options };
  }

  enqueue(words: string[]): void {
    for (const w of words) {
      if (!this.queue.includes(w)) this.queue.push(w);
    }
  }

  abort(): void {
    this.aborted = true;
    this.running = false;
  }

  async run(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    this.aborted = false;
    let count = 0;

    while (this.queue.length > 0 && !this.aborted) {
      const word = this.queue.shift()!;
      this.options.onProgress?.(`Fetching: ${word}`);
      try {
        const entries = await this.fetchWord(word);
        for (const e of entries) {
          this.store.add(e);
          this.options.onEntry?.(e);
          count++;
        }
      } catch (err) {
        this.options.onProgress?.(`Error fetching ${word}: ${err}`);
      }
      if (this.queue.length > 0 && !this.aborted) {
        await this.delay(this.options.rateLimit);
      }
    }

    this.running = false;
    return count;
  }

  /** Per-section cap for the LEGACY entry adapter. One Hyogen word carries
   *  22,558 items across its sections; the legacy store is a flat array behind
   *  a per-keystroke Levenshtein search (AUDIT §3), so bulk import is not what
   *  this adapter is for. `profile()` is (§22.7). */
  static readonly MAX_PER_SECTION = 40;

  /** §22.7: on-demand profile for ONE word — returns parsed entries WITHOUT
   *  touching the legacy store. The corpus serves the catalog. */
  async profileWord(word: string): Promise<CollocationEntry[]> {
    return this.fetchWord(word);
  }

  /**
   * §22.7 — the STRUCTURED profile: how this word attaches, and what attaches
   * that way, with the source's own totals.
   *
   * `profileWord` flattens to `CollocationEntry[]` and loses direction, sense,
   * POS section and the particle facets — i.e. the entire grammatical half of a
   * collocational profile. This returns the shape the 語法 block renders.
   */
  async profile(word: string): Promise<HyogenProfile> {
    const url = HyogenScraper.pageFor(word);
    const response = await requestUrl({ url, method: "GET", throw: false });
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    return parseHyogenProfile(response.text, word);
  }

  /** The Hyogen page for one word — where a listed phrase stays checkable, and
   *  where the profile's truncations remain reachable (cf. `TWC.pageFor`). */
  static pageFor(word: string): string {
    return `https://collocation.hyogen.info/word/${encodeURIComponent(word)}`;
  }

  private async fetchWord(word: string): Promise<CollocationEntry[]> {
    const url = HyogenScraper.pageFor(word);
    const response = await requestUrl({ url, method: "GET" });
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }
    return this.parseHtml(response.text, word);
  }

  /**
   * Adapt the structured profile to the legacy `CollocationEntry` shape.
   *
   * Rewritten 2026-08-02 (AUDIT §1). The old body scanned `<tr>/<td>`; the
   * page has no data table at all, so it returned the あかさたな kana nav bar
   * as 10 entries, labelled them all 動詞 because a layout row contained that
   * substring, and threw nothing. See `hyogen-parse.ts` for the real shape.
   *
   * Two model bugs fixed with it:
   *  - `fullPhrase` is the item VERBATIM (Hyogen items already contain the
   *    headword), and `collocate` is derived by removing it — the old code
   *    concatenated and produced 風風が吹く.
   *  - `pattern` carries the DIRECTION (風～ / ～風 / 複合), which is a real
   *    collocational fact the old model had nowhere to put.
   *
   * Capped per section: one word yields 22,558 items and the legacy store is a
   * flat array behind a Levenshtein search box (AUDIT §3). Bulk import is not
   * what this adapter is for — `profile()` is (§22.7).
   */
  private parseHtml(html: string, headword: string): CollocationEntry[] {
    const profile = parseHyogenProfile(html, headword);
    const now = Date.now();
    const readingMatch = html.match(/読み[：:\s]*<[^>]*>([ぁ-ん]+)<\/[^>]*>/i);
    const headwordReading = readingMatch ? readingMatch[1] : "";
    const POS_BY_LABEL: Record<string, PartOfSpeech> = {
      名詞: PartOfSpeech.Noun, 動詞: PartOfSpeech.Verb,
      い形容詞: PartOfSpeech.Adjective_i, な形容詞: PartOfSpeech.Adjective_na,
      副詞: PartOfSpeech.Adverb,
    };
    const entries: CollocationEntry[] = [];
    for (const sec of profile.sections) {
      const pos = POS_BY_LABEL[sec.pos] ?? PartOfSpeech.Noun;
      const arrow = sec.direction === "head-final" ? `～${headword}`
        : sec.direction === "compound" ? `${headword}複合` : `${headword}～`;
      for (const item of sec.items.slice(0, HyogenScraper.MAX_PER_SECTION)) {
        const collocate = collocateOf(item, headword, sec.direction);
        if (!collocate) continue;
        entries.push({
          id: this.store.generateId(),
          headword,
          headwordReading,
          collocate,
          fullPhrase: item,
          headwordPOS: pos,
          collocatePOS: pos,
          pattern: arrow,
          exampleSentences: [],
          source: CollocationSource.Hyogen,
          tags: sec.sense !== undefined ? [`hyogen/sense${sec.sense}`] : [],
          notes: sec.label,
          frequency: 50,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return entries;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isRunning(): boolean {
    return this.running;
  }

  queueLength(): number {
    return this.queue.length;
  }
}
