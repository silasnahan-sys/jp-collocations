/**
 * PenProbeModal — what this device actually does with a Pencil.
 *
 * ## Why measure instead of read the docs
 *
 * The iPad ergonomics work rests on three claims that no amount of reading
 * settles, because they are properties of THIS webview on THIS OS version
 * inside THIS app, and Obsidian mobile is a WKWebView whose drag behaviour is
 * not documented anywhere that binds:
 *
 *   1. Does `dragstart` fire for `pointerType: 'pen'`? The entire cross-app
 *      carry depends on it — the synthetic path in `pointer-drag.ts` cannot
 *      leave the app by construction, so if native never fires for a pen then
 *      dragging a phrase into Apple Notes with the Pencil is not merely awkward,
 *      it is impossible, and the honest answer is a different mechanism (the
 *      share sheet / `obsidian://jpc-capture`) rather than a better long press.
 *   2. Does the Pencil report HOVER before it lands? `hover-peek` is the best
 *      thing this hardware can do and it is worth nothing if the events do not
 *      arrive.
 *   3. What do `pointer` / `hover` / `any-hover` report? The CSS in `styles.css`
 *      moved off a width breakpoint on the strength of an answer to this.
 *
 * This repo's standing norm is to settle questions like these on a number
 * rather than an argument — the same reason `golden/twc.mjs` verifies a scrape
 * on a record count instead of a string. So: press the pad with the Pencil and
 * read what happened. Everything below is observation; nothing is inferred.
 *
 * The report copies out as Markdown, because the useful thing to do with it is
 * paste it into a conversation about what to build next.
 */

import { App, Modal, Notice, Platform } from 'obsidian';
import { penDragVerdict, penSeen, posture, isCoarse, hand } from './posture.ts';

interface Seen {
  types: Set<string>;
  /** A pointer that moved with no button down and a real hover distance —
   *  i.e. a nib held ABOVE the glass. The single most useful bit here. */
  hoverBeforeContact: boolean;
  dragstartFor: Set<string>;
  maxPressure: number;
  sawTilt: boolean;
  sawAltitude: boolean;
  presses: number;
  longestPressMs: number;
}

export class PenProbeModal extends Modal {
  private seen: Seen = {
    types: new Set(),
    hoverBeforeContact: false,
    dragstartFor: new Set(),
    maxPressure: 0,
    sawTilt: false,
    sawAltitude: false,
    presses: 0,
    longestPressMs: 0,
  };
  private liveEl: HTMLElement | null = null;
  private downAt = 0;
  private downType = '';

  constructor(app: App) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('jp-penprobe');
    contentEl.createEl('h3', { text: '✎ ペン／ドラッグ調査' });
    contentEl.createEl('p', {
      cls: 'jp-penprobe-lead',
      text: 'この端末が Apple Pencil をどう扱うかを実測します。'
        + '下のパッドを ①ペンを浮かせて近づける ②タップ ③長押ししてドラッグ の順に試してください。',
    });

    /**
     * The pad is `draggable` and carries real text, so `dragstart` here is the
     * same event a transcript line would fire. Testing with anything less would
     * measure the test rather than the thing.
     */
    const pad = contentEl.createDiv('jp-penprobe-pad');
    pad.setText('ここを押す / 長押ししてドラッグ');
    pad.setAttribute('draggable', 'true');

    pad.addEventListener('pointerover', (e: PointerEvent) => this.note(e, 'over'));
    pad.addEventListener('pointermove', (e: PointerEvent) => this.note(e, 'move'));
    pad.addEventListener('pointerdown', (e: PointerEvent) => {
      this.downAt = Date.now();
      this.downType = e.pointerType;
      this.seen.presses++;
      this.note(e, 'down');
    });
    const up = (e: PointerEvent): void => {
      if (this.downAt) {
        this.seen.longestPressMs = Math.max(this.seen.longestPressMs, Date.now() - this.downAt);
        this.downAt = 0;
      }
      this.note(e, 'up');
    };
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    pad.addEventListener('dragstart', (e: DragEvent) => {
      // Attribute the drag to whatever pointer type was last pressed — a
      // DragEvent carries no pointerType of its own, and this is the only link
      // between "a pen was on the glass" and "the platform lifted a drag".
      this.seen.dragstartFor.add(this.downType || 'unknown');
      e.dataTransfer?.setData('text/plain', 'jp-collocations pen probe');
      this.repaint();
    });

    this.liveEl = contentEl.createDiv('jp-penprobe-live');

    const acts = contentEl.createDiv('jp-penprobe-acts');
    const copy = acts.createEl('button', { text: '📋 レポートをコピー', cls: 'mod-cta' });
    copy.onclick = () => {
      void navigator.clipboard.writeText(this.report().join('\n'))
        .then(() => new Notice('📋 コピーしました'))
        .catch(() => new Notice('クリップボードに書けませんでした'));
    };
    const reset = acts.createEl('button', { text: 'やり直す' });
    reset.onclick = () => {
      this.seen = {
        types: new Set(), hoverBeforeContact: false, dragstartFor: new Set(),
        maxPressure: 0, sawTilt: false, sawAltitude: false, presses: 0, longestPressMs: 0,
      };
      this.repaint();
    };

    this.repaint();
  }

  onClose(): void { this.contentEl.empty(); }

  private note(e: PointerEvent, phase: string): void {
    this.seen.types.add(e.pointerType);
    if (e.pressure > this.seen.maxPressure) this.seen.maxPressure = e.pressure;
    if (e.tiltX || e.tiltY) this.seen.sawTilt = true;
    const withAngle = e as PointerEvent & { altitudeAngle?: number };
    if (typeof withAngle.altitudeAngle === 'number') this.seen.sawAltitude = true;
    /**
     * Hover, defined honestly: a pen event with NO buttons held and zero
     * pressure, during move/over rather than down. On a device without Pencil
     * hover these simply never arrive, which is exactly the signal wanted.
     */
    if (e.pointerType === 'pen' && phase !== 'down' && e.buttons === 0 && e.pressure === 0) {
      this.seen.hoverBeforeContact = true;
    }
    this.repaint();
  }

  private mq(q: string): string {
    try { return window.matchMedia(q).matches ? 'YES' : 'no'; } catch { return '?'; }
  }

  private report(): string[] {
    const s = this.seen;
    const pen = s.types.has('pen');
    const L: string[] = [];
    L.push('## ✎ pen / drag probe');
    L.push('');
    L.push('### この端末');
    L.push(`- posture: **${posture()}** (hand: ${hand()})`);
    L.push(`- Platform: isPhone=${Platform.isPhone} isTablet=${Platform.isTablet} `
      + `isMobile=${Platform.isMobile} isDesktopApp=${Platform.isDesktopApp} isIosApp=${Platform.isIosApp}`);
    L.push(`- window: ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`);
    L.push(`- isCoarse(): ${isCoarse()}`);
    L.push(`- media \`(pointer: coarse)\`: ${this.mq('(pointer: coarse)')}`);
    L.push(`- media \`(pointer: fine)\`: ${this.mq('(pointer: fine)')}`);
    L.push(`- media \`(hover: hover)\`: ${this.mq('(hover: hover)')}`);
    L.push(`- media \`(any-pointer: fine)\`: ${this.mq('(any-pointer: fine)')}`);
    L.push(`- media \`(any-hover: hover)\`: ${this.mq('(any-hover: hover)')}`);
    L.push('');
    L.push('### 観測');
    L.push(`- pointerType seen: **${[...s.types].join(', ') || '(none yet)'}**`);
    L.push(`- presses: ${s.presses} (longest ${s.longestPressMs}ms)`);
    L.push(`- pen ever seen (global latch): ${penSeen()}`);
    L.push(`- **Pencil hover before contact: ${s.hoverBeforeContact ? 'YES' : 'no'}**`);
    L.push(`- max pressure: ${s.maxPressure.toFixed(3)}`);
    L.push(`- tilt reported: ${s.sawTilt} / altitudeAngle present: ${s.sawAltitude}`);
    L.push(`- **dragstart fired for: ${[...s.dragstartFor].join(', ') || 'NOTHING'}**`);
    L.push(`- pen drag verdict (live, from real carries): **${penDragVerdict()}**`);
    L.push('');
    L.push('### 判定');
    if (!pen) {
      L.push('- ペンがまだ観測されていません。Pencil でパッドに触れてください。');
    } else if (s.dragstartFor.has('pen') || penDragVerdict() === 'yes') {
      // Either instrument saying YES settles it, and they are not equal in
      // strength. This modal only watches presses made INSIDE it, on its own
      // pad; the live verdict comes from `notePenPress(true)` on real carries,
      // on real `draggable` rows, and is guarded by `pointerType === 'pen'`.
      // A capability observed once is a capability — it cannot be un-observed
      // by a later press that happened to be ignored. Branching on this
      // modal's own set alone reported a FALSE NEGATIVE on 2026-08-06: the
      // report printed 「発火していない」 directly under a live verdict of `yes`.
      const src = s.dragstartFor.has('pen') ? 'この画面での長押し' : '実際のカードの持ち出し';
      L.push(`- ✅ **ペンでネイティブドラッグが発火する**（証拠: ${src}） → 他アプリへの持ち出しは '
        + 'HTML5 drag で可能。\`pointer-drag.ts\` の 700ms 待機は正しい（プラットフォームに先を譲るため）。`);
      if (!s.dragstartFor.has('pen')) {
        L.push('  - なお、この画面の長押しでは発火していません。判定は実カードの記録を優先します'
          + '（この画面のパッドより、実際に draggable な行のほうが条件が本番に近いため）。');
      }
    } else if (s.presses > 0) {
      L.push('- ⚠️ **まだペンでのネイティブドラッグを観測できていません** → 現時点ではアプリ内の'
        + '合成ドラッグのみ。持ち出しは共有シート / `obsidian://jpc-capture` 側で解く必要があります。'
        + '（辞書やトレイの実カードを数回ペンで持ち上げてから、再度この検査を実行してください。'
        + '判定はそちらの記録を優先します。）');
    }
    if (s.hoverBeforeContact) {
      L.push('- ✅ ホバーが届く → 鑑賞モードの辞書ピークはこの端末で機能します。');
    } else if (pen) {
      L.push('- ⚠️ ホバー未観測（M2 未満の iPad、または Pencil 第1世代の可能性）。'
        + 'ピークは触れた瞬間にしか出ません。');
    }
    return L;
  }

  private repaint(): void {
    if (!this.liveEl) return;
    this.liveEl.empty();
    for (const line of this.report()) {
      if (line.startsWith('### ')) {
        this.liveEl.createDiv({ cls: 'jp-penprobe-h', text: line.slice(4) });
      } else if (line.startsWith('## ') || !line.trim()) {
        continue;
      } else {
        this.liveEl.createDiv({ cls: 'jp-penprobe-row', text: line.replace(/^- /, '').replace(/\*\*/g, '') });
      }
    }
  }
}
