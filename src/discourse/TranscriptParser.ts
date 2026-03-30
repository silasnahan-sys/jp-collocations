// ============================================================
// TranscriptParser — parse ||‑annotated JP YouTube transcripts
// into TranscriptChunk[] / ParsedTranscript structures.
//
// Input format:
//   [08:15] 1本読んだ||ような感じ||。 なるほど。||そこに||...
//   [08:20] ||あ||、おかしくない。...
//
// Rules:
//   • Lines starting with [MM:SS] are timestamped chunks.
//   • `||` marks discourse-bit boundaries.
//   • Text between two `||` markers is a discourse bit.
//   • Text before the first `||` on a line is also a bit.
//   • `==` at the end of a segment is a fade/trail-off marker.
//   • Empty bits (after trimming) are discarded.
// ============================================================

import type {
  DiscourseBit,
  TranscriptChunk,
  ParsedTranscript,
} from "./discourse-types.ts";

const TIMESTAMP_RE = /^\[(\d{1,2}:\d{2})\]\s*/;
const FADE_MARKER = "==";
const BIT_SEP = "||";

let _bitCounter = 0;

function nextBitId(): string {
  return `bit_${++_bitCounter}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Infer a coarse bit type from surface text. */
function inferBitType(text: string): string {
  const t = text.trim();

  // Single-token pivots
  if (/^[あええっうん、。！？]$/.test(t)) return "pivot";

  // Fade / trail-off
  if (t === FADE_MARKER || /^[。…==]+$/.test(t)) return "boundary";

  // Hedge markers
  if (/ような感じ|みたいな|らしい|っぽい/.test(t)) return "hedge";

  // Connectors / fillers
  if (/^(ま[あ]?[、。]?|だから|それで|なので|そして|でも|ただ|ところで)/.test(t)) return "connector";
  if (/ま、だから|それで言うと/.test(t)) return "connector";

  // Perspective framing 的には
  if (/的には?$/.test(t)) return "deictic";

  // Modal / stance caps — must come before the generic concessive check
  // because わけだけど ends in けど
  if (/わけだけど|わけで|わけだ|ということで|ということだ/.test(t)) return "modal_cap";

  // Causal endings
  if (/から$|ので$|ため$/.test(t)) return "causal";

  // Concessive endings
  if (/けど$|が$|でも$|ても$|でても$/.test(t)) return "concessive";

  // たり enumeration
  if (/たり/.test(t)) return "enumeration";
  if (/のかもしれない|かもしれない|だろう|でしょう/.test(t)) return "speculation";

  // Fuzzy reference
  if (/っぽい|とか|その辺|あたり|など/.test(t)) return "fuzzy_ref";

  // Assertion-deflation tail
  if (/んじゃない/.test(t)) return "hedge";

  // Epistemic speculation
  if (/きっと|たぶん|おそらく/.test(t)) return "speculation";

  return "generic";
}

/** Extract rough morpheme tokens from a JP text string (whitespace + surface split). */
function extractMorphemes(text: string): string[] {
  // Very lightweight: split on common particles/auxiliaries and whitespace.
  // A production system would call a MeCab/kuromoji API here.
  return text
    .replace(/([はがをにへでもとやからまで])/g, " $1 ")
    .split(/\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Split a (possibly timestamped) line into raw text segments using `||`.
 * Returns an array of { text, globalOffset } objects in source order.
 */
function splitIntoBitTexts(
  rawLine: string,
  lineStartOffset: number
): Array<{ text: string; startOffset: number; endOffset: number }> {
  const results: Array<{ text: string; startOffset: number; endOffset: number }> = [];
  const parts = rawLine.split(BIT_SEP);

  let cursor = lineStartOffset;
  for (const part of parts) {
    const start = cursor;
    const end = cursor + part.length;
    cursor = end + BIT_SEP.length; // account for the separator itself
    if (part.trim().length > 0) {
      results.push({ text: part.trim(), startOffset: start, endOffset: end });
    }
  }
  return results;
}

/**
 * Parse a single transcript line into a TranscriptChunk.
 * @param line   Raw source line (may start with [MM:SS])
 * @param lineIndex  Zero-based line index
 * @param globalOffset  Character offset from the start of the full text
 * @param chunkIndex  Zero-based chunk index across entire transcript
 */
function parseLine(
  line: string,
  lineIndex: number,
  globalOffset: number,
  chunkIndex: number
): TranscriptChunk {
  let remaining = line;
  let timestamp: string | undefined;

  const tsMatch = TIMESTAMP_RE.exec(remaining);
  if (tsMatch) {
    timestamp = tsMatch[1];
    remaining = remaining.slice(tsMatch[0].length);
  }

  const offsetBase = globalOffset + (tsMatch ? tsMatch[0].length : 0);
  const segments = splitIntoBitTexts(remaining, offsetBase);

  const bits: DiscourseBit[] = segments.map((seg, i) => {
    const text = seg.text;
    const isFade = text === FADE_MARKER || text.endsWith(FADE_MARKER);
    const bitType = isFade ? "boundary" : inferBitType(text);

    const bit: DiscourseBit = {
      id: nextBitId(),
      text,
      startOffset: seg.startOffset,
      endOffset: seg.endOffset,
      timestamp,
      bitType,
      morphemes: extractMorphemes(text),
      features: {
        isFade,
        position: i,
        lineIndex,
        hasTimestamp: timestamp !== undefined,
      },
      chunkIndex,
      lineIndex,
    };
    return bit;
  });

  return {
    timestamp,
    rawText: line,
    bits,
    lineIndex,
  };
}

// ---- Public API ----------------------------------------------------------

/**
 * Parse a full `||`-annotated transcript string into a ParsedTranscript.
 *
 * @param text  Raw annotated transcript text (may span multiple lines).
 */
export function parseTranscript(text: string): ParsedTranscript {
  // Reset counter for deterministic testing
  _bitCounter = 0;

  const lines = text.split("\n");
  const chunks: TranscriptChunk[] = [];
  const allBits: DiscourseBit[] = [];

  let globalOffset = 0;
  let chunkIndex = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (line.trim().length === 0) {
      globalOffset += line.length + 1; // +1 for \n
      continue;
    }

    const chunk = parseLine(line, lineIndex, globalOffset, chunkIndex);
    chunks.push(chunk);
    allBits.push(...chunk.bits);
    chunkIndex++;
    globalOffset += line.length + 1;
  }

  return { chunks, allBits, rawText: text };
}

/**
 * Parse a single annotated line (convenience wrapper).
 */
export function parseLine_public(line: string, lineIndex = 0): TranscriptChunk {
  _bitCounter = 0;
  return parseLine(line, lineIndex, 0, lineIndex);
}

/**
 * Return the raw text segments that sit between `||` markers.
 * Useful for quick inspection / testing.
 */
export function extractBitTexts(annotatedLine: string): string[] {
  // Remove optional [MM:SS] prefix
  const cleaned = annotatedLine.replace(TIMESTAMP_RE, "");
  return cleaned
    .split(BIT_SEP)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}
