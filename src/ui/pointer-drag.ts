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
 */

import { Platform } from 'obsidian';
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

/** Movement (px) before commit that means "this is a scroll", not a press. */
const SLOP = 10;
/** When the row starts LOOKING picked up — feedback before the commitment. */
const ARM_MS = 350;
/**
 * When we take over, given native has not.
 *
 * On a phone no `dragstart` is ever coming, so this is just the long-press
 * beat. Everywhere else it has to outlast the platform's own drag lift
 * (~500ms on iPadOS) or we would steal the cross-app drag before the system
 * could offer it — see step 3 above.
 */
const COMMIT_MS = Platform.isPhone ? 380 : 700;

interface Session {
  end(): void;
}
let live: Session | null = null;

/** True while a synthetic drag is in flight (a zone can suppress its own
 *  hover/tap handling rather than fighting the carry). */
export const pointerDragActive = (): boolean => live !== null;

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
   */
  const blockScroll = (e: TouchEvent): void => e.preventDefault();
  document.addEventListener('touchmove', blockScroll, { passive: false });

  let zone: PointerDropZone | null = null;

  const end = (): void => {
    document.removeEventListener('touchmove', blockScroll);
    source.removeEventListener('pointermove', onMove);
    source.removeEventListener('pointerup', onUp);
    source.removeEventListener('pointercancel', onCancel);
    try { source.releasePointerCapture(pointerId); } catch { /* already gone */ }
    source.removeClass('jp-draggable--lifted');
    pill.remove();
    live = null;
  };

  const onMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    place(ev.clientX, ev.clientY);
    const z = zoneAt(ev.clientX, ev.clientY);
    if (z !== zone) {
      zone?.leave();
      zone = z;
      zone?.enter(payload);
    }
    zone?.over(ev.clientX, ev.clientY);
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

  const onCancel = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    zone?.leave();
    end();
  };

  source.addEventListener('pointermove', onMove);
  source.addEventListener('pointerup', onUp);
  source.addEventListener('pointercancel', onCancel);
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
    let armTimer: number | null = window.setTimeout(
      () => el.addClass('jp-draggable--arming'), ARM_MS);
    let commitTimer: number | null = null;

    const done = (): void => {
      if (armTimer !== null) { window.clearTimeout(armTimer); armTimer = null; }
      if (commitTimer !== null) { window.clearTimeout(commitTimer); commitTimer = null; }
      el.removeClass('jp-draggable--arming');
      el.removeEventListener('dragstart', onNative);
      el.removeEventListener('pointermove', onCandidateMove);
      el.removeEventListener('pointerup', done);
      el.removeEventListener('pointercancel', done);
    };

    // The platform took it. Its drag leaves the app; ours does not.
    const onNative = (): void => done();

    const onCandidateMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== pid) return;
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > SLOP) done();
    };

    commitTimer = window.setTimeout(() => {
      const p = payload();
      done();
      if (!p || !p.text.trim()) return;
      beginPointerDrag(el, p, pill(p), pid, x0, y0);
    }, COMMIT_MS);

    el.addEventListener('dragstart', onNative);
    el.addEventListener('pointermove', onCandidateMove);
    el.addEventListener('pointerup', done);
    el.addEventListener('pointercancel', done);
  });
}
