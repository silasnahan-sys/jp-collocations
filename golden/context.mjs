/**
 * golden/context.mjs — the ContextWindow locator/highlighter (DESIGN §20.2).
 *
 * Accuracy contract under test:
 *  - anchor found by quote first, timestamp proximity second; distant
 *    timestamps REFUSED (located:false beats a wrong window)
 *  - ratified 談話モード turns/speakers used when present; without a seg no
 *    speaker is ever invented
 *  - highlight is deinflect-validated (気になって lights for 気になる;
 *    本気になって does NOT)
 *
 * Run:  node golden/context.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const C = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'context-window.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const lines = (...rows) => rows.map(([t, text], index) => ({ index, tStartSec: t, text }));
const hitText = (turn) => turn.segments.filter((s) => s.hit).map((s) => s.text).join('|');

const TRANSCRIPT = lines(
  [0, 'こんにちは皆さん'],
  [5, '今日は面白い話があってさ'],
  [10, 'その話がずっと気になってたんだよ'],
  [15, 'えー本当に？'],
  [20, 'うん、だから調べてみたわけ'],
  [25, 'なるほどね'],
);

console.log('══ locateAnchorLine ══');
{
  check('quote match wins', C.locateAnchorLine(TRANSCRIPT, { tStartSec: 10, quote: '気になってた' }) === 2);
  check('quote match without timestamp', C.locateAnchorLine(TRANSCRIPT, { tStartSec: null, quote: '調べてみた' }) === 4);
  check('duplicate quote → timestamp disambiguates', (() => {
    const dup = lines([0, '気になる話'], [30, '気になる話']);
    return C.locateAnchorLine(dup, { tStartSec: 29, quote: '気になる話' }) === 1;
  })());
  check('quote straddling two caption lines', (() => {
    const split = lines([0, 'それがどうしても気に'], [3, 'なってしまって困る']);
    return C.locateAnchorLine(split, { tStartSec: 0, quote: '気になってしまって' }) === 0;
  })());
  check('no quote match, near timestamp → nearest line', C.locateAnchorLine(TRANSCRIPT, { tStartSec: 21, quote: '存在しない引用' }) === 4);
  check('no quote match, DISTANT timestamp → refused', C.locateAnchorLine(TRANSCRIPT, { tStartSec: 500, quote: '存在しない引用' }) === -1);
}

console.log('══ buildContextWindow: line mode (no seg) ══');
{
  const w = C.buildContextWindow({
    lines: TRANSCRIPT,
    att: { tStartSec: 10, quote: '気になってた' },
    highlightTerms: ['気になる'],
    radius: 2,
  });
  check('located with ±2 lines', w.located && w.turns.length === 5);
  check('anchor flagged, at center', w.turns[2].isAnchor && w.turns.filter((t) => t.isAnchor).length === 1);
  check('no speakers invented without a seg', w.turns.every((t) => t.speaker === undefined));
  // §23.4-3: diarized letters on the lines are HEARD truth, not invention —
  // they ride into the window even with no ratified seg
  const diar = C.buildContextWindow({
    lines: TRANSCRIPT.map((l, i) => ({ ...l, speaker: i % 2 ? 'B' : 'A' })),
    att: { tStartSec: 10, quote: '気になってた' },
    highlightTerms: ['気になる'],
    radius: 1,
  });
  check('diarized line speakers carry through without a seg',
    diar.located && diar.turns.every((t) => t.speaker === 'A' || t.speaker === 'B'));
  check('inflected hit highlighted (気になってた for 気になる)', hitText(w.turns[2]).includes('気になってた'), hitText(w.turns[2]));
  check('context turns carry no highlight', hitText(w.turns[0]) === '' && hitText(w.turns[4]) === '');
  check('window clamps at transcript start', C.buildContextWindow({
    lines: TRANSCRIPT, att: { tStartSec: 0, quote: 'こんにちは' }, highlightTerms: [], radius: 2,
  }).turns.length === 3);
}

console.log('══ buildContextWindow: ratified seg mode ══');
{
  const seg = { turns: [
    { start: 0, speaker: 'A' },   // lines 0-1
    { start: 2, speaker: 'B' },   // line 2 (anchor)
    { start: 3, speaker: 'A' },   // line 3
    { start: 4, speaker: 'B' },   // lines 4-5
  ] };
  const w = C.buildContextWindow({
    lines: TRANSCRIPT,
    att: { tStartSec: 10, quote: '気になってた' },
    seg,
    highlightTerms: ['気になる'],
    radius: 1,
  });
  check('turn-based window (±1 turn)', w.located && w.turns.length === 3);
  check('ratified speakers carried', w.turns.map((t) => t.speaker).join('') === 'ABA');
  check('anchor turn is the seg turn', w.turns[1].isAnchor && hitText(w.turns[1]).includes('気になってた'));
  check('multi-line turn joined', (() => {
    const w2 = C.buildContextWindow({
      lines: TRANSCRIPT, att: { tStartSec: 20, quote: '調べてみた' }, seg, highlightTerms: [], radius: 0,
    });
    return w2.turns.length === 1 && w2.turns[0].segments.map((s) => s.text).join('').includes('なるほどね');
  })());
}

console.log('══ highlightSegments: accuracy ══');
{
  const segs = C.highlightSegments('あいつ、ついに本気になってきたな', ['気になる']);
  check('compound-guard holds in highlighting (本気になって NOT lit)', segs.every((s) => !s.hit), JSON.stringify(segs));
  const multi = C.highlightSegments('気になるけど気にならない', ['気になる']);
  check('multiple occurrences all lit', multi.filter((s) => s.hit).length === 2, JSON.stringify(multi));
  const round = C.highlightSegments('その話がずっと気になってたんだ', ['気になる']);
  check('segments reassemble the exact original text', round.map((s) => s.text).join('') === 'その話がずっと気になってたんだ');
  check('short/empty terms never highlight', C.highlightSegments('あれだよ', ['あ', '']).every((s) => !s.hit));
}

console.log(fail ? `\n✗ context: ${fail} failed (${pass} passed)` : `\n✓ context: all ${pass} pass`);
process.exit(fail ? 1 : 0);
