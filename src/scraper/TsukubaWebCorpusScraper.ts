/**
 * TsukubaWebCorpusScraper.ts — Tsukuba Web Corpus (TWC) integration
 *
 * NINJAL-LWP for TWC: 1.1 billion words of Japanese web text
 * Provides lexical profiling — co-occurrence relations and grammatical
 * behavior of content words (nouns, verbs, adjectives).
 *
 * This scraper:
 *   1. Fetches collocation profiles for headwords from TWC
 *   2. Parses grammatical patterns (格パターン, 共起名詞, 共起動詞, etc.)
 *   3. Extracts frequency data and example sentences
 *   4. Feeds results into the CollocationStore + discourse engine
 *
 * Usage is limited to research/education per TWC terms of use.
 * All requests are user-initiated with rate limiting.
 *
 * Reference: 筑波大学 留学生センター / 国立国語研究所 / Lago言語研究所
 */

import type { App } from 'obsidian';
import { requestUrl } from 'obsidian';
import type { CollocationEntry } from '../types.ts';
import { PartOfSpeech, CollocationSource } from '../types.ts';
import type { CollocationStore } from '../data/CollocationStore.ts';

// ── Types ────────────────────────────────────────────────────

export interface TWCCollocationResult {
  /** The searched headword */
  headword: string;
  /** Grammatical pattern (e.g. 「Nが〜」「Nを〜」) */
  pattern: string;
  /** The collocate word */
  collocate: string;
  /** POS of the collocate */
  collocatePOS: string;
  /** MI score (mutual information) from TWC */
  miScore: number;
  /** Raw frequency in TWC */
  frequency: number;
  /** Example sentences */
  examples: string[];
}

export interface TWCWordProfile {
  /** Searched headword */
  headword: string;
  /** Reading (if extracted) */
  reading: string;
  /** Part of speech of headword */
  headwordPOS: string;
  /** Total frequency in TWC corpus */
  totalFrequency: number;
  /** Collocation results grouped by pattern */
  collocations: TWCCollocationResult[];
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

// ── Scraper Class ────────────────────────────────────────────

export class TsukubaWebCorpusScraper {
  private app: App;
  private store: CollocationStore;
  private options: TWCScraperOptions;
  private queue: string[] = [];
  private running = false;
  private aborted = false;
  private sessionCookie = '';

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

    // Accept terms first
    await this.acceptTerms();

    while (this.queue.length > 0 && !this.aborted) {
      const word = this.queue.shift()!;
      this.options.onProgress?.(`TWC: fetching profile for「${word}」...`);

      try {
        const profile = await this.fetchWordProfile(word);
        if (profile) {
          const entries = this.profileToEntries(profile);
          for (const entry of entries) {
            this.store.add(entry);
            this.options.onEntry?.(entry);
            count++;
          }
          this.options.onProgress?.(
            `TWC: ${word} → ${entries.length} collocations extracted`
          );
        }
      } catch (err) {
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
    await this.acceptTerms();
    const profile = await this.fetchWordProfile(word);
    return profile ? this.profileToEntries(profile) : [];
  }

  // ── Terms acceptance ─────────────────────────────────────

  private async acceptTerms(): Promise<void> {
    try {
      const resp = await requestUrl({
        url: 'https://tsukubawebcorpus.jp/search/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'accept=true',
      });
      // Extract session cookie from response
      const setCookie = resp.headers?.['set-cookie'];
      if (setCookie) {
        this.sessionCookie = typeof setCookie === 'string'
          ? setCookie.split(';')[0]
          : '';
      }
    } catch {
      // Terms page may not need explicit acceptance via API
    }
  }

  // ── Fetch word profile ───────────────────────────────────

  private async fetchWordProfile(word: string): Promise<TWCWordProfile | null> {
    const encoded = encodeURIComponent(word);
    const url = `https://tsukubawebcorpus.jp/search/?q=${encoded}&options=exact`;

    const headers: Record<string, string> = {
      'Accept': 'text/html',
      'Accept-Language': 'ja',
    };
    if (this.sessionCookie) {
      headers['Cookie'] = this.sessionCookie;
    }

    const response = await requestUrl({ url, method: 'GET', headers });

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }

    return this.parseProfilePage(response.text, word);
  }

  // ── HTML parsing ─────────────────────────────────────────

  private parseProfilePage(html: string, headword: string): TWCWordProfile | null {
    const collocations: TWCCollocationResult[] = [];

    // Extract reading if available
    const readingMatch = html.match(/reading['"]*\s*[:=]\s*['"]?([ぁ-んァ-ヶー]+)/);
    const reading = readingMatch?.[1] ?? '';

    // Extract POS
    const posMatch = html.match(/品詞\s*[:：]\s*([^\s<]+)/);
    const headwordPOS = posMatch?.[1] ?? '名詞';

    // Extract total frequency
    const freqMatch = html.match(/(?:頻度|freq(?:uency)?)\s*[:：=]\s*([\d,]+)/i);
    const totalFrequency = freqMatch ? parseInt(freqMatch[1].replace(/,/g, ''), 10) : 0;

    // Parse collocation tables
    // TWC/NINJAL-LWP presents data in sections:
    //   名詞+格助詞パターン, 共起動詞, 共起名詞, 共起形容詞

    const sectionPatterns: Array<{ label: RegExp; patternType: string; pos: string }> = [
      { label: /(?:格パターン|particle\s*pattern)/i, patternType: 'N+格助詞', pos: '動詞' },
      { label: /(?:共起動詞|co-occurring\s*verb)/i, patternType: 'N+V', pos: '動詞' },
      { label: /(?:共起名詞|co-occurring\s*noun)/i, patternType: 'N+N', pos: '名詞' },
      { label: /(?:共起形容詞|co-occurring\s*adj)/i, patternType: 'N+Adj', pos: '形容詞' },
      { label: /(?:共起副詞|co-occurring\s*adv)/i, patternType: 'N+Adv', pos: '副詞' },
      { label: /(?:を〜する|をVする)/i, patternType: 'Nを〜', pos: '動詞' },
      { label: /(?:が〜する|がVする)/i, patternType: 'Nが〜', pos: '動詞' },
      { label: /(?:に〜する|にVする)/i, patternType: 'Nに〜', pos: '動詞' },
      { label: /(?:サ変動詞|サ変)/i, patternType: 'N+する', pos: '動詞' },
    ];

    // Extract table rows — TWC uses structured tables for collocation data
    const tablePattern = /<table[^>]*class="[^"]*(?:result|colloc|profile)[^"]*"[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch: RegExpExecArray | null;

    while ((tableMatch = tablePattern.exec(html)) !== null) {
      const tableContent = tableMatch[1];

      // Determine section type from surrounding context
      const contextStart = Math.max(0, tableMatch.index - 200);
      const context = html.slice(contextStart, tableMatch.index);

      let patternType = 'N+X';
      let collocatePOS = '名詞';

      for (const sp of sectionPatterns) {
        if (sp.label.test(context) || sp.label.test(tableContent)) {
          patternType = sp.patternType;
          collocatePOS = sp.pos;
          break;
        }
      }

      // Parse rows
      const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch: RegExpExecArray | null;
      let rowCount = 0;

      while ((rowMatch = rowPattern.exec(tableContent)) !== null) {
        if (rowCount >= this.options.maxPerPattern) break;

        const cells = this.extractCells(rowMatch[1]);
        if (cells.length < 2) continue;

        // First cell is typically the collocate word, second may be MI or freq
        const collocate = cells[0];
        if (!collocate || collocate.length < 1 || /^[\d,.]+$/.test(collocate)) continue;

        const miScore = cells.length >= 3 ? this.parseNumber(cells[1]) : 0;
        const frequency = cells.length >= 3 ? this.parseNumber(cells[2]) : this.parseNumber(cells[1]);

        // Look for example sentences in expandable sections
        const examples: string[] = [];
        const exPattern = /<(?:div|span|td)[^>]*class="[^"]*example[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|td)>/gi;
        let exMatch: RegExpExecArray | null;
        while ((exMatch = exPattern.exec(rowMatch[1])) !== null && examples.length < 3) {
          const cleaned = this.stripTags(exMatch[1]).trim();
          if (cleaned.length > 5) examples.push(cleaned);
        }

        collocations.push({
          headword,
          pattern: patternType,
          collocate,
          collocatePOS,
          miScore,
          frequency,
          examples,
        });

        rowCount++;
      }
    }

    // Fallback: parse any list-based collocation display
    if (collocations.length === 0) {
      const listPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let listMatch: RegExpExecArray | null;

      while ((listMatch = listPattern.exec(html)) !== null && collocations.length < 50) {
        const text = this.stripTags(listMatch[1]).trim();
        // Pattern: "collocate (freq)" or "collocate    MI    freq"
        const parts = text.split(/\s{2,}|\t/);
        if (parts.length >= 1 && parts[0].length > 0) {
          const collocate = parts[0].replace(/[\d(),]+$/, '').trim();
          if (collocate.length < 1) continue;

          collocations.push({
            headword,
            pattern: 'N+X',
            collocate,
            collocatePOS: '名詞',
            miScore: parts.length >= 2 ? this.parseNumber(parts[1]) : 0,
            frequency: parts.length >= 3 ? this.parseNumber(parts[2]) : 0,
            examples: [],
          });
        }
      }
    }

    if (collocations.length === 0) return null;

    return {
      headword,
      reading,
      headwordPOS,
      totalFrequency,
      collocations,
    };
  }

  // ── Convert profile to store entries ─────────────────────

  private profileToEntries(profile: TWCWordProfile): CollocationEntry[] {
    const entries: CollocationEntry[] = [];
    const now = Date.now();

    for (const coll of profile.collocations) {
      const id = this.store.generateId();
      entries.push({
        id,
        headword: profile.headword,
        headwordReading: profile.reading,
        collocate: coll.collocate,
        fullPhrase: `${profile.headword}${coll.collocate}`,
        headwordPOS: this.mapPOS(profile.headwordPOS),
        collocatePOS: this.mapPOS(coll.collocatePOS),
        pattern: coll.pattern,
        exampleSentences: coll.examples,
        source: CollocationSource.Import, // TWC-sourced
        tags: ['twc', `twc-pattern:${coll.pattern}`],
        notes: coll.miScore > 0 ? `MI=${coll.miScore.toFixed(2)} freq=${coll.frequency}` : '',
        frequency: Math.min(100, Math.max(1, Math.round(coll.miScore * 10))),
        createdAt: now,
        updatedAt: now,
      });
    }

    return entries;
  }

  // ── Helpers ──────────────────────────────────────────────

  private extractCells(rowHtml: string): string[] {
    const cells: string[] = [];
    const cellPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let match: RegExpExecArray | null;
    while ((match = cellPattern.exec(rowHtml)) !== null) {
      cells.push(this.stripTags(match[1]).trim());
    }
    return cells;
  }

  private stripTags(html: string): string {
    let text = html;
    let prev = '';
    while (prev !== text) {
      prev = text;
      text = text.replace(/<[^>]*>/g, '');
    }
    return text
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .trim();
  }

  private parseNumber(str: string): number {
    const cleaned = str.replace(/[,\s]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  private mapPOS(pos: string): PartOfSpeech {
    const map: Record<string, PartOfSpeech> = {
      '名詞': PartOfSpeech.Noun,
      '動詞': PartOfSpeech.Verb,
      'い形容詞': PartOfSpeech.Adjective_i,
      'イ形容詞': PartOfSpeech.Adjective_i,
      'な形容詞': PartOfSpeech.Adjective_na,
      'ナ形容詞': PartOfSpeech.Adjective_na,
      '形容詞': PartOfSpeech.Adjective_i,
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
