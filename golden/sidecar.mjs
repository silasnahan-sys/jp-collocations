/**
 * golden/sidecar.mjs — sharded vault storage for the big dictionaries (§27.5).
 *
 * The invariant that matters: **the shard is a pure function of the key**, so a
 * lookup reads one file and no index is ever loaded. If write-time and
 * read-time normalization ever diverge, entries become silently unreachable —
 * which is the failure this golden exists to catch.
 *
 * Runs against a real in-memory IO, and end-to-end on entries lifted verbatim
 * from the user's export.
 *
 *   node golden/sidecar.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
const { transpileModule } = ts;

const HERE = dirname(fileURLToPath(import.meta.url));
const SRCDIR = join(HERE, '..', 'src', 'dictionary');
const tsc = (src) => transpileModule(src, {
  compilerOptions: { module: 'ESNext', target: 'ES2022' },
}).outputText;
const dataUrl = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64');

const framesUrl = dataUrl(tsc(readFileSync(join(SRCDIR, 'frames.ts'), 'utf8')));
const eijiroUrl = dataUrl(
  tsc(readFileSync(join(SRCDIR, 'eijiro.ts'), 'utf8'))
    .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`),
);
const sidecarJs = tsc(readFileSync(join(SRCDIR, 'sidecar.ts'), 'utf8'))
  .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`)
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`);

const S = await import(dataUrl(sidecarJs));
const { adaptEijiroEntry } = await import(eijiroUrl);
const { normalizeFrame } = await import(framesUrl);

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => {
  n++;
  if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg}`);
};

/** A real IO: an in-memory filesystem that behaves like the vault adapter. */
function memIO() {
  const files = new Map();
  const dirs = new Set();
  return {
    files, dirs,
    async read(p) { return files.has(p) ? files.get(p) : null; },
    async write(p, t) { files.set(p, t); },
    async append(p, t) { files.set(p, (files.get(p) ?? '') + t); },
    async exists(p) { return files.has(p); },
    async mkdir(p) { dirs.add(p); },
    async remove(p) { files.delete(p); },
  };
}

console.log('══ the shard is a pure function of the key ══');
ok(S.hashKey('破綻') === S.hashKey('破綻'), 'hash is stable within a run');
ok(S.hashKey('破綻') !== S.hashKey('破滅'), 'different keys differ');
ok(S.shardOf('破綻', 512) === S.shardOf('破綻', 512), 'shardOf is deterministic');
ok(S.shardOf('破綻', 512) < 512 && S.shardOf('破綻', 512) >= 0, 'shard is in range');
// the normalization must be shared, or write and read disagree
ok(S.shardOf('Break', 512) === S.shardOf(' break ', 512),
  'case and whitespace fold identically at write and read time');
ok(S.normalizeLookupKey(' Ｂreak ') === 'break', 'NFKC + trim + lowercase');
{
  // distribution sanity — a hash that piles everything into one shard would
  // make "one file per lookup" meaningless
  const counts = new Array(64).fill(0);
  for (let i = 0; i < 5000; i++) counts[S.shardOf('word' + i, 64)]++;
  const max = Math.max(...counts), min = Math.min(...counts);
  ok(max < min * 3, 'keys spread across shards (no hot shard)', `(min ${min} max ${max})`);
}

console.log('\n══ line format survives a torn write ══');
ok(S.decodeLines(null).length === 0, 'null body → []');
ok(S.decodeLines('{"k":"a"}\n{"k":"b"}\n').length === 2, 'two lines parse');
ok(S.decodeLines('{"k":"a"}\n{"k":"tor').length === 1,
  'a half-written last line is skipped, not fatal');

console.log('\n══ round-trip on REAL entries from the export ══');
{
  const FIX = JSON.parse(readFileSync(join(HERE, 'fixtures', 'eijiro.entries.json'), 'utf8'));
  const heads = Object.keys(FIX).map((k) => adaptEijiroEntry(FIX[k]));
  const io = memIO();
  const dir = 'JP Dictionaries/英辞郎 v144';
  const SHARDS = 16;

  const res = await S.appendBatch(io, dir, heads, SHARDS);
  await S.writeMeta(io, dir, {
    title: '英辞郎 v144', revision: '1.0', shards: SHARDS,
    headwords: res.heads, frames: res.frames, builtAt: 0, format: 1,
  });
  ok(res.heads === heads.length, 'every headword written', `(${res.heads})`);
  ok(res.frames > 0, 'frames written', `(${res.frames})`);
  ok(io.files.size > 1, 'written across multiple shard files', `(${io.files.size} files)`);
  ok(!io.files.has(`${dir}/index.json`), 'NO index file exists (the shard IS the index)');

  const meta = await S.readMeta(io, dir);
  ok(meta && meta.shards === SHARDS, 'meta round-trips');

  // every entry must be findable by its own expression
  let found = 0;
  for (const h of heads) {
    const got = await S.lookupHead(io, dir, h.expression, SHARDS);
    if (got.some((g) => g.expression === h.expression)) found++;
  }
  ok(found === heads.length, 'EVERY entry is reachable after write', `(${found}/${heads.length})`);

  // one lookup touches one file
  {
    let reads = 0;
    const spy = { ...io, async read(p) { reads++; return io.read(p); } };
    await S.lookupHead(spy, dir, '$__ in arrears', SHARDS);
    ok(reads === 1, 'a lookup reads exactly ONE shard file', `(${reads})`);
  }

  ok((await S.lookupHead(io, dir, 'no-such-headword', SHARDS)).length === 0,
    'an absent headword returns [] (not a crash, not a false hit)');
  ok((await S.lookupHead(io, dir, '  $__ IN ARREARS  ', SHARDS)).length === 1,
    'lookup is case/space-insensitive via the shared normalizer');

  console.log('\n══ the reach-for query — the point of the whole thing ══');
  const jp = '＿ドルの支払いが滞っている';
  const byFrame = await S.lookupFrame(io, dir, jp, SHARDS);
  ok(byFrame.length >= 1, 'a Japanese frame resolves to its candidates', `(${byFrame.length})`);
  ok(byFrame[0].intention === '$__ in arrears',
    'and carries the English intention back', `(${byFrame[0]?.intention})`);

  // THE join: the user's own notation must reach Eijiro's frame
  const userNotation = '○○を買うと自動的に＿ドル値引きされる';
  const joined = await S.lookupFrame(io, dir, userNotation, SHARDS);
  ok(joined.length >= 1,
    "a frame written in the USER's notation finds Eijiro's entry", `(${joined.length})`);
  ok(normalizeFrame(userNotation) === '～を買うと自動的に＿ドル値引きされる',
    'because both normalize to one key');

  ok((await S.lookupFrame(io, dir, '', SHARDS)).length === 0, 'an empty frame returns []');

  console.log('\n══ uninstall = delete ══');
  await S.dropSidecar(io, dir, SHARDS);
  ok(io.files.size === 0, 'dropSidecar removes every file it wrote', `(${io.files.size} left)`);
}

console.log('\n══ batches accumulate (import streams bank by bank) ══');
{
  const FIX = JSON.parse(readFileSync(join(HERE, 'fixtures', 'eijiro.entries.json'), 'utf8'));
  const keys = Object.keys(FIX);
  const io = memIO();
  const dir = 'd';
  const SHARDS = 8;
  const a = keys.slice(0, 6).map((k) => adaptEijiroEntry(FIX[k]));
  const b = keys.slice(6).map((k) => adaptEijiroEntry(FIX[k]));
  await S.appendBatch(io, dir, a, SHARDS);
  await S.appendBatch(io, dir, b, SHARDS);
  let found = 0;
  for (const k of keys) {
    const got = await S.lookupHead(io, dir, k, SHARDS);
    if (got.length) found++;
  }
  ok(found === keys.length,
    'entries from BOTH batches are reachable (append never clobbers)', `(${found}/${keys.length})`);
}

// ── The write-cost golden (added after a real timeout, 2026-07-26) ──────────
// The in-memory IO above makes `append` a free string concat, so it could never
// expose what actually happened in Obsidian: vaultSidecarIO implemented append
// as read-modify-write, every append cost the size of the file so far, and an
// 英辞郎 conversion (~242,000 appends onto shards that grow to ~1MB) died with
// "File system operation timed out". These checks measure CALLS and BYTES, the
// two things a fake filesystem still tells the truth about.
console.log('\n══ write cost: appends must not re-write the whole file ══');
{
  /** An IO that bills like a real filesystem. */
  function billedIO() {
    const files = new Map();
    let calls = 0, bytesTouched = 0;
    return {
      files,
      stats: () => ({ calls, bytesTouched }),
      async read(p) { calls++; const v = files.get(p) ?? null; bytesTouched += v?.length ?? 0; return v; },
      async write(p, t) { calls++; bytesTouched += t.length; files.set(p, t); },
      async append(p, t) { calls++; bytesTouched += t.length; files.set(p, (files.get(p) ?? '') + t); },
      async exists(p) { calls++; return files.has(p); },
      async mkdir() { calls++; },
      async remove(p) { calls++; files.delete(p); },
      async listFolders() { calls++; return []; },
    };
  }

  const CHUNK = 'x'.repeat(1000);
  const ROUNDS = 200;

  // Unbuffered: one call per append, and (in the real adapter) a full rewrite.
  const raw = billedIO();
  for (let i = 0; i < ROUNDS; i++) await raw.append('d/head-000.jsonl', CHUNK);
  const rawStats = raw.stats();

  // Buffered: the same data, far fewer calls.
  const inner = billedIO();
  const buf = S.bufferedSidecarIO(inner, { maxBytes: 50_000 });
  for (let i = 0; i < ROUNDS; i++) await buf.append('d/head-000.jsonl', CHUNK);
  await buf.flush();
  const bufStats = inner.stats();

  ok(bufStats.calls < rawStats.calls / 10,
    'buffering cuts filesystem calls by >10x', `(${rawStats.calls} → ${bufStats.calls})`);
  ok(inner.files.get('d/head-000.jsonl').length === ROUNDS * CHUNK.length,
    'and every byte still lands', `(${inner.files.get('d/head-000.jsonl').length})`);
  ok(bufStats.bytesTouched === ROUNDS * CHUNK.length,
    'bytes written stay LINEAR in the data (not quadratic in file size)',
    `(${bufStats.bytesTouched})`);
}

console.log('\n══ the buffer is consistent while it is still held ══');
{
  const inner = memIO();
  const buf = S.bufferedSidecarIO(inner, { maxBytes: 1 << 20 });
  await buf.append('d/a.jsonl', 'one\n');
  await buf.append('d/a.jsonl', 'two\n');
  ok(await buf.exists('d/a.jsonl'), 'exists() sees an unflushed file');
  ok((await buf.read('d/a.jsonl')) === 'one\ntwo\n',
    'read() serves buffered appends, so a lookup mid-conversion is never torn');
  ok((await inner.read('d/a.jsonl')) === null, 'and nothing has reached disk yet');
  ok(buf.pendingBytes() > 0, 'pendingBytes reports the held tail');
  await buf.flush();
  ok((await inner.read('d/a.jsonl')) === 'one\ntwo\n', 'flush lands it');
  ok(buf.pendingBytes() === 0, 'and empties the buffer');

  await buf.append('d/a.jsonl', 'three\n');
  await buf.write('d/a.jsonl', 'reset\n');
  await buf.flush();
  ok((await inner.read('d/a.jsonl')) === 'reset\n',
    'a write supersedes buffered appends (dropSidecar must really reset)');
}

console.log(`\n${fail ? '✗' : '✓'} sidecar: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
