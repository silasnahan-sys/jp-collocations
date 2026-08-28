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

import type { DropIntent, DropSurface } from '../notes/drop-intent.ts';
import { attachDropRouter } from './drop-router.ts';
import { attachSelectionEcho, type InVault } from './selection-echo.ts';
import type { PeekData } from './hover-peek.ts';
import type { NoteClass } from '../notes/note-types.ts';
import { edgeDock, wideDock, isTouchy } from './posture.ts';
import { setIcon } from 'obsidian';
import { renderSurfaceBar, PLACES, TOOLS, type Surface } from './surface-bar.ts';
import { attachEdgeBack, attachEdgeForward } from './touch-nav.ts';
import { mountClipboardDoor } from './clipboard-door.ts';
import { observePane, paneSizeOf, isNarrowPane } from './pane-size.ts';
import { armBarRetreat } from './bar-retreat.ts';
import { armKeyboardClearance } from './keyboard-aware.ts';

/**
 * Which drop surface a bar surface counts as, for anything routing text into
 * this view. 復習 and ⚡ have no drop identity of their own, and the tray is the
 * holding pen that "accepts literally anything" — so it is the right fallback
 * rather than a reason to refuse the carry.
 */
const AS_DROP: Record<Surface, DropSurface> = {
  lexicon: 'lexicon', dict: 'dict', x: 'x', tray: 'tray', review: 'tray', capture: 'tray',
};

/** The late-bound deps main.ts assigns onto each view. All optional: a view
 *  constructed without them simply has no drop road and no bar. */
export interface ViewChrome {
  /** §29 — hand a routed drop to the one executor. */
  onDrop?: (intent: DropIntent, files: File[]) => void;
  dropCan?: () => { ocr?: boolean; x?: boolean };
  /** §26.3 — where the identity bar goes. */
  openSurface?: (s: Surface) => void;
  surfaceBadge?: (s: Surface) => number | undefined;
  /** §26.3 — the way OUT. Defaults to the nav stack's `back`; a view that has
   *  its own idea of "done" can supply one. See `mountDismiss`. */
  dismiss?: () => void;
  /** …and what that would land on, named, so the edge drag can say where it
   *  goes BEFORE you commit. Null when there is nowhere behind you, which is
   *  what stops the gesture arming at all. See `touch-nav.ts`. */
  backPeek?: () => string | null;
  /** The trail's other half (dict-nav.Trail): a RIGHT-edge drag re-descends
   *  into the stop you backed out of. Null = no future = no gesture. */
  forwardPeek?: () => string | null;
  goForward?: () => void;
  /** The results pane the edge drags RIDE (touch-nav `EdgeBackDeps.page`):
   *  with it, back/forward move the page under the finger instead of only
   *  the label tab — the 2026-08-27 correction. */
  pageEl?: () => HTMLElement | null;
  /** §26.3 — the ANSWER half of a selection, off the sharded shelf. Wired once
   *  in main.ts so every surface answers a highlighted phrase identically.
   *  `sentence` is the line the selection was cut from, so a mid-word cut can
   *  be grown back through its own context. See `SelectionEchoDeps.look`. */
  lookUp?: (text: string, sentence?: string) => Promise<PeekData | null>;
  /** …and the way from the answer into the full entry. */
  openWord?: (headword: string) => void;
  /** §26.3 — a selection is not always words. Lets the echo confirm a
   *  highlighted image's vault path before pairing it with the sentence beside
   *  it, wherever in the vault that image is filed. See `InVault`. */
  inVault?: InVault;
  /** Move 1 (PHYSICS 掴む) — lift the selection into the hold dock: keep
   *  reading, decide later. Wired once in main.ts's peekChrome so every
   *  armed surface grabs identically. `sentence` is the containing line —
   *  the scene rides with the specimen (S1). */
  hold?: (text: string, surface: string, sentence?: string) => void;
  /** Items 12–13 (コマ送り) — the menu carries STATE: catalog patterns whose
   *  terms all occur in this text, so the echo can say 「もう台帳にある」
   *  instead of offering to add what the hand already caught. */
  patternsIn?: ((text: string) => Array<{ id: string; key: string; class: NoteClass; classRatified?: boolean }>) | null;
  /** …and the door to the entry it already is. */
  openPattern?: ((id: string) => void) | null;
  /** The yourei count for an exact span in the frozen 𝕏 corpus, and the
   *  door to its instances (the 𝕏 view). Wired once in main.ts. */
  instances?: (text: string) => number;
  openInstances?: (text: string) => void;
  /** 集句 — add a span to the shared multi-selection question. */
  collect?: (text: string) => void;
  /** …and the strip that shows the accumulating question (one shared set;
   *  each view mounts its own strip). See ui/collect-strip.ts. */
  collectStrip?: import('./collect-strip.ts').CollectStripDeps;
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
    ...(chrome.inVault ? { inVault: chrome.inVault } : {}),
  });
}

/**
 * §26.3 step 4 — the selection verb. Same classifier, same executor, so a
 * highlighted phrase offers exactly the verbs a dropped one would.
 *
 * The echo carries the ANSWER as well as the verbs, so a phrase selected on ANY
 * surface says what it means without going anywhere. That is the whole of the
 * lookup detour: you were never short of verbs, you were short of the meaning,
 * and the only place holding it was a view you had to travel to.
 *
 * ## 辞書 was excluded on a premise that was wrong
 *
 * This block used to say the 辞書 was deliberately left out because it "already
 * answers a selection with its own relation-typed capture (`offerCapture`)",
 * and that two bars for one gesture would be worse than the one that knows
 * more. The reasoning is sound and the premise was false: `offerCapture` is
 * wired to an explicit ⚡ BUTTON that `entry-grammar` renders on each part,
 * cell and citation — `b.onclick`, never a selection. Nothing at all responded
 * to selected text in the 辞書.
 *
 * So the surface whose entire purpose is answering "what does this mean" was
 * the only one that could not answer it about a word inside its own glosses.
 * It is armed now, in `DictionaryView.buildUI`, and the two affordances cover
 * different gestures rather than competing for one.
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
    ...(chrome.lookUp ? { look: chrome.lookUp } : {}),
    ...(chrome.openWord ? { open: chrome.openWord } : {}),
    ...(chrome.inVault ? { inVault: chrome.inVault } : {}),
    ...(chrome.hold ? { hold: chrome.hold } : {}),
    ...(chrome.patternsIn ? { patternsIn: chrome.patternsIn } : {}),
    ...(chrome.openPattern ? { openPattern: chrome.openPattern } : {}),
    ...(chrome.instances ? { instances: chrome.instances } : {}),
    ...(chrome.openInstances ? { openInstances: chrome.openInstances } : {}),
    ...(chrome.collect ? { collect: chrome.collect } : {}),
  });
}

/**
 * §26.3 — the reachable dock. Returns null on the desktop only.
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
 * the same shape and the same fix: one real dock, and everything that belongs
 * under the reaching hand goes in it.
 *
 * WAS `Platform.isPhone`, which is false on an iPad — so the whole law switched
 * itself off on the device that most needed it, and the tablet was left with
 * desktop chrome under a fingertip. `edgeDock` asks the posture instead and
 * gives the tablet a rail on the writing-hand edge rather than a phone's bottom
 * strip, because a tablet's reachable region is the near EDGE. See `posture.ts`.
 *
 * Callers pass `dock ?? header` as the parent of each control, so the desktop
 * path is untouched — off the touch postures this returns null and nothing
 * moves. Order inside the dock is CSS `order`, not call order, so views can
 * keep building their controls in whatever sequence already reads well.
 */
export const thumbDock = edgeDock;
export { edgeDock, wideDock };

/**
 * Render the identity bar, or nothing when the view was given no navigator.
 *
 * Takes the VIEW ROOT and resolves both docks itself, rather than being handed
 * whichever one the caller happened to pick. The placement rule is a property
 * of what a control IS — a destination or a verb — not of the view drawing it,
 * and four views each choosing separately is how five destinations ended up
 * inside a floating overlay on the iPad. See `PLACES` / `TOOLS`.
 *
 * `fallback` is where they go when there is no dock at all (the desktop): the
 * view's own header, exactly as `?? header` did at each call site before.
 */
export function mountSurfaceBar(
  viewRoot: HTMLElement,
  chrome: ViewChrome,
  current: Surface,
  fallback?: HTMLElement,
): void {
  if (!chrome.openSurface) return;
  // Before anything measures itself: make the view root report its OWN width,
  // so every rule below answers the pane the user is looking at rather than the
  // window it happens to live in. Idempotent, so re-renders are free.
  observePane(viewRoot);
  // Every surface with a query box gets the same rule: when the software
  // keyboard takes the bottom of the screen, the pane shortens by the same
  // amount rather than letting the keyboard sit on the results. Idempotent.
  armKeyboardClearance(viewRoot);
  const home = fallback ?? viewRoot;
  const places = wideDock(viewRoot) ?? home;
  const tools = edgeDock(viewRoot) ?? home;
  const deps = {
    current,
    open: (s: Surface) => chrome.openSurface!(s),
    badge: (s: Surface) => chrome.surfaceBadge?.(s),
  };

  /** Foot bars retreat while reading; a rail or an inline header does not. */
  const retreatIfFooted = (el: HTMLElement): void => {
    if (el.hasClass('jp-surfbar--foot') && isNarrowPane(paneSizeOf(viewRoot))) {
      armBarRetreat(viewRoot, el);
    }
  };

  if (places === tools) {
    // A phone has ONE dock (both names return it), and the desktop has none, so
    // both resolve to the header. Either way there is a single container and
    // splitting the bar in two would only stack two rows in it — so this is the
    // pre-split behaviour, unchanged, on both postures that had no problem.
    retreatIfFooted(renderSurfaceBar(places, deps));
  } else {
    retreatIfFooted(renderSurfaceBar(places, { ...deps, only: PLACES, layout: 'foot' }));
    renderSurfaceBar(tools, { ...deps, only: TOOLS, layout: 'rail' });
  }
  // Receiving what you just copied acts on the surface in front of you, so it
  // is a TOOL and sits beside ⚡ — not a sixth destination. This is the only
  // inbound channel Manatan and the reference-doc apps share with the plugin;
  // see clipboard-door.ts for why it cannot be a focus-time watcher.
  if (chrome.onDrop) {
    mountClipboardDoor(tools, {
      surface: () => AS_DROP[current],
      can: () => chrome.dropCan?.() ?? {},
      run: (intent, files) => chrome.onDrop!(intent, files),
      // Same oracle the drop road gets. Without it a copied `![[パネル.png]]`
      // or `app://…` is unresolvable, and the door can only read a picture the
      // vault is already holding as a wish or a link.
      ...(chrome.inVault ? { inVault: chrome.inVault } : {}),
    });
  }
  // 閉じて戻る is a verb about where you are now, so it belongs with the tools.
  mountDismiss(tools, chrome);
  armEdgeBack(viewRoot, chrome);
}

/**
 * The same verb as `mountDismiss`, reachable by hand instead of by button.
 *
 * It lives here, next to the button, deliberately. `suite-nav.ts` and
 * `input-map.ts` were both built and both correct, and neither was reachable on
 * the iPad — `input-map` listens to `wheel`, which a tablet does not have, and
 * the button was on the floating rail, which is the one control he does not
 * use. So the way out existed everywhere and could be taken nowhere:
 * 「sometimes u literally just get STUCK」.
 *
 * One verb with two affordances, mounted from one line, is also the only way
 * this stays true. A gesture wired per-view is a gesture that is missing on the
 * view somebody forgets — and an exit that works on four surfaces out of five
 * is not an exit, it is a thing you have to remember. The whole value of the
 * grammar is that there is nothing to remember.
 */
export function armEdgeBack(viewRoot: HTMLElement, chrome: ViewChrome): void {
  if (!chrome.dismiss || !chrome.backPeek) return;
  attachEdgeBack(viewRoot, {
    peek: () => chrome.backPeek!(),
    go: () => chrome.dismiss!(),
    ...(chrome.pageEl ? { page: () => chrome.pageEl!() } : {}),
  });
  // The other direction, where the view keeps a forward trail: right edge
  // re-enters the future you backed out of. Arms per-touch off forwardPeek,
  // so before any back has happened the gesture simply does not exist.
  if (chrome.goForward && chrome.forwardPeek) {
    attachEdgeForward(viewRoot, {
      peek: () => chrome.forwardPeek!(),
      go: () => chrome.goForward!(),
      ...(chrome.pageEl ? { page: () => chrome.pageEl!() } : {}),
    });
  }
}

/**
 * A way OUT, in the reaching hand.
 *
 * Reported 2026-08-06, one-handed on a phone: 「theres view you cant close」.
 * It is exactly right. Obsidian's own close affordance is the tab drawer —
 * two-handed, top of the screen, and on a phone it is not even on screen.
 * Every plugin surface therefore became a room with the door behind you, and
 * the surfaces now take the whole pane, which makes it worse, not better.
 *
 * `openSurface(current)` is the TOGGLE (see `suite-nav.ts`), so pressing the
 * surface you are already on IS the way back — but nothing on screen said so,
 * and an affordance nobody can see is not an affordance. This is that verb
 * with a name and a fingertip target, and it sits in the dock so it lands
 * under the thumb or beside the writing hand rather than at the top.
 *
 * Desk posture gets nothing: there the tab bar is right there and visible.
 */
function mountDismiss(host: HTMLElement, chrome: ViewChrome): void {
  if (!isTouchy()) return;
  /**
   * A DOCK IS NOT A VIEW ROOT.
   *
   * Three of the four callers pass `dock ?? header`, so on a touch posture
   * `host` already IS the dock — and this line used to call `edgeDock(host)`
   * on it, which built a SECOND dock inside the first. On a phone that nested
   * one `.jp-thumbdock` in another and was merely wasteful. On a tablet the
   * nested element is `position: absolute` and its parent is not a positioning
   * context, so it escaped the rail entirely and rendered as a second floating
   * rail at `top: 50%` on the same edge — a phantom bar, holding one button,
   * overlapping the real one and sitting on top of the content. Part of what
   * was reported as 「it COVERS stuff」.
   *
   * TrayView passes its root, so the `edgeDock` path still has to exist.
   */
  const isDock = host.hasClass('jp-thumbdock') || host.hasClass('jp-slaterail');
  const dock = isDock ? host : (edgeDock(host) ?? host);
  if (dock.querySelector('.jp-dismiss')) return;      // re-render guard
  const b = dock.createEl('button', { cls: 'jp-dismiss', attr: { 'aria-label': '閉じて戻る' } });
  setIcon(b, 'corner-up-left');
  b.createSpan({ text: '戻る' });
  b.onclick = (e) => { e.preventDefault(); chrome.dismiss?.(); };
}
