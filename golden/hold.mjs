/**
 * golden/hold.mjs — the held specimen's laws (PHYSICS Move 1).
 *
 * Law 1: NOTHING IS EVER MID-AIR — chips persist, and an overflowing hold
 *        hands its oldest chip back for the tray, never to the void.
 * Law 3: SCENE RIDES ALONG — a chip is {text, sentence, surface}, and an
 *        identical re-grab refreshes instead of twinning.
 * Plus the two feel functions the dock steers by: chipLabel and isToss.
 *
 * Run:  node golden/hold.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const H = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'hold.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('══ hold / release / newest ══');
{
  let saved = null;
  const s = new H.HoldStore((d) => { saved = d; }, { cap: 3, flickPx: 24 });
  const a = s.hold('外的要因に左右される', 'x', 'その結果は外的要因に左右されるものだ');
  check('chip carries text + surface', a.chip.text === '外的要因に左右される' && a.chip.surface === 'x');
  check('scene rides along', a.chip.sentence === 'その結果は外的要因に左右されるものだ');
  check('nothing evicted below cap', a.evicted === null);
  check('persisted on hold', Array.isArray(saved) && saved.length === 1);
  s.hold('はずで', 'dict');
  const n = s.hold('まずは', 'x');
  check('newest is the last grab', s.newest()?.id === n.chip.id);
  check('release removes exactly one', s.release(n.chip.id)?.text === 'まずは' && s.all().length === 2);
  check('release of a ghost is null', s.release('hold-nope') === null);
}

console.log('══ law 1: overflow is handed to gravity, never dropped ══');
{
  const s = new H.HoldStore(() => {}, { cap: 2, flickPx: 24 });
  const first = s.hold('一つ目', 'x');
  s.hold('二つ目', 'x');
  const third = s.hold('三つ目', 'x');
  check('cap evicts the OLDEST', third.evicted?.id === first.chip.id);
  check('…and the hold still has cap chips', s.all().length === 2);
  check('the evicted chip is intact (the caller trays it)', third.evicted?.text === '一つ目');
}

console.log('══ re-grab refreshes, never twins ══');
{
  const s = new H.HoldStore(() => {}, { cap: 3, flickPx: 24 });
  s.hold('気になる', 'x', '最近ずっと気になるんだよね');
  s.hold('別の', 'dict');
  const again = s.hold('気になる', 'x', '最近ずっと気になるんだよね');
  check('same text+sentence → one chip', s.all().length === 2);
  check('…moved to the top (newest)', s.newest()?.id === again.chip.id);
  check('…and evicts nothing', again.evicted === null);
  // same text, DIFFERENT sentence = a different sighting = its own chip
  s.hold('気になる', 'x', '君のことが気になるって言ってた');
  check('same text, new scene → a second chip', s.all().length === 3);
}

console.log('══ a chip never stores a scene equal to its own text ══');
{
  const s = new H.HoldStore(() => {}, { cap: 3, flickPx: 24 });
  const r = s.hold('そんなこと言われても困る', 'tray', 'そんなこと言われても困る');
  check('sentence === text → no sentence stored', r.chip.sentence === undefined);
}

console.log('══ persistence roundtrip ══');
{
  let saved = null;
  const s = new H.HoldStore((d) => { saved = d; }, { cap: 3, flickPx: 24 });
  s.hold('はず', 'x', '遅くないはず。');
  const s2 = new H.HoldStore(() => {}, { cap: 3, flickPx: 24 });
  s2.load(saved);
  check('chips survive a reload (nothing mid-air)', s2.all().length === 1 && s2.newest()?.text === 'はず');
  s2.load('garbage');
  check('junk data is ignored, chips kept', s2.all().length === 1);
}

console.log('══ the two feel functions ══');
{
  check('chipLabel snips long text', H.chipLabel('やはり向き不向きがあるはずで、まずは', 10) === 'やはり向き不向きがあ…');
  check('chipLabel leaves short text whole', H.chipLabel('まずは') === 'まずは');
  check('a tremor is not a toss', !H.isToss(5, 5, 24));
  check('real travel is a toss', H.isToss(20, 20, 24));
  check('the threshold is the knob', H.isToss(5, 5, 6));
}

console.log('══ 鋳造: mint a twin beside the chip, cap still evicts to gravity ══');
{
  const s = new H.HoldStore(() => {}, { cap: 3, flickPx: 24 });
  const a = s.hold('一つ目', 'x').chip;
  const b = s.hold('二つ目', 'dict').chip;
  const m = s.mint(a.id);
  check('the twin exists with a fresh id', !!m && m.chip.id !== a.id && m.chip.text === a.text);
  const ids = s.all().map((c) => c.id);
  check('the twin seats directly after its sibling', ids.indexOf(m.chip.id) === ids.indexOf(a.id) + 1, ids.join(','));
  check('nothing evicted below cap', m.evicted === null);
  const m2 = s.mint(a.id);
  check('a second mint gets its own id and the cap hands the OLDEST to gravity',
    m2.chip.id !== m.chip.id && m2.evicted !== null && s.all().length === 3);
  check('a ghost id mints nothing', s.mint('hold-nope') === null);
  check('the twin re-grabbed by content still dedupes to the ORIGINAL id',
    s.hold('二つ目', 'dict').chip.id === b.id);
}

console.log(fail ? `\n✗ hold: ${fail} failed (${pass} passed)` : `\n✓ hold: all ${pass} pass`);
process.exit(fail ? 1 : 0);
