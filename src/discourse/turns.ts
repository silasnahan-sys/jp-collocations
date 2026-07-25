/**
 * turns.ts — the pure turn model for 談話モード (DESIGN §23.4-2). PURE —
 * golden-tested in golden/turns.mjs against the real ゆる哲学ラジオ case.
 *
 * The turn grain is the SENTENCE, not the caption line: a single caption line
 * can hold a reaction cluster AND the floor returning (「うん。そこまで言う。
 * 急に…」). So a turn boundary is (line, char) — `char` is the offset into the
 * start line where the turn begins; absent/0 = line start, which is exactly
 * the persisted `_discourseSeg` format that already exists (backward
 * compatible: old segs are the char:0 special case).
 *
 * `applyComponentSplit` is the one-tap fix: tapping a §23.1 flip/return pill
 * splits the turn at that sentence boundary AND assigns the CA-suggested
 * speakers (reactions belong to the listener; after them the floor returns to
 * the pre-reaction speaker).
 */

export interface TurnRef {
  /** index into the stamped line list where this turn starts. */
  start: number;
  /** char offset into that line (sentence-grain boundaries); 0/absent = line start. */
  char?: number;
  speaker: string;
}

export interface LineLike { text: string; tStartSec?: number }

export const turnKey = (t: TurnRef): string => `${t.start}:${t.char ?? 0}`;

export function sortTurns(turns: TurnRef[]): TurnRef[] {
  return [...turns].sort((a, b) => a.start - b.start || (a.char ?? 0) - (b.char ?? 0));
}

/** Dedupe by (line,char), clamp to the line list, force a turn at 0:0. */
export function sanitizeTurns(turns: TurnRef[], lines: LineLike[]): TurnRef[] {
  const seen = new Set<string>();
  const ok = sortTurns(turns.filter((t) => {
    if (t.start < 0 || t.start >= lines.length) return false;
    const c = t.char ?? 0;
    if (c < 0 || c >= (lines[t.start]?.text.length ?? 0) && c !== 0) return false;
    const k = turnKey(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }));
  if (!ok.length || ok[0].start !== 0 || (ok[0].char ?? 0) !== 0) ok.unshift({ start: 0, speaker: 'A' });
  return ok;
}

/**
 * The per-line text slices of turn `ti` (first/last line sliced at char
 * boundaries — two boundaries on the same line yield one partial slice).
 * Returns the slices with their line indices so callers can render/tap lines.
 */
export function turnLineSlices(
  lines: LineLike[], turns: TurnRef[], ti: number,
): Array<{ line: number; text: string; partialStart: boolean }> {
  const t = turns[ti];
  if (!t) return [];
  const next = turns[ti + 1];
  const c0 = t.char ?? 0;
  const endLine = next ? ((next.char ?? 0) > 0 ? next.start : next.start - 1) : lines.length - 1;
  const out: Array<{ line: number; text: string; partialStart: boolean }> = [];
  for (let li = t.start; li <= Math.min(endLine, lines.length - 1); li++) {
    let text = lines[li]?.text ?? '';
    const from = li === t.start ? c0 : 0;
    const to = next && li === next.start && (next.char ?? 0) > 0 ? (next.char ?? 0) : text.length;
    text = text.slice(from, to);
    if (text) out.push({ line: li, text, partialStart: li === t.start && c0 > 0 });
  }
  return out;
}

/** The turn's full text (line slices joined with no separator — offsets into
 *  this string map back to (line,char) via locateInTurn). */
export function turnTextOf(lines: LineLike[], turns: TurnRef[], ti: number): string {
  return turnLineSlices(lines, turns, ti).map((s) => s.text).join('');
}

/** Map a char offset within turn `ti`'s text back to an absolute (line, char). */
export function locateInTurn(
  lines: LineLike[], turns: TurnRef[], ti: number, offset: number,
): { line: number; char: number } | null {
  let rest = offset;
  for (const s of turnLineSlices(lines, turns, ti)) {
    const base = s.line === turns[ti].start ? (turns[ti].char ?? 0) : 0;
    if (rest < s.text.length) return { line: s.line, char: base + rest };
    rest -= s.text.length;
  }
  return null;
}

// ── layer-3 relations (§23.4-5): drawn arrows between turns ────────────────────
// The skeleton-principle notation: → responds-to, ↳ extends, ↧ undercuts.
// Arrows are HUMAN-drawn (never suggested) — each one is layer-3 gold.

export type RelationType = '→' | '↳' | '↧';
export const RELATION_TYPES: readonly RelationType[] = ['→', '↳', '↧'];
export const RELATION_LABEL: Record<RelationType, string> = { '→': '応答', '↳': '展開', '↧': '切り崩し' };

/** One drawn arrow. Endpoints are turn identities — the (line,char) starts. */
export interface TurnRelation {
  from: { start: number; char?: number };
  to: { start: number; char?: number };
  type: RelationType;
  /** drawn when (epoch ms) — provenance for the gold record. */
  at: number;
}

const endKey = (e: { start: number; char?: number }): string => `${e.start}:${e.char ?? 0}`;
/** Identity of an arrow = its ordered endpoint pair (type is mutable). */
export const relationKey = (r: { from: TurnRelation['from']; to: TurnRelation['to'] }): string =>
  `${endKey(r.from)}>${endKey(r.to)}`;

/** Add an arrow (returns a NEW array). Self-arrows refused (null). Drawing the
 *  same from→to again RETYPES the existing arrow instead of duplicating. */
export function addRelation(
  rels: TurnRelation[], from: TurnRef, to: TurnRef, type: RelationType, at: number,
): TurnRelation[] | null {
  if (turnKey(from) === turnKey(to)) return null;
  const rel: TurnRelation = {
    from: { start: from.start, ...(from.char ? { char: from.char } : {}) },
    to: { start: to.start, ...(to.char ? { char: to.char } : {}) },
    type, at,
  };
  const key = relationKey(rel);
  const rest = rels.filter((r) => relationKey(r) !== key);
  return [...rest, rel];
}

export function removeRelation(rels: TurnRelation[], key: string): TurnRelation[] {
  return rels.filter((r) => relationKey(r) !== key);
}

export const cycleRelationType = (t: RelationType): RelationType =>
  RELATION_TYPES[(RELATION_TYPES.indexOf(t) + 1) % RELATION_TYPES.length];

/** Drop arrows whose endpoints no longer exist in the ratified turn set (a
 *  merged-away turn takes its arrows with it — they described that turn). */
export function sanitizeRelations(rels: TurnRelation[], turns: TurnRef[]): TurnRelation[] {
  const keys = new Set(turns.map(turnKey));
  return rels.filter((r) => keys.has(endKey(r.from)) && keys.has(endKey(r.to)));
}

// ── layer-4 readings (§23.4-6): human-only, perspectival, PLURAL ───────────────
// A turn holds many readings under different lenses without contradiction —
// blur is data, never one forced label. Machine never suggests here.

export type ReadingLens = 'micro' | 'macro' | 'meta' | 'thought';
export const READING_LENSES: readonly ReadingLens[] = ['micro', 'macro', 'meta', 'thought'];
export const LENS_LABEL: Record<ReadingLens, string> = { micro: '微視', macro: '巨視', meta: 'メタ', thought: '思考' };

export interface TurnReading { lens: ReadingLens; label: string; at: number }

/** Add a reading to a turn (keyed by turnKey). Returns a NEW map, or null on
 *  empty/duplicate (same lens + same label — different lenses NEVER collide). */
export function addReading(
  map: Record<string, TurnReading[]>, key: string, lens: ReadingLens, label: string, at: number,
): Record<string, TurnReading[]> | null {
  const t = label.trim();
  if (!t) return null;
  const cur = map[key] ?? [];
  if (cur.some((r) => r.lens === lens && r.label === t)) return null;
  return { ...map, [key]: [...cur, { lens, label: t, at }] };
}

export function removeReading(
  map: Record<string, TurnReading[]>, key: string, lens: ReadingLens, label: string,
): Record<string, TurnReading[]> {
  const next = (map[key] ?? []).filter((r) => !(r.lens === lens && r.label === label));
  const out = { ...map };
  if (next.length) out[key] = next;
  else delete out[key];
  return out;
}

/** Readings of merged-away turns are dropped with their turn (same contract
 *  as relations — they described THAT turn). */
export function sanitizeReadings(
  map: Record<string, TurnReading[]>, turns: TurnRef[],
): Record<string, TurnReading[]> {
  const keys = new Set(turns.map(turnKey));
  const out: Record<string, TurnReading[]> = {};
  for (const [k, v] of Object.entries(map)) if (keys.has(k) && v.length) out[k] = v;
  return out;
}

/** The "other voice" relative to a speaker letter (flip suggestions). */
export const flipOf = (speaker: string): string => (speaker === 'A' ? 'B' : 'A');

/** Insert a boundary at `offset` into turn `ti`; tail gets `speaker` (default:
 *  the other voice). Returns a NEW sorted array, or null if the offset is not
 *  strictly inside the turn. */
export function splitTurnAt(
  lines: LineLike[], turns: TurnRef[], ti: number, offset: number, speaker?: string,
): TurnRef[] | null {
  if (offset <= 0) return null;
  const total = turnTextOf(lines, turns, ti).length;
  if (offset >= total) return null;
  const at = locateInTurn(lines, turns, ti, offset);
  if (!at) return null;
  const boundary: TurnRef = { start: at.line, ...(at.char ? { char: at.char } : {}), speaker: speaker ?? flipOf(turns[ti].speaker) };
  const key = turnKey(boundary);
  if (turns.some((t) => turnKey(t) === key)) return null;
  return sortTurns([...turns.map((t) => ({ ...t })), boundary]);
}

/**
 * The one-tap component fix (§23.4-2). `unitStart` is the char offset of the
 * tapped sentence unit within the turn's text.
 *
 *  - aizuchi/reaction (listener-shaped): the marked unit belongs to the OTHER
 *    voice. At the turn head → relabel the whole turn as the listener (other
 *    than the previous turn's speaker); mid-turn → split, tail = other voice.
 *  - return: the floor goes BACK to the pre-reaction speaker. Split at the
 *    unit; the reaction head is relabelled as the listener, the tail resumes
 *    the previous turn's speaker. This is the うん。そこまで言う。急に… case
 *    fixed in one tap.
 *
 * Returns a NEW array, or null when there is nothing to change.
 */
export function applyComponentSplit(
  lines: LineLike[], turns: TurnRef[], ti: number,
  unitStart: number, kind: 'aizuchi' | 'reaction' | 'return' | 'echo',
): TurnRef[] | null {
  if (kind === 'echo') return null; // echo is a capture, not a boundary
  const prevSpeaker = ti > 0 ? turns[ti - 1].speaker : null;
  const cur = turns[ti];
  if (!cur) return null;
  const listener = flipOf(prevSpeaker ?? flipOf(cur.speaker));
  if (kind === 'return') {
    if (unitStart <= 0) return null;
    const floor = prevSpeaker ?? cur.speaker;
    const split = splitTurnAt(lines, turns, ti, unitStart, floor);
    if (!split) return null;
    // the head (the reaction cluster) belongs to the listener
    const headKey = turnKey(cur);
    return split.map((t) => (turnKey(t) === headKey ? { ...t, speaker: listener } : t));
  }
  // aizuchi / reaction
  if (unitStart <= 0) {
    if (cur.speaker === listener) return null;
    return turns.map((t, i) => (i === ti ? { ...t, speaker: listener } : { ...t }));
  }
  return splitTurnAt(lines, turns, ti, unitStart, flipOf(cur.speaker));
}
