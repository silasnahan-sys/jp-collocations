/**
 * seed-patterns.ts
 *
 * All 13 seed PatternRule objects with deep, context-dependent detector logic.
 * The helper functions and constants exported here are also re-used by
 * DiscourseAnalyzer (buildEdges) to avoid duplication.
 */

import type { CascadeArc, DiscourseBit, PatternMatch, PatternRule } from "./discourse-types.ts";
import type { AnalysisContext } from "./discourse-types.ts";
import { PatternRegistry, STRENGTH } from "./discourse-types.ts";

// ─── Named constants ──────────────────────────────────────────────────────────

/** Base complexity for a speculation arc (minimum value before intermediate bits). */
export const CASCADE_BASE_COMPLEXITY = 0.3;
/** Complexity added per intermediate bit in a speculation cascade. */
export const CASCADE_COMPLEXITY_PER_BIT = 0.12;
/** Fuzziness score contributed per approximation marker found in a bit. */
export const FUZZINESS_PER_MARKER = 0.22;

// ─── Context helper functions ─────────────────────────────────────────────────

/**
 * Assess how assertive a text segment is.
 * Returns a RelationshipStrength score 0.0 (fully hedged) – 1.0 (absolute certainty).
 */
export function assessAssertionStrength(text: string): number {
  if (/絶対|確実に|間違いなく|必ず|明らかに|当然|もちろん|確かに/.test(text)) return STRENGTH.ABSOLUTE;
  if (/やっぱり|やはり|確かに|たしかに|まさに|どうやら|そのまま|ちゃんと/.test(text)) return STRENGTH.STRONG;
  if (/もしかして|ひょっとして|もしかしたら|ひょっとしたら/.test(text)) return STRENGTH.WEAK;
  if (/かもしれない|かも|だろう|でしょう|じゃないかな|のでは|のかな/.test(text)) return STRENGTH.WEAK + 0.05;
  if (/かな|っぽい|みたいな|ような気がする|と思う|かなって/.test(text)) return STRENGTH.MODERATE - 0.1;
  return STRENGTH.MODERATE;
}

/**
 * Count approximation / vagueness markers in a text.
 * More markers → higher fuzziness score.
 */
export function countApproximationMarkers(text: string): number {
  const markers = [
    /っぽい/, /みたいな/, /的な/, /ような/, /っぽいもの/, /みたいなやつ/,
    /とか/, /なんか/, /その辺/, /あたり/, /そういう/, /あれ/, /やつ/,
    /ああいう/, /そんな/, /こんな/, /どんな/, /くらい/, /ぐらい/, /なんとか/,
  ];
  return markers.reduce((n, rx) => n + (rx.test(text) ? 1 : 0), 0);
}

/**
 * Count stacked discourse connectors in a text.
 * Returns { count, connectors[] }.
 */
export function countStackedConnectors(text: string): { count: number; connectors: string[] } {
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
 * Scan `texts` forward from `startIndex` for the first epistemic speculation
 * closure pattern.  Returns the closing index, or -1 if not found.
 */
export function findSpeculationClosure(texts: string[], startIndex: number): number {
  const closureRx = /のかもしれない|かもしれない(?:ね|よ|けど)?$|かも(?:ね|しれない)?$|だろう(?:ね|か)?$|でしょう|ではないか|じゃないか(?:な)?$|のでは(?:ないか)?$|んじゃないかな$|じゃないかなあ?$/;
  for (let j = startIndex + 1; j < texts.length; j++) {
    if (closureRx.test(texts[j].trim())) return j;
  }
  return -1;
}

/**
 * Build a CascadeArc for a speculation cascade starting at `anchorIndex`.
 * Returns null if no closure can be found forward in `texts`.
 */
export function buildSpeculationArc(texts: string[], anchorIndex: number): CascadeArc | null {
  const closureIndex = findSpeculationClosure(texts, anchorIndex);
  if (closureIndex === -1) return null;
  const intermediateCount = closureIndex - anchorIndex - 1;
  const complexity = Math.min(1.0, CASCADE_BASE_COMPLEXITY + intermediateCount * CASCADE_COMPLEXITY_PER_BIT);
  return {
    anchorIndex,
    closureIndex,
    anchorText: texts[anchorIndex],
    closureText: texts[closureIndex],
    intermediateCount,
    cascadeType: "epistemic-speculation",
    complexity,
  };
}

// ─── 13 Seed PatternRule objects ──────────────────────────────────────────────

const hedgeStanceSoftening: PatternRule = {
  id: "hedge-stance-softening",
  name: "Hedge / Stance Softening",
  detector(bits: DiscourseBit[], index: number, _ctx: AnalysisContext): PatternMatch | null {
    const bit  = bits[index].text;
    const prev = bits[index - 1]?.text ?? null;

    const tier1 = /ような感じ|みたいな感じ|って感じ|っぽい感じ|ような気がする|かなっていう|だったかな(?:っていう)?|かなって|かなぁ/;
    const tier2 = /じゃないかな|と思う(?:けど)?|かもしれない|だろう(?:ね|か)?|でしょう|のかも|かもね|だろうな|でしょうね/;
    const tier3 = /なんか.*って|ちょっと.*かな|一応.*けど|多分.*と思う|なんとなく|どうも|いちおう|なんか(?:ね|な)/;
    const tier4 = /らしい|ようだ|みたいだ|っぽい|らしき|ような|ようで|みたいで|っぽくて/;
    const tier5 = /くらい|ぐらい|ほど|程度|くらいの|ぐらいの|だったっけ|っけ$/;

    const hasTier1 = tier1.test(bit);
    const hasTier2 = tier2.test(bit);
    const hasTier3 = tier3.test(bit);
    const hasTier4 = tier4.test(bit);
    const hasTier5 = tier5.test(bit);

    if (!hasTier1 && !hasTier2 && !hasTier3 && !hasTier4 && !hasTier5) return null;

    const prevStrength = prev ? assessAssertionStrength(prev) : STRENGTH.MODERATE;
    const contrastBoost = prevStrength >= STRENGTH.STRONG ? 0.12 : 0.0;
    const baseConf = hasTier1 ? 0.92 : hasTier2 ? 0.85 : hasTier4 ? 0.82 : hasTier3 ? 0.78 : 0.72;
    const confidence = Math.min(0.99, baseConf + contrastBoost);
    const marker = hasTier1 ? "ような感じ/かなって/って感じ"
      : hasTier2 ? "と思う/かもしれない/だろう"
      : hasTier4 ? "らしい/ようだ/みたいだ/っぽい"
      : hasTier3 ? "なんか/ちょっと/多分"
      : "くらい/ぐらい";
    const assertionStrength: number = STRENGTH.WEAK + (1 - confidence) * 0.3;

    return {
      confidence,
      evidence: [bit],
      direction: "backward",
      span: 1,
      features: {
        marker,
        tier: hasTier1 ? 1 : hasTier2 ? 2 : hasTier4 ? 4 : hasTier3 ? 3 : 5,
        prevAssertionStrength: prevStrength,
        contrastBoost,
        assertionStrength,
      },
    };
  },
};

const splitMorphemeCoConstruction: PatternRule = {
  id: "split-morpheme-co-construction",
  name: "Split-Morpheme Co-construction",
  detector(bits: DiscourseBit[], index: number, _ctx: AnalysisContext): PatternMatch | null {
    const bit  = bits[index].text;
    const prev = bits[index - 1]?.text ?? null;

    const contStartRx = /^(?:ても|でも|ながら|てから|てて|ちゃって|ちゃう|ておく|てみる|てしまう|てしまって|てある|ていた|ている|てた|てて|てく|でいる|でいた)/;
    const stemEndRx   = /[んいきしちにびみり]$/;

    const deicticCaseSplit = prev && /^(?:そこ|ここ|あそこ|それ|これ|あれ|どこ|どれ)$/.test(prev.trim())
      && /^[にはがをでとからまで]/.test(bit.trim());
    const teFormContinuation = prev && stemEndRx.test(prev.trim()) && contStartRx.test(bit.trim());
    const baConditional      = prev && /[えきしちにびみり]$/.test(prev.trim()) && /^ば/.test(bit.trim());
    const taraConditional    = prev && /た$|だ$/.test(prev.trim()) && /^ら/.test(bit.trim());
    const auxSplit           = prev && stemEndRx.test(prev.trim())
      && /^(?:ている|ていた|てしまう|てしまった|ておく|ておいた|てみる|てみた|てある|ていく|てきた)/.test(bit.trim());
    const concessive         = prev && stemEndRx.test(prev.trim()) && /^(?:でも|ても)/.test(bit.trim());
    const potentialStem      = !prev && stemEndRx.test(bit.trim());

    if (!teFormContinuation && !deicticCaseSplit && !baConditional && !taraConditional
        && !auxSplit && !concessive && !potentialStem) return null;

    let splitType: string;
    let confidence: number;
    if (teFormContinuation || auxSplit) {
      splitType  = auxSplit ? "auxiliary-split" : "te-form-continuation";
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
      confidence,
      evidence: [prev ? `${prev} → ${bit}` : bit],
      direction: "backward",
      span: 1,
      features: { splitType },
    };
  },
};

const perspectiveFraming: PatternRule = {
  id: "perspective-framing",
  name: "Perspective Framing",
  detector(bits: DiscourseBit[], index: number, _ctx: AnalysisContext): PatternMatch | null {
    const bit = bits[index].text;

    const tier1 = /[^\s]{1,10}的には|[^\s]{1,10}としては|[^\s]{1,10}にとっては|[^\s]{1,10}にしてみれば|[^\s]{1,10}から見れば|[^\s]{1,10}から言えば/;
    const tier2 = /的には|としては|にとって(?:は)?|から見ると|から言えば|の立場では|の観点からは|にしてみれば|の目から見ると|からすれば|の場合は|にすれば|として見れば|の視点から|から考えると|の感覚では|の目線では|にとってみれば/;
    const tier3 = /的に(?:は)?$|感覚的には|直感的には|経験的には|論理的には|客観的には|主観的には|個人的には/;

    const hasTier1 = tier1.test(bit);
    const hasTier2 = tier2.test(bit);
    const hasTier3 = tier3.test(bit);

    if (!hasTier1 && !hasTier2 && !hasTier3) return null;

    const confidence = hasTier1 ? 0.93 : hasTier2 ? 0.87 : 0.75;
    const entityMatch = bit.match(/^(.{1,10})(?:的には|としては|にとっては|から見れば|から言えば)/);
    const entity = entityMatch ? entityMatch[1] : null;

    return {
      confidence,
      evidence: [bit],
      direction: "forward",
      span: 1,
      features: {
        frameType: "perspective",
        entity: entity ?? "",
        tier: hasTier1 ? 1 : hasTier2 ? 2 : 3,
      },
    };
  },
};

const interactionalPivot: PatternRule = {
  id: "interactional-pivot",
  name: "Interactional Pivot",
  detector(bits: DiscourseBit[], index: number, _ctx: AnalysisContext): PatternMatch | null {
    const bit  = bits[index].text;
    const prev = bits[index - 1]?.text ?? null;
    const next = bits[index + 1]?.text ?? null;

    const trimmed = bit.trim().replace(/[。、！？…～〜]/g, "");

    const tier1Rx = /^(?:あ|ああ|あー|あ〜|あっ|え|えっ|えー|えっと|うん|ん|へえ|ほう|おお|おー|わあ|わー)$/;
    const tier2Rx = /^(?:なるほど|そっか|そうか|そうそう|あそうか|そうなの|うんうん|はいはい|ほーん|ふーん|ふむ|なるほどね|そうですか|へーそうか|あーそうか|そうだよね|あーなるほど|わかった|そうだそうだ)$/;
    const tier3Rx = /^(?:えーそうなの|うわー|すごい|ほんと|まじで|え、まじ|へー！|おおー|なるほどなるほど|あ、ほんとだ)$/;

    const isTier1 = tier1Rx.test(trimmed);
    const isTier2 = tier2Rx.test(trimmed);
    const isTier3 = tier3Rx.test(trimmed);

    if (!isTier1 && !isTier2 && !isTier3) return null;

    const prevLen = prev ? prev.trim().length : 0;
    const nextLen = next ? next.trim().length : 0;
    const surroundedByContent = prevLen > 4 && nextLen > 4;
    const contrastBoost = surroundedByContent ? 0.04 : 0.0;
    const baseConf = isTier1 ? 0.95 : isTier2 ? 0.90 : 0.85;

    return {
      confidence: Math.min(0.99, baseConf + contrastBoost),
      evidence: [bit],
      direction: "bidirectional",
      span: 1,
      features: {
        marker: trimmed,
        tier: isTier1 ? 1 : isTier2 ? 2 : 3,
        surroundedByContent,
      },
    };
  },
};

const epistemicContinuationBlend: PatternRule = {
  id: "epistemic-continuation-blend",
  name: "Epistemic-Continuation Blend",
  detector(bits: DiscourseBit[], index: number, _ctx: AnalysisContext): PatternMatch | null {
    const bit = bits[index].text;

    const contForms = /(?:(?:ん|て|で)いる(?:と|のに|けど)|(?:ん|て|で)いた(?:ら|けど)|(?:ん|て)いると|(?:読|聞|使|見|やっ|やり|し|き|来)(?:んで|て)いると|(?:読|聞|使|見|やっ|し|き)ながら|(?:て|で)みると|(?:て|で)くると|(?:て|で)いくと|(?:ん)でると|てると|でると)/;
    const epistAdv  = /確かに|たしかに|やっぱり|やはり|実は|案外|意外と|どうやら|なるほど|まさに|案の定|やっぱ|さすがに|確かに|なるほどに/;

    const hasCont  = contForms.test(bit);
    const hasEpist = epistAdv.test(bit);

    if (!hasCont && !hasEpist) return null;
    if (!hasCont || !hasEpist) {
      return {
        confidence: 0.55,
        evidence: [bit],
        direction: "forward",
        span: 1,
        features: {
          blendType: hasCont ? "continuation-only" : "epistemic-only",
          hasContinuation: hasCont,
          hasEpistemic: hasEpist,
        },
      };
    }

    const contMatch  = bit.match(contForms);
    const epistMatch = bit.match(epistAdv);

    return {
      confidence: 0.90,
      evidence: [bit],
      direction: "forward",
      span: 1,
      features: {
        blendType: "progressive-epistemic-fusion",
        continuationForm: contMatch ? contMatch[0] : "",
        epistemicAdverb: epistMatch ? epistMatch[0] : "",
        hasContinuation: true,
        hasEpistemic: true,
      },
    };
  },
};

const discontinuousParallel: PatternRule = {
  id: "discontinuous-parallel",
  name: "Discontinuous Parallel",
  detector(bits: DiscourseBit[], index: number, _ctx: AnalysisContext): PatternMatch | null {
    const bit      = bits[index].text;
    const allTexts = bits.map(b => b.text);

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

    const partnerIndices: number[] = [];
    const [mainRx] = parallelPatterns.find(([, n]) => n === matchedPattern)!;
    for (let j = 0; j < allTexts.length; j++) {
      if (j !== index && mainRx.test(allTexts[j].trim())) partnerIndices.push(j);
    }

    if (partnerIndices.length === 0) {
      return {
        confidence: 0.55,
        evidence: [bit],
        direction: "forward",
        span: 1,
        features: { pattern: matchedPattern, partnerFound: false, partnerIndices: "" },
      };
    }

    const span = Math.max(...partnerIndices) - index;
    const spanBoost = Math.min(0.1, span * 0.02);

    return {
      confidence: Math.min(0.95, 0.85 + spanBoost),
      evidence: [bit],
      direction: "forward",
      span,
      features: {
        pattern: matchedPattern,
        partnerFound: true,
        partnerIndices: partnerIndices.join(","),
        span,
      },
    };
  },
};

const causalConcessiveCascade: PatternRule = {
  id: "causal-concessive-cascade",
  name: "Causal-Concessive Cascade",
  detector(bits: DiscourseBit[], index: number, _ctx: AnalysisContext): PatternMatch | null {
    const bit  = bits[index].text;
    const prev = bits[index - 1]?.text ?? null;
    const next = bits[index + 1]?.text ?? null;

    const allTexts = bits.map(b => b.text);

    const causalRx  = /(?:から|ので|ために|おかげで|せいで|くせに|のに)$|(?:だから|なので|ゆえに)$/;
    const concedeRx = /(?:けど|けれど|けれども|が|のに|にもかかわらず|でも|それでも|ながらも)(?:。|、|$)/;
    const actionRx  = /(?:する|した|なる|なった|変える|変えた|思う|思った|言う|言った|考える|読む|書く|見る|行く|来る|使う|やる)(?:ん|の)?(?:だ|で|けど|が)?$/;

    const isCausal    = causalRx.test(bit.trim());
    const isConcessive = concedeRx.test(bit.trim());
    const isAction    = actionRx.test(bit.trim());

    if (isAction && prev && causalRx.test(prev.trim()) && next && concedeRx.test(next.trim())) {
      return {
        confidence: 0.92,
        evidence: [`${prev} → ${bit} → ${next}`],
        direction: "forward",
        span: 2,
        features: {
          causalMarker:    prev.trim().match(causalRx)?.[0] ?? "から",
          actionBit:       bit.trim(),
          concedeMarker:   next.trim().match(concedeRx)?.[0] ?? "けど",
          chainLength:     3,
          emotionalTrajectory: "build-then-deflate",
        },
      };
    }

    if (isCausal && next && concedeRx.test(next.trim())) {
      return {
        confidence: 0.87,
        evidence: [`${bit} → ${next}`],
        direction: "forward",
        span: 1,
        features: {
          causalMarker:  bit.trim().match(causalRx)?.[0] ?? "から",
          concedeMarker: next.trim().match(concedeRx)?.[0] ?? "けど",
          chainLength:   2,
          emotionalTrajectory: "reason-then-concede",
        },
      };
    }

    if (isConcessive) {
      const causalIndex   = index >= 2 ? index - 2 : -1;
      const hasPriorCausal = causalIndex >= 0 && causalRx.test(allTexts[causalIndex].trim());
      return {
        confidence: hasPriorCausal ? 0.85 : 0.70,
        evidence: [bit],
        direction: "backward",
        span: 1,
        features: {
          concedeMarker: bit.trim().match(concedeRx)?.[0] ?? "けど",
          chainLength:   hasPriorCausal ? 3 : 1,
          emotionalTrajectory: "concessive-cap",
          hasPriorCausal,
        },
      };
    }

    return null;
  },
};

const assertionDeflation: PatternRule = {
  id: "assertion-deflation",
  name: "Assertion Deflation",
  detector(bits: DiscourseBit[], index: number, _ctx: AnalysisContext): PatternMatch | null {
    const bit  = bits[index].text;
    const prev = bits[index - 1]?.text ?? null;
    const next = bits[index + 1]?.text ?? null;

    const strongRx    = /そのまま|絶対|確実に|明らかに|間違いなく|必ず|全然|全く|すごく|かなり/;
    const softener1Rx = /んじゃない(?:か)?$|じゃない(?:か)?$|でしょ$|ちがう(?:かな)?$|ではないか$|ないか$/;
    const softener2Rx = /[？?]$|みたいな$|ような$|かな$|っていう$|っぽい$/;
    const softener3Rx = /かもしれない$|かも$|でしょうか$|かなぁ$|だろうか$/;

    const isStage2 = softener1Rx.test(bit.trim());
    const isStage3 = softener2Rx.test(bit.trim());
    const isStage4 = softener3Rx.test(bit.trim());

    if (prev && softener1Rx.test(prev.trim()) && (isStage3 || isStage4)) {
      const deflationCurve   = [0.8, isStage4 ? 0.2 : 0.35].join(",");
      const assertionStrength: number = isStage4 ? STRENGTH.WEAK : STRENGTH.WEAK + 0.1;
      return {
        confidence: 0.93,
        evidence: [`${prev}→${bit}`],
        direction: "backward",
        span: 1,
        features: {
          deflationStage: isStage4 ? "terminal" : "progressive",
          deflationCurve,
          previousStage:   prev.trim().match(softener1Rx)?.[0] ?? "",
          currentStage:    bit.trim().match(isStage4 ? softener3Rx : softener2Rx)?.[0] ?? "",
          assertionStrength,
        },
      };
    }

    if (prev && strongRx.test(prev) && isStage2) {
      return {
        confidence: 0.87,
        evidence: [`${prev}→${bit}`],
        direction: "backward",
        span: 1,
        features: {
          deflationStage:      "initial",
          deflationCurve:      `${STRENGTH.STRONG},${STRENGTH.MODERATE}`,
          prevAssertionStrength: STRENGTH.STRONG,
          assertionStrength:   STRENGTH.MODERATE,
        },
      };
    }

    if (isStage2) {
      const nextDeflates = next && (softener2Rx.test(next.trim()) || softener3Rx.test(next.trim()));
      return {
        confidence: nextDeflates ? 0.82 : 0.72,
        evidence: [bit],
        direction: "forward",
        span: 1,
        features: {
          deflationStage:    "initial",
          deflationCurve:    `${STRENGTH.MODERATE},${nextDeflates ? STRENGTH.WEAK : STRENGTH.MODERATE}`,
          assertionStrength: STRENGTH.MODERATE - 0.1,
        },
      };
    }

    return null;
  },
};

const connectorCompounding: PatternRule = {
  id: "connector-compounding",
  name: "Connector Compounding",
  detector(bits: DiscourseBit[], index: number, _ctx: AnalysisContext): PatternMatch | null {
    const bit = bits[index].text;
    const { count, connectors } = countStackedConnectors(bit.trim());
    if (count < 2) return null;

    const has = (c: string) => connectors.includes(c);
    let combinatorialMeaning: string;
    if (has("ま") && has("だから")) {
      combinatorialMeaning = "casual-reasoning";
    } else if (has("つまり") || has("要するに")) {
      combinatorialMeaning = "formal-reformulation";
    } else if (has("でも") && has("やっぱり")) {
      combinatorialMeaning = "concessive-reaffirmation";
    } else if (has("ただ") && has("でも")) {
      combinatorialMeaning = "hedged-concession";
    } else if (has("なんか") || has("ちょっと")) {
      combinatorialMeaning = "casual-hedged-transition";
    } else {
      combinatorialMeaning = "generic-stacking";
    }

    return {
      confidence: Math.min(0.97, 0.75 + count * 0.07),
      evidence: [bit],
      direction: "forward",
      span: 1,
      features: {
        connectorType: "stacked",
        stackedConnectorCount: count,
        connectors,
        combinatorialMeaning,
      },
    };
  },
};

const fuzzyReferenceChain: PatternRule = {
  id: "fuzzy-reference-chain",
  name: "Fuzzy Reference Chain",
  detector(bits: DiscourseBit[], index: number, _ctx: AnalysisContext): PatternMatch | null {
    const bit   = bits[index].text;
    const count = countApproximationMarkers(bit);
    if (count < 1) return null;

    const tier1 = /っぽいものとか|っぽいやつとか|みたいなやつとか|的なこととか|みたいな感じのやつ/;
    const tier2 = /その辺(?:の|り)|あたり(?:の)?|そういった|なんかそういう|ああいう感じ|そんな感じの/;
    const tier3 = /みたいなもの|的なもの|みたいなこと|的なこと|っぽいもの|みたいなの/;

    const isTier1 = tier1.test(bit);
    const isTier2 = tier2.test(bit);
    const fuzziness = Math.min(1.0, count * FUZZINESS_PER_MARKER);
    const baseConf  = isTier1 ? 0.92 : isTier2 ? 0.87 : tier3.test(bit) ? 0.82 : 0.70 + count * 0.04;

    return {
      confidence: Math.min(0.97, baseConf),
      evidence: [bit],
      direction: "forward",
      span: 1,
      features: {
        fuzzyMarkerCount: count,
        fuzziness,
        tier: isTier1 ? 1 : isTier2 ? 2 : 3,
      },
    };
  },
};

const extendedReasoningStanceCap: PatternRule = {
  id: "extended-reasoning-stance-cap",
  name: "Extended Reasoning → Stance Cap",
  detector(bits: DiscourseBit[], index: number, _ctx: AnalysisContext): PatternMatch | null {
    const bit      = bits[index].text;
    const allTexts = bits.map(b => b.text);

    const tier1 = /わけだ(?:けど|が|ね|よ)?$|わけです(?:が|ね)?$|わけで(?:す)?$|わけじゃない$|わけにはいかない$|わけなんだ$/;
    const tier2 = /からこそ$|だからこそ$|ためにこそ$|ゆえにこそ$/;
    const tier3 = /ということで(?:す)?$|ってことは$|ということだ(?:ね)?$|というわけで(?:す)?$|というわけだ$/;
    const tier4 = /であるがゆえに$|であるがために$|によるものだ$|によるものです$/;

    const isTier1 = tier1.test(bit.trim());
    const isTier2 = tier2.test(bit.trim());
    const isTier3 = tier3.test(bit.trim());
    const isTier4 = tier4.test(bit.trim());

    if (!isTier1 && !isTier2 && !isTier3 && !isTier4) return null;

    const precedingBits = allTexts.slice(0, index);
    let lastBoundary = -1;
    for (let k = precedingBits.length - 1; k >= 0; k--) {
      if (/。$|[.!?！？]$/.test(precedingBits[k].trim())) {
        lastBoundary = precedingBits.length - 1 - k;
        break;
      }
    }
    const reasoningLength  = lastBoundary === -1 ? precedingBits.length : lastBoundary;
    const complexityBoost  = Math.min(0.12, reasoningLength * 0.015);
    const baseConf         = isTier1 ? 0.92 : isTier2 ? 0.88 : isTier3 ? 0.85 : 0.82;

    return {
      confidence: Math.min(0.98, baseConf + complexityBoost),
      evidence: [bit],
      direction: "backward",
      span: reasoningLength || 1,
      features: {
        stanceCap: isTier1 ? "わけ" : isTier2 ? "からこそ" : isTier3 ? "ということで" : "であるがゆえに",
        tier: isTier1 ? 1 : isTier2 ? 2 : isTier3 ? 3 : 4,
        reasoningLength,
        complexityBoost,
      },
    };
  },
};

const epistemicSpeculationCascade: PatternRule = {
  id: "epistemic-speculation-cascade",
  name: "Epistemic Speculation Cascade",
  detector(bits: DiscourseBit[], index: number, _ctx: AnalysisContext): PatternMatch | null {
    const bit      = bits[index].text;
    const allTexts = bits.map(b => b.text);

    const anchorRx  = /^(?:きっと|たぶん|多分|おそらく|もしかしたら|もしかして|ひょっとしたら|ひょっとして|もしかすると|案外|意外と)/;
    const closureRx = /(?:のかもしれない|かもしれない(?:ね|よ|けど)?|かも(?:ね|しれない)?|だろう(?:ね|か)?|でしょう|ではないか|じゃないか(?:な)?|のでは(?:ないか)?|んじゃないかな|じゃないかなあ?)(?:。|$)/;

    const isAnchor  = anchorRx.test(bit.trim());
    const isClosure = closureRx.test(bit.trim());

    if (!isAnchor && !isClosure) return null;

    if (isAnchor) {
      const arc             = buildSpeculationArc(allTexts, index);
      const speculationLevel: number = arc ? 0.6 + arc.complexity * 0.35 : STRENGTH.MODERATE;
      return {
        confidence: arc ? 0.92 : 0.65,
        evidence: [bit],
        direction: "forward",
        span: arc ? arc.intermediateCount + 1 : 1,
        targetIndex: arc?.closureIndex,
        features: {
          speculationAnchor:   bit.trim().match(anchorRx)?.[0] ?? "",
          hasClosure:          !!arc,
          closureIndex:        arc?.closureIndex ?? -1,
          intermediateCount:   arc?.intermediateCount ?? 0,
          arcComplexity:       arc?.complexity ?? 0,
          speculationLevel,
        },
      };
    }

    // Closure bit — scan back for the anchor
    let anchorIdx = -1;
    for (let k = index - 1; k >= 0; k--) {
      if (anchorRx.test(allTexts[k].trim())) { anchorIdx = k; break; }
    }
    const hasAnchor        = anchorIdx !== -1;
    const intermediateCount = hasAnchor ? (index - anchorIdx - 1) : 0;
    const speculationLevel: number  = hasAnchor ? STRENGTH.MODERATE + 0.2 : STRENGTH.MODERATE;

    return {
      confidence: hasAnchor ? 0.90 : 0.75,
      evidence: [bit],
      direction: "backward",
      span: intermediateCount + 1,
      targetIndex: hasAnchor ? anchorIdx : undefined,
      features: {
        speculationClose:  bit.trim().match(closureRx)?.[0] ?? "",
        hasAnchor,
        intermediateCount,
        speculationLevel,
      },
    };
  },
};

const discourseFadeTrailOff: PatternRule = {
  id: "discourse-fade-trail-off",
  name: "Discourse Fade / Trail-off",
  detector(bits: DiscourseBit[], index: number, _ctx: AnalysisContext): PatternMatch | null {
    const bit      = bits[index].text;
    const allTexts = bits.map(b => b.text);

    const explicitRx = /==|…$|…。$|\.{3}$/;
    const tier1      = /(?:んだ|な)けど(?:ね|なあ|。|$)|(?:んだ|な)けれど(?:も)?(?:ね|なあ|。|$)|だが(?:ね|。|$)/;
    const tier2      = /みたいな(?:。|$)|ような(?:気がする)?(?:。|$)|っていう感じ(?:で)?(?:。|$)|って感じで?(?:。|$)|っぽい(?:ね|な|。|$)/;
    const tier3      = /のかもしれない(?:ね|けど)?(?:。|$)|かもしれないな?(?:あ|ぁ)?(?:。|$)|かもね(?:。|$)|のかも(?:ね|。|$)/;
    const tier4      = /かな(?:あ|ぁ)?(?:。|$)|かな。$|だろうなあ?(?:。|$)|かなぁ(?:。|$)|ような気がする(?:ね|な)?(?:。|$)/;
    const tier5      = /(?:ん|の)ですけど(?:ね|。|$)|(?:ん|の)だけど(?:ね|。|$)|(?:し|て)いて(?:。|$)/;

    const isExplicit = explicitRx.test(bit.trim());
    const isTier1    = tier1.test(bit.trim());
    const isTier2    = tier2.test(bit.trim());
    const isTier3    = tier3.test(bit.trim());
    const isTier4    = tier4.test(bit.trim());
    const isTier5    = tier5.test(bit.trim());

    if (!isExplicit && !isTier1 && !isTier2 && !isTier3 && !isTier4 && !isTier5) return null;

    const priorTypes = allTexts.slice(Math.max(0, index - 4), index)
      .map(b => {
        if (/きっと|たぶん|多分|おそらく/.test(b))  return "speculation";
        if (/から$|ので$/.test(b.trim()))            return "causal";
        if (/[でし]たり/.test(b))                    return "parallel";
        if (/わけ/.test(b))                          return "stance-cap";
        return "other";
      });

    const precededBySpeculation = priorTypes.includes("speculation");
    const precededByCausal      = priorTypes.includes("causal");
    const baseConf  = isExplicit ? 0.98 : isTier1 ? 0.88 : isTier3 ? 0.87 : isTier2 ? 0.84 : isTier4 ? 0.80 : 0.72;
    const contextBoost = (precededBySpeculation || precededByCausal) ? 0.04 : 0.0;
    const fadeType  = isExplicit ? "explicit-marker"
      : isTier1 ? "dangling-concessive"
      : isTier3 ? "speculation-trail"
      : isTier2 ? "hanging-approximation"
      : isTier4 ? "vague-conclusion"
      : "softened-dangling";

    return {
      confidence: Math.min(0.99, baseConf + contextBoost),
      evidence: [bit],
      direction: "backward",
      span: 1,
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

// ─── Registry helpers ─────────────────────────────────────────────────────────

/** Return an ordered list of all 13 seed PatternRule objects. */
export function getSeedPatterns(): PatternRule[] {
  return [
    hedgeStanceSoftening,
    splitMorphemeCoConstruction,
    perspectiveFraming,
    interactionalPivot,
    epistemicContinuationBlend,
    discontinuousParallel,
    causalConcessiveCascade,
    assertionDeflation,
    connectorCompounding,
    fuzzyReferenceChain,
    extendedReasoningStanceCap,
    epistemicSpeculationCascade,
    discourseFadeTrailOff,
  ];
}

/** Build and return a PatternRegistry pre-loaded with all 13 seed rules. */
export function buildSeedRegistry(): PatternRegistry {
  const registry = new PatternRegistry();
  for (const rule of getSeedPatterns()) {
    registry.register(rule);
  }
  return registry;
}
