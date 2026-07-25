/**
 * occurrence-index.ts — KWIC (KeyWord In Context) occurrence index
 *
 * From PR#11: Stores per-occurrence records in KWIC format,
 * enabling concordance-line display (left context | KEYWORD | right context).
 *
 * This is the bread-and-butter of corpus linguistics applied to
 * the learner's own vault — every time a discourse marker appears,
 * we capture its surrounding context and metadata.
 */

import type { PatternMatch } from './discourse-grammar';
import { PATTERN_BY_ID } from './discourse-patterns';

// ── Types ────────────────────────────────────────────────────

export interface KWICRecord {
  /** Pattern ID */
  patternId: string;
  /** Surface form matched */
  surface: string;
  /** Left context (up to N chars before the match) */
  left: string;
  /** The matched keyword itself */
  keyword: string;
  /** Right context (up to N chars after the match) */
  right: string;
  /** Source file path (vault-relative) */
  filePath: string;
  /** Line number in the file (1-based) if available */
  lineNumber: number;
  /** Character offset */
  offset: number;
  /** Timestamp when indexed */
  indexedAt: number;
}

export interface KWICSearchResult {
  records: KWICRecord[];
  totalCount: number;
  /** Unique files where this pattern appears */
  fileCount: number;
}

/** Serializable state */
export interface KWICIndexData {
  /** pattern ID → array of KWIC records */
  records: Record<string, KWICRecord[]>;
  /** Total record count */
  totalRecords: number;
}

// ── KWIC Index class ─────────────────────────────────────────

export class KWICIndex {
  private data: KWICIndexData;
  private contextWindow: number;

  /**
   * @param contextWindow - Number of characters to capture on each side (default 60)
   */
  constructor(saved?: KWICIndexData, contextWindow: number = 60) {
    this.data = saved ?? { records: {}, totalRecords: 0 };
    this.contextWindow = contextWindow;
  }

  // ── Indexing ───────────────────────────────────────────

  /**
   * Index all matches from a file, replacing any previous records for that file.
   */
  indexFile(filePath: string, fileContent: string, matches: PatternMatch[]): void {
    // Remove old records from this file
    this.removeFile(filePath);

    // Compute line numbers from content
    const lineStarts = [0];
    for (let i = 0; i < fileContent.length; i++) {
      if (fileContent[i] === '\n') lineStarts.push(i + 1);
    }

    for (const m of matches) {
      // Find line number
      let lineNumber = 1;
      for (let i = 0; i < lineStarts.length; i++) {
        if (lineStarts[i] > m.offset) break;
        lineNumber = i + 1;
      }

      const left = fileContent.slice(
        Math.max(0, m.offset - this.contextWindow),
        m.offset,
      );
      const right = fileContent.slice(
        m.offset + m.matchedText.length,
        Math.min(fileContent.length, m.offset + m.matchedText.length + this.contextWindow),
      );

      const record: KWICRecord = {
        patternId: m.pattern.id,
        surface: m.pattern.surface,
        keyword: m.matchedText,
        left: left.replace(/\n/g, ' '),
        right: right.replace(/\n/g, ' '),
        filePath,
        lineNumber,
        offset: m.offset,
        indexedAt: Date.now(),
      };

      if (!this.data.records[m.pattern.id]) {
        this.data.records[m.pattern.id] = [];
      }
      this.data.records[m.pattern.id].push(record);
      this.data.totalRecords++;
    }
  }

  /** Remove all records from a specific file */
  removeFile(filePath: string): void {
    for (const patternId of Object.keys(this.data.records)) {
      const before = this.data.records[patternId].length;
      this.data.records[patternId] =
        this.data.records[patternId].filter(r => r.filePath !== filePath);
      const removed = before - this.data.records[patternId].length;
      this.data.totalRecords -= removed;

      if (this.data.records[patternId].length === 0) {
        delete this.data.records[patternId];
      }
    }
  }

  // ── Queries ────────────────────────────────────────────

  /** Get all KWIC records for a pattern */
  getByPattern(patternId: string): KWICSearchResult {
    const records = this.data.records[patternId] ?? [];
    const files = new Set(records.map(r => r.filePath));
    return { records, totalCount: records.length, fileCount: files.size };
  }

  /** Get all KWIC records for a surface form (may span multiple pattern IDs) */
  getBySurface(surface: string): KWICSearchResult {
    const allRecords: KWICRecord[] = [];
    for (const records of Object.values(this.data.records)) {
      for (const r of records) {
        if (r.surface === surface) allRecords.push(r);
      }
    }
    const files = new Set(allRecords.map(r => r.filePath));
    return { records: allRecords, totalCount: allRecords.length, fileCount: files.size };
  }

  /** Get all records from a specific file */
  getByFile(filePath: string): KWICRecord[] {
    const result: KWICRecord[] = [];
    for (const records of Object.values(this.data.records)) {
      for (const r of records) {
        if (r.filePath === filePath) result.push(r);
      }
    }
    return result.sort((a, b) => a.offset - b.offset);
  }

  /** Search KWIC records where left or right context contains a string */
  searchContext(query: string): KWICRecord[] {
    const results: KWICRecord[] = [];
    const lowerQuery = query.toLowerCase();
    for (const records of Object.values(this.data.records)) {
      for (const r of records) {
        if (r.left.toLowerCase().includes(lowerQuery) ||
            r.right.toLowerCase().includes(lowerQuery)) {
          results.push(r);
        }
      }
    }
    return results;
  }

  /** Get the most frequent patterns across all records */
  getTopPatterns(limit: number = 20): Array<{ patternId: string; surface: string; count: number }> {
    return Object.entries(this.data.records)
      .map(([patternId, records]) => ({
        patternId,
        surface: records[0]?.surface ?? '',
        count: records.length,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  // ── Stats ──────────────────────────────────────────────

  getTotalRecords(): number {
    return this.data.totalRecords;
  }

  getUniquePatternCount(): number {
    return Object.keys(this.data.records).length;
  }

  getFileCount(): number {
    const files = new Set<string>();
    for (const records of Object.values(this.data.records)) {
      for (const r of records) files.add(r.filePath);
    }
    return files.size;
  }

  // ── Persistence ────────────────────────────────────────

  serialize(): KWICIndexData {
    return this.data;
  }

  static deserialize(data: KWICIndexData, contextWindow?: number): KWICIndex {
    return new KWICIndex(data, contextWindow);
  }
}
