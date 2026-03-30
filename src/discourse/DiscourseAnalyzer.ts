// ============================================================
// DiscourseAnalyzer — detects all 13 relationship types
// between DiscourseBits extracted from a parsed transcript.
// ============================================================

import type {
  DiscourseBit,
  ParsedTranscript,
  DiscourseRelationship,
  DiscourseAnalysisResult,
  DiscourseGraph,
} from "./discourse-types.ts";
import { buildGraph } from "./DiscourseGraph.ts";
import { seedRegistry } from "./RelationshipRegistry.ts";

let _relCounter = 0;
function nextRelId(): string {
  return `rel_${++_relCounter}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---- Individual relationship detectors ----------------------------------

/** 1. Hedge / Stance Softening */
function detectHedge(
  bits: DiscourseBit[],
  i: number
): DiscourseRelationship | null {
  const target = bits[i];
  if (!target) return null;
  if (!/ような感じ|みたいな|らしい|っぽい感じ/.test(target.text)) return null;
  // Look back up to 3 bits for the assertion being hedged
  for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
    const src = bits[j];
    if (src.bitType !== "hedge" && src.bitType !== "boundary") {
      return {
        id: nextRelId(),
        type: "hedge_stance_softening",
        sourceBitId: src.id,
        targetBitId: target.id,
        strength: 0.9,
        evidence: [`"${src.text}" hedged by "${target.text}"`],
        metadata: { lookahead: i - j },
      };
    }
  }
  return null;
}

/** 2. Split-Morpheme Co-construction */
function detectSplitMorpheme(
  bits: DiscourseBit[],
  i: number
): DiscourseRelationship | null {
  const curr = bits[i];
  const next = bits[i + 1];
  if (!next) return null;
  // Verb-stem ending (e.g. 並ん) followed by concessive (でても)
  if (/[んで]$/.test(curr.text) && /^[でもて]/.test(next.text)) {
    return {
      id: nextRelId(),
      type: "split_morpheme_coconstruction",
      sourceBitId: curr.id,
      targetBitId: next.id,
      strength: 0.85,
      evidence: [`verb-stem "${curr.text}" continued in "${next.text}"`],
      metadata: {},
    };
  }
  return null;
}

/** 3. Perspective Framing */
function detectPerspectiveFraming(
  bits: DiscourseBit[],
  i: number
): DiscourseRelationship | null {
  const curr = bits[i];
  const next = bits[i + 1];
  if (!next) return null;
  if (/的$/.test(curr.text) && /^には?/.test(next.text)) {
    return {
      id: nextRelId(),
      type: "perspective_framing",
      sourceBitId: curr.id,
      targetBitId: next.id,
      strength: 0.95,
      evidence: [`"${curr.text}" + "${next.text}" = perspective frame`],
      metadata: {},
    };
  }
  return null;
}

/** 4. Interactional Pivot */
function detectInteractionalPivot(
  bits: DiscourseBit[],
  i: number
): DiscourseRelationship | null {
  const curr = bits[i];
  const next = bits[i + 1];
  if (!next) return null;
  if (/^[あええっうん]$/.test(curr.text.trim())) {
    return {
      id: nextRelId(),
      type: "interactional_pivot",
      sourceBitId: curr.id,
      targetBitId: next.id,
      strength: 1.0,
      evidence: [`pivot token "${curr.text}" precedes "${next.text}"`],
      metadata: {},
    };
  }
  return null;
}

/** 5. Epistemic-Continuation Blend */
function detectEpistemicContinuation(
  bits: DiscourseBit[],
  i: number
): DiscourseRelationship | null {
  const curr = bits[i];
  if (/んでると確かに|ながら確かに|てると/.test(curr.text)) {
    const next = bits[i + 1];
    if (!next) return null;
    return {
      id: nextRelId(),
      type: "epistemic_continuation_blend",
      sourceBitId: curr.id,
      targetBitId: next.id,
      strength: 0.8,
      evidence: [`epistemic-continuation bit "${curr.text}"`],
      metadata: {},
    };
  }
  return null;
}

/** 6. Discontinuous Parallel (たり...たり) */
function detectDiscontinuousParallel(
  bits: DiscourseBit[],
  i: number
): DiscourseRelationship | null {
  const src = bits[i];
  if (!/たり/.test(src.text)) return null;
  // Search forward (up to 8 bits) for a matching たり bit
  for (let j = i + 1; j < bits.length && j <= i + 8; j++) {
    if (/たり/.test(bits[j].text)) {
      return {
        id: nextRelId(),
        type: "discontinuous_parallel",
        sourceBitId: src.id,
        targetBitId: bits[j].id,
        strength: 0.9,
        evidence: [`たり enumeration: "${src.text}" ↔ "${bits[j].text}"`],
        metadata: { distance: j - i },
      };
    }
  }
  return null;
}

/** 7. Causal-Concessive Cascade */
function detectCausalConcessive(
  bits: DiscourseBit[],
  i: number
): DiscourseRelationship | null {
  const causal = bits[i];
  if (!/から$|ので$/.test(causal.text.trim())) return null;
  const action = bits[i + 1];
  const concessive = bits[i + 2];
  if (!action || !concessive) return null;
  if (/けど$|が$/.test(concessive.text.trim())) {
    return {
      id: nextRelId(),
      type: "causal_concessive_cascade",
      sourceBitId: causal.id,
      targetBitId: concessive.id,
      strength: 0.85,
      evidence: [
        `cascade: "${causal.text}" → "${action.text}" → "${concessive.text}"`,
      ],
      metadata: { middleBitId: action.id },
    };
  }
  return null;
}

/** 8. Assertion-Deflation */
function detectAssertionDeflation(
  bits: DiscourseBit[],
  i: number
): DiscourseRelationship | null {
  const curr = bits[i];
  if (!/んじゃない/.test(curr.text)) return null;
  const next = bits[i + 1];
  if (!next) return null;
  if (/みたいな|っていう|かな/.test(next.text)) {
    // Find the original assertion (look back up to 4)
    const origin = bits[Math.max(0, i - 3)];
    return {
      id: nextRelId(),
      type: "assertion_deflation",
      sourceBitId: origin.id,
      targetBitId: next.id,
      strength: 0.88,
      evidence: [
        `assertion starting at "${origin.text}" deflated to "${next.text}"`,
      ],
      metadata: { deflationAnchorId: curr.id },
    };
  }
  return null;
}

/** 9. Connector Compounding */
function detectConnectorCompounding(
  bits: DiscourseBit[],
  i: number
): DiscourseRelationship | null {
  const curr = bits[i];
  // Stacked connectors: contains two or more of: ま, だから, それで, で言うと
  const connectorCount = [
    /^ま[あ]?/.test(curr.text),
    /だから/.test(curr.text),
    /それで/.test(curr.text),
    /で言うと/.test(curr.text),
    /というか/.test(curr.text),
  ].filter(Boolean).length;
  if (connectorCount < 2) return null;
  const next = bits[i + 1];
  if (!next) return null;
  return {
    id: nextRelId(),
    type: "connector_compounding",
    sourceBitId: curr.id,
    targetBitId: next.id,
    strength: 0.92,
    evidence: [`stacked connectors in "${curr.text}" (count=${connectorCount})`],
    metadata: { connectorCount },
  };
}

/** 10. Fuzzy Reference Chain */
function detectFuzzyReference(
  bits: DiscourseBit[],
  i: number
): DiscourseRelationship | null {
  const curr = bits[i];
  const next = bits[i + 1];
  if (!next) return null;
  const currFuzzy = /っぽい|とか|その辺|あたり|など/.test(curr.text);
  const nextFuzzy = /っぽい|とか|その辺|あたり|など/.test(next.text);
  if (currFuzzy && nextFuzzy) {
    return {
      id: nextRelId(),
      type: "fuzzy_reference_chain",
      sourceBitId: curr.id,
      targetBitId: next.id,
      strength: 0.8,
      evidence: [`fuzzy chain: "${curr.text}" → "${next.text}"`],
      metadata: {},
    };
  }
  if (currFuzzy) {
    return {
      id: nextRelId(),
      type: "fuzzy_reference_chain",
      sourceBitId: curr.id,
      targetBitId: next.id,
      strength: 0.65,
      evidence: [`fuzzy ref: "${curr.text}"`],
      metadata: {},
    };
  }
  return null;
}

/** 11. Extended Reasoning → Stance Cap */
function detectExtendedReasoning(
  bits: DiscourseBit[],
  i: number
): DiscourseRelationship | null {
  const cap = bits[i];
  if (!/わけだけど|わけで|ということで|ということだ/.test(cap.text)) return null;
  // The source is the bit furthest back before this cap that isn't a connector
  let j = i - 1;
  while (j >= 0 && bits[j].bitType === "connector") j--;
  if (j < 0 || j === i) return null;
  const src = bits[j];
  return {
    id: nextRelId(),
    type: "extended_reasoning_stance_cap",
    sourceBitId: src.id,
    targetBitId: cap.id,
    strength: 0.87,
    evidence: [`reasoning "${src.text}" capped by "${cap.text}"`],
    metadata: { reasoningLength: i - j },
  };
}

/** 12. Epistemic Speculation Cascade */
function detectEpistemicSpeculation(
  bits: DiscourseBit[],
  i: number
): DiscourseRelationship | null {
  const start = bits[i];
  if (!/^きっと$|^たぶん$|^おそらく$/.test(start.text.trim())) return null;
  // Find terminal bit: のかもしれない, だろう, でしょう within 8 bits
  for (let j = i + 1; j < bits.length && j <= i + 8; j++) {
    if (/のかもしれない|かもしれない|だろう|でしょう/.test(bits[j].text)) {
      return {
        id: nextRelId(),
        type: "epistemic_speculation_cascade",
        sourceBitId: start.id,
        targetBitId: bits[j].id,
        strength: 0.93,
        evidence: [
          `speculation from "${start.text}" to "${bits[j].text}" (${j - i} bits)`,
        ],
        metadata: { cascadeLength: j - i },
      };
    }
  }
  return null;
}

/** 13. Discourse Fade / Trail-off */
function detectDiscourseFade(
  bits: DiscourseBit[],
  i: number
): DiscourseRelationship | null {
  const curr = bits[i];
  if (curr.bitType !== "boundary") return null;
  if (i === 0) return null;
  const prev = bits[i - 1];
  return {
    id: nextRelId(),
    type: "discourse_fade_trailoff",
    sourceBitId: prev.id,
    targetBitId: curr.id,
    strength: 1.0,
    evidence: [`fade marker "${curr.text}" follows "${prev.text}"`],
    metadata: {},
  };
}

// ---- Detector pipeline --------------------------------------------------

type Detector = (bits: DiscourseBit[], i: number) => DiscourseRelationship | null;

const DETECTORS: Detector[] = [
  detectHedge,
  detectSplitMorpheme,
  detectPerspectiveFraming,
  detectInteractionalPivot,
  detectEpistemicContinuation,
  detectDiscontinuousParallel,
  detectCausalConcessive,
  detectAssertionDeflation,
  detectConnectorCompounding,
  detectFuzzyReference,
  detectExtendedReasoning,
  detectEpistemicSpeculation,
  detectDiscourseFade,
];

/** Register an additional detector at runtime (endlessly expandable). */
export function registerDetector(fn: Detector): void {
  DETECTORS.push(fn);
}

// ---- Public API ----------------------------------------------------------

/**
 * Analyze all bits and return every detected relationship.
 */
export function detectRelationships(bits: DiscourseBit[]): DiscourseRelationship[] {
  _relCounter = 0;
  const relationships: DiscourseRelationship[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < bits.length; i++) {
    for (const detector of DETECTORS) {
      const rel = detector(bits, i);
      if (!rel) continue;
      const key = `${rel.type}:${rel.sourceBitId}:${rel.targetBitId}`;
      if (!seen.has(key)) {
        seen.add(key);
        relationships.push(rel);
      }
    }
  }
  return relationships;
}

/**
 * Full analysis pipeline:
 *   1. Seed the registry (idempotent)
 *   2. Detect all relationships from a ParsedTranscript
 *   3. Build a DiscourseGraph
 *   4. Produce a DiscourseAnalysisResult with summary statistics
 */
export function analyzeTranscript(transcript: ParsedTranscript): DiscourseAnalysisResult {
  seedRegistry();

  const relationships = detectRelationships(transcript.allBits);
  const graph: DiscourseGraph = buildGraph(transcript, relationships);

  // Summary stats
  const relationshipTypeCounts: Record<string, number> = {};
  for (const rel of relationships) {
    relationshipTypeCounts[rel.type] = (relationshipTypeCounts[rel.type] ?? 0) + 1;
  }

  const topRelationships = [...relationships]
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 10);

  const bitTypeDistribution: Record<string, number> = {};
  for (const bit of transcript.allBits) {
    bitTypeDistribution[bit.bitType] =
      (bitTypeDistribution[bit.bitType] ?? 0) + 1;
  }

  return {
    graph,
    transcript,
    summary: { relationshipTypeCounts, topRelationships, bitTypeDistribution },
  };
}
