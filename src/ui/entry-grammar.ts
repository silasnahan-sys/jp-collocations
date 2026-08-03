/**
 * entry-grammar.ts — THE single renderer for dictionary-entry parts.
 *
 * Sibling of `class-grammar.ts`, same job on a different axis, and the two are
 * deliberately orthogonal:
 *
 *   • the 6-class taxonomy owns **HUE** (`NOTE_TYPES` colors are RESERVED);
 *   • the entry grammar owns **SHAPE and WEIGHT** (§26.1: "badges are
 *     shape-coded — A1 filled square, 文型 outlined, 名/動 boxed").
 *
 * That is what lets a 連語-blue class dot and a 英辞郎 register badge sit on the
 * same card without ever competing for the same signal, and it is why this
 * module contains no hex at all — every color is an Obsidian theme variable, so
 * the entry reads as typeset text in the user's own theme rather than as a
 * second palette bolted on.
 *
 * §26.1: "the entry is a typeset ARTICLE, not a UI — inside the content area
 * there is zero chrome: no cards, no dividers except semantic boxes; hierarchy
 * is typography alone." So this module emits spans and hairlines, never boxes
 * within boxes.
 *
 * **This is the only place entry parts become pixels.** `entry-parts.ts` decides
 * WHAT the parts are (per-dictionary, as data); this decides how they look
 * (identically, everywhere). A dictionary can never acquire its own layout,
 * which is what makes drift structurally impossible rather than merely
 * discouraged. `golden/entry-parts.mjs` pins both halves.
 */

import type {
  EntryPart, PartKind, SenseBlock, EntryNode, EntryShape,
} from '../dictionary/entry-parts.ts';
import type { Selection, SaveRelation } from '../dictionary/savable.ts';

/** CSS custom property carrying a part's accent. Shape/weight live in styles.css. */
export const partVar = (kind: PartKind): string => `--jp-part-${kind}`;

/**
 * What each part MEANS, in the user's language — the tooltip is the whole
 * explanation of the grammar, so it has to be learnable from one hover.
 * §27.1 is load-bearing here: a 〔context〕 is a production-CONDITION (when you
 * would reach for this), which is a different question from what it combines
 * with (frame) or who says it (register).
 */
export const PART_HINTS: Record<PartKind, string> = {
  pron: '発音',
  pos: '品詞',
  level: '語彙レベル',
  inflect: '活用形',
  sense: '語義番号',
  context: 'この語を選ぶ条件 — 「いつ使うか」（§27.1 産出条件）',
  frame: '共起の型 — 「何と一緒に使うか」',
  register: '位相 — 「誰が・どこで言うか」（話/英/《諺》など）',
  gloss: '語義',
  alt: '言い換え可能な部分',
  example: '用例',
  note: '補足',
  xref: '参照 — タップで引く',
};

export interface EntryRenderOpts {
  /** §28 S4 — an example is capturable where it sits, not somewhere else. */
  onCaptureExample?: (text: string, ja?: string, en?: string) => void;
  /** §28 S4 — a cross-reference is a door, not a string. */
  onLookup?: (word: string, via?: SaveRelation) => void;
  /** Marks occurrences of the queried headword inside examples (§26.1). */
  highlight?: string;
  /**
   * Turn a dictionary's own media path into something the view can load.
   * Absent when the images were never extracted, in which case an `image`
   * renders as nothing at all rather than as a broken frame (§28 S6).
   */
  resolveMedia?: (src: string) => string | undefined;
  /**
   * §28 S4, generalized — capture ANY thing the book asserted, where it sits.
   *
   * The old path could only take an example, because an example was the only
   * thing the model could name. Now a synonym, a judgement cell, a 使い分け line,
   * a derived form and a citation are each their own selectable thing, and
   * `offeredBy()` decides what each can honestly become.
   */
  onCapture?: (sel: Selection, evt: MouseEvent) => void;
  /** The entry's own headword — what this book's ━ / ― mark stands for. */
  headword?: string;
}

/** A 🏷️ on anything the book asserted — the same verb everywhere (§26.0(4)). */
function captureButton(parent: HTMLElement, sel: Selection, opts: EntryRenderOpts): void {
  if (!opts.onCapture) return;
  const b = parent.createEl('button', { cls: 'jp-part-capture', text: '🏷️' });
  b.title = '取り込む — 何として保存するか選べます';
  b.setAttr('aria-label', `${sel.text} を取り込む`);
  // The event is threaded through rather than read off `window.event`: that
  // global is deprecated, empty under strict/async handling, and a menu with no
  // anchor opens in the corner of the screen or not at all.
  b.onclick = (e) => { e.stopPropagation(); e.preventDefault(); opts.onCapture?.(sel, e); };
}

/**
 * Expand the book's headword-substitution mark in place.
 *
 * 新明解 prints `━な━に` for 爽快な・爽快に and 大辞泉 prints 「朝の―な気分」. Stored
 * verbatim, because that IS the page; but read as dashes it is noise, and the
 * reader should not have to hold the substitution in their head. The expansion
 * is muted so it still reads as the book's abbreviation rather than as text the
 * dictionary wrote out — and it means the same thing in every book (§26.0(4)).
 */
function withHeadwordMark(parent: HTMLElement, text: string, headword?: string): boolean {
  const hw = headword?.trim();
  if (!hw || !/[━―—]/.test(text)) return false;
  const parts = text.split(/([━―—]+)/);
  for (const p of parts) {
    if (!p) continue;
    if (/^[━―—]+$/.test(p)) {
      parent.createSpan({ cls: 'jp-part-headmark', text: hw }).title = `この辞書は「${hw}」を ${p} と略します`;
    } else parent.appendText(p);
  }
  return true;
}

/** Bold every occurrence of `needle` — §26.1: examples show the target in bold. */
function withHighlight(parent: HTMLElement, text: string, needle?: string, headword?: string): void {
  if (withHeadwordMark(parent, text, headword)) return;
  const n = needle?.trim();
  if (!n) { parent.appendText(text); return; }
  let i = 0;
  const lower = text.toLowerCase(), ln = n.toLowerCase();
  for (;;) {
    const at = lower.indexOf(ln, i);
    if (at < 0) { parent.appendText(text.slice(i)); return; }
    if (at > i) parent.appendText(text.slice(i, at));
    parent.createEl('strong', { text: text.slice(at, at + n.length), cls: 'jp-part-hit' });
    i = at + n.length;
  }
}

/** One part → one element. The ONLY place a part becomes pixels. */
export function renderPart(parent: HTMLElement, part: EntryPart, opts: EntryRenderOpts = {}): HTMLElement {
  const el = parent.createSpan({ cls: `jp-part jp-part--${part.kind}` });
  el.title = PART_HINTS[part.kind];
  el.dataset.jpPart = part.kind;

  if (part.kind === 'example') {
    // An example is a block, not an inline run: it is the thing the eye should
    // be able to skip to, and the thing most often captured.
    el.addClass('jp-part-example');
    if (part.en) withHighlight(el.createDiv('jp-part-example-en'), part.en, opts.highlight, opts.headword);
    if (part.ja) withHighlight(el.createDiv('jp-part-example-ja'), part.ja, opts.highlight, opts.headword);
    if (!part.en && !part.ja) withHighlight(el.createDiv('jp-part-example-en'), part.text, opts.highlight, opts.headword);
    // ONE capture verb for the whole entry. This used to be a bespoke button
    // that could only ever mean "save an example", so a sense's example and a
    // relation's example behaved differently on the same screen — the drift
    // this design exists to prevent. Both now go through the typed menu, and
    // `onCaptureExample` remains only for callers that never learned it.
    if (opts.onCapture) {
      captureButton(el, {
        text: part.ja ?? part.text, en: part.en, kind: 'example',
      }, opts);
    } else if (opts.onCaptureExample) {
      const b = el.createEl('button', { cls: 'jp-part-capture', text: '🏷️' });
      b.title = 'この用例を分類して取り込む';
      b.onclick = (e) => { e.stopPropagation(); opts.onCaptureExample?.(part.text, part.ja, part.en); };
    }
    return el;
  }

  if (part.kind === 'xref' && opts.onLookup) {
    const a = el.createEl('a', { text: part.text, cls: 'jp-part-xref-link' });
    a.onclick = (e) => { e.preventDefault(); opts.onLookup?.(part.text, '言い換え'); };
    return el;
  }

  // The publisher's own token, verbatim — 〔…〕 and 《…》 keep their brackets so
  // the entry still reads like the book it came from.
  const wrap = part.kind === 'context' ? ['〔', '〕']
    : part.kind === 'register' ? ['《', '》']
    : part.kind === 'alt' ? ['[', ']']
    : ['', ''];
  el.appendText(wrap[0]);
  withHighlight(el, part.text, undefined, opts.headword);
  el.appendText(wrap[1]);
  return el;
}

/**
 * What each SHAPE means. The tooltip is the whole teaching of the relation, so
 * it has to be learnable from one hover — and it is the same sentence in every
 * dictionary, which is the point (§26.0(4)).
 */
export const SHAPE_HINTS: Record<EntryShape, string> = {
  section: 'この辞書自身の見出し区分',
  senses: '語義',
  'pos-group': '品詞・位相のまとまり — 以下の語義はすべてこの品詞',
  members: '語群 — 同じ意味を分け合う語の集合',
  derived: '派生形 — 品詞ごとの派生語',
  comparison: '対比表 — どの語がどの型に入るか（○/△/−は出版社の判定）',
  distinctions: '使い分け — 語群の中の違い',
  examples: '用例',
  attestations: '実例 — コーパスからの実際の用例',
  image: '図版 — 辞書自身の挿絵',
  prose: '解説',
};

/**
 * ONE renderer per SHAPE — never one per dictionary.
 *
 * This is the whole anti-drift argument made concrete. A book's profile says
 * WHICH relations it uses and WHAT IT CALLS them; this decides how each relation
 * is drawn, identically for all 35. Adding a dictionary cannot add a renderer,
 * so a 類語対比表 and a 類語スケール are drawn the same way under their own
 * labels — learn the grammar once, it holds everywhere (§26.0(4)).
 *
 * §26.1 still governs: hierarchy is typography, not chrome. The one grid that
 * appears is the comparison, where the grid IS the information (§26.0(e)).
 */
export function renderEntryNodes(
  parent: HTMLElement, nodes: EntryNode[], opts: EntryRenderOpts = {},
): HTMLElement {
  const wrap = parent.createDiv('jp-shapes');
  for (const n of nodes) renderShape(wrap, n, opts);
  return wrap;
}

export function renderShape(parent: HTMLElement, n: EntryNode, opts: EntryRenderOpts = {}): HTMLElement {
  const el = parent.createDiv(`jp-shape jp-shape--${n.shape}`);
  el.dataset.jpShape = n.shape;
  el.title = SHAPE_HINTS[n.shape];

  // The publisher's OWN title, verbatim — 類語対比表 stays 類語対比表.
  if (n.label) el.createDiv({ cls: 'jp-shape-label', text: n.label });

  // Badges that GROUP what follows (品詞/位相): shape-coded, never hued.
  for (const t of n.tags ?? []) el.createSpan({ cls: 'jp-part jp-part--pos jp-shape-tag', text: t });

  if (n.shape === 'comparison' && n.table) { renderComparison(el, n.table, opts); return el; }

  if ((n.shape === 'members' || n.shape === 'derived') && n.items) {
    const list = el.createDiv('jp-shape-members');
    for (const m of n.items) {
      const row = list.createDiv('jp-shape-member');
      const head = row.createSpan({ cls: 'jp-shape-member-head', text: m.text });
      // Navigating away is a DIFFERENT act from taking the word, and mixing
      // them is why a tap meant to select kept becoming a lookup. The word
      // navigates; the 🏷️ captures.
      if (opts.onLookup) {
        head.addClass('jp-part-xref-link');
        head.onclick = () => opts.onLookup?.(m.text, n.shape === 'derived' ? '派生形' : '類語');
      }
      if (m.pos) row.createSpan({ cls: 'jp-part jp-part--pos', text: m.pos });
      if (m.gloss) row.createSpan({ cls: 'jp-part jp-part--gloss', text: m.gloss });
      captureButton(row, {
        text: m.text, shape: n.shape, label: m.gloss ?? n.label,
      }, opts);
    }
    return el;
  }

  if (n.shape === 'attestations') {
    // Corpus citations, keyword-in-context. These are ATTESTED — the evidential
    // tier this plugin is built on — so each is capturable where it sits (S4).
    const list = el.createDiv('jp-shape-attestations');
    for (const c of n.children ?? []) {
      const row = list.createDiv('jp-shape-attestation');
      withHighlight(row, c.text ?? '', c.hit ?? opts.highlight, opts.headword);
      if (c.cite) row.createSpan({ cls: 'jp-shape-cite', text: c.cite }).title = '出典';
      captureButton(row, {
        text: c.text ?? '', shape: 'attestations', cite: c.cite, label: n.label,
      }, opts);
    }
    return el;
  }

  if (n.shape === 'examples' && (n.text || n.en)) {
    renderPart(el, { kind: 'example', text: n.text ?? n.en ?? '', ja: n.text, en: n.en },
      { ...opts, highlight: n.hit ?? opts.highlight, onCaptureExample: undefined });
    if (n.cite) el.createSpan({ cls: 'jp-shape-cite', text: n.cite }).title = '出典';
    captureButton(el, {
      text: n.text ?? n.en ?? '', en: n.text && n.en ? n.en : undefined,
      shape: 'examples', cite: n.cite, label: n.label,
    }, opts);
    return el;
  }

  if (n.shape === 'image') {
    // §28 S6 — a vault that never extracted the media shows NOTHING rather than
    // a broken frame. `resolveMedia` is absent until the images are installed.
    const url = n.src ? opts.resolveMedia?.(n.src) : undefined;
    if (!url) return el;
    const img = el.createEl('img', { cls: 'jp-shape-image' });
    img.src = url;
    img.alt = n.text ?? '';
    img.loading = 'lazy';
    return el;
  }

  if (n.shape === 'distinctions') {
    const ol = el.createEl('ol', { cls: 'jp-shape-distinctions' });
    for (const c of n.children ?? []) {
      const li = ol.createEl('li', { text: c.text ?? '' });
      // A 使い分け line is the REASON to prefer one synonym over another — the
      // most reusable sentence in a thesaurus entry, and previously unsavable.
      captureButton(li, { text: c.text ?? '', shape: 'distinctions', label: n.label }, opts);
    }
    return el;
  }

  if (n.text) withHighlight(el.createDiv('jp-shape-text'), n.text, undefined, opts.headword);
  for (const p of n.parts ?? []) renderPart(el, p, opts);
  for (const c of n.children ?? []) renderShape(el, c, opts);
  return el;
}

/**
 * The comparison — items × frames → the publisher's own judgement.
 *
 * Drawn as a real grid because the grid IS the information: 類語例解 is telling
 * you that ちょいと is △ in 「…お待ちください」 where 少少 is ○, which is precisely
 * the reach-for question. Column headers keep the source's slot notation
 * (「私には…むずかしい」) rather than being reworded.
 */
export function renderComparison(
  parent: HTMLElement, table: { cols: string[]; rows: Array<{ item: string; cells: string[] }> },
  opts: EntryRenderOpts = {},
): HTMLElement {
  const t = parent.createEl('table', { cls: 'jp-shape-table' });
  const head = t.createEl('thead').createEl('tr');
  head.createEl('th');
  for (const c of table.cols) {
    head.createEl('th', { text: c, cls: 'jp-shape-frame' }).title = '共起の型';
  }
  const body = t.createEl('tbody');
  for (const r of table.rows) {
    const tr = body.createEl('tr');
    const th = tr.createEl('th', { text: r.item, cls: 'jp-shape-item' });
    if (opts.onLookup) {
      th.addClass('jp-part-xref-link');
      th.onclick = () => opts.onLookup?.(r.item, '類語');
    }
    r.cells.forEach((c, j) => {
      const td = tr.createEl('td', {
        text: c,
        cls: `jp-shape-cell jp-shape-cell--${c === '○' ? 'yes' : c === '△' ? 'maybe' : 'no'}`,
      });
      // A CELL is the smallest real claim in the whole entry: this word, in
      // this frame, gets this judgement. Capturing it captures all three.
      if (opts.onCapture && c) {
        td.addClass('jp-shape-cell--live');
        td.title = `${r.item} × ${table.cols[j]} = ${c}`;
        td.onclick = (e) => opts.onCapture?.({
          text: r.item, shape: 'comparison', label: table.cols[j], en: c,
        }, e);
      }
    });
  }
  return t;
}

/**
 * A whole entry — every sense, every part, in the fixed semantic order that
 * `entry-parts.ts` produced. Fixed order is half of "one grammar everywhere":
 * the eye learns where the apparatus lives once and never re-learns it.
 */
export function renderEntryParts(
  parent: HTMLElement, blocks: SenseBlock[], opts: EntryRenderOpts = {},
): HTMLElement {
  const article = parent.createDiv('jp-entry');
  for (const block of blocks) {
    const row = article.createDiv('jp-entry-sense');
    if (block.n !== undefined) {
      row.createSpan({ text: String(block.n), cls: 'jp-part jp-part--sense' }).title = PART_HINTS.sense;
    }
    const body = row.createDiv('jp-entry-sense-body');
    // §28 S6 — degrade honestly, in place, with the reason attached. This
    // entry's sense divisions were lost when the dictionary was converted, so
    // it reads as prose; saying that is the difference between a known
    // limitation and the plugin looking broken.
    if (block.flat) {
      body.addClass('jp-entry-sense-body--flat');
      const why = body.createDiv('jp-entry-flat-note');
      why.setText('この辞書は変換時に語義の区切りが失われています（再変換で構造が戻ります）');
      why.title = '設定 → 大型辞書 → 全辞書を変換 で、語義・用例・位相が分かれて表示されるようになります。';
    }
    for (const part of block.parts) renderPart(body, part, opts);
  }
  return article;
}
