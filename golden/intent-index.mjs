/**
 * golden/intent-index.mjs — the MEANING side of the shelf (§27.2, §27.0.1).
 *
 * §27.0.1: a phrase is not a translation, it is one meaning externalized twice.
 * The storage layer only honoured one of the two — the sidecar was keyed on the
 * Japanese shape and on the headword, never on the English — so the shelf could
 * be asked "what does this Japanese say?" and never "how is this said?". The
 * intention key was computed by the adapters, dropped by `packCandidate`, and
 * blanked again at read (`intentionKey: ''`), which is why the donor essay's own
 * query — "at some point" → どっかのタイミングで — was the one query the plugin
 * could not serve, and why an English want could sit open receiving zero offers.
 *
 * This pins the third shard family, its derivation from data already on disk,
 * and the offer it makes possible.
 *
 *   node golden/intent-index.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
const { transpileModule } = ts;

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const tsc = (src) => transpileModule(src, {
  compilerOptions: { module: 'ESNext', target: 'ES2022' },
}).outputText;
const dataUrl = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64');
const read = (p) => readFileSync(join(SRC, p), 'utf8');

const framesUrl = dataUrl(tsc(read('dictionary/frames.ts')));
const eijiroUrl = dataUrl(tsc(read('dictionary/eijiro.ts'))
  .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`));
const S = await import(dataUrl(tsc(read('dictionary/sidecar.ts'))
  .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`)
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`)));
const R = await import(dataUrl(tsc(read('notes/reach.ts'))
  .replace(/from ['"]\.\.\/dictionary\/frames\.ts['"]/g, `from '${framesUrl}'`)));
const { normalizeFrame } = await import(framesUrl);

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
    async listFiles(p) {
      return [...files.keys()]
        .filter((k) => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes('/')).sort();
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

/** A headword with its reach-for half, the way the adapters produce one. */
const entry = (expression, reach) => ({
  expression, pos: [], senses: [], xrefs: [], sequence: 0,
  reachFor: reach.map((r) => ({
    intention: r.intention ?? expression,
    surface: r.surface,
    frameKey: r.frameKey ?? r.surface,
    intentionKey: S.intentionKeyOf(r.intention ?? expression),
    slots: 0,
    classHint: r.classHint ?? 'collocation',
    ...(r.situation ? { situation: r.situation } : {}),
  })),
});

const DIR = 'JP Dictionaries/テスト辞書';
const SHARDS = 16;

// The donor essay's own case, plus enough neighbours to be a real index.
const ENTRIES = [
  entry('at some point', [
    { surface: 'どっかのタイミングで' },
    { surface: 'いつかは' },
  ]),
  entry('undergo', [
    { surface: '受ける', situation: '手術などを' },
    { surface: '経験する' },
  ]),
  entry('reluctantly', [{ surface: 'しぶしぶ' }]),
  entry('at some point', [{ surface: 'そのうち' }]),   // same want, second book row
];

console.log('══ the key space: one meaning, two externalizations ══');
{
  ok(S.intentionKeyOf('at some point') === 'at some point', 'the English is a key');
  ok(S.intentionKeyOf('  At Some Point  ') !== '', 'and survives whitespace');
  ok(S.shardOf(S.intentionKeyOf('at some point'), SHARDS) ===
     S.shardOf(S.intentionKeyOf('at some point'), SHARDS), 'the shard is a pure function of it');
  // The whole point of §27.7: ONE normalization, shared with the Japanese side.
  // If these ever diverge, a want and the row filed under it stop meeting.
  for (const probe of ['a ～', 'be ～ed', 'at some point', '  A  Bit  ']) {
    ok(S.intentionKeyOf(probe) === normalizeFrame(probe),
      `the intention key IS the shared frame normalization: ${JSON.stringify(probe)}`);
  }
}

console.log('\n══ round trip: reachable from BOTH sides ══');
{
  const io = memIO();
  const res = await S.appendBatch(io, DIR, ENTRIES, SHARDS);
  ok(res.intents > 0, `appendBatch writes the intent family (${res.intents} lines)`);

  const byMeaning = await S.lookupIntent(io, DIR, 'at some point', SHARDS);
  ok(byMeaning.length === 3, `「at some point」 → ${byMeaning.length} candidates`,
    JSON.stringify(byMeaning.map((c) => c.surface)));
  ok(byMeaning.some((c) => c.surface === 'どっかのタイミングで'),
    'THE donor-essay query returns どっかのタイミングで');
  ok(byMeaning.every((c) => c.intentionKey === 'at some point'),
    'every candidate carries the key it was found by (no longer blanked)');
  ok(byMeaning.every((c) => c.frameKey),
    'and its Japanese frame, which the line key can no longer imply');

  const byShape = await S.lookupFrame(io, DIR, 'どっかのタイミングで', SHARDS);
  ok(byShape.length === 1, 'the same row is still reachable from the Japanese side');
  ok(byShape[0].intention === 'at some point', 'and names the intention it answers');
  ok(byShape[0].intentionKey === 'at some point',
    'unpackCandidate no longer returns a blank intentionKey');

  const miss = await S.lookupIntent(io, DIR, 'no such want', SHARDS);
  ok(miss.length === 0, 'an unindexed want returns nothing, not everything');
}

console.log('\n══ derivation: no re-import, no source archive ══');
{
  // An "old" dictionary: frame shards only, exactly what every converted book
  // on the shelf looked like before this family existed.
  const io = memIO();
  for (const [shard, lines] of S.planFrameShards(ENTRIES, SHARDS)) {
    await io.append(S.framePath(DIR, shard), lines.map(S.encodeLine).join(''));
  }
  await S.writeMeta(io, DIR, {
    title: 'テスト辞書', revision: '1.0', shards: SHARDS,
    headwords: 0, frames: 4, builtAt: 0, format: 1,
  });
  ok((await S.lookupIntent(io, DIR, 'at some point', SHARDS)).length === 0,
    'before: the meaning side answers nothing');

  const built = await S.buildIntentIndex(io, DIR, { shards: SHARDS, passes: 4 });
  ok(built.keys === 3, `derived ${built.keys} intention keys from the frame shards alone`);
  ok(built.candidates === 6, `and ${built.candidates} candidates`, String(built.candidates));

  const after = await S.lookupIntent(io, DIR, 'at some point', SHARDS);
  ok(after.length === 3, 'after: the same query the shelf could not serve now answers');
  ok(after.some((c) => c.surface === 'どっかのタイミングで'), 'with the right phrase');
  ok(after.every((c) => c.frameKey), 'the Japanese frame survived the re-keying');

  // The derivation must agree with what a fresh import would have written.
  const native = new Set();
  for (const [, lines] of S.planIntentShards(ENTRIES, SHARDS)) {
    for (const l of lines) for (const c of l.c) native.add(`${l.k}|${c.s}|${c.f}`);
  }
  const derived = new Set();
  for (let s = 0; s < SHARDS; s++) {
    for (const l of S.decodeLines(await io.read(S.intentPath(DIR, s)))) {
      for (const c of l.c) derived.add(`${l.k}|${c.s}|${c.f}`);
    }
  }
  ok(native.size === derived.size && [...native].every((x) => derived.has(x)),
    'derived index == what a fresh import writes natively',
    `(native ${native.size}, derived ${derived.size})`);
}

console.log('\n══ the pass count is memory, never meaning ══');
{
  const build = async (passes) => {
    const io = memIO();
    for (const [shard, lines] of S.planFrameShards(ENTRIES, SHARDS)) {
      await io.append(S.framePath(DIR, shard), lines.map(S.encodeLine).join(''));
    }
    await S.buildIntentIndex(io, DIR, { shards: SHARDS, passes });
    const rows = [];
    for (let s = 0; s < SHARDS; s++) {
      for (const l of S.decodeLines(await io.read(S.intentPath(DIR, s)))) {
        for (const c of l.c) rows.push(`${l.k}|${c.s}|${c.f}`);
      }
    }
    return rows.sort().join('\n');
  };
  const one = await build(1), four = await build(4), sixteen = await build(16);
  ok(one === four && four === sixteen, 'passes=1, 4 and 16 produce byte-identical indexes');
}

console.log('\n══ rebuilding does not double the index ══');
{
  const io = memIO();
  for (const [shard, lines] of S.planFrameShards(ENTRIES, SHARDS)) {
    await io.append(S.framePath(DIR, shard), lines.map(S.encodeLine).join(''));
  }
  const a = await S.buildIntentIndex(io, DIR, { shards: SHARDS });
  const b = await S.buildIntentIndex(io, DIR, { shards: SHARDS });
  ok(a.candidates === b.candidates, 'a second build writes the same count, not twice as many');
  const hits = await S.lookupIntent(io, DIR, 'at some point', SHARDS);
  ok(hits.length === 3, 'and a lookup is not duplicated', String(hits.length));
}

console.log('\n══ maintenance learned the third family ══');
{
  const io = memIO();
  await S.appendBatch(io, DIR, ENTRIES, SHARDS);
  const cls = S.classifyShardFiles(await io.listFiles(DIR));
  ok(cls.intent.length > 0, 'classifyShardFiles recognizes intent shards');

  // A dictionary with NO intention index is not damaged — it is un-indexed.
  const old = memIO();
  for (const [shard, lines] of S.planFrameShards(ENTRIES, SHARDS)) {
    await old.append(S.framePath(DIR, shard), lines.map(S.encodeLine).join(''));
  }
  const frameRows = [...S.planFrameShards(ENTRIES, SHARDS).values()]
    .reduce((a, l) => a + l.length, 0);
  await S.writeMeta(old, DIR, {
    title: 'テスト辞書', revision: '1.0', shards: SHARDS, headwords: 0, frames: frameRows,
    builtAt: 0, format: 1,
  });
  const v = await S.verifySidecar(old, DIR, { deep: true });
  ok(v.ok, 'a book converted before the family existed still verifies clean',
    JSON.stringify(v.problems));
  ok(v.noIntentIndex, 'but the verdict says it has no meaning-side index');

  // Declared and then lost IS damage.
  const hurt = memIO();
  for (let s = 0; s < SHARDS; s++) {
    await hurt.append(S.headPath(DIR, s), '{"k":"x","e":{}}\n'.repeat(400));
    await hurt.append(S.intentPath(DIR, s), '{"k":"x","c":[]}\n'.repeat(400));
  }
  await S.writeMeta(hurt, DIR, {
    title: 'テスト辞書', revision: '1.0', shards: SHARDS,
    headwords: 6400, frames: 0, intents: 6400, builtAt: 0, format: 1,
  });
  for (let s = 0; s < 10; s++) hurt.files.delete(S.intentPath(DIR, s));
  const v2 = await S.verifySidecar(hurt, DIR);
  ok(!v2.ok, 'a DECLARED intention index that lost shards is reported');
  ok(v2.problems.some((p) => p.kind === 'missing-shards' && p.family === 'intent'),
    'and the intent family is named', JSON.stringify(v2.problems[0]));
  ok(/意図/.test(S.describeSidecarProblem(v2.problems[0])), 'in words a user can read',
    S.describeSidecarProblem(v2.problems[0]));

  // dropSidecar's probe fallback must take the third family with it.
  const bare = memIO();
  const noList = { ...bare, listFiles: undefined };
  await bare.append(S.intentPath(DIR, 3), 'x\n');
  await S.dropSidecar(noList, DIR, SHARDS);
  ok(bare.files.size === 0, 'the probe fallback removes intent shards too', `(${bare.files.size})`);
}

console.log('\n══ AND THE POINT: an English want can now be answered ══');
{
  const reach = {
    id: 'r1', want: 'at some point', createdAt: 0, offers: [],
  };
  const hits = [
    { surface: 'どっかのタイミングで', intentionKey: 'at some point', intention: 'at some point', at: 1 },
    { surface: '関係が破綻した', frameKey: '関係が～した', at: 1 },
  ];
  const made = R.collide([reach], hits, {});
  ok(made.length === 1, 'exactly the candidate filed under the want is offered');
  ok(made[0].offer.reason === 'intention', 'and the reason is `intention`', made[0]?.offer?.reason);
  ok(made[0].offer.surface === 'どっかのタイミングで', 'it is the phrase, not the sentence');
  const why = made[0].offer.why;
  ok(/意味の同一ではありません/.test(why), 'the why refuses to claim equivalence (§28 S3)', why);
  ok(/at some point/.test(why), 'and names where it was filed', why);

  // The regression that made this necessary: an English want matches nothing.
  const before = R.collide([reach], [{ surface: 'どっかのタイミングで', at: 1 }], {});
  ok(before.length === 0,
    'without the index, the same phrase arriving produces NO offer — the old behaviour');

  // A different want must not be answered by this row.
  const other = { id: 'r2', want: 'undergo', createdAt: 0, offers: [] };
  ok(R.collide([other], hits, {}).length === 0, 'a want it was not filed under gets nothing');

  // Precedence: intention beats a token coincidence.
  const tokenish = { id: 'r3', want: 'undergo surgery', createdAt: 0, offers: [] };
  const both = R.collide([tokenish], [
    { surface: 'undergo surgery を含む文', at: 1 },                       // token match
    { surface: '手術を受ける', intentionKey: 'undergo surgery', intention: 'undergo surgery', at: 1 },
  ], {});
  const byIntent = both.find((m) => m.offer.reason === 'intention');
  ok(!!byIntent && byIntent.offer.surface === '手術を受ける',
    'the meaning-side hit is offered as `intention`, not swallowed by the token test');
}

console.log(`\n${fail ? '✗' : '✓'} intent-index: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
