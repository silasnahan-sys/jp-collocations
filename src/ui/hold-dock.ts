/**
 * hold-dock.ts — the carry, on screen. (Move 1, PHYSICS §0: 運ぶ)
 *
 * A small stack of held chips docked at the screen edge, mounted on
 * `document.body` so it survives every view switch by construction — the one
 * property the reference footage (Apple Calendar, IMG_1159) has and no plugin
 * surface had: the object stays in hand while the world navigates underneath.
 *
 * Gesture grammar:
 *   tap a chip        → its verbs, AT the chip (⤵トレイ / ⚡分類 / 辞書 / ✕)
 *   drag ≥ flickPx    → a TOSS: the chip flings out along the drag vector and
 *                       lands in the tray. Anywhere is a legal landing;
 *                       gravity decides, the hand just lets go.
 *   drag < flickPx    → treated as a tap (a tremor is not a decision).
 *
 * Invariant 9 status, stated honestly (2026-08-20 review): the grab and the
 * toss have command twins (hold-selection, hold-toss-newest — the plugin's
 * first default hotkeys). The per-chip verbs (⚡/📖/✕) ride the tap and have
 * no commands yet; they get them when the film decides the verb set is right.
 *
 * What this deliberately is NOT (yet): a drop target router. Targeted
 * delivery is the verb row; the toss has exactly one destination. Move 2's
 * inspector work decides whether chips also drag onto surfaces directly.
 *
 * Feel notes, honoring the June rule (grabbability visible AT REST): the chip
 * wears a grip texture and a lift shadow before it is ever touched; press
 * scales it slightly under the finger (compositor transform only — invariant
 * 16's stutter lesson); the toss flings the chip along the throw vector and
 * fades it, and the ONLY confirmation is the object visibly leaving (plus the
 * tray badge ticking) — the world is the record, not a toast.
 */

import type { HeldChip, HoldKnobs } from '../notes/hold.ts';
import { chipLabel, isToss } from '../notes/hold.ts';

export interface HoldDockDeps {
  chips: () => readonly HeldChip[];
  knobs: () => HoldKnobs;
  /** land a chip in the tray (gravity). The dock animates; the deps file it. */
  toTray: (chip: HeldChip) => void;
  /** open the classify capture with the chip's scene riding along (S1). */
  classify: (chip: HeldChip) => void;
  /** look the chip up in the 辞書. */
  lookup: (chip: HeldChip) => void;
  /** discard on purpose (the one road that does NOT go to the tray). */
  discard: (chip: HeldChip) => void;
}

export class HoldDock {
  private el: HTMLElement | null = null;
  private verbsFor: string | null = null;

  constructor(private deps: HoldDockDeps) {}

  mount(): void {
    if (this.el) return;
    this.el = document.body.createDiv('jp-hold-dock');
    this.render();
  }

  unmount(): void { this.el?.remove(); this.el = null; }

  render(): void {
    const host = this.el;
    if (!host) return;
    host.empty();
    const chips = this.deps.chips();
    host.toggleClass('jp-hold-dock--empty', chips.length === 0);
    // newest on top — the thing you just grabbed is the thing your eye expects
    for (let i = chips.length - 1; i >= 0; i--) this.renderChip(host, chips[i]);
  }

  private renderChip(host: HTMLElement, chip: HeldChip): void {
    const el = host.createDiv('jp-hold-chip');
    el.createDiv('jp-hold-grip');
    el.createSpan({ text: chipLabel(chip.text), cls: 'jp-hold-label' });
    if (this.verbsFor === chip.id) this.renderVerbs(el, chip);

    let x0 = 0, y0 = 0, dx = 0, dy = 0, tracking = false;
    el.addEventListener('pointerdown', (e) => {
      // chrome you press, not text you read — the press must not start a
      // selection or scroll underneath (chip is body-level; page scroll is
      // unaffected — the document-listener rule does not apply here).
      e.preventDefault();
      tracking = true;
      x0 = e.clientX; y0 = e.clientY; dx = 0; dy = 0;
      el.setPointerCapture(e.pointerId);
      el.addClass('jp-hold-chip--held');
    });
    el.addEventListener('pointermove', (e) => {
      if (!tracking) return;
      dx = e.clientX - x0; dy = e.clientY - y0;
      // compositor-only while in flight (the floating-rail lesson)
      el.style.transform = `translate(${dx}px, ${dy}px) scale(1.04)`;
    });
    const settle = (e: PointerEvent): void => {
      if (!tracking) return;
      tracking = false;
      el.releasePointerCapture(e.pointerId);
      el.removeClass('jp-hold-chip--held');
      if (isToss(dx, dy, this.deps.knobs().flickPx)) {
        // A toss lands in the tray wherever it was aimed — everywhere is a
        // legal landing. The chip visibly leaves; no toast follows it.
        el.addClass('jp-hold-chip--tossed');
        el.style.transform = `translate(${dx * 3}px, ${dy * 3 - 40}px) scale(0.6)`;
        window.setTimeout(() => { this.deps.toTray(chip); this.render(); }, 160);
      } else {
        el.style.transform = '';
        this.verbsFor = this.verbsFor === chip.id ? null : chip.id;
        this.render();
      }
    };
    el.addEventListener('pointerup', settle);
    el.addEventListener('pointercancel', settle);
  }

  private renderVerbs(chipEl: HTMLElement, chip: HeldChip): void {
    const row = chipEl.createDiv('jp-hold-verbs');
    const verb = (icon: string, title: string, run: () => void): void => {
      const b = row.createEl('button', { cls: 'jp-hold-verb', attr: { title } });
      b.setText(icon);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.verbsFor = null;
        run();
        this.render();
      });
    };
    verb('⤵', 'トレイへ', () => this.deps.toTray(chip));
    verb('⚡', '分類して台帳へ（場面つき）', () => this.deps.classify(chip));
    verb('📖', '辞書で引く', () => this.deps.lookup(chip));
    verb('✕', '捨てる（トレイに残らない）', () => this.deps.discard(chip));
  }
}
