/**
 * golden/scene.mjs — §22 phase 1: srt parsing, the prose window, strata
 * ordering in the context tree, and the scene passthrough.
 *
 * Run:  node golden/scene.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (p) => import(pathToFileURL(join(HERE, '..', 'src', p)).href);
const SRT = await load('notes/srt.ts');
const CW = await load('notes/context-window.ts');
const CT = await load('lexicon/context-tree.ts');
const PS = await load('notes/pattern-store.ts');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('══ srt → transcript ══');
{
  const srt = `1
00:00:01,000 --> 00:00:03,500
<i>おはよう</i>ございます

2
00:00:03,500 --> 00:00:05,000
{\\an8}今日も始まりましたね

3
00:00:05,000 --> 00:00:06,000
今日も始まりましたね
`;
  const cues = SRT.parseSrt(srt);
  check('cues parsed, tags stripped', cues.length === 2 && cues[0].text === 'おはようございます', JSON.stringify(cues));
  check('rolled-up duplicate dropped', !cues.some((c, i) => i > 0 && c.text === cues[i - 1].text));
  check('timestamps in seconds', cues[0].startSec === 1 && cues[1].startSec === 3);

  const vtt = `WEBVTT

00:00:10.000 --> 00:00:12.000
字幕のテスト`;
  check('WebVTT parses too', SRT.parseSrt(vtt).length === 1 && SRT.parseSrt(vtt)[0].startSec === 10);

  const note = SRT.srtToNote({ srt, title: 'テスト S1E1', sourceName: 'テスト番組' });
  check('note is standard transcript shape', note.content.includes('[00:00:01] おはようございます') && note.content.includes('source: tv') && note.content.includes('show: "テスト番組"'));
  check('cueCount honest', note.cueCount === 2);
}

console.log('══ prose window (book/note medium) ══');
{
  const body = `---
source: book
book_title: "テスト本"
---

# テスト本

最初の段落です。導入の話。

その日、彼はどうしても気になってしまって、眠れなかった。
長い夜だった。

翌朝の段落です。結末の話。`;
  const w = CW.buildProseWindow({ body, att: { quote: '気になってしまって' }, highlightTerms: ['気になる'] });
  check('paragraph located ±1', w.located && w.paras.length === 3 && w.paras[1].isAnchor);
  check('multi-line paragraph joined as flow', w.paras[1].text.includes('長い夜だった'));
  check('inflected highlight in prose', w.paras[1].segments.some((s) => s.hit && s.text.includes('気になって')));
  check('frontmatter/heading never render as paragraphs', !w.paras.some((p) => p.text.startsWith('#') || p.text.includes('book_title')));
  check('unlocatable quote refused', CW.buildProseWindow({ body, att: { quote: '存在しない一文' }, highlightTerms: [] }).located === false);
}

console.log('══ strata: lived before curated, always ══');
{
  const att = (medium, extra = {}) => ({
    source: 'manual', medium, quote: `${medium}の用例ですよ`, addedAt: 1, ...extra,
  });
  const p = {
    id: 'p1', class: 'collocation', classRatified: true, keyKind: 'surface', key: '気になる',
    note: '気になる', payload: {}, createdAt: 1, updatedAt: 1,
    attestations: [
      att('dict', { scene: { sourceName: '研究社新和英大辞典' } }),
      att('book', { scene: { sourceName: 'テスト本' } }),
      att('corpus', { scene: { sourceName: 'TWC' } }),
      { source: 'yt', file: 'T/v.md', tStartSec: 5, quote: 'ずっと気になってた', addedAt: 1 },
    ],
  };
  const tree = CT.buildContextTree(p, []);
  const strata = tree.groups.map((g) => g.leaves[0].stratum);
  check('lived groups precede curated', strata.join(',').indexOf('curated') > strata.lastIndexOf('lived') - 1 && strata[0] === 'lived', strata.join(','));
  check('curated present but after (dict+corpus)', strata.filter((s) => s === 'curated').length === 2);
  check('group labels carry the scene address', tree.groups.some((g) => g.label.includes('研究社')) && tree.groups.some((g) => g.label.includes('📕 テスト本')));
  check('stratumOf falls back to source on legacy', PS.stratumOf({ source: 'yt' }) === 'lived' && PS.stratumOf({ source: 'manual', medium: 'dict' }) === 'curated');
}

console.log('══ §22.5 dictionary example capture ══');
{
  const EX = await load('dictionary/example-capture.ts');
  check('bilingual example line detected', EX.isExampleLine('彼は約束をちゃんと守った。 He kept his promise faithfully.'));
  check('JP sentence extracted from bilingual line', EX.exampleJapanese('彼は約束をちゃんと守った。 He kept his promise faithfully.') === '彼は約束をちゃんと守った。');
  check('English-only line never captures', !EX.isExampleLine('to keep a promise; to be faithful'));
  check('bare headword/gloss line never captures', !EX.isExampleLine('やくそく【約束】'));
  check('short particles-only fragment refused', !EX.isExampleLine('〜を守る'));
  check('sentence without terminal 。 still extracts', EX.exampleJapanese('約束は守るものだ so they say').startsWith('約束は守るもの'));
}

console.log(fail ? `\n✗ scene: ${fail} failed (${pass} passed)` : `\n✓ scene: all ${pass} pass`);
process.exit(fail ? 1 : 0);
