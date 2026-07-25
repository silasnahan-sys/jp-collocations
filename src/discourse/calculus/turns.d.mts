/**
 * Types for calculus/turns.mjs (Amendment IV + v2.1 de-fuse). See that file.
 *
 * Written 2026-07-25 when main.ts began importing `transcriptToTurns` for the
 * move concordance: tsc resolved the bare .mjs without complaint, which means
 * it was flowing through as `any` and the concordance path had no type safety
 * at all. The engine/ modules already carry .d.mts for exactly this reason.
 */

/** A graded backchannel lifted out of the line stream onto its turn. */
export interface GroundingEvent {
  tSec: number;
  /** 'ack' = continuer (attention only); 'accept' = real uptake. */
  grade: 'ack' | 'accept';
  text: string;
  by: string | null;
  /** true when de-fused from INSIDE a merged turn (Amendment v2.1). */
  embedded?: boolean;
}

export interface Turn {
  tSec: number;
  tEnd: number;
  speaker: string | null;
  /** 'inferred' is the honest default — text-based floor inference, not truth. */
  speakerSource: 'inferred' | 'marked';
  speakerRule: string | null;
  text: string;
  /** source line indexes this turn was merged from. */
  parts: number[];
  grounding: GroundingEvent[];
  floorHint?: string;
}

export interface TurnStats {
  lines: number;
  lifted: number;
  merged: number;
  embeddedGrounding: number;
  defusedSplits: number;
  ack: number;
  accept: number;
}

export interface TranscriptLine { tSec: number; text: string; line: number }

export declare function parseTranscript(md: string): TranscriptLine[];
export declare function gradeBackchannel(text: string): 'ack' | 'accept' | null;
export declare function buildTurns(
  lines: TranscriptLine[],
  opts?: { gapSec?: number; maxLen?: number; speakers?: boolean },
): { turns: Turn[]; stats: TurnStats };
export declare function transcriptToTurns(
  md: string,
  opts?: { gapSec?: number; maxLen?: number; speakers?: boolean },
): { turns: Turn[]; stats: TurnStats };
