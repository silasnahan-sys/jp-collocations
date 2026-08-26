/**
 * golden/x-notation.mjs — the 𝕏 query speaks the catalog's notation.
 *
 * The report: 「x dict doesnt seem to have the word proximity and patternistic
 * matching i asked for」. The rule under test is not "does it find things" —
 * it is that ORDER IS MEANING, that the window is a real bound, that a
 * half-typed mark never silently reinterprets the query, and that the bigram
 * probe never asks the index for a string no tweet can contain.
 *
 * Run:  node golden/x-notation.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const Q = await import(pathToFileURL(join(HERE, '..', 'src', 'x', 'query-notation.ts')).href);

let n = 0, fail = 0;
const check = (name, cond, detail = '') => {
  n++;
  if (cond) console.log(`  ✓ ${name}`);
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('══ a term is read as a pattern, not a string ══');
{
  check('〜 makes an ordered link', Q.parseTerm('はず〜まずは').kind === 'proximity');
  check('and keeps the parts in written order',
    Q.parseTerm('はず〜まずは').parts.join('|') === 'はず|まずは');
  check('every mark in the shared alphabet works',
    ['はず~まずは', 'はず～まずは', 'はず→まずは', 'はず⇒まずは'].every((t) => Q.parseTerm(t).kind === 'proximity'));
  check('○○ makes a frame', Q.parseTerm('○○として持っている').kind === 'frame');
  check('〇 (the other slot glyph) too', Q.parseTerm('〇〇として').kind === 'frame');
  check('plain text stays literal — nothing regresses', Q.parseTerm('以前の').kind === 'literal');

  // A half-typed mark is somebody typing, not a link. The box must not
  // silently reinterpret a query mid-keystroke.
  check('a bare mark is still a literal', Q.parseTerm('〜').kind === 'literal');
  check('a trailing mark is still a literal', Q.parseTerm('はず〜').kind === 'literal');
  check('a leading mark is still a literal', Q.parseTerm('〜まずは').kind === 'literal');
}

console.log('══ ORDER IS MEANING ══');
{
  const t = 'やはり向き不向きがあるはずで、まずは向いているところに行く';
  const fwd = Q.parseTerm('はず〜まずは');
  const rev = Q.parseTerm('まずは〜はず');
  check('the written order matches', Q.termMatches(t, fwd).hit);
  check('the reverse order does NOT — it is a different construction',
    Q.termMatches(t, rev).hit === false);
  // This is the whole difference from the old behaviour: a bag of substrings
  // would have said yes to both.
  check('both parts are present either way (so containment would have lied)',
    t.includes('はず') && t.includes('まずは'));
}

console.log('══ the window is a real bound, and a knob ══');
{
  const near = 'はず。まずは';
  const far = 'はず' + 'あ'.repeat(60) + 'まずは';
  check('a clause-scale pairing matches', Q.termMatches(near, Q.parseTerm('はず〜まずは')).hit);
  check('sixty characters apart does not', Q.termMatches(far, Q.parseTerm('はず〜まずは')).hit === false);
  check('…until the caller widens the window',
    Q.termMatches(far, Q.parseTerm('はず〜まずは', 100)).hit === true);
  check('the default is stated, not hidden', Q.DEFAULT_PROXIMITY === 30);
}

console.log('══ the gap is the 介在 — the material between is the finding ══');
{
  const r = Q.termMatches('印象としてずっと持っている', Q.parseTerm('印象として〜持っている'));
  check('an ordered hit reports its gap', r.hit && r.gap === 3, JSON.stringify(r));
  check('and its span covers the whole construction',
    r.span[0] === 0 && r.span[1] === '印象としてずっと持っている'.length, JSON.stringify(r.span));
  const tight = Q.termMatches('印象として持っている', Q.parseTerm('印象として〜持っている'));
  check('adjacent parts have zero gap', tight.hit && tight.gap === 0);
}

console.log('══ a frame is an ordered walk whose slot IS the gap ══');
{
  const p = Q.parseTerm('○○として持っている');
  check('the fixed material is what walks', p.fixed.join('|') === 'として持っている');
  check('the slot admits real filler', Q.termMatches('強い印象として持っている', p).hit);
  const two = Q.parseTerm('やはり○○はずで○○向いている');
  check('multi-slot frames keep every fixed piece in order',
    two.fixed.join('|') === 'やはり|はずで|向いている');
  check('and match across both slots',
    Q.termMatches('やはり向き不向きがあるはずで、まずは向いているところ', two).hit);
}

console.log('══ the bigram probe must be askable of the index ══');
{
  // Load-bearing: the index is built over tweet text, and はず〜まずは appears
  // in no tweet ever written. Probing with the raw term returns an empty
  // candidate set and every notation query answers 0件 while the matcher works.
  check('the probe is the longest LITERAL piece, never the raw term',
    Q.probeOf(Q.parseTerm('はず〜まずは')) === 'まずは');
  check('a frame probes its longest fixed piece',
    Q.probeOf(Q.parseTerm('○○として持っている')) === 'として持っている');
  check('a literal probes itself', Q.probeOf(Q.parseTerm('以前の')) === '以前の');
  check('the probe never contains a mark',
    !/[〜~～→⇒○〇]/.test(Q.probeOf(Q.parseTerm('はず〜まずは'))));
}

console.log('══ the grammar is taught, not discovered ══');
{
  check('a proximity term explains itself',
    Q.notationHint(Q.parseTerm('はず〜まずは')).includes('この順で'));
  check('and names the window', Q.notationHint(Q.parseTerm('はず〜まずは')).includes('30'));
  check('a frame explains its slot', Q.notationHint(Q.parseTerm('○○として')).includes('任意'));
  check('a literal needs no lesson', Q.notationHint(Q.parseTerm('以前の')) === null);
}

console.log(`\n${fail ? '✗' : '✓'} x-notation: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
