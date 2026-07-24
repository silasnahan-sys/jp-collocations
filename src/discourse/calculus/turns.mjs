// src/discourse/calculus/turns.mjs
// =====================================================================
// THE EVIDENCE CHAIN — transcript lines → turns + grounding events
// ---------------------------------------------------------------------
// PURE. No Obsidian, no network, no LLM. Golden-tested via
//   node golden/turns.mjs
//
// WHY THIS FILE EXISTS (Amendment IV to DISCOURSE-CALCULUS.md):
// Every prior attempt to test the calculus on real data — including the
// Phase-0 golden itself — silently hand-performed three editorial acts:
// sentence segmentation, backchannel exclusion, and speaker attribution.
// Until those are DETERMINISTIC CODE, every corpus "break" is ambiguous
// between "the algebra is wrong" and "the input was corrupted", and
// corpus-as-adversary is uninterpretable. This file is those three acts,
// as auditable rules.
//
// THE KEY UNIFICATION: a backchannel (うん/なるほど) is NOT a turn — it is
// a GROUNDING EVENT on someone else's turn (Clark). Lifting backchannels
// out of the turn sequence solves the ASR over-segmentation problem and
// supplies the grounding layer's input in the same act. Grounding events
// are GRADED: 'ack' (continuer — attention, floor-yield, NO acceptance)
// vs 'accept' (real uptake — なるほど/確かに/そうですね/repetition).
//
// HONESTY CONTRACT: fragment merging and speaker attribution are declared
// heuristics, not truth. Every turn carries provenance (`parts`, line
// indexes) and speaker inference is marked `speakerSource:'inferred'` with
// the rule that decided it, so a human ✕ corrects a RULE, never a label.
// =====================================================================

import { isBackchannelOnly } from '../engine/fillers.mjs';

// ---------------------------------------------------------------------
// 1. PARSE — transcript markdown → [{ tSec, text, line }]
//    Handles [MM:SS] and [H:MM:SS]. (The Phase-0 audit itself initially
//    dropped 2 of imiron's 3 hours to exactly this format split.)
// ---------------------------------------------------------------------
const LINE_RE = /^\[(?:(\d+):)?(\d{1,3}):(\d{2})\]\s*(.*)$/;
const STAGE_RE = /^\[[^\]]*\]$/; // [笑い] [咳払い] [音楽] …

export function parseTranscript(md) {
  const out = [];
  const lines = String(md || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = LINE_RE.exec(lines[i].trim());
    if (!m) continue;
    const h = m[1] ? Number(m[1]) : 0;
    const tSec = h * 3600 + Number(m[2]) * 60 + Number(m[3]);
    const text = m[4].trim();
    if (!text || STAGE_RE.test(text)) continue;
    out.push({ tSec, text, line: i + 1 });
  }
  return out;
}

// ---------------------------------------------------------------------
// 2. GRADE — backchannel classification (Clark's continuer/acceptance)
// ---------------------------------------------------------------------
// 'accept' tokens signal integration of the content, not just attention.
const ACCEPT_RE = /^(?:あ+、?)?(?:なるほど(?:ね|ですね)?|た?しかに|確かに|そうですね|そうですよね|そうっすね|ですよね|そう(?:そう)+|そうか|そっか|おっしゃる通り|分かりました|わかりました|了解(?:です)?|たしかにね)+$/;
// 'ack' tokens signal attention/floor-yield only.
const ACK_RE = /^(?:うん+|うんうん+|はい+|ええ+|えぇ|へ[えぇー]+|ふ[ーん]+|ふんふん|ほ[うー]+|お[おー]+|あ[あー]*|ああ|そう|ね|うい|ん+)+$/;

const stripPunct = (t) => String(t || '').replace(/[、。．，,.\s「」『』（）()！!？?ー~〜…・]/g, '');

/** null = not a backchannel; otherwise 'ack' | 'accept'. */
export function gradeBackchannel(text) {
  const s = stripPunct(text);
  if (!s || s.length > 14) return null;
  if (ACCEPT_RE.test(s)) return 'accept';
  if (ACK_RE.test(s)) return 'ack';
  if (isBackchannelOnly(text)) return 'ack';
  return null;
}

// ---------------------------------------------------------------------
// 3. MERGE — ASR fragments → utterance-sized turns
//    A line CONTINUES the previous turn iff the previous text has no hard
//    boundary, the time gap is small, and the merged turn stays utterance-
//    sized. This is what repairs triggers the ASR bisected across lines
//    (e.g. 疑問戻っ|ていいですか at imiron [1:37:38] — the RESUME move that
//    line-level matching can structurally never see).
// ---------------------------------------------------------------------
const HARD_END_RE = /[。．！？!?]\s*$/;

// ---------------------------------------------------------------------
// 3b. DE-FUSE — embedded uptake inside merged turns.
//    On unpunctuated ASR the listener's channel is time-sliced INTO the
//    speaker's lines: measured on imiron, 348 uptake tokens sat embedded
//    inside turn text while line-level lifting caught 3 (0.9% recall), and
//    ~27% of turns carried the other speaker's voice. A mid-turn uptake
//    run is therefore (a) a grounding event by the other party and often
//    (b) a floor-change tell. Three outcomes, skeletal:
//      1. content-before ends in a question → the run+rest is the OTHER
//         party answering (run stays: uptake-initial, recognizer RATIFYs)
//      2. run followed by a floor-take opener (じゃ/では…) → grounding on
//         the head turn, rest is the OTHER party's new turn
//      3. otherwise → excise the run as a grounding event; floor returns
//    PRECISION-FIRST vocabulary: a run must START with a token that is
//    unambiguous listener-talk. そうですね/ですよね are NOT anchors — they
//    are also the speaker's own floor-holder / conscription marker (よね),
//    and excising those would blind the CONSCRIPT recognizer. They only
//    join a run already anchored (e.g. なるほどそうですね).
// ---------------------------------------------------------------------
const EMBED_ANCHOR = '(?:なるほど(?:ね|ですね)?|確かに|たしかに|はいはい(?:はい)*|うんうん(?:うん)*|ふんふん|へ[えぇー]+)';
const EMBED_CONT = '(?:なるほど(?:ね|ですね)?|確かに|たしかに|そうですよね|そうですね|ですよね|そっか|はい+|うん+|ええ|ふんふん|へ[えぇー]+)';
const EMBED_RUN_RE = new RegExp(EMBED_ANCHOR + EMBED_CONT + '*', 'g');
const EMBED_ACCEPT_RE = /なるほど|確かに|たしかに|そうです|ですよね/;
const QUESTION_TAIL_RE = /(?:ですか|ますか|んですか|ですかね|ますかね|のかな|んすか)\s*[、。]?\s*$/;
const FLOOR_TAKE_RE = /^(?:じゃあ?|では、|それでは|ちなみに|ってことは|え、)/;

function findEmbeddedRun(text) {
  EMBED_RUN_RE.lastIndex = 0;
  let m;
  while ((m = EMBED_RUN_RE.exec(text)) !== null) {
    if (m.index >= 4) return { index: m.index, run: m[0] }; // mid-turn only:
    // a turn-initial run is the speaker's own uptake — the recognizer's job.
  }
  return null;
}

function defuseOne(turn, stats) {
  const out = [];
  let cur = turn;
  let guard = 0;
  while (guard++ < 12) {
    const m = findEmbeddedRun(cur.text);
    if (!m) break;
    const pre = cur.text.slice(0, m.index);
    const post = cur.text.slice(m.index + m.run.length);
    const grade = EMBED_ACCEPT_RE.test(m.run) ? 'accept' : 'ack';
    if (QUESTION_TAIL_RE.test(pre) && stripPunct(m.run + post).length > 4) {
      out.push({ ...cur, text: pre, grounding: [...cur.grounding] });
      cur = { ...cur, text: m.run + post, grounding: [], floorHint: 'other' };
      stats.defusedSplits++;
      continue;
    }
    if (FLOOR_TAKE_RE.test(post) && stripPunct(post).length > 4) {
      out.push({ ...cur, text: pre,
        grounding: [...cur.grounding, { tSec: cur.tSec, grade, text: m.run, by: null, embedded: true }] });
      stats.embeddedGrounding++; stats[grade]++; stats.defusedSplits++;
      cur = { ...cur, text: post, grounding: [], floorHint: 'other' };
      continue;
    }
    cur = { ...cur, text: pre + post,
      grounding: [...cur.grounding, { tSec: cur.tSec, grade, text: m.run, by: null, embedded: true }] };
    stats.embeddedGrounding++; stats[grade]++;
  }
  out.push(cur);
  return out.filter(t => stripPunct(t.text).length > 0);
}

function defuseTurns(turns, stats) {
  const out = [];
  for (const t of turns) out.push(...defuseOne(t, stats));
  return out;
}

// ---------------------------------------------------------------------
// 4. SPEAKERS — two-party floor inference (declared heuristic).
//    Rules, in priority order; each turn records which rule fired.
//      R1 question→response: a turn after a question goes to the other party
//      R2 response-initial marker (いや/違う/でも/え、…) → other party
//      R3 uptake-initial + substantive content (そう…/分かるよ…) → other party
//      R4 otherwise the floor continues
// ---------------------------------------------------------------------
const QUESTION_END_RE = /(?:[？?]\s*$|(?:です|ます)か[。．]?\s*$|いかがでしょう|どうですか|ますでしょうか)/;
const RESPONSE_INITIAL_RE = /^(?:あ、?)?(?:いや+|いえ|違い?ます|違う|ちがう|そうじゃなくて|でも|え、|えでも|は?、?何|なんで)/;
// そう excludes the determiner/proform (そういう/そうする…) — same mechanical
// fix as moves.mjs INITIAL_UPTAKE_RE (precision sample nenko:715/901).
const UPTAKE_INITIAL_RE = /^(?:あ、?)?(?:そう(?!いう|いえ|す(?:る|れ|ると)|し(?:て|た|よう))(?:そう)*(?:です(?:ね|よね)?|か|なんです)?|分かる|わかる|なるほど|確かに|たしかに)/;

const other = (sp) => (sp === 'A' ? 'B' : 'A');

/**
 * @param {{tSec:number,text:string,line?:number}[]} lines
 * @param {{gapSec?:number,maxLen?:number,speakers?:boolean}} opts
 * @returns {{turns:Turn[], stats:object}}
 * Turn = { tSec, tEnd, speaker, speakerSource, speakerRule, text, parts,
 *          grounding:[{tSec, grade:'ack'|'accept', text, by}] }
 */
export function buildTurns(lines, opts = {}) {
  const gapSec = opts.gapSec ?? 3;
  const maxLen = opts.maxLen ?? 90;
  const turns = [];
  const stats = { lines: lines.length, merged: 0, lifted: 0, ack: 0, accept: 0,
                  embeddedGrounding: 0, defusedSplits: 0 };

  let cur = null;
  let lastContentT = -Infinity;
  let sawBackchannelSinceContent = false;

  for (const ln of lines) {
    const grade = gradeBackchannel(ln.text);
    if (grade) {
      // Not a turn: a grounding event on the current turn (if any).
      stats.lifted++; stats[grade]++;
      if (cur) cur.grounding.push({ tSec: ln.tSec, grade, text: ln.text, by: null });
      sawBackchannelSinceContent = true;
      continue;
    }
    // Content line: merge or open a new turn.
    // A backchannel in between widens the allowed gap (the listener spoke
    // over the pause, the floor-holder is still mid-utterance).
    const allowedGap = sawBackchannelSinceContent ? gapSec * 2 : gapSec;
    const canMerge =
      cur &&
      !HARD_END_RE.test(cur.text) &&
      ln.tSec - lastContentT <= allowedGap &&
      cur.text.length < maxLen;
    if (canMerge) {
      cur.text += ln.text; // ASR fragments split mid-word: no separator
      cur.tEnd = ln.tSec;
      cur.parts.push(ln.line ?? -1);
      stats.merged++;
    } else {
      cur = { tSec: ln.tSec, tEnd: ln.tSec, speaker: null, speakerSource: 'inferred',
              speakerRule: null, text: ln.text, parts: [ln.line ?? -1], grounding: [] };
      turns.push(cur);
    }
    lastContentT = ln.tSec;
    sawBackchannelSinceContent = false;
  }

  const result = opts.defuse !== false ? defuseTurns(turns, stats) : turns;
  if (opts.speakers !== false) inferSpeakers(result);
  // Grounding comes from the party NOT holding the floor.
  for (const t of result) for (const g of t.grounding) g.by = other(t.speaker ?? 'A');
  return { turns: result, stats };
}

function inferSpeakers(turns) {
  let prev = null;
  for (const t of turns) {
    if (!prev) { t.speaker = 'A'; t.speakerRule = 'first'; prev = t; continue; }
    if (t.floorHint === 'other') { t.speaker = other(prev.speaker); t.speakerRule = 'R2b:floor-take'; }
    else if (QUESTION_END_RE.test(prev.text)) { t.speaker = other(prev.speaker); t.speakerRule = 'R1:question-response'; }
    else if (RESPONSE_INITIAL_RE.test(t.text)) { t.speaker = other(prev.speaker); t.speakerRule = 'R2:response-initial'; }
    else if (UPTAKE_INITIAL_RE.test(t.text) && stripPunct(t.text).length > 8) { t.speaker = other(prev.speaker); t.speakerRule = 'R3:uptake-initial'; }
    else { t.speaker = prev.speaker; t.speakerRule = 'R4:floor-continues'; }
    prev = t;
  }
}

/** One-call convenience: markdown → turns ready for the reducer. */
export function transcriptToTurns(md, opts = {}) {
  return buildTurns(parseTranscript(md), opts);
}
