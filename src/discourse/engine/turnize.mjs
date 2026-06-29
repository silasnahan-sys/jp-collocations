// _tmp_pipeline/turnize.mjs
// Group sentences into speaker turns. Four modes:
//   (1) TAGGED — explicit "A: ..." prefix, trust it
//   (2) DIARIZE — lexical 2-class HOST/GUEST classifier (preferred for VTT)
//   (3) PAUSE — VTT cues, long gap → potential turn boundary (legacy)
//   (4) SINGLE — assume one speaker for the whole document

import { diarize } from './diarize.mjs';

const TAG_RE = /^([A-Za-z\u4E00-\u9FFFぁ-んァ-ヴ][A-Za-z\u4E00-\u9FFFぁ-んァ-ヴ]{0,4}):\s*(.*)$/;

/** Tagged mode: each sentence may carry a speaker tag prefix. */
export function turnizeTagged(sentences) {
  /** @type {Array<{speaker:string, sentences:typeof sentences}>} */
  const turns = [];
  let currentSpeaker = null;
  /** @type {any[]} */
  let bucket = [];
  for (const s of sentences) {
    const text = typeof s === 'string' ? s : s.text;
    const m = TAG_RE.exec(text);
    if (m) {
      const sp = m[1];
      const rest = m[2];
      if (sp !== currentSpeaker) {
        if (bucket.length) turns.push({ speaker: currentSpeaker ?? '?', sentences: bucket });
        currentSpeaker = sp;
        bucket = [];
      }
      const cleaned = typeof s === 'string' ? rest : { ...s, text: rest };
      bucket.push(cleaned);
    } else {
      bucket.push(s);
    }
  }
  if (bucket.length) turns.push({ speaker: currentSpeaker ?? '?', sentences: bucket });
  return turns;
}

/** Pause mode: VTT-style sentences (with startMs/endMs). Long gap → turn. */
export function turnizeByPause(sentences, opts = {}) {
  const gapMs = opts.gapMs ?? 1500;
  if (!sentences.length) return [];
  /** @type {Array<{speaker:string, sentences:any[]}>} */
  const turns = [];
  /** @type {any[]} */
  let bucket = [sentences[0]];
  let speakerIdx = 0;
  for (let i = 1; i < sentences.length; i++) {
    const s = sentences[i];
    const prev = sentences[i - 1];
    const gap = (s.startMs ?? 0) - (prev.endMs ?? 0);
    if (gap > gapMs) {
      turns.push({ speaker: String.fromCharCode(65 + (speakerIdx % 2)), sentences: bucket });
      bucket = [];
      speakerIdx++;
    }
    bucket.push(s);
  }
  if (bucket.length) turns.push({ speaker: String.fromCharCode(65 + (speakerIdx % 2)), sentences: bucket });
  return turns;
}

/** Single mode: everything is one speaker. */
export function turnizeSingle(sentences, speaker = 'S') {
  return [{ speaker, sentences }];
}

/** Speaker-field mode: sentences already carry `.speaker` (from sentencizeTagged).
 *  Group runs of consecutive same-speaker sentences into turns. */
export function turnizeBySpeaker(sentences) {
  /** @type {Array<{speaker:string, sentences:any[]}>} */
  const turns = [];
  for (const s of sentences) {
    const sp = (s && s.speaker) || '?';
    const last = turns[turns.length - 1];
    if (last && last.speaker === sp) last.sentences.push(s);
    else turns.push({ speaker: sp, sentences: [s] });
  }
  return turns;
}

/** Pure-backchannel standalone utterance (うん。/ なるほど。/ へえ。 …). */
const STANDALONE_REACTION_RE = /^(?:うん|うんうん|うんうんうん|はい|はいはい|ええ|なるほど|なるほどなるほど|おお|おー|そうそう|そうですね|そうなんですね|へえ|へー|ふーん|あ|ああ|わ|そっか|そうか|確かに|わかる|わかるわかる)[、。．！？\s]*$/;

/** Turn-INITIAL reaction marker. In casual dialogue, reactions are usually
 *  glued to a comment (あ、そうなんだ / ああ、聞くね / いや、そうだよね) rather than
 *  bare — a lecture almost never opens sentences this way. */
const TURN_INITIAL_REACTION_RE = /^(?:うん|はい|ええ|なるほど|おお|そうそう|へえ|へー|ふーん|あ[、。\s]|ああ|あー|わ[、。\s]|そっか|そうか|確かに|わかる|いやいや|いや[、。\s]|そうだね|そうなの|なるほどね)/;

/** Does a label-less, timing-less transcript read as a 2-person dialogue?
 *  Use turn-initial reaction density so monologues stay single-speaker. */
export function looksDialogic(sentences) {
  const texts = sentences.map(s => ((typeof s === 'string' ? s : s.text) || '').trim());
  if (texts.length < 6) return false;
  let reactions = 0;
  for (const t of texts) if (STANDALONE_REACTION_RE.test(t) || TURN_INITIAL_REACTION_RE.test(t)) reactions++;
  // ≥3 reaction turns AND ≥10% of turns — lectures sit far below this floor.
  return reactions >= 3 && reactions / texts.length >= 0.10;
}

/** Auto: choose based on data shape. */
export function turnizeAuto(sentences) {
  // Highest priority: explicit per-sentence speaker field (tagged transcripts).
  if (sentences[0] && typeof sentences[0] === 'object' && sentences[0].speaker != null) {
    return turnizeBySpeaker(sentences);
  }
  const sample = sentences.slice(0, 20).map(s => typeof s === 'string' ? s : s.text);
  const taggedCount = sample.filter(t => TAG_RE.test(t)).length;
  if (taggedCount >= 3 && taggedCount / Math.max(sample.length, 1) > 0.3) return turnizeTagged(sentences);
  if (sentences[0] && typeof sentences[0] === 'object' && sentences[0].startMs != null) {
    // VTT-derived: prefer lexical diarizer over pause-flip.
    return diarize(sentences);
  }
  // Plain text (no tags, no timing): diarize only if it reads as a 2-person
  // dialogue; otherwise treat as one speaker so monologues aren't shredded.
  if (looksDialogic(sentences)) return diarize(sentences);
  return turnizeSingle(sentences);
}
