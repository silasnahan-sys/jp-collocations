/**
 * golden/x-probe.mjs — §29 rung 3: the descent ladder and the six verdicts.
 *
 * The measured facts these fixtures encode (live corpus, 2026-08-25):
 *   僕は印象として持っている = 0    印象として持っている = 0
 *   印象として = 1 (1 doc, 1 voice)  印象 = 70 occ / 47 docs / 46 voices
 *   アウトプット = 30 / 12 / 10      がっつり = 1 / 1 / 1      ゆる勉 = 0
 *
 * The property under test is not "does it find things" — it is that SILENCE is
 * labelled by kind, and that the ladder names which piece of the question the
 * corpus could not carry.
 *
 * Run:  node golden/x-probe.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (p) => pathToFileURL(join(HERE, '..', 'src', p)).href;
const P = await import(src('x/probe.ts'));
const T = await import(src('notes/token-canvas.ts'));

let n = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  n++;
  if (cond) console.log(`  ✓ ${name}`);
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

/** A corpus stand-in: anything not named is genuinely absent. */
const counterOf = (map) => (span) => map[span] ?? { occ: 0, docs: 0, authors: 0 };
const c = (occ, docs, authors) => ({ occ, docs, authors });

const SHELF = new Set(['僕', '印象', 'として', '持っている', 'アウトプット', '本題', '漢字']);
const isWord = (s) => SHELF.has(s);

console.log('══ the core is content, not length ══');
{
  ok(P.coreOf(['僕は', '印象', 'として', '持っている']) === '印象',
    'kanji DENSITY picks the core, not the longest token', P.coreOf(['僕は', '印象', 'として', '持っている']));
  ok(P.coreOf(['ゆる', '勉']) === '勉', 'a one-kanji token beats a two-kana one');
}

console.log('══ Fixture A — the ladder names the over-specification ══');
{
  const probe = '僕は印象として持っている';
  const pieces = T.tokenizeForCanvas(probe, isWord).map((t) => t.text);
  ok(pieces.join('|') === '僕は|印象|として|持っている',
    'the probe segments on the dictionary the plugin already has', pieces.join('|'));

  const count = counterOf({
    '印象として': c(1, 1, 1),
    '印象': c(70, 47, 46),
  });
  const r = P.descend(probe, pieces, count, { isWord });

  ok(r.rungs.length === 4, 'four rungs', String(r.rungs.length));
  ok(r.rungs.map((x) => x.span).join(' → ') ===
    '僕は印象として持っている → 印象として持っている → 印象として → 印象',
    'the descent walks the measured ladder', r.rungs.map((x) => x.span).join(' → '));

  ok(r.rungs[1].dropped.side === 'left' && r.rungs[1].dropped.text === '僕は',
    'a tie drops the LEFT anchor first — the usual over-specification',
    JSON.stringify(r.rungs[1].dropped));
  ok(r.rungs[2].dropped.side === 'right' && r.rungs[2].dropped.text === '持っている',
    'then the tail, because the core may not be dropped',
    JSON.stringify(r.rungs[2].dropped));

  ok(r.verdict === '沈黙・有意', 'silence HERE, attested SHORTER', r.verdict);
  ok(r.nearest.span === '印象として' && r.nearest.count.occ === 1,
    'nearest = the SMALLEST edit the corpus can answer', r.nearest.span);
  ok(r.surviving.span === '印象' && r.surviving.count.occ === 70,
    'surviving = where the distribution actually lives', r.surviving.span);
  ok(r.why.includes('僕は') && r.why.includes('持っている'),
    'the why NAMES what had to go', r.why);
  ok(r.why.includes('70'), 'and reports the deeper rung too, never instead', r.why);
}

console.log('══ attested: 顕在 / 偏在 / 競合 ══');
{
  const spread = P.descend('アウトプット', ['アウトプット'], counterOf({ 'アウトプット': c(30, 12, 10) }), { isWord });
  ok(spread.verdict === '顕在', 'attested and spread across voices', spread.verdict);
  ok(spread.why.includes('30') && spread.why.includes('10'), 'with the numbers stated', spread.why);

  const one = P.descend('がっつり', ['がっつり'], counterOf({ 'がっつり': c(1, 1, 1) }), { isWord });
  ok(one.verdict === '偏在', 'one voice, one document → 偏在, not 顕在', one.verdict);
  ok(one.why.includes('一般性は未確認'), 'and it refuses to generalise from one', one.why);

  const rivalled = P.descend('印象として', ['印象として'], counterOf({ '印象として': c(1, 1, 1) }), {
    isWord,
    variants: [{ span: '印象では', count: c(12, 9, 8) }],
  });
  ok(rivalled.verdict === '競合', 'a rival 3× more common takes precedence', rivalled.verdict);
  ok(rivalled.why.includes('印象では') && rivalled.why.includes('12'),
    'and the rival is NAMED with its count', rivalled.why);

  const noRival = P.descend('印象として', ['印象として'], counterOf({ '印象として': c(1, 1, 1) }), { isWord });
  ok(noRival.verdict !== '競合',
    '競合 cannot fire on rivals the machine was never shown', noRival.verdict);
}

console.log('══ silent all the way down: 沈黙・無力 vs 圏外 ══');
{
  // real words the corpus simply never held
  const powerless = P.descend('印象として', ['印象', 'として'], counterOf({}), { isWord, floorLen: 3 });
  ok(powerless.verdict === '沈黙・無力', 'real words, absent corpus → 沈黙・無力', powerless.verdict);
  ok(powerless.stoppedBy === '逸', 'stopped because the next drop was the core', powerless.stoppedBy);

  // an invented label: not a word anywhere
  const outside = P.descend('ゆる勉', ['ゆる', '勉'], counterOf({}), { isWord });
  ok(outside.verdict === '圏外', 'not even words → 圏外', outside.verdict);
  ok(outside.nearest === null && outside.surviving === null, 'and nothing survived');
}

console.log('══ the three stop rules each fire, and say so ══');
{
  // 平 — attested, then a drop that buys nothing
  const plateau = P.descend('前本題です', ['前', '本題', 'です'],
    counterOf({ '前本題です': c(5, 3, 3), '本題です': c(6, 4, 4) }), { isWord });
  ok(plateau.stoppedBy === '平', 'a drop that does not multiply the count stops the descent', plateau.stoppedBy);
  ok(plateau.rungs.length === 1, 'and the unprofitable rung is not recorded', String(plateau.rungs.length));
  ok(plateau.verdict === '顕在', 'the probe itself was attested and spread', plateau.verdict);

  // 床 — both ends would fall below the floor, and the core is not at an end
  const floor = P.descend('あ漢字い', ['あ', '漢字', 'い'], counterOf({}), { isWord, floorLen: 5 });
  ok(floor.stoppedBy === '床', 'too short to keep asking', floor.stoppedBy);

  // 逸 — the only legal drop would remove the core
  const drift = P.descend('印象として', ['印象', 'として'], counterOf({}), { isWord, floorLen: 3 });
  ok(drift.stoppedBy === '逸', 'the descent refuses to drift off its own subject', drift.stoppedBy);
}

console.log('══ the line the view prints ══');
{
  const r = P.descend('ゆる勉', ['ゆる', '勉'], counterOf({}), { isWord });
  ok(P.verdictLine(r).startsWith('圏外 — '), 'verdict then reason, never a bare label', P.verdictLine(r));
  ok(P.verdictLine(r).length > 10, 'and the reason is a sentence, not a shrug');
}

console.log(`\n${fail ? '✗' : '✓'} x-probe: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
