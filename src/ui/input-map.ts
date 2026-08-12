/**
 * input-map.ts — the touchpad, the mice, and the keys, as one layer.
 *
 * ## What a webview can actually hear
 *
 * This is the whole design constraint, and getting it wrong means building
 * something that cannot work:
 *
 *   • **Two-finger pan** on a Windows precision touchpad (and on a Magic
 *     Keyboard trackpad) arrives as ordinary `wheel` events carrying `deltaX`.
 *     Readable. This is the one multi-finger gesture we can own outright.
 *   • **Pinch** arrives as `wheel` with `ctrlKey: true` — a browser convention,
 *     not a real Control key. Readable.
 *   • **Three- and four-finger swipes never arrive at all.** The Windows shell
 *     consumes them before any app sees them, and iPadOS does the same. There
 *     is no event to listen for and no permission that grants one.
 *
 * So gestures split into two populations, and the second one is not a failure:
 * Windows Settings → Touchpad → Advanced gestures can bind a 3- or 4-finger
 * swipe to a CUSTOM SHORTCUT, and Elecom Mouse Assistant / Logi Options+ can
 * bind any button above 4 to a keystroke. Both then land on an Obsidian
 * command. That is why every verb here is also registered as a command rather
 * than a raw key handler — the command IS the integration point for hardware
 * this process will never hear from directly. Trying to talk to the drivers
 * would be strictly worse and mostly impossible.
 *
 * ## Why the swipe reducer is fussier than it looks
 *
 * A precision touchpad emits horizontal noise on every vertical scroll — your
 * fingers are not a rail. Naively accumulating `deltaX` therefore turns
 * ordinary reading into surface changes, which is worse than having no gesture
 * at all. Two rules stop it, and both are pinned by goldens:
 *
 *   1. A wheel event that is vertically dominant RESETS the horizontal
 *      accumulator. Drift cannot add up across a scroll.
 *   2. After a swipe fires, the gesture LATCHES until the touchpad goes quiet.
 *      One physical flick emits dozens of events; without the latch it would
 *      step five surfaces and land somewhere you did not ask for.
 *
 * PURE — no DOM, no Obsidian. The caller feeds it plain numbers.
 * Golden: golden/input-map.mjs
 */

/** What a gesture resolved to. Null means "this was ordinary scrolling". */
export type Gesture =
  | { kind: 'surface-step'; by: -1 | 1 }
  | { kind: 'density-step'; by: -1 | 1 };

export interface WheelSample {
  deltaX: number;
  deltaY: number;
  /** The browser's pinch convention, not a real Control key. */
  ctrlKey: boolean;
  /** Event timestamp in ms. Injected so the reducer stays pure. */
  at: number;
}

export interface GestureState {
  /** Horizontal travel banked since the last fire or reset. */
  panX: number;
  /** Pinch travel banked since the last density step. */
  zoom: number;
  /** True after a fire: no further gesture until the touchpad rests. */
  latched: boolean;
  lastAt: number;
}

export interface GestureConfig {
  /** Horizontal travel (px) that constitutes a swipe. */
  swipePx: number;
  /** Pinch travel (px) per density step. */
  pinchPx: number;
  /** Quiet time (ms) that ends a physical gesture. */
  restMs: number;
  /** |dx| must beat |dy| by this factor to count as horizontal at all. */
  axisRatio: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  // A deliberate flick, not a nudge: low enough to feel light, high enough
  // that a two-finger reposition mid-scroll never reaches it.
  swipePx: 120,
  pinchPx: 60,
  restMs: 220,
  axisRatio: 1.6,
};

export const idleGesture = (): GestureState => ({ panX: 0, zoom: 0, latched: false, lastAt: 0 });

export function feedWheel(
  prev: GestureState,
  e: WheelSample,
  cfg: GestureConfig = DEFAULT_GESTURE_CONFIG,
): { state: GestureState; gesture: Gesture | null } {
  // A pause ends the physical gesture: unlatch, and drop banked travel so the
  // next flick starts from zero rather than inheriting the last one's tail.
  const rested = prev.lastAt > 0 && e.at - prev.lastAt > cfg.restMs;
  const s: GestureState = rested
    ? { panX: 0, zoom: 0, latched: false, lastAt: e.at }
    : { ...prev, lastAt: e.at };

  if (e.ctrlKey) {
    // Pinch. Wheel-down (positive deltaY) is pinch-in, which means smaller.
    const zoom = s.zoom - e.deltaY;
    if (Math.abs(zoom) >= cfg.pinchPx) {
      // Keep the remainder rather than zeroing: a slow continuous pinch should
      // step evenly instead of stalling after each threshold crossing. Pinch is
      // deliberately NOT latched — holding it should keep stepping.
      const by: -1 | 1 = zoom > 0 ? 1 : -1;
      return { state: { ...s, zoom: zoom - by * cfg.pinchPx }, gesture: { kind: 'density-step', by } };
    }
    return { state: { ...s, zoom }, gesture: null };
  }

  // RULE 1: vertical dominance means this is a scroll. Reset the horizontal
  // accumulator so touchpad drift can never add up into a phantom swipe.
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * cfg.axisRatio) {
    return { state: { ...s, panX: 0 }, gesture: null };
  }

  const panX = s.panX + e.deltaX;
  // RULE 2: one physical flick, one step.
  if (s.latched || Math.abs(panX) < cfg.swipePx) return { state: { ...s, panX }, gesture: null };
  // Swiping content left (positive deltaX) moves you FORWARD, the direction
  // every paged surface on both platforms already means by it.
  return { state: { ...s, panX: 0, latched: true }, gesture: { kind: 'surface-step', by: panX > 0 ? 1 : -1 } };
}

// ── stepping along the bar ────────────────────────────────────────────────────

/**
 * Clamped, never wrapped.
 *
 * A wrap teleports you from ⚡ to 語彙 with no way to feel the edge, which on a
 * gesture (as opposed to a menu) reads as a misfire. Stopping tells you where
 * you are, which is the whole reason the bar marks the current surface.
 */
export function stepIndex(length: number, current: number, by: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, current + by));
}

// ── density ───────────────────────────────────────────────────────────────────

/**
 * "shrunk up" is not one problem with one right answer — a Pencil at a desk
 * and a thumb on a couch want different sizes of the same view. So it is a
 * live control rather than a setting you find once: pinch, or a hotkey, and it
 * persists.
 *
 * Steps are multiplicative on the theme's own text size, never absolute px, so
 * a vault that already runs large text stays proportional.
 */
export const DENSITY_SCALES = [0.85, 0.925, 1, 1.1, 1.25] as const;
export const DENSITY_DEFAULT = 2;

export const clampDensity = (level: number): number =>
  Math.max(0, Math.min(DENSITY_SCALES.length - 1, Math.round(level) || 0));

export const densityScale = (level: number): number => DENSITY_SCALES[clampDensity(level)];

/** Human label for the notice, so a step is visible rather than merely felt. */
export const densityLabel = (level: number): string => {
  const l = clampDensity(level);
  return `${Math.round(DENSITY_SCALES[l] * 100)}%${l === DENSITY_DEFAULT ? '（標準）' : ''}`;
};
