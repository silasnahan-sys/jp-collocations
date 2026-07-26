/**
 * golden/big-dict.mjs — the READ side of the sidecars.
 *
 * Converts real entries from the user's export through the REAL importer, then
 * queries them back through BigDictStore. If this passes, "convert a dictionary"
 * and "search it" are the same story rather than two halves that never met —
 * which is what they were until this file existed.
 *
 *   node golden/big-dict.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
const { transpileModule } = ts;

const HERE = dirname(fileURLToPath(import.meta.url));
const SRCDIR = join(HERE, '..', 'src', 'dictionary');
const tsc = (s) => transpileModule(s, { compilerOptions: { module: 'ESNext', target: 'ES2022' } }).outputText;
const url = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64');

const framesUrl = url(tsc(readFileSync(join(SRCDIR, 'frames.ts'), 'utf8')));
const eijiroUrl = url(tsc(readFileSync(join(SRCDIR, 'eijiro.ts'), 'utf8'))
  .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`));
const genUrl = url(tsc(readFileSync(join(SRCDIR, 'generic-yomitan.ts'), 'utf8'))
  .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`)
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`));
const sidecarUrl = url(tsc(readFileSync(join(SRCDIR, 'sidecar.ts'), 'utf8'))
  .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`)
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`));
const importUrl = url(tsc(readFileSync(join(SRCDIR, 'import-eijiro.ts'), 'utf8'))
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`)
  .replace(/from ['"]\.\/generic-yomitan\.ts['"]/g, `from '${genUrl}'`)
  .replace(/from ['"]\.\/sidecar\.ts['"]/g, `from '${sidecarUrl}'`));
const bigUrl = url(tsc(readFileSync(join(SRCDIR, 'big-dict.ts'), 'utf8'))
  .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`)
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`)
  .replace(/from ['"]\.\/sidecar\.ts['"]/g, `from '${sidecarUrl}'`));

const { importEijiro } = await import(importUrl);
const { BigDictStore } = await import(bigUrl);

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => {
  n++;
  if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg}`);
};

/** In-memory vault, with folder listing so discovery is exercised for real. */
function memIO() {
  const files = new Map();
  let reads = 0;
  return {
    files,
    reads: () => reads,
    async read(p) { reads++; return files.has(p) ? files.get(p) : null; },
    async write(p, t) { files.set(p, t); },
    async append(p, t) { files.set(p, (files.get(p) ?? '') + t); },
    async exists(p) { return files.has(p); },
    async mkdir() {},
    async remove(p) { files.delete(p); },
    async listFolders(dir) {
      const out = new Set();
      for (const p of files.keys()) {
        if (!p.startsWith(dir + '/')) continue;
        out.add(p.slice(dir.length + 1).split('/')[0]);
      }
      return [...out];
    },
  };
}

const EIJIRO = JSON.parse(readFileSync(join(HERE, 'fixtures', 'eijiro.entries.json'), 'utf8'));
const JITEN = JSON.parse(readFileSync(join(HERE, 'fixtures', 'jitendex.entries.json'), 'utf8'));
const ROOT = 'JP Dictionaries';
const SHARDS = 8;

const io = memIO();
// convert BOTH real dictionaries into the same vault
await importEijiro(io, {
  async index() { return { title: '英辞郎 v144', revision: '1.0', sourceLanguage: 'en', targetLanguage: 'ja' }; },
  async bankNames() { return ['b1']; },
  async bank() { return Object.values(EIJIRO); },
}, { shards: SHARDS, root: ROOT, now: () => 0 });
await importEijiro(io, {
  async index() { return { title: JITEN.index.title, revision: '1', sourceLanguage: 'ja', targetLanguage: 'en' }; },
  async bankNames() { return ['b1']; },
  async bank() { return JITEN.entries; },
}, { shards: SHARDS, root: ROOT, now: () => 0 });

console.log('══ discovery: the FOLDERS are the registry (no registry file) ══');
{
  const store = new BigDictStore(io, ROOT);
  const found = await store.refresh();
  ok(found.length === 2, 'both converted dictionaries discovered', `(${found.length})`);
  const titles = store.installed().map((d) => d.title);
  ok(titles.includes('英辞郎 v144'), '英辞郎 found');
  ok(titles.some((t) => /Jitendex/i.test(t)), 'jitendex found', `(${titles.join(' / ')})`);
  ok(store.installed()[0].headwords >= store.installed()[1].headwords,
    'ordered biggest-first (英辞郎 answers most production questions)');
  ok(!(await store.isEmpty()), 'isEmpty() is false when dictionaries exist');
  ok(!io.files.has(`${ROOT}/registry.json`), 'no registry file was invented');
}

console.log('\n══ a headword converted is a headword findable ══');
{
  const store = new BigDictStore(io, ROOT);
  const hits = await store.lookup('$__ in arrears');
  ok(hits.length === 1, 'the Eijiro entry comes back', `(${hits.length})`);
  ok(hits[0].dictionary === '英辞郎 v144', 'tagged with its dictionary');
  ok(hits[0].entry.senses[0].gloss === '＿ドルの支払いが滞っている', 'with its real sense');
  ok(hits[0].entry.reachFor === undefined,
    'the head shard carries the LOOK-UP half only (reach-for lives in frames)');

  const ja = await store.lookup('いかなる場合でも');
  ok(ja.length === 1 && /Jitendex/i.test(ja[0].dictionary),
    'and a JA→EN headword from the other dictionary', `(${ja.length})`);

  ok((await store.lookup('   $__ IN ARREARS ')).length === 1,
    'lookup normalizes exactly as the writer did');
  ok((await store.lookup('no such headword')).length === 0, 'a miss is [] , not a crash');
  ok((await store.lookup('')).length === 0, 'empty query is []');
}

console.log('\n══ THE REACH-FOR QUERY (§27.2) ══');
{
  const store = new BigDictStore(io, ROOT);
  const hits = await store.frame('＿ドルの支払いが滞っている');
  ok(hits.length >= 1, 'a Japanese frame resolves to candidates', `(${hits.length})`);
  ok(hits[0].candidate.intention === '$__ in arrears', 'carrying the English intention back');
  ok(hits[0].candidate.classHint === 'skeletal', 'and its class hint survived the round trip');

  // the join: YOUR notation reaches the curated frame
  const mine = await store.frame('○○を買うと自動的に＿ドル値引きされる');
  ok(mine.length >= 1, "a frame in the USER's notation finds Eijiro's entry", `(${mine.length})`);
  ok((await store.frame('')).length === 0, 'empty frame is []');
}

console.log('\n══ one shard read per dictionary, then cached ══');
{
  const store = new BigDictStore(io, ROOT, { cacheShards: 6 });
  await store.refresh();
  const before = io.reads();
  await store.lookup('$__ in arrears');
  const first = io.reads() - before;
  ok(first === 2, 'a cold lookup reads ONE shard per installed dictionary', `(${first})`);
  const mid = io.reads();
  await store.lookup('$__ in arrears');
  ok(io.reads() === mid, 'a repeat lookup reads NOTHING (cache hit)');
  ok(store.cachedShards() <= 6, 'the cache stays inside its cap', `(${store.cachedShards()})`);
}

console.log('\n══ the cache is BOUNDED (phones) ══');
{
  const store = new BigDictStore(io, ROOT, { cacheShards: 2 });
  await store.refresh();
  for (const q of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) await store.lookup(q);
  ok(store.cachedShards() <= 2, 'never grows past the cap however much you type',
    `(${store.cachedShards()})`);
}

console.log('\n══ an empty vault degrades honestly ══');
{
  const empty = new BigDictStore(memIO(), ROOT);
  ok(await empty.isEmpty(), 'isEmpty() true with nothing installed');
  ok((await empty.lookup('x')).length === 0, 'lookup returns [] rather than throwing');
  ok((await empty.frame('～が破綻する')).length === 0, 'frame returns [] too');
  ok(empty.installed().length === 0, 'installed() is empty');
}

console.log('\n══ invalidate() picks up a re-convert ══');
{
  const io2 = memIO();
  const store = new BigDictStore(io2, ROOT);
  ok(await store.isEmpty(), 'starts empty');
  await importEijiro(io2, {
    async index() { return { title: '英辞郎 v144', sourceLanguage: 'en', targetLanguage: 'ja' }; },
    async bankNames() { return ['b1']; },
    async bank() { return Object.values(EIJIRO); },
  }, { shards: SHARDS, root: ROOT, now: () => 0 });
  ok((await store.lookup('$__ in arrears')).length === 0,
    'a stale store does not see the new dictionary (it cached "empty")');
  store.invalidate();
  ok((await store.lookup('$__ in arrears')).length === 1,
    'after invalidate() it does');
}

console.log(`\n${fail ? '✗' : '✓'} big-dict: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
