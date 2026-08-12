/**
 * hover-peek.ts — the §26.3 dictionary preview on mouse / Pencil hover.
 *
 * ONE presentation for the peek, shared by the catalog (LexiconPanel) and
 * the dictionary (DictionaryView) — that sameness IS the seamless
 * integration (§26.0 property 4: one grammar everywhere). Each surface
 * supplies only a resolver from a screen point to peek data; timing,
 * rendering, positioning, and teardown live here.
 *
 * Rules baked in: NEVER on touch (tap = 飛び込み stays the touch verb);
 * dwell-gated (no flicker while reading past words); the card is
 * pointer-transparent and self-clamping to the viewport; degrades to
 * nothing where hover doesn't exist.
 */

import { pointerDragActive } from './pointer-drag.ts';

export interface PeekData {
  headword: string;
  reading?: string;
  deinflection?: string[];
  def?: string;
}

const DWELL_MS = 320;

export class HoverPeek {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private el: HTMLElement | null = null;
  private key = '';

  /** @param resolveAt screen point → peek data, or null when no word there. */
  constructor(private resolveAt: (x: number, y: number) => PeekData | null) {}

  /** Wire a container. `hitSelector` scopes peeks to hoverable text spans. */
  attach(container: HTMLElement, hitSelector: string): void {
    const overOrMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      // A Pencil carrying something across the surface is aiming, not reading.
      // Popping definitions under the pill would obscure the targets.
      if (pointerDragActive()) { this.cancel(); return; }
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(hitSelector)) this.schedule(e.clientX, e.clientY);
      else this.cancel();
    };
    container.addEventListener('pointerover', overOrMove);
    container.addEventListener('pointermove', overOrMove);
    container.addEventListener('pointerdown', () => this.cancel());
    container.addEventListener('pointerleave', () => this.cancel());
  }

  private schedule(x: number, y: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const data = this.resolveAt(x, y);
      if (!data) { this.remove(); return; }
      if (data.headword === this.key && this.el) return;   // same word: keep
      this.remove();
      this.key = data.headword;
      this.el = this.build(data, x, y);
    }, DWELL_MS);
  }

  private build(data: PeekData, x: number, y: number): HTMLElement {
    const el = document.body.createDiv('jp-lex-peek');
    const top = el.createDiv('jp-lex-peek-top');
    top.createSpan({ text: data.headword, cls: 'jp-lex-peek-hw' });
    if (data.reading && data.reading !== data.headword) {
      top.createSpan({ text: data.reading, cls: 'jp-lex-peek-reading' });
    }
    if (data.deinflection?.length) {
      top.createSpan({ text: `〈${data.deinflection.join('+')}〉`, cls: 'jp-lex-deinflect' });
    }
    if (data.def) el.createDiv({ text: data.def.slice(0, 140), cls: 'jp-lex-peek-def' });
    const pad = 12;
    el.style.left = `${Math.min(x + pad, window.innerWidth - 300)}px`;
    el.style.top = `${Math.max(pad, y - el.offsetHeight - pad - 8)}px`;
    return el;
  }

  cancel(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.remove();
  }

  private remove(): void {
    this.el?.remove();
    this.el = null;
    this.key = '';
  }
}

/**
 * Fold definitions to a single preview string (shared helper).
 *
 * Takes both shapes the shelf speaks: a Yomitan definition (a string, or an
 * object with `text`) and a `DictSense` off the sharded books (`gloss`). One
 * preview function, because the card showing it does not care which of the
 * two answered and neither should the caller.
 */
export function definitionsPreview(defs: unknown[]): string {
  return defs
    .map((d) => {
      if (typeof d === 'string') return d;
      if (!d || typeof d !== 'object') return '';
      const o = d as { text?: unknown; gloss?: unknown };
      return String(o.text ?? o.gloss ?? '');
    })
    .filter(Boolean)
    .join(' / ');
}
