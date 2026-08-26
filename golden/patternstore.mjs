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

console.log('══ AUDIT-PARTS §3 — untimed media keep every sighting ══');
// The key was `file|tStartSec|source`. Prose and tweets have no tStartSec, so
// every sighting inside ONE Kindle note or ONE long-form post collapsed to the
// same key and `upsertEntry` silently dropped all but the first — a book with
// 40 sightings stored one, forever. The quote is what distinguishes them.
{
  const store = new P.PatternStore(async () => {});
  const book = (q) => ({ source: 'web', medium: 'book', file: '読書/夜は短し.md', tStartSec: null, quote: q, status: 'suggested', addedAt: 1 });
  const quotes = ['気になる人がいた', 'それが気になるところだ', '気になるなら聞けばいい'];
  await store.record('気になる', book(quotes[0]), 1);
  const id = store.all()[0].id;
  await store.addAttestations(quotes.slice(1).map((q) => ({ id, att: book(q) })), 2);
  const e = store.byId(id);
  check('three sightings in ONE untimed note all survive', e.attestations.length === 3, `${e.attestations.length}`);
  check('their keys are distinct', new Set(e.attestations.map(P.attestationKey)).size === 3);

  // …but a genuine duplicate — same file, same second, same quote — still dedupes.
  await store.addAttestations([{ id, att: book(quotes[0]) }], 3);
  check('an identical re-sighting still dedupes', store.byId(id).attestations.length === 3, `${store.byId(id).attestations.length}`);

  // Timestamped media are unchanged: same file+second, different quote is still
  // two sightings; that was already true and must stay true.
  const vid = (t, q) => ({ source: 'yt', file: 'T.md', tStartSec: t, quote: q, status: 'suggested', addedAt: 1 });
  await store.addAttestations([{ id, att: vid(10, 'a') }, { id, att: vid(20, 'b') }], 4);
  check('timestamped sightings unaffected', store.byId(id).attestations.length === 5, `${store.byId(id).attestations.length}`);
}

console.log('══ AUDIT-PARTS §3 — a ✕ written under the OLD key still blocks ══');
// rejectedAtts persists across the key change. Re-proposing everything the user
// had already rejected would be worse than the bug being fixed.
{
  const store = new P.PatternStore(async () => {});
  const att = { source: 'web', medium: 'book', file: 'B.md', tStartSec: null, quote: 'これは違う', status: 'suggested', addedAt: 1 };
  await store.record('気になる', { ...att, quote: 'seed' }, 1);
  const id = store.all()[0].id;
  const e = store.byId(id);
  e.rejectedAtts = [P.legacyAttestationKey(att)];        // as written before the fix
  check('legacy key is the old 3-part shape', P.legacyAttestationKey(att) === 'B.md||web', P.legacyAttestationKey(att));
  check('the new key differs from it', P.attestationKey(att) !== P.legacyAttestationKey(att));
  check('isRejected honours the legacy key', P.isRejected(e, att));
  await store.addAttestations([{ id, att }], 2);
  check('a legacy-rejected sighting is NOT re-added',
    !store.byId(id).attestations.some((a) => a.quote === 'これは違う'));
}

console.log('══ PHYSICS §5 — a question is a capture with attestations: [] ══');
{
  const store = new P.PatternStore(async () => {});
  // Born as a wondering: no sighting exists, so none may be minted.
  const q = await store.recordClassified({
    note: 'もし〜たなら', cls: 'skeletal', payload: { parts: ['もし', 'たなら'] }, att: null, standing: true,
  }, 1);
  check('standing entry born with attestations: []', q.standing === true && q.attestations.length === 0);
  // The answer arrives through the ordinary suggested road, and the mark stays:
  // a filled hole stays visible (§27 rule 3).
  await store.addAttestations([{ id: q.id, att: {
    source: 'yt', file: 'T.md', tStartSec: 5, quote: 'もし行けたなら', addedAt: 2,
    status: 'suggested', matchKind: 'link', confidence: 0.6,
  } }], 2);
  check('an answer lands as suggested; standing survives',
    store.byId(q.id).attestations.length === 1 && store.byId(q.id).standing === true);
  // Standing marks only an entry BORN by the filing — an existing entry keeps
  // the mute record its own ✕s earned.
  const normal = await store.recordClassified({
    note: '気を抜く', cls: 'collocation', payload: {}, att: { source: 'yt', file: 'U.md', tStartSec: 1, quote: '気を抜いた', addedAt: 3 },
  }, 3);
  const again = await store.recordClassified({
    note: '気を抜く', cls: 'collocation', payload: {}, att: null, standing: true,
  }, 4);
  check('re-filing an existing key does not retro-mark it standing',
    again.id === normal.id && !store.byId(normal.id).standing);
  // Round-trip: the flag is data, not session state.
  let saved = null;
  const store2 = new P.PatternStore(async (d) => { saved = d; });
  await store2.recordClassified({ note: 'まさか〜とは', cls: 'skeletal', payload: {}, att: null, standing: true }, 5);
  const fresh = new P.PatternStore(async () => {});
  fresh.load(saved);
  check('standing round-trips through load()', fresh.all()[0]?.standing === true);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} patternstore: ${pass}/${pass + fail} checks passed`);
process.exitCode = fail === 0 ? 0 : 1;
