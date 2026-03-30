// ============================================================
// src/discourse/index.ts — barrel export for the discourse module
// ============================================================

// Types & registries
export type {
  DiscourseRelationshipTypeDef,
  BitTypeDef,
  DiscourseBit,
  DiscourseRelationship,
  DiscourseEdge,
  DiscourseGraph,
  TranscriptChunk,
  ParsedTranscript,
  DiscourseAnalysisResult,
  FeedEvent,
  FeedEventType,
  FeedListener,
} from "./discourse-types.ts";

export {
  RELATIONSHIP_TYPE_REGISTRY,
  BIT_TYPE_REGISTRY,
  registerRelationshipType,
  getRelationshipType,
  getAllRelationshipTypes,
  unregisterRelationshipType,
  registerBitType,
  getBitType,
  getAllBitTypes,
} from "./discourse-types.ts";

// Relationship registry (seed + runtime extension)
export {
  seedRegistry,
  registrySize,
  bitTypeRegistrySize,
} from "./RelationshipRegistry.ts";

// Transcript parser
export {
  parseTranscript,
  parseLine_public as parseLine,
  extractBitTexts,
} from "./TranscriptParser.ts";

// Discourse graph builder + query helpers
export {
  buildGraph,
  getRelationshipsForBit,
  getRelationshipsByType,
  getNeighbours,
  getBitsByType,
  getRootBits,
  getLeafBits,
  findPath,
  computeDegrees,
  serializeGraph,
  deserializeGraph,
} from "./DiscourseGraph.ts";

// Analyzer (relationship detection)
export {
  detectRelationships,
  analyzeTranscript,
  registerDetector,
} from "./DiscourseAnalyzer.ts";

// Adaptive transcript feed pipeline
export { TranscriptFeed, processFeedFromText } from "./TranscriptFeed.ts";
