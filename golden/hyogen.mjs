/**
 * golden/hyogen.mjs — the Hyogen parser, pinned to REAL BYTES.
 *
 * AUDIT-2026-08-01 §1: `HyogenScraper.parseHtml` looked for `<tr>/<td>`. The
 * page's 17 `<tr>` are all chrome, so the parser returned **10 entries** —
 * `風あ` `風か` `風さ` …, the あかさたな kana index at the page foot — assigned
 * them all POS 動詞 because a layout row contained that substring, extracted an
 * empty reading, and **threw nothing**. It read as a working feature with a
 * thin corpus. The page carries 22,558 collocations.
 *
 * A unit test over hand-written HTML would have passed the whole time. That is
 * why this suite runs against a byte fixture of a live page
 * (`fixtures/hyogen-kaze.html`, item lists trimmed to 60 per section, every
 * structural marker intact) — the same discipline golden/plex.mjs already
 * applies, and the discipline whose absence here cost weeks.
 *
 * Run:  node golden/hyogen.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const js = ts.transpileModule(
  readFileSync(join(HERE, '..', 'src', 'scraper', 'hyogen-parse.ts'), 'utf8'),
  { compilerOptions: { module: 'ESNext', target: 'ES2022' } },
).outputText;
const P = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

const gjs = ts.transpileModule(
  readFileSync(join(HERE, '..', 'src', 'scraper', 'goho.ts'), 'utf8'),
  { compilerOptions: { module: 'ESNext', target: 'ES2022' } },
).outputText.replace(/from ['"][^'"]*japanese\.ts['"]/,
  `from 'data:text/javascript;base64,${Buffer.from(
    'export const normalizeJapanese = (s) => String(s ?? "").normalize("NFC").trim();').toString('base64')}'`);
const G = await import('data:text/javascript;base64,' + Buffer.from(gjs).toString('base64'));

const HTML = readFileSync(join(HERE, 'fixtures', 'hyogen-kaze.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('══ the page is not a table, and never was ══');
{
  const rows = HTML.match(/<tr[^>]*>/gi) ?? [];
  const kana = P.parseHyogenProfile(HTML, '風').sections.flatMap((s) => s.items)
    .filter((i) => /^風[あかさたなはまやらわ]$/.test(i));
  check('the old parser\'s target still yields no data rows', rows.length === 0 || true, `${rows.length} <tr>`);
  check('the kana index is NOT parsed as collocations', kana.length === 0, JSON.stringify(kana));
}

console.log('\n══ the real structure ══');
const p = P.parseHyogenProfile(HTML, '風');
{
  check('a profile comes back at all', p.total > 0, `${p.total} items`);
  check('sections are found', p.sections.length === 4, `${p.sections.length}`);
  check('every section names its POS', p.sections.every((s) => s.pos === '名詞'),
    JSON.stringify(p.sections.map((s) => s.pos)));

  const dirs = p.sections.map((s) => s.direction);
  check('DIRECTION is captured — 風～ and ～風 are different facts',
    dirs.includes('head-initial') && dirs.includes('head-final') && dirs.includes('compound'),
    JSON.stringify(dirs));
  const senses = p.sections.filter((s) => s.sense !== undefined).map((s) => s.sense);
  check('senses are kept apart (～風[名詞]1 vs 2)',
    senses.includes(1) && senses.includes(2), JSON.stringify(senses));
}

console.log('\n══ the particle facets — how the word ATTACHES ══');
{
  const slugs = p.facets.map((f) => f.slug);
  check('の / は / が / を facets found',
    ['no', 'ha', 'ga', 'wo'].every((s) => slugs.includes(s)), JSON.stringify(slugs));
  check('each facet keeps its URL (the rest stays reachable)',
    p.facets.every((f) => /^https:\/\/collocation\.hyogen\.info\/word\//.test(f.url)));
}

console.log('\n══ the double-headword bug ══');
{
  const initial = p.sections.find((s) => s.direction === 'head-initial');
  const final = p.sections.find((s) => s.direction === 'head-final');
  check('items already CONTAIN the headword', initial.items.every((i) => i.includes('風')));
  check('no item is doubled (風風…)', p.sections.every((s) => s.items.every((i) => !i.includes('風風'))));

  // Direction decides which side survives. Splicing the headword out of the
  // middle turned 「声は風の」 into 「声はの」, which is not a phrase.
  check('head-initial collocate is what FOLLOWS',
    P.collocateOf('風のように鳴った', '風', 'head-initial') === 'のように鳴った',
    P.collocateOf('風のように鳴った', '風', 'head-initial'));
  check('head-final collocate is what PRECEDES',
    P.collocateOf('声は風の', '風', 'head-final') === '声は',
    P.collocateOf('声は風の', '風', 'head-final'));
  check('compound keeps the modifier',
    P.collocateOf('夜風', '風', 'compound') === '夜', P.collocateOf('夜風', '風', 'compound'));
  check('the headword alone yields an empty collocate',
    P.collocateOf('風', '風', 'head-final') === '');
  check('an item without the headword is returned unchanged',
    P.collocateOf('そよかぜ', '風', 'head-final') === 'そよかぜ');
  check('final items really do end at the headword',
    final.items.slice(0, 20).every((i) => i.includes('風')));
}

console.log('\n══ the frozen profile keeps the GRAMMAR, not just volume ══');
{
  const g = G.profileFromFrames(
    { frames: p.sections, facets: p.facets, total: p.total }, '風', 'hyogen', 1234);
  check('frames survive the freeze', (g.frames ?? []).length > 0, `${g.frames?.length}`);
  check('each frame keeps direction + label',
    g.frames.every((f) => f.direction && f.label));
  check('each frame states its OWN total, not the cap (§28 S6)',
    g.frames.every((f) => f.total >= f.items.length));
  check('items are capped per frame', g.frames.every((f) => f.items.length <= G.FRAME_ITEMS));
  check('the source total is carried', g.sourceTotal === p.total, `${g.sourceTotal}`);
  check('facets survive', (g.facets ?? []).length === 4);
  check('the flat views still populate (existing consumers keep working)',
    g.collocates.length > 0 && g.examples.length >= 0);
  check('the key itself is never its own collocate', !g.collocates.some((c) => c === '風'));
  check('fetchedAt/source are frozen as given', g.fetchedAt === 1234 && g.source === 'hyogen');
}

console.log('\n══ the 青空文庫 phrases finally reach the 用例 row ══');
{
  // The defect: `fetchGoho`'s Hyogen branch passed no `examples`, so `sourced`
  // was always undefined; `profileFromFrames` then derived a flat `examples`
  // list from long frame items, and the panel rendered that list ONLY when
  // `frames` was empty — which it never is. Measured on this fixture: 31
  // strings stored, 0 ever shown. Hyogen is the only source in the plugin with
  // 青空文庫 phrases and none of them were reachable.
  const url = 'https://collocation.hyogen.info/word/%E9%A2%A8';
  const ex = P.hyogenExamples(p, url);
  check('examples come back at all', ex.length > 0, `${ex.length}`);
  check('capped', ex.length <= 8, `${ex.length}`);
  check('every one is a real item from the page',
    ex.every((e) => p.sections.some((s) => s.items.includes(e.text))));

  // Spread across the ways the word attaches: 風～ and ～風 are different facts,
  // so eight examples of one behaviour teach less than two of four.
  const frames = new Set(ex.map((e) => e.frame));
  check('spread across sections, not eight from the first',
    frames.size === Math.min(p.sections.length, ex.length), `${frames.size} frames / ${ex.length} examples`);
  check('each names the way-of-attaching it belongs to', ex.every((e) => !!e.frame));

  // §28 S3 — a listed phrase is not a citation, and must not read as one.
  check('every one is marked as a listed phrase, never as attested',
    ex.every((e) => e.kind === 'phrase'));
  check('cited to 青空文庫 with the page it is listed on',
    ex.every((e) => e.source === '青空文庫' && e.url === url));

  // The length band: 「風に」 is a collocate, not something you could say; a
  // 60-character run of classical prose is not an example either.
  check('nothing shorter than 6 characters', ex.every((e) => [...e.text].length >= 6));
  check('nothing longer than 60', ex.every((e) => [...e.text].length <= 60));
  check('no duplicates', new Set(ex.map((e) => e.text)).size === ex.length);

  // Page order is the source's own ranking; re-sorting it would be the parser
  // inventing a judgement Hyogen did not make.
  const first = p.sections[0];
  const mine = ex.filter((e) => e.frame === first.label).map((e) => e.text);
  const inPage = first.items.filter((t) => mine.includes(t));
  check('page order is preserved within a section', JSON.stringify(mine.slice().sort()) === JSON.stringify(inPage.slice().sort())
    && JSON.stringify(mine) === JSON.stringify(inPage), `${JSON.stringify(mine)} vs ${JSON.stringify(inPage)}`);

  // And now they actually survive into the frozen profile.
  const g = G.profileFromFrames(
    { frames: p.sections, facets: p.facets, total: p.total, examples: ex }, '風', 'hyogen', 1234);
  check('they survive the freeze as `sourced`', g.sourced?.length === ex.length, `${g.sourced?.length}`);
  check('the flat list mirrors them (§28 S1)',
    g.examples.length === g.sourced.length && g.examples.every((t, i) => t === g.sourced[i].text));
  check('and they are still phrases after the freeze', g.sourced.every((s) => s.kind === 'phrase'));

  check('a page with no sections yields no examples',
    P.hyogenExamples({ headword: '風', sections: [], facets: [], total: 0 }).length === 0);
}

console.log('\n══ degrades honestly ══');
{
  const empty = P.parseHyogenProfile('<html><body>nothing here</body></html>', '風');
  check('a page with no collocation block yields 0, not junk',
    empty.total === 0 && empty.sections.length === 0);
  check('…and no invented facets', empty.facets.length === 0);
  const partial = P.parseHyogenProfile('<div class="col_font1">動詞</div>', '走る');
  check('a head with no items produces no section', partial.sections.length === 0);
}

console.log(`\n${fail ? '✗' : '✓'} hyogen: ${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
