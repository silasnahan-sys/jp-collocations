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

console.log('══ rung 1 — relevance is a FUNCTION OF CLASS ══');
{
  const t = (id, text) => ({ id, text });

  // 🟡 セリフ: only a verbatim echo is a strong hit.
  const serifu = { cls: 'serifu', key: 'こんな人間になる予定ではなかった' };
  const sr = R.rankByClass([
    t('a', '前半だけ こんな人間に なるとはね'),
    t('b', '正直、こんな人間になる予定ではなかったよ'),
  ], serifu);
  ok(sr[0].item.id === 'b', 'verbatim echo outranks shared material', sr[0].item.id);
  ok(sr[0].why.includes('逐語'), 'and says why', sr[0].why);

  // 🔵 連語: adjacency IS the claim.
  const colloc = { cls: 'collocation', key: '風が吹く', payload: { parts: ['風', '吹く'] } };
  const cr = R.rankByClass([
    t('far', '風はやんだが、夕方になってようやく涼しい風が街路樹の間を吹く'),
    t('near', '強い風が吹くらしい'),
  ], colloc);
  ok(cr[0].item.id === 'near', 'tight components outrank scattered ones', cr[0].item.id);

  // 🟢 修辞連語: the halo is the hit; the bare lemma is the WEAK case —
  // which is exactly backwards from how substring search treats it.
  const rhet = { cls: 'rhet_collocation', key: '程々に', payload: { lemma: '程々に', halo: '程々にという感じ' } };
  const rr = R.rankByClass([
    t('bare', '程々に。'),
    t('halo', 'まあ程々にという感じでやってます'),
  ], rhet);
  ok(rr[0].item.id === 'halo', 'halo context outranks a bare lemma', rr[0].item.id);
  ok(rr[1].why.includes('喚起は未確認'), 'and the bare lemma states its own weakness', rr[1].why);

  // 🟠 骨格構文: parts in ORDER, with the intervener profile reported.
  const skel = { cls: 'skeletal', key: 'はず〜まずは', payload: { parts: ['はず', 'まずは'] } };
  const kr = R.rankByClass([
    t('rev', 'まずは確認、そのはずです'),
    t('tight', '遅くないはず。まずは今月中に'),
  ], skel);
  ok(kr[0].item.id === 'tight', 'ordered anchors outrank reversed ones', kr[0].item.id);
  ok(kr[0].why.includes('介在'), 'the intervener count is REPORTED, not hidden', kr[0].why);
  ok(kr.find((x) => x.item.id === 'rev').score === 0, 'wrong order scores zero');

  // 💠 慣用構文: the fixed material is the criterion; the filler is the finding.
  const frame = { cls: 'phrase_schema', key: '表面に○○', payload: { frame: '表面に○○' } };
  const fr = R.rankByClass([
    t('yes', '表面に何も帯びていない'),
    t('no', '裏面については触れない'),
  ], frame);
  ok(fr[0].item.id === 'yes' && fr[0].score >= 9, 'the frame matches on its fixed part');
  ok(fr[1].score === 0, 'and a text without it scores zero');

  // 🔴 談話: position is the only witness an isolated post can offer.
  const disc = { cls: 'discourse', key: 'というか' };
  const dr = R.rankByClass([
    t('mid', 'それはそうなんだけど、というか話が逸れた'),
    t('head', 'というか、そもそも前提が違う'),
  ], disc);
  ok(dr[0].item.id === 'head', 'utterance-initial outranks mid-clause', dr[0].item.id);
  ok(dr[1].why.includes('未確認'), 'and the weak case admits it', dr[1].why);

  // THE headline property: one candidate set, two classes, two orders.
  const shared = [t('lemmaOnly', '程々に。'), t('withHalo', '程々にという感じ')];
  const asRhet = R.rankByClass(shared, rhet)[0].item.id;
  const asSerifu = R.rankByClass(shared, { cls: 'serifu', key: '程々に。' })[0].item.id;
  ok(asRhet === 'withHalo' && asSerifu === 'lemmaOnly',
    'the SAME hits rank differently for different classes', asRhet + ' vs ' + asSerifu);

  // Recency/likes may only break ties between linguistically equal hits.
  const eq = [t('older', 'まずは確認'), t('newer', 'まずは確認')];
  const byTie = R.rankByClass(eq, { cls: 'serifu', key: 'まずは確認' },
    (a, b) => (b.id === 'newer' ? 1 : 0) - (a.id === 'newer' ? 1 : 0));
  ok(byTie[0].item.id === 'newer', 'a tiebreak decides only equal scores', byTie[0].item.id);
  ok(byTie[0].score === byTie[1].score, 'and the scores really were equal');
}

console.log(`\n${fail ? '✗' : '✓'} x-relevance: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
