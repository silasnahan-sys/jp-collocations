/**
 * golden/import-eijiro.mjs — the conversion pipeline end to end (§27.7 step 3).
 *
 * Runs the REAL importer against a BankSource of entries lifted verbatim from
 * the user's export, and asserts the properties that make a 522MB conversion
 * survivable and honest:
 *   • the corpus is never resident — one bank at a time, and a bank is not
 *     retained after it is written
 *   • a re-import REPLACES, so stale headwords cannot outlive the source
 *   • a broken bank is reported, never counted as success (§28 S6)
 *   • everything written is reachable afterwards
 *
 *   node golden/import-eijiro.mjs
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
const sidecarUrl = url(tsc(readFileSync(join(SRCDIR, 'sidecar.ts'), 'utf8'))
  .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`)
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`));
const importUrl = url(tsc(readFileSync(join(SRCDIR, 'import-eijiro.ts'), 'utf8'))
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`)
  .replace(/from ['"]\.\/sidecar\.ts['"]/g, `from '${sidecarUrl}'`));

const { importEijiro, sidecarDirFor } = await import(importUrl);
const S = await import(sidecarUrl);

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
  };
}

const FIX = JSON.parse(readFileSync(join(HERE, 'fixtures', 'eijiro.entries.json'), 'utf8'));
const ALL = Object.values(FIX);

/** A BankSource over the real fixture, split into `banks` banks. */
function source(banks = 3, opts = {}) {
  const per = Math.ceil(ALL.length / banks);
  const names = Array.from({ length: banks }, (_, i) => `term_bank_${i + 1}.json`);
  const opened = [];
  return {
    opened,
    async index() { return { title: '英辞郎 v144', revision: '1.0' }; },
    async bankNames() { return names; },
    async bank(name) {
      opened.push(name);
      if (opts.breakOn === name) throw new Error('corrupt bank');
      const i = names.indexOf(name);
      return ALL.slice(i * per, (i + 1) * per);
    },
  };
}

console.log('══ folder naming ══');
ok(sidecarDirFor('英辞郎 v144') === 'JP Dictionaries/英辞郎 v144', 'title → vault folder');
ok(!sidecarDirFor('a/b:c*d').includes('/b'), 'path-hostile characters are sanitized',
  `(${sidecarDirFor('a/b:c*d')})`);

console.log('\n══ a real conversion ══');
{
  const io = memIO();
  const src = source(3);
  const seen = [];
  const res = await importEijiro(io, src, {
    shards: 8, now: () => 0, onProgress: (p) => seen.push(p),
  });
  ok(res.title === '英辞郎 v144', 'title read from index.json');
  ok(res.banks === 3, 'every bank processed', `(${res.banks})`);
  ok(res.headwords === ALL.length, 'every entry converted', `(${res.headwords}/${ALL.length})`);
  ok(res.frames > 0, 'the reach-for index was built', `(${res.frames})`);
  ok(res.failed.length === 0, 'no failures on clean input');
  ok(seen.length === 3, 'progress reported per bank', `(${seen.length})`);
  ok(seen[2].headwords === ALL.length, 'progress accumulates');

  // the whole point: everything written is findable
  let found = 0;
  for (const k of Object.keys(FIX)) {
    if ((await S.lookupHead(io, res.dir, k, 8)).length) found++;
  }
  ok(found === Object.keys(FIX).length,
    'every imported headword is reachable', `(${found}/${Object.keys(FIX).length})`);

  const meta = await S.readMeta(io, res.dir);
  ok(meta.headwords === res.headwords && meta.shards === 8, 'meta records the real shape');
  ok(meta.format === 1, 'the line format is versioned (future migrations)');
}

console.log('\n══ streaming: the corpus is never resident ══');
{
  const io = memIO();
  const src = source(4);
  await importEijiro(io, src, { shards: 4, now: () => 0 });
  ok(src.opened.length === 4, 'each bank opened exactly once', `(${src.opened.length})`);
  ok(new Set(src.opened).size === 4, 'no bank re-read (nothing is being held and revisited)');
}

console.log('\n══ re-import REPLACES (stale headwords cannot outlive the source) ══');
{
  const io = memIO();
  const dir = sidecarDirFor('英辞郎 v144');
  // first import: the full fixture
  await importEijiro(io, source(2), { shards: 8, now: () => 0 });
  const before = await S.lookupHead(io, dir, '$__ in arrears', 8);
  ok(before.length === 1, 'entry present after first import');

  // second import: a SMALLER source that no longer contains that entry
  const shrunk = {
    async index() { return { title: '英辞郎 v144', revision: '2.0' }; },
    async bankNames() { return ['b1']; },
    async bank() { return [FIX['"V for Victory" sign']]; },
  };
  const res2 = await importEijiro(io, shrunk, { shards: 8, now: () => 0 });
  ok(res2.headwords === 1, 're-import wrote only the new source', `(${res2.headwords})`);
  const after = await S.lookupHead(io, dir, '$__ in arrears', 8);
  ok(after.length === 0,
    'the dropped entry is GONE — a re-import is a rebuild, not an accumulation');
  ok((await S.lookupHead(io, dir, '"V for Victory" sign', 8)).length === 1,
    'and the surviving entry is still reachable');
}

console.log('\n══ a broken bank is reported, never swallowed (§28 S6) ══');
{
  const io = memIO();
  const src = source(3, { breakOn: 'term_bank_2.json' });
  const res = await importEijiro(io, src, { shards: 8, now: () => 0 });
  ok(res.failed.length === 1, 'the failure is counted', `(${JSON.stringify(res.failed)})`);
  ok(res.failed[0] === 'term_bank_2.json', 'and NAMED, so it can be investigated');
  ok(res.banks === 3, 'the run continues past it rather than aborting');
  ok(res.headwords > 0 && res.headwords < ALL.length,
    'the result honestly reports a PARTIAL import', `(${res.headwords}/${ALL.length})`);
}

console.log('\n══ cancellation ══');
{
  const io = memIO();
  let seen = 0;
  const res = await importEijiro(io, source(4), {
    shards: 4, now: () => 0, shouldStop: () => ++seen > 2,
  });
  ok(res.banks <= 2, 'shouldStop halts between banks', `(${res.banks})`);
  ok((await S.readMeta(io, res.dir)) !== null,
    'meta is still written, so a cancelled import is not an unreadable folder');
}

console.log(`\n${fail ? '✗' : '✓'} import-eijiro: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
