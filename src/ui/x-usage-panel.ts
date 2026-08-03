/**
 * x-usage-panel.ts — the corpus panel, rendered identically wherever it appears.
 *
 * ONE renderer, used by the 𝕏 view (above its feed) and by a catalog entry (as
 * a knowledge box). That is not code tidiness — it is §28 S1 made visible: the
 * X corpus is a *view of the same lexicon*, so "how X writes this" must read
 * the same whether you arrived from a search box or from an entry you were
 * already studying. Two renderers would drift, and the day they did, the same
 * phrase would have two different reputations depending on which door you used.
 *
 * The design argument for what it shows is in `x/usage.ts`. The design argument
 * for what it *refuses* to show is here: no percentages, no "commonly used",
 * no ranking against other phrases. The panel reports counts over a corpus it
 * names, and the reader draws the conclusion. A corpus of 1,832 tweets can say
 * "38 people wrote this"; it cannot say "this is common in Japanese", and the
 * gap between those two sentences is the whole of §12.
 */

import { knowledgeBox } from './knowledge-box.ts';
import { spreadOf, type XUsage } from '../x/usage.ts';

export interface XUsagePanelDeps {
  /** Open a permalink — the door back on every concordance row (§28 S2). */
  openUrl: (url: string) => void;
  /** Capture this line as a 用例 on the entry being viewed, when there is one. */
  onCapture?: (quote: string, url: string, handle: string) => void;
}

const SPREAD_JA: Record<ReturnType<typeof spreadOf>, string> = {
  // Deliberately descriptive, never evaluative. `narrow` does not mean "bad
  // evidence" — it means "look at who", which is a different instruction.
  thin: '用例が少なく、傾向はまだ言えません',
  narrow: '少数の書き手に偏っています — 誰が書いたか見てください',
  spread: 'いろいろな書き手が使っています',
};

const ym = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
};

/**
 * Render `u` into `host`. Returns the box, or null when there is nothing
 * honest to say — an empty corpus panel is worse than none (§28 S6).
 */
export function renderXUsage(host: HTMLElement, u: XUsage, deps: XUsagePanelDeps): HTMLElement | null {
  if (!u.hits) return null;
  const spread = spreadOf(u);
  const body = knowledgeBox(
    host,
    `𝕏 コーパスの中の「${u.term}」 — ${u.hits.toLocaleString()}件 / ${u.corpus.toLocaleString()}件中 ・ ${u.authors.toLocaleString()}人`,
    'goho',
  );

  const meta = body.createDiv('jp-xu-meta');
  meta.createSpan({ cls: `jp-xu-spread jp-xu-spread--${spread}`, text: SPREAD_JA[spread] });
  if (u.span) {
    meta.createSpan({
      cls: 'jp-xu-span',
      // The date range is register information: a phrase whose newest sighting
      // is three years old is not current, and only the corpus can say so.
      text: u.span.from === u.span.to ? ym(u.span.from) : `${ym(u.span.from)}〜${ym(u.span.to)}`,
    });
  }

  // ── the adjacent environment ──
  const env = (label: string, list: XUsage['before']): void => {
    if (!list.length) return;
    const row = body.createDiv('jp-xu-env');
    row.createSpan({ cls: 'jp-xu-env-label', text: label });
    for (const n of list) {
      const chip = row.createSpan({ cls: 'jp-xu-chip' });
      chip.createSpan({ text: n.text });
      // count/authors together, always — a count without its spread is the
      // number this whole module exists to stop reporting alone.
      chip.createSpan({ cls: 'jp-xu-chip-n', text: `${n.count}・${n.authors}人` });
    }
  };
  env('前に', u.before);
  env('後に', u.after);

  // ── the concordance ──
  // Alignment IS the finding. Left column right-aligned against the hit so the
  // recurring environment stacks into a visible column; unaligned, this is just
  // a list of sentences.
  const kw = body.createDiv('jp-xu-kwic');
  for (const l of u.lines) {
    const row = kw.createDiv('jp-xu-row');
    row.createSpan({ cls: 'jp-xu-left', text: (l.clippedLeft ? '…' : '') + l.left });
    row.createSpan({ cls: 'jp-xu-hit', text: l.hit });
    row.createSpan({ cls: 'jp-xu-right', text: l.right + (l.clippedRight ? '…' : '') });
    const acts = row.createDiv('jp-xu-acts');
    if (deps.onCapture) {
      const grab = acts.createEl('button', { cls: 'jp-xu-btn', text: '📎', attr: { title: 'この一行を用例として添付' } });
      grab.onclick = (e) => {
        e.stopPropagation();
        deps.onCapture!((l.clippedLeft ? '…' : '') + l.left + l.hit + l.right + (l.clippedRight ? '…' : ''), l.url, l.handle);
      };
    }
    const go = acts.createEl('button', { cls: 'jp-xu-btn', text: '↪', attr: { title: `@${l.handle} の投稿を開く` } });
    go.onclick = (e) => { e.stopPropagation(); deps.openUrl(l.url); };
  }
  if (u.more) {
    body.createDiv({
      cls: 'jp-xu-more',
      // §28 S6: a sample that does not say it is a sample reads as the total.
      text: `ほか${u.more.toLocaleString()}件（この一覧は先頭${u.lines.length}件）`,
    });
  }
  return body;
}
