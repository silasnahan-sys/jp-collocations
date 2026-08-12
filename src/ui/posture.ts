/**
 * posture.ts — the third posture the plugin never had a name for.
 *
 * ## Why this exists
 *
 * §26.3 adopted ACE CROWN's layout law — every actionable element in the thumb
 * zone, reading zone on top — and implemented it as `Platform.isPhone`. That is
 * two device classes: phone, and everything else. The iPad is in neither.
 *
 * `Platform.isPhone` is FALSE on an iPad, so every ergonomic the plugin learned
 * turned itself off there: `thumbDock()` returned null, the selection echo and
 * the surface bar never docked, and the drag commit sat at its long
 * wait-for-the-platform value. The CSS made the same mistake from the other
 * side — the 44px tap targets live under `@media (max-width: 600px)`, and a
 * full-screen iPad pane is 1024–1366px, so they never applied either. The net
 * result is the one combination nobody designed: **desktop chrome driven by a
 * finger and a Pencil.**
 *
 * The fix is not "treat the iPad as a big phone". A phone is one hand, held,
 * thumb at the bottom. A tablet on a stand with a Pencil in the right hand is a
 * different machine with a different reachable region — the near EDGE, not the
 * bottom — and it is the only one of the three that can hover. So: three
 * postures, named, and every surface asks which one it is in.
 *
 *   desk   — precise pointer, real hover, a keyboard. Nothing changes here.
 *   thumb  — phone. One hand, bottom reach, no hover, no keyboard.
 *   slate  — tablet. Stylus or two hands, edge reach on the writing side,
 *            hover ONLY when a Pencil is actually present, no keyboard.
 *
 * ## Pen presence is OBSERVED, not queried
 *
 * There is no honest way to ask "is an Apple Pencil paired". iPadOS reports
 * `pointer: coarse` and `hover: none` to CSS whether or not one is attached,
 * because the *primary* input is still a finger; `any-hover` is no better. A
 * Pencil announces itself only by being used — one `PointerEvent` with
 * `pointerType === 'pen'`.
 *
 * So this module watches, latches on the first one, and tells whoever asked to
 * be told. Surfaces that own a pen-only affordance (hover peek) stay dark until
 * a pen is seen and light up mid-session when one appears. Nothing has to guess,
 * and nothing offers a hover affordance to a finger that can never trigger it.
 *
 * ## The drag commit learns the platform instead of assuming it
 *
 * `pointer-drag.ts` waits `COMMIT_MS` before taking a press over, so that
 * iPadOS's own drag — the only one that can leave the app — gets first refusal.
 * That wait was set to 700ms everywhere off-phone on the assumption that a
 * native lift is coming. Whether WebKit fires `dragstart` for a *pen* inside
 * Obsidian's webview is not something this file can know, and guessing wrong is
 * expensive in both directions: too short steals the cross-app drag, too long
 * means every Pencil carry begins with a dead hold on a row that looks broken.
 *
 * So it is measured. Each pen long-press reports whether the platform claimed
 * it. Until a verdict exists the long wait stands (the safe direction — losing
 * a cross-app drag is worse than a slow one). Once enough presses have gone by
 * with no `dragstart`, the wait drops to the ordinary long-press beat, because
 * by then we have watched the platform decline the gesture repeatedly and there
 * is nothing left to wait for. It re-learns in one gesture if that ever changes.
 */

import { Platform } from 'obsidian';
import { mountFloatingRail, type RailState } from './floating-rail.ts';

export type Posture = 'desk' | 'thumb' | 'slate';
export type Hand = 'right' | 'left';

/** What main.ts injects once at load. All optional — an unconfigured module
 *  falls back to detection and a right-handed default, which is what the
 *  plugin did implicitly before this file existed. */
export interface PostureConfig {
  /** Force a posture, for when the platform flags are wrong (Stage Manager,
   *  a webview reporting the host rather than the panel). */
  override?: Posture | 'auto';
  /** Which hand holds the Pencil — decides which edge the slate rail sits on. */
  hand?: Hand;
  /** Seeded from persisted state so the drag commit does not have to re-learn
   *  the platform on every launch, and written back when a verdict is reached. */
  penNativeDrag?: PenDragVerdict;
  /** Same measurement for a fingertip. Separate, because they are separate
   *  facts about the platform and one does not predict the other. */
  touchNativeDrag?: PenDragVerdict;
  onDragVerdict?: (pointer: DragPointer, v: PenDragVerdict) => void;
  /** Where the user last parked the slate rail, and whether they put it away.
   *  Persisted for the same reason the drag verdict is: it is a decision they
   *  made with their hand, and making them make it again every launch is the
   *  thing that stops people moving it at all. */
  rail?: RailState;
  onRail?: (r: RailState) => void;
}

/** Does this platform hand a PEN press to native HTML5 drag? */
export type PenDragVerdict = 'unknown' | 'yes' | 'no';

let cfg: PostureConfig = {};

/** Called once from `onload`. Safe to call again when settings change. */
export function configurePosture(next: PostureConfig): void {
  cfg = { ...cfg, ...next };
  if (next.penNativeDrag && next.penNativeDrag !== 'unknown') verdicts.pen = next.penNativeDrag;
  if (next.touchNativeDrag && next.touchNativeDrag !== 'unknown') verdicts.touch = next.touchNativeDrag;
  applyPostureClasses();
}

// ── posture ───────────────────────────────────────────────────────────────────

/**
 * Coarse means "the primary input is a fingertip" — it is TRUE on an iPad even
 * with a Pencil attached, and that is correct: the Pencil is an addition, not a
 * replacement, and the finger is still what most taps arrive from. So this is
 * the right test for TARGET SIZE, and the wrong one for hover. Those two
 * questions were conflated before, which is how the dictionary got a hover peek
 * and the transcript got 34px rows.
 */
export function isCoarse(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return Platform.isMobile;                       // older webview: trust the app
  }
}

export function posture(): Posture {
  if (cfg.override && cfg.override !== 'auto') return cfg.override;
  // OBSERVATION BEATS CLAIM.
  //
  // A stylus that reports itself BEFORE it touches the glass is an iPad Pro —
  // Pencil hover exists on no phone, on no Android tablet, and on no first-
  // generation Pencil. So a hover sighting is harder evidence about the device
  // than any flag, and it outranks them.
  //
  // Measured 2026-08-06 on Silas's own probe: `isPhone=true isTablet=false`
  // in a 422×1075 pane, in the same session that logged pen hover, tilt and
  // altitudeAngle. Obsidian was describing the PANE (a Slide Over / narrow
  // Split View strip) and calling it a phone — so every slate ergonomic
  // switched off on a tablet with a Pencil in hand. That is the exact failure
  // this file was written to end, arriving from the opposite direction: last
  // time the iPad was mistaken for a desktop, this time for a phone.
  //
  // The thumb layout is still right for a narrow strip you hold — but a Pencil
  // does not reach for a thumb dock, so the *edge* rail is what it needs.
  if (sawPenHover) return 'slate';
  if (Platform.isPhone) return 'thumb';
  // `isTablet` is the direct answer where Obsidian supplies it. The second
  // clause catches a mobile build that is neither flag (it has happened), and
  // the third catches a touch device the app misreports — a coarse pointer on a
  // wide viewport is a tablet whatever anyone claims.
  if (Platform.isTablet) return 'slate';
  if (Platform.isMobile) return 'slate';
  if (isCoarse() && window.innerWidth >= 700) return 'slate';
  return 'desk';
}

export const isThumb = (): boolean => posture() === 'thumb';
export const isSlate = (): boolean => posture() === 'slate';
export const isDesk = (): boolean => posture() === 'desk';
/** Either touch posture — the test for "size this for a fingertip". */
export const isTouchy = (): boolean => posture() !== 'desk';

export function hand(): Hand { return cfg.hand ?? 'right'; }

// ── pen presence ──────────────────────────────────────────────────────────────

let sawPen = false;
/** A pen reported while NOT touching the glass. Only an M2+ iPad Pro can do
 *  this, which makes it a statement about the DEVICE, not just the input —
 *  see `posture()`, which trusts it over `Platform.isPhone`. */
let sawPenHover = false;
const penWatchers = new Set<() => void>();

/** True once a stylus has actually been used in this session. */
export const penSeen = (): boolean => sawPen;
/** True once a stylus has been seen hovering. Implies an iPad Pro. */
export const penHoverSeen = (): boolean => sawPenHover;

/**
 * Be told when a pen first appears.
 *
 * Returns a detach function. If a pen has ALREADY been seen the callback runs
 * immediately — a surface mounted after the first Pencil touch must not have to
 * wait for a second one to light up.
 */
export function onPenFirstSeen(cb: () => void): () => void {
  if (sawPen) { cb(); return () => { /* nothing to detach */ }; }
  penWatchers.add(cb);
  return () => { penWatchers.delete(cb); };
}

function notePen(): void {
  if (sawPen) return;
  sawPen = true;
  document.body?.addClass('jp-pen');
  for (const cb of penWatchers) { try { cb(); } catch { /* a watcher must not break the others */ } }
  penWatchers.clear();
}

/**
 * Start watching for a stylus.
 *
 * Passive and in the capture phase so it sees every pointer the app receives
 * without altering any of them, and on `document` so it survives every view
 * re-render. Returns a detach function for `onunload`.
 */
export function watchForPen(): () => void {
  const seen = (e: PointerEvent): void => {
    if (e.pointerType !== 'pen') return;
    // `buttons === 0` on a pointermove means the nib is reported while OFF the
    // glass. That is the iPad-Pro-only signal, and it changes the posture, so
    // the classes have to be re-stamped the moment it arrives rather than at
    // the next reload.
    if (e.type === 'pointermove' && e.buttons === 0 && !sawPenHover) {
      sawPenHover = true;
      notePen();
      applyPostureClasses();
      return;
    }
    notePen();
  };
  const opts = { capture: true, passive: true } as const;
  document.addEventListener('pointerdown', seen, opts);
  // Hover: an iPad Pro reports the nib BEFORE it lands. That is the earliest a
  // Pencil can possibly be detected, and detecting it early is the difference
  // between the peek being there when you first reach for it and appearing only
  // after you have already given up and tapped.
  document.addEventListener('pointermove', seen, opts);
  return () => {
    document.removeEventListener('pointerdown', seen, opts);
    document.removeEventListener('pointermove', seen, opts);
  };
}

// ── the drag commit verdict ───────────────────────────────────────────────────

/**
 * The verdict is per POINTER TYPE, because the question is per pointer type.
 *
 * It was measured for the pen and assumed for everything else, which left the
 * finger — the primary input on the device this file exists for — permanently
 * on the 700ms wait with no way to ever learn otherwise. `notePenPress` was
 * only ever called under `if (isPen)`, so a thousand finger presses taught it
 * nothing. Whether iPadOS hands a FINGER long-press to HTML5 drag inside
 * Obsidian's webview is exactly as unknowable from here as the pen question
 * was, and gets the same answer: watch, don't guess.
 *
 * If the platform does claim it, we keep waiting and the cross-app drag lives.
 * If it does not, the finger converges to the ordinary long-press beat after
 * three declines, the same as the pen. Either way nobody holds a dead row for
 * 700ms forever on a hypothesis nothing ever tested.
 */
export type DragPointer = 'pen' | 'touch';

const verdicts: Record<DragPointer, PenDragVerdict> = { pen: 'unknown', touch: 'unknown' };
/** Presses observed that the platform did NOT claim, per pointer type. */
const declines: Record<DragPointer, number> = { pen: 0, touch: 0 };
/** How many declines before we stop waiting. Three is enough to be sure it is
 *  the platform and not one press that happened to be ignored, and few enough
 *  that the slow path is over within the first minute of real use. */
const DECLINES_TO_CONVICT = 3;

/** Null for a mouse, whose native drag works everywhere and is never waited on. */
export function dragPointer(pointerType: string): DragPointer | null {
  return pointerType === 'pen' || pointerType === 'touch' ? pointerType : null;
}

export const penDragVerdict = (): PenDragVerdict => verdicts.pen;
export const dragVerdict = (p: DragPointer): PenDragVerdict => verdicts[p];

/**
 * Report the outcome of one completed long-press.
 *
 * `sawNative` is true when `dragstart` fired at any point during the press —
 * i.e. the platform took the gesture and the cross-app drag is available. One
 * such press settles it permanently in the good direction; there is no reason
 * to keep counting once we know the capability exists.
 */
export function noteDragPress(pointerType: string, sawNative: boolean): void {
  const p = dragPointer(pointerType);
  if (!p || verdicts[p] === 'yes') return;
  if (sawNative) {
    verdicts[p] = 'yes';
    declines[p] = 0;
    cfg.onDragVerdict?.(p, 'yes');
    return;
  }
  if (verdicts[p] === 'no') return;
  if (++declines[p] >= DECLINES_TO_CONVICT) {
    verdicts[p] = 'no';
    cfg.onDragVerdict?.(p, 'no');
  }
}

/** Back-compat for callers that only ever meant the pen. */
export const notePenPress = (sawNative: boolean): void => noteDragPress('pen', sawNative);

/**
 * How long a press of this pointer type must survive before we take it over.
 *
 * A phone gets the plain long-press beat: nothing is coming and it never was.
 * Anything else gets it ONLY once we have watched the platform decline the
 * gesture for that pointer — see above for why the safe default is the slow one.
 */
export function dragCommitMs(pointerType: string): number {
  if (Platform.isPhone) return 380;
  const p = dragPointer(pointerType);
  if (p && verdicts[p] === 'no') return 380;
  return 700;
}

// ── body classes ──────────────────────────────────────────────────────────────

/**
 * Stamp the posture on `document.body` so CSS can answer most of this without
 * a JS round-trip.
 *
 * Media queries alone cannot express "tablet": `(pointer: coarse)` is true on
 * both touch postures and viewport width is a property of the WINDOW, while the
 * thing that actually needs sizing is a PANE that may be a third of it. One
 * class settles it for the whole stylesheet.
 */
export function applyPostureClasses(): void {
  const b = document.body;
  if (!b) return;
  b.removeClass('jp-posture-desk');
  b.removeClass('jp-posture-thumb');
  b.removeClass('jp-posture-slate');
  b.addClass(`jp-posture-${posture()}`);
  b.toggleClass('jp-hand-left', hand() === 'left');
  b.toggleClass('jp-hand-right', hand() === 'right');
  const o = orientation();
  b.toggleClass('jp-orient-portrait', o === 'portrait');
  b.toggleClass('jp-orient-landscape', o === 'landscape');
  if (sawPen) b.addClass('jp-pen');
}

// ── rotation ──────────────────────────────────────────────────────────────────

export type Orientation = 'portrait' | 'landscape';

/** Measured, not asked. `screen.orientation` reports the DEVICE, which is the
 *  wrong question inside Stage Manager or a Split View pane — what a layout
 *  needs to know is the shape of the box it is actually in. */
export function orientation(): Orientation {
  try {
    return window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape';
  } catch {
    return 'landscape';
  }
}

/**
 * Re-evaluate the posture when the viewport changes — which, until now, never
 * happened.
 *
 * `applyPostureClasses()` ran exactly once at load. Rotate the iPad and every
 * ergonomic kept the shape it had at launch: the edge rail stayed on the edge
 * that used to be near, the fingertip sizing kept a stale posture, and
 * `posture()`'s own width fallback went stale with it. The same held for Stage
 * Manager and Split View, where the pane changes size without any rotation at
 * all. This is the identical bug as `Platform.isPhone` one layer up — a
 * decision made once about a device, when the thing that matters is the pane
 * and it moves.
 *
 * Fires the callback ONLY when the posture or the orientation actually
 * changed, so a drag-resize does not re-render every surface 60 times a second.
 */
export function watchViewport(
  onChange: (posture: Posture, orientation: Orientation) => void,
  debounceMs = 120,
): () => void {
  let last = `${posture()}/${orientation()}`;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const settle = (): void => {
    timer = null;
    const now = `${posture()}/${orientation()}`;
    applyPostureClasses();          // always: the classes are cheap and idempotent
    if (now === last) return;
    last = now;
    onChange(posture(), orientation());
  };
  const bump = (): void => {
    if (timer) clearTimeout(timer);
    // iOS reports the OLD dimensions during `orientationchange`, so a debounce
    // here is correctness, not just throttling.
    timer = setTimeout(settle, debounceMs);
  };
  window.addEventListener('resize', bump);
  window.addEventListener('orientationchange', bump);
  return () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener('resize', bump);
    window.removeEventListener('orientationchange', bump);
  };
}

// ── the dock ──────────────────────────────────────────────────────────────────

/**
 * Where a view's always-reachable controls go, per posture.
 *
 * Replaces `thumbDock`, which existed only on a phone. The shape differs
 * because the reachable region differs, and pretending otherwise is what put
 * the iPad's controls out of reach:
 *
 *   thumb — a full-width strip pinned to the bottom. One hand, thumb arcs
 *           across the bottom of the screen. This is ACE CROWN's law verbatim
 *           and it is right for the device it was written about.
 *   slate — a vertical rail on the WRITING-HAND edge. A tablet is held with two
 *           hands or propped on a stand, and the hand that reaches is the one
 *           holding the Pencil. A bottom strip on a 1366px-tall screen is a
 *           journey; the near edge is already under the nib. It also keeps the
 *           controls out of the reading column instead of stacked beneath it,
 *           which matters when the column is a transcript you are following.
 *   desk  — null. Nothing moves; the mouse reaches everything.
 *
 * Returns null off the touch postures, exactly as `thumbDock` did, so callers
 * keep the `dock ?? header` idiom and the desktop path is untouched.
 */
/**
 * ## Two questions, not one — the iPad "search tab" bug
 *
 * `edgeDock` used to answer "where do this view's controls go", and every view
 * put ALL of them there. On a phone that is right: the dock is a full-width
 * bottom sheet and a search box fits it perfectly. On a tablet the same call
 * returns a ~58px vertical rail, and 辞書, 𝕏 and 語彙 were posting a text
 * input, a row of mode chips and a completions dropdown into it. That is the
 * reported 「the search tab that pops up isnt very useable … it COVERS stuff」:
 * not a styling miss, a category error. A rail is for things the size of a
 * fingertip; a search box is not one of them.
 *
 * So the dock now answers two questions:
 *
 *   edgeDock — controls that are ICONS. The phone's bottom strip, the tablet's
 *              edge rail. Reachable, small, out of the reading column.
 *   wideDock — controls that need WIDTH: a query box, a list of completions,
 *              a row of chips. On a phone this is the same bottom sheet (one
 *              dock, `order` decides the stacking). On a tablet it is a bar
 *              across the FOOT of the pane, in flow — so it reaches the bottom
 *              of a 1366px screen without floating over anything.
 *
 * Both are memoised per view root, so `edgeDock(root)` and `wideDock(root)` on
 * a phone hand back the same element instead of building two stacked bars. The
 * cache is validated by parentage, not presence: every view calls `empty()`
 * before it re-renders, which destroys the children while leaving the property
 * behind, and a stale node would be filled and never shown.
 */
type DockKey = '_jpDockEdge' | '_jpDockWide';
type DockHost = HTMLElement & { _jpDockEdge?: HTMLElement; _jpDockWide?: HTMLElement };

function dock(viewRoot: HTMLElement, kind: 'edge' | 'wide'): HTMLElement | null {
  const p = posture();
  if (p === 'desk') return null;
  const root = viewRoot as DockHost;
  // One dock on a phone: both keys name the same slot.
  const key: DockKey = p === 'thumb' || kind === 'edge' ? '_jpDockEdge' : '_jpDockWide';
  const live = root[key];
  if (live && live.parentElement === root) return live;

  let el: HTMLElement;
  if (p === 'thumb') {
    el = viewRoot.createDiv('jp-thumbdock');
  } else if (kind === 'wide') {
    el = viewRoot.createDiv('jp-slatebar');
  } else {
    // The rail is absolutely positioned, so its host must BE a positioning
    // context. Stated as a class the code sets rather than left to a
    // `:has(> .jp-slaterail)` rule: if that selector ever fails to match — an
    // older WebKit, a view whose root is not the element the stylesheet named —
    // the rail does not sit slightly wrong, it positions against a different
    // element entirely and lands somewhere unrelated to the pane.
    viewRoot.addClass('jp-rail-host');
    el = viewRoot.createDiv(`jp-slaterail jp-slaterail--${hand()}`);
    // The tablet rail is the only dock that OVERLAYS content, so it is the only
    // one that has to be movable and dismissible. See `floating-rail.ts`.
    mountFloatingRail(el, {
      state: cfg.rail ?? null,
      hand: hand(),
      save: (s) => { cfg.rail = s; cfg.onRail?.(s); },
    });
  }
  root[key] = el;
  return el;
}

/** Icon-sized, always-reachable controls. Null on the desktop. */
export function edgeDock(viewRoot: HTMLElement): HTMLElement | null {
  return dock(viewRoot, 'edge');
}

/** Controls that need real width — a query box, a completions list, chips. */
export function wideDock(viewRoot: HTMLElement): HTMLElement | null {
  return dock(viewRoot, 'wide');
}

/**
 * Back-compat alias.
 *
 * `thumbDock` is called from five views. Rather than a five-file rename in the
 * same change that alters behaviour — which would make the diff unreadable and
 * the regression unfindable — the old name keeps working and now returns the
 * right container for the posture it is actually in.
 */
export const thumbDock = edgeDock;
