/**
 * paradigm.ts — 32 rows that are one phenomenon, shown as one phenomenon.
 *
 * The catalog's 談話 shelf reads, top to bottom:
 *
 *   ですね / かな / んですけど / んですよ / ですよね / よね / ますね / んですよね /
 *   じゃないですか / ですけど / んですね / じゃん / ますよね / でしょ / でしょう /
 *   んじゃない / だよね / んだよね / でしょうね / ですかね / んじゃないかな /
 *   んですけれども / んですけども / んじゃないですか / んですかね / んじゃないの /
 *   ですけれども / ですけども / ますかね / んじゃないですかね / じゃないですかね
 *
 * Thirty-one variants and one piece of ASR wreckage. Every one is a real,
 * separately-ratifiable noticing and none should be deleted — but presented as
 * a flat list they read as noise, and a catalog that reads as noise stops being
 * reached for. That is not a cosmetic complaint: §28's entire chain exists to
 * end at *reach-for*, and a shelf you scroll past defeats it at the last step.
 *
 * ## Two axes, and a veto
 *
 * **Axis 1 — what the corpus says they DO.** The concordance sweep recorded a
 * discourse move on every sighting it could name (`concordance:final:
 * AGREE-MARK`), from the recognizer in `discourse/`, against the user's own
 * transcripts. Forms whose sightings mostly name the same move do the same job
 * *in this corpus*. That is evidence, already on disk, and it was never once
 * displayed before this module.
 *
 * **Axis 2 — declared contractions.** けれども ~ けども ~ けど is not a theory; it
 * is the same morpheme spelled three ways, and any reference says so. The table
 * below is short, closed, and written out so it can be argued with line by
 * line. What it deliberately does NOT do is strip politeness or copulas — that
 * would need a morphology I'd be inventing, and it would file 「ですけど」 with
 * 「ですね」 on a shared です that carries none of the meaning.
 *
 * **The veto.** When the two axes disagree, the corpus wins and the fold does
 * not happen. 「ですよね」 and 「んですよね」 share a skeleton but their own
 * sightings call them CONFIRMATION-SEEK and EXPLAIN-CONFIRM — the ん really is
 * doing something — so they stay apart. Declared morphology proposes; the
 * user's own data disposes. That ordering is the whole ethic of §12 and §28 S3
 * applied to grouping.
 *
 * ## What this is not
 *
 * A VIEW fold, never a store merge. Every member keeps its id, its own ✓/✕
 * history, its own attestations — §28 S1, one object re-rendered, never copied.
 * Collapsing rows must never collapse decisions. An entry that fits nothing is
 * left standing alone rather than filed under a guess (§28 S6: degrade to less
 * structure, never to wrong structure).
 */

import type { UnifiedEntry } from './unified-search.ts';
import { dominantMove } from './context-tree.ts';

/** Classified sightings a member needs before its move is taken as its label. */
export const FOLD_MIN_SIGHTINGS = 8;
/** …and how one-sided that tally has to be. */
export const FOLD_MIN_SHARE = 0.5;
/** A family of one is just an entry wearing a bigger hat. */
const MIN_MEMBERS = 2;

/**
 * Spelling variants of one morpheme. Ordered: longest form first, so けれども
 * is consumed before けども could match inside it.
 *
 * Every line here is an orthographic or phonological variant, never a
 * grammatical one. Adding です→だ or ます→∅ to this list would be the exact
 * mistake the module header refuses.
 */
const CONTRACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/けれども/g, 'けど'],
  [/けども/g, 'けど'],
  [/でしょう/g, 'でしょ'],
  [/ではない/g, 'じゃない'],
  [/のです/g, 'んです'],
  [/のだ/g, 'んだ'],
];

/** A key with its spelling variants collapsed. Not a stem — a normal form. */
export function skeleton(key: string): string {
  let s = key.normalize('NFC').trim();
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to);
  return s;
}

export interface Paradigm {
  /** stable id for the family, for expand/collapse state. */
  id: string;
  /** the recognizer's move id when the family has one, else ''. */
  move: string;
  /** what the family is called: 承認を求める, or the shared surface. */
  label: string;
  /** why these are together — shown, never implied. */
  basis: 'move' | 'spelling';
  /** members, most-attested first. The first one names the family. */
  members: UnifiedEntry[];
  /** sum of every member's confirmed usages. */
  attestations: number;
  /** sum of the classified sightings behind the grouping. */
  sightings: number;
}

export interface FoldedList {
  paradigms: Paradigm[];
  /** everything that did not fold, in the order it arrived. */
  loose: UnifiedEntry[];
}

interface Node {
  entry: UnifiedEntry;
  skel: string;
  move: string | null;
  moveLabel: string;
  sightings: number;
}

/**
 * Fold a result list into paradigms plus leftovers.
 *
 * Order is preserved: a family takes the list position of its best-ranked
 * member, so a search that ranked 「よね」 first still shows that family first.
 * The caller decides whether to fold at all — folding is wrong while the user
 * is searching for a specific string, because then the flat list IS the answer.
 */
export function foldParadigms(entries: UnifiedEntry[]): FoldedList {
  const nodes: Node[] = [];
  const loose: UnifiedEntry[] = [];

  for (const e of entries) {
    // Only the 談話 shelf. The move vocabulary belongs to the discourse
    // recognizer, and the contraction table is written for sentence-final
    // forms; spending either on a 台詞 would be borrowing authority neither
    // was given (§23 — ask each layer only what it can know).
    if (e.cls !== 'discourse' || !e.pattern) { loose.push(e); continue; }
    const dm = dominantMove(e.pattern, { minSightings: FOLD_MIN_SIGHTINGS, minShare: FOLD_MIN_SHARE });
    nodes.push({
      entry: e,
      skel: skeleton(e.headword),
      move: dm?.move ?? null,
      moveLabel: dm?.label ?? '',
      sightings: dm?.classified ?? 0,
    });
  }

  // ── union-find over the two axes, with the veto ──
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a: number, b: number): void => { const ra = find(a), rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      // The veto, checked first: two forms the corpus says do different jobs
      // are not the same form, however they are spelled.
      if (a.move && b.move && a.move !== b.move) continue;
      const sameMove = !!a.move && a.move === b.move;
      const sameSpelling = a.skel === b.skel;
      if (sameMove || sameSpelling) union(i, j);
    }
  }

  const groups = new Map<number, Node[]>();
  for (let i = 0; i < nodes.length; i++) {
    const r = find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(nodes[i]);
  }

  const paradigms: Paradigm[] = [];
  for (const g of groups.values()) {
    if (g.length < MIN_MEMBERS) { loose.push(...g.map((n) => n.entry)); continue; }
    g.sort((a, b) => b.entry.attestationCount - a.entry.attestationCount ||
      b.sightings - a.sightings ||
      a.entry.headword.localeCompare(b.entry.headword, 'ja'));
    // A family named by its move says what it DOES; one named by spelling can
    // only say what it looks like. Prefer the former whenever it exists.
    const named = g.find((n) => n.move);
    paradigms.push({
      id: `par-${named?.move ?? g[0].skel}`,
      move: named?.move ?? '',
      label: named?.moveLabel || g[0].entry.headword,
      basis: named ? 'move' : 'spelling',
      members: g.map((n) => n.entry),
      attestations: g.reduce((n, x) => n + x.entry.attestationCount, 0),
      sightings: g.reduce((n, x) => n + x.sightings, 0),
    });
  }

  // Dissolved singletons re-enter `loose` out of order; restore the caller's
  // ranking so the fold never silently reshuffles the list.
  const pos = new Map(entries.map((e, i) => [e.id, i]));
  const at = (e: UnifiedEntry): number => pos.get(e.id) ?? 0;
  loose.sort((a, b) => at(a) - at(b));
  paradigms.sort((a, b) => at(a.members[0]) - at(b.members[0]));
  return { paradigms, loose };
}

/** `ですけど・ですけども ほか2語` — the family's own headword line. */
export function paradigmSurface(p: Paradigm, shown = 3): string {
  const head = p.members.slice(0, shown).map((m) => m.headword).join('・');
  const rest = p.members.length - shown;
  return rest > 0 ? `${head} ほか${rest}語` : head;
}
