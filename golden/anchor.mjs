/**
 * golden/anchor.mjs — in-transcript anchoring regression.
 *
 * Proves the contract the embed/card/audio layer depends on:
 *   1. anchors are written INTO the actual transcript (typed callouts wrapping
 *      the real timestamped lines, terminated by ^recon-ids),
 *   2. context windows are "enough but not too much" (mins, caps, clause flow),
 *   3. stripAnchors is the exact inverse (no line lost, no char corrupted),
 *   4. re-running is idempotent and a second notes-file's run preserves the
 *      first run's anchors (multi-source merge via entryToResult),
 *   5. clip ranges cover exactly the window the embed shows.
 *
 * Run:  node golden/anchor.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (p) => import(pathToFileURL(join(HERE, '..', 'src', 'notes', p)).href);
const { reconcile, parseTranscriptLines } = await load('pipeline.ts');
const { blockIdFor, buildAnchoredEntries, entryToResult, retypeInMarkdown } = await load('annotate.ts');
const {
  contextWindow, planAnchors, applyAnchors, stripAnchors,
} = await load('transcript-anchor.ts');

const suite = JSON.parse(readFileSync(join(HERE, '001.cases.json'), 'utf8'));
const pristine = readFileSync(join(HERE, suite.transcript), 'utf8');
const lines = parseTranscriptLines(pristine);
const readings = JSON.parse(readFileSync(join(HERE, 'readings.fixture.json'), 'utf8'));
const readingOf = (w) => (Object.prototype.hasOwnProperty.call(readings, w) ? readings[w] : null);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const results = reconcile(suite.cases.map((c) => c.note), lines, readingOf);
const plan = planAnchors(results, lines);

console.log('══ plan (windows + clusters + clips) ══');
check('every located result planned', plan.items.length === results.filter((r) => r.best).length);
check('item ids unique', new Set(plan.items.map((i) => i.id)).size === plan.items.length);
check('anchorIdOf covers every item', plan.items.every((i) => plan.anchorIdOf.has(i.id)));
check('cluster anchor id is one of its items', plan.clusters.every((c) => c.items.some((i) => i.id === c.anchorId)));

for (const it of plan.items) {
  const s = it.result.best;
  if (it.window.startLine > s.startLine || it.window.endLine < s.endLine) {
    check(`window contains span (${it.id})`, false, `${JSON.stringify(it.window)} vs span ${s.startLine}-${s.endLine}`);
  }
}
check('all windows contain their spans', true);
check('per-side line cap respected', plan.items.every((it) =>
  it.result.best.startLine - it.window.startLine <= 4 && it.window.endLine - it.result.best.endLine <= 4));
check('window gives real context (≥1 line each side when available)', plan.items.every((it) =>
  (it.window.startLine < it.result.best.startLine || it.result.best.startLine === 0) &&
  (it.window.endLine > it.result.best.endLine || it.result.best.endLine === lines.length - 1)));

// clip range covers the window
check('clip range covers the window', plan.items.every((it) => {
  if (it.clipStartSec == null) return true;
  const t0 = lines[it.window.startLine].tStartSec, t1 = lines[it.window.endLine].tStartSec;
  return it.clipStartSec <= t0 && it.clipEndSec > t1;
}));
check('clip range bounded (≤90s)', plan.items.every((it) =>
  it.clipStartSec == null || it.clipEndSec - it.clipStartSec <= 90));

console.log('══ apply / strip (exact inverse) ══');
const classOf = () => 'serifu';
const annotated = applyAnchors(pristine, plan, classOf);
check('every cluster anchor written', plan.clusters.every((c) => annotated.includes(`^${c.anchorId}`)));
check('typed callout headers written', (annotated.match(/> \[!serifu\][+-] 🟡/g) ?? []).length === plan.clusters.length);
check('window lines are quoted with timestamps', /> \[(?:\d{1,2}:)?\d{1,2}:\d{2}\] /.test(annotated));
check('matched span highlighted (==…== in a quoted line)', /> \[[\d:]+\] .*==.+==/.test(annotated));

const stripped = stripAnchors(annotated);
check('stripAnchors(applyAnchors(x)) === x (roundtrip)', stripped === pristine,
  stripped === pristine ? '' : `lengths ${stripped.length} vs ${pristine.length}`);

const linesAfter = parseTranscriptLines(stripped);
check('no transcript line lost or altered',
  linesAfter.length === lines.length &&
  linesAfter.every((l, i) => l.text === lines[i].text && l.tStartSec === lines[i].tStartSec));

const annotated2 = applyAnchors(stripAnchors(annotated), plan, classOf);
check('re-apply idempotent (same output)', annotated2 === annotated);

// callout block integrity: from each header to its ^anchor, every line is quoted
{
  const L = annotated.split('\n');
  let ok = true;
  for (let i = 0; i < L.length; i++) {
    if (!/^> \[!serifu\]/.test(L[i])) continue;
    let j = i + 1;
    while (j < L.length && L[j].startsWith('>')) j++;
    if (!/^\^recon-/.test(L[j] ?? '')) { ok = false; break; }
  }
  check('each callout is one contiguous block ending in its ^anchor', ok);
}

console.log('══ retype on the annotated transcript ══');
const anchor0 = plan.clusters[0].anchorId;
const retyped = retypeInMarkdown(annotated, anchor0, 'discourse');
check('retype swaps keyword+emoji for the right block',
  retyped !== annotated && retyped.includes('[!discourse]') && (retyped.match(/> \[!serifu\]/g) ?? []).length === plan.clusters.length - 1);
check('retyped transcript still strips back to pristine', stripAnchors(retyped) === pristine);
// v2 classes (2026-07-10): phrase schema 💠[!kobun] + skeletal 🟠[!skeletal]
const retypedKobun = retypeInMarkdown(annotated, anchor0, 'phrase_schema');
check('retype to phrase_schema writes [!kobun] 💠', /\[!kobun\][+-] 💠/.test(retypedKobun));
check('kobun-retyped transcript still strips to pristine', stripAnchors(retypedKobun) === pristine);
const retypedSkel = retypeInMarkdown(annotated, anchor0, 'skeletal');
check('retype to skeletal writes [!skeletal] 🟠 and strips clean',
  /\[!skeletal\][+-] 🟠/.test(retypedSkel) && stripAnchors(retypedSkel) === pristine);

console.log('══ entries + multi-source merge ══');
const entries = buildAnchoredEntries(results, plan, 'Transcripts/t.md', 'notes/a.md', new Map());
check('located entries carry anchorId', entries.filter((e) => e.anchorId).length === plan.items.length);
check('entries carry window + clip + span fields', entries.filter((e) => e.anchorId).every((e) =>
  e.startLine != null && e.endLine != null && e.spanStartLine != null && e.clipStartSec != null));
check('entryToResult reproduces the block id', entries.filter((e) => e.anchorId).every((e) =>
  blockIdFor(entryToResult(e)) === e.blockId));

// simulate a SECOND notes file run: its plan must re-include run A's entries
const resultsB = reconcile(['これはペンだと思います'], lines, readingOf);
const pseudoA = entries.map((e) => entryToResult(e)).filter(Boolean);
const combined = planAnchors([...resultsB.filter((r) => r.best), ...pseudoA], lines);
const annotatedBoth = applyAnchors(pristine, combined, classOf);
check('second run preserves first run anchors', plan.items.every((it) =>
  annotatedBoth.includes(`^${combined.anchorIdOf.get(it.id)}`)));
check('second run adds its own anchor', resultsB.filter((r) => r.best).every((r) =>
  annotatedBoth.includes(`^${combined.anchorIdOf.get(blockIdFor(r))}`)));
check('combined transcript still strips to pristine', stripAnchors(annotatedBoth) === pristine);

console.log('══ cluster merge (overlapping windows share one block) ══');
// two notes hitting the same area of the transcript
const near = reconcile([results[0].note, results[0].note + 'ね'], lines, readingOf);
const nearPlan = planAnchors(near.filter((r) => r.best), lines);
if (nearPlan.items.length === 2 && nearPlan.clusters.length === 1) {
  check('overlapping windows merged into one cluster', true);
  check('both items share the cluster anchor',
    nearPlan.anchorIdOf.get(nearPlan.items[0].id) === nearPlan.anchorIdOf.get(nearPlan.items[1].id));
  const one = applyAnchors(pristine, nearPlan, classOf);
  check('merged cluster writes exactly one callout', (one.match(/> \[!serifu\]/g) ?? []).length === 1);
  check('merged output still strips to pristine', stripAnchors(one) === pristine);
} else {
  check('overlapping windows merged into one cluster', nearPlan.clusters.length < nearPlan.items.length,
    `items=${nearPlan.items.length} clusters=${nearPlan.clusters.length}`);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} anchor: ${pass}/${pass + fail} checks passed`);

// show one real anchored callout
const m = annotated.match(/> \[!serifu\][\s\S]*?\n\^recon-[a-z0-9]+/);
if (m) console.log('\n── sample anchored callout (inside the transcript) ──\n\n' + m[0]);
process.exit(fail === 0 ? 0 : 1);
