/**
 * frames.ts — ONE frame key space, shared by the dictionary and the catalog.
 *
 * This is the file that decides whether the dictionary work merges with the
 * plugin or sits beside it (DESIGN §28 S5: one road in). The observation it
 * rests on:
 *
 *   Eijiro already writes the plugin's slot notation.
 *     "$__ in arrears"                        → ＿ in arrears        (numeric slot)
 *     "$__ ... taken off your ~ purchase"     → both slot kinds, in one sentence
 *     "be ～" / "a ～" / "the ～" labels        → the frame's syntactic shape
 *   and the user writes the same thing by hand as 🟠 skeletal links and
 *   💠 phrase schemas (`[X]というところで納得している`).
 *
 * If those live in two key spaces they are two products. Normalized into one,
 * a word finds every frame it lives in, a frame finds its fillers across BOTH
 * strata (lived attestations and curated senses), and a phrase you *heard* can
 * reach a frame whose filler differs — which is §27.2's production index and
 * the thing §27.0.1 means by "reach-for, not look-up."
 *
 * It also answers the demand the manifesto did not cover: **an example sentence
 * is indexable with its word taken out.** `gapFrame(sentence, word)` produces
 * the frame; the frame is the key; the original sentence stays as the filler.
 *
 * PURE — no Obsidian, no store, no I/O. Golden: golden/frames.mjs.
 */

/** The canonical slot markers. Everything normalizes to these two. */
export const SLOT_ANY = '～';   // a thing / phrase slot   (Eijiro ~, ～, 〜)
export const SLOT_NUM = '＿';   // a numeric slot          (Eijiro __, ＿)

/** What a slot can be filled by — kept because it changes how a frame reads. */
export type SlotKind = 'any' | 'num';

export interface FrameSlot {
  kind: SlotKind;
  /** index into the normalized frame string. */
  at: number;
}

export interface Frame {
  /** normalized, canonical — THE key. Compare frames only by this. */
  key: string;
  slots: FrameSlot[];
  /** true when the frame carries no slot at all (a fixed surface, not a frame). */
  fixed: boolean;
  /** syntactic shape when the source declared one (Eijiro's be ～ / a ～). */
  shape?: string;
}

/**
 * Fold the many ways a slot gets written into the two canonical markers.
 * Eijiro uses ASCII `~` and `__`; the user writes `～`/`〜` and `＿`; older
 * captures used `○○` and `X`. A frame key that does not fold these is a frame
 * key that silently splits the same frame into four entries.
 */
export function normalizeFrame(input: string): string {
  // NFKC first — note this already folds fullwidth ＿ to ASCII `_` and ～ to ~,
  // so every rule below must be written against the ASCII forms.
  let s = String(input ?? '').normalize('NFKC');
  // numeric slots: `$__`, `$_`, `__`, `_` all mean "a number goes here".
  s = s.replace(/\$?_+/g, SLOT_NUM);
  // any-slots: ASCII tilde, wave dash, and the ○○ / □□ capture conventions
  s = s.replace(/[~〜～]/g, SLOT_ANY);
  s = s.replace(/[○◯]{2,}|[□]{2,}/g, SLOT_ANY);
  // bracketed alternatives are display, not structure: 割引[値引き] → 割引
  s = s.replace(/\[[^\]]*\]/g, '');
  // Eijiro emits its frame label span TWICE ("a ～ a ～1人当たり"). Collapse an
  // immediately-repeated label so the key is not doubled — this is a source
  // rendering artifact, not two slots.
  s = s.replace(new RegExp(`^(\\S{0,4}\\s?[${SLOT_ANY}${SLOT_NUM}])\\s*\\1`), '$1');
  // collapse runs of the same slot; a frame never means "two slots in a row"
  s = s.replace(new RegExp(`${SLOT_ANY}\\s*${SLOT_ANY}+`, 'g'), SLOT_ANY);
  s = s.replace(new RegExp(`${SLOT_NUM}\\s*${SLOT_NUM}+`, 'g'), SLOT_NUM);
  return s.replace(/\s+/g, ' ').trim();
}

/** Parse a (possibly un-normalized) surface into a Frame. */
export function toFrame(input: string, shape?: string): Frame {
  const key = normalizeFrame(input);
  const slots: FrameSlot[] = [];
  for (let i = 0; i < key.length; i++) {
    if (key[i] === SLOT_ANY) slots.push({ kind: 'any', at: i });
    else if (key[i] === SLOT_NUM) slots.push({ kind: 'num', at: i });
  }
  return { key, slots, fixed: slots.length === 0, ...(shape ? { shape } : {}) };
}

/**
 * THE example-sentence demand: take the word OUT and keep the sentence.
 *
 * `gapFrame('関係が破綻していた', '破綻')` → `関係が～していた`
 *
 * Indexing the result means a sentence is findable by its shape rather than by
 * its content word — so 「関係が破綻した」 and 「交渉が破綻した」 land on the same
 * frame, which is exactly what a learner needs to see to reach for it. The
 * original sentence is never destroyed; it stays as the frame's filler.
 *
 * Returns null when the word is not present — a frame invented from a sentence
 * that does not contain the word would be a lie.
 */
export function gapFrame(sentence: string, word: string, kind: SlotKind = 'any'): string | null {
  const s = String(sentence ?? '');
  const w = String(word ?? '');
  if (!w || !s.includes(w)) return null;
  const marker = kind === 'num' ? SLOT_NUM : SLOT_ANY;
  // Gap EVERY occurrence: a sentence using the word twice is one frame with
  // two slots, not a frame that still contains the word it is supposed to hide.
  return normalizeFrame(s.split(w).join(marker));
}

/**
 * All the frames one attested sentence contributes, given the words known to
 * occur in it. Used to index lived attestations into the same space as the
 * dictionary's frames.
 */
export function framesOfSentence(sentence: string, words: string[]): Array<{ word: string; frame: string }> {
  const out: Array<{ word: string; frame: string }> = [];
  const seen = new Set<string>();
  for (const w of words) {
    const f = gapFrame(sentence, w);
    if (!f || seen.has(f)) continue;
    seen.add(f);
    out.push({ word: w, frame: f });
  }
  return out;
}

/**
 * Does a concrete surface realize a frame? Used to find a heard phrase's frame
 * even when the filler differs from every recorded one.
 *
 * Slot-aware and anchored: `～が破綻する` matches 「関係が破綻する」 but not
 * 「破綻する」 (an empty filler is not a filler) and not a substring of a
 * larger unrelated string at the edges.
 */
export function frameMatches(frame: string, surface: string): boolean {
  const f = normalizeFrame(frame);
  const s = String(surface ?? '').normalize('NFKC').trim();
  if (!f) return false;
  const parts = f.split(new RegExp(`[${SLOT_ANY}${SLOT_NUM}]`));
  if (parts.length === 1) return f === s;                 // fixed surface
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // a slot must swallow at least one character — that is what makes it a slot
  const re = new RegExp('^' + parts.map(esc).join('(.+?)') + '$');
  return re.test(s);
}

/**
 * Fillers a surface supplies for a frame's slots, or null if it does not match.
 * The fillers are what a 🟠 entry's leaves are (§7 orange data model).
 */
export function fillersOf(frame: string, surface: string): string[] | null {
  const f = normalizeFrame(frame);
  const s = String(surface ?? '').normalize('NFKC').trim();
  const parts = f.split(new RegExp(`[${SLOT_ANY}${SLOT_NUM}]`));
  if (parts.length === 1) return f === s ? [] : null;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp('^' + parts.map(esc).join('(.+?)') + '$').exec(s);
  return m ? m.slice(1) : null;
}

/**
 * Shape → class hint, per §27.3. PURE and shape-only — a suggestion the human
 * tests decide on, never a verdict (§13.3/§15), and never 🔴: responsivity is
 * dialogic and cannot be read off a dictionary entry.
 */
export function classHintForFrame(frame: Frame, opts: { situation?: boolean; evocativeHead?: boolean } = {}):
  'collocation' | 'skeletal' | 'phrase_schema' | 'rhet_collocation' {
  if (opts.evocativeHead) return 'rhet_collocation';
  // a 〔situation〕-framed whole with a slot is a schema: the situation IS the
  // frame's condition of use (§27.1 property 2)
  if (opts.situation && frame.slots.length) return 'phrase_schema';
  if (frame.slots.length >= 2) return 'phrase_schema';
  if (frame.slots.length === 1) return frame.shape ? 'skeletal' : 'phrase_schema';
  return 'collocation';
}
/**
 * TWO classes a dictionary can never assert, and why:
 *   🔴 discourse — responsivity is dialogic; it needs a prior turn to exist.
 *   🟡 serifu    — the citation test is "someone actually SAID this, quotably."
 *                  A gloss is not an utterance. 🟡 is earned by LIVED capture
 *                  only. (Emitting it from shape alone labelled 8,087 of one
 *                  10k bank 🟡 — every multi-word English headword — which is
 *                  how this was caught.)
 */
export const DICT_FORBIDDEN_HINTS = ['discourse', 'serifu'] as const;
