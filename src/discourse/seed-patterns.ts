/**
 * seed-patterns.ts
 *
 * The 13 seed PatternRule objects that correspond to the original inline
 * DETECTORS in DiscourseAnalyzer.ts.  Each rule carries full metadata
 * (id, name, description, priority, examples, createdFrom, hitCount) plus
 * a detector function using the (bits, index, context) => PatternMatch | null
 * signature.
 *
 * Export getSeedPatterns() and buildSeedRegistry() for use by DiscourseAnalyzer.
 */

import type {
  DiscourseBit,
  PatternRule,
  PatternMatch,
  AnalysisContext,
} from "./discourse-types.ts";
import { PatternRegistry } from "./discourse-types.ts";

// ─── Shared helpers ────────────────────────────────────────────────────────────

function text(bits: DiscourseBit[], index: number): string {
  return bits[index]?.text ?? "";
}

function prevText(bits: DiscourseBit[], index: number): string {
  return bits[index - 1]?.text ?? "";
}

function nextText(bits: DiscourseBit[], index: number): string {
  return bits[index + 1]?.text ?? "";
}

// ─── 13 Seed Rules ────────────────────────────────────────────────────────────

const hedgeStanceSoftening: PatternRule = {
  id: "seed-hedge-stance-softening",
  name: "Hedge / Stance Softening",
  description:
    "Detects approximation and epistemic-distancing markers that soften the speaker's stance: ような感じ, みたいな, っぽい, ようだ, らしい, くらい, etc.",
  relationshipType: "hedge-stance-softening",
  priority: 80,
  examples: [
    "ような感じ", "みたいな感じ", "って感じ", "っぽい感じ",
    "ような気がする", "みたいな", "っぽい", "ようだ", "ように",
    "らしい", "くらい", "ぐらい", "気味", "かのような",
    "っていうか", "みたいなものかな", "ような雰囲気", "ぽい",
    "気がする", "ような気持ち", "みたいな感覚",
  ],
  createdFrom: "seed",
  hitCount: 0,
  detector(bits, index): PatternMatch | null {
    const t = text(bits, index);
    const match = /ような感じ|みたいな感じ|って感じ|っぽい感じ|ような気がする|みたいな|っぽい|ようだ|ように|らしい|くらい|ぐらい|気味|かのような|気がする/.exec(t);
    if (match) {
      return {
        confidence: 0.9,
        evidence: [match[0]],
        direction: "forward",
        span: 1,
        features: { marker: match[0] },
      };
    }
    return null;
  },
};

const splitMorphemeCoConstruction: PatternRule = {
  id: "seed-split-morpheme-co-construction",
  name: "Split-Morpheme Co-construction",
  description:
    "Detects verb-stem splits across bit boundaries where one speaker completes another's morpheme.",
  relationshipType: "split-morpheme-co-construction",
  priority: 30,
  examples: [
    "読み||ます", "食べ||て", "行き||ました", "し||て",
    "来||て", "見||ます", "でき||て", "知り||たくて",
    "言い||たい", "やり||たい",
  ],
  createdFrom: "seed",
  hitCount: 0,
  detector(bits, index): PatternMatch | null {
    const t = text(bits, index);
    const prev = prevText(bits, index);
    if (prev && /[んいきしちにびみり]$/.test(prev.trim()) && /^[でてでても]/.test(t.trim())) {
      return {
        confidence: 0.8,
        evidence: [`${prev}||${t}`],
        direction: "forward",
        span: 1,
        features: { splitType: "verb-stem" },
      };
    }
    if (/[いきしちにびみり]$/.test(t.trim())) {
      return {
        confidence: 0.6,
        evidence: [t.trim()],
        direction: "forward",
        span: 1,
        features: { splitType: "potential-stem" },
      };
    }
    return null;
  },
};

const perspectiveFraming: PatternRule = {
  id: "seed-perspective-framing",
  name: "Perspective Framing",
  description:
    "Detects perspective-establishing markers that frame the speaker's viewpoint: 的には, から見ると, としては, にとって.",
  relationshipType: "perspective-framing",
  priority: 70,
  examples: [
    "的には", "的に", "から見ると", "としては", "にとって",
    "にとっては", "の立場から", "の観点から", "の視点では",
    "からすると", "からすれば", "から言うと", "から見れば",
    "としての", "という立場で", "という意味では",
  ],
  createdFrom: "seed",
  hitCount: 0,
  detector(bits, index): PatternMatch | null {
    const t = text(bits, index);
    const match = /的には|的に|から見ると|としては|にとって|にとっては|から見れば|からすると|からすれば|から言うと/.exec(t);
    if (match) {
      return {
        confidence: 0.85,
        evidence: [match[0]],
        direction: "forward",
        span: 1,
        features: { frameType: "perspective", marker: match[0] },
      };
    }
    return null;
  },
};

const interactionalPivot: PatternRule = {
  id: "seed-interactional-pivot",
  name: "Interactional Pivot",
  description:
    "Detects short realisation/backchannelling tokens (あ, え, へえ, うん, そう, なるほど) that mark a shift in floor.",
  relationshipType: "interactional-pivot",
  priority: 100,
  examples: [
    "あ", "え", "えー", "へえ", "うん", "そう", "なるほど",
    "ふーん", "ほう", "おー", "ああ", "うーん", "はい",
    "ええ", "まあ", "あー", "そうか", "そうなんだ", "そうですか",
    "へえー", "ほほう", "なんと", "マジで",
  ],
  createdFrom: "seed",
  hitCount: 0,
  detector(bits, index): PatternMatch | null {
    const t = text(bits, index);
    const trimmed = t.trim().replace(/[。、！？…]/g, "");
    if (/^(あ|え|えー|へえ|うん|そう|なるほど|ふーん|ほう|おー|ああ|うーん|はい|ええ|まあ|あー|そうか|そうなんだ|そうですか|へえー|ほほう|なんと|マジで)$/.test(trimmed)) {
      return {
        confidence: 0.95,
        evidence: [trimmed],
        direction: "forward",
        span: 1,
        features: { marker: trimmed },
      };
    }
    return null;
  },
};

const epistemicContinuationBlend: PatternRule = {
  id: "seed-epistemic-continuation-blend",
  name: "Epistemic-Continuation Blend",
  description:
    "Detects progressive + epistemic certainty blends: んでると, てると確かに, ながら確かに, ているのに.",
  relationshipType: "epistemic-continuation-blend",
  priority: 65,
  examples: [
    "んでると", "てると確かに", "ながら確かに", "ているのに",
    "てるのに確かに", "しながら確かに", "続けながら",
    "読んでると確かに", "見てると確かに", "やってると確かに",
    "するうちに確かに", "いくうちに", "経つにつれ",
  ],
  createdFrom: "seed",
  hitCount: 0,
  detector(bits, index): PatternMatch | null {
    const t = text(bits, index);
    const match = /んでると|てると確かに|ながら確かに|ているのに|てるのに確かに/.exec(t);
    if (match) {
      return {
        confidence: 0.85,
        evidence: [match[0]],
        direction: "forward",
        span: 1,
        features: { blendType: "progressive-certainty", marker: match[0] },
      };
    }
    return null;
  },
};

const discontinuousParallel: PatternRule = {
  id: "seed-discontinuous-parallel",
  name: "Discontinuous Parallel",
  description:
    "Detects the たり...たり parallel-enumeration pattern spanning multiple bits.",
  relationshipType: "discontinuous-parallel",
  priority: 60,
  examples: [
    "があったり", "したり", "したりして", "だったり",
    "行ったり来たり", "食べたり飲んだり", "読んだり書いたり",
    "買ったり売ったり", "来たり去ったり", "増えたり減ったり",
    "寝たり起きたり", "笑ったり泣いたり",
  ],
  createdFrom: "seed",
  hitCount: 0,
  detector(bits, index, context): PatternMatch | null {
    const t = text(bits, index);
    const tariPattern = /があったり|[でし]たり/;
    if (tariPattern.test(t)) {
      const otherIdx = context.allTexts.findIndex((b, i) => i !== index && tariPattern.test(b));
      if (otherIdx >= 0) {
        return {
          targetIndex: otherIdx,
          confidence: 0.9,
          evidence: [t.match(/(があったり|[でし]たり)/)?.[0] ?? t.trim()],
          direction: "bidirectional",
          span: Math.abs(otherIdx - index),
          features: { pattern: "たり-たり" },
        };
      }
    }
    return null;
  },
};

const causalConcessive: PatternRule = {
  id: "seed-causal-concessive-cascade",
  name: "Causal-Concessive Cascade",
  description:
    "Detects から/ので → けど/が concessive chains where a causal reason is immediately qualified.",
  relationshipType: "causal-concessive-cascade",
  priority: 75,
  examples: [
    "から", "ので", "だから", "なので", "ために",
    "けど", "が", "のに", "けれど", "けれども",
    "んだけど", "なんだけど", "けれど", "だけど",
    "からこそ", "のでそれで", "だから、でも",
  ],
  createdFrom: "seed",
  hitCount: 0,
  detector(bits, index): PatternMatch | null {
    const t = text(bits, index);
    const next = nextText(bits, index);
    if (/から$|ので$/.test(t.trim()) && /けど|が$|のに$/.test(next.trim())) {
      return {
        targetIndex: index + 1,
        confidence: 0.85,
        evidence: [t.trim().slice(-2), next.trim().slice(0, 4)],
        direction: "forward",
        span: 1,
        features: { causalMarker: t.trim().slice(-2), concedeMarker: next.trim().slice(0, 2) },
      };
    }
    if (/んだけど|なんだけど|けれど/.test(t)) {
      const match = t.match(/んだけど|なんだけど|けれど/);
      return {
        confidence: 0.75,
        evidence: [match![0]],
        direction: "forward",
        span: 1,
        features: { causalMarker: match![0] },
      };
    }
    return null;
  },
};

const assertionDeflation: PatternRule = {
  id: "seed-assertion-deflation",
  name: "Assertion Deflation",
  description:
    "Detects sequences where a strong assertion (んじゃない, でしょ) is progressively softened.",
  relationshipType: "assertion-deflation",
  priority: 70,
  examples: [
    "んじゃない", "んじゃないか", "でしょ", "でしょう",
    "じゃないですか", "ではないか", "じゃないか",
    "じゃない？", "でしょ？", "じゃないかな",
    "だと思う", "かもな", "かもしれない", "だろう",
  ],
  createdFrom: "seed",
  hitCount: 0,
  detector(bits, index): PatternMatch | null {
    const t = text(bits, index);
    const prev = prevText(bits, index);
    if (prev && /んじゃない/.test(prev) && /\?|みたいな|ような/.test(t)) {
      return {
        confidence: 0.9,
        evidence: [prev.trim(), t.trim()],
        direction: "forward",
        span: 1,
        features: { deflationStage: "progressive" },
      };
    }
    const match = /んじゃない|んじゃないか|でしょ/.exec(t);
    if (match) {
      return {
        confidence: 0.8,
        evidence: [match[0]],
        direction: "forward",
        span: 1,
        features: { deflationStage: "initial", marker: match[0] },
      };
    }
    return null;
  },
};

const connectorCompounding: PatternRule = {
  id: "seed-connector-compounding",
  name: "Connector Compounding",
  description:
    "Detects stacked filler-connector combinations (ま、だから, まあ、そういえば) that compound discourse structure.",
  relationshipType: "connector-compounding",
  priority: 75,
  examples: [
    "ま、だから", "まあ、だから", "まあそれで", "だからそれで",
    "ところで", "そういえば", "それで言うと", "ていうか、つまり",
    "まあ、その", "まあ、なんか", "だから、えーと",
    "えーと、つまり", "あのー、それで", "まあ言うてみれば",
    "それはそうと", "ちなみに", "ついでに言うと",
  ],
  createdFrom: "seed",
  hitCount: 0,
  detector(bits, index): PatternMatch | null {
    const t = text(bits, index);
    const match = /^(ま、?だから|まあ、?だから|まあそれで|だからそれで|ところで|そういえば|それで言うと|ていうか、?つまり|ちなみに|それはそうと|ついでに言うと)/.exec(t.trim());
    if (match) {
      return {
        confidence: 0.9,
        evidence: [match[0]],
        direction: "forward",
        span: 1,
        features: { connectorType: "stacked-filler", marker: match[0] },
      };
    }
    return null;
  },
};

const fuzzyReferenceChain: PatternRule = {
  id: "seed-fuzzy-reference-chain",
  name: "Fuzzy Reference Chain",
  description:
    "Detects approximation-marked referential chains: っぽいものとか, その辺の, あたりの, みたいなもの.",
  relationshipType: "fuzzy-reference-chain",
  priority: 60,
  examples: [
    "っぽいものとか", "その辺の", "あたりの", "的なもの",
    "みたいなもの", "そういった", "そういうの", "そういうもの",
    "そんなの", "そんな感じの", "あの辺", "その手の",
    "そのあたり", "みたいなの", "っぽいやつ", "系のもの",
    "っぽいもの", "らしいもの", "というか系",
  ],
  createdFrom: "seed",
  hitCount: 0,
  detector(bits, index): PatternMatch | null {
    const t = text(bits, index);
    const match = /っぽいものとか|その辺の|あたりの|的なもの|みたいなもの|そういった|そういうの|そんな感じ|その手の|そのあたり/.exec(t);
    if (match) {
      return {
        confidence: 0.85,
        evidence: [match[0]],
        direction: "forward",
        span: 1,
        features: { fuzzyMarker: match[0] },
      };
    }
    return null;
  },
};

const extendedReasoningStanceCap: PatternRule = {
  id: "seed-extended-reasoning-stance-cap",
  name: "Extended Reasoning → Stance Cap",
  description:
    "Detects わけ-capping constructions that close an extended reasoning sequence with an evaluative stance.",
  relationshipType: "extended-reasoning-stance-cap",
  priority: 80,
  examples: [
    "わけだ", "わけだけど", "わけで", "わけです", "わけじゃない",
    "わけだから", "わけですね", "わけですよ", "わけではない",
    "というわけだ", "というわけで", "そういうわけで",
    "そういうわけだ", "というわけです", "ってわけ",
    "ってわけだ", "わけでもない",
  ],
  createdFrom: "seed",
  hitCount: 0,
  detector(bits, index): PatternMatch | null {
    const t = text(bits, index);
    const match = /わけだ|わけだけど|わけで|わけです|わけじゃない|わけだから|ってわけ/.exec(t);
    if (match) {
      return {
        confidence: 0.9,
        evidence: [match[0]],
        direction: "forward",
        span: 1,
        features: { stanceCap: match[0] },
      };
    }
    return null;
  },
};

const epistemicSpeculationCascade: PatternRule = {
  id: "seed-epistemic-speculation-cascade",
  name: "Epistemic Speculation Cascade",
  description:
    "Detects きっと/たぶん/もしかして → のかもしれない multi-bit speculation arcs.",
  relationshipType: "epistemic-speculation-cascade",
  priority: 75,
  examples: [
    "きっと", "たぶん", "もしかして", "おそらく", "多分",
    "のかもしれない", "かもしれない", "かも", "かもな",
    "きっとそう", "たぶんそう", "もしかしたら",
    "ひょっとして", "ひょっとしたら", "かもしれないけど",
    "かもしれないね", "かもしれないよ",
  ],
  createdFrom: "seed",
  hitCount: 0,
  detector(bits, index, context): PatternMatch | null {
    const t = text(bits, index);
    if (/^きっと|^たぶん|^もしかして|^おそらく|^多分|^ひょっとして/.test(t.trim())) {
      const closeIdx = context.allTexts.findIndex(b => /のかもしれない|かもしれない|かも/.test(b));
      const hasClose = closeIdx >= 0;
      return {
        targetIndex: hasClose ? closeIdx : undefined,
        confidence: hasClose ? 0.9 : 0.65,
        evidence: [t.trim()],
        direction: "forward",
        span: hasClose ? Math.abs(closeIdx - index) : 1,
        features: { speculationAnchor: t.trim(), hasClosure: hasClose },
      };
    }
    if (/のかもしれない|かもしれない$/.test(t.trim())) {
      return {
        confidence: 0.85,
        evidence: [t.match(/のかもしれない|かもしれない/)?.[0] ?? "かもしれない"],
        direction: "forward",
        span: 1,
        features: { speculationClose: true },
      };
    }
    return null;
  },
};

const discourseFadeTrailOff: PatternRule = {
  id: "seed-discourse-fade-trail-off",
  name: "Discourse Fade / Trail-off",
  description:
    "Detects fade-out and trail-off markers: == boundary, …, ね。, よね。, かな。, だけど。",
  relationshipType: "discourse-fade-trail-off",
  priority: 50,
  examples: [
    "==", "…", "ね。", "よね。", "かな。", "だけど。",
    "けどね。", "んだけどね", "みたいな。", "って感じで。",
    "なんですけどね", "ですよね", "ですかね",
    "だよね", "じゃないですか", "かな", "かなあ",
    "ですかねえ", "ですよねえ",
  ],
  createdFrom: "seed",
  hitCount: 0,
  detector(bits, index): PatternMatch | null {
    const t = text(bits, index);
    const match = /==|…$|…。$|ね。$|よね。$|かな。$|だけど。$|けどね。$/.exec(t.trim());
    if (match) {
      return {
        confidence: 0.95,
        evidence: [match[0]],
        direction: "forward",
        span: 1,
        features: { fadeMarker: match[0] },
      };
    }
    return null;
  },
};

// ─── Public API ────────────────────────────────────────────────────────────────

/** Returns all 13 seed PatternRule objects. */
export function getSeedPatterns(): PatternRule[] {
  return [
    hedgeStanceSoftening,
    splitMorphemeCoConstruction,
    perspectiveFraming,
    interactionalPivot,
    epistemicContinuationBlend,
    discontinuousParallel,
    causalConcessive,
    assertionDeflation,
    connectorCompounding,
    fuzzyReferenceChain,
    extendedReasoningStanceCap,
    epistemicSpeculationCascade,
    discourseFadeTrailOff,
  ];
}

/** Creates and returns a PatternRegistry pre-loaded with all 13 seed patterns. */
export function buildSeedRegistry(): PatternRegistry {
  const registry = new PatternRegistry();
  for (const rule of getSeedPatterns()) {
    registry.register(rule);
  }
  return registry;
}
