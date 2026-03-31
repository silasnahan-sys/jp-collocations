/**
 * Discourse-types: open registries (never closed enums) so new types can always
 * be added at runtime without a rebuild.
 */

import type { DiscourseCategory } from "../types.ts";

// ─── Relationship strength scale ─────────────────────────────────────────────
/** 0.0 (none) → 1.0 (absolute) assertion / hedge / speculation strength. */
export type RelationshipStrength = number;

/** Named anchor points on the 0–1 strength scale. */
export const STRENGTH = {
  NONE:     0.0,
  WEAK:     0.2,
  MODERATE: 0.5,
  STRONG:   0.75,
  ABSOLUTE: 1.0,
} as const;

// ─── Cascade arc ─────────────────────────────────────────────────────────────
/**
 * Tracks a multi-bit cascade (speculation, causal-concessive, etc.) from its
 * opening anchor bit to its closing bit with the intermediate span.
 */
export interface CascadeArc {
  /** Index of the bit that opens the cascade (e.g. きっと). */
  anchorIndex: number;
  /** Index of the bit that closes/caps the cascade (e.g. かもしれない). */
  closureIndex: number;
  /** Surface text of the anchor bit. */
  anchorText: string;
  /** Surface text of the closure bit. */
  closureText: string;
  /** Number of intermediate bits between anchor and closure. */
  intermediateCount: number;
  /** Classifier for the cascade type (e.g. "speculation", "causal-concessive"). */
  cascadeType: string;
  /**
   * Relative complexity 0–1: longer spans and richer intermediate bits raise
   * this value, signalling more sophisticated discourse structure.
   */
  complexity: RelationshipStrength;
}

// ─── Context window ───────────────────────────────────────────────────────────
/**
 * A sliding window of adjacent bits around a focal bit, used for
 * context-dependent detector confidence scoring.
 */
export interface ContextWindow {
  /** All bit texts in the current graph. */
  bits: string[];
  /** Index of the focal bit within `bits`. */
  currentIndex: number;
  /** Half-width of the window (total window = 2*windowSize + 1). */
  windowSize: number;
}

// ─── Shared type-to-category mapping ─────────────────────────────────────────
export const TYPE_TO_CATEGORY: Record<string, DiscourseCategory> = {
  "hedge-stance-softening":         "hedging",
  "split-morpheme-co-construction": "referential",
  "perspective-framing":            "stance",
  "interactional-pivot":            "interactional",
  "epistemic-continuation-blend":   "epistemic",
  "discontinuous-parallel":         "enumerative",
  "causal-concessive-cascade":      "causal-logical",
  "assertion-deflation":            "hedging",
  "connector-compounding":          "structural",
  "fuzzy-reference-chain":          "referential",
  "extended-reasoning-stance-cap":  "stance",
  "epistemic-speculation-cascade":  "epistemic",
  "discourse-fade-trail-off":       "structural",
  "sequential-adjacency":           "structural",
  "unknown":                        "structural",
};

export function categoryForType(type: string): DiscourseCategory {
  return TYPE_TO_CATEGORY[type] ?? "structural";
}

// ─── Seed relationship type names ─────────────────────────────────────────────
const SEED_RELATIONSHIP_TYPES = [
  "hedge-stance-softening",
  "split-morpheme-co-construction",
  "perspective-framing",
  "interactional-pivot",
  "epistemic-continuation-blend",
  "discontinuous-parallel",
  "causal-concessive-cascade",
  "assertion-deflation",
  "connector-compounding",
  "fuzzy-reference-chain",
  "extended-reasoning-stance-cap",
  "epistemic-speculation-cascade",
  "discourse-fade-trail-off",
] as const;

export type SeedRelationshipType = typeof SEED_RELATIONSHIP_TYPES[number];
/** Open registry: seed types + any string registered at runtime. */
export type DiscourseRelationshipType = SeedRelationshipType | (string & {});

// ─── Runtime registry ─────────────────────────────────────────────────────────
export class RelationshipRegistry {
  private static registered: Set<string> = new Set(SEED_RELATIONSHIP_TYPES);

  static register(type: string): void {
    RelationshipRegistry.registered.add(type);
  }

  static has(type: string): boolean {
    return RelationshipRegistry.registered.has(type);
  }

  static all(): DiscourseRelationshipType[] {
    return Array.from(RelationshipRegistry.registered) as DiscourseRelationshipType[];
  }

  static seeds(): SeedRelationshipType[] {
    return [...SEED_RELATIONSHIP_TYPES];
  }
}

// ─── DiscourseBit ─────────────────────────────────────────────────────────────
export interface DiscourseBit {
  id: string;
  text: string;
  startOffset: number;
  endOffset: number;
  timestamp?: string;
  bitType: DiscourseRelationshipType | "unknown";
  /** Raw morpheme tokens split from the bit text. */
  morphemes: string[];
  /** Arbitrary feature bag for pattern-specific metadata. */
  features: Record<string, string | number | boolean | string[]>;
  /**
   * How strongly assertive this bit is (0 = fully hedged, 1 = absolute
   * certainty).  Set by assertion-strength analysis during detection.
   */
  assertionStrength?: RelationshipStrength;
  /**
   * How "fuzzy" the reference in this bit is (0 = precise reference, 1 =
   * maximally vague).  Driven by approximation-marker density.
   */
  fuzziness?: RelationshipStrength;
  /**
   * How speculative this bit is (0 = factual, 1 = pure speculation).  Set
   * when the bit is part of an epistemic speculation cascade.
   */
  speculationLevel?: RelationshipStrength;
}

// ─── DiscourseEdge ────────────────────────────────────────────────────────────
export interface DiscourseEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationshipType: DiscourseRelationshipType;
  /** 0–1 confidence of the detected relationship. */
  confidence: number;
  direction: "forward" | "backward" | "bidirectional";
  /** Distance in bit-positions between source and target (1 = adjacent). */
  bitDistance: number;
  evidence: string;
  metadata: Record<string, string | number | boolean>;
}

// ─── DiscourseGraph ───────────────────────────────────────────────────────────
export interface DiscourseGraph {
  id: string;
  bits: DiscourseBit[];
  edges: DiscourseEdge[];
  /** Multi-step cascade groups detected within this graph (optional). */
  cascades?: DiscourseCascade[];
  source: string;
  timestamp?: string;
  createdAt: number;
}

// ─── TranscriptChunk ──────────────────────────────────────────────────────────
/** A timestamped chunk of annotated transcript text using || as bit boundaries. */
export interface TranscriptChunk {
  id: string;
  raw: string;
  timestamp?: string;
  bits: DiscourseBit[];
  graph: DiscourseGraph;
}

// ─── Analysis context ─────────────────────────────────────────────────────────
/**
 * Context object threaded through every PatternRule detector call.
 * Carries source metadata; the full DiscourseBit array is passed as the first
 * argument to the detector, so raw text access is always available via `bits[i].text`.
 */
export interface AnalysisContext {
  /** Identifies the source of the transcript being analysed. */
  source: string;
}

// ─── PatternMatch ─────────────────────────────────────────────────────────────
/**
 * The result returned by a `PatternRule.detector` when the rule fires.
 *
 * Fields like `assertionStrength`, `fuzziness`, and `speculationLevel` are
 * carried in the `features` bag because they are rule-specific metadata.
 */
export interface PatternMatch {
  /** Index of a non-adjacent target bit that this match relates to (optional). */
  targetIndex?: number;
  /** 0–1 confidence that the pattern was detected. */
  confidence: number;
  /** Human-readable evidence strings explaining why the rule fired. */
  evidence: string[];
  direction: "forward" | "backward" | "bidirectional";
  /** Distance in bit-positions to `targetIndex` (1 = adjacent). */
  span: number;
  /** Arbitrary feature bag; rule-specific metadata lives here. */
  features: Record<string, string | number | boolean | string[]>;
}

// ─── PatternRule ──────────────────────────────────────────────────────────────
/**
 * A single named discourse-pattern detector.
 * Registered in a `PatternRegistry` and called during analysis.
 */
export interface PatternRule {
  /** Unique kebab-case identifier (matches a `DiscourseRelationshipType`). */
  id: string;
  /** Human-readable name for display. */
  name: string;
  /**
   * Core detector function.
   * @param bits  — full bit array for the current analysis pass
   * @param index — index of the bit being examined
   * @param context — source/metadata context
   * @returns A PatternMatch if the rule fires, otherwise null.
   */
  detector: (
    bits: DiscourseBit[],
    index: number,
    context: AnalysisContext,
  ) => PatternMatch | null;
}

// ─── DiscourseCascade ────────────────────────────────────────────────────────
/**
 * A group of bits and edges that together form a multi-step discourse
 * cascade (e.g. a causal–concessive chain or a speculation arc).
 */
export interface DiscourseCascade {
  id: string;
  /** Ordered bits participating in this cascade. */
  bits: DiscourseBit[];
  /** Edges that link the cascade bits. */
  edges: DiscourseEdge[];
  /**
   * Classifier for the cascade type (mirrors `CascadeArc.cascadeType`).
   * E.g. `"epistemic-speculation"`, `"causal-concessive"`.
   */
  cascadeType: string;
  /** Relative 0–1 complexity score (longer / richer cascades score higher). */
  complexity: number;
}

// ─── PatternRegistry ─────────────────────────────────────────────────────────
/**
 * Runtime-extensible store of `PatternRule` objects.
 * Seed rules are registered via `buildSeedRegistry()` in `seed-patterns.ts`;
 * callers may add domain-specific rules at any time.
 */
export class PatternRegistry {
  private rules: Map<string, PatternRule> = new Map();

  /** Add (or replace) a rule by its `id`. */
  register(rule: PatternRule): void {
    this.rules.set(rule.id, rule);
    RelationshipRegistry.register(rule.id);
  }

  /** Look up a single rule by id. */
  get(id: string): PatternRule | undefined {
    return this.rules.get(id);
  }

  /** Return all registered rules in insertion order. */
  all(): PatternRule[] {
    return Array.from(this.rules.values());
  }
}
