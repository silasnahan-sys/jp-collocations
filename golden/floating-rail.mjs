/**
 * golden/floating-rail.mjs — the movable slate rail.
 *
 * The property that matters is not "it moves". It is that the position SURVIVES
 * A ROTATION. An iPad turns, enters Split View and resizes under Stage Manager,
 * and a rail stored in pixels is off the bottom of the pane the first time any
 * of those happens — so the user moves it, the device changes shape, and the
 * control they placed is gone. Storing a fraction of the free travel is the
 * whole reason this file is pure geometry instead of three lines of inline DOM.
 *
 * Second property: the default is NOT the middle. The rail overlays the reading
 * column, and the middle of a reading column is the line you are reading.
 *
 * Run:  node golden/floating-rail.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const R = await import(pathToFileURL(join(HERE, '..', 'src', 'ui', 'floating-rail.ts')).href);

let n = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  n++;
  if (cond) console.log(`  ✓ ${name}`);
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};
const near = (a, b, eps = 0.001) => Math.abs(a - b) <= eps;

const INSET = 6;
const LANDSCAPE = { width: 1366, height: 1024 };
const PORTRAIT = { width: 1024, height: 1366 };
const RAIL_W = 58, RAIL_H = 300;

console.log('══ the default is out of the reading line ══');
{
  ok(R.DEFAULT_RAIL.y > 0.6,
    'the rail starts LOW, not centred — the middle is where the text is',
    `y=${R.DEFAULT_RAIL.y}`);
  ok(R.DEFAULT_RAIL.collapsed === false, 'it starts open; you have to be able to find it');
  ok(R.DEFAULT_RAIL.edge === 'right', 'right-handed default, matching posture.hand');
}

console.log('\n══ a fraction survives what a pixel does not ══');
{
  const parked = { edge: 'right', y: 0.72, collapsed: false };
  const land = R.railTop(parked, LANDSCAPE, RAIL_H, INSET);
  const port = R.railTop(parked, PORTRAIT, RAIL_H, INSET);

  // The same stored state resolves to different pixels in each shape, and both
  // are INSIDE their own pane. A pixel offset would have kept `land` and put it
  // off-screen in portrait.
  ok(land + RAIL_H <= LANDSCAPE.height, 'lands inside a landscape pane', `${land}+${RAIL_H}`);
  ok(port + RAIL_H <= PORTRAIT.height, 'lands inside a portrait pane', `${port}+${RAIL_H}`);
  ok(port > land, 'a taller pane moves it proportionally down, not to the same pixel');

  // The relation is what is preserved: 72% of the way down the free travel.
  ok(near((land - INSET) / R.railTravel(LANDSCAPE, RAIL_H, INSET), 0.72),
    'the stored fraction is exactly what comes back out');
}

console.log('\n══ release snaps to an edge, never mid-pane ══');
{
  const left = R.snapRail(40, 200, RAIL_W, RAIL_H, LANDSCAPE, INSET);
  ok(left.edge === 'left', 'dropped on the left half docks left');

  const right = R.snapRail(1200, 200, RAIL_W, RAIL_H, LANDSCAPE, INSET);
  ok(right.edge === 'right', 'dropped on the right half docks right');

  // Mid-pane is the case that matters: a rail left floating in the middle
  // covers two columns of text instead of one, so there is no "stay here".
  const middle = R.snapRail(LANDSCAPE.width / 2 - RAIL_W / 2, 200, RAIL_W, RAIL_H, LANDSCAPE, INSET);
  ok(middle.edge === 'left' || middle.edge === 'right', 'dead centre still picks a side');

  // Handedness is a default, not a cage — a right-handed user can park it left
  // and it stays left.
  ok(R.snapRail(10, 10, RAIL_W, RAIL_H, LANDSCAPE, INSET).edge === 'left',
    'a deliberate move beats the handedness default');
}

console.log('\n══ snap → resolve → snap is stable ══');
{
  // A rail that drifts every time the pane re-lays-out is worse than one that
  // cannot move at all, because it moves without being asked.
  let s = { ...R.snapRail(1200, 500, RAIL_W, RAIL_H, LANDSCAPE, INSET), collapsed: false };
  for (let i = 0; i < 5; i++) {
    const top = R.railTop(s, LANDSCAPE, RAIL_H, INSET);
    const again = R.snapRail(1200, top, RAIL_W, RAIL_H, LANDSCAPE, INSET);
    ok(near(again.y, s.y) && again.edge === s.edge,
      `round trip ${i + 1} does not drift`, `${s.y} → ${again.y}`);
    s = { ...s, ...again };
  }
}

console.log('\n══ the drag stops at the wall ══');
{
  // Clamped live rather than on release: dragging past the edge and springing
  // back reads as the app fighting you.
  const far = R.clampDrag(600, 400, 9999, 9999, RAIL_W, RAIL_H, LANDSCAPE, INSET);
  ok(600 + far.dx + RAIL_W <= LANDSCAPE.width, 'cannot be dragged off the right edge');
  ok(400 + far.dy + RAIL_H <= LANDSCAPE.height, 'cannot be dragged off the bottom');

  const back = R.clampDrag(600, 400, -9999, -9999, RAIL_W, RAIL_H, LANDSCAPE, INSET);
  ok(600 + back.dx >= INSET, 'cannot be dragged off the left edge');
  ok(400 + back.dy >= INSET, 'cannot be dragged off the top');

  const free = R.clampDrag(600, 400, 20, -30, RAIL_W, RAIL_H, LANDSCAPE, INSET);
  ok(free.dx === 20 && free.dy === -30, 'a move that stays inside is not touched');
}

console.log('\n══ degenerate panes do not produce NaN ══');
{
  // A rail taller than its pane (a short Split View strip, a collapsed pane).
  // Division by a zero travel is the obvious way to write a silent `NaN` into
  // a persisted setting and never get it back.
  const tiny = { width: 320, height: 120 };
  ok(R.railTravel(tiny, RAIL_H, INSET) === 0, 'no travel when the rail exceeds the pane');

  const top = R.railTop({ edge: 'right', y: 0.72, collapsed: false }, tiny, RAIL_H, INSET);
  ok(Number.isFinite(top), 'top is a real number', String(top));
  ok(top === INSET, 'with nowhere to travel it pins to the top inset');

  const snapped = R.snapRail(0, 40, RAIL_W, RAIL_H, tiny, INSET);
  ok(Number.isFinite(snapped.y) && snapped.y === 0, 'snap yields 0, not NaN', String(snapped.y));

  ok(R.clamp01(-5) === 0 && R.clamp01(5) === 1 && R.clamp01(0.4) === 0.4, 'clamp01 clamps');
  ok(R.railTop({ edge: 'right', y: 99, collapsed: false }, LANDSCAPE, RAIL_H, INSET)
    <= LANDSCAPE.height, 'a corrupt stored fraction cannot push it off-screen');
}

console.log('\n══ tap and drag are different gestures ══');
{
  // The grip carries both verbs, so the threshold between them is load-bearing:
  // too tight and folding it away needs a surgeon's hand, too loose and every
  // short drag folds it instead.
  ok(R.isTap(0, 0), 'a still press is a tap');
  ok(R.isTap(3, 4), 'a 5px wobble is still a tap — fingers are not precise');
  ok(!R.isTap(0, 40), 'a real move is a drag');
  ok(!R.isTap(40, 0), 'horizontal counts too — that is an edge change');
}

console.log('\n══ a throw decides the edge, not just where you let go ══');
{
  // Released still on the right half → right. That is placement, and it is what
  // every check above this block already describes.
  const still = R.snapRail(900, 100, RAIL_W, RAIL_H, LANDSCAPE, INSET, 0);
  ok(still.edge === 'right', 'a still release goes to the nearer edge');

  // Flicked LEFT from the right half → left. The gesture said where it should
  // go; returning it under the finger reads as the app refusing the throw.
  const thrown = R.snapRail(900, 100, RAIL_W, RAIL_H, LANDSCAPE, INSET, -900);
  ok(thrown.edge === 'left', 'a hard flick left wins over being on the right half');

  const back = R.snapRail(100, 100, RAIL_W, RAIL_H, LANDSCAPE, INSET, 900);
  ok(back.edge === 'right', '…and symmetrically the other way');

  // A slow reposition must NOT read as a throw, or the rail escapes every time
  // you nudge it.
  const nudge = R.snapRail(900, 100, RAIL_W, RAIL_H, LANDSCAPE, INSET, -(R.FLING_VX - 60));
  ok(nudge.edge === 'right', 'a slow drag under the threshold is still a placement');

  // The signature has to stay compatible: everything written before the throw
  // existed passes six arguments and means "released still".
  const legacy = R.snapRail(900, 100, RAIL_W, RAIL_H, LANDSCAPE, INSET);
  ok(legacy.edge === still.edge && legacy.y === still.y, 'omitting vx means a still release');

  // The throw changes only the EDGE. Vertical position is where you left it —
  // a flick sideways must not also fling the rail up or down the pane.
  ok(near(thrown.y, still.y), 'a horizontal throw does not move it vertically');
}

console.log('\n══ the release is a spring, and it lands exactly ══');
{
  const F = R.springFrames(0, 120, 0, 0, R.RAIL_SPRING);
  ok(F.length > 8, 'a release produces a real animation, not one frame', `${F.length} frames`);
  ok(F[0].y === 120, 'it starts at the distance still to cover');

  const last = F[F.length - 1];
  // The teleport this whole file exists to remove was `top` written in one
  // frame. The inverse failure is just as bad: a spring that stops 0.3px out
  // leaves the rail permanently off its own edge, and the error compounds
  // across drags because the next one starts from there.
  ok(last.x === 0 && last.y === 0, 'and ENDS on the target exactly, not near it');

  // It must NOT overshoot. This assertion was the opposite one revision ago and
  // the reversal is the point: the rail arrives at an EDGE, and an edge is a
  // wall. A spring that overshoots a wall has passed through it, which reads as
  // an animation being played rather than an object arriving — reported back as
  // 「its a litle bouncy but artificially so」, which was right.
  const under = Math.min(...F.map((f) => f.y));
  ok(under > -0.5, 'it does NOT overshoot — you cannot bounce off a wall you are landing on',
    `min=${under.toFixed(3)}`);
  ok(F.every((f) => f.y <= 120.0001), 'and never travels further than the distance it had to cover');
  // Monotonic approach is the positive form of the same claim.
  let monotonic = true;
  for (let i = 1; i < F.length; i++) if (F[i].y > F[i - 1].y + 0.001) monotonic = false;
  ok(monotonic, 'it decelerates in — every frame is closer than the last');

  // …and then it settles rather than ringing forever.
  const half = F.slice(Math.floor(F.length / 2));
  ok(half.every((f) => Math.abs(f.y) < 30), 'the second half is already close to home');
  const ms = (F.length - 1) * (1000 / 60);
  ok(ms > 150 && ms < R.MAX_SETTLE_MS,
    'the settle is long enough to see and short enough to not wait for', `${ms.toFixed(0)}ms`);
}

console.log('\n══ the spring carries the velocity the finger left ══');
{
  // This is the whole feel. A spring released at the same place with the throw's
  // momentum must travel FURTHER before it comes back than one released dead.
  const dead = R.springFrames(0, 60, 0, 0, R.RAIL_SPRING);
  const flung = R.springFrames(0, 60, 0, 900, R.RAIL_SPRING);
  const reach = (F) => Math.max(...F.map((f) => f.y));
  ok(reach(flung) > reach(dead) + 5,
    'a thrown release overshoots further than a still one',
    `flung=${reach(flung).toFixed(1)} dead=${reach(dead).toFixed(1)}`);
  ok(flung[flung.length - 1].y === 0, 'and still lands exactly');

  // A release with no distance left to cover but real speed still animates —
  // dropping it would make a flick that happens to end on the edge feel dead.
  const inPlace = R.springFrames(0, 0, 0, 800, R.RAIL_SPRING);
  ok(inPlace.length > 4 && Math.max(...inPlace.map((f) => Math.abs(f.y))) > 1,
    'speed alone is enough to produce motion');
}

console.log('\n══ the physics cannot produce a NaN or run away ══');
{
  for (const [dx, dy, vx, vy] of [[0, 0, 0, 0], [-400, 900, -3000, 2500], [0.01, -0.01, 0, 0]]) {
    const F = R.springFrames(dx, dy, vx, vy, R.RAIL_SPRING);
    ok(F.every((f) => Number.isFinite(f.x) && Number.isFinite(f.y)),
      `finite for (${dx},${dy},${vx},${vy})`);
    ok(F.length <= Math.ceil((R.MAX_SETTLE_MS / 1000) * 60) + 2,
      `bounded for (${dx},${dy},${vx},${vy})`, `${F.length} frames`);
  }
  // Overdamped constants must not blow up either — the guard exists so a caller
  // retuning the spring gets a dull animation, never a NaN written to a style.
  const over = R.springFrames(0, 100, 0, 0, { stiffness: 100, damping: 200, mass: 1 });
  ok(over.every((f) => Number.isFinite(f.y)), 'an overdamped spring is still finite');
  ok(!over.some((f) => f.y < -0.5), '…and does not overshoot, by definition');
}

console.log('\n══ the walls push back instead of stopping you dead ══');
{
  const W = 1024;
  ok(R.rubberBand(0, W) === 0, 'in bounds, nothing happens');

  // Asymptotic: pushing twice as far past the edge does NOT give twice as much.
  const a = R.rubberBand(100, W), b = R.rubberBand(200, W);
  ok(b > a, 'further still gives further — it never refuses outright');
  ok(b < 2 * a, 'but progressively less, which is what "resistance" means',
    `100→${a.toFixed(1)}  200→${b.toFixed(1)}`);
  ok(a < 100, 'the rail always lags the finger past the bound', `${a.toFixed(1)} < 100`);

  // Symmetric, and bounded by the dimension however hard you pull.
  ok(near(R.rubberBand(-150, W), -R.rubberBand(150, W)), 'symmetric in both directions');
  ok(Math.abs(R.rubberBand(1e6, W)) < W, 'and can never exceed the pane itself');

  // The live drag resists; the RESTING place is still hard-clamped, because a
  // release has to land somewhere legal. Two questions, two functions.
  const box = { width: 1024, height: 1366 };
  const soft = R.resistDrag(6, 600, -400, 0, RAIL_W, RAIL_H, box, INSET);
  ok(soft.dx > -400 && soft.dx < 0, 'dragging off the left edge gives, but not fully',
    `${soft.dx.toFixed(1)}px of 400`);
  const hard = R.clampDrag(6, 600, -400, 0, RAIL_W, RAIL_H, box, INSET);
  ok(hard.dx === 0, 'while the resting clamp still refuses it outright');

  const inside = R.resistDrag(300, 600, 40, 40, RAIL_W, RAIL_H, box, INSET);
  ok(inside.dx === 40 && inside.dy === 40, 'and inside the bounds it tracks the finger exactly');
}

console.log('\n══ throw speed comes from the tail, not the last frame ══');
{
  // A finger that moved fast and then PAUSED before lifting has thrown nothing.
  // Reading only the final pair of points would report the pause (≈0) — or, on
  // a jittery digitiser, a phantom throw from a 4px twitch.
  const moving = [];
  for (let i = 0; i <= 6; i++) moving.push({ t: i * 16, x: i * 16, y: 0 });
  const v = R.throwVelocity(moving);
  ok(v.vx > 800, 'a steady 16px/frame drag reads as ~1000px/s', `${v.vx.toFixed(0)}px/s`);
  ok(Math.abs(v.vy) < 1, 'and no vertical component it did not have');

  const paused = [
    { t: 0, x: 0, y: 0 }, { t: 16, x: 60, y: 0 }, { t: 32, x: 120, y: 0 },
    { t: 200, x: 121, y: 0 }, { t: 260, x: 121, y: 0 },
  ];
  ok(Math.abs(R.throwVelocity(paused).vx) < R.FLING_VX,
    'a drag that stopped before lifting is not a throw',
    `${R.throwVelocity(paused).vx.toFixed(0)}px/s`);

  ok(R.throwVelocity([]).vx === 0 && R.throwVelocity([{ t: 0, x: 0, y: 0 }]).vx === 0,
    'too few samples is zero, not NaN');
  const sameInstant = [{ t: 5, x: 0, y: 0 }, { t: 5, x: 40, y: 0 }];
  ok(Number.isFinite(R.throwVelocity(sameInstant).vx),
    'two samples at the same timestamp do not divide by zero');
}

console.log(fail ? `\n✗ ${fail}/${n} checks failed` : `\n✓ all ${n} checks pass`);
process.exit(fail ? 1 : 0);
