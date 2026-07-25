/**
 * speak-session.ts — 発話セッション (DESIGN §25.5). PURE model + store —
 * golden/follow.mjs.
 *
 * The user's なりきりスピーキング practice, held by the tool so the head
 * holds only the language: mode + constraint + role are structure; during
 * the session only marks exist (📍 note / 🎤 spoke-here); ratings are
 * per-bout 0–4 on the USER'S aspects (editable data — the user doubts the
 * rubric himself, so the schema stores aspect-id + value and nothing
 * entrenches the method); points = sum of rating values, toward the goal.
 *
 * Every rated 🎤 mark is a production-gold record by construction: the
 * transcript context at tSec + the role + the ratings live in the session,
 * and the actual next turn is recoverable from the transcript file. §24's
 * future fuel, collected as a side effect of practice.
 */

export type SpeakMode = 'narikiri' | 'rannyu' | 'jiyu' | 'shunpatsu';

export const SPEAK_MODES: Array<{ id: SpeakMode; label: string; hint: string }> = [
  { id: 'narikiri', label: 'なりきり', hint: '話者の役を取り、その人の番で答える' },
  { id: 'rannyu', label: '乱入', hint: '自分として反応・参加する' },
  { id: 'jiyu', label: '自由', hint: '内容へのオープンな応答' },
  { id: 'shunpatsu', label: '瞬発', hint: 'ライトニング — 短く速く' },
];

export interface SpeakConstraint {
  kind: 'none' | 'timer' | 'counter';
  /** timer: allotted seconds per bout. */
  seconds?: number;
  /** counter: the session's point goal (points come from RATINGS). */
  goalPoints?: number;
}

/** The user's own aspects (2026-07-19) — seed DATA, editable in settings. */
export const DEFAULT_ASPECTS: string[] = [
  '一貫性', '文脈適合', '独自の寄与', '簡潔さ', '正確さ', '一発で言えたか',
];

export interface SessionMark {
  id: string;
  /** 📍 note-mark (capture intent) | 🎤 speak-mark (a production bout). */
  kind: 'note' | 'speak';
  /** transcript position of the turn (absent when unsynced). */
  tSec?: number;
  lineIndex?: number;
  /** the marked line's text, frozen — the debrief's anchor even if the file moves. */
  lineText?: string;
  seed?: string;
  /** 🎤 only: per-aspect 0–4 (aspect name → value). */
  ratings?: Record<string, number>;
  at: number;
}

export interface SpeakSession {
  id: string;
  file: string;
  mode: SpeakMode;
  constraint: SpeakConstraint;
  /** なりきり: the speaker letter whose slot is taken. */
  role?: string;
  /** frozen copy of the aspect list at session start (the rubric may evolve). */
  aspects: string[];
  startedAt: number;
  endedAt?: number;
  marks: SessionMark[];
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export function newSession(opts: {
  file: string; mode: SpeakMode; constraint: SpeakConstraint; role?: string;
  aspects: string[]; now: number;
}): SpeakSession {
  return {
    id: `spk-${fnv(`${opts.file}|${opts.now}`)}`,
    file: opts.file,
    mode: opts.mode,
    constraint: opts.constraint,
    role: opts.role,
    aspects: [...opts.aspects],
    startedAt: opts.now,
    marks: [],
  };
}

export function newMark(opts: {
  kind: 'note' | 'speak'; tSec?: number; lineIndex?: number; lineText?: string;
  seed?: string; now: number;
}): SessionMark {
  return {
    id: `smk-${fnv(`${opts.kind}|${opts.lineIndex ?? -1}|${opts.now}`)}`,
    kind: opts.kind,
    tSec: opts.tSec,
    lineIndex: opts.lineIndex,
    lineText: opts.lineText,
    seed: opts.seed,
    at: opts.now,
  };
}

/** Sum of every rating value across 🎤 marks — "make my way to 30". */
export function sessionPoints(s: SpeakSession): number {
  let pts = 0;
  for (const m of s.marks) {
    if (m.kind !== 'speak' || !m.ratings) continue;
    for (const v of Object.values(m.ratings)) pts += v;
  }
  return pts;
}

export function speakMarks(s: SpeakSession): SessionMark[] {
  return s.marks.filter((m) => m.kind === 'speak');
}

// ── the store (`_speakSessions` blob key, persistence injected) ──────────────

export interface SpeakData { sessions: SpeakSession[] }

export class SpeakStore {
  private sessions = new Map<string, SpeakSession>();
  private saveFn: (data: SpeakData) => Promise<void>;

  constructor(saveFn: (data: SpeakData) => Promise<void>) {
    this.saveFn = saveFn;
  }

  load(data: SpeakData | undefined): void {
    this.sessions.clear();
    for (const s of data?.sessions ?? []) this.sessions.set(s.id, s);
  }

  private persist(): Promise<void> {
    return this.saveFn({ sessions: this.all() });
  }

  all(): SpeakSession[] {
    return [...this.sessions.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  forFile(file: string): SpeakSession[] {
    return this.all().filter((s) => s.file === file);
  }

  async upsert(s: SpeakSession): Promise<void> {
    this.sessions.set(s.id, s);
    await this.persist();
  }

  async addMark(sessionId: string, mark: SessionMark): Promise<boolean> {
    const s = this.sessions.get(sessionId);
    if (!s || s.endedAt) return false;
    s.marks.push(mark);
    await this.persist();
    return true;
  }

  /** Set/replace a 🎤 mark's ratings (per-bout in the pause, or at debrief —
   *  re-rating is allowed; the latest judgment wins). */
  async rateMark(sessionId: string, markId: string, ratings: Record<string, number>): Promise<boolean> {
    const s = this.sessions.get(sessionId);
    const m = s?.marks.find((x) => x.id === markId);
    if (!s || !m || m.kind !== 'speak') return false;
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(ratings)) {
      if (v >= 0 && v <= 4) clean[k] = Math.round(v);
    }
    m.ratings = clean;
    await this.persist();
    return true;
  }

  async end(sessionId: string, now: number): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s || s.endedAt) return;
    s.endedAt = now;
    await this.persist();
  }
}
