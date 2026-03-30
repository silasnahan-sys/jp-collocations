// ============================================================
// TranscriptFeed — adaptive, event-driven pipeline that
// processes an annotated JP transcript incrementally and
// emits typed FeedEvents as each chunk / bit / relationship
// is discovered.
//
// Design:
//   • Feed is created once per transcript session.
//   • Call feed.ingest(line) for real-time streaming or
//     feed.ingestAll(text) for batch processing.
//   • Subscribers receive FeedEvent objects via addEventListener.
//   • Relationship detection runs per-chunk but also re-runs
//     cross-chunk whenever a new chunk is added (to catch
//     patterns like Discontinuous Parallel spanning lines).
// ============================================================

import type {
  DiscourseBit,
  DiscourseRelationship,
  TranscriptChunk,
  ParsedTranscript,
  DiscourseAnalysisResult,
  FeedEvent,
  FeedEventType,
  FeedListener,
} from "./discourse-types.ts";
import { parseTranscript } from "./TranscriptParser.ts";
import { detectRelationships, analyzeTranscript } from "./DiscourseAnalyzer.ts";
import { seedRegistry } from "./RelationshipRegistry.ts";

// ---- Internal helpers ---------------------------------------------------

function makeEvent<T>(type: FeedEventType, payload: T): FeedEvent<T> {
  return { type, payload, timestamp: Date.now() };
}

// ---- TranscriptFeed class -----------------------------------------------

export class TranscriptFeed {
  private chunks: TranscriptChunk[] = [];
  private allBits: DiscourseBit[] = [];
  private relationships: DiscourseRelationship[] = [];
  private rawLines: string[] = [];

  /** Per-event-type listener registry. */
  private listeners = new Map<string, Array<FeedListener<unknown>>>();

  constructor() {
    seedRegistry();
  }

  // ---- Event bus --------------------------------------------------------

  /**
   * Subscribe to a specific feed event type.
   *
   * Pass `"*"` as the type to receive every event regardless of its type
   * (wildcard subscription). Wildcard listeners are invoked after any
   * type-specific listeners for the same event.
   *
   * @example
   *   feed.addEventListener("bit_added", e => console.log(e.payload));
   *   feed.addEventListener("*", e => console.log("any event:", e.type));
   */
  addEventListener<T>(type: FeedEventType | "*", listener: FeedListener<T>): void {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(listener as FeedListener<unknown>);
  }

  removeEventListener<T>(type: FeedEventType | "*", listener: FeedListener<T>): void {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const idx = arr.indexOf(listener as FeedListener<unknown>);
    if (idx !== -1) arr.splice(idx, 1);
  }

  private emit<T>(type: FeedEventType, payload: T): void {
    const event = makeEvent(type, payload);
    const specific = this.listeners.get(type) ?? [];
    const wildcard = this.listeners.get("*") ?? [];
    for (const fn of [...specific, ...wildcard]) {
      try {
        fn(event as FeedEvent<unknown>);
      } catch {
        // Listener errors must not break the feed.
      }
    }
  }

  // ---- Ingestion --------------------------------------------------------

  /**
   * Ingest a single annotated line (real-time streaming mode).
   * Parses the line into bits, detects new relationships, emits events.
   */
  ingestLine(line: string): TranscriptChunk {
    this.rawLines.push(line);
    const lineIndex = this.chunks.length;

    // Parse only this new line to extract bits for the chunk
    const lineTranscript = parseTranscript(line);
    const chunk = lineTranscript.chunks[0];
    if (!chunk) {
      // Empty line — return a stub chunk
      const stub: TranscriptChunk = {
        rawText: line,
        bits: [],
        lineIndex,
      };
      return stub;
    }
    // Re-index the chunk so lineIndex is correct
    chunk.lineIndex = lineIndex;
    for (const bit of chunk.bits) {
      bit.lineIndex = lineIndex;
      bit.chunkIndex = lineIndex;
    }

    this.chunks.push(chunk);
    for (const bit of chunk.bits) {
      this.allBits.push(bit);
      this.emit<DiscourseBit>("bit_added", bit);
    }

    // Detect relationships across ALL bits so far (catches cross-chunk patterns)
    const newRels = detectRelationships(this.allBits);
    const existingIds = new Set(this.relationships.map(r => r.id));
    for (const rel of newRels) {
      if (!existingIds.has(rel.id)) {
        this.relationships.push(rel);
        this.emit<DiscourseRelationship>("relationship_detected", rel);
      }
    }

    this.emit<TranscriptChunk>("chunk_complete", chunk);
    return chunk;
  }

  /**
   * Ingest a full multi-line transcript at once (batch mode).
   * Returns the full DiscourseAnalysisResult after processing all lines.
   */
  ingestAll(text: string): DiscourseAnalysisResult {
    for (const line of text.split("\n")) {
      if (line.trim().length > 0) this.ingestLine(line);
    }
    return this.getResult();
  }

  // ---- State access -----------------------------------------------------

  /** Return the current ParsedTranscript from all ingested lines. */
  getTranscript(): ParsedTranscript {
    return {
      chunks: this.chunks,
      allBits: this.allBits,
      rawText: this.rawLines.join("\n"),
    };
  }

  /** Return all detected relationships so far. */
  getRelationships(): DiscourseRelationship[] {
    return this.relationships;
  }

  /** Return all bits ingested so far. */
  getBits(): DiscourseBit[] {
    return this.allBits;
  }

  /**
   * Run a full analysis of everything ingested so far and emit
   * an `analysis_complete` event.
   */
  getResult(): DiscourseAnalysisResult {
    const transcript = this.getTranscript();
    const result = analyzeTranscript(transcript);
    this.emit<DiscourseAnalysisResult>("analysis_complete", result);
    return result;
  }

  /** Reset the feed (clear all state). */
  reset(): void {
    this.chunks = [];
    this.allBits = [];
    this.relationships = [];
    this.rawLines = [];
  }

  /** Return a summary of current feed state (for diagnostics). */
  status(): {
    chunks: number;
    bits: number;
    relationships: number;
    relationshipTypes: Record<string, number>;
  } {
    const types: Record<string, number> = {};
    for (const r of this.relationships) {
      types[r.type] = (types[r.type] ?? 0) + 1;
    }
    return {
      chunks: this.chunks.length,
      bits: this.allBits.length,
      relationships: this.relationships.length,
      relationshipTypes: types,
    };
  }
}

// ---- Convenience factory -----------------------------------------------

/**
 * Create a TranscriptFeed and immediately process a full transcript,
 * returning the DiscourseAnalysisResult.
 */
export function processFeedFromText(text: string): DiscourseAnalysisResult {
  const feed = new TranscriptFeed();
  return feed.ingestAll(text);
}
