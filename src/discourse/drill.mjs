/**
 * drill.mjs — next-move prediction, built so it can actually FALSIFY something.
 *
 * DISCOURSE-VERDICT.md §4 measured the previous drill and found it inert: the
 * option set was built by inserting the ANSWER first and topping up from a
 * fixed-order affordance list, so the answer *displaced the tail of an almost
 * constant prefix* and membership of the option set leaked it. Re-measured
 * 2026-08-01 on today's code: 11 / 14 distinct option-sets across an entire
 * file, and 65.4% (nenko) / 70.7% (imiron) winnable by reading ONLY the four
 * labels — no board, no Japanese — against 25% for random guessing. Tells were
 * fully deterministic (one set answered RATIFY 81/81).
 *
 * The constitution's whole acceptance criterion is "if reading the board does
 * not let a learner predict the next move, the theory is wrong." With a leaky
 * instrument that criterion cannot return a result in EITHER direction, which
 * is why the parser question kept being argued rather than settled.
 *
 * Three defects, three fixes, all enforced here and asserted in
 * golden/drill.mjs:
 *
 *  1. LEAK — the option set is now a pure function of the BOARD STATE and never
 *     of the answer. `drillOptions()` cannot see the answer; it is not passed
 *     in. A freeze point whose answer falls outside the state-derived option set
 *     is DROPPED, not patched by inserting the answer (which is precisely how
 *     the leak was born). Drops are counted and reported, never silent.
 *
 *  2. HORIZON — "the next move" now means within `HORIZON_TURNS` turns, not the
 *     next drillable move at any distance. Previously the median answer was 10–20 s
 *     ahead and up to 30% of freeze points had theirs more than 30 s in the
 *     future, which is not next-move prediction by any reading.
 *
 *  3. NO BASELINE — `drillBaseline()` computes what is winnable from the option
 *     labels alone, so a score is never shown without the number that says how
 *     much of it is free. An instrument that cannot report its own floor is not
 *     an instrument.
 *
 * PURE — no Obsidian, no I/O, byte-deterministic (no Date.now, no Math.random).
 * The view supplies board-derived inputs and renders; all drill logic is here.
 */

/** Moves worth drilling — they move CG / Projected / QUD. PROPOSE and
 *  ACKNOWLEDGE are the noise floor and are never the answer. */
export const DRILLABLE = new Set([
  'CONSCRIPT', 'GRANT', 'REJECT', 'RATIFY', 'RELATE_CONTRAST', 'SUBSTITUTE',
  'RETRACT_OWN', 'DENY_COMMITMENT', 'RE_TYPE', 'PROJECT_CONSEQUENCE',
  'ASSERT_AS_DERIVED', 'SHELVE_QUD', 'RESUME_QUD',
]);

/** "Next move" = within this many turns of the freeze point. §4 defect 2. */
export const HORIZON_TURNS = 2;
/** Secondary guard for wall-clock: a 2-turn gap can still be a long silence. */
export const HORIZON_SEC = 45;
/** A question with one option is not a question; more than six is a menu. */
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

/** FNV-1a → a stable 32-bit seed from board-side facts only. */
function seedOf(...parts) {
  let h = 2166136261;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** mulberry32 — small, deterministic, good enough to break a fixed prefix. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, seed) {
  const out = [...list];
  const rand = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The option set for one freeze point — **the answer is deliberately not a
 * parameter.** That is the whole fix for §4 defect 1, and it is enforced by the
 * signature rather than by care: this function is incapable of leaking a value
 * it never receives.
 *
 * `afforded` is `affordances(board, nextSpeaker)` mapped to primitive names, so
 * the option set is a genuine read-out of what the board makes available. The
 * shuffle is seeded from board-side identifiers so it is deterministic per
 * freeze point but varies across them — that is what breaks the near-constant
 * prefix that produced the old tells.
 */
export function drillOptions(afforded, seed, max = MAX_OPTIONS) {
  const pool = [...new Set(afforded)].filter((p) => DRILLABLE.has(p));
  if (pool.length < MIN_OPTIONS) return [];
  // Sort first so the input's own ordering cannot survive into the sample.
  const picked = shuffled([...pool].sort(), seed).slice(0, Math.min(max, pool.length));
  return picked.sort();               // canonical display order — position leaks nothing
}

/**
 * Every legitimate freeze point in a folded transcript.
 *
 * Inputs are all board-side and index-aligned:
 *   turns  — the reducer's input turns  [{ speaker, text, tSec }]
 *   snaps  — `board.turns` snapshots, 1:1 with `turns`, each carrying `prims`
 *   afford — Map turnIdx → afforded primitive names facing THAT turn's speaker
 *
 * Returns `{ cases, dropped }`. `dropped` is itemised because a drill that
 * silently discards the freeze points it finds inconvenient would misreport its
 * own coverage — the same failure this file exists to end.
 */
export function buildDrillCases({ turns, snaps, afford }, opts = {}) {
  const horizonTurns = opts.horizonTurns ?? HORIZON_TURNS;
  const horizonSec = opts.horizonSec ?? HORIZON_SEC;
  const max = opts.maxOptions ?? MAX_OPTIONS;
  const cases = [];
  const dropped = { noMove: 0, tooFar: 0, thinOptions: 0, answerNotAfforded: 0 };

  for (let i = 0; i < turns.length - 1; i++) {
    const atSec = turns[i]?.tSec ?? null;

    // 1. The answer must live within the horizon. §4 defect 2.
    let j = -1, answer = null;
    for (let k = i + 1; k <= Math.min(i + horizonTurns, turns.length - 1); k++) {
      const hit = (snaps[k]?.prims ?? []).find((p) => DRILLABLE.has(p));
      if (hit) { j = k; answer = hit; break; }
    }
    if (j < 0) { dropped.noMove++; continue; }

    const ansSec = turns[j]?.tSec ?? null;
    if (atSec != null && ansSec != null && ansSec - atSec > horizonSec) { dropped.tooFar++; continue; }

    // 2. Options from board state ALONE — the answer is not in scope here.
    const options = drillOptions(afford.get(j) ?? [], seedOf(i, j, ansSec ?? '', turns[j]?.speaker ?? ''), max);
    if (options.length < MIN_OPTIONS) { dropped.thinOptions++; continue; }

    // 3. Answer outside the state-derived set → DROP. Never patch it in.
    if (!options.includes(answer)) { dropped.answerNotAfforded++; continue; }

    cases.push({
      freezeIdx: i, answerIdx: j, atSec, answerSec: ansSec,
      answerPrim: answer,
      speaker: turns[j]?.speaker ?? '',
      text: turns[j]?.text ?? '',
      options,
      gapTurns: j - i,
      gapSec: atSec != null && ansSec != null ? ansSec - atSec : null,
    });
  }
  return { cases, dropped };
}

/**
 * What is winnable WITHOUT understanding — the numbers that say whether a score
 * means anything. §4 defect 3.
 *
 * Three floors, because one is not enough and the obvious one is a trap:
 *
 *   chance    — mean 1/K. What blind guessing gets.
 *   marginal  — always answer the single most common primitive in the whole
 *               file. ONE free parameter, so it cannot overfit. This is the
 *               floor that matters: if the move distribution is skewed, a
 *               learner can score well by knowing nothing but the base rate.
 *   optionOnly— what the option SET adds on top, measured leave-one-out: each
 *               case is predicted from the OTHER cases sharing its option set,
 *               falling back to the marginal when the set is unique.
 *
 * The naive version of `optionOnly` — group by set, count the modal answer,
 * divide — is what this function computed first, and it reported 92% on a file
 * with 89 distinct sets over 113 cases. That is ~89 parameters fitted to 113
 * points: memorisation reported as a baseline. Leave-one-out is the fix, and
 * the trap is documented here because the naive number is superficially the
 * more alarming one and would have been believed.
 */
export function drillBaseline(cases) {
  const empty = { n: 0, distinctSets: 0, optionOnly: 0, marginal: 0, chance: 0, topPrim: null, tells: [] };
  if (!cases.length) return empty;

  const bySet = new Map();
  const overall = new Map();
  let chance = 0;
  for (const c of cases) {
    const key = c.options.join(',');
    if (!bySet.has(key)) bySet.set(key, []);
    bySet.get(key).push(c.answerPrim);
    overall.set(c.answerPrim, (overall.get(c.answerPrim) ?? 0) + 1);
    chance += 1 / c.options.length;
  }
  const [topPrim, topN] = [...overall].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];

  // Leave-one-out: predict each case from the others sharing its option set.
  let hits = 0;
  for (const c of cases) {
    const peers = bySet.get(c.options.join(','));
    const freq = new Map();
    for (const a of peers) freq.set(a, (freq.get(a) ?? 0) + 1);
    freq.set(c.answerPrim, (freq.get(c.answerPrim) ?? 0) - 1);   // hold this one out
    const ranked = [...freq].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const guess = ranked.length ? ranked[0][0] : topPrim;        // unique set → base rate
    if (guess === c.answerPrim) hits++;
  }

  // A "tell" is a set that always resolves the same way on ≥5 occurrences.
  const tells = [];
  for (const [key, answers] of bySet) {
    if (answers.length < 5) continue;
    const uniq = new Set(answers);
    if (uniq.size === 1) tells.push({ options: key, prim: answers[0], n: answers.length });
  }

  return {
    n: cases.length,
    distinctSets: bySet.size,
    optionOnly: hits / cases.length,
    marginal: topN / cases.length,
    chance: chance / cases.length,
    topPrim,
    tells: tells.sort((a, b) => b.n - a.n),
  };
}

/** The case at or after a playback position — what the 予測 button asks for. */
export function caseAtOrAfter(cases, posSec) {
  if (posSec == null) return cases[0] ?? null;
  return cases.find((c) => (c.atSec ?? -1) >= posSec) ?? null;
}
