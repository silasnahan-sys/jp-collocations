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
const genPartsUrl = url(tsc(readFileSync(join(SRCDIR, 'entry-parts.ts'), 'utf8'))
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`));
const genUrl = url(tsc(readFileSync(join(SRCDIR, 'generic-yomitan.ts'), 'utf8'))
  .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`)
  .replace(/from ['"]\.\/entry-parts\.ts['"]/g, `from '${genPartsUrl}'`)
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`));
const sidecarUrl = url(tsc(readFileSync(join(SRCDIR, 'sidecar.ts'), 'utf8'))
  .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`)
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`));
const importUrl = url(tsc(readFileSync(join(SRCDIR, 'import-eijiro.ts'), 'utf8'))
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`)
  .replace(/from ['"]\.\/generic-yomitan\.ts['"]/g, `from '${genUrl}'`)
  .replace(/from ['"]\.\/sidecar\.ts['"]/g, `from '${sidecarUrl}'`));
const partsUrl = url(tsc(readFileSync(join(SRCDIR, 'entry-parts.ts'), 'utf8'))
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`));
const deinflectUrl = url(tsc(readFileSync(join(SRCDIR, 'deinflect.ts'), 'utf8')));
const bigUrl = url(tsc(readFileSync(join(SRCDIR, 'big-dict.ts'), 'utf8'))
  .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`)
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`)
  .replace(/from ['"]\.\/entry-parts\.ts['"]/g, `from '${partsUrl}'`)
  .replace(/from ['"]\.\/deinflect\.ts['"]/g, `from '${deinflectUrl}'`)
  .replace(/from ['"]\.\/sidecar\.ts['"]/g, `from '${sidecarUrl}'`));

const { importEijiro } = await import(importUrl);
const { BigDictStore, bigHitToLookupResult, senseLine, dedupeAgainst, interleave } = await import(bigUrl);

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

console.log('\n══ AUDIT-PARTS §6 — running text is INFLECTED ══');
// A sharded store is exact-match by construction: the shard is picked by
// hashing the key, so a form you have not computed cannot be probed. The whole
// converted shelf was therefore reachable only from the citation form — the one
// form you already know — while the small imported store had deinflected since
// it shipped. These are the forms text actually arrives in.
{
  const vio = memIO();
  const verb = (expr, reading, gloss) =>
    [expr, reading, '', '', 0, [{ type: 'structured-content', content: `<div class="sense">${gloss}</div>` }], 1, ''];
  await importEijiro(vio, {
    async index() { return { title: '動詞テスト辞典', revision: '1', sourceLanguage: 'ja', targetLanguage: 'en' }; },
    async bankNames() { return ['b1']; },
    async bank() {
      return [
        verb('食べる', 'たべる', 'to eat'),
        verb('面白い', 'おもしろい', 'interesting'),
        verb('言う', 'いう', 'to say'),
      ];
    },
  }, { shards: SHARDS, root: ROOT, now: () => 0 });
  const store = new BigDictStore(vio, ROOT);

  ok((await store.lookup('食べる')).length === 1, 'the citation form still hits exactly');

  for (const [q, want] of [['食べた', '食べる'], ['食べて', '食べる'], ['食べない', '食べる'], ['面白かった', '面白い']]) {
    const hits = await store.lookup(q);
    ok(hits.length > 0 && hits[0].entry.expression === want,
      `「${q}」 reaches 「${want}」`, `(${hits.map((h) => h.entry.expression).join(',') || 'nothing'})`);
    ok(hits[0]?.deinflection?.length > 0,
      `「${q}」 carries its trail, so the 〈…〉 badge can say how`, JSON.stringify(hits[0]?.deinflection));
  }

  // An exact hit must never be labelled derived, and a real miss stays a miss.
  ok((await store.lookup('食べる'))[0].deinflection === undefined, 'an exact hit carries NO trail');
  ok((await store.lookup('ぜんぜんちがう語')).length === 0, 'a real miss is still []');

  // The fallback must stay bounded: shards are FILE READS here, not Map hits.
  const before = vio.reads();
  await store.lookup('たべさせられたくなかった');
  const spent = vio.reads() - before;
  ok(spent <= 4, 'a deep miss reads at most MAX_DEINFLECT_CANDIDATES shards per dictionary', `(${spent})`);
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
  const store = new BigDictStore(io, ROOT, { cacheBytes: 1 << 20 });
  await store.refresh();
  const before = io.reads();
  await store.lookup('$__ in arrears');
  const first = io.reads() - before;
  ok(first === 2, 'a cold lookup reads ONE shard per installed dictionary', `(${first})`);
  const mid = io.reads();
  await store.lookup('$__ in arrears');
  ok(io.reads() === mid, 'a repeat lookup reads NOTHING (cache hit)');
}

// The cap is on BYTES, not entries. A count cap cannot express the constraint:
// one query reads one shard per installed dictionary — 31 on the real vault, so
// 62 reads for lookup+frame — while shard sizes span three orders of magnitude.
// A cap of 6 entries meant each keystroke evicted the last keystroke's shards
// and nothing was ever reused.
console.log('\n══ the cache is BOUNDED BY BYTES (phones) ══');
{
  const store = new BigDictStore(io, ROOT, { cacheBytes: 400 });
  await store.refresh();
  for (const q of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) await store.lookup(q);
  ok(store.cachedBytes() <= 400 || store.cachedShards() === 1,
    'never holds more than its byte budget however much you type',
    `(${store.cachedBytes()}B in ${store.cachedShards()} shards)`);
}

console.log('\n══ a big budget keeps a whole query resident ══');
{
  const store = new BigDictStore(io, ROOT, { cacheBytes: 32 * 1024 * 1024 });
  await store.refresh();
  await store.lookup('$__ in arrears');
  const after = io.reads();
  // A DIFFERENT key, then back — the second query must not have evicted the first.
  await store.lookup('no-such-headword-at-all');
  const mid = io.reads();
  ok(mid > after, 'a new key does read new shards');
  await store.lookup('$__ in arrears');
  ok(io.reads() === mid,
    'and the earlier query is still cached — consecutive keystrokes reuse reads');
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

// The 辞書 view only ever queried DictionaryStore, so 31 converted dictionaries
// and 6.1M headwords were unreachable from the surface named after them — a §28
// seam (a lookup losing REACHABILITY across a subsystem boundary). The adapter
// is what closes it, and it closes it by making a sidecar hit the SAME object
// the view already renders rather than teaching the view a second shape.
console.log('\n══ a sidecar hit renders as an ordinary dictionary entry ══');
{
  const store = new BigDictStore(io, ROOT);
  const [hit] = await store.lookup('$__ in arrears');
  const r = bigHitToLookupResult(hit, 0);
  ok(r.term.expression === '$__ in arrears', 'expression survives');
  ok(r.dictionary === '英辞郎 v144', 'the 辞書 badge names the source dictionary');
  ok(typeof r.term.definitions[0] === 'string' && r.term.definitions[0].length > 0,
    'senses become renderable definition lines', `(${JSON.stringify(r.term.definitions[0])})`);
  ok(r.term.reading === r.term.expression,
    'a reading-less entry reads as its expression (so the card hides the row)');
  ok(Array.isArray(r.tags), 'tags is an array — the card slices it unconditionally');
  ok(r.term.sequence === hit.entry.sequence, 'sequence survives (groupResults keys on it)');
}

console.log('\n══ 〔…〕 stays a production-CONDITION, not a gloss (§27.1) ══');
{
  ok(senseLine({ pos: '名', gloss: '破綻', situation: '経営が', note: 'かたい' })
    === '【名】 破綻 〔経営が〕 ◆かたい',
    'pos / gloss / situation / note keep their own marks');
  ok(senseLine({ gloss: 'x' }) === 'x', 'a bare gloss stays bare');
  ok(senseLine({ gloss: '' }) === '', 'an empty sense is empty (filtered out upstream)');
}

console.log('\n══ nothing appears twice, and nothing distinct collapses ══');
{
  const store = new BigDictStore(io, ROOT);
  const hits = await store.lookup('$__ in arrears');
  const asLocal = hits.map((h, i) => bigHitToLookupResult(h, i));
  ok(dedupeAgainst(hits, asLocal).length === 0,
    'a dictionary that was imported AND converted is not shown twice');
  ok(dedupeAgainst(hits, []).length === hits.length, 'with nothing local, every hit is kept');

  // 英辞郎 genuinely has many entries per expression; a key of expression+dict
  // alone would silently collapse them into the first one.
  const same = [
    { dictionary: 'D', entry: { expression: '同', pos: [], senses: [{ gloss: 'a' }], xrefs: [], sequence: 1 } },
    { dictionary: 'D', entry: { expression: '同', pos: [], senses: [{ gloss: 'b' }], xrefs: [], sequence: 2 } },
  ];
  ok(dedupeAgainst(same, []).length === 2,
    'two distinct entries sharing one expression both survive');
  ok(dedupeAgainst([same[0], same[0]], []).length === 1, 'but a true duplicate is dropped');
}

console.log('\n══ breadth before depth: the limit spreads across books ══');
{
  // The shipped bug, in miniature. `metas` is sorted biggest-first, so walking
  // it in order and returning at `limit` spent the whole budget on the largest
  // books. Measured on the real vault (35 installed, limit 40): 「気」 answered
  // from 11 dictionaries while 17 held it, and the six dropped were the small
  // specialist ones — 用例.jp, 類語例解, 現代国語例解, NHK アクセント, 斎藤和英,
  // WISDOM. Exactly the books you open BECAUSE the word is common.
  const big = Array.from({ length: 9 }, (_, i) => `大辞林-${i}`);
  const mid = ['明鏡-0', '明鏡-1'];
  const small = ['用例.jp-0'];
  const groups = [big, mid, small];

  ok(interleave(groups, 40).length === 12, 'under the limit, nothing is lost');
  const capped = interleave(groups, 4);
  ok(capped.length === 4, 'the cap is still a cap');
  ok(capped.includes('用例.jp-0'),
    'the smallest book gets its one entry in even at limit 4', JSON.stringify(capped));
  ok(JSON.stringify(capped) === JSON.stringify(['大辞林-0', '明鏡-0', '用例.jp-0', '大辞林-1']),
    'round 1 is one-per-book, in store order; round 2 starts only after',
    JSON.stringify(capped));
  // The old behaviour, for contrast: [大辞林-0..3] and nothing else.
  ok(!capped.includes('大辞林-3'), 'no book reaches its 4th entry before others reach their 1st');

  ok(interleave([], 10).length === 0, 'no groups → nothing');
  ok(interleave(groups, 0).length === 0, 'limit 0 → nothing');
  ok(interleave([[], ['a']], 5).join() === 'a', 'an empty group is skipped, not counted');
  ok(interleave([['a', 'b'], ['c']], 99).join() === 'a,c,b',
    'a group that runs out drops out of later rounds');
}

console.log(`\n${fail ? '✗' : '✓'} big-dict: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
