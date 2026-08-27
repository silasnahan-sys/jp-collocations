/**
 * golden/x-slot.mjs — §29 rung 4: the construction boundary (fixture C).
 *
 * Measured 2026-08-25 on the live vault: the 言えば/言うと/言ったら family =
 * 113 occurrences, 27 of them と-preceded impostors (蒼き狼と言えば is a
 * TOPIC in a game's title, not a manner), plus かと言えば and そういえば.
 * True fillers type く/に/で/て AND the corpus-taught から and を (一言で×8,
 * 逆に×4, 結論から×4, 簡単に×3, 極論を…). The pins, from §29.3 verbatim:
 *
 *   - と/か/そう-preceded hits NEVER enter the manner table;
 *   - every row carries its morphological type;
 *   - ambiguous rows land in a 灰 group — never silently dropped, never
 *     asserted;
 *   - family-distribution counts present (recurrence across surfaces).
 *
 * Run:  node golden/x-slot.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const S = await import(pathToFileURL(join(HERE, '..', 'src', 'x', 'slot.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

// The offline oracle, standing in for DictionaryStore (the readings.fixture
// convention): the words fixture C's fillers deinflect to or simply are.
const WORDS = new Set(['悪い', '冷たい', '分かりやすい', '逆に', '一言', '結論', '簡単', '正直', '厳密', '極論', 'それ']);
const oracle = {
  isWord: (s) => WORDS.has(s),
  deinflect: (s) => {
    const out = [{ term: s, trail: [] }];
    if (s.endsWith('く')) out.push({ term: s.slice(0, -1) + 'い', trail: ['adv'] });
    return out;
  },
};

const T = (text) => ({ text });
const corpus = [
  // true fillers, across the family (fixture C's corpus-taught list)
  T('一言で言えば最高だった'), T('一言で言うと違う'),
  T('逆に言えばそれだけのこと'), T('逆に言うとありがたい'),
  T('結論から言えばダメだった'), T('結論から言ったら怒られた'),
  T('簡単に言うとこうなる'),
  T('正直に言ったら楽になった'),
  T('厳密に言えば違反です'),
  T('極論を言えば全部いらない'),
  T('かなり冷たく言えば自業自得'),
  T('分かりやすく言うとゲームです'),
  // impostors wearing the frame's clothes
  T('蒼き狼と言えばあのゲーム'), T('大阪と言えばたこ焼き'),
  T('どちらかと言えば嫌い'),
  T('そう言えば忘れてた'),
  // a chained clause: one appearance, one surface, no morphology → 灰
  T('昨日彼が言えばよかったのに'),
];

console.log('══ the cues: impostors never enter the manner table ══');
{
  const t = S.slotTable(corpus, '言えば', oracle);
  check('と-preceded hits are excluded (蒼き狼と言えば)',
    !t.rows.some((r) => r.filler.includes('蒼き狼') || r.filler.includes('大阪')));
  check('…and NAMED as impostors with their cue',
    t.impostors.some((i) => i.cue === 'と' && i.text.includes('蒼き狼')),
    JSON.stringify(t.impostors));
  check('かと言えば is its own cue, not a manner row',
    t.impostors.some((i) => i.cue === 'かと') && !t.rows.some((r) => r.filler.endsWith('どちらか')));
  check('そう言えば is lexicalized, excluded by cue',
    t.impostors.some((i) => i.cue === 'そう'));
  check('every family occurrence was examined (the denominator is honest)',
    t.occurrences === 17, `saw ${t.occurrences}`);
}

console.log('══ the typing: every row carries its morphological type ══');
{
  const t = S.slotTable(corpus, '言えば', oracle);
  const type = (f) => t.rows.find((r) => r.filler === f)?.type;
  check('一言で types で', type('一言で') === 'で');
  check('逆に types に', type('逆に') === 'に');
  check('結論から types から — the corpus-taught particle', type('結論から') === 'から');
  check('極論を types を — the other corpus-taught particle', type('極論を') === 'を');
  check('かなり冷たく types く THROUGH deinflection (冷たく→冷たい)',
    type('かなり冷たく') === 'く');
  check('正直に言ったら reaches the table through its family surface',
    t.rows.some((r) => r.filler === '正直に' && r.surfaces.includes('言ったら')));
}

console.log('══ the family: recurrence across surfaces is the third test ══');
{
  const t = S.slotTable(corpus, '言えば', oracle);
  const row = (f) => t.rows.find((r) => r.filler === f);
  check('一言で recurs across 言えば AND 言うと', row('一言で')?.recurring === true);
  check('厳密に appears before one surface only — present, not recurring',
    row('厳密に')?.recurring === false);
  check('the family is answered from any member', S.familyOf('言うと').includes('言ったら'));
  check('anchorIn finds the anchor inside a longer query',
    S.anchorIn('悪く言えば') === '言えば' && S.anchorIn('関係ない') === null);
}

console.log('══ the 灰 group: kept, juxtaposed, never dropped ══');
{
  const t = S.slotTable(corpus, '言えば', oracle);
  check('the chained clause lands in 灰, not in the manner table',
    t.gray.some((r) => r.filler.includes('彼が')) && !t.rows.some((r) => r.filler.includes('彼が')),
    JSON.stringify(t.gray));
  check('灰 rows still carry their counts (auditable, not asserted)',
    t.gray.every((r) => r.count >= 1 && r.type === '灰'));
}

console.log('══ the second anchor: 距 between two anchors is countable ══');
{
  const t = S.slotTable(
    [T('悪く言えばケチに近い'), T('一言で言えば天才'), T('それに近い')],
    '言えば', oracle, { secondAnchor: 'に近い' });
  check('co-occurrence with the second anchor is counted over family hits',
    t.coAnchor?.anchor === 'に近い' && t.coAnchor?.count === 1, JSON.stringify(t.coAnchor));
}

console.log(`\n${fail === 0 ? '✓' : '✗'} x-slot: ${pass}/${pass + fail} checks passed`);
if (fail) process.exitCode = 1;
