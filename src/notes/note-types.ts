/**
 * note-types.ts — the "Big-5" note taxonomy (DESIGN §7). Data, not code:
 * defining/retyping a note is picking one of these five classes. Each carries a
 * callout keyword (source-of-truth for the class in Markdown), a FINAL color,
 * and a display label. Payload stores per class are a later phase (§7.2); this
 * slice routes a reconciled note to a class and anchors it.
 */

export type NoteClass = 'serifu' | 'collocation' | 'rhet_collocation' | 'rhet_construction' | 'discourse';

export interface NoteTypeDef {
  id: NoteClass;
  label: string;     // Japanese display label
  en: string;        // short English label
  emoji: string;     // color dot
  color: string;     // FINAL color (DESIGN §7)
  callout: string;   // Obsidian callout keyword — class is recovered from this
}

/** Colors are the corrected FINAL set (DESIGN §7): rhet-collocation BLUE, rhet-construction AQUA. */
export const NOTE_TYPES: Record<NoteClass, NoteTypeDef> = {
  serifu:            { id: 'serifu',            label: 'セリフ',   en: 'serifu',       emoji: '🟡', color: '#e0c341', callout: 'serifu' },
  collocation:       { id: 'collocation',       label: '連語',     en: 'collocation',  emoji: '🟢', color: '#5cb85c', callout: 'collocation' },
  rhet_collocation:  { id: 'rhet_collocation',  label: '修辞連語', en: 'rhet-coll',    emoji: '🔵', color: '#4a90d9', callout: 'rhet-coll' },
  rhet_construction: { id: 'rhet_construction', label: '修辞構文', en: 'rhet-constr',  emoji: '🩵', color: '#5bc8d8', callout: 'rhet-constr' },
  discourse:         { id: 'discourse',         label: '談話',     en: 'discourse',    emoji: '🔴', color: '#d9534f', callout: 'discourse' },
};

export const NOTE_CLASSES: NoteClass[] = ['serifu', 'collocation', 'rhet_collocation', 'rhet_construction', 'discourse'];

/** A freshly reconciled phrase is a citation of what was said → serifu until retyped. */
export const DEFAULT_NOTE_CLASS: NoteClass = 'serifu';

/** callout keyword → class (for recovering the class from Markdown). */
export const CALLOUT_TO_CLASS: Record<string, NoteClass> = Object.fromEntries(
  NOTE_CLASSES.map((c) => [NOTE_TYPES[c].callout, c]),
) as Record<string, NoteClass>;
