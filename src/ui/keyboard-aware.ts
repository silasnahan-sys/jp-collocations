/**
 * keyboard-aware.ts — the pane yields to the keyboard instead of hiding under it.
 *
 * Filmed (IMG_1197, and a third of every Monokakido session before it): on the
 * iPad the software keyboard sits ON the plugin — over the results list, over
 * the search box's own corner — and the user reads around it. コマ送り's law 10
 * put it as "the corner belongs to the keyboard"; this module is the half of
 * that law a webview can actually enforce.
 *
 * What it can and cannot know, measured rather than assumed:
 *
 *   • A DOCKED or SPLIT keyboard shrinks `window.visualViewport`. That delta is
 *     exact, so the pane can shorten by exactly that much and every bottom-
 *     anchored control (the search box, the thumb dock, the surface bar) rises
 *     with it. This file handles that case completely.
 *   • A FLOATING keyboard (the 10-key the films show most) is a system window
 *     the page cannot see — no resize, no geometry, nothing. No web code can
 *     dodge it. What survives even then: the focused input is scrolled into
 *     view, and nothing this plugin owns is pinned into the corners the user
 *     parks that keyboard in.
 *
 * Mechanism: while an element inside `root` holds focus and the visual viewport
 * is shorter than the layout viewport, `--jp-kb-inset` carries the difference
 * and `jp-kb-open` turns it into bottom padding on the view root (styles.css).
 * The root is a flex column in every surface, so its scrollers shrink and the
 * docked controls rise — no per-view work.
 *
 * Listener hygiene: `visualViewport` outlives any view, so the geometry
 * listeners unhook themselves the first time they fire for a root that has
 * left the document. `armKeyboardClearance` is idempotent per element, matching
 * `attachDropRouter` / `attachSelectionEcho`.
 */

/** Viewport shortfall below this is a browser UI twitch, not a keyboard. */
const MIN_KB_PX = 60;

export function armKeyboardClearance(root: HTMLElement): void {
  const host = root as HTMLElement & { _jpcKb?: boolean };
  if (host._jpcKb) return;
  const vv = window.visualViewport;
  if (!vv) return;                    // pre-visualViewport webview: nothing to measure
  host._jpcKb = true;

  let raf = 0;

  const clear = (): void => {
    root.removeClass('jp-kb-open');
    root.style.removeProperty('--jp-kb-inset');
  };

  const unhook = (): void => {
    vv.removeEventListener('resize', onGeo);
    vv.removeEventListener('scroll', onGeo);
    delete host._jpcKb;
  };

  const apply = (): void => {
    raf = 0;
    // Self-cleaning: the viewport outlives the view.
    if (!root.isConnected) { unhook(); return; }
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    const active = document.activeElement;
    if (inset >= MIN_KB_PX && active && root.contains(active)) {
      root.style.setProperty('--jp-kb-inset', `${Math.round(inset)}px`);
      root.addClass('jp-kb-open');
      // The input being typed into must never be the thing the keyboard hides.
      (active as HTMLElement).scrollIntoView?.({ block: 'nearest' });
    } else {
      clear();
    }
  };

  const onGeo = (): void => {
    if (!raf) raf = window.requestAnimationFrame(apply);
  };

  vv.addEventListener('resize', onGeo);
  vv.addEventListener('scroll', onGeo);
  root.addEventListener('focusin', onGeo);
  // focusout fires before the keyboard's dismiss animation settles; the
  // deferred re-measure sees the restored viewport and clears the inset.
  root.addEventListener('focusout', () => window.setTimeout(onGeo, 80));
}
