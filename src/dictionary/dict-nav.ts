/**
 * dict-nav.ts — the 辞書's navigation grammar as a pure model.
 *
 * Three organs Monokakido has and the films show the hand using every single
 * session (コマ送り items 7/8/16), built here as data with no DOM:
 *
 *   • NEIGHBOURS — the dictionary as a PLACE you can walk, not only query.
 *     Sorted by reading (gojūon: 病人 びょうにん → 病毒 びょうどく → 廟堂
 *     びょうどう — filmed at 1175 f11732, the flip is instant), so an entry
 *     always has a left and a right, like a page in a physical book.
 *   • HISTORY — dated, persistent, capped. Monokakido's counter read 1,251;
 *     the plugin's was a session array that died on reload. A lookup is a
 *     fact about your study, and facts survive restarts.
 *   • DAY GROUPS — 今日 / 昨日 / M月D日, computed with an injected clock so
 *     the grouping is testable.
 *
 * Three rules, each pinned in golden/dict-nav.mjs:
 *
 *  1. TYPING IS ONE LOOKUP. The live search fires per keystroke; the history
 *     must not read の→のば→のばあ as three visits. A new word that extends or
 *     truncates the head row within the refinement window REPLACES it.
 *  2. A REVISIT IS NOT A DUPLICATE ROW. The same word at the head within the
 *     dwell window is the same visit; outside it, a real re-visit files anew
 *     (Monokakido's History shows repeats across days — that is the point).
 *  3. NEIGHBOURS ARE UNIQUE EXPRESSIONS. Ten senses of 手 in three books are
 *     one place; prev/next never lands you where you already stand.
 */

// ── History ──────────────────────────────────────────────────

export interface DictHistoryRow {
  word: string;
  /** epoch ms of the LAST visit this row represents */
  at: number;
}

export const HISTORY_CAP = 500;
/** A new query extending/truncating the head within this window is typing. */
export const REFINE_MS = 2 * 60 * 1000;
/** The same word again within this window is the same visit. */
export const DWELL_MS = 5 * 60 * 1000;

/**
 * Record one lookup. Returns the SAME array when nothing changed (so callers
 * can cheaply skip persistence), a new array otherwise. Newest first.
 */
export function recordLookup(
  rows: readonly DictHistoryRow[], word: string, now: number, cap = HISTORY_CAP,
): DictHistoryRow[] {
  const w = word.trim();
  if (!w) return rows as DictHistoryRow[];
  const head = rows[0];
  if (head) {
    const age = now - head.at;
    if (head.word === w && age < DWELL_MS) return rows as DictHistoryRow[];
    // Rule 1 — a refinement replaces the head instead of stacking under it.
    // Both directions: のば→のばあ (extending) and のばあ→のば (backspacing).
    const refines = age < REFINE_MS
      && (w.startsWith(head.word) || head.word.startsWith(w));
    if (refines) return [{ word: w, at: now }, ...rows.slice(1)].slice(0, cap);
  }
  return [{ word: w, at: now }, ...rows].slice(0, cap);
}

export interface DictHistoryDay {
  label: string;
  rows: DictHistoryRow[];
}

/** Group rows (newest-first) into dated sections: 今日 / 昨日 / M月D日. */
export function historyDays(rows: readonly DictHistoryRow[], now: number): DictHistoryDay[] {
  const dayKey = (t: number): string => {
    const d = new Date(t);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const today = dayKey(now);
  const yesterday = dayKey(now - 24 * 60 * 60 * 1000);
  const out: DictHistoryDay[] = [];
  let cur: DictHistoryDay | null = null;
  let curKey = '';
  for (const r of rows) {
    const k = dayKey(r.at);
    if (!cur || k !== curKey) {
      const d = new Date(r.at);
      const label = k === today ? '今日' : k === yesterday ? '昨日'
        : `${d.getMonth() + 1}月${d.getDate()}日`;
      cur = { label, rows: [] };
      curKey = k;
      out.push(cur);
    }
    cur.rows.push(r);
  }
  return out;
}

/**
 * The persistence half, mirroring HoldStore: load tolerates junk, every
 * mutation saves through the injected closure, reads are cheap.
 */
export class DictHistoryStore {
  private rowsArr: DictHistoryRow[] = [];
  private persist: (data: unknown) => Promise<void>;
  constructor(persist: (data: unknown) => Promise<void>) { this.persist = persist; }

  load(data: unknown): void {
    if (!Array.isArray(data)) return;
    this.rowsArr = data.filter(
      (r): r is DictHistoryRow => !!r && typeof r.word === 'string' && typeof r.at === 'number',
    );
  }

  rows(): readonly DictHistoryRow[] { return this.rowsArr; }

  record(word: string, now = Date.now()): void {
    const next = recordLookup(this.rowsArr, word, now);
    if (next === this.rowsArr) return;
    this.rowsArr = next;
    void this.persist(this.rowsArr);
  }
}

// ── Neighbours ───────────────────────────────────────────────

export interface NavHeadword {
  expression: string;
  reading: string;
}

export interface NeighborIndex {
  /** unique expressions in reading order */
  order: NavHeadword[];
  /** expression → position in `order` */
  pos: Map<string, number>;
}

/** カタカナ → ひらがな so ハシ and はし sort as one column. */
const kata2hira = (s: string): string =>
  s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/**
 * Build the walkable order once per store mutation. Codepoint order on
 * normalized kana approximates gojūon well enough to walk by; ties break on
 * the expression so the order is total and stable.
 */
export function buildNeighborIndex(entries: Iterable<NavHeadword>): NeighborIndex {
  const byExpr = new Map<string, { h: NavHeadword; key: string }>();
  for (const e of entries) {
    if (!e.expression) continue;
    const key = kata2hira(e.reading || e.expression) + '\u0001' + e.expression;
    const prev = byExpr.get(e.expression);
    // Rule 3 — one place per expression; the first reading seen names it.
    if (!prev) byExpr.set(e.expression, { h: { expression: e.expression, reading: e.reading || e.expression }, key });
  }
  const rows = [...byExpr.values()];
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const order = rows.map((r) => r.h);
  const pos = new Map<string, number>();
  order.forEach((h, i) => pos.set(h.expression, i));
  return { order, pos };
}

/**
 * Where a query stands, and who stands beside it. The query finds its place
 * by expression first, then by reading (typing びょうにん lands on 病人's
 * spot). Null when the word has no place in the walkable order — the chips
 * then hide rather than pointing nowhere.
 */
export function neighborsOf(
  index: NeighborIndex, query: string,
): { prev: NavHeadword | null; here: NavHeadword; next: NavHeadword | null } | null {
  let i = index.pos.get(query);
  if (i === undefined) {
    const q = kata2hira(query);
    i = index.order.findIndex((h) => kata2hira(h.reading) === q);
    if (i < 0) return null;
  }
  return {
    prev: i > 0 ? index.order[i - 1] : null,
    here: index.order[i],
    next: i < index.order.length - 1 ? index.order[i + 1] : null,
  };
}

// ── The search notation: Starts/Ends in the alphabet the plugin already speaks ──

/**
 * Monokakido offers Equals / Starts / Ends as a dropdown; the plugin's users
 * already write 〜たなら for "something before たなら" in every notation
 * field. Same alphabet here: a leading tilde is Ends, a trailing tilde is
 * Starts, no tilde is the ordinary walk (exact → prefix → contains). All
 * three tilde forms (〜 U+301C, ~ U+007E, ～ U+FF5E) are one mark — the
 * third-alphabet lesson of the 2026-08-20 review.
 */
export function searchNotation(q: string): { mode: 'ends' | 'starts'; term: string } | null {
  const t = q.trim();
  const ends = /^[〜~～](.+)$/.exec(t);
  if (ends) return { mode: 'ends', term: ends[1].trim() };
  const starts = /^(.+?)[〜~～]$/.exec(t);
  if (starts) return { mode: 'starts', term: starts[1].trim() };
  return null;
}

// ── The trail: back AND forward, as one pure spine ───────────
//
// The films' walk is never one-directional: the hand descends into an entry,
// backs out, and goes right back in — 行って戻ってまた行く — and iOS answers
// both directions from the screen edges. The plugin had only half the organ:
// a back array, poppable by button. This is the whole spine, shared by 辞書
// and 𝕏 so both surfaces walk by one grammar (§26.0 property 4).
//
// Law: a new descend BURNS the forward stack (you left the old future), and
// back/forward move the CURRENT stop across, so nothing is ever lost mid-walk.

export class Trail<T> {
  private backArr: T[] = [];
  private fwdArr: T[] = [];

  /** A new descend: remember where you stand, forget the abandoned future. */
  push(stop: T): void {
    this.backArr.push(stop);
    this.fwdArr = [];
  }

  /** Step back: the current stop becomes the future. Null at the trail head. */
  back(current: T): T | null {
    const prev = this.backArr.pop();
    if (prev === undefined) return null;
    this.fwdArr.push(current);
    return prev;
  }

  /** Step forward again. Null when no future exists. */
  forward(current: T): T | null {
    const next = this.fwdArr.pop();
    if (next === undefined) return null;
    this.backArr.push(current);
    return next;
  }

  peekBack(): T | null { return this.backArr[this.backArr.length - 1] ?? null; }
  peekForward(): T | null { return this.fwdArr[this.fwdArr.length - 1] ?? null; }
  get backLength(): number { return this.backArr.length; }
  get forwardLength(): number { return this.fwdArr.length; }
  /** Oldest-first, for breadcrumb rendering. Read-only. */
  backStops(): readonly T[] { return this.backArr; }
  clear(): void { this.backArr = []; this.fwdArr = []; }
}

// ── Quick nav: the riffle schedule ───────────────────────────

/**
 * Hold a neighbour chip and the pages riffle — Monokakido's paddles under a
 * held thumb, a Kindle riffled by its corner. The schedule accelerates the
 * way a hand does: deliberate first steps while you read what is passing,
 * then a glide once you clearly mean distance. Flips are hard cuts (the
 * filmed chip flip lands between two frames); the ACCELERATION is the only
 * tempo, so the speed itself is the feedback.
 */
export const RIFFLE_HOLD_MS = 320;
const RIFFLE_STEPS = [300, 240, 190, 150, 120, 100] as const;
export function riffleDelay(step: number): number {
  if (step < 0) return RIFFLE_STEPS[0];
  return step < RIFFLE_STEPS.length ? RIFFLE_STEPS[step] : 90;
}

// ── The page-turn verdict: does a released pan COMMIT to the neighbour? ──

/**
 * The kindle-quick page turn, as a decision the goldens can hold still.
 * The first build answered "scrolly-like but much quicker" with a discrete
 * release-time flick — the exact mistake the 2026-08-25 review warned about
 * (a scrolly correction answered with a more discrete model). The pan now
 * FOLLOWS the finger; this decides what the release means:
 *
 *   • distance: past ~28% of the pane width, the page is committed — the
 *     hand has carried it over the hill and letting go finishes the turn.
 *   • velocity: a quick throw commits from much less distance (≥0.5 px/ms
 *     over ≥48px) — that is the flick.
 *   • no target: nothing to turn to — always snap back (the rubber band
 *     already told the hand during the drag).
 */
export function panVerdict(
  dxAbs: number, dtMs: number, paneWidth: number, hasTarget: boolean,
): 'commit' | 'snap' {
  if (!hasTarget) return 'snap';
  if (dxAbs > paneWidth * 0.28) return 'commit';
  if (dtMs > 0 && dxAbs >= 48 && dxAbs / dtMs >= 0.5) return 'commit';
  return 'snap';
}
