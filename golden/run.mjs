/**
 * golden/run.mjs — reconciliation regression runner (DESIGN §6).
 *
 * Reconciles each frozen case with the pure LocalMatcher and diffs against the
 * expected span/status/corrections. Tolerant of noise (timestamp ±tol,
 * confidence not asserted), strict on substance (located line, auto vs
 * needs-review, and each expected correction kind+surfaces present).
 *
 * Run:  node --experimental-strip-types golden/run.mjs
 * Re-run after ANY change to the matcher scoring, reading resolver, or a case.
 * Green = "still works." Exit code is nonzero on any failure (CI-friendly).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const { match } = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'local-matcher.ts')).href);

function parseTranscript(md) {
  const lines = [];
  let idx = 0;
  for (const ln of md.split('\n')) {
    const m = ln.match(/\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]\s*(.*)/);
    if (!m) continue;
    const h = m[1] ? +m[1] : 0;
    const text = (m[4] || '').replace(/\[音楽\]/g, '').trim();
    if (text) lines.push({ index: idx++, tStartSec: h * 3600 + +m[2] * 60 + +m[3], text });
  }
  return lines;
}
const fmt = (s) => s == null ? '--:--' : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

let failures = 0, cases = 0;
const suites = readdirSync(HERE).filter((f) => /\.cases\.json$/.test(f)).sort();

for (const suiteFile of suites) {
  const suite = JSON.parse(readFileSync(join(HERE, suiteFile), 'utf8'));
  const md = readFileSync(join(HERE, suite.transcript), 'utf8');
  const lines = parseTranscript(md);
  const THRESHOLD = suite.threshold ?? 0.7;

  // frozen reading source (fixture) → the injected ReadingResolver
  let readings = {};
  try { readings = JSON.parse(readFileSync(join(HERE, 'readings.fixture.json'), 'utf8')); } catch {}
  const readingOf = (w) => (Object.prototype.hasOwnProperty.call(readings, w) ? readings[w] : null);

  console.log(`\n══ ${suiteFile}  (${lines.length} lines, threshold ${THRESHOLD}) ══`);
  for (const c of suite.cases) {
    cases++;
    const r = match(c.note, lines, readingOf);
    const status = r.best && r.confidence >= THRESHOLD ? 'auto' : 'needs-review';
    const problems = [];
    const e = c.expect;

    if (e.tSec != null) {
      const got = r.best?.tStartSec;
      if (got == null || Math.abs(got - e.tSec) > (e.tol ?? 40))
        problems.push(`span @ ${fmt(got)} expected ~${fmt(e.tSec)} (±${e.tol ?? 40}s)`);
    }
    if (e.status && status !== e.status) problems.push(`status ${status} expected ${e.status}`);
    for (const ec of e.corrections ?? []) {
      const hit = r.corrections.find((rc) =>
        rc.kind === ec.kind && rc.noteText.includes(ec.note) && rc.transcriptText.includes(ec.transcript));
      if (!hit) problems.push(`missing correction [${ec.kind}] 「${ec.note}」→「${ec.transcript}」`);
    }

    const tag = c.synthetic ? ' (synthetic)' : '';
    if (problems.length) {
      failures++;
      console.log(`  ✗ case ${c.id}${tag} 「${c.note}」`);
      for (const p of problems) console.log(`      - ${p}`);
      console.log(`      got: @${fmt(r.best?.tStartSec)} conf=${r.confidence.toFixed(2)} status=${status} corr=[${r.corrections.map((x) => x.kind).join(',')}]`);
    } else {
      const cor = r.corrections.length ? ` +${r.corrections.map((x) => x.kind).join(',')}` : '';
      console.log(`  ✓ case ${c.id}${tag}  @${fmt(r.best?.tStartSec)} conf=${r.confidence.toFixed(2)} ${status}${cor}`);
    }
  }
}

console.log(`\n${failures ? '✗' : '✓'} ${cases - failures}/${cases} cases pass`);
process.exit(failures ? 1 : 0);
