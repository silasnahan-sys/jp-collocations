/**
 * suite-nav.ts — going TO and FROM, which the suite has never had.
 *
 * ## The seam
 *
 * `surface-bar.ts` fixed *reaching* another surface: one bar, always present,
 * no palette round trip. It did not fix **coming back**. `open(surface)` is a
 * one-way door — it lands you in the 辞書 with no memory of the sentence you
 * were writing, and the way back is to find your tab again. So the bar made
 * the suite navigable and left it feeling like nine separate apps that happen
 * to share a toolbar.
 *
 * Split view was the workaround, and it is the wrong shape. On a desk it is
 * merely cramped. On a tablet in portrait it halves a pane that was already
 * the whole point, which is why the surfaces read as "shrunk up" there. Split
 * is what you reach for when *returning* is expensive; make returning free and
 * the reason for split mostly evaporates.
 *
 * ## What this is
 *
 * A stack of PLACES and one verb. `toggle(surface)` goes there if you are not
 * there and comes straight back if you are — the same binding in both
 * directions, so "go to and from" is one gesture rather than two bindings and
 * a decision. A place remembers enough to be *restored*, not merely reopened:
 * an editor place carries its cursor and scroll, so returning puts you on the
 * character you left, not the top of the file.
 *
 * ## The rule that keeps it from becoming junk
 *
 * Revisiting a place already in the stack TRUNCATES back to it instead of
 * pushing. 辞書 → 𝕏 → 辞書 leaves a stack of one, not three. Without that,
 * "move at will" builds a history no one can reason about and `back` starts
 * replaying a wander instead of undoing it. This is the whole difference
 * between a stack you trust and a log you ignore.
 *
 * PURE — no Obsidian imports, so the navigation logic is testable without a
 * workspace. Golden: golden/suite-nav.mjs.
 */

import type { Surface } from './surface-bar.ts';
import type { Posture } from './posture.ts';

/** Where you were, with enough state to put you back rather than re-open. */
export type Place =
  | { kind: 'surface'; surface: Surface }
  | { kind: 'editor'; path: string; line?: number; ch?: number; scroll?: number };

/**
 * Where a surface should be MOUNTED on this device right now.
 *
 *  side — Obsidian's right sidebar. On a wide desktop this is the right
 *         answer: resizable, sits beside the editor, stays put.
 *  full — a tab in the main pane, at the full width of the window.
 */
export type Presentation = 'full' | 'side';

/** The stack never grows without bound; a wander is not a history. */
export const STACK_CAP = 24;

export function samePlace(a: Place | null, b: Place | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'surface' && b.kind === 'surface') return a.surface === b.surface;
  if (a.kind === 'editor' && b.kind === 'editor') return a.path === b.path;
  return false;
}

/** Where you are now — the top of the stack. */
export const here = (stack: readonly Place[]): Place | null => stack[stack.length - 1] ?? null;

/**
 * Move to `to`.
 *
 * Three cases, and the middle one is the important one:
 *  - already there            → nothing moves (and the state is refreshed, so
 *                               a re-entry updates a stale cursor)
 *  - somewhere below in the stack → TRUNCATE to it; the excursion is undone
 *  - new                      → push, dropping the oldest past the cap
 */
export function goTo(stack: readonly Place[], to: Place, cap = STACK_CAP): Place[] {
  const at = stack.findIndex((p) => samePlace(p, to));
  if (at === stack.length - 1) return [...stack.slice(0, -1), to];   // refresh in place
  if (at >= 0) return [...stack.slice(0, at), to];                   // truncate back to it
  const next = [...stack, to];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Step back one place. `to` is null when there is nowhere behind you. */
export function back(stack: readonly Place[]): { stack: Place[]; to: Place | null } {
  if (stack.length < 2) return { stack: [...stack], to: null };
  const next = stack.slice(0, -1);
  return { stack: next, to: next[next.length - 1] };
}

/**
 * THE verb. One binding per surface, and it means both directions:
 * press it away from 辞書 and you go to 辞書; press it in 辞書 and you land
 * back where you summoned it from.
 *
 * `replaceHere` is how the caller keeps the editor honest — the live cursor at
 * the moment of the press, so the place you return to is the place you left
 * rather than the place you last happened to be recorded at.
 */
export function toggle(
  stack: readonly Place[],
  surface: Surface,
  replaceHere?: Place | null,
): { stack: Place[]; to: Place | null; action: 'go' | 'back' } {
  const base = replaceHere ? [...stack.slice(0, -1), replaceHere] : [...stack];
  const top = here(base);
  if (top?.kind === 'surface' && top.surface === surface) {
    const r = back(base);
    // Nowhere behind: stay put rather than dumping you on a blank workspace.
    return r.to ? { ...r, action: 'back' } : { stack: base, to: null, action: 'back' };
  }
  const next = goTo(base, { kind: 'surface', surface });
  return { stack: next, to: here(next), action: 'go' };
}

/**
 * ## Why everything is "shrunk up" on the iPad
 *
 * Five of the six surfaces open with `getRightLeaf(false)`. On a desktop that
 * is a resizable panel beside the editor and it is the right home. On mobile —
 * phone AND tablet — Obsidian's right sidebar is a fixed-width slide-over
 * DRAWER. It does not resize, it does not care that the iPad has 1366px, and
 * it covers the editor anyway while it is open. So the surfaces were being
 * squeezed into a phone-sized column on a tablet and then blamed for being
 * cramped. It is the same mistake `posture.ts` was written to end, one layer
 * up: a decision made about the device instead of about the PANE.
 *
 * The drawer was tolerable only because it was the only way to keep the editor
 * reachable. With a back-stack, going full-width costs nothing — the way back
 * is one press — so there is no longer any reason to accept the drawer.
 *
 * The threshold is the width below which a sidebar-mounted surface stops being
 * usable next to a document: two ~430px columns plus a divider.
 */
export const SIDE_MIN_WIDTH = 880;

export function presentation(posture: Posture, windowWidth: number): Presentation {
  if (posture !== 'desk') return 'full';       // the mobile sidebar is a drawer
  return windowWidth >= SIDE_MIN_WIDTH ? 'side' : 'full';
}

/**
 * Mouse buttons the webview actually receives.
 *
 * An Elecom trackball or an MX Master sends buttons 3 and 4 (the thumb pair)
 * as ordinary `mousedown`, and those are the only extra buttons that arrive —
 * anything above 4 never reaches a webview and has to be mapped to a KEYSTROKE
 * in Elecom Mouse Assistant or Logi Options+. That is why every verb here is
 * also registered as an Obsidian command: the command is what a mapped
 * keystroke lands on, so the mice ride the hotkey layer for free instead of
 * needing a driver integration that cannot exist.
 */
export const MOUSE_BACK = 3;
export const MOUSE_FORWARD = 4;

/** `null` for any button that is not the thumb pair, so callers never guess. */
export function mouseIntent(button: number): 'back' | 'forward' | null {
  if (button === MOUSE_BACK) return 'back';
  if (button === MOUSE_FORWARD) return 'forward';
  return null;
}
