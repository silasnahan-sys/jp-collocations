/**
 * floating-rail.ts — the slate rail, made movable and dismissible.
 *
 * ## What was wrong
 *
 * `edgeDock` put the tablet's controls on the writing-hand edge, which is the
 * right *place*, and then nailed them there: `position: absolute; top: 50%`,
 * no handle, no way to move it, no way to put it away. A control layer that
 * floats over the reading column and cannot be moved is not a dock, it is an
 * obstruction — and it lands in the vertical middle, which is exactly where
 * the text you are reading is. Reported from the iPad, precisely:
 * 「its not movable in smooth way like apple notes toolbar and you cant move
 * it and it COVERS stuff too」.
 *
 * Apple Notes' markup palette is the right reference and it is worth naming
 * why: it floats, you drag it by any part of its own chrome, it snaps to an
 * edge instead of being left mid-screen, and it collapses to a puck when you
 * want the page back. Every one of those is a property of a thing that OVERLAYS
 * content — an overlay you cannot move is a bug, and an overlay you cannot
 * dismiss is a worse one.
 *
 * ## Why a fraction and not a pixel
 *
 * The stored position is `{ edge, y }` where `y ∈ [0,1]` of the rail's free
 * travel, never a pixel offset. An iPad rotates, enters Split View, and resizes
 * under Stage Manager; a rail parked 400px down a landscape pane is off the
 * bottom of the portrait one. A fraction survives all three, which is the same
 * reasoning `posture.ts` applies to the posture itself — describe the RELATION,
 * measure the box at use time.
 *
 * ## Smoothness is a `transform` — and that was only half of it
 *
 * During the drag the rail moves by `transform: translate()` and nothing else.
 * Changing `top` mid-drag relayouts the pane on every frame, which on a webview
 * over a long transcript is exactly the stutter being complained about. A
 * transform is compositor-only. The real offsets are written once, on release.
 *
 * That half was right and it was never the half being felt. MEASURED off the
 * 2026-08-08 iPad recording: the plugin holds a locked 60fps — 90–98.5% of
 * frames land inside 16.7ms whenever the screen is actually moving, and there
 * is not one gap ≥70ms in 140 seconds. Nothing was dropping. What the same
 * recording shows is three drags that each end like this, in per-frame change
 * energy:
 *
 *     … 1.09  1.21  1.41  1.49  1.33  0.56  0.63  1.90  →  0.03
 *
 * Peak velocity on the final frame, then dead. `apply()` cleared `transform`
 * and wrote the new `top` IN THE SAME FRAME, so the rail teleported the
 * remaining distance — both axes at once, because the edge class swaps the
 * anchor too. No object in the physical world stops like that, which is why the
 * hand rejects it however many frames per second it arrives at.
 *
 * The tell that this was an omission rather than a decision: the only
 * `transition` anywhere on `.jp-slaterail` was `transition: none` on the
 * `--moving` state — suppressing one that the base never declared.
 *
 * ## So: release physics
 *
 * On release the rail FLIPs — measure, apply the final layout, measure again,
 * then animate the difference away on a spring that STARTS AT THE VELOCITY THE
 * FINGER LEFT. That last clause is the whole feel: same constants, but a hard
 * flick travels further and takes longer than a nudge, because the gesture is
 * still in the motion. A tween would arrive politely at a fixed speed and read
 * as an animation being played rather than an object continuing.
 *
 * A hard throw also DECIDES the edge (`FLING_VX`): flick the rail leftward from
 * the right half and it goes left, because you threw it there. Position alone
 * would send it back under your finger and feel like the app arguing.
 *
 * ## The physics has to be a PROPERTY, not a flourish
 *
 * The first cut of this bounced — ζ≈0.67 — and grew 4.5% in the hand, and the
 * report back was 「its a litle bouncy but artificially so」. Both are the same
 * mistake: character added AT the moment of release, to an object that was
 * otherwise rigid and unresisting for the whole gesture before it. Decoration
 * on top of a dead drag reads as decoration.
 *
 * So the physics is now continuous and consists of exactly three things, none
 * of them ornamental:
 *
 *   - in bounds the rail tracks the finger 1:1 (it always did);
 *   - past a bound it RESISTS, progressively, and never quite refuses
 *     (`rubberBand`) — that is how a hand learns an edge without being stopped;
 *   - on release it carries the velocity it had into a critically damped
 *     settle (`RAIL_SPRING`, ζ=1) — no overshoot, because it is arriving at a
 *     wall and nothing passes through a wall.
 *
 * Nothing changes size. Elevation is light: a deeper shadow and a touch of
 * translucency, which is what coming off a surface actually looks like.
 *
 * PURE physics and geometry above the DOM section — no Obsidian, no document,
 * no clock — so the snap, the clamp and the spring are all testable off a
 * number. Golden: golden/floating-rail.mjs.
 */

import {
  type Spring, type SpringFrame, type Sample,
  criticallyDamped, springAt, springFrames, springKeyframes,
  rubberBand, throwVelocity, pushSample,
  REST_PX, MAX_SETTLE_MS, RUBBER,
} from './physics.ts';

/**
 * The physics moved to `physics.ts` the moment a SECOND thing needed to move.
 * Copying it would have been the whole problem in miniature: two surfaces with
 * two slightly different ideas of what resistance feels like is exactly the
 * seam a hand notices and cannot name.
 *
 * Re-exported from here because this is still where the laws are documented
 * against a real gesture, and because golden/floating-rail.mjs pins them
 * through this module.
 */
export {
  criticallyDamped, springAt, springFrames, springKeyframes,
  rubberBand, throwVelocity, pushSample,
  REST_PX, MAX_SETTLE_MS, RUBBER,
};
export type { Spring, SpringFrame, Sample };

export type RailEdge = 'left' | 'right';

/** Where the rail sits, in terms that survive a rotation. */
export interface RailState {
  edge: RailEdge;
  /** Fraction of the rail's free vertical travel: 0 = top, 1 = bottom. */
  y: number;
  /** Put away — only the grip shows. */
  collapsed: boolean;
}

export interface Box { width: number; height: number }

/**
 * The default is NOT the vertical middle.
 *
 * Centring an overlay puts it over the line you are reading, which is the one
 * place it must never be. Low on the writing-hand edge is both reachable and
 * out of the way, and it is where a hand resting on the glass already is.
 */
export const DEFAULT_RAIL: RailState = { edge: 'right', y: 0.72, collapsed: false };

export const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Rail height can exceed the pane (a short pane, a long rail); then it pins. */
export const railTravel = (box: Box, railH: number, inset: number): number =>
  Math.max(0, box.height - railH - inset * 2);

/** Stored fraction → the `top` CSS wants, in pixels from the pane's top. */
export function railTop(state: RailState, box: Box, railH: number, inset: number): number {
  return inset + clamp01(state.y) * railTravel(box, railH, inset);
}

/**
 * Horizontal speed (px/s) above which the THROW picks the edge, not the position.
 *
 * Below it, a release is a placement and the nearer edge wins. Above it the
 * gesture was a flick and the direction is the whole intent — a rail flicked
 * left from the right half that returns to the right has not been placed, it
 * has been refused. ~420px/s is a deliberate flick and is roughly double the
 * speed of a slow reposition, so the two do not blur into each other.
 */
export const FLING_VX = 420;

/**
 * Where a rail released at this position belongs.
 *
 * Snaps to the NEARER vertical edge rather than staying where it was dropped.
 * A rail left floating mid-pane covers two columns of text instead of one and
 * has no relationship to the reaching hand; edges are the only positions that
 * are both out of the way and reachable. Handedness is a starting default, not
 * a cage — a left-handed grip that wants it right, or a right-handed one
 * reading a wide table, moves it and the choice sticks.
 *
 * `vx` is optional and defaults to a still release, so every caller and golden
 * written before the throw existed still describes a pure placement.
 */
export function snapRail(
  railLeft: number,
  railTopPx: number,
  railW: number,
  railH: number,
  box: Box,
  inset: number,
  vx = 0,
): Pick<RailState, 'edge' | 'y'> {
  const centreX = railLeft + railW / 2;
  const travel = railTravel(box, railH, inset);
  const thrown = Math.abs(vx) >= FLING_VX;
  return {
    edge: thrown ? (vx > 0 ? 'right' : 'left') : centreX < box.width / 2 ? 'left' : 'right',
    y: travel <= 0 ? 0 : clamp01((railTopPx - inset) / travel),
  };
}

// ── release physics ───────────────────────────────────────────────────────────

/**
 * ζ = damping / 2√(stiffness·mass) = 1 — CRITICALLY DAMPED. It decelerates into
 * place and does not overshoot.
 *
 * This was ζ≈0.67 for one revision, which overshot by ~6%, and the report back
 * was 「its a litle bouncy but artificially so」. That is the correct reading and
 * the reason is physical: the rail snaps to an EDGE, and an edge is a wall.
 * Overshooting a wall means passing through it and coming back, which nothing
 * does, so the eye reads the motion as an animation being played rather than an
 * object arriving. Bounce is only honest where there is somewhere to bounce
 * into — a free axis, or the rubber-band return in `rubberBand` below.
 *
 * The life comes from `v0` instead. A spring released carrying the throw's
 * velocity travels further and takes longer for a hard flick than for a nudge,
 * without any of it being decorated: same constants, different gesture,
 * different motion. That is weight, and weight is what "not artificial" means.
 *
 * Stiffness is set by the SETTLE TIME, which is the part that is felt: ~383ms
 * for a placement, ~450ms for a hard throw across the pane. A critically damped
 * spring has a long tail by nature, so it needs more stiffness than the
 * underdamped one did to arrive in the same time — at ζ=0.67 and k=380 this
 * settled in 417ms, and matching that honestly costs k=550.
 *
 * `damping` is DERIVED, never typed in. ζ=1 is the claim being made; writing
 * the two numbers independently means the next person to touch the stiffness
 * silently reintroduces the overshoot this whole comment exists to explain.
 */
export const RAIL_SPRING: Spring = criticallyDamped(550);

/**
 * Keep a drag inside the pane while it is happening.
 *
 * Clamping only on release lets the rail be dragged off the edge and then jump
 * back, which reads as the app fighting you. Clamping live means the rail stops
 * at the wall like a physical object.
 */
export function clampDrag(
  startLeft: number,
  startTop: number,
  dx: number,
  dy: number,
  railW: number,
  railH: number,
  box: Box,
  inset: number,
): { dx: number; dy: number } {
  const maxLeft = Math.max(inset, box.width - railW - inset);
  const maxTop = Math.max(inset, box.height - railH - inset);
  const left = Math.min(Math.max(startLeft + dx, inset), maxLeft);
  const top = Math.min(Math.max(startTop + dy, inset), maxTop);
  return { dx: left - startLeft, dy: top - startTop };
}

/**
 * The live drag position: in bounds it follows the finger exactly, past them it
 * resists. `clampDrag` is still what decides where the rail RESTS — a release
 * must always land somewhere legal — so the two are different questions and
 * stay different functions.
 */
export function resistDrag(
  startLeft: number,
  startTop: number,
  dx: number,
  dy: number,
  railW: number,
  railH: number,
  box: Box,
  inset: number,
): { dx: number; dy: number } {
  const maxLeft = Math.max(inset, box.width - railW - inset);
  const maxTop = Math.max(inset, box.height - railH - inset);
  const soft = (v: number, lo: number, hi: number, dim: number): number =>
    v < lo ? lo + rubberBand(v - lo, dim)
      : v > hi ? hi + rubberBand(v - hi, dim)
        : v;
  return {
    dx: soft(startLeft + dx, inset, maxLeft, box.width) - startLeft,
    dy: soft(startTop + dy, inset, maxTop, box.height) - startTop,
  };
}

/** A press that neither moved far nor lasted long is a TAP, not a drag. */
export const MOVE_SLOP = 8;

export function isTap(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) <= MOVE_SLOP;
}

// ── DOM ───────────────────────────────────────────────────────────────────────

export interface RailDeps {
  /** Persisted position, or null to start from the handedness default. */
  state: RailState | null;
  /** Handedness decides only the STARTING edge; a move overrides it forever. */
  hand: RailEdge;
  save: (s: RailState) => void;
}

const INSET = 6;

/**
 * ## Why there is no scale here any more
 *
 * There was: the rail grew 4.5% while held and squashed to 0.86 when folded.
 * Both are Disney, not physics — a rigid object does not change size because
 * you touched it, and the eye knows that even when it cannot say so. Together
 * with the overshoot they are most of what produced 「artificially so」.
 *
 * Elevation is LIGHT, not size. The rail lifts by casting a deeper shadow
 * (`.jp-slaterail--moving` in styles.css) and by going very slightly
 * translucent, which is what actually happens when something comes off a
 * surface toward you. The geometry stays rigid throughout.
 *
 * The fold still moves, and honestly: collapsing changes the rail's height, so
 * `railTop` recomputes and the FLIP below springs the real difference. The
 * motion is the consequence of the geometry rather than an effect played over
 * it — which is the whole rule this file is now written to.
 */

/** Honour the system switch. A spring is motion, and some people cannot use it. */
const reducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Give a freshly created rail its handle, its position, and its two gestures.
 *
 * The grip is a real child of the rail rather than the rail itself being the
 * drag target, for the same reason `drag-out.ts` moved to grips: a rail full of
 * buttons cannot also be a drag surface without every button press becoming a
 * candidate drag. One small, unambiguous handle costs 22px and removes the
 * whole class of collision.
 */
export function mountFloatingRail(rail: HTMLElement, deps: RailDeps): void {
  let state: RailState = deps.state
    ? { ...deps.state }
    : { ...DEFAULT_RAIL, edge: deps.hand };

  const grip = rail.createDiv('jp-rail-grip');
  grip.setAttribute('aria-label', 'ツールバーを移動（長押しで移動・タップで畳む）');
  grip.setAttr('role', 'button');

  /**
   * The rail's world — the pane MINUS the foot bar, when there is one.
   *
   * Subtracting it is what lets the search bar have no defensive padding: the
   * rail simply cannot be parked into that band, so the two can never overlap
   * however far down you drag. Reserving space in the bar instead would cost
   * ~120px of a query box's width on every pane forever, to solve a collision
   * that only happens at one extreme of the travel.
   */
  const box = (): Box => {
    const p = rail.parentElement;
    if (!p) return { width: window.innerWidth, height: window.innerHeight };
    // `:scope >` and not a bare descendant search: 語彙 has TWO foot bars —
    // LexiconPanel docks its own search row against the bottom of the results
    // scroller, which is nested. The one the rail must not be parked into is
    // the one that occupies the bottom of the PANE, and that is the direct
    // child; the nested one scrolls away with its list.
    const bar = p.querySelector<HTMLElement>(':scope > .jp-slatebar');
    const reserved = bar ? bar.offsetHeight + 8 : 0;
    return { width: p.clientWidth, height: Math.max(0, p.clientHeight - reserved) };
  };

  /** Write the position the layout actually uses. Never called mid-drag. */
  const apply = (): void => {
    rail.toggleClass('jp-slaterail--collapsed', state.collapsed);
    rail.removeClass('jp-slaterail--left');
    rail.removeClass('jp-slaterail--right');
    rail.addClass(`jp-slaterail--${state.edge}`);
    // `top: 50%` + a translate was the old centring; both have to go or the
    // measured offset below is applied to something already displaced.
    rail.style.transform = '';
    rail.style.top = `${railTop(state, box(), rail.offsetHeight, INSET)}px`;
  };

  // Two frames, not one: the first lets the rail lay out so `offsetHeight` is
  // real, and collapsing changes that height, so it re-measures every time.
  requestAnimationFrame(apply);

  /**
   * Put the rail down where it now belongs, moving it there instead of cutting.
   *
   * FLIP: the rail is currently sitting at some visual position because of a
   * drag transform; `apply()` writes the real layout and clears that transform,
   * which by itself is the teleport. So measure both, and animate the
   * difference away on a spring carrying the throw's own velocity.
   *
   * Measuring AFTER `apply()` is what makes the edge swap survive: `--left` and
   * `--right` change which side the box is anchored from, so the delta is a
   * real two-axis distance rather than something computable from `top` alone.
   */
  const settle = (vx: number, vy: number): void => {
    const before = rail.getBoundingClientRect();
    apply();
    if (reducedMotion() || typeof rail.animate !== 'function') return;
    const after = rail.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    // A tap folds the rail without moving it: no distance to cover, but the
    // fold still wants to feel like something happened.
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.hypot(vx, vy) < 60) return;

    const { keys, ms } = springKeyframes(dx, dy, vx, vy, RAIL_SPRING);
    rail.animate(keys, { duration: ms, easing: 'linear' });
  };

  let drag: { id: number; x: number; y: number; left: number; top: number } | null = null;
  let trail: Sample[] = [];

  grip.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0 || drag) return;
    e.preventDefault();            // never let the grip start a text selection
    e.stopPropagation();
    const r = rail.getBoundingClientRect();
    const p = rail.parentElement?.getBoundingClientRect();
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      left: r.left - (p?.left ?? 0),
      top: r.top - (p?.top ?? 0),
    };
    trail = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
    try { grip.setPointerCapture(e.pointerId); } catch { /* older webview */ }
    // Picked up: deeper shadow, slightly translucent, same size. Elevation is
    // light. The geometry does not move until the finger does.
    rail.addClass('jp-slaterail--moving');
  });

  const onMove = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    // `resistDrag`, not `clampDrag`: in bounds it tracks the finger exactly,
    // past them it gives progressively less. A wall that stops dead under a
    // moving finger is the instant the rail stops being an object.
    const c = resistDrag(
      drag.left, drag.top, e.clientX - drag.x, e.clientY - drag.y,
      rail.offsetWidth, rail.offsetHeight, box(), INSET,
    );
    trail.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (trail.length > 8) trail.shift();
    // Compositor-only for the whole gesture. See the header.
    rail.style.transform = `translate(${c.dx}px, ${c.dy}px)`;
  };

  const onUp = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const started = drag;
    drag = null;
    rail.removeClass('jp-slaterail--moving');
    try { grip.releasePointerCapture(e.pointerId); } catch { /* already gone */ }

    const { vx, vy } = throwVelocity(trail);
    trail = [];

    if (isTap(dx, dy)) {
      // A tap on the handle puts the rail away and brings it back. This is the
      // dismissal the overlay never had.
      state = { ...state, collapsed: !state.collapsed };
      settle(0, 0);
    } else {
      const c = clampDrag(
        started.left, started.top, dx, dy,
        rail.offsetWidth, rail.offsetHeight, box(), INSET,
      );
      state = {
        ...state,
        ...snapRail(
          started.left + c.dx, started.top + c.dy,
          rail.offsetWidth, rail.offsetHeight, box(), INSET, vx,
        ),
      };
      settle(vx, vy);
    }
    deps.save(state);
  };

  const onCancel = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    trail = [];
    rail.removeClass('jp-slaterail--moving');
    settle(0, 0);                   // spring back to where it actually lives
  };

  // On the WINDOW, in capture — the rail's own view re-renders underneath it,
  // and a listener on a node that gets replaced mid-drag leaves the rail stuck
  // translated with no handler left to put it down. Same failure `pointer-drag`
  // documents; same fix.
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);

  // The pane can change shape without the rail moving (rotation, Split View).
  // The fraction is still right; the pixels are not.
  const reflow = (): void => { if (!drag) apply(); };
  window.addEventListener('resize', reflow);
  window.addEventListener('orientationchange', reflow);

  // The rail dies with its view; take the window listeners with it rather than
  // accumulating a set per render.
  const obs = new MutationObserver(() => {
    if (rail.isConnected) return;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('resize', reflow);
    window.removeEventListener('orientationchange', reflow);
    obs.disconnect();
  });
  if (rail.parentElement) obs.observe(rail.parentElement, { childList: true });
}
