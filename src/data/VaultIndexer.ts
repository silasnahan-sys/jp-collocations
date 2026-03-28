import type { App, TFile } from "obsidian";
import type { CollocationEntry, PluginSettings } from "../types.ts";
import { PartOfSpeech, CollocationSource } from "../types.ts";
import type { CollocationStore } from "./CollocationStore.ts";
import { TextClassifier } from "../classifier/TextClassifier.ts";

/** Noise patterns to strip before sentence splitting. */
const STRIP_PATTERNS: RegExp[] = [
  /^---[\s\S]*?---\n/m,          // frontmatter
  /\[\[.*?\]\]/g,                 // wiki links
  /\[.*?\]\(.*?\)/g,              // markdown links
  /!\[.*?\]\(.*?\)/g,             // images
  /```[\s\S]*?```/g,              // code blocks
  /`[^`]+`/g,                     // inline code
  /#+\s/g,                        // headings prefix
  /\*\*([^*]+)\*\*/g,             // bold → text
  /_([^_]+)_/g,                   // italic → text
  /\d{1,2}:\d{2}(:\d{2})?/g,     // timestamps HH:MM or HH:MM:SS
  /https?:\/\/\S+/g,              // URLs
  /[^\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Latin}\s。、！？…・]/gu,
];

/** Japanese sentence boundary regex. */
const SENTENCE_BOUNDARY = /([。！？…]+|[\n]{2,})/;

/** Min/max sentence length in characters for indexing. */
const MIN_SENTENCE_LEN = 5;
const MAX_SENTENCE_LEN = 200;

export interface IndexProgress {
  word: string;
  wordIndex: number;
  totalWords: number;
  sentencesFound: number;
}

export interface IndexResult {
  entriesAdded: number;
  filesScanned: number;
  wordsProcessed: number;
}

export class VaultIndexer {
  private app: App;
  private store: CollocationStore;
  private classifier: TextClassifier;
  private settings: PluginSettings;
  private aborted = false;

  constructor(app: App, store: CollocationStore, settings: PluginSettings) {
    this.app = app;
    this.store = store;
    this.settings = settings;
    this.classifier = new TextClassifier();
  }

  abort(): void {
    this.aborted = true;
  }

  async indexVault(
    words: string[],
    onProgress?: (p: IndexProgress) => void
  ): Promise<IndexResult> {
    this.aborted = false;
    const result: IndexResult = { entriesAdded: 0, filesScanned: 0, wordsProcessed: 0 };

    const mdFiles = this.app.vault.getMarkdownFiles();
    result.filesScanned = mdFiles.length;

    // Build sentence corpus from all files
    const allSentences: Array<{ sentence: string; file: string; lineStart: number }> = [];
    for (const file of mdFiles) {
      if (this.aborted) break;
      const sentences = await this.extractSentences(file);
      for (const s of sentences) {
        allSentences.push({ ...s, file: file.path });
      }
    }

    for (let i = 0; i < words.length; i++) {
      if (this.aborted) break;
      const word = words[i];

      onProgress?.({
        word,
        wordIndex: i,
        totalWords: words.length,
        sentencesFound: result.entriesAdded,
      });

      // Skip if already indexed and setting enabled
      if (this.settings.vaultIndexSkipIndexed) {
        const existing = this.store.getByHeadword(word);
        if (existing.some(e => e.source === CollocationSource.Import)) {
          result.wordsProcessed++;
          continue;
        }
      }

      const matching = allSentences.filter(s => s.sentence.includes(word));
      const limited = matching.slice(0, this.settings.vaultIndexMaxSentencesPerWord);

      for (const { sentence, file, lineStart } of limited) {
        const entry = this.buildEntry(word, sentence, file, lineStart);
        if (entry) {
          this.store.add(entry);
          result.entriesAdded++;
        }
      }

      result.wordsProcessed++;
    }

    return result;
  }

  private async extractSentences(
    file: TFile
  ): Promise<Array<{ sentence: string; lineStart: number }>> {
    try {
      const raw = await this.app.vault.read(file);
      const cleaned = this.cleanText(raw);
      const lines = cleaned.split("\n");
      const sentences: Array<{ sentence: string; lineStart: number }> = [];

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx].trim();
        if (!line) continue;
        const parts = line.split(SENTENCE_BOUNDARY).filter(p => p && !/^[。！？…]+$/.test(p));
        for (const part of parts) {
          const s = part.trim();
          if (s.length >= MIN_SENTENCE_LEN && s.length <= MAX_SENTENCE_LEN) {
            sentences.push({ sentence: s, lineStart: lineIdx + 1 });
          }
        }
      }

      return sentences;
    } catch (e) {
      console.error("VaultIndexer: failed to read file:", file.path, e);
      return [];
    }
  }

  private cleanText(raw: string): string {
    let text = raw;
    for (const pattern of STRIP_PATTERNS) {
      text = text.replace(pattern, " ");
    }
    return text.replace(/\s+/g, " ").trim();
  }

  private buildEntry(
    word: string,
    sentence: string,
    file: string,
    lineStart: number
  ): CollocationEntry | null {
    try {
      const classifyResult = this.classifier.classify(sentence);

      // Extract a collocate — the token immediately following or preceding the headword
      const idx = sentence.indexOf(word);
      if (idx === -1) return null;

      const after = sentence.slice(idx + word.length, idx + word.length + 8).split(/[\s。、！？]/)[0];
      const before = sentence.slice(Math.max(0, idx - 8), idx).split(/[\s。、！？]/).pop() ?? "";
      const collocate = after.length >= 1 ? after : before;

      if (!collocate) return null;

      const fullPhrase = `${word}${after}`;
      const now = Date.now();

      const entry: CollocationEntry = {
        id: this.store.generateId(),
        headword: word,
        headwordReading: "",
        collocate,
        fullPhrase,
        headwordPOS: classifyResult.headwordPOS ?? PartOfSpeech.Noun,
        collocatePOS: PartOfSpeech.Other,
        pattern: classifyResult.pattern ?? "N+V",
        exampleSentences: [sentence],
        source: CollocationSource.Import,
        tags: classifyResult.tags ?? [],
        notes: `Auto-indexed from ${file}:${lineStart}`,
        frequency: 1,
        createdAt: now,
        updatedAt: now,
      };

      return entry;
    } catch (e) {
      console.error("VaultIndexer: failed to build entry for:", word, e);
      return null;
    }
  }
}
