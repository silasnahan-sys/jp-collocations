/**
 * golden/discovery.mjs — 💡 discovery (§21 core): recurring uncataloged
 * collocations from the user's own exposure. Not a language generator — an
 * exposure counter.
 *
 * Run:  node golden/discovery.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const D = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'discovery.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const src = (file, ...texts) => ({ file, lines: texts.map((text, index) => ({ index, tStartSec: index * 10, text })) });

// 気を遣う recurs across 3 files (mixed inflections); 電話をかける only in one;
// 気になる is already known
const SOURCES = [
  src('T/a.md', '彼はいつも気を遣うタイプだ', 'それが気になるんだよ', '先輩に気を遣って疲れた'),
  src('T/b.md', '気を遣う必要ないって', '電話をかける時間がない', '電話をかけるのを忘れた', '電話をかけると言った'),
  src('T/c.md', 'そんなに気を遣うなよ'),
];

console.log('══ chunkLine: accuracy of the shape itself ══');
{
  check('full kanji noun kept (電話をかける, not 話をかける)', D.chunkLine('電話をかける時間がない').includes('電話をかける'), JSON.stringify(D.chunkLine('電話をかける時間がない')));
  check('inflection canonicalized to lemma (遣って→気を遣う)', D.chunkLine('先輩に気を遣って疲れた').includes('気を遣う'), JSON.stringify(D.chunkLine('先輩に気を遣って疲れた')));
  check('non-verb tail produces nothing (気にタイプ×)', !D.chunkLine('その気にタイプの人').length || !D.chunkLine('その気にタイプの人').some((s) => s.includes('タイプ')));
  check('mid-compound noun rejected (本気を…)', !D.chunkLine('日本気を遣う').some((s) => s === '気を遣う' || s === '本気を遣う') || D.chunkLine('日本気を遣う').length === 0);
  check('suru-noun canonicalized (勉強して→勉強する)', D.chunkLine('毎日勉強している').includes('勉強する'), JSON.stringify(D.chunkLine('毎日勉強している')));
}

console.log('══ recurrence across sources ══');
{
  const out = D.discoverCollocations({ sources: SOURCES, knownKeys: ['気になる'] });
  const kizukau = out.find((d) => d.surface === '気を遣う');
  check('cross-file recurring chunk discovered (canonical form)', !!kizukau, JSON.stringify(out.map((d) => d.surface)));
  check('counts are real (3 files / 4 occurrences incl. inflected)', kizukau && kizukau.files === 3 && kizukau.count === 4, JSON.stringify(kizukau));
  check('single-file chunk excluded by default (minFiles 2)', !out.some((d) => d.surface.includes('電話')));
  check('already-cataloged keys never surface', !out.some((d) => d.surface.includes('気になる')));
  check('example carries provenance (file + t)', kizukau && kizukau.example.file.startsWith('T/') && typeof kizukau.example.tStartSec === 'number');
}

console.log('══ dismissal + ranking ══');
{
  const out = D.discoverCollocations({ sources: SOURCES, knownKeys: [], dismissed: ['気を遣う'] });
  check('dismissed surfaces never re-proposed', !out.some((d) => D && d.surface.includes('気を遣う')));

  const wide = D.discoverCollocations({ sources: SOURCES, knownKeys: [], minFiles: 1, minCount: 3 });
  const kizukau = wide.find((d) => d.surface.includes('気を遣'));
  const denwa = wide.find((d) => d.surface.includes('電話'));
  check('breadth beats raw frequency', kizukau && denwa ? kizukau.score > denwa.score : !!kizukau, JSON.stringify(wide.map((d) => [d.surface, d.score])));
  check('empty sources → empty result', D.discoverCollocations({ sources: [], knownKeys: [] }).length === 0);
}

console.log('══ §27 precision floor: the foundation for ratification ══');
{
  // 1. bare サ変 (説明する) is chunked for spans but NEVER surfaced as a
  //    discovery, however often it recurs — it is a transparent dictionary
  //    word, not a reach-for unit. This is the fix for the 発見-list flood.
  check('bare サ変 IS still chunked (for example spans)', D.chunkLine('丁寧に説明する').includes('説明する'));
  const suru = D.discoverCollocations({
    sources: [src('S/a.md', '丁寧に説明する', 'よく説明する人'), src('S/b.md', '説明する時間', '説明するのが上手'), src('S/c.md', 'また説明する')],
    knownKeys: [],
  });
  check('bare サ変 never surfaces as a discovery', !suru.some((d) => d.surface === '説明する'), JSON.stringify(suru.map((d) => d.surface)));

  // 2. compound particles are not noun+case+verb (人にとって → 人にとう×).
  check('にとって is not mis-parsed (人にとう×)', !D.chunkLine('私たちにとって大事な').some((s) => s.includes('とう')), JSON.stringify(D.chunkLine('私たちにとって大事な')));
  check('について is not mis-parsed', !D.chunkLine('言語について話す').some((s) => s.endsWith('とう') || s.includes('につい')), JSON.stringify(D.chunkLine('言語について話す')));
  check('に対して is not mis-parsed', !D.chunkLine('相手に対して怒る').some((s) => s.includes('に対')), JSON.stringify(D.chunkLine('相手に対して怒る')));

  // 3. pure-kana verb fragments (なう) are ASR debris, not verbs — rejected,
  //    while real kana verbs (かける) still pass.
  check('kana fragment なう rejected (気になう×)', !D.chunkLine('それが気になう').some((s) => s.includes('なう')), JSON.stringify(D.chunkLine('それが気になう')));
  check('real kana verb かける still passes', D.chunkLine('電話をかける').includes('電話をかける'));
  check('known light kana verb なる still passes (気になる)', D.chunkLine('それが気になる').includes('気になる'));

  // 4. association ranking: a single-bond verb (抜く) outranks a light verb
  //    (する) even at equal recurrence, because する pairs with many nouns.
  const rank = D.discoverCollocations({
    sources: [
      src('R/a.md', '手を抜く癖', '話をするだけ', '用意をする', '準備をする'),
      src('R/b.md', '手を抜くなよ', '話をする時間', '用意をする人', '準備をする前'),
    ],
    knownKeys: [], minFiles: 2, minCount: 2,
  });
  const teWoNuku = rank.find((d) => d.surface === '手を抜く');
  const hanashi = rank.find((d) => d.surface === '話をする');
  check('single-bond 手を抜く outranks light-verb 話をする', teWoNuku && hanashi && teWoNuku.score > hanashi.score, JSON.stringify(rank.map((d) => [d.surface, Math.round(d.score * 100) / 100])));
}

console.log('══ §27.x-2 real-transcript regression guards (from the live vault run) ══');
{
  // On REAL ASR transcripts the blind u-row shortcut was the top garbage source
  // (run-on lines, no punctuation): it emitted 話ですねうぬ / いいなう / つけてく as
  // if they were verbs. A kana-only verb must now be a KNOWN kana verb, so
  // clause debris produces nothing.
  check('ASR kana debris rejected (話ですねうぬ×)', D.chunkLine('はいうんいう話ですねうんで').length === 0, JSON.stringify(D.chunkLine('はいうんいう話ですねうんで')));
  check('ASR kana debris rejected (方がいいなう×)', D.chunkLine('方がいいなって思うでしょう').length === 0, JSON.stringify(D.chunkLine('方がいいなって思うでしょう')));
  // deinflect OVERGENERATES (出ました → 出まする/出ましる/出る); with no dictionary
  // to validate, take the SHORTEST real lemma, never the tail-swap fabrication.
  const demasu = D.chunkLine('ラジオの初の書籍が出ました');
  check('deinflect tail-swap avoided (出ました→書籍が出る, not 出まする)', demasu.includes('書籍が出る') && !demasu.some((s) => s.includes('出まする')), JSON.stringify(demasu));
  // real reach-for units still survive the tighter floor.
  check('real kanji-verb chunk preserved (人を助ける)', D.chunkLine('他の人を助ける能力').includes('人を助ける'), JSON.stringify(D.chunkLine('他の人を助ける能力')));
  check('real kanji-verb chunk preserved (絶対に許す)', D.chunkLine('形式的な取り扱いはもう絶対に許さない').includes('絶対に許す'), JSON.stringify(D.chunkLine('形式的な取り扱いはもう絶対に許さない')));
}

console.log(fail ? `\n✗ discovery: ${fail} failed (${pass} passed)` : `\n✓ discovery: all ${pass} pass`);
process.exit(fail ? 1 : 0);
