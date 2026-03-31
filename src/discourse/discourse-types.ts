/**
 * Discourse-types: open registries (never closed enums) so new types can always
 * be added at runtime without a rebuild.
 */

import type { DiscourseCategory } from "../types.ts";

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
  evidence: string[];
  metadata: Record<string, string | number | boolean>;
}

// ─── DiscourseCascade ─────────────────────────────────────────────────────────
/** A chain of 3+ relationships forming an emergent meaning. */
export interface DiscourseCascade {
  id: string;
  /** Ordered array of edge IDs in the chain. */
  relationships: string[];
  cascadeType: string;
  /** Describes the emergent meaning of the chain. */
  overallFunction: string;
}

// ─── DiscourseGraph ───────────────────────────────────────────────────────────
export interface DiscourseGraph {
  id: string;
  bits: DiscourseBit[];
  edges: DiscourseEdge[];
  cascades: DiscourseCascade[];
  source: string;
  timestamp?: string;
  createdAt: number;
}

// ─── PatternRule types ────────────────────────────────────────────────────────

/** Context object passed to every detector. */
export interface AnalysisContext {
  allBits: DiscourseBit[];
  allTexts: string[];
  graphSoFar: { bits: DiscourseBit[]; edges: DiscourseEdge[] };
}

/** What a detector returns on match. */
export interface PatternMatch {
  /** Index of the target bit (for edges). */
  targetIndex?: number;
  /** 0–1 confidence. */
  confidence: number;
  /** Actual text patterns that triggered this rule. */
  evidence: string[];
  direction: "forward" | "backward" | "bidirectional";
  /** Number of bits between source and target. */
  span: number;
  features: Record<string, string | number | boolean | string[]>;
}

/** A single expandable detection rule. */
export interface PatternRule {
  id: string;
  name: string;
  description: string;
  relationshipType: DiscourseRelationshipType;
  /** The detector function. Returns a match result or null. */
  detector: (bits: DiscourseBit[], index: number, context: AnalysisContext) => PatternMatch | null;
  /** Higher priority rules are checked first. */
  priority: number;
  /** Example JP strings this rule matches. */
  examples: string[];
  createdFrom: "seed" | "learned" | "manual";
  /** Incremented each time the detector fires. */
  hitCount: number;
}

// ─── PatternRegistry ──────────────────────────────────────────────────────────

/** Serialisable metadata for a PatternRule (excludes the detector function). */
interface SerializedRule {
  id: string;
  name: string;
  description: string;
  relationshipType: string;
  priority: number;
  examples: string[];
  createdFrom: "seed" | "learned" | "manual";
  hitCount: number;
}

export class PatternRegistry {
  private rules: Map<string, PatternRule> = new Map();

  register(rule: PatternRule): void {
    this.rules.set(rule.id, rule);
    RelationshipRegistry.register(rule.relationshipType as string);
  }

  unregister(id: string): boolean {
    return this.rules.delete(id);
  }

  getByType(type: string): PatternRule[] {
    return Array.from(this.rules.values()).filter(r => r.relationshipType === type);
  }

  getAll(): PatternRule[] {
    return Array.from(this.rules.values()).sort((a, b) => b.priority - a.priority);
  }

  getById(id: string): PatternRule | undefined {
    return this.rules.get(id);
  }

  /** Serialize all rules (excluding the detector function) for persistence. */
  serialize(): string {
    const data: SerializedRule[] = Array.from(this.rules.values()).map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      relationshipType: r.relationshipType as string,
      priority: r.priority,
      examples: r.examples,
      createdFrom: r.createdFrom,
      hitCount: r.hitCount,
    }));
    return JSON.stringify(data, null, 2);
  }

  /** Deserialize rule metadata. Detector functions must be re-attached separately. */
  deserialize(json: string): void {
    const data: SerializedRule[] = JSON.parse(json);
    for (const item of data) {
      const existing = this.rules.get(item.id);
      if (existing) {
        existing.name = item.name;
        existing.description = item.description;
        existing.priority = item.priority;
        existing.examples = item.examples;
        existing.createdFrom = item.createdFrom;
        existing.hitCount = item.hitCount;
      }
    }
  }
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
