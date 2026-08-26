/**
 * capture-bundle.ts — CanvasMarks → the layered bundle → catalog records.
 *
 * The seam this closes: the canvas already speaks the carve vocabulary
 * (tap=部品, drag=範囲, strike=スロット, ◯=レンマ) but `deriveFromMarks`
 * flattens it to ONE winning reading — exactly the model the 2026-08-14
 * worked examples broke. This module reads the SAME marks as a lattice:
 *
 *   strike runs   → slot carves        (holes in the frame)
 *   span          → range carve        (a said-whole chunk; strikes inside it
 *                                       are ITS holes, not a second frame's)
 *   glue tokens   → glue carves        (になる — frame-fixed, core-absent)
 *   pivots        → axis carves        (こんな⇄そんな⇄あんな)
 *   links / parts → pole links         (骨格; multi-token poles via `links`,
 *                                       tap-tap `parts` chain as the fallback)
 *   ◯ + halo      → withLemma          (修辞連語 stays the hand's call)
 *
 * …then `bundleRecords` turns every derived layer into a catalog record in
 * the store's own conventions (○○ slots in `payload.frame`, `payload.parts`
 * for links, lemma/halo for 🟢), stamped with a shared `bundleId` and the
 * edges once, on the L0 record. One sighting, many layers, one attestation
 * each — the sweep gets the whole key fan.
 *
 * PURE — no Obsidian, no store, no I/O. Golden: golden/capture-bundle.mjs.
 */

import type { CanvasToken, CanvasMarks } from './token-canvas.ts';
import type { Bundle, CarveMark, LinkMark } from './analysis-bundle.ts';
import { deriveBundle, withLemma } from './analysis-bundle.ts';
import type { NoteClass } from './note-types.ts';
import { SLOT_ANY } from '../dictionary/frames.ts';
import { notationCrossesSentence, NOTATION_CROSS_MARK_RE } from './pipeline.ts';

/** Contiguous runs over a sorted list of token indexes. */
const runsOf = (idxs: number[]): Array<[number, number]> => {
  const s = [...idxs].sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  for (const i of s) {
    const last = out[out.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else out.push([i, i]);
  }
  return out;
};

const charSpan = (tokens: CanvasToken[], from: number, to: number): [number, number] | null => {
  const a = tokens[from];
  const b = tokens[to];
  return a && b ? [a.start, b.end] : null;
};

/** CanvasMarks (token indexes) → analysis-bundle carves (char offsets). */
export function toCarves(
  tokens: CanvasToken[],
  marks: CanvasMarks,
): { carves: CarveMark[]; links: LinkMark[] } {
  const carves: CarveMark[] = [];
  const links: LinkMark[] = [];

  if (marks.span) {
    const s = charSpan(tokens, marks.span[0], marks.span[1]);
    if (s) carves.push({ kind: 'range', start: s[0], end: s[1] });
  }
  for (const [f, t] of runsOf(marks.struck)) {
    const s = charSpan(tokens, f, t);
    if (s) carves.push({ kind: 'slot', start: s[0], end: s[1] });
  }
  for (const [f, t] of runsOf(marks.glue ?? [])) {
    const s = charSpan(tokens, f, t);
    if (s) carves.push({ kind: 'glue', start: s[0], end: s[1] });
  }
  for (const p of marks.pivots ?? []) {
    const s = charSpan(tokens, p.index, p.index);
    if (s) carves.push({ kind: 'axis', start: s[0], end: s[1], ...(p.mates?.length ? { mates: p.mates } : {}) });
  }

  if (marks.links?.length) {
    for (const l of marks.links) {
      const a = charSpan(tokens, l.a[0], l.a[1]);
      const b = charSpan(tokens, l.b[0], l.b[1]);
      if (a && b) links.push({ a, b });
    }
  } else if (marks.parts.length >= 2) {
    // tap-tap fallback: the picked bones chain pairwise (A〜B, B〜C)
    const sorted = [...marks.parts].sort((a, b) => a - b);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = charSpan(tokens, sorted[i], sorted[i]);
      const b = charSpan(tokens, sorted[i + 1], sorted[i + 1]);
      if (a && b) links.push({ a, b });
    }
  }

  return { carves, links };
}

/** The whole road: marks on the canvas → the derived bundle (◯ included). */
export function bundleFromCanvas(text: string, tokens: CanvasToken[], marks: CanvasMarks): Bundle {
  const { carves, links } = toCarves(tokens, marks);
  let b = deriveBundle(text, carves, links);
  if (marks.circled != null && tokens[marks.circled]) {
    const [hf, ht] = marks.halo ?? [marks.circled, marks.circled];
    const halo = charSpan(tokens, hf, ht);
    const pivot = charSpan(tokens, marks.circled, marks.circled);
    if (pivot) {
      const haloText = halo && (halo[0] !== pivot[0] || halo[1] !== pivot[1])
        ? text.slice(halo[0], halo[1])
        : undefined;
      b = withLemma(b, pivot, haloText);
    }
  }
  return b;
}

export interface BundleRecord {
  note: string;
  cls: NoteClass;
  payload: {
    parts?: string[];
    /** the link's notation crossed a 。 — recorded, so matchLink may cross it too */
    crossSentence?: boolean;
    frame?: string;
    lemma?: string;
    halo?: string;
    bundleId?: string;
    /** rides L0 only — see CaptureModal.saveBundle for why it goes no further */
    gloss?: string;
    bundleEdges?: Array<{ from: number; to: number; kind: string; at?: [number, number]; surfaces?: string[] }>;
    slotTypes?: string[];
    glueParts?: string[];
  };
}

const fnv = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
};

/** Store convention: slots render as ○○ in payload.frame; 〔type〕 never rides. */
const toStoreFrame = (notation: string): string =>
  notation.replace(/〔[^〕]*〕/g, '').split(SLOT_ANY).join('○○');

/**
 * Bundle → catalog records, one per layer, in existing store conventions.
 * The FIRST record (L0, the whole thought) carries the edges; every record
 * carries the shared bundleId. Keys derive downstream exactly as today —
 * parts join for links, frame for 💠 — so the flat consumers see nothing new.
 */
export function bundleRecords(bundle: Bundle, opts: { gloss?: string } = {}): BundleRecord[] {
  const bundleId = `b_${fnv(bundle.text)}`;
  return bundle.layers.map((l, i) => {
    const payload: BundleRecord['payload'] = { bundleId };
    if (i === 0 && bundle.edges.length) payload.bundleEdges = bundle.edges.map((e) => ({ ...e }));
    // The gloss the hand typed describes THE THOUGHT it was looking at — the
    // whole span — so it rides L0 and goes no further. A derived core
    // (〜予定ではなかった) does not mean what the whole utterance meant, and
    // copying one gloss onto every cut would assert something the hand never
    // said. Before this, ⿻全層保存 wrote no gloss at all, which multiplied
    // PRINCIPLE-2026-08-05's "gloss empty on all 305" by the layer count.
    // Empty beats wrong; L0 beats empty.
    if (i === 0 && opts.gloss) payload.gloss = opts.gloss;
    switch (l.role) {
      case 'frame':
      case 'core':
      case 'chunk':
        payload.frame = toStoreFrame(l.notation);
        if (l.slotTypes?.some(Boolean)) payload.slotTypes = l.slotTypes;
        if (l.glue?.length) payload.glueParts = l.glue;
        break;
      case 'link':
        // the boundary mark is stripped from the part material but RECORDED:
        // it is the one fact the notation exists to carry, and matchLink
        // needs it to allow exactly this link across a sentence ender. ONE
        // predicate decides (pipeline.notationCrossesSentence — same gate the
        // save path uses), and the strip is global + both paren widths, so a
        // second mark can never survive as unmatchable part material.
        if (notationCrossesSentence(l.notation)) payload.crossSentence = true;
        payload.parts = l.notation.replace(NOTATION_CROSS_MARK_RE, '').split(SLOT_ANY).filter(Boolean);
        break;
      case 'lemma':
        payload.lemma = l.notation;
        if (l.halo) payload.halo = l.halo;
        break;
      // 'whole': the surface IS the payload
    }
    return { note: l.notation, cls: l.cls, payload };
  });
}
