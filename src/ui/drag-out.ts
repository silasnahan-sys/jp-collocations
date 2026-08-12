/**
 * drag-out.ts — the other half of the gesture.
 *
 * A drop router that only receives is a one-way valve, and one-way valves are
 * why "just retype it" keeps happening. Everything the plugin shows that is a
 * *thing* — a headword, a located quote, a dictionary sense, a tweet, a
 * transcript line — is draggable out of it: into Apple Notes across the Stage
 * Manager seam, into an Obsidian editor pane, or back into another plugin
 * surface (where `application/x-jpc-drag` lets the receiver keep provenance
 * instead of receiving anonymous text).
 *
 * On platforms whose WebKit never fires `dragstart` from a touch (iPhone), the
 * whole mechanism below is inert, so every source armed here ALSO gets the
 * synthetic path in `pointer-drag.ts`. Native keeps first refusal — see that
 * file for how the two stay out of each other's way.
 *
 * Four flavours go on the wire, because four different receivers are listening:
 *   • `text/plain` — Apple Notes, the editor, anything. The Japanese, clean.
 *   • `text/html`  — Notes and Pages keep the shape: a quote arrives as a
 *     blockquote, an entry as a bold headword with its reading. Formatting on
 *     arrival is most of what makes the gesture feel finished.
 *   • `text/uri-list` — what a thing IS when it is a FILE rather than a
 *     sentence. See below.
 *   • `application/x-jpc-drag` — our own surfaces, so a quote dragged onto an
 *     entry can become a 用例 that still knows which video it came from
 *     (§28 S2: provenance is never dropped, and a drag is a boundary crossing
 *     like any other).
 *
 * ## `text/uri-list`, and why its absence was the mirror of the drop-road bug
 *
 * The drop road learned to recognise a vault picture arriving as a resource URL
 * (`notes/resource-url.ts`). This road never PUT one on the wire — so a picture
 * leaving the plugin had no way to say it was a picture, and the tray solved
 * that by refusing to let image cards be dragged at all. The one card type that
 * IS a file was the one type that could not be carried.
 *
 * Now `payload.url` rides as `text/uri-list`, which means:
 *   • into another plugin surface, a carried picture is recognised as the vault
 *     file it already is — and a card holding a picture AND a sentence
 *     reconstitutes as the same pair on the far side rather than as two things;
 *   • into an Obsidian editor pane, the `text/plain` embed markup renders;
 *   • into Safari, a link card is a link instead of a string.
 *
 * What it does NOT do is make the picture itself appear in Apple Notes. A
 * webview cannot put file bytes on a cross-app drag — `dataTransfer.items.add`
 * is not available at `dragstart` on WebKit, and `app://`/`capacitor://` mean
 * nothing outside Obsidian. Notes receives the reference, not the image. That
 * is a platform ceiling, not an oversight, and it is written here so the next
 * reader does not go looking for the bug.
 */

import { bindPointerDrag } from './pointer-drag.ts';

export type DragKind = 'entry' | 'quote' | 'dict' | 'tweet' | 'line' | 'card';

export interface DragPayload {
  /** The Japanese itself — what a plain-text receiver gets. */
  text: string;
  kind: DragKind;
  /** Shown on the drag pill. Defaults to a snip of `text`. */
  label?: string;
  /** Secondary line on the pill (reading, speaker, timestamp, source). */
  sub?: string;
  /** Rich form. Omitted → a sensible default is composed per kind. */
  html?: string;
  /** Provenance for our own receivers: file, videoId, tSec, patternId, … */
  meta?: Record<string, string | number | undefined>;

  /**
   * What this thing IS, when it is a file or a link rather than a sentence.
   *
   * For a vault file that is its resource URL — the caller resolves it, because
   * `getResourcePath` needs an `App` and this module has none. For a link card
   * it is the link. Absent for everything that is only words, which is most of
   * what leaves here.
   */
  url?: string;
  /** The vault path behind `url`, for our own receivers — it does not expire. */
  path?: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function defaultHtml(p: DragPayload): string {
  const body = esc(p.text);
  switch (p.kind) {
    case 'quote':
    case 'line':
    case 'tweet': {
      const cite = p.sub ? `<br><small>— ${esc(p.sub)}</small>` : '';
      return `<blockquote>${body}${cite}</blockquote>`;
    }
    case 'entry':
    case 'dict':
      return `<b>${body}</b>${p.sub ? ` <span>（${esc(p.sub)}）</span>` : ''}`;
    default:
      return body;
  }
}

/** Options for a drag source. */
export interface DraggableOpts {
  /**
   * Arm the synthetic long-press carry too. Default true.
   *
   * Set FALSE where the element's long-press already means something else. The
   * transcript is the case that forced this: a long press on a line has been
   * the §25.1 seed-note gesture since it existed, and arming the carry on the
   * same element would have fired both — a note editor opening underneath a
   * pill you were already dragging. There the row keeps native drag (a mouse
   * drags it, and a mouse has no long press to collide with) while the carry
   * lives on the stamp beside it, which means nothing else.
   *
   * This is a real cost, not a free switch: off the native path a source with
   * `synthetic: false` cannot be carried by touch AT ALL. Only turn it off when
   * something else on the same element earns the gesture more.
   */
  synthetic?: boolean;

  /**
   * Where the drag is picked up from, when that is not the whole element.
   *
   * `draggable="true"` SUPPRESSES TEXT SELECTION inside the element it is set
   * on. A selection and a drag open identically — press, then move — so one
   * element cannot serve both; whichever the browser claims, the other is
   * gone. Arming a whole row therefore silently costs you the ability to
   * select anything written in it, which on a reading surface is the more
   * valuable of the two by a wide margin.
   *
   * So the row keeps its text and the carry moves to a handle. Pass the head
   * — the element bearing the name of the thing, which is what you reach for
   * when you mean to pick the thing up. 辞書 (`headerRow`) and 𝕏 (`head`)
   * have always done this; this option is how the rest say it.
   *
   * The row still dims while its copy is in the air: what lifts is the whole
   * thing, not the handle you lifted it by.
   */
  grip?: HTMLElement;
}

/**
 * Make `el` a drag source. `payload()` is called at `dragstart`, not now, so a
 * row that re-renders its own content keeps handing over what it currently
 * shows. Returning null declines the drag (an empty row, a placeholder).
 */
export function makeDraggable(
  el: HTMLElement,
  payload: () => DragPayload | null,
  opts: DraggableOpts = {},
): void {
  // What you grab, versus what travels. They are the same element unless a
  // grip says otherwise — see `DraggableOpts.grip` for why they often should
  // not be.
  const from = opts.grip ?? el;
  const host = from as HTMLElement & { _jpcDrag?: boolean };
  if (host._jpcDrag) return;
  host._jpcDrag = true;
  from.setAttribute('draggable', 'true');
  from.addClass('jp-draggable');

  from.addEventListener('dragstart', (e: DragEvent) => {
    const p = payload();
    if (!p || !p.text.trim() || !e.dataTransfer) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', p.text);
    e.dataTransfer.setData('text/html', p.html ?? defaultHtml(p));
    // Only when there is one: an empty `text/uri-list` is worse than none —
    // its mere PRESENCE in `types` makes the preview pass paint link verbs
    // over a carry that has no link (`dropIntents` reads `kinds`, and during a
    // drag that is all it can read).
    if (p.url) e.dataTransfer.setData('text/uri-list', p.url);
    e.dataTransfer.setData('application/x-jpc-drag', JSON.stringify({
      kind: p.kind, text: p.text, ...(p.path ? { path: p.path } : {}), ...(p.meta ?? {}),
    }));
    e.dataTransfer.setDragImage(...dragPill(p));
    // The row itself dims while its copy is in the air — the thing you are
    // carrying should not also still be sitting there at full weight.
    el.addClass('jp-draggable--lifted');
  });

  from.addEventListener('dragend', () => el.removeClass('jp-draggable--lifted'));

  // The same source, for the platforms where none of the above ever fires.
  // Bound to the grip for the same reason: a long press held on the row's text
  // is how a touch device opens a selection, and the carry must not eat it.
  if (opts.synthetic !== false) bindPointerDrag(from, payload, dragPillEl);
}

/**
 * The thing that follows the nib. The browser's default is a translucent
 * screenshot of the whole row — accurate and completely unreadable at a wrist's
 * distance. A small opaque pill carrying the headword reads at a glance, which
 * is the entire point of looking at it mid-drag.
 *
 * ONE builder for both paths. iOS ignores `setDragImage` and substitutes its own
 * snapshot, so on the native path this pill is a desktop-only nicety — but the
 * synthetic path positions it by hand, which is how the phone ends up with the
 * readable pill the platform refused to draw.
 */
export function dragPillEl(p: DragPayload): HTMLElement {
  const pill = document.body.createDiv('jp-drag-pill');
  pill.createDiv({ cls: 'jp-drag-pill-main', text: p.label ?? snip(p.text) });
  if (p.sub) pill.createDiv({ cls: 'jp-drag-pill-sub', text: p.sub });
  return pill;
}

/**
 * `setDragImage` snapshots synchronously but requires the node to be laid out,
 * so it goes into the document off-screen and is swept on the next tick.
 */
function dragPill(p: DragPayload): [HTMLElement, number, number] {
  const pill = dragPillEl(p);
  window.setTimeout(() => pill.remove(), 0);
  // Held under the nib rather than centred: a Pencil hides what is beneath it.
  return [pill, 16, 12];
}

function snip(s: string, n = 22): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return [...one].length <= n ? one : [...one].slice(0, n).join('') + '…';
}
