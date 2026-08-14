/**
 * TokenCanvas — the tactile classification surface (§22.4), v1.
 *
 * Gesture vocabulary (aligned with the system ink habits Scribble taught —
 * the "Pages gleanings": marks anchor to TOKENS not positions; scratch and
 * circle reuse existing muscle memory; rough input SNAPS to token bounds):
 *
 *   tap            toggle a part (🟠 bones — non-adjacent multi-select)
 *   drag           span (edges snap to tokens)
 *   long-press+drag strike → struck tokens become ○○ slots (💠)
 *   double-tap     circle the pivot (🟢); a drag from the pivot sets halo
 *
 * 🔴 arrow gesture is v2. Suggestions are pentimento: faint spans offered
 * below; one tap applies. Every interaction re-derives class + payload and
 * reports via onChange — the host (CaptureModal / X picker) mirrors it into
 * its fields, so the canvas augments rather than replaces.
 */

import type { CanvasToken, CanvasMarks, DerivedCapture, SpanSuggestion } from '../notes/token-canvas.ts';
import { tokenizeForCanvas, deriveFromMarks, emptyMarks, suggestionToTokenRange } from '../notes/token-canvas.ts';

export interface TokenCanvasOpts {
  text: string;
  probe?: (s: string) => boolean;
  suggestions?: SpanSuggestion[];
  onChange: (derived: DerivedCapture, marks: CanvasMarks) => void;
}

const LONG_PRESS_MS = 350;
const DOUBLE_TAP_MS = 300;

export class TokenCanvas {
  private tokens: CanvasToken[] = [];
  private marks: CanvasMarks = emptyMarks();
  private el: HTMLElement | null = null;
  private pills: HTMLElement[] = [];
  private lastTap: { idx: number; at: number } | null = null;
  /** §22.4 pentimento: the best suggestion pre-drawn as a FAINT span on the
   *  tokens themselves — tapping inside it (before any mark) accepts it;
   *  drawing your own mark overrides it. */
  private faint: [number, number] | null = null;

  constructor(private opts: TokenCanvasOpts) {
    this.tokens = tokenizeForCanvas(opts.text, opts.probe);
    const best = (opts.suggestions ?? [])[0];
    this.faint = best ? suggestionToTokenRange(this.tokens, best) : null;
  }

  /** The layered-bundle path (capture-bundle.ts) reads the canvas state whole. */
  getTokens(): CanvasToken[] { return this.tokens; }
  getMarks(): CanvasMarks { return this.marks; }

  private hasMarks(): boolean {
    return !!(this.marks.span || this.marks.parts.length || this.marks.struck.length || this.marks.circled != null);
  }

  render(parent: HTMLElement): void {
    this.el = parent.createDiv('jp-canvas');
    const row = this.el.createDiv('jp-canvas-row');
    this.pills = [];

    let downIdx = -1;
    let downAt = 0;
    let dragTo = -1;
    let striking = false;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;

    const idxFromEvent = (e: PointerEvent): number => {
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('.jp-canvas-pill');
      return t ? this.pills.indexOf(t as HTMLElement) : -1;
    };

    this.tokens.forEach((tok, i) => {
      const pill = row.createSpan({
        text: tok.text,
        cls: `jp-canvas-pill${tok.kind === 'punct' ? ' jp-canvas-pill--punct' : ''}`,
      });
      this.pills.push(pill);
      if (tok.kind === 'punct') return;

      pill.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        // capture on the ROW: the drag keeps reporting even when the Pencil
        // wanders off the pill row mid-stroke (the iPad reality)
        try { row.setPointerCapture(e.pointerId); } catch { /* older webview */ }
        downIdx = i;
        downAt = Date.now();
        dragTo = i;
        striking = false;
        longPressTimer = setTimeout(() => { striking = true; this.paintPreview(downIdx, dragTo, true); }, LONG_PRESS_MS);
      });
      pill.addEventListener('pointerenter', () => { /* hover no-op; move handled globally */ });
    });

    // zigzag-scratch (§22.4 v2, Scribble muscle memory): oscillating vertical
    // motion during a drag = a scratch = strike, no long-press needed
    let lastY = 0;
    let lastDir = 0;
    let dirChanges = 0;
    row.addEventListener('pointermove', (e) => {
      if (downIdx < 0) return;
      if (lastY !== 0) {
        const dy = e.clientY - lastY;
        if (Math.abs(dy) > 5) {
          const dir = Math.sign(dy);
          if (lastDir !== 0 && dir !== lastDir) dirChanges++;
          lastDir = dir;
          if (dirChanges >= 2 && !striking) {
            striking = true;
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
          }
        }
      }
      lastY = e.clientY;
      const to = idxFromEvent(e);
      if (to >= 0 && to !== dragTo) {
        dragTo = to;
        this.paintPreview(downIdx, dragTo, striking);
      }
    });
    row.addEventListener('pointerdown', () => { lastY = 0; lastDir = 0; dirChanges = 0; });

    const finish = (e: PointerEvent): void => {
      if (downIdx < 0) return;
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      const upIdx = idxFromEvent(e);
      const from = Math.min(downIdx, dragTo < 0 ? downIdx : dragTo);
      const to = Math.max(downIdx, dragTo < 0 ? downIdx : dragTo);
      const moved = to > from;
      const now = Date.now();

      if (!moved && !striking) {
        // pentimento accept: tapping inside the faint pre-drawn span BEFORE
        // any mark exists takes the suggestion whole (one tap = classified);
        // any drawn mark overrides it (recorded as suggested-vs-chosen by the
        // host through the marks themselves)
        if (this.faint && !this.hasMarks() && downIdx >= this.faint[0] && downIdx <= this.faint[1]) {
          this.marks.span = [this.faint[0], this.faint[1]];
          this.faint = null;
          this.lastTap = null;
          downIdx = -1;
          this.repaint();
          this.opts.onChange(deriveFromMarks(this.tokens, this.marks), this.marks);
          return;
        }
        // tap — double-tap = circle, single = toggle part (or set halo if a
        // drag begins on the circled pill; halo via drag handled by `moved`)
        if (this.lastTap && this.lastTap.idx === downIdx && now - this.lastTap.at < DOUBLE_TAP_MS) {
          this.marks.circled = this.marks.circled === downIdx ? undefined : downIdx;
          this.marks.halo = this.marks.circled != null ? [downIdx, downIdx] : undefined;
          this.lastTap = null;
        } else {
          this.lastTap = { idx: downIdx, at: now };
          const p = this.marks.parts.indexOf(downIdx);
          if (p >= 0) this.marks.parts.splice(p, 1);
          else this.marks.parts.push(downIdx);
        }
      } else if (moved && striking) {
        for (let i = from; i <= to; i++) {
          if (this.tokens[i].kind === 'punct') continue;
          if (!this.marks.struck.includes(i)) this.marks.struck.push(i);
        }
      } else if (moved && this.marks.circled != null && (downIdx === this.marks.circled || dragTo === this.marks.circled)) {
        this.marks.halo = [from, to];       // drag from the pivot = halo reach
      } else if (moved) {
        this.marks.span = [from, to];
      }

      downIdx = -1;
      striking = false;
      this.repaint();
      this.opts.onChange(deriveFromMarks(this.tokens, this.marks), this.marks);
    };
    row.addEventListener('pointerup', finish);
    row.addEventListener('pointercancel', () => { downIdx = -1; if (longPressTimer) clearTimeout(longPressTimer); this.repaint(); });

    // pentimento: faint suggestions, one tap applies
    if (this.opts.suggestions?.length) {
      const sug = this.el.createDiv('jp-canvas-sugs');
      for (const s of this.opts.suggestions.slice(0, 4)) {
        const range = suggestionToTokenRange(this.tokens, s);
        if (!range) continue;
        const label = this.tokens.slice(range[0], range[1] + 1).map((t) => t.text).join('');
        const chip = sug.createEl('button', { text: `💡 ${label}`, cls: 'jp-canvas-sug', attr: { title: s.label } });
        chip.onclick = () => {
          this.marks = { ...emptyMarks(), span: range };
          this.repaint();
          this.opts.onChange(deriveFromMarks(this.tokens, this.marks), this.marks);
        };
      }
    }

    const clear = this.el.createEl('button', { text: '⌫ マークを消す', cls: 'jp-canvas-clear' });
    clear.onclick = () => {
      this.marks = emptyMarks();
      this.repaint();
      this.opts.onChange(deriveFromMarks(this.tokens, this.marks), this.marks);
    };

    this.repaint();
  }

  private paintPreview(from: number, to: number, strike: boolean): void {
    this.repaint();
    const [a, b] = [Math.min(from, to), Math.max(from, to)];
    for (let i = a; i <= b; i++) this.pills[i]?.addClass(strike ? 'jp-canvas-pill--striking' : 'jp-canvas-pill--spanning');
  }

  private repaint(): void {
    this.pills.forEach((p, i) => {
      p.className = `jp-canvas-pill${this.tokens[i].kind === 'punct' ? ' jp-canvas-pill--punct' : ''}`;
      if (this.faint && !this.hasMarks() && i >= this.faint[0] && i <= this.faint[1]) p.addClass('jp-canvas-pill--faint');
      if (this.marks.span && i >= this.marks.span[0] && i <= this.marks.span[1]) p.addClass('jp-canvas-pill--span');
      if (this.marks.parts.includes(i)) p.addClass('jp-canvas-pill--part');
      if (this.marks.struck.includes(i)) p.addClass('jp-canvas-pill--struck');
      if (this.marks.circled === i) p.addClass('jp-canvas-pill--circled');
      if (this.marks.halo && i >= this.marks.halo[0] && i <= this.marks.halo[1] && this.marks.circled !== i) p.addClass('jp-canvas-pill--halo');
    });
  }
}
