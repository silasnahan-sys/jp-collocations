/**
 * golden/generic-yomitan.mjs — every dictionary that is NOT 英辞郎 (§27.4).
 *
 * Run against entries lifted verbatim from the user's jitendex export. Two
 * things this pins, both of which the Eijiro-only path got wrong by
 * construction:
 *
 *   • FORMAT — jitendex is a structured-content NODE TREE, not HTML strings.
 *     The Eijiro adapter's regexes find nothing in it; this walks the tree.
 *   • DIRECTION — jitendex is JA→EN, the mirror of 英辞郎. The JAPANESE must
 *     stay on the `surface` side either way, or half the corpus indexes
 *     backwards and the frame space is polluted with English keys.
 *
 *   node golden/generic-yomitan.mjs
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
const partsUrl = url(tsc(readFileSync(join(SRCDIR, 'entry-parts.ts'), 'utf8'))
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`));
const genUrl = url(tsc(readFileSync(join(SRCDIR, 'generic-yomitan.ts'), 'utf8'))
  .replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`)
  .replace(/from ['"]\.\/entry-parts\.ts['"]/g, `from '${partsUrl}'`)
  .replace(/from ['"]\.\/eijiro\.ts['"]/g, `from '${eijiroUrl}'`));

const G = await import(genUrl);
const P = await import(partsUrl);
const { adaptEijiroEntry } = await import(eijiroUrl);

const FIX = JSON.parse(readFileSync(join(HERE, 'fixtures', 'jitendex.entries.json'), 'utf8'));
const byHw = (hw) => FIX.entries.find((e) => e[0] === hw);

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => {
  n++;
  if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg}`);
};

console.log('══ direction is read from index.json, never guessed ══');
ok(G.directionOf({ sourceLanguage: 'ja', targetLanguage: 'en' }) === 'ja->en', 'ja→en detected');
ok(G.directionOf({ sourceLanguage: 'en', targetLanguage: 'ja' }) === 'en->ja', 'en→ja detected');
ok(G.directionOf(null) === 'ja->en', 'absent metadata defaults to ja→en (the learner default)');
ok(FIX.index.sourceLanguage === 'ja', 'the real jitendex export IS ja→en', `(${FIX.index.sourceLanguage})`);

console.log('\n══ the registry sends each dictionary to the right adapter ══');
ok(G.isEijiro('英辞郎 v144'), '英辞郎 → bespoke adapter');
ok(G.isEijiro('Eijiro'), 'romanized too');
ok(!G.isEijiro(FIX.index.title), `${FIX.index.title} → generic adapter`);
ok(!G.isEijiro('大辞泉'), 'kokugo → generic');

console.log('\n══ the Eijiro adapter genuinely CANNOT read a node tree ══');
{
  // This is why the registry exists rather than one clever adapter.
  const e = adaptEijiroEntry(byHw('いかなる場合でも'));
  const gen = G.adaptGenericEntry(byHw('いかなる場合でも'), { direction: 'ja->en' });
  ok(e.senses.length === 0, 'Eijiro adapter finds NO senses in structured content', `(${e.senses.length})`);
  ok(gen.senses.length > 0, 'the generic adapter does', `(${gen.senses.length})`);
}

console.log('\n══ flattenContent walks the tree ══');
ok(G.flattenContent('plain') === 'plain', 'a string passes through');
ok(G.flattenContent({ tag: 'li', content: 'x' }) === 'x', 'a node yields its content');
ok(G.flattenContent([{ tag: 'li', content: 'a' }, { tag: 'li', content: 'b' }]).includes('a'), 'arrays flatten');
ok(G.flattenContent(null) === '', 'null is empty, not a crash');

console.log('\n══ real jitendex entries ══');
{
  const h = G.adaptGenericEntry(byHw('いかなる場合でも'), { direction: 'ja->en' });
  ok(h.expression === 'いかなる場合でも', 'expression kept');
  ok(h.reading === 'いかなるばあいでも', 'reading kept');
  ok(h.senses[0]?.gloss?.length > 0, 'a real gloss was extracted', `(${h.senses[0]?.gloss?.slice(0, 40)})`);
  const c = h.reachFor[0];
  ok(!!c, 'a phrase is a reach-for unit');
  // THE direction test
  ok(c.surface === 'いかなる場合でも', 'surface is the JAPANESE', `(${c.surface})`);
  ok(/[a-z]/i.test(c.intention), 'intention is the ENGLISH', `(${c.intention})`);
  ok(c.frameKey === 'いかなる場合でも', 'the frame key is the JAPANESE side', `(${c.frameKey})`);
}
{
  const h = G.adaptGenericEntry(byHw('馬酔木'), { direction: 'ja->en' });
  ok(h.senses.length > 0, '馬酔木 has senses', `(${h.senses.length})`);
  ok(h.reachFor.every((c) => c.classHint !== 'discourse' && c.classHint !== 'serifu'),
    'the generic adapter also never asserts 🔴 or 🟡');
}

console.log('\n══ reversing the direction moves the Japanese, not the meaning ══');
{
  const ja = G.adaptGenericEntry(byHw('Ｔシャツ'), { direction: 'ja->en' });
  const en = G.adaptGenericEntry(byHw('Ｔシャツ'), { direction: 'en->ja' });
  if (ja.reachFor.length && en.reachFor.length) {
    ok(ja.reachFor[0].surface !== en.reachFor[0].surface,
      'the surface side follows the declared direction');
    ok(ja.reachFor[0].surface === 'Ｔシャツ', 'ja→en puts the headword on surface');
  } else {
    ok(true, 'entry produced no candidates in one direction (acceptable)');
  }
}

console.log('\n══ a whole real bank adapts without throwing ══');
{
  const heads = G.adaptGenericBank(FIX.entries, { direction: 'ja->en' });
  ok(heads.length === FIX.entries.length, 'every entry adapted', `(${heads.length})`);
  ok(heads.every((h) => Array.isArray(h.senses) && Array.isArray(h.reachFor)), 'shapes are well-formed');
  const withSenses = heads.filter((h) => h.senses.length).length;
  ok(withSenses === heads.length, 'every real entry yielded at least one sense',
    `(${withSenses}/${heads.length})`);
}

// ── Pass 2: the sense walker ───────────────────────────────────────────────
// The old adapter asked for Yomitan `data.content:"glossary"` blocks and, when
// a book did not use them, flattened the WHOLE tree into one string. Every
// dictionary in the user's vault then reported 1.0 senses per entry and 新英和's
// `wait` was a single 2,967-character "definition". The tree shapes below are
// verbatim from the 11.9GB export.

console.log('\n══ marksOf reads all FOUR conventions the shelf actually uses ══');
{
  const m = (data) => G.marksOf({ tag: 'div', data });
  ok(m({ class: 'level2' }).includes('level2'), 'data.class — 新英和 .level2');
  ok(m({ content: 'sense' }).includes('sense'), 'data.content — Yomitan/Jitendex');
  ok(m({ p: '', meaning: '' }).includes('meaning'), 'data KEYS — プログレッシブ');
  ok(m({ name: '大語義' }).includes('大語義'), 'data VALUES — 大辞林');
  ok(G.marksOf('a string').length === 0, 'a bare string has no marks');
  ok(G.marksOf({ tag: 'div' }).length === 0, 'a node without data has no marks');
}

console.log('\n══ senses split by the book’s own vocabulary ══');
{
  // 新英和: .level2 IS the sense hierarchy.
  const shin = {
    tag: 'div',
    content: [
      { tag: 'div', data: { class: 'level2' }, content: '1 待つ, 待ち受ける' },
      { tag: 'div', data: { class: 'level2' }, content: '2 給仕をする' },
    ],
  };
  const nodes = G.splitSenseNodes(shin, P.profileFor('新英和大辞典 第6版').tree);
  ok(nodes.length === 2, '新英和 splits at .level2', `(${nodes.length})`);

  // プログレッシブ names parts in the data KEYS.
  const prog = {
    tag: 'div',
    content: [
      { tag: 'span', data: { p: '', meaning: '' }, content: '（…を）待つ' },
      { tag: 'span', data: { p: '', meaning: '' }, content: '給仕する' },
    ],
  };
  ok(G.splitSenseNodes(prog, P.profileFor('プログレッシブ英和中辞典［第5版］').tree).length === 2,
    'プログレッシブ splits at the `meaning` key');

  // 大辞林 names them in a data VALUE.
  const dj = {
    tag: 'div',
    content: [
      { tag: 'div', data: { name: '大語義' }, content: 'まちうける' },
      { tag: 'div', data: { name: '大語義' }, content: 'きたいする' },
    ],
  };
  ok(G.splitSenseNodes(dj, P.profileFor('大辞林　第四版').tree).length === 2,
    '大辞林 splits at data.name=大語義');
}

console.log('\n══ the fallbacks, in order, and never an invented division ══');
{
  ok(G.splitSenseNodes({ tag: 'div', content: [
    { tag: 'div', data: { content: 'sense' }, content: 'a' },
    { tag: 'div', data: { content: 'sense' }, content: 'b' },
  ] }).length === 2, 'Yomitan roles work with no profile at all');
  ok(G.splitSenseNodes({ tag: 'ol', content: [
    { tag: 'li', content: 'a' }, { tag: 'li', content: 'b' }, { tag: 'li', content: 'c' },
  ] }).length === 3, 'list items are senses');
  ok(G.splitSenseNodes([{ tag: 'div', content: 'a' }, { tag: 'div', content: 'b' }]).length === 2,
    'top-level blocks are better than one blob');
  ok(G.splitSenseNodes({ tag: 'span', content: 'just one thing' }).length === 1,
    'a genuinely single sense stays single — no division is invented');
  ok(G.splitSenseNodes(null).length === 1, 'null degrades to one node, not a crash');
}

console.log('\n══ roles are lifted OUT of the gloss, and `skip` is dropped ══');
{
  const tree = { roles: { pos: 'pos', ex: 'example', junk: 'skip' } };
  const node = { tag: 'div', content: [
    { tag: 'span', data: { class: 'pos' }, content: '[動]' },
    '（…を）待つ',
    { tag: 'span', data: { class: 'junk' }, content: 'ルビの重複' },
    { tag: 'span', data: { class: 'ex' }, content: 'Wait here. ここで待って' },
  ] };
  const { rest, got } = G.harvestRoles(node, tree);
  ok(got.pos?.[0] === '[動]', 'pos harvested', JSON.stringify(got.pos));
  ok(got.example?.[0] === 'Wait here. ここで待って', 'example harvested');
  ok(rest === '（…を）待つ', 'the gloss keeps ONLY the definition', JSON.stringify(rest));
  ok(!rest.includes('ルビ'), 'a `skip` role is dropped entirely');
}

console.log('\n══ 新英和 `wait` stops being one 2,967-character paragraph ══');
{
  const tuple = ['wait', 'wait', '', '', 0, [{
    type: 'structured-content',
    content: { tag: 'div', content: [
      { tag: 'div', data: { class: 'pos' }, content: 'vi.' },
      { tag: 'div', data: { class: 'level2' }, content: '1 待つ, 待ち受ける 〔for, till, until〕' },
      { tag: 'div', data: { class: 'level2' }, content: '2 《諺》 待てば海路の日和あり' },
      { tag: 'div', data: { class: 'level3' }, content: 'a 給仕をする' },
    ] },
  }], 7, ''];
  const h = G.adaptGenericEntry(tuple, { tree: P.profileFor('新英和大辞典 第6版').tree });
  ok(h.senses.length === 3, 'three senses, not one blob', `(${h.senses.length})`);
  ok(h.senses.every((s) => s.gloss.length < 60), 'and none is a paragraph');
  ok(!P.isFlattened(h.senses), 'the entry no longer reads as flattened');
  // and the read side then finds the apparatus inside each sense
  const parts = P.partsOfEntry(h, '新英和大辞典 第6版');
  ok(parts.length === 3 && parts[0].n === 1, 'it renders as a numbered sense list');
  const frames = parts[0].parts.filter((p) => p.kind === 'frame').map((p) => p.text);
  ok(frames[0] === 'for, till, until', '〔…〕 became a frame part', JSON.stringify(frames));
  const regs = parts[1].parts.filter((p) => p.kind === 'register').map((p) => p.text);
  ok(regs[0] === '諺', '《諺》 became a register part', JSON.stringify(regs));
}

console.log('\n══ a thesaurus sense is a synonym SET — never dropped for having no prose ══');
{
  // Oxford's 類語グループ often holds only a 類語一覧. Reading "no gloss" as "no
  // sense" made the adapter report 0.7 senses/entry — it was LOSING entries.
  const tuple = ['have', 'have', '', '', 0, [{
    type: 'structured-content',
    content: { tag: 'div', data: { class: '類語グループ' }, content: [
      { tag: 'div', data: { class: '類語一覧' }, content: 'eat ・ have ・ swallow ・ consume' },
    ] },
  }], 0, ''];
  const h = G.adaptGenericEntry(tuple, { tree: P.profileFor('オックスフォード英語類語辞典').tree });
  ok(h.senses.length === 1, 'the sense survives', `(${h.senses.length})`);
  ok(h.senses[0].gloss.includes('swallow'), 'carrying the synonym set as its content',
    JSON.stringify(h.senses[0].gloss));
}

console.log('\n══ a book that marks NOTHING is split by its own literal separator ══');
{
  // 明鏡 第二版 has no classes; its newlines really are the sense boundaries.
  const tuple = ['憔悴', 'しょうすい', '', '', 0, [{
    type: 'structured-content',
    content: '\n〘名〙やつれ衰えること。\n「━しきった顔」',
  }], 0, ''];
  const h = G.adaptGenericEntry(tuple, { tree: P.profileFor('明鏡国語辞典 第三版').tree });
  ok(h.senses.length === 2, 'newline-separated senses split', `(${h.senses.length})`);
  ok(h.senses[0].gloss.startsWith('〘名〙'), 'first keeps its POS bracket');

  // …but a textual split must never override a structural one.
  const structured = ['x', '', '', '', 0, [{
    type: 'structured-content',
    content: { tag: 'div', content: [
      { tag: 'div', data: { class: 'level1' }, content: 'あ\nい' },
      { tag: 'div', data: { class: 'level1' }, content: 'う' },
    ] },
  }], 0, ''];
  ok(G.adaptGenericEntry(structured, { tree: P.profileFor('明鏡国語辞典 第三版').tree }).senses.length === 2,
    'a structural split wins over the newline fallback');
}

console.log('\n══ a PLAIN-STRING glossary is split too (the WISDOM case) ══');
{
  // Sanseido WISDOM is CSV-derived: no tree at all, one 12,015-character string
  // per entry. The string branch used to push it as a single sense, so it stayed
  // a wall of text through a whole re-conversion while every structured book
  // improved. Its own newlines are the divisions.
  const text = 'ぜひ 【是非】 名詞\n〖よしあし〗right and wrong.\n▸ 我々はその方法の是非を論じた\n是非に及ばず';
  const h = G.adaptGenericEntry(['是非', 'ぜひ', '', '', 0, [text], 0, ''], {});
  ok(h.senses.length === 4, 'the plain string splits at its own newlines', `(${h.senses.length})`);
  ok(h.senses.every((s) => s.gloss.length < 60), 'no sense is a paragraph');
  ok(!h.senses.some((s) => s.gloss.includes('\n')), 'no newline survives inside a sense');

  // `{type:'text'}` is the same content in a thin wrapper — same treatment.
  const wrapped = G.adaptGenericEntry(
    ['是非', '', '', '', 0, [{ type: 'text', text }], 0, ''], {});
  ok(wrapped.senses.length === 4, 'a {type:text} glossary splits identically');

  // A single-line string must stay exactly one sense.
  ok(G.adaptGenericEntry(['x', '', '', '', 0, ['ひとつの語義'], 0, ''], {}).senses.length === 1,
    'a one-line string is still one sense');
}

console.log('\n══ the title alone selects the vocabulary (one table, one lookup) ══');
{
  const bank = [['wait', '', '', '', 0, [{
    type: 'structured-content',
    content: { tag: 'div', content: [
      { tag: 'div', data: { class: 'level2' }, content: '1 待つ' },
      { tag: 'div', data: { class: 'level2' }, content: '2 給仕する' },
    ] },
  }], 0, '']];
  ok(G.adaptGenericBank(bank, { dictionary: '新英和大辞典 第6版' })[0].senses.length === 2,
    'passing the TITLE is enough — no second copy of the vocabulary');
  ok(G.adaptGenericBank(bank, { dictionary: '知らない辞書' })[0].senses.length === 2,
    'an unprofiled book still splits via the structural fallbacks');
}

console.log('\n══ the whitespace squeeze must not eat the separator ══');
{
  // Verbatim shape from 擬音語・擬態語辞典【あーん】: each span ENDS in "\n", and
  // harvestRoles joins the collected strings with " ". The old
  // `.replace(/\s{2,}/g,' ')` turned every "。\n " into "。 ", so the newline
  // split on the next line had nothing to split — 412 chars, one sense.
  const spans = [
    { tag: 'span', content: '①子供などが声を張り上げて泣く声。\n' },
    { tag: 'span', content: '「子供のように『ああん』と泣きながら」\n' },
    { tag: 'span', content: '②口を大きく開ける様子。\n' },
  ];
  const { rest } = G.harvestRoles(spans, undefined);
  ok(rest.includes('\n'), 'newlines survive harvestRoles');
  ok(!/[^\S\n]{2,}/.test(rest), 'horizontal runs are still squeezed');
  const h = G.adaptGenericEntry(
    ['あーん', '', '', '', 0, [{ type: 'structured-content', content: spans }], 0, ''], {});
  // TWO senses, not three: the book numbers them ①②, and its own numbering
  // outranks its line breaks — so 「…」, which is sense ①'s example, stays with
  // sense ① instead of becoming a third sense of its own.
  ok(h.senses.length === 2, 'the entry splits at ① and ②, keeping the example with its sense');
  ok(h.senses[0].gloss.includes('ああん'), 'and sense ① keeps its example line');

  // With no numbering, the line breaks are all the source gives — so they rule.
  const plain = [
    { tag: 'span', content: 'ひとつめの語義。\n' },
    { tag: 'span', content: 'ふたつめの語義。\n' },
  ];
  ok(G.adaptGenericEntry(
    ['x', '', '', '', 0, [{ type: 'structured-content', content: plain }], 0, ''], {},
  ).senses.length === 2, 'unnumbered text still splits at its newlines');
}

console.log('\n══ a book\'s own sense numbers are a separator (①②③ / ❶❷❸) ══');
{
  // 大辞林, 三省堂国語, 明鏡, 新選国語, 旺文社漢字典 number senses this way and
  // carry NO newline at all — the newline default could never reach them.
  const text = '①光が強い。「まぶしい光」②心がひかれる。③度合いが大きい。';
  ok(G.splitCircled(text).length === 3, '①②③ splits into three');
  ok(G.splitCircled('❶名詞。❷動詞。').length === 2, '❶❷ splits too');

  // Text BEFORE ① is the headword's own apparatus and must not be lost.
  const withLead = G.splitCircled('〘名〙①はじめ。②おわり。');
  ok(withLead.length === 3 && withLead[0] === '〘名〙', 'the lead-in survives as its own part');

  // The bar: a run that never starts, or never continues, is NOT a division.
  ok(G.splitCircled('③だけが引用の中にある').length === 1, 'a stray ③ does not open a sense');
  ok(G.splitCircled('①ひとつだけ').length === 1, 'a lone ① is not a division');
  ok(G.splitSenseText('区切りのない一文').length === 1, 'text with no division stays one chunk');

  const h = G.adaptGenericEntry(
    ['まぶしい', '', '', '', 0, [{ type: 'structured-content', content: { tag: 'span', content: text } }], 0, ''], {});
  ok(h.senses.length === 3, 'and the walker uses it when the tree divided nothing');

  // Numbering and line breaks are not rivals. WISDOM ships 12,015-char CSV rows
  // that happen to contain a ①; taking the numbering ALONE left one
  // 11,013-char sense where the newline split had been giving 78.
  const big = '①' + 'あ'.repeat(700) + '\n' + 'い'.repeat(700) + '②' + 'う'.repeat(50);
  const parts = G.splitSenseText(big);
  ok(parts.length === 3, 'an oversized numbered sense is refined by its own newlines');
  ok(parts.every((p) => p.length < 800), 'and no wall of text survives the refinement');
  // A numbered sense that is NOT oversized keeps its example attached.
  ok(G.splitSenseText('①みじかい。\n「れい」\n②ふたつめ。').length === 2,
    'a short numbered sense is not re-split by its example line');

  // エースクラウン uses TWO runs in one entry: ❶❷❸ for senses, ①②③ for the 成句.
  // Splitting on ① alone left the whole ❶❷❸ run inside one oversized lead.
  const twoRuns = '❶' + 'あ'.repeat(300) + '❷' + 'い'.repeat(300)
    + '①' + 'う'.repeat(30) + '②' + 'え'.repeat(30);
  const both = G.splitSenseText(twoRuns);
  ok(both.length === 4, 'the second numbering run splits the oversized lead');
  ok(both.every((p) => p.length < 600), 'and nothing oversized survives');
}

console.log('\n══ an apparatus-only lead-in is a part of speech, not a sense ══');
{
  ok(G.isApparatusOnly('［他五］') && G.isApparatusOnly('名') && G.isApparatusOnly('（ ）')
    && G.isApparatusOnly('1'), '明鏡 ［他五］ / 新選 名 / 大辞林 （ ） / ライトハウス 1');
  ok(!G.isApparatusOnly('待てしばし') && !G.isApparatusOnly('to wait')
    && !G.isApparatusOnly('略して中期防。'), 'real content is never apparatus');
  // The regression that caught the first version: shortness is NOT the test.
  ok(!G.isApparatusOnly('1 待つ') && !G.isApparatusOnly('待つ'),
    'a short REAL sense is not apparatus (新英和 `1 待つ`)');

  const lifted = G.liftLeadPos([{ gloss: '［他五］' }, { gloss: '❶待つ' }, { gloss: '❷期待する' }]);
  ok(lifted.length === 2, 'the lead stops being a sense');
  ok(lifted.every((s) => s.pos === '他五'), 'and becomes the pos of the senses after it');

  // Never empties an entry out, and never overwrites a pos the source gave.
  ok(G.liftLeadPos([{ gloss: '［名］' }]).length === 1, 'a lone apparatus entry survives');
  ok(G.liftLeadPos([{ gloss: '名' }, { gloss: 'x', pos: '動' }])[0].pos === '動',
    'a sense that already has a pos keeps it');
}

console.log('\n══ 例文N件 is a count label; a <summary> is not always one ══');
{
  ok(G.isCountLabel('例文１件') && G.isCountLabel('用例12件'), 'bare counts are labels');
  ok(!G.isCountLabel('文型 & コロケーション') && !G.isCountLabel('Usage'),
    'section labels are NOT counts');
  ok(!G.isCountLabel('ああんと'), 'a headword variant is NOT a count');

  const details = { tag: 'details', content: [
    { tag: 'summary', content: '例文１件' },
    { tag: 'span', content: 'We walked along the shoreline.' },
  ] };
  ok(!G.harvestRoles(details, undefined).rest.includes('例文'),
    'the count label is dropped out of the gloss');
  ok(G.harvestRoles(details, undefined).rest.includes('shoreline'),
    'but the example it labels is kept');
  // 擬音語 uses <summary> for variant forms — dropping those would be destructive.
  const variants = { tag: 'details', content: [{ tag: 'summary', content: 'ああんと' }] };
  ok(G.harvestRoles(variants, undefined).rest.includes('ああんと'),
    'a non-count summary survives');
}

console.log('\n══ furigana is not text ══');
{
  // `<ruby>学<rt>がっ</rt></ruby>` was concatenated to `学がっ`, so 明鏡 stored
  // `人 ひと ・ 物 もの ・ 時 とき などが 来 く ることや` — the reading spliced into
  // the word it annotates, in every book that ships ruby.
  const ruby = [
    { tag: 'ruby', content: ['学', { tag: 'rt', content: 'がっ' }] },
    { tag: 'ruby', content: ['校', { tag: 'rt', content: 'こう' }] },
    'は',
  ];
  ok(G.flattenContent(ruby) === '学校は', 'the reading is dropped from the run of text');
  ok(G.flattenContent({ tag: 'rp', content: '(' }) === '', 'the ruby parenthesis fallback too');

  // The OTHER road out of the tree collects raw strings itself, so it needs the
  // same rule — 明鏡 ships `<ruby><rb>人</rb><rt>ひと</rt></ruby>` and every
  // kanji in the book was arriving with its reading spliced in after it.
  const meikyo = [
    { tag: 'ruby', data: { full: '', class: 'full' }, content: [
      { tag: 'span', data: { rb: '' }, content: '人' },
      { tag: 'rt', data: { rt: '' }, content: 'ひと' },
    ] },
    'が',
    { tag: 'ruby', data: { full: '', class: 'full' }, content: [
      { tag: 'span', data: { rb: '' }, content: '来' },
      { tag: 'rt', data: { rt: '' }, content: 'く' },
    ] },
    'る',
  ];
  // Japanese does not space its words, and every ruby is its own node — joining
  // the runs with " " put a space at every kanji that carried a reading.
  ok(G.harvestRoles(meikyo, undefined).rest === '人が来る',
    'harvestRoles drops the reading AND does not space the Japanese');
  ok(G.harvestRoles([{ tag: 'span', content: 'Homarus' }, { tag: 'span', content: 'americanus' }],
    undefined).rest === 'Homarus americanus', 'but Latin words keep their space');
}

console.log('\n══ a comparison is a RELATION, not prose ══');
{
  // 類語例解's 類語対比表, verbatim in shape: header = the publisher's FRAMES
  // with the slot already written in, each row a candidate, each cell a
  // judgement. Flattened, the whole table vanished — the most valuable thing
  // in the book.
  const table = { tag: 'table', content: { tag: 'tbody', content: [
    { tag: 'tr', content: [
      { tag: 'th', content: '' },
      { tag: 'th', content: '私には…むずかしい' },
      { tag: 'th', content: '…お待ちください' },
    ] },
    { tag: 'tr', content: [
      { tag: 'td', content: 'ちょいと' }, { tag: 'td', content: '○' }, { tag: 'td', content: '△' },
    ] },
    { tag: 'tr', content: [
      { tag: 'td', content: '少少' }, { tag: 'td', content: '○' }, { tag: 'td', content: '○' },
    ] },
  ] } };
  const c = G.readComparison(table);
  ok(c && c.cols.length === 2, 'the empty corner cell is not a frame');
  ok(c.cols[0] === '私には…むずかしい', "the source's slot notation is kept verbatim");
  ok(c.rows.length === 2 && c.rows[0].item === 'ちょいと', 'each row is a candidate surface');
  ok(c.rows[0].cells[1] === '△', 'and the judgement is the publisher\'s own token');

  // NOT every table is a comparison: Jitendex ships a one-row FORMS table
  // (∅/稍/漸) with empty cells. Reading that as a judgement matrix would
  // assert a comparison the book never made.
  const forms = { tag: 'table', content: { tag: 'tbody', content: [
    { tag: 'tr', content: [{ tag: 'th', content: '' }, { tag: 'th', content: '稍' }] },
    { tag: 'tr', content: [{ tag: 'td', content: 'やや' }, { tag: 'td', content: '' }] },
  ] } };
  ok(G.readComparison(forms) === null, 'a one-row table with empty cells is NOT a comparison');
}

console.log('\n══ Yomitan roles: a sense-group GROUPS senses ══');
{
  const tree = { tag: 'div', data: { content: 'sense-group' }, content: [
    { tag: 'span', data: { content: 'part-of-speech-info' }, content: 'interjection' },
    { tag: 'span', data: { content: 'dialect-info' }, content: 'Kansai' },
    { tag: 'ol', content: [
      { tag: 'li', data: { content: 'sense' }, content: [
        { tag: 'ul', data: { content: 'glossary' }, content: [
          { tag: 'li', content: 'oh no' }, { tag: 'li', content: 'yuck' },
        ] },
      ] },
      { tag: 'li', data: { content: 'sense' }, content: [
        { tag: 'ul', data: { content: 'glossary' }, content: [{ tag: 'li', content: 'hi' }] },
      ] },
    ] },
  ] };
  const [g] = G.buildNodes(tree, 0, 'や');
  ok(g.shape === 'pos-group', 'a sense-group is a POS grouping, not a sense');
  ok(JSON.stringify(g.tags) === JSON.stringify(['interjection', 'Kansai']),
    'its badges include dialect-info (the green Kansai tag)');
  ok(g.children.length === 2 && g.children.every((c) => c.shape === 'senses'),
    'Yomitan numbers senses with <ol> — those are senses, not 使い分け');
  ok(g.children[0].text === 'oh no | yuck', 'a glossary holds ALTERNATIVES for one sense');
}

console.log('\n══ 用例.jp is a corpus: citations are not senses ══');
{
  const long = (s) => s + 'これはコーパスから取られた実際の用例の文である。'.repeat(2);
  const ul = { tag: 'ul', content: [
    { tag: 'li', content: long('傷は死体からやや離れた場所にあり、') },
    { tag: 'li', content: long('妻面窓もやや大きい。') },
  ] };
  const [a] = G.buildNodes(ul, 0, 'やや', { corpus: true });
  ok(a.shape === 'attestations', 'a declared corpus yields attestations');
  ok(a.children.length === 2, 'each <li> is one citation');
  ok(a.children[0].hit === 'やや', 'and the occurrence is marked, so it shows keyword-in-context');
  ok(G.adaptGenericEntry(['やや', '', '', '', 0,
    [{ type: 'structured-content', content: ul }], 0, ''],
  { tree: { corpus: true } }).nodes?.[0].shape === 'attestations',
  'they land on ONE entry rather than dividing it into senses');


  // ATTESTED is a claim about PROVENANCE, and only the book can make it.
  // NEW斎藤 and ことわざ ship editor-written illustrations that look identical in
  // the tree; inferring attestation from shape promoted those to corpus
  // evidence, which misstates the one thing §20.3 orders examples by.
  const [u] = G.buildNodes(ul, 0, 'やや');
  ok(u.shape === 'examples', 'an UNDECLARED book degrades to examples, never to attested');

  // The source work is provenance, not part of the sentence.
  const cited = { tag: 'ul', content: [
    { tag: 'li', content: [{ tag: 'a', content: '『南回帰線(下)』' }, long('おれは彼らを保釈にしてやりながら、')] },
    { tag: 'li', content: [{ tag: 'a', content: '『鉄面皮』' }, long('事情を説明して保釈される頃には、')] },
  ] };
  const [c2] = G.buildNodes(cited, 0, '保釈', { corpus: true });
  ok(c2.shape === 'attestations', 'a linked SOURCE WORK does not make it a 語群');
  ok(c2.children[0].cite === '『南回帰線(下)』', 'the work is kept as the citation');
  ok(!c2.children[0].text.startsWith('『'), 'and is not glued to the front of the sentence');
}

console.log('\n══ a book organized by DERIVATION is not a book of senses ══');
{
  // Verbatim from the vault shard for WISDOM 包括, which stored NINE "senses":
  // a headword line, three derived forms, their glosses and a split example.
  const raw = [
    'ほうかつ 【包括】',
    '包括的(な) 形容詞',
    '【総合的な】｟やや書｠ comprehensive ; (all-)inclusive .',
    '▸ 中東の包括的平和',
    'comprehensive peace in the Middle East.',
    '包括的に 副詞',
    'comprehensively ; inclusively.',
    '包括する 動詞',
    '｟書｠ comprehend ; include.',
  ].join('\n');
  const tree = P.profileFor('Sanseido The WISDOM English-Japanese Dictionary.csv (en-ja)').tree;
  const h = G.adaptGenericEntry(['包括', 'ほうかつ', '', '', 0, [raw], 0, ''], { tree });
  const d = (h.nodes ?? []).find((x) => x.shape === 'derived');
  ok(d && d.children.length === 3, 'three derived forms, not nine senses');
  ok(d.children[0].label === '包括的(な)' && d.children[0].tags[0] === '形容詞',
    'each carries its own form and part of speech');
  const ex = d.children[0].children?.[0];
  ok(ex && ex.text === '中東の包括的平和' && ex.en === 'comprehensive peace in the Middle East.',
    'the two-line example is rejoined into a pair');
  ok(d.children[2].label === '包括する' && d.children[2].text.includes('comprehend'),
    'and the last form keeps its gloss');

  // Nothing is imposed on a book that is not organized this way.
  ok(!G.readDerived(['ひとつめ', 'ふたつめ'], {}), 'no derivedAt → no derived shape');
}

console.log('\n══ sub-senses: a/b/c are varieties of ONE sense ══');
{
  // 新英和's real shape, and the trap: `.level3` is a SIBLING of `.level2`, not
  // nested inside it — the hierarchy lives only in the class name, so a walker
  // that assumes containment finds nothing.
  const lvl = (cls, txt) => ({ tag: 'div', data: { meaning: '', [cls]: '', class: cls }, content: txt });
  const tree = { tag: 'div', content: [
    lvl('level2', 'ロブスター, ウミザリカニ'),
    lvl('level3', 'イセエビ (spiny lobster).'),
    lvl('level3', '淡水に生息するザリガニ類.'),
    lvl('level2', 'まぬけ.'),
  ] };
  const p = P.profileFor('新英和大辞典 第6版').tree;
  const t = G.buildSenseTree(tree, p, 'lobster');
  ok(t.length === 2, 'two top-level senses, not four');
  ok(t[0].children.length === 2, 'and the lettered ones hang under the first');
  ok(t[1].text.includes('まぬけ') && !t[1].children, 'a sense with no letters stays flat');

  // The flat list must KEEP every leaf — that is what search and the reach-for
  // index read, so the hierarchy is additive, never a replacement.
  const h = G.adaptGenericEntry(['lobster', '', '', '', 0,
    [{ type: 'structured-content', content: tree }], 0, ''], { tree: p });
  ok(h.senses.length === 4, 'senses[] still holds all four leaves');

  // A book that letters nothing must not gain a fake hierarchy.
  const flat = { tag: 'div', content: [lvl('level2', 'A'), lvl('level2', 'B')] };
  ok(G.buildSenseTree(flat, p, '').length === 0, 'no lettering → no tree stored');
  ok(G.buildSenseTree(tree, { senseAt: ['level2'] }, '').length === 0, 'no subSenseAt → nothing');
}

console.log('\n══ the book\'s own illustration ══');
{
  // 新英和 hangs the path on a SPAN and leaves the <img> tag empty.
  const span = { tag: 'span', data: { img: '', src: 'pics/L/lobster.jpg', alt: '【画像】' },
    content: { tag: 'img', data: {} } };
  const [img] = G.buildNodes(span, 0, 'lobster');
  ok(img.shape === 'image' && img.src === 'pics/L/lobster.jpg', 'the media path is kept verbatim');
  ok(img.text === '【画像】', 'and its alt text');
  // Not everything with a `src` is a picture.
  ok(G.buildNodes({ tag: 'span', data: { src: 'audio/x.mp3' } }, 0, '')[0]?.shape !== 'image',
    'an audio path is not an illustration');
}

console.log('\n══ a plain-text book whose only structure is typographic ══');
{
  // エースクラウン's Yomitan export is ONE string with every tag stripped. The
  // 文型[be+名詞] boxes of the Monokakido app are NOT in it — nothing here
  // invents them. What IS there: `━ 名` / `━ 動` sections, ❶❷❸ restarting
  // inside each, and `■` examples with the translation glued to the English.
  const raw = '［名］［動］　成句tie'
    + '━ 名（複ties）Ｃ❶タイ, ネクタイ■He is wearing a blue tie today.彼はブルーのネクタイをしています'
    + '❷つながり; きずな■family ties家族のきずな'
    + '━ 動（三単現ties）❶結ぶ, しばる■tie one\'s necktieネクタイを結ぶ❷関連させる■Politics are tied.政治は関連している';
  const tree = P.profileFor('エースクラウン英和辞典［第二版］').tree;
  const groups = G.readPosSections(raw, tree);
  ok(groups.length === 2, 'the ━ dividers split noun from verb');
  ok(groups[0].tags[0] === '名' && groups[1].tags[0] === '動', 'each carries its own part of speech');
  // Both sections number from ❶; without the divider the two runs collide.
  ok(groups[0].children.length === 3, '名 keeps its inflection lead plus ❶❷');
  ok(groups[1].children.some((s) => s.text.startsWith('❷')), '動 restarts at ❶ and reaches ❷');

  const ex = groups[0].children[1].children[0];
  ok(ex.en === 'He is wearing a blue tie today.' && ex.ja === '彼はブルーのネクタイをしています',
    'a glued example splits at the sentence end');

  // A PHRASE has no terminal punctuation — the script boundary is the seam.
  ok(G.splitGluedPair('family ties家族のきずな').en === 'family ties', 'phrase: English half');
  ok(G.splitGluedPair('family ties家族のきずな').ja === '家族のきずな', 'phrase: Japanese half');
  ok(G.splitGluedPair('彼はきょう来る').ja === '彼はきょう来る', 'a Japanese-only example stays whole');

  // One section is not a division — a book with no ━ gains nothing.
  ok(G.readPosSections('❶ひとつ❷ふたつ', tree).length === 0, 'no dividers → no pos-groups');
}

console.log('\n══ example halves ZIP into pairs, never concatenate ══');
{
  // プログレッシブ's real shape. `enexam` and `excf` were unmapped, so the
  // English sentence and the V＋for＋名 pattern both ran into the definition:
  // `…期待するThe farmers are waiting for rain.V＋for＋名 農家の人たちは…`.
  // NOTE the wrapper: `example` CONTAINS the two halves. Giving the container a
  // role consumes it and never descends, which deletes the sentences outright —
  // gloss clean, examples gone. An unmapped mark must stay transparent.
  const sense = { tag: 'div', data: { meaning: '' }, content: [
    { tag: 'span', content: '待ち受ける, 待ち望む' },
    { tag: 'span', data: { example: '' }, content: [
      { tag: 'span', data: { enexam: '' }, content: 'The farmers are waiting for rain.' },
      { tag: 'span', data: { jpexam: '' }, content: '農家の人たちは雨が降るのを待ち受けている' },
      { tag: 'span', data: { enexam: '' }, content: "I'm waiting to hear your opinion." },
      { tag: 'span', data: { jpexam: '' }, content: 'ご意見をお待ちしています' },
    ] },
  ] };
  const tree = P.profileFor('プログレッシブ英和中辞典［第5版］').tree;
  const h = G.adaptGenericEntry(['wait', '', '', '', 0,
    [{ type: 'structured-content', content: sense }], 0, ''], { tree });

  ok(!h.senses[0].gloss.includes('The farmers'), 'the English half is out of the definition');
  // NOTE: `excf` is NOT the pattern holder — harvesting the real block showed it
  // is a container wrapping the whole article, and mapping it to `frame` pulled
  // `dis·a·gree /dìsəɡríː/ [動] (自) 1 〈人が〉…` into one part. The pattern case is
  // pinned below, on the shape ライトハウス actually uses.

  const pairs = (h.nodes ?? []).filter((n) => n.shape === 'examples');
  ok(pairs.length === 2, 'two examples, not one run of text');
  ok(pairs[0].en === 'The farmers are waiting for rain.', 'nth English…');
  ok(pairs[0].text === '農家の人たちは雨が降るのを待ち受けている', '…pairs with the nth Japanese');
  ok(pairs[1].en === "I'm waiting to hear your opinion.", 'and the second pair holds');

  // Which half is which is the BOOK's naming, not ours: プログレッシブ puts the
  // ENGLISH sentence under `jpexam`. Whichever half actually contains
  // kana/kanji is the Japanese one, so the pair cannot come out reversed.
  const flipped = { tag: 'div', data: { meaning: '' }, content: [
    { tag: 'span', data: { jpexam: '' }, content: 'He disagreed with me.' },
    { tag: 'span', data: { enexam: '' }, content: '彼は私と意見が分かれた' },
  ] };
  const f = G.adaptGenericEntry(['disagree', '', '', '', 0,
    [{ type: 'structured-content', content: flipped }], 0, ''], { tree });
  const fp = (f.nodes ?? []).find((n) => n.shape === 'examples');
  ok(fp.text === '彼は私と意見が分かれた' && fp.en === 'He disagreed with me.',
    'the Japanese half is detected by SCRIPT, not by the label');

  // ライトハウス prints the pattern inside the example block, so it arrived glued
  // to the front of the translation. It is a FRAME, not part of the sentence.
  const withPat = { tag: 'div', data: { meaning: '' }, content: [
    { tag: 'span', data: { enexam: '' }, content: 'What the author says disagrees with the facts.' },
    { tag: 'span', data: { jpexam: '' }, content: 'V ＋ with ＋ 名 著者の述べていることは事実と一致しない.' },
  ] };
  const wp = (G.adaptGenericEntry(['disagree', '', '', '', 0,
    [{ type: 'structured-content', content: withPat }], 0, ''], { tree }).nodes ?? [])
    .find((n) => n.shape === 'examples');
  ok(wp.label === 'V＋with＋名', 'the pattern is lifted out as the example\'s frame');
  ok(wp.text === '著者の述べていることは事実と一致しない.', 'and the sentence is left clean');

  // The REAL shape, straight off the export: the pattern is a nested node and
  // the sentence its bare sibling, with no space of their own anywhere. The
  // whitespace the lift cuts on exists only because the example halves keep the
  // blanket separator that every other role gave up — join them the Japanese
  // way and `V＋with＋名著者の…` ships as the sentence.
  const nested = { tag: 'div', data: { meaning: '' }, content: [
    { tag: 'span', data: { enexam: '' }, content: 'What the author says disagrees with the facts.' },
    { tag: 'div', data: { jpexam: '' }, content: [
      { tag: 'span', data: { bunkei: '' }, content: [
        { tag: 'span', content: 'V' }, { tag: 'span', content: '＋' },
        { tag: 'span', content: 'with' }, { tag: 'span', content: '＋' },
        { tag: 'span', content: '名' },
      ] },
      { tag: 'span', content: '著者の述べていることは事実と一致しない.' },
    ] },
  ] };
  const nx = (G.adaptGenericEntry(['disagree', '', '', '', 0,
    [{ type: 'structured-content', content: nested }], 0, ''], { tree }).nodes ?? [])
    .find((n) => n.shape === 'examples');
  ok(nx?.label === 'V＋with＋名', 'a pattern in its OWN node is still lifted', nx?.label);
  ok(nx?.text === '著者の述べていることは事実と一致しない.',
    'and does not ride along on the front of the sentence', nx?.text);
}

console.log('\n══ a corpus defines nothing ══');
{
  const long = (s) => s + 'これはコーパスから取られた実際の用例の文である。';
  const ul = { tag: 'ul', content: [
    { tag: 'li', content: long('傷は死体からやや離れた場所にあり、') },
    { tag: 'li', content: long('妻面窓もやや大きい。') },
  ] };
  const h = G.adaptGenericEntry(['やや', '', '', '', 0,
    [{ type: 'structured-content', content: ul }], 0, ''], { tree: { corpus: true } });
  ok(h.senses.length === 0, '用例.jp gives ZERO senses — it has no definitions');
  ok(h.nodes[0].shape === 'attestations' && h.nodes[0].children.length === 2,
    'the citations are the entry, stored once');
}

console.log('\n══ a gaiji glyph is not an illustration ══');
{
  const gaiji = { tag: 'span', data: { img: '', src: 'gaiji/参考1.svg' }, content: {} };
  ok(G.buildNodes(gaiji, 0, '').length === 0, '明鏡 gaiji/参考1.svg is not presented as a plate');
  const plate = { tag: 'span', data: { img: '', src: 'pics/L/lobster.jpg' }, content: {} };
  ok(G.buildNodes(plate, 0, '')[0].shape === 'image', 'a real plate still is');
}

console.log('\n══ an example GROUP is consumed whole, punctuation and all ══');
{
  // 三省堂's real shape: the 「 ・ 」 belong to the GROUP, the sentences to the
  // spans inside it. Mapping only the spans consumed the sentences and left the
  // brackets in the definition — every sense ended in an empty 「・・・」.
  const tree = P.profileFor('三省堂国語辞典　第八版').tree;
  const sense = (n, ...ex) => ({ tag: 'div', data: { name: '語義' }, content: [
    { tag: 'span', data: { name: '語義番号' }, content: n },
    { tag: 'span', data: { name: '語釈' }, content: '来るのをのぞむ。' },
    { tag: 'div', data: { name: '用例G' }, content: ['「',
      ...ex.flatMap((e, i) => (i ? ['・'] : []).concat([
        { tag: 'span', data: { name: '用例' }, content: e }])), '」'] },
  ] });
  const content = { tag: 'div', data: { name: '解説部' }, content: {
    tag: 'div', data: { name: '大語義' }, content: [
      sense('①', '郵便物を━', '春のおとずれを━'), sense('②', '人を━心得'),
    ] } };
  const h = G.adaptGenericEntry(['待つ', 'まつ', '', '', 0,
    [{ type: 'structured-content', content }], 0, ''], { tree });

  ok(h.senses.length === 2, 'the entry is two senses', `(${h.senses.length})`);
  ok(!h.senses.some((s) => /「[・\s]*」/.test(s.gloss)),
    'no sense is left holding an empty 「・・」', JSON.stringify(h.senses.map((s) => s.gloss)));
  // The tree gives ONE node here (大語義 encloses both 語義), so the split falls
  // to the text — the path that used to drop every harvested example.
  ok(h.senses[0].example === '「郵便物を━・春のおとずれを━」',
    'the first sense keeps the 用例 the book printed under it', h.senses[0].example);
  ok(h.senses[1].example === '「人を━心得」', 'and the second keeps its own', h.senses[1].example);
  // Japanese does not space its words: the group is one run, not five.
  ok(!/\s/.test(h.senses[0].example), 'the group is respaced by the BOOK, not by us');

  // A count that does not line up 1:1 is an unknown correspondence, and filing
  // the nth under the nth would claim a pairing the editors never made.
  const lop = { tag: 'div', data: { name: '解説部' }, content: {
    tag: 'div', data: { name: '大語義' }, content: [
      sense('①', 'あ'), sense('②', 'い'), { tag: 'div', data: { name: '語義' },
        content: { tag: 'span', data: { name: '語義番号' }, content: '③' } },
    ] } };
  const h2 = G.adaptGenericEntry(['x', '', '', '', 0,
    [{ type: 'structured-content', content: lop }], 0, ''], { tree });
  ok(h2.senses.length === 3 && !h2.senses.some((s) => s.example),
    'a mismatched count attaches NOTHING rather than misfiling',
    JSON.stringify(h2.senses.map((s) => s.example)));
}

console.log('\n══ the examples a book hangs BESIDE its senses, not inside them ══');
{
  // 明鏡's real shape: each sense is a `.level1` div, and its examples are a
  // SIBLING <details><summary>例文５件</summary>. splitSenseNodes returns the
  // senses, so the block sat outside everything the harvest looked at and all
  // 108,388 headwords' worth of examples were dropped — 0%, measured.
  const tree = P.profileFor('明鏡国語辞典 第三版').tree;
  const sense = (n, text) => ({ tag: 'div', data: { class: 'level1' }, content: `${n}${text}` });
  const exBlock = (...lines) => ({ tag: 'details', content: [
    { tag: 'summary', content: `例文${lines.length}件` },
    ...lines.map((l) => ({ tag: 'span', content: l })),
  ] });
  const content = { tag: 'div', data: { class: 'body' }, content: [
    { tag: 'div', data: { class: 'level0' }, content: '［他五］' },
    sense('❶', '来ることを望みながら時を過ごす。'),
    exBlock('「駅前で友人を待つ」', '「故郷からの便りを待つ」'),
    sense('❷', '期限をのばす。'),
    exBlock('「返済はあと一日待ってくれ」'),
  ] };
  const h = G.adaptGenericEntry(['待つ', 'まつ', '', '', 0,
    [{ type: 'structured-content', content }], 0, ''], { tree });

  const s = h.senses.filter((x) => /^[❶❷]/.test(x.gloss));
  ok(s.length === 2, 'both senses survive', `(${h.senses.length})`);
  ok(s[0].example === '「駅前で友人を待つ」「故郷からの便りを待つ」',
    'the block after ❶ is ❶\'s examples', s[0].example);
  ok(s[1].example === '「返済はあと一日待ってくれ」',
    'and the block after ❷ is ❷\'s', s[1].example);
  ok(!s.some((x) => /例文\d+件/.test(x.gloss) || /例文\d+件/.test(x.example ?? '')),
    'the count label itself is never text');

  // Document order is the whole claim. A block with no sense before it has
  // nothing to belong to, so it is left alone rather than filed under sense 1.
  const orphan = { tag: 'div', content: [
    exBlock('「宙に浮いた例文」'),
    sense('❶', '来ることを望む。'),
  ] };
  const ho = G.adaptGenericEntry(['x', '', '', '', 0,
    [{ type: 'structured-content', content: orphan }], 0, ''], { tree });
  ok(!ho.senses.some((x) => (x.example ?? '').includes('宙に浮いた')),
    'a block before any sense is not filed under the first one',
    JSON.stringify(ho.senses.map((x) => x.example)));

  // <summary> is not always a count — the same export uses it for real content.
  const real = { tag: 'div', content: [
    sense('❶', '意味。'),
    { tag: 'details', content: [
      { tag: 'summary', content: '文型 & コロケーション' },
      { tag: 'span', content: '中身' },
    ] },
  ] };
  const hr = G.adaptGenericEntry(['y', '', '', '', 0,
    [{ type: 'structured-content', content: real }], 0, ''], { tree });
  ok(!hr.senses.some((x) => (x.example ?? '').includes('中身')),
    'a titled section is not an example block');
}

console.log('\n══ a boxed コラム is not a definition ══');
{
  // Unmapping L1T recovered every example and exposed what it had been eating
  // alongside them: ライトハウス's boxed panels, which were then free to compete
  // to be senses. `interesting` shipped a "sense" reading `!アク` and another
  // holding the whole synonym box run together.
  const tree = P.profileFor('ライトハウス英和辞典 第7版').tree;
  const cell = (word, gloss) => ({ tag: 'td', data: { class: 'column border' }, content: [
    { tag: 'span', data: { b: '' }, content: word },
    { tag: 'span', content: ' ' }, { tag: 'span', data: { NBracket: '' }, content: '（' },
    { tag: 'span', content: gloss }, { tag: 'span', data: { NBracket: '' }, content: '）' },
  ] });
  const content = [
    // the ⚠アクセント badge: two cells holding `!` and `アク`
    { tag: 'div', data: { MG: '' }, content: { tag: 'span', data: { Fbox2G: '' }, content: [
      { tag: 'span', data: { Fbox2C1: '' }, content: '!' },
      { tag: 'span', data: { Fbox2C2: '' }, content: 'アク' },
    ] } },
    { tag: 'div', data: { class: 'L1' }, content: '━━形 興味深い, おもしろい' },
    { tag: 'div', data: { ColumnG: '' }, content: { tag: 'table', content: [
      { tag: 'tr', content: [cell('interesting', '興味や関心をそそる'),
        { tag: 'td', data: { class: 'column border center' }, content: 'おもしろい' }] },
      { tag: 'tr', content: cell('amusing', '楽しませるような') },
      { tag: 'tr', content: cell('entertaining', '人を楽しませる') },
    ] } },
  ];
  const h = G.adaptGenericEntry(['interesting', '', '', '', 0,
    [{ type: 'structured-content', content }], 0, ''], { tree });

  ok(!h.senses.some((s) => s.gloss.includes('アク')),
    'the ⚠アクセント badge is not a sense', JSON.stringify(h.senses.map((s) => s.gloss)));
  ok(!h.senses.some((s) => s.gloss.includes('amusing')),
    'nor is the synonym box run together as one');
  ok(h.senses.length === 1, 'the definition is the only sense', `(${h.senses.length})`);

  // Skipped from `senses[]`, LIFTED into a relation — the 大辞泉 `C` pairing.
  const mem = (h.nodes ?? []).find((n) => n.shape === 'members');
  ok(!!mem, 'the box becomes a members relation');
  ok(mem?.items.length === 3, 'one member per row', JSON.stringify(mem?.items?.length));
  ok(mem?.items[0].text === 'interesting' && mem?.items[0].gloss === '興味や関心をそそる',
    'the bold word is the member, the （…） its nuance', JSON.stringify(mem?.items[0]));
  ok(mem?.label === 'おもしろい',
    'the cell with no bold word is the Japanese the box is ABOUT — its label', mem?.label);
}

console.log('\n══ a CONTAINER must stay transparent, or it eats what it holds ══');
{
  // The single most expensive mistake this shelf can make, twice found: give a
  // role to a mark that WRAPS a block and the harvest consumes the whole
  // subtree and never descends. ライトハウス's L1T looked like a part-of-speech
  // label and is really the block that label opens — 400 characters holding the
  // gloss and all five example pairs — so `interesting` shipped with 0 of its 5.
  const tree = P.profileFor('ライトハウス英和辞典 第7版').tree;
  const block = { tag: 'div', data: { class: 'L1' }, content: [
    { tag: 'span', data: { class: 'L1T' }, content: [
      '━━形 興味深い, おもしろい',
      { tag: 'span', data: { class: 'ExEnglish' }, content: 'an interesting idea' },
      { tag: 'span', data: { class: 'ExJapanese' }, content: 'おもしろい考え' },
    ] },
  ] };
  const got = G.harvestRoles(block, tree).got;
  ok((got['example-en'] ?? []).length === 1, 'an example inside L1T is still reached',
    JSON.stringify(got['example-en']));
  ok((got['example-ja'] ?? []).length === 1, 'and so is its Japanese half');
  ok(!tree.roles.L1T && !tree.roles.L4T, 'L1T/L4T carry no role — they are containers');
  ok(!tree.roles.example, 'and neither does the `example` wrapper, for the same reason');
}

console.log('\n══ a rank badge is not the book\'s illustration ══');
{
  // 三省堂 draws its frequency rank inside the headword block. That one badge
  // was enough to keep the whole 見出部 alive as a relation "section".
  const badge = { tag: 'span', data: { name: 'img', src: 'svg-logo/最重要語.svg' }, content: '＊＊' };
  ok(G.buildNodes(badge, 0, '').every((x) => x.shape !== 'image'),
    'svg-logo/最重要語.svg is furniture, not a plate');
  ok(G.buildNodes({ tag: 'span', data: { img: '', src: 'pics/L/lobster.jpg' } }, 0, '')[0].shape === 'image',
    'and the real plate is still a plate');
}

console.log('\n══ 新明解 is read by TYPOGRAPHY — the export has almost no classes ══');
{
  // Lifted from the user's own export of 爽快. One structural node holds BOTH
  // kanji-numbered senses, and the only `data` in the whole article is the
  // 子項目 that hangs 爽快味 off the foot of the entry.
  const tree = P.profileFor('新明解国語辞典　第八版').tree;
  const body = { tag: 'div', content: [
    { tag: 'span', content: ['━な', { tag: 'span' }, '━に'] },
    { tag: 'div', content: [
      { tag: 'span', content: '一' }, '【壮', { tag: 'span', content: '快' }, '】',
      { tag: 'div', content: '心身に与える刺激が強烈で、勇気が体内に満ちあふれてくる様子だ。' },
    ] },
    { tag: 'div', content: [
      { tag: 'span', content: '二' }, '【爽', { tag: 'span', content: '快' }, '】',
      { tag: 'div', content: 'こだわりなどがふっきれて、生新の気をおぼえる様子だ。' },
    ] },
  ] };
  const sub = { tag: 'div', data: { subentries: '子項目' }, content: [
    { tag: 'span', content: '子' },
    { tag: 'span', content: { tag: 'a', content: { tag: 'span', content: '爽快味' } } },
  ] };
  const h = G.adaptGenericEntry(['爽快', 'そうかい', '', '', 0,
    [{ type: 'structured-content', content: [body, sub] }], 0, ''], { tree });

  // splitNodeText: the tree gave ONE node for both senses, so the whole-entry
  // splitText fallback was never reached — 一/二 have to divide it from inside.
  ok(h.senses.length === 3, 'the 一/二 block becomes two senses, not one',
    `(${h.senses.length})`);
  ok(h.senses[1].gloss.startsWith('一【壮快】'), '一 opens the first');
  ok(h.senses[2].gloss.startsWith('二【爽快】'), '二 opens the second');
  // The split needs the book's own 【…】 head: a bare 一 would cut prose apart.
  ok(G.splitSenseText('一日中ずっと待った', tree.splitNodeText).length === 1,
    'a bare 一 in ordinary prose is not a sense boundary');

  // headwordMark: STORAGE stays verbatim (that is what the page says); the
  // renderer is the one that expands it — golden/entry-parts.mjs owns that half.
  ok(h.senses[0].gloss === '━な━に', 'the ━ inflection lead is stored exactly as printed');
  ok(/[━―—]/.test(tree.headwordMark.source), 'the profile declares what ━ stands for');

  // subEntryAt: the pointer is the LINK, and 子 is the book's label for it.
  const der = (h.nodes ?? []).find((x) => x.shape === 'derived');
  ok(!!der, '子項目 becomes a derived relation');
  ok(der.items.length === 1 && der.items[0].text === '爽快味',
    'and holds the linked word alone — not the 子 label', JSON.stringify(der?.items));
  ok(!h.senses.some((s) => s.gloss.includes('爽快味')),
    'so the sub-entry is no longer a fourth "sense" of 爽快');
  // No anchor to read means the pointer is not emitted at all, rather than
  // emitted wrong (§28 S6).
  ok(G.buildNodes({ tag: 'div', data: { subentries: '子項目' }, content: '子爽快味' }, 0, '')
    .every((x) => x.shape !== 'derived'), 'a pointer with no link is dropped, never guessed');
}

console.log('\n══ relations are stored only when prose could not hold them ══');
{
  ok(!G.hasRelation({ shape: 'prose', text: 'ただの文' }), 'prose alone earns no bytes');
  ok(G.hasRelation({ shape: 'section', children: [{ shape: 'comparison' }] }),
    'a section containing a relation does');
  ok(!G.hasRelation({ shape: 'examples', text: 'x' }), 'a bare example is already in senses[]');
  ok(G.hasRelation({ shape: 'examples', text: 'x', en: 'y' }), 'a real PAIR is not');
}

console.log('\n══ a 反対語 is prose the sense list never sees ══');
{
  // 類語例解 prints its antonym as ONE unlinked line inside a named div. The
  // prose rule read that as "already in senses[]" and dropped it — but the
  // sense path never receives it either, so 痛快's 愉快⇔不愉快・不快 was in
  // NEITHER list in the shipped shards. `relationAt` is the opt-in that says
  // this book's named section is a relation, not a restatement.
  const RAW = {
    tag: 'div',
    data: { name: '反対語' },
    content: [
      { tag: 'span', content: '反対語' },
      { tag: 'span', content: '▼愉快⇔不愉快・不快' },
    ],
  };
  const [node] = G.buildNodes(RAW, 0, '痛快');
  ok(node.shape === 'section' && node.label === '反対語', 'the named div is a section', JSON.stringify(node));
  ok(!G.hasRelation(node), 'and without the opt-in it is dropped, as 共通する意味 must be');
  ok(G.hasRelation(node, { relationAt: ['反対語'] }), 'the opt-in keeps it');
  ok(!G.hasRelation(node, { relationAt: ['関連語'] }), 'and keeps only the section it names');
  // Verbatim, not split: 愉快 sits LEFT of the ⇔ because it is the group's own
  // synonym. Reading the arrow into members would file it as an antonym of
  // 痛快 — wrong structure, which is worse than less of it (§28 S6).
  ok(node.children?.[0]?.text === '▼愉快⇔不愉快・不快',
    'the book\'s own line is kept as printed, ⇔ and all', JSON.stringify(node.children));
  // The book this is for must reach it, and the English thesaurus it used to
  // borrow from must not have changed hands.
  ok(P.profileFor('使い方の分かる 類語例解辞典').id === 'ruigo-reikai',
    '類語例解 has its own row, ahead of the 類語 catch-all');
  ok(P.profileFor('使い方の分かる 類語例解辞典').tree?.relationAt?.includes('反対語'),
    'and that row is what turns the opt-in on');
  ok(P.profileFor('オックスフォード英語類語辞典').id === 'oxford-thesaurus',
    'while Oxford keeps the row that was written for it');
  ok(!P.profileFor('オックスフォード英語類語辞典').tree?.relationAt,
    'and does not acquire a knob it never asked for');
}

console.log(`\n${fail ? '✗' : '✓'} generic-yomitan: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
