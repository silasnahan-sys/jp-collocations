/**
 * drop-router.ts — the surface blooms when you carry something over it.
 *
 * The gesture this exists for: iPad, Stage Manager, Apple Notes on the left and
 * this plugin on the right. You select a line with the Pencil, drag it across
 * the seam, and the target surface *opens up* to receive it — big soft targets,
 * one per thing the drop could mean, the one under your nib lifted. Let go and
 * it lands with a definite thump and a concrete confirmation.
 *
 * Three things make that feel right rather than merely functional, and all
 * three are load-bearing:
 *
 * 1. **The surface reacts before you commit.** Targets appear on `dragenter`,
 *    not on drop. You are choosing, not gambling.
 * 2. **Targets are Pencil-sized and few.** Never more than four. A nib is
 *    precise but a wrist in mid-air is not, so 88px of card beats 44px of row.
 * 3. **The landing is specific.** "⏱ 文字起こしを取り込む" is a promise the
 *    executor then keeps, and the Notice afterwards names what actually
 *    happened — never a silent success (§28 S6).
 *
 * The awkward part of the spec, handled here so no caller has to think about
 * it: while a drag is in flight `getData()` returns `''` by design (drag data
 * is protected until drop). So the cards are drawn from a VAGUE sample —
 * `types` plus per-file MIME — and re-derived concretely on drop. `dropIntents`
 * keys intents by action precisely so the target you aimed at is still findable
 * a moment later. When it isn't (you aimed at ⚡ but the payload turned out to
 * be a YouTube link), the concrete leader wins and says so; guessing your aim
 * onto a payload that cannot support it would be the dishonest branch.
 */

import { Notice } from 'obsidian';
import { dropIntents, type DropIntent, type DropSample, type DropSurface } from '../notes/drop-intent.ts';
import { registerPointerDropZone } from './pointer-drag.ts';
import type { DragPayload } from './drag-out.ts';

export interface DropRouterDeps {
  /** A thunk when the surface changes under the same element — the lexicon is
   *  a list until you open an entry, and then it can accept 用例. */
  surface: DropSurface | (() => DropSurface);
  /** Headword of the entry open RIGHT NOW — re-read per drag, never captured. */
  entryKey?: () => string | undefined;
  /** Capabilities, re-read per drag: settings change without a reload. */
  can?: () => { ocr?: boolean; x?: boolean };
  /** §28 S5 — the one road in. Every surface hands its drop to the same executor. */
  run: (intent: DropIntent, files: File[]) => void | Promise<void>;
  /**
   * Route ⌘V through the same targets. Off by default: a view with its own
   * search box wants paste to reach the box, and this would eat it.
   */
  paste?: boolean;
}

const MAX_CARDS = 4;

/**
 * Arm `root` as a drop surface. Returns a detach function; calling twice on the
 * same element is a no-op (views re-render their contents, not their root).
 */
export function attachDropRouter(root: HTMLElement, deps: DropRouterDeps): () => void {
  const host = root as HTMLElement & { _jpcDrop?: () => void };
  if (host._jpcDrop) return host._jpcDrop;

  root.addClass('jp-drop-host');
  let veil: HTMLElement | null = null;
  let cards: DropIntent[] = [];
  /**
   * dragenter/dragleave fire per descendant, so a naive `dragleave` teardown
   * flickers the whole overlay every time the pointer crosses a card boundary.
   * Depth counting is the standard fix and the only one that survives the
   * overlay being made of elements that themselves receive the events.
   */
  let depth = 0;

  const ctx = () => ({
    surface: typeof deps.surface === 'function' ? deps.surface() : deps.surface,
    entryKey: deps.entryKey?.(),
    can: deps.can?.() ?? {},
  });

  const teardown = (): void => {
    depth = 0;
    veil?.remove();
    veil = null;
    cards = [];
  };

  const paint = (intents: DropIntent[], mode: 'drag' | 'paste'): void => {
    cards = intents.slice(0, MAX_CARDS);
    if (!cards.length) { teardown(); return; }
    veil?.remove();
    veil = root.createDiv(`jp-drop-veil jp-drop-veil--${mode}`);
    const sheet = veil.createDiv('jp-drop-sheet');
    sheet.createDiv({
      cls: 'jp-drop-title',
      text: mode === 'paste' ? '貼り付けたものを…' : 'ここへ落とす',
    });
    const rack = sheet.createDiv('jp-drop-cards');
    for (const [i, intent] of cards.entries()) {
      const card = rack.createEl('button', { cls: 'jp-drop-card' });
      card.dataset.action = intent.action;
      // Staggered bloom. Cheap, and it reads as the surface *opening* rather
      // than a dialog appearing — the difference between a drawer and a modal.
      card.style.setProperty('--jp-drop-i', String(i));
      card.createSpan({ cls: 'jp-drop-card-icon', text: intent.icon });
      const body = card.createDiv('jp-drop-card-body');
      body.createDiv({ cls: 'jp-drop-card-label', text: intent.label });
      body.createDiv({ cls: 'jp-drop-card-detail', text: intent.detail });
      if (i === 0) card.addClass('jp-drop-card--default');
    }
  };

  /** What we can see mid-drag: the type list, plus MIME for each file. */
  const previewSample = (dt: DataTransfer | null): DropSample => ({
    preview: true,
    kinds: dt ? Array.from(dt.types) : [],
    files: dt ? Array.from(dt.items ?? [])
      .filter((it) => it.kind === 'file')
      .map((it) => ({ type: it.type })) : [],
  });

  const realSample = (dt: DataTransfer): { sample: DropSample; files: File[] } => {
    const files = Array.from(dt.files ?? []);
    return {
      sample: {
        text: dt.getData('text/plain') || undefined,
        uriList: dt.getData('text/uri-list') || undefined,
        kinds: Array.from(dt.types),
        files: files.map((f) => ({ name: f.name, type: f.type })),
      },
      files,
    };
  };

  const indexOfCard = (el: HTMLElement | null): number => {
    const card = el?.closest?.('.jp-drop-card') as HTMLElement | null;
    if (!card) return -1;
    const rack = card.parentElement;
    return rack ? Array.from(rack.children).indexOf(card) : -1;
  };

  /** Which card the pointer is over, if any. */
  const cardAt = (e: DragEvent): number => indexOfCard(e.target as HTMLElement | null);

  /** The same question from bare coordinates — the synthetic path has no
   *  event target, because the pill is what is under the finger. */
  const cardAtPoint = (x: number, y: number): number =>
    indexOfCard(document.elementFromPoint(x, y) as HTMLElement | null);

  const arm = (idx: number): void => {
    if (!veil) return;
    veil.querySelectorAll('.jp-drop-card').forEach((el, i) => {
      (el as HTMLElement).toggleClass('jp-drop-card--armed', i === idx);
    });
  };

  const onEnter = (e: DragEvent): void => {
    const dt = e.dataTransfer;
    if (!dt) return;
    // Nothing we can carry — let the event go wherever it was going.
    if (!dt.types.length) return;
    depth++;
    if (veil) return;
    const intents = dropIntents(previewSample(dt), ctx());
    if (!intents.length) { depth = 0; return; }
    e.preventDefault();
    paint(intents, 'drag');
  };

  const onOver = (e: DragEvent): void => {
    if (!veil) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    arm(cardAt(e));
  };

  const onLeave = (): void => {
    depth--;
    if (depth <= 0) teardown();
  };

  const onDrop = (e: DragEvent): void => {
    if (!veil || !e.dataTransfer) { teardown(); return; }
    const aimedIdx = cardAt(e);
    const aimed = aimedIdx >= 0 ? cards[aimedIdx]?.action : undefined;
    const { sample, files } = realSample(e.dataTransfer);
    const real = dropIntents(sample, ctx());
    if (!real.length) { teardown(); return; }
    e.preventDefault();
    e.stopPropagation();
    const chosen = (aimed && real.find((i) => i.action === aimed)) ?? real[0];
    flash(root, e.clientX, e.clientY);
    teardown();
    // The aim was unsupportable by what actually arrived. Say so rather than
    // pretending — the alternative is a drop that silently did something else.
    if (aimed && chosen.action !== aimed) {
      new Notice(`落としたものは別物でした → ${chosen.icon} ${chosen.label}`, 4000);
    }
    void deps.run(chosen, files);
  };

  const onPaste = (e: ClipboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const cb = e.clipboardData;
    if (!cb) return;
    const files = Array.from(cb.files ?? []);
    const sample: DropSample = {
      text: cb.getData('text/plain') || undefined,
      uriList: cb.getData('text/uri-list') || undefined,
      kinds: Array.from(cb.types ?? []),
      files: files.map((f) => ({ name: f.name, type: f.type })),
    };
    const intents = dropIntents(sample, ctx());
    if (!intents.length) return;
    e.preventDefault();
    paint(intents, 'paste');
    if (!veil) return;
    veil.querySelectorAll('.jp-drop-card').forEach((el, i) => {
      el.addEventListener('click', () => {
        const intent = cards[i];
        teardown();
        void deps.run(intent, files);
      });
    });
    // Anywhere else, or Escape, cancels — a paste chooser that traps you is
    // worse than no paste chooser.
    veil.addEventListener('click', (ev) => { if (ev.target === veil) teardown(); });
    const esc = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      teardown();
      window.removeEventListener('keydown', esc, true);
    };
    window.addEventListener('keydown', esc, true);
  };

  /**
   * The same surface, for a carry the platform never turned into a DragEvent.
   *
   * Everything below reuses `paint`/`arm`/`teardown`/`flash` unchanged — the
   * bloom, the four cards and the landing ring are the gesture, and a drop that
   * looked different depending on which transport delivered it would be a seam
   * the user has to learn (§26.0 property 4).
   *
   * One thing is simpler here: a real drag hides its payload until `drop`, so
   * `onEnter` has to paint from `previewSample` and `onDrop` re-derives and
   * apologises when the aim turns out unsupportable. A synthetic drag knows the
   * payload from the first frame, so the cards drawn are the cards meant, and
   * that correction branch cannot fire.
   */
  const carried = (p: DragPayload): DropSample => ({
    text: p.text,
    kinds: ['text/plain', 'text/html', 'application/x-jpc-drag'],
    files: [],
  });

  const detachZone = registerPointerDropZone({
    el: root,
    enter: (p) => {
      const intents = dropIntents(carried(p), ctx());
      if (intents.length) paint(intents, 'drag');
    },
    over: (x, y) => arm(cardAtPoint(x, y)),
    leave: () => teardown(),
    drop: (p, x, y) => {
      const intents = dropIntents(carried(p), ctx());
      if (!intents.length) { teardown(); return; }
      const idx = cardAtPoint(x, y);
      const chosen = (idx >= 0 && cards[idx]) || intents[0];
      flash(root, x, y);
      teardown();
      void deps.run(chosen, []);
    },
  });

  root.addEventListener('dragenter', onEnter);
  root.addEventListener('dragover', onOver);
  root.addEventListener('dragleave', onLeave);
  root.addEventListener('drop', onDrop);
  if (deps.paste) root.addEventListener('paste', onPaste);

  const detach = (): void => {
    teardown();
    detachZone();
    root.removeClass('jp-drop-host');
    root.removeEventListener('dragenter', onEnter);
    root.removeEventListener('dragover', onOver);
    root.removeEventListener('dragleave', onLeave);
    root.removeEventListener('drop', onDrop);
    if (deps.paste) root.removeEventListener('paste', onPaste);
    delete host._jpcDrop;
  };
  host._jpcDrop = detach;
  return detach;
}

/**
 * The landing. A ring at the exact point the nib let go — the physical
 * acknowledgement that the surface caught the thing, fired before any async
 * work starts so it never reads as "loading".
 */
function flash(root: HTMLElement, clientX: number, clientY: number): void {
  const box = root.getBoundingClientRect();
  const dot = root.createDiv('jp-drop-flash');
  dot.style.left = `${clientX - box.left}px`;
  dot.style.top = `${clientY - box.top}px`;
  window.setTimeout(() => dot.remove(), 520);
}
