/**
 * golden/realformat.mjs — the REAL-WORLD transcript format regression.
 *
 * Vault transcripts copied from browser tools (e.g. 意味論.md) are NOT the
 * plugin's own `[MM:SS] text` shape: stamps are markdown links
 * `[MM:SS](https://youtu.be/<id>?t=N)`, lines can be tab-indented, carry
 * `<mark>` highlights, `~~strikethrough~~`, `[[wikilinks]]`, `&amp;` entities,
 * user `==highlights==`, unstamped continuation lines, and no frontmatter.
 * This suite proves the whole pipeline works on that shape:
 *   parse (clean text, no URLs) → videoId inference → match → anchor
 *   roundtrip (byte-exact, user markup survives) → performance budget.
 *
 * Run:  node golden/realformat.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (p) => import(pathToFileURL(join(HERE, '..', 'src', 'notes', p)).href);
const { parseTranscriptLines, cleanCaptionText, bodyVideoId, reconcile, frontmatterSources, reconcileMultiAsync, splitPatternParts } = await load('pipeline.ts');
const { planAnchors, applyAnchors, stripAnchors, mapParsedToMdLines } = await load('transcript-anchor.ts');

const pristine = readFileSync(join(HERE, '002.realformat.md'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('══ parse (linked stamps, markup, entities) ══');
const lines = parseTranscriptLines(pristine);
check('all 13 stamped lines parsed (unstamped memo dropped)', lines.length === 13, `got ${lines.length}`);
check('no URL leaks into matched text', lines.every((l) => !l.text.includes('http')));
check('no html/markup leaks into matched text', lines.every((l) => !/[<>]|~~|==|\[\[/.test(l.text)));
check('tab-indented line parsed', lines[1]?.text.includes('真理条件の話'));
check('[音楽] cue removed', !lines[0].text.includes('音楽'));
check('mark content kept as speech', lines[3]?.text.includes('世界がどうなっているか'));
check('strikethrough content kept', lines[5]?.text.includes('古い') && lines[5]?.text.includes('新しい'));
check('wikilink alias + entity decoded', lines[6]?.text.includes('教科書') && !lines[6]?.text.includes('&amp;'));
check('H:MM:SS over one hour', lines[12 - 0]?.tStartSec === 3603 || lines.some((l) => l.tStartSec === 3603));
check('mapParsedToMdLines mirrors parse', mapParsedToMdLines(pristine).mdOf.length === lines.length);
check('cleanCaptionText is idempotent', lines.every((l) => cleanCaptionText(l.text) === l.text));

console.log('══ videoId inference (no frontmatter) ══');
check('bodyVideoId finds the id in linked stamps', bodyVideoId(pristine) === 'AbCdEfGhIjK');
check('bodyVideoId null on plain text', bodyVideoId('ただの文章です') === null);

console.log('══ match on the real shape ══');
const phrases = [
  '同じ枠組で処理してるからには同じ結論が出てくる',
  'あくまで道具にしか過ぎない',
  '形式意味論はその新しい枠組で計算します',   // its window reaches the ==/memo lines
];
const results = reconcile(phrases, lines, undefined);
check('correlative phrase located, auto', results[0].status === 'auto' && results[0].best?.tStartSec === 35,
  `status=${results[0].status} t=${results[0].tStartSec} score=${results[0].best?.score?.toFixed(2)}`);
check('second phrase located, auto', results[1].status === 'auto' && results[1].best?.tStartSec === 50,
  `status=${results[1].status} t=${results[1].tStartSec}`);
check('phrase across a ~~strike~~ located', results[2].best?.tStartSec === 25,
  `t=${results[2].tStartSec} score=${results[2].best?.score?.toFixed(2)}`);
check('located text is clean speech', results.every((r) => !/http|[<>]/.test(r.reconciled)));

console.log('══ anchor roundtrip with user markup inside the window ══');
const plan = planAnchors(results, lines);
const annotated = applyAnchors(pristine, plan, () => 'serifu');
check('anchor written', /\^recon-[a-z0-9]+/.test(annotated));
check('matched phrase ==highlighted== on its clean line', /からには同じ結論が出てくる/.test(annotated) && /==[^=\n]*からには[^=\n]*==/.test(annotated));
const markLineQuoted = annotated.split('\n').find((l) => l.includes('<mark'));
check('user <mark> line quoted UNMODIFIED (no == inserted)', !!markLineQuoted && !markLineQuoted.includes('=='));
check("user ==highlight== line travels the verbatim ⋮ escape", annotated.split('\n').some((l) => l.startsWith('> ⋮') && l.includes('==ここは自分でハイライトした行==')));
const stripped = stripAnchors(annotated);
check('stripAnchors(applyAnchors(x)) === x on the REAL format', stripped === pristine,
  stripped === pristine ? '' : `lengths ${stripped.length} vs ${pristine.length}`);
check("user's own ==highlight== survived the roundtrip", stripped.includes('==ここは自分でハイライトした行=='));
const again = applyAnchors(stripAnchors(annotated), plan, () => 'serifu');
check('re-apply idempotent', again === annotated);

console.log('══ multi-source (one page spans several videos) ══');
{
  check('inline single source', JSON.stringify(frontmatterSources('---\nsource: [[A]]\n---\n')) === '["A"]');
  check('inline comma-separated sources', JSON.stringify(frontmatterSources('---\nsource: [[A]], [[B (id1)]]\n---\n')) === '["A","B (id1)"]');
  check('yaml list sources', JSON.stringify(frontmatterSources('---\nsources:\n  - "[[A]]"\n  - [[B]]\n---\n')) === '["A","B"]');
  check('no frontmatter → empty', frontmatterSources('source: [[A]]').length === 0);
  check('Properties-panel quote nesting survives', JSON.stringify(
    frontmatterSources(`---\nsource: ' "[[ちょいガチ言語学ラジオ「意味論」 375 (fe5kdBLS8wM)]]"'\n---\n`))
    === '["ちょいガチ言語学ラジオ「意味論」 375 (fe5kdBLS8wM)"]');

  const srcA = parseTranscriptLines('[00:10] フランス革命に感謝した方がいい\n[00:15] 自由と平等の理念について話します');
  const srcB = parseTranscriptLines('[00:10] まずは判定しましょう合法な転売は\n[00:15] 転売ヤーは悪なのかを考えます');
  const grouped = await reconcileMultiAsync(
    ['フランス革命に感謝', '転売ヤーは悪なのか', '存在しないフレーズXYZ'],
    [srcA, srcB], undefined);
  check('phrase 1 assigned to source A', grouped[0].some((r) => r.note === 'フランス革命に感謝' && r.best));
  check('phrase 2 assigned to source B', grouped[1].some((r) => r.note === '転売ヤーは悪なのか' && r.best));
  check('every phrase lands somewhere (unmatched → needs-review, not lost)',
    grouped[0].length + grouped[1].length === 3);
}

console.log('══ performance budget (real-scale transcript) ══');
// ~3400 lines / >100k normalized chars — the scale of a 3-hour episode.
// This gate exists to catch ALGORITHMIC regressions (an accidental O(n²)),
// not machine-load noise — a warm 4s budget sat exactly at the measured
// runtime and flaked with thermal/background variance (observed 3.9–5.0s
// on the same code). Best-of-two runs (JIT warm) against a 2× headroom
// budget: a real regression still trips it instantly.
const bigBody = Array.from({ length: 260 }, () => pristine).join('\n');
const bigLines = parseTranscriptLines(bigBody);
const PHRASES = ['同じ枠組で処理してるからには同じ結論が出てくる', 'あくまで道具にしか過ぎない', 'というところで納得している'];
let ms = Infinity;
for (let run = 0; run < 2; run++) {
  const t0 = Date.now();
  reconcile(PHRASES, bigLines, undefined);
  ms = Math.min(ms, Date.now() - t0);
}
check(`3 phrases across ${bigLines.length} lines under 8s (best of 2)`, ms < 8000, `${ms}ms`);
console.log(`  (best of 2: ${ms}ms)`);

console.log('══ ambiguity demotion (generic fragments never fake-auto) ══');
{
  // the SAME phrase: unique in the small fixture → auto; repeated 260× in the
  // big body → equally good everywhere → must abstain (needs-review).
  const unique = reconcile(['あくまで道具にしか過ぎない'], lines, undefined)[0];
  const everywhere = reconcile(['あくまで道具にしか過ぎない'], bigLines, undefined)[0];
  check('unique phrase → auto', unique.status === 'auto', unique.status);
  check('same phrase repeated everywhere → needs-review (ambiguous)', everywhere.status === 'needs-review',
    `status=${everywhere.status} best=${everywhere.best?.score?.toFixed(2)}`);
}

console.log('══ gapped correlative patterns (dash notation = one note) ══');
{
  check('〜 splits into parts', JSON.stringify(splitPatternParts('んだったら〜なきゃ')) === '["んだったら","なきゃ"]');
  check('JP interior space splits', JSON.stringify(splitPatternParts('が違えば　と思う一方で')) === '["が違えば","と思う一方で"]');
  check('English notes never space-split', splitPatternParts('a pivotal role').length === 1);
  check('plain JP note stays whole', splitPatternParts('というところで納得している').length === 1);

  // real shape: both parts generic alone, co-occurring ONCE (26:47 case)
  const gl = parseTranscriptLines([
    '[00:10] そこはなきゃで終わる話じゃないんだよね',   // なきゃ BEFORE any んだったら → order forbids
    '[00:20] やるんだったらいろいろ考えるでしょ',       // んだったら with no なきゃ in reach
    ...Array.from({ length: 8 }, (_, i) => `[01:0${i}] 間をつなぐだけの発言が続いていますよ`),
    '[10:00] 逃げるんだったらさ急がなきゃじゃん',        // the ONLY in-order co-occurrence
    '[10:10] そうだよねというわけで次の話題です',
    '[20:00] 見るんだったらどうしようかな',
  ].join('\n'));
  const g = reconcile(['んだったら〜なきゃ'], gl, undefined)[0];
  check('parts pin each other at the co-occurrence line', g.best?.startLine === 10 && g.best?.endLine === 10,
    `got lines ${g.best?.startLine}-${g.best?.endLine} conf=${g.confidence.toFixed(2)}`);
  check('gapped co-occurrence is auto (ambiguity veto lifted)', g.status === 'auto', g.status);
  const lone = reconcile(['なきゃ'], gl, undefined)[0];
  check('the same fragment ALONE stays needs-review', lone.status === 'needs-review');
}

console.log(`\n${fail === 0 ? '✓' : '✗'} realformat: ${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
