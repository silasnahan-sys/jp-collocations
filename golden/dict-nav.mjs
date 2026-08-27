/**
 * golden/dict-nav.mjs — the 辞書's navigation grammar (§30, コマ送り 7/8/16).
 *
 * Rule 1: TYPING IS ONE LOOKUP — の→のば→のばあ collapses to one history row.
 * Rule 2: A REVISIT IS NOT A DUPLICATE — within the dwell window; across it,
 *         a real re-visit files anew.
 * Rule 3: NEIGHBOURS ARE UNIQUE EXPRESSIONS in reading (gojūon) order —
 *         病人 びょうにん → 病毒 びょうどく → 廟堂 びょうどう, the filmed walk.
 *
 * Run:  node golden/dict-nav.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const N = await import(pathToFileURL(join(HERE, '..', 'src', 'dictionary', 'dict-nav.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const T0 = 1_700_000_000_000; // an arbitrary fixed clock — no Date.now in goldens

console.log('══ history rule 1: typing is one lookup ══');
{
  let rows = [];
  rows = N.recordLookup(rows, 'の', T0);
  rows = N.recordLookup(rows, 'のば', T0 + 400);
  rows = N.recordLookup(rows, 'のばあ', T0 + 900);
  check('three keystrokes, one row', rows.length === 1, `got ${rows.length}`);
  check('the row is the settled query', rows[0].word === 'のばあ');
  rows = N.recordLookup(rows, 'のば', T0 + 1500);
  check('backspacing refines too', rows.length === 1 && rows[0].word === 'のば');
  rows = N.recordLookup(rows, '病人', T0 + 3000);
  check('an unrelated word files under it', rows.length === 2 && rows[0].word === '病人');
  const after = N.recordLookup(rows, '病人食', T0 + N.REFINE_MS + 60_000);
  check('outside the refine window an extension is a NEW row',
    after.length === 3 && after[0].word === '病人食');
}

console.log('══ history rule 2: revisit vs duplicate ══');
{
  let rows = N.recordLookup([], '手', T0);
  const same = N.recordLookup(rows, '手', T0 + 30_000);
  check('same word within the dwell window is the same visit (same array)', same === rows);
  const later = N.recordLookup(rows, '手', T0 + N.DWELL_MS + 1000);
  check('across the window a re-visit files anew', later.length === 2);
  check('empty input never records', N.recordLookup(rows, '  ', T0 + 99) === rows);
}

console.log('══ history cap + day groups ══');
{
  let rows = [];
  for (let i = 0; i < 30; i++) rows = N.recordLookup(rows, `語${i}`, T0 + i * (N.DWELL_MS + 1));
  const capped = N.recordLookup(rows, '溢れ', T0 + 40 * N.DWELL_MS, 10);
  check('the cap holds and newest survives', capped.length === 10 && capped[0].word === '溢れ');

  const DAY = 24 * 60 * 60 * 1000;
  const now = T0 + 10 * DAY;
  const grouped = N.historyDays([
    { word: '今', at: now - 60_000 },
    { word: '昨', at: now - DAY },
    { word: '先', at: now - 3 * DAY },
  ], now);
  check('three days, three groups', grouped.length === 3, `got ${grouped.length}`);
  check('today is 今日', grouped[0].label === '今日', grouped[0].label);
  check('yesterday is 昨日', grouped[1].label === '昨日', grouped[1].label);
  check('older days carry their date', /^\d+月\d+日$/.test(grouped[2].label), grouped[2].label);
}

console.log('══ store: load tolerates junk, record persists ══');
{
  let saved = null;
  const s = new N.DictHistoryStore((d) => { saved = d; return Promise.resolve(); });
  s.load([{ word: '手', at: T0 }, { broken: true }, null, { word: 7, at: 'x' }]);
  check('junk rows are dropped on load', s.rows().length === 1);
  s.record('波', T0 + N.DWELL_MS + 1);
  check('record persists through the closure', Array.isArray(saved) && saved[0].word === '波');
  const before = saved;
  s.record('波', T0 + N.DWELL_MS + 2);
  check('an unchanged record does not re-persist', saved === before);
}

console.log('══ neighbours rule 3: the filmed walk, unique, reading-ordered ══');
{
  const idx = N.buildNeighborIndex([
    { expression: '廟堂', reading: 'びょうどう' },
    { expression: '病人', reading: 'びょうにん' },
    { expression: '病毒', reading: 'びょうどく' },
    { expression: '病人', reading: 'びょうにん' },   // second book, same place
    { expression: '手', reading: 'て' },
  ]);
  check('duplicates collapse to one place', idx.order.length === 4, `got ${idx.order.length}`);
  // The filmed walk (1175 f11670: 病人 → 病毒 → 廟堂) runs BACKWARD through
  // gojūon — びょうどう < びょうどく < びょうにん — so it was the 前 chip,
  // twice. The index must reproduce that exact walk in the prev direction.
  const nb = N.neighborsOf(idx, '病人');
  check('the filmed flip: 病人 ←prev 病毒', nb?.prev?.expression === '病毒', nb?.prev?.expression);
  const nb2 = N.neighborsOf(idx, '病毒');
  check('…and 病毒 ←prev 廟堂', nb2?.prev?.expression === '廟堂', nb2?.prev?.expression);
  check('walking forward agrees', nb2?.next?.expression === '病人');
  const first = N.neighborsOf(idx, idx.order[0].expression);
  const last = N.neighborsOf(idx, idx.order[idx.order.length - 1].expression);
  check('the first page has no prev', first?.prev === null);
  check('the last page has no next', last?.next === null);
}

console.log('══ neighbours: reading entry + kana folding + honest null ══');
{
  const idx = N.buildNeighborIndex([
    { expression: '橋', reading: 'はし' },
    { expression: 'バス', reading: 'バス' },
    { expression: '綿', reading: 'わた' },
    { expression: '端', reading: 'はし' },
  ]);
  const byReading = N.neighborsOf(idx, 'はし');
  check('a reading finds its place', byReading !== null && byReading.here.reading === 'はし');
  // Unfolded, カタカナ (U+30A0+) sorts after EVERY hiragana word — バス would
  // land past わた. Folded to ばす it stands in the は column where it belongs.
  const kata = idx.order.findIndex((h) => h.expression === 'バス');
  const wata = idx.order.findIndex((h) => h.expression === '綿');
  check('katakana folds into the kana column (バス before わた)', kata < wata, `バス at ${kata}, 綿 at ${wata}`);
  check('a word with no place returns null (chips hide)', N.neighborsOf(idx, '存在しない語') === null);
}

console.log('══ the tilde search grammar: one alphabet, three modes ══');
{
  check('〜たなら is Ends', JSON.stringify(N.searchNotation('〜たなら')) === '{"mode":"ends","term":"たなら"}');
  check('all three tildes are one mark', N.searchNotation('~たなら')?.mode === 'ends' && N.searchNotation('～たなら')?.mode === 'ends');
  check('もし〜 is Starts', JSON.stringify(N.searchNotation('もし〜')) === '{"mode":"starts","term":"もし"}');
  check('a bare word is the ordinary walk', N.searchNotation('たなら') === null);
  check('a lone tilde asks nothing', N.searchNotation('〜') === null);
}

console.log('══ the page-turn verdict: carried over the hill, or thrown ══');
{
  const W = 400; // pane width
  check('carried past 28% commits', N.panVerdict(120, 600, W, true) === 'commit');
  check('a slow half-hearted drag snaps back', N.panVerdict(80, 600, W, true) === 'snap');
  check('a quick throw commits from little distance', N.panVerdict(60, 100, W, true) === 'commit');
  check('a fast but tiny twitch does not', N.panVerdict(30, 40, W, true) === 'snap');
  check('no page to turn to always snaps', N.panVerdict(300, 100, W, false) === 'snap');
}

console.log('══ the trail: back AND forward, one spine (行って戻ってまた行く) ══');
{
  const t = new N.Trail();
  const stop = (word, scroll = 0) => ({ word, scroll });
  t.push(stop('爽快', 120));       // at 爽快, descended away
  t.push(stop('痛快'));            // at 痛快, descended away — now at 愉快
  check('two stops behind, none ahead', t.backLength === 2 && t.forwardLength === 0);
  const prev = t.back(stop('愉快', 44));
  check('back returns the previous stop with its scroll', prev.word === '痛快');
  check('the stop you left became the future', t.forwardLength === 1 && t.peekForward().word === '愉快');
  const fwd = t.forward(stop('痛快'));
  check('forward re-descends into that future, restoring it', fwd.word === '愉快' && fwd.scroll === 44);
  check('…and the walk is symmetric (back again possible)', t.backLength === 2 && t.forwardLength === 0);
  t.back(stop('愉快'));
  check('a NEW descend burns the forward stack (you left that future)',
    (t.push(stop('豪快')), t.forwardLength === 0 && t.backLength === 2));
  check('back at the trail head answers null, loses nothing',
    (t.clear(), t.back(stop('孤高')) === null && t.forwardLength === 0));
}

console.log('══ quick nav: the riffle accelerates, then glides ══');
{
  const seq = [0, 1, 2, 3, 4, 5, 6, 12].map((n) => N.riffleDelay(n));
  const monotone = seq.every((v, i) => i === 0 || v <= seq[i - 1]);
  check('each step is at least as quick as the last', monotone, seq.join(','));
  check('the first step is deliberate (readable pages)', N.riffleDelay(0) >= 240);
  check('the glide floors at 90ms, never runaway', N.riffleDelay(99) === 90);
  check('a negative step asks for the deliberate tempo', N.riffleDelay(-1) === N.riffleDelay(0));
  check('the hold gate outlasts a tap', N.RIFFLE_HOLD_MS >= 250);
}

console.log('══ the vertical verdict: same physics, other axis ══');
{
  const H = 600; // pane HEIGHT — panVerdict is axis-agnostic by design
  check('pulled past 28% of the pane height commits', N.panVerdict(180, 700, H, true) === 'commit');
  check('a shy vertical tug snaps back', N.panVerdict(100, 700, H, true) === 'snap');
  check('a vertical throw commits', N.panVerdict(60, 100, H, true) === 'commit');
  check('no neighbour below: always snap (the rubber band already said)', N.panVerdict(500, 100, H, false) === 'snap');
}

console.log(`\n${fail ? '✗' : '✓'} dict-nav: ${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
