/**
 * discourse-acts.ts — Multi-layer rhetorical classification of a sentence.
 *
 * Motivated by the user's design note:
 *   "You'd define WHAT something is, like a 例示, its function like 理由付け,
 *    its form like 引用 and then the kind of 引用 defined in several ways…
 *    there's layers. Then thought level is like this is person A who was
 *    doing an explanation responding to person B's question that sowed doubt"
 *
 * That is, every sentence (or discourse unit) carries FOUR orthogonal
 * pieces of information:
 *
 *   1. WHAT  — its rhetorical act (例示 / 理由付け / 主張 / 反論 / …)
 *   2. FUNCTION — what it DOES in the argument
 *                 (evidence-providing / doubt-sowing / objection-deflecting / …)
 *   3. FORM — the linguistic vehicle (引用 / 仮定 / 列挙 / 反復 / 比喩 / …)
 *   4. FORM-SUBTYPE — finer form distinction
 *                 (引用 → direct-quote / reported-speech / hypothetical-quote / hearsay)
 *
 * The fifth axis — the "thought-to-thought" conversational MOVE — depends
 * on dialogue state and is computed in `conversational-state.ts`.
 *
 * This module does PURELY local classification (no cross-sentence state):
 * given a sentence + its features + leading marker, decide WHAT/FUNCTION/
 * FORM/SUBTYPE. The classifier emits the surface evidence it used and a
 * confidence so downstream code can audit it.
 */

import type { SentenceParse } from './sentence-relations';
import type { SentenceFeatures } from './sentence-features';
import { effectiveRole } from './discourse-roles';

// ── Layer 1: WHAT ──────────────────────────────────────────────

/**
 * The rhetorical act a sentence performs. Closer to "speech act" than
 * "grammatical form" — what is the speaker DOING with this utterance.
 */
export type RhetoricalAct =
  | 'assertion'          // 主張: stating something as true
  | 'opinion'            // 意見: explicitly framed as a personal view
  | 'exemplification'    // 例示: giving an instance
  | 'justification'      // 理由付け: giving a reason for a claim
  | 'elaboration'        // 補足説明: adding detail
  | 'definition'         // 定義: defining a term
  | 'summary'            // まとめ: condensing prior content
  | 'rephrasing'         // 言い換え: restating
  | 'concession'         // 譲歩: yielding a point
  | 'rebuttal'           // 反論: opposing a claim
  | 'qualification'      // 限定: narrowing/restricting
  | 'question'           // 質問: open or polar inquiry
  | 'clarification-request' // 確認: asking to clarify
  | 'answer'             // 応答: response to a question
  | 'acknowledgement'    // 受容: hearing / following along
  | 'agreement'          // 同意
  | 'disagreement'       // 不同意
  | 'reaction'           // 反応: emotive uptake
  | 'directive'          // 指示: command / request
  | 'narration'          // 描写: telling what happened
  | 'meta-comment'       // メタ: comment about the talk itself
  | 'topic-management'   // 話題管理: opening/shifting/closing topic
  | 'filler'             // つなぎ: pure filler, no rhetorical content
  | 'fragment'           // 断片: too short / aborted
  | 'other';

// ── Layer 2: FUNCTION ──────────────────────────────────────────

/**
 * What the sentence is doing in the argumentative/conversational fabric.
 * Multiple FUNCTIONs can apply (e.g. an example can simultaneously be
 * `evidence-providing` AND `doubt-deflecting`), so this is an array.
 */
export type DiscourseFunction =
  | 'claim-asserting'
  | 'evidence-providing'
  | 'conclusion-drawing'
  | 'common-ground-establishing'
  | 'topic-introducing'
  | 'topic-shifting'
  | 'topic-resuming'
  | 'doubt-sowing'             // hedged challenge, rhetorical question, "本当に?"
  | 'doubt-resolving'          // clarification that closes a doubt
  | 'objection-raising'        // explicit pushback
  | 'objection-deflecting'     // pre-emptive answer to anticipated objection
  | 'alignment-displaying'     // backchannel, agreement
  | 'alignment-seeking'        // tag-question, ね / でしょ
  | 'face-saving'              // hedge to soften
  | 'face-attacking'           // direct correction
  | 'self-repair'              // っていうか, じゃなくて
  | 'other-repair'             // correcting the other speaker
  | 'attention-soliciting'     // ね, ねえ, ほら
  | 'turn-yielding'            // か?, でしょうか? (handing the floor)
  | 'turn-holding'             // けど…, んだけど… (keeping the floor)
  | 'none';

// ── Layer 3: FORM ──────────────────────────────────────────────

/**
 * The linguistic vehicle the act is delivered through. Independent of
 * the act itself: a 例示 can be delivered as a 引用 ("X さんが「Y」って
 * 言ってた、みたいな"), as a hypothetical (もし〜なら), as an enumeration
 * (A も B も C も), as an analogy (いわば〜のようなもの), etc.
 */
export type SurfaceForm =
  | 'plain'              // bare declarative; no special vehicle
  | 'quotation'          // と / って / という / っていう
  | 'hypothetical'       // もし / 仮に / 〜たら / 〜なら
  | 'enumeration'        // 〜とか / A も B も / 一つは…二つは…
  | 'comparison'         // 〜より / 〜と比べて / 〜に対して
  | 'analogy'            // いわば / 〜のように / みたいに
  | 'rhetorical-question' // 〜じゃないですか / 〜でしょ / 〜だろうか
  | 'tag-question'       // 〜よね / 〜でしょ / 〜じゃん
  | 'negative-equation'  // 〜ではなく / 〜じゃなくて / 〜わけではない
  | 'enumerative-list'   // numbered (まず…次に…)
  | 'repetition'         // verbatim or near-verbatim re-saying
  | 'self-correction'    // っていうか / じゃなくて in-flight
  | 'reported-thought'   // 〜と思った / 〜と感じた
  | 'other';

/**
 * Sub-form. Currently used for `quotation` (the user's example) and
 * `hypothetical`; extensible per-form.
 */
export type FormSubtype =
  // ── for FORM = quotation ──
  | 'direct-quote'        // 「X」と言った
  | 'reported-speech'     // って言ってた / と聞いた
  | 'hypothetical-quote'  // って言ったら / って思ったら
  | 'hearsay'             // らしい / そうだ / みたい (without explicit source)
  | 'self-quote'          // 僕が〜って言ったように
  | 'common-knowledge-citation' // っていうじゃない / みたいな
  // ── for FORM = hypothetical ──
  | 'counterfactual'      // 〜ていたら / 仮に
  | 'conditional-future'  // 〜たら / 〜ば
  | 'concessive-conditional' // 〜ても / 〜でも
  // ── universal ──
  | 'none';

// ── The annotation produced per sentence ─────────────────────

export interface ActAnnotation {
  /** Layer 1 — the rhetorical act. */
  act: RhetoricalAct;
  /** Layer 2 — what it's doing in the argument (zero or more). */
  functions: DiscourseFunction[];
  /** Layer 3 — the linguistic vehicle. */
  form: SurfaceForm;
  /** Layer 3b — finer form distinction. */
  formSubtype: FormSubtype;
  /** Surface substrings that drove the classification (for audit). */
  evidence: string[];
  /** 0-1 confidence in the WHAT layer specifically. */
  confidence: number;
}

// ── Regexes for surface evidence ───────────────────────────────

const RE_EXAMPLE_OPENER = /^(?:例えば|たとえばさ?|具体的(?:に|には)|たとえ話[をだ]|一例[だで]|例で言うと)/;
const RE_EXAMPLE_TOKAR = /(?:とか|みたいな|的な感じ|っていうのが|っていうやつ)/;
const RE_NUMBERED = /(?:まず|次に|それから|最後に|一つ目|二つ目|三つ目|1つ目|2つ目|3つ目|第一に|第二に|第三に)/;

const RE_CAUSE_OPENER = /^(?:なぜなら|というのは|なぜかというと|だって|それは)/;
const RE_CAUSE_TAIL = /(?:から[だで]|からです|ので[すだ]|わけ[だで]|ためです|ためだ|もんだから)$/;

const RE_DEFINITION = /(?:とは|というのは)(?:[^、]{1,30})(?:こと|もの|意味|事|物)[でだ]/;
const RE_REPHRASE = /^(?:つまり|要するに|要は|簡単に言うと|一言で言うと|端的に言うと|言い換えると|逆に言うと)/;
const RE_SUMMARY = /^(?:結論から言うと|まとめると|総じて|結局|いずれにせよ|要するに)/;
const RE_CONCESSION = /^(?:確かに|もちろん|そりゃ|そりゃそうだけど|たしかに|なるほど(?:ね|です)?[、,])/;

const RE_OPINION = /(?:と思う|と思います|と感じる|と感じます|気がする|な気がする|個人的には|私(?:は|としては)|僕(?:は|としては))/;
const RE_NARRATION_PAST = /(?:[\u3042-\u3093]た。|[\u3042-\u3093]ました。|でした。|だった。)$/;

const RE_QUESTION = /(?:[？?]|か[？?\s]?$|かな$|でしょうか$|の[？?]$|っけ[？?]?$)/;
const RE_TAG_QUESTION = /(?:よね[？?]?$|でしょ[？?う]?$|じゃん[？?]?$|だろ[？?う]?$)/;
const RE_RHETORICAL_Q = /(?:じゃないですか[？?。]?$|じゃない[？?]?$|でしょう[？?か]?$|だろうか[？?。]?$)/;
const RE_CLARIFICATION_Q = /^(?:え[？?]|何[？?]|は[？?]|ん[？?]|どういう(?:こと|意味)|もう一度|もう一回|もっと(?:詳しく|具体的に))/;

const RE_DIRECTIVE = /(?:てください|てくれ|なさい|てちょうだい|てもらえ(?:ます|る)?[？?]?)$/;

// ── Quotation form ──
const RE_QUOT_DIRECT = /「[^」]{1,60}」(?:と|って)/;
const RE_QUOT_REPORTED = /(?:って言って(?:た|ました)|と言って(?:た|ました|いた|いました)|って聞いた|と聞いた|って書いて(?:あった|ある))/;
const RE_QUOT_HYPOTHETICAL = /って(?:言ったら|言われたら|なったら|思ったら|聞いたら)/;
const RE_QUOT_HEARSAY = /(?:らしい[よねでです]?|そうです[よねけど]?|そうだ[よね]?|みたい[だですよね]?)/;
const RE_QUOT_COMMON_CITATION = /(?:っていうじゃない|っていうやつ|っていうあれ|みたいな[、,。])/;
/**
 * Sentence-terminal quotative と (「ーんだと。」 / 「ーだと。」 / 「ーって。」).
 * Treated as `reported-speech` — the speaker is reporting that this
 * proposition is the content of what someone said / thought / argued.
 */
const RE_QUOT_TERMINAL_TO = /(?:んだと|なんだと|だと|でしたと|ですと)[。．、,]?\s*$/;
/**
 * Conservative sentence-terminal quotative って.
 *
 * NOTE: bare `[kana|kanji]って。` is fundamentally ambiguous with the
 * te-form of u/tsu/ru-godan verbs (待って・行って・買って — imperative or
 * request, NOT quotation). We therefore restrict to copula-anchored
 * endings (`〜だって。/〜ですって。`) and a few unambiguous lexicalized forms.
 * False-negative for plain-verb quotation 「行くって。」 is accepted as the
 * lesser evil compared with false-positive on imperatives.
 */
const RE_QUOT_TERMINAL_TTE = /(?:[んな]だって|ですって|だって(?:さ|よ|ね)?|っていうことだって|なんだって)[。．、,]?\s*$/;

// ── Hypothetical form ──
const RE_HYPO_COUNTERFACTUAL = /(?:[\u3042-\u3093]て?いたら|もし[\u4e00-\u9fff\u3041-\u3093]+(?:てい?たら|ていれば)|仮に[\u4e00-\u9fff\u3041-\u3093]+(?:なら|だったら))/;
const RE_HYPO_FUTURE = /(?:もし[\u4e00-\u9fff\u3041-\u3093]+(?:たら|なら|ば)|[\u3042-\u3093]たら[、,])/;
const RE_HYPO_CONCESSIVE = /(?:[\u3042-\u3093]ても[、,]|[\u3042-\u3093]でも[、,])/;

// ── Negative equation (X ではなく Y) ──
const RE_NEG_EQ = /(?:ではなく|じゃなくて|わけではない|そうではない|というよりは|というよりも|というより)/;

// ── Comparison ──
const RE_COMPARE = /(?:[\u4e00-\u9fff\u3041-\u3093]+より|と比べて|に比べて|それに対して|に対して)/;

// ── Analogy ──
// Covers いわば / まるで / 〜のように / 〜みたいに / 〜のようなもの, AND
// the hypothetical-comparison 「〜かのような / かのように / かのようだ」.
const RE_ANALOGY = /(?:いわば|まるで|〜のように|みたいに(?![、,。])|[\u4e00-\u9fff\u3041-\u3093]+のようなもの|かのよう(?:な|に|だ|です|でした))/;

// ── Enumeration ──
const RE_ENUM_TOKA = /(?:とか[、,]|だの[、,]|やら[、,])/;

// ── Repetition (caller passes prev sentence) ──

// ── Helpers ──────────────────────────────────────────────────

function pushEvidence(arr: string[], m: RegExpMatchArray | null): void {
  if (m && m[0]) arr.push(m[0]);
}

/**
 * Classify the FORM and SUBTYPE of a sentence based on surface evidence.
 * Returns the strongest single form (forms don't usually overlap).
 */
function classifyForm(text: string, evidence: string[]): { form: SurfaceForm; subtype: FormSubtype } {
  // Quotation family (check most specific first)
  let m: RegExpMatchArray | null;
  if ((m = text.match(RE_QUOT_HYPOTHETICAL))) { pushEvidence(evidence, m); return { form: 'quotation', subtype: 'hypothetical-quote' }; }
  if ((m = text.match(RE_QUOT_DIRECT)))       { pushEvidence(evidence, m); return { form: 'quotation', subtype: 'direct-quote' }; }
  if ((m = text.match(RE_QUOT_REPORTED)))     { pushEvidence(evidence, m); return { form: 'quotation', subtype: 'reported-speech' }; }
  if ((m = text.match(RE_QUOT_COMMON_CITATION))) { pushEvidence(evidence, m); return { form: 'quotation', subtype: 'common-knowledge-citation' }; }
  // Sentence-final んだと / だと / Xって。 — quotative-と left dangling at
  // the end of the sentence ("[that's what they say] it always existed").
  if ((m = text.match(RE_QUOT_TERMINAL_TO))) { pushEvidence(evidence, m); return { form: 'quotation', subtype: 'reported-speech' }; }
  if ((m = text.match(RE_QUOT_TERMINAL_TTE))) { pushEvidence(evidence, m); return { form: 'quotation', subtype: 'common-knowledge-citation' }; }
  if ((m = text.match(RE_QUOT_HEARSAY)))      { pushEvidence(evidence, m); return { form: 'quotation', subtype: 'hearsay' }; }

  // Hypothetical family
  if ((m = text.match(RE_HYPO_COUNTERFACTUAL))) { pushEvidence(evidence, m); return { form: 'hypothetical', subtype: 'counterfactual' }; }
  if ((m = text.match(RE_HYPO_FUTURE)))         { pushEvidence(evidence, m); return { form: 'hypothetical', subtype: 'conditional-future' }; }
  if ((m = text.match(RE_HYPO_CONCESSIVE)))     { pushEvidence(evidence, m); return { form: 'hypothetical', subtype: 'concessive-conditional' }; }

  // Negative equation
  if ((m = text.match(RE_NEG_EQ)))   { pushEvidence(evidence, m); return { form: 'negative-equation', subtype: 'none' }; }

  // Rhetorical / tag question (check before generic question, since they
  // share terminal regex)
  if ((m = text.match(RE_RHETORICAL_Q))) { pushEvidence(evidence, m); return { form: 'rhetorical-question', subtype: 'none' }; }
  if ((m = text.match(RE_TAG_QUESTION))) { pushEvidence(evidence, m); return { form: 'tag-question', subtype: 'none' }; }

  // Comparison / analogy
  if ((m = text.match(RE_ANALOGY)))  { pushEvidence(evidence, m); return { form: 'analogy', subtype: 'none' }; }
  if ((m = text.match(RE_COMPARE)))  { pushEvidence(evidence, m); return { form: 'comparison', subtype: 'none' }; }

  // Enumeration
  if (RE_NUMBERED.test(text))        { evidence.push('numbered-enumeration'); return { form: 'enumerative-list', subtype: 'none' }; }
  if (RE_ENUM_TOKA.test(text))       { evidence.push('〜とか'); return { form: 'enumeration', subtype: 'none' }; }

  return { form: 'plain', subtype: 'none' };
}

/**
 * Decide WHAT the sentence is doing rhetorically, combining sentence
 * features (already extracted) with surface evidence.
 */
function classifyAct(
  text: string,
  feats: SentenceFeatures,
  evidence: string[],
): { act: RhetoricalAct; confidence: number } {
  const trimmed = text.trim();

  // ── Speech-act-level overrides (highest priority) ──
  if (feats.speechAct === 'requestive' || RE_DIRECTIVE.test(trimmed)) {
    evidence.push('directive-suffix');
    return { act: 'directive', confidence: 0.85 };
  }
  if (feats.speechAct === 'imperative') {
    return { act: 'directive', confidence: 0.80 };
  }
  if (feats.speechAct === 'fragment' && !feats.hasBackchannelStart && !feats.hasReactionStart) {
    return { act: 'fragment', confidence: 0.70 };
  }

  // ── Backchannel / reaction openers ──
  if (feats.hasBackchannelStart) {
    const role = feats.leadingMarker?.role;
    if (role === 'agreement') { evidence.push(feats.leadingMarker!.surface); return { act: 'agreement', confidence: 0.85 }; }
    evidence.push('backchannel-start');
    return { act: 'acknowledgement', confidence: 0.80 };
  }
  if (feats.hasReactionStart) {
    if (feats.leadingMarker) evidence.push(feats.leadingMarker.surface);
    return { act: 'reaction', confidence: 0.85 };
  }
  if (feats.hasDisagreementOpener) {
    evidence.push('disagreement-opener');
    return { act: 'disagreement', confidence: 0.80 };
  }

  // ── Question family ──
  if (feats.speechAct === 'interrogative') {
    if (RE_CLARIFICATION_Q.test(trimmed)) {
      evidence.push('clarification-Q');
      return { act: 'clarification-request', confidence: 0.85 };
    }
    if (RE_RHETORICAL_Q.test(trimmed) || RE_TAG_QUESTION.test(trimmed)) {
      // Rhetorical questions are most often used to assert, not ask.
      evidence.push('rhetorical/tag-Q');
      return { act: 'assertion', confidence: 0.70 };
    }
    evidence.push('Q-terminal');
    return { act: 'question', confidence: 0.85 };
  }

  // ── Leading-marker-driven categories ──
  const role = feats.leadingMarker?.role;
  const leadStrength = feats.leadingMarker?.strength;

  // Topic-management ONLY when the leading marker is strong/medium AND the
  // sentence doesn't itself end in an opinion / assertion / question marker.
  // 「そもそもーんだと。」 is a topic-launch in form but the predicate is an
  // assertion — we prefer the asserted content here.
  const isStrongTopicShift = (role === 'topic-shift' || role === 'topic-return' ||
                              role === 'topic-initiation') && leadStrength !== 'weak';
  const hasOpinionTail = RE_OPINION.test(text);
  const hasTerminalQuote = RE_QUOT_TERMINAL_TO.test(text) || RE_QUOT_TERMINAL_TTE.test(text);
  if (isStrongTopicShift && !hasOpinionTail && !hasTerminalQuote && !feats.hasAssertionMarker) {
    if (feats.leadingMarker) evidence.push(feats.leadingMarker.surface);
    return { act: 'topic-management', confidence: 0.80 };
  }

  if (role === 'concession' || RE_CONCESSION.test(trimmed)) {
    const m = trimmed.match(RE_CONCESSION);
    if (m) pushEvidence(evidence, m);
    else if (feats.leadingMarker) evidence.push(feats.leadingMarker.surface);
    return { act: 'concession', confidence: 0.80 };
  }

  if (role === 'opposition' && feats.leadingMarker?.strength === 'strong') {
    evidence.push(feats.leadingMarker.surface);
    return { act: 'rebuttal', confidence: 0.80 };
  }

  if (role === 'qualification') {
    if (feats.leadingMarker) evidence.push(feats.leadingMarker.surface);
    return { act: 'qualification', confidence: 0.75 };
  }

  if (role === 'summary' || RE_SUMMARY.test(trimmed)) {
    const m = trimmed.match(RE_SUMMARY);
    if (m) pushEvidence(evidence, m);
    else if (feats.leadingMarker) evidence.push(feats.leadingMarker.surface);
    return { act: 'summary', confidence: 0.80 };
  }

  if (role === 'rephrasing' || RE_REPHRASE.test(trimmed)) {
    const m = trimmed.match(RE_REPHRASE);
    if (m) pushEvidence(evidence, m);
    else if (feats.leadingMarker) evidence.push(feats.leadingMarker.surface);
    return { act: 'rephrasing', confidence: 0.80 };
  }

  if (role === 'exemplification' || RE_EXAMPLE_OPENER.test(trimmed)) {
    const m = trimmed.match(RE_EXAMPLE_OPENER);
    if (m) pushEvidence(evidence, m);
    else if (feats.leadingMarker) evidence.push(feats.leadingMarker.surface);
    return { act: 'exemplification', confidence: 0.80 };
  }

  // Also count `〜とか / みたいな` as exemplification when present heavily
  if (RE_EXAMPLE_TOKAR.test(text)) {
    evidence.push('とか/みたいな');
    return { act: 'exemplification', confidence: 0.65 };
  }

  if (role === 'cause' || RE_CAUSE_OPENER.test(trimmed) || RE_CAUSE_TAIL.test(feats.terminalForm.trim())) {
    const m = trimmed.match(RE_CAUSE_OPENER) ?? feats.terminalForm.trim().match(RE_CAUSE_TAIL);
    if (m) pushEvidence(evidence, m);
    else if (feats.leadingMarker) evidence.push(feats.leadingMarker.surface);
    return { act: 'justification', confidence: 0.80 };
  }

  // Definitions look like "X とは Y のこと(意味)だ"
  if (RE_DEFINITION.test(text)) {
    evidence.push('〜とは〜こと');
    return { act: 'definition', confidence: 0.75 };
  }

  if (role === 'elaboration' || role === 'addition') {
    if (feats.leadingMarker) evidence.push(feats.leadingMarker.surface);
    return { act: 'elaboration', confidence: 0.70 };
  }

  if (RE_OPINION.test(text)) {
    const m = text.match(RE_OPINION);
    if (m) pushEvidence(evidence, m);
    return { act: 'opinion', confidence: 0.70 };
  }

  if (feats.hasAssertionMarker) {
    evidence.push('assertion-marker');
    return { act: 'assertion', confidence: 0.75 };
  }

  if (feats.leadingMarker?.role === 'filler' && text.trim().length < 6) {
    return { act: 'filler', confidence: 0.85 };
  }

  // Narration (past-tense run with no other markers)
  if (RE_NARRATION_PAST.test(trimmed)) {
    evidence.push('past-final');
    return { act: 'narration', confidence: 0.60 };
  }

  // Default: declarative without specific marker → assertion (low conf)
  return { act: 'assertion', confidence: 0.55 };
}

/**
 * Decide what argumentative/conversational FUNCTION(s) this sentence is
 * performing. Independent of (but informed by) WHAT and FORM.
 */
function classifyFunctions(
  act: RhetoricalAct,
  form: SurfaceForm,
  feats: SentenceFeatures,
  text: string,
): DiscourseFunction[] {
  const fns = new Set<DiscourseFunction>();

  switch (act) {
    case 'assertion':
    case 'opinion':
      fns.add('claim-asserting');
      break;
    case 'justification':
    case 'exemplification':
    case 'definition':
    case 'elaboration':
      fns.add('evidence-providing');
      break;
    case 'summary':
    case 'rephrasing':
      fns.add('conclusion-drawing');
      break;
    case 'concession':
      fns.add('common-ground-establishing');
      break;
    case 'rebuttal':
    case 'disagreement':
      fns.add('objection-raising');
      break;
    case 'qualification':
      fns.add('face-saving');
      break;
    case 'question':
      fns.add('turn-yielding');
      break;
    case 'clarification-request':
      fns.add('doubt-sowing');
      fns.add('turn-yielding');
      break;
    case 'agreement':
    case 'acknowledgement':
      fns.add('alignment-displaying');
      break;
    case 'reaction':
      fns.add('alignment-displaying');
      break;
    case 'directive':
      fns.add('turn-yielding');
      break;
    case 'topic-management':
      // refine based on leading marker role
      if (feats.leadingMarker?.role === 'topic-initiation') fns.add('topic-introducing');
      else if (feats.leadingMarker?.role === 'topic-return') fns.add('topic-resuming');
      else fns.add('topic-shifting');
      break;
    case 'narration':
      fns.add('evidence-providing');
      break;
  }

  // Form-driven function adds
  if (form === 'rhetorical-question') {
    fns.add('claim-asserting');
    fns.add('doubt-sowing');
  }
  if (form === 'tag-question') {
    fns.add('alignment-seeking');
  }
  if (form === 'negative-equation') {
    fns.add('objection-raising');
  }
  if (form === 'hypothetical') {
    fns.add('evidence-providing');
  }
  if (form === 'quotation') {
    fns.add('evidence-providing');
  }

  // Hedge → face-saving
  if (feats.hasHedge) fns.add('face-saving');

  // Self-repair triggers
  if (feats.repairTriggers.length > 0) fns.add('self-repair');

  // Attention soliciting (ね, ねえ, ほら at the start)
  if (/^(?:ねえ|ね、|ほら[、,!?])/.test(text.trim())) fns.add('attention-soliciting');

  // Turn-holding: ending in 〜けど / 〜んだけど without terminal punct
  if (/(?:んだけど|けど|んですけど)[、,]?$/.test(feats.terminalForm.trim())) {
    fns.add('turn-holding');
  }

  if (fns.size === 0) fns.add('none');
  return Array.from(fns);
}

/**
 * Full per-sentence rhetorical annotation.
 *
 * Does NOT use cross-sentence dialogue state — that's the job of
 * `conversational-state.ts` (which adds the MOVE layer on top).
 */
export function annotateAct(parse: SentenceParse, feats: SentenceFeatures): ActAnnotation {
  const evidence: string[] = [];
  const { form, subtype } = classifyForm(parse.text, evidence);
  const { act, confidence } = classifyAct(parse.text, feats, evidence);
  const functions = classifyFunctions(act, form, feats, parse.text);

  return {
    act,
    functions,
    form,
    formSubtype: subtype,
    evidence,
    confidence,
  };
}

// ── Japanese display labels for the demo / UI ─────────────────

export const ACT_LABEL_JA: Record<RhetoricalAct, string> = {
  'assertion': '主張',
  'opinion': '意見',
  'exemplification': '例示',
  'justification': '理由付け',
  'elaboration': '補足',
  'definition': '定義',
  'summary': 'まとめ',
  'rephrasing': '言い換え',
  'concession': '譲歩',
  'rebuttal': '反論',
  'qualification': '限定',
  'question': '質問',
  'clarification-request': '確認要求',
  'answer': '応答',
  'acknowledgement': '受容',
  'agreement': '同意',
  'disagreement': '不同意',
  'reaction': '反応',
  'directive': '指示',
  'narration': '描写',
  'meta-comment': 'メタ言及',
  'topic-management': '話題管理',
  'filler': 'つなぎ',
  'fragment': '断片',
  'other': 'その他',
};

export const FORM_LABEL_JA: Record<SurfaceForm, string> = {
  'plain': '平叙',
  'quotation': '引用',
  'hypothetical': '仮定',
  'enumeration': '列挙',
  'comparison': '対比',
  'analogy': '比喩',
  'rhetorical-question': '修辞疑問',
  'tag-question': '同意要求疑問',
  'negative-equation': '否定的言い換え',
  'enumerative-list': '番号付き列挙',
  'repetition': '反復',
  'self-correction': '自己修復',
  'reported-thought': '内省',
  'other': 'その他',
};

export const SUBTYPE_LABEL_JA: Record<FormSubtype, string> = {
  'direct-quote': '直接引用',
  'reported-speech': '間接引用',
  'hypothetical-quote': '仮想発話',
  'hearsay': '伝聞',
  'self-quote': '自己引用',
  'common-knowledge-citation': '共通認識引用',
  'counterfactual': '反事実',
  'conditional-future': '未来条件',
  'concessive-conditional': '逆接条件',
  'none': '',
};

export const FUNCTION_LABEL_JA: Record<DiscourseFunction, string> = {
  'claim-asserting': '主張提示',
  'evidence-providing': '根拠提供',
  'conclusion-drawing': '結論導出',
  'common-ground-establishing': '共通基盤構築',
  'topic-introducing': '話題導入',
  'topic-shifting': '話題転換',
  'topic-resuming': '話題復帰',
  'doubt-sowing': '疑念惹起',
  'doubt-resolving': '疑念解消',
  'objection-raising': '反対提起',
  'objection-deflecting': '反対回避',
  'alignment-displaying': '同調表示',
  'alignment-seeking': '同調要求',
  'face-saving': '配慮',
  'face-attacking': '対立',
  'self-repair': '自己修復',
  'other-repair': '他者修復',
  'attention-soliciting': '注意喚起',
  'turn-yielding': '発話権譲渡',
  'turn-holding': '発話権保持',
  'none': '—',
};
