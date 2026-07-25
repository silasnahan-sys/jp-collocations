/**
 * discourse-index.ts — 5-axis inverted index for discourse markers
 *
 * From PR#10: Maintains inverted indexes across 5 axes:
 *   1. Marker surface  → occurrences
 *   2. Category         → occurrences
 *   3. Co-occurrence    → (marker1, marker2) pair counts
 *   4. Collocation link → discourse markers found within a collocation entry
 *   5. Source file       → discourse markers per file
 *
 * All state is JSON-serializable for Obsidian's saveData() persistence.
 * Designed for incremental updates when files change (active-leaf-change hook).
 */

import type { DiscoursePatternDef, PatternCategory } from './discourse-patterns';
import type { PatternMatch } from './discourse-grammar';

// ── Types ────────────────────────────────────────────────────

export interface OccurrenceRecord {
  /** Pattern ID (e.g. "A001") */
  patternId: string;
  /** Source file path (vault-relative) */
  filePath: string;
  /** Character offset in the file */
  offset: number;
  /** Surrounding context snippet (±40 chars) */
  context: string;
  /** Timestamp of indexing */
  indexedAt: number;
}

export interface CoOccurrencePair {
  /** Alphabetically ordered pair key: "A001|B003" */
  pairKey: string;
  patternId1: string;
  patternId2: string;
  /** How many times they co-occur in the same utterance/paragraph */
  count: number;
  /** File paths where they co-occur */
  filePaths: string[];
}

export interface IndexStats {
  totalOccurrences: number;
  uniquePatterns: number;
  filesIndexed: number;
  coOccurrencePairs: number;
  lastUpdated: number;
}

/** Serializable index state */
export interface DiscourseIndexData {
  /** Axis 1: surface → occurrence records */
  bySurface: Record<string, OccurrenceRecord[]>;
  /** Axis 2: category → occurrence records (stored as pattern IDs for efficiency) */
  byCategory: Record<string, string[]>; // category → patternId[]
  /** Axis 3: co-occurrence pair key → pair data */
  coOccurrences: Record<string, CoOccurrencePair>;
  /** Axis 4: collocation headword → discourse pattern IDs found in its examples */
  byCollocation: Record<string, string[]>;
  /** Axis 5: file path → pattern IDs */
  byFile: Record<string, string[]>;
  /** Metadata */
  stats: IndexStats;
}

// ── DiscourseIndex class ─────────────────────────────────────

export class DiscourseIndex {
  private data: DiscourseIndexData;

  constructor(saved?: DiscourseIndexData) {
    this.data = saved ?? this.createEmpty();
  }

  private createEmpty(): DiscourseIndexData {
    return {
      bySurface: {},
      byCategory: {},
      coOccurrences: {},
      byCollocation: {},
      byFile: {},
      stats: {
        totalOccurrences: 0, uniquePatterns: 0,
        filesIndexed: 0, coOccurrencePairs: 0,
        lastUpdated: Date.now(),
      },
    };
  }

  // ── Index a file's patterns ────────────────────────────

  /**
   * Index all matches from a single file.
   * Replaces any previous data for that file (incremental update).
   */
  indexFile(filePath: string, fileContent: string, matches: PatternMatch[]): void {
    // Remove old data for this file first
    this.removeFile(filePath);

    const patternIds: string[] = [];

    for (const m of matches) {
      const occ: OccurrenceRecord = {
        patternId: m.pattern.id,
        filePath,
        offset: m.offset,
        context: fileContent.slice(
          Math.max(0, m.offset - 40),
          Math.min(fileContent.length, m.offset + m.matchedText.length + 40),
        ),
        indexedAt: Date.now(),
      };

      // Axis 1: surface
      const surface = m.pattern.surface;
      if (!this.data.bySurface[surface]) this.data.bySurface[surface] = [];
      this.data.bySurface[surface].push(occ);

      // Axis 2: category
      const cat = m.pattern.category;
      if (!this.data.byCategory[cat]) this.data.byCategory[cat] = [];
      this.data.byCategory[cat].push(m.pattern.id);

      patternIds.push(m.pattern.id);
    }

    // Axis 5: file → patterns
    this.data.byFile[filePath] = patternIds;

    // Axis 3: co-occurrence (pairs within same file)
    const uniqueIds = [...new Set(patternIds)];
    for (let i = 0; i < uniqueIds.length; i++) {
      for (let j = i + 1; j < uniqueIds.length; j++) {
        const [a, b] = [uniqueIds[i], uniqueIds[j]].sort();
        const pairKey = `${a}|${b}`;
        if (!this.data.coOccurrences[pairKey]) {
          this.data.coOccurrences[pairKey] = {
            pairKey, patternId1: a, patternId2: b,
            count: 0, filePaths: [],
          };
        }
        const pair = this.data.coOccurrences[pairKey];
        pair.count++;
        if (!pair.filePaths.includes(filePath)) {
          pair.filePaths.push(filePath);
        }
      }
    }

    this.refreshStats();
  }

  /** Remove all index data for a file */
  removeFile(filePath: string): void {
    // Axis 1: remove occurrences
    for (const surface of Object.keys(this.data.bySurface)) {
      this.data.bySurface[surface] =
        this.data.bySurface[surface].filter(o => o.filePath !== filePath);
      if (this.data.bySurface[surface].length === 0) {
        delete this.data.bySurface[surface];
      }
    }

    // Axis 2: rebuild from remaining files (done in refreshStats)
    // Axis 3: remove co-occurrences from this file
    for (const key of Object.keys(this.data.coOccurrences)) {
      const pair = this.data.coOccurrences[key];
      pair.filePaths = pair.filePaths.filter(f => f !== filePath);
      if (pair.filePaths.length === 0) {
        delete this.data.coOccurrences[key];
      }
    }

    // Axis 5: remove file entry
    delete this.data.byFile[filePath];

    this.refreshStats();
  }

  // ── Axis 4: collocation links ──────────────────────────

  /**
   * Link discourse patterns found in a collocation's example sentences.
   */
  linkCollocation(headword: string, patternIds: string[]): void {
    this.data.byCollocation[headword] = patternIds;
  }

  // ── Query methods ──────────────────────────────────────

  /** Axis 1: get occurrences by surface form */
  searchBySurface(surface: string): OccurrenceRecord[] {
    return this.data.bySurface[surface] ?? [];
  }

  /** Axis 2: get all pattern IDs in a category */
  searchByCategory(category: PatternCategory | string): string[] {
    return this.data.byCategory[category] ?? [];
  }

  /** Axis 3: get co-occurrence pairs involving a pattern */
  getCoOccurrences(patternId: string): CoOccurrencePair[] {
    return Object.values(this.data.coOccurrences)
      .filter(p => p.patternId1 === patternId || p.patternId2 === patternId)
      .sort((a, b) => b.count - a.count);
  }

  /** Axis 3: get top N co-occurrence pairs */
  getTopCoOccurrences(limit: number = 20): CoOccurrencePair[] {
    return Object.values(this.data.coOccurrences)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /** Axis 3: search by specific pair */
  searchByCoOccurrence(marker1: string, marker2: string): CoOccurrencePair | undefined {
    const [a, b] = [marker1, marker2].sort();
    return this.data.coOccurrences[`${a}|${b}`];
  }

  /** Axis 4: get discourse patterns linked to a collocation */
  getCollocationPatterns(headword: string): string[] {
    return this.data.byCollocation[headword] ?? [];
  }

  /** Axis 5: get all patterns found in a file */
  getFilePatterns(filePath: string): string[] {
    return this.data.byFile[filePath] ?? [];
  }

  /** Axis 5: get all indexed files */
  getIndexedFiles(): string[] {
    return Object.keys(this.data.byFile);
  }

  /** Get marker frequency (total occurrences of a surface) */
  getMarkerFrequency(surface: string): number {
    return (this.data.bySurface[surface] ?? []).length;
  }

  // ── Stats ──────────────────────────────────────────────

  private refreshStats(): void {
    const allOccs = Object.values(this.data.bySurface).flat();
    const uniquePatterns = new Set(allOccs.map(o => o.patternId));

    this.data.stats = {
      totalOccurrences: allOccs.length,
      uniquePatterns: uniquePatterns.size,
      filesIndexed: Object.keys(this.data.byFile).length,
      coOccurrencePairs: Object.keys(this.data.coOccurrences).length,
      lastUpdated: Date.now(),
    };
  }

  getStats(): IndexStats {
    return { ...this.data.stats };
  }

  // ── Persistence ────────────────────────────────────────

  serialize(): DiscourseIndexData {
    return this.data;
  }

  static deserialize(data: DiscourseIndexData): DiscourseIndex {
    return new DiscourseIndex(data);
  }
}
