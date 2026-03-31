import type { CascadeArc, DiscourseBit, DiscourseEdge, DiscourseGraph, RelationshipStrength, TranscriptChunk } from "./discourse-types.ts";
import { RelationshipRegistry, STRENGTH } from "./discourse-types.ts";

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
  return text
    .split(/(?<=[はがをにでもとのへからまでよりか。、！？…])|(?=[はがをにでもとのへからまでよりか。、！？…])/)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

// ─── Context helpers ──────────────────────────────────────────────────────────

/**
 * Assess how assertive a text segment is.
 * Returns a strength score 0.0 (fully hedged) – 1.0 (absolute certainty).
 */
function assessAssertionStrength(text: string): RelationshipStrength {
  // Absolute certainty markers
  if (/絶対|確実に|間違いなく|必ず|明らかに|当然|もちろん|確かに/.test(text)) return STRENGTH.ABSOLUTE;
  // Strong markers
  if (/やっぱり|やはり|確かに|たしかに|まさに|どうやら|そのまま|ちゃんと/.test(text)) return STRENGTH.STRONG;
  // Speculative / hedged markers — significantly lower strength
  if (/もしかして|ひょっとして|もしかしたら|ひょっとしたら/.test(text)) return STRENGTH.WEAK;
  // Explicit uncertainty markers
  if (/かもしれない|かも|だろう|でしょう|じゃないかな|のでは|のかな/.test(text)) return STRENGTH.WEAK + 0.05;
  // Soft hedge markers
  if (/かな|っぽい|みたいな|ような気がする|と思う|かなって/.test(text)) return STRENGTH.MODERATE - 0.1;
  // Default: moderate assertion
  return STRENGTH.MODERATE;
}

/**
 * Count approximation / vagueness markers in a text.
 * More markers = higher fuzziness score.
 */
function countApproximationMarkers(text: string): number {
  const markers = [
    /っぽい/, /みたいな/, /的な/, /ような/, /っぽいもの/, /みたいなやつ/,
    /とか/, /なんか/, /その辺/, /あたり/, /そういう/, /あれ/, /やつ/,
    /ああいう/, /そんな/, /こんな/, /どんな/, /くらい/, /ぐらい/, /なんとか/,
  ];
  return markers.reduce((n, rx) => n + (rx.test(text) ? 1 : 0), 0);
}

/**
 * Count stacked discourse connectors in a text.
 * Returns (count, array of matched connectors).
 */
function countStackedConnectors(text: string): { count: number; connectors: string[] } {
  const connectorPatterns: Array<[RegExp, string]> = [
    [/^ま[あ、,]?/, "ま"],        [/^まあ/, "まあ"],
    [/だから/, "だから"],         [/それで/, "それで"],
    [/言うと/, "言うと"],         [/つまり/, "つまり"],
    [/要するに/, "要するに"],     [/ただ/, "ただ"],
    [/でも/, "でも"],             [/やっぱり/, "やっぱり"],
    [/ちょっと/, "ちょっと"],     [/あと/, "あと"],
    [/そういえば/, "そういえば"], [/ていうか/, "ていうか"],
    [/んで/, "んで"],             [/で、/, "で"],
    [/というか/, "というか"],     [/なんか/, "なんか"],
  ];
  const found: string[] = [];
  for (const [rx, name] of connectorPatterns) {
    if (rx.test(text) && !found.includes(name)) found.push(name);
  }
  return { count: found.length, connectors: found };
}

/**
 * Scan `bits` starting from `startIndex` forward for any closure pattern of an
 * epistemic speculation cascade.  Returns the closing index or -1.
 */
function findSpeculationClosure(bits: string[], startIndex: number): number {
  const closureRx = /のかもしれない|かもしれない(?:ね|よ|けど)?$|かも(?:ね|しれない)?$|だろう(?:ね|か)?$|でしょう|ではないか|じゃないか(?:な)?$|のでは(?:ないか)?$|んじゃないかな$|じゃないかなあ?$/;
  for (let j = startIndex + 1; j < bits.length; j++) {
    if (closureRx.test(bits[j].trim())) return j;
  }
  return -1;
}

/**
 * Build a CascadeArc for a speculation cascade starting at `anchorIndex`.
 */
function buildSpeculationArc(bits: string[], anchorIndex: number): CascadeArc | null {
  const closureIndex = findSpeculationClosure(bits, anchorIndex);
  if (closureIndex === -1) return null;
  const intermediateCount = closureIndex - anchorIndex - 1;
  // Complexity scales with the number of intermediate bits (capped at 1.0)
  const complexity = Math.min(1.0, CASCADE_BASE_COMPLEXITY + intermediateCount * CASCADE_COMPLEXITY_PER_BIT);
  return {
    anchorIndex,
    closureIndex,
    anchorText: bits[anchorIndex],
    closureText: bits[closureIndex],
    intermediateCount,
    cascadeType: "epistemic-speculation",
    complexity,
  };
}

// ─── 13 relationship detectors ────────────────────────────────────────────────

/** Base complexity for speculation arc (minimum value). */
const CASCADE_BASE_COMPLEXITY = 0.3;
/** Complexity added per intermediate bit in a speculation cascade. */
const CASCADE_COMPLEXITY_PER_BIT = 0.12;
/** Fuzziness score added per approximation marker found. */
const FUZZINESS_PER_MARKER = 0.22;

interface DetectorResult {
  type: string;
  confidence: number;
  evidence: string;
  features: Record<string, string | number | boolean | string[]>;
  assertionStrength?: number;
  fuzziness?: number;
  speculationLevel?: number;
}

/**
 * Extended detector signature — receives the current bit index so detectors
 * can perform look-ahead / look-behind within the full bit array.
 */
type Detector = (
  bit: string,
  prev: string | null,
  next: string | null,
  allBits: string[],
  index: number,
) => DetectorResult | null;

const DETECTORS: Record<string, Detector> = {

  // ── 1. Hedge / Stance Softening ────────────────────────────────────────────
  /**
   * A hedge in this bit softens the preceding assertion.
   * Confidence is boosted when the preceding bit contains a strong assertion
   * marker, because the contrast makes the hedge more salient.
   */
  "hedge-stance-softening": (bit, prev) => {
    // Tier-1: prototypical hedge expressions (very high signal)
    const tier1 = /ような感じ|みたいな感じ|って感じ|っぽい感じ|ような気がする|かなっていう|だったかな(?:っていう)?|かなって|かなぁ/;
    // Tier-2: epistemic softeners
    const tier2 = /じゃないかな|と思う(?:けど)?|かもしれない|だろう(?:ね|か)?|でしょう|のかも|かもね|だろうな|でしょうね/;
    // Tier-3: vague adverbs and approximators
    const tier3 = /なんか.*って|ちょっと.*かな|一応.*けど|多分.*と思う|なんとなく|どうも|いちおう|なんか(?:ね|な)/;
    // Tier-4: classical hedge morphemes
    const tier4 = /らしい|ようだ|みたいだ|っぽい|らしき|ような|ようで|みたいで|っぽくて/;
    // Tier-5: discourse-hedging auxiliaries & particles
    const tier5 = /くらい|ぐらい|ほど|程度|くらいの|ぐらいの|だったっけ|っけ$/;

    const hasTier1 = tier1.test(bit);
    const hasTier2 = tier2.test(bit);
    const hasTier3 = tier3.test(bit);
    const hasTier4 = tier4.test(bit);
    const hasTier5 = tier5.test(bit);

    if (!hasTier1 && !hasTier2 && !hasTier3 && !hasTier4 && !hasTier5) return null;

    // Context: how strong was the preceding assertion?
    const prevStrength = prev ? assessAssertionStrength(prev) : STRENGTH.MODERATE;
    // A hedge after a strong assertion is highly salient
    const contrastBoost = prevStrength >= STRENGTH.STRONG ? 0.12 : 0.0;

    const baseConf = hasTier1 ? 0.92 : hasTier2 ? 0.85 : hasTier4 ? 0.82 : hasTier3 ? 0.78 : 0.72;
    const confidence = Math.min(0.99, baseConf + contrastBoost);

    const marker = hasTier1 ? "ような感じ/かなって/って感じ"
      : hasTier2 ? "と思う/かもしれない/だろう"
      : hasTier4 ? "らしい/ようだ/みたいだ/っぽい"
      : hasTier3 ? "なんか/ちょっと/多分"
      : "くらい/ぐらい";

    return {
      type: "hedge-stance-softening",
      confidence,
      evidence: bit,
      features: {
        marker,
        tier: hasTier1 ? 1 : hasTier2 ? 2 : hasTier4 ? 4 : hasTier3 ? 3 : 5,
        prevAssertionStrength: prevStrength,
        contrastBoost,
      },
      assertionStrength: STRENGTH.WEAK + (1 - confidence) * 0.3,
    };
  },

  // ── 2. Split-Morpheme Co-construction ─────────────────────────────────────
  /**
   * A single grammatical construction is SPLIT across multiple bits.
   * The bits are individually incomplete but form a whole together.
   */
  "split-morpheme-co-construction": (bit, prev) => {
    // Continuation morpheme at the START of this bit (prev bit has the stem)
    const contStartRx = /^(?:ても|でも|ながら|てから|てて|ちゃって|ちゃう|ておく|てみる|てしまう|てしまって|てある|ていた|ている|てた|てて|てく|でいる|でいた)/;
    // Verb stem at END of prev bit (incomplete form)
    const stemEndRx = /[んいきしちにびみり]$/;
    // Deictic/topic → case particle split
    const deicticCaseSplit = prev && /^(?:そこ|ここ|あそこ|それ|これ|あれ|どこ|どれ)$/.test(prev.trim())
      && /^[にはがをでとからまで]/.test(bit.trim());
    // て-form continuation
    const teFormContinuation = prev && stemEndRx.test(prev.trim()) && contStartRx.test(bit.trim());
    // ば-conditional split (stem ends in verb root, next starts with ば)
    const baConditional = prev && /[えきしちにびみり]$/.test(prev.trim()) && /^ば/.test(bit.trim());
    // たら split
    const taraConditional = prev && /た$|だ$/.test(prev.trim()) && /^ら/.test(bit.trim());
    // Auxiliary split: V-stem||ている, V-stem||てしまう, V-stem||ておく
    const auxSplit = prev && stemEndRx.test(prev.trim())
      && /^(?:ている|ていた|てしまう|てしまった|ておく|ておいた|てみる|てみた|てある|ていく|てきた)/.test(bit.trim());
    // Concessive split: V-stem||でも / V-stem||ても
    const concessive = prev && stemEndRx.test(prev.trim()) && /^(?:でも|ても)/.test(bit.trim());
    // Bare potential stem — incomplete form at the end of the current bit
    const potentialStem = !prev && stemEndRx.test(bit.trim());

    if (!teFormContinuation && !deicticCaseSplit && !baConditional && !taraConditional
        && !auxSplit && !concessive && !potentialStem) return null;

    let splitType: string;
    let confidence: number;
    if (teFormContinuation || auxSplit) {
      splitType = auxSplit ? "auxiliary-split" : "te-form-continuation";
      confidence = 0.88;
    } else if (deicticCaseSplit) {
      splitType = "deictic-case-split"; confidence = 0.85;
    } else if (concessive) {
      splitType = "concessive-split"; confidence = 0.83;
    } else if (baConditional) {
      splitType = "ba-conditional-split"; confidence = 0.80;
    } else if (taraConditional) {
      splitType = "tara-conditional-split"; confidence = 0.78;
    } else {
      splitType = "potential-stem"; confidence = 0.55;
    }

    return {
      type: "split-morpheme-co-construction",
      confidence,
      evidence: prev ? `${prev}||${bit}` : bit,
      features: { splitType },
    };
  },

  // ── 3. Perspective Framing ─────────────────────────────────────────────────
  /**
   * This bit establishes a perspective or evaluative standpoint from which
   * subsequent claims are to be understood.
   */
  "perspective-framing": (bit) => {
    // Tier-1: canonical perspective constructions with entity slot
    const tier1 = /[^\s]{1,10}的には|[^\s]{1,10}としては|[^\s]{1,10}にとっては|[^\s]{1,10}にしてみれば|[^\s]{1,10}から見れば|[^\s]{1,10}から言えば/;
    // Tier-2: bare perspective frames (no entity slot required)
    const tier2 = /的には|としては|にとって(?:は)?|から見ると|から言えば|の立場では|の観点からは|にしてみれば|の目から見ると|からすれば|の場合は|にすれば|として見れば|の視点から|から考えると|の感覚では|の目線では|にとってみれば/;
    // Tier-3: informal perspective markers
    const tier3 = /的に(?:は)?$|感覚的には|直感的には|経験的には|論理的には|客観的には|主観的には|個人的には/;

    const hasTier1 = tier1.test(bit);
    const hasTier2 = tier2.test(bit);
    const hasTier3 = tier3.test(bit);

    if (!hasTier1 && !hasTier2 && !hasTier3) return null;

    const confidence = hasTier1 ? 0.93 : hasTier2 ? 0.87 : 0.75;
    // Extract the entity before the frame marker (if any)
    const entityMatch = bit.match(/^(.{1,10})(?:的には|としては|にとっては|から見れば|から言えば)/);
    const entity = entityMatch ? entityMatch[1] : null;

    return {
      type: "perspective-framing",
      confidence,
      evidence: bit,
      features: {
        frameType: "perspective",
        entity: entity ?? "",
        tier: hasTier1 ? 1 : hasTier2 ? 2 : 3,
      },
    };
  },

  // ── 4. Interactional Pivot ─────────────────────────────────────────────────
  /**
   * Short response tokens that signal discourse reorientation — the speaker
   * has processed incoming information and is pivoting to a new direction.
   */
  "interactional-pivot": (bit, prev, next) => {
    const trimmed = bit.trim().replace(/[。、！？…～〜]/g, "");

    // Tier-1: pure realization / acknowledgement tokens (single token)
    const tier1Rx = /^(?:あ|ああ|あー|あ〜|あっ|え|えっ|えー|えっと|うん|ん|へえ|ほう|おお|おー|わあ|わー)$/;
    // Tier-2: compound acknowledgement / understanding tokens
    const tier2Rx = /^(?:なるほど|そっか|そうか|そうそう|あそうか|そうなの|うんうん|はいはい|ほーん|ふーん|ふむ|なるほどね|そうですか|へーそうか|あーそうか|そうだよね|あーなるほど|わかった|そうだそうだ)$/;
    // Tier-3: emotionally-loaded pivots
    const tier3Rx = /^(?:えーそうなの|うわー|すごい|ほんと|まじで|え、まじ|へー！|おおー|なるほどなるほど|あ、ほんとだ)$/;

    const isTier1 = tier1Rx.test(trimmed);
    const isTier2 = tier2Rx.test(trimmed);
    const isTier3 = tier3Rx.test(trimmed);

    if (!isTier1 && !isTier2 && !isTier3) return null;

    // Boost confidence if there's a topic shift between prev and next
    const prevLen = prev ? prev.trim().length : 0;
    const nextLen = next ? next.trim().length : 0;
    const surroundedByContent = prevLen > 4 && nextLen > 4;
    const contrastBoost = surroundedByContent ? 0.04 : 0.0;

    const baseConf = isTier1 ? 0.95 : isTier2 ? 0.90 : 0.85;

    return {
      type: "interactional-pivot",
      confidence: Math.min(0.99, baseConf + contrastBoost),
      evidence: bit,
      features: {
        marker: trimmed,
        tier: isTier1 ? 1 : isTier2 ? 2 : 3,
        surroundedByContent,
      },
    };
  },

  // ── 5. Epistemic-Continuation Blend ───────────────────────────────────────
  /**
   * A grammatical continuation form (progressive, conditional, experiential)
   * is FUSED with an epistemic adverb within the SAME bit, creating an
   * "experiencing-and-realising" semantic frame.
   */
  "epistemic-continuation-blend": (bit): DetectorResult | null => {
    // Continuation forms
    const contForms = /(?:(?:ん|て|で)いる(?:と|のに|けど)|(?:ん|て|で)いた(?:ら|けど)|(?:ん|て)いると|(?:読|聞|使|見|やっ|やり|し|き|来)(?:んで|て)いると|(?:読|聞|使|見|やっ|し|き)ながら|(?:て|で)みると|(?:て|で)くると|(?:て|で)いくと|(?:ん)でると|てると|でると)/;
    // Epistemic adverbs — realisation/certainty spectrum
    const epistAdv = /確かに|たしかに|やっぱり|やはり|実は|案外|意外と|どうやら|なるほど|まさに|案の定|やっぱ|さすがに|確かに|なるほどに/;

    const hasCont = contForms.test(bit);
    const hasEpist = epistAdv.test(bit);

    if (!hasCont && !hasEpist) return null;
    if (!hasCont || !hasEpist) {
      // Single-element match — lower confidence
      return {
        type: "epistemic-continuation-blend",
        confidence: 0.55,
        evidence: bit,
        features: {
          blendType: hasCont ? "continuation-only" : "epistemic-only",
          hasContinuation: hasCont,
          hasEpistemic: hasEpist,
        },
      };
    }

    // Extract the matched continuation and epistemic forms for the feature bag
    const contMatch = bit.match(contForms);
    const epistMatch = bit.match(epistAdv);

    return {
      type: "epistemic-continuation-blend",
      confidence: 0.90,
      evidence: bit,
      features: {
        blendType: "progressive-epistemic-fusion",
        continuationForm: contMatch ? contMatch[0] : "",
        epistemicAdverb: epistMatch ? epistMatch[0] : "",
        hasContinuation: true,
        hasEpistemic: true,
      },
    };
  },

  // ── 6. Discontinuous Parallel ─────────────────────────────────────────────
  /**
   * One half of a parallel construction is present here; the other half
   * exists in a non-adjacent bit (detected in buildEdges).
   */
  "discontinuous-parallel": (bit, _prev, _next, allBits, index): DetectorResult | null => {
    // All Japanese parallel pair constructions
    const parallelPatterns: Array<[RegExp, string]> = [
      [/[でし]たり$|があったり$|だったり$|になったり$|(?:て|で)いたり$/, "たり-たり"],
      [/とか(?:\s|$)/, "とか-とか"],
      [/し(?:、|$)/, "し-し"],
      [/も(?:\s|、|$)/, "も-も"],
      [/や(?:\s|、|$)/, "や-や"],
      [/なり(?:\s|$)/, "なり-なり"],
      [/たら(?:、|$)/, "たら-たら"],
      [/ば(?:、|$)/, "ば-ば"],
      [/ても(?:\s|$)|でも(?:\s|$)/, "ても-ても"],
      [/だの(?:\s|$)/, "だの-だの"],
      [/か(?:\s|、|$)/, "か-か"],
    ];

    let matchedPattern: string | null = null;
    for (const [rx, name] of parallelPatterns) {
      if (rx.test(bit.trim())) { matchedPattern = name; break; }
    }
    if (!matchedPattern) return null;

    // Count how many other bits also match this parallel construction
    const partnerIndices: number[] = [];
    const [mainRx] = parallelPatterns.find(([, n]) => n === matchedPattern)!;
    for (let j = 0; j < allBits.length; j++) {
      if (j !== index && mainRx.test(allBits[j].trim())) partnerIndices.push(j);
    }
    if (partnerIndices.length === 0) {
      // No partner found — lower confidence (may still be real but incomplete)
      return {
        type: "discontinuous-parallel",
        confidence: 0.55,
        evidence: bit,
        features: { pattern: matchedPattern, partnerFound: false, partnerIndices: "" },
      };
    }

    const span = Math.max(...partnerIndices) - index;
    // Longer span = more sophisticated discourse structure = higher salience
    const spanBoost = Math.min(0.1, span * 0.02);

    return {
      type: "discontinuous-parallel",
      confidence: Math.min(0.95, 0.85 + spanBoost),
      evidence: bit,
      features: {
        pattern: matchedPattern,
        partnerFound: true,
        partnerIndices: partnerIndices.join(","),
        span,
      },
    };
  },

  // ── 7. Causal-Concessive Cascade ──────────────────────────────────────────
  /**
   * A chain of: REASON → ACTION → CONCESSION (3+ bits) where each link
   * modifies the emotional or logical relationship between the others.
   */
  "causal-concessive-cascade": (bit, prev, next, allBits, index): DetectorResult | null => {
    // Causal (reason/cause) endings
    const causalRx = /(?:から|ので|ために|おかげで|せいで|くせに|のに)$|(?:だから|なので|ゆえに)$/;
    // Concessive endings
    const concedeRx = /(?:けど|けれど|けれども|が|のに|にもかかわらず|でも|それでも|ながらも)(?:。|、|$)/;
    // Action/consequence midpoint
    const actionRx = /(?:する|した|なる|なった|変える|変えた|思う|思った|言う|言った|考える|読む|書く|見る|行く|来る|使う|やる)(?:ん|の)?(?:だ|で|けど|が)?$/;

    const isCausal = causalRx.test(bit.trim());
    const isConcessive = concedeRx.test(bit.trim());
    const isAction = actionRx.test(bit.trim());

    // 3-bit cascade: current is the action; prev is causal; next is concessive
    if (isAction && prev && causalRx.test(prev.trim()) && next && concedeRx.test(next.trim())) {
      return {
        type: "causal-concessive-cascade",
        confidence: 0.92,
        evidence: `${prev} → ${bit} → ${next}`,
        features: {
          causalMarker: prev.trim().match(causalRx)?.[0] ?? "から",
          actionBit: bit.trim(),
          concedeMarker: next.trim().match(concedeRx)?.[0] ?? "けど",
          chainLength: 3,
          emotionalTrajectory: "build-then-deflate",
        },
      };
    }

    // 2-bit cascade: this bit is causal and next is concessive
    if (isCausal && next && concedeRx.test(next.trim())) {
      return {
        type: "causal-concessive-cascade",
        confidence: 0.87,
        evidence: `${bit} → ${next}`,
        features: {
          causalMarker: bit.trim().match(causalRx)?.[0] ?? "から",
          concedeMarker: next.trim().match(concedeRx)?.[0] ?? "けど",
          chainLength: 2,
          emotionalTrajectory: "reason-then-concede",
        },
      };
    }

    // This bit IS the concessive cap — scan back for the causal anchor
    if (isConcessive) {
      const causalIndex = index >= 2 ? index - 2 : -1;
      const hasPriorCausal = causalIndex >= 0 && causalRx.test(allBits[causalIndex].trim());
      return {
        type: "causal-concessive-cascade",
        confidence: hasPriorCausal ? 0.85 : 0.70,
        evidence: bit,
        features: {
          concedeMarker: bit.trim().match(concedeRx)?.[0] ?? "けど",
          chainLength: hasPriorCausal ? 3 : 1,
          emotionalTrajectory: "concessive-cap",
          hasPriorCausal,
        },
      };
    }

    return null;
  },

  // ── 8. Assertion-Deflation ─────────────────────────────────────────────────
  /**
   * A strong claim is progressively weakened across consecutive bits.
   * Each subsequent modifier reduces the assertion commitment.
   */
  "assertion-deflation": (bit, prev, next): DetectorResult | null => {
    // Stage-1: strong initial assertion (something that will later be deflated)
    const strongRx = /そのまま|絶対|確実に|明らかに|間違いなく|必ず|全然|全く|すごく|かなり/;
    // Stage-2: first softener — rhetorical question / negated assertion
    const softener1Rx = /んじゃない(?:か)?$|じゃない(?:か)?$|でしょ$|ちがう(?:かな)?$|ではないか$|ないか$/;
    // Stage-3: interrogative or further hedge
    const softener2Rx = /[？?]$|みたいな$|ような$|かな$|っていう$|っぽい$/;
    // Stage-4: full hedge (trailing approximation)
    const softener3Rx = /かもしれない$|かも$|でしょうか$|かなぁ$|だろうか$/;

    const isStage2 = softener1Rx.test(bit.trim());
    const isStage3 = softener2Rx.test(bit.trim());
    const isStage4 = softener3Rx.test(bit.trim());

    // Progressive deflation: prev is stage-2, current is stage-3+
    if (prev && softener1Rx.test(prev.trim()) && (isStage3 || isStage4)) {
      const deflationCurve = [0.8, isStage4 ? 0.2 : 0.35].join(",");
      return {
        type: "assertion-deflation",
        confidence: 0.93,
        evidence: `${prev}→${bit}`,
        features: {
          deflationStage: isStage4 ? "terminal" : "progressive",
          deflationCurve,
          previousStage: prev.trim().match(softener1Rx)?.[0] ?? "",
          currentStage: bit.trim().match(isStage4 ? softener3Rx : softener2Rx)?.[0] ?? "",
        },
        assertionStrength: isStage4 ? STRENGTH.WEAK : STRENGTH.WEAK + 0.1,
      };
    }

    // Stage-2 initial: strong prev + rhetorical-question current
    if (prev && strongRx.test(prev) && isStage2) {
      return {
        type: "assertion-deflation",
        confidence: 0.87,
        evidence: `${prev}→${bit}`,
        features: {
          deflationStage: "initial",
          deflationCurve: `${STRENGTH.STRONG},${STRENGTH.MODERATE}`,
          prevAssertionStrength: STRENGTH.STRONG,
        },
        assertionStrength: STRENGTH.MODERATE,
      };
    }

    // Standalone stage-2 detection (lower confidence — no confirmed prior)
    if (isStage2) {
      // Boost if next bit continues the deflation
      const nextDeflates = next && (softener2Rx.test(next.trim()) || softener3Rx.test(next.trim()));
      return {
        type: "assertion-deflation",
        confidence: nextDeflates ? 0.82 : 0.72,
        evidence: bit,
        features: {
          deflationStage: "initial",
          deflationCurve: `${STRENGTH.MODERATE},${nextDeflates ? STRENGTH.WEAK : STRENGTH.MODERATE}`,
        },
        assertionStrength: STRENGTH.MODERATE - 0.1,
      };
    }

    return null;
  },

  // ── 9. Connector Compounding ───────────────────────────────────────────────
  /**
   * Multiple discourse connectors are stacked in a single bit.
   * The COMBINATION carries meaning beyond any individual connector.
   */
  "connector-compounding": (bit) => {
    const { count, connectors } = countStackedConnectors(bit.trim());
    if (count < 2) return null;

    // Classify the combinatorial meaning
    let combinatorialMeaning: string;
    const has = (c: string) => connectors.includes(c);
    if (has("ま") && has("だから")) {
      combinatorialMeaning = "casual-reasoning"; // ま+だから = well, so...
    } else if (has("つまり") || has("要するに")) {
      combinatorialMeaning = "formal-reformulation"; // つまり+要するに = in other words
    } else if (has("でも") && has("やっぱり")) {
      combinatorialMeaning = "concessive-reaffirmation"; // でも+やっぱり = still though
    } else if (has("ただ") && has("でも")) {
      combinatorialMeaning = "hedged-concession"; // ただ+でも = but well
    } else if (has("なんか") || has("ちょっと")) {
      combinatorialMeaning = "casual-hedged-transition";
    } else {
      combinatorialMeaning = "generic-stacking";
    }

    return {
      type: "connector-compounding",
      confidence: Math.min(0.97, 0.75 + count * 0.07),
      evidence: bit,
      features: {
        connectorType: "stacked",
        stackedConnectorCount: count,
        connectors,
        combinatorialMeaning,
      },
    };
  },

  // ── 10. Fuzzy Reference Chain ──────────────────────────────────────────────
  /**
   * Content is wrapped in multiple approximation markers, creating a
   * deliberately vague reference.  More markers = more casual/intimate register.
   */
  "fuzzy-reference-chain": (bit) => {
    const count = countApproximationMarkers(bit);
    if (count < 1) return null;

    // Specific high-signal multi-marker combinations
    const tier1 = /っぽいものとか|っぽいやつとか|みたいなやつとか|的なこととか|みたいな感じのやつ/;
    const tier2 = /その辺(?:の|り)|あたり(?:の)?|そういった|なんかそういう|ああいう感じ|そんな感じの/;
    const tier3 = /みたいなもの|的なもの|みたいなこと|的なこと|っぽいもの|みたいなの/;

    const isTier1 = tier1.test(bit);
    const isTier2 = tier2.test(bit);

    // Fuzziness scales with marker count (capped at 1.0)
    const fuzziness = Math.min(1.0, count * FUZZINESS_PER_MARKER);
    const baseConf = isTier1 ? 0.92 : isTier2 ? 0.87 : tier3.test(bit) ? 0.82 : 0.70 + count * 0.04;

    return {
      type: "fuzzy-reference-chain",
      confidence: Math.min(0.97, baseConf),
      evidence: bit,
      features: {
        fuzzyMarkerCount: count,
        fuzziness,
        tier: isTier1 ? 1 : isTier2 ? 2 : 3,
      },
      fuzziness,
    };
  },

  // ── 11. Extended Reasoning → Stance Cap ───────────────────────────────────
  /**
   * A long reasoning segment is capped by an explanatory stance marker.
   * Longer reasoning before the cap = more sophisticated discourse structure.
   */
  "extended-reasoning-stance-cap": (bit, _prev, _next, allBits, index) => {
    // Tier-1: わけ-family caps (strongest)
    const tier1 = /わけだ(?:けど|が|ね|よ)?$|わけです(?:が|ね)?$|わけで(?:す)?$|わけじゃない$|わけにはいかない$|わけなんだ$/;
    // Tier-2: から-こそ caps
    const tier2 = /からこそ$|だからこそ$|ためにこそ$|ゆえにこそ$/;
    // Tier-3: という-family conclusion caps
    const tier3 = /ということで(?:す)?$|ってことは$|ということだ(?:ね)?$|というわけで(?:す)?$|というわけだ$/;
    // Tier-4: であるがゆえに + formal equivalents
    const tier4 = /であるがゆえに$|であるがために$|によるものだ$|によるものです$/;

    const isTier1 = tier1.test(bit.trim());
    const isTier2 = tier2.test(bit.trim());
    const isTier3 = tier3.test(bit.trim());
    const isTier4 = tier4.test(bit.trim());

    if (!isTier1 && !isTier2 && !isTier3 && !isTier4) return null;

    // Measure reasoning length: count preceding bits since the last full-stop
    // or the start of the graph (longer = more sophisticated)
    const precedingBits = allBits.slice(0, index);
    let lastBoundary = -1;
    for (let k = precedingBits.length - 1; k >= 0; k--) {
      if (/。$|[.!?！？]$/.test(precedingBits[k].trim())) { lastBoundary = precedingBits.length - 1 - k; break; }
    }
    const reasoningLength = lastBoundary === -1 ? precedingBits.length : lastBoundary;
    // Complexity bonus for long reasoning chains
    const complexityBoost = Math.min(0.12, reasoningLength * 0.015);

    const baseConf = isTier1 ? 0.92 : isTier2 ? 0.88 : isTier3 ? 0.85 : 0.82;

    return {
      type: "extended-reasoning-stance-cap",
      confidence: Math.min(0.98, baseConf + complexityBoost),
      evidence: bit,
      features: {
        stanceCap: isTier1 ? "わけ" : isTier2 ? "からこそ" : isTier3 ? "ということで" : "であるがゆえに",
        tier: isTier1 ? 1 : isTier2 ? 2 : isTier3 ? 3 : 4,
        reasoningLength,
        complexityBoost,
      },
    };
  },

  // ── 12. Epistemic Speculation Cascade ─────────────────────────────────────
  /**
   * Progressive speculation builds bit-by-bit from an anchor adverb through
   * intervening material to a tentative conclusion.  The full arc (not just
   * individual bits) is the meaningful unit.
   */
  "epistemic-speculation-cascade": (bit, _prev, _next, allBits, index): DetectorResult | null => {
    // Speculation ANCHORS (opening markers)
    const anchorRx = /^(?:きっと|たぶん|多分|おそらく|もしかしたら|もしかして|ひょっとしたら|ひょっとして|もしかすると|案外|意外と)/;
    // Speculation CLOSURES (closing markers)
    const closureRx = /(?:のかもしれない|かもしれない(?:ね|よ|けど)?|かも(?:ね|しれない)?|だろう(?:ね|か)?|でしょう|ではないか|じゃないか(?:な)?|のでは(?:ないか)?|んじゃないかな|じゃないかなあ?)(?:。|$)/;

    const isAnchor = anchorRx.test(bit.trim());
    const isClosure = closureRx.test(bit.trim());

    if (!isAnchor && !isClosure) return null;

    if (isAnchor) {
      // Build the full arc if a closure can be found
      const arc = buildSpeculationArc(allBits, index);
      const speculationLevel = arc ? 0.6 + arc.complexity * 0.35 : STRENGTH.MODERATE;
      return {
        type: "epistemic-speculation-cascade",
        confidence: arc ? 0.92 : 0.65,
        evidence: bit,
        features: {
          speculationAnchor: bit.trim().match(anchorRx)?.[0] ?? "",
          hasClosure: !!arc,
          closureIndex: arc?.closureIndex ?? -1,
          intermediateCount: arc?.intermediateCount ?? 0,
          arcComplexity: arc?.complexity ?? 0,
        },
        speculationLevel,
      };
    }

    // Closure bit — check if a prior anchor exists
    let anchorIdx = -1;
    for (let k = index - 1; k >= 0; k--) {
      if (anchorRx.test(allBits[k].trim())) { anchorIdx = k; break; }
    }
    const hasAnchor = anchorIdx !== -1;
    const intermediateCount = hasAnchor ? (index - anchorIdx - 1) : 0;

    return {
      type: "epistemic-speculation-cascade",
      confidence: hasAnchor ? 0.90 : 0.75,
      evidence: bit,
      features: {
        speculationClose: bit.trim().match(closureRx)?.[0] ?? "",
        hasAnchor,
        intermediateCount,
      },
      speculationLevel: hasAnchor ? STRENGTH.MODERATE + 0.2 : STRENGTH.MODERATE,
    };
  },

  // ── 13. Discourse Fade / Trail-off ─────────────────────────────────────────
  /**
   * The discourse segment is concluding or trailing off.  Explicit fade markers
   * (== notation) and implicit trailing expressions are both detected.
   */
  "discourse-fade-trail-off": (bit, prev, _next, allBits, index) => {
    // Explicit: == marker or ellipsis
    const explicitRx = /==|…$|…。$|\.{3}$/;
    // Tier-1 implicit: dangling concessive (speaker backs away from claim)
    const tier1 = /(?:んだ|な)けど(?:ね|なあ|。|$)|(?:んだ|な)けれど(?:も)?(?:ね|なあ|。|$)|だが(?:ね|。|$)/;
    // Tier-2 implicit: hanging approximation / impression
    const tier2 = /みたいな(?:。|$)|ような(?:気がする)?(?:。|$)|っていう感じ(?:で)?(?:。|$)|って感じで?(?:。|$)|っぽい(?:ね|な|。|$)/;
    // Tier-3 implicit: speculation trail
    const tier3 = /のかもしれない(?:ね|けど)?(?:。|$)|かもしれないな?(?:あ|ぁ)?(?:。|$)|かもね(?:。|$)|のかも(?:ね|。|$)/;
    // Tier-4 implicit: vague conclusion
    const tier4 = /かな(?:あ|ぁ)?(?:。|$)|かな。$|だろうなあ?(?:。|$)|かなぁ(?:。|$)|ような気がする(?:ね|な)?(?:。|$)/;
    // Tier-5 implicit: softened dangling
    const tier5 = /(?:ん|の)ですけど(?:ね|。|$)|(?:ん|の)だけど(?:ね|。|$)|(?:し|て)いて(?:。|$)/;

    const isExplicit = explicitRx.test(bit.trim());
    const isTier1 = tier1.test(bit.trim());
    const isTier2 = tier2.test(bit.trim());
    const isTier3 = tier3.test(bit.trim());
    const isTier4 = tier4.test(bit.trim());
    const isTier5 = tier5.test(bit.trim());

    if (!isExplicit && !isTier1 && !isTier2 && !isTier3 && !isTier4 && !isTier5) return null;

    // Contextual richness: detect what discourse structure preceded the fade
    const priorTypes = allBits.slice(Math.max(0, index - 4), index)
      .map(b => {
        if (/きっと|たぶん|多分|おそらく/.test(b)) return "speculation";
        if (/から$|ので$/.test(b.trim())) return "causal";
        if (/[でし]たり/.test(b)) return "parallel";
        if (/わけ/.test(b)) return "stance-cap";
        return "other";
      });

    const precededBySpeculation = priorTypes.includes("speculation");
    const precededByCausal = priorTypes.includes("causal");

    const baseConf = isExplicit ? 0.98 : isTier1 ? 0.88 : isTier3 ? 0.87
      : isTier2 ? 0.84 : isTier4 ? 0.80 : 0.72;
    // Boost when the fade follows a complex discourse structure
    const contextBoost = (precededBySpeculation || precededByCausal) ? 0.04 : 0.0;

    const fadeType = isExplicit ? "explicit-marker"
      : isTier1 ? "dangling-concessive"
      : isTier3 ? "speculation-trail"
      : isTier2 ? "hanging-approximation"
      : isTier4 ? "vague-conclusion"
      : "softened-dangling";

    return {
      type: "discourse-fade-trail-off",
      confidence: Math.min(0.99, baseConf + contextBoost),
      evidence: bit,
      features: {
        fadeMarker: isExplicit ? "==/…" : fadeType,
        fadeType,
        precededBySpeculation,
        precededByCausal,
        priorStructureTypes: priorTypes,
      },
    };
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
      const detected = this.detectBitType(seg.text, texts[i - 1] ?? null, texts[i + 1] ?? null, texts, i);
      return {
        id: bitId(),
        text: seg.text,
        startOffset: seg.start,
        endOffset: seg.end,
        timestamp,
        bitType: detected?.type ?? "unknown",
        morphemes: tokenize(seg.text),
        features: detected?.features ?? {},
        assertionStrength: detected?.assertionStrength,
        fuzziness: detected?.fuzziness,
        speculationLevel: detected?.speculationLevel,
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
    all: string[],
    index: number,
  ): DetectorResult | null {
    let best: DetectorResult | null = null;
    for (const detector of Object.values(DETECTORS)) {
      const result = detector(text, prev, next, all, index);
      if (result && (!best || result.confidence > best.confidence)) {
        best = result;
      }
    }
    return best;
  }

  private buildEdges(bits: DiscourseBit[], _texts: string[]): DiscourseEdge[] {
    const edges: DiscourseEdge[] = [];
    const texts = bits.map(b => b.text);

    for (let i = 0; i < bits.length; i++) {
      const current = bits[i];

      // ── Sequential adjacency (always) ─────────────────────────────────────
      if (i + 1 < bits.length) {
        const next = bits[i + 1];
        edges.push(this.makeEdge(current, next, 1, "sequential-adjacency", 0.7, "adjacent bits"));
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
        const arc = buildSpeculationArc(texts, i);
        if (arc) {
          edges.push(this.makeEdge(
            current, bits[arc.closureIndex],
            arc.intermediateCount + 1,
            "epistemic-speculation-cascade",
            0.88 + arc.complexity * 0.1,
            `speculation arc: ${arc.anchorText}→[${arc.intermediateCount} bits]→${arc.closureText}`,
          ));
        }
      }

      // ── Causal-concessive 3-bit chain ─────────────────────────────────────
      const causalRx = /(?:から|ので|ために|おかげで|せいで)$/;
      const concedeRx = /(?:けど|けれど|けれども|が|のに|でも|それでも)(?:。|、|$)/;
      if (causalRx.test(current.text.trim()) && i + 2 < bits.length) {
        const capBit = bits[i + 2];
        if (concedeRx.test(capBit.text.trim())) {
          // Causal → action → concessive 3-link
          edges.push(this.makeEdge(
            current, capBit, 2,
            "causal-concessive-cascade",
            0.88,
            `から→action→けど chain`,
          ));
        }
      }

      // ── Perspective framing scope ─────────────────────────────────────────
      // A perspective frame extends forward until the next perspective marker
      // or sentence boundary.
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
        const prevBit = bits[i - 1];
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
    source: DiscourseBit,
    target: DiscourseBit,
    distance: number,
    type: string,
    confidence: number,
    evidence: string,
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
