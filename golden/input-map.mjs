/**
 * golden/input-map.mjs — the touchpad reducer.
 *
 * The two checks that matter are the NEGATIVE ones. A precision touchpad emits
 * horizontal noise on every vertical scroll, and one physical flick emits
 * dozens of wheel events. If either leaks through, reading a dictionary starts
 * flipping surfaces at random — strictly worse than having no gesture at all.
 *
 * Run:  node golden/input-map.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const M = await import(pathToFileURL(join(HERE, '..', 'src', 'ui', 'input-map.ts')).href);

let n = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  n++;
  if (cond) console.log(`  ✓ ${name}`);
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

/** Feed a stream of samples; collect every gesture that fired. */
const run = (samples, cfg) => {
  let s = M.idleGesture();
  const out = [];
  for (const e of samples) {
    const r = M.feedWheel(s, { ctrlKey: false, deltaX: 0, deltaY: 0, ...e }, cfg);
    s = r.state;
    if (r.gesture) out.push(r.gesture);
  }
  return { state: s, gestures: out };
};
/** A physical flick: many small events, ~8ms apart. */
const flick = (dx, count = 20, t0 = 1000) =>
  Array.from({ length: count }, (_, i) => ({ deltaX: dx, deltaY: 0, at: t0 + i * 8 }));

console.log('══ the negative checks: what must NOT fire ══');
{
  // Real precision-touchpad scrolling: strong vertical, a few px of sideways
  // wobble on every single event, sustained for a long read.
  const scroll = Array.from({ length: 300 }, (_, i) => ({
    deltaX: (i % 3) - 1,        // -1, 0, 1 … drifts both ways but never zero-sums
    deltaY: 14,
    at: 1000 + i * 8,
  }));
  ok(run(scroll).gestures.length === 0, 'vertical scrolling with sideways drift NEVER swipes');

  // A one-sided drift is the harder case: 300 events × 2px = 600px of travel,
  // five times the swipe threshold, all of it while plainly scrolling.
  const biased = Array.from({ length: 300 }, (_, i) => ({ deltaX: 2, deltaY: 16, at: 1000 + i * 8 }));
  const r = run(biased);
  ok(r.gestures.length === 0, 'even 600px of ONE-SIDED drift under a scroll does not swipe');
  ok(r.state.panX === 0, 'because a vertical-dominant event resets the accumulator', `panX=${r.state.panX}`);

  ok(run(flick(2, 30)).gestures.length === 0,
    'a slow sideways creep below the threshold does nothing');
}

console.log('\n══ one flick, one surface ══');
{
  const r = run(flick(12, 40));               // 480px of travel in one gesture
  ok(r.gestures.length === 1, 'a long flick steps exactly ONCE, not four times', `${r.gestures.length} fired`);
  ok(r.gestures[0].kind === 'surface-step' && r.gestures[0].by === 1, 'swiping content left goes forward');

  const back = run(flick(-12, 40));
  ok(back.gestures[0]?.by === -1, 'and the other way goes back');

  // two flicks separated by a rest = two steps
  const two = run([...flick(12, 20, 1000), ...flick(12, 20, 3000)]);
  ok(two.gestures.length === 2, 'two separate flicks step twice', `${two.gestures.length}`);

  // the latch must release on rest, not on direction change alone
  const noRest = run([...flick(12, 20, 1000), ...flick(12, 20, 1000 + 20 * 8 + 50)]);
  ok(noRest.gestures.length === 1, 'a continuous drag past the threshold is still ONE step');
}

console.log('\n══ pinch → density ══');
{
  const pinch = (dy, count, t0 = 1000) =>
    Array.from({ length: count }, (_, i) => ({ ctrlKey: true, deltaX: 0, deltaY: dy, at: t0 + i * 8 }));
  const out = run(pinch(-10, 20));            // spreading apart → bigger
  ok(out.gestures.length > 0 && out.gestures.every((g) => g.kind === 'density-step' && g.by === 1),
    'spreading steps density UP');
  ok(run(pinch(10, 20)).gestures.every((g) => g.by === -1), 'pinching steps it DOWN');
  ok(out.gestures.length === 3, 'a 200px pinch at 60px/step yields 3 steps, evenly', `${out.gestures.length}`);
  // pinch is deliberately NOT latched — holding it should keep stepping
  ok(run(pinch(-10, 60)).gestures.length === 10, 'holding a pinch keeps stepping (no latch)');

  // and a pinch must not be mistaken for a swipe or vice versa
  ok(run([{ ctrlKey: true, deltaX: 400, deltaY: 0, at: 1000 }]).gestures.length === 0,
    'horizontal travel while ctrl-held is pinch context, never a swipe');
}

console.log('\n══ stepping the bar ══');
{
  ok(M.stepIndex(6, 0, -1) === 0, 'stepping back from the first surface CLAMPS (no wrap-teleport)');
  ok(M.stepIndex(6, 5, 1) === 5, 'and forward from the last');
  ok(M.stepIndex(6, 2, 1) === 3 && M.stepIndex(6, 2, -1) === 1, 'and moves in the middle');
  ok(M.stepIndex(0, 0, 1) === 0, 'an empty bar is safe');
}

console.log('\n══ density levels ══');
{
  ok(M.densityScale(M.DENSITY_DEFAULT) === 1, 'the default is exactly 1× — no silent resize on first run');
  ok(M.clampDensity(-5) === 0 && M.clampDensity(99) === M.DENSITY_SCALES.length - 1, 'levels clamp');
  ok(M.clampDensity(NaN) === 0, 'a corrupt persisted level does not produce NaN scaling');
  ok(M.DENSITY_SCALES.every((v, i, a) => i === 0 || v > a[i - 1]), 'the scale is monotonic');
  ok(/標準/.test(M.densityLabel(M.DENSITY_DEFAULT)) && !/標準/.test(M.densityLabel(0)),
    'only the default is labelled 標準');
}

console.log(`\n${fail ? '✗' : '✓'} input-map: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
