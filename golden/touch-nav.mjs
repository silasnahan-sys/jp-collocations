/**
 * golden/touch-nav.mjs — the edge drag that goes back.
 *
 * The property that matters is not "a swipe fires". It is that READING IS
 * NEVER NAVIGATION. A thumb resting near the left edge of a long dictionary
 * entry, scrolling, must never accumulate into leaving the page — and the
 * failure is silent and infuriating when it happens, because the user did
 * nothing they can name. Every check about `decideAxis` is that one property.
 *
 * Second property: the commit point is a PLACE, not a number. `pullFor` tracks
 * 1:1 and then resists, so the hand feels the latch. That only works if the
 * curve is continuous — a jump at the threshold would read as the affordance
 * glitching rather than as weight.
 *
 * Run:  node golden/touch-nav.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const T = await import(pathToFileURL(join(HERE, '..', 'src', 'ui', 'touch-nav.ts')).href);

let n = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  n++;
  if (cond) console.log(`  ✓ ${name}`);
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};
const near = (a, b, eps = 0.001) => Math.abs(a - b) <= eps;
const C = T.DEFAULT_EDGE;

console.log('══ the gesture starts at the edge, or not at all ══');
{
  ok(T.inEdgeZone(0), 'the very edge counts');
  ok(T.inEdgeZone(C.zone), 'the far side of the zone counts');
  ok(!T.inEdgeZone(C.zone + 1), 'one pixel past does not');
  ok(!T.inEdgeZone(-1), 'and neither does outside the pane');
  // A zone wide enough to find without looking, narrow enough that it is not
  // simply "the left third of every surface".
  ok(C.zone >= 20 && C.zone <= 44, 'the zone is a thumb, not a margin', `${C.zone}px`);
}

console.log('\n══ READING IS NEVER NAVIGATION ══');
{
  // The whole point. Scrolling with a thumb near the edge must abandon, and
  // must abandon PERMANENTLY — not sit undecided waiting to become a nav.
  ok(T.decideAxis(0, 60) === 'abandoned', 'a straight scroll down abandons');
  ok(T.decideAxis(0, -60) === 'abandoned', '…and up');
  ok(T.decideAxis(14, 60) === 'abandoned', 'a scroll with a little drift abandons');
  ok(T.decideAxis(30, 40) === 'abandoned', 'even a diagonal favours the scroll');

  ok(T.decideAxis(40, 5) === 'nav', 'a clean horizontal pull is a navigation');
  ok(T.decideAxis(40, 20) === 'nav', 'and tolerates a real hand not being straight');

  ok(T.decideAxis(0, 0) === 'undecided', 'a press alone decides nothing');
  ok(T.decideAxis(4, 4) === 'undecided', 'nor does a wobble inside the slop');

  // Leftward is not a back gesture — it is the direction that would push the
  // affordance off its own edge, and on a tablet it is how you reach for the
  // Obsidian sidebar.
  ok(T.decideAxis(-60, 5) !== 'nav', 'dragging LEFT never navigates');

  // The ratio has to actually be a ratio: at exactly the boundary it commits,
  // just past it it does not.
  ok(T.decideAxis(C.slop * C.axisRatio, C.slop) === 'nav', 'exactly at the ratio, it locks');
  ok(T.decideAxis(C.slop * C.axisRatio - 4, C.slop + 4) !== 'nav', 'just under it, it does not');
}

console.log('\n══ the commit point is a place you can feel ══');
{
  ok(T.pullFor(0) === 0, 'no pull, no travel');
  ok(near(T.pullFor(40), 40), 'inside the commit distance it tracks the finger exactly');
  ok(near(T.pullFor(C.commitPx), C.commitPx), '…right up to the threshold');

  // Continuity: a jump here would read as the affordance glitching rather than
  // as the drag going heavy.
  const eps = 0.01;
  ok(near(T.pullFor(C.commitPx + eps), T.pullFor(C.commitPx), 0.05),
    'and the curve is CONTINUOUS across it — weight, not a step');

  // Past it: still moves, but always less than the finger. That difference is
  // the entire signal that you have latched.
  const past = 60;
  const p = T.pullFor(C.commitPx + past);
  ok(p > C.commitPx, 'past the threshold it still gives');
  ok(p < C.commitPx + past, '…but always lags the finger now', `${p.toFixed(1)} < ${C.commitPx + past}`);

  // Monotonic and bounded, however hard you pull.
  let mono = true;
  for (let d = 0; d < 900; d += 7) if (T.pullFor(d + 7) < T.pullFor(d)) mono = false;
  ok(mono, 'it never goes backwards as you pull further');
  ok(T.pullFor(1e6) < C.commitPx * 3.5, 'and cannot be dragged into the next county',
    `${T.pullFor(1e6).toFixed(0)}px`);
  ok(Number.isFinite(T.pullFor(1e9)), 'no NaN at any distance');
}

console.log('\n══ distance or a flick — either is a whole answer ══');
{
  ok(T.commits(C.commitPx, 0), 'a slow drag past the threshold commits');
  ok(!T.commits(C.commitPx - 1, 0), 'and one pixel short of it does not');

  // A flick is a real answer: you should not have to drag the full distance
  // when you have clearly thrown it.
  ok(T.commits(C.commitPx * 0.5, C.commitVx + 50), 'a genuine flick commits early');

  // …but a twitch is not a flick. Fast and tiny is a mis-touch, and treating
  // it as a navigation is how a gesture becomes something you brace against.
  ok(!T.commits(4, 2000), 'a fast twitch is not a flick');
  ok(!T.commits(C.commitPx * (C.flickFloor - 0.1), C.commitVx + 500),
    'speed cannot rescue a drag that barely moved');

  // Slow and short: the ordinary abandon. Put it back and nothing happened.
  ok(!T.commits(30, 40), 'a short slow pull is a refusal, and refusing is free');
  ok(!T.commits(-80, -900), 'a leftward drag can never commit');
}

console.log('\n══ the config is coherent ══');
{
  // These four constants have to agree with each other or the gesture has dead
  // zones: a commit distance shorter than the slop would fire before the axis
  // was even decided.
  ok(C.commitPx > C.slop * C.axisRatio,
    'you cannot commit before the axis has been decided',
    `commit=${C.commitPx} lock≈${C.slop * C.axisRatio}`);
  ok(C.commitPx * C.flickFloor > C.slop,
    'and a flick still has to travel further than the slop',
    `${(C.commitPx * C.flickFloor).toFixed(0)} > ${C.slop}`);
  ok(C.flickFloor > 0 && C.flickFloor < 1, 'the flick floor is a fraction of the commit');
  ok(C.axisRatio > 1, 'horizontal has to actually beat vertical, not merely tie');
}

console.log(fail ? `\n✗ ${fail}/${n} checks failed` : `\n✓ all ${n} checks pass`);
process.exit(fail ? 1 : 0);
