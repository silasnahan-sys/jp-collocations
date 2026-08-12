/**
 * golden/drop-bytes.mjs — the carry that died on the doorstep.
 *
 * MEASURED, 2026-08-08, from a camera recording of the iPad: lasso a run of
 * Apple Pencil handwriting in Apple Notes, drag it across the seam onto 収集
 * トレイ, let go — and the plugin answered
 *
 *     ⤵ トレイへ に失敗しました
 *     NotFoundError: The object can not be found here.
 *
 * three separate times. Nothing about the gesture was wrong. A cross-app carry
 * on iPadOS hands over a *promise* of a file, WebKit materialises it lazily from
 * the sending app's item provider, and that provider is only guaranteed alive
 * for the `drop` dispatch. `runDropIntent` awaited `f.arrayBuffer()` one
 * microtask later, by which point there was nothing behind the File.
 *
 * Two rules are locked in here, and they are the whole fix:
 *
 *   1. The read STARTS inside the drop dispatch (`holdBytes`), not when the
 *      executor gets around to it. Move it and the bug returns.
 *   2. A file that cannot be produced resolves to `null` and NEVER rejects, so
 *      one dead payload cannot take the rest of the carry — or the text the
 *      same drop was carrying — down with it.
 *
 * Run:  node golden/drop-bytes.mjs
 */
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// `drop-router.ts` imports `Notice` from obsidian; without the stub the suite
// dies at import time. See golden/stub/loader.mjs.
register(pathToFileURL(join(HERE, 'stub', 'loader.mjs')));
const R = await import(pathToFileURL(join(HERE, '..', 'src', 'ui', 'drop-router.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const bytesOf = (s) => new TextEncoder().encode(s).buffer;

/** A File whose bytes are only obtainable while `alive` — the item provider. */
function promisedFile(name, body, state) {
  return {
    name,
    type: 'image/png',
    arrayBuffer: () => state.alive
      ? Promise.resolve(bytesOf(body))
      // WebKit's own wording, verbatim — the string Silas saw on screen.
      : Promise.reject(Object.assign(new Error('The object can not be found here.'), { name: 'NotFoundError' })),
  };
}

console.log('\ndrop-bytes — the Pencil carry across the seam\n');

// ── 1. the bug, reproduced ────────────────────────────────────────────────
{
  const state = { alive: true };
  const f = promisedFile('handwriting.png', 'strokes', state);
  // The old code path: let the dispatch end, THEN read.
  state.alive = false;
  let threw = null;
  try { await f.arrayBuffer(); } catch (e) { threw = e; }
  check('a promised file read after the dispatch throws NotFoundError',
    threw?.name === 'NotFoundError', String(threw));
}

// ── 2. the fix: hold the bytes during the dispatch ────────────────────────
{
  const state = { alive: true };
  const f = promisedFile('handwriting.png', 'strokes', state);
  // What `realSample` now does, synchronously, inside the drop handler.
  const held = R.dropBytes(f);           // read starts here…
  state.alive = false;                   // …provider goes away…
  const got = await held;                // …and the bytes still arrive.
  check('bytes held during the dispatch survive the provider going away',
    got !== null && new TextDecoder().decode(got) === 'strokes');
}

// ── 3. never rejects ──────────────────────────────────────────────────────
{
  const state = { alive: false };
  const f = promisedFile('gone.png', 'x', state);
  let rejected = false;
  const got = await R.dropBytes(f).catch(() => { rejected = true; return undefined; });
  check('an unproducible file resolves to null rather than rejecting', !rejected && got === null);
}

// ── 4. one dead payload does not take the live ones with it ───────────────
{
  const live = { alive: true }, dead = { alive: false };
  const files = [
    promisedFile('a.png', 'A', live),
    promisedFile('b.png', 'B', dead),
    promisedFile('c.png', 'C', live),
  ];
  const out = [];
  let unreadable = 0;
  for (const f of files) {
    const data = await R.dropBytes(f);
    if (!data) { unreadable++; continue; }
    out.push(new TextDecoder().decode(data));
  }
  check('two of three land when the middle one is unproducible',
    out.join('') === 'AC' && unreadable === 1, `${out.join('')} / ${unreadable}`);
}

// ── 5. a live handle still works without ever having been dropped ─────────
{
  const f = promisedFile('picked.png', 'from a file picker', { alive: true });
  const got = await R.dropBytes(f);
  check('a file that never went through a drop reads normally',
    got !== null && new TextDecoder().decode(got) === 'from a file picker');
}

// ── 6. the same File asked twice gives the same bytes once ────────────────
{
  const state = { alive: true };
  let reads = 0;
  const f = {
    name: 'once.png', type: 'image/png',
    arrayBuffer: () => { reads++; return state.alive ? Promise.resolve(bytesOf('one')) : Promise.reject(new Error('gone')); },
  };
  const a = R.dropBytes(f);
  state.alive = false;
  const b = R.dropBytes(f);
  const [ra, rb] = [await a, await b];
  check('a held file is read exactly once and replayed',
    reads === 1 && ra !== null && rb !== null, `reads=${reads}`);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
