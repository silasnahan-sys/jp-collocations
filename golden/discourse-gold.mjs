/**
 * golden/discourse-gold.mjs — the 🔴 training-data store (DESIGN §13.2) and
 * the classified-capture path into the pattern catalog (§13.1/13.3).
 *
 * Proves: gold identity is stable per (source, utterance); re-capture updates
 * the label without duplicating; agreement stats grade the parser honestly;
 * JSONL is line-per-example; deriveClassified keys each class on its defining
 * unit; the perspectival principle (same span, second class → sibling entry).
 *
 * Run:  node golden/discourse-gold.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const G = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'discourse-gold.ts')).href);
const P = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'pattern-store.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('══ gold identity ══');
{
  const src = { kind: 'yt', file: 'Transcripts/A.md', tStartSec: 120 };
  check('same (source, utterance) → same id', G.goldIdFor(src, 'でも行ったことあるんすよ') === G.goldIdFor({ ...src }, 'でも行ったことあるんすよ'));
  check('different second → different id', G.goldIdFor(src, 'x') !== G.goldIdFor({ ...src, tStartSec: 121 }, 'x'));
  check('different utterance → different id', G.goldIdFor(src, 'a') !== G.goldIdFor(src, 'b'));
}

console.log('══ store: upsert, never duplicate ══');
{
  let saved = null;
  const store = new G.DiscourseGoldStore(async (d) => { saved = d; });
  const base = {
    utterance: 'でも行ったことあるんすよ',
    contextBefore: ['行ったことないでしょ'], contextAfter: ['えっ、まじすか'],
    suggestedAct: 'CONTRASTIVE-REVEAL', suggestedEdge: { kind: 'contrasts', toOffset: 1 },
    act: 'CONTRASTIVE-REVEAL', edge: { kind: 'contrasts', toOffset: 1 },
    source: { kind: 'yt', file: 'T/A.md', tStartSec: 10 }, addedAt: 1,
  };
  await store.add(base);
  await store.add({ ...base, act: 'INFORM', addedAt: 2 });   // relabel same span
  check('re-capture updates, does not duplicate', store.size() === 1);
  check('latest label wins', store.all()[0].act === 'INFORM');
  check('persisted via saveFn', saved && saved.examples.length === 1);
  // roundtrip
  const store2 = new G.DiscourseGoldStore(async () => {});
  store2.load(saved);
  check('load roundtrips', store2.size() === 1 && store2.all()[0].utterance === base.utterance);
}

console.log('══ agreement stats (the scoreboard) ══');
{
  const mk = (act, sAct, edge, sEdge) => ({
    utterance: 'u' + Math.random(), contextBefore: [], contextAfter: [],
    suggestedAct: sAct, suggestedEdge: sEdge, act, edge,
    source: { kind: 'manual' }, addedAt: 1, id: 'x' + Math.random(),
  });
  const s = G.goldStats([
    mk('ANSWER', 'ANSWER', null, null),                                   // act ✓ edge ✓
    mk('INFORM', 'ANSWER', null, null),                                   // act ✗ edge ✓
    mk('ANSWER', 'ANSWER', { kind: 'answers', toOffset: 1 }, { kind: 'answers', toOffset: 2 }), // act ✓ edge ✗
    { ...mk('BACKCHANNEL', undefined, null, undefined), suggestedAct: undefined, suggestedEdge: undefined }, // ungraded
  ]);
  check('total counts everything', s.total === 4);
  check('act agreement = 2/3 (ungraded excluded)', s.actAgreement.agreed === 2 && s.actAgreement.graded === 3);
  check('edge agreement = 2/3', s.edgeAgreement.agreed === 2 && s.edgeAgreement.graded === 3);
  check('byAct counts labels', s.byAct['ANSWER'] === 2 && s.byAct['BACKCHANNEL'] === 1);
}

console.log('══ JSONL export ══');
{
  const rows = [
    { id: 'a', utterance: 'う', contextBefore: [], contextAfter: [], act: 'INFORM', source: { kind: 'manual' }, addedAt: 1 },
    { id: 'b', utterance: 'え', contextBefore: [], contextAfter: [], act: 'ANSWER', source: { kind: 'manual' }, addedAt: 2 },
  ];
  const jsonl = G.toJsonl(rows);
  const lines = jsonl.split('\n');
  check('one example per line', lines.length === 2);
  check('every line parses back', lines.every((l) => JSON.parse(l).utterance));
}

console.log('══ deriveClassified: keys follow the class ══');
{
  const link = P.deriveClassified('だったら〜なきゃ', 'skeletal', { parts: ['んだったら', 'なきゃ'] });
  check('🟠 keys on the LINK from payload parts', link.keyKind === 'link' && link.key === 'んだったら〜なきゃ');
  const frame = P.deriveClassified('というところで納得', 'phrase_schema', { frame: '「○○」というところで納得している' });
  check('💠 keys on the frame', frame.keyKind === 'frame' && frame.key.includes('というところで納得している'));
  const lemma = P.deriveClassified('として破綻している', 'rhet_collocation', { lemma: '破綻', halo: 'として〜している' });
  check('🟢 keys on the LEMMA (gesture catalog)', lemma.keyKind === 'surface' && lemma.key === '破綻');
  const fallback = P.deriveClassified('材質が違えば', 'collocation', {});
  check('payload-less capture falls back to notation', fallback.keyKind === 'surface' && fallback.suggestedClass === 'collocation');
}

console.log('══ recordClassified: ratification + perspectival siblings ══');
{
  const store = new P.PatternStore(async () => {});
  const att = { source: 'x', file: 'https://x.com/u/status/1', tStartSec: null, quote: 'ツイート本文', addedAt: 1 };
  const first = await store.recordClassified({
    note: 'として破綻している', cls: 'phrase_schema', suggested: 'serifu',
    payload: { frame: '「○○」として破綻している' }, att,
  });
  check('class is ratified on save', first.classRatified && first.class === 'phrase_schema');
  check('machine suggestion is preserved (training signal)', first.classSuggested === 'serifu');
  check('x attestation attached', first.attestations.length === 1 && first.attestations[0].source === 'x');

  // same span, DIFFERENT lens → sibling entry, not overwrite
  const second = await store.recordClassified({
    note: 'として破綻している', cls: 'rhet_collocation', suggested: 'serifu',
    payload: { lemma: '破綻' }, att,
  });
  check('different lens → separate entry', second.id !== first.id);
  check('both lenses live in the catalog', store.size() === 2);
  check('original lens untouched', store.byId(first.id).class === 'phrase_schema');

  // same lens again → merges into the same entry (no duplicate)
  const again = await store.recordClassified({
    note: 'として破綻している', cls: 'rhet_collocation',
    payload: { lemma: '破綻' },
    att: { ...att, file: 'https://x.com/u/status/2' },
  });
  check('same lens re-capture merges (2 attestations)', again.id === second.id && again.attestations.length === 2);

  // sweepTerms works for the lemma-keyed 🟢 entry
  check('🟢 entry is sweepable by its lemma', JSON.stringify(P.sweepTerms(again)) === '["破綻"]');
}

console.log(`\n${fail ? '✗' : '✓'} discourse-gold: ${pass}/${pass + fail}`);
process.exitCode = fail ? 1 : 0;
