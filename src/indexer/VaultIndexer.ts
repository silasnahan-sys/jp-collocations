import type { App, TFile } from "obsidian";
import type {
  CollocationEntry,
  VaultIndexOptions,
  VaultIndexResult,
  VaultMatchContext,
} from "../types.ts";
import { CollocationSource, PartOfSpeech } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";
import { TextClassifier } from "../classifier/TextClassifier.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Regex patterns that constitute "noise" (timestamps, transcript markers, etc.) */
const NOISE_PATTERNS: RegExp[] = [
  /\[\d{1,2}:\d{2}(?::\d{2})?\]/g,          // [00:00] [1:23:45]
  /\(\d{1,2}:\d{2}(?::\d{2})?\)/g,           // (00:00)
  /→\s*\d{1,2}:\d{2}(?::\d{2})?/g,           // → 1:23
  /^#+\s.*/gm,                               // Markdown headings
  /^\s*[-*]\s+/gm,                           // Markdown list bullets
  /\[\[([^\]]+)\]\]/g,                       // [[wikilink]] → keep inner text
  /\[([^\]]+)\]\([^)]+\)/g,                  // [text](url) → keep text
  /`[^`]*`/g,                                // inline code
  /^---.*?---/ms,                            // frontmatter
  /\*\*([^*]+)\*\*/g,                        // **bold** → keep text
  /\*([^*]+)\*/g,                            // *italic* → keep text
  /==([^=]+)==/g,                            // ==highlight== → keep text
  /~~([^~]+)~~/g,                            // ~~strikethrough~~
];

/** Characters that end a sentence. */
const SENTENCE_END = /[。！？\n]/;

/** Clause-level separators (minor boundaries). */
const CLAUSE_BOUNDARY = /[、，；]/;

/** N+の+N structural pattern (up to 6 chars on each side of の). */
const NO_PATTERN = /[\s\S]{1,6}の[\s\S]{1,6}/g;

/** Japanese particle characters used in structural chunk extraction. */
const PARTICLE_RE = /[はがをにでもからまでへとよりだし]/;

/** Minimum length (in characters) for a collocation chunk to be stored. */
const MIN_CHUNK_LEN = 2;

/** Maximum length (in characters) for a collocation chunk to be stored. */
const MAX_CHUNK_LEN = 30;

/** Maximum number of sentences to process per target word (default). */
const DEFAULT_MAX_PER_WORD = 20;

// ---------------------------------------------------------------------------
// VaultIndexer
// ---------------------------------------------------------------------------

export class VaultIndexer {
  private app: App;
  private store: CollocationStore;
  private classifier: TextClassifier;
  private aborted = false;

  constructor(app: App, store: CollocationStore) {
    this.app = app;
    this.store = store;
    this.classifier = new TextClassifier();
  }

  /** Signal to abort a running scan. */
  abort(): void {
    this.aborted = true;
  }

  /**
   * Scan the vault for occurrences of the target words and auto-generate
   * collocation entries.
   */
  async run(
    options: VaultIndexOptions = {},
    onProgress?: (msg: string) => void,
  ): Promise<VaultIndexResult> {
    this.aborted = false;

    const maxPerWord = options.maxPerWord ?? DEFAULT_MAX_PER_WORD;
    const skipExisting = options.skipExisting ?? true;

    // Determine target words
    const targetWords = this.resolveTargetWords(options.targetWords, skipExisting);
    if (targetWords.length === 0) {
      return { scanned: 0, matches: 0, added: 0, words: [] };
    }

    // Collect all markdown files
    const files = this.app.vault.getMarkdownFiles();

    const result: VaultIndexResult = {
      scanned: 0,
      matches: 0,
      added: 0,
      words: [],
    };

    // Map: targetWord → array of match contexts (capped at maxPerWord)
    const matchMap = new Map<string, VaultMatchContext[]>();
    for (const w of targetWords) matchMap.set(w, []);

    onProgress?.(`Scanning ${files.length} notes for ${targetWords.length} target word(s)…`);

    for (const file of files) {
      if (this.aborted) break;

      let content: string;
      try {
        content = await this.app.vault.cachedRead(file);
      } catch {
        continue;
      }

      result.scanned++;

      const cleaned = this.stripNoise(content);
      const sentences = this.extractSentences(cleaned);

      for (const sentence of sentences) {
        if (this.aborted) break;
        for (const target of targetWords) {
          const contexts = matchMap.get(target)!;
          if (contexts.length >= maxPerWord) continue;
          if (sentence.includes(target)) {
            contexts.push({ filePath: file.path, sentence, matchedText: target });
            result.matches++;
          }
        }
      }
    }

    if (this.aborted) {
      onProgress?.("Indexing aborted.");
      return result;
    }

    // Generate entries from all collected contexts
    onProgress?.(`Generating collocation entries from ${result.matches} match(es)…`);

    const existingPhrases = new Set(this.store.getAll().map(e => e.fullPhrase));

    for (const [target, contexts] of matchMap.entries()) {
      if (contexts.length === 0) continue;

      let addedForWord = 0;
      for (const ctx of contexts) {
        if (this.aborted) break;
        const chunks = this.generateChunks(ctx.sentence, target);
        for (const chunk of chunks) {
          if (existingPhrases.has(chunk)) continue;
          const entry = this.buildEntry(chunk, ctx);
          this.store.add(entry);
          existingPhrases.add(chunk);
          result.added++;
          addedForWord++;
        }
      }

      if (addedForWord > 0 && !result.words.includes(target)) {
        result.words.push(target);
      }
    }

    onProgress?.(
      `Done. Scanned ${result.scanned} notes, found ${result.matches} match(es), added ${result.added} entr${result.added === 1 ? "y" : "ies"}.`,
    );
    return result;
  }

  // ---------------------------------------------------------------------------
  // Target word resolution
  // ---------------------------------------------------------------------------

  private resolveTargetWords(
    provided: string[] | undefined,
    skipExisting: boolean,
  ): string[] {
    if (provided && provided.length > 0) {
      return provided.filter(w => w.trim().length > 0).map(w => w.trim());
    }

    // Fall back to all headwords from the store
    const words = this.store.getIndex().byHeadword;
    const targets: string[] = [];
    for (const [headword] of words.entries()) {
      if (skipExisting) {
        const entries = this.store.getByHeadword(headword);
        const hasVaultEntry = entries.some(e => e.source === CollocationSource.VaultIndex);
        if (hasVaultEntry) continue;
      }
      targets.push(headword);
    }
    return targets;
  }

  // ---------------------------------------------------------------------------
  // Noise stripping
  // ---------------------------------------------------------------------------

  /**
   * Remove timestamps, markdown formatting and transcript noise while
   * preserving Japanese text content.
   */
  stripNoise(content: string): string {
    // Strip YAML frontmatter first
    let text = content.replace(/^---[\s\S]*?---\s*/m, "");

    // Apply all noise patterns
    for (const re of NOISE_PATTERNS) {
      // For patterns that capture inner text (e.g. [[link]], **bold**),
      // replace with the capture group; otherwise remove entirely.
      if (re.source.includes("([^")) {
        text = text.replace(re, "$1");
      } else {
        text = text.replace(re, " ");
      }
    }

    // Collapse multiple spaces/newlines
    text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
    return text.trim();
  }

  // ---------------------------------------------------------------------------
  // Sentence extraction
  // ---------------------------------------------------------------------------

  /**
   * Split cleaned text into individual sentences, filtering out empty or
   * non-Japanese lines.
   */
  extractSentences(text: string): string[] {
    const sentences: string[] = [];
    // Split on sentence-ending punctuation, keeping the delimiter with each part
    const parts = text.split(/(?<=[。！？])|(?=\n)/);
    let buffer = "";

    for (const part of parts) {
      buffer += part.replace(/\n/g, "");
      if (SENTENCE_END.test(part) || part === "\n") {
        const trimmed = buffer.trim();
        if (trimmed.length >= MIN_CHUNK_LEN && this.hasJapanese(trimmed)) {
          sentences.push(trimmed);
        }
        buffer = "";
      }
    }

    // Flush remaining buffer
    if (buffer.trim().length >= MIN_CHUNK_LEN && this.hasJapanese(buffer.trim())) {
      sentences.push(buffer.trim());
    }

    return sentences;
  }

  // ---------------------------------------------------------------------------
  // Chunk generation
  // ---------------------------------------------------------------------------

  /**
   * Given a sentence and a target word that appears in it, generate a set of
   * meaningful collocation chunks to store as entries.
   *
   * Strategy:
   * 1. The target word alone.
   * 2. The clause-level segment containing the target (split on 、).
   * 3. Forward windows of various lengths after the target.
   * 4. Backward windows (preceding material + target).
   * 5. Structural patterns: N+の+N, N+particle+V, etc. (via the classifier).
   */
  generateChunks(sentence: string, target: string): string[] {
    const pos = sentence.indexOf(target);
    if (pos === -1) return [target];

    const chunks = new Set<string>();

    // 1. Target alone (only if it's a meaningful word, not a single particle)
    if (target.length >= MIN_CHUNK_LEN) {
      chunks.add(target);
    }

    // 2. Clause-level segment containing the target
    const clauses = sentence.split(CLAUSE_BOUNDARY);
    for (const clause of clauses) {
      if (clause.includes(target)) {
        const c = clause.trim();
        if (this.isValidChunk(c)) chunks.add(c);
      }
    }

    // 3. Forward windows: target + N chars after it, stopping at boundaries
    const after = sentence.slice(pos + target.length);
    const forwardStops = this.findBoundaryPositions(after);
    for (const stop of forwardStops) {
      const chunk = target + after.slice(0, stop);
      if (this.isValidChunk(chunk)) chunks.add(chunk);
    }

    // 4. Backward windows: up to 8 chars before target + target
    const before = sentence.slice(0, pos);
    const backwardStops = this.findBackBoundaryPositions(before);
    for (const stop of backwardStops) {
      const chunk = before.slice(stop) + target;
      if (this.isValidChunk(chunk)) chunks.add(chunk);
    }

    // 5. Structural sub-phrases: split by particles to get noun-phrase cores
    const structural = this.extractStructuralChunks(sentence, target);
    for (const c of structural) {
      if (this.isValidChunk(c)) chunks.add(c);
    }

    // Filter and return
    return [...chunks].filter(c => this.isValidChunk(c));
  }

  /**
   * Find positions (relative to `text`) where interesting forward chunks end.
   * Returns positions at: next clause boundary, next sentence end, and
   * a few fixed widths that stay within the sentence.
   */
  private findBoundaryPositions(text: string): number[] {
    const positions = new Set<number>();
    const stripped = text.replace(/[。！？\n].*$/, ""); // stop at sentence end

    // Fixed character windows
    for (const len of [4, 6, 8, 12]) {
      if (len <= stripped.length) positions.add(len);
    }

    // Clause boundary positions
    for (let i = 0; i < stripped.length; i++) {
      if (CLAUSE_BOUNDARY.test(stripped[i])) {
        positions.add(i);       // stop before the 、
        positions.add(i + 1);   // include the 、
      }
    }

    // Include to end of stripped text
    if (stripped.length > 0) positions.add(stripped.length);

    return [...positions].sort((a, b) => a - b).filter(p => p > 0 && p <= stripped.length);
  }

  /**
   * Find positions where interesting backward chunks start (relative to `text`).
   * Returns start positions such that `text.slice(start) + target` forms a phrase.
   */
  private findBackBoundaryPositions(text: string): number[] {
    const positions = new Set<number>();
    const stripped = text.replace(/^.*[。！？\n]/, ""); // only within same sentence
    const offset = text.length - stripped.length;

    // Fixed character windows
    for (const len of [2, 4, 6]) {
      const start = stripped.length - len;
      if (start >= 0) positions.add(offset + start);
    }

    // After clause boundary
    for (let i = stripped.length - 1; i >= 0; i--) {
      if (CLAUSE_BOUNDARY.test(stripped[i])) {
        positions.add(offset + i + 1);
        break;
      }
    }

    return [...positions].sort((a, b) => a - b).filter(p => p >= 0);
  }

  /**
   * Extract noun-phrase cores and particle-based sub-phrases from the sentence
   * that contain the target word.
   */
  private extractStructuralChunks(sentence: string, target: string): string[] {
    const chunks: string[] = [];

    // N+の+N patterns containing target
    NO_PATTERN.lastIndex = 0;
    let noMatch: RegExpExecArray | null;
    while ((noMatch = NO_PATTERN.exec(sentence)) !== null) {
      if (noMatch[0].includes(target)) {
        chunks.push(noMatch[0]);
      }
    }

    // Particle-delimited phrase: look for target + particle + following word
    const pos = sentence.indexOf(target);
    const afterTarget = sentence.slice(pos + target.length);
    for (let i = 0; i < Math.min(afterTarget.length, 15); i++) {
      if (PARTICLE_RE.test(afterTarget[i])) {
        // Include up to 8 chars after particle for verb/noun
        const verbEnd = Math.min(i + 1 + 8, afterTarget.length);
        const chunk = target + afterTarget.slice(0, verbEnd);
        chunks.push(chunk);
        break;
      }
    }

    return chunks;
  }

  // ---------------------------------------------------------------------------
  // Entry building
  // ---------------------------------------------------------------------------

  /**
   * Build a CollocationEntry from a chunk and its match context.
   */
  private buildEntry(chunk: string, ctx: VaultMatchContext): CollocationEntry {
    const result = this.classifier.classify(chunk);
    const now = Date.now();
    const exampleWithHighlight = this.highlightInSentence(ctx.sentence, chunk);

    return {
      id: this.store.generateId(),
      headword: result.headword || chunk,
      headwordReading: "",
      collocate: result.collocate,
      fullPhrase: chunk,
      headwordPOS: result.headwordPOS,
      collocatePOS: result.collocatePOS,
      pattern: result.pattern,
      exampleSentences: [exampleWithHighlight],
      source: CollocationSource.VaultIndex,
      tags: [...result.tags, "vault-indexed"],
      notes: `Source: ${ctx.filePath}`,
      frequency: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Wrap all occurrences of the matched chunk in the sentence with bold markers
   * for display.
   */
  private highlightInSentence(sentence: string, chunk: string): string {
    if (!sentence.includes(chunk)) return sentence;
    // Escape special regex characters in the chunk before building the pattern
    const escaped = chunk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return sentence.replace(new RegExp(escaped, "g"), `**${chunk}**`);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isValidChunk(chunk: string): boolean {
    if (!chunk || chunk.length < MIN_CHUNK_LEN || chunk.length > MAX_CHUNK_LEN) return false;
    if (!this.hasJapanese(chunk)) return false;
    // Reject chunks that are purely particles
    if (/^[はがをにでもからまでへとよりだし]+$/.test(chunk)) return false;
    return true;
  }

  private hasJapanese(text: string): boolean {
    return /[\u3000-\u9fff\uff00-\uffef]/.test(text);
  }
}
