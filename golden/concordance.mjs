/**
 * golden/concordance.mjs — the MOVE CONCORDANCE on the real corpora.
 *
 * This is the §11 fail-branch product. Its contract is deliberately narrower
 * than the board's, and the checks below enforce the narrowness as hard as they
 * enforce the coverage:
 *
 *   • it must FIND the instances the seam fix unlocked (recall), and
 *   • it must never claim what the speaker was DOING (the demotion), and
 *   • every row must carry a door back (§28 S2).
 *
 *   node golden/concordance.mjs
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (p) => import(pathToFileURL(join(HERE, '..', 'src', 'discourse', p)).href);
const { transcriptToTurns } = await imp('calculus/turns.mjs');
const {
  buildConcordance, groupByMarker, uptakeProfile, positionProfile,
  toAttestations, positionOf, CONCORDANCE_MARKERS,
} = await imp('concordance.mjs');

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => {
  n++;
  if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg} ${extra}`);
};

const load = (f) => transcriptToTurns(readFileSync(join(HERE, 'fixtures', f), 'utf8'));

// ── position classifier: pure, and the thing precision rests on ──
console.log('══ position (the only thing this file asserts) ══');
ok(positionOf('面白いですよね', 3, 'ですよね') === 'final', 'turn-final marker is final');
ok(positionOf('面白いですよね。', 3, 'ですよね') === 'final', 'punctuation after = still final');
ok(positionOf('面白いですよねだからやる価値がある', 3, 'ですよね') === 'medial',
  'marker with substantive material after = medial');
ok(positionOf('そうですよね、はい', 3, 'ですよね') === 'clausal', 'comma then short tail = clausal');

// ── longest-first: ですよね must never be recorded as a bare よね ──
console.log('\n══ longest-first (a concordance keyed on the wrong span is worthless) ══');
{
  const rows = buildConcordance([{ tSec: 0, speaker: 'A', text: '面白いですよね' }]);
  ok(rows.length === 1, 'one marker recorded, not two', `(${rows.map(r => r.marker).join(',')})`);
  ok(rows[0].marker === 'ですよね', 'the LONGER marker wins', `(${rows[0].marker})`);
}
{
  const rows = buildConcordance([{ tSec: 0, speaker: 'A', text: 'それ有利じゃないですかね' }]);
  ok(rows.length === 1 && rows[0].marker === 'じゃないですかね',
    'じゃないですかね is not split into じゃないですか + ね', `(${rows.map(r => r.marker).join(',')})`);
}

// ── uptake is OBSERVED, never inferred ──
console.log('\n══ uptake is an observation about the next turn ══');
{
  const rows = buildConcordance([
    { tSec: 0, speaker: 'A', text: 'これは難しいですよね' },
    { tSec: 5, speaker: 'B', text: 'なるほど確かに' },
  ]);
  ok(rows[0].uptake === 'accept', 'なるほど in the next turn = accept', `(${rows[0].uptake})`);
}
{
  const rows = buildConcordance([
    { tSec: 0, speaker: 'A', text: 'これは難しいですよね' },
    { tSec: 5, speaker: 'B', text: 'いやそれは違うと思います' },
  ]);
  ok(rows[0].contested === true, 'いや-initial next turn = contested');
  ok(rows[0].uptake !== 'accept', 'a contested next turn is not scored as acceptance');
}
{
  const rows = buildConcordance([{ tSec: 0, speaker: 'A', text: 'これは難しいですよね' }]);
  ok(rows[0].uptake === null && rows[0].contested === false,
    'no next turn = no claim either way (not "unchallenged therefore CG")');
}

// ── THE DEMOTION: the move label may ride along, never key or dominate ──
console.log('\n══ the move label is demoted (§12) ══');
{
  const { turns } = load('nenko-hGdbIzNsDw8.md');
  const rows = buildConcordance(turns, { source: { source: 'yt', file: 'nenko.md', videoId: 'hGdbIzNsDw8' } });
  ok(rows.every((r) => typeof r.marker === 'string' && r.marker.length > 0),
    'every row is keyed on the MARKER');
  ok(rows.some((r) => r.opId === null),
    'rows survive with no operator hint at all (the marker is the unit)');
  const grouped = groupByMarker(rows);
  ok(grouped.every((e) => typeof e.marker === 'string'),
    'entries are keyed on the marker, never on a move name');
  // §28 S2 — a row with no door back is an orphan
  ok(rows.every((r) => r.source && r.source.file),
    'every row carries provenance (§28 S2)');
  const atts = grouped.flatMap((e) => toAttestations(e, 0));
  ok(atts.every((a) => a.status === 'suggested'),
    'every attestation is SUGGESTED — the machine never asserts (§28 S3)', `(${atts.length})`);
  ok(atts.every((a) => a.tStartSec != null),
    'every attestation is timestamped (you can go hear it)');
}

// ── recall: the instances the seam fix unlocked must actually be here ──
console.log('\n══ nenko (33 min, punctuated) ══');
{
  const { turns } = load('nenko-hGdbIzNsDw8.md');
  const rows = buildConcordance(turns, { source: { source: 'yt', file: 'nenko.md' } });
  const g = groupByMarker(rows);
  console.log(`   ${turns.length} turns → ${rows.length} marker instances across ${g.length} markers`);
  for (const e of g.slice(0, 8)) {
    const p = positionProfile(e.rows);
    console.log(`     ${e.marker.padEnd(12)} ×${String(e.count).padStart(3)}  ` +
      `[final ${p.final} / clausal ${p.clausal} / medial ${p.medial}]  ` +
      `→ accept ${e.uptake.accept} ack ${e.uptake.ack} 反 ${e.uptake.contested} 無 ${e.uptake.none}`);
  }
  ok(rows.length >= 100, 'nenko yields a usable concordance', `(${rows.length})`);
}

console.log('\n══ 意味論 (3h03m, unpunctuated ASR — where the seam bit hardest) ══');
{
  const { turns } = load('imiron-fe5kdBLS8wM.md');
  const rows = buildConcordance(turns, { source: { source: 'yt', file: 'imiron.md' } });
  const g = groupByMarker(rows);
  console.log(`   ${turns.length} turns → ${rows.length} marker instances across ${g.length} markers`);
  for (const e of g.slice(0, 10)) {
    const p = positionProfile(e.rows);
    console.log(`     ${e.marker.padEnd(12)} ×${String(e.count).padStart(3)}  ` +
      `[final ${p.final} / clausal ${p.clausal} / medial ${p.medial}]  ` +
      `→ accept ${e.uptake.accept} ack ${e.uptake.ack} 反 ${e.uptake.contested} 無 ${e.uptake.none}`);
  }
  const find = (m) => g.find((e) => e.marker === m)?.count ?? 0;
  // §5.2's table: these are the markers the board could not see.
  ok(find('じゃないですか') >= 40, 'じゃないですか recovered (board saw 7)', `(${find('じゃないですか')})`);
  ok(find('ですよね') >= 60, 'ですよね recovered (board saw 3)', `(${find('ですよね')})`);
  // §5.2 counted 184 よね by raw substring — i.e. the whole family, including
  // every ですよね/んですよね. The concordance keys longest-first (that is the
  // point), so the family total is the comparable number, not bare よね.
  const yoneFamily = g.filter((e) => e.marker.endsWith('よね')).reduce((a, e) => a + e.count, 0);
  ok(yoneFamily >= 150, 'the よね family recovered (board saw 8 of 184)', `(${yoneFamily})`);
  ok(find('じゃん') >= 8, 'じゃん recovered (board saw 0)', `(${find('じゃん')})`);
  ok(rows.length >= 600, 'the 3-hour file yields a real corpus', `(${rows.length})`);

  // the honest headline: most instances are NOT turn-final. That is exactly
  // why a sentence-final matcher over merged turns saw almost nothing.
  const all = positionProfile(rows);
  const medialShare = (all.medial + all.clausal) / rows.length;
  console.log(`   position overall: final ${all.final} / clausal ${all.clausal} / medial ${all.medial}` +
    `  →  ${(100 * medialShare).toFixed(0)}% are NOT turn-final`);
  ok(medialShare > 0.5, 'majority of real instances are not turn-final (the seam, quantified)',
    `(${(100 * medialShare).toFixed(0)}%)`);
}

// ── determinism ──
console.log('\n══ determinism ══');
{
  const { turns } = load('nenko-hGdbIzNsDw8.md');
  const a = JSON.stringify(buildConcordance(turns));
  const b = JSON.stringify(buildConcordance(turns));
  ok(a === b, 'buildConcordance is byte-deterministic');
}

console.log(`\n${fail ? '✗' : '✓'} concordance: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
