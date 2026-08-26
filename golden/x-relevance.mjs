/**
 * golden/x-relevance.mjs — §29 rung 0, Fixture A: the word-boundary test.
 *
 * The measured fact this pins (live corpus, 2026-08-25): 足して occurs 23 times
 * and all 23 are false friends — 満足して×15, 不足して×7, 補足して×1, zero 足す.
 * The old view ranked all 23 by recency and called them results.
 *
 * The deinflector is the REAL one (it is pure); only the shelf is stubbed, per
 * the offline-oracle convention in §29.4.
 *
 * Run:  node golden/x-relevance.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (p) => pathToFileURL(join(HERE, '..', 'src', p)).href;
const R = await import(src('x/relevance.ts'));
const D = await import(src('dictionary/deinflect.ts'));

let n = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  n++;
  if (cond) console.log(`  ✓ ${name}`);
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

// The shelf, as a closed set: exactly the words these fixtures need it to know.
const SHELF = new Set([
  '足す', '満足する', '不足する', '補足する', '水', 'スープ',
  '印象', '第一印象', '言う',
]);
const oracle = { deinflect: (s) => D.deinflect(s), isWord: (s) => SHELF.has(s) };

console.log('══ Fixture A — 足して is 23/23 false friends ══');
{
  // the three measured environments, verbatim
  const docs = [
    ['t1', '仕事に満足しています'],
    ['t2', '睡眠が不足していると思う'],
    ['t3', '一つ補足しておきます'],
  ];
  const raw = docs.flatMap(([id, text]) => R.occurrences(id, text, '足して'));
  ok(raw.length === 3, 'the substring really is present in all three', String(raw.length));

  const r = R.trueHits(raw, oracle);
  ok(r.hits.length === 0, 'zero true hits', String(r.hits.length));
  ok(r.partial.length === 3, 'and nothing was dropped — all three are the tail', String(r.partial.length));

  const named = r.partial.map((h) => h.verdict.swallower);
  ok(named.join('|') === '満足する|不足する|補足する', 'each names its own swallower', named.join('|'));
  ok(r.swallowers.length === 3, 'the tail label has three distinct swallowers');
  ok(R.partialLabel(r).startsWith('部分一致 3件'), 'the tail states its count', R.partialLabel(r));
  ok(/満足する×1/.test(R.partialLabel(r)), 'and names words, not just a number', R.partialLabel(r));
}

console.log('══ a real 足す survives the same test ══');
{
  const raw = R.occurrences('t4', 'スープに水を足してみた', '足して');
  const r = R.trueHits(raw, oracle);
  ok(r.hits.length === 1, 'the genuine occurrence is a true hit', String(r.hits.length));
  ok(r.partial.length === 0, 'and is not demoted');
  ok(r.hits[0].verdict.trail.includes('te-form'),
    'it carries the deinflection trail for the 〈…〉 badge', JSON.stringify(r.hits[0].verdict.trail));
}

console.log('══ the tightest swallower wins, and reach is a knob ══');
{
  // 第一印象 covers 印象; the report must name the compound, not something longer.
  const raw = R.occurrences('t5', 'それが第一印象でした', '印象');
  const r = R.trueHits(raw, oracle);
  ok(r.partial.length === 1 && r.partial[0].verdict.swallower === '第一印象',
    'a covering compound is named, not silently dropped',
    JSON.stringify(r.partial.map((h) => h.verdict.swallower)));

  // With no reach there is nothing to extend into, so nothing can be swallowed.
  const none = R.trueHits(raw, oracle, 0);
  ok(none.hits.length === 1 && none.partial.length === 0,
    'reach 0 disables the test entirely — the knob is real');

  // A bare occurrence with nothing around it stays true.
  const bare = R.trueHits(R.occurrences('t6', '印象', '印象'), oracle);
  ok(bare.hits.length === 1, 'an unswallowed occurrence is a true hit');
}

console.log('══ the honest-empty rule ══');
{
  const r = R.trueHits([], oracle);
  ok(r.hits.length === 0 && r.partial.length === 0, 'no hits in, no hits out');
  ok(R.partialLabel(r) === '', 'and no tail label is invented for an empty tail');
}

console.log(`\n${fail ? '✗' : '✓'} x-relevance: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
