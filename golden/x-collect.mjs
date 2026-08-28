/**
 * golden/x-collect.mjs — 集句: successive selections become one question.
 *
 * The pins are the assembly grammar (it must produce ONLY strings the
 * search box could have been handed by typing — no invented notation) and
 * the set's own discipline (dedupe, caps, the term gate, armed state and
 * subscription behavior).
 *
 * Run:  node golden/x-collect.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const C = await import(pathToFileURL(join(HERE, '..', 'src', 'x', 'collect.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('══ collectQuery: the assembly speaks the box\'s own grammar ══');
{
  check('two terms AND = the space the box already parses',
    C.collectQuery(['今も', 'やや'], 'and') === '今も やや');
  check('two terms near = the 〜 notation (order + window)',
    C.collectQuery(['今も', 'やや'], 'near') === '今も〜やや');
  check('three terms in near mode degrade to AND, never invent a 3-way 〜',
    C.collectQuery(['a', 'b', 'c'], 'near') === 'a b c');
  check('one term is just itself', C.collectQuery(['招いた誤解'], 'near') === '招いた誤解');
  check('empty is empty', C.collectQuery([], 'and') === '');
  check('whitespace terms are dropped', C.collectQuery(['  ', 'やや'], 'and') === 'やや');
}

console.log('══ collectable: what may be a term ══');
{
  check('a word-sized span may', C.collectable('招いた誤解'));
  check('a single character may not', !C.collectable('誤'));
  check('a whole line may not (25+ chars is a sentence, not a term)',
    !C.collectable('今も言語にやや障害が残っているというのはつらいことです'));
  check('a multi-line selection may not', !C.collectable('今も\nやや'));
}

console.log('══ CollectSet: the shared question\'s discipline ══');
{
  const s = new C.CollectSet();
  let events = 0;
  const un = s.subscribe(() => events++);
  check('add accepts a term and notifies', s.add('今も') && events === 1);
  check('duplicates are refused silently', !s.add('今も') && events === 1);
  check('the gate is the same rule as collectable', !s.add('誤'));
  s.add('やや');
  check('the query assembles from the live set', s.query() === '今も やや');
  s.setMode('near');
  check('mode rides into the assembly', s.query() === '今も〜やや');
  s.remove('今も');
  check('remove narrows the question', s.query() === 'やや');
  s.setArmed(true);
  check('arming notifies subscribers', s.armed() && events >= 5);
  s.clear();
  check('clear empties AND disarms (the question is over)',
    s.list().length === 0 && !s.armed());
  un();
  const before = events;
  s.add('別条');
  check('unsubscribe really unsubscribes', events === before);
  const cap = new C.CollectSet();
  for (const t of ['一つ', '二つ', '三つ', '四つ', '五つ', '六つ']) cap.add(t);
  check('a seventh condition is refused (the question changed)',
    !cap.add('七つ') && cap.list().length === 6);
}

console.log(`\n${fail ? '✗' : '✓'} x-collect: ${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
