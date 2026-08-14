/**
 * golden/shape-index.mjs — which books answer the SECOND question.
 *
 * The fixture is a miniature 類語例解-shaped entry — including the label
 * collision the shapes exist to untangle: the MEMBERS section is titled
 * 使い方 (the book's own word), and a flat renderer stacks such blocks
 * meaninglessly (worst on the headword 使い方 itself). The properties:
 *   - `usageNodes` keeps exactly the usage-shaped subtrees, prunes
 *     definitions, and keeps a section only when something usage-shaped
 *     survives inside it (an empty section is an absence, not a frame);
 *   - `summarize` reports shapes in stable order with the PUBLISHER'S OWN
 *     titles as badges — never renamed;
 *   - a definitions-only entry answers `second: false` and prunes to [].
 *
 * Run:  node golden/shape-index.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const S = await import(pathToFileURL(join(HERE, '..', 'src', 'dictionary', 'shape-index.ts')).href);

let n = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  n++;
  if (cond) console.log(`  ✓ ${name}`);
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const ruigo = [
  { shape: 'senses', children: [{ shape: 'prose', text: '低い所から高い所へ移る。' }] },
  {
    shape: 'section', label: '使い方',
    children: [{
      shape: 'members', label: '使い方',
      items: [
        { text: '上がる', gloss: '広く一般に使われる' },
        { text: '登る', gloss: '足を使って高い所へ' },
        { text: '昇る', gloss: '空中を高く移動する' },
      ],
    }],
  },
  {
    shape: 'comparison', label: '類語対比表',
    table: {
      cols: ['階段を～', '日が～', '屋上に～', '煙が～'],
      rows: [
        { item: '上がる', cells: ['○', '−', '○', '○'] },
        { item: '登る', cells: ['○', '−', '△', '−'] },
        { item: '昇る', cells: ['−', '○', '−', '○'] },
      ],
    },
  },
  { shape: 'section', label: '使い分け', children: [{ shape: 'distinctions', label: '使い分け', text: '【1】「上がる」は結果に、「登る」は過程に重点がある。' }] },
  { shape: 'prose', text: '補説…' },
];

{
  const shapes = S.shapesOf(ruigo);
  ok(shapes.has('members') && shapes.has('comparison') && shapes.has('distinctions'),
    'shapesOf walks the tree and sees the usage shapes');
  ok(shapes.has('prose') && shapes.has('senses'),
    'shapesOf reports everything — it is a census, not a filter');

  const sum = S.summarize(ruigo);
  ok(sum.second === true, 'this entry can answer 「使い方は」');
  ok(JSON.stringify(sum.usage) === JSON.stringify(['members', 'comparison', 'distinctions']),
    'usage shapes come back in stable USAGE_SHAPES order', JSON.stringify(sum.usage));
  const labels = sum.badges.map((b) => b.label);
  ok(labels.includes('使い方') && labels.includes('類語対比表') && labels.includes('使い分け'),
    'badges carry the publisher\'s OWN titles, verbatim', JSON.stringify(labels));
  ok(sum.badges.find((b) => b.label === '使い方')?.shape === 'members',
    'the collision is untangled: 使い方-the-title is typed as members-the-shape');

  const pruned = S.usageNodes(ruigo);
  ok(pruned.length === 3, 'usageNodes: three subtrees survive (使い方 section, 対比表, 使い分け section)', String(pruned.length));
  ok(!JSON.stringify(pruned).includes('低い所から'),
    'definitions do not ride along — the second question shows no first-question material');
  ok(pruned[0].shape === 'section' && pruned[0].children?.[0]?.shape === 'members',
    'a section survives BECAUSE something usage-shaped survives inside it');
}

{
  const defsOnly = [
    { shape: 'senses', children: [{ shape: 'prose', text: '意味。' }] },
    { shape: 'section', label: '補説', children: [{ shape: 'prose', text: '…' }] },
    { shape: 'pos-group', tags: ['名'], children: [{ shape: 'prose', text: '…' }] },
  ];
  ok(S.summarize(defsOnly).second === false, 'a definitions-only entry cannot answer the second question');
  ok(S.usageNodes(defsOnly).length === 0, 'and prunes to nothing — no empty frames rendered');
}

{
  const idx = S.buildShapeIndex([
    { dict: '使い方の分かる類語例解辞典', nodes: ruigo },
    { dict: '大辞泉', nodes: [{ shape: 'senses', children: [{ shape: 'prose', text: '…' }] }] },
  ]);
  ok(idx.length === 1 && idx[0].dict === '使い方の分かる類語例解辞典',
    'the index keeps only the books that answer — the specialist book IS the entry point');
  ok(S.hasSecondQuestion(idx) === true && S.hasSecondQuestion([]) === false,
    'hasSecondQuestion is the badge gate');
}

console.log(`\n${fail ? '✗' : '✓'} shape-index: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
