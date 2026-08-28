/**
 * collect.ts — 集句: successive selections become ONE question.
 *
 * The ask, verbatim from the 2026-08-28 desk report: reading 「今も言語に
 * やや障害が残っている」 the study question is 「do 今も and やや go
 * together?」 — and no single selection can ask it, because the two spans
 * are not adjacent and no regex the hand would write enumerates what may
 * stand between them. The corpus can answer exactly this (co-occurrence,
 * order, the gap material — pair.ts), so what was missing is only the
 * GESTURE: a way for two, three selections to accumulate into a query
 * instead of each replacing the last.
 *
 * This module is the pure half: an observable term set and the assembly
 * rule that turns it into the notation the search box already speaks —
 * space = AND, 〜 = ordered proximity (query-notation.ts). It deliberately
 * invents no new grammar: whatever the strip assembles, the hand could
 * have typed, and the box will parse it with the same rules it teaches.
 *
 * The DOM half is ui/collect-strip.ts; the entry gestures are the echo's
 * ⊕ verb and the strip's armed mode (every settled selection joins).
 *
 * PURE — no DOM. Golden: golden/x-collect.mjs.
 */

export type CollectMode = 'and' | 'near';

/** Terms are capped: a seventh condition is a sign the question changed. */
const MAX_TERMS = 6;
const MIN_CHARS = 2;
/** Selections longer than this are lines, not terms — a term is a span the
 *  corpus could plausibly repeat. */
const MAX_CHARS = 24;

/**
 * Assemble the query string the strip runs. The near mode exists for
 * exactly two terms (A〜B — ordered, windowed; query-notation.ts); with
 * any other count it degrades to AND rather than inventing an unstated
 * multi-way proximity semantics.
 */
export function collectQuery(terms: string[], mode: CollectMode): string {
  const ts = terms.map((t) => t.trim()).filter(Boolean);
  if (!ts.length) return '';
  if (ts.length === 1) return ts[0];
  if (mode === 'near' && ts.length === 2) return `${ts[0]}〜${ts[1]}`;
  return ts.join(' ');
}

/** Whether a raw selection can BE a term. Exported for the strip and the
 *  echo to agree (one rule, two gates). */
export function collectable(text: string): boolean {
  const t = text.trim();
  const n = [...t].length;
  return n >= MIN_CHARS && n <= MAX_CHARS && !/\n/.test(t);
}

/**
 * The shared, observable term set — ONE per plugin, so a span collected in
 * the 辞書 and a span collected in the 𝕏 view land in the same question.
 */
export class CollectSet {
  private terms: string[] = [];
  private _mode: CollectMode = 'and';
  private _armed = false;
  private subs = new Set<() => void>();

  list(): string[] { return [...this.terms]; }
  mode(): CollectMode { return this._mode; }
  armed(): boolean { return this._armed; }
  query(): string { return collectQuery(this.terms, this._mode); }

  /** Add a settled selection. Rejects non-terms, dedupes, caps; returns
   *  whether the set changed. */
  add(text: string): boolean {
    const t = text.trim();
    if (!collectable(t) || this.terms.includes(t) || this.terms.length >= MAX_TERMS) return false;
    this.terms.push(t);
    this.emit();
    return true;
  }

  remove(text: string): void {
    const i = this.terms.indexOf(text);
    if (i < 0) return;
    this.terms.splice(i, 1);
    this.emit();
  }

  clear(): void {
    if (!this.terms.length && !this._armed) return;
    this.terms = [];
    this._armed = false;
    this.emit();
  }

  setMode(m: CollectMode): void {
    if (this._mode === m) return;
    this._mode = m;
    this.emit();
  }

  setArmed(on: boolean): void {
    if (this._armed === on) return;
    this._armed = on;
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  private emit(): void {
    for (const fn of this.subs) fn();
  }
}
