/**
 * EditorDecorations.ts — CodeMirror 6 extension that adds colored underlines
 * and highlights showing discourse relations and patterns in the editor.
 *
 * Works in both edit mode and live preview (Obsidian uses CM6 for both).
 *
 * Visualization:
 *   - Colored underlines for intra-sentence clause relations
 *   - Background highlights for cross-sentence relations (source/target)
 *   - Gutter markers for sentences containing discourse patterns
 *   - Hover tooltips showing relation type + explanation
 */

import {
  EditorView,
  Decoration,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { analyzeRelations, type SentenceRelation, type ContextChunk } from '../discourse/sentence-relations';
import { detectPatterns, type PatternMatch } from '../discourse/discourse-grammar';
import {
  heuristicResolver,
  type RelationsResolver,
  type ResolvedRelations,
} from '../discourse/relations-resolver';

// ═══════════════════════════════════════════════════════════
// EDITOR CONTEXT — plugin-level resolver + active-file-path lookup
// ═══════════════════════════════════════════════════════════
// CM6 editor extensions are registered globally per plugin instance, but the
// resolver needs to know the active file path to look up the right sidecar.
// We expose a module-level setter the host plugin calls once at startup; the
// decoration builder consults it on each rebuild.

interface EditorContext {
  resolver: RelationsResolver;
  getActiveFilePath: () => string | undefined;
}

let editorContext: EditorContext = {
  resolver: heuristicResolver,
  getActiveFilePath: () => undefined,
};

/**
 * Inject the plugin-level resolver + active-file lookup. Called once from
 * `main.ts` after the SurferBridge is constructed. Without this call,
 * decorations fall back to the unvalidated heuristic resolver (and tooltips
 * say so).
 */
export function setEditorContext(ctx: EditorContext): void {
  editorContext = ctx;
}

// ══════════════════════════════════════════════════════════════
// STATE EFFECT: Toggle visualization on/off
// ══════════════════════════════════════════════════════════════

export const toggleVisualization = StateEffect.define<boolean>();

// ══════════════════════════════════════════════════════════════
// RELATION COLOR MAP (CSS classes)
// ══════════════════════════════════════════════════════════════

const COLOR_MAP: Record<string, { bg: string; border: string; label: string }> = {
  'jp-rel-cause':       { bg: 'rgba(255,107,107,0.15)', border: '#ff6b6b', label: '因果' },
  'jp-rel-concession':  { bg: 'rgba(255,159,67,0.15)',  border: '#ff9f43', label: '逆接' },
  'jp-rel-conditional': { bg: 'rgba(255,193,7,0.15)',   border: '#ffc107', label: '条件' },
  'jp-rel-temporal':    { bg: 'rgba(78,205,196,0.15)',   border: '#4ecdc4', label: '継起' },
  'jp-rel-purpose':     { bg: 'rgba(106,176,76,0.15)',   border: '#6ab04c', label: '目的' },
  'jp-rel-means':       { bg: 'rgba(104,109,224,0.15)',  border: '#686de0', label: '手段' },
  'jp-rel-contrast':    { bg: 'rgba(255,71,87,0.15)',    border: '#ff4757', label: '対比' },
  'jp-rel-addition':    { bg: 'rgba(46,213,115,0.15)',   border: '#2ed573', label: '並列' },
  'jp-rel-elaboration': { bg: 'rgba(116,185,255,0.15)',  border: '#74b9ff', label: '詳述' },
  'jp-rel-example':     { bg: 'rgba(162,155,254,0.15)',  border: '#a29bfe', label: '例示' },
  'jp-rel-reference':   { bg: 'rgba(253,203,110,0.15)',  border: '#fdcb6e', label: '照応' },
  'jp-rel-repetition':  { bg: 'rgba(129,236,236,0.15)',  border: '#81ecec', label: '反復' },
  'jp-rel-lexchain':    { bg: 'rgba(0,206,209,0.15)',    border: '#00ced1', label: '語彙鎖' },
  'jp-rel-topic':       { bg: 'rgba(85,239,196,0.15)',   border: '#55efc4', label: '主題' },
  'jp-rel-scaffold':    { bg: 'rgba(9,132,227,0.15)',    border: '#0984e3', label: '列挙' },
  'jp-rel-qa':          { bg: 'rgba(108,92,231,0.15)',   border: '#6c5ce7', label: 'Q&A' },
  'jp-rel-agree':       { bg: 'rgba(0,184,148,0.15)',    border: '#00b894', label: '同意' },
  'jp-rel-disagree':    { bg: 'rgba(214,48,49,0.15)',    border: '#d63031', label: '反論' },
  'jp-rel-tsukkomi':    { bg: 'rgba(225,112,85,0.15)',   border: '#e17055', label: 'ツッコミ' },
  'jp-rel-reaction':    { bg: 'rgba(253,121,168,0.15)',  border: '#fd79a8', label: '反応' },
  'jp-rel-repair':      { bg: 'rgba(99,110,114,0.15)',   border: '#636e72', label: '修復' },
  'jp-rel-shift':       { bg: 'rgba(162,155,254,0.15)',  border: '#a29bfe', label: '転換' },
  'jp-rel-return':      { bg: 'rgba(116,185,255,0.15)',  border: '#74b9ff', label: '復帰' },
  'jp-rel-summary':     { bg: 'rgba(46,213,115,0.15)',   border: '#2ed573', label: '要約' },
  'jp-rel-evidence':    { bg: 'rgba(255,234,167,0.15)',  border: '#ffeaa7', label: '根拠' },
  'jp-rel-counter':     { bg: 'rgba(214,48,49,0.15)',    border: '#d63031', label: '反証' },
  'jp-rel-hedge':       { bg: 'rgba(178,190,195,0.15)',  border: '#b2bec3', label: 'ヘッジ' },
  'jp-rel-punchline':   { bg: 'rgba(225,112,85,0.15)',   border: '#e17055', label: 'オチ' },
  'jp-rel-offer':       { bg: 'rgba(85,239,196,0.15)',   border: '#55efc4', label: '申出' },
  'jp-rel-decline':     { bg: 'rgba(214,48,49,0.15)',    border: '#d63031', label: '辞退' },
  'jp-rel-complaint':   { bg: 'rgba(255,107,107,0.15)',  border: '#ff6b6b', label: '不満' },
  // Sidecar bit-relations — distinct palette to make sidecar-authoritative
  // markings visually identifiable next to heuristic ones.
  'jp-rel-bit-locked':  { bg: 'rgba(46,204,113,0.18)',   border: '#27ae60', label: 'LOCK' },
  'jp-rel-bit-td':      { bg: 'rgba(52,152,219,0.15)',   border: '#3498db', label: 'TD' },
  'jp-rel-bit-bu':      { bg: 'rgba(241,196,15,0.15)',   border: '#f1c40f', label: 'BU' },
};

// ══════════════════════════════════════════════════════════════
// STATE FIELD: Stores whether visualization is active
// ══════════════════════════════════════════════════════════════

export const visualizationActive = StateField.define<boolean>({
  create() { return false; },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(toggleVisualization)) return e.value;
    }
    return value;
  },
});

// ══════════════════════════════════════════════════════════════
// DECORATION BUILDER
// ══════════════════════════════════════════════════════════════

function buildDecorations(view: EditorView): DecorationSet {
  const isActive = view.state.field(visualizationActive);
  if (!isActive) return Decoration.none;

  const text = view.state.doc.toString();
  if (!text.trim()) return Decoration.none;

  const filePath = editorContext.getActiveFilePath();
  const resolved: ResolvedRelations = editorContext.resolver(text, { filePath });
  const { relations, sentences, source: relSource } = resolved;
  const sourceTag = relSource === 'sidecar' ? '[sidecar]' : '[heuristic]';
  const sourceClass = relSource === 'sidecar'
    ? 'jp-vis-relation--sidecar'
    : 'jp-vis-relation--heuristic';
  const builder = new RangeSetBuilder<Decoration>();

  // Collect all decorations sorted by start position
  const decos: Array<{ from: number; to: number; deco: Decoration }> = [];

  // Add pattern underlines for each sentence
  for (const sent of sentences) {
    for (const pm of sent.patterns) {
      const from = sent.start + pm.offset;
      const to = from + pm.matchedText.length;
      if (from >= 0 && to <= text.length && from < to) {
        const cat = pm.pattern.category;
        decos.push({
          from, to,
          deco: Decoration.mark({
            class: `jp-vis-pattern jp-vis-cat-${cat}`,
            attributes: {
              'data-pattern-id': pm.pattern.id,
              'data-pattern-gloss': pm.pattern.gloss,
              title: `${pm.pattern.categoryLabel}：${pm.pattern.gloss}\n${pm.pattern.glossEn}`,
            },
          }),
        });
      }
    }
  }

  // Add relation decorations
  for (const rel of relations) {
    const colorInfo = COLOR_MAP[rel.colorClass] ?? { bg: 'rgba(200,200,200,0.15)', border: '#ccc', label: rel.label };
    const tooltip = `${sourceTag} ${rel.label} (${rel.labelEn})\n${rel.source.text.slice(0, 30)}… → ${rel.target.text.slice(0, 30)}…`;

    // Source span
    if (rel.source.start >= 0 && rel.source.end <= text.length && rel.source.start < rel.source.end) {
      decos.push({
        from: rel.source.start,
        to: rel.source.end,
        deco: Decoration.mark({
          class: `jp-vis-relation-source ${sourceClass} ${rel.colorClass}`,
          attributes: { title: `[源] ${tooltip}` },
        }),
      });
    }

    // Target span
    if (rel.target.start >= 0 && rel.target.end <= text.length && rel.target.start < rel.target.end) {
      decos.push({
        from: rel.target.start,
        to: rel.target.end,
        deco: Decoration.mark({
          class: `jp-vis-relation-target ${sourceClass} ${rel.colorClass}`,
          attributes: { title: `[先] ${tooltip}` },
        }),
      });
    }
  }

  // Sort by from position, then by length (longer first for nesting)
  decos.sort((a, b) => a.from - b.from || (b.to - b.from) - (a.to - a.from));

  for (const d of decos) {
    builder.add(d.from, d.to, d.deco);
  }

  return builder.finish();
}

// ══════════════════════════════════════════════════════════════
// VIEW PLUGIN
// ══════════════════════════════════════════════════════════════

export const discourseDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged ||
          update.transactions.some(t => t.effects.some(e => e.is(toggleVisualization)))) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

// ══════════════════════════════════════════════════════════════
// PUBLIC API: Extensions array to register with Obsidian
// ══════════════════════════════════════════════════════════════

/**
 * Get all CM6 extensions needed for discourse visualization.
 * Register with: this.registerEditorExtension(getDiscourseExtensions())
 */
export function getDiscourseExtensions() {
  return [visualizationActive, discourseDecorationPlugin];
}

/**
 * Toggle discourse visualization in the given editor view.
 */
export function toggleDiscourseVisualization(view: EditorView) {
  const current = view.state.field(visualizationActive);
  view.dispatch({ effects: toggleVisualization.of(!current) });
}

/**
 * Get CSS styles for the visualization.
 * These should be appended to the plugin's styles.css.
 */
export function getVisualizationCSS(): string {
  let css = `
/* ── Discourse Visualization: Pattern underlines ── */
.jp-vis-pattern {
  border-bottom: 2px solid currentColor;
  border-radius: 0;
  cursor: help;
}
`;

  // Category colors (A-N)
  const catColors: Record<string, string> = {
    A: '#74b9ff', B: '#a29bfe', C: '#55efc4', D: '#ffeaa7',
    E: '#fd79a8', F: '#6c5ce7', G: '#e17055', H: '#00cec9',
    I: '#dfe6e9', J: '#ff6b6b', K: '#ff9f43', L: '#0984e3',
    M: '#00b894', N: '#fdcb6e',
  };

  for (const [cat, color] of Object.entries(catColors)) {
    css += `.jp-vis-cat-${cat} { border-bottom-color: ${color}; text-decoration-color: ${color}; }\n`;
  }

  css += `
/* ── Discourse Visualization: Relation highlights ── */
.jp-vis-relation-source {
  border-bottom: 2px dashed;
  cursor: help;
}
.jp-vis-relation-target {
  border-bottom: 2px solid;
  cursor: help;
}
`;

  // Relation color classes
  for (const [cls, info] of Object.entries(COLOR_MAP)) {
    css += `.${cls} { background-color: ${info.bg}; border-bottom-color: ${info.border}; }\n`;
  }

  return css;
}
