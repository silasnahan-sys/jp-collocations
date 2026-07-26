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

console.log(fail ? `\n✗ goho: ${fail} failed (${pass} passed)` : `\n✓ goho: all ${pass} pass`);
process.exit(fail ? 1 : 0);
