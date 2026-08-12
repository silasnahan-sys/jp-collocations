/**
 * touch-nav.ts — the way out, under a finger.
 *
 * ## The thing that was actually missing
 *
 * Reported 2026-08-08: 「theres no gestures to go too and from so sometimes u
 * literally just get STUCK in certain places」.
 *
 * The navigation was not missing. `suite-nav.ts` is a proper back-stack —
 * truncate-on-revisit, and a `Place` that carries an editor's path, cursor and
 * scroll so returning restores rather than reopens. `input-map.ts` is a careful
 * gesture reducer with drift rejection and latching. Both are pure, both are
 * golden-tested, both are correct.
 *
 * `input-map.ts` listens to `wheel`.
 *
 * An iPad has no wheel. There was no `touchstart` or `touchmove` navigation
 * handling anywhere in the plugin, so on the device the whole suite is actually
 * used on, every navigation verb existed, was tested, and was reachable only by
 * pressing a button — and the buttons were on the floating rail, which is the
 * thing he does not use. The verbs were all there and the hands could not reach
 * any of them. That is the whole of 「STUCK」.
 *
 * ## Why an edge drag and not a swipe
 *
 * A swipe is a thing you either did or did not do, and you find out afterwards.
 * That is the gimmick shape: a gesture that fires an action. This is a DRAG —
 * the affordance follows your finger the entire way, tells you where you would
 * land before you commit, and can be abandoned by simply putting it back. You
 * cannot get it wrong, and you never have to wonder whether the app heard you.
 *
 * It is also why there is no setting. Where "back" goes is read off the stack
 * at the moment you touch the edge, so summoning 辞書 from a note offers you the
 * note, and opening 辞書 cold offers you whatever you were on before it. Home is
 * inferred from how you arrived: 「switches and knobs here is bad, we need
 * contextual responisve design」.
 *
 * ## The commit point is a physical place
 *
 * The affordance tracks 1:1 out to `commitPx` and then RESISTS (`rubberBand`,
 * the same curve the rail settles on — `physics.ts`). So the threshold is not a
 * number you have to learn or a label that has to appear: past it the drag goes
 * heavy, and your hand knows it has latched without being told. Resistance is
 * how a bound gets communicated without a stop.
 *
 * ## What it refuses to do
 *
 *   - It never arms when there is nowhere behind you. An exit that does nothing
 *     is worse than no exit, because it spends the trust the invariant needs.
 *   - It never arms on a mouse. The desk already has thumb buttons and a
 *     touchpad through `input-map.ts`; a mouse drag from the edge is nobody's
 *     idea of navigation.
 *   - It abandons the moment the gesture is vertically dominant, so reading is
 *     never a navigation. A `pointercancel` (iOS deciding the drag was a
 *     scroll) is treated as the same answer.
 *
 * No `touch-action` is set anywhere. A clean horizontal drag does not start an
 * iOS scroll, and an ambiguous diagonal one SHOULD be abandoned — so the
 * platform's own arbitration is the behaviour we want, rather than something to
 * suppress with a dead strip over the edge of the content.
 *
 * PURE geometry above the DOM section. Golden: golden/touch-nav.mjs.
 */

import { rubberBand, throwVelocity, pushSample, springKeyframes, criticallyDamped, type Sample } from './physics.ts';

export interface EdgeConfig {
  /** How far from the pane's left edge a drag must START, in px. */
  zone: number;
  /** Movement before the gesture commits to an axis. */
  slop: number;
  /** How much more horizontal than vertical, to lock as a nav drag. */
  axisRatio: number;
  /** Distance at which release navigates — and where resistance begins. */
  commitPx: number;
  /** Speed (px/s) that commits a shorter drag. A flick is also an answer. */
  commitVx: number;
  /** Fraction of `commitPx` a flick must still have covered, so a twitch is not a flick. */
  flickFloor: number;
}

/**
 * `zone` is 30px rather than iOS's ~20pt because this edge is inside a pane,
 * not against the bezel — there is no physical rim to find it by, so it needs
 * to be slightly more forgiving than the system gesture it echoes.
 */
export const DEFAULT_EDGE: EdgeConfig = {
  zone: 30,
  slop: 10,
  axisRatio: 1.4,
  commitPx: 96,
  commitVx: 380,
  flickFloor: 0.35,
};

/** Did this drag start in the edge zone? `x` is relative to the pane's left. */
export const inEdgeZone = (x: number, cfg: EdgeConfig = DEFAULT_EDGE): boolean =>
  x >= 0 && x <= cfg.zone;

export type Axis = 'undecided' | 'nav' | 'abandoned';

/**
 * Which gesture this is turning out to be.
 *
 * Vertical dominance abandons rather than staying undecided: a reader scrolling
 * a long entry with a thumb resting near the left edge must never accumulate
 * toward a navigation, and 「undecided」 that can still become 'nav' later is
 * exactly how that happens.
 */
export function decideAxis(dx: number, dy: number, cfg: EdgeConfig = DEFAULT_EDGE): Axis {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < cfg.slop && ay < cfg.slop) return 'undecided';
  if (dx > 0 && ax >= ay * cfg.axisRatio) return 'nav';
  if (ay >= cfg.slop) return 'abandoned';
  return 'undecided';
}

/**
 * How far the affordance has actually travelled, for a finger `dx` out.
 *
 * 1:1 to the commit point, resisted past it. The change in weight IS the
 * threshold — you feel the latch instead of reading about it. Pulling back
 * before release is always possible, so the gesture has no point of no return
 * until you lift.
 */
export function pullFor(dx: number, cfg: EdgeConfig = DEFAULT_EDGE): number {
  if (dx <= 0) return 0;
  if (dx <= cfg.commitPx) return dx;
  return cfg.commitPx + rubberBand(dx - cfg.commitPx, cfg.commitPx * 2);
}

/** Distance OR a genuine flick. Either is a complete answer; neither alone is. */
export function commits(dx: number, vx: number, cfg: EdgeConfig = DEFAULT_EDGE): boolean {
  if (dx >= cfg.commitPx) return true;
  return vx >= cfg.commitVx && dx >= cfg.commitPx * cfg.flickFloor;
}

// ── DOM ───────────────────────────────────────────────────────────────────────

export interface EdgeBackDeps {
  /**
   * What "back" would land on right now, named — 辞書, 𝕏, or a note's title.
   * `null` means there is nowhere behind, and the gesture does not arm at all.
   * Called on every touch, never cached: the stack moves under it.
   */
  peek: () => string | null;
  go: () => void;
}

const SETTLE = criticallyDamped(550);

const reducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Places a press must never be stolen from. */
const GUARDED = 'input, textarea, select, [contenteditable="true"], .jp-rail-grip, .jp-slaterail, [draggable="true"]';

/**
 * Is the press inside something that scrolls horizontally and could still go
 * left? Then the drag belongs to it. A carousel that stops responding near its
 * own left end because a navigation ate the gesture is precisely the kind of
 * exception that makes a hand stop trusting the whole grammar.
 */
function inHorizontalScroller(from: Element | null, root: HTMLElement): boolean {
  for (let el: Element | null = from; el && el !== root; el = el.parentElement) {
    const e = el as HTMLElement;
    if (e.scrollWidth > e.clientWidth + 1 && e.scrollLeft > 0) return true;
  }
  return false;
}

/**
 * Arm `host` so a drag from its left edge goes back. Returns a detach.
 *
 * Idempotent per element: every view calls this on each render, and stacking
 * one listener per render is how a single drag ends up navigating four times.
 */
export function attachEdgeBack(
  host: HTMLElement,
  deps: EdgeBackDeps,
  cfg: EdgeConfig = DEFAULT_EDGE,
): () => void {
  const marked = host as HTMLElement & { _jpEdgeBack?: () => void };
  if (marked._jpEdgeBack) return marked._jpEdgeBack;

  host.addClass('jp-nav-host');

  let drag: { id: number; x0: number; y0: number; axis: Axis } | null = null;
  let trail: Sample[] = [];
  let tab: HTMLElement | null = null;

  const clear = (): void => {
    drag = null;
    trail = [];
    tab?.remove();
    tab = null;
  };

  const show = (label: string, y: number): void => {
    tab = host.createDiv('jp-edgeback');
    tab.createSpan({ cls: 'jp-edgeback-arrow', text: '‹' });
    tab.createSpan({ cls: 'jp-edgeback-label', text: label });
    tab.style.top = `${y}px`;
  };

  const onDown = (e: PointerEvent): void => {
    if (drag || e.pointerType === 'mouse' || !e.isPrimary) return;
    const r = host.getBoundingClientRect();
    if (!inEdgeZone(e.clientX - r.left, cfg)) return;
    const t = e.target as Element | null;
    if (t?.closest(GUARDED)) return;
    if (inHorizontalScroller(t, host)) return;
    // Asked at touch time, not cached: an exit that does nothing costs more
    // trust than no exit at all.
    if (!deps.peek()) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: 'undecided' };
    trail = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
  };

  const onMove = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    pushSample(trail, { t: e.timeStamp, x: e.clientX, y: e.clientY });

    if (drag.axis === 'undecided') {
      const next = decideAxis(dx, dy, cfg);
      if (next === 'abandoned') { clear(); return; }
      if (next === 'undecided') return;
      drag.axis = 'nav';
      const label = deps.peek();
      if (!label) { clear(); return; }
      show(label, e.clientY - host.getBoundingClientRect().top);
    }

    // Locked. Suppress the text selection this drag would otherwise start.
    e.preventDefault();
    const pull = pullFor(dx, cfg);
    if (tab) {
      tab.style.transform = `translateX(${pull.toFixed(1)}px)`;
      tab.toggleClass('jp-edgeback--armed', commits(dx, 0, cfg));
    }
  };

  const onUp = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    const locked = drag.axis === 'nav';
    const { vx } = throwVelocity(trail);
    // Take the element OFF the instance before resetting: the settle below
    // outlives this handler, and `clear()` would delete the thing it animates.
    const el = tab;
    const pull = pullFor(dx, cfg);
    drag = null;
    trail = [];
    tab = null;

    if (!locked) { el?.remove(); return; }

    if (commits(dx, vx, cfg)) {
      el?.remove();
      deps.go();
      return;
    }

    // Refused: put it back on the same laws everything else moves by, rather
    // than blinking out. An abandoned gesture that vanishes reads as an error;
    // one that returns reads as a decision you made.
    if (!el) return;
    if (reducedMotion() || typeof el.animate !== 'function') { el.remove(); return; }
    const { keys, ms } = springKeyframes(pull, 0, vx, 0, SETTLE);
    const anim = el.animate(keys, { duration: ms, easing: 'linear' });
    anim.onfinish = () => el.remove();
    anim.oncancel = () => el.remove();
  };

  const onCancel = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    clear();
  };

  // Capture on the host, not the window: two views can be alive at once in a
  // split, and the one you are touching is the one that should answer.
  host.addEventListener('pointerdown', onDown, true);
  host.addEventListener('pointermove', onMove, true);
  host.addEventListener('pointerup', onUp, true);
  host.addEventListener('pointercancel', onCancel, true);

  const detach = (): void => {
    host.removeEventListener('pointerdown', onDown, true);
    host.removeEventListener('pointermove', onMove, true);
    host.removeEventListener('pointerup', onUp, true);
    host.removeEventListener('pointercancel', onCancel, true);
    clear();
    delete marked._jpEdgeBack;
  };
  marked._jpEdgeBack = detach;
  return detach;
}
