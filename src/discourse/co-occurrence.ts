/**
 * co-occurrence.ts — Co-occurrence constellation analysis engine
 *
 * From PR#11: Analyzes which discourse markers tend to appear together,
 * building "constellation" graphs that reveal a writer/speaker's
 * rhetorical habits.
 *
 * Key insights:
 *   - A speaker who uses 確かに almost always follows with でも (concession→rebuttal)
 *   - YT transcript hosts tend to cluster フィラー patterns (えーと, なんか, まあ)
 *   - Academic writing clusters 論理展開 patterns (したがって, すなわち)
 *   - High co-occurrence of ヘッジ markers indicates tentative speaking style
 */

import type { PatternMatch } from './discourse-grammar';
import { PATTERN_BY_ID, type DiscoursePatternDef } from './discourse-patterns';

// ── Types ────────────────────────────────────────────────────

export interface ConstellationNode {
  patternId: string;
  surface: string;
  /** How many times this pattern appears in the corpus */
  frequency: number;
  /** Connected nodes (co-occurring patterns) */
  connections: ConstellationEdge[];
}

export interface ConstellationEdge {
  /** The other pattern's ID */
  targetId: string;
  /** Raw co-occurrence count */
  count: number;
  /**
   * Pointwise Mutual Information (PMI) — how much more they co-occur
   * than expected by chance. > 0 = positive association.
   */
  pmi: number;
  /** Average distance (in characters) between the two patterns */
  avgDistance: number;
  /** Whether target typically appears before or after this node */
  direction: 'before' | 'after' | 'mixed';
}

export interface Constellation {
  nodes: Map<string, ConstellationNode>;
  totalUtterances: number;
  /** Top clustered groups of markers */
  clusters: ConstellationCluster[];
}

export interface ConstellationCluster {
  /** Pattern IDs in this cluster */
  members: string[];
  /** Cluster label derived from dominant category/function */
  label: string;
  /** Intra-cluster average PMI */
  cohesion: number;
}

// ── Build constellation from matches ─────────────────────────

/**
 * Build a co-occurrence constellation from a corpus of analyzed utterances.
 * Each "utterance" represents one logical unit (sentence, paragraph, or
 * YT transcript segment).
 *
 * @param utteranceMatches - Array of match arrays (one per utterance)
 * @param windowSize - Maximum character distance for co-occurrence (default: 200)
 */
export function buildConstellation(
  utteranceMatches: PatternMatch[][],
  windowSize: number = 200,
): Constellation {
  const freq = new Map<string, number>();
  const pairCount = new Map<string, number>();
  const pairDistance = new Map<string, number[]>();
  const pairDirection = new Map<string, { before: number; after: number }>();

  const totalUtterances = utteranceMatches.length;

  for (const matches of utteranceMatches) {
    // Count frequencies per utterance (unique per utterance for PMI)
    const seen = new Set<string>();
    for (const m of matches) {
      if (!seen.has(m.pattern.id)) {
        freq.set(m.pattern.id, (freq.get(m.pattern.id) ?? 0) + 1);
        seen.add(m.pattern.id);
      }
    }

    // Count co-occurrences within window
    for (let i = 0; i < matches.length; i++) {
      for (let j = i + 1; j < matches.length; j++) {
        const dist = Math.abs(matches[j].offset - matches[i].offset);
        if (dist > windowSize) continue;

        const [a, b] = [matches[i].pattern.id, matches[j].pattern.id].sort();
        const key = `${a}|${b}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);

        if (!pairDistance.has(key)) pairDistance.set(key, []);
        pairDistance.get(key)!.push(dist);

        if (!pairDirection.has(key)) pairDirection.set(key, { before: 0, after: 0 });
        const dir = pairDirection.get(key)!;
        if (matches[i].pattern.id === a) {
          dir.after++;
        } else {
          dir.before++;
        }
      }
    }
  }

  // Build nodes
  const nodes = new Map<string, ConstellationNode>();
  for (const [id, count] of freq) {
    const pat = PATTERN_BY_ID.get(id);
    nodes.set(id, {
      patternId: id,
      surface: pat?.surface ?? id,
      frequency: count,
      connections: [],
    });
  }

  // Build edges with PMI
  for (const [key, count] of pairCount) {
    const [aId, bId] = key.split('|');
    const freqA = freq.get(aId) ?? 0;
    const freqB = freq.get(bId) ?? 0;

    if (freqA === 0 || freqB === 0 || totalUtterances === 0) continue;

    // PMI = log2(P(a,b) / (P(a) * P(b)))
    const pAB = count / totalUtterances;
    const pA = freqA / totalUtterances;
    const pB = freqB / totalUtterances;
    const pmi = Math.log2(pAB / (pA * pB));

    const distances = pairDistance.get(key) ?? [];
    const avgDist = distances.length > 0
      ? distances.reduce((s, d) => s + d, 0) / distances.length
      : 0;

    const dir = pairDirection.get(key) ?? { before: 0, after: 0 };
    const direction: 'before' | 'after' | 'mixed' =
      dir.before > dir.after * 2 ? 'before' :
      dir.after > dir.before * 2 ? 'after' : 'mixed';

    const edge: ConstellationEdge = {
      targetId: bId, count, pmi, avgDistance: avgDist, direction,
    };
    const edgeRev: ConstellationEdge = {
      targetId: aId, count, pmi, avgDistance: avgDist,
      direction: direction === 'before' ? 'after' : direction === 'after' ? 'before' : 'mixed',
    };

    nodes.get(aId)?.connections.push(edge);
    nodes.get(bId)?.connections.push(edgeRev);
  }

  // Sort connections by PMI
  for (const node of nodes.values()) {
    node.connections.sort((a, b) => b.pmi - a.pmi);
  }

  // Cluster detection (simple greedy: high-PMI connected components)
  const clusters = detectClusters(nodes);

  return { nodes, totalUtterances, clusters };
}

/**
 * Simple greedy clustering: repeatedly pick the highest-PMI edge and merge.
 */
function detectClusters(
  nodes: Map<string, ConstellationNode>,
): ConstellationCluster[] {
  const visited = new Set<string>();
  const clusters: ConstellationCluster[] = [];

  // Start from highest-frequency nodes
  const sorted = [...nodes.values()].sort((a, b) => b.frequency - a.frequency);

  for (const node of sorted) {
    if (visited.has(node.patternId)) continue;

    // BFS from this node, following high-PMI edges
    const cluster: string[] = [];
    const queue = [node.patternId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      cluster.push(current);

      const currentNode = nodes.get(current);
      if (!currentNode) continue;

      // Follow edges with PMI > 1 (strong positive association)
      for (const edge of currentNode.connections) {
        if (!visited.has(edge.targetId) && edge.pmi > 1.0) {
          queue.push(edge.targetId);
        }
      }
    }

    if (cluster.length >= 2) {
      // Label from dominant category
      const cats = new Map<string, number>();
      for (const id of cluster) {
        const pat = PATTERN_BY_ID.get(id);
        if (pat) {
          const cat = pat.categoryLabel;
          cats.set(cat, (cats.get(cat) ?? 0) + 1);
        }
      }
      const label = [...cats.entries()]
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? '混合';

      // Cohesion: average intra-cluster PMI
      let pmiSum = 0;
      let pmiCount = 0;
      for (const id of cluster) {
        const n = nodes.get(id);
        if (!n) continue;
        for (const e of n.connections) {
          if (cluster.includes(e.targetId)) {
            pmiSum += e.pmi;
            pmiCount++;
          }
        }
      }

      clusters.push({
        members: cluster,
        label,
        cohesion: pmiCount > 0 ? pmiSum / pmiCount : 0,
      });
    }
  }

  return clusters.sort((a, b) => b.cohesion - a.cohesion);
}

// ── Convenience queries ──────────────────────────────────────

/**
 * Get the N strongest associations for a given pattern.
 */
export function getStrongestAssociations(
  constellation: Constellation,
  patternId: string,
  limit: number = 5,
): ConstellationEdge[] {
  const node = constellation.nodes.get(patternId);
  if (!node) return [];
  return node.connections.slice(0, limit);
}

/**
 * Find patterns that form "bridge" connections between clusters.
 */
export function findBridgePatterns(constellation: Constellation): string[] {
  const clusterMap = new Map<string, number>();
  constellation.clusters.forEach((c, i) => {
    for (const id of c.members) clusterMap.set(id, i);
  });

  const bridges: string[] = [];
  for (const node of constellation.nodes.values()) {
    const nodeCluster = clusterMap.get(node.patternId);
    if (nodeCluster === undefined) continue;
    const crossCluster = node.connections.some(e => {
      const targetCluster = clusterMap.get(e.targetId);
      return targetCluster !== undefined && targetCluster !== nodeCluster;
    });
    if (crossCluster) bridges.push(node.patternId);
  }

  return bridges;
}
