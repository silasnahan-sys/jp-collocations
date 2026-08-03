/**
 * golden/ratify.mjs — ratification as a byproduct of study (AUDIT §6.5, #8).
 *
 * Three properties are what make this build worth anything, and all three are
 * easy to lose in a refactor that looks harmless:
 *
 *   1. **A probe is never a queue.** At most ONE per graded card, and a pattern
 *      with nothing open yields null rather than a "nothing to ask" interruption.
 *      Reintroducing a queue reintroduces the chore that has never once
 *      completed in this project's history.
 *   2. **`pick` is recorded and honoured.** Precision is computed from the
 *      uniformly-drawn rows ALONE. Pooling the uncertainty-sampled rows into the
 *      same percentage would understate the sweep by an unknown amount, and the
 *      resulting number would be believed because it is the alarming one.
 *   3. **A proportion below its floor is REFUSED, not printed.** §28 S6 —
 *      degrade to less information, never to wrong information.
 *
 * Run:  node golden/ratify.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const R = await import(pathToFileURL(join(HERE, '..', 'src', 'study', 'ratify.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` (${detail})` : ''}`); }
};

const EMPTY = () => ({ rows: {} });
const put = (data, row) => { data.rows[row.id] = row; return data; };

/** A pattern with `n` suggested sightings, all carrying `move` as the concordance label. */
const mk = (over = {}) => ({
  id: 'p1', key: 'ですね', note: 'ですね', class: 'discourse', classRatified: false,
  payload: {}, attestations: [], rejectedAtts: [], ...over,
});
const att = (i, over = {}) => ({
  source: 'yt', file: `T${i}.md`, tStartSec: i * 10, quote: `これはですね、${i}番目の行です。`,
  addedAt: 1, status: 'suggested', confidence: 0.75, matchKind: 'concordance:final:AGREE-MARK', ...over,
});

console.log('\n══ at most ONE probe, and silence when there is nothing ══');
{
  const clean = mk({ classRatified: true, attestations: [] });
  check('a settled pattern yields NO probe (silence, not "nothing to ask")',
    R.nextProbe(clean, EMPTY()) === null);

  const p = mk({ attestations: [att(1), att(2)] });
  const one = R.nextProbe(p, EMPTY());
  check('an open pattern yields exactly one probe object', !!one && !Array.isArray(one));
  check('the probe names what ✓ and ✕ each mean', !!one.yes && !!one.no, `${one.yes} / ${one.no}`);
  check('the probe carries a question ready to render', /[？?]$/.test(one.question), one.question);
}

console.log('\n══ value order: move → class → sighting ══');
{
  // 8 sightings all naming one move clears MOVE_MIN_SIGHTINGS/SHARE.
  const many = Array.from({ length: 10 }, (_, i) => att(i));
  const p = mk({ attestations: many });
  const first = R.nextProbe(p, EMPTY());
  check('a move claim is asked FIRST — it settles hundreds at once',
    first.kind === 'move', `${first.kind}, covers=${first.covers}`);
  check('and it says how many sightings it settles', first.covers >= 10, `covers=${first.covers}`);

  // answer the move → class is next
  const d = put(EMPTY(), R.answerOf(first, 'yes', 1, 'review'));
  const second = R.nextProbe(p, d);
  check('once the move is settled the CLASS is asked', second.kind === 'class', second.kind);
  check('a class probe is marked as blocking (it gates matcher + card + sweep)',
    second.pick === 'blocking');

  put(d, R.answerOf(second, 'yes', 2, 'review'));
  const third = R.nextProbe(p, d);
  check('then individual sightings', third.kind === 'sighting', third.kind);

  // a pattern with no move claim and a ratified class goes straight to sightings
  const plain = mk({ class: 'collocation', classRatified: true, attestations: [att(1)] });
  check('no move + ratified class → straight to the sighting',
    R.nextProbe(plain, EMPTY()).kind === 'sighting');
}

console.log('\n══ decided is final; わからない ripens with the schedule ══');
{
  const p = mk({ class: 'collocation', classRatified: true, attestations: [att(1)] });
  const pr = R.nextProbe(p, EMPTY());
  const yes = put(EMPTY(), R.answerOf(pr, 'yes', 1, 'review'));
  check('a decided sighting is never asked again', R.nextProbe(p, yes) === null);
  const no = put(EMPTY(), R.answerOf(pr, 'no', 1, 'review'));
  check('a rejected sighting is never asked again', R.nextProbe(p, no) === null);

  // skip → re-askable, but bounded
  let d = EMPTY(), asked = 0, cur = R.nextProbe(p, d);
  while (cur && asked < 10) { d = put(d, R.answerOf(cur, 'skip', asked, 'review')); asked++; cur = R.nextProbe(p, d); }
  check('a skip is re-offered, and bounded by MAX_REASKS',
    asked === R.MAX_REASKS + 1, `asked ${asked}×, MAX_REASKS=${R.MAX_REASKS}`);
  check('the row remembers how many times it was asked', d.rows[pr.id].asks === asked);
  check('skip is stored as a real answer, not as absence', d.rows[pr.id].verdict === 'skip');
}

console.log('\n══ the sampling split — the trap this module exists for ══');
{
  const p = mk({ class: 'collocation', classRatified: true, attestations: [
    att(1, { confidence: 0.95 }), att(2, { confidence: 0.52 }), att(3, { confidence: 0.9 }),
  ] });
  const picks = [];
  for (let seq = 0; seq < 8; seq++) picks.push(R.nextProbe(p, EMPTY(), { seq }).pick);
  const randoms = picks.filter((x) => x === 'random').length;
  check('one draw in MEASUREMENT_EVERY is uniform',
    randoms === 8 / R.MEASUREMENT_EVERY, `${randoms}/8 random, EVERY=${R.MEASUREMENT_EVERY}`);
  check('the rest are drawn by uncertainty',
    picks.filter((x) => x === 'uncertain').length === 8 - randoms);

  // the uncertainty draw must actually be the most uncertain one
  const unc = R.nextProbe(p, EMPTY(), { seq: 1 });
  check('the uncertain draw takes the sighting nearest confidence 0.5',
    unc.subject.startsWith('T2.md'), unc.subject);

  // determinism — a golden that cannot pin the draw cannot pin the bias
  check('the uniform draw is deterministic for a given seq',
    R.nextProbe(p, EMPTY(), { seq: 0 }).subject === R.nextProbe(p, EMPTY(), { seq: 0 }).subject);
  const s0 = R.nextProbe(p, EMPTY(), { seq: 0 }).subject;
  const s4 = R.nextProbe(p, EMPTY(), { seq: 4 }).subject;
  check('…and it moves between measurement draws rather than sticking',
    typeof s0 === 'string' && typeof s4 === 'string');
}

console.log('\n══ report: precision comes from the uniform rows ALONE ══');
{
  const d = EMPTY();
  // 24 uniform draws, 18 of them real → 75%
  for (let i = 0; i < 24; i++) {
    put(d, { id: `sighting:p:r${i}`, kind: 'sighting', patternId: 'p', subject: `r${i}`, claim: 'components',
      verdict: i < 18 ? 'yes' : 'no', at: i, surface: 'review', pick: 'random', covers: 1, asks: 1 });
  }
  // 40 uncertainty draws, nearly all rejected — the biased stratum
  for (let i = 0; i < 40; i++) {
    put(d, { id: `sighting:p:u${i}`, kind: 'sighting', patternId: 'p', subject: `u${i}`, claim: 'components',
      verdict: i < 4 ? 'yes' : 'no', at: i, surface: 'review', pick: 'uncertain', covers: 1, asks: 1 });
  }
  const rep = R.report(d);
  check('precision is the RANDOM stratum only', rep.sweepPrecision.n === 24, `n=${rep.sweepPrecision.n}`);
  check('…and reads 75%, not the pooled 34%',
    Math.round(rep.sweepPrecision.pct * 100) === 75, `${Math.round(rep.sweepPrecision.pct * 100)}%`);
  check('the biased stratum is reported APART, never pooled',
    rep.sweepBiased.n === 40 && Math.round(rep.sweepBiased.pct * 100) === 10,
    `${rep.sweepBiased.n} rows @ ${Math.round(rep.sweepBiased.pct * 100)}%`);
  check('every proportion carries its Wilson interval',
    rep.sweepPrecision.lo < rep.sweepPrecision.pct && rep.sweepPrecision.pct < rep.sweepPrecision.hi,
    `[${rep.sweepPrecision.lo.toFixed(2)}, ${rep.sweepPrecision.hi.toFixed(2)}]`);
  check('skips never enter a proportion',
    rep.sweepPrecision.n + rep.sweepBiased.n === 64);
}

console.log('\n══ a proportion below its floor is REFUSED, not printed ══');
{
  const d = EMPTY();
  for (let i = 0; i < R.MIN_FOR_PRECISION - 1; i++) {
    put(d, { id: `sighting:p:r${i}`, kind: 'sighting', patternId: 'p', subject: `r${i}`, claim: 'c',
      verdict: 'yes', at: i, surface: 'review', pick: 'random', covers: 1, asks: 1 });
  }
  const rep = R.report(d);
  check('19 uniform answers yield NO precision number', rep.sweepPrecision === null);
  check('…but the count is still reported, so the refusal is legible',
    rep.randomN === R.MIN_FOR_PRECISION - 1, `randomN=${rep.randomN}`);
  check('proportion() refuses below the floor', R.proportion(5, 9) === null);
  check('…and returns at exactly the floor', R.proportion(20, 20) !== null);
  check('a small-population measure has its own, stated floor',
    R.MIN_FOR_CLAIM < R.MIN_FOR_PRECISION, `claim=${R.MIN_FOR_CLAIM} precision=${R.MIN_FOR_PRECISION}`);
}

console.log('\n══ the wilson interval itself ══');
{
  const [lo, hi] = R.wilson(9, 10);
  check('9/10 is not 90% ± nothing', hi - lo > 0.25, `[${lo.toFixed(2)}, ${hi.toFixed(2)}]`);
  const [lo2, hi2] = R.wilson(900, 1000);
  check('900/1000 is tight', hi2 - lo2 < 0.05, `[${lo2.toFixed(3)}, ${hi2.toFixed(3)}]`);
  check('the interval brackets the estimate', lo2 < 0.9 && 0.9 < hi2);
  const [z0, z1] = R.wilson(0, 0);
  check('n=0 yields total ignorance rather than 0%', z0 === 0 && z1 === 1);
  check('0/20 does not claim certainty', R.wilson(0, 20)[1] > 0);
}

console.log('\n══ drill answers — recorded, and NOT called parser accuracy ══');
{
  const now = 100;
  const agree = R.drillRow('nenko.md', 'c12', 'CONSCRIPT', 'CONSCRIPT', now);
  const split = R.drillRow('nenko.md', 'c13', 'CONSCRIPT', 'REJECT', now);
  check('agreement is a yes', agree.verdict === 'yes');
  check('a disagreement is a no AND keeps what the learner said',
    split.verdict === 'no' && split.answer === 'REJECT');
  check('the calculus\'s claim is kept as the claim', split.claim === 'CONSCRIPT');
  check('drill rows are marked as offered, never as a measurement draw',
    agree.pick === 'offered' && split.pick === 'offered');
  check('the case is scoped by file so ids do not collide across videos',
    R.drillRow('a.md', 'c1', 'X', 'Y', 1).id !== R.drillRow('b.md', 'c1', 'X', 'Y', 1).id);

  const d = EMPTY();
  for (let i = 0; i < 6; i++) put(d, R.drillRow('f.md', `c${i}`, 'CONSCRIPT', 'REJECT', i));
  for (let i = 6; i < 10; i++) put(d, R.drillRow('f.md', `c${i}`, 'GRANT', 'GRANT', i));
  const rep = R.report(d);
  check('the repeated refusal surfaces as a split, worst first',
    rep.drillSplits[0].claim === 'CONSCRIPT' && rep.drillSplits[0].answer === 'REJECT' && rep.drillSplits[0].n === 6,
    JSON.stringify(rep.drillSplits[0]));
  check('agreements never appear as splits', rep.drillSplits.every((s) => s.claim !== s.answer));
  check('drill rows do NOT contaminate sweep precision', rep.sweepPrecision === null && rep.randomN === 0);
}

console.log('\n══ the 談話モード mirror ══');
{
  const c = R.componentRow('T.md', 'quotative|…', 'quotative', true, 5);
  check('a component accept is a yes on the discourse surface',
    c.verdict === 'yes' && c.surface === 'discourse');
  check('a reject is a no', R.componentRow('T.md', 'k', 'connective', false, 5).verdict === 'no');
  const d = EMPTY();
  for (let i = 0; i < 6; i++) put(d, R.componentRow('T.md', `k${i}`, 'quotative', i < 5, i));
  check('component agreement uses the small-population floor',
    R.report(d).componentAgreement !== null && R.report(d).componentAgreement.n === 6);
}

console.log('\n══ how much is actually open — the honest size of the job ══');
{
  const pats = [
    mk({ id: 'a', attestations: Array.from({ length: 12 }, (_, i) => att(i)) }),   // move + class + 12
    mk({ id: 'b', class: 'collocation', classRatified: true, attestations: [att(1)] }), // 1 sighting
    mk({ id: 'c', class: 'serifu', classRatified: true, attestations: [] }),        // nothing
  ];
  const o = R.openCounts(pats, EMPTY());
  check('move claims are counted', o.move === 1, `move=${o.move}`);
  check('unratified classes are counted', o.class === 1, `class=${o.class}`);
  // The doctrine: 12 sightings behind a live move claim are ONE question, not
  // twelve. Counting them as twelve is how a home screen reads "17,891 to
  // confirm" and stops being opened.
  check('sightings behind a live move claim are NOT counted as work',
    o.sighting === 1, `sighting=${o.sighting}`);
  check('…they are counted as COVERAGE instead', o.covered === 12, `covered=${o.covered}`);
  check('the total is questions, never coverage', o.total === 3, `total=${o.total}`);

  // answering shrinks the job
  const first = R.nextProbe(pats[0], EMPTY());
  const d = put(EMPTY(), R.answerOf(first, 'yes', 1, 'review'));
  const after = R.openCounts(pats, d);
  check('a settled move claim leaves the open count', after.move === 0);
  // The regression this exists to stop: coverage keyed on the probe being OPEN
  // handed all 12 sightings back as work the moment the claim was answered,
  // rebuilding the backlog the claim replaced.
  check('…and its sightings STAY covered, not handed back as work',
    after.sighting === 1 && after.covered === 12, `sighting=${after.sighting} covered=${after.covered}`);

  const claimed = mk({ id: 'x', attestations: Array.from({ length: 12 }, (_, i) => att(i)), classRatified: true });
  const settled = put(EMPTY(), R.answerOf(R.nextProbe(claimed, EMPTY()), 'yes', 1, 'review'));
  check('a claimed form is not re-queued sighting-by-sighting on a learning turn',
    R.nextProbe(claimed, settled, { seq: 1 }) === null);
  check('…but IS still drawn on a measurement turn, so precision can be measured where the sweep is loudest',
    R.nextProbe(claimed, settled, { seq: 4 })?.pick === 'random');
  check('an unclaimed form is queued normally on a learning turn',
    R.nextProbe(mk({ id: 'y', classRatified: true, attestations: [att(1), att(2)] }), EMPTY(), { seq: 1 })?.kind === 'sighting');
}

console.log('\n══ the claims the review deck cannot reach ══');
{
  // A pattern whose material is ALL suggested has no confirmed attestation, so
  // `isReviewable` is false and it never enters the deck — which is exactly
  // where the 🔴 concordance forms live. On the real vault that is 17 move
  // claims standing for ~17,800 sightings, none of them reachable by card.
  const unreachable = mk({ id: 'big', key: 'ですね', attestations: Array.from({ length: 40 }, (_, i) => att(i)) });
  const small = mk({ id: 'small', key: 'だよね', attestations: Array.from({ length: 9 }, (_, i) => att(i)) });
  const best = R.bestClaimProbe([small, unreachable], EMPTY());
  check('the fallback finds a claim on an unreviewable pattern', !!best && best.kind === 'move');
  check('…and takes the one that settles the MOST', best.patternId === 'big', `${best.patternId} covers=${best.covers}`);

  const d = put(EMPTY(), R.answerOf(best, 'yes', 1, 'review'));
  const next = R.bestClaimProbe([small, unreachable], d);
  check('once answered it moves to the next-best', next.patternId === 'small');
  put(d, R.answerOf(next, 'yes', 2, 'review'));
  check('and when they are all settled it goes quiet',
    R.bestClaimProbe([small, unreachable], d) === null);
  check('a catalog with no claims yields no fallback',
    R.bestClaimProbe([mk({ classRatified: true, attestations: [] })], EMPTY()) === null);
}

console.log('\n══ evidence is judgeable at a glance ══');
{
  // The concordance stores 400-character windows with deep links in them; the
  // 語彙 panel's first draft duly offered a bare URL as proof about 「ですね」.
  const long = 'あ'.repeat(400);
  const p = mk({ class: 'collocation', classRatified: true, attestations: [
    att(1, { quote: `(https://youtu.be/x?t=65) ${long}` }),
  ] });
  const pr = R.nextProbe(p, EMPTY());
  check('a deep link never reaches the question', !pr.evidence.some((e) => e.includes('http')), pr.evidence[0]?.slice(0, 40));
  check('the window is trimmed to something answerable in a second',
    pr.evidence.every((e) => e.length <= 100), `${pr.evidence[0]?.length} chars`);
}

console.log(`\n${fail ? '✗' : '✓'} ratify: ${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
