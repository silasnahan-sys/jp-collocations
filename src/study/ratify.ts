/**
 * ratify.ts — ratification as a BYPRODUCT of study (AUDIT-2026-08-01 §6.5,
 * punch-list #8: "the single highest-leverage build in the entire plugin").
 *
 * ## The problem, measured
 *
 * `golden/precision/samples.jsonl` holds 112 rows and **zero are ratified**.
 * The catalog holds **17,891 suggested attestations against 239 confirmed and
 * 1 rejected**. Every precision number this project has produced is therefore
 * the model grading its own output.
 *
 * Ratification-as-homework has never completed and never will: it is a separate
 * chore, entered deliberately, with no reward at the moment of the decision.
 * Two more findings say the fix is not "a better queue":
 *
 *   1. **The queue is not clearable and was never meant to be.** 28 entries hold
 *      17,823 of those 17,891 sightings — 「ですね」 alone has 3,565. A particle
 *      that occurs in every other sentence is not a thing you noticed, it is a
 *      thing the language does. `lexicon/context-tree.ts` already drew that line
 *      (`PROFILE_MIN`): past it the honest question stops being "is this one
 *      real" and becomes "what does this word DO".
 *   2. **What is actually open is small.** ~32 move claims (each settling
 *      hundreds of sightings), 255 unratified classes, 68 individual sightings.
 *      That is ~355 discrete judgements — weeks of ordinary study, not an
 *      afternoon of chore.
 *
 * ## The design
 *
 * The review session IS the ratification instrument. At the instant the learner
 * grades a card they have just reconstructed what the pattern means and how it
 * is used — the most expensive cognitive work in the whole loop, already paid
 * for. One judgement, on that same pattern, costs one keystroke there and would
 * cost a context switch anywhere else.
 *
 * So: **at most ONE probe per graded card.** Never a queue, never a modal, never
 * a blocker — the probe is offered after the grade and any key that advances the
 * card still advances it.
 *
 * ## Why `pick` exists (the trap this module is built around)
 *
 * The obvious ordering is to ask about the *most uncertain* candidate first —
 * that is what an active learner wants. It is also exactly what makes the
 * resulting precision number a lie: a sample drawn by uncertainty is biased
 * downward, and reporting it as "sweep precision" would understate the sweep by
 * an unknown amount. The naive number would look alarming and would be believed.
 *
 * Every row therefore records **why it was asked**. One in `MEASUREMENT_EVERY`
 * sighting probes is drawn uniformly at random (the measurement stratum) and the
 * rest by uncertainty (the learning stratum). `report()` computes precision from
 * the random stratum ALONE, carries a Wilson interval so the number arrives with
 * its own uncertainty, and refuses to state a percentage below
 * `MIN_FOR_PRECISION` instead of printing a meaningless one.
 *
 * PURE — no Obsidian, no I/O, no Date.now(); callers pass `now`.
 * Golden-tested in golden/ratify.mjs.
 */

import type { PatternEntry, Attestation } from '../notes/pattern-store.ts';
import { attestationKey } from '../notes/pattern-store.ts';
import { NOTE_TYPES, type NoteClass } from '../notes/note-types.ts';
import { dominantMove } from '../lexicon/context-tree.ts';

// ── the ledger ───────────────────────────────────────────────────────────────

/**
 * What was judged. Five kinds, one ledger — the point of §6.5 is that "no
 * amount of parser work can be *evaluated*" until every judgement the user
 * makes lands somewhere a measurement can read.
 *
 *   sighting  — is this occurrence really an instance of the pattern?
 *   move      — does this form mostly perform the move the concordance says?
 *   class     — is this 🔵/🟠/💠/🟢/🟡/🔴?
 *   drill     — the learner's answer vs. the calculus's, at a freeze point.
 *   component — a 談話モード pill accept/reject (§23 layer 2), mirrored here.
 */
export type RatifyKind = 'sighting' | 'move' | 'class' | 'drill' | 'component';

/** `skip` is a real answer ("I could not tell"), not an absence of one. */
export type Verdict = 'yes' | 'no' | 'skip';

/**
 * WHY this judgement was asked for. The single most important field in the row:
 * without it the ledger cannot distinguish a uniform sample from an
 * uncertainty-sampled one, and every precision number computed from it is
 * unfalsifiable.
 *
 *   random   — drawn uniformly from the pending set. THE measurement stratum.
 *   uncertain— drawn nearest the confidence midpoint. Biased low, on purpose.
 *   blocking — this judgement was gating something (an unratified class).
 *   offered  — the user came to it themselves (drill, 談話モード, 語彙 ✓/✕).
 */
export type PickReason = 'random' | 'uncertain' | 'blocking' | 'offered';

export type Surface = 'review' | 'drill' | 'lexicon' | 'discourse';

export interface Ratification {
  /** `kind:patternId:subject` — stable, so re-answering overwrites. */
  id: string;
  kind: RatifyKind;
  patternId: string;
  /** what was judged: an attestation key, a move id, a class, a case id. */
  subject: string;
  /** what the MACHINE claimed. The evaluation datum. */
  claim: string;
  verdict: Verdict;
  /** what the human said, when the answer is not yes/no (drill picks, retypes). */
  answer?: string;
  at: number;
  surface: Surface;
  pick: PickReason;
  /** how many sightings this ONE judgement settles (move claims cover hundreds). */
  covers: number;
  /** times this subject has been put to the user — see MAX_REASKS. */
  asks: number;
}

export interface RatifyData { rows: Record<string, Ratification> }

/**
 * A skipped probe is re-offered this many more times before it is left alone.
 *
 * わからない on first encounter is the normal case — it is *why* the probe is
 * tied to spaced repetition rather than to a queue. By the third review of a
 * card the same question is usually answerable, and a design that asked once
 * and gave up would throw away the judgement the whole schedule exists to ripen.
 * Decided rows (yes/no) are never re-asked.
 */
export const MAX_REASKS = 2;

/** One in this many sighting probes is drawn uniformly — the ONLY rows that may
 *  be called a precision measurement. */
export const MEASUREMENT_EVERY = 4;

/**
 * Below this many rows a proportion is not reported at all. A percentage from
 * 9 answers reads as a finding and is noise; refusing is the honest degrade.
 *
 * This floor is for measures whose POPULATION is large — sweep precision is a
 * claim about thousands of sightings, so a sample of nine says nothing about it.
 */
export const MIN_FOR_PRECISION = 20;

/**
 * The floor for measures whose whole population is small.
 *
 * There are ~32 move claims in the entire vault and a few hundred component
 * pills; demanding 20 of the former would mean the number is never reportable
 * even after two thirds of the population has been judged, which is a different
 * kind of dishonesty. Every proportion carries its Wilson interval, so a small n
 * arrives visibly small rather than silently weak.
 */
export const MIN_FOR_CLAIM = 5;

/** Sightings behind a move claim before the claim is worth putting to a human.
 *  Matches `lexicon/paradigm.ts` — this ratifies the claim the 語彙 shelf is
 *  ALREADY displaying as a family label, not a new one invented here. */
export const MOVE_MIN_SIGHTINGS = 8;
export const MOVE_MIN_SHARE = 0.5;

export const ratifyId = (kind: RatifyKind, patternId: string, subject: string): string =>
  `${kind}:${patternId}:${subject}`;

/**
 * The answer to a class probe that means "this entry should not exist".
 *
 * Measured on the real catalog: of the 255 entries still carrying a class
 * suggestion, a large share are ASR wreckage that was captured as if it were a
 * phrase — 「け情勢によって」, 「ー習慣が長くあると」, 「人間が落ち着く先が」. Asking
 * which of six classes those belong to is a question with no right answer, and
 * twenty such questions in a row is how a study loop gets abandoned. Disposal
 * is reached only by pressing ✕ and then choosing it, and it removes the entry
 * through the same `deletePattern` the 語彙 panel's 🗑 already uses — a new route
 * to an existing action, not a new power.
 */
export const DISPOSE = '__dispose__';

// ── the probe ────────────────────────────────────────────────────────────────

export interface Probe {
  id: string;
  kind: RatifyKind;
  patternId: string;
  subject: string;
  claim: string;
  /** the question, ready to render. */
  question: string;
  /** what ✓ means and what ✕ means — spelled out, never left to the button. */
  yes: string;
  no: string;
  /** real lines behind the claim. May be empty; never decorative. */
  evidence: string[];
  pick: PickReason;
  covers: number;
  /** how many times this subject has already been asked (0 on a first ask). */
  asks: number;
}

const JA_CLASS = (c: NoteClass): string => `${NOTE_TYPES[c].emoji} ${NOTE_TYPES[c].label}`;

/** FNV-1a — a deterministic stand-in for randomness, so the uniform draw is
 *  reproducible and the goldens can pin it. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Has this subject been settled? A decided verdict is final; a skip is not. */
export function decided(data: RatifyData, id: string): boolean {
  const r = data.rows[id];
  return !!r && r.verdict !== 'skip';
}

/** Should this subject still be put to the user? */
function askable(data: RatifyData, id: string): boolean {
  const r = data.rows[id];
  if (!r) return true;
  if (r.verdict !== 'skip') return false;
  return r.asks <= MAX_REASKS;
}

const asksOf = (data: RatifyData, id: string): number => data.rows[id]?.asks ?? 0;

/** Quote trimmed to something judgeable at a glance. A 400-character concordance
 *  window is not a question, it is a reading assignment. */
const EVIDENCE_CHARS = 90;
function evidenceOf(a: Attestation): string {
  const q = (a.quote ?? '')
    // the parenthesis has to go WITH the link — the sweep stores
    // `(https://youtu.be/x?t=65) そう。どうも…`, and stripping only the URL
    // leaves a dangling `(` at the head of every piece of evidence.
    .replace(/[（(]\s*https?:\/\/\S+?\s*[）)]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return q.length > EVIDENCE_CHARS ? q.slice(0, EVIDENCE_CHARS) + '…' : q;
}

/** Suggested sightings still open for judgement. */
export function pendingSightings(p: PatternEntry, data: RatifyData): Attestation[] {
  return p.attestations
    .filter((a) => a.status === 'suggested')
    .filter((a) => askable(data, ratifyId('sighting', p.id, attestationKey(a))));
}

// ── the three probe builders ─────────────────────────────────────────────────

/**
 * "Does this form mostly do X?" — ONE judgement settling every sighting behind
 * the claim. Only ever available for the handful of high-frequency forms, which
 * is exactly why it is asked first: a small queue worth hundreds each.
 */
/** Does this form have a corpus-backed claim about what it DOES — answered or
 *  not? Independent of the ledger: the claim's existence is what makes its
 *  sightings a distribution rather than a queue. */
export function hasClaim(p: PatternEntry): boolean {
  return dominantMove(p, { minSightings: MOVE_MIN_SIGHTINGS, minShare: MOVE_MIN_SHARE }) !== null;
}

function moveProbe(p: PatternEntry, data: RatifyData): Probe | null {
  const m = dominantMove(p, { minSightings: MOVE_MIN_SIGHTINGS, minShare: MOVE_MIN_SHARE });
  if (!m) return null;
  const id = ratifyId('move', p.id, m.move);
  if (!askable(data, id)) return null;
  const ev: string[] = [];
  const seen = new Set<string>();
  for (const a of p.attestations) {
    if (ev.length >= 3) break;
    if (a.status !== 'suggested') continue;
    if (!(a.matchKind ?? '').endsWith(':' + m.move)) continue;
    const q = evidenceOf(a);
    if (q.length < 6 || seen.has(q)) continue;
    seen.add(q); ev.push(q);
  }
  return {
    id, kind: 'move', patternId: p.id, subject: m.move, claim: m.label,
    question: `「${p.key}」は、あなたの字幕では主に【${m.label}】をしています。合っていますか？`,
    yes: `そう — ${m.count}件の見え方を確定`,
    no: 'ちがう — この分類は当てにならない',
    evidence: ev,
    pick: 'offered',
    covers: m.count,
    asks: asksOf(data, id),
  };
}

/** "Is this the right class?" — gates the matcher, the card shape and whether
 *  the entry is sweepable at all, so it is the cheapest high-consequence tap
 *  in the plugin. 255 of 303 entries are still carrying a suggestion. */
function classProbe(p: PatternEntry, data: RatifyData): Probe | null {
  if (p.classRatified) return null;
  const id = ratifyId('class', p.id, p.class);
  if (!askable(data, id)) return null;
  const ev = p.attestations.filter((a) => !a.status).slice(0, 2).map(evidenceOf).filter((q) => q.length >= 4);
  return {
    id, kind: 'class', patternId: p.id, subject: p.class, claim: p.class,
    question: `「${p.key}」の分類は ${JA_CLASS(p.class)} のままでいいですか？`,
    yes: 'そのまま確定',
    no: 'ちがう — 語彙で付け直す',
    evidence: ev,
    pick: 'blocking',
    covers: 1,
    asks: asksOf(data, id),
  };
}

/**
 * "Is this occurrence really the pattern?" — the classic ✓/✕, drawn by stratum.
 *
 * `seq` is the number of sighting probes already offered this session. It is the
 * ONLY thing deciding which stratum this draw comes from, which is what keeps
 * the split auditable rather than a matter of when the user happened to stop.
 */
function sightingProbe(p: PatternEntry, data: RatifyData, seq: number): Probe | null {
  const open = pendingSightings(p, data);
  if (!open.length) return null;
  const useRandom = seq % MEASUREMENT_EVERY === 0;
  // A form with a move claim is not a queue — settling that claim is what its
  // sightings needed, and re-offering 「ですね」's 3,565 one at a time afterwards
  // would rebuild the backlog the claim exists to replace. It stays SAMPLEABLE
  // though: those are the entries the sweep produced the most output for, and
  // excluding them entirely would leave precision measured only where the sweep
  // was quietest. So: draw from them on measurement turns, never as workload.
  if (!useRandom && hasClaim(p)) return null;
  let a: Attestation;
  if (useRandom) {
    const sorted = [...open].sort((x, y) => attestationKey(x).localeCompare(attestationKey(y)));
    a = sorted[fnv(`${p.id}#${seq}`) % sorted.length];
  } else {
    a = [...open].sort((x, y) =>
      Math.abs((x.confidence ?? 0.5) - 0.5) - Math.abs((y.confidence ?? 0.5) - 0.5)
      || attestationKey(x).localeCompare(attestationKey(y)))[0];
  }
  const key = attestationKey(a);
  const id = ratifyId('sighting', p.id, key);
  return {
    id, kind: 'sighting', patternId: p.id, subject: key,
    claim: a.matchKind ?? 'match',
    question: `これは「${p.key}」の実例ですか？`,
    yes: '実例 — 確定する',
    no: 'ちがう — 二度と出さない',
    evidence: [evidenceOf(a)].filter((q) => q.length > 0),
    pick: useRandom ? 'random' : 'uncertain',
    covers: 1,
    asks: asksOf(data, id),
  };
}

/**
 * At most one probe for the pattern just studied, in descending value:
 *
 *   move     — settles hundreds of sightings; only ~32 exist in the whole vault
 *   class    — settles how the entry is matched, carded and swept forever
 *   sighting — settles one occurrence
 *
 * Returns null when the pattern has nothing open, which is the common case and
 * must stay silent: a study session that pauses to say "nothing to ask" has
 * reintroduced the chore.
 */
export function nextProbe(
  p: PatternEntry,
  data: RatifyData,
  opts: { seq?: number; skipIds?: ReadonlySet<string> } = {},
): Probe | null {
  const seq = opts.seq ?? 0;
  const skip = opts.skipIds;
  const built = [moveProbe(p, data), classProbe(p, data), sightingProbe(p, data, seq)];
  for (const pr of built) {
    if (pr && !(skip && skip.has(pr.id))) return pr;
  }
  return null;
}

/** The row a probe becomes once answered. Callers supply `now`. */
export function answerOf(probe: Probe, verdict: Verdict, now: number, surface: Surface, answer?: string): Ratification {
  return {
    id: probe.id, kind: probe.kind, patternId: probe.patternId, subject: probe.subject,
    claim: probe.claim, verdict, at: now, surface, pick: probe.pick, covers: probe.covers,
    asks: probe.asks + 1,
    ...(answer ? { answer } : {}),
  };
}

/**
 * One drill answer as a ledger row.
 *
 * This is the judgement the plugin was ALREADY collecting and throwing away.
 * Every 予測 question freezes the board, shows options derived from board state
 * alone, and compares the learner's pick against the primitive the calculus
 * says fires next — a labelled disagreement, discarded the moment the panel
 * closed.
 *
 * It is recorded as `drill`, never as parser gold, because at a freeze point a
 * disagreement is usually the LEARNER and there is no third party to say which.
 * What the rows are good for is `drillSplits`: a claim the learner refuses the
 * same way over and over is a place to go and look.
 *
 * `scope` stands in for a pattern id — there is no pattern here, so the file the
 * case came from keys the row and keeps ids from colliding across videos.
 */
export function drillRow(
  scope: string, caseId: string, claim: string, picked: string, now: number,
): Ratification {
  return {
    id: ratifyId('drill', scope, caseId),
    kind: 'drill', patternId: scope, subject: caseId, claim,
    verdict: picked === claim ? 'yes' : 'no',
    answer: picked, at: now, surface: 'drill', pick: 'offered', covers: 1, asks: 1,
  };
}

/** One 談話モード component-pill verdict, mirrored into the ledger so a
 *  measurement reads ONE place (§6.5) instead of four separate stores. */
export function componentRow(
  file: string, key: string, kindClaim: string, accepted: boolean, now: number,
): Ratification {
  return {
    id: ratifyId('component', file, key),
    kind: 'component', patternId: file, subject: key, claim: kindClaim,
    verdict: accepted ? 'yes' : 'no',
    at: now, surface: 'discourse', pick: 'offered', covers: 1, asks: 1,
  };
}

// ── how much is open ─────────────────────────────────────────────────────────

export interface OpenCounts {
  move: number;
  /** sightings those move claims stand for — leverage, not workload. */
  covered: number;
  class: number;
  /** sightings on forms with NO live move claim: the genuinely one-at-a-time ones. */
  sighting: number;
  /** questions still to answer. NOT `covered` — that is what they settle. */
  total: number;
}

/**
 * What is still askable — the honest size of the job, which is the whole point.
 *
 * Sightings behind a form that HAS a live move claim are deliberately not
 * counted as individual work. That is `context-tree.ts`'s own doctrine
 * (`PROFILE_MIN`) applied to the count: 「ですね」's 3,565 suggestions are not
 * 3,565 questions, they are one question with 3,565 pieces of evidence, and a
 * home screen reading "17,891 to confirm" is precisely how a ✓/✕ surface
 * becomes one you never open again. Measured on the real catalog: 18,163 raw
 * versus 289 real questions, for the same coverage.
 */
export function openCounts(patterns: PatternEntry[], data: RatifyData): OpenCounts {
  let move = 0, covered = 0, cls = 0, sighting = 0;
  for (const p of patterns) {
    // Coverage keys on the CLAIM existing, not on it still being open —
    // answering "「ですね」 marks agreement" must not hand its 3,565 sightings
    // back as 3,565 questions the next time the count is taken.
    const claimed = hasClaim(p);
    const pend = pendingSightings(p, data).length;
    if (claimed) covered += pend; else sighting += pend;
    if (moveProbe(p, data)) move++;
    if (classProbe(p, data)) cls++;
  }
  return { move, covered, class: cls, sighting, total: move + cls + sighting };
}

/**
 * The single most valuable claim NOT reachable from the review deck.
 *
 * A pattern enters the deck only once it has a CONFIRMED attestation
 * (`pickAttestation` takes confirmed sightings only), so the 🔴 forms carrying
 * the concordance — whose material is entirely suggested — are never reviewed
 * and would never be probed. Those are exactly the entries holding the move
 * claims worth hundreds each: measured, 17 claims standing for ~17,800
 * sightings, all of them unreachable through the card loop.
 *
 * So when a graded card has nothing of its own to ask, the session falls back
 * to the best of these. It costs the "you just recalled this pattern" argument
 * — this one is about a different form — but it keeps the other half, which is
 * that the question arrives while the language is loaded and costs one key. A
 * separate surface for 17 questions would be a chore again.
 */
export function bestClaimProbe(patterns: PatternEntry[], data: RatifyData): Probe | null {
  let best: Probe | null = null;
  for (const p of patterns) {
    const mv = moveProbe(p, data);
    if (mv && (!best || mv.covers > best.covers)) best = mv;
  }
  return best;
}

// ── the readout ──────────────────────────────────────────────────────────────

/** Wilson score interval — a proportion reported without one invites reading
 *  9/10 as 90%. Returns [lo, hi] in 0–1. */
export function wilson(yes: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 1];
  const p = yes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return [Math.max(0, (centre - spread) / denom), Math.min(1, (centre + spread) / denom)];
}

export interface Proportion { n: number; yes: number; pct: number; lo: number; hi: number }

/** A proportion, or null when there is not enough of it to be one. */
export function proportion(yes: number, n: number, min = MIN_FOR_PRECISION): Proportion | null {
  if (n < min) return null;
  const [lo, hi] = wilson(yes, n);
  return { n, yes, pct: yes / n, lo, hi };
}

export interface RatifyReport {
  total: number;
  byKind: Record<RatifyKind, { yes: number; no: number; skip: number }>;
  /** THE precision number: sighting probes drawn uniformly at random. */
  sweepPrecision: Proportion | null;
  /** how many uniform draws exist, whether or not they clear the floor. */
  randomN: number;
  /** the uncertainty-sampled sightings, reported apart because they are biased
   *  LOW by construction and must never be pooled with the line above. */
  sweepBiased: Proportion | null;
  /** does the concordance's move label match what the user says the form does? */
  moveAgreement: Proportion | null;
  /** sightings settled by a ratified move claim — the leverage, stated. */
  moveCovers: number;
  /** class suggestions the user let stand. */
  classAgreement: Proportion | null;
  /**
   * Learner-vs-calculus agreement at drill freeze points. NOT parser accuracy:
   * at a freeze point a disagreement is usually the learner, and there is no
   * third party to say which. It is a disagreement RATE, and its use is to show
   * WHERE the two part company — see `drillSplits`.
   */
  drillAgreement: Proportion | null;
  /** the calculus's answers the learner most often refused, worst first. */
  drillSplits: Array<{ claim: string; answer: string; n: number }>;
  componentAgreement: Proportion | null;
}

const EMPTY = (): { yes: number; no: number; skip: number } => ({ yes: 0, no: 0, skip: 0 });

export function report(data: RatifyData): RatifyReport {
  const rows = Object.values(data.rows);
  const byKind: Record<RatifyKind, { yes: number; no: number; skip: number }> = {
    sighting: EMPTY(), move: EMPTY(), class: EMPTY(), drill: EMPTY(), component: EMPTY(),
  };
  for (const r of rows) byKind[r.kind][r.verdict]++;

  const decidedRows = rows.filter((r) => r.verdict !== 'skip');
  const slice = (k: RatifyKind, pick?: PickReason) =>
    decidedRows.filter((r) => r.kind === k && (pick === undefined || r.pick === pick));
  const prop = (rs: Ratification[], min = MIN_FOR_PRECISION) =>
    proportion(rs.filter((r) => r.verdict === 'yes').length, rs.length, min);

  const random = slice('sighting', 'random');
  const biased = decidedRows.filter((r) => r.kind === 'sighting' && r.pick !== 'random');

  const splits = new Map<string, { claim: string; answer: string; n: number }>();
  for (const r of decidedRows) {
    if (r.kind !== 'drill' || r.verdict !== 'no' || !r.answer) continue;
    const k = `${r.claim}→${r.answer}`;
    const e = splits.get(k) ?? { claim: r.claim, answer: r.answer, n: 0 };
    e.n++; splits.set(k, e);
  }

  return {
    total: rows.length,
    byKind,
    sweepPrecision: prop(random),
    randomN: random.length,
    sweepBiased: prop(biased),
    moveAgreement: prop(slice('move'), MIN_FOR_CLAIM),
    moveCovers: slice('move').filter((r) => r.verdict === 'yes').reduce((s, r) => s + r.covers, 0),
    classAgreement: prop(slice('class')),
    drillAgreement: prop(slice('drill')),
    drillSplits: [...splits.values()].sort((a, b) => b.n - a.n || a.claim.localeCompare(b.claim)).slice(0, 8),
    componentAgreement: prop(slice('component'), MIN_FOR_CLAIM),
  };
}
