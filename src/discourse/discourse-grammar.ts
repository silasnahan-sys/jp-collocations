/**
 * discourse-grammar.ts — Discourse grammar engine
 *
 * Performs morpheme-level pattern detection using pre-tokenized
 * sequences from discourse-patterns.ts. Uses a longest-first
 * greedy scan (PR6 approach) to find non-overlapping discourse
 * markers in raw Japanese text — this means TinySegmenter is NOT
 * required; we do character-level scanning with a pre-built
 * token→pattern index.
 *
 * Key capabilities:
 *   • detectPatterns(text) — find all discourse markers
 *   • detectLogicalFlow(text) — find multi-marker sequences
 *   • analyzeUtterance(text) — full utterance-level analysis
 *   • buildDiscourseProfile(text) — aggregate stats
 */

import {
  ALL_PATTERNS,
  PATTERN_BY_ID,
  LOGICAL_FLOWS,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  type DiscoursePatternDef,
  type PatternCategory,
  type PatternPosition,
  type LogicalFlowDef,
} from './discourse-patterns';

import { detectPatternsAccurate } from './accurate-patterns';

import {
  detectFillers,
  detectSpokenVariations,
  classifySpeechType,
  computeCSJRegisterScore,
  getCSJFrequency,
  getCSJTier,
  getCSJCoOccurrences,
  type FillerProfile,
  type SpokenVariation,
  type CSJSpeechType,
} from '../data/csj-spoken-data';

// ── Types ────────────────────────────────────────────────────

export interface PatternMatch {
  pattern: DiscoursePatternDef;
  /** Character offset in original text where the surface was found */
  offset: number;
  /** The substring that was matched (may differ slightly from pattern.surface for variant forms) */
  matchedText: string;
}

export interface LogicalFlowMatch {
  flow: LogicalFlowDef;
  /** The pattern matches that form this flow, in order */
  matches: PatternMatch[];
}

export interface UtteranceAnalysis {
  /** The raw text that was analyzed */
  text: string;
  /** All detected discourse patterns */
  patterns: PatternMatch[];
  /** Detected logical flow sequences */
  flows: LogicalFlowMatch[];
  /** Category distribution */
  categoryBreakdown: Record<PatternCategory, number>;
  /** Register estimate based on detected markers */
  estimatedRegister: string;
  /** Pragmatic summary: dominant functions */
  dominantFunctions: string[];
  /** CSJ-enriched analysis */
  csj: {
    /** Detected fillers with CSJ profiles */
    fillers: FillerProfile[];
    /** Detected spoken variations (fusion, nasalization, etc.) */
    spokenVariations: SpokenVariation[];
    /** CSJ-calibrated register score (negative=academic, positive=colloquial) */
    registerScore: number;
    /** CSJ register label in Japanese */
    registerLabel: string;
    /** Classified speech type (APS/SPS/dialogue) */
    speechType: CSJSpeechType;
    /** Filler density (fillers per estimated word) */
    fillerDensity: number;
  };
}

export interface DiscourseProfile {
  /** Total patterns detected */
  totalMatches: number;
  /** Matches per category */
  byCategory: Record<string, number>;
  /** Top N most frequent patterns */
  topPatterns: Array<{ surface: string; count: number; id: string }>;
  /** Register distribution */
  registerDistribution: Record<string, number>;
  /** Most used pragmatic functions */
  functionDistribution: Record<string, number>;
  /** Detected logical flows */
  flowCount: number;
  /** Hedging ratio: hedge markers / total markers */
  hedgingRatio: number;
  /** Formality score: -1 (very casual) to +1 (very formal) */
  formalityScore: number;
}

// ── Pre-build surface→pattern index (longest-first) ─────────

interface SurfaceEntry {
  surface: string;
  patterns: DiscoursePatternDef[];
}

/**
 * Build a sorted array of surface forms, longest first.
 * This enables greedy longest-match scanning.
 */
const SURFACE_INDEX: SurfaceEntry[] = (() => {
  const map = new Map<string, DiscoursePatternDef[]>();
  for (const p of ALL_PATTERNS) {
    const existing = map.get(p.surface);
    if (existing) {
      existing.push(p);
    } else {
      map.set(p.surface, [p]);
    }
  }
  return Array.from(map.entries())
    .map(([surface, patterns]) => ({ surface, patterns }))
    .sort((a, b) => b.surface.length - a.surface.length);
})();

// Also keep a Set of all single-char surfaces for fast skip
const SINGLE_CHAR_SURFACES = new Set<string>(
  SURFACE_INDEX.filter(e => e.surface.length === 1).map(e => e.surface),
);

// ── Variant normalization ────────────────────────────────────

/** Normalize common variant forms to canonical surfaces */
function normalizeForMatch(text: string): string {
  return text
    // Long vowel marks: ー → actual vowels have limited effect on matching
    // Whitespace normalization
    .replace(/\s+/g, '')
    // Half-width kana → full-width not needed since YT transcripts use full-width
    ;
}

// ── Core detection ───────────────────────────────────────────

/**
 * Detect all discourse patterns in text.
 *
 * PARSER-AUDIT Phase 2: delegates to the vendored engine's boundary-aware
 * matcher (morphological triggers, sentence rules, emergent bundles/moves).
 * The legacy substring scanner survives as `detectPatternsLegacy` — it
 * over-fired ~13% by matching particles inside content words (さ in 小さい)
 * and must not be used for anything user-visible.
 *
 * Offsets are relative to the exact `text` passed in (the legacy scanner
 * measured against a whitespace-stripped copy).
 */
export function detectPatterns(text: string): PatternMatch[] {
  return detectPatternsAccurate(text);
}

/**
 * LEGACY substring scan (over-fires; see PARSER-AUDIT.md). Kept only for
 * `detectLogicalFlows`, whose flow definitions reference legacy pattern ids.
 */
export function detectPatternsLegacy(text: string): PatternMatch[] {
  const normalized = normalizeForMatch(text);
  const matches: PatternMatch[] = [];
  const used = new Set<number>(); // set of character positions already claimed

  // For each surface (longest first), scan through text
  for (const entry of SURFACE_INDEX) {
    const { surface, patterns } = entry;
    let searchFrom = 0;
    while (true) {
      const idx = normalized.indexOf(surface, searchFrom);
      if (idx === -1) break;

      // Check no overlap with already-claimed positions
      let overlaps = false;
      for (let i = idx; i < idx + surface.length; i++) {
        if (used.has(i)) { overlaps = true; break; }
      }

      if (!overlaps) {
        // Claim these positions
        for (let i = idx; i < idx + surface.length; i++) {
          used.add(i);
        }
        // For surfaces with multiple patterns (e.g. different categories),
        // use context to pick the best or include all
        const best = pickBestPattern(patterns, idx, normalized);
        matches.push({
          pattern: best,
          offset: idx,
          matchedText: surface,
        });
      }

      searchFrom = idx + 1;
    }
  }

  return matches.sort((a, b) => a.offset - b.offset);
}

/**
 * When a surface maps to multiple patterns (e.g. 'まあ' can be filler or concessive),
 * use positional context to choose the best.
 */
function pickBestPattern(
  patterns: DiscoursePatternDef[],
  offset: number,
  text: string,
): DiscoursePatternDef {
  if (patterns.length === 1) return patterns[0];

  const isNearStart = offset < 10;
  const isNearEnd = offset > text.length - 10;

  // Filter by position hints
  const candidates = patterns.filter(p => {
    if (p.position === 'any') return true;
    if (p.position === 'utterance-initial' && isNearStart) return true;
    if (p.position === 'utterance-final' && isNearEnd) return true;
    if (p.position === 'mid-utterance' && !isNearStart && !isNearEnd) return true;
    if (p.position === 'boundary') return true;
    return false;
  });

  if (candidates.length > 0) return candidates[0];
  // Fallback: highest frequency tier (lowest number)
  return patterns.reduce((a, b) => a.frequencyTier <= b.frequencyTier ? a : b);
}

// ── Logical flow detection ───────────────────────────────────

/**
 * Given pattern matches (already detected), find multi-marker logical flows.
 * A flow is matched when its constituent patterns appear in the correct order.
 */
export function detectLogicalFlows(matches: PatternMatch[]): LogicalFlowMatch[] {
  const flowMatches: LogicalFlowMatch[] = [];

  for (const flow of LOGICAL_FLOWS) {
    const seqIds = flow.sequence;
    // Try to find each ID in order within the matches
    let currentIdx = 0;
    const found: PatternMatch[] = [];

    for (const targetId of seqIds) {
      let matched = false;
      for (let i = currentIdx; i < matches.length; i++) {
        if (matches[i].pattern.id === targetId) {
          found.push(matches[i]);
          currentIdx = i + 1;
          matched = true;
          break;
        }
        // Also check category match (some co-occurrences reference pattern groups)
        const targetPattern = PATTERN_BY_ID.get(targetId);
        if (targetPattern && matches[i].pattern.surface === targetPattern.surface) {
          found.push(matches[i]);
          currentIdx = i + 1;
          matched = true;
          break;
        }
      }
      if (!matched) break;
    }

    if (found.length === seqIds.length) {
      flowMatches.push({ flow, matches: found });
    }
  }

  return flowMatches;
}

// ── Utterance analysis ───────────────────────────────────────

/**
 * Full analysis of a single utterance or paragraph.
 */
export function analyzeUtterance(text: string): UtteranceAnalysis {
  const patterns = detectPatterns(text);
  // Flows are defined over legacy pattern ids, so they are matched against the
  // legacy scan; the engine matches drive everything else.
  const flows = detectLogicalFlows(detectPatternsLegacy(text));

  // Category breakdown
  const categoryBreakdown = {} as Record<PatternCategory, number>;
  const registerCounts: Record<string, number> = {};
  const functionCounts: Record<string, number> = {};

  for (const m of patterns) {
    const cat = m.pattern.category;
    categoryBreakdown[cat] = (categoryBreakdown[cat] ?? 0) + 1;
    registerCounts[m.pattern.register] = (registerCounts[m.pattern.register] ?? 0) + 1;
    functionCounts[m.pattern.pragmaticFunction] =
      (functionCounts[m.pattern.pragmaticFunction] ?? 0) + 1;
  }

  // Estimate register (base)
  const estimatedRegister = estimateRegister(registerCounts);

  // Dominant functions (top 3)
  const dominantFunctions = Object.entries(functionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([fn]) => fn);

  // ── CSJ enrichment ───────────────────────────────────────
  const patternSurfaces = patterns.map(m => m.pattern.surface);
  const fillers = detectFillers(text);
  const { variations, registerAdjustment } = detectSpokenVariations(text);
  const csjScore = computeCSJRegisterScore(text, patternSurfaces);

  return {
    text,
    patterns,
    flows,
    categoryBreakdown,
    estimatedRegister,
    dominantFunctions,
    csj: {
      fillers,
      spokenVariations: variations,
      registerScore: csjScore.score,
      registerLabel: csjScore.label,
      speechType: csjScore.speechType,
      fillerDensity: csjScore.fillerDensity,
    },
  };
}

function estimateRegister(counts: Record<string, number>): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return 'neutral';

  // Weighted score: casual/slang → negative, polite/formal/honorific → positive
  const weights: Record<string, number> = {
    slang: -2, casual: -1, neutral: 0, polite: 1,
    formal: 2, honorific: 3, humble: 3, academic: 2, any: 0,
  };

  let score = 0;
  for (const [reg, count] of Object.entries(counts)) {
    score += (weights[reg] ?? 0) * count;
  }
  score /= total;

  if (score < -1) return 'スラング/俗語';
  if (score < -0.3) return 'カジュアル';
  if (score < 0.3) return '普通体';
  if (score < 1) return '丁寧体';
  if (score < 2) return 'フォーマル';
  return '敬語';
}

// ── Discourse profile (aggregate) ────────────────────────────

/**
 * Build an aggregate profile from multiple texts (e.g., entire vault).
 */
export function buildDiscourseProfile(texts: string[]): DiscourseProfile {
  const allMatches: PatternMatch[] = [];
  let totalFlows = 0;

  for (const text of texts) {
    allMatches.push(...detectPatterns(text));
    // Flow defs reference legacy ids — count them off the legacy scan.
    totalFlows += detectLogicalFlows(detectPatternsLegacy(text)).length;
  }

  // Category counts
  const byCategory: Record<string, number> = {};
  const patternFreq = new Map<string, number>();
  const registerDist: Record<string, number> = {};
  const functionDist: Record<string, number> = {};
  let hedgeCount = 0;

  for (const m of allMatches) {
    const catLabel = `${m.pattern.category}: ${m.pattern.categoryLabel}`;
    byCategory[catLabel] = (byCategory[catLabel] ?? 0) + 1;

    const key = m.pattern.surface;
    patternFreq.set(key, (patternFreq.get(key) ?? 0) + 1);

    registerDist[m.pattern.register] = (registerDist[m.pattern.register] ?? 0) + 1;
    functionDist[m.pattern.pragmaticFunction] =
      (functionDist[m.pattern.pragmaticFunction] ?? 0) + 1;

    if (m.pattern.pragmaticFunction === 'hedge' || m.pattern.pragmaticFunction === 'softening') {
      hedgeCount++;
    }
  }

  // Top patterns
  const topPatterns = Array.from(patternFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([surface, count]) => {
      const pat = allMatches.find(m => m.pattern.surface === surface);
      return { surface, count, id: pat?.pattern.id ?? '' };
    });

  // Formality score
  const formalityWeights: Record<string, number> = {
    slang: -1, casual: -0.5, neutral: 0, polite: 0.5,
    formal: 0.8, honorific: 1, humble: 1, academic: 0.8, any: 0,
  };
  let formalitySum = 0;
  let formalityTotal = 0;
  for (const [reg, count] of Object.entries(registerDist)) {
    formalitySum += (formalityWeights[reg] ?? 0) * count;
    formalityTotal += count;
  }

  return {
    totalMatches: allMatches.length,
    byCategory,
    topPatterns,
    registerDistribution: registerDist,
    functionDistribution: functionDist,
    flowCount: totalFlows,
    hedgingRatio: allMatches.length > 0 ? hedgeCount / allMatches.length : 0,
    formalityScore: formalityTotal > 0 ? formalitySum / formalityTotal : 0,
  };
}

// ── Sentence-level boundary detection for YT transcripts ─────

/**
 * Detect discourse boundary positions in YT transcript text.
 * Returns offsets where new discourse segments begin,
 * useful for auto-segmenting unsegmented transcripts.
 */
export function detectBoundaries(text: string): number[] {
  const matches = detectPatterns(text);
  const boundaries: number[] = [];

  for (const m of matches) {
    if (m.pattern.category === 'D') {
      // Discourse boundary markers always indicate a boundary
      boundaries.push(m.offset);
    } else if (m.pattern.position === 'utterance-initial' && m.offset > 0) {
      // Utterance-initial markers after the start also suggest boundaries
      // But only if they're strong enough (frequency tier 1-2)
      if (m.pattern.frequencyTier <= 2) {
        boundaries.push(m.offset);
      }
    }
  }

  return [...new Set(boundaries)].sort((a, b) => a - b);
}

/**
 * Segment text at discourse boundaries.
 * Returns array of text segments.
 */
export function segmentAtBoundaries(text: string): string[] {
  const offsets = detectBoundaries(text);
  if (offsets.length === 0) return [text];

  const segments: string[] = [];
  let prev = 0;
  for (const offset of offsets) {
    if (offset > prev) {
      const seg = text.slice(prev, offset).trim();
      if (seg) segments.push(seg);
    }
    prev = offset;
  }
  // Final segment
  const last = text.slice(prev).trim();
  if (last) segments.push(last);

  return segments;
}

// ── Transcript-aware analysis ─────────────────────────────────

import {
  isTranscriptFormat,
  processTranscript,
  cleanForAnalysis,
  cleanSelection,
  getTextBySpeaker,
  getSpeakerSummary,
  lookupOffset,
  type TranscriptAnalysis,
  type TranscriptTurn,
} from './transcript-processor';

export type { TranscriptAnalysis, TranscriptTurn };

export interface TranscriptDiscourseAnalysis {
  /** Full transcript structure */
  transcript: TranscriptAnalysis;
  /** Per-turn discourse analysis */
  turnAnalyses: Array<{
    turn: TranscriptTurn;
    analysis: UtteranceAnalysis;
  }>;
  /** Aggregate profile across all turns */
  aggregateProfile: DiscourseProfile;
  /** Per-speaker profiles */
  speakerProfiles: Array<{
    speaker: number;
    turnCount: number;
    charCount: number;
    profile: DiscourseProfile;
  }>;
  /** Turn-pair patterns: how speakers respond to each other */
  turnPairPatterns: Array<{
    fromSpeaker: number;
    toSpeaker: number;
    pattern: string;
    count: number;
  }>;
}

/**
 * Analyze a transcript-format text with full speaker segmentation.
 *
 * This is the top-level function for processing vault notes with
 * [HH:MM:SS] timestamps. It:
 *   1. Parses timestamps and merges continuation lines
 *   2. Detects speaker changes via discourse heuristics
 *   3. Runs discourse pattern detection on each turn
 *   4. Builds per-speaker profiles
 *   5. Analyzes turn-pair interaction patterns
 */
export function analyzeTranscript(rawText: string): TranscriptDiscourseAnalysis {
  const transcript = processTranscript(rawText);

  // Analyze each turn
  const turnAnalyses = transcript.turns.map(turn => ({
    turn,
    analysis: analyzeUtterance(turn.text),
  }));

  // Aggregate profile
  const allTexts = transcript.turns.map(t => t.text);
  const aggregateProfile = buildDiscourseProfile(allTexts);

  // Per-speaker profiles
  const speakerIds = [...new Set(transcript.turns.map(t => t.speaker))];
  const speakerProfiles = speakerIds.map(speaker => {
    const speakerTurns = transcript.turns.filter(t => t.speaker === speaker);
    const speakerTexts = speakerTurns.map(t => t.text);
    return {
      speaker,
      turnCount: speakerTurns.length,
      charCount: speakerTexts.join('').length,
      profile: buildDiscourseProfile(speakerTexts),
    };
  });

  // Turn-pair patterns: what patterns follow speaker transitions?
  const pairCounts = new Map<string, number>();
  for (let i = 1; i < turnAnalyses.length; i++) {
    const prev = turnAnalyses[i - 1];
    const curr = turnAnalyses[i];
    if (prev.turn.speaker === curr.turn.speaker) continue;

    // What's the first marker the new speaker uses?
    const firstMarker = curr.analysis.patterns[0];
    if (firstMarker) {
      const key = `${prev.turn.speaker}→${curr.turn.speaker}:${firstMarker.pattern.pragmaticFunction}`;
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
  }

  const turnPairPatterns = Array.from(pairCounts.entries())
    .map(([key, count]) => {
      const [speakers, pattern] = key.split(':');
      const [from, to] = speakers.split('→').map(Number);
      return { fromSpeaker: from, toSpeaker: to, pattern, count };
    })
    .sort((a, b) => b.count - a.count);

  return {
    transcript,
    turnAnalyses,
    aggregateProfile,
    speakerProfiles,
    turnPairPatterns,
  };
}

/**
 * Smart analysis: auto-detects whether text is transcript format
 * or plain text and routes to the appropriate analyzer.
 */
export function smartAnalyze(text: string): {
  isTranscript: boolean;
  utterance?: UtteranceAnalysis;
  transcript?: TranscriptDiscourseAnalysis;
} {
  if (isTranscriptFormat(text)) {
    return {
      isTranscript: true,
      transcript: analyzeTranscript(text),
    };
  }
  return {
    isTranscript: false,
    utterance: analyzeUtterance(text),
  };
}

/** Re-export transcript utilities for external use */
export {
  isTranscriptFormat,
  cleanForAnalysis,
  cleanSelection,
  processTranscript,
  getTextBySpeaker,
  getSpeakerSummary,
  lookupOffset,
};

// ── Convenience: quick category label lookup ─────────────────

// Category display maps now live in discourse-patterns.ts (data layer);
// re-exported here so existing importers keep working.
export { CATEGORY_LABELS, CATEGORY_COLORS };

// ── Re-export CSJ utilities for downstream modules ───────────
export {
  detectFillers,
  detectSpokenVariations,
  classifySpeechType,
  computeCSJRegisterScore,
  getCSJFrequency,
  getCSJTier,
  getCSJCoOccurrences,
  type CSJSpeechType,
  type FillerProfile,
  type SpokenVariation,
};
