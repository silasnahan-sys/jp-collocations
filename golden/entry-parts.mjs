/**
 * golden/entry-parts.mjs — the entry grammar, and the anti-drift pins.
 *
 * The design claim this file exists to keep true: **a dictionary's identity is
 * WHICH parts it has and WHAT IT CALLS them, never HOW they are drawn.** So:
 *
 *   • a profile may only recognize and label — it has no way to draw;
 *   • every part a profile can emit is in the closed PART_KINDS vocabulary;
 *   • exactly ONE module turns parts into pixels (ui/entry-grammar.ts), and no
 *     other file may re-inline the part styling;
 *   • the 6-class taxonomy hues stay RESERVED — the entry grammar uses shape
 *     and weight, so the two axes cannot collide.
 *
 * Fixtures are the user's REAL 英辞郎 export (term_bank_228, headword "wait")
 * and the real stored shard text, not invented markup.
 *
 *   node golden/entry-parts.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
const { transpileModule } = ts;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const tsc = (s) => transpileModule(s, { compilerOptions: { module: 'ESNext', target: 'ES2022' } }).outputText;
const url = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64');

const src = (p) => readFileSync(join(ROOT, 'src', p), 'utf8');
const framesUrl = url(tsc(src('dictionary/frames.ts')));
const eijiroUrl = url(tsc(src('dictionary/eijiro.ts'))
  .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`));
const partsUrl = url(tsc(src('dictionary/entry-parts.ts'))
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`));

const P = await import(partsUrl);
const E = await import(eijiroUrl);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};
const kinds = (parts) => parts.map((p) => p.kind);
const textOf = (parts, kind) => parts.filter((p) => p.kind === kind).map((p) => p.text);

// ── the closed vocabulary ───────────────────────────────────────────────────
console.log('══ a profile can recognize and label, but never draw ══');
{
  const DRAWY = /color|css|class|style|render|element|html|width|font/i;
  const all = [...P.PROFILES, P.GENERIC];
  let drawy = [];
  for (const prof of all) {
    for (const k of Object.keys(prof)) {
      if (['id', 'match'].includes(k)) continue;
      if (DRAWY.test(k)) drawy.push(`${prof.id}.${k}`);
      if (typeof prof[k] === 'function') drawy.push(`${prof.id}.${k}()`);
    }
  }
  check('no profile carries a drawing hook or callback', drawy.length === 0, drawy.join(', '));
  check('every profile has an id and a title matcher',
    all.every((p) => p.id && p.match instanceof RegExp));
  check('PART_KINDS is closed and non-empty', P.PART_KINDS.length >= 10);
}

// ── 英辞郎: the real entry, the real defects ────────────────────────────────
// Raw HTML below is verbatim from the user's export, term_bank_228.json.
const WAIT_LI_1 = '<span class="sense-pos">自動</span> 〔何かが起きるまで〕待つ、待機するI have learned to wait. 私は待つということを学んだ。';
const WAIT_LI_8 = '<span class="sense-pos">他動</span> <span class="label">話</span> <span class="register">話</span>〔食事などを〕遅らせる';

console.log('\n══ 英辞郎: the label/register duplicate no longer leaks into the gloss ══');
{
  const tuple = ['wait', '', '', '', 0, [`<ol class="senses"><li>${WAIT_LI_1}</li><li>${WAIT_LI_8}</li></ol>`], 1, ''];
  const e = E.adaptEijiroEntry(tuple);
  check('two senses parsed', e.senses.length === 2, String(e.senses.length));
  const s8 = e.senses[1];
  // This is the bug the user reported as "話 話遅らせる".
  check('the gloss no longer starts with the doubled label',
    s8.gloss === '遅らせる', JSON.stringify(s8.gloss));
  check('the register is kept ONCE, as a register', s8.register === '話', JSON.stringify(s8.register));
  check('the situation is its own field', s8.situation === '食事などを', JSON.stringify(s8.situation));
}

console.log('\n══ 英辞郎: gloss and example stop being one string ══');
{
  const parts = P.partsOfSense(
    { pos: '自動', situation: '何かが起きるまで', gloss: '待つ、待機するI have learned to wait. 私は待つということを学んだ。' },
    P.profileFor('英辞郎 v144'),
  );
  check('the gloss is the definition alone',
    textOf(parts, 'gloss')[0] === '待つ、待機する', JSON.stringify(textOf(parts, 'gloss')[0]));
  const ex = parts.find((p) => p.kind === 'example');
  check('the example became its own part', !!ex);
  check('  …with the English half split out', ex?.en === 'I have learned to wait.', ex?.en);
  check('  …and the Japanese half split out', ex?.ja === '私は待つということを学んだ。', ex?.ja);
  check('the 〔situation〕 is a context part, not prose',
    textOf(parts, 'context')[0] === '何かが起きるまで');
  check('parts come in the fixed semantic order',
    kinds(parts).join(',') === 'pos,context,gloss,example', kinds(parts).join(','));
}

console.log('\n══ the one inferred split is narrow (it must not fire on prose) ══');
{
  const g = (s) => P.splitGluedExample(s);
  check('fires on JA→English sentence', g('待つ、待機するI have learned to wait.').example === 'I have learned to wait.');
  check('does NOT fire on an embedded acronym', g('IT技術の進歩').example === undefined,
    JSON.stringify(g('IT技術の進歩')));
  check('does NOT fire without sentence punctuation', g('日本語のNHK放送').example === undefined,
    JSON.stringify(g('日本語のNHK放送')));
  check('does NOT fire on a pure-Japanese gloss', g('待つ、待機する').example === undefined);
  check('does NOT fire on a pure-English gloss', g('to wait patiently').example === undefined);
  check('leaves the gloss intact when it does not fire', g('待つ、待機する').gloss === '待つ、待機する');
}

console.log('\n══ the SAME bracket means different things in different books ══');
{
  // 〔for, till, until〕 in 新英和 is a complement FRAME; 〔何かが…〕 in 英辞郎 is a
  // production CONDITION. One global bracket rule would have to get one wrong —
  // which is exactly why the mapping is per-dictionary data.
  const eij = P.partsOfSense({ gloss: '〔順番などを〕待ち受ける' }, P.profileFor('英辞郎 v144'));
  const shin = P.partsOfSense({ gloss: '待つ 〔for, till, until〕' }, P.profileFor('新英和大辞典 第6版'));
  check('英辞郎 〔…〕 → context', kinds(eij).includes('context') && !kinds(eij).includes('frame'));
  check('新英和 〔…〕 → frame', kinds(shin).includes('frame') && !kinds(shin).includes('context'));
  check('and both keep the publisher’s own token verbatim',
    textOf(eij, 'context')[0] === '順番などを' && textOf(shin, 'frame')[0] === 'for, till, until');
}

console.log('\n══ registers and xrefs are literal, never guessed ══');
{
  const shin = P.partsOfSense({ gloss: '《諺》 待てば海路の日和あり' }, P.profileFor('新英和大辞典 第6版'));
  check('《…》 → register', textOf(shin, 'register')[0] === '諺', JSON.stringify(textOf(shin, 'register')));
  check('and is removed from the gloss', !textOf(shin, 'gloss')[0].includes('諺'));
  const x = P.partsOfSense({ gloss: '⇒ time n. 1' }, P.profileFor('新英和大辞典 第6版'));
  check('a leading ⇒ makes the sense a cross-reference', kinds(x).includes('xref'));
}

console.log('\n══ legacy shards: the doubled register is repaired on READ too ══');
{
  // The shard written before the parser fix literally stores "話 話遅らせる".
  // Keying on verbatim repetition is an artifact signature, not a reading.
  const p = P.profileFor('英辞郎 v144');
  const legacy = P.partsOfSense({ pos: '他動', situation: '食事などを', gloss: '話 話遅らせる' }, p);
  check('the doubled token becomes ONE register',
    textOf(legacy, 'register').join() === '話', JSON.stringify(textOf(legacy, 'register')));
  check('and the gloss is clean', textOf(legacy, 'gloss')[0] === '遅らせる',
    JSON.stringify(textOf(legacy, 'gloss')[0]));

  // It must not fire on ordinary repetition-looking prose.
  const notDup = P.partsOfSense({ gloss: '人 people' }, p);
  check('a non-repeat is left alone', textOf(notDup, 'register').length === 0,
    JSON.stringify(textOf(notDup, 'register')));
  const noReg = P.partsOfSense({ gloss: '待つ、待機する' }, p);
  check('a normal gloss gains no register', textOf(noReg, 'register').length === 0);
  check('a book without the artifact never repairs',
    P.partsOfSense({ gloss: '話 話遅らせる' }, P.profileFor('大辞泉 第二版'))
      .filter((x) => x.kind === 'register').length === 0);
}

console.log('\n══ a stored field always beats one recovered from text ══');
{
  // After a re-conversion the converter supplies these directly; the recovery
  // path must then be a no-op, so re-converting changes nothing on screen.
  const stored = P.partsOfSense(
    { gloss: '遅らせる', situation: '食事などを', register: '話', example: 'Can it wait? 後でもいい？' },
    P.profileFor('英辞郎 v144'),
  );
  check('register comes from the field', textOf(stored, 'register').join() === '話');
  check('example comes from the field', stored.find((p) => p.kind === 'example')?.ja === '後でもいい？');
  check('and is not double-counted', stored.filter((p) => p.kind === 'example').length === 1);
}

console.log('\n══ an unprofiled dictionary degrades to LESS structure, not wrong structure ══');
{
  const p = P.profileFor('何か知らない辞書');
  check('falls back to GENERIC', p.id === 'generic');
  const parts = P.partsOfSense({ gloss: 'ふつうの語義です' }, p);
  check('a plain gloss stays one gloss part', kinds(parts).join() === 'gloss');
  check('nothing is invented', textOf(parts, 'gloss')[0] === 'ふつうの語義です');
}

console.log('\n══ a FLATTENED entry degrades to prose — it is never mined for apparatus ══');
{
  // The real 新英和 shard stores the whole "wait" article as ONE 2,967-char
  // "sense". Every 《…》 inside belongs to some sense buried in it, so hoisting
  // them would attach 《諺》《米》《口語》 to the entry as a whole — a claim the
  // source never made. Wrong structure is worse than none.
  const long = '待つ '.repeat(200) + '《諺》 待てば海路の日和あり 《米》 《口語》';
  check('a 2,000-char lone sense is recognised as flattened', P.isFlattened([{ gloss: long }]));
  const blocks = P.partsOfEntry({ senses: [{ gloss: long }] }, '新英和大辞典 第6版');
  check('it renders as ONE block', blocks.length === 1);
  check('marked flat, so the view can say why', blocks[0].flat === true);
  check('and carries the gloss ONLY — no hoisted registers',
    kinds(blocks[0].parts).join() === 'gloss', kinds(blocks[0].parts).join());
  check('the text is not silently truncated', blocks[0].parts[0].text.includes('海路の日和'));

  // A real multi-sense entry must never be mistaken for a flattened one.
  check('a genuine sense list is not flat',
    !P.isFlattened([{ gloss: 'a' }, { gloss: 'b' }]));
  check('a normal short sense is not flat', !P.isFlattened([{ gloss: '待つ、待機する' }]));
  const eij = P.partsOfEntry({ senses: [{ pos: '自動', situation: '順番などを', gloss: '待ち受ける' }] }, '英辞郎 v144');
  check('and 英辞郎 keeps its apparatus', kinds(eij[0].parts).join() === 'pos,context,gloss');
  check('  …without a flat marker', eij[0].flat === undefined);
}

console.log('\n══ multi-sense entries are numbered; single-sense ones are not ══');
{
  const multi = P.partsOfEntry({ senses: [{ gloss: 'a' }, { gloss: 'b' }] }, '英辞郎 v144');
  check('two senses get numbers 1,2', multi.map((b) => b.n).join() === '1,2');
  const one = P.partsOfEntry({ senses: [{ gloss: 'a' }] }, '英辞郎 v144');
  check('a lone sense gets no ordinal', one[0].n === undefined);
  check('an entry with no senses is an empty article',
    P.partsOfEntry({ senses: [] }, '英辞郎 v144').length === 0);
}

console.log('\n══ a 国語辞典 prints its 用例 as a trailing 「…」 run ══');
{
  const p = P.profileFor('現代国語例解辞典　第五版');
  const text = (parts, kind) => parts.find((x) => x.kind === kind)?.text;

  // Real shard text. Definition, then the examples, then nothing.
  const one = P.partsOfSense(
    { gloss: 'その時代の多数が正統と認めているものとは異なった学説。⇔正統。「異端視される」「異端邪説」「異端者」' }, p);
  check('the 「…」 run leaves the definition', text(one, 'gloss') === 'その時代の多数が正統と認めているものとは異なった学説。⇔正統。');
  check('and becomes the sense\'s 用例',
    text(one, 'example') === '「異端視される」「異端邪説」「異端者」', text(one, 'example'));

  // The near-misses this must NOT fire on — both are real shard text, and both
  // are talking ABOUT the quotation rather than showing it.
  const note = P.partsOfSense({ gloss: '❺《多く「…に俟つ」の形で》…を頼りにしてまかせる。' }, p);
  check('a quotation followed by more text is not an example', !text(note, 'example'));
  const xref = P.partsOfSense({ gloss: '「三尺(さんじゃく)下がって師の影を踏まず」に同じ。' }, p);
  check('nor is one a cross-reference points at', !text(xref, 'example'));
  const bare = P.partsOfSense({ gloss: '「合格発表を待つ」' }, p);
  check('a gloss that is ONLY a quotation keeps it — emptying it leaves no sense',
    text(bare, 'gloss') === '「合格発表を待つ」' && !text(bare, 'example'));

  // A stored field always beats one recovered from text, so re-conversion is a
  // silent upgrade rather than a change of display.
  const stored = P.partsOfSense({ gloss: '来るのをのぞむ。「郵便物を━」', example: '「郵便物を━・春のおとずれを━」' }, p);
  check('the converter\'s own example wins over the recovery',
    text(stored, 'example') === '「郵便物を━・春のおとずれを━」');

  // Per-book, and measured before switching on: these books print quotations
  // mid-sentence far more often than they print trailing examples.
  for (const t of ['ネット用語辞典「ネット王子」', '擬音語・擬態語辞典', '英辞郎 v144', 'プログレッシブ英和中辞典［第5版］']) {
    check(`${t.slice(0, 12)} is NOT opted in`, !P.profileFor(t).quotedExample);
  }
  for (const t of ['現代国語例解辞典　第五版', '新選国語辞典　第十版', '新明解国語辞典　第八版']) {
    check(`${t.slice(0, 10)} is`, P.profileFor(t).quotedExample === true);
  }
}

// ── the pins that keep the two axes apart ──────────────────────────────────
console.log('\n══ ONE renderer, and the taxonomy keeps its hues ══');
{
  const grammar = src('ui/entry-grammar.ts');
  const RESERVED = ['#e0c341', '#4a90d9', '#5cb85c', '#03ffb1', '#f39c12', '#d9534f'];
  const usedReserved = RESERVED.filter((h) => grammar.toLowerCase().includes(h));
  check('the entry grammar uses NO taxonomy color', usedReserved.length === 0, usedReserved.join());
  check('the entry grammar hardcodes no hex at all',
    !/#[0-9a-f]{3,8}\b/i.test(grammar), (grammar.match(/#[0-9a-f]{3,8}\b/i) ?? [])[0]);

  const css = readFileSync(join(ROOT, 'styles.css'), 'utf8');
  const block = css.slice(css.indexOf('.jp-entry {'));
  const cssReserved = RESERVED.filter((h) => block.toLowerCase().includes(h));
  check('the entry-grammar CSS uses no taxonomy color', cssReserved.length === 0, cssReserved.join());

  // Only entry-grammar.ts may build a .jp-part element — that is what makes a
  // second, drifting renderer impossible rather than merely discouraged.
  const offenders = [];
  for (const f of ['ui/DictionaryView.ts', 'ui/LexiconPanel.ts', 'dictionary/entry-parts.ts']) {
    if (/jp-part--|createSpan\(\{[^}]*jp-part/.test(src(f))) offenders.push(f);
  }
  check('no other module constructs entry-part elements', offenders.length === 0, offenders.join());
  check('entry-parts.ts is pure (no DOM, no obsidian)',
    !/document|HTMLElement|from ['"]obsidian/.test(src('dictionary/entry-parts.ts')));

  // The ━ mark is a SPLIT responsibility, and it only works if both halves are
  // present: the converter stores 新明解's `━な━に` verbatim (pinned in
  // golden/generic-yomitan.mjs) and the renderer is the one that expands it. A
  // profile declaring `headwordMark` with no renderer to honour it would show
  // the reader a row of dashes, so the two are pinned to each other here.
  check('a book that declares headwordMark exists',
    P.PROFILES.some((p) => p.tree?.headwordMark));
  check('and the renderer expands it against the entry headword',
    /headword\?: string/.test(grammar) && /function withHeadwordMark/.test(grammar));
  check('every path that prints text goes through that expansion',
    (grammar.match(/withHeadwordMark\(/g) ?? []).length >= 2);
  check('the expansion has its own class, so it still reads as the book\'s abbreviation',
    grammar.includes('jp-part-headmark')
    && readFileSync(join(ROOT, 'styles.css'), 'utf8').includes('.jp-part-headmark'));
}

console.log(fail ? `\n✗ entry-parts: ${fail} failed (${pass} passed)` : `\n✓ entry-parts: all ${pass} pass`);
process.exit(fail ? 1 : 0);
