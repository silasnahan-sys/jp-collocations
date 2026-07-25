/**
 * golden/frames.mjs — the ONE frame key space (src/dictionary/frames.ts).
 *
 * This pins the join that makes the dictionary part of the plugin instead of a
 * second product: Eijiro's `~`/`__`, the user's hand-drawn 🟠/💠 slots, and a
 * gapped example sentence must all land on the SAME key. If they don't, the
 * same frame silently becomes four entries and reach-for dies.
 *
 *   node golden/frames.mjs
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const { transpileModule } = ts;

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src', 'dictionary', 'frames.ts');
// frames.ts is pure TS with no imports — transpile and import it directly so
// the golden tests the SHIPPED source, not a copy.
const js = transpileModule(readFileSync(SRC, 'utf8'), {
  compilerOptions: { module: 'ESNext', target: 'ES2022' },
}).outputText;
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const {
  normalizeFrame, toFrame, gapFrame, framesOfSentence,
  frameMatches, fillersOf, classHintForFrame, SLOT_ANY, SLOT_NUM,
} = mod;

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => {
  n++;
  if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg}`);
};
const eq = (got, want, msg) => ok(got === want, msg, got === want ? '' : `(got ${JSON.stringify(got)} want ${JSON.stringify(want)})`);

console.log('══ the fold: every slot notation lands on ONE key ══');
eq(normalizeFrame('be ~'), `be ${SLOT_ANY}`, 'Eijiro ASCII ~ folds');
eq(normalizeFrame('be ～'), `be ${SLOT_ANY}`, 'fullwidth ～ folds');
eq(normalizeFrame('be 〜'), `be ${SLOT_ANY}`, 'wave dash 〜 folds');
eq(normalizeFrame('$__ in arrears'), `${SLOT_NUM} in arrears`, 'Eijiro $__ folds to the numeric slot');
eq(normalizeFrame('＿ドルの支払い'), `${SLOT_NUM}ドルの支払い`, 'fullwidth ＿ stays numeric');
eq(normalizeFrame('○○というところで'), `${SLOT_ANY}というところで`, 'the ○○ capture convention folds');
// THE join: the same frame written three ways must be ONE key
{
  const a = normalizeFrame('~が破綻する');
  const b = normalizeFrame('～が破綻する');
  const c = normalizeFrame('○○が破綻する');
  ok(a === b && b === c, 'Eijiro / user / legacy notations collide on one key', `(${a})`);
}

console.log('\n══ display noise is not structure ══');
eq(normalizeFrame('割引[値引き]'), '割引', 'bracketed alternatives dropped');
eq(normalizeFrame('a ～ a ～1人当たり'), `a ${SLOT_ANY}1人当たり`,
  'Eijiro duplicates its label span — the key must not double it');

console.log('\n══ gapFrame: the example-sentence demand ══');
eq(gapFrame('関係が破綻していた', '破綻'), `関係が${SLOT_ANY}していた`,
  'a sentence indexes with its word taken out');
eq(gapFrame('交渉が破綻した', '破綻'), `交渉が${SLOT_ANY}した`, 'a different filler, same shape');
// Gapping the SAME word in two sentences that differ elsewhere must give two
// frames — the varying element is 関係/交渉, and pretending otherwise would
// erase the very distinction a learner is looking at.
{
  const a = gapFrame('関係が破綻する', '破綻');
  const b = gapFrame('交渉が破綻する', '破綻');
  ok(a !== b, 'gapping 破綻 keeps 関係/交渉 literal — two frames, honestly', `(${a} / ${b})`);
}
// The shared frame appears when you gap the element that actually varies.
{
  const a = gapFrame('関係が破綻する', '関係');
  const b = gapFrame('交渉が破綻する', '交渉');
  ok(a === b, 'gapping the varying element gives ONE shared frame', `(${a})`);
}
eq(gapFrame('破綻と破綻', '破綻'), `${SLOT_ANY}と${SLOT_ANY}`, 'every occurrence is gapped, not just the first');
ok(gapFrame('全然関係ない', '破綻') === null,
  'a word not in the sentence yields NO frame (never invent one)');
eq(gapFrame('$5 in arrears', '5', 'num'), `${SLOT_NUM} in arrears`, 'numeric gapping');

console.log('\n══ framesOfSentence ══');
{
  const fs = framesOfSentence('関係が破綻していた', ['破綻', '関係', 'いない']);
  ok(fs.length === 2, 'only words actually present contribute a frame', `(${fs.length})`);
  ok(fs.some((f) => f.frame === `関係が${SLOT_ANY}していた`), 'the 破綻 frame is there');
  ok(fs.some((f) => f.frame === `${SLOT_ANY}が破綻していた`), 'the 関係 frame is there');
}

console.log('\n══ frameMatches / fillersOf — reaching a frame from a heard phrase ══');
ok(frameMatches('～が破綻する', '関係が破綻する'), 'a heard phrase reaches its frame');
ok(frameMatches('～が破綻する', '長年の信頼関係が破綻する'), 'a longer filler still matches');
ok(!frameMatches('～が破綻する', 'が破綻する'), 'an EMPTY filler is not a filler');
ok(!frameMatches('～が破綻する', '関係が成立する'), 'a different frame does not match');
{
  const f = fillersOf('～が破綻する', '関係が破綻する');
  ok(Array.isArray(f) && f[0] === '関係', 'the filler is recoverable (🟠 leaves)', `(${JSON.stringify(f)})`);
}
{
  const f = fillersOf(`${SLOT_NUM} in arrears`, '$500 in arrears');
  ok(Array.isArray(f) && f[0] === '$500', 'numeric filler recoverable', `(${JSON.stringify(f)})`);
}
ok(fillersOf('～が破綻する', '関係が成立する') === null, 'no match → null, never []');

console.log('\n══ fixed surfaces are not frames ══');
{
  const fr = toFrame('どっかのタイミングで');
  ok(fr.fixed === true && fr.slots.length === 0, 'a slotless surface is marked fixed');
  ok(frameMatches('どっかのタイミングで', 'どっかのタイミングで'), 'fixed matches exactly');
  ok(!frameMatches('どっかのタイミングで', 'どっかのタイミングでね'), 'fixed does not match loosely');
}

console.log('\n══ classHint is shape-only, a suggestion, and never 🔴 ══');
eq(classHintForFrame(toFrame('be ～', 'be ～')), 'skeletal', 'declared shape + one slot → 🟠');
eq(classHintForFrame(toFrame('～というところで～')), 'phrase_schema', 'two slots → 💠');
eq(classHintForFrame(toFrame('～のVサイン'), { situation: true }), 'phrase_schema',
  '〔situation〕 + slot → 💠 (the situation IS the condition of use)');
eq(classHintForFrame(toFrame('破綻'), { evocativeHead: true }), 'rhet_collocation', 'evocative head → 🟢');
eq(classHintForFrame(toFrame('猛勉強')), 'collocation', 'short slotless bond → 🔵');
{
  const hints = [
    classHintForFrame(toFrame('be ～', 'be ～')),
    classHintForFrame(toFrame('～と～')),
    classHintForFrame(toFrame('破綻')),
    classHintForFrame(toFrame('善は急げ')),
  ];
  ok(!hints.includes('discourse'),
    'NEVER 🔴 — responsivity is dialogic and cannot be read off a dictionary');
}

console.log(`\n${fail ? '✗' : '✓'} frames: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
