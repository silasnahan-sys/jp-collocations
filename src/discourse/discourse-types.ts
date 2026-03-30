/**
 * Discourse-types: open registries (never closed enums) so new types can always
 * be added at runtime without a rebuild.
 */

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
