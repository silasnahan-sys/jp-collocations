import type { App } from "obsidian";
import { requestUrl } from "obsidian";
import type { CollocationEntry } from "../types.ts";
import { PartOfSpeech, CollocationSource } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";

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

  private async fetchWord(word: string): Promise<CollocationEntry[]> {
    const url = `https://collocation.hyogen.info/word/${encodeURIComponent(word)}`;
    const response = await requestUrl({ url, method: "GET" });
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }
    return this.parseHtml(response.text, word);
  }

  private parseHtml(html: string, headword: string): CollocationEntry[] {
    const entries: CollocationEntry[] = [];
    const now = Date.now();

    // Parse collocate blocks from the page
    // The hyogen.info site uses a structure with collocation rows
    // We extract using regex patterns on the raw HTML

    // Extract reading from 読み仮名 or ruby annotations
    const readingMatch = html.match(/読み[：:\s]*<[^>]*>([ぁ-ん]+)<\/[^>]*>/i)
      ?? html.match(/reading['"]\s*[：:]\s*['"]?([ぁ-ん]+)/i);
    const headwordReading = readingMatch ? readingMatch[1] : "";

    // Extract collocation tables — each POS section has rows
    // Pattern: look for <td> or <li> elements containing collocate + example
    const rowPattern = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    const rows = html.match(rowPattern) ?? [];

    let currentPOS: PartOfSpeech = PartOfSpeech.Noun;

    // Detect POS section headers
    const posHeaders: [string, PartOfSpeech][] = [
      ["名詞", PartOfSpeech.Noun],
      ["動詞", PartOfSpeech.Verb],
      ["い形容詞", PartOfSpeech.Adjective_i],
      ["な形容詞", PartOfSpeech.Adjective_na],
      ["副詞", PartOfSpeech.Adverb],
    ];

    for (const row of rows) {
      // Check for POS header in row
      for (const [label, pos] of posHeaders) {
        if (row.includes(label)) {
          currentPOS = pos;
          break;
        }
      }

      // Extract text content from td cells
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) ?? [];
      if (cells.length < 2) continue;

      const stripTags = (cell: string | undefined): string => {
        if (!cell) return "";
        // Strip HTML tags iteratively until stable to prevent partial-tag injection
        let text = cell;
        let prev = "";
        while (prev !== text) {
          prev = text;
          text = text.replace(/<[^>]*>/g, "");
        }
        return text.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
      };

      const collocate = stripTags(cells[0]);
      const example = stripTags(cells[1]);

      if (!collocate || collocate.length < 1) continue;

      const id = this.store.generateId();
      const entry: CollocationEntry = {
        id,
        headword,
        headwordReading,
        collocate,
        fullPhrase: headword + collocate,
        headwordPOS: PartOfSpeech.Noun,
        collocatePOS: currentPOS,
        pattern: `N+${collocate.charAt(0)}+${currentPOS === PartOfSpeech.Verb ? "V" : "Adj"}`,
        exampleSentences: example ? [example] : [],
        source: CollocationSource.Hyogen,
        tags: [],
        notes: "",
        frequency: 50,
        createdAt: now,
        updatedAt: now,
      };
      entries.push(entry);
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
