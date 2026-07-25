/**
 * Shared type contracts between jp-sentence-surfer- and jp-collocations.
 * These types define the bridge API that jp-sentence-surfer- calls into.
 *
 * Enhanced with full discourse grammar system types from PRs #5, #6, #8, #9, #10, #11.
 */

import type { PatternCategory, PatternPosition, PatternRegister, PragmaticFunction } from './discourse/discourse-patterns';
import type { PatternMatch, UtteranceAnalysis, DiscourseProfile } from './discourse/discourse-grammar';
import type { IndexStats, CoOccurrencePair, OccurrenceRecord } from './discourse/discourse-index';
import type { KWICRecord } from './discourse/occurrence-index';
import type { VariationTree } from './discourse/variation-trees';
import type { TemplateMatch, CooperationTemplate } from './discourse/cooperation-templates';
import type { ConstellationEdge } from './discourse/co-occurrence';
import type { TranscriptAnalysis, TranscriptTurn } from './discourse/transcript-processor';
import type { TranscriptDiscourseAnalysis } from './discourse/discourse-grammar';

// ── Re-export discourse types for surfer consumption ─────────
export type { PatternCategory, PatternPosition, PatternRegister, PragmaticFunction };
export type { PatternMatch, UtteranceAnalysis, DiscourseProfile };
export type { IndexStats, CoOccurrencePair, OccurrenceRecord };
export type { KWICRecord, VariationTree, TemplateMatch, CooperationTemplate, ConstellationEdge };
export type { TranscriptAnalysis, TranscriptTurn, TranscriptDiscourseAnalysis };

// ── Legacy Discourse Categories (kept for backward compat) ───
export type DiscourseCategory =
  | 'topic-initiation'
  | 'reasoning'
  | 'modality'
  | 'connective'
  | 'confirmation'
  | 'rephrasing'
  | 'filler'
  | 'quotation';

export type DiscoursePosition =
  | 'utterance-initial'
  | 'utterance-final'
  | 'mid-utterance'
  | 'any';

// ── Surfer Collocation Entry ─────────────────────────────────
export interface SurferCollocationEntry {
  id: string;
  surface: string;
  reading?: string;
  definitions?: string[];
  discourseCategory?: DiscourseCategory;
  discoursePosition?: DiscoursePosition;
  pragmaticFunction?: string;
  register?: string;
  coOccurrenceIds?: string[];
  exampleSentences?: Array<{ text: string; source: string }>;
  sourceFile?: string;
  capturedAt?: string;
  granularity?: string;
  /** Discourse contexts appended by addDiscourseContext */
  _discourseContexts?: DiscourseContext[];
  /** Full discourse analysis when captured */
  _analysis?: UtteranceAnalysis;
}

// ── Discourse Context ────────────────────────────────────────
export interface DiscourseContext {
  markers: Array<{
    surface: string;
    category: string;
    position: string;
  }>;
  granularity: string;
  sourceFile: string;
  capturedAt: string;
  chunkText: string;
}

// ── Search / Stats Results ───────────────────────────────────
export interface CollocationMatch {
  entry: SurferCollocationEntry;
  offset: number;
  length: number;
}

export interface DiscourseStats {
  totalEntries: number;
  byCategory: Record<string, number>;
  byPosition: Record<string, number>;
  topCoOccurrences: Array<{ pair: [string, string]; count: number }>;
  /** Full index stats from discourse-index */
  indexStats?: IndexStats;
  /** KWIC totals */
  kwicRecords?: number;
  /** Variation tree count */
  variationTrees?: number;
  /** Formality score: -1 (casual) to +1 (formal) */
  formalityScore?: number;
  /** Hedging ratio */
  hedgingRatio?: number;
}

// ── Bridge API result types for surfer ───────────────────────

/** Result from analyzeText() bridge call */
export interface AnalysisResult {
  patterns: PatternMatch[];
  flows: Array<{ flowName: string; flowNameEn: string; matchCount: number }>;
  templates: Array<{ templateName: string; confidence: number }>;
  register: string;
  dominantFunctions: string[];
  categoryBreakdown: Record<string, number>;
}

/** Result from getVariationTree() bridge call */
export interface VariationTreeResult {
  stem: string;
  conceptLabel: string;
  conceptLabelEn: string;
  variants: Array<{
    surface: string;
    register: string;
    pragmaticFunction: string;
    frequencyTier: number;
  }>;
}

/** Result from KWIC search */
export interface KWICResult {
  records: KWICRecord[];
  totalCount: number;
  fileCount: number;
}

/** Result from co-occurrence constellation query */
export interface ConstellationResult {
  patternId: string;
  surface: string;
  frequency: number;
  associations: ConstellationEdge[];
}

/** Result from discourse profiling across the vault */
export interface VaultProfileResult {
  totalMatches: number;
  topPatterns: Array<{ surface: string; count: number }>;
  registerDistribution: Record<string, number>;
  formalityScore: number;
  hedgingRatio: number;
  flowCount: number;
}

/** Result from transcript analysis */
export interface TranscriptAnalysisResult {
  /** Whether input was detected as transcript format */
  isTranscript: boolean;
  /** Clean text with timestamps/URLs/formatting stripped */
  cleanText: string;
  /** Number of speakers detected */
  speakerCount: number;
  /** Duration in seconds */
  durationSeconds: number;
  /** Per-turn analysis */
  turns: Array<{
    speaker: number;
    startTimestamp: string;
    text: string;
    patternCount: number;
    dominantFunction: string;
    register: string;
  }>;
  /** Per-speaker profiles */
  speakerProfiles: Array<{
    speaker: number;
    turnCount: number;
    charCount: number;
    topPatterns: Array<{ surface: string; count: number }>;
    formalityScore: number;
    register: string;
  }>;
  /** Aggregate stats */
  totalPatterns: number;
  overallRegister: string;
  /** Extracted URLs */
  extractedUrls: string[];
  /** How speakers respond to each other */
  turnPairPatterns: Array<{
    fromSpeaker: number;
    toSpeaker: number;
    pattern: string;
    count: number;
  }>;
}
