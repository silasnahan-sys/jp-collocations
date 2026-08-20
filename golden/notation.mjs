/**
 * golden/notation.mjs — ONE split alphabet for notation fields.
 *
 * Derive (`splitPatternParts`) and save used to split notation on two
 * different alphabets: derive knew 〜 ~ → ⇒ … but not 、。; save knew
 * 〜 ~ , 、 but not → ⇒. So a headword built with → was understood on the way
 * in and silently glued into ONE part on the way out, and the user's own
 * (。) boundary invention (typed keystroke by keystroke, IMG_1082) was saved
 * as literal part material no corpus text could ever contain.
 *
 * `splitNotationParts` is the one splitter for anything the user writes AS
 * notation; `notationCrossesSentence` reports the (。)/。 boundary fact so the
 * entry records it (payload.crossSentence) instead of eating it.
 *
 * Run:  node golden/notation.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const P = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'pipeline.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('══ every join glyph the user actually writes splits ══');
{
  check('〜 splits', eq(P.splitNotationParts('はず〜まずは'), ['はず', 'まずは']));
  check('→ splits (dropped by the old save alphabet — the filmed loss)',
    eq(P.splitNotationParts('はず→まずは'), ['はず', 'まずは']));
  check('⇒ splits', eq(P.splitNotationParts('はず⇒まずは'), ['はず', 'まずは']));
  check('… splits', eq(P.splitNotationParts('この…も…まで'), ['この', 'も', 'まで']));
  check('、 splits', eq(P.splitNotationParts('はずで、まずは'), ['はずで', 'まずは']));
  check('。 splits (a boundary is a join, not part material)',
    eq(P.splitNotationParts('はず。まずは'), ['はず', 'まずは']));
  check('spaces around a join are eaten', eq(P.splitNotationParts('はず 〜 まずは'), ['はず', 'まずは']));
}

console.log('══ the (。) boundary form: a join that records itself ══');
{
  check('（。） full-width splits clean', eq(P.splitNotationParts('はず（。）〜まずは'), ['はず', 'まずは']));
  check('(。) ASCII-paren splits clean', eq(P.splitNotationParts('はず(。)〜まずは'), ['はず', 'まずは']));
  check('（。） detected as crossing', P.notationCrossesSentence('はず（。）〜まずは'));
  check('(。) detected as crossing', P.notationCrossesSentence('はず(。)〜まずは'));
  check('bare 。 detected as crossing', P.notationCrossesSentence('はず。まずは'));
  check('、 is NOT a sentence crossing', !P.notationCrossesSentence('はずで、まずは'));
  check('plain 〜 is NOT a crossing', !P.notationCrossesSentence('はず〜まずは'));
}

console.log('══ derive and save can no longer disagree on explicit joins ══');
{
  // every notation derive understands, save now understands identically
  // (parity holds where all parts are ≥2 chars — derive's clamp, next check)
  for (const s of ['外的要因に〜左右される', 'はず→まずは', 'んだったら…なきゃ']) {
    check(`parity on ${s}`, eq(P.splitNotationParts(s), P.splitPatternParts(s)),
      `${JSON.stringify(P.splitNotationParts(s))} vs ${JSON.stringify(P.splitPatternParts(s))}`);
  }
  // ONE intentional difference: derive clamps 1-char parts (a guard against
  // shattering free text) — so it stores もし〜が〜たなら as [もし,たなら],
  // silently dropping the が the hand composed (IMG_1067). A notation FIELD
  // keeps every part the user wrote: この…も…まで's も is a real part
  // (XViewDeps' own doc example), and が stays in the filmed formula.
  check('notation keeps 1-char parts (この…も…まで)', eq(P.splitNotationParts('この…も…まで'), ['この', 'も', 'まで']));
  check('notation keeps が in もし〜が〜たなら (derive drops it)',
    eq(P.splitNotationParts('もし〜が〜たなら'), ['もし', 'が', 'たなら']));
  // …while free-text derivation keeps its guard: a comma in a SENTENCE is not
  // a link join (splitPatternParts must not shatter ordinary selections)
  check('free text with 、 stays whole under splitPatternParts',
    eq(P.splitPatternParts('やはり向き不向きがあるはずで、まずは向いている'), ['やはり向き不向きがあるはずで、まずは向いている']));
}

console.log(fail ? `\n✗ notation: ${fail} failed (${pass} passed)` : `\n✓ notation: all ${pass} pass`);
process.exit(fail ? 1 : 0);
