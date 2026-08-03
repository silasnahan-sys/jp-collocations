/**
 * golden/savable.mjs — a save is a typed EDGE, not a tag.
 *
 * Pins the two claims that make this worth having:
 *   • what you can save is DERIVED from what the book asserted, so the menu is
 *     per-dictionary without a line of per-dictionary code;
 *   • 連語 is not one thing — the collocation relations are distinct facts.
 *
 *   node golden/savable.mjs
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
const S = await import(url(tsc(readFileSync(join(SRCDIR, 'savable.ts'), 'utf8'))));

let fail = 0, n = 0;
const ok = (c, m, x = '') => { n++; if (!c) { fail++; console.log(`  ✗ ${m} ${x}`); } else console.log(`  ✓ ${m}`); };

console.log('══ the relation vocabulary is CLOSED and fully specified ══');
{
  ok(S.SAVE_RELATIONS.length === new Set(S.SAVE_RELATIONS).size, 'no duplicate relations');
  const missing = S.SAVE_RELATIONS.filter((r) => !S.RELATION_SPECS[r]);
  ok(missing.length === 0, 'every relation has a spec', missing.join());
  const noHint = S.SAVE_RELATIONS.filter((r) => !S.RELATION_SPECS[r].hint);
  ok(noHint.length === 0, 'and a hint the user can learn it from', noHint.join());
  ok(S.RELATION_SPECS['類語'].binary && S.RELATION_SPECS['対義語'].binary,
    'lexical relations need a second endpoint');
  ok(!S.RELATION_SPECS['実例'].binary, 'evidence relations do not');
}

console.log('\n══ 連語 is not ONE thing ══');
{
  // 〜を待つ / 待っている人 / 待ち受ける / じっと待つ / 雨が降るのを待つ are five
  // different facts about how 待つ combines. One bucket loses the distinction
  // that makes any of them reusable.
  ok(S.COLLOCATION_KINDS.length >= 8, 'the collocation relations are enumerated');
  for (const k of ['格フレーム', '連体修飾', '複合動詞', '補文', '前置詞型']) {
    ok(S.COLLOCATION_KINDS.includes(k), `${k} is its own relation`);
  }
  ok(S.COLLOCATION_KINDS[S.COLLOCATION_KINDS.length - 1] === 'コロケーション',
    'plain co-occurrence is the LAST resort, never the default');
}

console.log('\n══ a surface form says WHICH collocation relation it is ══');
{
  const c = (s, hw) => S.classifyCollocation(s, hw);
  // The particle IS the case frame.
  ok(c('順番を待つ', '待つ') === '格フレーム', '〜を待つ is a case frame');
  ok(c('連絡に待つ', '待つ') === '格フレーム', 'so is 〜に');
  // A clause standing where a noun would.
  ok(c('雨が降るのを待つ', '待つ') === '補文', '雨が降るのを待つ is a COMPLEMENT clause');
  ok(c('返事が来ることを待つ', '待つ') === '補文', 'ことを too');
  // Voice / benefactive is marked after the verb.
  ok(c('待ってくれる', '待つ') !== '格フレーム', '待ってくれ is not a case frame');
  // Two stems, nothing between.
  ok(c('待ち受ける', '待ち') === '複合動詞', '待ち受ける is a compound verb');
  // Manner.
  ok(c('じっと待つ', '待つ') === '副詞修飾', 'じっと待つ is manner modification');
  // English takes its own relation.
  ok(c('wait for the train', 'wait') === '前置詞型', 'wait for is a preposition pattern');
  ok(c('a long wait', 'wait') === 'コロケーション', 'and plain English co-occurrence is not');
  // The floor is honest, not a guess.
  ok(c('なにかべつのもの', '待つ') === 'コロケーション', 'a form that says nothing gets the floor');
  ok(c('', '待つ') === 'コロケーション', 'and so does nothing at all');
}

console.log('\n══ the menu is derived from what the book asserted ══');
{
  // A 語群 IS the synonym claim — the book grouped those words under one meaning.
  const members = S.offeredBy({ text: 'ちょいと', shape: 'members', headword: 'やや' });
  ok(members.includes('類語') && members.includes('使い分け'),
    'a members set offers 類語 and 使い分け');

  // A comparison cell is the publisher judging a word against a FRAME.
  const cell = S.offeredBy({ text: '△', shape: 'comparison', label: '類語対比表' });
  ok(cell.includes('判定') && cell.includes('格フレーム'), 'a comparison cell offers a judgement');

  // Attested corpus evidence is a different claim from an authored example.
  ok(S.offeredBy({ text: '…', shape: 'attestations' }).includes('実例'), 'a citation offers 実例');
  ok(!S.offeredBy({ text: '…', shape: 'attestations' }).includes('用例'),
    'and NOT 用例 — provenance is the whole point');

  // A book that asserts no structure offers only the floor.
  const bare = S.offeredBy({ text: 'なにか' });
  ok(bare.length === 1 && bare[0] === '注意', 'an unstructured selection offers only 注意');

  // Direction matters for a translated pair.
  ok(S.offeredBy({ text: '雨が降るのを待つ', shape: 'examples', en: 'wait for rain' }).includes('対訳'),
    'an example WITH both halves offers 対訳');
  ok(!S.offeredBy({ text: '雨が降るのを待つ', shape: 'examples' }).includes('対訳'),
    'a one-sided example does not');
}

console.log('\n══ a relation the source STATED is not asked about again ══');
{
  // 類語例解 writes `⇔うんと` inside 関連語 — the book saying ちと and うんと are
  // opposites. Throwing that away only to ask the user later discards evidence.
  const a = S.statedRelation('⇔うんと');
  ok(a && a.relation === '対義語' && a.target === 'うんと', '⇔ states an antonym');
  ok(S.statedRelation('⇒や否や')?.relation === '言い換え', '⇒ states a paraphrase/see-also');
  ok(S.statedRelation('ふつうの語') === null, 'an unmarked token states nothing');
}

console.log('\n══ a capture carries its evidence and its provenance ══');
{
  const c = S.buildCapture({
    text: 'ちと', shape: 'members', headword: 'やや',
    dictionary: '使い方の分かる 類語例解辞典', label: '「ちょっと」の古めかしい言い方',
  }, '類語');
  ok(c.subject === 'ちと' && c.object === 'やや', 'a binary relation fills in the headword');
  ok(c.evidence === '「ちょっと」の古めかしい言い方', "the source's own words are kept as evidence");
  ok(c.dictionary === '使い方の分かる 類語例解辞典', 'and who said it');

  const e = S.buildCapture({
    text: '傷は死体からやや離れた場所にあり', shape: 'attestations',
    cite: '『南回帰線(下)』', headword: 'やや',
  }, '実例');
  ok(e.cite === '『南回帰線(下)』', 'an attestation keeps the work it was quoted from');
  ok(!e.object, 'and an unary relation gains no spurious endpoint');
}

console.log(`\n${fail ? '✗' : '✓'} savable: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
