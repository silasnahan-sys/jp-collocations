/**
 * conversational-state.ts — Sequential dialogue-state machine + the
 * "thought-to-thought" MOVE layer.
 *
 * The user's design note:
 *   "thought level is like this is say person A who was doing an
 *    explanation responding to person B's question that sowed doubt in
 *    their explanation (this is the thought to thought idea, where this
 *    例示 in this particular discourse makes the discourse a 受け答え
 *    considering where it stands at that moment of discourse)"
 *
 * That is: the same 例示 (Layer 1 = exemplification) can become a
 * `defense-against-objection` MOVE if the prior turn from the other
 * speaker sowed doubt — OR a plain `evidence-providing` MOVE if it
 * appears mid-monologue.
 *
 * Implementation:
 *   - Walk through sentences left-to-right.
 *   - Maintain a tiny dialogue state:
 *       * openQuestions  — questions asked by speaker X awaiting answer
 *                          from speaker Y (other speaker).
 *       * standingClaims — recent assertions by each speaker that have
 *                          NOT yet been agreed/disagreed with.
 *       * lastDoubtBy    — most recent speaker who sowed doubt (asked a
 *                          rhetorical Q, raised an objection, gave a
 *                          clarification-request) and on whose target.
 *       * lastMoveBySpeaker — for turn-management.
 *   - On each new sentence:
 *       1. Read its act + features.
 *       2. Look up dialogue state to decide the MOVE.
 *       3. Update the state with this sentence's effect.
 *
 * MOVE is intentionally a SINGLE label per sentence (the dominant
 * conversational role at this exact moment). If multiple apply, the
 * resolver picks the strongest.
 */

import type { SentenceParse } from './sentence-relations';
import type { SentenceFeatures } from './sentence-features';
import type { ActAnnotation, RhetoricalAct } from './discourse-acts';
import { topicOverlap } from './sentence-features';

// ── Move taxonomy ─────────────────────────────────────────────

/**
 * The conversational MOVE — what this sentence is DOING at this moment
 * in the discourse, given the dialogue state. This is the layer that
 * cannot be assigned from the sentence alone.
 */
export type ConversationalMove =
  // ── Response to prior turn ──
  | 'answer-to-question'             // declarative answers an open Q from other speaker
  | 'partial-answer'                  // gives some info but defers / hedges full answer
  | 'evasion'                         // changes topic / hedges past the question
  | 'counter-question'                // answers a Q with a Q
  | 'clarification-of-own-prior'     // self-repair on own previous turn
  | 'reformulation-after-pushback'   // rephrase after other speaker raised objection
  | 'defense-against-objection'      // example/justification AFTER doubt was sown
  | 'pre-emptive-clarification'       // hedge / example before any doubt is sown
  | 'acceptance-of-correction'        // "そうですね、確かに" after correction
  | 'rejection-of-correction'         // pushes back on a correction
  // ── Same-speaker continuation ──
  | 'monologic-elaboration'           // continues own claim with example/elab (no objection in play)
  | 'monologic-justification'         // gives reason for own claim
  | 'monologic-summary'               // wraps up own segment
  | 'monologic-pivot'                 // own concession-then-counter
  // ── Initiating moves ──
  | 'claim-launch'                    // first assertion on a new topic
  | 'topic-launch'                    // explicit new topic
  | 'topic-resumption'                // returning to a prior topic
  | 'question-launch'                 // asks a new Q
  | 'doubt-sowing-challenge'          // rhetorical Q or hedged challenge to other speaker
  // ── Listener moves ──
  | 'backchannel'                     // pure receipt token
  | 'aligned-uptake'                  // agreement / 確かに / そうですね
  | 'reactive-uptake'                 // えー / うそ / やば
  // ── Default ──
  | 'continuation'                    // unmarked continuation
  | 'unclassified';

// ── Dialogue state ────────────────────────────────────────────

interface OpenQuestion {
  sentenceIdx: number;
  asker: string;        // speaker who asked
  topicNPs: string[];   // for matching answer to question
  predicateHead: string | null;
  /** Set true once we count it as answered. */
  closed: boolean;
}

interface StandingClaim {
  sentenceIdx: number;
  claimer: string;
  topicNPs: string[];
  predicateHead: string | null;
  /** Did the OTHER speaker raise doubt/objection on this claim? */
  challenged: boolean;
  /** Did the claimer already defend it? */
  defended: boolean;
}

interface DoubtRaised {
  sentenceIdx: number;
  raiser: string;
  againstSpeaker: string;
  topicNPs: string[];
  /** How many turns ago, decremented as we advance. */
  age: number;
}

export interface DialogueState {
  openQuestions: OpenQuestion[];
  standingClaims: StandingClaim[];
  recentDoubts: DoubtRaised[];
  lastSpeaker: string | null;
  lastMoveBySpeaker: Map<string, ConversationalMove>;
  /** Index of the last sentence whose act = topic-management. */
  lastTopicLaunchIdx: number;
}

export function newDialogueState(): DialogueState {
  return {
    openQuestions: [],
    standingClaims: [],
    recentDoubts: [],
    lastSpeaker: null,
    lastMoveBySpeaker: new Map(),
    lastTopicLaunchIdx: -1,
  };
}

// ── Per-sentence move annotation ──────────────────────────────

export interface MoveAnnotation {
  move: ConversationalMove;
  /** Why this move was chosen — references to state items + surface evidence. */
  reason: string;
  /** Surface substrings / state-item descriptors that drove it. */
  evidence: string[];
  /** 0-1 */
  confidence: number;
}

// ── Helpers ──────────────────────────────────────────────────

const SPEAKER_UNKNOWN = '__unknown__';
function speakerOf(s: SentenceParse): string {
  return s.speaker ?? SPEAKER_UNKNOWN;
}

function sameSpeaker(a: SentenceParse, b: SentenceParse): boolean {
  const sa = speakerOf(a), sb = speakerOf(b);
  return sa !== SPEAKER_UNKNOWN && sb !== SPEAKER_UNKNOWN && sa === sb;
}

function differentSpeaker(a: SentenceParse, b: SentenceParse): boolean {
  const sa = speakerOf(a), sb = speakerOf(b);
  if (sa === SPEAKER_UNKNOWN || sb === SPEAKER_UNKNOWN) return false;
  return sa !== sb;
}

/** Find an open Q from a different speaker that topically matches s. */
function findAnsweredQuestion(
  state: DialogueState,
  s: SentenceParse,
  feats: SentenceFeatures,
): OpenQuestion | null {
  const me = speakerOf(s);
  for (let i = state.openQuestions.length - 1; i >= 0; i--) {
    const q = state.openQuestions[i];
    if (q.closed) continue;
    if (q.asker === me) continue; // can't answer one's own Q (unless rhetorical)
    // Topic match — share a topic NP OR a predicate head OR be the very next turn
    const qTopicSet = new Set(q.topicNPs);
    const shares = feats.topicNPs.some(t => qTopicSet.has(t))
      || feats.contentHeads.some(h => qTopicSet.has(h));
    const adjacent = state.lastSpeaker === q.asker;
    if (shares || adjacent) return q;
  }
  return null;
}

/** Find a recent doubt against `meSpeaker` that's still active. */
function findActiveDoubtAgainst(state: DialogueState, meSpeaker: string): DoubtRaised | null {
  for (let i = state.recentDoubts.length - 1; i >= 0; i--) {
    const d = state.recentDoubts[i];
    if (d.againstSpeaker !== meSpeaker) continue;
    if (d.age > 3) continue; // expire after 3 turns
    return d;
  }
  return null;
}

/** Find the standing claim by speaker (most recent). */
function lastStandingClaimBy(state: DialogueState, speaker: string): StandingClaim | null {
  for (let i = state.standingClaims.length - 1; i >= 0; i--) {
    if (state.standingClaims[i].claimer === speaker) return state.standingClaims[i];
  }
  return null;
}

/** Find the standing claim by ANY other speaker (most recent). */
function lastStandingClaimByOther(state: DialogueState, meSpeaker: string): StandingClaim | null {
  for (let i = state.standingClaims.length - 1; i >= 0; i--) {
    const c = state.standingClaims[i];
    if (c.claimer !== meSpeaker) return c;
  }
  return null;
}

// ── The classifier ────────────────────────────────────────────

/**
 * Decide the MOVE for this sentence given current dialogue state.
 *
 * Reasoning is layered:
 *   1. Listener-only moves first (backchannel, aligned-uptake, reactive-uptake).
 *   2. Response moves (answer to open Q, defense after doubt, reformulation
 *      after pushback, etc.) — these REQUIRE a different prior speaker.
 *   3. Same-speaker continuation moves (monologic-elaboration, -justification,
 *      -summary, -pivot, clarification-of-own-prior).
 *   4. Initiating moves (claim-launch, topic-launch, question-launch).
 *   5. Default → `continuation` / `unclassified`.
 */
function classifyMove(
  parse: SentenceParse,
  feats: SentenceFeatures,
  act: ActAnnotation,
  prevParse: SentenceParse | null,
  prevFeats: SentenceFeatures | null,
  prevAct: ActAnnotation | null,
  state: DialogueState,
): MoveAnnotation {
  const me = speakerOf(parse);
  const evidence: string[] = [];

  // ── 1. Listener-only moves (cross-speaker, short, formulaic) ──
  if (act.act === 'reaction') {
    return {
      move: 'reactive-uptake',
      reason: 'act=reaction (cross-speaker emotive uptake)',
      evidence: act.evidence.slice(),
      confidence: 0.85,
    };
  }
  if (act.act === 'acknowledgement') {
    return {
      move: 'backchannel',
      reason: 'act=acknowledgement (backchannel-class opener)',
      evidence: act.evidence.slice(),
      confidence: 0.80,
    };
  }
  if (act.act === 'agreement') {
    // If the agreement immediately follows a correction by other speaker,
    // it's acceptance-of-correction.
    if (prevAct && prevParse && differentSpeaker(prevParse, parse) &&
        (prevAct.act === 'rebuttal' || prevAct.act === 'disagreement' ||
         prevAct.functions.includes('self-repair') || prevAct.functions.includes('other-repair'))) {
      return {
        move: 'acceptance-of-correction',
        reason: 'agreement immediately after other-speaker rebuttal/correction',
        evidence: [...act.evidence, `prev-act=${prevAct.act}`],
        confidence: 0.80,
      };
    }
    return {
      move: 'aligned-uptake',
      reason: 'act=agreement',
      evidence: act.evidence.slice(),
      confidence: 0.85,
    };
  }

  // ── 2. Response moves (different-speaker context) ──

  // 2a. Answer to an open question
  const answered = findAnsweredQuestion(state, parse, feats);
  if (answered) {
    // Counter-question?
    if (act.act === 'question' || act.act === 'clarification-request' ||
        feats.speechAct === 'interrogative') {
      return { move: 'counter-question',
        reason: `answers open Q #${answered.sentenceIdx + 1} with another question`,
        evidence: [`open-Q#${answered.sentenceIdx + 1}`], confidence: 0.75 };
    }
    if (act.act === 'assertion' || act.act === 'opinion' ||
        act.act === 'exemplification' || act.act === 'justification' ||
        act.act === 'narration' || act.act === 'definition' ||
        act.act === 'elaboration') {
      // Hedge => partial-answer
      if (feats.hasHedge) {
        return { move: 'partial-answer',
          reason: `addresses open Q #${answered.sentenceIdx + 1} but hedged`,
          evidence: [`open-Q#${answered.sentenceIdx + 1}`, ...act.evidence], confidence: 0.75 };
      }
      return { move: 'answer-to-question',
        reason: `closes open Q #${answered.sentenceIdx + 1}`,
        evidence: [`open-Q#${answered.sentenceIdx + 1}`], confidence: 0.85 };
    }
  }

  // 2b. Evasion: topic-shift in response to an open Q
  if (act.act === 'topic-management' && state.openQuestions.some(q => !q.closed && q.asker !== me)) {
    return { move: 'evasion',
      reason: 'topic-shift while an open question remains',
      evidence: act.evidence.slice(), confidence: 0.70 };
  }

  // 2c. Defense-against-objection — THE KEY MOVE
  // If the other speaker recently sowed doubt against ME, and now I'm
  // producing an example / justification / elaboration, this is defense.
  const doubt = findActiveDoubtAgainst(state, me);
  if (doubt && (act.act === 'exemplification' || act.act === 'justification' ||
                act.act === 'definition' || act.act === 'elaboration' ||
                act.act === 'rephrasing' || act.act === 'summary')) {
    return {
      move: 'defense-against-objection',
      reason: `act=${act.act} after doubt raised by ${doubt.raiser} at #${doubt.sentenceIdx + 1}`,
      evidence: [`doubt-from:${doubt.raiser}#${doubt.sentenceIdx + 1}`, ...act.evidence],
      confidence: 0.85,
    };
  }

  // 2d. Reformulation-after-pushback: prior was other speaker's rebuttal,
  // now I'm rephrasing my own prior claim.
  if (prevParse && prevAct && differentSpeaker(prevParse, parse) &&
      (prevAct.act === 'rebuttal' || prevAct.act === 'disagreement') &&
      (act.act === 'rephrasing' || act.act === 'qualification' || feats.repairTriggers.length > 0)) {
    const myClaim = lastStandingClaimBy(state, me);
    return {
      move: 'reformulation-after-pushback',
      reason: `rephrase/qualify after other-speaker ${prevAct.act}`,
      evidence: [`pushback#${prevParse ? '' : ''}`, ...act.evidence,
                 ...(myClaim ? [`my-claim#${myClaim.sentenceIdx + 1}`] : [])],
      confidence: 0.80,
    };
  }

  // 2e. Rejection-of-correction: prev was a correction by other speaker
  // and now I'm pushing back.
  if (prevParse && prevAct && differentSpeaker(prevParse, parse) &&
      (prevAct.functions.includes('self-repair') || prevAct.functions.includes('other-repair') ||
       prevAct.act === 'rebuttal') &&
      (act.act === 'disagreement' || act.act === 'rebuttal' ||
       feats.hasDisagreementOpener)) {
    return {
      move: 'rejection-of-correction',
      reason: 'disagreement directly after other-speaker correction/rebuttal',
      evidence: act.evidence.slice(),
      confidence: 0.80,
    };
  }

  // ── 3. Same-speaker continuation moves ──
  if (prevParse && sameSpeaker(prevParse, parse)) {
    // 3a. clarification-of-own-prior: self-repair markers
    if (feats.repairTriggers.length > 0) {
      return { move: 'clarification-of-own-prior',
        reason: 'self-repair trigger after own prior turn',
        evidence: feats.repairTriggers.slice(), confidence: 0.80 };
    }
    // 3b. monologic-pivot: own concession then own rebuttal
    if (prevAct && prevAct.act === 'concession' && act.act === 'rebuttal') {
      return { move: 'monologic-pivot',
        reason: 'own concession → own rebuttal (concession-then-pivot)',
        evidence: act.evidence.slice(), confidence: 0.80 };
    }
    // 3c. monologic-justification
    if (act.act === 'justification') {
      return { move: 'monologic-justification',
        reason: 'justification continuing own prior claim',
        evidence: act.evidence.slice(), confidence: 0.75 };
    }
    // 3d. monologic-summary
    if (act.act === 'summary') {
      return { move: 'monologic-summary',
        reason: 'summary continuing own segment',
        evidence: act.evidence.slice(), confidence: 0.75 };
    }
    // 3e. monologic-elaboration (default for same-speaker elaborative acts)
    if (act.act === 'exemplification' || act.act === 'elaboration' ||
        act.act === 'definition' || act.act === 'rephrasing') {
      return { move: 'monologic-elaboration',
        reason: `same-speaker ${act.act}, no active doubt`,
        evidence: act.evidence.slice(), confidence: 0.70 };
    }
  }

  // ── 4. Initiating moves ──
  if (act.act === 'topic-management') {
    const role = feats.leadingMarker?.role;
    if (role === 'topic-return') {
      return { move: 'topic-resumption', reason: 'topic-return marker',
        evidence: act.evidence.slice(), confidence: 0.80 };
    }
    return { move: 'topic-launch', reason: 'topic-management act',
      evidence: act.evidence.slice(), confidence: 0.75 };
  }

  if (act.act === 'question' || act.act === 'clarification-request') {
    // Doubt-sowing if directed at the other speaker's standing claim
    const otherClaim = lastStandingClaimByOther(state, me);
    if (otherClaim && !otherClaim.challenged) {
      const overlap = feats.topicNPs.some(t => otherClaim.topicNPs.includes(t));
      if (overlap || act.act === 'clarification-request') {
        return {
          move: 'doubt-sowing-challenge',
          reason: `Q on ${otherClaim.claimer}'s standing claim #${otherClaim.sentenceIdx + 1}`,
          evidence: [`challenged-claim#${otherClaim.sentenceIdx + 1}`, ...act.evidence],
          confidence: 0.80,
        };
      }
    }
    return { move: 'question-launch', reason: 'fresh question, no targeted standing claim',
      evidence: act.evidence.slice(), confidence: 0.70 };
  }

  if (act.act === 'rebuttal' || act.act === 'disagreement') {
    const otherClaim = lastStandingClaimByOther(state, me);
    return {
      move: 'doubt-sowing-challenge',
      reason: otherClaim ? `direct challenge to ${otherClaim.claimer}'s claim #${otherClaim.sentenceIdx + 1}` : 'rebuttal with no clear target',
      evidence: act.evidence.slice(),
      confidence: 0.75,
    };
  }

  if ((act.act === 'assertion' || act.act === 'opinion') && state.standingClaims.every(c => c.claimer !== me)) {
    // First claim by this speaker, OR fresh standing claim
    return { move: 'claim-launch', reason: 'first/new assertion by this speaker',
      evidence: act.evidence.slice(), confidence: 0.70 };
  }

  // 4-bis. Pre-emptive clarification: same speaker as no-doubt-in-play but
  // their previous own move was a claim and this is a definition / example.
  if (prevParse && sameSpeaker(prevParse, parse) && prevAct &&
      (prevAct.act === 'assertion' || prevAct.act === 'opinion') &&
      (act.act === 'definition' || act.act === 'exemplification') &&
      !doubt) {
    return { move: 'pre-emptive-clarification',
      reason: 'definition/example right after own assertion with no doubt yet raised',
      evidence: act.evidence.slice(), confidence: 0.70 };
  }

  // ── 5. Default ──
  if (act.act === 'filler' || act.act === 'fragment') {
    return { move: 'continuation', reason: `act=${act.act} (low-content)`,
      evidence: [], confidence: 0.55 };
  }
  return { move: 'continuation', reason: 'no specific move detected',
    evidence: [], confidence: 0.55 };
}

/**
 * Update the dialogue state to incorporate the effect of this sentence.
 * Called AFTER `classifyMove` so the move can use the state from BEFORE.
 */
function updateState(
  state: DialogueState,
  idx: number,
  parse: SentenceParse,
  feats: SentenceFeatures,
  act: ActAnnotation,
  move: ConversationalMove,
): void {
  const me = speakerOf(parse);

  // Age all recent doubts by one turn (so they expire).
  for (const d of state.recentDoubts) d.age += 1;

  // Close open questions if this move answered/evaded/etc.
  if (move === 'answer-to-question' || move === 'partial-answer' ||
      move === 'counter-question' || move === 'evasion') {
    for (let i = state.openQuestions.length - 1; i >= 0; i--) {
      const q = state.openQuestions[i];
      if (q.closed) continue;
      if (q.asker !== me) { q.closed = true; break; }
    }
  }

  // Mark standing claim as challenged if this move is doubt-sowing.
  if (move === 'doubt-sowing-challenge' || act.act === 'rebuttal' || act.act === 'disagreement' ||
      act.act === 'clarification-request') {
    for (let i = state.standingClaims.length - 1; i >= 0; i--) {
      const c = state.standingClaims[i];
      if (c.claimer === me) continue;
      const overlap = feats.topicNPs.some(t => c.topicNPs.includes(t)) ||
                      feats.contentHeads.some(h => c.topicNPs.includes(h));
      if (overlap || differentSpeaker({ speaker: c.claimer } as any, parse)) {
        c.challenged = true;
        state.recentDoubts.push({
          sentenceIdx: idx, raiser: me, againstSpeaker: c.claimer,
          topicNPs: c.topicNPs.slice(), age: 0,
        });
        break;
      }
    }
  }

  // Mark standing claim as defended if this move was a defense.
  if (move === 'defense-against-objection' || move === 'reformulation-after-pushback') {
    const own = lastStandingClaimBy(state, me);
    if (own) own.defended = true;
  }

  // Register a NEW question if this sentence is a question.
  if (act.act === 'question' || act.act === 'clarification-request') {
    state.openQuestions.push({
      sentenceIdx: idx,
      asker: me,
      topicNPs: feats.topicNPs.slice(),
      predicateHead: feats.predicateHead,
      closed: false,
    });
  }

  // Register a NEW standing claim if this sentence is an assertion/opinion.
  if (act.act === 'assertion' || act.act === 'opinion') {
    state.standingClaims.push({
      sentenceIdx: idx,
      claimer: me,
      topicNPs: feats.topicNPs.length ? feats.topicNPs.slice() : feats.contentHeads.slice(0, 3),
      predicateHead: feats.predicateHead,
      challenged: false,
      defended: false,
    });
  }

  // Topic management resets the topic-launch index.
  if (act.act === 'topic-management') {
    state.lastTopicLaunchIdx = idx;
  }

  state.lastSpeaker = me;
  state.lastMoveBySpeaker.set(me, move);

  // Bound the state to prevent unbounded growth on long transcripts.
  if (state.openQuestions.length > 30) state.openQuestions = state.openQuestions.slice(-30);
  if (state.standingClaims.length > 30) state.standingClaims = state.standingClaims.slice(-30);
  if (state.recentDoubts.length > 20) state.recentDoubts = state.recentDoubts.slice(-20);
}

/**
 * Public entry point: given a list of sentences, their per-sentence
 * features, and per-sentence act annotations, return one MoveAnnotation
 * per sentence, computed in left-to-right order with running state.
 */
export function annotateMoves(
  sentences: SentenceParse[],
  features: SentenceFeatures[],
  acts: ActAnnotation[],
): MoveAnnotation[] {
  const state = newDialogueState();
  const out: MoveAnnotation[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const prev = i > 0 ? sentences[i - 1] : null;
    const prevF = i > 0 ? features[i - 1] : null;
    const prevA = i > 0 ? acts[i - 1] : null;
    const move = classifyMove(sentences[i], features[i], acts[i], prev, prevF, prevA, state);
    out.push(move);
    updateState(state, i, sentences[i], features[i], acts[i], move.move);
  }
  return out;
}

// ── Japanese display labels for the demo ──────────────────────

export const MOVE_LABEL_JA: Record<ConversationalMove, string> = {
  'answer-to-question':           '応答',
  'partial-answer':               '部分応答',
  'evasion':                      '回避',
  'counter-question':             '逆質問',
  'clarification-of-own-prior':   '自己訂正',
  'reformulation-after-pushback': '反論を受けて言い直し',
  'defense-against-objection':    '反論への弁明',
  'pre-emptive-clarification':    '先回り補足',
  'acceptance-of-correction':     '訂正受容',
  'rejection-of-correction':      '訂正拒絶',
  'monologic-elaboration':        '自己補足',
  'monologic-justification':      '自己理由付け',
  'monologic-summary':            '自己まとめ',
  'monologic-pivot':              '譲歩→転換',
  'claim-launch':                 '主張開始',
  'topic-launch':                 '話題開始',
  'topic-resumption':             '話題復帰',
  'question-launch':              '質問提示',
  'doubt-sowing-challenge':       '疑念提起',
  'backchannel':                  '相槌',
  'aligned-uptake':               '同調反応',
  'reactive-uptake':              '感情反応',
  'continuation':                 '継続',
  'unclassified':                 '未分類',
};

/** Helper: re-use feature module's topicOverlap with a slim parse-shape. */
export { topicOverlap };
