/**
 * golden/class-grammar.mjs — pins DESIGN §26.0 rule 4 / §28 S1.
 *
 * The 6-class taxonomy is a VISUAL GRAMMAR, not a data enum: the same color must
 * mean the same thing on every surface, so knowledge transfers with zero
 * relearning. That invariant has drifted twice — the six taxonomy hexes were
 * simultaneously meaning "speaker A", "SRS good", "noun", "conditional", and
 * three different affordances existed for setting a class. This golden makes
 * that drift fail loudly instead of silently.
 *
 *   node golden/class-grammar.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => {
  n++;
  if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg}`);
};

const noteTypes = read('src/notes/note-types.ts');
const grammar = read('src/ui/class-grammar.ts');
const css = read('styles.css');

// ── the six colors, parsed straight out of the taxonomy ──
const COLORS = new Map();
for (const m of noteTypes.matchAll(/id: '([a-z_]+)',[^}]*?color: '(#[0-9a-fA-F]{3,8})'/g)) {
  COLORS.set(m[1], m[2].toLowerCase());
}

console.log('══ the taxonomy is well-formed ══');
ok(COLORS.size === 6, 'six classes carry a color', `(${COLORS.size})`);
ok(new Set(COLORS.values()).size === COLORS.size,
  'every class color is UNIQUE (two classes sharing a hue is unreadable)',
  `(${[...COLORS.values()].join(' ')})`);

// ── RESERVED: no non-taxonomy rule may wear a taxonomy hue ──
console.log('\n══ the identity band is reserved (§26.0 rule 4) ══');
// styles.css is allowed to reference the VARIABLES; it must not re-inline hexes.
const cssNoVars = css.replace(/--jp-cls-[a-z-]+:\s*[^;]+;/g, '');
for (const [cls, hex] of COLORS) {
  const hits = [...cssNoVars.matchAll(new RegExp(hex, 'gi'))].length;
  ok(hits === 0, `styles.css does not re-inline ${cls} (${hex})`, hits ? `(${hits} raw uses)` : '');
}

// ── the same, for every .ts outside the single source ──
console.log('\n══ no view re-inlines a class color (it must go through classColor) ══');
const tsFiles = [
  'src/ui/LibraryView.ts', 'src/ui/LexiconPanel.ts', 'src/ui/CaptureModal.ts',
  'src/ui/ReviewView.ts', 'src/ui/XSearchView.ts', 'src/ui/VoiceSyncRenderer.ts',
  'src/ui/CollocationView.ts', 'src/ui/TrayView.ts', 'src/ui/DiscourseModeView.ts',
];
for (const f of tsFiles) {
  const src = read(f);
  const bad = [...COLORS.values()].filter((hex) => src.toLowerCase().includes(hex));
  ok(bad.length === 0, `${f.split('/').pop()} inlines no class hex`, bad.join(' '));
  ok(!/NOTE_TYPES\[[^\]]+\]\.color/.test(src),
    `${f.split('/').pop()} reads no .color directly (use classColor)`);
}

// ── ONE control for setting a class ──
console.log('\n══ one grammar for setting a note type (§26.0 rules 2+4) ══');
ok(/export function classChips/.test(grammar), 'the shared class control exists');
for (const f of ['src/ui/LibraryView.ts', 'src/ui/LexiconPanel.ts', 'src/ui/CaptureModal.ts']) {
  const src = read(f);
  // a <select> whose options are the six classes = a second grammar + a
  // translation step (you pick from a form field describing the content).
  const classSelect = /createEl\('select'[\s\S]{0,400}?NOTE_CLASSES/.test(src);
  ok(!classSelect, `${f.split('/').pop()} has no class <select>`);
  ok(/classChips\(/.test(src), `${f.split('/').pop()} uses the shared classChips`);
}

// ── the single source of truth actually reaches CSS ──
console.log('\n══ NOTE_TYPES is the single source (§28 S1) ══');
ok(/injectClassGrammar/.test(read('src/main.ts')), 'onload publishes the class grammar');
ok(/--jp-cls-\$\{|--jp-cls-\$/.test(grammar) || /classVar/.test(grammar),
  'the CSS variable name is DERIVED from the taxonomy, not typed twice');
const hardcodedVarBlock = /--jp-cls-(serifu|collocation|kobun|skeletal|discourse|rhet-coll)\s*:/.test(css);
ok(!hardcodedVarBlock,
  'styles.css does not hardcode the --jp-cls-* values (they come from NOTE_TYPES)');

// ── every class has visual presence somewhere ──
console.log('\n══ every class is renderable (a class with no pixels is not a class) ══');
ok(/\.jp-cls-chip\b/.test(css), 'the chip is styled');
ok(/\.jp-cls-railed\b/.test(css), 'the rail is styled');
ok(/\.jp-cls-dot\b/.test(css), 'the dot is styled');
ok(/\.jp-cls-badge\b/.test(css), 'the badge is styled');
ok(/\.jp-cls-dot--suggested|\.jp-cls-badge--suggested/.test(css),
  'suggested-vs-ratified is visually distinct (§28 S3 — machine output never reads as truth)');

console.log(`\n${fail ? '✗' : '✓'} class-grammar: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
