import type { DiscourseBit, DiscourseEdge, DiscourseGraph, TranscriptChunk } from "./discourse-types.ts";
import { RelationshipRegistry } from "./discourse-types.ts";

let _bitCounter = 0;
let _edgeCounter = 0;
let _graphCounter = 0;
let _chunkCounter = 0;

function bitId(): string { return `bit_${++_bitCounter}_${Date.now()}`; }
function edgeId(): string { return `edge_${++_edgeCounter}_${Date.now()}`; }
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
  // Split on common boundary characters while keeping tokens
  return text
    .split(/(?<=[はがをにでもとのへからまでよりか。、！？…])|(?=[はがをにでもとのへからまでよりか。、！？…])/)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

// ─── 13 relationship detectors ────────────────────────────────────────────────

interface DetectorResult {
  type: string;
  confidence: number;
  evidence: string;
  features: Record<string, string | number | boolean | string[]>;
}

type Detector = (bit: string, prev: string | null, next: string | null, allBits: string[]) => DetectorResult | null;

const DETECTORS: Record<string, Detector> = {
  /** 1. Hedge/Stance Softening — "ような感じ", "みたいな", "っぽい", "ようだ" */
  "hedge-stance-softening": (bit) => {
    if (/ような感じ|みたいな|っぽい|ようだ|ように|らしい|くらい|ぐらい/.test(bit)) {
      return { type: "hedge-stance-softening", confidence: 0.9, evidence: bit, features: { marker: "ような/みたいな/らしい" } };
    }
    return null;
  },

  /** 2. Split-Morpheme Co-construction — verb stem split across bits */
  "split-morpheme-co-construction": (bit, prev) => {
    // Detect verb-stem (no ending) + continuation in next
    if (prev && /[んいきしちにびみり]$/.test(prev.trim()) && /^[でてでても]/.test(bit.trim())) {
      return { type: "split-morpheme-co-construction", confidence: 0.8, evidence: `${prev}||${bit}`, features: { splitType: "verb-stem" } };
    }
    if (/[いきしちにびみり]$/.test(bit.trim())) {
      return { type: "split-morpheme-co-construction", confidence: 0.6, evidence: bit, features: { splitType: "potential-stem" } };
    }
    return null;
  },

  /** 3. Perspective Framing — "X的には", "的には", "的に" */
  "perspective-framing": (bit) => {
    if (/的には|的に|から見ると|としては|にとって|にとっては/.test(bit)) {
      return { type: "perspective-framing", confidence: 0.85, evidence: bit, features: { frameType: "perspective" } };
    }
    return null;
  },

  /** 4. Interactional Pivot — single short realisation marker あ, え, へえ, うん, そう */
  "interactional-pivot": (bit) => {
    const trimmed = bit.trim().replace(/[。、！？…]/g, "");
    if (/^(あ|え|えー|へえ|うん|そう|なるほど|ふーん|ほう|おー)$/.test(trimmed)) {
      return { type: "interactional-pivot", confidence: 0.95, evidence: bit, features: { marker: trimmed } };
    }
    return null;
  },

  /** 5. Epistemic-Continuation Blend — んでると, ているのに, ながら + certainty */
  "epistemic-continuation-blend": (bit) => {
    if (/んでると|てると確かに|ながら確かに|ているのに|てるのに確かに/.test(bit)) {
      return { type: "epistemic-continuation-blend", confidence: 0.85, evidence: bit, features: { blendType: "progressive-certainty" } };
    }
    return null;
  },

  /** 6. Discontinuous Parallel — があったり ... たりしてて (たり...たり pattern) */
  "discontinuous-parallel": (bit, _prev, _next, allBits) => {
    if (/があったり|[でし]たり/.test(bit)) {
      const hasPartner = allBits.some(b => b !== bit && /[でし]たり/.test(b));
      if (hasPartner) {
        return { type: "discontinuous-parallel", confidence: 0.9, evidence: bit, features: { pattern: "たり-たり" } };
      }
    }
    return null;
  },

  /** 7. Causal-Concessive Cascade — から...んだけど, から...が, ので...が */
  "causal-concessive-cascade": (bit, _prev, next) => {
    if (/から$|ので$/.test(bit.trim()) && next && /けど|が$|のに$/.test(next.trim())) {
      return { type: "causal-concessive-cascade", confidence: 0.85, evidence: `${bit} → ${next}`, features: { causalMarker: "から/ので", concedeMarker: "けど/が" } as Record<string, string | number | boolean | string[]> };
    }
    if (/んだけど|なんだけど|けれど/.test(bit)) {
      return { type: "causal-concessive-cascade", confidence: 0.75, evidence: bit, features: { causalMarker: "けど" } as Record<string, string | number | boolean | string[]> };
    }
    return null;
  },

  /** 8. Assertion-Deflation — sequential modifiers weakening: んじゃない → ? → みたいな */
  "assertion-deflation": (bit, prev) => {
    if (/んじゃない|んじゃないか|でしょ/.test(bit)) {
      return { type: "assertion-deflation", confidence: 0.8, evidence: bit, features: { deflationStage: "initial" } };
    }
    if (prev && /んじゃない/.test(prev) && /\?|みたいな|ような/.test(bit)) {
      return { type: "assertion-deflation", confidence: 0.9, evidence: `${prev}→${bit}`, features: { deflationStage: "progressive" } };
    }
    return null;
  },

  /** 9. Connector Compounding — ま、だからそれで言うと, そういえば, ところで */
  "connector-compounding": (bit) => {
    if (/^(ま、?だから|まあ、?だから|まあそれで|だからそれで|ところで|そういえば|それで言うと|ていうか、?つまり)/.test(bit.trim())) {
      return { type: "connector-compounding", confidence: 0.9, evidence: bit, features: { connectorType: "stacked-filler" } };
    }
    return null;
  },

  /** 10. Fuzzy Reference Chain — X + っぽいものとか, あたりの, その辺の */
  "fuzzy-reference-chain": (bit) => {
    if (/っぽいものとか|その辺の|あたりの|的なもの|みたいなもの|そういった/.test(bit)) {
      return { type: "fuzzy-reference-chain", confidence: 0.85, evidence: bit, features: { fuzzyMarker: "っぽい/その辺/あたり" } };
    }
    return null;
  },

  /** 11. Extended Reasoning → Stance Cap — わけだ, わけだけど, わけで */
  "extended-reasoning-stance-cap": (bit) => {
    if (/わけだ|わけだけど|わけで|わけです|わけじゃない/.test(bit)) {
      return { type: "extended-reasoning-stance-cap", confidence: 0.9, evidence: bit, features: { stanceCap: "わけ" } };
    }
    return null;
  },

  /** 12. Epistemic Speculation Cascade — きっと...のかもしれない, たぶん...かも */
  "epistemic-speculation-cascade": (bit, _prev, _next, allBits) => {
    if (/^きっと|^たぶん|^もしかして/.test(bit.trim())) {
      const hasClose = allBits.some(b => /のかもしれない|かもしれない|かも/.test(b));
      return {
        type: "epistemic-speculation-cascade",
        confidence: hasClose ? 0.9 : 0.65,
        evidence: bit,
        features: { speculationAnchor: bit.trim(), hasClosure: hasClose } as Record<string, string | number | boolean | string[]>,
      };
    }
    if (/のかもしれない|かもしれない$/.test(bit.trim())) {
      return { type: "epistemic-speculation-cascade", confidence: 0.85, evidence: bit, features: { speculationClose: true } as Record<string, string | number | boolean | string[]> };
    }
    return null;
  },

  /** 13. Discourse Fade/Trail-off — == marker or sentence-ending …, trail particles */
  "discourse-fade-trail-off": (bit) => {
    if (/==|…$|…。$|ね。$|よね。$|かな。$|だけど。$/.test(bit.trim())) {
      return { type: "discourse-fade-trail-off", confidence: 0.95, evidence: bit, features: { fadeMarker: "==/…/ね" } };
    }
    return null;
  },
};

// ─── Main analyzer class ───────────────────────────────────────────────────────

export class DiscourseAnalyzer {
  /**
   * Parse a raw annotated string (with || delimiters) into a DiscourseGraph.
   * Optionally pass a timestamp string (e.g. "[08:15]").
   */
  analyze(raw: string, timestamp?: string, source = "manual"): DiscourseGraph {
    const segments = splitBits(raw);
    const texts = segments.map(s => s.text);

    const bits: DiscourseBit[] = segments.map((seg, i) => {
      const detected = this.detectBitType(seg.text, texts[i - 1] ?? null, texts[i + 1] ?? null, texts);
      return {
        id: bitId(),
        text: seg.text,
        startOffset: seg.start,
        endOffset: seg.end,
        timestamp,
        bitType: detected?.type ?? "unknown",
        morphemes: tokenize(seg.text),
        features: detected?.features ?? {},
      };
    });

    const edges = this.buildEdges(bits, texts);

    return {
      id: graphId(),
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

  private detectBitType(
    text: string,
    prev: string | null,
    next: string | null,
    all: string[]
  ): DetectorResult | null {
    let best: DetectorResult | null = null;
    for (const detector of Object.values(DETECTORS)) {
      const result = detector(text, prev, next, all);
      if (result && (!best || result.confidence > best.confidence)) {
        best = result;
      }
    }
    return best;
  }

  private buildEdges(bits: DiscourseBit[], _texts: string[]): DiscourseEdge[] {
    const edges: DiscourseEdge[] = [];

    for (let i = 0; i < bits.length; i++) {
      const current = bits[i];

      // Adjacent edge (always)
      if (i + 1 < bits.length) {
        const next = bits[i + 1];
        edges.push(this.makeEdge(current, next, 1, "sequential-adjacency", 0.7, "adjacent bits"));
      }

      // Detect discontinuous parallels (たり...たり)
      if (current.bitType === "discontinuous-parallel") {
        for (let j = i + 2; j < bits.length; j++) {
          if (bits[j].bitType === "discontinuous-parallel") {
            edges.push(this.makeEdge(current, bits[j], j - i, "discontinuous-parallel", 0.85, "たり-たり span"));
            break;
          }
        }
      }

      // Speculation cascade: anchor → closure
      if (/^きっと|^たぶん/.test(current.text.trim())) {
        for (let j = i + 1; j < bits.length; j++) {
          if (/のかもしれない|かもしれない/.test(bits[j].text)) {
            edges.push(this.makeEdge(current, bits[j], j - i, "epistemic-speculation-cascade", 0.9, "speculation span"));
            break;
          }
        }
      }

      // Causal chain: から → けど
      if (/から$|ので$/.test(current.text.trim())) {
        if (i + 1 < bits.length && /けど|が$/.test(bits[i + 1].text.trim())) {
          edges.push(this.makeEdge(current, bits[i + 1], 1, "causal-concessive-cascade", 0.88, "から→けど"));
        }
      }
    }

    return edges;
  }

  private makeEdge(
    source: DiscourseBit,
    target: DiscourseBit,
    distance: number,
    type: string,
    confidence: number,
    evidence: string
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

  /** Register a new relationship type at runtime. */
  registerType(type: string): void {
    RelationshipRegistry.register(type);
  }
}
