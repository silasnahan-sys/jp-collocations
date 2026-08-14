/**
 * usage-board.ts — the 類語 group as a place you can stand in.
 *
 * Today a 類語 list is prose you read; the group is not a navigable object.
 * This is the pure model for the 使い分け board: columns = the synonyms,
 * rows = the publisher's own frames (類語対比表 verbatim — 「私には…むずかしい」
 * arrives with the slot already written, which is the plugin's own frame
 * notation), every cell a DOOR to that member×frame's real examples. One
 * swipe moves member-to-member with the frame held — the bam-bam-bam pass
 * across a synonym set that no flat entry rendering allows.
 *
 * Two rules are load-bearing, both inherited from entry-parts.ts:
 *
 *  1. **Judgements stay the publisher's own tokens.** ○/△/−/× render as
 *     printed, never normalized into scores — the book's editors judged, we
 *     transmit (S3's spirit applied to somebody else's hand).
 *  2. **Degrade honestly.** A book with members but no table still yields a
 *     board (side-by-side members, `judged: false`) — juxtapose, don't tell;
 *     no synthesized comparison ever fills the gap (§27.0.2 rule 2, §28 S6).
 *
 * PURE — no Obsidian, no store, no I/O. Golden: golden/usage-board.mjs.
 */

import type { ComparisonTable, EntryNode, MemberItem } from './entry-parts.ts';

export interface BoardMember {
  item: string;
  /** the members-shape gloss for this item, when the book gave one. */
  gloss?: string;
  /** judgement tokens aligned with Board.frames; empty when `judged` is false. */
  cells: string[];
}

export interface Board {
  /** the publisher's OWN title for the comparison (類語対比表 / 類語スケール). */
  title?: string;
  /** the publisher's frames, verbatim, slots as printed. */
  frames: string[];
  members: BoardMember[];
  /** true when a real comparison table backs the cells. */
  judged: boolean;
}

/** A cell resolved into the query the examples join runs (UI resolves it). */
export interface CellDoor {
  member: string;
  /** frame verbatim; pairs with toFrame/TWC for the examples fetch. */
  frame: string;
  judgement: string;
}

const findFirst = (
  nodes: readonly EntryNode[],
  pred: (n: EntryNode) => boolean,
): EntryNode | null => {
  for (const n of nodes) {
    if (pred(n)) return n;
    const hit = n.children ? findFirst(n.children, pred) : null;
    if (hit) return hit;
  }
  return null;
};

/**
 * Build the board from an entry's nodes. Comparison table when the book has
 * one; members-only fallback otherwise; null when the entry holds neither
 * (no board is an absence — render nothing, not an empty frame).
 */
export function boardFrom(nodes: readonly EntryNode[]): Board | null {
  const cmp = findFirst(nodes, (n) => n.shape === 'comparison' && !!n.table);
  const mem = findFirst(nodes, (n) => n.shape === 'members' && !!n.items?.length);
  const glossOf = (item: string): string | undefined =>
    mem?.items?.find((m: MemberItem) => m.text === item)?.gloss;

  if (cmp?.table) {
    const t: ComparisonTable = cmp.table;
    return {
      title: cmp.label,
      frames: [...t.cols],
      members: t.rows.map((r) => ({ item: r.item, gloss: glossOf(r.item), cells: [...r.cells] })),
      judged: true,
    };
  }
  if (mem?.items?.length) {
    return {
      title: mem.label,
      frames: [],
      members: mem.items.map((m: MemberItem) => ({ item: m.text, gloss: m.gloss, cells: [] })),
      judged: false,
    };
  }
  return null;
}

/** The door behind a cell — or null off the board's edge (callers never guess). */
export function cellDoor(board: Board, memberIdx: number, frameIdx: number): CellDoor | null {
  const m = board.members[memberIdx];
  const f = board.frames[frameIdx];
  if (!m || f === undefined) return null;
  return { member: m.item, frame: f, judgement: m.cells[frameIdx] ?? '' };
}

/**
 * One swipe, member-to-member, frame held — wraps at the edges so the pass
 * around a five-member set is a rhythm, not four strokes and a dead end.
 */
export function stepMember(board: Board, memberIdx: number, dir: 1 | -1): number {
  const n = board.members.length;
  if (n === 0) return 0;
  return ((memberIdx + dir) % n + n) % n;
}
