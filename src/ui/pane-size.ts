/**
 * pane-size.ts — layout answers to the box the content is actually in.
 *
 * ## The bug this closes, stated once
 *
 * `styles.css` line 6940 already knows the rule:
 *
 *   > `@media (max-width: 600px)` describes the WINDOW. The thing that
 *   > actually needs sizing is a pane.
 *
 * …and then the file goes on to carry eighteen width media queries anyway, six
 * of them at `max-width: 600px`, while `posture()` branches on
 * `window.innerWidth >= 700`. Every layout decision in the plugin is therefore
 * computed from a number that does not describe the box the user is looking at.
 *
 * MEASURED 2026-08-08 from two camera recordings: this plugin is essentially
 * never run at window width. It is a ~390pt floating window sitting over
 * Manatan, a split-view column beside Apple Notes, a Slide Over strip, or a
 * leaf inside an Obsidian window that itself has a sidebar open. In every one
 * of those the window number and the pane number disagree — and they disagree
 * by DIFFERENT amounts depending on what else happens to be open. So the same
 * pane width produces different layouts, and different pane widths produce the
 * same layout.
 *
 * That is the whole reason placement feels arbitrary and why muscle memory
 * never forms: the toolbar genuinely does move for reasons that have nothing to
 * do with the pane in front of you.
 *
 * ## What this does instead
 *
 * One `ResizeObserver` per view root, writing a size class and a custom
 * property onto that root. CSS then scopes by `.jp-pane-xs` and friends and is
 * correct in a Slide Over strip, a split column, a floating window and a
 * maximised desktop leaf without knowing which of those it is in.
 *
 * Deliberately NOT CSS container queries: `container-type: inline-size`
 * establishes containment on the element, which changes how the existing
 * absolutely-positioned rail, the sticky foot bar and the drop veil resolve
 * their containing block. A class carries the same information and disturbs
 * nothing already shipped.
 */

export type PaneSize = 'xs' | 'sm' | 'md' | 'lg';

export const PANE_SIZES: readonly PaneSize[] = ['xs', 'sm', 'md', 'lg'];

/**
 * The breakpoints, chosen by WHAT FITS rather than by device names.
 *
 * The load-bearing one is `xs`, and it is set at 440 rather than at the width
 * where the bar stops fitting. Five captioned buttons fit down to about 300px,
 * so a "does the row fit" threshold would have put the ~390px floating window
 * over Manatan into the roomy branch — and that window is precisely where the
 * chrome was measured to be worst, because the bar is not competing with the
 * bar. It is competing with the foot bar AND the tool rail AND 戻る AND
 * Obsidian's own navigation bar, stacked, in a pane that also has to show
 * Japanese.
 *
 * So `xs` means "this pane has no chrome budget", not "the row would overflow",
 * and 440 is the width below which every real pane he uses — a 320px Slide
 * Over strip, a ~390px floating window, a narrow split column — is one of
 * those. Above it there is room for captions, and a captioned button is a
 * better target than a bare glyph.
 *
 * `sm` is a narrow split column; `md` is about half an iPad; `lg` is a pane
 * with room to spare and is the only one where anything may sit inline in a
 * header rather than in a dock.
 */
export function paneSize(width: number): PaneSize {
  if (!(width > 0)) return 'md';      // unmeasured: assume the roomy middle
  if (width < 440) return 'xs';
  if (width < 620) return 'sm';
  if (width < 900) return 'md';
  return 'lg';
}

/** The size an element's own box is right now, measured rather than remembered. */
export const paneSizeOf = (el: HTMLElement): PaneSize => paneSize(el.clientWidth);

/** Narrow enough that labels come off and nothing may be allowed to wrap. */
export const isTightPane = (s: PaneSize): boolean => s === 'xs';

/** Narrow enough that chrome must earn its vertical space. */
export const isNarrowPane = (s: PaneSize): boolean => s === 'xs' || s === 'sm';

const CLASSES = PANE_SIZES.map((s) => `jp-pane-${s}`);

/**
 * Write `size` onto `el` as a class, removing the other three.
 *
 * Split out and exported because it is the whole contract with the stylesheet,
 * and because a golden can then check the class bookkeeping without needing a
 * `ResizeObserver` in the harness.
 */
export function applyPaneSize(el: HTMLElement, size: PaneSize, width?: number): void {
  for (const c of CLASSES) el.classList.remove(c);
  el.classList.add(`jp-pane-${size}`);
  // Exposed for the rare rule that wants a real number — a max-width on a
  // measured column, say — without reaching for the window again.
  if (width && width > 0) el.style.setProperty('--jp-pane-w', `${Math.round(width)}px`);
}

/**
 * Keep `el`'s pane class in sync with its own width. Returns a detach function.
 *
 * Idempotent per element: views re-render their contents constantly, and a
 * second observer on the same root would double every callback and leak the
 * first. Same guard `attachDropRouter` uses, for the same reason.
 */
export function observePane(
  el: HTMLElement,
  onChange?: (size: PaneSize, width: number) => void,
): () => void {
  const host = el as HTMLElement & { _jpcPane?: () => void };
  if (host._jpcPane) return host._jpcPane;

  let last: PaneSize | null = null;
  const measure = (w: number): void => {
    const size = paneSize(w);
    // Always refresh the custom property; only churn classes on a real change.
    if (size === last) { if (w > 0) el.style.setProperty('--jp-pane-w', `${Math.round(w)}px`); return; }
    last = size;
    applyPaneSize(el, size, w);
    onChange?.(size, w);
  };

  measure(el.clientWidth);

  // Guarded: the golden harness's hand-written DOM has no ResizeObserver, and
  // a view that never resizes is still correctly sized by the call above.
  const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  let ro: ResizeObserver | null = null;
  if (RO) {
    ro = new RO((entries) => {
      for (const e of entries) {
        // `contentBoxSize` is the spec'd path; `contentRect` is the one Safari
        // shipped first and still populates. Either gives the pane, not the window.
        const w = e.contentBoxSize?.[0]?.inlineSize ?? e.contentRect?.width ?? 0;
        measure(w);
      }
    });
    ro.observe(el);
  }

  const detach = (): void => {
    ro?.disconnect();
    for (const c of CLASSES) el.classList.remove(c);
    el.style.removeProperty('--jp-pane-w');
    delete host._jpcPane;
  };
  host._jpcPane = detach;
  return detach;
}
