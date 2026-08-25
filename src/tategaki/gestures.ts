/**
 * Touch plumbing for the vertical reader.
 *
 * Vertical text scrolls along the horizontal axis and starts at the *right*
 * edge, which is where most naive tategaki implementations fall over on a
 * phone: they leave the reader parked at the end of the note, they fight the
 * browser over pinch, and they cannot tell a tap from a swipe. Everything in
 * this file exists to get those three things right.
 */

/** Short vibration, where the platform offers one. */
export function haptic(pattern: number | number[] = 8): void {
  try {
    const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
    nav.vibrate?.(pattern);
  } catch {
    // Vibration is unavailable or blocked by policy — a no-op is fine.
  }
}

/**
 * Scroll maths for a `writing-mode: vertical-rl` scroller.
 *
 * Engines disagree about the sign and origin of `scrollLeft` in vertical and
 * RTL flows, so rather than assume a convention we probe the element for its
 * real range once and work in relative deltas from there.
 */
export class ScrollController {
  private el: HTMLElement;
  private min = 0;
  private max = 0;
  private startAtMax = true;
  private calibrated = false;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  /** Re-probe after a render or a resize. */
  invalidate(): void {
    this.calibrated = false;
  }

  /** Probe the scroll range and work out which end holds the start of the text. */
  calibrate(): void {
    const el = this.el;
    const original = el.scrollLeft;

    // A theme setting `scroll-behavior: smooth` would animate these probes and
    // hand back the wrong numbers, so the measurement runs with it forced off.
    const previousBehavior = el.style.scrollBehavior;
    el.style.scrollBehavior = "auto";

    el.scrollLeft = -1e7;
    this.min = el.scrollLeft;
    el.scrollLeft = 1e7;
    this.max = el.scrollLeft;
    el.scrollLeft = original;

    const sentinel = el.querySelector<HTMLElement>('[data-jp-tg-sentinel="start"]');
    if (sentinel && this.max !== this.min) {
      const target = this.scrollValueForInlineStart(sentinel);
      this.startAtMax = Math.abs(target - this.max) <= Math.abs(target - this.min);
    } else {
      this.startAtMax = true;
    }

    el.style.scrollBehavior = previousBehavior;
    this.calibrated = true;
  }

  private ensure(): void {
    if (!this.calibrated) this.calibrate();
  }

  /** scrollLeft value that would put `el`'s right edge at the reading start. */
  private scrollValueForInlineStart(target: HTMLElement): number {
    const style = getComputedStyle(this.el);
    const padRight = parseFloat(style.paddingRight) || 0;
    const hostRect = this.el.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    return this.el.scrollLeft + (rect.right - (hostRect.right - padRight));
  }

  private clamp(value: number): number {
    return Math.min(Math.max(value, this.min), this.max);
  }

  /** Where the text begins, in scrollLeft terms. */
  startValue(): number {
    this.ensure();
    return this.startAtMax ? this.max : this.min;
  }

  /** Where the text ends. */
  endValue(): number {
    this.ensure();
    return this.startAtMax ? this.min : this.max;
  }

  /** +1 when reading forward means increasing scrollLeft, -1 otherwise. */
  forwardSign(): number {
    this.ensure();
    return this.startAtMax ? -1 : 1;
  }

  /** True when there is nothing to scroll (the note fits on one screen). */
  isSingleScreen(): boolean {
    this.ensure();
    return this.max - this.min <= 1;
  }

  /** Reading progress, 0 at the first character and 1 at the last. */
  getProgress(): number {
    this.ensure();
    const span = this.endValue() - this.startValue();
    if (Math.abs(span) < 1) return 0;
    const progress = (this.el.scrollLeft - this.startValue()) / span;
    return Math.min(1, Math.max(0, progress));
  }

  /** Jump to a normalised reading position. */
  setProgress(progress: number, smooth = false): void {
    this.ensure();
    const span = this.endValue() - this.startValue();
    const target = this.clamp(this.startValue() + span * Math.min(1, Math.max(0, progress)));
    this.scrollTo(target, smooth);
  }

  /** Park the reader on the first character. */
  scrollToStart(): void {
    this.ensure();
    this.scrollTo(this.startValue(), false);
  }

  /** Move one screen forward (`+1`) or back (`-1`). Returns false at the edge. */
  turnPage(direction: 1 | -1, smooth = true): boolean {
    this.ensure();
    const step = this.pageStep() * this.forwardSign() * direction;
    const before = this.el.scrollLeft;
    const target = this.clamp(before + step);
    if (Math.abs(target - before) < 1) return false;
    this.scrollTo(target, smooth);
    return true;
  }

  /** Align the current position to the nearest whole screen. */
  snapToPage(smooth = true): void {
    this.ensure();
    const step = this.pageStep();
    if (step <= 0) return;
    const offset = this.el.scrollLeft - this.startValue();
    const snapped = Math.round(offset / step) * step;
    this.scrollTo(this.clamp(this.startValue() + snapped), smooth);
  }

  /** One screen, minus a sliver so the last column is not cut mid-glyph. */
  private pageStep(): number {
    return Math.max(40, this.el.clientWidth - 8);
  }

  private scrollTo(left: number, smooth: boolean): void {
    if (smooth && typeof this.el.scrollTo === "function") {
      this.el.scrollTo({ left, behavior: "smooth" });
    } else {
      this.el.scrollLeft = left;
    }
  }
}

// ── Pinch to resize the type ────────────────────────────────────────────────

export interface PinchOptions {
  /** Called with the scale factor relative to the size when the pinch began. */
  onScale: (factor: number) => void;
  /** Called when the gesture ends, so callers can persist the new size. */
  onEnd?: () => void;
  /** Ignore pinches smaller than this ratio change. */
  threshold?: number;
}

/**
 * Two-finger pinch that resizes the *text* rather than zooming the webview.
 * Returns a disposer.
 */
export function attachPinchZoom(el: HTMLElement, options: PinchOptions): () => void {
  const threshold = options.threshold ?? 0.02;
  let startDistance = 0;
  let pinching = false;
  let lastFactor = 1;

  const distance = (touches: TouchList): number => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  };

  const onTouchStart = (ev: TouchEvent): void => {
    if (ev.touches.length !== 2) return;
    startDistance = distance(ev.touches);
    pinching = startDistance > 0;
    lastFactor = 1;
  };

  const onTouchMove = (ev: TouchEvent): void => {
    if (!pinching || ev.touches.length !== 2) return;
    ev.preventDefault();
    const factor = distance(ev.touches) / startDistance;
    if (!Number.isFinite(factor) || Math.abs(factor - lastFactor) < threshold) return;
    lastFactor = factor;
    options.onScale(factor);
  };

  const onTouchEnd = (ev: TouchEvent): void => {
    if (!pinching || ev.touches.length >= 2) return;
    pinching = false;
    options.onEnd?.();
  };

  el.addEventListener("touchstart", onTouchStart, { passive: true });
  el.addEventListener("touchmove", onTouchMove, { passive: false });
  el.addEventListener("touchend", onTouchEnd, { passive: true });
  el.addEventListener("touchcancel", onTouchEnd, { passive: true });

  return () => {
    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("touchmove", onTouchMove);
    el.removeEventListener("touchend", onTouchEnd);
    el.removeEventListener("touchcancel", onTouchEnd);
  };
}

// ── Tap / long-press ────────────────────────────────────────────────────────

export interface TapOptions {
  onTap: (x: number, y: number, target: EventTarget | null) => void;
  onLongPress?: (x: number, y: number, target: EventTarget | null) => void;
  /** Movement in px above which the gesture counts as a scroll, not a tap. */
  moveTolerance?: number;
  /** Hold time in ms that promotes a press to a long-press. */
  longPressDelay?: number;
}

/**
 * Tap and long-press recognition that survives momentum scrolling — a phone
 * reader taps to look a word up and long-presses for the context menu, and
 * neither must fire while the reader is flicking through pages.
 */
export function attachTapGestures(el: HTMLElement, options: TapOptions): () => void {
  const tolerance = options.moveTolerance ?? 10;
  const longPressDelay = options.longPressDelay ?? 500;

  let startX = 0;
  let startY = 0;
  let startScroll = 0;
  let startTime = 0;
  let moved = false;
  let target: EventTarget | null = null;
  let longPressTimer: number | null = null;
  let longPressFired = false;
  let lastTouchAt = 0;

  const clearTimer = (): void => {
    if (longPressTimer !== null) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  const onTouchStart = (ev: TouchEvent): void => {
    if (ev.touches.length !== 1) { clearTimer(); moved = true; return; }
    const touch = ev.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    startScroll = el.scrollLeft;
    startTime = Date.now();
    moved = false;
    longPressFired = false;
    target = ev.target;

    if (options.onLongPress) {
      clearTimer();
      longPressTimer = window.setTimeout(() => {
        if (moved) return;
        longPressFired = true;
        options.onLongPress?.(startX, startY, target);
      }, longPressDelay);
    }
  };

  const onTouchMove = (ev: TouchEvent): void => {
    if (moved || ev.touches.length !== 1) return;
    const touch = ev.touches[0];
    if (Math.abs(touch.clientX - startX) > tolerance || Math.abs(touch.clientY - startY) > tolerance) {
      moved = true;
      clearTimer();
    }
  };

  const onTouchEnd = (ev: TouchEvent): void => {
    clearTimer();
    lastTouchAt = Date.now();
    if (longPressFired || moved) return;
    // Momentum from a previous flick can move the scroller without the finger
    // moving; that is a scroll being stopped, not a tap.
    if (Math.abs(el.scrollLeft - startScroll) > 2) return;
    if (Date.now() - startTime > 700) return;
    const touch = ev.changedTouches[0];
    if (!touch) return;
    options.onTap(touch.clientX, touch.clientY, target);
  };

  const onTouchCancel = (): void => {
    clearTimer();
    lastTouchAt = Date.now();
    moved = true;
  };

  // Desktop equivalents so the same view works with a mouse. A touch also emits
  // a synthetic click a moment later; without this guard every tap on a phone
  // would be handled twice.
  const onClick = (ev: MouseEvent): void => {
    if (ev.detail === 0) return;
    if (Date.now() - lastTouchAt < 900) return;
    options.onTap(ev.clientX, ev.clientY, ev.target);
  };

  const onContextMenu = (ev: MouseEvent): void => {
    if (!options.onLongPress) return;
    if (Date.now() - lastTouchAt < 900) return;
    ev.preventDefault();
    options.onLongPress(ev.clientX, ev.clientY, ev.target);
  };

  el.addEventListener("touchstart", onTouchStart, { passive: true });
  el.addEventListener("touchmove", onTouchMove, { passive: true });
  el.addEventListener("touchend", onTouchEnd, { passive: true });
  el.addEventListener("touchcancel", onTouchCancel, { passive: true });
  el.addEventListener("click", onClick);
  el.addEventListener("contextmenu", onContextMenu);

  return () => {
    clearTimer();
    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("touchmove", onTouchMove);
    el.removeEventListener("touchend", onTouchEnd);
    el.removeEventListener("touchcancel", onTouchCancel);
    el.removeEventListener("click", onClick);
    el.removeEventListener("contextmenu", onContextMenu);
  };
}

/**
 * Map wheel and trackpad gestures onto the reading axis.
 *
 * Browsers do map a vertical wheel onto a horizontal-only scroller, but they
 * add the delta to `scrollLeft` — which in `vertical-rl` moves you *backwards*
 * through the text. This claims the event and applies the reading direction,
 * so a trackpad on an iPad or a mouse on the desktop scrolls forward.
 */
export function attachWheelScrolling(
  el: HTMLElement,
  controller: ScrollController,
  isVertical: () => boolean
): () => void {
  const onWheel = (ev: WheelEvent): void => {
    if (!isVertical()) return;
    if (ev.ctrlKey) return; // pinch-zoom on a trackpad arrives as ctrl+wheel
    if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) return;

    // deltaMode 1 is lines, 2 is pages; normalise both to pixels.
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? el.clientWidth : 1;
    el.scrollLeft += ev.deltaY * unit * controller.forwardSign();
    ev.preventDefault();
  };

  el.addEventListener("wheel", onWheel, { passive: false });
  return () => el.removeEventListener("wheel", onWheel);
}

export interface KeyboardOptions {
  /** Turn one screen; `+1` reads on, `-1` goes back. */
  onPage: (direction: 1 | -1) => void;
  onStart: () => void;
  onEnd: () => void;
  onZoom: (direction: 1 | -1) => void;
}

/**
 * Keyboard reading controls, for an iPad with a Magic Keyboard and for desktop.
 * Left/down reads on because vertical text advances leftwards.
 */
export function attachKeyboardNavigation(el: HTMLElement, options: KeyboardOptions): () => void {
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

    switch (ev.key) {
      case "ArrowLeft":
      case "ArrowDown":
      case "PageDown":
        options.onPage(1);
        break;
      case "ArrowRight":
      case "ArrowUp":
      case "PageUp":
        options.onPage(-1);
        break;
      case " ":
        options.onPage(ev.shiftKey ? -1 : 1);
        break;
      case "Home":
        options.onStart();
        break;
      case "End":
        options.onEnd();
        break;
      case "+":
      case "=":
        options.onZoom(1);
        break;
      case "-":
      case "_":
        options.onZoom(-1);
        break;
      default:
        return;
    }
    ev.preventDefault();
  };

  el.addEventListener("keydown", onKeyDown);
  return () => el.removeEventListener("keydown", onKeyDown);
}

/** Fire `callback` once scrolling has been quiet for `delay` ms. */
export function onScrollSettled(el: HTMLElement, delay: number, callback: () => void): () => void {
  let timer: number | null = null;
  const onScroll = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(callback, delay);
  };
  el.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    if (timer !== null) window.clearTimeout(timer);
    el.removeEventListener("scroll", onScroll);
  };
}

// ── Hit testing ─────────────────────────────────────────────────────────────

export interface CaretHit {
  node: Text;
  offset: number;
}

/** Firefox exposes `caretPositionFromPoint`; WebKit/Blink `caretRangeFromPoint`. */
type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
};

/** Text node and offset under a screen point — works in vertical writing mode. */
export function caretFromPoint(doc: Document, x: number, y: number): CaretHit | null {
  const caretDoc = doc as CaretDocument;

  if (typeof caretDoc.caretRangeFromPoint === "function") {
    const range = caretDoc.caretRangeFromPoint(x, y);
    if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
      return { node: range.startContainer as Text, offset: range.startOffset };
    }
  }

  if (typeof caretDoc.caretPositionFromPoint === "function") {
    const position = caretDoc.caretPositionFromPoint(x, y);
    if (position && position.offsetNode.nodeType === Node.TEXT_NODE) {
      return { node: position.offsetNode as Text, offset: position.offset };
    }
  }

  return null;
}

const BOUNDARY_RE = /[\s。、，．・！？!?「」『』（）()\[\]【】〈〉《》…—―ー～〜:;：；"'`|｜]/;

/**
 * Grow a lookup string outward from the tapped character.
 *
 * `text` is what the reader tapped into, `offset` where. The result starts at
 * the beginning of the tapped run so a tap in the middle of 風が吹く still
 * offers the whole phrase, and `offsetInRun` says where the finger landed.
 */
export function runAroundOffset(
  text: string,
  offset: number,
  options: { back?: number; forward?: number } = {}
): { run: string; start: number; offsetInRun: number } {
  const maxBack = options.back ?? 8;
  const maxForward = options.forward ?? 16;
  const clamped = Math.min(Math.max(offset, 0), Math.max(0, text.length - 1));

  let start = clamped;
  while (start > 0 && clamped - start < maxBack && !BOUNDARY_RE.test(text[start - 1])) {
    start--;
  }

  let end = clamped;
  while (end < text.length && end - start < maxBack + maxForward && !BOUNDARY_RE.test(text[end])) {
    end++;
  }

  return { run: text.slice(start, end), start, offsetInRun: clamped - start };
}
