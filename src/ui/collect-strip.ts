/**
 * collect-strip.ts — the DOM half of 集句 (x/collect.ts).
 *
 * A slim strip at the top of an armed view. Hidden until the question
 * starts (a first term arrives, or the hand latches ⊕); from then on it
 * shows the accumulating terms as chips, the AND/〜 mode, the live local
 * count, and the doors: run in the 𝕏検索辞書 (where the pair panel, gap
 * concordance and form families answer), or classify the assembled shape
 * into the 台帳.
 *
 * ARMED mode is the ergonomic core: while the latch is down, EVERY settled
 * selection in the view joins the set — select 今も, select やや, done; no
 * verb press between them. The echo stays up (it still answers what each
 * span MEANS); this strip is about what the spans do TOGETHER.
 *
 * One CollectSet is shared plugin-wide (a span from the 辞書 and a span
 * from the 𝕏 view land in one question); each mounted strip re-renders on
 * the set's own events.
 */

import { CollectSet, collectable } from '../x/collect.ts';

export interface CollectStripDeps {
  set: CollectSet;
  /** Local corpus count for the CURRENT assembly (null = unknown/empty). */
  count: (query: string) => number | null;
  /** Open the 𝕏 view on this query — where the semantic layer answers. */
  run: (query: string) => void;
  /** File the assembled shape into the 台帳 (optional). */
  classify?: (key: string) => void;
}

export function mountCollectStrip(host: HTMLElement, deps: CollectStripDeps): () => void {
  const el = host.createDiv('jp-collect');
  el.hide();

  let selTimer: number | null = null;
  const onSelChange = (): void => {
    if (!deps.set.armed()) return;
    if (selTimer) window.clearTimeout(selTimer);
    selTimer = window.setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (!sel || sel.rangeCount === 0 || !collectable(text)) return;
      const anchor = sel.anchorNode;
      const a = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
      if (!a || !host.contains(a)) return;
      // Chrome is not text here either (the echo's own rule).
      if ((a as HTMLElement).closest?.('button, input, textarea, select, [data-jp-no-echo], .jp-collect')) return;
      deps.set.add(text);
    }, 500);
  };
  document.addEventListener('selectionchange', onSelChange);

  const render = (): void => {
    const terms = deps.set.list();
    const armed = deps.set.armed();
    if (!terms.length && !armed) { el.hide(); el.empty(); return; }
    el.show();
    el.empty();

    const latch = el.createEl('button', {
      cls: `jp-collect-latch${armed ? ' jp-collect-latch--on' : ''}`,
      attr: { title: armed ? '集句を解除 — 選択はもう集まりません' : '選択を集める — 押している間、選択するたび条件に加わります' },
    });
    latch.setText(armed ? '⊕ 集めています' : '⊕');
    latch.onclick = () => deps.set.setArmed(!armed);

    for (const t of terms) {
      const chip = el.createDiv('jp-collect-chip');
      chip.createSpan({ text: t, cls: 'jp-collect-chip-text' });
      const x = chip.createEl('button', { text: '✕', cls: 'jp-collect-chip-x', attr: { 'aria-label': `${t} を外す` } });
      x.onclick = () => deps.set.remove(t);
    }

    if (terms.length >= 2) {
      const mode = deps.set.mode();
      const modeBtn = el.createEl('button', {
        cls: 'jp-collect-mode',
        attr: {
          title: mode === 'and'
            ? '共起（順不同・同ツイート内）— タップで 〜近接（この順序・近く）へ'
            : '〜近接（この順序で近くに立つ）— タップで共起へ。三語以上は共起のみ',
        },
      });
      modeBtn.setText(mode === 'and' ? '×共起' : '〜近接');
      modeBtn.onclick = () => deps.set.setMode(mode === 'and' ? 'near' : 'and');
    }

    if (terms.length) {
      const q = deps.set.query();
      const n = deps.count(q);
      el.createSpan({
        cls: 'jp-collect-count',
        text: n === null ? '' : `ローカル ${n}件`,
        attr: { title: '凍結コーパス内の件数 — ライブ取得はまだ走っていません' },
      });
      const go = el.createEl('button', { text: '𝕏で見る', cls: 'jp-collect-go' });
      go.onclick = () => deps.run(q);
      if (deps.classify && terms.length >= 2) {
        const cls = el.createEl('button', {
          text: '分類', cls: 'jp-collect-classify',
          attr: { title: 'この組み合わせを台帳へ（機械は提案しません — 分類は手の仕事）' },
        });
        cls.onclick = () => deps.classify!(q);
      }
    }

    const clear = el.createEl('button', { text: '⌫', cls: 'jp-collect-clear', attr: { 'aria-label': '集句をすべて消す' } });
    clear.onclick = () => deps.set.clear();
  };

  const unsub = deps.set.subscribe(render);
  render();

  return () => {
    unsub();
    document.removeEventListener('selectionchange', onSelChange);
    if (selTimer) window.clearTimeout(selTimer);
    el.remove();
  };
}
