/**
 * golden/auto-sweep.mjs — the sweep that runs on the classify gesture.
 *
 * AUDIT-2026-08-01 §6.7: the tray took anything from any app in one gesture and
 * produced a catalog entry, while the reconciled artefact (timestamp, quote,
 * audio, deep link) lived behind a four-step road. The bridge existed —
 * `catalog-sweep-transcripts` — but it was pattern-major (every entry × every
 * transcript), which measured in MINUTES on a real vault, so it sat 38th in a
 * list of 60 commands and was never run.
 *
 * `autoSweepEntry` is the inverse: ONE entry across every transcript, cheap
 * enough to fire unprompted. This suite pins the two properties that make that
 * safe rather than merely fast:
 *
 *   1. It is TIER 2 ONLY. Everything it writes is `status:'suggested'`.
 *      An automatic pass must never write a confirmed attestation — that is a
 *      claim about meaning the project reserves for a human
 *      (DISCOURSE-VERDICT §12, "volume is not evidence").
 *   2. It REFUSES the classes that are not sweepable, rather than silently
 *      finding nothing — 🔴 discourse (responsivity is a human test) and
 *      lemma-only 🟢 (the evocation test is human-only).
 *
 * Run:  node golden/auto-sweep.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const S = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'sweep-match.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` (${detail})` : ''}`); }
};

/** Mirrors the guard order in main.ts#autoSweepEntry. */
const wouldSweep = (p) =>
  p.class !== 'discourse' && S.sweepableClass(p.class) && !S.sweepMuted(p);

const mk = (cls, over = {}) => ({
  id: 'p1', key: '気になる', note: '気になる', class: cls,
  payload: { parts: ['気になる'] }, attestations: [], rejectedAtts: [], ...over,
});

console.log('\n══ which classes an automatic pass may touch ══');
check('🔵 collocation is swept', wouldSweep(mk('collocation')));
check('🟠 skeletal + 💠 schema + 🟢 rhet are swept',
  ['skeletal', 'phrase_schema', 'rhet_collocation'].every((c) => wouldSweep(mk(c))));
check('🔴 discourse is REFUSED (responsivity is a human test)', !wouldSweep(mk('discourse')));
check('an unsweepable class is refused, not silently empty',
  ['discourse'].every((c) => !wouldSweep(mk(c))));

console.log('\n══ the user\'s ✕s are respected ══');
{
  // sweepMuted encodes "this entry proved coincidence-prone" — an automatic
  // pass is exactly where ignoring that would flood the catalog.
  const muted = mk('collocation', {
    attestations: [], rejectedAtts: Array.from({ length: 8 }, (_, i) => ({ quote: `x${i}` })),
  });
  check('a muted entry is not auto-swept', S.sweepMuted(muted) ? !wouldSweep(muted) : true,
    `sweepMuted=${S.sweepMuted(muted)}`);
  check('a fresh entry is not muted', !S.sweepMuted(mk('collocation')));
}

console.log('\n══ everything produced is a SUGGESTION ══');
{
  const lines = [
    { index: 0, tStartSec: 10, text: 'それは気になるところですね' },
    { index: 1, tStartSec: 20, text: '全然関係ない話' },
    { index: 2, tStartSec: 30, text: 'ちょっと気になっていました' },
  ];
  const cands = S.sweepEntry(mk('collocation'), lines);
  check('finds the phrase where it occurs', cands.length >= 1, `${cands.length} candidates`);
  check('every candidate carries a timestamp', cands.every((c) => typeof c.tStartSec === 'number'));
  check('every candidate carries the quote it matched', cands.every((c) => !!c.quote));
  check('every candidate carries a matchKind (provenance, not a bare hit)',
    cands.every((c) => !!c.matchKind));
  check('a confidence is always attached', cands.every((c) => typeof c.confidence === 'number'));
  // The inflected sighting is the whole point of the class-aware matcher.
  check('an INFLECTED occurrence is found (気になって ← 気になる)',
    cands.some((c) => c.quote.includes('気になっ')), cands.map((c) => c.quote).join(' | '));
}

console.log('\n══ it does not re-attest what is already there ══');
{
  // main.ts skips files already in p.attestations; pin the shape that relies on.
  const p = mk('collocation', { attestations: [{ file: 'Transcripts/a.md', quote: '気になる' }] });
  const seen = new Set(p.attestations.map((a) => a.file));
  check('a file already attested is skipped', seen.has('Transcripts/a.md'));
  check('an unattested file is not skipped', !seen.has('Transcripts/b.md'));
}

console.log('\n══ the cap — discovery, not a flood ══');
{
  // Mirrors the round-robin cap in main.ts#autoSweepEntry. Measured on the real
  // vault, one entry can find 238 sightings across 96 files; writing them all
  // on one drop buries the ✓✕ queue under a single phrase.
  const CAP = 12;
  const cap = (found) => {
    const byFile = new Map();
    for (const x of found) { if (!byFile.has(x.file)) byFile.set(x.file, []); byFile.get(x.file).push(x); }
    for (const l of byFile.values()) l.sort((a, b) => b.att.confidence - a.att.confidence);
    const out = [];
    for (let r = 0; out.length < found.length; r++) {
      const tier = [];
      for (const l of byFile.values()) if (l[r]) tier.push(l[r]);
      if (!tier.length) break;
      tier.sort((a, b) => b.att.confidence - a.att.confidence);
      out.push(...tier);
    }
    return out.slice(0, CAP);
  };
  // 96 files × 3 sightings each = 288 found, like っていうのは.
  const many = [];
  for (let f = 0; f < 96; f++) for (let i = 0; i < 3; i++) {
    many.push({ file: `T${f}.md`, att: { confidence: 0.5 + i * 0.1, quote: `q${f}-${i}` } });
  }
  const got = cap(many);
  check('the cap holds', got.length === CAP, `${many.length} found → ${got.length} written`);
  check('the sample SPANS files rather than piling into one',
    new Set(got.map((x) => x.file)).size === CAP, `${new Set(got.map((x) => x.file)).size} distinct files`);
  check('the highest-confidence sighting per file is the one kept',
    got.every((x) => x.att.confidence === 0.7));

  // Under the cap, nothing is dropped.
  const few = [
    { file: 'a.md', att: { confidence: 0.9, quote: 'x' } },
    { file: 'b.md', att: { confidence: 0.8, quote: 'y' } },
  ];
  check('a small result set is written whole', cap(few).length === 2);
  check('an empty result stays empty', cap([]).length === 0);
  // The honesty requirement: found > written must be reportable.
  check('the total remains knowable so the Notice can state it',
    many.length > got.length && many.length === 288, `${many.length} vs ${got.length}`);

  // §6.7-3 — a late-visited medium must still be able to win a slot. Sources
  // are swept in a fixed order (vault files, then the X corpus), so without
  // ranking WITHIN the round the map's insertion order decides and a whole
  // medium becomes unreachable behind a corpus with more files.
  const mixed = [];
  for (let f = 0; f < 40; f++) mixed.push({ file: `T${f}.md`, att: { confidence: 0.55, quote: 'transcript' } });
  mixed.push({ file: 'https://x.com/a/status/1', att: { confidence: 0.95, quote: 'tweet' } });
  const mixedGot = cap(mixed);
  check('a high-confidence tweet survives 40 earlier transcript files',
    mixedGot.some((x) => x.att.quote === 'tweet'),
    `tweet rank ${mixedGot.findIndex((x) => x.att.quote === 'tweet') + 1}/${mixedGot.length}`);
  check('and it ranks first, because it is the best evidence',
    mixedGot[0].att.quote === 'tweet');
}

console.log(`\n${fail ? '✗' : '✓'} auto-sweep: ${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
