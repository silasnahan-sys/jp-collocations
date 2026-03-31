import type {
  AnalysisContext,
  CascadeArc,
  DiscourseBit,
  DiscourseEdge,
  DiscourseGraph,
  PatternMatch,
  TranscriptChunk,
} from "./discourse-types.ts";
import { RelationshipRegistry, STRENGTH } from "./discourse-types.ts";
import type { PatternRegistry } from "./discourse-types.ts";
import {
  assessAssertionStrength,
  buildSeedRegistry,
  buildSpeculationArc,
} from "./seed-patterns.ts";

let _bitCounter   = 0;
let _edgeCounter  = 0;
let _graphCounter = 0;
let _chunkCounter = 0;

function bitId():   string { return `bit_${++_bitCounter}_${Date.now()}`; }
function edgeId():  string { return `edge_${++_edgeCounter}_${Date.now()}`; }
function graphId(): string { return `graph_${++_graphCounter}_${Date.now()}`; }
function chunkId(): string { return `chunk_${++_chunkCounter}_${Date.now()}`; }

/**
 * Split raw annotated text on `||` markers and return an array of non-empty
 * segments with their offsets in the original string.
 */
function splitBits(raw: string): Array<{ text: string; start: number; end: number }> {
  const segments: Array<{ text: string; start: number; end: number }> = [];
  const parts = raw.split("||");
  let offset = 0;
  for (const part of parts) {
    if (part.trim().length > 0) {
      segments.push({ text: part, start: offset, end: offset + part.length });
    }
    offset += part.length + 2; // +2 for "||"
  }
  return segments;
}

/** Very lightweight Japanese morpheme splitter (no external lib). */
function tokenize(text: string): string[] {
  return text
    .split(/(?<=[はがをにでもとのへからまでよりか。、！？…])|(?=[はがをにでもとのへからまでよりか。、！？…])/)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

/**
 * Safely extract a numeric value from a feature bag, returning `undefined`
 * if the key is missing or not a number.
 */
function numericFeature(
  features: Record<string, string | number | boolean | string[]>,
  key: string,
): number | undefined {
  const v = features[key];
  return typeof v === "number" ? v : undefined;
}

// ─── Edge confidence constants ────────────────────────────────────────────────
const EDGE_MAX_CONFIDENCE         = 0.99;
const EDGE_SPECULATION_BASE       = 0.88;
const EDGE_SPECULATION_COMPLEXITY = 0.10;

/**
 * Run all rules in `registry` against the bit at `index` and return the
 * highest-confidence PatternMatch (or null if nothing fires).
 */
function runDetectorsOnContext(
  bits: DiscourseBit[],
  index: number,
  context: AnalysisContext,
  registry: PatternRegistry,
): { ruleId: string; match: PatternMatch } | null {
  let best: { ruleId: string; match: PatternMatch } | null = null;
  for (const rule of registry.all()) {
    const match = rule.detector(bits, index, context);
    if (match && (!best || match.confidence > best.match.confidence)) {
      best = { ruleId: rule.id, match };
    }
  }
  return best;
}

// ─── Main analyzer class ───────────────────────────────────────────────────────

export class DiscourseAnalyzer {
  private readonly registry: PatternRegistry;

  constructor(registry?: PatternRegistry) {
    this.registry = registry ?? buildSeedRegistry();
  }

  /**
   * Parse a raw annotated string (with || delimiters) into a DiscourseGraph.
   * Uses a two-pass approach: first build stub bits, then run detectors.
   */
  analyze(raw: string, timestamp?: string, source = "manual"): DiscourseGraph {
    const segments = splitBits(raw);
    const context: AnalysisContext = { source };

    // ── Pass 1: stub bits (bitType unknown, no features) ──────────────────────
    const bits: DiscourseBit[] = segments.map(seg => ({
      id:          bitId(),
      text:        seg.text,
      startOffset: seg.start,
      endOffset:   seg.end,
      timestamp,
      bitType:     "unknown" as const,
      morphemes:   tokenize(seg.text),
      features:    {},
    }));

    // ── Pass 2: run detectors, update each bit in place ───────────────────────
    for (let i = 0; i < bits.length; i++) {
      const result = runDetectorsOnContext(bits, i, context, this.registry);
      if (result) {
        const { ruleId, match } = result;
        bits[i].bitType  = ruleId;
        bits[i].features = { ...match.features };

        // Lift strength fields from the features bag onto the bit itself
        bits[i].assertionStrength = numericFeature(match.features, "assertionStrength");
        bits[i].fuzziness         = numericFeature(match.features, "fuzziness");
        bits[i].speculationLevel  = numericFeature(match.features, "speculationLevel");
      }
    }

    const edges = this.buildEdges(bits);

    return {
      id:        graphId(),
      bits,
      edges,
      source,
      timestamp,
      createdAt: Date.now(),
    };
  }

  /** Parse a full transcript into chunks, one per timestamped line. */
  parseTranscript(transcript: string, source = "transcript"): TranscriptChunk[] {
    const chunks: TranscriptChunk[] = [];
    const lines = transcript.split("\n").map(l => l.trim()).filter(Boolean);

    for (const line of lines) {
      const tsMatch  = line.match(/^\[(\d+:\d+)\]\s*/);
      const timestamp = tsMatch ? `[${tsMatch[1]}]` : undefined;
      const raw       = tsMatch ? line.slice(tsMatch[0].length) : line;

      if (!raw.includes("||") && raw.trim().length === 0) continue;

      const graph = this.analyze(raw, timestamp, source);
      chunks.push({
        id: chunkId(),
        raw,
        timestamp,
        bits:  graph.bits,
        graph,
      });
    }

    return chunks;
  }

  private buildEdges(bits: DiscourseBit[]): DiscourseEdge[] {
    const edges: DiscourseEdge[] = [];
    const texts = bits.map(b => b.text);

    for (let i = 0; i < bits.length; i++) {
      const current = bits[i];

      // ── Sequential adjacency (always) ─────────────────────────────────────
      if (i + 1 < bits.length) {
        edges.push(this.makeEdge(current, bits[i + 1], 1, "sequential-adjacency", 0.7, "adjacent bits"));
      }

      // ── Discontinuous parallel spans ──────────────────────────────────────
      if (current.bitType === "discontinuous-parallel") {
        const partnerIndices = current.features["partnerIndices"];
        const partners: number[] = typeof partnerIndices === "string" && partnerIndices !== ""
          ? partnerIndices.split(",").map(Number).filter(n => !isNaN(n))
          : [];
        for (const j of partners) {
          if (j > i && j < bits.length) {
            const span = j - i;
            edges.push(this.makeEdge(
              current, bits[j], span,
              "discontinuous-parallel",
              Math.min(0.95, 0.82 + span * 0.02),
              `${current.features["pattern"] ?? "parallel"} span`,
            ));
          }
        }
      }

      // ── Epistemic speculation cascade arc ─────────────────────────────────
      const anchorRx = /^(?:きっと|たぶん|多分|おそらく|もしかしたら|もしかして|ひょっとしたら|ひょっとして|もしかすると)/;
      if (anchorRx.test(current.text.trim())) {
        const arc: CascadeArc | null = buildSpeculationArc(texts, i);
        if (arc) {
          edges.push(this.makeEdge(
            current, bits[arc.closureIndex],
            arc.intermediateCount + 1,
            "epistemic-speculation-cascade",
            Math.min(EDGE_MAX_CONFIDENCE, EDGE_SPECULATION_BASE + arc.complexity * EDGE_SPECULATION_COMPLEXITY),
            `speculation arc: ${arc.anchorText}→[${arc.intermediateCount} bits]→${arc.closureText}`,
          ));
        }
      }

      // ── Causal-concessive 3-bit chain ─────────────────────────────────────
      const causalRx  = /(?:から|ので|ために|おかげで|せいで)$/;
      const concedeRx = /(?:けど|けれど|けれども|が|のに|でも|それでも)(?:。|、|$)/;
      if (causalRx.test(current.text.trim()) && i + 2 < bits.length) {
        const capBit = bits[i + 2];
        if (concedeRx.test(capBit.text.trim())) {
          edges.push(this.makeEdge(
            current, capBit, 2,
            "causal-concessive-cascade",
            0.88,
            `から→action→けど chain`,
          ));
        }
      }

      // ── Perspective framing scope ─────────────────────────────────────────
      if (current.bitType === "perspective-framing") {
        for (let j = i + 1; j < Math.min(i + 6, bits.length); j++) {
          const b = bits[j];
          if (b.bitType === "perspective-framing" || /。$/.test(b.text.trim())) break;
          edges.push(this.makeEdge(
            current, b, j - i,
            "perspective-framing",
            Math.max(0.5, 0.82 - (j - i) * 0.08),
            `perspective scope bit ${j - i}`,
          ));
        }
      }

      // ── Connector-compounding → content bridging ──────────────────────────
      if (current.bitType === "connector-compounding" && i + 1 < bits.length) {
        const next = bits[i + 1];
        if (next.bitType === "fuzzy-reference-chain" || next.bitType === "extended-reasoning-stance-cap") {
          edges.push(this.makeEdge(
            current, next, 1,
            "connector-compounding",
            0.80,
            `connector stack bridges to ${next.bitType}`,
          ));
        }
      }

      // ── Hedge follows strong assertion ────────────────────────────────────
      if (current.bitType === "hedge-stance-softening" && i > 0) {
        const prevBit     = bits[i - 1];
        const prevStrength = assessAssertionStrength(prevBit.text);
        if (prevStrength >= STRENGTH.STRONG) {
          edges.push(this.makeEdge(
            prevBit, current, 1,
            "hedge-stance-softening",
            0.90,
            `strong assertion (${prevStrength}) → hedge`,
          ));
        }
      }

      // ── Assertion-deflation chain ─────────────────────────────────────────
      if (current.bitType === "assertion-deflation" && i + 1 < bits.length) {
        const next = bits[i + 1];
        if (next.bitType === "assertion-deflation" || next.bitType === "hedge-stance-softening"
            || next.bitType === "discourse-fade-trail-off") {
          edges.push(this.makeEdge(
            current, next, 1,
            "assertion-deflation",
            0.85,
            `deflation chain: ${current.features["deflationStage"]} → ${next.bitType}`,
          ));
        }
      }
    }

    return edges;
  }

  private makeEdge(
    source:     DiscourseBit,
    target:     DiscourseBit,
    distance:   number,
    type:       string,
    confidence: number,
    evidence:   string,
  ): DiscourseEdge {
    return {
      id:               edgeId(),
      sourceId:         source.id,
      targetId:         target.id,
      relationshipType: type,
      confidence,
      direction:        "forward",
      bitDistance:      distance,
      evidence,
      metadata:         {},
    };
  }

  /** Register a new relationship type at runtime. */
  registerType(type: string): void {
    RelationshipRegistry.register(type);
  }
}
