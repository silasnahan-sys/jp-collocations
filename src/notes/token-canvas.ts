/**
 * token-canvas.ts — the PURE core of the TokenCanvas (§22.4): tokenization,
 * the marks model, and marks → class/payload derivation. Golden-tested in
 * golden/canvas.mjs.
 *
 * Accuracy contract (user edit, §22.4 caveat): tokens must be accurate and
 * variation-responsive, or honestly coarse — dictionary-validated
 * longest-match when a lookup is available, script-run fallback otherwise.
 * Never confidently wrong: a fallback token is a coarse RUN, not a guessed
 * word boundary.
 *
 * The marks model encodes the class-defining tests as data:
 *   span     — drawn edges → the unit IS the surface (🟡/🔵)
 *   parts    — picked bones → 🟠 skeletal link
 *   struck   — crossed-out tokens → ○○ slots; kept tokens = frame → 💠
 *   circled  — the evocative pivot (+ halo range) → 🟢
 * (the 🔴 arrow gesture is v2 — pending the user's Pages reference.)
 */

import { normalizeJapanese } from '../utils/japanese.ts';
import { deinflect } from '../dictionary/deinflect.ts';

export interface CanvasToken {
  text: string;
  start: number;
  end: number;
  kind: 'text' | 'punct';
}

const PUNCT_RE = /[、。！？!?・…‥「」『』()（）\s]/;
const KANJI = /[㐀-䶿一-鿿々]/;
const HIRA = /[ぁ-ゖー]/;
const KATA = /[ァ-ヶー]/;

const scriptOf = (ch: string): 'kanji' | 'hira' | 'kata' | 'punct' | 'other' =>
  PUNCT_RE.test(ch) ? 'punct' : KANJI.test(ch) ? 'kanji' : HIRA.test(ch) ? 'hira' : KATA.test(ch) ? 'kata' : 'other';

/**
 * Tokenize for the canvas. `probe` (optional) validates a candidate word —
 * typically deinflection-backed dictionary lookup. With a probe: longest
 * validated match wins (8→2 chars). Without (or on miss): script runs, with
 * a kanji run + its trailing hiragana kept together (書いて stays whole —
 * okurigana belongs to its kanji), and each punctuation char its own token.
 */
export function tokenizeForCanvas(text: string, probe?: (s: string) => boolean): CanvasToken[] {
  const out: CanvasToken[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const sc = scriptOf(ch);
    if (sc === 'punct') {
      out.push({ text: ch, start: i, end: i + 1, kind: 'punct' });
      i++;
      continue;
    }
    // dictionary longest-match first
    if (probe) {
      let matched = 0;
      for (let n = Math.min(8, text.length - i); n >= 2; n--) {
        const cand = text.slice(i, i + n);
        if ([...cand].some((c) => scriptOf(c) === 'punct')) continue;
        if (probe(cand)) { matched = n; break; }
      }
      if (matched) {
        out.push({ text: text.slice(i, i + matched), start: i, end: i + matched, kind: 'text' });
        i += matched;
        continue;
      }
    }
    // fallback: script run. A kanji run followed by hiragana splits so the
    // okurigana stays with ITS verb: the split is deinflection-VALIDATED
    // (昨日書いた → 昨日|書いた, never 昨日書|いた), suru-verbal nouns keep
    // both kanji (勉強した whole). Unvalidatable → the coarse whole run.
    let j = i + 1;
    if (sc === 'kanji') {
      while (j < text.length && scriptOf(text[j]) === 'kanji') j++;
      const kanjiEnd = j;
      let tailEnd = kanjiEnd;
      while (tailEnd < text.length && scriptOf(text[tailEnd]) === 'hira') tailEnd++;
      const tail = text.slice(kanjiEnd, tailEnd);
      const runLen = kanjiEnd - i;
      if (tail) {
        const U_ROW = /[うくぐすつぬぶむる]$/;
        const k = tail.startsWith('し') && runLen >= 2 ? 2 : 1;
        const candStart = kanjiEnd - Math.min(k, runLen);
        const cand = text.slice(candStart, tailEnd);
        const valid = U_ROW.test(cand) || deinflect(cand).some((d) => U_ROW.test(d.term) && d.term.length >= 2);
        if (valid) {
          if (candStart > i) out.push({ text: text.slice(i, candStart), start: i, end: candStart, kind: 'text' });
          out.push({ text: cand, start: candStart, end: tailEnd, kind: 'text' });
          i = tailEnd;
          continue;
        }
      }
      out.push({ text: text.slice(i, tailEnd), start: i, end: tailEnd, kind: 'text' });
      i = tailEnd;
      continue;
    }
    while (j < text.length && scriptOf(text[j]) === sc) j++;
    out.push({ text: text.slice(i, j), start: i, end: j, kind: 'text' });
    i = j;
  }
  return out;
}

/** The marks a user (or a faint suggestion) can put on the canvas. */
export interface CanvasMarks {
  /** contiguous token-index range [from, to] inclusive — the drawn span. */
  span?: [number, number];
  /** picked bones (token indexes, any adjacency) — 🟠. */
  parts: number[];
  /** crossed-out token indexes — ○○ slots for 💠. */
  struck: number[];
  /** the circled pivot token — 🟢. */
  circled?: number;
  /** halo range [from, to] around the pivot (defaults to the pivot alone). */
  halo?: [number, number];
}

export const emptyMarks = (): CanvasMarks => ({ parts: [], struck: [] });

export interface DerivedCapture {
  cls: 'serifu' | 'collocation' | 'rhet_collocation' | 'phrase_schema' | 'skeletal' | null;
  note: string;
  payload: { parts?: string[]; frame?: string; lemma?: string; halo?: string };
  why: string;
}

const joinTokens = (tokens: CanvasToken[], from: number, to: number): string =>
  tokens.slice(from, to + 1).map((t) => t.text).join('').trim();

/**
 * Marks → the capture they MEAN. Priority mirrors specificity: a circle is
 * the most deliberate mark, then strikes (slots), then picked parts, then a
 * plain span. Exactly one reading wins — the gesture is the semantics.
 */
export function deriveFromMarks(tokens: CanvasToken[], marks: CanvasMarks): DerivedCapture {
  const clean = (s: string): string => normalizeJapanese(s).trim();

  if (marks.circled != null && tokens[marks.circled]) {
    const [hf, ht] = marks.halo ?? [marks.circled, marks.circled];
    const lemma = clean(tokens[marks.circled].text);
    const halo = clean(joinTokens(tokens, hf, ht));
    return {
      cls: 'rhet_collocation',
      note: halo || lemma,
      payload: { lemma, ...(halo && halo !== lemma ? { halo } : {}) },
      why: '◯ 円 = 喚起の軸（レンマ）',
    };
  }

  if (marks.struck.length) {
    // kept tokens form the frame; each struck RUN becomes one ○○ slot.
    // Scope: the span if drawn, else the whole line.
    const [from, to] = marks.span ?? [0, tokens.length - 1];
    const struck = new Set(marks.struck);
    let frame = '';
    let inSlot = false;
    for (let i = from; i <= to; i++) {
      if (struck.has(i)) {
        if (!inSlot) { frame += '○○'; inSlot = true; }
      } else {
        frame += tokens[i].text;
        inSlot = false;
      }
    }
    frame = clean(frame);
    return {
      cls: 'phrase_schema',
      note: frame,
      payload: { frame },
      why: '取り消し線 = 差し替え可能なスロット（再配列テスト）',
    };
  }

  if (marks.parts.length >= 2) {
    const parts = [...marks.parts].sort((a, b) => a - b)
      .map((i) => clean(tokens[i]?.text ?? ''))
      .filter(Boolean);
    return {
      cls: 'skeletal',
      note: parts.join('〜'),
      payload: { parts },
      why: '複数タップ = リンクの部品（骨格）',
    };
  }

  if (marks.span) {
    const note = clean(joinTokens(tokens, marks.span[0], marks.span[1]));
    return { cls: null, note, payload: {}, why: 'ドラッグ = 表面そのもの（🟡/🔵はサジェスターが判定）' };
  }

  return { cls: null, note: '', payload: {}, why: '' };
}

/** A faint pentimento suggestion: a span (char offsets) + what proposes it. */
export interface SpanSuggestion {
  start: number;
  end: number;
  label: string;
}

/** Map char-offset suggestions onto token-index ranges (for faint rendering).
 *  A suggestion that doesn't align to token boundaries snaps OUTWARD — a
 *  faint mark may be generous, never truncating. */
export function suggestionToTokenRange(tokens: CanvasToken[], s: SpanSuggestion): [number, number] | null {
  let from = -1, to = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (from < 0 && tokens[i].end > s.start) from = i;
    if (tokens[i].start < s.end) to = i;
  }
  if (from < 0 || to < from) return null;
  return [from, to];
}
