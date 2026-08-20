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

import { dropIntents, type DropIntent, type DropSurface } from '../notes/drop-intent.ts';
import { vaultPathOf, type InVault } from '../notes/resource-url.ts';
import { hand, isSlate, isThumb } from './posture.ts';
import type { PeekData } from './hover-peek.ts';

export interface SelectionEchoDeps {
  surface: DropSurface | (() => DropSurface);
  entryKey?: () => string | undefined;
  can?: () => { ocr?: boolean; x?: boolean };
  run: (intent: DropIntent) => void;

  /**
   * The ANSWER half. Selected text → what it means, off the sharded shelf.
   *
   * Without this the echo has always been half a tool: it tells you what you
   * could DO with a phrase and never what the phrase IS, so the moment you
   * did not already know, the only way to find out was to leave — open the
   * 辞書, lose your place, and on an iPad with a video running, lose the
   * thread entirely. `HoverPeek` had the other half and could not act, and
   * would not speak to a finger at all. Two halves, no whole.
   *
   * Here they are one thing. Same card, same gesture, one shape (`PeekData`)
   * for one idea. Optional because a surface with nothing to look up should
   * render no head rather than an empty one (§28 S6).
   */
  look?: (text: string) => Promise<PeekData | null>;

  /** The way out: open the full entry when the head is not enough. */
  open?: (headword: string) => void;

  /**
   * Move 1 (PHYSICS 掴む) — lift this phrase into the hold dock instead of
   * acting on it now. The echo is where the grab lives because the echo is
   * where the hand already is: the selection, answered, with one more verb —
   * "not yet." The sentence (the containing line's text) rides along so the
   * scene arrives wherever the chip lands (S1).
   */
  hold?: (text: string, surface: string, sentence?: string) => void;

  /**
   * Turn what a rendered image's DOM knows into a vault path the tray can
   * point at. See `InVault`.
   *
   * Optional, and the difference it makes is the whole of "anywhere in the
   * vault": a resource URL carries an ABSOLUTE path, and no string rule can
   * say where the vault root falls inside it. Without this the echo can only
   * guess (it looks for `attachments/`, which is where this plugin puts its
   * own), so a panel filed anywhere else paired with a path that resolved to
   * nothing. With it the path is confirmed before a card is ever built.
   */
  inVault?: InVault;
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
  /** Bumped on every show and every hide, so a slow lookup that lands after
   *  the selection moved on writes into nothing instead of into the wrong
   *  phrase's card. */
  let seq = 0;

  const hide = (): void => { seq++; bar?.remove(); bar = null; };

  const ctx = () => ({
    surface: typeof deps.surface === 'function' ? deps.surface() : deps.surface,
    entryKey: deps.entryKey?.(),
    can: deps.can?.() ?? {},
  });

  /**
   * Put the bar where the words are. Takes the rect rather than reading the
   * selection, because the head arrives asynchronously and by then the range
   * may be collapsed — but the bar still belongs beside the phrase it is
   * about. Re-runnable: the head changes the bar's height, and a card placed
   * before it filled would sit at the wrong altitude.
   */
  const place = (rect: DOMRect): void => {
    if (!bar || isThumb()) return;                   // footed; no math needed
    const box = root.getBoundingClientRect();
    const barW = bar.offsetWidth || 240;
    /**
     * Centred under a mouse, shifted out from under the HAND with a stylus.
     *
     * A right-handed grip puts the wrist and forearm down and to the right of
     * the nib, so a bar centred on the selection is half-covered by the hand
     * that just made it — and the covered half is the side the hand rests on.
     * Biasing it toward the free side keeps every verb visible without moving
     * the bar far enough to stop reading as "about this phrase".
     */
    const bias = isSlate() ? (hand() === 'right' ? -barW / 3 : barW / 3) : 0;
    const left = Math.min(
      Math.max(8, rect.left - box.left + rect.width / 2 - barW / 2 + bias),
      Math.max(8, box.width - barW - 8),
    );
    // Above the highlight when there is room, below it when there is not —
    // the bar must never sit on top of the words it is about. On a slate the
    // preference for ABOVE is stronger than a preference: below the selection
    // is exactly where the writing hand is.
    const above = rect.top - box.top - bar.offsetHeight - 8;
    bar.style.left = `${left}px`;
    bar.style.top = above > 4 ? `${above}px` : `${rect.bottom - box.top + 8}px`;
  };

  /** The answer, once the shelf has one. */
  const fillHead = (head: HTMLElement, d: PeekData | null, whenNone = '辞書に該当なし'): void => {
    head.empty();
    head.removeClass('jp-echo-head--waiting');
    if (!d) {
      // Say the shelf has nothing rather than showing an empty frame — an
      // absent answer and a blank one are different facts (§28 S6). And a
      // shelf that FAILED says that instead: "not found" is a claim about the
      // language, and we are in no position to make it when the read threw.
      head.addClass('jp-echo-head--none');
      head.createSpan({ text: whenNone, cls: 'jp-echo-head-hw' });
      return;
    }
    const top = head.createDiv('jp-echo-head-top');
    top.createSpan({ text: d.headword, cls: 'jp-echo-head-hw' });
    if (d.reading && d.reading !== d.headword) {
      top.createSpan({ text: d.reading, cls: 'jp-echo-head-reading' });
    }
    if (d.deinflection?.length) {
      top.createSpan({ text: `〈${d.deinflection.join('+')}〉`, cls: 'jp-lex-deinflect' });
    }
    if (d.def) head.createDiv({ text: d.def.slice(0, 160), cls: 'jp-echo-head-def' });
    // The way out. A peek that cannot become the full entry is a dead end, and
    // a dead end is the thing that sends you navigating in the first place.
    if (!deps.open) return;
    const hw = d.headword;
    head.addClass('jp-echo-head--open');
    head.title = `${hw} を辞書で開く`;
    head.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hide();
      window.getSelection()?.removeAllRanges();
      deps.open!(hw);
    });
  };

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

    // A selection is not always words. Dragging the Pencil across a manga
    // panel and the sentence under it selects BOTH, and until now the echo read
    // `sel.toString()` and silently lost the picture — the same half-a-carry
    // bug the drop road had, arriving from the other side. Images already in
    // the vault need no saving, so the paths ride along and `image-pair`
    // pairs them with the text.
    const shots = imagesIn(sel.rangeCount ? sel.getRangeAt(0) : null as unknown as Range, deps.inVault);
    const intents = dropIntents(
      shots.length ? { text, files: shots.map((p) => ({ name: p, type: 'image/png' })) } : { text },
      ctx(),
    ).slice(0, MAX_VERBS);
    for (const i of intents) if (shots.length) i.payload.imagePaths = shots;
    // A phrase with no verbs still has a MEANING, and the meaning is the half
    // that used to be missing. Only a card with neither is nothing to show.
    if (!intents.length && !deps.look) { hide(); return; }

    hide();
    const mine = ++seq;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    // Footed on a phone only. A tablet keeps the bar AT the selection: the
    // Pencil is already there, and a trip to the bottom of a 1366px screen to
    // act on a word the nib is touching is the opposite of the point.
    bar = root.createDiv(`jp-echo${isThumb() ? ' jp-echo--foot' : ''}`);

    // Answer above verbs: read what it is, then decide what to do with it.
    // That order is the whole point — the other way round is a menu of things
    // to do to a phrase you do not yet understand.
    if (deps.look) {
      const head = bar.createDiv('jp-echo-head jp-echo-head--waiting');
      head.createSpan({
        cls: 'jp-echo-head-hw',
        text: [...text].length > 18 ? `${[...text].slice(0, 18).join('')}…` : text,
      });
      void deps.look(text).then(
        (d) => { if (mine === seq && bar) { fillHead(head, d); place(rect); } },
        // A shelf that fails to answer says so. It must never look like "no
        // such word", which is a different and much stronger claim.
        () => { if (mine === seq && bar) { fillHead(head, null, '辞書を読めませんでした'); place(rect); } },
      );
    }

    // The verbs get their own row so the answer can have one above them; with
    // no head the bar looks exactly as it always did.
    const verbs = bar.createDiv('jp-echo-verbs');
    for (const intent of intents) {
      const b = verbs.createEl('button', { cls: 'jp-echo-btn', attr: { title: intent.detail } });
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

    // Move 1 (掴む) — the "not yet" verb, after the act-now verbs: lift the
    // phrase into the hold dock and keep reading. Rendered apart from the
    // intent list on purpose: intents compete for MAX_VERBS slots by surface
    // relevance, and the grab must exist on every surface unconditionally.
    if (deps.hold) {
      const sentence = sentenceAround(sel.rangeCount ? sel.getRangeAt(0) : null, root);
      const b = verbs.createEl('button', { cls: 'jp-echo-btn jp-echo-btn--hold', attr: { title: '持っておく — 画面端に置いて読み続ける' } });
      b.createSpan({ cls: 'jp-echo-icon', text: '✊' });
      b.createSpan({ cls: 'jp-echo-label', text: '持つ' });
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hide();
        window.getSelection()?.removeAllRanges();
        deps.hold!(text, ctx().surface, sentence);
      });
    }

    place(rect);
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

/**
 * Vault paths of every image inside `range`, in document order.
 *
 * Obsidian renders a vault image as an `<img>` whose `src` is a resource URL
 * with the file's ABSOLUTE path inside it. Recovering the vault-RELATIVE path
 * from that means knowing where the vault root sits inside the absolute one,
 * which no amount of string work can know — so `inVault` asks the vault, and
 * `vaultPathOf` walks candidate tails past it until one lands.
 *
 * Exported for `golden/selection-images.mjs`.
 */
/**
 * The sentence the selection was taken from — the nearest ancestor line/block,
 * capped so a grab from a long card carries a scene, not a novel. Best-effort:
 * a null range or a selection spanning containers degrades to undefined, and
 * the chip simply carries no sentence (S6: absent, not fabricated).
 */
function sentenceAround(range: Range | null, root: HTMLElement): string | undefined {
  if (!range) return undefined;
  let node: Node | null = range.startContainer;
  let el: HTMLElement | null = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
  for (let hops = 0; el && el !== root && hops < 5; hops++) {
    const text = el.textContent?.trim().replace(/\s+/g, ' ') ?? '';
    // a line-sized container: meaningfully bigger than the selection, smaller
    // than the whole card
    if (text.length >= 8 && text.length <= 300) return text;
    if (text.length > 300) return undefined;
    el = el.parentElement;
  }
  return undefined;
}

export function imagesIn(range: Range, inVault?: InVault): string[] {
  const out: string[] = [];
  // Every step here is optional on some engine or in the golden's hand-written
  // DOM, and a selection whose images cannot be determined must degrade to
  // "no images" — never to a thrown echo. Losing the picture is a shame;
  // losing the whole selection bar is the bug this file exists to prevent.
  const host = range?.commonAncestorContainer as Node | undefined;
  if (!host) return out;
  const scope = (host.nodeType === 1 ? host : host.parentElement) as HTMLElement | null;
  if (typeof scope?.querySelectorAll !== 'function') return out;
  for (const img of Array.from(scope.querySelectorAll('img'))) {
    if (typeof range.intersectsNode === 'function' && !range.intersectsNode(img)) continue;
    const p = vaultPathOf(img.getAttribute('src') ?? '', inVault)
      // Second road, for anything whose URL the first road could not place: the
      // note itself said what this picture is. `![[パネル.png]]` renders inside
      // an `.internal-embed` whose `src` is the LINK TEXT — shortest-form, so
      // only the vault can expand it, which is exactly what `inVault` does.
      ?? (inVault ? inVault(embedLink(img) ?? '') : null);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** The link text of the embed a rendered image sits in, if it sits in one. */
function embedLink(img: Element): string | null {
  let n: Element | null = img.parentElement;
  // Reading view wraps in one div, Live Preview in a span inside a widget —
  // three hops covers both and stops well short of the note body.
  for (let up = 0; n && up < 3; up++, n = n.parentElement) {
    const cls = typeof n.className === 'string' ? n.className : '';
    if (!cls.includes('internal-embed')) continue;
    const s = n.getAttribute?.('src');
    if (s) return s;
  }
  return null;
}

/**
 * The URL knowledge lives in `notes/resource-url.ts` — the drag road needs the
 * identical rule, and one wrong copy of "is this URL local or remote" is how
 * this went wrong on Android in the first place. Re-exported so the echo's own
 * golden can keep importing from here.
 */
export { pathTails, vaultPathOf, type InVault } from '../notes/resource-url.ts';
