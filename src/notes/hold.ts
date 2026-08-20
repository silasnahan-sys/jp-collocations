/**
 * hold.ts — 掴む・運ぶ・置く: the held specimen, as a store.
 *
 * ## Why this exists (Move 1 of the physics — claude/PHYSICS-2026-08-19.md)
 *
 * Every filmed capture forced one choice at the moment of noticing: act NOW
 * (travel to a button, enter the modal, lose the reading) or lose the
 * noticing. The one grammar the reference apps have and this plugin lacked is
 * the CARRY — Calendar's held event surviving Month→Week→Day while the world
 * navigates underneath (IMG_1159), the 15-second drag-ghost in IMG_1082
 * looking for somewhere to exist. A held chip is that: pick a phrase up,
 * keep reading, decide later.
 *
 * Three laws, stated here because the code below enforces them:
 *
 *  1. NOTHING IS EVER MID-AIR. Held chips persist across reloads (the store
 *     saves through the plugin blob), and an overflowing hold does not drop
 *     its oldest chip — it hands it back to the caller, whose one job is to
 *     land it in the tray. Gravity, not loss.
 *  2. THE TRAY IS GRAVITY. An aimless toss has one destination and it is
 *     always legal. `isToss` decides toss-vs-tap from travel, exposed as a
 *     knob because the threshold is a feel constant, not a truth.
 *  3. SCENE RIDES ALONG. A chip is `{text, sentence, surface}`, never a bare
 *     string — S1: what the surface knew arrives wherever the chip lands.
 *
 * Zero Obsidian imports — golden/hold.mjs runs this file directly.
 */

export interface HeldChip {
  id: string;
  /** the specimen itself — the span the hand took. */
  text: string;
  /** the sentence/line it was taken from, when the surface knew it. */
  sentence?: string;
  /** which surface it was grabbed on ('x' | 'dict' | 'tray' | 'lexicon' | 'editor' | …). */
  surface: string;
  at: number;
}

/** Feel knobs, overridable from settings — exposed, never guessed (house rule). */
export interface HoldKnobs {
  /** how many chips the dock holds before the oldest is handed to gravity. */
  cap: number;
  /** pointer travel (px) beyond which a release is a TOSS, not a tap. */
  flickPx: number;
}
export const DEFAULT_HOLD_KNOBS: HoldKnobs = { cap: 3, flickPx: 24 };

const fnv = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
};

/** What the chip face shows — a snip, never the whole paragraph. */
export function chipLabel(text: string, max = 10): string {
  const t = text.trim().replace(/\s+/g, ' ');
  const chars = [...t];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : t;
}

/** Toss vs tap, from pointer travel. One knob, one place. */
export function isToss(dx: number, dy: number, flickPx: number): boolean {
  return Math.hypot(dx, dy) >= flickPx;
}

export class HoldStore {
  private chips: HeldChip[] = [];
  // plain fields, not constructor parameter-properties: golden/hold.mjs runs
  // this file under Node strip-types, which refuses the parameter form
  private saveFn: (data: unknown) => void;
  private knobs: HoldKnobs;

  constructor(saveFn: (data: unknown) => void, knobs: HoldKnobs = DEFAULT_HOLD_KNOBS) {
    this.saveFn = saveFn;
    this.knobs = knobs;
  }

  load(data: unknown): void {
    if (!Array.isArray(data)) return;
    this.chips = data.filter(
      (c): c is HeldChip => !!c && typeof c.text === 'string' && typeof c.id === 'string',
    );
  }

  all(): readonly HeldChip[] { return this.chips; }

  /**
   * Hold a specimen. Returns `{chip, evicted}` — `evicted` is the chip the cap
   * pushed out, which the CALLER must land in the tray (law 1: handed to
   * gravity, never dropped). An identical re-grab (same text+sentence) is the
   * hand double-checking, not a request for a twin: the existing chip is
   * refreshed to the top instead.
   */
  hold(text: string, surface: string, sentence?: string): { chip: HeldChip; evicted: HeldChip | null } {
    const t = text.trim();
    const id = `hold-${fnv(`${t}|${sentence ?? ''}`)}`;
    const existing = this.chips.findIndex((c) => c.id === id);
    if (existing >= 0) {
      const [chip] = this.chips.splice(existing, 1);
      chip.at = Date.now();
      this.chips.push(chip);
      this.persist();
      return { chip, evicted: null };
    }
    const chip: HeldChip = { id, text: t, surface, at: Date.now() };
    if (sentence && sentence.trim() && sentence.trim() !== t) chip.sentence = sentence.trim();
    this.chips.push(chip);
    let evicted: HeldChip | null = null;
    if (this.chips.length > this.knobs.cap) evicted = this.chips.shift() ?? null;
    this.persist();
    return { chip, evicted };
  }

  /** Take a chip OUT (it landed somewhere, or was discarded on purpose). */
  release(id: string): HeldChip | null {
    const i = this.chips.findIndex((c) => c.id === id);
    if (i < 0) return null;
    const [chip] = this.chips.splice(i, 1);
    this.persist();
    return chip;
  }

  newest(): HeldChip | null { return this.chips[this.chips.length - 1] ?? null; }

  private persist(): void { this.saveFn(this.chips); }
}
