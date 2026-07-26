/**
 * golden/patternstore.mjs — the pattern-lexicon spine (core-diagnosis P1).
 *
 * Proves the catalog contract: the user's notation drives key derivation
 * (〜 link / 「○○」 frame / surface), the same pattern sighted in different
 * videos accumulates ONE entry with deduped attestations, and class
 * suggestions stay overridable.
 *
 * Run:  node golden/patternstore.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (p) => import(pathToFileURL(join(HERE, '..', 'src', 'notes', p)).href);
const P = await load('pattern-store.ts');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('══ derivation from the handwriting notation ══');
const link = P.derivePattern('んだったら〜なきゃ');
check('〜 parts → link key + 🟠 suggestion', link.keyKind === 'link' && link.key === 'んだったら〜なきゃ' && link.suggestedClass === 'skeletal');
check('link payload carries components', JSON.stringify(link.payload.parts) === '["んだったら","なきゃ"]');
const frame = P.derivePattern('「○○」が有効な反論');
check('○○ slot → frame key + 💠 suggestion', frame.keyKind === 'frame' && frame.suggestedClass === 'phrase_schema');
const surf = P.derivePattern('手先が器用');
check('plain note → surface key + 🟡 suggestion', surf.keyKind === 'surface' && surf.key === '手先が器用' && surf.suggestedClass === 'serifu');
check('stable id from kind+key', P.patternIdFor(link) === P.patternIdFor(P.derivePattern('んだったら〜なきゃ')));
check('different kinds never collide', P.patternIdFor(link) !== P.patternIdFor(surf));

console.log('══ accumulation (the whole point) ══');
{
  const att = (file, sec) => ({ source: 'yt', file, tStartSec: sec, blockId: 'b', anchorId: 'a', quote: 'q', addedAt: 1 });
  let e = P.upsertEntry(undefined, 'んだったら〜なきゃ', att('Transcripts/A.md', 100), 1);
  e = P.upsertEntry(e, 'んだったら〜なきゃ', att('Transcripts/B.md', 55), 2);
  check('two videos → ONE entry, two attestations', e.attestations.length === 2 && e.id === P.patternIdFor(link));
  const before = e.attestations.length;
  e = P.upsertEntry(e, 'んだったら〜なきゃ', att('Transcripts/A.md', 100), 3);
  check('re-running the same video does not duplicate', e.attestations.length === before);
  e = P.upsertEntry(e, 'んだったら〜なきゃ', null, 4);
  check('unanchored sighting touches the entry, adds nothing', e.attestations.length === before && e.updatedAt === 4);
  check('suggested class not marked ratified', e.classRatified === false);
}

console.log('══ corpus-join probes + anchor upgrade (P3) ══');
{
  check('link sweeps by ALL components', JSON.stringify(P.sweepTerms(link)) === '["んだったら","なきゃ"]');
  check('frame sweeps by fixed material around ○○', JSON.stringify(P.sweepTerms(P.derivePattern('「○○」が有効な反論'))) === '["が有効な反論"]');
  check('surface sweeps by itself', JSON.stringify(P.sweepTerms(surf)) === '["手先が器用"]');
  check('1-char surface is not sweepable', P.sweepTerms({ keyKind: 'surface', key: 'ね', payload: {} }).length === 0);

  // sweep finds it first (no anchor), the pen anchors it later → upgrade in place
  const sweepAtt = { source: 'yt', file: 'T.md', tStartSec: 42, quote: 'q', addedAt: 1 };
  let e = P.upsertEntry(undefined, '手先が器用', sweepAtt, 1);
  check('swept sighting has no anchor', e.attestations.length === 1 && !e.attestations[0].anchorId);
  e = P.upsertEntry(e, '手先が器用', { ...sweepAtt, anchorId: 'recon-abc', blockId: 'b1', addedAt: 2 }, 2);
  check('hand-anchoring the same spot upgrades, not duplicates', e.attestations.length === 1 && e.attestations[0].anchorId === 'recon-abc');
  e = P.upsertEntry(e, '手先が器用', { ...sweepAtt, addedAt: 3 }, 3);
  check('a later sweep never downgrades the anchor', e.attestations[0].anchorId === 'recon-abc');
}

console.log('══ store persistence + class ratification ══');
{
  let saved = null;
  const store = new P.PatternStore(async (d) => { saved = d; });
  await store.record('が違えば〜と思う一方で', { source: 'yt', file: 'T.md', tStartSec: 9, quote: 'q', addedAt: 1 }, 1);
  await store.record('が違えば〜と思う一方で', { source: 'yt', file: 'U.md', tStartSec: 3, quote: 'q2', addedAt: 2 }, 2);
  check('store dedupes by pattern', store.size() === 1 && store.all()[0].attestations.length === 2);
  const id = store.all()[0].id;
  await store.setClass(id, 'phrase_schema');
  check('class override ratifies', store.byId(id).class === 'phrase_schema' && store.byId(id).classRatified === true);
  check('persisted via injected save', saved && saved.entries.length === 1);
  const fresh = new P.PatternStore(async () => {});
  fresh.load(saved);
  check('round-trips through load()', fresh.size() === 1 && fresh.byId(id).classRatified === true);
  await store.remove(id);
  check('remove works', store.size() === 0);
}

console.log('══ §26.2 rejected examples feed the personal ❗ box ══');
{
  const store = new P.PatternStore(async () => {});
  const mk = (i) => ({ source: 'yt', file: `R${i}.md`, tStartSec: i, quote: `bad${i}`, status: 'suggested', addedAt: i });
  for (let i = 1; i <= 6; i++) await store.record('気になる', mk(i), i);
  const id = store.all()[0].id;
  for (let i = 1; i <= 6; i++) await store.rejectAttestation(id, P.attestationKey(mk(i)));
  const e = store.byId(id);
  check('✕ quotes captured, capped at 5, newest kept',
    (e.rejectedExamples ?? []).length === 5 && e.rejectedExamples[4] === 'bad6' && !e.rejectedExamples.includes('bad1'));
  check('rejectedAtts remembers ALL keys (sweep never re-proposes)', (e.rejectedAtts ?? []).length === 6);
  check('rejected attestations removed from the entry', e.attestations.length === 0);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} patternstore: ${pass}/${pass + fail} checks passed`);
process.exitCode = fail === 0 ? 0 : 1;
