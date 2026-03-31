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
