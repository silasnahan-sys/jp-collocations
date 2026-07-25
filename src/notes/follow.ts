/**
 * follow.ts — the 今ここ clock (DESIGN §25.2). PURE — golden/follow.mjs.
 *
 * Clock (c), manual sync: the user taps the line they just heard; from that
 * instant the transcript position advances on the device clock. Pause
 * freezes it; a new sync (any later tap) re-anchors it. Clocks (a)/(b)
 * (local <audio> / Plex viewOffset) bypass this and feed a position in
 * directly — this file is only the wall-clock arithmetic and the
 * position→line resolution both share.
 */

export interface FollowClock {
  /** transcript position at the sync instant. */
  syncTSec: number;
  /** wall time (ms) of the sync instant. */
  syncWallMs: number;
  /** frozen position while paused; null = running. */
  pausedAtTSec: number | null;
}

export function syncClock(tSec: number, nowMs: number): FollowClock {
  return { syncTSec: tSec, syncWallMs: nowMs, pausedAtTSec: null };
}

export function clockPosition(c: FollowClock | null, nowMs: number): number | null {
  if (!c) return null;
  if (c.pausedAtTSec != null) return c.pausedAtTSec;
  return c.syncTSec + (nowMs - c.syncWallMs) / 1000;
}

export function pauseClock(c: FollowClock, nowMs: number): FollowClock {
  if (c.pausedAtTSec != null) return c;
  return { ...c, pausedAtTSec: clockPosition(c, nowMs) ?? c.syncTSec };
}

export function resumeClock(c: FollowClock, nowMs: number): FollowClock {
  if (c.pausedAtTSec == null) return c;
  return syncClock(c.pausedAtTSec, nowMs);
}

/**
 * The line "now" is on: last line whose stamp is ≤ position (binary search).
 * Untimed lines (no tStartSec) never win. −1 when position precedes the
 * first stamp or nothing is timed.
 */
export function currentLineIndex(lines: Array<{ tStartSec?: number }>, posSec: number): number {
  let lo = 0, hi = lines.length - 1, best = -1;
  // transcripts are stamp-sorted; skip untimed tails defensively in the probe
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    let probe = mid;
    while (probe >= lo && lines[probe].tStartSec == null) probe--;
    if (probe < lo) { lo = mid + 1; continue; }
    if ((lines[probe].tStartSec as number) <= posSec) { best = probe; lo = mid + 1; }
    else hi = probe - 1;
  }
  return best;
}
