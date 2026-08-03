/**
 * ratify-store.ts — persistence for the ratification ledger (AUDIT §6.5).
 *
 * Same shape as `SrsStore`: a Map, an injected save callback, and nothing that
 * knows about Obsidian. Persisted in the plugin-data blob under
 * `_ratifications` (sibling-preserving spread, like every other store).
 *
 * The point of ONE ledger is stated in §6.5: "until that exists, no amount of
 * parser work can be *evaluated*". Before this, the four kinds of human
 * judgement this plugin collects lived in four unrelated places — attestation
 * `status` flags, `rejectedAtts` keys, `_componentGold`, `_discourseGold` — and
 * a fifth (`golden/precision/samples.jsonl`) was a file outside the app that
 * nothing wrote to. A measurement had nowhere to read from, so no finding could
 * ever become settled and the same three conclusions kept being re-derived.
 *
 * Keyed by `Ratification.id`, so re-answering a question overwrites rather than
 * appending — the same "latest human word wins" rule `recordComponentVerdict`
 * already uses. History is deliberately not kept: what a measurement needs is
 * the user's current judgement, and an append log would make every proportion
 * depend on how many times they changed their mind.
 *
 * **It starts empty on purpose.** The catalog already holds 239 confirmed and 1
 * rejected attestation, and folding those in would look like a free head start.
 * It would be the exact bias this whole design is built to prevent: a confirmed
 * attestation may have been hand-captured (never a machine claim at all) or
 * ratified from a queue the user chose to look at, and neither can be assigned
 * a `pick`. Rows with an unknown sampling reason cannot enter a proportion, so
 * they stay out — which is the reason the ledger had to exist in the first place.
 */

import type { Ratification, RatifyData } from './ratify.ts';

export class RatifyStore {
  private rows = new Map<string, Ratification>();

  constructor(private saveFn: (data: RatifyData) => Promise<void>) {}

  load(data: RatifyData | undefined): void {
    this.rows.clear();
    for (const [id, r] of Object.entries(data?.rows ?? {})) this.rows.set(id, r);
  }

  /** The plain object the pure module reads. */
  data(): RatifyData {
    return { rows: Object.fromEntries(this.rows) };
  }

  size(): number { return this.rows.size; }

  get(id: string): Ratification | undefined { return this.rows.get(id); }

  async record(row: Ratification): Promise<void> {
    this.rows.set(row.id, row);
    await this.saveFn(this.data());
  }
}
