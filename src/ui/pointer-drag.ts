/**
 * pointer-drag.ts — the carry gesture where the platform's own drag is absent.
 *
 * ## Why this exists
 *
 * `drag-out.ts` is built entirely on HTML5 drag-and-drop (`draggable="true"` +
 * `dragstart` + `dataTransfer`). That is the right substrate and it is not being
 * replaced: it is the ONLY one that crosses an app boundary, which is the whole
 * point of dragging a phrase into Apple Notes across the Stage Manager seam.
 *
 * But it does not exist everywhere. On iPhone WebKit a `draggable` element is
 * just an element: no long-press lift, no `dragstart`, no drag. So every carry
 * gesture in the plugin — a headword, a located quote, a corpus collocate, a
 * tweet — silently degraded to "read it off the screen and retype it" on the
 * one device that is hardest to type on. And where the native drag DOES fire,
 * `setDragImage` is ignored on iOS: the system screenshots the whole row, which
 * is exactly the unreadable-at-a-wrist's-distance thing `dragPill` was written
 * to avoid.
 *
 * So this is a second path, not a replacement, and the two must never both run.
 *
 * ## How they stay out of each other's way
 *
 * No platform sniffing decides it. The rule is **native gets first refusal**:
 *
 *   1. A press starts a candidate. The mouse is excluded outright — its native
 *      drag works everywhere and nobody long-presses a mouse.
 *   2. Any movement past `SLOP` before commit cancels. A press that moves
 *      immediately is a scroll, and hijacking a scroll is unforgivable on a
 *      surface whose main verb is scrolling.
 *   3. If `dragstart` fires at any point, the candidate is abandoned — the
 *      platform took it, and the platform's drag is better (it leaves the app).
 *   4. Only if the press survives `COMMIT_MS` with no `dragstart` do we take
 *      over, because by then no native drag is coming.
 *
 * That ordering is why `COMMIT_MS` is long off-phone: iPadOS lifts its own drag
 * around half a second, so waiting past that lets step 3 fire and the system
 * win. On a phone we know nothing is coming, so it commits at the ordinary
 * long-press beat instead of making the user hold a dead row for 700ms.
 *
 * The gesture is a LONG PRESS rather than an immediate drag for the same reason
 * iOS chose one: on a scrolling list, a press that moves is a scroll, and the
 * only way to distinguish "carry this" from "scroll past this" without stealing
 * one of them is to make carrying begin from a stationary hold.
 *
 * ## One press, three outcomes — commit on MOTION, not on time
 *
 * The 30fps films (IMG_1159/1175/1184/1197) measured what a hand actually does
 * on a row: the tip PARKS on its target while the eyes read — 0.47–1.33s on
 * every single tap in Monokakido and Calendar — and only then commits. The old
 * model here armed a visual at 350ms and STARTED THE CARRY at the commit
 * deadline, which turned every reading-park into a drag pill and a locked
 * page: the plugin was mistaking reading for carrying, hundreds of times a
 * session. So the deadline no longer begins anything. It only changes what the
 * press MEANS:
 *
 *   • move before the deadline  → a scroll. We stand down instantly.
 *   • survive the deadline      → the row LIFTS (`--held`) — a signal, not an
 *     action. Nothing is blocked, nothing follows the finger yet.
 *   • then move                 → NOW the carry begins, pill and all.
 *   • then release in place     → nothing. The click goes through — a parked
 *     press that lifts is a TAP, which is exactly what the films show a
 *     reading hand doing (park → read → commit the row).
 *
 * The scroll blocker therefore installs only when a carry is genuinely in
 * flight, never while a hand is merely resting on a row it is reading.
 */

import { dragCommitMs, noteDragPress } from './posture.ts';
// TYPE-ONLY, and deliberately so: `drag-out.ts` imports `beginPointerDrag` from
// here as a value, so a value import in this direction would be a runtime
// cycle. The pill is built by the caller and handed over for the same reason.
import type { DragPayload } from './drag-out.ts';

/**
 * A surface that can receive a synthetic drag.
 *
 * Deliberately not a DragEvent listener. Mid-flight, a real drag's `getData()`
 * returns `''` by spec, so `drop-router.ts` has to paint from a vague sample and
 * re-derive on drop. A synthetic drag has no such restriction — the payload is
 * fully known from the first frame — so the zone is handed the real thing
 * throughout and the router's guess-then-correct branch never runs.
 */
export interface PointerDropZone {
  el: HTMLElement;
  /** the carried thing has entered this surface. */
  enter(p: DragPayload): void;
  /** it moved within this surface (viewport coordinates). */
  over(x: number, y: number): void;
  /** it left, without being dropped. */
  leave(): void;
  /** it was released here. */
  drop(p: DragPayload, x: number, y: number): void;
}

const zones = new Set<PointerDropZone>();

/** Arm a surface. Returns a detach function, like `attachDropRouter`. */
export function registerPointerDropZone(z: PointerDropZone): () => void {
  zones.add(z);
  return () => { zones.delete(z); };
}

/** Movement (px) before the hold matures that means "this is a scroll". */
const SLOP = 10;
/**
 * When we take over, given native has not — now asked per press, not fixed.
 *
 * On a phone no `dragstart` is ever coming, so this is just the long-press
 * beat. Everywhere else it has to outlast the platform's own drag lift
 * (~500ms on iPadOS) or we would steal the cross-app drag before the system
 * could offer it — see step 3 above.
 *
 * That reasoning is sound and its old implementation still guessed: a flat
 * 700ms for every non-phone press, including a PEN, on the untested assumption
 * that iPadOS lifts a native drag for a Pencil inside Obsidian's webview the
 * way it does for a finger. If it does not, that assumption costs a 700ms dead
 * hold on every single Pencil carry — the row sits there looking broken — and
 * buys nothing, because the drag it is politely waiting for is never coming.
 *
 * `posture.ts` decides it by watching instead: the long wait stands until the
 * platform has declined a pen press several times over, then drops to the
 * ordinary beat. `notePenPress` below is what feeds it.
 */

interface Session {
  end(): void;
}
let live: Session | null = null;

/** True while a synthetic drag is in flight (a zone can suppress its own
 *  hover/tap handling rather than fighting the carry). */
export const pointerDragActive = (): boolean => live !== null;

/**
 * End any drag in flight. Called from `onunload`.
 *
 * The scroll blocker lives on `document`, which outlives the plugin: a drag
 * still in flight when the plugin is disabled would leave the app unscrollable
 * with the offending code already gone, and only a full window reload would
 * clear it. Unload is one of the ways a gesture can be abandoned.
 */
export function abortPointerDrag(): void {
  live?.end();
}

/**
 * Which registered zone is under this point.
 *
 * Walks UP from the topmost element so the DEEPEST registered surface wins —
 * a panel armed inside a view armed inside a workspace should receive the drop
 * that is visually over the panel. Iterating `zones` in insertion order would
 * instead hand it to whichever happened to be armed first.
 */
function zoneAt(x: number, y: number): PointerDropZone | null {
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  while (el) {
    for (const z of zones) if (z.el === el) return z;
    el = el.parentElement;
  }
  return null;
}

/**
 * Take over a press that native drag declined, and carry `payload` until the
 * pointer is released.
 *
 * `pill` is built by the caller (`drag-out.ts` owns what a carried thing looks
 * like, and the same pill is what `setDragImage` gets on the native path — one
 * appearance for one gesture).
 */
export function beginPointerDrag(
  source: HTMLElement,
  payload: DragPayload,
  pill: HTMLElement,
  pointerId: number,
  x: number,
  y: number,
): void {
  if (live) { pill.remove(); return; }

  pill.addClass('jp-drag-pill--live');
  // Held under the nib rather than centred, matching `setDragImage(…, 16, 12)`
  // on the native path: a finger or a Pencil hides what is directly beneath it.
  const place = (cx: number, cy: number): void => {
    pill.style.left = `${cx + 16}px`;
    pill.style.top = `${cy + 12}px`;
  };
  place(x, y);
  source.addClass('jp-draggable--lifted');

  // Capture so the drag keeps reporting once the finger wanders off the row —
  // which it does immediately, since the whole point is to take it elsewhere.
  try { source.setPointerCapture(pointerId); } catch { /* older webview */ }

  /**
   * Stop the page scrolling under the carry.
   *
   * `preventDefault()` on a pointermove does NOT suppress scrolling, and
   * `touch-action` is read when the touch sequence BEGINS — by now it has, so
   * setting it here would do nothing. A non-passive `touchmove` blocker is the
   * only thing that actually works once a gesture is already in progress.
   *
   * It is also the most dangerous thing in this file: while it is installed the
   * page cannot scroll AT ALL, so every path out of a drag must reach `end()`.
   * See the listener placement below.
   */
  const blockScroll = (e: TouchEvent): void => e.preventDefault();
  document.addEventListener('touchmove', blockScroll, { passive: false });

  let zone: PointerDropZone | null = null;
  let ended = false;

  const end = (): void => {
    if (ended) return;
    ended = true;
    window.clearTimeout(deadman);
    if (frame) window.cancelAnimationFrame(frame);
    document.removeEventListener('touchmove', blockScroll);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('blur', onCancel);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('keydown', onKey, true);
    try { source.releasePointerCapture(pointerId); } catch { /* already gone */ }
    source.removeClass('jp-draggable--lifted');
    pill.remove();
    live = null;
  };

  /**
   * Last resort. If every other path somehow fails to fire, the scroll blocker
   * must still come off — a carry that silently locks the page is worse than a
   * carry that gives up. Long enough that no real drag hits it.
   */
  const deadman = window.setTimeout(() => {
    console.warn('[jp-collocations] pointer drag timed out; releasing the page');
    end();
  }, 30_000);

  /**
   * Pointer moves arrive faster than the screen refreshes, and each one costs
   * two `elementFromPoint` hit-tests (which zone, then which card). Doing that
   * per event burns the frame budget the drag itself needs to look smooth, so
   * the pill follows immediately — that is just a transform — and the hit-test
   * runs at most once per frame.
   */
  let frame = 0;
  let at: { x: number; y: number } | null = null;
  const settle = (): void => {
    frame = 0;
    if (!at || ended) return;
    const { x, y } = at;
    const z = zoneAt(x, y);
    if (z !== zone) {
      zone?.leave();
      zone = z;
      zone?.enter(payload);
    }
    zone?.over(x, y);
  };
  const onMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    place(ev.clientX, ev.clientY);
    at = { x: ev.clientX, y: ev.clientY };
    if (!frame) frame = window.requestAnimationFrame(settle);
  };

  const onUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    const landed = zone;
    end();
    /**
     * A press that never moved still produces a `click` on release, and these
     * rows are all clickable — a carried entry would land AND open its detail.
     * The carry already consumed the gesture, so the click that follows it is
     * not a second instruction.
     */
    const swallow = (c: Event): void => { c.preventDefault(); c.stopPropagation(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    // …and if no click follows (the finger left the row), stop waiting for one
    // rather than swallowing an unrelated tap later.
    window.setTimeout(() => window.removeEventListener('click', swallow, true), 400);

    // The zone tears its own overlay down inside `drop` — the same call the
    // native path makes — so nothing here needs to know how it was painted.
    if (landed) landed.drop(payload, ev.clientX, ev.clientY);
  };

  const onCancel = (ev?: Event): void => {
    if (ev && 'pointerId' in ev && (ev as PointerEvent).pointerId !== pointerId) return;
    zone?.leave();
    end();
  };
  const onHide = (): void => { if (document.hidden) onCancel(); };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    onCancel();
  };

  /**
   * Listened for on WINDOW, in the capture phase — never on `source`.
   *
   * `source` is a row inside a panel that re-renders itself, and a drop handler
   * re-renders it. Listeners attached to the row die with the row, so a drag
   * that outlived one re-render never reached `end()`: the pointer capture was
   * already lost, `pointerup` went to a detached node, and the non-passive
   * `touchmove` blocker above stayed installed — leaving the whole page
   * unscrollable with no way back short of reloading the plugin.
   *
   * The window outlives every re-render, so every one of these fires. Escape,
   * losing focus and backgrounding the app end it too, because the ways a
   * gesture can be abandoned are not limited to lifting the pointer.
   */
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('blur', onCancel);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('keydown', onKey, true);
  live = { end };
}

/**
 * Watch `el` for a press that native drag never claims, and hand it to
 * `beginPointerDrag` when one appears.
 *
 * `payload()` is called at commit rather than at press, matching
 * `makeDraggable`: a row that re-renders its own content hands over what it
 * currently shows. Returning null declines, exactly as on the native path.
 */
export function bindPointerDrag(
  el: HTMLElement,
  payload: () => DragPayload | null,
  pill: (p: DragPayload) => HTMLElement,
): void {
  el.addEventListener('pointerdown', (e: PointerEvent) => {
    // The mouse's native drag works on every platform this plugin runs on, and
    // a long-press is not a mouse gesture. Leaving it alone also means no
    // desktop behaviour changes at all.
    if (e.pointerType === 'mouse' || e.button !== 0 || live) return;

    const pid = e.pointerId, x0 = e.clientX, y0 = e.clientY;
    const kind = e.pointerType;
    /** The hold has matured: the row is lifted, the next move is a carry. */
    let held = false;
    let commitTimer: number | null = null;

    const done = (): void => {
      if (commitTimer !== null) { window.clearTimeout(commitTimer); commitTimer = null; }
      held = false;
      el.removeClass('jp-draggable--held');
      el.removeEventListener('dragstart', onNative);
      el.removeEventListener('pointermove', onCandidateMove);
      el.removeEventListener('pointerup', done);
      el.removeEventListener('pointercancel', done);
    };

    // The platform took it. Its drag leaves the app; ours does not.
    //
    // This is also the ONLY positive evidence that this pointer type CAN reach
    // the system drag on this device, so it is worth one call before standing
    // down. Reported for a finger as well as a pen: the finger is the primary
    // input on the iPad and it had no way to learn anything at all.
    const onNative = (): void => {
      noteDragPress(kind, true);
      done();
    };

    const onCandidateMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== pid) return;
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) <= SLOP) return;
      if (!held) { done(); return; }        // moved before the lift: a scroll
      // Moved after it: the carry begins, from where the pointer is NOW —
      // the pill must appear under the nib, not back where the press landed.
      const p = payload();
      const cx = ev.clientX, cy = ev.clientY;
      done();
      if (!p || !p.text.trim()) return;
      beginPointerDrag(el, p, pill(p), pid, cx, cy);
    };

    commitTimer = window.setTimeout(() => {
      // Reaching the deadline with no `dragstart` IS the observation: the
      // platform had its full first refusal and passed. Reported only here and
      // in `onNative`, never on an early cancel — a press abandoned to a scroll
      // says nothing about whether a drag would have been offered, and counting
      // it would convict the platform on evidence it never gave.
      noteDragPress(kind, false);
      // Not a carry yet — a SIGNAL that one is available. The films' parked
      // reading press (0.47–1.33s, every tap) reaches here constantly, and it
      // must cost the reader nothing: no pill, no scroll lock, and on release
      // the row's ordinary click still lands.
      held = true;
      el.addClass('jp-draggable--held');
    }, dragCommitMs(e.pointerType));

    el.addEventListener('dragstart', onNative);
    el.addEventListener('pointermove', onCandidateMove);
    el.addEventListener('pointerup', done);
    el.addEventListener('pointercancel', done);
  });
}
