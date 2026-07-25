// src/discourse/calculus/moves.mjs
// =====================================================================
// RECOGNITION → ALGEBRA BRIDGE (v2 — span events)
// ---------------------------------------------------------------------
// Turns one utterance's surface Japanese into an ORDERED SEQUENCE of span
// events consumed by scoreboard.mjs. This is the REPLACEABLE EDGE: swap in
// a better recognizer and the calculus is untouched.
//
// AMENDMENT I (the atom — see DISCOURSE-CALCULUS.md §Amendments):
// v1 returned a BAG of booleans {deny, project, concede…} and the reducer
// fired them in a fixed schema order. That destroyed intra-utterance order
// — and order-of-moves IS the trajectory (the calculus's own one law). The
// falsification that forced this: on the VERBATIM 年功序列 [07:50] line
// (projection + fence in ONE utterance, which the Phase-0 golden had
// hand-split), the fence fired before the projection existed, bound the
// wrong antecedent, and the board ended with the denied inference still
// projected. The fix is the representation the user's own danwa bolding
// already had: ordered spans. match.mjs returns offsets; v1 threw them
// away; v2 keeps them.
//
// Event kinds (offset-sorted):
//   place:conscript | place:derived | place:preface   — how the focal prop enters
//   question                                          — raises a QUD instead
//   uptake(grade) | reject | concede | contrast       — consume the PRIOR turn (initial-position only)
//   repair | substitute                               — replace speaker's own prior
//   deny | retype                                     — stance/scope control (the two ex-blind-spots)
//   project                                           — attributable downstream inference
//   shelve | resume                                   — QUD parking
//
// Provenance is kept per-event (`src`) so every derived move is auditable
// back to a real lexicon trigger or a named detector — nothing invented
// per-transcript.
// =====================================================================

import { matchSentence } from '../engine/match.mjs';

// op-id → event kind (unchanged sets from v1)
const CONSCRIPT_OPS = new Set(['GROUND-CLAIM', 'CONFIRMATION-SEEK', 'CONJECTURE-APPEAL', 'EXPLAIN-CONFIRM']);
const DERIVED_OPS = new Set(['CAUSAL-DERIVE', 'CAUSAL-DISCOURSE', 'EXPLAIN-CAUSE']);
const PREFACE_OPS = new Set(['HEDGE-INCOMPLETE', 'EXPLAIN-HEDGE']);
const LOW_FORCE_OPS = new Set(['EPISTEMIC-THINK', 'EPISTEMIC-MAY', 'EPISTEMIC-EXPECT']);
const TENTATIVE_OPS = new Set(['EVIDENTIAL-SEEM', 'APPROXIMATIVE', 'EVIDENTIAL-HEARSAY']);
const SUBSTITUTE_OPS = new Set(['REFORMULATE-SUMMARIZE']);
const REPAIR_OPS = new Set(['REFORMULATE-REPAIR']);
const REJECT_OPS = new Set(['REJECT-CORRECTION']);
const CONCEDE_OPS = new Set(['CONCESSIVE-CONTRAST']);
const RATIFY_OPS = new Set(['BUILD-ON', 'AGREE-MARK']);

const Q_RE = /(?:[？?]\s*$|ですか[。．！？\s]*$|ますか[。．！？\s]*$|んですか[。．！？\s]*$|の[?？]\s*$|かな[？?]?\s*$|と思います[か？?])/;

// --- detectors for moves the lexicon has no operator for -------------
// Precision-guarded after the Phase-0 audit (Probe C): v1's regexes fired
// on third-party reports (彼はそこまで言ってなかった), on criticizing the
// OTHER's overstatement (そこまで言わなくても), and on mundane から…になって
// (朝から雨になっていた). Guards are skeletal, not content reads.

// DENY_COMMITMENT — self-fence of an attributed inference.
//   requires a completed-saying negative (言って(い)ない / 言ってません),
//   NOT the volitional 言わなくて (criticism of another's phrasing),
//   NOT a third-party subject immediately before (彼は/あいつは/さんは…).
const DENY_RE = /そこまで(?:は|を)?言っ(?:て(?:は)?(?:い|な)|た(?:こと)?は?な)|とまでは言って(?:い)?な/;
const DENY_3P_RE = /(?:彼|彼女|あいつ|こいつ|そいつ|やつ|先生|さん|くん|君|の人)(?:は|も|が)?\s*そこまで/;

// RE_TYPE — recharacterize own prior as heuristic (便宜的/分かりやすさのため…)
const RETYPE_RE = /便宜的|分かりやす[さ]?のため|わかりやす[さ]?のため|大げさに言|語弊|ざっくり言|噛み砕|例え(?:ば)?の話|たとえの話/;

// SUBSTITUTE cue: 要は as reformulation even when …SUMMARIZE misfires on ASR
const YOUWA_RE = /(?<![必重主需])要は|要するに/;

// PROJECT_CONSEQUENCE — a downstream inference placed as attributable.
//   requires a DISCOURSE-causal opener (だから/なので/それで/そうなると…) or a
//   conditional 〜(していく)と / 〜すると, followed by なってしまう/ことになる….
//   Bare noun+から (朝から/昨日から) no longer qualifies.
const PROJECT_RE = /(?:だから|なので|ですから|それで|そうなると|そうすると|そう考えると|ていくと|ていったら|突き詰めると|极?めると|すると).*?(?:(?:に)?なってしま|(?:に)?なっちゃ|話にな(?:る|っ)|ことにな(?:る|っ)|ようにな(?:る|っ))/;

// QUD parking
const SHELVE_RE = /一旦.{0,6}?(?:置い|おい)|それはそうと|棚上げ|後で(?:話|考え)|置いといて|置いとくと/;
// Resumption REQUIRES the return verb bound to an issue-noun. Bare さっきの話
// is anaphoric REFERENCE ("per what we said earlier"), not a return — the
// standalone branch consumed the imiron shelf at [1:01:52] (さっきの話だとね)
// and left the real [1:37:38] resume empty-handed. Corpus-found, rule-fixed.
const RESUME_RE = /(?:話|疑問|質問|議論|さっき|それ)(?:を|に)?戻(?:す|る|そ|り|っ)|戻っていい|元の(?:話|質問|疑問)に戻/;

// ── responsivity anchors (Amendment V: precision-first GRANT/REJECT) ──
// The precision sample (golden/precision/, 2026-07-22) measured suggested-
// precision REJECT 0/7 and GRANT 7/24. The ✕ rows are systematic, not noise:
//   • bare いや is a filler / agreement-preface / exclamative (いや、そう。
//     僕もそう思う = AGREEMENT), almost never rejection;
//   • bare initial でも/けど is adversative continuation, a new counterpoint
//     (あ、でも…), or an ASR clause-split (けど…-initial soup) — while every
//     suggested-✓ GRANT had an ASSENT HEAD before the adversative:
//     ま、でも / まあでも / そうでも / とはいえ / 面白いけど.
//   • しかし matched INSIDE もしかしたら (substring, nenko:1422).
// So: REJECT needs a correction anchor; GRANT needs an assent head; a bare
// initial adversative is CONTRAST — it contests the other's live prop
// (blocking tacit CG) but writes nothing into CG/Projected.

// REJECT — strong correction anchors only. いや alone NEVER fires.
//   Guards from the sample's innocents: 違うんかい (quoted self-report),
//   違うない/違うのかな (self-doubt), 違う+noun (lexical "different").
const REJECT_ANCHOR_RE = /^(?:(?:あ|え)、?\s*)?(?:いや+ー?、?\s*)?(?:そうじゃなく(?:て|で)?|そうではなく(?:て)?|じゃなく(?:て|で)|違う(?:よ|って|んじゃなく)?(?=[、。！!？?\s]|$)|違います(?=[、。！!\s]|$)|ちゃうちゃう)/;

// GRANT — assent head + initial-window adversative, or a directly
// concessive conjunction. The ま、でも / あ、でも minimal pair is the rule:
// ま(あ) accepts then pivots; あ、 flags a NEW counterpoint (✕ in sample).
const GRANT_DIRECT_RE = /^(?:あ、?)?とはいえ/;
const ASSENT_HEAD_RE = /^(?:あ、?)?(?:ま+ー?あ?、?|そう+(?:です(?:よ)?ね?|だね|ね)?、?。?|確かに、?|たしかに、?|それはそう(?:です)?(?:ね)?、?|なるほど、?|面白い(?:です)?(?:ね)?、?|分かる(?:よ)?、?|わかる(?:よ)?、?|一理ある、?)$/;
const ADVERSATIVE_RE = /でも|けども|けど/; // searched in the initial window only

// そう must not be the determiner/proform そういう・そうする・そうすると —
// under-anchored ^そう mis-fired RATIFY on そういう意味で/そういうのって
// (precision sample nenko:715/901, judged ✕: mechanical, not judgment).
// いや-prelude allowed: agreement-preface いや (いや、そう/いや、なるほど)
// is UPTAKE — its board effect is the opposite of the reject it used to fire.
const INITIAL_UPTAKE_RE = /^(?:あ、?)?(?:いや+ー?、?\s*)?(?:そう(?!いう|いえ|す(?:る|れ|ると)|し(?:て|た|よう)|じゃ|では)(?:そう)*(?:です(?:ね|よね)?|か|なんです)?|分かる(?:よ)?|わかる(?:よ)?|なるほど|確かに|たしかに)/;

const stripLen = (t) => t.replace(/[、。．，,.\s「」『』！!？?ー~〜…]/g, '').length;

// ── AMENDMENT VI (candidate, 2026-07-25): alignment display ≠ issue settled ──
// Falsified by a blind read of nenko 12:15–16:45 (window fixed before looking):
// 「そうかな。…めちゃくちゃ測りやすいと思う。」 fired RATIFY — the board moved
// the OTHER speaker's prop into CG at the moment it was being disputed. Measured
// across both fixtures: 91% (nenko) / 100% (imiron) of turn-level uptake firings
// are turns where the speaker went on to say 20+ chars of NEW content. They are
// floor-takes with an alignment display on the front (「そうですねあとじゃ先生の
// ご関心内容を…」 = a host moving to the next question), not acceptances.
// The cause is structural, not a tuning error: the INITIAL-UPTAKE guard REQUIRES
// stripLen > 8, so this path can only ever fire on a turn that continues past
// the alignment token — it is incapable of firing on a pure acceptance. Genuine
// short acceptances already arrive through the grounding channel (turns.mjs
// gradeBackchannel → applyGrounding), which this amendment leaves untouched.
// Rule (components.ts / DESIGN §23 semantics — an alignment unit followed by
// substantive content is a `return`-shaped floor-take): uptake RATIFIES only on
// a turn that IS the alignment and nothing else; otherwise it ACKNOWLEDGEs —
// the prop stays live and attended, nothing is written to common ground.
const ALIGN_ONLY_RE = /^(?:あ、?)?(?:いや+ー?、?\s*)?(?:そう(?:そう)*(?:です(?:ね|よね)?|か|かな|なんです|だね|ね)?|分かる(?:よ)?|わかる(?:よ)?|なるほど(?:ね)?|確かに|たしかに|ですね|だね)[、。！!\s]*$/;
const isAlignmentOnlyTurn = (t) => ALIGN_ONLY_RE.test(String(t).trim());

/**
 * @param {string} text
 * @returns {{ events: {kind:string, offset:number, surface:string, src:string, grade?:string}[],
 *   force:'assert'|'low'|'tentative', backchannel:boolean, isQuestion:boolean,
 *   bareFence:boolean, ops:string[] }}
 */
export function recognizeEvents(text) {
  const t = String(text || '');
  const { hits, backchannel } = matchSentence(t);
  const events = [];
  const push = (kind, offset, surface, src, extra = {}) =>
    events.push({ kind, offset, surface, src, ...extra });

  // (1) lexicon hits → events, offsets preserved
  for (const h of hits) {
    // Bare sentence-final ね is rapport/softening, NOT conscription — the
    // precision sample judged every bare-ね conscription ✕ (5/5: nenko
    // 494/765/1374, imiron 253/10658, all 〜しますね/思いますね class).
    // よね/ですよね/だよね remain conscription triggers.
    if (CONSCRIPT_OPS.has(h.opId) && h.surface === 'ね') continue;
    if (CONSCRIPT_OPS.has(h.opId)) push('place:conscript', h.offset, h.surface, h.opId);
    else if (DERIVED_OPS.has(h.opId)) push('place:derived', h.offset, h.surface, h.opId);
    else if (PREFACE_OPS.has(h.opId)) push('place:preface', h.offset, h.surface, h.opId);
    else if (SUBSTITUTE_OPS.has(h.opId)) push('substitute', h.offset, h.surface, h.opId);
    else if (REPAIR_OPS.has(h.opId)) push('repair', h.offset, h.surface, h.opId);
    // REJECT_OPS / CONCEDE_OPS hits are NOT trusted as moves (Amendment V —
    // measured 0/7 and 7/24 suggested-precision): the head analysis below
    // decides reject/concede/contrast from anchors, not from bare triggers.
    else if (RATIFY_OPS.has(h.opId)) push('uptake', h.offset, h.surface, h.opId, { grade: 'accept' });
  }

  // (2) named detectors → events with real offsets
  const rx = (re, kind, src, extra) => {
    const m = re.exec(t);
    if (m) push(kind, m.index, m[0], src, extra);
  };
  if (DENY_RE.test(t) && !DENY_3P_RE.test(t)) rx(DENY_RE, 'deny', 'DENY-DETECT');
  rx(RETYPE_RE, 'retype', 'RETYPE-DETECT');
  if (!events.some(e => e.kind === 'substitute')) rx(YOUWA_RE, 'substitute', 'YOUWA-DETECT');
  rx(PROJECT_RE, 'project', 'PROJECT-DETECT');
  rx(SHELVE_RE, 'shelve', 'SHELVE-DETECT');
  rx(RESUME_RE, 'resume', 'RESUME-DETECT');

  // (3) head analysis (position IS the disambiguator: only an utterance-
  //     initial responsive consumes the PRIOR turn; a medial けど contrasts
  //     within the speaker's own flow and must not GRANT). Amendment V:
  //     reject/concede fire ONLY from anchors; a bare initial adversative
  //     is 'contrast' (RELATE_CONTRAST — contests, writes nothing).
  const head = t.trimStart();
  const headOff = t.length - head.length;
  const INITIAL_WINDOW = 6;

  if (REJECT_ANCHOR_RE.test(head)) {
    push('reject', headOff, head.slice(0, 6), 'REJECT-ANCHOR');
  } else if (INITIAL_UPTAKE_RE.test(head) && stripLen(t) > 8 &&
             !events.some(e => e.kind === 'uptake' && e.offset <= headOff + 2)) {
    push('uptake', headOff, head.slice(0, 4), 'INITIAL-UPTAKE', { grade: 'accept' });
  }

  if (GRANT_DIRECT_RE.test(head)) {
    push('concede', headOff, 'とはいえ', 'GRANT-ANCHOR');
  } else {
    const adv = ADVERSATIVE_RE.exec(head.slice(0, INITIAL_WINDOW + 4));
    if (adv) {
      const pre = head.slice(0, adv.index);
      if (ASSENT_HEAD_RE.test(pre)) {
        push('concede', headOff + adv.index, pre + adv[0], 'GRANT-ANCHOR');
      } else if (adv[0] === 'でも' && (adv.index === 0 || /^(?:[あえ]+、?|ん、?)$/.test(pre) || /[、。]$/.test(pre))) {
        // TURN-INITIAL でも (bare or after a filler): counterpoint or
        // あ、でも new-point — contests the live prop, concedes nothing.
        // NOT: でも after a content pre = the particle でも (ラジオでも
        // "also on the radio", 読んでもらって — labeling pass false hits);
        // NOT: stranded けど(も)-initial = an ASR clause-split whose けど
        // belongs to the PREVIOUS clause (imiron rows 3151/5026/6587…) —
        // it continues the speaker's own flow and contests nothing.
        push('contrast', headOff + adv.index, adv[0], 'CONTRAST-INITIAL');
      }
      // stranded けど / content-pre でも / deeper adversative: no board move
    } else if (/^しかし[、\s]/.test(head)) {
      push('contrast', headOff, 'しかし', 'CONTRAST-INITIAL');
    }
  }

  // Medial demotion for any remaining relational strays (lexicon uptake
  // hits beyond the head window act within the speaker's own flow).
  for (const e of events) {
    if ((e.kind === 'concede' || e.kind === 'reject' || e.kind === 'uptake') && e.offset > headOff + INITIAL_WINDOW) {
      e.kind = e.kind === 'concede' ? 'contrast-medial' : 'agree-medial';
    }
  }

  // Amendment VI: demote alignment-plus-content to ACKNOWLEDGE (see above).
  if (!isAlignmentOnlyTurn(t)) {
    for (const e of events) if (e.kind === 'uptake') e.kind = 'align';
  }

  // (4) question placement
  const isQuestion = Q_RE.test(t);
  if (isQuestion) push('question', t.length - 1, '?', 'Q-DETECT');

  events.sort((a, b) => a.offset - b.offset);

  // force modifier (utterance-level)
  const ids = new Set(hits.map(h => h.opId));
  const has = (set) => [...ids].some(id => set.has(id));
  let force = 'assert';
  if (has(TENTATIVE_OPS)) force = 'tentative';
  else if (has(LOW_FORCE_OPS)) force = 'low';

  // A bare fence (そこまでは言ってないです。 alone) asserts nothing new.
  const bareFence = events.some(e => e.kind === 'deny') && stripLen(t) <= 12;

  return { events, force, backchannel, isQuestion, bareFence, ops: hits.map(h => h.opId) };
}
