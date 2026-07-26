/**
 * golden/dexie-stream.mjs — reading the 12.7GB Yomitan backup.
 *
 * Runs against `fixtures/dexie-terms.fragment.json`, which is bytes cut
 * verbatim out of the user's real 12,775,408,499-byte export — not a mock.
 *
 * What has to hold, because the file cannot be re-read cheaply if it doesn't:
 *   • rows survive being split across ARBITRARY chunk boundaries (a 12.7GB
 *     read never lands on a row edge);
 *   • memory stays bounded — the buffer must not grow with the file;
 *   • only the requested table is emitted;
 *   • the router groups by dictionary without assuming rows are grouped.
 *
 *   node golden/dexie-stream.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
const { transpileModule } = ts;

const HERE = dirname(fileURLToPath(import.meta.url));
const js = transpileModule(
  readFileSync(join(HERE, '..', 'src', 'dictionary', 'dexie-stream.ts'), 'utf8'),
  { compilerOptions: { module: 'ESNext', target: 'ES2022' } },
).outputText;
const D = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => {
  n++;
  if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg}`);
};

const FRAGMENT = readFileSync(join(HERE, 'fixtures', 'dexie-terms.fragment.json'), 'utf8');

console.log('══ the fixture is real bytes from the 12.7GB export ══');
ok(FRAGMENT.startsWith('"tableName":"terms"'), 'it is a terms chunk header + rows');
ok(FRAGMENT.includes('研究社'), 'carrying a real dictionary title');
ok(/\$types/.test(FRAGMENT), 'and typeson bookkeeping that must be dropped');

console.log('\n══ whole-fragment read ══');
{
  const s = new D.DexieRowStream('terms');
  const rows = s.feed(FRAGMENT).map(D.parseRow).filter(Boolean);
  ok(rows.length === 3, 'all three rows extracted', `(${rows.length})`);
  ok(rows[0].expression === '外字一覧', 'first expression', `(${rows[0].expression})`);
  ok(rows[0].dictionary === '研究社　新和英大辞典　第５版', 'dictionary title rides on the row');
  ok(Array.isArray(rows[0].glossary) && rows[0].glossary.length === 1, 'glossary is an array');
  ok(rows[0].$types === undefined, '$types was dropped');
  ok(rows[1].expression === '〆鯖', 'second row', `(${rows[1].expression})`);
  ok(rows[2].sequence === 2, 'third row keeps its sequence');
}

console.log('\n══ rows survive ARBITRARY chunk boundaries ══');
// A 12.7GB stream never splits on a row edge; every size must give the same rows.
{
  const whole = new D.DexieRowStream('terms').feed(FRAGMENT).map(D.parseRow).filter(Boolean)
    .map((r) => r.expression).join('|');
  let allMatch = true, worstBuf = 0;
  for (const size of [1, 2, 3, 7, 13, 64, 127, 256, 999]) {
    const s = new D.DexieRowStream('terms');
    const got = [];
    for (let i = 0; i < FRAGMENT.length; i += size) {
      for (const r of s.feed(FRAGMENT.slice(i, i + size))) {
        const p = D.parseRow(r);
        if (p) got.push(p.expression);
      }
      worstBuf = Math.max(worstBuf, s.buffered());
    }
    if (got.join('|') !== whole) { allMatch = false; console.log(`      size ${size}: ${got.join('|')}`); }
  }
  ok(allMatch, 'every chunk size from 1 byte to 999 yields identical rows');
  ok(worstBuf < FRAGMENT.length, 'the buffer never holds the whole input', `(peak ${worstBuf}B)`);
}

console.log('\n══ memory stays bounded as the stream grows ══');
{
  // 200 copies of the fragment ≈ a long stream; the buffer must not track it.
  const s = new D.DexieRowStream('terms');
  let peak = 0, count = 0;
  for (let i = 0; i < 200; i++) {
    count += s.feed(FRAGMENT).length;
    peak = Math.max(peak, s.buffered());
  }
  ok(count === 600, 'all rows across 200 repetitions', `(${count})`);
  ok(peak < 4000, 'peak buffer stays tiny regardless of stream length', `(${peak}B)`);
}

console.log('\n══ only the requested table is emitted ══');
{
  const other = '"tableName":"media","inbound":true,"rows":[{"id":1,"path":"x.png"}]},{' + FRAGMENT;
  const s = new D.DexieRowStream('terms');
  const rows = s.feed(other).map(D.parseRow).filter(Boolean);
  ok(rows.length === 3, 'the media table is skipped, the terms rows are not', `(${rows.length})`);
  const m = new D.DexieRowStream('media');
  ok(m.feed(other).length === 1, 'and asking for media gets media instead');
}

console.log('\n══ a table split across several chunks (how Dexie streams) ══');
{
  const split = FRAGMENT + '}],[{' + FRAGMENT;
  const s = new D.DexieRowStream('terms');
  ok(s.feed(split).length === 6, 'rows from BOTH chunks of the same table', `(${s.rows})`);
}

console.log('\n══ rowToTuple feeds the existing adapters unchanged ══');
{
  const r = D.parseRow(new D.DexieRowStream('terms').feed(FRAGMENT)[0]);
  const t = D.rowToTuple(r);
  ok(t.length === 8, 'the 8-slot Yomitan tuple', `(${t.length})`);
  ok(t[0] === '外字一覧' && t[1] === '外字一覧', 'expression + reading in place');
  ok(Array.isArray(t[5]), 'glossary in slot 5 where the adapters look');
  ok(typeof t[4] === 'number' && typeof t[6] === 'number', 'score + sequence are numbers');
}

console.log('\n══ the router groups by dictionary with a BOUNDED buffer ══');
{
  const flushed = [];
  const router = new D.DictionaryRouter(async (dict, tuples) => {
    flushed.push({ dict, n: tuples.length });
  }, 10);
  // interleave two dictionaries — the format does not promise grouping
  for (let i = 0; i < 25; i++) {
    await router.add({
      expression: `w${i}`, reading: '', definitionTags: '', rules: '', score: 0,
      glossary: ['g'], sequence: i, termTags: '',
      dictionary: i % 2 ? 'A' : 'B',
    });
    if (router.pending() > 10) break;
  }
  ok(router.pending() <= 10, 'never buffers past the cap', `(${router.pending()})`);
  await router.drain();
  const total = flushed.reduce((a, f) => a + f.n, 0);
  ok(total === 25, 'every row reaches a flush', `(${total})`);
  ok(router.pending() === 0, 'drain empties it');
  const dicts = new Set(flushed.map((f) => f.dict));
  ok(dicts.has('A') && dicts.has('B'), 'both dictionaries came out separately',
    `(${[...dicts].join(',')})`);
  ok(flushed.every((f) => f.n > 0), 'no empty flushes');
}

console.log('\n══ junk degrades to nothing, never a throw ══');
ok(D.parseRow('not json') === null, 'unparseable row → null');
ok(D.parseRow('{"id":1}') === null, 'a non-term row → null');
ok(new D.DexieRowStream('terms').feed('').length === 0, 'empty chunk is fine');
ok(new D.DexieRowStream('terms').feed('{"a":1}').length === 0, 'text outside a table emits nothing');

console.log(`\n${fail ? '✗' : '✓'} dexie-stream: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
