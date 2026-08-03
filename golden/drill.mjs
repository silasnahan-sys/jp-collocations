/**
 * golden/drill.mjs — the test that would have caught DISCOURSE-VERDICT §4.
 *
 * The old drill was green on every golden in the repo while being 65–71%
 * winnable without reading anything, because nothing ever asserted the one
 * property that matters: THE OPTION SET MUST NOT DEPEND ON THE ANSWER. That is
 * the first block below, and it is structural — it holds regardless of corpus.
 *
 * The measured blocks then run the real recognizer over the two real fixtures
 * and print the option-only baseline, so the instrument's own floor is a
 * reported number rather than an assumption.
 *
 * Run: node golden/drill.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reduce, affordances } from '../src/discourse/calculus/scoreboard.mjs';
import { recognizeEvents } from '../src/discourse/calculus/moves.mjs';
import { transcriptToTurns } from '../src/discourse/calculus/turns.mjs';
import {
  buildDrillCases, drillOptions, drillBaseline, caseAtOrAfter,
  DRILLABLE, HORIZON_TURNS, HORIZON_SEC, MIN_OPTIONS, MAX_OPTIONS,
} from '../src/discourse/drill.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ` (${extra})` : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); }
};

/** Fold a fixture exactly the way FollowAlongView.computeBoard does. */
function fold(file) {
  const md = readFileSync(join(HERE, 'fixtures', file), 'utf8');
  const { turns } = transcriptToTurns(md);
  const afford = new Map();
  const board = reduce(turns, recognizeEvents, (b, _t, i) => {
    const next = turns[i + 1];
    if (next) afford.set(i + 1, affordances(b, next.speaker).map((a) => a.prim));
  });
  return { turns, snaps: board.turns, afford };
}

console.log('\n══ THE INVARIANT — the option set cannot depend on the answer ══');
{
  // drillOptions' signature is the proof: it has no answer parameter. Assert the
  // behavioural consequence — same state, any answer, byte-identical options.
  const afforded = ['PROPOSE', 'CONSCRIPT', 'GRANT', 'REJECT', 'RATIFY', 'ASSERT_AS_DERIVED',
    'SUBSTITUTE', 'RETRACT_OWN', 'PROJECT_CONSEQUENCE'];
  const a = drillOptions(afforded, 12345);
  const b = drillOptions([...afforded], 12345);
  ok('same state + same seed → identical options', JSON.stringify(a) === JSON.stringify(b));
  ok('input ordering cannot survive into the sample',
    JSON.stringify(drillOptions([...afforded].reverse(), 12345)) === JSON.stringify(a));
  ok('non-drillable prims never become options', !a.includes('PROPOSE'));
  ok('options are canonically sorted (position leaks nothing)',
    JSON.stringify(a) === JSON.stringify([...a].sort()));
  ok('cardinality is bounded', a.length <= MAX_OPTIONS && a.length >= MIN_OPTIONS, `${a.length}`);
  ok('a thin pool yields no question at all', drillOptions(['CONSCRIPT'], 1).length === 0);
  ok('different freeze points get different sets',
    JSON.stringify(drillOptions(afforded, 999)) !== JSON.stringify(drillOptions(afforded, 1000)));
}

console.log('\n══ horizon — "next move" means next, not eventually ══');
for (const [name, file] of [['nenko', 'nenko-hGdbIzNsDw8.md'], ['imiron', 'imiron-fe5kdBLS8wM.md']]) {
  const { cases } = buildDrillCases(fold(file));
  ok(`${name}: every answer is within ${HORIZON_TURNS} turns`,
    cases.every((c) => c.gapTurns <= HORIZON_TURNS));
  ok(`${name}: every answer is within ${HORIZON_SEC}s`,
    cases.every((c) => c.gapSec == null || c.gapSec <= HORIZON_SEC));
  ok(`${name}: the answer is always answerable (∈ options)`,
    cases.every((c) => c.options.includes(c.answerPrim)));
  ok(`${name}: every answer is a drillable primitive`,
    cases.every((c) => DRILLABLE.has(c.answerPrim)));
}

console.log('\n══ the baseline is REPORTED, and the tells are gone ══');
for (const [name, file] of [['nenko', 'nenko-hGdbIzNsDw8.md'], ['imiron', 'imiron-fe5kdBLS8wM.md']]) {
  const { cases, dropped } = buildDrillCases(fold(file));
  const b = drillBaseline(cases);
  const pct = (x) => `${(100 * x).toFixed(1)}%`;
  console.log(`   ${name}: ${b.n} cases · ${b.distinctSets} distinct option-sets`);
  console.log(`     chance ${pct(b.chance)} → marginal ${pct(b.marginal)} (always "${b.topPrim}")`
    + ` → option-set LOO ${pct(b.optionOnly)}`);
  console.log(`     dropped — noMove ${dropped.noMove} · tooFar ${dropped.tooFar}`
    + ` · thinOptions ${dropped.thinOptions} · answerNotAfforded ${dropped.answerNotAfforded}`);

  ok(`${name}: enough distinct option-sets to defeat memorisation`,
    b.distinctSets >= 30, `${b.distinctSets} (old code: 11–14)`);
  // Tells are measured, but the assertion is on their REACH, not their
  // existence. Under the old code a tell was proof of leakage (the answer was
  // inserted first, so sets were near-constant by construction). The sampler is
  // now provably answer-blind, so a residual tell is a fact about answer SKEW —
  // CONSCRIPT is 48–60% of all answers — which `marginal` already reports. What
  // would still indict the sampler is tells with broad reach, so that is the bar.
  const tellReach = b.tells.reduce((n, t) => n + t.n, 0) / b.n;
  ok(`${name}: deterministic tells reach <5% of cases`,
    tellReach < 0.05, `${(100 * tellReach).toFixed(1)}%`
    + (b.tells.length ? ` — worst ${b.tells[0].prim} ${b.tells[0].n}×` : ' — none'));
  ok(`${name}: coverage is accounted for, never silently capped`,
    Object.values(dropped).every((v) => Number.isFinite(v)));
  // NOT a pass/fail on the baseline VALUE — that is a fact about the corpus and
  // the theory, not about this code, and hiding it behind a red ✗ would invite
  // tuning the instrument until the number looks acceptable. It is printed, and
  // §6 of AUDIT-2026-08-01.md reads it. What IS asserted is that the instrument
  // reports its own floors at all — the §4 defect was their absence.
  ok(`${name}: all three floors are reported`,
    Number.isFinite(b.chance) && Number.isFinite(b.marginal) && Number.isFinite(b.optionOnly)
    && b.topPrim != null);
}

console.log('\n══ determinism ══');
{
  const f = fold('nenko-hGdbIzNsDw8.md');
  const one = JSON.stringify(buildDrillCases(f).cases);
  const two = JSON.stringify(buildDrillCases(fold('nenko-hGdbIzNsDw8.md')).cases);
  ok('identical input → byte-identical cases', one === two);
  const { cases } = buildDrillCases(f);
  ok('caseAtOrAfter is monotonic in position',
    !cases.length || (caseAtOrAfter(cases, 0)?.atSec ?? 0) <= (caseAtOrAfter(cases, 600)?.atSec ?? Infinity));
  ok('caseAtOrAfter past the end returns null', caseAtOrAfter(cases, 1e9) === null);
}

console.log(`\n${fail ? '✗' : '✓'} drill: ${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
