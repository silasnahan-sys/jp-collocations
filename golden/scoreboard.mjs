/**
 * golden/scoreboard.mjs — regression + falsification test for the discourse
 * common-ground calculus (DISCOURSE-CALCULUS.md + Amendments I–III,
 * src/discourse/calculus/).
 *
 * v2. The Phase-0 golden proved EXPRESSIBILITY on 9 hand-groomed lines; the
 * audit (2026-07-22) showed its money test depended on hand-splitting the
 * [07:50] line, that it excluded backchannels, and that registers never
 * settled. THIS golden bakes those attacks in as permanent checks:
 *   • the money test runs on the VERBATIM UNSPLIT line
 *   • grounding: continuers (うん) do NOT enter CG; conscription + assent does
 *   • settlement: answering pops the QUD; live registers drain
 *   • precision: the audit's innocent sentences fire nothing
 *   • invariants check PRIMITIVES membership, not typeof (no more theater)
 *
 *   node golden/scoreboard.mjs
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (p) => import(pathToFileURL(join(HERE, '..', 'src', 'discourse', p)).href);

const { reduce, traceString, makeBoard, PRIMITIVES, affordances } = await imp('calculus/scoreboard.mjs');
const { recognizeEvents } = await imp('calculus/moves.mjs');
const { matchSentence } = await imp('engine/match.mjs');

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => { n++; if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg}`); };

// ── The real 堀元 arc — WITH the [07:50] line VERBATIM (projection and
//    fence in one utterance, as actually spoken; v1 hand-split it). ──
const A = '堀元', B = '相手';
const ARC = [
  { speaker: A, tSec: 451, text: '僕それ大企業がになってるの変じゃねって思ってて。' },
  { speaker: A, tSec: 454, text: 'それ要はさ、公共の福祉じゃん。' },
  { speaker: A, tSec: 465, text: '社会のための投資を強いられてるわけでしょ。' },
  { speaker: A, tSec: 470, text: 'だから、ま、この話を突き詰めていくと今働く能力がないやつは生活保護を受けながら職業訓練をしてくださいっていう話になってしまうので炎上するんですけど、そこまでは言ってないです。' },
  { speaker: A, tSec: 479, text: 'でもぶっちゃけ僕はそれに近いこと思ってて。' },
  { speaker: B, tSec: 506, text: 'その仕組み無理じゃねって気がするな。' },
  { speaker: B, tSec: 511, text: 'というか実際の仕事に放り込まれるから学べることって多いよねっていうことじゃない。' },
  { speaker: A, tSec: 527, text: 'そうなので今教育期間って言ったのは分かりやすさのための便宜的な話で、現実的にはベーシックインカムみたいな。' },
];

const board = reduce(ARC, recognizeEvents);
console.log('\n══ scoreboard trace (real recognizer → span-ordered reducer) ══');
console.log(traceString(board));

const turnAt = (t) => board.turns.find(x => x.tSec === t);
const primsAt = (t) => turnAt(t).prims;
const logHas = (prim) => board.log.filter(l => l.prim === prim);

// ── 1. The calculus SEES what the lexicon is structurally blind to ──
console.log('\n══ blind-spot recovery (the two moves that decide the argument) ══');
{
  const denyText = 'そこまでは言ってないです。';
  const raw = matchSentence(denyText).hits.map(h => h.opId);
  ok(raw.every(id => !/DENY|FENCE|COMMIT/.test(id)), 'lexicon has NO fence operator for そこまで言ってない', `(${raw.join(',') || '∅'})`);
  const rd = recognizeEvents(denyText);
  ok(rd.events.some(e => e.kind === 'deny'), 'calculus DETECTS the fence (deny event)');
  ok(rd.bareFence === true, 'a bare fence asserts nothing new');
  const rt = recognizeEvents('分かりやすさのための便宜的な話で');
  ok(rt.events.some(e => e.kind === 'retype'), 'calculus DETECTS the re-type (retype event)');
}

// ── 2. Conscription pushes attributable inferences onto the board ──
console.log('\n══ conscription → projected common ground ══');
ok(primsAt(454).includes('CONSCRIPT'), '公共の福祉じゃん → CONSCRIPT');
ok(primsAt(454).includes('SUBSTITUTE'), '要は… re-packages the prior claim → SUBSTITUTE');
ok(primsAt(465).includes('CONSCRIPT'), '強いられてるわけでしょ → CONSCRIPT');
ok(turnAt(465).projected.length >= 2, 'two conscripted props now attributable', `(${turnAt(465).projected.length})`);

// ── 3. THE MONEY TEST v2 — ON THE VERBATIM UNSPLIT LINE ──
// Projection and fence live in ONE utterance. Span order must make the
// projection exist BEFORE the fence, and the fence must bind IT — not the
// conscription two turns earlier (v1's failure on this exact line).
console.log('\n══ the fence (project → deny, intra-utterance, verbatim) ══');
{
  const prims = primsAt(470);
  ok(prims.includes('ASSERT_AS_DERIVED'), 'だから… → ASSERT_AS_DERIVED');
  ok(prims.includes('PROJECT_CONSEQUENCE'), '…話になってしまう → PROJECT_CONSEQUENCE');
  ok(prims.includes('DENY_COMMITMENT'), 'そこまで言ってない → DENY_COMMITMENT (same utterance)');
  ok(prims.indexOf('PROJECT_CONSEQUENCE') < prims.indexOf('DENY_COMMITMENT'),
    'span order: the projection exists BEFORE the fence fires');
  const fence = logHas('DENY_COMMITMENT')[0];
  ok(fence && /突き詰め|生活保護/.test(fence.ref), 'fence binds the JUST-PROJECTED consequence', `(${fence?.ref.slice(0, 24)}…)`);
  ok(!turnAt(470).projected.some(g => /突き詰め|生活保護/.test(g)),
    'the denied inference is fenced OUT of the projected set');
  ok(!prims.includes('GRANT'), 'medial けど does not GRANT (position-gated concession)');
}

// ── 4. Concede-pivot, repair, re-type on real surface ──
console.log('\n══ concede / repair / re-type ══');
ok(primsAt(479).includes('GRANT'), 'でも… (initial) → GRANT (concede before pivot)');
ok(primsAt(511).includes('RETRACT_OWN'), 'というか… → RETRACT_OWN (repair own prior)');
const repair = logHas('RETRACT_OWN')[0];
ok(repair && /⇒/.test(repair.ref), 'repair replaces the retracted prop', `(${repair?.ref.slice(0, 40)}…)`);
ok(primsAt(527).includes('RE_TYPE'), '便宜的な話で → RE_TYPE');
{
  const heur = [...board.props.values()].filter(p => p.status === 'heuristic');
  ok(heur.length >= 1, 're-type demotes a literal claim to heuristic');
  ok(heur.every(p => !/便宜的/.test(p.gloss)), 're-type targets a PRIOR claim, not its own utterance');
}

// ── 5. GROUNDING (Amendment II) — continuer ≠ acceptance ──
console.log('\n══ grounding: うん is attention, not agreement ══');
{
  const g = (grade, tSec) => ({ tSec, grade, text: grade === 'ack' ? 'うん。' : 'なるほど', by: 'B' });
  const turns = [
    { speaker: 'A', tSec: 1, text: '職業訓練は社会全体で担うべきだと思うんですよ。', grounding: [g('ack', 2)] },
    { speaker: 'A', tSec: 3, text: 'それって公共の福祉じゃん。', grounding: [g('ack', 4)] },
    { speaker: 'A', tSec: 5, text: 'つまり制度の設計から考え直すべき問題なんですよ。', grounding: [g('accept', 6)] },
  ];
  const b = reduce(turns, recognizeEvents);
  ok(b.turns[0].cg === 0, 'plain proposal + うん → NOT in CG (ACKNOWLEDGE only)', `(cg=${b.turns[0].cg})`);
  ok(b.log.some(l => l.prim === 'ACKNOWLEDGE'), 'the continuer is a first-class ACKNOWLEDGE move');
  ok(b.turns[1].cg === 1, 'conscription (じゃん) + assent → tacit CG', `(cg=${b.turns[1].cg})`);
  ok(b.log.some(l => l.prim === 'RATIFY' && /tacit/.test(l.note)), 'tacit ratification is marked as such');
  ok(b.turns[2].cg === 2, 'なるほど (accept) → RATIFY into CG', `(cg=${b.turns[2].cg})`);
}

// ── 6. SETTLEMENT (Amendment III) — registers model attention, not archive ──
console.log('\n══ settlement: answering pops, live registers drain ══');
{
  const qturns = [
    { speaker: 'A', tSec: 1, text: '職場での年功序列はありだと思いますか？' },
    { speaker: 'B', tSec: 3, text: 'なしですね、完全に実力主義でやるべきだと思います。' },
  ];
  const qb = reduce(qturns, recognizeEvents);
  ok(qb.qud.length === 0 && qb.answered.length === 1, 'a substantive answer POPS the QUD', `(open=${qb.qud.length}, answered=${qb.answered.length})`);

  const many = Array.from({ length: 12 }, (_, i) =>
    ({ speaker: i % 2 ? 'B' : 'A', tSec: i * 5, text: `これは${i}番目の別々の論点についての提案ですね。` }));
  const mb = reduce(many, recognizeEvents);
  ok(mb.table.length < many.length, 'unaddressed proposals LAPSE out of the live Table', `(live=${mb.table.length}, lapsed=${mb.lapsed.length})`);
  ok(mb.dynamics.some(d => d.kind === 'LAPSE'), 'lapse is board dynamics, not a speaker move');

  const cturns = [
    { speaker: 'A', tSec: 0, text: 'それって結局公共の福祉じゃん。' },
    ...Array.from({ length: 8 }, (_, i) =>
      ({ speaker: 'B', tSec: 10 + i, text: `ところで${i}個目の全く別の話をしますけどね。` })),
  ];
  const cb = reduce(cturns, recognizeEvents);
  ok(cb.dynamics.some(d => d.kind === 'TACIT_CG'), 'an UNCHALLENGED conscription slides into CG (Stalnaker default)');
  ok(cb.projected.length === 0, 'projected register drains', `(${cb.projected.length})`);
}

// ── 7. PRECISION GUARDS — the audit's innocents fire nothing ──
console.log('\n══ precision: innocents from the Phase-0 audit ══');
{
  const noProject = ['朝から雨になっていたので傘を持っていった。', '昨日から気になってたんだよね。'];
  for (const t of noProject)
    ok(!recognizeEvents(t).events.some(e => e.kind === 'project'), `no PROJECT on: ${t.slice(0, 14)}…`);
  const noDeny = ['そこまで言わなくてもいいじゃん。', '彼はそこまで言ってなかったと思うよ。'];
  for (const t of noDeny)
    ok(!recognizeEvents(t).events.some(e => e.kind === 'deny'), `no DENY on: ${t.slice(0, 14)}…`);
  ok(recognizeEvents(ARC[3].text).events.some(e => e.kind === 'project'), 'positive control: the real projection still fires');
  ok(recognizeEvents('そこまでは言ってないです。').events.some(e => e.kind === 'deny'), 'positive control: the real fence still fires');
}

// ── 8. AFFORDANCES — the board as a possibility engine ──
console.log('\n══ affordances (the production-condition read-out) ══');
{
  const affA = affordances(board, A).map(a => a.prim);
  ok(affA.includes('PROPOSE') && affA.includes('CONSCRIPT'), 'placement affordances always live');
  const b0 = makeBoard();
  const aff0 = affordances(b0, A).map(a => a.prim);
  ok(!aff0.includes('DENY_COMMITMENT') && !aff0.includes('GRANT'), 'stateful affordances need their preconditions');
}

// ── 9. Invariants — REAL ones (the v1 versions could not fail) ──
console.log('\n══ invariants ══');
{
  const PRIMSET = new Set(PRIMITIVES);
  ok(board.log.every(l => PRIMSET.has(l.prim)), 'every logged move ∈ PRIMITIVES (set membership, not typeof)');
  ok(new Set(board.cg).size === board.cg.length, 'CG has no duplicates');
  ok(board.cg.every(id => board.props.has(id)), 'CG references only real props');
  ok(board.table.every(it => board.props.has(it.id)) && board.projected.every(it => board.props.has(it.id)),
    'live registers reference only real props');
  let mono = true, prevCg = 0;
  for (const t of board.turns) { if (t.cg < prevCg) mono = false; prevCg = t.cg; }
  ok(mono, 'CG is monotonic non-decreasing');
}

// ── 10. Determinism + purity ──
console.log('\n══ determinism (reproducible, not a one-shot read) ══');
{
  const board2 = reduce(ARC, recognizeEvents);
  ok(traceString(board) === traceString(board2), 'identical input → byte-identical trace');
  const b = makeBoard();
  ok(b.cg.length === 0 && b.table.length === 0 && b.log.length === 0, 'fresh board is empty');
  ok(reduce([], recognizeEvents).turns.length === 0, 'empty transcript → empty trace');
}

console.log(`\n${fail ? '✗' : '✓'} scoreboard: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
