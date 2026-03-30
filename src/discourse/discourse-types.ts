// ============================================================
// Open Registry Types for Discourse Grammar Relationship Engine
// All registries are open maps — new types can be added at runtime.
// ============================================================

// --- Relationship Type Registry ---

export interface DiscourseRelationshipTypeDef {
  id: string;
  label: string;
  description: string;
  examplePattern?: string;
  tags: string[];
}

export const RELATIONSHIP_TYPE_REGISTRY = new Map<string, DiscourseRelationshipTypeDef>();

export function registerRelationshipType(def: DiscourseRelationshipTypeDef): void {
  RELATIONSHIP_TYPE_REGISTRY.set(def.id, def);
}

export function getRelationshipType(id: string): DiscourseRelationshipTypeDef | undefined {
  return RELATIONSHIP_TYPE_REGISTRY.get(id);
}

export function getAllRelationshipTypes(): DiscourseRelationshipTypeDef[] {
  return Array.from(RELATIONSHIP_TYPE_REGISTRY.values());
}

export function unregisterRelationshipType(id: string): boolean {
  return RELATIONSHIP_TYPE_REGISTRY.delete(id);
}

// --- Bit Type Registry (open registry, not enum) ---

export interface BitTypeDef {
  id: string;
  label: string;
  description: string;
  color?: string;
}

export const BIT_TYPE_REGISTRY = new Map<string, BitTypeDef>();

export function registerBitType(def: BitTypeDef): void {
  BIT_TYPE_REGISTRY.set(def.id, def);
}

export function getBitType(id: string): BitTypeDef | undefined {
  return BIT_TYPE_REGISTRY.get(id);
}

export function getAllBitTypes(): BitTypeDef[] {
  return Array.from(BIT_TYPE_REGISTRY.values());
}

// --- Core DiscourseBit ---

export interface DiscourseBit {
  id: string;
  text: string;
  startOffset: number;
  endOffset: number;
  timestamp?: string;
  bitType: string;
  morphemes: string[];
  features: Record<string, unknown>;
  chunkIndex: number;
  lineIndex?: number;
}

// --- DiscourseRelationship ---

export interface DiscourseRelationship {
  id: string;
  type: string;
  sourceBitId: string;
  targetBitId: string;
  strength: number;
  evidence: string[];
  metadata: Record<string, unknown>;
}

// --- DiscourseEdge (graph edge representation) ---

export interface DiscourseEdge {
  from: string;
  to: string;
  type: string;
  weight: number;
  label?: string;
}

// --- DiscourseGraph ---

export interface DiscourseGraph {
  bits: Map<string, DiscourseBit>;
  relationships: DiscourseRelationship[];
  edges: DiscourseEdge[];
  metadata: {
    sourceText: string;
    timestamp?: string;
    totalBits: number;
    totalRelationships: number;
  };
}

// --- Transcript chunk (one timestamped line) ---

export interface TranscriptChunk {
  timestamp?: string;
  rawText: string;
  bits: DiscourseBit[];
  lineIndex: number;
}

// --- Parsed transcript (all chunks + flat bit list) ---

export interface ParsedTranscript {
  chunks: TranscriptChunk[];
  allBits: DiscourseBit[];
  rawText: string;
}

// --- Analysis result returned by DiscourseAnalyzer ---

export interface DiscourseAnalysisResult {
  graph: DiscourseGraph;
  transcript: ParsedTranscript;
  summary: {
    relationshipTypeCounts: Record<string, number>;
    topRelationships: DiscourseRelationship[];
    bitTypeDistribution: Record<string, number>;
  };
}

// --- Feed event types for TranscriptFeed ---

export type FeedEventType =
  | "bit_added"
  | "relationship_detected"
  | "chunk_complete"
  | "analysis_complete"
  | "type_registered";

export interface FeedEvent<T = unknown> {
  type: FeedEventType;
  payload: T;
  timestamp: number;
}

/**
 * Listener callback for feed events.
 * Pass `"*"` as the event type to `addEventListener` to receive all events
 * (wildcard subscription).
 */
export type FeedListener<T = unknown> = (event: FeedEvent<T>) => void;
