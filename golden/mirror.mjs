/**
 * golden/mirror.mjs — the vault-native catalog mirror (DESIGN §19).
 *
 * catalog.jsonl must round-trip losslessly (it is the disaster-recovery
 * source), stay diff-stable (sorted by id), and catalog.md must be
 * deterministic so the idempotent writer can skip unchanged writes.
 *
 * Run:  node golden/mirror.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const M = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'catalog-mirror.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const entry = (id, cls, key, extra = {}) => ({
  id, class: cls, classRatified: true, keyKind: 'surface', key, note: key,
  payload: {}, attestations: [], createdAt: 1, updatedAt: 1, ...extra,
});

console.log('══ catalog.jsonl: lossless round-trip ══');
{
  const entries = [
    entry('pat-b', 'collocation', '気になる', {
      payload: { gloss: 'to weigh on one', parts: ['気', 'なる'] },
      attestations: [{ source: 'yt', file: 'T/v.md', tStartSec: 30, quote: '気になってた', addedAt: 1 }],
    }),
    entry('pat-a', 'skeletal', 'だったら〜じゃん', { keyKind: 'link', payload: { parts: ['だったら', 'じゃん'] } }),
    entry('pat-c', 'discourse', '照れ隠し', { rejectedAtts: ['x|1|yt'] }),
  ];
  const jsonl = M.renderCatalogJsonl(entries);
  const back = M.parseCatalogJsonl(jsonl);
  check('every entry survives', back.length === 3);
  check('deep equality (payload, attestations, rejectedAtts)', JSON.stringify([...entries].sort((a, b) => a.id.localeCompare(b.id))) === JSON.stringify(back));
  check('sorted by id for stable diffs', jsonl.indexOf('pat-a') < jsonl.indexOf('pat-b') && jsonl.indexOf('pat-b') < jsonl.indexOf('pat-c'));
  check('trailing newline (POSIX text file)', jsonl.endsWith('\n'));
}

console.log('══ parse resilience ══');
{
  const good = JSON.stringify(entry('pat-x', 'serifu', 'まあね'));
  const text = `${good}\nGARBAGE NOT JSON\n{"id":"no-key-field","class":"serifu"}\n\n${good.replace('pat-x', 'pat-y')}\n`;
  const back = M.parseCatalogJsonl(text);
  check('malformed lines skipped, valid kept', back.length === 2 && back[0].id === 'pat-x' && back[1].id === 'pat-y');
  check('empty text → empty list', M.parseCatalogJsonl('').length === 0);
}

console.log('══ catalog.md: deterministic + readable ══');
{
  const entries = [
    entry('p1', 'collocation', '気になる', {
      payload: { gloss: 'weighs on one' },
      attestations: [
        { source: 'yt', quote: 'a', addedAt: 1 },
        { source: 'yt', quote: 'b', addedAt: 1, status: 'suggested' },
      ],
    }),
    entry('p2', 'skeletal', 'だったら〜じゃん'),
  ];
  const md = M.renderCatalogMd(entries);
  check('class sections with emoji', md.includes('## 🔵 連語 (1)') && md.includes('## 🟠 骨格構文 (1)'));
  check('entry row carries gloss + counts', md.includes('**気になる** — weighs on one 〔1件 +候補1〕'));
  check('deterministic (no timestamps)', M.renderCatalogMd(entries) === md);
  check('empty catalog still renders header', M.renderCatalogMd([]).includes('# パターン台帳'));
}

console.log(fail ? `\n✗ mirror: ${fail} failed (${pass} passed)` : `\n✓ mirror: all ${pass} pass`);
process.exit(fail ? 1 : 0);
