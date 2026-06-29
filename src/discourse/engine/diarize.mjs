// _tmp_pipeline/diarize.mjs
// Two-class lexical diarizer for VTT-style podcast transcripts.
//
// PROBLEM: turnizeByPause flips A↔B on every >1.5 s gap. For a 2-person
// podcast where the host monologues with internal backchannels, this is
// systematically wrong.
//
// APPROACH (cheap, no ML):
//   1. featurize each candidate utterance (length, has-? mark, final
//      particle distribution, host-signature lexicon hits, guest-signature
//      lexicon hits).
//   2. score each utterance: hostiness = host_hits - guest_hits, +1 per
//      long-form predicate, -1 per pure backchannel.
//   3. classify HOST vs GUEST by sign of score (ties → previous speaker).
//   4. bleed-split: if a sentence ends with one of the reaction tokens
//      after a clause-final closer, split off the tail and assign to the
//      OTHER speaker.
//   5. addressee rule: vocative `〜君。/〜さん。/〜先生。/〜ちゃん。` marks
//      the next non-vocative utterance as addressed to that party (the
//      ADDRESSEE then becomes the next speaker).
//
// Output: same shape as turnizeByPause — array of `{speaker, sentences}` —
// but speaker is `HOST` / `GUEST` (not A/B) and consecutive same-speaker
// utterances are merged.

const REACTION_TOKEN_RE = /^(?:うん|うんうん|うんうんうん|はい|はいはい|ええ|なるほど|なるほどなるほど|おお|おー|そうそう|そうですね|そうなんですね|へえ|へー|ふーん|あ|ああ|わ|ですね|そっか|そうか)[、。．！？\s]*$/;

/** Tokens that signal a turn is functioning AS a backchannel even if not pure. */
const CONTINUER_TAIL_RE = /[、,]?\s*(?:うん|うんうん|はい|なるほど|そうそう|おお|ええ|へえ)[。！？．\s]*$/;

/** Sentence-final closers after which a trailing reaction is suspicious. */
const CLOSER_BEFORE_REACTION_RE = /(?:けど|けども|んですけど|んですけれども|から|んだ|んです|ます|です|ね|よ|よね|でしょ|でしょう)[、,]?\s*$/;

/** Host-signature surface forms (expository / narrative / informing). */
const HOST_LEX = [
  'なんですよ','わけです','わけですよ','わけですね','んですけれども','ですけれども',
  'ですけど','ですけれど','というのは','ということです','と言いますと',
  'なんでしょうか','じゃないですか','なんですけど','んですよ','んですよね',
  'ありました','ありますね','言いました','言いますと','言われています','と言われています',
  'みたいなんですよ','ようです','ようなんです','ようなんですよ',
  // casual-register exposition (two-man show host who narrates in plain+んだ style)
  'んだわ','んだよね','わけなんです','わけなんですよ','わけなんですけど','わけじゃない',
  'らしくて','らしいんです','らしいんですよ','みたいなんです','んですけども',
  'なんですけども','なんですよね','のことなんです','ってことなんです','たんですよ',
];

/** Guest-signature surface forms (reactive / inquiry / receipt). */
const GUEST_LEX = [
  'なるほど','なるほどなるほど','へえ','へー','ふーん','おお','そうなんですか',
  'そうですか','そうなんだ','あ、そうなんだ','すごいですね','面白いですね',
  '初めて聞きました','知らなかった','知らなかったです','知ってます','聞いたことある',
  '聞いたことあります','どういうことですか','どういう意味ですか','なんでですか',
  'えっ','えっと','うん','うんうん','はいはい','はいはいはい',
  // casual-register agreement / receipt (reactor in a two-man show)
  'だよね','もんね','そうだね','そうなの','そうなの?','じゃないの','わかる','わかるわかる',
  'そうそう','確かに','聞くね','聞いたことある','だもんね',
];

/** `ですね` is host-exposition when it tails a long clause (〜してですね) but a
 *  guest receipt when it stands alone (そうですね。). Disambiguated by length. */
function desuneSignal(text, strippedLen) {
  if (!/ですね/.test(text)) return 0;
  if (strippedLen <= 7 && /^(そう)?ですね/.test(text.trim())) return -1.5; // standalone receipt → guest
  return +1; // tail of a longer clause → host
}

/** Interruption / 2nd-person command — a near-certain turn flip when it lands
 *  on top of the partner's expository turn (おい / やめろ / 待ってくれ / お前 …). */
const INTERRUPT_RE = /(?:^おい|^ちょっと待|待ってくれ|やめろ|やめなよ|お前|なんだよ|^いやいや|うるせ|っつの|勘弁)/;

/** Vocative pattern detection. */
const VOCATIVE_RE = /^([\u4E00-\u9FFFぁ-んァ-ヴーA-Za-z]{1,8})(?:君|さん|先生|ちゃん)[、。．！]/;

/** Featurize one sentence — produce a hostiness score (positive = HOST, negative = GUEST). */
export function scoreUtterance(text) {
  if (!text) return { score: 0, isReaction: true, isQuestion: false, hostHits: 0, guestHits: 0, length: 0 };
  const stripped = text.replace(/[、。．,.\s「」『』！!？?ー~〜]/g, '');
  const length = stripped.length;
  if (length === 0) return { score: 0, isReaction: true, isQuestion: false, hostHits: 0, guestHits: 0, length: 0 };

  if (REACTION_TOKEN_RE.test(text.trim())) {
    return { score: -3, isReaction: true, isQuestion: false, hostHits: 0, guestHits: 1, length };
  }

  let hostHits = 0;
  for (const s of HOST_LEX) if (text.includes(s)) hostHits++;
  let guestHits = 0;
  // Only substring-match guest tokens ≥3 chars; short kana backchannels
  // (うん/はい/ええ/おお) fire inside content words (してしま*うん*な) — those are
  // handled whole-utterance by REACTION_TOKEN_RE instead.
  for (const s of GUEST_LEX) if (s.length >= 3 && text.includes(s)) guestHits++;

  const isQuestion = /[？?]\s*$/.test(text) || /(?:ですか|ますか|の\?|の？|んですか)[、。．\s]*$/.test(text);

  // Length contribution: long utterances are more host-like (expository).
  const lengthScore = length >= 30 ? 1 : (length >= 15 ? 0.5 : (length <= 6 ? -1 : 0));
  // Question lifts guest-likelihood (within reason — host also asks rhetoricals).
  const questionScore = isQuestion ? -0.5 : 0;

  const score = (hostHits * 1.5) - (guestHits * 1.5) + lengthScore + questionScore + desuneSignal(text, length);
  return { score, isReaction: false, isQuestion, hostHits, guestHits, length, interrupt: INTERRUPT_RE.test(text.trim()) };
}

/** Split a cue's text on a trailing reaction tail. Returns
 *  { head, tail } where tail is the bleed-through (or empty). */
export function bleedSplit(text) {
  if (!text) return { head: text, tail: '' };
  // Find the position of the trailing reaction.
  const m = text.match(/^(.*?)([、,]?\s*(?:うん|うんうん|はい|なるほど|そうそう|おお|ええ|へえ))([。！？．\s]*)$/);
  if (!m) return { head: text, tail: '' };
  const head = m[1];
  const tail = m[2].replace(/^[、,]\s*/, '') + (m[3] ?? '');
  // Only split if head ends with a closer (otherwise the reaction may be
  // genuine sentence-final particle of same speaker).
  if (!CLOSER_BEFORE_REACTION_RE.test(head)) return { head: text, tail: '' };
  if (head.trim().length < 6) return { head: text, tail: '' };
  return { head: head.trim() + (head.trim().endsWith('。') ? '' : '。'), tail: tail.trim() };
}

/** Main diarize entry point.
 *  @param {Array<{text:string,startMs?:number,endMs?:number,cueIdxs?:number[]}>} sentences
 *  @returns {Array<{speaker:string, sentences:any[]}>}
 */
export function diarize(sentences) {
  if (!sentences.length) return [];

  // Step A: bleed-split — expand the sentence list with splits.
  /** @type {any[]} */
  const expanded = [];
  for (const s of sentences) {
    const { head, tail } = bleedSplit(s.text);
    if (tail) {
      expanded.push({ ...s, text: head, _bledFrom: s.text });
      expanded.push({ ...s, text: tail, _bledTail: true, _bledFrom: s.text });
    } else {
      expanded.push({ ...s });
    }
  }

  // Step B: score each utterance.
  const scored = expanded.map(s => ({ ...s, _feat: scoreUtterance(s.text) }));

  // Step C: classify with sticky previous-speaker for ties.
  let prev = 'HOST';
  for (let i = 0; i < scored.length; i++) {
    const s = scored[i];
    const f = s._feat;
    if (s._bledTail) {
      // Tail is by construction the OTHER speaker.
      s.speaker = prev === 'HOST' ? 'GUEST' : 'HOST';
      continue;
    }
    // Interruption flip: a 2nd-person command/break-in landing on top of the
    // partner's expository turn is the OTHER speaker, regardless of weak score.
    const prevFeat = i > 0 ? scored[i - 1]._feat : null;
    if (f.interrupt && Math.abs(f.score) < 1.5 && prevFeat && prevFeat.length >= 15 && !prevFeat.isReaction) {
      s.speaker = prev === 'HOST' ? 'GUEST' : 'HOST';
    } else if (Math.abs(f.score) < 0.5) {
      s.speaker = prev;
    } else if (f.score > 0) {
      s.speaker = 'HOST';
    } else {
      s.speaker = 'GUEST';
    }
    prev = s.speaker;
  }

  // Step D: addressee from vocative — vocative sentence stays with current
  // speaker; the NEXT non-vocative non-backchannel sentence is the addressee.
  for (let i = 0; i < scored.length; i++) {
    const m = VOCATIVE_RE.exec(scored[i].text);
    if (!m) continue;
    scored[i].addressee = m[1];
    // Find next non-reaction sentence; expect it to be the addressee.
    for (let j = i + 1; j < Math.min(i + 4, scored.length); j++) {
      if (scored[j]._feat.isReaction) {
        // The reaction IS the addressee responding.
        const callerSpeaker = scored[i].speaker;
        scored[j].speaker = callerSpeaker === 'HOST' ? 'GUEST' : 'HOST';
        break;
      }
    }
  }

  // Step E: merge consecutive same-speaker sentences into turns.
  /** @type {Array<{speaker:string, sentences:any[]}>} */
  const turns = [];
  for (const s of scored) {
    if (turns.length && turns[turns.length - 1].speaker === s.speaker) {
      turns[turns.length - 1].sentences.push(s);
    } else {
      turns.push({ speaker: s.speaker, sentences: [s] });
    }
  }
  return turns;
}
