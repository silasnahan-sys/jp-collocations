/**
 * bar-retreat.ts — the navigator costs nothing while you are reading.
 *
 * 「the tool bar should be used for that without getting in the way」
 *
 * A foot bar is the right place for destinations — it is where the hand is, and
 * `surface-bar.ts` explains why they must not float. But a bar pinned to the
 * foot of a pane that is already a ~390pt floating window over Manatan is
 * permanently spending a strip of the only thing the pane is for. In the
 * 2026-08-08 recordings that pane had the foot bar AND the tool rail AND 戻る
 * AND Obsidian's own navigation bar, all at once, all of the time.
 *
 * So the bar leaves while you are going down the page and comes back the
 * instant you reach for it. Reading is the only activity that is never
 * interrupted; every other one begins with a scroll up or a stop.
 *
 * Three rules keep it from being the kind of auto-hide that feels like a trap:
 *
 * 1. **Up always wins, immediately.** Any upward travel at all brings it back —
 *    no threshold, no delay. Reaching for the bar IS scrolling up, and a bar
 *    that made you scroll twice would be worse than one that never moved.
 * 2. **The ends are safe.** Near the top or the bottom of the scroll range it
 *    never hides: those are where you arrive and where you finish, and both are
 *    moments you are about to go somewhere.
 * 3. **Only where the space is actually scarce.** A roomy pane keeps it pinned;
 *    movement you did not need is just movement.
 */

/** Where the bar should be, given the last thing the scroller did. */
export type Retreat = 'here' | 'away';

export interface RetreatState {
  at: Retreat;
  /** Scroll offset the last decision was made from. */
  y: number;
}

/** Downward travel, in px, before the bar concedes the strip. */
export const HIDE_AFTER = 14;
/** How close to either end counts as "the ends are safe". */
export const END_ZONE = 72;

export const initialRetreat = (y = 0): RetreatState => ({ at: 'here', y });

/**
 * The whole decision, pure so it can be tested without a scroller.
 *
 * `max` is the largest scrollable offset (`scrollHeight - clientHeight`); a
 * pane with nothing to scroll has `max <= 0` and can never hide the bar,
 * which is what stops a short surface from flickering it on a rubber-band.
 */
export function nextRetreat(prev: RetreatState, y: number, max: number): RetreatState {
  const dy = y - prev.y;
  // A pane that does not scroll has no strip to reclaim.
  if (max <= END_ZONE) return { at: 'here', y };
  // Rule 2 — arriving and finishing are both about to be departures.
  if (y <= END_ZONE || y >= max - END_ZONE) return { at: 'here', y };
  // Rule 1 — up wins with no threshold at all.
  if (dy < 0) return { at: 'here', y };
  if (dy >= HIDE_AFTER) return { at: 'away', y };
  // Not enough travel to mean anything: hold position AND hold the anchor, so
  // a slow drag accumulates toward the threshold instead of resetting it.
  return { at: prev.at, y: prev.y };
}

/** The nearest ancestor that actually scrolls, or null. */
function scrollerFor(el: HTMLElement): HTMLElement | null {
  let n: HTMLElement | null = el;
  while (n) {
    const s = getComputedStyle(n).overflowY;
    if ((s === 'auto' || s === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
    n = n.parentElement;
  }
  return null;
}

/**
 * Arm `bar` to retreat while `from`'s scroller goes down. Returns a detach.
 *
 * Idempotent per bar element — views re-render constantly and a second listener
 * would double every frame and leak the first.
 */
export function armBarRetreat(from: HTMLElement, bar: HTMLElement): () => void {
  const host = bar as HTMLElement & { _jpcRetreat?: () => void };
  if (host._jpcRetreat) return host._jpcRetreat;

  const scroller = scrollerFor(from);
  if (!scroller) return () => {};

  let state = initialRetreat(scroller.scrollTop);
  let queued = false;

  const settle = (): void => {
    queued = false;
    const max = scroller.scrollHeight - scroller.clientHeight;
    const next = nextRetreat(state, scroller.scrollTop, max);
    if (next.at !== state.at) bar.toggleClass('jp-surfbar--away', next.at === 'away');
    state = next;
  };

  const onScroll = (): void => {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(settle);
  };

  scroller.addEventListener('scroll', onScroll, { passive: true });

  const detach = (): void => {
    scroller.removeEventListener('scroll', onScroll);
    bar.removeClass('jp-surfbar--away');
    delete host._jpcRetreat;
  };
  host._jpcRetreat = detach;
  return detach;
}
