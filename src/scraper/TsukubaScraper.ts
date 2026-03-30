import type { App, RequestUrlParam } from "obsidian";
import { requestUrl } from "obsidian";
import type { CollocationEntry } from "../types.ts";
import {
  CollocationSource,
  PartOfSpeech,
  Register,
  JLPTLevel,
  BoundaryType,
  CollocationStrength,
} from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";

export interface TsukabaScraperOptions {
  rateLimit: number;
  onProgress?: (msg: string) => void;
  onEntry?: (entry: CollocationEntry) => void;
}

export class TsukubaScraper {
  private app: App;
  private store: CollocationStore;
  private options: TsukabaScraperOptions;
  private queue: string[] = [];
  private running = false;
  private aborted = false;

  private static readonly BASE_URL = "https://tsukubawebcorpus.jp/search/";

  constructor(app: App, store: CollocationStore, options: TsukabaScraperOptions) {
    this.app = app;
    this.store = store;
    this.options = options;
  }

  enqueue(words: string[]): void {
    this.queue.push(...words);
  }

  isRunning(): boolean {
    return this.running;
  }

  abort(): void {
    this.aborted = true;
  }

  async run(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    this.aborted = false;
    let addedCount = 0;

    for (const word of this.queue) {
      if (this.aborted) break;
      try {
        this.options.onProgress?.(`Fetching Tsukuba corpus data for: ${word}`);
        const entries = await this.fetchWord(word);
        for (const entry of entries) {
          this.store.add(entry);
          this.options.onEntry?.(entry);
          addedCount++;
        }
        await this.delay(this.options.rateLimit);
      } catch (err) {
        this.options.onProgress?.(`Error fetching ${word}: ${String(err)}`);
      }
    }

    this.queue = [];
    this.running = false;
    return addedCount;
  }

  private async fetchWord(word: string): Promise<CollocationEntry[]> {
    const url = `${TsukubaScraper.BASE_URL}?word=${encodeURIComponent(word)}&pos=all&format=json`;
    const params: RequestUrlParam = {
      url,
      method: "GET",
      headers: {
        "User-Agent": "jp-collocations Obsidian Plugin (research use)",
        "Accept": "application/json, text/html",
      },
    };

    const response = await requestUrl(params);
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }

    try {
      const data = response.json as TsukubaApiResponse;
      return this.parseApiResponse(word, data);
    } catch {
      // Fall back to HTML parsing if API endpoint is not JSON
      return this.parseHtmlResponse(word, response.text);
    }
  }

  private parseApiResponse(word: string, data: TsukubaApiResponse): CollocationEntry[] {
    const entries: CollocationEntry[] = [];
    if (!data?.collocations) return entries;

    for (const item of data.collocations) {
      const entry = this.makeEntry(
        word,
        item.collocate ?? "",
        item.fullPhrase ?? `${word}${item.collocate ?? ""}`,
        item.pos ?? "名詞",
        item.collocatePos ?? "動詞",
        item.frequency ?? 0,
        item.miScore,
        item.tScore,
        item.examples ?? [],
      );
      entries.push(entry);
    }
    return entries;
  }

  private parseHtmlResponse(word: string, html: string): CollocationEntry[] {
    const entries: CollocationEntry[] = [];
    // Parse basic collocate tables from HTML
    // Look for table rows with collocation data
    const rowRe = /<tr[^>]*>.*?<\/tr>/gis;
    const cellRe = /<td[^>]*>(.*?)<\/td>/gi;
    const rows = html.match(rowRe) ?? [];

    for (const row of rows) {
      const cells: string[] = [];
      let m: RegExpExecArray | null;
      cellRe.lastIndex = 0;
      while ((m = cellRe.exec(row)) !== null) {
        cells.push(m[1].replace(/<[^>]+>/g, "").trim());
      }
      if (cells.length >= 2 && cells[0] && cells[1]) {
        const freq = parseInt(cells[2] ?? "0", 10) || 0;
        const entry = this.makeEntry(
          word,
          cells[1],
          `${word}${cells[1]}`,
          "名詞",
          "動詞",
          freq,
          undefined,
          undefined,
          [],
        );
        entries.push(entry);
      }
    }
    return entries;
  }

  private makeEntry(
    headword: string,
    collocate: string,
    fullPhrase: string,
    headwordPosStr: string,
    collocatePosStr: string,
    frequency: number,
    miScore: number | undefined,
    tScore: number | undefined,
    examples: string[],
  ): CollocationEntry {
    const now = Date.now();
    return {
      id: this.store.generateId(),
      headword,
      headwordReading: "",
      collocate,
      fullPhrase,
      headwordPOS: this.mapPOS(headwordPosStr),
      collocatePOS: this.mapPOS(collocatePosStr),
      pattern: this.inferPattern(headword, collocate, headwordPosStr, collocatePosStr),
      exampleSentences: examples,
      source: CollocationSource.Tsukuba,
      tags: [],
      notes: "",
      frequency,
      createdAt: now,
      updatedAt: now,
      miScore,
      tScore,
      register: Register.Written,
      boundaryType: BoundaryType.Phrase,
      strength: this.inferStrength(frequency, miScore),
      constituentTokens: [...headword.split(""), ...collocate.split("")].filter(c => c.trim()),
    };
  }

  private mapPOS(pos: string): PartOfSpeech {
    const map: Record<string, PartOfSpeech> = {
      "名詞": PartOfSpeech.Noun,
      "動詞": PartOfSpeech.Verb,
      "形容詞": PartOfSpeech.Adjective_i,
      "い形容詞": PartOfSpeech.Adjective_i,
      "な形容詞": PartOfSpeech.Adjective_na,
      "副詞": PartOfSpeech.Adverb,
      "助詞": PartOfSpeech.Particle,
      "接続詞": PartOfSpeech.Conjunction,
      "noun": PartOfSpeech.Noun,
      "verb": PartOfSpeech.Verb,
      "adjective": PartOfSpeech.Adjective_i,
      "adverb": PartOfSpeech.Adverb,
    };
    return map[pos] ?? PartOfSpeech.Other;
  }

  private inferPattern(hw: string, col: string, hwPos: string, colPos: string): string {
    const h = hwPos.includes("名") ? "N" : hwPos.includes("動") ? "V" : hwPos.includes("形") ? "A" : "X";
    const c = colPos.includes("動") ? "V" : colPos.includes("名") ? "N" : colPos.includes("形") ? "A" : "X";
    // Detect particle in collocate
    const particleMatch = col.match(/^[をがにのでもはへ]/);
    if (particleMatch) {
      return `${h}+${particleMatch[0]}+${c}`;
    }
    return `${h}+${c}`;
  }

  private inferStrength(freq: number, miScore?: number): CollocationStrength {
    if (miScore !== undefined) {
      if (miScore >= 8) return CollocationStrength.Fixed;
      if (miScore >= 5) return CollocationStrength.Strong;
      if (miScore >= 3) return CollocationStrength.Moderate;
      return CollocationStrength.Weak;
    }
    if (freq >= 1000) return CollocationStrength.Strong;
    if (freq >= 100) return CollocationStrength.Moderate;
    return CollocationStrength.Weak;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

interface TsukubaApiResponse {
  collocations?: Array<{
    collocate?: string;
    fullPhrase?: string;
    pos?: string;
    collocatePos?: string;
    frequency?: number;
    miScore?: number;
    tScore?: number;
    examples?: string[];
  }>;
}
