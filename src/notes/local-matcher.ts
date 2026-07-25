/**
 * local-matcher.ts — the pure, offline reconciliation backbone (DESIGN §4).
 *
 * Given a user's note phrase (from Apple Notes / typed — possibly misspelled,
 * abbreviated, or carrying its own kanji errors) and a frozen transcript (which
 * carries YouTube ASR errors), locate WHERE the phrase was said and propose
 * corrections for both sides.
 *
 * No network, no model, no Obsidian. Deterministic. This is the part that must
 * always work; the LLM only disambiguates the residue it flags `needs-review`.
 *
 * The Japanese-specific move (DESIGN §4 reading-space amendment): span location
 * is fuzzy on SURFACE (robust to a few kanji swaps because most chars still
 * match), but correction detection runs in READING space — so 効く / 利く / 聞く
 * (all きく) are recognised as the same word and a kanji error becomes a
 * *confident homophone correction* rather than an unexplained mismatch. Readings
 * come from an injected resolver (DictionaryStore in production); with no
 * resolver the module degrades to surface-only matching.
 */

import { normalizeJapanese, katakanaToHiragana, isKanji, levenshtein } from '../utils/japanese.ts';

/** A frozen transcript line. */
export interface MatcherLine {
  index: number;
  tStartSec?: number;
  text: string;
  /** Diarized speaker letter (`[HH:MM:SS] A: …` lines — §23.4-3 layer-1 truth). */
  speaker?: string;
}

/** surface → kana reading, or null if unknown. Backed by DictionaryStore + deinflection in prod. */
export type ReadingResolver = (surface: string) => string | null;

export interface Correction {
  /** The run as it appears in the user's note. */
  noteText: string;
  /** The aligned run as it appears in the transcript. */
  transcriptText: string;
  kind: 'homophone' | 'kanji-swap' | 'edit';
  /** 0..1 — how sure we are these are the same intended token. */
  confidence: number;
  reason: string;
}

export interface MatchSpan {
  startLine: number;
  endLine: number;
  tStartSec?: number;
  text: string;
  /** 0..1 fuzzy surface similarity of the located span to the note. */
  score: number;
}

export interface MatchResult {
  best: MatchSpan | null;
  alternatives: MatchSpan[];
  contextBefore: string[];
  contextAfter: string[];
  corrections: Correction[];
  /** Combined confidence for the located span (before any LLM disambiguation). */
  confidence: number;
}

// ── reading-space normalisation ───────────────────────────────────────────────
// katakana → hiragana always; each maximal kanji run → its reading if the resolver
// knows it, else left as-is (so unknown kanji fall back to surface comparison).
export function toReadingForm(s: string, readingOf?: ReadingResolver): string {
  const norm = katakanaToHiragana(normalizeJapanese(s));
  if (!readingOf) return norm;
  let out = '';
  let run = '';
  const flush = () => {
    if (!run) return;
    const r = readingOf(run);
    out += r != null ? katakanaToHiragana(r) : run;
    run = '';
  };
  for (const ch of norm) {
    if (isKanji(ch)) { run += ch; }
    else { flush(); out += ch; }
  }
  flush();
  return out;
}

// character-bigram Dice coefficient — cheap, order-tolerant fuzzy similarity.
function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}
function editRatio(a: string, b: string): number {
  const d = levenshtein(a, b);
  const m = Math.max(a.length, b.length) || 1;
  return 1 - d / m;
}

/**
 * Locate `phrase` in `lines` and propose corrections.
 *
 * Span location slides a character window (sized to the phrase) across the
 * concatenated transcript and scores it in surface space; correction detection
 * then aligns the note against the winning span in reading space.
 */
export function match(
  phrase: string,
  lines: MatcherLine[],
  readingOf?: ReadingResolver,
  opts: { topK?: number; contextLines?: number } = {},
): MatchResult {
  const topK = opts.topK ?? 3;
  const ctxN = opts.contextLines ?? 2;
  const noteNorm = normalizeJapanese(phrase).replace(/\s+/g, '');
  const noteR = toReadingForm(phrase, readingOf);

  // concatenate transcript, remembering which line each char came from
  let concat = '';
  const charLine: number[] = [];
  const lineNorm: string[] = lines.map((l) => normalizeJapanese(l.text).replace(/\s+/g, ''));
  for (let i = 0; i < lines.length; i++) {
    for (const ch of lineNorm[i]) { concat += ch; charLine.push(i); }
  }
  if (!concat.length || !noteNorm.length) {
    return { best: null, alternatives: [], contextBefore: [], contextAfter: [], corrections: [], confidence: 0 };
  }

  // Slide a window ~ note length (±40%) and score by surface similarity.
  // PERF (real transcripts are 100k+ normalized chars): the note's bigram map is
  // built ONCE; each start position grows its window incrementally (one bigram
  // per char) instead of rebuilding maps per length; the expensive edit-ratio
  // runs only when the cheap Dice score says the window is a live candidate.
  const W = noteNorm.length;
  const minW = Math.max(2, Math.floor(W * 0.7));
  const maxW = Math.min(concat.length, Math.ceil(W * 1.5));
  const step = Math.max(1, Math.floor(W / 6));
  const lenStep = Math.max(1, Math.floor(W / 6));
  const noteBi = bigrams(noteNorm);
  const noteBiTotal = Math.max(1, W - 1);
  // Below this Dice score, skip the edit-ratio refinement. 0.30, deliberately
  // permissive: when BOTH sides carry independent errors (user's shorthand vs
  // the captions' ASR garble, e.g. ことさら喜んで vs こさ喜んで) the shared
  // bigrams collapse while the edit ratio stays high — a tighter gate silently
  // loses exactly the matches this pipeline exists to make.
  const DICE_GATE = 0.30;
  type Cand = { start: number; end: number; score: number; text: string };
  const cands: Cand[] = [];
  for (let start = 0; start <= concat.length - minW; start += step) {
    const upto = Math.min(maxW, concat.length - start);
    // incremental bigram intersection over the growing window
    const winCount = new Map<string, number>();
    let inter = 0;
    const addBigramAt = (i: number) => {
      const g = concat.slice(i, i + 2);
      const c = (winCount.get(g) ?? 0) + 1;
      winCount.set(g, c);
      const cn = noteBi.get(g);
      if (cn !== undefined && c <= cn) inter++;
    };
    for (let i = start; i < start + minW - 1; i++) addBigramAt(i);
    const lens: number[] = [minW];
    const dices: number[] = [W < 2 ? (concat.slice(start, start + minW) === noteNorm ? 1 : 0)
      : (2 * inter) / ((minW - 1) + noteBiTotal)];
    let len = minW;
    while (len + lenStep <= upto) {
      const next = len + lenStep;
      for (let i = start + len - 1; i < start + next - 1; i++) addBigramAt(i);
      len = next;
      lens.push(len);
      dices.push((2 * inter) / ((len - 1) + noteBiTotal));
    }
    let bestLen = lens[0], bestScore = dices[0];
    for (let k = 1; k < lens.length; k++) if (dices[k] > bestScore) { bestScore = dices[k]; bestLen = lens[k]; }
    if (bestScore >= DICE_GATE) {
      // Live region: refine with the edit ratio at EVERY plausible length —
      // Dice alone would truncate a window right before a substituted char
      // (homophone tails like 効く→聞く), losing the correction downstream.
      for (let k = 0; k < lens.length; k++) {
        if (dices[k] < DICE_GATE - 0.15) continue;
        const s = Math.max(dices[k], editRatio(concat.slice(start, start + lens[k]), noteNorm));
        if (s > bestScore) { bestScore = s; bestLen = lens[k]; }
      }
    }
    cands.push({ start, end: start + bestLen, score: bestScore, text: concat.slice(start, start + bestLen) });
  }
  cands.sort((a, b) => b.score - a.score);

  // de-overlap: keep top spans that don't overlap already-kept ones
  const kept: Cand[] = [];
  for (const c of cands) {
    if (kept.some((k) => c.start < k.end && c.end > k.start)) continue;
    kept.push(c);
    if (kept.length >= topK) break;
  }
  if (!kept.length) return { best: null, alternatives: [], contextBefore: [], contextAfter: [], corrections: [], confidence: 0 };

  const toSpan = (c: Cand): MatchSpan => {
    const startLine = charLine[c.start];
    const endLine = charLine[Math.min(c.end - 1, charLine.length - 1)];
    return { startLine, endLine, tStartSec: lines[startLine]?.tStartSec, text: c.text, score: c.score };
  };
  const best = toSpan(kept[0]);
  const alternatives = kept.slice(1).map(toSpan);

  // corrections: align note vs the winning span, in reading space
  const corrections = diffCorrections(phrase, best.text, readingOf);

  // context ±N transcript lines
  const contextBefore = lines.slice(Math.max(0, best.startLine - ctxN), best.startLine).map((l) => l.text);
  const contextAfter = lines.slice(best.endLine + 1, best.endLine + 1 + ctxN).map((l) => l.text);

  // confidence: span score, penalised if a low-confidence homophone correction remains
  const homoPenalty = corrections.some((c) => c.kind !== 'homophone') ? 0.15 : 0;
  const confidence = Math.max(0, Math.min(1, best.score - homoPenalty));

  return { best, alternatives, contextBefore, contextAfter, corrections, confidence };
}

/**
 * GAPPED pattern matching — the handwriting habit this pipeline serves writes
 * correlative patterns as connected fragments (`んだったら〜なきゃ`,
 * `が違えば　と思う一方で`): the parts appear NEAR each other in the
 * transcript with the speaker's own words in the gap. Each part is located
 * independently (top candidates kept), then the combination is chosen that
 * puts the parts IN ORDER within a bounded gap — the parts disambiguate each
 * other, so a fragment that is hopelessly generic alone (なきゃ) becomes a
 * confident match when pinned by its partner.
 */
export function matchGapped(
  parts: string[],
  lines: MatcherLine[],
  readingOf?: ReadingResolver,
  opts: { maxGapLines?: number; maxGapSec?: number; contextLines?: number } = {},
): MatchResult {
  const maxGapLines = opts.maxGapLines ?? 8;
  const maxGapSec = opts.maxGapSec ?? 40;
  const ctxN = opts.contextLines ?? 2;
  const empty: MatchResult = { best: null, alternatives: [], contextBefore: [], contextAfter: [], corrections: [], confidence: 0 };
  if (parts.length < 2) return empty;

  const weights = parts.map((p) => Math.max(1, normalizeJapanese(p).replace(/\s+/g, '').length));
  const wTotal = weights.reduce((a, b) => a + b, 0);

  // Wide candidate list for the FIRST part (generic fragments recur dozens of
  // times — the right occurrence is rarely in a short top-K)…
  const r0 = match(parts[0], lines, readingOf, { topK: 32, contextLines: 0 });
  if (!r0.best) return empty;
  const starts = [r0.best, ...r0.alternatives];

  // …then every LATER part is searched LOCALLY in the bounded window after the
  // chain so far — co-occurrence, not global rank, decides.
  let bestChain: MatchSpan[] | null = null;
  let bestScore = -1;
  for (const a of starts) {
    const chain: MatchSpan[] = [a];
    let acc = a.score * weights[0];
    let ok = true;
    for (let i = 1; i < parts.length; i++) {
      const prev = chain[chain.length - 1];
      const from = prev.endLine;
      let to = Math.min(lines.length - 1, from + maxGapLines);
      const t0 = lines[from]?.tStartSec;
      if (t0 != null) {
        while (to > from && lines[to]?.tStartSec != null && (lines[to].tStartSec as number) - t0 > maxGapSec) to--;
      }
      const slice = lines.slice(from, to + 1);
      const local = match(parts[i], slice, readingOf, { topK: 1, contextLines: 0 });
      if (!local.best) { ok = false; break; }
      chain.push({ ...local.best, startLine: local.best.startLine + from, endLine: local.best.endLine + from,
        tStartSec: lines[local.best.startLine + from]?.tStartSec });
      acc += local.best.score * weights[i];
    }
    if (ok && acc > bestScore) { bestScore = acc; bestChain = chain; }
  }
  if (!bestChain) return empty;
  const chain = bestChain as MatchSpan[];

  const first = chain[0], last = chain[chain.length - 1];
  const best: MatchSpan = {
    startLine: first.startLine,
    endLine: last.endLine,
    tStartSec: first.tStartSec,
    text: chain.map((c) => c.text).join('〜'),
    score: bestScore / wTotal,
  };
  const corrections: Correction[] = [];
  for (let i = 0; i < parts.length; i++) corrections.push(...diffCorrections(parts[i], chain[i].text, readingOf));
  const contextBefore = lines.slice(Math.max(0, best.startLine - ctxN), best.startLine).map((l) => l.text);
  const contextAfter = lines.slice(best.endLine + 1, best.endLine + 1 + ctxN).map((l) => l.text);
  const homoPenalty = corrections.some((c) => c.kind !== 'homophone') ? 0.15 : 0;
  const confidence = Math.max(0, Math.min(1, best.score - homoPenalty));
  return { best, alternatives: [], contextBefore, contextAfter, corrections, confidence };
}

/**
 * Align note vs transcript span and emit corrections. Substitutions whose two
 * sides share a reading are `homophone` (high confidence, same intended word);
 * kanji↔kanji substitutions with unknown/different readings are `kanji-swap`;
 * everything else is a generic `edit`.
 */
export function diffCorrections(note: string, span: string, readingOf?: ReadingResolver): Correction[] {
  const a = normalizeJapanese(note).replace(/\s+/g, '');
  const b = normalizeJapanese(span).replace(/\s+/g, '');
  const ops = backtrace(a, b);   // merged ops INCLUDING matches, in order
  const corrections: Correction[] = [];
  const leadingKana = (s: string) => { let k = ''; for (const ch of s) { if (isKanji(ch)) break; k += ch; } return k; };
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.kind !== 'sub') continue;
    const nText = op.a, tText = op.b;
    // Extend each side with the trailing okurigana (leading kana of the next
    // matched run) so the reading resolver sees a WORD (効+く), not a bare kanji.
    const next = ops[i + 1];
    const oku = next && next.kind === 'match' ? leadingKana(next.a) : '';
    const nWord = nText + oku, tWord = tText + oku;
    const nR = readingWord(nWord, readingOf);
    const tR = readingWord(tWord, readingOf);
    if (nR && tR && nR === tR) {
      corrections.push({ noteText: nWord, transcriptText: tWord, kind: 'homophone', confidence: 0.9,
        reason: `same reading 「${nR}」 — homophone/kanji-choice error` });
    } else if ([...nText].some(isKanji) && [...tText].some(isKanji)) {
      corrections.push({ noteText: nText, transcriptText: tText, kind: 'kanji-swap', confidence: 0.5,
        reason: readingOf ? `readings 「${nR ?? '?'}」≠「${tR ?? '?'}」 — needs review` : 'kanji differ; no reading source — needs review' });
    } else {
      corrections.push({ noteText: nText, transcriptText: tText, kind: 'edit', confidence: 0.4, reason: 'surface differs' });
    }
  }
  return corrections;
}

/** Reading of a whole word-unit: resolver first (word-level), else kana passthrough. */
function readingWord(word: string, readingOf?: ReadingResolver): string | null {
  if (readingOf) { const r = readingOf(word); if (r != null) return katakanaToHiragana(normalizeJapanese(r)); }
  const kanaOnly = katakanaToHiragana(normalizeJapanese(word));
  return [...kanaOnly].some(isKanji) ? null : kanaOnly;  // unknown kanji → null (can't judge)
}

// Levenshtein backtrace grouping adjacent substitutions/indels into runs.
type DiffOp = { kind: 'match' | 'sub' | 'ins' | 'del'; a: string; b: string };
function backtrace(a: string, b: string): DiffOp[] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
  // walk back
  const raw: DiffOp[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) { raw.push({ kind: 'match', a: a[i - 1], b: b[j - 1] }); i--; j--; }
    else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) { raw.push({ kind: 'sub', a: a[i - 1], b: b[j - 1] }); i--; j--; }
    else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) { raw.push({ kind: 'del', a: a[i - 1], b: '' }); i--; }
    else { raw.push({ kind: 'ins', a: '', b: b[j - 1] }); j--; }
  }
  raw.reverse();
  // merge adjacent same-kind ops into runs (matches too, so diffCorrections can
  // read okurigana off the following matched run).
  const merged: DiffOp[] = [];
  for (const op of raw) {
    const last = merged[merged.length - 1];
    if (last && last.kind === op.kind) { last.a += op.a; last.b += op.b; }
    else merged.push({ ...op });
  }
  return merged;
}
