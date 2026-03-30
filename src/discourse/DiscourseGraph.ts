// ============================================================
// DiscourseGraph — build and query a graph of discourse bits
// connected by detected relationships.
// ============================================================

import type {
  DiscourseBit,
  DiscourseRelationship,
  DiscourseEdge,
  DiscourseGraph,
  ParsedTranscript,
} from "./discourse-types.ts";

// ---- Build ---------------------------------------------------------------

/**
 * Build a DiscourseGraph from a ParsedTranscript and a list of relationships.
 */
export function buildGraph(
  transcript: ParsedTranscript,
  relationships: DiscourseRelationship[]
): DiscourseGraph {
  const bits = new Map<string, DiscourseBit>();
  for (const bit of transcript.allBits) {
    bits.set(bit.id, bit);
  }

  const edges: DiscourseEdge[] = relationships.map(rel => ({
    from: rel.sourceBitId,
    to: rel.targetBitId,
    type: rel.type,
    weight: rel.strength,
    label: rel.type.replace(/_/g, " "),
  }));

  return {
    bits,
    relationships,
    edges,
    metadata: {
      sourceText: transcript.rawText,
      totalBits: bits.size,
      totalRelationships: relationships.length,
    },
  };
}

// ---- Query helpers -------------------------------------------------------

/**
 * Return all relationships where the given bit is either source or target.
 */
export function getRelationshipsForBit(
  graph: DiscourseGraph,
  bitId: string
): DiscourseRelationship[] {
  return graph.relationships.filter(
    r => r.sourceBitId === bitId || r.targetBitId === bitId
  );
}

/**
 * Return all relationships of a given type.
 */
export function getRelationshipsByType(
  graph: DiscourseGraph,
  type: string
): DiscourseRelationship[] {
  return graph.relationships.filter(r => r.type === type);
}

/**
 * Return the neighbours of a given bit: all bits directly connected.
 */
export function getNeighbours(
  graph: DiscourseGraph,
  bitId: string
): DiscourseBit[] {
  const ids = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from === bitId) ids.add(edge.to);
    if (edge.to === bitId) ids.add(edge.from);
  }
  return Array.from(ids)
    .map(id => graph.bits.get(id))
    .filter((b): b is DiscourseBit => b !== undefined);
}

/**
 * Return all bits of a given bit type.
 */
export function getBitsByType(
  graph: DiscourseGraph,
  bitType: string
): DiscourseBit[] {
  return Array.from(graph.bits.values()).filter(b => b.bitType === bitType);
}

/**
 * Return all bits that have no incoming relationships (root bits).
 */
export function getRootBits(graph: DiscourseGraph): DiscourseBit[] {
  const targeted = new Set(graph.relationships.map(r => r.targetBitId));
  return Array.from(graph.bits.values()).filter(b => !targeted.has(b.id));
}

/**
 * Return all bits that have no outgoing relationships (leaf bits).
 */
export function getLeafBits(graph: DiscourseGraph): DiscourseBit[] {
  const sourced = new Set(graph.relationships.map(r => r.sourceBitId));
  return Array.from(graph.bits.values()).filter(b => !sourced.has(b.id));
}

/**
 * Find the shortest path between two bits (BFS over edges).
 * Returns an ordered array of bit IDs or null if unreachable.
 */
export function findPath(
  graph: DiscourseGraph,
  fromId: string,
  toId: string
): string[] | null {
  if (fromId === toId) return [fromId];
  if (!graph.bits.has(fromId) || !graph.bits.has(toId)) return null;

  // Build adjacency list (directed)
  const adj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!adj.has(edge.from)) adj.set(edge.from, []);
    adj.get(edge.from)!.push(edge.to);
  }

  const visited = new Set<string>();
  const queue: Array<{ id: string; path: string[] }> = [
    { id: fromId, path: [fromId] },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    for (const neighbour of adj.get(current.id) ?? []) {
      const newPath = [...current.path, neighbour];
      if (neighbour === toId) return newPath;
      if (!visited.has(neighbour)) {
        queue.push({ id: neighbour, path: newPath });
      }
    }
  }
  return null;
}

/**
 * Compute a degree map: how many relationships each bit participates in.
 */
export function computeDegrees(
  graph: DiscourseGraph
): Map<string, { in: number; out: number; total: number }> {
  const degrees = new Map<
    string,
    { in: number; out: number; total: number }
  >();
  for (const id of graph.bits.keys()) {
    degrees.set(id, { in: 0, out: 0, total: 0 });
  }
  for (const rel of graph.relationships) {
    const src = degrees.get(rel.sourceBitId);
    if (src) { src.out++; src.total++; }
    const tgt = degrees.get(rel.targetBitId);
    if (tgt) { tgt.in++; tgt.total++; }
  }
  return degrees;
}

/**
 * Serialize the graph to a plain JSON-safe object for storage / export.
 */
export function serializeGraph(graph: DiscourseGraph): object {
  return {
    bits: Array.from(graph.bits.values()),
    relationships: graph.relationships,
    edges: graph.edges,
    metadata: graph.metadata,
  };
}

/**
 * Deserialize a plain object back into a DiscourseGraph.
 */
export function deserializeGraph(raw: {
  bits: DiscourseBit[];
  relationships: DiscourseRelationship[];
  edges: DiscourseEdge[];
  metadata: DiscourseGraph["metadata"];
}): DiscourseGraph {
  const bits = new Map<string, DiscourseBit>();
  for (const b of raw.bits) bits.set(b.id, b);
  return {
    bits,
    relationships: raw.relationships,
    edges: raw.edges,
    metadata: raw.metadata,
  };
}
