/**
 * golden/dictionary.mjs — proves the FULL production dictionary path with no
 * fixture shortcuts:
 *
 *   Yomitan ZIP bytes → YomitanImporter (real minimal-ZIP parser, stored AND
 *   deflate entries) → DictionaryStore.addDictionary → lookup →
 *   makeDictionaryReadingResolver → LocalMatcher homophone correction.
 *
 * If this passes, "import a Yomitan dictionary" is the ONLY missing link for
 * homophone-aware reconciliation — the machinery itself is verified.
 *
 * Run:  node golden/dictionary.mjs
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { deflateRawSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require(join(HERE, '..', 'node_modules', 'esbuild'));

// ── Bundle the production modules (obsidian stubbed — types only anyway) ──
const dir = mkdtempSync(join(tmpdir(), 'jpc-dict-'));
const stub = join(dir, 'obsidian-stub.js');
require('node:fs').writeFileSync(stub, 'module.exports = { Notice: class {}, App: class {} };');
const entrySrc = `
export { YomitanImporter } from '${join(HERE, '..', 'src', 'dictionary', 'YomitanImporter.ts').replace(/\\/g, '/')}';
export { DictionaryStore } from '${join(HERE, '..', 'src', 'dictionary', 'DictionaryStore.ts').replace(/\\/g, '/')}';
export { makeDictionaryReadingResolver } from '${join(HERE, '..', 'src', 'notes', 'reading-resolver.ts').replace(/\\/g, '/')}';
export { match } from '${join(HERE, '..', 'src', 'notes', 'local-matcher.ts').replace(/\\/g, '/')}';
`;
const entryPath = join(dir, 'entry.ts');
require('node:fs').writeFileSync(entryPath, entrySrc);
await esbuild.build({
  entryPoints: [entryPath], bundle: true, platform: 'node', format: 'cjs',
  outfile: join(dir, 'dict.cjs'), logLevel: 'silent', alias: { obsidian: stub },
});
const { YomitanImporter, DictionaryStore, makeDictionaryReadingResolver, match } = require(join(dir, 'dict.cjs'));

// ── Hand-built ZIP writer (local headers + central dir + EOCD) ──────────
function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function buildZip(files) {
  // files: [{name, data (Buffer), deflate (bool)}]
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = Buffer.from(f.name, 'utf8');
    const raw = f.data;
    const stored = f.deflate ? deflateRawSync(raw) : raw;
    const method = f.deflate ? 8 : 0;
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0, 6);             // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);            // mod time
    local.writeUInt16LE(0, 12);            // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);            // extra len
    chunks.push(local, nameBytes, stored);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);               // version made by
    cd.writeUInt16LE(20, 6);               // version needed
    cd.writeUInt16LE(0, 8);                // flags
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(stored.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);               // extra
    cd.writeUInt16LE(0, 32);               // comment
    cd.writeUInt16LE(0, 34);               // disk
    cd.writeUInt16LE(0, 36);               // internal attrs
    cd.writeUInt32LE(0, 38);               // external attrs
    cd.writeUInt32LE(offset, 42);          // local header offset
    central.push(Buffer.concat([cd, nameBytes]));
    offset += local.length + nameBytes.length + stored.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  const all = Buffer.concat([...chunks, cdBuf, eocd]);
  // Return a real ArrayBuffer slice (the importer takes ArrayBuffer)
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

// ── A minimal but real Yomitan dictionary ────────────────────────────────
const indexJson = JSON.stringify({ title: 'GoldenTestDict', format: 3, revision: 'golden-1' });
const termBank = JSON.stringify([
  // [expression, reading, defTags, rules, score, definitions, sequence, termTags]
  ['効く', 'きく', '', 'v5', 10, ['to be effective'], 1, ''],
  ['利く', 'きく', '', 'v5', 9, ['to work (function)'], 2, ''],
  ['聞く', 'きく', '', 'v5', 20, ['to hear; to ask'], 3, ''],
  ['食べる', 'たべる', '', 'v1', 30, ['to eat'], 4, ''],
  ['薬', 'くすり', '', '', 25, ['medicine'], 5, ''],
]);

let failures = 0, checks = 0;
const check = (ok, msg) => { checks++; console.log(`  ${ok ? '✓' : (failures++, '✗')} ${msg}`); };

// index.json STORED, term_bank DEFLATED — exercises both extraction paths.
const zip = buildZip([
  { name: 'index.json', data: Buffer.from(indexJson, 'utf8'), deflate: false },
  { name: 'term_bank_1.json', data: Buffer.from(termBank, 'utf8'), deflate: true },
]);

console.log('\n══ Yomitan ZIP → importer (stored + deflate entries) ══');
const importer = new YomitanImporter();
const dictData = await importer.import(zip);
check(dictData.meta.title === 'GoldenTestDict', `index.json parsed (title: ${dictData.meta.title})`);
check(dictData.terms.length === 5, `term_bank deflate-extracted (${dictData.terms.length}/5 terms)`);

console.log('\n══ DictionaryStore lookup ══');
const store = new DictionaryStore({}, async () => {});
store.addDictionary(dictData);
const kiku = store.lookup('効く');
check(kiku.length > 0 && kiku[0].term.reading === 'きく', `lookup(効く) → きく`);
check(store.lookup('食べる')[0]?.term.reading === 'たべる', `lookup(食べる) → たべる`);
check(store.lookup('存在しない語').length === 0, `lookup(unknown) → empty (no false hits)`);

console.log('\n══ Production reading resolver (NOT the fixture) ══');
const readingOf = makeDictionaryReadingResolver(store);
check(readingOf('効く') === 'きく', `resolver(効く) → きく`);
check(readingOf('聞く') === 'きく', `resolver(聞く) → きく (homophone pair complete)`);
check(readingOf('謎の語') === null, `resolver(unknown) → null (degrade, not guess)`);

console.log('\n══ End-to-end: homophone correction through the real resolver ══');
// The user's handwritten note says 効く; the ASR transcript wrote 聞く.
const lines = [
  { index: 0, tStartSec: 10, text: 'この薬はよく聞くと思いますよ' },
  { index: 1, tStartSec: 20, text: '全然関係ない行です' },
];
const r = match('この薬はよく効く', lines, readingOf);
check(r.best?.startLine === 0 && r.best?.tStartSec === 10, `matched the right line (@${r.best?.tStartSec}s)`);
const homophone = r.corrections.find((c) => c.kind === 'homophone' || c.kind === 'kanji-swap');
check(!!homophone, `homophone/kanji-swap correction produced (効く⇄聞く)` +
  (homophone ? ` [${homophone.kind}: ${homophone.noteText}→${homophone.transcriptText}]` : ` — got kinds: ${r.corrections.map(c => c.kind).join(',') || 'none'}`));

// ── The blob guard (AUDIT §18 / DESIGN §27.5) ────────────────────────────────
// 2026-07-25: a large import drove `_dictStore` to 239.6 MB of a 241 MB plugin
// data blob; the whole-file rewrite was truncated mid-string and the plugin
// stopped loading entirely — the view opened for a second and went white.
// The blob is rewritten in full on every save, so size here is not a matter of
// taste. Big dictionaries belong in vault sidecars (sidecar.ts).
console.log('\n══ Oversized dictionaries never enter the plugin data blob ══');
check(typeof DictionaryStore.BLOB_TERM_LIMIT === 'number' && DictionaryStore.BLOB_TERM_LIMIT > 0,
  `a term limit exists (${DictionaryStore.BLOB_TERM_LIMIT?.toLocaleString?.()})`);
{
  let persisted = null;
  const guarded = new DictionaryStore({}, async (d) => { persisted = d; });
  // one ordinary dictionary, and one far over the limit
  guarded.addDictionary({
    meta: { title: 'small', revision: '1', termCount: 1 },
    terms: [{ expression: '効く', reading: 'きく', definitions: ['work'], definitionTags: [], termTags: [], rules: [], score: 0, sequence: 0 }],
    tags: new Map(), expressionIndex: new Map(), readingIndex: new Map(),
    frequencies: new Map(), pitches: new Map(),
  });
  const huge = new Array(DictionaryStore.BLOB_TERM_LIMIT + 1).fill(0).map((_, i) => ({
    expression: 'w' + i, reading: '', definitions: ['d'], definitionTags: [], termTags: [],
    rules: [], score: 0, sequence: i,
  }));
  guarded.addDictionary({
    meta: { title: '英辞郎 v144', revision: '1', termCount: huge.length },
    terms: huge, tags: new Map(), expressionIndex: new Map(), readingIndex: new Map(),
    frequencies: new Map(), pitches: new Map(),
  });

  check(guarded.oversized().length === 1, 'the oversized dictionary is REPORTED, not hidden');
  check(guarded.oversized()[0]?.title === '英辞郎 v144', 'and named, so the notice can say which');

  await guarded.save();
  const titles = (persisted?.dictionaries ?? []).map((d) => d.meta.title);
  check(titles.includes('small'), 'a normal dictionary still persists');
  check(!titles.includes('英辞郎 v144'),
    'the 2.36M-term dictionary is NOT written to the blob (this is the 239MB bug)');
}

console.log('\n══ 〜-Ends mode + homophone paging (the gap-list leftovers) ══');
{
  const ends = store.endsWithSearch('べる');
  check(ends.some((r) => r.term.expression === '食べる'), `endsWithSearch(べる) finds 食べる (${ends.length} hits)`);
  const endsKu = store.endsWithSearch('く');
  check(endsKu.length >= 3 && ['効く', '利く', '聞く'].every((e) => endsKu.some((r) => r.term.expression === e)),
    'endsWithSearch(く) finds the whole きく column');
  check(store.endsWithSearch('存在しない').length === 0, 'an impossible suffix finds nothing');
  // reading-scan: すり is the TAIL of くすり — the びを→口火を切る row of the gap list
  check(store.endsWithSearch('すり').some((r) => r.term.expression === '薬'),
    'a reading tail reaches its headword (すり → 薬)');

  const same = store.homophones('聞く');
  check(same.length === 2 && same.every((h) => h.expression === '効く' || h.expression === '利く'),
    `homophones(聞く) → 効く・利く, never itself (got ${same.map((h) => h.expression).join('・')})`);
  check(store.homophones('きく').length === 3, 'a reading query pages ALL its spellings');
  check(store.homophones('食べる').length === 0, 'a lone reading has no pages beside it');
}

console.log(`\n${failures ? '✗' : '✓'} ${checks - failures}/${checks} dictionary checks pass`);
process.exit(failures ? 1 : 0);
