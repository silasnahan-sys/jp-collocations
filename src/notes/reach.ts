/**
 * reach.ts — HOLDING THE REACHING (DESIGN §27.0.2).
 *
 * Everything else in this plugin holds what you have already caught. §27.0.2's
 * finding is that the most alive part is the opposite — the hole:
 *
 *   「どっかのタイミングで」— the WANT came first (a meaning felt but
 *   un-externalized: *"no phrase I found captured that"*), the finding came
 *   later by HEARING, and the magic was the **collision**.
 *
 * So a Reach is a first-class object for a want with no phrase yet. Three rules
 * follow from §27.0.2 and they are what make this different from a to-do list:
 *
 *  1. **A reach is never answered by the machine.** The watcher OFFERS; only
 *     the user's felt recognition fills it. Every offer carries a `why` that
 *     states its own weak, skeletal reason — never "this means that". This is
 *     the same recall-machine/hand-is-truth split as everywhere else (§28 S3).
 *  2. **Juxtapose, don't tell.** §27.0.2: *never print "逆に = actually", set the
 *     scenes side by side and let the flash happen.* Offers are therefore
 *     deliberately loose and are presented, not ranked into a verdict.
 *  3. **A filled reach stays visible.** The hole is part of the record — how you
 *     came to reach for it is the trace, and deleting it on fill would throw
 *     away the only evidence the collision ever happened.
 *
 * PURE — no Obsidian, no store, no I/O. Golden: golden/reach.mjs.
 */

// The ONE frame key space (frames.ts is itself pure). A second normalization
// here would mean a want and the dictionary's reach-for query could never agree
// about what shape they were both circling.
import { toFrame } from '../dictionary/frames.ts';

/** Why an offer was made. Weak by design; none of these is a claim of meaning. */
export type OfferReason =
  | 'token'      // shares a written token with the want
  | 'frame'      // realizes a frame the want was circling
  | 'juxtapose'; // arrived while this reach was open — pure co-presence

export interface ReachOffer {
  /** the candidate phrase, verbatim. */
  surface: string;
  /** where it came from, so it can be gone back to (§28 S2). */
  source?: { file?: string; tStartSec?: number | null; medium?: string; deepLink?: string };
  reason: OfferReason;
  /** the offer's own account of itself, in words that never assert meaning. */
  why: string;
  offeredAt: number;
  /** the USER's felt recognition. Absent = still just an offer. */
  verdict?: 'yes' | 'no';
}

export interface Reach {
  id: string;
  /** the felt want, in the user's own words — "at some point", "that feeling when…" */
  want: string;
  /** an optional paraphrase / English gloss / gesture note. */
  gloss?: string;
  openedAt: number;
  offers: ReachOffer[];
  /** set when an offer is recognized. The reach STAYS — the hole is the trace. */
  filled?: { surface: string; at: number; offerIndex: number };
  /** closed without a fill: it turned out not to be a real hole. */
  abandonedAt?: number;
}

export const isOpen = (r: Reach): boolean => !r.filled && !r.abandonedAt;

/** Stable id from the want text + time (no Math.random — goldens must be deterministic). */
export function reachId(want: string, at: number): string {
  let h = 0x811c9dc5;
  const s = `${want}|${at}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `reach-${(h >>> 0).toString(36)}`;
}

export function openReach(want: string, at: number, gloss?: string): Reach {
  const w = String(want ?? '').trim();
  if (!w) throw new Error('a reach needs a want');
  return {
    id: reachId(w, at),
    want: w,
    ...(gloss?.trim() ? { gloss: gloss.trim() } : {}),
    openedAt: at,
    offers: [],
  };
}

/** Content tokens of a want — used only to justify a `token` offer, never to mean. */
export function wantTokens(want: string): string[] {
  const STOP = new Set([
    'the', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'for', 'that', 'this', 'it', 'is',
    'be', 'and', 'or', 'my', 'you', 'i', 'when', 'some', 'something', 'someone',
    'こと', 'もの', 'する', 'いる', 'ある', 'です', 'ます', '的な', 'ような',
  ]);
  return String(want ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}ー々]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

/**
 * The want, read as a FRAME — when it is shaped like one.
 *
 * A hole is often written with its shape already in it: 「〜のタイミングで」,
 * 「○○が有効な反論」. `toFrame` is the plugin's single frame key space
 * (frames.ts), the same one `BigDictStore.frame()` — the reach-for query — and
 * the 💠/🟠 catalog keys live in, so a want circling a shape and a phrase that
 * realizes it can meet without a second normalization.
 *
 * Returns null for a want with no slot in it: a frame offer is only honest when
 * there is a frame to have been circling.
 */
function frameOfWant(r: Pick<Reach, 'want' | 'gloss'>): string | null {
  for (const raw of [r.want, r.gloss]) {
    if (!raw?.trim()) continue;
    const f = toFrame(raw);
    if (!f.fixed && f.key) return f.key;
  }
  return null;
}

/**
 * Two frame keys "touch" when one contains the other.
 *
 * Deliberately loose, and deliberately not a similarity score. §27.0.2's rule
 * is JUXTAPOSE, DON'T TELL: an offer sets two things side by side so the
 * recognition can happen: it is not a ranked verdict, so a threshold would be
 * inventing a precision the mechanism does not have.
 *
 * The previous test was `item.frameKey.includes(r.gloss)` — the gloss is prose
 * ("that feeling when…") and a frame key is a slotted Japanese shape, so it was
 * false in essentially every real case. Together with the fact that no caller
 * ever supplied `frameKey`, the entire `frame` reason was unreachable.
 */
function framesTouch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // A bare slot matches everything and would make every arrival a frame offer.
  const bare = (s: string) => s.replace(/[～＿\s]/g, '').length === 0;
  if (bare(a) || bare(b)) return false;
  return a.includes(b) || b.includes(a);
}

export interface Incoming {
  surface: string;
  source?: ReachOffer['source'];
  /** normalized frame key, when the incoming item has one (frames.ts). */
  frameKey?: string;
  at: number;
}

/**
 * THE COLLISION WATCHER. Given the open reaches and whatever just arrived in
 * the attested stream, produce offers.
 *
 * Deliberately weak: it can only see writing, never meaning. A `token` offer
 * says "this shares a word with what you wrote"; a `frame` offer says "this
 * realizes a frame you were circling"; a `juxtapose` offer says nothing at all
 * except "this arrived while you were reaching." That last one is not a
 * failure mode — §27.0.2 asks for exactly it, because the flash comes from
 * setting things side by side, not from being told.
 *
 * Returns NEW offers only; already-offered surfaces are not re-offered, so a
 * reach does not accumulate the same candidate every sweep.
 */
export function collide(
  reaches: Reach[], incoming: Incoming[], opts: { juxtaposeLimit?: number } = {},
): Array<{ reachId: string; offer: ReachOffer }> {
  const out: Array<{ reachId: string; offer: ReachOffer }> = [];
  const juxLimit = opts.juxtaposeLimit ?? 0;

  for (const r of reaches) {
    if (!isOpen(r)) continue;
    const seen = new Set(r.offers.map((o) => o.surface));
    const tokens = wantTokens(r.want + (r.gloss ? ' ' + r.gloss : ''));
    const wantFrame = frameOfWant(r);
    let jux = 0;

    for (const item of incoming) {
      const surface = String(item.surface ?? '').trim();
      if (!surface || seen.has(surface)) continue;

      const hit = tokens.find((t) => surface.toLowerCase().includes(t));
      let reason: OfferReason | null = null;
      let why = '';

      if (hit) {
        reason = 'token';
        why = `「${hit}」を含みます（意味ではなく表記の一致）`;
      } else if (item.frameKey && wantFrame && framesTouch(wantFrame, item.frameKey)) {
        reason = 'frame';
        why = `あなたが回っていた型を実現しています: ${item.frameKey}`;
      } else if (jux < juxLimit) {
        reason = 'juxtapose';
        why = 'この願いが開いている間に届きました — 並べてみるだけ';
        jux++;
      }
      if (!reason) continue;

      seen.add(surface);
      out.push({
        reachId: r.id,
        offer: {
          surface,
          ...(item.source ? { source: item.source } : {}),
          reason, why, offeredAt: item.at,
        },
      });
    }
  }
  return out;
}

/** Attach offers to their reaches (pure — returns new objects). */
export function applyOffers(reaches: Reach[], made: Array<{ reachId: string; offer: ReachOffer }>): Reach[] {
  if (!made.length) return reaches;
  const byId = new Map<string, ReachOffer[]>();
  for (const m of made) {
    const list = byId.get(m.reachId);
    if (list) list.push(m.offer); else byId.set(m.reachId, [m.offer]);
  }
  return reaches.map((r) => {
    const add = byId.get(r.id);
    return add ? { ...r, offers: [...r.offers, ...add] } : r;
  });
}

/**
 * Felt recognition: THIS is the one. The reach is filled but not removed — the
 * hole is the trace of how you came to it, and §27.0.2's whole point is that
 * the collision, not the entry, was the event.
 */
export function recognize(r: Reach, offerIndex: number, at: number): Reach {
  const o = r.offers[offerIndex];
  if (!o) throw new Error(`no offer at index ${offerIndex}`);
  const offers = r.offers.map((x, i) => (i === offerIndex ? { ...x, verdict: 'yes' as const } : x));
  return { ...r, offers, filled: { surface: o.surface, at, offerIndex } };
}

/** Not it. The offer is marked so the watcher never raises it again. */
export function reject(r: Reach, offerIndex: number): Reach {
  if (!r.offers[offerIndex]) throw new Error(`no offer at index ${offerIndex}`);
  return {
    ...r,
    offers: r.offers.map((x, i) => (i === offerIndex ? { ...x, verdict: 'no' as const } : x)),
  };
}

/** It was not a real hole after all. */
export function abandon(r: Reach, at: number): Reach {
  return { ...r, abandonedAt: at };
}

export interface ReachData { reaches: Reach[] }

/**
 * The store. Tiny by construction — a reach is a sentence and a handful of
 * offers — so unlike the dictionaries it genuinely belongs in the plugin blob.
 */
export class ReachStore {
  private items = new Map<string, Reach>();
  constructor(private saveFn: (data: ReachData) => Promise<void>) {}

  load(data: ReachData | undefined): void {
    this.items.clear();
    for (const r of data?.reaches ?? []) this.items.set(r.id, r);
  }

  private persist(): Promise<void> { return this.saveFn({ reaches: this.all() }); }

  /** Newest first; open reaches before closed ones — the hole is what you came for. */
  all(): Reach[] {
    return [...this.items.values()].sort((a, b) => {
      const ao = isOpen(a) ? 0 : 1, bo = isOpen(b) ? 0 : 1;
      return ao !== bo ? ao - bo : b.openedAt - a.openedAt;
    });
  }

  open(): Reach[] { return this.all().filter(isOpen); }
  byId(id: string): Reach | undefined { return this.items.get(id); }
  size(): number { return this.items.size; }

  async add(want: string, at: number, gloss?: string): Promise<Reach> {
    const r = openReach(want, at, gloss);
    this.items.set(r.id, r);
    await this.persist();
    return r;
  }

  private async put(r: Reach): Promise<Reach> {
    this.items.set(r.id, r);
    await this.persist();
    return r;
  }

  /** Run the watcher over what just arrived, and keep whatever it offered. */
  async watch(incoming: Incoming[], opts?: { juxtaposeLimit?: number }): Promise<number> {
    const made = collide(this.open(), incoming, opts);
    if (!made.length) return 0;
    for (const r of applyOffers(this.open(), made)) this.items.set(r.id, r);
    await this.persist();
    return made.length;
  }

  async recognizeOffer(id: string, i: number, at: number): Promise<Reach | undefined> {
    const r = this.items.get(id);
    return r ? this.put(recognize(r, i, at)) : undefined;
  }

  async rejectOffer(id: string, i: number): Promise<Reach | undefined> {
    const r = this.items.get(id);
    return r ? this.put(reject(r, i)) : undefined;
  }

  async abandonReach(id: string, at: number): Promise<Reach | undefined> {
    const r = this.items.get(id);
    return r ? this.put(abandon(r, at)) : undefined;
  }

  async remove(id: string): Promise<void> {
    if (this.items.delete(id)) await this.persist();
  }
}

/** Counts for a header line. `waiting` = open reaches with an unjudged offer. */
export function reachStats(reaches: Reach[]): { open: number; filled: number; waiting: number; offers: number } {
  let open = 0, filled = 0, waiting = 0, offers = 0;
  for (const r of reaches) {
    if (r.filled) filled++;
    else if (isOpen(r)) {
      open++;
      if (r.offers.some((o) => !o.verdict)) waiting++;
    }
    offers += r.offers.length;
  }
  return { open, filled, waiting, offers };
}
