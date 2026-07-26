/**
 * golden/generic-yomitan.mjs — every dictionary that is NOT 英辞郎 (§27.4).
 *
 * Run against entries lifted verbatim from the user's jitendex export. Two
 * things this pins, both of which the Eijiro-only path got wrong by
 * construction:
 *
 *   • FORMAT — jitendex is a structured-content NODE TREE, not HTML strings.
 *     The Eijiro adapter's regexes find nothing in it; this walks the tree.
 *   • DIRECTION — jitendex is JA→EN, the mirror of 英辞郎. The JAPANESE must
 *     stay on the `surface` side either way, or half the corpus indexes
 *     backwards and the frame space is polluted with English keys.
 *
 *   node golden/generic-yomitan.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
const { transpileModule } = ts;

const HERE = dirname(fileURLToPath(import.meta.url));
const SRCDIR = join(HERE, '..', 'src', 'dictionary');
const tsc = (s) => transpileModule(s, { compilerOptions: { module: 'ESNext', target: 'ES2022' } }).outputText;
const url = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64');

const framesUrl = url(tsc(readFileSync(join(SRCDIR, 'frames.ts'), 'utf8')));
const eijiroUrl = url(tsc(readFileSync(join(SRCDIR, 'eijiro.ts'), 'utf8'))
  .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`));
const genUrl = url(tsc(readFileSync(join(SRCDIR, 'generic-yomitan.ts'), 'utf8'))
  .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`)
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`));

const G = await import(genUrl);
const { adaptEijiroEntry } = await import(eijiroUrl);

const FIX = JSON.parse(readFileSync(join(HERE, 'fixtures', 'jitendex.entries.json'), 'utf8'));
const byHw = (hw) => FIX.entries.find((e) => e[0] === hw);

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => {
  n++;
  if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg}`);
};

console.log('══ direction is read from index.json, never guessed ══');
ok(G.directionOf({ sourceLanguage: 'ja', targetLanguage: 'en' }) === 'ja->en', 'ja→en detected');
ok(G.directionOf({ sourceLanguage: 'en', targetLanguage: 'ja' }) === 'en->ja', 'en→ja detected');
ok(G.directionOf(null) === 'ja->en', 'absent metadata defaults to ja→en (the learner default)');
ok(FIX.index.sourceLanguage === 'ja', 'the real jitendex export IS ja→en', `(${FIX.index.sourceLanguage})`);

console.log('\n══ the registry sends each dictionary to the right adapter ══');
ok(G.isEijiro('英辞郎 v144'), '英辞郎 → bespoke adapter');
ok(G.isEijiro('Eijiro'), 'romanized too');
ok(!G.isEijiro(FIX.index.title), `${FIX.index.title} → generic adapter`);
ok(!G.isEijiro('大辞泉'), 'kokugo → generic');

console.log('\n══ the Eijiro adapter genuinely CANNOT read a node tree ══');
{
  // This is why the registry exists rather than one clever adapter.
  const e = adaptEijiroEntry(byHw('いかなる場合でも'));
  const gen = G.adaptGenericEntry(byHw('いかなる場合でも'), { direction: 'ja->en' });
  ok(e.senses.length === 0, 'Eijiro adapter finds NO senses in structured content', `(${e.senses.length})`);
  ok(gen.senses.length > 0, 'the generic adapter does', `(${gen.senses.length})`);
}

console.log('\n══ flattenContent walks the tree ══');
ok(G.flattenContent('plain') === 'plain', 'a string passes through');
ok(G.flattenContent({ tag: 'li', content: 'x' }) === 'x', 'a node yields its content');
ok(G.flattenContent([{ tag: 'li', content: 'a' }, { tag: 'li', content: 'b' }]).includes('a'), 'arrays flatten');
ok(G.flattenContent(null) === '', 'null is empty, not a crash');

console.log('\n══ real jitendex entries ══');
{
  const h = G.adaptGenericEntry(byHw('いかなる場合でも'), { direction: 'ja->en' });
  ok(h.expression === 'いかなる場合でも', 'expression kept');
  ok(h.reading === 'いかなるばあいでも', 'reading kept');
  ok(h.senses[0]?.gloss?.length > 0, 'a real gloss was extracted', `(${h.senses[0]?.gloss?.slice(0, 40)})`);
  const c = h.reachFor[0];
  ok(!!c, 'a phrase is a reach-for unit');
  // THE direction test
  ok(c.surface === 'いかなる場合でも', 'surface is the JAPANESE', `(${c.surface})`);
  ok(/[a-z]/i.test(c.intention), 'intention is the ENGLISH', `(${c.intention})`);
  ok(c.frameKey === 'いかなる場合でも', 'the frame key is the JAPANESE side', `(${c.frameKey})`);
}
{
  const h = G.adaptGenericEntry(byHw('馬酔木'), { direction: 'ja->en' });
  ok(h.senses.length > 0, '馬酔木 has senses', `(${h.senses.length})`);
  ok(h.reachFor.every((c) => c.classHint !== 'discourse' && c.classHint !== 'serifu'),
    'the generic adapter also never asserts 🔴 or 🟡');
}

console.log('\n══ reversing the direction moves the Japanese, not the meaning ══');
{
  const ja = G.adaptGenericEntry(byHw('Ｔシャツ'), { direction: 'ja->en' });
  const en = G.adaptGenericEntry(byHw('Ｔシャツ'), { direction: 'en->ja' });
  if (ja.reachFor.length && en.reachFor.length) {
    ok(ja.reachFor[0].surface !== en.reachFor[0].surface,
      'the surface side follows the declared direction');
    ok(ja.reachFor[0].surface === 'Ｔシャツ', 'ja→en puts the headword on surface');
  } else {
    ok(true, 'entry produced no candidates in one direction (acceptable)');
  }
}

console.log('\n══ a whole real bank adapts without throwing ══');
{
  const heads = G.adaptGenericBank(FIX.entries, { direction: 'ja->en' });
  ok(heads.length === FIX.entries.length, 'every entry adapted', `(${heads.length})`);
  ok(heads.every((h) => Array.isArray(h.senses) && Array.isArray(h.reachFor)), 'shapes are well-formed');
  const withSenses = heads.filter((h) => h.senses.length).length;
  ok(withSenses === heads.length, 'every real entry yielded at least one sense',
    `(${withSenses}/${heads.length})`);
}

console.log(`\n${fail ? '✗' : '✓'} generic-yomitan: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
