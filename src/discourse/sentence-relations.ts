/**
 * sentence-relations.ts — Cross-sentence and intra-sentence relation detection engine.
 *
 * Detects connections between grammatical and discourse "pieces" both:
 *   - WITHIN a single sentence (intra-sentential)
 *   - ACROSS sentences by the same speaker (inter-sentential)
 *   - ACROSS speakers (inter-speaker / adjacency pairs)
 *
 * Research base:
 *   - 会話分析 (CA): adjacency pairs, preference organization, repair
 *   - 結束性理論 (Cohesion): Halliday & Hasan reference chains, lexical cohesion
 *   - 談話文法: Maynard's Japanese discourse grammar
 *   - 仁田義雄 et al.: clause-combining patterns (複文構造)
 *   - ポライトネス理論: Brown & Levinson face-work strategies
 *
 * Works with ANY Japanese YouTube content: 討論, 解説, 雑談, インタビュー, etc.
 */

import { detectPatterns, type PatternMatch } from './discourse-grammar';
import type { DiscoursePatternDef, PragmaticFunction } from './discourse-patterns';
import './discourse-roles'; // side-effect: assigns discourseRole/roleStrength to ALL_PATTERNS
import {
  extractSentenceFeatures,
  topicOverlap,
  detectNegationOf,
  computeConfidence,
  type SentenceFeatures,
} from './sentence-features';
import { annotateAct, type ActAnnotation } from './discourse-acts';
import { annotateMoves, type MoveAnnotation } from './conversational-state';

/**
 * Confidence floor: relations below this threshold are dropped before
 * being returned. Tuned so that connector-based intra-clause relations
 * (0.80) and well-evidenced adjacency pairs (>=0.65) survive, while
 * one-feature heuristics (~0.4-0.5) are filtered out.
 */
export const CONFIDENCE_FLOOR = 0.55;

// ══════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════

export type RelationType =
  // ── Intra-sentence clause combining ──
  | 'cause-effect'        // から/ので → result
  | 'concession-counter'  // けど/のに → but actually
  | 'conditional'         // ば/たら/なら → then
  | 'temporal-sequence'   // て/たら → then (time)
  | 'purpose'             // ために/ように → in order to
  | 'means'               // て/ことで → by means of
  | 'contrast'            // 一方/に対して → whereas
  | 'addition'            // し/上に → and also
  | 'elaboration'         // つまり/というのは → that is
  | 'exemplification'     // 例えば/たとえば → for instance
  // ── Cross-sentence cohesion ──
  | 'anaphoric-reference' // それ/あれ/この → refers back
  | 'lexical-repetition'  // 同じ語の繰り返し
  | 'lexical-chain'       // 関連語の連鎖
  | 'topic-continuation'  // は/が topic chain
  | 'scaffolding'         // まず→次に→最後に
  // ── Adjacency pairs (cross-speaker) ──
  | 'question-answer'
  | 'assertion-agreement'
  | 'assertion-disagreement'
  | 'offer-accept'
  | 'offer-decline'
  | 'complaint-remedy'
  | 'tsukkomi-boke'       // ツッコミ・ボケ pair
  | 'reaction'            // 反応 (backchannel in response)
  | 'repair-initiation'   // 修復開始
  | 'repair-completion'   // 修復完了
  // ── Discourse-level ──
  | 'topic-shift'
  | 'topic-return'
  | 'summary-of'
  | 'evidence-for'
  | 'counter-to'
  | 'hedge-then-assert'
  | 'setup-punchline'
  // ── Sidecar bit_relation (authoritative typed-relation from pipeline) ──
  // The pipeline emits a richer taxonomy than the heuristic union; we surface
  // them as three buckets keyed on reconciliation status so visualisation can
  // distinguish confidence levels without leaking pipeline-internal labels.
  | 'bit-relation-locked'
  | 'bit-relation-td'
  | 'bit-relation-bu';

export interface RelationSpan {
  /** Character offset in the full text */
  start: number;
  end: number;
  text: string;
  /** Which sentence index (0-based) */
  sentenceIdx: number;
  /** Speaker ID if multi-speaker */
  speaker?: string;
}

export interface SentenceRelation {
  type: RelationType;
  /** The source piece (cause, question, setup, etc.) */
  source: RelationSpan;
  /** The target piece (effect, answer, punchline, etc.) */
  target: RelationSpan;
  /** Confidence 0-1 */
  confidence: number;
  /** Display label in Japanese */
  label: string;
  /** Display label in English */
  labelEn: string;
  /** CSS color class for visualization */
  colorClass: string;
  /**
   * Machine-readable reason code explaining WHY this relation was emitted,
   * e.g. `connector:kara`, `pair:assertion-disagreement`, `anaphora:so`,
   * `lexical-repetition`, `sidecar:bit_relation`. Used for debugging and
   * for the discourse demo to show provenance.
   */
  reason?: string;
  /**
   * The surface substrings (markers, keywords, shared lexemes) that
   * triggered this relation. Surfaced in the UI so a reviewer can see
   * at a glance what evidence the parser used.
   */
  triggers?: string[];
}

export interface ContextChunk {
  /** The text of this context unit */
  text: string;
  start: number;
  end: number;
  /** Sentences contained in this chunk */
  sentences: SentenceParse[];
  /** All relations found within/across chunk sentences */
  relations: SentenceRelation[];
  /** Genre classification of this chunk */
  genre?: string;
  /** Speaker(s) in this chunk */
  speakers: string[];
}

export interface SentenceParse {
  text: string;
  start: number;
  end: number;
  speaker?: string;
  /** Discourse patterns found in this sentence */
  patterns: PatternMatch[];
  /** Clauses making up the sentence */
  clauses: ClauseParse[];
  /**
   * Multi-layer rhetorical annotation (WHAT/FUNCTION/FORM/SUBTYPE) for
   * this sentence. Populated by `analyzeRelations`. Local-only — does
   * not depend on cross-sentence dialogue state.
   */
  act?: ActAnnotation;
  /**
   * Thought-to-thought conversational MOVE for this sentence, computed
   * with reference to the running dialogue state (open questions,
   * standing claims, recent doubt). This is the layer that turns a
   * generic 例示 into a `defense-against-objection` when context
   * warrants. Populated by `analyzeRelations`.
   */
  move?: MoveAnnotation;
  /** Per-sentence linguistic features used by the parser. */
  features?: SentenceFeatures;
}

export interface ClauseParse {
  text: string;
  start: number; // relative to sentence start
  end: number;
  /** The connecting form leading to the next clause */
  connector?: string;
  connectorType?: 'te-form' | 'ba-form' | 'tara-form' | 'nara-form'
    | 'node' | 'kara' | 'kedo' | 'ga' | 'shi' | 'noni' | 'tame'
    | 'you-ni' | 'nagara' | 'tsutsu' | 'terminal';
}

// ══════════════════════════════════════════════════════════════
// CLAUSE SPLITTER — splits a sentence into connected clauses
// ══════════════════════════════════════════════════════════════

/** Clause connectors ordered longest-first for greedy match */
const CLAUSE_CONNECTORS: Array<{
  pattern: RegExp;
  type: ClauseParse['connectorType'];
}> = [
  { pattern: /けれども$/,   type: 'kedo' },
  { pattern: /ものの$/,     type: 'kedo' },
  { pattern: /にもかかわらず$/, type: 'kedo' },
  { pattern: /ながら$/,     type: 'nagara' as any },
  { pattern: /ために$/,     type: 'tame' },
  { pattern: /ように$/,     type: 'you-ni' },
  { pattern: /つつ$/,       type: 'tsutsu' as any },
  { pattern: /ので$/,       type: 'node' },
  { pattern: /から$/,       type: 'kara' },
  { pattern: /けど$/,       type: 'kedo' },
  { pattern: /のに$/,       type: 'noni' as any },
  { pattern: /たら$/,       type: 'tara-form' },
  { pattern: /なら$/,       type: 'nara-form' },
  { pattern: /ば$/,         type: 'ba-form' },
  { pattern: /が[、,]?$/,   type: 'ga' },
  { pattern: /し[、,]?$/,   type: 'shi' },
  { pattern: /て[、,]?$/,   type: 'te-form' },
  { pattern: /で[、,]?$/,   type: 'te-form' },
];

/**
 * Split a sentence into clauses based on connector forms.
 * Uses a simple heuristic: scan for clause-ending patterns and split.
 */
export function splitClauses(sentence: string, sentenceStart: number): ClauseParse[] {
  const clauses: ClauseParse[] = [];

  // Split on Japanese comma first for coarse segmentation
  const segments = sentence.split(/([、,])/);
  let offset = 0;

  let currentText = '';
  let currentStart = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === '、' || seg === ',') {
      currentText += seg;
      offset += seg.length;
      continue;
    }

    currentText += seg;
    offset += seg.length;

    // Check if this segment ends with a clause connector
    let matched = false;
    for (const { pattern, type } of CLAUSE_CONNECTORS) {
      if (pattern.test(currentText.trimEnd())) {
        clauses.push({
          text: currentText,
          start: currentStart,
          end: currentStart + currentText.length,
          connector: currentText.match(pattern)?.[0],
          connectorType: type,
        });
        currentStart = currentStart + currentText.length;
        currentText = '';
        matched = true;
        break;
      }
    }
  }

  // Remainder is the final clause
  if (currentText.trim()) {
    clauses.push({
      text: currentText,
      start: currentStart,
      end: currentStart + currentText.length,
      connectorType: 'terminal',
    });
  }

  // If no clauses were found, treat entire sentence as one
  if (clauses.length === 0) {
    clauses.push({
      text: sentence,
      start: 0,
      end: sentence.length,
      connectorType: 'terminal',
    });
  }

  // Adjust offsets relative to full text
  for (const c of clauses) {
    c.start += sentenceStart;
    c.end += sentenceStart;
  }

  return clauses;
}

// ══════════════════════════════════════════════════════════════
// ANAPHORIC REFERENCE DETECTION
// ══════════════════════════════════════════════════════════════

/** Demonstratives that create cross-sentence references */
const ANAPHORA_PATTERNS = [
  { regex: /(?:それ|その|そこ|そういう|そんな|そう(?:いった|した))/, series: 'so' },
  { regex: /(?:これ|この|ここ|こういう|こんな|こう(?:いった|した))/, series: 'ko' },
  { regex: /(?:あれ|あの|あそこ|ああいう|あんな|ああ(?:いった|した))/, series: 'a' },
];

// ══════════════════════════════════════════════════════════════
// ADJACENCY PAIR DETECTION (cross-speaker)
// ══════════════════════════════════════════════════════════════

/**
 * Feature-driven adjacency-pair definition.
 *
 * `evaluate` receives the parsed sentences AND the pre-computed
 * {@link SentenceFeatures} for each, and returns either `null` (rule does
 * not fire) or an object describing how confident the rule is and why.
 *
 * This replaces the old `firstPart`/`secondPart` callbacks which only
 * checked a single coarse `pragmaticFunction` tag — that design produced
 * many false positives because (a) several distinct discourse roles share
 * one tag (`しかし`/`が`/`けど` all = `contrast`), and (b) the rules used
 * `OR` over weak signals with no aligned-evidence check.
 *
 * Confidence convention:
 *   - 0.85+ : multiple corroborating features (e.g. strong opposition
 *             marker + speaker change + topic overlap + negation).
 *   - 0.65-0.80 : one strong feature + one corroborating feature.
 *   - <0.55 : will be filtered by {@link CONFIDENCE_FLOOR}.
 */
interface AdjacencyPairContext {
  s1: SentenceParse;
  s2: SentenceParse;
  f1: SentenceFeatures;
  f2: SentenceFeatures;
  sameSpeaker: boolean;
}

interface AdjacencyPairResult {
  reason: string;
  triggers: string[];
  confidence: number;
}

interface AdjacencyPairDef {
  type: RelationType;
  evaluate: (ctx: AdjacencyPairContext) => AdjacencyPairResult | null;
  label: string;
  labelEn: string;
}

const ADJACENCY_PAIRS: AdjacencyPairDef[] = [
  // ─────────────────────────────────────────────────────────
  // Question → Answer
  //   Requires: s1 is interrogative AND s2 is declarative.
  //   Boost for speaker change.
  // ─────────────────────────────────────────────────────────
  {
    type: 'question-answer',
    label: '質問→応答', labelEn: 'Question → Answer',
    evaluate: ({ f1, f2, sameSpeaker, s1 }) => {
      if (f1.speechAct !== 'interrogative') return null;
      if (f2.speechAct !== 'declarative' && f2.speechAct !== 'fragment') return null;
      const triggers: string[] = [f1.terminalForm.trim()];
      const confidence = computeConfidence(0.55, [
        [!sameSpeaker, 0.20],
        [topicOverlap(f1, f2) >= 0.6, 0.10],
        [f2.hasAssertionMarker, 0.05],
      ]);
      return { reason: 'pair:question-answer', triggers, confidence };
    },
  },

  // ─────────────────────────────────────────────────────────
  // Assertion → Agreement
  //   Requires: s1 ends as a declarative AND s2 leads with an
  //   agreement/backchannel marker OR has agreement role.
  //   Speaker change is a strong boost.
  // ─────────────────────────────────────────────────────────
  {
    type: 'assertion-agreement',
    label: '主張→同意', labelEn: 'Assertion → Agreement',
    evaluate: ({ f1, f2, sameSpeaker }) => {
      if (f1.speechAct !== 'declarative') return null;
      const role = f2.leadingMarker?.role;
      const isAgreement = role === 'agreement' || role === 'backchannel';
      if (!isAgreement && !f2.hasBackchannelStart) return null;
      // Same speaker giving themselves a backchannel doesn't count.
      if (sameSpeaker && !isAgreement) return null;
      const triggers: string[] = [];
      if (f2.leadingMarker) triggers.push(f2.leadingMarker.surface);
      const confidence = computeConfidence(0.55, [
        [!sameSpeaker, 0.15],
        [f2.leadingMarker?.strength === 'strong', 0.15],
        [f1.hasAssertionMarker, 0.05],
      ]);
      return { reason: 'pair:assertion-agreement', triggers, confidence };
    },
  },

  // ─────────────────────────────────────────────────────────
  // Assertion → Disagreement  ← THE BIG ONE
  //   Now requires real opposition evidence, not just `'contrast'`-
  //   tagged conjunctions. Specifically:
  //     - s1 is declarative + affirmative.
  //     - At least one of:
  //         (a) s2 leads with a STRONG opposition marker
  //         (b) s2 has an inline opposition trigger (ではなく, etc.)
  //         (c) s2 is negative AND mentions s1's predicate head
  //         (d) s2 opens with explicit disagreement (いや, 違う)
  //     - Topic overlap or explicit reference (otherwise it's a
  //       topic-shift, not a disagreement).
  //     - Different speakers OR explicit self-repair triggers.
  //     - s2's leading marker is NOT a topic-shift (ところで, etc.).
  // ─────────────────────────────────────────────────────────
  {
    type: 'assertion-disagreement',
    label: '主張→反論', labelEn: 'Assertion → Disagreement',
    evaluate: ({ f1, f2, s1, s2, sameSpeaker }) => {
      if (f1.speechAct !== 'declarative') return null;
      if (f1.polarity !== 'affirmative') return null;
      if (f2.speechAct !== 'declarative' && f2.speechAct !== 'fragment') return null;
      // Veto: explicit topic-shift opener disqualifies "disagreement".
      if (f2.leadingMarker?.role === 'topic-shift') return null;
      // Veto: agreement/backchannel/reaction openers disqualify.
      if (f2.leadingMarker?.role === 'agreement' || f2.leadingMarker?.role === 'backchannel') return null;

      const hasStrongLeadOpposition =
        f2.leadingMarker?.role === 'opposition' && f2.leadingMarker.strength === 'strong';
      const hasInlineOpposition = f2.oppositionTriggers.some(t => t.position === 'inline');
      const hasDisagreementOpener = f2.hasDisagreementOpener;
      const negatesPrev = detectNegationOf(f1, f2, s2.text);

      const oppositionEvidence =
        hasStrongLeadOpposition || hasInlineOpposition || hasDisagreementOpener || negatesPrev;
      if (!oppositionEvidence) return null;

      const overlap = topicOverlap(f1, f2);
      // Require topic overlap unless we have an inline ではなく / 違う opener
      // (those are explicit semantic flips on the previous claim).
      const hasExplicitRef = hasInlineOpposition || hasDisagreementOpener;
      if (overlap < 0.6 && !hasExplicitRef) return null;

      // Same-speaker disagreement is only allowed if it's an explicit
      // self-repair (じゃなくて, そうじゃなくて, 違う違う). Otherwise it's
      // just the speaker continuing their own argument.
      if (sameSpeaker && f2.repairTriggers.length === 0 && !hasInlineOpposition) return null;

      const triggers: string[] = [];
      if (f2.leadingMarker?.role === 'opposition') triggers.push(f2.leadingMarker.surface);
      for (const t of f2.oppositionTriggers) triggers.push(t.text);
      if (hasDisagreementOpener) {
        const m = s2.text.trim().match(/^(いや+|違う+|そうじゃ(?:なくて|ない)|ちが(?:う|くて))/);
        if (m) triggers.push(m[1]);
      }
      if (negatesPrev && f1.predicateHead) triggers.push(`¬${f1.predicateHead}`);
      if (f2.repairTriggers.length) triggers.push(...f2.repairTriggers);

      const confidence = computeConfidence(0.50, [
        [hasStrongLeadOpposition, 0.15],
        [hasInlineOpposition, 0.20],
        [hasDisagreementOpener, 0.15],
        [negatesPrev, 0.15],
        [overlap >= 1.0, 0.10],
        [!sameSpeaker, 0.10],
      ]);
      return { reason: 'pair:assertion-disagreement', triggers, confidence };
    },
  },

  // ─────────────────────────────────────────────────────────
  // ツッコミ・ボケ pair
  //   Requires: s2 starts with corrective opener OR contains an
  //   explicit ツッコミ phrase, AND speaker change.
  // ─────────────────────────────────────────────────────────
  {
    type: 'tsukkomi-boke',
    label: 'ボケ→ツッコミ', labelEn: 'Boke → Tsukkomi',
    evaluate: ({ s1, s2, f1, f2, sameSpeaker }) => {
      if (sameSpeaker) return null;
      const tsukkomiTriggers = s2.text.match(/(?:なんでやねん|ちゃうわ|おい[っ！!]?|どないやねん|ありえへん)/);
      const correctiveStart = /^(?:違う|そうじゃなくて|いやいや|それは違|待って待って|ちゃうちゃう)/.test(s2.text.trim());
      if (!tsukkomiTriggers && !correctiveStart) return null;
      const triggers: string[] = [];
      if (tsukkomiTriggers) triggers.push(tsukkomiTriggers[0]);
      if (correctiveStart) {
        const m = s2.text.trim().match(/^(違う|そうじゃなくて|いやいや|それは違|待って待って|ちゃうちゃう)/);
        if (m) triggers.push(m[1]);
      }
      const confidence = computeConfidence(0.65, [
        [!!tsukkomiTriggers, 0.20],
        [f1.speechAct === 'declarative', 0.05],
      ]);
      return { reason: 'pair:tsukkomi-boke', triggers, confidence };
    },
  },

  // ─────────────────────────────────────────────────────────
  // Reaction
  //   Requires: s2 leads with a reaction or backchannel marker AND
  //   speaker change (a speaker reacting to themselves is suspicious).
  // ─────────────────────────────────────────────────────────
  {
    type: 'reaction',
    label: '発話→反応', labelEn: 'Utterance → Reaction',
    evaluate: ({ f2, sameSpeaker }) => {
      if (sameSpeaker) return null;
      const role = f2.leadingMarker?.role;
      if (!f2.hasReactionStart && !f2.hasBackchannelStart && role !== 'reaction' && role !== 'backchannel' && role !== 'agreement') {
        return null;
      }
      const triggers: string[] = [];
      if (f2.leadingMarker) triggers.push(f2.leadingMarker.surface);
      const confidence = computeConfidence(0.60, [
        [f2.leadingMarker?.strength === 'strong', 0.15],
        [f2.hasReactionStart, 0.10],
      ]);
      return { reason: 'pair:reaction', triggers, confidence };
    },
  },

  // ─────────────────────────────────────────────────────────
  // Setup → Punchline
  //   Requires: s1 contains a quotative wind-up (って言ったら / って聞いたら /
  //   ってなったら) AND s2 contains an emotive reaction OR strong evaluation.
  //   Speaker change boosts confidence (storytelling-then-react).
  // ─────────────────────────────────────────────────────────
  {
    type: 'setup-punchline',
    label: '設定→オチ', labelEn: 'Setup → Punchline',
    evaluate: ({ s1, s2, f2 }) => {
      const setup = s1.text.match(/って(?:言ったら|聞いたら|なったら|思ったら)/);
      if (!setup) return null;
      const hasReact = f2.hasReactionStart || /[！!]{1,}/.test(s2.text);
      if (!hasReact) return null;
      const triggers = [setup[0]];
      const reactMatch = s2.text.trim().match(/^(え[ー〜]?|うそ|まじ|やば|すご)/);
      if (reactMatch) triggers.push(reactMatch[1]);
      const confidence = computeConfidence(0.65, [
        [f2.hasReactionStart, 0.15],
      ]);
      return { reason: 'pair:setup-punchline', triggers, confidence };
    },
  },

  // ─────────────────────────────────────────────────────────
  // Repair initiation → Repair
  //   Requires: s1 is a clarification request (え?, 何?, は?) AND s2
  //   contains a repair trigger AND speaker change.
  // ─────────────────────────────────────────────────────────
  {
    type: 'repair-initiation',
    label: '修復開始→修復', labelEn: 'Repair Init → Repair',
    evaluate: ({ s1, f2, sameSpeaker }) => {
      const initiator = s1.text.trim().match(/^(?:え[？?]|何[？?]|は[？?]|ん[？?]|もう一回|もう1回|どういうこと[？?])/);
      if (!initiator) return null;
      if (f2.repairTriggers.length === 0) return null;
      if (sameSpeaker) return null;
      const triggers = [initiator[0], ...f2.repairTriggers];
      const confidence = computeConfidence(0.70, [
        [f2.repairTriggers.length >= 2, 0.10],
      ]);
      return { reason: 'pair:repair-initiation', triggers, confidence };
    },
  },

  // ─────────────────────────────────────────────────────────
  // Concession → Counter
  //   Requires: s1 leads with concession marker (確かに, もちろん, ただし)
  //   AND s2 leads with opposition marker. Topic overlap required.
  //   Same speaker is the normal case (rhetorical concession then pivot).
  // ─────────────────────────────────────────────────────────
  {
    type: 'concession-counter',
    label: '譲歩→反論', labelEn: 'Concession → Counter',
    evaluate: ({ f1, f2 }) => {
      if (f1.leadingMarker?.role !== 'concession') return null;
      const oppRole = f2.leadingMarker?.role;
      if (oppRole !== 'opposition' && f2.oppositionTriggers.length === 0) return null;
      const overlap = topicOverlap(f1, f2);
      if (overlap < 0.6) return null;
      const triggers: string[] = [f1.leadingMarker.surface];
      if (f2.leadingMarker) triggers.push(f2.leadingMarker.surface);
      for (const t of f2.oppositionTriggers) triggers.push(t.text);
      const confidence = computeConfidence(0.70, [
        [f2.leadingMarker?.strength === 'strong', 0.10],
        [overlap >= 1.0, 0.10],
      ]);
      return { reason: 'pair:concession-counter', triggers, confidence };
    },
  },

  // ─────────────────────────────────────────────────────────
  // Evidence → Conclusion
  //   Requires: s1 has cause/elaboration marker AND s2 leads with
  //   summary/consequence marker. Same speaker. Topic overlap.
  // ─────────────────────────────────────────────────────────
  {
    type: 'evidence-for',
    label: '根拠→結論', labelEn: 'Evidence → Conclusion',
    evaluate: ({ f1, f2, sameSpeaker }) => {
      if (!sameSpeaker) return null;
      const f1Role = f1.leadingMarker?.role;
      const hasEvidence = f1Role === 'cause' || f1Role === 'elaboration' || f1Role === 'exemplification';
      if (!hasEvidence) return null;
      const f2Role = f2.leadingMarker?.role;
      const hasConclusion = f2Role === 'summary' || f2Role === 'consequence' || f2Role === 'rephrasing';
      if (!hasConclusion) return null;
      const overlap = topicOverlap(f1, f2);
      if (overlap < 0.6) return null;
      const triggers = [f1.leadingMarker!.surface, f2.leadingMarker!.surface];
      const confidence = computeConfidence(0.70, [
        [f2.leadingMarker?.strength === 'strong', 0.10],
        [overlap >= 1.0, 0.10],
      ]);
      return { reason: 'pair:evidence-for', triggers, confidence };
    },
  },

  // ─────────────────────────────────────────────────────────
  // Hedge → Assert
  //   Requires: s1 ends with a hedge AND s2 ends with assertion
  //   marker. Same speaker. Topic overlap.
  // ─────────────────────────────────────────────────────────
  {
    type: 'hedge-then-assert',
    label: 'ヘッジ→主張', labelEn: 'Hedge → Assert',
    evaluate: ({ f1, f2, sameSpeaker }) => {
      if (!sameSpeaker) return null;
      if (!f1.hasHedge) return null;
      if (!f2.hasAssertionMarker) return null;
      const overlap = topicOverlap(f1, f2);
      if (overlap < 0.6) return null;
      const triggers: string[] = [];
      if (f1.leadingMarker?.role === 'hedge') triggers.push(f1.leadingMarker.surface);
      triggers.push(f1.terminalForm.trim(), f2.terminalForm.trim());
      const confidence = computeConfidence(0.65, [
        [overlap >= 1.0, 0.10],
      ]);
      return { reason: 'pair:hedge-then-assert', triggers, confidence };
    },
  },

  // ─────────────────────────────────────────────────────────
  // Topic shift (sentence-level)
  //   When s2 leads with a strong topic-shift marker we emit an
  //   explicit `topic-shift` relation so the demo can show "this is
  //   NOT a continuation."
  // ─────────────────────────────────────────────────────────
  {
    type: 'topic-shift',
    label: '話題転換', labelEn: 'Topic shift',
    evaluate: ({ f2 }) => {
      if (f2.leadingMarker?.role !== 'topic-shift') return null;
      if (f2.leadingMarker.strength === 'weak') return null;
      const triggers = [f2.leadingMarker.surface];
      const confidence = computeConfidence(0.70, [
        [f2.leadingMarker.strength === 'strong', 0.10],
      ]);
      return { reason: 'pair:topic-shift', triggers, confidence };
    },
  },
];

// ══════════════════════════════════════════════════════════════
// COLOR ASSIGNMENTS FOR VISUALIZATION
// ══════════════════════════════════════════════════════════════

export const RELATION_COLORS: Record<RelationType, string> = {
  'cause-effect': 'jp-rel-cause',
  'concession-counter': 'jp-rel-concession',
  'conditional': 'jp-rel-conditional',
  'temporal-sequence': 'jp-rel-temporal',
  'purpose': 'jp-rel-purpose',
  'means': 'jp-rel-means',
  'contrast': 'jp-rel-contrast',
  'addition': 'jp-rel-addition',
  'elaboration': 'jp-rel-elaboration',
  'exemplification': 'jp-rel-example',
  'anaphoric-reference': 'jp-rel-reference',
  'lexical-repetition': 'jp-rel-repetition',
  'lexical-chain': 'jp-rel-lexchain',
  'topic-continuation': 'jp-rel-topic',
  'scaffolding': 'jp-rel-scaffold',
  'question-answer': 'jp-rel-qa',
  'assertion-agreement': 'jp-rel-agree',
  'assertion-disagreement': 'jp-rel-disagree',
  'offer-accept': 'jp-rel-offer',
  'offer-decline': 'jp-rel-decline',
  'complaint-remedy': 'jp-rel-complaint',
  'tsukkomi-boke': 'jp-rel-tsukkomi',
  'reaction': 'jp-rel-reaction',
  'repair-initiation': 'jp-rel-repair',
  'repair-completion': 'jp-rel-repair',
  'topic-shift': 'jp-rel-shift',
  'topic-return': 'jp-rel-return',
  'summary-of': 'jp-rel-summary',
  'evidence-for': 'jp-rel-evidence',
  'counter-to': 'jp-rel-counter',
  'hedge-then-assert': 'jp-rel-hedge',
  'setup-punchline': 'jp-rel-punchline',
  'bit-relation-locked': 'jp-rel-bit-locked',
  'bit-relation-td':     'jp-rel-bit-td',
  'bit-relation-bu':     'jp-rel-bit-bu',
};

// ══════════════════════════════════════════════════════════════
// CONNECTOR → RELATION MAPPING (intra-sentence)
// ══════════════════════════════════════════════════════════════

const CONNECTOR_RELATIONS: Record<string, { type: RelationType; label: string; labelEn: string }> = {
  'kara':      { type: 'cause-effect',       label: '因果（から）',  labelEn: 'Cause (kara)' },
  'node':      { type: 'cause-effect',       label: '因果（ので）',  labelEn: 'Cause (node)' },
  'kedo':      { type: 'concession-counter',  label: '逆接（けど）',  labelEn: 'Concession (kedo)' },
  'ga':        { type: 'contrast',            label: '対比（が）',    labelEn: 'Contrast (ga)' },
  'noni':      { type: 'concession-counter',  label: '逆接（のに）',  labelEn: 'Concession (noni)' },
  'ba-form':   { type: 'conditional',         label: '条件（ば）',    labelEn: 'Conditional (ba)' },
  'tara-form': { type: 'conditional',         label: '条件（たら）',  labelEn: 'Conditional (tara)' },
  'nara-form': { type: 'conditional',         label: '条件（なら）',  labelEn: 'Conditional (nara)' },
  'te-form':   { type: 'temporal-sequence',   label: '継起（て形）',  labelEn: 'Sequential (te)' },
  'tame':      { type: 'purpose',             label: '目的（ため）',  labelEn: 'Purpose (tame)' },
  'you-ni':    { type: 'purpose',             label: '目的（ように）', labelEn: 'Purpose (you-ni)' },
  'shi':       { type: 'addition',            label: '並列（し）',    labelEn: 'Addition (shi)' },
  'nagara':    { type: 'temporal-sequence',   label: '同時（ながら）', labelEn: 'Simultaneous (nagara)' },
  'tsutsu':    { type: 'temporal-sequence',   label: '漸進（つつ）',  labelEn: 'Gradual (tsutsu)' },
};

// ══════════════════════════════════════════════════════════════
// MAIN ENGINE: analyzeRelations
// ══════════════════════════════════════════════════════════════

/**
 * Split text into sentences, heuristically handling Japanese punctuation
 * and YTranscript-style formatting.
 */
function splitSentences(text: string): Array<{ text: string; start: number; end: number; speaker?: string }> {
  const results: Array<{ text: string; start: number; end: number; speaker?: string }> = [];

  // Detect speaker labels: "Speaker: text" or "[Speaker] text" or "Name「text」"
  const lines = text.split('\n');
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { offset += line.length + 1; continue; }

    // Speaker detection
    let speaker: string | undefined;
    let content = trimmed;

    // Pattern: "name: text" or "name：text"
    const speakerMatch = trimmed.match(/^([^\s:：]{1,20})[：:]\s*(.+)/);
    if (speakerMatch) {
      speaker = speakerMatch[1];
      content = speakerMatch[2];
    }

    // Split on terminal punctuation
    const sentRegex = /[^。！？!?\n]*[。！？!?][」』）\)]*|[^。！？!?\n]+$/gm;
    let match: RegExpExecArray | null;
    let localOffset = offset + (trimmed.length - content.length + (line.length - trimmed.length));

    // Use indexOf to find the content start in the original line
    const contentStart = offset + line.indexOf(content);

    sentRegex.lastIndex = 0;
    while ((match = sentRegex.exec(content)) !== null) {
      const sentText = match[0].trim();
      if (!sentText) continue;
      results.push({
        text: sentText,
        start: contentStart + match.index,
        end: contentStart + match.index + match[0].length,
        speaker,
      });
    }

    // If no matches, whole line is a sentence
    if (results.length === 0 || results[results.length - 1].end <= offset) {
      results.push({
        text: content,
        start: contentStart,
        end: contentStart + content.length,
        speaker,
      });
    }

    offset += line.length + 1;
  }

  return results;
}

/**
 * Extract content words (nouns, verbs — kanji runs) for lexical cohesion detection.
 */
function extractContentWords(text: string): string[] {
  const kanjiRuns = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]{2,}/g) ?? [];
  const katakanaRuns = text.match(/[\u30a1-\u30f6ー]{3,}/g) ?? [];
  return [...kanjiRuns, ...katakanaRuns];
}

/**
 * Full relation analysis of a text passage.
 *
 * Detects:
 * 1. Intra-sentence clause relations (connector-based)
 * 2. Cross-sentence discourse pattern relations
 * 3. Cross-speaker adjacency pairs
 * 4. Anaphoric reference chains
 * 5. Lexical cohesion chains
 */
export function analyzeRelations(text: string): {
  sentences: SentenceParse[];
  relations: SentenceRelation[];
  chunks: ContextChunk[];
} {
  // Step 1: Split into sentences
  const rawSentences = splitSentences(text);

  // Step 2: Parse each sentence
  const sentences: SentenceParse[] = rawSentences.map((s, idx) => {
    const patterns = detectPatterns(s.text);
    const clauses = splitClauses(s.text, s.start);
    return {
      text: s.text,
      start: s.start,
      end: s.end,
      speaker: s.speaker,
      patterns,
      clauses,
    };
  });

  const relations: SentenceRelation[] = [];

  // ── Step 3: Intra-sentence clause relations ──
  for (let si = 0; si < sentences.length; si++) {
    const sent = sentences[si];
    for (let ci = 0; ci < sent.clauses.length - 1; ci++) {
      const clause = sent.clauses[ci];
      const nextClause = sent.clauses[ci + 1];
      if (!clause.connectorType || clause.connectorType === 'terminal') continue;

      const relDef = CONNECTOR_RELATIONS[clause.connectorType];
      if (!relDef) continue;

      relations.push({
        type: relDef.type,
        source: {
          start: clause.start, end: clause.end,
          text: clause.text, sentenceIdx: si,
          speaker: sent.speaker,
        },
        target: {
          start: nextClause.start, end: nextClause.end,
          text: nextClause.text, sentenceIdx: si,
          speaker: sent.speaker,
        },
        confidence: 0.85,
        label: relDef.label,
        labelEn: relDef.labelEn,
        colorClass: RELATION_COLORS[relDef.type],
        reason: `connector:${clause.connectorType}`,
        triggers: clause.connector ? [clause.connector] : [],
      });
    }
  }

  // Pre-compute sentence features once.
  const features: SentenceFeatures[] = sentences.map(extractSentenceFeatures);

  // Multi-layer per-sentence rhetorical annotation
  // (WHAT/FUNCTION/FORM/SUBTYPE).
  const acts: ActAnnotation[] = sentences.map((s, i) => annotateAct(s, features[i]));

  // Thought-to-thought conversational MOVE, computed with running state.
  const moves: MoveAnnotation[] = annotateMoves(sentences, features, acts);

  // Attach to each SentenceParse so downstream code (demo, UI) can read.
  for (let i = 0; i < sentences.length; i++) {
    sentences[i].features = features[i];
    sentences[i].act = acts[i];
    sentences[i].move = moves[i];
  }

  // ── Step 4: Cross-sentence relations (adjacency pairs + discourse) ──
  for (let i = 0; i < sentences.length - 1; i++) {
    const s1 = sentences[i];
    const s2 = sentences[i + 1];
    const f1 = features[i];
    const f2 = features[i + 1];
    const sameSpeaker = !!s1.speaker && !!s2.speaker && s1.speaker === s2.speaker;
    const ctx: AdjacencyPairContext = { s1, s2, f1, f2, sameSpeaker };

    for (const pair of ADJACENCY_PAIRS) {
      const result = pair.evaluate(ctx);
      if (!result) continue;
      relations.push({
        type: pair.type,
        source: { start: s1.start, end: s1.end, text: s1.text, sentenceIdx: i, speaker: s1.speaker },
        target: { start: s2.start, end: s2.end, text: s2.text, sentenceIdx: i + 1, speaker: s2.speaker },
        confidence: result.confidence,
        label: pair.label,
        labelEn: pair.labelEn,
        colorClass: RELATION_COLORS[pair.type],
        reason: result.reason,
        triggers: result.triggers,
      });
    }

    // Connect scaffolding sequences (まず → 次に → 最後に)
    const scaffoldFuncs: PragmaticFunction[] = ['sequence'];
    const s1Scaffold = s1.patterns.find(p => scaffoldFuncs.includes(p.pattern.pragmaticFunction));
    const s2Scaffold = s2.patterns.find(p => scaffoldFuncs.includes(p.pattern.pragmaticFunction));
    if (s1Scaffold && s2Scaffold) {
      relations.push({
        type: 'scaffolding',
        source: { start: s1.start, end: s1.end, text: s1.text, sentenceIdx: i, speaker: s1.speaker },
        target: { start: s2.start, end: s2.end, text: s2.text, sentenceIdx: i + 1, speaker: s2.speaker },
        confidence: 0.75,
        label: '列挙連鎖', labelEn: 'Scaffolding chain',
        colorClass: RELATION_COLORS['scaffolding'],
        reason: 'scaffolding:sequence',
        triggers: [s1Scaffold.matchedText, s2Scaffold.matchedText],
      });
    }
  }

  // ── Step 5: Anaphoric references (cross-sentence) ──
  for (let i = 1; i < sentences.length; i++) {
    const s = sentences[i];
    for (const ap of ANAPHORA_PATTERNS) {
      const match = s.text.match(ap.regex);
      if (match) {
        // Find the closest previous sentence to reference
        const prevSent = sentences[i - 1];
        relations.push({
          type: 'anaphoric-reference',
          source: { start: prevSent.start, end: prevSent.end, text: prevSent.text, sentenceIdx: i - 1, speaker: prevSent.speaker },
          target: { start: s.start + (match.index ?? 0), end: s.start + (match.index ?? 0) + match[0].length, text: match[0], sentenceIdx: i, speaker: s.speaker },
          confidence: 0.65,
          label: '照応（' + ap.series + '系）', labelEn: `Anaphora (${ap.series}-series)`,
          colorClass: RELATION_COLORS['anaphoric-reference'],
          reason: `anaphora:${ap.series}`,
          triggers: [match[0]],
        });
      }
    }
  }

  // ── Step 6: Lexical repetition chains ──
  for (let i = 0; i < sentences.length; i++) {
    const words1 = extractContentWords(sentences[i].text);
    // Check next 3 sentences for repetitions
    for (let j = i + 1; j < Math.min(i + 4, sentences.length); j++) {
      const words2 = extractContentWords(sentences[j].text);
      const shared = words1.filter(w => words2.includes(w));
      if (shared.length > 0) {
        relations.push({
          type: 'lexical-repetition',
          source: { start: sentences[i].start, end: sentences[i].end, text: shared[0], sentenceIdx: i, speaker: sentences[i].speaker },
          target: { start: sentences[j].start, end: sentences[j].end, text: shared[0], sentenceIdx: j, speaker: sentences[j].speaker },
          confidence: 0.6,
          label: '語彙反復「' + shared[0] + '」', labelEn: `Lexical repetition "${shared[0]}"`,
          colorClass: RELATION_COLORS['lexical-repetition'],
          reason: 'lexical-repetition',
          triggers: shared.slice(0, 3),
        });
      }
    }
  }

  // ── Step 7: Filter sub-threshold relations ──
  const filtered = relations.filter(r => r.confidence >= CONFIDENCE_FLOOR);

  // ── Step 8: Group into context chunks ──
  const chunks = buildContextChunks(sentences, filtered);

  return { sentences, relations: filtered, chunks };
}

// ══════════════════════════════════════════════════════════════
// CONTEXT CHUNK BUILDER
// ══════════════════════════════════════════════════════════════

/**
 * Groups sentences into coherent context chunks based on topic boundaries
 * and relation density. A chunk break occurs when:
 * 1. A topic-shift pattern is detected
 * 2. A speaker change occurs (in multi-speaker)
 * 3. There's no relation connecting two adjacent sentences
 */
function buildContextChunks(
  sentences: SentenceParse[],
  relations: SentenceRelation[],
): ContextChunk[] {
  if (sentences.length === 0) return [];

  const chunks: ContextChunk[] = [];
  let chunkStart = 0;

  for (let i = 1; i < sentences.length; i++) {
    const prev = sentences[i - 1];
    const curr = sentences[i];

    // Check for topic-shift patterns
    const hasTopicShift = curr.patterns.some(p =>
      p.pattern.pragmaticFunction === 'topic-shift'
    );

    // Check if any relation connects i-1 to i
    const hasRelation = relations.some(r =>
      (r.source.sentenceIdx === i - 1 && r.target.sentenceIdx === i) ||
      (r.source.sentenceIdx === i && r.target.sentenceIdx === i - 1)
    );

    // Break chunk on topic shift with no connecting relations
    if (hasTopicShift && !hasRelation) {
      const chunkSents = sentences.slice(chunkStart, i);
      const chunkRels = relations.filter(r =>
        r.source.sentenceIdx >= chunkStart && r.target.sentenceIdx < i
      );

      chunks.push({
        text: chunkSents.map(s => s.text).join(''),
        start: chunkSents[0].start,
        end: chunkSents[chunkSents.length - 1].end,
        sentences: chunkSents,
        relations: chunkRels,
        speakers: [...new Set(chunkSents.map(s => s.speaker).filter((s): s is string => !!s))],
      });

      chunkStart = i;
    }
  }

  // Final chunk
  const chunkSents = sentences.slice(chunkStart);
  if (chunkSents.length > 0) {
    const chunkRels = relations.filter(r =>
      r.source.sentenceIdx >= chunkStart
    );
    chunks.push({
      text: chunkSents.map(s => s.text).join(''),
      start: chunkSents[0].start,
      end: chunkSents[chunkSents.length - 1].end,
      sentences: chunkSents,
      relations: chunkRels,
      speakers: [...new Set(chunkSents.map(s => s.speaker).filter((s): s is string => !!s))],
    });
  }

  return chunks;
}

/**
 * Quick summary of relations found — for display in notices.
 */
export function summarizeRelations(relations: SentenceRelation[]): string {
  const byType = new Map<RelationType, number>();
  for (const r of relations) {
    byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [type, count] of byType) {
    const label = relations.find(r => r.type === type)?.label ?? type;
    parts.push(`${label}×${count}`);
  }
  return parts.join('、') || '関係なし';
}
