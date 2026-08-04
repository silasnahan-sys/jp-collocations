/**
 * golden/goho.mjs — §22.7 corpus enrichment: profile normalization + the
 * fetch-once-and-freeze cache rule.
 *
 * Run:  node golden/goho.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const G = await import(pathToFileURL(join(HERE, '..', 'src', 'scraper', 'goho.ts')).href);
const P = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'pattern-store.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('══ normalizeProfile ══');
{
  const entries = [
    { fullPhrase: '気を遣う', collocate: '遣う', exampleSentences: ['先輩にいつも気を遣ってしまう。', '先輩にいつも気を遣ってしまう。'] },
    { fullPhrase: '気になる', collocate: '', exampleSentences: ['それが気になる。'] },
    { fullPhrase: '気が済む', exampleSentences: ['短すぎ', 'x'.repeat(200)] },
  ];
  const p = G.normalizeProfile(entries, '気になる', 'hyogen', 1000);
  check('key itself excluded from collocates', !p.collocates.includes('気になる'));
  check('collocates deduped + kept', p.collocates.includes('気を遣う') && p.collocates.includes('気が済む'));
  check('examples deduped', p.examples.filter((e) => e.includes('先輩')).length === 1);
  check('junk examples dropped (too short / too long)', !p.examples.some((e) => e === '短すぎ' || e.length > 120));
  check('provenance carried', p.source === 'hyogen' && p.fetchedAt === 1000);
  check('empty scrape → empty but valid profile', G.normalizeProfile([], 'x', 'hyogen', 1).collocates.length === 0);
}

console.log('══ fetch once, freeze forever (invariant §2.4) ══');
{
  const store = new P.PatternStore(async () => {});
  store.load({ entries: [P.upsertEntry(undefined, '気になる', null, 1)] });
  const id = store.all()[0].id;
  const first = { fetchedAt: 1, source: 'hyogen', collocates: ['気を遣う'], examples: ['例文ですよ。'] };
  check('first setGoho lands', await store.setGoho(id, first) === true && store.byId(id).payload.goho.fetchedAt === 1);
  const second = { fetchedAt: 2, source: 'hyogen', collocates: ['違うもの'], examples: [] };
  check('second setGoho REFUSED (frozen)', await store.setGoho(id, second) === false && store.byId(id).payload.goho.fetchedAt === 1);
  check('unknown id → false', await store.setGoho('nope', first) === false);
}

console.log('══ drill-down: the profile DEEPENS without anything frozen changing ══');
{
  // §2.4 says a later site change must not rewrite a past entry, which is also
  // why the profile could never get past its first fetch — a corpus whose own
  // UI is a three-pane drill-down was reduced to one snapshot forever.
  // `extendGoho` is the reconciliation: fill-only, never replace.
  const store = new P.PatternStore(async () => {});
  store.load({ entries: [P.upsertEntry(undefined, '風', null, 1)] });
  const id = store.all()[0].id;

  const frameA = { pos: '名詞', direction: 'head-initial', label: '風＋助詞', patternId: 'J001', items: ['風を'], total: 9 };
  const frameB = { pos: '名詞', direction: 'head-final', label: '名詞＋の＋風', patternId: 'H007', items: ['子供の風'], total: 15 };

  check('cannot extend what was never fetched', await store.extendGoho(id, { frame: frameA }) === false);

  await store.setGoho(id, {
    fetchedAt: 1, source: 'twc', collocates: [], examples: [],
    frames: [frameA],
    index: [{ id: 'J001', name: '風＋助詞', category: '助詞', freq: 284, share: 88.2 },
            { id: 'H007', name: '名詞＋の＋風', category: '他の名詞との共起', freq: 10, share: 3.1 }],
  });

  check('a NEW pattern lands', await store.extendGoho(id, { frame: frameB }) === true);
  check('and both frames are now held', store.byId(id).payload.goho.frames.length === 2);
  check('the index is untouched by drilling', store.byId(id).payload.goho.index.length === 2);

  // The invariant: a pattern already frozen is DROPPED, not merged. Otherwise a
  // later site change could rewrite what an earlier fetch recorded.
  const rewritten = { ...frameA, items: ['まったく別のもの'], total: 999 };
  check('re-drilling a frozen pattern is refused', await store.extendGoho(id, { frame: rewritten }) === false);
  check('…and the original survives byte-for-byte',
    store.byId(id).payload.goho.frames.find((f) => f.patternId === 'J001').items[0] === '風を');
  check('…including its total', store.byId(id).payload.goho.frames.find((f) => f.patternId === 'J001').total === 9);

  // Examples append, deduped by text, and the flat mirror keeps pace (§28 S1).
  check('examples land', await store.extendGoho(id, {
    examples: [{ text: '風を切って走る。', kind: 'attested', collocate: '風を' }],
  }) === true);
  check('a duplicate sentence is refused', await store.extendGoho(id, {
    examples: [{ text: '風を切って走る。', kind: 'attested', collocate: '風を' }],
  }) === false);
  check('sourced and the flat list stay in step',
    store.byId(id).payload.goho.examples.length === store.byId(id).payload.goho.sourced.length &&
    store.byId(id).payload.goho.examples[0] === '風を切って走る。');
  check('offering nothing new reports so', await store.extendGoho(id, {}) === false);
  check('unknown id → false', await store.extendGoho('nope', { frame: frameB }) === false);

  // A source with no pattern ids (Hyogen) is keyed on its head line instead,
  // which is what distinguishes its sections (「～ 風[名詞]2」).
  const s2 = new P.PatternStore(async () => {});
  s2.load({ entries: [P.upsertEntry(undefined, '精度', null, 1)] });
  const id2 = s2.all()[0].id;
  await s2.setGoho(id2, { fetchedAt: 1, source: 'hyogen', collocates: [], examples: [],
    frames: [{ pos: '名詞', direction: 'head-final', label: '～ 精度[名詞]2', items: ['その精度'], total: 3 }] });
  check('an id-less duplicate section is refused by its label',
    await s2.extendGoho(id2, { frame: { pos: '名詞', direction: 'head-final', label: '～ 精度[名詞]2', items: ['ちがう'], total: 1 } }) === false);
  check('…while a different section lands',
    await s2.extendGoho(id2, { frame: { pos: '名詞', direction: 'head-initial', label: '精度[名詞] ～', items: ['精度を得る'], total: 20 } }) === true);
}

console.log(fail ? `\n✗ goho: ${fail} failed (${pass} passed)` : `\n✓ goho: all ${pass} pass`);
process.exit(fail ? 1 : 0);
