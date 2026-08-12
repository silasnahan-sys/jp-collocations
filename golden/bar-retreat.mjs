/**
 * golden/bar-retreat.mjs — the navigator costs nothing while you are reading.
 *
 * 「the tool bar should be used for that without getting in the way」
 *
 * An auto-hiding bar is easy to build and easy to make hateful. The three rules
 * below are what separate the two, and each is here because its absence is a
 * specific irritation:
 *
 *   1. UP WINS IMMEDIATELY, with no threshold. Reaching for the bar IS scrolling
 *      up; a bar that needed a second gesture would be worse than one that never
 *      moved at all.
 *   2. THE ENDS ARE SAFE. The top is where you arrive and the bottom is where
 *      you finish — both are moments you are about to go somewhere.
 *   3. A SHORT PANE NEVER HIDES IT. Otherwise a rubber-band on a surface with
 *      nothing to scroll flickers the bar for no reason.
 *
 * Run:  node golden/bar-retreat.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const B = await import(pathToFileURL(join(HERE, '..', 'src', 'ui', 'bar-retreat.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const MAX = 4000;
/** Walk a list of scroll offsets and report where the bar ended up. */
const walk = (ys, max = MAX) => {
  let s = B.initialRetreat(ys[0]);
  for (const y of ys.slice(1)) s = B.nextRetreat(s, y, max);
  return s.at;
};

console.log('\nbar-retreat — out of the way, back on demand\n');

// ── rule 3: nothing to scroll, nothing to reclaim ─────────────────────────
check('a pane with no scroll range keeps the bar', walk([0, 200, 400], 0) === 'here');
check('a pane shorter than the end zone keeps it', walk([0, 40, 80], 50) === 'here');

// ── rule 2: the ends are safe ─────────────────────────────────────────────
check('scrolling down while still at the top keeps it', walk([0, 30, 60]) === 'here');
check('arriving at the bottom brings it back',
  walk([1000, 1400, 1800, MAX - 10]) === 'here');

// ── the ordinary case: reading down the page ──────────────────────────────
check('reading down the middle of a long page hides it',
  walk([500, 560, 620]) === 'away');
check('one small nudge is not reading', walk([500, 508]) === 'here');

// ── rule 1: up wins, immediately and from anywhere ────────────────────────
check('a single pixel of up brings it straight back',
  walk([500, 600, 700, 699]) === 'here');
check('…even mid-flick', walk([500, 900, 1300, 1299]) === 'here');

// ── a slow drag accumulates instead of resetting ──────────────────────────
// Each step is below HIDE_AFTER on its own; together they are a scroll down.
// If the anchor advanced on every sub-threshold frame this would never fire,
// which is the classic way an auto-hide bar ends up feeling broken on a
// trackpad or a slow Pencil drag.
check('many sub-threshold steps still count as going down',
  walk([500, 504, 508, 512, 516, 520]) === 'away');

// ── it stays away until something says otherwise ──────────────────────────
check('continuing down keeps it away', walk([500, 600, 700, 800]) === 'away');
check('a pause does not bring it back', walk([500, 600, 700, 700, 700]) === 'away');

// ── the thresholds are the contract ───────────────────────────────────────
check('HIDE_AFTER is a real threshold, not zero', B.HIDE_AFTER > 0);
check('exactly HIDE_AFTER hides', walk([500, 500 + B.HIDE_AFTER]) === 'away');
check('one less than HIDE_AFTER does not', walk([500, 500 + B.HIDE_AFTER - 1]) === 'here');

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
