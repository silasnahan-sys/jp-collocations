/**
 * generic-yomitan.ts — the adapter for EVERY dictionary that is not 英辞郎
 * (DESIGN §27.4's registry + generic fallback).
 *
 * Two things make this necessary rather than a nicety, both found by opening
 * the user's actual export rather than trusting the plan:
 *
 *  1. **Format.** 英辞郎's converter emitted glossary content as HTML STRINGS,
 *     which is why `eijiro.ts` can parse with a closed set of class names.
 *     Jitendex — and Yomitan's own format spec — use the structured-content
 *     NODE TREE (`{tag, content, data}`). Pointing the Eijiro adapter at
 *     jitendex parses exactly nothing. This walks the tree.
 *
 *  2. **Direction.** 英辞郎 is EN→JA: the English headword is the intention you
 *     search by, the Japanese gloss is what you reach for. Jitendex is JA→EN —
 *     the mirror. A production lexicon has to keep the JAPANESE on the
 *     `surface` side in both cases, or half the corpus indexes backwards.
 *     `index.json`'s sourceLanguage/targetLanguage decides; there is no
 *     guessing from content.
 *
 * PURE. Golden: golden/generic-yomitan.mjs.
 */

import type { NoteClass } from '../notes/note-types.ts';
import { toFrame, classHintForFrame } from './frames.ts';
import type { DictHeadword, DictSense, ReachCandidate, EijiroTuple } from './eijiro.ts';

/** Which side of the pair is Japanese. */
export type Direction = 'ja->en' | 'en->ja';

export function directionOf(index: { sourceLanguage?: string; targetLanguage?: string } | null): Direction {
  // Absent metadata is common in hand-rolled dictionaries; JA→EN is the
  // overwhelming default for a Japanese learner's Yomitan install.
  const src = (index?.sourceLanguage ?? 'ja').toLowerCase();
  return src.startsWith('en') ? 'en->ja' : 'ja->en';
}

type Node = string | Node[] | {
  tag?: string;
  content?: Node;
  data?: Record<string, string>;
  [k: string]: unknown;
};

/** Flatten a structured-content tree (or plain string) to readable text. */
export function flattenContent(node: unknown, sep = ''): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n) => flattenContent(n, sep)).filter(Boolean).join(sep);
  const o = node as { tag?: string; content?: unknown; text?: string };
  if (typeof o.text === 'string') return o.text;
  // block-ish tags read better with a separator so senses do not run together
  const blocky = o.tag === 'div' || o.tag === 'li' || o.tag === 'br' || o.tag === 'ul' || o.tag === 'ol';
  return flattenContent(o.content, blocky ? ' ' : sep).trim();
}

/** Collect the text of every node whose data.content matches `kind`. */
export function pickByDataContent(node: unknown, kind: string, out: string[] = []): string[] {
  if (node == null) return out;
  if (Array.isArray(node)) { for (const n of node) pickByDataContent(n, kind, out); return out; }
  if (typeof node !== 'object') return out;
  const o = node as { data?: Record<string, string>; content?: unknown };
  if (o.data?.content === kind) {
    const t = flattenContent(o.content, ' ').trim();
    if (t) out.push(t);
    return out;                       // do not descend into a matched block
  }
  pickByDataContent(o.content, kind, out);
  return out;
}

/**
 * Adapt one tuple from any Yomitan dictionary.
 *
 * Senses come from `glossary` entries; a `structured-content` value is walked,
 * a plain string is taken as-is, and a deinflection tuple is skipped (it is
 * grammar plumbing, never a definition).
 */
export function adaptGenericEntry(
  tuple: EijiroTuple,
  opts: { direction?: Direction; evocativeHead?: (s: string) => boolean } = {},
): DictHeadword {
  const [expression, reading, defTags, rules, , glossary, sequence] = tuple;
  const dir = opts.direction ?? 'ja->en';

  const senses: DictSense[] = [];
  for (const g of glossary ?? []) {
    if (typeof g === 'string') {
      if (g.trim()) senses.push({ gloss: g.trim() });
      continue;
    }
    if (Array.isArray(g)) continue;                       // deinflection tuple
    const o = g as { type?: string; text?: string; content?: unknown };
    if (o.type === 'text' && o.text?.trim()) { senses.push({ gloss: o.text.trim() }); continue; }
    if (o.type !== 'structured-content') continue;
    // Prefer the marked glossary blocks; fall back to the whole tree.
    const parts = pickByDataContent(o.content, 'glossary');
    const notes = pickByDataContent(o.content, 'extra-info');
    const texts = parts.length ? parts : [flattenContent(o.content, ' ')];
    for (const t of texts) {
      const gloss = t.trim();
      if (!gloss) continue;
      senses.push({ gloss, ...(notes.length ? { note: notes.join(' ') } : {}) });
    }
  }

  const posTags = String(defTags ?? '').split(/\s+/).filter(Boolean);
  const evocative = opts.evocativeHead?.(expression) ?? false;

  const reachFor: ReachCandidate[] = [];
  for (const s of senses) {
    // The JAPANESE side is always `surface` — that is the production unit the
    // six classes describe, whichever way the dictionary is pointed.
    const surface = dir === 'ja->en' ? expression : s.gloss;
    const intention = dir === 'ja->en' ? s.gloss : expression;
    if (!surface || !intention) continue;
    const frame = toFrame(surface);
    // Same bar as the Eijiro adapter: an expression earns a place, a bare
    // single-word look-up does not.
    const isExpression = /[\s・…]/.test(surface.trim()) || surface.trim().length >= 4;
    if (frame.fixed && !evocative && !isExpression) continue;
    reachFor.push({
      intention, surface,
      frameKey: frame.key,
      intentionKey: toFrame(intention).key,
      slots: frame.slots.length,
      classHint: classHintForFrame(frame, { evocativeHead: evocative }) as NoteClass,
    });
  }

  return {
    expression,
    ...(reading ? { reading } : {}),
    pos: posTags,
    ...(rules === '人名' ? { kind: 'name' as const } : {}),
    senses, reachFor, xrefs: [], sequence,
  };
}

export function adaptGenericBank(
  bank: EijiroTuple[],
  opts: { direction?: Direction; evocativeHead?: (s: string) => boolean } = {},
): DictHeadword[] {
  const out: DictHeadword[] = [];
  for (const t of bank) {
    if (!Array.isArray(t) || !t[5]?.length) continue;
    out.push(adaptGenericEntry(t, opts));
  }
  return out;
}

/**
 * §27.4's registry. 英辞郎 gets its bespoke adapter because its HTML carries
 * production structure (frames, 〔situations〕) that the generic walker would
 * flatten into prose. Everything else gets the generic one — which is a real
 * fallback, not a stub: it produces the same DictHeadword/ReachCandidate shape
 * and lands in the same frame key space.
 */
export function isEijiro(title: string): boolean {
  return /英辞郎|eijiro/i.test(String(title ?? ''));
}
