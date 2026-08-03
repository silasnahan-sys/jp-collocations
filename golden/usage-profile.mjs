/**
 * golden/usage-profile.mjs — 使われ方, the answer to an unclearable queue.
 *
 * 32 discourse entries in the shipped catalog hold 17,891 of its 18,065
 * sightings, every one unratified, against 174 the user has confirmed in total.
 * 「ですね」 alone carries 3,565. The 候補 list showed twelve of them.
 *
 * `buildUsageProfile` reads the sweep's own `matchKind` back — which recorded
 * the discourse move on every single sighting and was never displayed — and
 * turns the pile into a distribution. The counts below are the REAL ones from
 * data.json, so this suite proves the fold on the actual shape of the problem.
 *
 * Run:  node golden/usage-profile.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CT = await import(pathToFileURL(join(HERE, '..', 'src', 'lexicon', 'context-tree.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const sugg = (matchKind, quote) => ({
  source: 'yt', file: 'f.md', quote, addedAt: 1, status: 'suggested', matchKind,
});
const pat = (key, atts) => ({
  id: 'p-' + key, class: 'discourse', classRatified: true, keyKind: 'surface',
  key, note: key, payload: {}, attestations: atts, createdAt: 1, updatedAt: 1,
});
/** n sightings of one kind, with distinguishable quotes. */
const many = (n, kind, stem) => Array.from({ length: n }, (_, i) => sugg(kind, `${stem}という話${i}`));

console.log('\n══ below the threshold the ✓/✕ list is still the honest interface ══');
{
  check('9 sightings → no profile', CT.buildUsageProfile(pat('X', many(9, 'concordance:final:AGREE-MARK', 'あ'))) === null);
  check('39 sightings → still no profile', CT.buildUsageProfile(pat('X', many(39, 'concordance:final:AGREE-MARK', 'あ'))) === null);
  check('40 sightings → profile', CT.buildUsageProfile(pat('X', many(40, 'concordance:final:AGREE-MARK', 'あ'))) !== null);
}

console.log('\n══ 「ですね」 as it actually is in the catalog ══');
{
  // The real distribution: AGREE-MARK dominates, split final/clausal.
  const atts = [
    ...many(787, 'concordance:final:AGREE-MARK', 'そう'),
    ...many(1087, 'concordance:clausal:AGREE-MARK', 'はい'),
    ...many(577, 'concordance:final:CONFIRMATION-SEEK', 'これ'),
    ...many(407, 'concordance:final:GROUND-CLAIM', 'つまり'),
    ...many(300, 'concordance:medial', 'えー'),        // position only, no move
  ];
  const p = CT.buildUsageProfile(pat('ですね', atts));
  check('a profile is produced', !!p);
  check('total counts EVERY sighting, not the 12 the list shows', p.total === 3158, String(p.total));
  check('classified excludes the position-only ones', p.classified === 2858, String(p.classified));
  check('AGREE-MARK leads', p.moves[0].move === 'AGREE-MARK', p.moves[0].move);
  check('and is summed across final + clausal', p.moves[0].count === 1874, String(p.moves[0].count));
  check('shares are of the CLASSIFIED total, not the raw pile',
    Math.abs(p.moves[0].share - 1874 / 2858) < 1e-9, String(p.moves[0].share));
  check('shares sum to 1', Math.abs(p.moves.reduce((n, m) => n + m.share, 0) - 1) < 1e-9);
  check('moves are ordered by count', p.moves.every((m, i) => i === 0 || p.moves[i - 1].count >= m.count));
  check('the move is glossed in Japanese, not shown as an internal id',
    p.moves[0].label === '同意を示す', p.moves[0].label);
  check('every move carries real lines as evidence', p.moves.every((m) => m.examples.length > 0));
  check('evidence is capped at 3', p.moves.every((m) => m.examples.length <= 3));
  // 文末 leads on the sum across moves (787 + 577 + 407), ahead of 節末's 1087 —
  // the position tally is over sightings, not over move rows.
  check('positions cover all three, position-only included, biggest first',
    p.positions.length === 3 &&
    p.positions[0].position === 'final' && p.positions[0].count === 1771 &&
    p.positions[1].position === 'clausal' && p.positions[1].count === 1087 &&
    p.positions[2].position === 'medial' && p.positions[2].count === 300,
    JSON.stringify(p.positions));
  check('positions are glossed too', p.positions.every((x) => /文末|節末|文中/.test(x.label)),
    JSON.stringify(p.positions.map((x) => x.label)));
}

console.log('\n══ evidence is evidence: deduped, readable, never a bare link ══');
{
  const atts = [
    ...Array.from({ length: 50 }, () => sugg('concordance:final:AGREE-MARK', 'まったく同じ行')),
    sugg('concordance:final:AGREE-MARK', 'あ'),                                        // too short
    // The real defect this guard exists for: the sweep matches inside raw
    // transcript text, so the first draft offered a bare deep link as proof
    // that 「ですね」 marks agreement.
    sugg('concordance:final:AGREE-MARK', '(https://youtu.be/0z91Gp-V8fE?t=65'),
    sugg('concordance:final:AGREE-MARK', '![[Transcripts/x.md#^recon-1]]'),
    sugg('concordance:final:AGREE-MARK', 'ABCDEFGH'),                                  // no Japanese
    sugg('concordance:final:AGREE-MARK', 'これは別の行です'),
  ];
  const p = CT.buildUsageProfile(pat('ね', atts));
  const ex = p.moves[0].examples;
  check('the same line 50 times counts as one example', ex.filter((q) => q === 'まったく同じ行').length === 1, JSON.stringify(ex));
  check('a 1-character quote is not evidence', !ex.includes('あ'), JSON.stringify(ex));
  check('a bare deep link is not evidence', !ex.some((q) => q.includes('youtu.be')), JSON.stringify(ex));
  check('an embed is not evidence', !ex.some((q) => q.includes('[[')), JSON.stringify(ex));
  check('a line with no Japanese is not evidence', !ex.includes('ABCDEFGH'), JSON.stringify(ex));
  check('the readable lines ARE evidence',
    ex.includes('まったく同じ行') && ex.includes('これは別の行です'), JSON.stringify(ex));
  check('but the count still includes every sighting', p.moves[0].count === 55, String(p.moves[0].count));
}

console.log('\n══ a position-only sweep says nothing rather than something wrong ══');
{
  const p = CT.buildUsageProfile(pat('かな', many(200, 'concordance:medial', 'えー')));
  check('no named move → no profile at all', p === null);
}

console.log('\n══ confirmed sightings are not swept into the distribution ══');
{
  const atts = [
    ...many(60, 'concordance:final:AGREE-MARK', 'そう'),
    { source: 'yt', file: 'f.md', quote: 'これは確定した用例', addedAt: 1 },   // no status = confirmed
  ];
  const p = CT.buildUsageProfile(pat('ですね', atts));
  check('total is the suggested pile only', p.total === 60, String(p.total));
  check('the confirmed line is not used as profile evidence',
    !p.moves.some((m) => m.examples.includes('これは確定した用例')));
}

console.log('\n══ an unrecognised matchKind is skipped, not guessed at ══');
{
  const atts = [...many(45, 'concordance:final:AGREE-MARK', 'そう'), sugg('link', 'リンク由来'), sugg('', '空')];
  const p = CT.buildUsageProfile(pat('ね', atts));
  check('total still counts them (they ARE sightings)', p.total === 47, String(p.total));
  check('but they add no move', p.moves.reduce((n, m) => n + m.count, 0) === 45);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} usage-profile: ${pass}/${pass + fail} checks passed`);
if (fail) process.exitCode = 1;
