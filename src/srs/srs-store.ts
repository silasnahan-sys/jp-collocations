/**
 * srs-store.ts — persistent review state for the catalog deck.
 *
 * The card unit is the PATTERN (PatternEntry.id) — the P1 philosophy carried
 * into review: three sightings of んだったら〜なきゃ are one card with three
 * examples, not three cards. States live in the plugin-data blob under
 * `_srsDeck` (sibling-preserving spread, like every other store).
 *
 * Queue policy (Anki-shaped): due learning/relearning first (by dueMs), then
 * due reviews, then up to `newPerSession` unseen cards. Learning steps that
 * come due mid-session re-enter the queue.
 */

import { newCardState, schedule, isDue, type CardState, type Grade } from './scheduler.ts';

export interface SrsData { cards: Record<string, CardState> }

export interface QueueCounts { learn: number; due: number; fresh: number; leech: number }

export const NEW_PER_SESSION = 20;

export class SrsStore {
  private cards = new Map<string, CardState>();
  private saveFn: (data: SrsData) => Promise<void>;

  constructor(saveFn: (data: SrsData) => Promise<void>) {
    this.saveFn = saveFn;
  }

  load(data: SrsData | undefined): void {
    this.cards.clear();
    for (const [id, s] of Object.entries(data?.cards ?? {})) this.cards.set(id, s);
  }

  private async persist(): Promise<void> {
    await this.saveFn({ cards: Object.fromEntries(this.cards) });
  }

  stateOf(id: string): CardState | undefined { return this.cards.get(id); }
  size(): number { return this.cards.size; }

  /** Grade one card. Unseen ids enter the deck on their first review. */
  async review(id: string, grade: Grade, now = Date.now()): Promise<CardState> {
    const prev = this.cards.get(id) ?? newCardState(now);
    const next = schedule(prev, grade, now);
    this.cards.set(id, next);
    await this.persist();
    return next;
  }

  /** Remove state for ids that no longer exist in the catalog. */
  async prune(liveIds: Set<string>): Promise<number> {
    let removed = 0;
    for (const id of [...this.cards.keys()]) {
      if (!liveIds.has(id)) { this.cards.delete(id); removed++; }
    }
    if (removed) await this.persist();
    return removed;
  }

  /**
   * Build a session queue over `deckIds` (catalog patterns with material).
   * Returns ids in review order.
   */
  buildQueue(deckIds: string[], now = Date.now(), newPerSession = NEW_PER_SESSION): string[] {
    const learn: string[] = [];
    const due: string[] = [];
    const fresh: string[] = [];
    for (const id of deckIds) {
      const s = this.cards.get(id);
      if (!s || s.state === 'new') { fresh.push(id); continue; }
      if (s.leech) continue; // suspended: needs a rewrite, not more failed reps
      if (!isDue(s, now)) continue;
      if (s.state === 'learning' || s.state === 'relearning') learn.push(id);
      else due.push(id);
    }
    const dueMs = (id: string) => this.cards.get(id)?.dueMs ?? 0;
    learn.sort((a, b) => dueMs(a) - dueMs(b));
    due.sort((a, b) => dueMs(a) - dueMs(b));
    return [...learn, ...due, ...fresh.slice(0, newPerSession)];
  }

  counts(deckIds: string[], now = Date.now()): QueueCounts {
    let learn = 0, due = 0, fresh = 0, leech = 0;
    for (const id of deckIds) {
      const s = this.cards.get(id);
      if (!s || s.state === 'new') { fresh++; continue; }
      if (s.leech) { leech++; continue; }
      if (!isDue(s, now)) continue;
      if (s.state === 'learning' || s.state === 'relearning') learn++;
      else due++;
    }
    return { learn, due, fresh, leech };
  }

  /** Clear leech flags among `deckIds` and make those cards due now — the
   *  user says the cards have been rewritten and deserve another run. */
  async reviveLeeches(deckIds: string[], now = Date.now()): Promise<number> {
    let revived = 0;
    for (const id of deckIds) {
      const s = this.cards.get(id);
      if (!s?.leech) continue;
      this.cards.set(id, { ...s, leech: false, dueMs: now });
      revived++;
    }
    if (revived) await this.persist();
    return revived;
  }
}
