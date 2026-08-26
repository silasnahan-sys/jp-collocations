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
 * be a YouTube link), NOTHING runs: the rack repaints with what the payload
 * really supports and the user chooses or cancels. Running the concrete leader
 * with an explanatory toast was tried first and filmed landing as bafflement —
 * an executed verb the user never picked is a broken promise however well it
 * apologises.
 */

import { dropIntents, atenaFor, type DropIntent, type DropSample, type DropSurface } from '../notes/drop-intent.ts';
import type { InVault } from '../notes/resource-url.ts';
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
  /** Ask the vault whether a path is real — what lets a picture dragged out of
   *  a note be recognised as the vault file it already is, rather than as a
   *  link to a URL that expires. See `notes/resource-url.ts`. */
  inVault?: InVault;
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
 * Bytes for a dropped file, read the instant it landed.
 *
 * A cross-app carry on iPadOS does not hand over a file — it hands over a
 * *promise* of one, and WebKit materialises it lazily from the sending app's
 * item provider. That provider is only guaranteed alive for the duration of the
 * `drop` dispatch. A read started even one microtask later can find nothing
 * behind the `File` and throws `NotFoundError: The object can not be found
 * here.` — which is precisely what an Apple Notes handwriting selection did,
 * three times, on the 2026-08-08 iPad recording: lasso the strokes, drag them
 * onto 収集トレイ, and the carry died on the doorstep.
 *
 * So the read STARTS here, synchronously, while the door is still open, and the
 * executor awaits the result whenever it gets around to it. This is the whole
 * fix; everything downstream is just refusing to lose the rest of the drop when
 * one payload comes back empty.
 */
const bytes = new WeakMap<File, Promise<ArrayBuffer | null>>();

/**
 * Begin reading every file in a carry. Called synchronously from the `drop` and
 * `paste` handlers — moving this off the event dispatch reintroduces the bug.
 */
function holdBytes(files: File[]): void {
  for (const f of files) dropBytes(f);
}

/**
 * The bytes for `f`: the read begun at drop time, or a fresh one if this file
 * never went through a drop (a file picker hands over a live handle and needs
 * no rescue).
 *
 * Memoised per File, so a payload is pulled off the provider exactly once no
 * matter how many callers ask — asking twice is how you turn a file that WAS
 * readable into one that isn't.
 *
 * Never rejects. `null` means "the platform never produced this" — a fact to
 * report to the user, not an exception to bubble. Resolve-to-null also keeps an
 * unawaited hold from becoming an unhandled rejection.
 */
export function dropBytes(f: File): Promise<ArrayBuffer | null> {
  const held = bytes.get(f);
  if (held) return held;
  const fresh = f.arrayBuffer().then((b) => b, () => null);
  bytes.set(f, fresh);
  return fresh;
}

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
    ...(deps.inVault ? { inVault: deps.inVault } : {}),
  });

  const teardown = (): void => {
    depth = 0;
    veil?.remove();
    veil = null;
    cards = [];
  };

  const paint = (intents: DropIntent[], mode: 'drag' | 'paste' | 'confirm'): void => {
    cards = intents.slice(0, MAX_CARDS);
    if (!cards.length) { teardown(); return; }
    veil?.remove();
    veil = root.createDiv(`jp-drop-veil jp-drop-veil--${mode}`);
    const sheet = veil.createDiv('jp-drop-sheet');
    sheet.createDiv({
      cls: 'jp-drop-title',
      text: mode === 'paste' ? '貼り付けたものを…'
        : mode === 'confirm' ? '落としたものは違いました — どれにする?'
          : 'ここへ落とす',
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
    // Synchronous, inside the drop dispatch, before anything awaits. See
    // `holdBytes` — this line is the difference between a Pencil carry that
    // lands and one that reports a DOM exception.
    holdBytes(files);
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

  /**
   * Turn the painted cards into a tap-to-choose sheet. One wiring for the two
   * moments a human decision sits between the gesture and the run: a paste
   * (which never had an aim) and a drop whose aim the real payload cannot
   * support (which had one and lost it).
   */
  const armChooser = (files: File[]): void => {
    if (!veil) return;
    veil.querySelectorAll('.jp-drop-card').forEach((el, i) => {
      el.addEventListener('click', () => {
        const intent = cards[i];
        teardown();
        void deps.run(intent, files);
      });
    });
    // Anywhere else, or Escape, cancels — a chooser that traps you is worse
    // than no chooser.
    veil.addEventListener('click', (ev) => { if (ev.target === veil) teardown(); });
    const esc = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      teardown();
      window.removeEventListener('keydown', esc, true);
    };
    window.addEventListener('keydown', esc, true);
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
    // The aim was unsupportable by what actually arrived. The old branch ran
    // the concrete leader and explained itself in a toast — which was honest
    // and still wrong, because it EXECUTED something the user never chose
    // (filmed, IMG_1197 213s: 「落としたものは別物でした」 landing as pure
    // confusion). Nothing runs on a broken promise now: the cards repaint
    // with what the payload really supports, and the user picks or cancels.
    // The bytes are already held (`realSample`), so the choice can take its
    // time.
    if (aimed && chosen.action !== aimed) {
      paint(real, 'confirm');
      armChooser(files);
      return;
    }
    flash(root, e.clientX, e.clientY);
    teardown();
    void deps.run(chosen, files);
  };

  const onPaste = (e: ClipboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const cb = e.clipboardData;
    if (!cb) return;
    const files = Array.from(cb.files ?? []);
    // A pasted image is promised the same way a dropped one is, and the paste
    // chooser puts a human decision between the event and the read — by far the
    // longest gap in the app. Hold the bytes now.
    holdBytes(files);
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
    armChooser(files);
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
  /**
   * A carry that holds a FILE has to say so here too.
   *
   * This used to build `{text, kinds, files: []}` and drop `p.url` on the
   * floor — so a picture carried by finger or Pencil arrived as the string of
   * its own path, while the same card dragged with a mouse arrived as a
   * picture. That is the seam §26.0 property 4 forbids, and it fell on the
   * transport that is the ONLY one iOS touch ever uses (see `drag-out.ts`:
   * WebKit never fires `dragstart` from a touch), so the platform where this
   * matters most was the platform where it never worked.
   */
  const carried = (p: DragPayload): DropSample => ({
    text: p.text,
    kinds: p.url
      ? ['text/plain', 'text/html', 'text/uri-list', 'application/x-jpc-drag']
      : ['text/plain', 'text/html', 'application/x-jpc-drag'],
    ...(p.url ? { uriList: p.url } : {}),
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
    // 宛名札 — reads the SAME rack and the SAME aim as drop() above, so the
    // line at the nib and the act on release cannot disagree (§2.2).
    address: (x, y) => cards.length ? atenaFor(cards, cardAtPoint(x, y), ctx().surface) : null,
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
