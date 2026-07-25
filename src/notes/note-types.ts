/**
 * note-types.ts — the note taxonomy (DESIGN §7), v2 (2026-07-10). Data, not
 * code: defining/retyping a note is picking one of these six classes. Each
 * carries a callout keyword (source-of-truth for the class in Markdown), a
 * FINAL color, and a display label. Payload stores per class are a later phase
 * (§7.2); this slice routes a reconciled note to a class and anchors it.
 *
 * v2 semantics (processing-based; each class has an operational test):
 *  - serifu        🟡 fixed quotable surface (citation test)
 *  - collocation   🔵 lexical⟷lexical word bond (swap → ungrammatical)
 *  - rhet_collocation 🟢 gesture performed via an EVOCATIVE headword — the
 *                     lemma must hold an inherent impression/image (onomatopoeia
 *                     prototypical; 生々しい/顧みる/破綻); halo shows the image
 *                     being aimed. Bland labels (難点) fail → phrase_schema.
 *  - phrase_schema 💠 holistic phrasal schema, said WHOLE ([X]というところで
 *                     納得している); rearrangement kills it; slots open, frame fixed.
 *  - skeletal      🟠 component-LINK construction (以前⟷ば, どんな⟷ても,
 *                     ても⟷からには — correlatives included); the link survives
 *                     rearrangement; fillers are context, not construction.
 *  - discourse     🔴 responsivity-defined: function requires reference to what
 *                     it is in discourse WITH (speaker/prior turn/commitment).
 * Classes are perspectival projections — the same span may carry entries in
 * more than one class (e.g. 🟢 insight-into-破綻 AND 💠 として破綻している whole).
 */

export type NoteClass = 'serifu' | 'collocation' | 'rhet_collocation' | 'phrase_schema' | 'skeletal' | 'discourse';

export interface NoteTypeDef {
  id: NoteClass;
  label: string;     // Japanese display label
  en: string;        // short English label
  emoji: string;     // color dot
  color: string;     // FINAL color v2 (user, 2026-07-10)
  callout: string;   // Obsidian callout keyword — class is recovered from this
}

/** Colors are the FINAL v2 set: collocation BLUE, rhet-collocation GREEN, skeletal ORANGE, phrase-schema MINT #03FFB1. */
export const NOTE_TYPES: Record<NoteClass, NoteTypeDef> = {
  serifu:           { id: 'serifu',           label: 'セリフ',   en: 'serifu',        emoji: '🟡', color: '#e0c341', callout: 'serifu' },
  collocation:      { id: 'collocation',      label: '連語',     en: 'collocation',   emoji: '🔵', color: '#4a90d9', callout: 'collocation' },
  rhet_collocation: { id: 'rhet_collocation', label: '修辞連語', en: 'rhet-coll',     emoji: '🟢', color: '#5cb85c', callout: 'rhet-coll' },
  phrase_schema:    { id: 'phrase_schema',    label: '慣用構文', en: 'phrase-schema', emoji: '💠', color: '#03ffb1', callout: 'kobun' },
  skeletal:         { id: 'skeletal',         label: '骨格構文', en: 'skeletal',      emoji: '🟠', color: '#f39c12', callout: 'skeletal' },
  discourse:        { id: 'discourse',        label: '談話',     en: 'discourse',     emoji: '🔴', color: '#d9534f', callout: 'discourse' },
};

export const NOTE_CLASSES: NoteClass[] = ['serifu', 'collocation', 'rhet_collocation', 'phrase_schema', 'skeletal', 'discourse'];

/** A freshly reconciled phrase is a citation of what was said → serifu until retyped. */
export const DEFAULT_NOTE_CLASS: NoteClass = 'serifu';

/** callout keyword → class (for recovering the class from Markdown). Includes the pre-v2 keyword. */
export const CALLOUT_TO_CLASS: Record<string, NoteClass> = {
  ...(Object.fromEntries(NOTE_CLASSES.map((c) => [NOTE_TYPES[c].callout, c])) as Record<string, NoteClass>),
  'rhet-constr': 'skeletal',   // legacy (v1 "rhetorical construction") — strip/retype still recognize it
};
