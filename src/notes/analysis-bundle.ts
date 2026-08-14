/**
 * analysis-bundle.ts — one utterance, many cuts: the layered classification model.
 *
 * ## Why this exists (2026-08-14, from the user's own worked examples)
 *
 * The six classes are not bins a span gets filed into; they are CUTS AT
 * DIFFERENT DEPTHS of one gestalt, and a token can hold different citizenship
 * in each layer:
 *
 *   こんな人間になる予定ではなかった
 *     L0  セリフ      the whole THOUGHT (the 内言 test: 「…と思った」 attaches
 *                     without residue). Its productivity lives at the stance
 *                     level, above idiomaticity.
 *     L1  慣用構文    〔軸:こんな〕～〔思〕になる予定ではなかった — one region
 *                     opened. The slot is bounded SEMANTICALLY (what can be
 *                     the thought's content), not by POS.
 *     L1' 慣用構文    ～予定ではなかった — the core, with になる demoted to
 *                     GLUE: fixed material of L1, coupling material of L1'.
 *                     The glue-stripped key is what lets the core collide with
 *                     行く予定ではなかった in the sweep.
 *
 *   においては問題ないと考えている
 *     chunk 慣用構文  においては問題ない          (a range carved as said-whole)
 *     link  骨格構文  においては～と考えている     (the correlative)
 *     …and においては belongs to BOTH — a shared MEMBRANE. Any model that
 *     assigns each token to exactly one record cannot store this analysis.
 *
 * So a capture is a BUNDLE: the utterance, the derived layers, and typed edges
 * between them (derives / glue / axis / shares-token). Filing them as
 * independent rows loses the derivation, the membranes, and the glue — which
 * is precisely what the flat modal does today.
 *
 * ## Entailment, not assignment
 *
 * The class of a derived layer is mostly ENTAILED by which carves produced it:
 * nothing carved → セリフ (the whole thought; `DEFAULT_NOTE_CLASS` already
 * believes this); slots opened, frame held → 慣用構文; only a link held →
 * 骨格構文. What is NEVER entailed here is 修辞連語 — whether a lemma is
 * evocative (喚起) is the hand's judgement, so that layer exists only through
 * an explicit `withLemma` call (S3: the machine suggests shape, never felt
 * quality). Entailed classes are still suggestions downstream — the chips stay
 * editable; this module just makes the honest default cheap.
 *
 * ## One key space
 *
 * Every layer key passes through `normalizeFrame` — the same fold the
 * dictionary, the reach index and the catalog use (§28 S5, frames.ts: "one
 * frame key space or two products"). A skeletal link IS a frame whose middle
 * is one big slot, so A～B keys live in the same space too. `matchKeysOf`
 * therefore hands the sweep a FAN of keys per capture — full surface, slotted
 * frame, glue-stripped core, link (and its 。-crossing variant) — instead of
 * the single key the videos showed the user hand-typing compensations for.
 *
 * PURE — no Obsidian, no store, no I/O. Golden: golden/analysis-bundle.mjs
 * (fixtures are the user's own two examples, verbatim).
 */

import type { NoteClass } from './note-types.ts';
import { normalizeFrame, SLOT_ANY } from '../dictionary/frames.ts';

/** A carve on the utterance. Offsets are [start, end) into the raw text. */
export type CarveKind =
  | 'part'   // タップ — a component the hand singled out (lemma candidate)
  | 'range'  // ドラッグ — a sub-span carved as a said-whole chunk
  | 'slot'   // 長押しドラッグ — a region opened into a hole
  | 'axis'   // 2回タップ — a paradigm pivot (こんな⇄そんな⇄あんな)
  | 'glue';  // demoted material: fixed in the outer frame, coupling in the core

export interface CarveMark {
  kind: CarveKind;
  start: number;
  end: number;
  /**
   * `slot` only — the CONTENT-TYPE of the hole (思 = thought-content, 量, 人,
   * …, free text). Semantic, not syntactic: what bounds the slot in
   * こんな人間になる予定ではなかった is "can it be the content of the thought",
   * not "is it an NP". Never enters the match key — the same frame must
   * collide regardless of how its hole was typed.
   */
  contentType?: string;
  /** `axis` only — known paradigm mates (そんな, あんな), when the hand has them. */
  mates?: string[];
}

/** A link between two poles — the 骨格 carve. Marked by a stroke, not typed. */
export interface LinkMark {
  a: [number, number];
  b: [number, number];
}

export type LayerRole = 'whole' | 'frame' | 'core' | 'chunk' | 'link' | 'lemma';

export interface Layer {
  cls: NoteClass;
  role: LayerRole;
  /** display notation — may carry 〔思〕 content-types and axis annotations. */
  notation: string;
  /** THE key — `normalizeFrame` of the notation with display-only apparatus stripped. */
  key: string;
  /** every key this layer arms for the sweep (e.g. the link and its 。-variant). */
  keys: string[];
  /** slot content-types in order of appearance (display/UI apparatus). */
  slotTypes?: string[];
  /** axis pivots with their mates, when marked. */
  axes?: Array<{ text: string; mates?: string[] }>;
  /** glue surfaces stripped between frame and core. */
  glue?: string[];
  /** the source span this layer stands on ([0, text.length) for whole/frame/core). */
  span: [number, number];
}

export type EdgeKind = 'derives' | 'glue' | 'axis' | 'shares-token';

export interface Edge {
  /** indices into Bundle.layers. */
  from: number;
  to: number;
  kind: EdgeKind;
  /** for shares-token: the membrane's span in the raw text (においては). */
  at?: [number, number];
  /** for glue edges: the demoted surfaces. */
  surfaces?: string[];
}

export interface Bundle {
  text: string;
  layers: Layer[];
  edges: Edge[];
}

/* ────────────────────────────────────────────────────────────────────────── */

const overlap = (aS: number, aE: number, bS: number, bE: number): boolean =>
  Math.max(aS, bS) < Math.min(aE, bE);

const within = (inner: CarveMark | [number, number], oS: number, oE: number): boolean => {
  const [s, e] = Array.isArray(inner) ? inner : [inner.start, inner.end];
  return s >= oS && e <= oE;
};

const sortMarks = (ms: CarveMark[]): CarveMark[] => [...ms].sort((x, y) => x.start - y.start);

/**
 * Strip display-only apparatus from a notation before keying: content-type
 * labels 〔…〕 ride along for the eye, never for the collision.
 */
export const keyOf = (notation: string): string => normalizeFrame(notation.replace(/〔[^〕]*〕/g, ''));

/**
 * Rebuild a stretch of text with slot marks replaced by ～〔type〕 and glue
 * marks optionally removed. The workhorse for frame/core/chunk notations.
 */
function carveNotation(
  text: string,
  lo: number,
  hi: number,
  marks: CarveMark[],
  opts: { dropGlue?: boolean } = {},
): { notation: string; slotTypes: string[] } {
  const inRange = sortMarks(marks.filter((m) => within(m, lo, hi)));
  const slotTypes: string[] = [];
  let out = '';
  let at = lo;
  for (const m of inRange) {
    if (m.kind !== 'slot' && !(m.kind === 'glue' && opts.dropGlue)) continue;
    if (m.start < at) continue; // overlapping apparatus (an axis inside a slot) never re-emits text
    out += text.slice(at, m.start);
    if (m.kind === 'slot') {
      out += SLOT_ANY + (m.contentType ? `〔${m.contentType}〕` : '');
      slotTypes.push(m.contentType ?? '');
    }
    // glue with dropGlue: emit nothing — the coupling vanishes from the core.
    at = m.end;
  }
  out += text.slice(at, hi);
  return { notation: out, slotTypes };
}

const mk = (
  cls: NoteClass,
  role: LayerRole,
  notation: string,
  span: [number, number],
  extra: Partial<Layer> = {},
): Layer => {
  const key = keyOf(notation);
  return { cls, role, notation, key, keys: [key], span, ...extra };
};

/**
 * Derive the bundle from carves. Deterministic, total, and honest about what
 * it will NOT infer (修辞連語 — see `withLemma`).
 *
 *  - L0 セリフ always exists: every capture begins life as the whole thought.
 *  - top-level `slot` marks → a 慣用構文 frame layer over the full text
 *    (axes annotate it; they are fixed material with a paradigm, not holes).
 *  - `glue` marks → a further 慣用構文 CORE layer with the glue stripped,
 *    plus a glue edge frame→core. The core's key is the generalizing one.
 *  - each `range` mark → a 慣用構文 chunk layer over the sub-span (slots and
 *    glue inside the range are applied within it, same rules).
 *  - each link → a 骨格構文 layer A～B; if the gap between poles crosses a
 *    sentence boundary the 。-crossing key A(。)～B is ALSO armed (the user's
 *    own はず(。)〜まずは notation, generated instead of typed).
 *  - membranes: any link pole that overlaps a chunk's span yields a
 *    shares-token edge carrying the overlap (においては, dual citizenship).
 */
export function deriveBundle(text: string, marks: CarveMark[] = [], links: LinkMark[] = []): Bundle {
  const layers: Layer[] = [];
  const edges: Edge[] = [];
  const whole: [number, number] = [0, text.length];

  // L0 — the thought, solid.
  layers.push(mk('serifu', 'whole', text, whole));
  const l0 = 0;

  const top = marks.filter((m) => m.kind !== 'range');
  const axes = marks
    .filter((m) => m.kind === 'axis')
    .map((m) => ({ text: text.slice(m.start, m.end), mates: m.mates }));
  const glueSurfaces = marks.filter((m) => m.kind === 'glue').map((m) => text.slice(m.start, m.end));

  // Frame layer — slots opened, frame held.
  let frameIdx = -1;
  if (top.some((m) => m.kind === 'slot')) {
    const { notation, slotTypes } = carveNotation(text, 0, text.length, top);
    frameIdx = layers.push(mk('phrase_schema', 'frame', notation, whole, {
      slotTypes,
      axes: axes.length ? axes : undefined,
    })) - 1;
    edges.push({ from: l0, to: frameIdx, kind: 'derives' });
    for (const a of axes) edges.push({ from: frameIdx, to: frameIdx, kind: 'axis', surfaces: [a.text] });
  }

  // Core layer — glue demoted, the generalizing key.
  if (top.some((m) => m.kind === 'glue')) {
    const { notation, slotTypes } = carveNotation(text, 0, text.length, top, { dropGlue: true });
    const from = frameIdx >= 0 ? frameIdx : l0;
    const coreIdx = layers.push(mk('phrase_schema', 'core', notation, whole, {
      slotTypes: slotTypes.length ? slotTypes : undefined,
      glue: glueSurfaces,
    })) - 1;
    edges.push({ from, to: coreIdx, kind: 'glue', surfaces: glueSurfaces });
  }

  // Chunk layers — ranges carved as said-wholes, with their own inner carves.
  const chunkIdxs: number[] = [];
  for (const r of marks.filter((m) => m.kind === 'range')) {
    const inner = marks.filter((m) => m.kind !== 'range' && within(m, r.start, r.end));
    const { notation, slotTypes } = carveNotation(text, r.start, r.end, inner);
    const idx = layers.push(mk('phrase_schema', 'chunk', notation, [r.start, r.end], {
      slotTypes: slotTypes.length ? slotTypes : undefined,
    })) - 1;
    chunkIdxs.push(idx);
    edges.push({ from: l0, to: idx, kind: 'derives' });
  }

  // Link layers — the skeleton, with membranes to any chunk they touch.
  for (const ln of links) {
    const [aS, aE] = ln.a;
    const [bS, bE] = ln.b;
    const aText = text.slice(aS, aE);
    const bText = text.slice(bS, bE);
    const between = text.slice(Math.min(aE, bS), Math.max(aE, bS));
    const crosses = /[。．.!?！？]/.test(between);
    const plain = `${aText}${SLOT_ANY}${bText}`;
    const notation = crosses ? `${aText}(。)${SLOT_ANY}${bText}` : plain;
    const idx = layers.push(mk('skeletal', 'link', notation, [Math.min(aS, bS), Math.max(aE, bE)])) - 1;
    const l = layers[idx];
    const plainKey = keyOf(plain);
    if (!l.keys.includes(plainKey)) l.keys.push(plainKey); // the 。-crossing layer also arms the loose key
    edges.push({ from: l0, to: idx, kind: 'derives' });
    for (const cIdx of chunkIdxs) {
      const [cS, cE] = layers[cIdx].span;
      for (const [pS, pE] of [ln.a, ln.b] as Array<[number, number]>) {
        if (overlap(cS, cE, pS, pE)) {
          edges.push({
            from: cIdx, to: idx, kind: 'shares-token',
            at: [Math.max(cS, pS), Math.min(cE, pE)],
          });
        }
      }
    }
  }

  return { text, layers, edges };
}

/**
 * The one layer this module refuses to entail: 修辞連語. Whether a lemma is
 * evocative — holds an image of its own — is felt, not derived. The hand says
 * so; this just records it, linked to the whole it was heard in.
 */
export function withLemma(bundle: Bundle, span: [number, number], halo?: string): Bundle {
  const lemma = bundle.text.slice(span[0], span[1]);
  const layer = mk('rhet_collocation', 'lemma', lemma, span);
  if (halo) layer.keys.push(keyOf(halo));
  const layers = [...bundle.layers, layer];
  const edges = [...bundle.edges, { from: 0, to: layers.length - 1, kind: 'derives' as EdgeKind }];
  return { ...bundle, layers, edges };
}

/** The fan the sweep gets: every key of every layer, deduplicated, empty-safe. */
export function matchKeysOf(bundle: Bundle): string[] {
  const out: string[] = [];
  for (const l of bundle.layers) for (const k of l.keys) if (k && !out.includes(k)) out.push(k);
  return out;
}

/** Membrane report — which spans hold citizenship in more than one layer. */
export function membranesOf(bundle: Bundle): Array<{ span: [number, number]; text: string; layers: [number, number] }> {
  return bundle.edges
    .filter((e): e is Edge & { at: [number, number] } => e.kind === 'shares-token' && !!e.at)
    .map((e) => ({ span: e.at, text: bundle.text.slice(e.at[0], e.at[1]), layers: [e.from, e.to] }));
}
