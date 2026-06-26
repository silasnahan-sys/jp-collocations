/**
 * engine.ts — typed plugin-facing wrapper over the vendored discourse engine.
 *
 * The engine itself is plain JS under `engine/` (ported from the `_tmp_pipeline`
 * reference: morphological tokenisation + a ~126-operator lexicon + voicing /
 * quote-frames / spans-pivots-moves / FLOW_STATE). It replaces the old naive
 * `detectPatterns` substring matcher, which produced ~13% false positives by
 * matching sentence-final particles inside content words (さ in 小さい, etc.) —
 * see PARSER-AUDIT.md.
 *
 * This wrapper exposes only the stable surface the plugin needs; the rich
 * analysis is reachable through `raw` for callers that want more.
 */

import { analyze } from './engine/analyze.mjs';
import type { RawDiscourseResult, RawDiscourseHit } from './engine/analyze.mjs';

/** A single discourse operator hit, boundary-aware (not substring noise). */
export interface DiscourseHit {
  /** Operator id, e.g. STANCE-PACKAGE, SUSPENDED-NARRATIVE. */
  opId: string;
  /** Dotted category, e.g. discourse.stance, illocution.ground. */
  category: string;
  /** Surface text actually matched. */
  surface: string;
  /** Char offset within the sentence. */
  offset: number;
  /** Voicing channel if inferred: 'S' | 'S→H' | 'S+H' | 'S→<person>'. */
  voice?: string;
  /** Japanese gloss of the operator. */
  glossJa?: string;
}

export interface DiscourseSentence {
  text: string;
  hits: DiscourseHit[];
  /** Full untyped per-sentence analysis (spans/pivots/moves/quotes/flow…). */
  raw: unknown;
}

export interface DiscourseAnalysis {
  sentences: DiscourseSentence[];
  operatorCount: number;
  triggerCount: number;
  /** The full untyped engine result, for callers that need everything. */
  raw: RawDiscourseResult;
}

function toHit(h: RawDiscourseHit): DiscourseHit {
  return {
    opId: h.opId,
    category: h.opCategory ?? 'unknown',
    surface: h.surface ?? '',
    offset: typeof h.offset === 'number' ? h.offset : -1,
    voice: typeof h.voice === 'string' ? h.voice : undefined,
    glossJa: typeof h.glossJa === 'string' ? h.glossJa : undefined,
  };
}

/**
 * Analyse a block of Japanese text (one or many sentences, raw VTT / plain /
 * tagged transcript — the engine auto-detects format) into discourse operators
 * with voicing and structure.
 */
export function analyzeDiscourse(text: string): DiscourseAnalysis {
  const r = analyze(text);
  const sentences: DiscourseSentence[] = (r.sentences ?? []).map(s => ({
    text: s.text ?? '',
    hits: (s.hits ?? []).map(toHit),
    raw: s,
  }));
  return {
    sentences,
    operatorCount: r.stats?.lexicon?.operators ?? 0,
    triggerCount: r.stats?.lexicon?.triggers ?? 0,
    raw: r,
  };
}
