// _tmp_pipeline/normalize.mjs
// Text normalization: NFC, fullwidth↔halfwidth ASCII/digits, noise markers,
// repeated punctuation collapse. No semantic mutation — preserves all
// content-bearing characters.

const FULLWIDTH_ASCII_OFFSET = 0xFF01 - 0x21;

/** Convert full-width ASCII (！-～) to half-width. Spaces converted too. */
function fullwidthAsciiToHalf(s) {
  return s.replace(/[\uFF01-\uFF5E]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - FULLWIDTH_ASCII_OFFSET)
  ).replace(/\u3000/g, ' ');
}

/** Common YouTube auto-caption noise markers — strip but log count. */
const NOISE_PATTERNS = [
  /\[音楽\]/g,
  /\[拍手\]/g,
  /\[笑\]/g,
  /\[笑い\]/g,
  /\[笑い声\]/g,
  /\[歓声\]/g,
  /\[ざわざわ\]/g,
  /\[BGM\]/g,
  /\[bgm\]/gi,
  /（音楽）/g,
  /（拍手）/g,
  /（笑）/g,
  /\(音楽\)/g,
  /\(拍手\)/g,
  /\(笑\)/g,
  /♪[^♪]*♪/g,
  /♪/g,
];

/** Strip inline VTT timing tags like <00:00:01.234> and class spans. */
function stripVttInline(s) {
  return s
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
    .replace(/<c[^>]*>/g, '')
    .replace(/<\/c>/g, '')
    .replace(/<v[^>]*>/g, '')
    .replace(/<\/v>/g, '');
}

/** Collapse repeated punctuation: 。。。 → 。、、 → 、!!? → ! */
function collapsePunctuation(s) {
  return s
    .replace(/。{2,}/g, '。')
    .replace(/、{2,}/g, '、')
    .replace(/[！!]{2,}/g, (m) => m[0])
    .replace(/[？?]{2,}/g, (m) => m[0])
    .replace(/[…・]{3,}/g, '…');
}

/** Public: normalize a single line/utterance. */
export function normalize(raw, opts = {}) {
  let s = String(raw ?? '');
  s = s.normalize('NFC');
  s = stripVttInline(s);
  let stripped = 0;
  for (const p of NOISE_PATTERNS) {
    s = s.replace(p, () => { stripped++; return ''; });
  }
  if (opts.fullwidthToHalf !== false) s = fullwidthAsciiToHalf(s);
  s = collapsePunctuation(s);
  s = s.replace(/[ \t]+/g, ' ').trim();
  return { text: s, noiseStripped: stripped };
}

/** Batch-normalize an array of lines, preserving line breaks. */
export function normalizeLines(lines, opts = {}) {
  return lines.map(l => normalize(l, opts));
}
