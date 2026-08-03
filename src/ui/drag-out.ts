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
 * Three flavours go on the wire every time, because three different receivers
 * are listening:
 *   • `text/plain` — Apple Notes, the editor, anything. The Japanese, clean.
 *   • `text/html`  — Notes and Pages keep the shape: a quote arrives as a
 *     blockquote, an entry as a bold headword with its reading. Formatting on
 *     arrival is most of what makes the gesture feel finished.
 *   • `application/x-jpc-drag` — our own surfaces, so a quote dragged onto an
 *     entry can become a 用例 that still knows which video it came from
 *     (§28 S2: provenance is never dropped, and a drag is a boundary crossing
 *     like any other).
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

/**
 * Make `el` a drag source. `payload()` is called at `dragstart`, not now, so a
 * row that re-renders its own content keeps handing over what it currently
 * shows. Returning null declines the drag (an empty row, a placeholder).
 */
export function makeDraggable(el: HTMLElement, payload: () => DragPayload | null): void {
  const host = el as HTMLElement & { _jpcDrag?: boolean };
  if (host._jpcDrag) return;
  host._jpcDrag = true;
  el.setAttribute('draggable', 'true');
  el.addClass('jp-draggable');

  el.addEventListener('dragstart', (e: DragEvent) => {
    const p = payload();
    if (!p || !p.text.trim() || !e.dataTransfer) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', p.text);
    e.dataTransfer.setData('text/html', p.html ?? defaultHtml(p));
    e.dataTransfer.setData('application/x-jpc-drag', JSON.stringify({
      kind: p.kind, text: p.text, ...(p.meta ?? {}),
    }));
    e.dataTransfer.setDragImage(...dragPill(p));
    // The row itself dims while its copy is in the air — the thing you are
    // carrying should not also still be sitting there at full weight.
    el.addClass('jp-draggable--lifted');
  });

  el.addEventListener('dragend', () => el.removeClass('jp-draggable--lifted'));

  // The same source, for the platforms where none of the above ever fires.
  bindPointerDrag(el, payload, dragPillEl);
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
