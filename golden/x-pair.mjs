/**
 * golden/x-pair.mjs — the pair construction + the form family (§29 past
 * `single`; the 2026-08-27 desk report's second charge).
 *
 * A two-term query is a CONSTRUCTION being asked about. Three countable
 * facts answer it, and each is pinned here:
 *
 *   - pairReading: what stands BETWEEN the terms (the gap concordance),
 *     grouped and counted, one vote per document, order recorded as a
 *     positional fact, far co-occurrence counted but never grouped;
 *   - formFamily: the sibling surface forms of a term's lemma that the
 *     corpus actually attests — never the conjugation table, never a form
 *     with zero hits, never a different lemma on the same stem;
 *   - the honesty edges: overlapping occurrences are not pairings, a
 *     one-char kana stem answers [], the query term never lists itself.
 *
 * Run:  node golden/x-pair.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const P = await import(pathToFileURL(join(HERE, '..', 'src', 'x', 'pair.ts')).href);
const F = await import(pathToFileURL(join(HERE, '..', 'src', 'x', 'family.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('══ pairReading: the gap concordance ══');
{
  const docs = [
    { id: '1', text: '今も障害が残っている', author: 'a1' },
    { id: '2', text: '障害が残っているのです', author: 'a2' },
    { id: '3', text: '障害は残っていると思う', author: 'a3' },
    { id: '4', text: '障害年金は手付かずのまま残っている', author: 'a4' },
    { id: '5', text: '残っている障害について', author: 'a5' },
    { id: '6', text: '障害の件です。まったく別の話。ずっとあとに残っている話。', author: 'a6' },
    { id: '7', text: '障害が残っている、そして障害が残っている', author: 'a1' },
  ];
  const r = P.pairReading(docs, '障害', '残っている');
  const ga = r.groups.find((g) => g.gap === 'が' && g.dir === 'ab');
  check('the modal gap が leads, counted once per doc', ga && ga.count === 3, JSON.stringify(r.groups));
  // docs 1, 2, 7 carry が — but 7 is a1 again, so distinct authors = 2.
  check('…with distinct authors counted', ga && ga.authors === 2, ga && String(ga.authors));
  check('は stands as its own group', r.groups.some((g) => g.gap === 'は' && g.count === 1));
  check('the long のまま gap is grouped, not dropped',
    r.groups.some((g) => g.gap.includes('のまま')));
  // ab = docs 1,2,3,4,6,7 (the far doc still has an order); ba = doc 5.
  check('the reverse order is its own fact', r.order.ba === 1 && r.order.ab === 6,
    JSON.stringify(r.order));
  check('a distant co-mention counts as far, never as a group',
    r.far === 1 && !r.groups.some((g) => g.gap.includes('件です')));
  check('every group carries an attested sample', r.groups.every((g) => g.sample.length > 0));
}

console.log('══ pairReading: the honesty edges ══');
{
  const r = P.pairReading([{ id: '1', text: '残ってる話' }], '残って', '残ってる');
  check('an occurrence inside the other term is NOT a pairing',
    r.order.ab + r.order.ba === 0, JSON.stringify(r));
  const same = P.pairReading([{ id: '1', text: 'ああああ' }], 'あ', 'あ');
  check('identical terms answer nothing rather than pairing with themselves',
    same.groups.length === 0 && same.order.ab + same.order.ba === 0);
  const adj = P.pairReading([{ id: '1', text: '言語障害が残る' }], '言語', '障害');
  check('adjacency is the empty gap, stated as a group',
    adj.groups.length === 1 && adj.groups[0].gap === '');
}

console.log('══ formFamily: attested forms of one lemma ══');
{
  const WORDS = new Set(['残る', '障る', 'する']);
  const oracle = {
    isWord: (s) => WORDS.has(s),
    deinflect: (s) => {
      const out = [];
      // toy analyser: strip common tails back to 残る
      for (const [tail, base] of [['って', 'る'], ['ってる', 'る'], ['らない', 'る'], ['った', 'る'], ['り', 'る'], ['ったまま', 'る']]) {
        if (s.endsWith(tail)) out.push({ term: s.slice(0, -tail.length) + base, trail: [tail] });
      }
      return out;
    },
  };
  const texts = [
    '障害が残って心配', '後遺症が残ってるらしい', '障害が残らないか心配',
    '記憶に残った', '残ったままの宿題', '心に残り続ける', '障害の話',
  ];
  const fam = F.formFamily(texts, '残って', oracle);
  const names = fam.map((f) => f.form);
  check('the lemma is named through the shared oracle', F.lemmaOf('残って', oracle) === '残る');
  check('sibling forms are found with counts', names.includes('残らない') && names.includes('残ってる'),
    JSON.stringify(fam));
  check('the LONGEST resolving surface wins (残ったまま over 残った at that site)',
    names.includes('残ったまま'));
  check('the query term never lists itself', !names.includes('残って'));
  check('a different lemma on the same stem char never enters (障害 ≠ 残る family)',
    names.every((n) => !n.includes('障')));
  check('every offered form has real hits', fam.every((f) => f.count >= 1));
}

console.log('══ formFamily: refusals ══');
{
  const oracle = { isWord: (s) => s === 'する', deinflect: (s) => (s === 'して' ? [{ term: 'する', trail: ['て'] }] : []) };
  check('a one-char kana stem answers [] rather than matching half the language',
    F.formFamily(['している', 'します', 'した'], 'して', oracle).length === 0);
  const none = { isWord: () => false, deinflect: () => [] };
  check('an unnameable lemma answers []', F.formFamily(['残って'], '残って', none).length === 0);
}

console.log(`\n${fail ? '✗' : '✓'} x-pair: ${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
