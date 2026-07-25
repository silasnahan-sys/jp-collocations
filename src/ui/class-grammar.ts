/**
 * class-grammar.ts — THE single source of the 6-class visual grammar.
 *
 * DESIGN §26.0 rule 4 ("one grammar everywhere"): the same color, box shape and
 * badge must mean the same thing on every surface, so knowledge transfers with
 * zero relearning. Rule 5 ("continuity of identity"): an entry seen in search,
 * in the catalog, in the tray, in SRS is the SAME object re-rendered.
 *
 * Before this module both rules were false in practice:
 *   • colors were injected inline from `NOTE_TYPES[cls].color` in some views and
 *     hardcoded as raw hexes in `styles.css` for *unrelated* things — #4a90d9
 *     meant 連語 here and "speaker A" / "SRS good" / "noun" there;
 *   • setting a class used three different affordances (chip row in the capture
 *     modal, raw <select> dropdowns in the library and lexicon panel), and a
 *     <select> is a translation step (rule 2) as well as a second grammar;
 *   • six views rendered classed objects with no class mark at all.
 *
 * Everything class-colored now routes through here. `NOTE_TYPES` stays the data;
 * this is the only place that turns it into pixels.
 */

import { NOTE_TYPES, NOTE_CLASSES, type NoteClass } from '../notes/note-types.ts';

/** CSS custom property that carries a class color. Keyed by callout keyword. */
export const classVar = (cls: NoteClass): string => `--jp-cls-${NOTE_TYPES[cls].callout}`;

/** Always reference a class color through the variable — never re-inline the hex. */
export const classColor = (cls: NoteClass): string => `var(${classVar(cls)})`;

/** Operational test for each class, in the user's own words (§7 v2 semantics). */
export const CLASS_HINTS: Record<NoteClass, string> = {
  serifu: 'そのまま引用できる固定のセリフ（引用テスト）',
  collocation: '語⟷語の結びつき — 入れ替えると不自然（置換テスト）',
  rhet_collocation: '喚起的な語で演じる表現 — レンマ自体が像を持つ（喚起テスト）',
  phrase_schema: '丸ごと取り出して言う型 — 並べ替えると死ぬ・スロットは開く',
  skeletal: '成分どうしのリンク — 並べ替えても構築される意味が生きる',
  discourse: '応答性 — 相手・前の発話・コミットメントとの関係で初めて機能する',
};

const STYLE_EL_ID = 'jp-class-grammar';

/**
 * Publish the taxonomy into CSS as custom properties, so a stylesheet rule and a
 * JS-built element cannot disagree about what 連語-blue is. Called once in
 * onload(); idempotent, so a re-register just refreshes the block.
 */
export function injectClassGrammar(doc: Document = document): void {
  const css = [
    'body {',
    ...NOTE_CLASSES.map((c) => `  ${classVar(c)}: ${NOTE_TYPES[c].color};`),
    '}',
  ].join('\n');
  let el = doc.getElementById(STYLE_EL_ID) as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement('style');
    el.id = STYLE_EL_ID;
    doc.head.appendChild(el);
  }
  el.textContent = css;
}

/**
 * The class rail — the left edge every classed card wears, on every surface.
 * `undefined` renders the neutral "unclassed" rail rather than nothing, so an
 * unclassed object is visibly unclassed instead of silently untyped.
 */
export function applyClassRail(el: HTMLElement, cls: NoteClass | undefined): void {
  el.addClass('jp-cls-railed');
  el.style.setProperty('--jp-rail', cls ? classColor(cls) : 'var(--background-modifier-border)');
  if (cls) el.dataset.jpClass = cls; else delete el.dataset.jpClass;
  el.title = cls ? NOTE_TYPES[cls].label : '未分類';
}

/** The class dot — the compact mark used where a full rail does not fit. */
export function classDot(parent: HTMLElement, cls: NoteClass, opts: { ratified?: boolean } = {}): HTMLElement {
  const d = parent.createSpan({ cls: 'jp-cls-dot' });
  d.style.setProperty('--jp-dot', classColor(cls));
  if (opts.ratified === false) d.addClass('jp-cls-dot--suggested');
  d.title = opts.ratified === false
    ? `${NOTE_TYPES[cls].label}（提案 — 未確定）`
    : NOTE_TYPES[cls].label;
  return d;
}

/**
 * The class badge — dot + label, for headers and rows that have room.
 * Same object, same mark, everywhere it is re-rendered (rule 5).
 */
export function classBadge(parent: HTMLElement, cls: NoteClass, opts: { ratified?: boolean } = {}): HTMLElement {
  const b = parent.createSpan({ cls: 'jp-cls-badge' });
  b.style.setProperty('--jp-badge', classColor(cls));
  if (opts.ratified === false) b.addClass('jp-cls-badge--suggested');
  b.createSpan({ text: NOTE_TYPES[cls].emoji, cls: 'jp-cls-badge-emoji' });
  b.createSpan({ text: NOTE_TYPES[cls].label, cls: 'jp-cls-badge-label' });
  b.title = CLASS_HINTS[cls];
  return b;
}

export interface ClassChipsOpts {
  /** current class; `undefined` = nothing picked yet. */
  value?: NoteClass;
  /** the machine's guess — rendered as 提案, never as truth (sweep-precision rule). */
  suggested?: NoteClass;
  /** false = the class came from a matcher and has not been ratified by the hand. */
  ratified?: boolean;
  /** 1–6 digit shortcuts, matching chip order. Only where a modal owns the keyboard. */
  keys?: boolean;
  /** emoji-only chips, for tight rows (catalog cards, tray items). */
  compact?: boolean;
  onPick: (cls: NoteClass) => void | Promise<void>;
}

/**
 * THE class control. One gesture on every surface that can set a note type —
 * replacing the <select> dropdowns, which were both a second grammar and a
 * translation step (you picked from a form field describing the content instead
 * of acting on the content).
 *
 * Returns a handle so a view can re-mark the active chip without a full
 * re-render — retyping should not cost a repaint of the list you are reading.
 */
export function classChips(
  parent: HTMLElement,
  opts: ClassChipsOpts,
): { el: HTMLElement; set: (cls: NoteClass) => void } {
  const row = parent.createDiv({ cls: opts.compact ? 'jp-cls-chips jp-cls-chips--compact' : 'jp-cls-chips' });
  const els = new Map<NoteClass, HTMLElement>();
  let active = opts.value;

  const mark = (cls: NoteClass): void => {
    active = cls;
    for (const [c, el] of els) el.toggleClass('jp-cls-chip--active', c === cls);
  };

  NOTE_CLASSES.forEach((c, i) => {
    const def = NOTE_TYPES[c];
    const b = row.createEl('button', { cls: 'jp-cls-chip' });
    b.style.setProperty('--jp-chip', classColor(c));
    if (opts.keys) b.createSpan({ text: String(i + 1), cls: 'jp-cls-chip-key' });
    b.createSpan({ text: def.emoji, cls: 'jp-cls-chip-emoji' });
    if (!opts.compact) b.createSpan({ text: def.label, cls: 'jp-cls-chip-label' });
    if (c === opts.suggested && c !== opts.value) {
      b.createSpan({ text: '提案', cls: 'jp-cls-chip-suggest' });
    }
    b.title = `${def.label} — ${CLASS_HINTS[c]}`;
    b.setAttribute('aria-label', def.label);
    b.onclick = () => { mark(c); void opts.onPick(c); };
    els.set(c, b);
  });

  if (active) mark(active);
  // A class the hand has not ratified reads as provisional, everywhere (never truth).
  if (opts.ratified === false) row.addClass('jp-cls-chips--suggested');

  return { el: row, set: mark };
}
