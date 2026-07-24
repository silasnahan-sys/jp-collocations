/**
 * golden/precision-sample.mjs — the ✓✕ PRECISION SAMPLING protocol
 * (suggested-vs-ratified, per the capture-spine pattern).
 *
 * ROLES, per the project's standing rule (sweep = recall machine; ✓✕ is
 * the classifier; the machine NEVER claims correctness):
 *   • this sampler deterministically extracts every precision-critical
 *     firing from the fixture corpora, evenly strided, with context;
 *   • `suggested` is a MODEL's provisional read (labeled, never truth,
 *     never consumed by the core);
 *   • `ratified` is YOURS: edit samples.jsonl ("yes" / "no" / "unsure"),
 *     or mark the REVIEW.md sheet and have any session sync it.
 *
 * Regeneration MERGES existing annotations by id, so ratifications
 * survive resampling. golden/calculus-precision.mjs pins the sample:
 * any rule change that alters which moves fire must visit this protocol
 * loudly (resample + carry ratifications), never silently.
 *
 *   node golden/precision-sample.mjs     # (re)generate samples + REVIEW.md
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (p) => import(pathToFileURL(join(HERE, '..', 'src', 'discourse', p)).href);
const { reduce } = await imp('calculus/scoreboard.mjs');
const { recognizeEvents } = await imp('calculus/moves.mjs');
const { transcriptToTurns } = await imp('calculus/turns.mjs');

export const FILES = [
  ['nenko', 'nenko-hGdbIzNsDw8.md'],
  ['imiron', 'imiron-fe5kdBLS8wM.md'],
];

// Precision-critical moves (they write CG/Projected/QUD — drill trust rides
// on them) with per-file sampling caps. ACKNOWLEDGE is excluded (low stakes).
export const SPEC = [
  { prim: 'CONSCRIPT', cap: 12 },
  { prim: 'GRANT', cap: 12 },
  { prim: 'RATIFY', cap: 10 },
  { prim: 'REJECT', cap: 8 },
  { prim: 'SUBSTITUTE', cap: 8 },
  { prim: 'PROJECT_CONSEQUENCE', cap: 8 },
  { prim: 'DENY_COMMITMENT', cap: 8 },
  { prim: 'RE_TYPE', cap: 8 },
  { prim: 'RETRACT_OWN', cap: 8 },
  { prim: 'SHELVE_QUD', cap: 8 },
  { prim: 'RESUME_QUD', cap: 8 },
];
const KIND_FOR = {
  CONSCRIPT: 'place:conscript', GRANT: 'concede', RATIFY: 'uptake', REJECT: 'reject',
  SUBSTITUTE: 'substitute', PROJECT_CONSEQUENCE: 'project', DENY_COMMITMENT: 'deny',
  RE_TYPE: 'retype', SHELVE_QUD: 'shelve', RESUME_QUD: 'resume', RETRACT_OWN: 'repair',
};

const fmt = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return h ? `${h}:${mm}` : mm;
};
/** Even deterministic stride: first-N biases to the opening; this spreads. */
const stride = (arr, cap) => {
  if (arr.length <= cap) return [...arr];
  const out = [];
  for (let i = 0; i < cap; i++) out.push(arr[Math.floor(i * arr.length / cap)]);
  return [...new Set(out)];
};

export function buildSamples() {
  const out = [];
  for (const [key, file] of FILES) {
    const md = readFileSync(join(HERE, 'fixtures', file), 'utf8');
    const { turns } = transcriptToTurns(md);
    const board = reduce(turns, recognizeEvents);
    const list = board.turns;
    const turnAtOrBefore = (tSec) => {
      let ti = list.findIndex(t => t.tSec === tSec);
      if (ti < 0) { ti = 0; for (let i = 0; i < list.length; i++) if (list[i].tSec <= tSec) ti = i; else break; }
      return ti;
    };
    const byPrim = {};
    for (const l of board.log) (byPrim[l.prim] ??= []).push(l);

    // id = file:tSec:prim — STABLE across resampling (a stride index would
    // churn ids and orphan ratifications); collisions get a :2 suffix.
    const seen = new Map();
    const mkId = (base) => {
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return n === 1 ? base : `${base}:${n}`;
    };
    for (const { prim, cap } of SPEC) {
      stride(byPrim[prim] ?? [], cap).forEach((l) => {
        const ti = turnAtOrBefore(l.tSec);
        const t = list[ti];
        const ev = t ? recognizeEvents(t.text).events.filter(e => e.kind === KIND_FOR[prim]) : [];
        out.push({
          id: mkId(`${key}:${l.tSec}:${prim}`),
          video: key, tSec: l.tSec, at: fmt(l.tSec), prim, speaker: l.speaker,
          surface: ev.map(e => `${e.surface}⟨${e.src}⟩`).join(' ') || l.note || '',
          boundTo: (l.ref ?? '').slice(0, 64),
          prev: (list[ti - 1]?.text ?? '').slice(0, 80),
          text: (t?.text ?? '(grounding event)').slice(0, 170),
          suggested: null, reason: '', ratified: null,
        });
      });
    }
    stride(board.dynamics.filter(d => d.kind === 'TACIT_CG'), 8).forEach((d, i) => {
      const ti = turnAtOrBefore(d.tSec);
      out.push({
        id: `${key}:${d.tSec}:TACIT_CG:${i}`,
        video: key, tSec: d.tSec, at: fmt(d.tSec), prim: 'TACIT_CG', speaker: '',
        surface: '(conscription unchallenged for 6 turns → slid into CG)',
        boundTo: (d.ref ?? '').slice(0, 64),
        prev: '', text: (list[ti]?.text ?? '').slice(0, 170),
        suggested: null, reason: '', ratified: null,
      });
    });
  }
  return out;
}

// ── merge-preserving regeneration + REVIEW.md ─────────────────────────
const DIR = join(HERE, 'precision');
const SAMPLES = join(DIR, 'samples.jsonl');
const REVIEW = join(DIR, 'REVIEW.md');

export function loadSamples() {
  if (!existsSync(SAMPLES)) return [];
  return readFileSync(SAMPLES, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function writeAll(samples) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(SAMPLES, samples.map(s => JSON.stringify(s)).join('\n') + '\n', 'utf8');
  const byPrim = {};
  for (const s of samples) (byPrim[s.prim] ??= []).push(s);
  const mark = (v) => v === 'yes' ? '✓' : v === 'no' ? '✕' : v === 'unsure' ? '?' : '·';
  let mdOut = `# 🔴 move-precision review — suggested vs ratified

The machine SUGGESTS (a model's provisional read — never truth, never fed to
the core). **You ratify**: set \`ratified\` in \`samples.jsonl\` to \`"yes"\` /
\`"no"\` / \`"unsure"\` — or mark rows here (✓/✕/?) and tell any session to sync.
Precision counts only ratified rows. Suggested-precision is provisional by
definition. Generated deterministically from golden/fixtures/; regeneration
preserves annotations by id.\n`;
  for (const [prim, rows] of Object.entries(byPrim)) {
    const sug = rows.filter(r => r.suggested === 'yes').length;
    mdOut += `\n## ${prim} — ${rows.length} sampled · suggested ✓ ${sug}/${rows.length}\n`;
    for (const r of rows) {
      mdOut += `\n**[${mark(r.ratified)}] ${r.id}** \`${r.at}\` ${r.video} — suggested **${mark(r.suggested)}** ${r.reason ? '— ' + r.reason : ''}\n`;
      if (r.prev) mdOut += `> prev: ${r.prev}\n`;
      mdOut += `> **${r.text}**\n`;
      if (r.surface) mdOut += `> trigger: ${r.surface}\n`;
      if (r.boundTo) mdOut += `> bound to: ${r.boundTo}\n`;
    }
  }
  writeFileSync(REVIEW, mdOut, 'utf8');
}

export function regenerate() {
  const fresh = buildSamples();
  const old = new Map(loadSamples().map(s => [s.id, s]));
  for (const s of fresh) {
    const o = old.get(s.id);
    if (o) { s.suggested = o.suggested; s.reason = o.reason; s.ratified = o.ratified; }
  }
  writeAll(fresh);
  return fresh;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const samples = regenerate();
  const counts = {};
  for (const s of samples) counts[s.prim] = (counts[s.prim] ?? 0) + 1;
  console.log(`wrote ${samples.length} samples → golden/precision/samples.jsonl + REVIEW.md`);
  console.log(Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' '));
}
