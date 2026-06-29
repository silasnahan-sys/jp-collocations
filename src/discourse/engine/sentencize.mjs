// _tmp_pipeline/sentencize.mjs
// Split a stream into sentences. Three modes:
//   (1) PUNCTUATION-DRIVEN — if 。！？ density is sufficient, split there
//   (2) CUE-DRIVEN — if input is from VTT cues, use timing gaps + filler
//       tokens + sentence-final markers as soft boundaries
//   (3) HYBRID — combine: even punctuation-poor text often has clear
//       sentence-final markers (です/ます/だ/ね/よ + pause)
//
// Postprocess fixes (added in v2):
//   - NUMERIC-COUNTER MERGE: if sentence A ends in /[0-9０-９]+。$/ and the
//     next sentence begins with a Japanese counter (人/年/月/円/時間/番/
//     回/匹/名/歳/代/etc.), the ASR hallucinated a 。 between number and
//     counter — merge them.
//   - FRAGMENT REATTACH: if a sentence is ≤ 2 mora and is not a known
//     standalone backchannel, prepend it to the next sentence.

const HARD_PUNCT = /[。！？!?]/;
const SOFT_PUNCT = /[、,]/;

/** Japanese counter heads that an ASR may have severed from a preceding numeral. */
const JP_COUNTER_HEAD =
  /^(?:人|年|月|円|時間|秒|分|時|日|週|歳|才|名|番|回|匹|頭|羽|機|台|本|個|枚|冊|杯|皿|軒|戸|階|畳|曲|首|首相|代|世紀|世|位|位置|割|分の)/;

/** Tokens that, alone, are real standalone responses and must NOT be merged. */
const KEEP_STANDALONE = new Set([
  'うん','うんうん','うんうんうん','はい','はいはい','ええ','えぇ',
  'そう','そうそう','なるほど','確かに','そっか','ですね',
  'へえ','へー','ふーん','おお','おー','ありがとう','ありがとうございました',
  'おしまい','ハレルヤ','イエス','ノー','違う','違います','いえ','いえいえ',
  'すみません','失礼します',
]);


/** Final-position markers that often end an utterance even without 。 */
const FINAL_MARKERS = [
  'です','ます','ました','ません','でした','でしょう','でしょ','だ','だよ','だね','だな',
  'ですね','ですよ','ですか','ますね','ますよ','ますか',
  'ですよね','ますよね','んです','んだ','んだよ','のだ','のです',
  'よね','かな','かしら','かもしれない','かもしれません','じゃない','じゃないですか',
  'のですが','んですけど','んですけれども','けど','けれど','けれども',
];

/** Compile a single regex that matches any final marker at end-of-cue. */
const FINAL_RE = new RegExp(`(?:${FINAL_MARKERS.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`);

/** Quick check: does this string contain enough hard punctuation? */
export function hasPunctuation(text, minDensity = 0.005) {
  if (!text) return false;
  const hits = (text.match(/[。！？!?]/g) || []).length;
  return hits / Math.max(text.length, 1) >= minDensity;
}

/** Split punctuation-rich text into sentences. */
export function splitByPunctuation(text) {
  if (!text) return [];
  /** @type {string[]} */
  const out = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    buf += ch;
    if (HARD_PUNCT.test(ch)) {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = '';
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * Combine VTT cues into sentences using:
 *  - cue text concatenation (joined by zero-width space-free direct adjacency)
 *  - timing gap > gapMs as soft boundary
 *  - end-of-cue tokens matching FINAL_MARKERS as boundary
 *  - hard punctuation 。！？ inside cue text as boundary
 *
 * @param {Array<{startMs:number,endMs:number,text:string}>} cues
 * @param {{gapMs?:number}} [opts]
 */
export function sentencizeCues(cues, opts = {}) {
  const gapMs = opts.gapMs ?? 700;
  /** @type {Array<{text:string, startMs:number, endMs:number, cueIdxs:number[]}>} */
  const sentences = [];
  let buf = '';
  let bufStart = -1;
  let bufEnd = -1;
  /** @type {number[]} */
  let bufIdxs = [];

  const flush = () => {
    const t = buf.trim();
    if (t) sentences.push({ text: t, startMs: bufStart, endMs: bufEnd, cueIdxs: bufIdxs });
    buf = ''; bufStart = -1; bufEnd = -1; bufIdxs = [];
  };

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (!cue.text) continue;
    const prev = cues[i - 1];
    const gap = prev ? (cue.startMs - prev.endMs) : 0;

    if (gap > gapMs && buf.trim()) flush();

    if (bufStart < 0) bufStart = cue.startMs;
    bufEnd = cue.endMs;
    bufIdxs.push(i);
    buf += cue.text;

    // Split inside the cue if it contains hard punctuation.
    if (HARD_PUNCT.test(buf)) {
      const parts = splitByPunctuation(buf);
      // Push all but the last as completed sentences; keep last as in-progress.
      for (let k = 0; k < parts.length - 1; k++) {
        sentences.push({
          text: parts[k],
          startMs: bufStart,
          endMs: bufEnd,
          cueIdxs: [...bufIdxs],
        });
      }
      const last = parts[parts.length - 1] ?? '';
      if (HARD_PUNCT.test(last.slice(-1))) {
        sentences.push({ text: last, startMs: bufStart, endMs: bufEnd, cueIdxs: [...bufIdxs] });
        buf = ''; bufStart = -1; bufEnd = -1; bufIdxs = [];
      } else {
        buf = last; // partial sentence carried forward
        // keep bufStart/bufIdxs (approximate)
      }
      continue;
    }

    // No hard punct in buffer — soft boundary if cue ends in a final marker
    // AND next cue has a meaningful gap or starts a new utterance.
    if (FINAL_RE.test(buf)) {
      const next = cues[i + 1];
      const nextGap = next ? (next.startMs - cue.endMs) : Infinity;
      if (nextGap > 250 || !next) flush();
    }
  }
  if (buf.trim()) flush();
  return repairBoundaries(sentences);
  }

/** Speaker-tag prefix: "A: …", "高成: …" — same shape used by detect/turnize. */
const SPEAKER_TAG_RE = /^([A-Za-z\u4E00-\u9FFFぁ-んァ-ヴ][A-Za-z\u4E00-\u9FFFぁ-んァ-ヴ]{0,4}):\s*(.*)$/;

/**
 * Tagged-transcript sentencizer. Splits a speaker-tagged plain-text stream
 * ("A: …" / "高成: …") into sentences that each carry their speaker, so that
 * downstream layers never see two speakers fused into one "sentence".
 *
 * Algorithm:
 *   1. Read line-by-line. A line beginning with a speaker tag opens a new
 *      utterance for that speaker; an untagged non-empty line is treated as a
 *      continuation of the current speaker's utterance.
 *   2. Sentencize WITHIN each utterance (punctuation split when present, else
 *      the whole utterance is one sentence). Boundary repair runs per-utterance
 *      only, so micro-fragments are never reattached across a speaker change.
 *
 * @param {string} raw
 * @returns {Array<{text:string, speaker:string}>}
 */
export function sentencizeTagged(raw) {
  const text = String(raw ?? '').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  /** @type {Array<{speaker:string, content:string}>} */
  const utterances = [];
  let curSpeaker = '?';
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const m = SPEAKER_TAG_RE.exec(t);
    if (m) {
      curSpeaker = m[1];
      utterances.push({ speaker: curSpeaker, content: m[2].trim() });
    } else if (utterances.length) {
      // continuation line — belongs to the current speaker
      utterances[utterances.length - 1].content += t;
    } else {
      utterances.push({ speaker: curSpeaker, content: t });
    }
  }
  /** @type {Array<{text:string, speaker:string}>} */
  const out = [];
  for (const u of utterances) {
    if (!u.content) continue;
    const parts = hasPunctuation(u.content) ? splitByPunctuation(u.content) : [u.content];
    const repaired = repairBoundaries(parts.map(p => ({ text: p })));
    for (const r of repaired) {
      const clean = (r.text || '').trim();
      if (clean) out.push({ text: clean, speaker: u.speaker });
    }
  }
  return out;
}

/** Plain-text sentencizer — uses punctuation if available, otherwise
 *  falls back to FINAL_MARKERS heuristic. */
export function sentencizePlain(text) {
  let raw;
  if (hasPunctuation(text)) {
    raw = splitByPunctuation(text);
  } else {
    // No punctuation: try line breaks then FINAL_MARKERS.
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    /** @type {string[]} */
    const out = [];
    let buf = '';
    for (const l of lines) {
      buf = buf ? buf + l : l;
      if (FINAL_RE.test(buf)) { out.push(buf); buf = ''; }
    }
    if (buf) out.push(buf);
    raw = out;
  }
  return repairBoundaries(raw.map(t => ({ text: t }))).map(s => s.text);
}

// ───────────────────────── caption mode (no punctuation) ─────────────────────
// YouTube auto-caption copy has no 。 and inline [HH:MM:SS] stamps. We split
// on sentence-final SKELETAL clusters only (topic-agnostic), guarding against
// clusters that are actually mid-clause continuations.

/** Sentence-final skeletal clusters, matched longest-first. */
const CAPTION_FINAL = [
  'じゃないですか','んですけれども','ますでしょうか','でしょうか',
  'んですよね','んですけど','ですよね','ますよね','でしょうね','じゃないか',
  'ましょうか','ましたっけ','ませんでした','んでした','と思います','と思う',
  'でしょう','ましょう','ますか','ますね','ますよ','ました','ません',
  'ですね','ですよ','ですか','でした','んです','のです','のだ','んだよね',
  'んだよ','んだね','んだな','んだ','だよね','だよな','だわ','だよ','だね','だな',
  'じゃん','じゃない','でしょ','だろう','だろ','かな','かなあ','よね','わよ',
  'ますわ','ですわ','たわ','だわ',
  'ます','です','すか','んすか','なよ','ってこと',
];
const CAPTION_FINAL_SORTED = [...new Set(CAPTION_FINAL)].sort((a, b) => b.length - a.length);

/** If text AFTER a candidate boundary begins with one of these, the "final"
 *  form is mid-clause → suppress. Front items (わ/よ/ね/さ/が/か) keep final
 *  particle / です-が・です-か clusters intact; case particles は/を/に/も are
 *  intentionally absent (after a final form they open a new dislocated clause). */
const CAPTION_CONT = /^(?:わ|よ|ね|さ|が|か|から|けれども|けれど|けども|けど|ので|のに|んで|して|したら|し|くらい|ぐらい|ばかり|わけ|つつ|ながら|より|まで|など|なんか|たり|たら|れば|って|という|ような|ように|みたいな|時|とき|場合|ところ|の|と|で|て)/;

/** Strong sentence-initial cues: force a split BEFORE these (not at offset 0). */
const CAPTION_INIT = /(さて|ところで|というわけで|それでは|じゃあ|じゃ次)/g;

/** Split a punctuation-less Japanese string into sentence-ish units using only
 *  skeletal cues. Returns boundary offsets is internal; exposed as string[]. */
export function segmentSkeletal(text) {
  const s = String(text ?? '');
  if (!s) return [];
  const bounds = new Set();
  for (let i = 1; i < s.length; i++) {
    for (const f of CAPTION_FINAL_SORTED) {
      if (i >= f.length && s.slice(i - f.length, i) === f) {
        if (!CAPTION_CONT.test(s.slice(i))) bounds.add(i);
        break; // longest cluster ending here wins
      }
    }
  }
  let m;
  while ((m = CAPTION_INIT.exec(s)) !== null) if (m.index > 0) bounds.add(m.index);
  const sorted = [...bounds].sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const b of sorted) { const seg = s.slice(prev, b).trim(); if (seg) out.push({ text: seg, _start: prev, _end: b }); prev = b; }
  const tail = s.slice(prev).trim(); if (tail) out.push({ text: tail, _start: prev, _end: s.length });
  return out;
}

/** Parse [MM:SS]/[HH:MM:SS] (optional markdown link) → ms; else null. */
function parseStamp(line) {
  const m = /^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\](?:\([^)]*\))?\s*/.exec(line);
  if (!m) return null;
  const a = +m[1], b = +m[2], c = m[3] != null ? +m[3] : null;
  const ms = (c != null) ? ((a * 3600 + b * 60 + c) * 1000) : ((a * 60 + b) * 1000);
  return { ms, rest: line.slice(m[0].length) };
}

/** Strip caption noise: [音楽]/[笑い] markers, html/markdown, wrap-spaces. */
function cleanCaptionText(t) {
  return String(t ?? '')
    .replace(/\[[^\]]*\]/g, ' ')               // [音楽] [笑い] [拍手]
    .replace(/<[^>]+>/g, ' ')                   // stray html (mark/span/svg)
    .replace(/\*\*?|`+|^#+\s*|^-#\s*/gm, ' ')   // markdown emphasis/headers
    .replace(/[ \t　]+/g, '');              // wrap-spaces are artifacts → drop
}

/**
 * Caption sentencizer. Builds timestamped cues, joins their cleaned text into a
 * single stream (tracking each char's cue time), splits skeletally, and assigns
 * each sentence approximate startMs/endMs. The startMs lets turnizeAuto route to
 * the lexical diarizer automatically.
 * @returns {Array<{text:string, startMs:number, endMs:number}>}
 */
export function sentencizeCaptions(raw) {
  const lines = String(raw ?? '').replace(/^﻿/, '').split(/\r?\n/);
  let joined = '';
  /** @type {number[]} */ const timeOf = []; // ms per char index in `joined`
  let curMs = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const st = parseStamp(t);
    let body;
    if (st) { curMs = st.ms; body = st.rest; } else { body = t; }
    const cleaned = cleanCaptionText(body);
    for (const ch of cleaned) { joined += ch; timeOf.push(curMs); }
  }
  if (!joined) return [];
  const segs = segmentSkeletal(joined);
  /** @type {Array<{text:string, startMs:number, endMs:number}>} */
  const out = [];
  for (const sg of segs) {
    const startMs = timeOf[sg._start] ?? curMs;
    const endIdx = Math.min(sg._end, timeOf.length - 1);
    const endMs = timeOf[endIdx] ?? startMs;
    out.push({ text: sg.text, startMs, endMs: Math.max(endMs, startMs) });
  }
  return repairBoundaries(out);
}

/** Postprocess pass: merge ASR digit-counter splits + reattach micro-fragments.
 *  Pure on the sentence list, preserves cue/timing metadata when merging. */
export function repairBoundaries(sents) {
  if (!sents || sents.length < 2) return sents ?? [];
  // Pass A: numeric+counter merge.
  /** @type {any[]} */
  const a = [];
  for (let i = 0; i < sents.length; i++) {
    const cur = sents[i];
    if (a.length && /[0-9０-９]+[。．]\s*$/.test(a[a.length - 1].text) &&
        JP_COUNTER_HEAD.test(cur.text.replace(/^[\s、,]+/, ''))) {
      const prev = a[a.length - 1];
      prev.text = prev.text.replace(/[。．]\s*$/, '') + cur.text;
      if (cur.endMs != null) prev.endMs = cur.endMs;
      if (cur.cueIdxs && prev.cueIdxs) prev.cueIdxs = [...prev.cueIdxs, ...cur.cueIdxs];
      continue;
    }
    a.push({ ...cur });
  }
  // Pass B: micro-fragment reattach (≤2 mora, not standalone).
  /** @type {any[]} */
  const b = [];
  for (let i = 0; i < a.length; i++) {
    const cur = a[i];
    const stripped = cur.text.replace(/[、。．,.\s「」『』！!？?ー~〜]/g, '');
    const isMicro = stripped.length > 0 && stripped.length <= 2 && !KEEP_STANDALONE.has(stripped);
    if (isMicro && i + 1 < a.length) {
      const next = a[i + 1];
      next.text = cur.text.replace(/[、。．]?\s*$/, '') + (cur.text.endsWith('、') ? '' : '、') + next.text;
      if (cur.startMs != null && (next.startMs == null || cur.startMs < next.startMs)) next.startMs = cur.startMs;
      if (cur.cueIdxs && next.cueIdxs) next.cueIdxs = [...cur.cueIdxs, ...next.cueIdxs];
      continue;
    }
    b.push(cur);
  }
  return b;
}
