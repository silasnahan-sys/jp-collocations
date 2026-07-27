/**
 * golden/import-dexie.mjs — converting all 36 dictionaries out of one backup.
 *
 * Drives the REAL importer over a Dexie document built from rows lifted
 * verbatim out of the user's 12.7GB export, with a second dictionary's rows
 * INTERLEAVED — because the format promises no grouping and the router must
 * not depend on it.
 *
 * The invariant that would silently destroy a 12-hour conversion if wrong:
 * a dictionary's sidecar is reset on its FIRST batch only. Reset per batch and
 * every dictionary ends up holding just its final chunk, with no error.
 *
 *   node golden/import-dexie.mjs
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
const streamUrl = url(tsc(readFileSync(join(SRCDIR, 'dexie-stream.ts'), 'utf8')));
const dexieUrl = url(tsc(readFileSync(join(SRCDIR, 'import-dexie.ts'), 'utf8'))
  .replace(/from ['"]\.\/dexie-stream\.ts['"]/g, `from '${streamUrl}'`)
  .replace(/from ['"]\.\/import-eijiro\.ts['"]/g, `from '${importUrl}'`)
  .replace(/from ['"]\.\/sidecar\.ts['"]/g, `from '${sidecarUrl}'`)
  .replace(/from ['"]\.\/generic-yomitan\.ts['"]/g, `from '${genUrl}'`)
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`));

const { importDexie, skipTitles } = await import(dexieUrl);
const bigUrl = url(tsc(readFileSync(join(SRCDIR, 'big-dict.ts'), 'utf8'))
  .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`)
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`)
  .replace(/from ['"]\.\/sidecar\.ts['"]/g, `from '${sidecarUrl}'`));
const { BigDictStore } = await import(bigUrl);

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => {
  n++;
  if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg}`);
};

function memIO() {
  const files = new Map();
  return {
    files,
    async read(p) { return files.has(p) ? files.get(p) : null; },
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

// Rows lifted verbatim from the user's 12.7GB export.
const FRAGMENT = readFileSync(join(HERE, 'fixtures', 'dexie-terms.fragment.json'), 'utf8');
const REAL_ROWS = FRAGMENT.slice(FRAGMENT.indexOf('[') + 1).split(/(?<=\}),(?=\{)/);
const KENKYUSHA = '研究社　新和英大辞典　第５版';

const row = (expr, dict, seq) => JSON.stringify({
  expression: expr, reading: expr, definitionTags: '', rules: '', score: 0,
  glossary: [`${expr} — gloss`], sequence: seq, termTags: '', dictionary: dict, id: seq,
});

/** A Dexie document with two dictionaries INTERLEAVED across two chunks. */
function doc() {
  const a = [];
  for (let i = 0; i < 40; i++) {
    a.push(row(`語${i}かたち`, i % 2 ? KENKYUSHA : '大辞泉', i));
  }
  return '{"formatName":"dexie","data":{"tables":[],"data":['
    + '{"tableName":"media","inbound":true,"rows":[{"id":1,"path":"x.png"}]},'
    + `{"tableName":"terms","inbound":true,"rows":[${REAL_ROWS.join(',')}]},`
    + `{"tableName":"terms","inbound":true,"rows":[${a.join(',')}]}`
    + ']}}';
}

/** Feed the document in small chunks, as a real read stream would. */
async function* chunks(text, size = 97) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

console.log('══ a full pass over a Dexie document ══');
{
  const io = memIO();
  const seen = [];
  const res = await importDexie(io, chunks(doc()), {
    shards: 8, root: 'JP Dictionaries', bufferRows: 12, now: () => 0,
    onProgress: (p) => seen.push(p.current),
  });
  ok(res.rows === 43, 'every terms row read (3 real + 40 synthetic)', `(${res.rows})`);
  ok(res.unparseable === 0, 'nothing unparseable', `(${res.unparseable})`);
  ok(res.dictionaries.length === 2, 'two dictionaries converted', `(${res.dictionaries.length})`);
  const titles = res.dictionaries.map((d) => d.title);
  ok(titles.includes(KENKYUSHA), '研究社 found (from the REAL rows)');
  ok(titles.includes('大辞泉'), '大辞泉 found');
  ok(res.dictionaries.every((d) => d.adapter === 'generic'), 'both used the generic adapter');
  ok(seen.length > 2, 'progress fired more than once per dictionary (batched flushes)',
    `(${seen.length} flushes)`);
}

console.log('\n══ THE INVARIANT: reset on the FIRST batch only ══');
{
  // bufferRows is deliberately tiny so each dictionary flushes MANY times.
  const io = memIO();
  const res = await importDexie(io, chunks(doc()), {
    shards: 4, root: 'JP Dictionaries', bufferRows: 6, now: () => 0,
  });
  const total = res.dictionaries.reduce((a, d) => a + d.headwords, 0);
  ok(total === 43, 'every headword survived many flushes', `(${total})`);
  // If reset ran per batch, each dictionary would hold only its last few rows.
  const daijisen = res.dictionaries.find((d) => d.title === '大辞泉');
  ok(daijisen.headwords === 20, '大辞泉 kept ALL its rows, not just the final batch',
    `(${daijisen.headwords})`);
}

console.log('\n══ converted rows are queryable through BigDictStore ══');
{
  const io = memIO();
  await importDexie(io, chunks(doc()), { shards: 8, root: 'JP Dictionaries', bufferRows: 12, now: () => 0 });
  const store = new BigDictStore(io, 'JP Dictionaries');
  const found = await store.refresh();
  ok(found.length === 2, 'both dictionaries discovered after a Dexie import', `(${found.length})`);
  const hit = await store.lookup('外字一覧');
  ok(hit.length === 1, 'a REAL headword from the 12.7GB file is findable', `(${hit.length})`);
  ok(hit[0].dictionary === KENKYUSHA, 'tagged with its real dictionary', `(${hit[0].dictionary})`);
  ok(hit[0].entry.senses.length > 0, 'and carries its gloss');
  const jp = await store.lookup('語3かたち');
  ok(jp.length === 1 && jp[0].dictionary === KENKYUSHA, 'interleaved rows landed in the right dictionary');
}

console.log('\n══ meta is written once, at the end, with real counts ══');
{
  const io = memIO();
  const res = await importDexie(io, chunks(doc()), { shards: 8, root: 'JP Dictionaries', bufferRows: 12, now: () => 7 });
  for (const d of res.dictionaries) {
    const meta = JSON.parse(io.files.get(`${d.dir}/meta.json`));
    ok(meta.headwords === d.headwords, `${d.title}: meta matches the real count`,
      `(${meta.headwords} vs ${d.headwords})`);
    ok(meta.builtAt === 7 && meta.revision === 'dexie', 'meta is stamped and marked as a backup import');
  }
}

console.log('\n══ ORPHANS: terms of dictionaries no longer registered ══');
{
  // Measured on the real backup: 97 distinct titles on `terms`, 36 in
  // `dictionaries`. The surplus are leftovers of removed/superseded
  // dictionaries. Converting them would make dozens of junk folders.
  const withRegistry = '{"formatName":"dexie","data":{"data":['
    + '{"tableName":"dictionaries","inbound":false,"rows":['
    + '{"$":[4,{"title":"大辞泉","revision":"r1","version":3}],"$types":{"$":{"":"arrayNonindexKeys"}}}'
    + ']},'
    + `{"tableName":"terms","inbound":true,"rows":[${[
      row('のこる', '大辞泉', 1), row('きえた', '消えた辞書', 2), row('のこる2', '大辞泉', 3),
    ].join(',')}]}`
    + ']}}';
  const io = memIO();
  const res = await importDexie(io, chunks(withRegistry), {
    shards: 4, root: 'JP Dictionaries', bufferRows: 50, now: () => 0,
  });
  ok(res.registered === 1, 'the dictionaries table was read in the SAME pass', `(${res.registered})`);
  ok(res.rows === 2, 'only registered dictionaries convert', `(${res.rows})`);
  ok(res.orphans === 1, 'the orphan is counted and REPORTED, not silently dropped', `(${res.orphans})`);
  ok(res.dictionaries.length === 1 && res.dictionaries[0].title === '大辞泉',
    'no junk folder for the removed dictionary');
}
{
  // A fragment with no dictionaries table must convert everything rather than
  // silently converting nothing.
  const io = memIO();
  const res = await importDexie(io, chunks(doc()), { shards: 4, root: 'JP Dictionaries', bufferRows: 50, now: () => 0 });
  ok(res.registered === 0 && res.rows === 43,
    'no registry seen → convert everything (never silently zero)', `(${res.rows})`);
}

console.log('\n══ skipping an already-converted dictionary ══');
{
  const io = memIO();
  const res = await importDexie(io, chunks(doc()), {
    shards: 8, root: 'JP Dictionaries', bufferRows: 12, now: () => 0,
    skip: skipTitles(['大辞泉']),
  });
  ok(res.dictionaries.length === 1, 'the skipped dictionary is not converted', `(${res.dictionaries.length})`);
  ok(res.dictionaries[0].title === KENKYUSHA, 'the other still is');
  ok(res.rows === 43, 'but its rows were still READ (the pass is sequential)', `(${res.rows})`);
}

console.log('\n══ cancellation lands what it read ══');
{
  const io = memIO();
  let calls = 0;
  // stop late enough that rows HAVE been read — the property under test is
  // "a cancelled run keeps what it read", not "cancelling always writes".
  const res = await importDexie(io, chunks(doc(), 400), {
    shards: 8, root: 'JP Dictionaries', bufferRows: 500, now: () => 0,
    shouldStop: () => ++calls > 6,
  });
  ok(res.rows < 43, 'stopped early', `(${res.rows} rows)`);
  ok(res.rows > 0, 'but had read some rows before stopping', `(${res.rows})`);
  ok(res.dictionaries.length >= 1,
    'and drained them to disk — a cancelled run never discards what it read');
  const total = res.dictionaries.reduce((a, d) => a + d.headwords, 0);
  ok(total === res.rows, 'every row read reached a sidecar', `(${total}/${res.rows})`);
}

// ── The all-or-nothing golden (added after 30 dictionaries went missing) ────
// meta.json used to be written only after the WHOLE 12.7GB pass. Discovery
// requires a meta, so the run that died at 19:20 on 2026-07-26 left 31 folders,
// 2.44GB of correct shards — and exactly ONE readable dictionary. The rows were
// all there; nothing could see them. Meta is now written per batch.
console.log('\n══ a dictionary is READABLE before the pass finishes ══');
{
  const io = memIO();
  let calls = 0;
  const res = await importDexie(io, chunks(doc(), 400), {
    shards: 8, root: 'JP Dictionaries', bufferRows: 12, now: () => 7,
    shouldStop: () => ++calls > 6,
  });
  ok(res.stopped === true, 'the run was cancelled', `(rows ${res.rows})`);

  // The real test: discovery, which is what actually failed on the vault.
  const store = new BigDictStore(io, 'JP Dictionaries');
  const found = await store.refresh();
  ok(found.length === res.dictionaries.length && found.length > 0,
    'EVERY dictionary written so far is discoverable after an interrupted run',
    `(${found.length}/${res.dictionaries.length})`);
  ok(store.installed().every((d) => d.partial),
    'and each is marked 暫定 — a cancelled run must not claim to be finished');
  const totalHeads = store.installed().reduce((a, d) => a + d.headwords, 0);
  ok(totalHeads === res.rows,
    'the running counts in meta match the rows actually converted',
    `(${totalHeads}/${res.rows})`);
}

console.log('\n══ a completed pass clears 暫定 ══');
{
  const io = memIO();
  await importDexie(io, chunks(doc()), {
    shards: 8, root: 'JP Dictionaries', bufferRows: 12, now: () => 0,
  });
  const store = new BigDictStore(io, 'JP Dictionaries');
  await store.refresh();
  ok(store.installed().length === 2, 'both dictionaries installed');
  ok(store.installed().every((d) => !d.partial),
    'a run that finished leaves NO dictionary marked partial');
}

console.log('\n══ skip: an already-converted dictionary is not rebuilt ══');
{
  const io = memIO();
  const res = await importDexie(io, chunks(doc()), {
    shards: 8, root: 'JP Dictionaries', bufferRows: 12, now: () => 0,
    skip: skipTitles([KENKYUSHA]),
  });
  ok(res.skipped.includes(KENKYUSHA), 'the skip is REPORTED, not silent', `(${res.skipped})`);
  ok(res.dictionaries.every((d) => d.title !== KENKYUSHA), 'and it was not converted');
  ok(!(await io.exists(`JP Dictionaries/${KENKYUSHA}/head-000.jsonl`)),
    'its folder was never touched — a finished conversion is not dropped and redone');
  ok(res.dictionaries.some((d) => d.title === '大辞泉'), 'the others still convert');
}

console.log(`\n${fail ? '✗' : '✓'} import-dexie: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
