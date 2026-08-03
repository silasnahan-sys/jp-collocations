/**
 * view-chrome.ts — the two things every plugin view now has in common.
 *
 * §28 S5 says every medium funnels into the same path. That has always been
 * stated about *data*; this is the same claim about *chrome*. A drop that means
 * one thing on the 辞書 and another on the 語彙 is a seam the user has to learn;
 * a switcher that exists on three surfaces and not the other two is a seam they
 * have to remember. So both live here, once, and every ItemView wires them the
 * same way in two lines.
 *
 * Deliberately not a base class: these views already extend Obsidian's
 * `ItemView`, and half of them mount their real content through a renderer
 * (LexiconPanel) rather than owning it. Two free functions compose; an
 * inheritance chain would not.
 */

import { Platform } from 'obsidian';
import type { DropIntent, DropSurface } from '../notes/drop-intent.ts';
import { attachDropRouter } from './drop-router.ts';
import { attachSelectionEcho } from './selection-echo.ts';
import { renderSurfaceBar, type Surface } from './surface-bar.ts';

/** The late-bound deps main.ts assigns onto each view. All optional: a view
 *  constructed without them simply has no drop road and no bar. */
export interface ViewChrome {
  /** §29 — hand a routed drop to the one executor. */
  onDrop?: (intent: DropIntent, files: File[]) => void;
  dropCan?: () => { ocr?: boolean; x?: boolean };
  /** §26.3 — where the identity bar goes. */
  openSurface?: (s: Surface) => void;
  surfaceBadge?: (s: Surface) => number | undefined;
}

/**
 * Arm a view's root as a drop surface. Safe to call on every render — the
 * router itself is idempotent per element.
 */
export function armDrops(
  host: HTMLElement,
  chrome: ViewChrome,
  surface: DropSurface | (() => DropSurface),
  opts: { paste?: boolean; entryKey?: () => string | undefined } = {},
): void {
  if (!chrome.onDrop) return;
  attachDropRouter(host, {
    surface,
    entryKey: opts.entryKey,
    can: () => chrome.dropCan?.() ?? {},
    run: (intent, files) => chrome.onDrop!(intent, files),
    paste: opts.paste,
  });
}

/**
 * §26.3 step 4 — the selection verb. Same classifier, same executor, so a
 * highlighted phrase offers exactly the verbs a dropped one would.
 *
 * Deliberately NOT wired into the 辞書, which already answers a selection with
 * its own relation-typed capture (`offerCapture`: 語釈 / 対比 / 判定 / 実例).
 * Two bars for one gesture would be worse than the one that knows more.
 */
export function armSelectionEcho(
  host: HTMLElement,
  chrome: ViewChrome,
  surface: DropSurface | (() => DropSurface),
  opts: { entryKey?: () => string | undefined } = {},
): void {
  if (!chrome.onDrop) return;
  attachSelectionEcho(host, {
    surface,
    entryKey: opts.entryKey,
    can: () => chrome.dropCan?.() ?? {},
    run: (intent) => chrome.onDrop!(intent, []),
  });
}

/**
 * §26.3 — the phone footer. Returns null on every other device.
 *
 * ACE CROWN's layout law, which §26.3 adopts verbatim: on a phone EVERY
 * actionable element sits in the thumb zone, reading zone on top. The plugin
 * stated that law and then kept its single most-used control — the search box —
 * at the top of 語彙, 辞書 and 𝕏, which is the least reachable place there is
 * one-handed. The posture this fails hardest in is the one the phone is
 * actually used in (§25's table: iPhone, one thumb, eyes elsewhere).
 *
 * It also fixes something quieter. `renderSurfaceBar` has always emitted
 * `jp-surfbar--foot` on a phone — `position: sticky; bottom: 0` — but three
 * views mount it into a `flex-shrink: 0` header pinned to the TOP of the
 * column. Sticky-bottom inside a non-scrolling top header is inert, so the
 * footer bar has never once reached the foot in 辞書 or 𝕏. Both problems have
 * the same shape and the same fix: one real footer, and everything that belongs
 * under the thumb goes in it.
 *
 * Callers pass `dock ?? header` as the parent of each control, so the desktop
 * path is untouched — off a phone this returns null and nothing moves.
 * Vertical order inside the dock is CSS `order`, not call order, so views can
 * keep building their controls in whatever sequence already reads well.
 */
export function thumbDock(viewRoot: HTMLElement): HTMLElement | null {
  if (!Platform.isPhone) return null;
  return viewRoot.createDiv('jp-thumbdock');
}

/** Render the identity bar, or nothing when the view was given no navigator. */
export function mountSurfaceBar(host: HTMLElement, chrome: ViewChrome, current: Surface): void {
  if (!chrome.openSurface) return;
  renderSurfaceBar(host, {
    current,
    open: (s) => chrome.openSurface!(s),
    badge: (s) => chrome.surfaceBadge?.(s),
  });
}
