/**
 * golden/note-phrases.mjs — the ingest gate (`extractNotePhrases` /
 * `looksGenerated`).
 *
 * `⚡ 照合` scans a notes file for phrases, and nothing stopped it scanning a
 * file the plugin GENERATED. 11.5% of the shipped catalog was therefore the
 * plugin's own furniture standing as headwords — transcript anchors, YouTube
 * deep links, correction marks, cloze fronts.
 *
 * Every REJECT case below is a real key taken out of the user's data.json, so
 * this suite proves the gate on the exact strings that got through. Every KEEP
 * case is a real catalog entry too: the gate must not be so eager that it eats
 * the noticings it exists to protect.
 *
 * Run:  node golden/note-phrases.mjs
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

console.log('\n══ the plugin\'s own output is not a noticing ══');
// Each of these was a live headword in the shipped catalog.
const REJECT = [
  ['⏱原文:![[Transcripts/ちょいガチ言語学ラジオ「意味論」375(fe5kdBLS8wM).md#^recon-145s3x2]]', 'the transcript anchor'],
  ['⏱ **原文:** ![[Transcripts/x.md#^recon-1uyeb7j]]', 'the anchor before markdown stripping'],
  ['▶YouTube(156:11):https://youtu.be/fe5kdBLS8wM?t=9371', 'the YouTube deep link'],
  ['▶ **YouTube (158:30):** https://youtu.be/x?t=9510', 'the deep link before stripping'],
  ['メモ(raw): それだけ取ったら〜それだけとったら', 'the raw-note echo'],
  ['⚠️ 漢字違い: 「知」→「地」', 'a kanji correction mark'],
  ['⚠ 同音校正: 「以外」→「意外」', 'a homophone correction mark'],
  ['続き: そうですね / はい', 'the discourse card back'],
  ['...思ってそれの成果とかどうなっていくのか【_____】奥をを代表して憶測を喋る...', 'a cloze card front'],
  ['成分: それなもん 〜 かぬちい', 'a payload line'],
  ['@zangiPM「正解を知るより、正解にたどり着く力を磨く」という言葉に、キャリア面談での場面を思い出しました。', 'a pasted tweet body'],
  ['Asheadofthesalessectionheplaysapivotalrole[isinapositionofpivotalimporta', 'OCR English with its spaces eaten'],
  ['世界に広がった由由表見方切りが強に並べっていうの〜ていうだけせべなくて証が動れて想みが飽たね勝手知ってる高に〜ソいなり合わせだったら家のだ「受け止めきてないほ、独り生きるらの新化脚ぐくらい過去万美しない事とやめん…かべるには国まるーーいけないかにちーーながふわーーい.的意味い世界と決させてしてかだっち〜なくてんができない雨底辺と近いが生あるりやさしい相れます術をう男子物語一筋の希望があらや違う〜んでる側がする〜愛したいすい化をつるまいさか強の人生', 'a 343-character ASR run-on'],
];
for (const [line, why] of REJECT) {
  check(why, P.looksGenerated(line) === true, JSON.stringify(line.slice(0, 40)));
}

console.log('\n══ but a real noticing survives it ══');
// Every one of these is a genuine entry from the same catalog.
const KEEP = [
  ['置ったぶんは手掛きたいわたし', 'a plain セリフ'],
  ['文脈を加味できる', 'a short skeletal'],
  ['〜という軸がある', 'a schema with a tilde slot'],
  ['えないしが〜って普遍的じゃなくて', 'a tilde schema with kana tail'],
  ['ですけれども', 'a bare function word'],
  ['抜きで〜ものではないしたらほどなるほど。「○○」っていうことですね。', 'a 34-character skeletal with 「」'],
  ['いやなんかあと僕今〜の話〜い思ったのは〜なんじゃないかなと思って、結局〜〜〜思うんですよその〜たら〜「○」その〜だら〜っていう話って〜。だから、', 'a 136-character note — long, but the user\'s own'],
  ['⚠ これは自分のメモ', 'a warning glyph the USER wrote (no correction keyword)'],
  ['▶ ここから面白い', 'a play glyph the USER wrote (no YouTube link)'],
];
for (const [line, why] of KEEP) {
  check(why, P.looksGenerated(line) === false, JSON.stringify(line.slice(0, 40)));
}

console.log('\n══ extractNotePhrases applies the same gate ══');
{
  const md = [
    '---', 'title: x', '---',
    '# 見出し',
    '- 置ったぶんは手掛きたいわたし',
    '',
    '---',
    '⏱ **原文:** ![[Transcripts/x.md#^recon-1]]',
    '▶ **YouTube (12:34):** https://youtu.be/x?t=754',
    'メモ(raw): ~~あ~~ → **い**',
    '> 引用は対象外',
    '* 文脈を加味できる',
  ].join('\n');
  const got = P.extractNotePhrases(md);
  check('keeps exactly the two real phrases', got.length === 2, JSON.stringify(got));
  check('and they are the right two',
    got[0] === '置ったぶんは手掛きたいわたし' && got[1] === '文脈を加味できる', JSON.stringify(got));
  check('no anchor survived', !got.some((p) => p.includes('原文')), JSON.stringify(got));
  check('no deep link survived', !got.some((p) => p.includes('youtu.be')), JSON.stringify(got));
}

console.log('\n══ the gate is total on empty/whitespace ══');
check('empty is generated', P.looksGenerated('') === true);
check('whitespace is generated', P.looksGenerated('   ') === true);

console.log(`\n${fail === 0 ? '✓' : '✗'} note-phrases: ${pass}/${pass + fail} checks passed`);
if (fail) process.exitCode = 1;
