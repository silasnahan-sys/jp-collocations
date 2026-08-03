/**
 * selection-echo.ts — §26.3 build-order step 4, the last unbuilt platform verb.
 *
 * Dragging answers "this thing, over there." Selecting answers "this *part* of
 * the thing, right here" — and until now the answer to that, inside a plugin
 * view, was nothing at all. You could highlight a phrase inside a transcript
 * line or a located 用例 and the only thing available was ⌘C and a trip through
 * the command palette, which on an iPad means putting the Pencil down.
 *
 * The echo is the same brain as the drop road wearing a third face:
 * `dropIntents` decides what a highlighted phrase could mean, the identical
 * executor runs it, and the verbs therefore READ the same in all three input
 * modes. Drag it in, paste it in, or select it in place — 「⚡ 分類して台帳へ」
 * means exactly one thing everywhere, which is the only way a gesture
 * vocabulary stays learnable (§26.2).
 *
 * Placement follows §26.3's device law rather than the selection: on a phone
 * the bar pins to the bottom, because an action at the selection is an action
 * under your own hand where you cannot see it. On desktop and iPad it floats
 * just above the highlight, viewport-clamped.
 */

import { Platform } from 'obsidian';
import { dropIntents, type DropIntent, type DropSurface } from '../notes/drop-intent.ts';

export interface SelectionEchoDeps {
  surface: DropSurface | (() => DropSurface);
  entryKey?: () => string | undefined;
  can?: () => { ocr?: boolean; x?: boolean };
  run: (intent: DropIntent) => void;
}

/** Below this a "selection" is a stray tap that grabbed one character. */
const MIN_CHARS = 2;
const MAX_VERBS = 4;

export function attachSelectionEcho(root: HTMLElement, deps: SelectionEchoDeps): () => void {
  const host = root as HTMLElement & { _jpcEcho?: () => void };
  if (host._jpcEcho) return host._jpcEcho;
  // The bar is absolutely positioned against this element, so this element has
  // to BE a positioning context. Every current caller also arms the drop router
  // (which sets one), and relying on that would work right up until the first
  // surface that wants the echo without the drops.
  root.addClass('jp-echo-host');

  let bar: HTMLElement | null = null;
  let timer: number | null = null;

  const hide = (): void => { bar?.remove(); bar = null; };

  const ctx = () => ({
    surface: typeof deps.surface === 'function' ? deps.surface() : deps.surface,
    entryKey: deps.entryKey?.(),
    can: deps.can?.() ?? {},
  });

  const show = (): void => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (!sel || sel.rangeCount === 0 || [...text].length < MIN_CHARS) { hide(); return; }
    // Only selections made INSIDE this view — a highlight in the editor pane
    // next door is not this view's business.
    const anchor = sel.anchorNode;
    if (!anchor || !root.contains(anchor.nodeType === 1 ? anchor : anchor.parentNode)) { hide(); return; }
    // Never over our own bar (clicking a verb re-fires selectionchange).
    if (bar?.contains(anchor.nodeType === 1 ? anchor : anchor.parentNode)) return;

    const intents = dropIntents({ text }, ctx()).slice(0, MAX_VERBS);
    if (!intents.length) { hide(); return; }

    hide();
    bar = root.createDiv(`jp-echo${Platform.isPhone ? ' jp-echo--foot' : ''}`);
    for (const intent of intents) {
      const b = bar.createEl('button', { cls: 'jp-echo-btn', attr: { title: intent.detail } });
      b.createSpan({ cls: 'jp-echo-icon', text: intent.icon });
      b.createSpan({ cls: 'jp-echo-label', text: intent.label });
      // `pointerdown` rather than `click`: a click lands only after the
      // browser has collapsed the selection, and on iOS the synthesized
      // `mousedown` lands after `touchend` — later still. pointerdown is the
      // first event every input device agrees on. (The phrase itself is
      // already frozen into `intent.payload.text`, so a collapse mid-flight
      // costs nothing; this is purely about the handler firing at all.)
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hide();
        window.getSelection()?.removeAllRanges();
        deps.run(intent);
      });
    }

    if (Platform.isPhone) return;                    // pinned; no math needed
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const barW = bar.offsetWidth || 240;
    const left = Math.min(
      Math.max(8, rect.left - box.left + rect.width / 2 - barW / 2),
      Math.max(8, box.width - barW - 8),
    );
    // Above the highlight when there is room, below it when there is not —
    // the bar must never sit on top of the words it is about.
    const above = rect.top - box.top - bar.offsetHeight - 8;
    bar.style.left = `${left}px`;
    bar.style.top = above > 4 ? `${above}px` : `${rect.bottom - box.top + 8}px`;
  };

  // `selectionchange` fires continuously through a drag-select, so the bar is
  // built once the hand has settled rather than on every intermediate range.
  const onChange = (): void => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(show, 160);
  };
  const onEsc = (e: KeyboardEvent): void => { if (e.key === 'Escape') hide(); };

  document.addEventListener('selectionchange', onChange);
  root.addEventListener('scroll', hide, true);
  window.addEventListener('keydown', onEsc, true);

  const detach = (): void => {
    if (timer) window.clearTimeout(timer);
    hide();
    document.removeEventListener('selectionchange', onChange);
    root.removeEventListener('scroll', hide, true);
    window.removeEventListener('keydown', onEsc, true);
    root.removeClass('jp-echo-host');
    delete host._jpcEcho;
  };
  host._jpcEcho = detach;
  return detach;
}
