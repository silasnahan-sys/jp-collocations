import type {
  DiscourseBit,
  DiscourseEdge,
  DiscourseGraph,
  DiscourseRelationshipType,
  TranscriptChunk,
  PatternRule,
  PatternMatch,
  AnalysisContext,
  DiscourseCascade,
} from "./discourse-types.ts";
import { RelationshipRegistry, PatternRegistry } from "./discourse-types.ts";
import { buildSeedRegistry } from "./seed-patterns.ts";

let _bitCounter = 0;
let _edgeCounter = 0;
let _graphCounter = 0;
let _chunkCounter = 0;
let _cascadeCounter = 0;

function bitId(): string { return `bit_${++_bitCounter}_${Date.now()}`; }
function edgeId(): string { return `edge_${++_edgeCounter}_${Date.now()}`; }
function graphId(): string { return `graph_${++_graphCounter}_${Date.now()}`; }
function chunkId(): string { return `chunk_${++_chunkCounter}_${Date.now()}`; }
function cascadeId(): string { return `cascade_${++_cascadeCounter}_${Date.now()}`; }

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

// ─── Main analyzer class ───────────────────────────────────────────────────────

export class DiscourseAnalyzer {
  private registry: PatternRegistry;

  constructor(registry?: PatternRegistry) {
    this.registry = registry ?? buildSeedRegistry();
  }

  /**
   * Parse a raw annotated string (with || delimiters) into a DiscourseGraph.
   * Optionally pass a timestamp string (e.g. "[08:15]").
   */
  analyze(raw: string, timestamp?: string, source = "manual"): DiscourseGraph {
    const segments = splitBits(raw);
    const texts = segments.map(s => s.text);

    // First pass: build stub bits so detectors have a full bit array
    const stubBits: DiscourseBit[] = segments.map((seg, i) => ({
      id: `stub_${i}`,
      text: seg.text,
      startOffset: seg.start,
      endOffset: seg.end,
      timestamp,
      bitType: "unknown" as const,
      morphemes: [],
      features: {},
    }));

    const context: AnalysisContext = {
      allBits: stubBits,
      allTexts: texts,
      graphSoFar: { bits: stubBits, edges: [] },
    };

    // Second pass: run detectors, build real bits
    const bits: DiscourseBit[] = segments.map((seg, i) => {
      const best = this.runDetectorsOnContext(stubBits, i, context);
      return {
        id: bitId(),
        text: seg.text,
        startOffset: seg.start,
        endOffset: seg.end,
        timestamp,
        bitType: (best?.rule.relationshipType ?? "unknown") as DiscourseRelationshipType | "unknown",
        morphemes: tokenize(seg.text),
        features: best?.match.features ?? {},
      };
    });

    const edges = this.buildEdges(bits, texts);
    const cascades = this.detectCascades(bits, edges);

    return {
      id: graphId(),
      bits,
      edges,
      cascades,
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
      const tsMatch = line.match(/^\[(\d+:\d+)\]\s*/);
      const timestamp = tsMatch ? `[${tsMatch[1]}]` : undefined;
      const raw = tsMatch ? line.slice(tsMatch[0].length) : line;

      if (!raw.includes("||") && raw.trim().length === 0) continue;

      const graph = this.analyze(raw, timestamp, source);
      chunks.push({
        id: chunkId(),
        raw,
        timestamp,
        bits: graph.bits,
        graph,
      });
    }

    return chunks;
  }

  /**
   * Run all registry rules (priority-sorted) against one bit position.
   * Returns the highest-confidence result and increments hitCount on winner.
   */
  private runDetectorsOnContext(
    bits: DiscourseBit[],
    index: number,
    context: AnalysisContext
  ): { rule: PatternRule; match: PatternMatch } | null {
    const rules = this.registry.getAll(); // sorted by priority desc
    let best: { rule: PatternRule; match: PatternMatch } | null = null;

    for (const rule of rules) {
      const result = rule.detector(bits, index, context);
      if (result && (!best || result.confidence > best.match.confidence)) {
        best = { rule, match: result };
      }
    }

    if (best) {
      best.rule.hitCount++;
    }

    return best;
  }

  private buildEdges(bits: DiscourseBit[], texts: string[]): DiscourseEdge[] {
    const edges: DiscourseEdge[] = [];
    const context: AnalysisContext = {
      allBits: bits,
      allTexts: texts,
      graphSoFar: { bits, edges: [] },
    };

    const rules = this.registry.getAll();

    for (let i = 0; i < bits.length; i++) {
      const current = bits[i];

      // Adjacent edge (always)
      if (i + 1 < bits.length) {
        edges.push(this.makeEdge(current, bits[i + 1], 1, "sequential-adjacency", 0.7, ["adjacent bits"]));
      }

      // Ask each rule if it finds a span-crossing edge
      for (const rule of rules) {
        const result = rule.detector(bits, i, context);
        if (!result) continue;

        if (result.targetIndex !== undefined && result.targetIndex !== i && result.targetIndex < bits.length) {
          const distance = Math.abs(result.targetIndex - i);
          // Only non-adjacent spans (adjacent already covered above)
          if (distance > 1) {
            edges.push(
              this.makeEdge(bits[i], bits[result.targetIndex], distance, rule.relationshipType as string, result.confidence, result.evidence)
            );
          }
        }
      }
    }

    return edges;
  }

  /** Find chains of 3+ connected non-adjacency edges and build DiscourseCascade objects. */
  detectCascades(bits: DiscourseBit[], edges: DiscourseEdge[]): DiscourseCascade[] {
    const cascades: DiscourseCascade[] = [];

    // Build adjacency: sourceId → outgoing semantic edges
    const adjMap = new Map<string, DiscourseEdge[]>();
    for (const edge of edges) {
      if (edge.relationshipType === "sequential-adjacency") continue;
      if (!adjMap.has(edge.sourceId)) adjMap.set(edge.sourceId, []);
      adjMap.get(edge.sourceId)!.push(edge);
    }

    const usedChains = new Set<string>();

    const dfs = (currentBitId: string, chain: DiscourseEdge[]): void => {
      const outEdges = adjMap.get(currentBitId) ?? [];

      for (const edge of outEdges) {
        chain.push(edge);

        if (chain.length >= 3) {
          const chainKey = chain.map(e => e.id).join("\0");
          if (!usedChains.has(chainKey)) {
            usedChains.add(chainKey);
            const types = chain.map(e => e.relationshipType as string);
            cascades.push({
              id: cascadeId(),
              relationships: chain.map(e => e.id),
              cascadeType: determineCascadeType(types),
              overallFunction: describeCascadeFunction(types),
            });
          }
        }

        dfs(edge.targetId, chain);
        chain.pop();
      }
    };

    for (const bit of bits) {
      dfs(bit.id, []);
    }

    return cascades;
  }

  private makeEdge(
    source: DiscourseBit,
    target: DiscourseBit,
    distance: number,
    type: string,
    confidence: number,
    evidence: string[]
  ): DiscourseEdge {
    return {
      id: edgeId(),
      sourceId: source.id,
      targetId: target.id,
      relationshipType: type,
      confidence,
      direction: "forward",
      bitDistance: distance,
      evidence,
      metadata: {},
    };
  }

  /** Register a new relationship type at runtime (keeps RelationshipRegistry in sync). */
  registerType(type: string): void {
    RelationshipRegistry.register(type);
  }

  /** Register a full PatternRule (and its type) at runtime. */
  registerRule(rule: PatternRule): void {
    this.registry.register(rule);
  }
}

// ─── Cascade helpers ──────────────────────────────────────────────────────────

function determineCascadeType(types: string[]): string {
  const typeSet = new Set(types);

  if (typeSet.has("epistemic-speculation-cascade") && typeSet.has("hedge-stance-softening")) {
    return "speculation-hedge-cascade";
  }
  if (typeSet.has("causal-concessive-cascade") && typeSet.has("connector-compounding")) {
    return "causal-connector-cascade";
  }
  if (typeSet.has("assertion-deflation") && typeSet.has("discourse-fade-trail-off")) {
    return "deflation-fade-cascade";
  }
  if (typeSet.has("extended-reasoning-stance-cap") && typeSet.has("perspective-framing")) {
    return "reasoning-perspective-cascade";
  }
  if (typeSet.has("epistemic-continuation-blend") && typeSet.has("epistemic-speculation-cascade")) {
    return "epistemic-blend-speculation-cascade";
  }
  if (typeSet.has("hedge-stance-softening") && typeSet.has("split-morpheme-co-construction")) {
    return "hedge-coconstruction-cascade";
  }

  const unique = [...new Set(types)];
  return unique.slice(0, 2).join("-") + "-cascade";
}

function describeCascadeFunction(types: string[]): string {
  const typeSet = new Set(types);

  if (typeSet.has("epistemic-speculation-cascade") && typeSet.has("hedge-stance-softening")) {
    return "Speaker builds layered epistemic hedging through speculation then stance softening";
  }
  if (typeSet.has("causal-concessive-cascade") && typeSet.has("connector-compounding")) {
    return "Stacked connectors navigate a causal-concessive argument while managing face";
  }
  if (typeSet.has("assertion-deflation") && typeSet.has("discourse-fade-trail-off")) {
    return "Confident assertion progressively deflated toward fade/trail-off for social harmony";
  }
  if (typeSet.has("extended-reasoning-stance-cap") && typeSet.has("perspective-framing")) {
    return "Extended reasoning framed by perspective and capped with evaluative stance";
  }
  if (typeSet.has("epistemic-continuation-blend") && typeSet.has("epistemic-speculation-cascade")) {
    return "Progressive epistemic certainty blended into broader speculation arc";
  }
  if (typeSet.has("hedge-stance-softening") && typeSet.has("split-morpheme-co-construction")) {
    return "Tentative stance co-constructed across bit boundaries";
  }

  const unique = [...new Set(types)];
  return `Emergent meaning from chained ${unique.join(", ")} relationships`;
}
