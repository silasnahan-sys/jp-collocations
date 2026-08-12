/**
 * citation-l5.ts — Cross-turn / cross-sentence chain detector and
 * SourceGraph builder.
 *
 * Walks the whole transcript's stacks linearly, threading citation chains
 * by surface overlap, footing continuity, and orientation cues. Produces
 * a SourceGraph for visualization.
 */

import type {
  ChainKind,
  CitationChain,
  CitationStack,
  Footing,
  SourceGraph,
  SourceGraphEdge,
  SourceGraphNode,
} from './citation-types';

interface Turn {
  speakerId: string;
  stacks: CitationStack[];
}

export interface L5Input {
  /** Speaker turn boundaries, with their stacks. Pass [{speakerId:'_', stacks: allStacks}] for unsegmented. */
  turns: Turn[];
}

/** Surface bigram overlap count between two strings (cheap chain signal). */
function bigramOverlap(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const set = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) set.add(a.slice(i, i + 2));
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) if (set.has(b.slice(i, i + 2))) hits++;
  return hits;
}

function chainKindFor(prevFooting: Footing, nextFooting: Footing, isCrossTurn: boolean): ChainKind {
  if (prevFooting === nextFooting && (prevFooting === 'self-now' || prevFooting === 'self-prior')) return 'self-echo';
  if (isCrossTurn) return 'other-uptake';
  if (prevFooting === 'self-now' && (nextFooting === 'self-prior' || nextFooting === 'meta-discourse-voice')) return 'collaborative-reformulation';
  if (prevFooting === 'projected-third' && nextFooting === 'projected-third') return 'empathetic-projection';
  if (prevFooting === 'other-specific' && nextFooting === 'self-now') return 'accusation-defense';
  if (prevFooting === 'meta-discourse-voice' && nextFooting === 'meta-discourse-voice') return 'reification-ladder';
  return 'collaborative-reformulation';
}

function deriveVoiceId(footing: Footing, surface: string): string {
  if (footing === 'self-now' || footing === 'self-prior' || footing === 'self-counterfactual') return 'voice:self';
  if (footing === 'collective-volitional-self') return 'voice:collective-self';
  if (footing === 'institutional') return 'voice:institutional';
  if (footing === 'anonymous-textual') return 'voice:anonymous-textual';
  if (footing === 'other-generic') return 'voice:other-generic';
  if (footing === 'meta-discourse-voice') return 'voice:meta';
  if (footing === 'projected-third') return 'voice:projected:' + surface.slice(0, 8);
  if (footing === 'interlocutor-as-fictional-third') return 'voice:fictive-listener';
  if (footing === 'participant-observer') return 'voice:observer';
  // other-specific → key by surface stub
  return 'voice:other:' + surface.slice(0, 8);
}

export function classifyL5(input: L5Input): SourceGraph {
  const chains: CitationChain[] = [];
  const nodes = new Map<string, SourceGraphNode>();
  const edges: SourceGraphEdge[] = [];

  // Flatten: build a linear sequence of (turnIdx, siteRef).
  interface Ref { speakerId: string; site: CitationStack['sites'][number]; turnIdx: number; }
  const linear: Ref[] = [];
  input.turns.forEach((t, ti) => {
    for (const stk of t.stacks) {
      for (const s of stk.sites) {
        linear.push({ speakerId: t.speakerId, site: s, turnIdx: ti });
      }
    }
  });

  // Build voice nodes
  for (const ref of linear) {
    const vid = deriveVoiceId(ref.site.footing, ref.site.surface);
    if (!nodes.has(vid)) {
      nodes.set(vid, { voiceId: vid, footing: ref.site.footing, attestations: [] });
    }
    nodes.get(vid)!.attestations.push(ref.site.id);
  }

  // Chain detection: for each site, scan backwards up to N sites
  const WINDOW = 40;
  const BIGRAM_THRESHOLD = 3;
  const chainOf = new Map<string, string>(); // siteId → chainId

  for (let i = 0; i < linear.length; i++) {
    const cur = linear[i];
    let bestPrev: Ref | null = null;
    let bestScore = 0;
    for (let j = i - 1; j >= Math.max(0, i - WINDOW); j--) {
      const prev = linear[j];
      const score = bigramOverlap(cur.site.surface, prev.site.surface);
      // Also consider explicit orientation cues
      const boost = (cur.site.orientation === 'cross-turn-uptake' || cur.site.orientation === 'retrospective-proximate') ? 2 : 0;
      const total = score + boost;
      if (total > bestScore) { bestScore = total; bestPrev = prev; }
    }
    if (bestPrev && bestScore >= BIGRAM_THRESHOLD) {
      cur.site.uptake_target = bestPrev.site.id;
      bestPrev.site.uptake = cur.speakerId === bestPrev.speakerId ? 'self-uptake' : 'cross-turn-uptake';

      // Chain linkage
      const existing = chainOf.get(bestPrev.site.id);
      let chainId: string;
      if (existing) {
        chainId = existing;
        const c = chains.find(c => c.id === chainId)!;
        c.members.push(cur.site.id);
      } else {
        chainId = `chain:${chains.length + 1}`;
        chains.push({
          id: chainId,
          kind: chainKindFor(bestPrev.site.footing, cur.site.footing, cur.speakerId !== bestPrev.speakerId),
          members: [bestPrev.site.id, cur.site.id],
          anchorFooting: bestPrev.site.footing,
          closed: false,
        });
        chainOf.set(bestPrev.site.id, chainId);
      }
      chainOf.set(cur.site.id, chainId);
      cur.site.chainId = chainId;
      bestPrev.site.chainId = chainId;

      // Edge
      const fromV = deriveVoiceId(bestPrev.site.footing, bestPrev.site.surface);
      const toV = deriveVoiceId(cur.site.footing, cur.site.surface);
      const relation: SourceGraphEdge['relation'] =
        cur.site.cite_illoc === 'reformulate' ? 'reformulates' :
        cur.site.cite_illoc === 'accuse' ? 'accuses' :
        cur.site.cite_illoc === 'concede' ? 'defends' :
        cur.site.cite_illoc === 'recruit' ? 'recruits' :
        cur.speakerId !== bestPrev.speakerId ? 'uptakes' : 'cites';
      edges.push({ fromVoiceId: fromV, toVoiceId: toV, relation, siteId: cur.site.id });
    }
    cur.site.layerCompleted = 5;
    cur.site.confidence.l5 = bestScore >= BIGRAM_THRESHOLD ? 0.75 : 0.4;
  }

  // Close chains whose last member appears > 5 turns before end
  const lastTurnIdx = linear.length > 0 ? linear[linear.length - 1].turnIdx : 0;
  for (const c of chains) {
    const lastMember = c.members[c.members.length - 1];
    const ref = linear.find(r => r.site.id === lastMember);
    if (ref && lastTurnIdx - ref.turnIdx >= 5) c.closed = true;
  }

  return {
    nodes: Array.from(nodes.values()),
    edges,
    chains,
  };
}
