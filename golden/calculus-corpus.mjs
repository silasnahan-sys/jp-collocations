/**
 * golden/calculus-corpus.mjs — the calculus AT SCALE, on the full real
 * transcripts (fixtures/, verbatim vault copies). Corpus-as-adversary made
 * interpretable: the evidence chain (calculus/turns.mjs) is code, so a break
 * here is a THEORY break, not input corruption.
 *
 * The headline: the reducer must reconstruct the imiron macro-arc —
 * SHELVE at [12:02] (一旦置いておいて, verbatim) and RESUME at [1:37:38]
 * (疑問戻っていいですか — a trigger the ASR bisected across two lines,
 * repaired by fragment merging) — 85 minutes apart. Blind-spot #5, run for
 * real, on the FULL 3h03m file (the Phase-0 audit itself dropped 2 hours
 * to a timestamp-format bug; this golden parses every line).
 *
 * Register-sanity baselines come from the audit's degenerate numbers
 * (pre-settlement: Table 361/1330 live at end, QUD depth 22 push-only).
 *
 * Coverage numbers are PRINTED, not asserted — per the project rule:
 * recall machine, never claimed-correct.
 *
 *   node golden/calculus-corpus.mjs
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (p) => import(pathToFileURL(join(HERE, '..', 'src', 'discourse', p)).href);
const { reduce, traceString, PRIMITIVES } = await imp('calculus/scoreboard.mjs');
const { recognizeEvents } = await imp('calculus/moves.mjs');
const { transcriptToTurns } = await imp('calculus/turns.mjs');

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => { n++; if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg}`); };
const PRIMSET = new Set(PRIMITIVES);

function run(label, file) {
  const md = readFileSync(join(HERE, 'fixtures', file), 'utf8');
  const { turns, stats } = transcriptToTurns(md);
  const board = reduce(turns, recognizeEvents);
  const per = board.turns;
  const residue = per.filter(t => t.prims.every(p => p === 'PROPOSE' || p === 'ADJUST_FORCE' || p === 'ANSWER_QUD')).length;
  let maxQud = 0; for (const t of per) maxQud = Math.max(maxQud, t.qud.length);
  const grounding = turns.reduce((a, t) => a + t.grounding.length, 0);
  console.log(`\n── ${label}: ${stats.lines} lines → ${turns.length} turns (${stats.lifted} backchannel lines lifted + ${stats.embeddedGrounding} EMBEDDED runs de-fused [${stats.defusedSplits} floor-splits]: ${stats.ack} ack / ${stats.accept} accept; ${stats.merged} fragments merged) ──`);
  console.log(`   end-state: CG=${board.cg.length} Table(live)=${board.table.length} lapsed=${board.lapsed.length} Projected=${board.projected.length} QUD=${board.qud.length}(max ${maxQud}) shelved=${board.shelved.length} answered=${board.answered.length} unresolved=${board.unresolved.length}`);
  console.log(`   structure coverage: ${per.length - residue}/${per.length} turns beyond bare PROPOSE (${(100 * (per.length - residue) / per.length).toFixed(1)}%) — recall-machine number, NOT a precision claim`);
  return { board, turns, stats, maxQud, grounding };
}

// ── 年功序列 (33 min, punctuated ASR — the golden arc's source) ──
{
  const { board, maxQud } = run('年功序列', 'nenko-hGdbIzNsDw8.md');
  console.log('\n══ register sanity (audit baseline: Table 361 live, QUD depth 22) ══');
  ok(board.table.length <= 20, 'live Table stays bounded (was 361)', `(${board.table.length})`);
  ok(maxQud <= 6, 'QUD depth stays sane (was 22, push-only)', `(max ${maxQud})`);
  ok(board.log.every(l => PRIMSET.has(l.prim)), 'every move ∈ PRIMITIVES over the full file');
  ok(board.cg.length > 0, 'grounding actually grounds something', `(CG=${board.cg.length})`);
  const b2 = reduce(transcriptToTurns(readFileSync(join(HERE, 'fixtures', 'nenko-hGdbIzNsDw8.md'), 'utf8')).turns, recognizeEvents);
  ok(traceString(board) === traceString(b2), 'full-file determinism (byte-identical trace)');
}

// ── 意味論 (3h03m, unpunctuated ASR — the macro-structure test) ──
{
  const { board, turns, stats, maxQud, grounding } = run('意味論', 'imiron-fe5kdBLS8wM.md');
  const last = turns[turns.length - 1];

  console.log('\n══ de-fused grounding on ASR soup (audit baseline: 3 events, 0.9% recall) ══');
  ok(grounding >= 200, 'grounding events on the 3h file (was 3)', `(${grounding})`);
  ok(stats.embeddedGrounding >= 180, 'embedded uptake runs recovered from inside turns', `(${stats.embeddedGrounding})`);
  ok(stats.defusedSplits >= 5, 'fused speaker changes split', `(${stats.defusedSplits})`);
  const BROAD = /(なるほど|確かに|たしかに|そうですね|そうですよね|はいはい|ですよね)/g;
  let remaining = 0;
  for (const t of turns) remaining += (t.text.match(BROAD) ?? []).length;
  ok(remaining < 261, 'broad-metric tokens left in text well below the 348 baseline (remainder ≈ the deliberately-unanchored そうですね/ですよね class)', `(${remaining})`);
  ok(board.log.filter(l => l.prim === 'ACKNOWLEDGE').length >= 100, 'the continuer channel is alive on ASR', `(${board.log.filter(l => l.prim === 'ACKNOWLEDGE').length})`);
  ok(board.log.filter(l => l.prim === 'RATIFY').length >= 50, 'the uptake channel is alive on ASR', `(${board.log.filter(l => l.prim === 'RATIFY').length})`);
  console.log('\n══ the full 3 hours are actually read (the audit dropped 2 of them) ══');
  ok(last.tSec > 3 * 3600, 'H:MM:SS lines parsed to the end', `(last turn @${Math.floor(last.tSec / 60)}min)`);

  console.log('\n══ THE MACRO-ARC — blind-spot #5, live (SHELVE [12:02] → RESUME [1:37:38]) ══');
  const shelves = board.log.filter(l => l.prim === 'SHELVE_QUD');
  const resumes = board.log.filter(l => l.prim === 'RESUME_QUD');
  const shelveAt = shelves.find(l => l.tSec >= 700 && l.tSec <= 750);
  ok(!!shelveAt, 'SHELVE fires at the real 一旦置いておいて moment [12:02]',
    `(shelves at: ${shelves.map(l => Math.floor(l.tSec / 60) + 'min').join(', ') || 'none'})`);
  const resumeAt = resumes.find(l => l.tSec >= 5840 && l.tSec <= 5900);
  ok(!!resumeAt, 'RESUME fires at 疑問戻っていいですか [1:37:38] — the ASR-bisected trigger, repaired',
    `(resumes at: ${resumes.map(l => Math.floor(l.tSec / 60) + 'min').join(', ') || 'none'})`);
  ok(resumeAt && !/no shelved QUD/.test(resumeAt.ref), 'RESUME restores a REAL parked issue, 85 minutes later', `(${resumeAt?.ref.slice(0, 36)}…)`);

  console.log('\n══ register sanity over 3 hours (audit baseline: Table 1330 live) ══');
  ok(board.table.length <= 20, 'live Table bounded over 3 hours', `(${board.table.length})`);
  ok(maxQud <= 6, 'QUD depth sane over 3 hours', `(max ${maxQud})`);
  ok(board.log.every(l => PRIMSET.has(l.prim)), 'every move ∈ PRIMITIVES over 3 hours');
}

console.log(`\n${fail ? '✗' : '✓'} calculus-corpus: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
