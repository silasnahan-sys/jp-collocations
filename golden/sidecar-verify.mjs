/**
 * golden/sidecar-verify.mjs — a converted dictionary must not be able to lose
 * data quietly (§27.5, §28 S6).
 *
 * The failure this exists to catch, observed on the real vault: 英辞郎 v144
 * held 512 head shards and only 186 frame shards (326–511), while its meta.json
 * still claimed 1,759,832 frames. Nothing anywhere reported it — a missing
 * shard file makes `read` return null, `decodeLines(null)` return [], and the
 * caller sees a word with no reach-for candidates rather than a dictionary with
 * no file. `repairSidecarMeta` could not see it either, by construction: it
 * skips every folder whose meta is readable, which is exactly the state a
 * half-finished `dropSidecar` leaves behind.
 *
 *   node golden/sidecar-verify.mjs
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
const S = await import(dataUrl(
  tsc(readFileSync(join(SRCDIR, 'sidecar.ts'), 'utf8'))
    .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`)
    .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`),
));

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => {
  n++;
  if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg}`);
};

/** The same in-memory filesystem the sidecar golden uses. */
function memIO(onRemove) {
  const files = new Map();
  const dirs = new Set();
  let removes = 0;
  return {
    files, dirs,
    async read(p) { return files.has(p) ? files.get(p) : null; },
    async write(p, t) { files.set(p, t); },
    async append(p, t) { files.set(p, (files.get(p) ?? '') + t); },
    async exists(p) { return files.has(p); },
    async mkdir(p) { dirs.add(p); },
    async remove(p) { onRemove?.(++removes, p); files.delete(p); },
    async listFiles(p) {
      return [...files.keys()]
        .filter((k) => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes('/'))
        // The vault adapter lists in name order, which is what put frame-* in
        // front of head-* in front of meta.json when the damage happened.
        .sort();
    },
    async listFolders(p) {
      const set = new Set();
      for (const k of files.keys()) {
        if (!k.startsWith(`${p}/`)) continue;
        const rest = k.slice(p.length + 1);
        const i = rest.indexOf('/');
        if (i > 0) set.add(rest.slice(0, i));
      }
      return [...set];
    },
  };
}

const ROOT = 'JP Dictionaries';

/** Write a dictionary of the given density directly — no adapter in the way. */
async function build(io, title, { shards, perHead, perFrame }) {
  const dir = `${ROOT}/${title}`;
  for (let s = 0; s < shards; s++) {
    await io.append(S.headPath(dir, s), `{"k":"h${s}","e":{}}\n`.repeat(perHead));
    await io.append(S.framePath(dir, s), `{"k":"f${s}","c":[]}\n`.repeat(perFrame));
  }
  await S.writeMeta(io, dir, {
    title, revision: '1.0', shards,
    headwords: shards * perHead, frames: shards * perFrame,
    builtAt: 0, format: 1,
  });
  return dir;
}

console.log('══ a healthy dictionary verifies clean ══');
{
  const io = memIO();
  const dir = await build(io, 'healthy', { shards: 8, perHead: 400, perFrame: 300 });
  const v = await S.verifySidecar(io, dir, { deep: true });
  ok(v.ok, 'ok with every shard present and counts matching', JSON.stringify(v.problems));
  ok(v.found.headwords === 3200 && v.found.frames === 2400, 'deep counts match meta');
  ok(v.found.headShards === 8 && v.found.frameShards === 8, 'both families fully present');
  ok(!v.partial, 'a completed conversion is not flagged partial');
}

console.log('\n══ THE 英辞郎 CASE: shards deleted, meta left behind ══');
{
  const io = memIO();
  const dir = await build(io, '英辞郎 v144', { shards: 8, perHead: 400, perFrame: 300 });
  // Exactly the observed shape: a contiguous run of FRAME shards gone from the
  // low end, every head shard intact, meta untouched and still claiming them.
  for (let s = 0; s < 5; s++) io.files.delete(S.framePath(dir, s));

  const v = await S.verifySidecar(io, dir);
  ok(!v.ok, 'presence-only verification fails the damaged dictionary');
  const miss = v.problems.find((p) => p.kind === 'missing-shards');
  ok(!!miss && miss.family === 'frame', 'the frame family is named as the damaged one');
  ok(miss && miss.present === 3 && miss.of === 8, 'reports 3/8 present', JSON.stringify(miss?.missing));
  ok(miss && S.summarizeIndices(miss.missing) === '0–4', 'the hole reads as a range, not 5 numbers');
  ok(v.problems.every((p) => p.family !== 'head'), 'the intact head family is NOT accused');
  ok(v.claimed.frames === 2400, 'meta is still claiming the frames that are gone');

  const deep = await S.verifySidecar(io, dir, { deep: true });
  const mismatch = deep.problems.find((p) => p.kind === 'count-mismatch');
  ok(!!mismatch && mismatch.claimed === 2400 && mismatch.found === 900,
    'deep verification names the exact shortfall', JSON.stringify(mismatch));

  // The regression that matters: repair alone calls this dictionary healthy.
  const res = await S.repairSidecarMeta(io, ROOT);
  ok(res.alreadyOk.includes('英辞郎 v144') && res.repaired.length === 0,
    'repairSidecarMeta still sees only a readable meta and skips it');
  ok(!v.ok, 'verification is therefore the ONLY thing that can catch this');

  const text = S.describeSidecarProblem(miss);
  ok(/3\/8/.test(text) && /0–4/.test(text), 'the notice says what is missing', text);
}

console.log('\n══ a sparse dictionary is not falsely accused ══');
{
  // 8 frames over 8 shards: an empty shard here is ordinary, not damage.
  const io = memIO();
  const dir = await build(io, 'sparse', { shards: 8, perHead: 2, perFrame: 1 });
  for (let s = 0; s < 4; s++) io.files.delete(S.framePath(dir, s));
  // meta must match what is really left, or we would be testing the wrong thing
  await S.writeMeta(io, dir, {
    title: 'sparse', revision: '1.0', shards: 8, headwords: 16, frames: 4, builtAt: 0, format: 1,
  });
  const v = await S.verifySidecar(io, dir, { deep: true });
  ok(v.ok, 'below the density floor, absent shards are not reported', JSON.stringify(v.problems));
}

console.log('\n══ an interrupted drop can no longer hide ══');
{
  // Kill the drop after it has removed a couple of files, the way a crash or a
  // closed app does. Before the fix this left meta alive and the damage mute.
  const io = memIO((count) => { if (count === 3) throw new Error('interrupted'); });
  const dir = await build(io, 'interrupted', { shards: 8, perHead: 400, perFrame: 300 });
  await S.dropSidecar(io, dir, 8).catch(() => {});

  ok(!(await io.exists(S.metaPath(dir))), 'meta.json is the FIRST thing deleted');
  ok(io.files.size > 0, 'the interrupt really did leave shards behind', `(${io.files.size})`);

  const res = await S.repairSidecarMeta(io, ROOT);
  ok(res.repaired.some((r) => r.title === 'interrupted'),
    'repair can now see the wreckage and rebuild a meta for it');
  ok(res.repaired.find((r) => r.title === 'interrupted') &&
     (await S.readMeta(io, dir))?.partial === true,
    'and presents it as 暫定 rather than as a finished dictionary');
}

console.log('\n══ verifyAllSidecars: worst first, and quiet about non-dictionaries ══');
{
  const io = memIO();
  await build(io, 'good-a', { shards: 8, perHead: 400, perFrame: 300 });
  await build(io, 'good-b', { shards: 8, perHead: 400, perFrame: 300 });
  const bad = await build(io, 'broken', { shards: 8, perHead: 400, perFrame: 300 });
  for (let s = 0; s < 6; s++) io.files.delete(S.framePath(bad, s));
  await io.write(`${ROOT}/notes/README.md`, 'not a dictionary');

  const all = await S.verifyAllSidecars(io, ROOT);
  ok(all.length === 3, 'a folder with no shards and no meta is not listed', `(${all.length})`);
  ok(all[0].title === 'broken' && !all[0].ok, 'the damaged dictionary sorts first');
  ok(all.filter((v) => !v.ok).length === 1, 'exactly one is called broken');
  ok(all.every((v) => v.found.headwords === null), 'presence-only mode reads no shard bodies');
}

console.log('\n══ shard-index overflow (the hash width changed under the data) ══');
{
  const io = memIO();
  const dir = await build(io, 'overflow', { shards: 8, perHead: 400, perFrame: 300 });
  await io.append(S.headPath(dir, 9), '{"k":"x","e":{}}\n');
  const v = await S.verifySidecar(io, dir);
  const of = v.problems.find((p) => p.kind === 'shard-overflow');
  ok(!!of && of.max === 9 && of.shards === 8, 'a shard beyond meta.shards is reported', JSON.stringify(of));
}

console.log('\n══ summarizeIndices ══');
ok(S.summarizeIndices([0, 1, 2, 3]) === '0–3', 'one run');
ok(S.summarizeIndices([3, 1, 0, 2]) === '0–3', 'unsorted input');
ok(S.summarizeIndices([0, 1, 5]) === '0–1, 5', 'run plus singleton');
ok(S.summarizeIndices([7]) === '7', 'single index');
ok(S.summarizeIndices([]) === '', 'nothing missing');

// The shelf is 51,016 files in a vault of 636 notes; a leading dot takes it out
// of Obsidian's index without changing how the plugin reads it. The SETTING
// syncs, the FOLDER may not — so the name is resolved from disk, not trusted.
console.log('\n══ resolveBigDictRoot: whichever shelf is actually there ══');
{
  const has = (...paths) => { const s = new Set(paths); return async (p) => s.has(p); };
  const R = async (exists, cfg = 'JP Dictionaries') => S.resolveBigDictRoot(exists, cfg);

  ok(await R(has('.JP Dictionaries')) === '.JP Dictionaries', 'dotted shelf found');
  ok(await R(has('JP Dictionaries')) === 'JP Dictionaries', 'plain shelf still works');
  ok(await R(has('.JP Dictionaries', 'JP Dictionaries')) === '.JP Dictionaries',
    'both present → dotted wins (the plain one is the leftover)');
  ok(await R(has()) === 'JP Dictionaries',
    'neither present → the CONFIGURED name, so a fresh install is not created hidden');
  ok(await R(has('.Books'), 'Books') === '.Books', 'honours a custom configured root');
  ok(await R(has('.Books'), '.Books') === '.Books', 'an already-dotted setting is not double-dotted');
  ok(await R(has(), '   ') === 'JP Dictionaries', 'blank setting falls back to the default');
  ok(await S.resolveBigDictRoot(async () => { throw new Error('adapter down'); }, 'JP Dictionaries')
    === 'JP Dictionaries', 'an exists() that throws does not take the plugin down');
  ok(S.dottedRoot('JP Dictionaries') === '.JP Dictionaries' && S.dottedRoot('.x') === '.x',
    'dottedRoot is idempotent');
}

console.log(`\n${fail ? '✗' : '✓'} sidecar-verify: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
