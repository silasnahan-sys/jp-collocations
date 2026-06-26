// _tmp_pipeline/fillers.mjs
// Filler / backchannel dictionary. These tokens often LOOK like operator
// triggers but in many contexts are pure disfluency. The matcher uses this
// list to suppress operator emission unless the surrounding context forces
// it (e.g. "なんか" in the middle of a noun phrase IS APPROXIMATIVE, but
// "なんかさー、〜" sentence-initial is a filler).

/** Tokens that, when standing alone surrounded by punctuation/whitespace,
 *  are treated as discourse fillers (no operator emitted). */
export const STANDALONE_FILLERS = new Set([
  'えー','えーと','えっと','えっとー','えっと、','えーっと',
  'あー','あーと','あのー','あの','その','そのー',
  'うー','うーん','んー','んーと','うーんと',
  'まあ','ま','まー','まあね','まあまあ',
  'なんていうか','なんていうのかな','なんていうんだろう','なんつーか',
  'こう','ね','さ','よ','な',
]);

/** Backchannel tokens — when ALONE in a turn or standalone in a line, they
 *  represent listener uptake, not an operator. */
export const BACKCHANNELS = new Set([
  'うん','うんうん','うんうんうん','ううん',
  'はい','はいはい','ええ','えぇ',
  'そう','そうそう','そうそうそう','そうですね','そうですよね',
  'なるほど','確かに','そうか','そっか','あー','あーね','ですね',
  'へえ','へー','へぇ','ふーん','ふんふん','おお','おー',
  '了解','分かりました','わかりました','分かる','わかる',
]);

/** Sentence-initial mitigators — these soften following claims but rarely
 *  emit their own operator (instead they MODIFY the next operator's strength).
 *  NOTE: ただ・やっぱり・一応・もちろん・ちょっと・なんか were REMOVED from this
 *  list — they are now full operators (DISCOURSE-RESTRICTOR /
 *  EXPECTATION-CONFIRM / PROVISIONAL / PRESUPPOSE-EVOKE / HEDGE-DOWNGRADE /
 *  APPROXIMATIVE-FILLER) and should fire when sentence-initial. */
export const SENTENCE_INITIAL_MITIGATORS = new Set([
  'まあ','たぶん','多分','おそらく','まー','ま、','まあ、',
]);

/** Returns true if `tok` is a filler that should not emit an operator
 *  WHEN it appears in a typical filler position (sentence-initial,
 *  post-comma, post-pause). The caller passes `inFillerSlot`. */
export function isFillerSuppressed(tok, inFillerSlot) {
  if (!inFillerSlot) return false;
  return STANDALONE_FILLERS.has(tok) || SENTENCE_INITIAL_MITIGATORS.has(tok);
}

/** Returns true if a whole micro-utterance is only backchannel material. */
export function isBackchannelOnly(text) {
  const stripped = text.replace(/[、。．，,.\s「」『』！!？?ー~〜]/g, '');
  if (!stripped) return false;
  if (BACKCHANNELS.has(stripped)) return true;
  // Repeated うん / そう
  if (/^(うん|そう|はい|ええ|なるほど|そっか|そうですね|ですね)+$/.test(stripped)) return true;
  return false;
}
