/**
 * shape-index.ts — which books can answer the SECOND question, and with what.
 *
 * A headword has two askable questions. 「意味は」 every book answers; the
 * plugin's reason to exist is 「使い方は」 — and the nodes that answer it
 * (使い分け, 類語対比表, 文型 rows, attested examples) live in a handful of
 * specialist books that were historically the first ones cut (big-dict.ts,
 * 2026-08-01: 用例.jp・使い方の分かる類語例解辞典・現代国語例解辞典 were exactly
 * the books breadth-before-depth dropped, "on exactly the high-frequency words
 * where you most want a second opinion").
 *
 * entry-parts.ts already parses those books into a closed vocabulary of SHAPES
 * with the publisher's own labels kept verbatim. What was missing is the
 * ability to ASK about shapes without reading every entry: which books hold a
 * usage answer for this word, and what kind. That is this module — the pure
 * summarize/filter layer under the 用法ビュー and the 使い分け board:
 *
 *  - `summarize(nodes)`   → which shapes an entry contributes, with the
 *                           publisher's own titles as badges (類語対比表,
 *                           使い分け — never renamed into "our" wording).
 *  - `usageNodes(nodes)`  → the entry pruned to its usage-shaped subtrees,
 *                           sections kept only when something usage-shaped
 *                           survives inside them (§28 S6: an empty section is
 *                           an absence, not a frame to render).
 *  - `buildShapeIndex`    → the per-dictionary rollup a sidecar can persist,
 *                           so 「使い方は」 answers instantly instead of after
 *                           35 shard reads.
 *
 * The label collision this untangles, from the user's own report: 類語例解
 * titles its MEMBERS section 使い方 — so a flat renderer shows "使い方"
 * blocks stacked meaninglessly (worst on the headword 使い方 itself), while a
 * shape-typed renderer knows one is `members`, another is `distinctions`, and
 * renders each by its RELATION under the publisher's verbatim title.
 *
 * PURE — no Obsidian, no store, no I/O. Golden: golden/shape-index.mjs.
 */

import type { EntryNode, EntryShape } from './entry-parts.ts';

/** The shapes that answer 「使い方は」. Everything else answers 「意味は」. */
export const USAGE_SHAPES: readonly EntryShape[] = [
  'members',        // the 語群 — who shares this meaning
  'comparison',     // items × frames → judgement (類語対比表, 類語スケール)
  'distinctions',   // ordered contrastive prose (使い分け)
  'examples',       // example pairs, incl. 文型-patterned groups
  'attestations',   // attested corpus citations (用例.jp KWIC)
] as const;

export const isUsageShape = (s: EntryShape): boolean => (USAGE_SHAPES as readonly string[]).includes(s);

/** Every shape present in an entry, walking the whole tree once. */
export function shapesOf(nodes: readonly EntryNode[]): Set<EntryShape> {
  const out = new Set<EntryShape>();
  const walk = (n: EntryNode): void => {
    out.add(n.shape);
    n.children?.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

export interface ShapeBadge {
  shape: EntryShape;
  /** the publisher's OWN title, verbatim (類語対比表 / 使い分け / ▶例文…). */
  label: string;
}

export interface ShapeSummary {
  /** usage shapes present, in USAGE_SHAPES order (stable for rendering). */
  usage: EntryShape[];
  /** tappable badges — one per titled usage node, publisher's words only. */
  badges: ShapeBadge[];
  /** true iff this entry can answer 「使い方は」 at all. */
  second: boolean;
}

/** Summarize one entry's contribution to the second question. */
export function summarize(nodes: readonly EntryNode[]): ShapeSummary {
  const present = shapesOf(nodes);
  const usage = USAGE_SHAPES.filter((s) => present.has(s));
  const badges: ShapeBadge[] = [];
  const walk = (n: EntryNode): void => {
    if (isUsageShape(n.shape) && n.label) badges.push({ shape: n.shape, label: n.label });
    n.children?.forEach(walk);
  };
  nodes.forEach(walk);
  return { usage: [...usage], badges, second: usage.length > 0 };
}

/**
 * Prune an entry to the subtrees that answer 「使い方は」.
 *
 * A usage-shaped node survives whole (its children are its apparatus). A
 * `section` survives only if something usage-shaped survives inside it — and
 * then keeps ONLY those survivors, so the publisher's own sectioning still
 * organizes the view without smuggling definitions back in. Everything else
 * is the first question's material and is dropped here.
 */
export function usageNodes(nodes: readonly EntryNode[]): EntryNode[] {
  const prune = (n: EntryNode): EntryNode | null => {
    if (isUsageShape(n.shape)) return n;
    if (n.shape === 'section' || n.shape === 'pos-group') {
      const kept = (n.children ?? []).map(prune).filter((c): c is EntryNode => c !== null);
      if (kept.length === 0) return null;
      return { ...n, children: kept };
    }
    return null;
  };
  return nodes.map(prune).filter((n): n is EntryNode => n !== null);
}

export interface DictShapeEntry {
  dict: string;
  summary: ShapeSummary;
}

/**
 * The rollup for one headword across the shelf — what a sidecar would persist
 * per head shard so the badges render before any entry body is read.
 */
export function buildShapeIndex(
  perDict: ReadonlyArray<{ dict: string; nodes: readonly EntryNode[] }>,
): DictShapeEntry[] {
  return perDict
    .map(({ dict, nodes }) => ({ dict, summary: summarize(nodes) }))
    .filter((e) => e.summary.second);
}

/** Does ANY book on the shelf answer the second question for this head? */
export const hasSecondQuestion = (index: readonly DictShapeEntry[]): boolean => index.length > 0;
