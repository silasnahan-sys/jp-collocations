/**
 * scheduler.ts — a real SRS scheduler (Anki's SM-2 lineage), PURE and
 * golden-tested. No Obsidian imports, no Date.now() — callers pass `now`.
 *
 * States: new → learning (minute steps) → review (day intervals).
 * A review lapse (もう一度) drops the card into relearning, keeps its history,
 * and halves the next interval after it graduates back.
 *
 * Grades are Anki's four: 1 もう一度 / 2 難しい / 3 普通 / 4 簡単.
 */

export type Grade = 1 | 2 | 3 | 4;

export interface CardState {
  state: 'new' | 'learning' | 'review' | 'relearning';
  /** epoch ms when the card is next due. */
  dueMs: number;
  /** current review interval in days (0 while in learning). */
  intervalDays: number;
  /** ease factor ×1000 (2500 = 250%). Integer to keep persistence exact. */
  ease: number;
  reps: number;
  lapses: number;
  /** index into the learning steps while (re)learning. */
  stepIndex: number;
  /** last grade, for stats. */
  lastGrade?: Grade;
  /**
   * Set when the card keeps lapsing (≥ LEECH_LAPSES review lapses): it is
   * eating minutes without sticking and needs a REWRITE, not more reps.
   * Leeches leave the normal queue; grading 簡単 after a revive clears it.
   */
  leech?: boolean;
}

const MIN = 60_000;
const DAY = 86_400_000;

/** Anki defaults, in minutes. */
export const LEARNING_STEPS_MIN = [1, 10];
export const RELEARNING_STEPS_MIN = [10];
export const GRADUATING_DAYS = 1;
export const EASY_DAYS = 4;
export const MIN_EASE = 1300;
export const START_EASE = 2500;
/** lapsed cards come back at this fraction of their old interval. */
export const LAPSE_FACTOR = 0.5;
export const MAX_INTERVAL_DAYS = 365;
/** review lapses before a card is flagged a leech (Anki uses 8; smaller deck
 *  → flag earlier: the fix is rewriting the card, not more failed reps). */
export const LEECH_LAPSES = 5;

export function newCardState(now: number): CardState {
  return { state: 'new', dueMs: now, intervalDays: 0, ease: START_EASE, reps: 0, lapses: 0, stepIndex: 0 };
}

const clampIvl = (d: number) => Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.round(d)));

/** Apply one graded review. Returns the NEXT state (input is not mutated). */
export function schedule(prev: CardState, grade: Grade, now: number): CardState {
  const s: CardState = { ...prev, reps: prev.reps + 1, lastGrade: grade };

  if (prev.state === 'new' || prev.state === 'learning' || prev.state === 'relearning') {
    const steps = prev.state === 'relearning' ? RELEARNING_STEPS_MIN : LEARNING_STEPS_MIN;
    if (grade === 1) {
      s.state = prev.state === 'new' ? 'learning' : prev.state;
      s.stepIndex = 0;
      s.dueMs = now + steps[0] * MIN;
      return s;
    }
    if (grade === 4) {
      // easy graduates immediately
      s.state = 'review';
      s.stepIndex = 0;
      s.intervalDays = prev.state === 'relearning'
        ? clampIvl(Math.max(1, prev.intervalDays))
        : EASY_DAYS;
      s.dueMs = now + s.intervalDays * DAY;
      return s;
    }
    // 2 (hard) repeats the current step; 3 (good) advances
    const nextIndex = grade === 2 ? prev.stepIndex : prev.stepIndex + 1;
    if (nextIndex >= steps.length) {
      s.state = 'review';
      s.stepIndex = 0;
      s.intervalDays = prev.state === 'relearning'
        ? clampIvl(Math.max(1, prev.intervalDays))
        : GRADUATING_DAYS;
      s.dueMs = now + s.intervalDays * DAY;
      return s;
    }
    s.state = prev.state === 'new' ? 'learning' : prev.state;
    s.stepIndex = nextIndex;
    s.dueMs = now + steps[nextIndex] * MIN;
    return s;
  }

  // ── review state ──
  if (grade === 1) {
    s.state = 'relearning';
    s.stepIndex = 0;
    s.lapses = prev.lapses + 1;
    if (s.lapses >= LEECH_LAPSES) s.leech = true;
    s.ease = Math.max(MIN_EASE, prev.ease - 200);
    s.intervalDays = clampIvl(prev.intervalDays * LAPSE_FACTOR);
    s.dueMs = now + RELEARNING_STEPS_MIN[0] * MIN;
    return s;
  }
  let ease = prev.ease;
  let ivl: number;
  if (grade === 2) {
    ease = Math.max(MIN_EASE, ease - 150);
    ivl = prev.intervalDays * 1.2;
  } else if (grade === 3) {
    ivl = prev.intervalDays * (ease / 1000);
  } else {
    ease = ease + 150;
    ivl = prev.intervalDays * (ease / 1000) * 1.3;
    if (prev.leech) s.leech = false; // 簡単 on a revived leech = recovered
  }
  s.ease = ease;
  s.intervalDays = clampIvl(Math.max(ivl, prev.intervalDays + 1));
  s.dueMs = now + s.intervalDays * DAY;
  s.state = 'review';
  return s;
}

/** Human label for what each grade would schedule — the review buttons show this. */
export function previewIntervals(prev: CardState, now: number): Record<Grade, string> {
  const label = (next: CardState): string => {
    const ms = next.dueMs - now;
    if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))}分`;
    if (ms < DAY) return `${Math.round(ms / (60 * MIN))}時間`;
    const d = Math.round(ms / DAY);
    if (d < 30) return `${d}日`;
    if (d < 360) return `${(d / 30).toFixed(1).replace(/\.0$/, '')}ヶ月`;
    return `${(d / 365).toFixed(1).replace(/\.0$/, '')}年`;
  };
  return {
    1: label(schedule(prev, 1, now)),
    2: label(schedule(prev, 2, now)),
    3: label(schedule(prev, 3, now)),
    4: label(schedule(prev, 4, now)),
  };
}

export function isDue(s: CardState, now: number): boolean {
  return s.dueMs <= now;
}
