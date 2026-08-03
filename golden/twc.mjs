/**
 * golden/twc.mjs — NINJAL-LWP for TWC, against byte fixtures captured
 * 2026-08-02 from the live site.
 *
 * The defect this pins: `TsukubaWebCorpusScraper` fetched `/search/?q=風` and
 * scraped HTML for tables. That page holds no data — three jqGrid panels POST
 * for their own JSON — so the scraper's real behaviour was to report success
 * having found nothing, for every word, for as long as it has existed.
 *
 * The defect it pins HARDER: calling the JSON endpoints the obvious way returns
 * **HTTP 200 with well-formed JSON** containing the global first page of a
 * 43-million-row table — こと's collocates, for every word you ask about. No
 * error and no empty result: a parser written against that response looks like
 * it works. `twc-colloc-LEAK.json` is that exact response, kept as a fixture so
 * the guard can never be removed by accident.
 *
 * Run:  node golden/twc.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const T = await import(pathToFileURL(join(HERE, '..', 'src', 'scraper', 'twc-parse.ts')).href);
const G = await import(pathToFileURL(join(HERE, '..', 'src', 'scraper', 'goho.ts')).href);
const fx = (n) => JSON.parse(readFileSync(join(HERE, 'fixtures', n), 'utf8'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('══ the silent wrong word ══');
{
  // GET instead of POST, or POST without the CSRF token: 200, valid JSON, and
  // every row belongs to こと. Nothing downstream can tell without this check.
  const leak = fx('twc-colloc-LEAK.json');
  check('the failure really is invisible: 200-shaped JSON with rows',
    Array.isArray(leak.rows) && leak.rows.length > 0);
  const parsed = T.parseCollocates(leak, 'N.25644.J001');
  check('but parseCollocates drops every foreign-keyed row', parsed.rows.length === 0,
    JSON.stringify(parsed.rows.slice(0, 1)));
  check('…so 風 can never be given こと’s collocates',
    !parsed.rows.some((r) => r.text.includes('こと')));
  // And it must not masquerade as a complete empty pattern.
  check('a rejected request does not read as "complete"', parsed.complete === false,
    `complete=${parsed.complete}`);
  // Sanity: the same guard passes the row through when the key DOES match.
  const good = T.parseCollocates(fx('twc-colloc-kaze-J001.json'), 'N.25644.J001');
  check('the guard is not simply rejecting everything', good.rows.length > 0, `${good.rows.length}`);
}

console.log('\n══ headword resolution ══');
{
  const hws = T.parseHeadwords(fx('twc-headword-kaze.json'), '風');
  check('風 resolves', hws.length > 0);
  const n = hws.find((h) => h.id.startsWith('N.'));
  check('to the noun N.25644', n?.id === 'N.25644', n?.id);
  check('with reading + romaji', n?.yomi === 'カゼ' && n?.romaji === 'kaze', `${n?.yomi}/${n?.romaji}`);
  check('and a corpus frequency', n?.freq > 0, String(n?.freq));
  check('POS comes off the id prefix', n?.pos === '名詞', n?.pos);
  // `eq` is used deliberately: a `contains` lookup for 風 also returns 風景 and
  // 風呂, which are different words, not other senses of this one.
  check('an exact-surface filter excludes 風景/風呂',
    T.parseHeadwords(fx('twc-headword-kaze.json'), '風').every((h) => h.headword === '風'));

  // 風 is TWO words in this corpus: 形容動詞 フウ (80,779) and 名詞 カゼ (322).
  // Resolution ranks by the corpus's own frequency rather than by a guess about
  // which sense "must" be meant — and the caller gets both, so the one not
  // profiled is offered rather than silently chosen away.
  check('homographs are all returned, not collapsed', hws.length === 2, `${hws.length}`);
  check('ranked by corpus frequency', hws[0].freq >= hws[1].freq);
  check('and they are genuinely different words',
    hws[0].pos !== hws[1].pos && hws[0].yomi !== hws[1].yomi,
    hws.map((h) => `${h.yomi}/${h.pos}/${h.freq}`).join(' vs '));
  for (const [id, want] of [['N.1', '名詞'], ['V.1', '動詞'], ['AJ.1', '形容詞'],
                            ['AN.1', '形容動詞'], ['AV.1', '副詞'], ['ZZ.1', '']]) {
    check(`posOfId(${id}) = ${want || '(unknown → blank, not a guess)'}`, T.posOfId(id) === want, T.posOfId(id));
  }
}

console.log('\n══ how the word attaches ══');
{
  const pats = T.parsePatterns(fx('twc-patterns-kaze.json'));
  check('patterns parse', pats.length > 0, `${pats.length}`);
  check('ranked by corpus frequency', pats.every((p, i) => i === 0 || pats[i - 1].freq >= p.freq));
  const j = pats.find((p) => p.id === 'J001');
  check('J001 is 風＋助詞 with freq and share', j?.name === '風＋助詞' && j.freq === 284 && j.share === 88.2,
    JSON.stringify(j));
  // The envelope says `"total": 0, "records": 1` for every word. Both are junk.
  const env = fx('twc-patterns-kaze.json');
  check('the envelope metadata really is junk', env.total === 0 && env.records === 1);
  check('…and the parser counts rows instead of trusting it', pats.length === env.rows.length);
}

console.log('\n══ direction comes from the braces, not from a guess ══');
{
  check('{風}を → head-initial', T.directionOf('{風}を') === 'head-initial');
  check('子供の{風} → head-final', T.directionOf('子供の{風}') === 'head-final');
  check('〜の{風}が → circumfix', T.directionOf('子供の{風}が') === 'circumfix');
  // TWC's 近接動詞 rows ("走る ⇨ 動詞") carry NO braces — those words co-occur
  // with the headword rather than attaching to it. Defaulting them to
  // head-initial would render 「走る～する」 and assert a position the corpus
  // never claimed.
  check('a braceless co-occurrence row is `unmarked`, not head-initial',
    T.directionOf('する') === 'unmarked', T.directionOf('する'));
  const s = T.splitBraces('子供の{風}');
  check('splitBraces separates the head', s.before === '子供の' && s.head === '風' && s.after === '');
  const bare = T.splitBraces('風が');
  check('a row without braces degrades without throwing', bare.head === '' && bare.after === '風が');

  const ji = T.parseCollocates(fx('twc-colloc-kaze-J001.json'), 'N.25644.J001');
  check('J001 collocates are head-initial', ji.rows.every((r) => r.direction === 'head-initial'));
  check('and the braces are stripped for display', ji.rows[0].text === '風を', ji.rows[0].text);
  check('while the collocate alone is kept', ji.rows[0].collocate === 'を', ji.rows[0].collocate);
  check('surface stays verbatim', ji.rows[0].surface === '{風}を', ji.rows[0].surface);

  const hf = T.parseCollocates(fx('twc-colloc-kaze-H007.json'), 'N.25644.H007');
  check('H007 collocates are head-final', hf.rows.every((r) => r.direction === 'head-final'));
  check('子供の{風} → 子供の風 / 子供の', hf.rows[0].text === '子供の風' && hf.rows[0].collocate === '子供の',
    `${hf.rows[0].text} / ${hf.rows[0].collocate}`);
}

console.log('\n══ the numbers that justify consulting a corpus at all ══');
{
  const ji = T.parseCollocates(fx('twc-colloc-kaze-J001.json'), 'N.25644.J001');
  const wo = ji.rows.find((r) => r.text === '風を');
  check('freq / MI / logDice all survive', wo.freq === 145 && wo.mi === 4.11 && wo.logDice === -2.83,
    JSON.stringify(wo));
  // The point of MI: 「風を」 is the most FREQUENT collocate but not the most
  // selective one — a plain frequency list cannot say that, and this is the
  // whole reason the plugin consults TWC rather than counting its own notes.
  const hf = T.parseCollocates(fx('twc-colloc-kaze-H007.json'), 'N.25644.H007');
  const top = [...hf.rows].sort((a, b) => b.mi - a.mi)[0];
  check(`most frequent ≠ most selective (${wo.text} freq=${wo.freq} mi=${wo.mi} vs ${top.text} freq=${top.freq} mi=${top.mi})`,
    top.mi > wo.mi && top.freq < wo.freq);
  check('a zero metric is kept as 0, not dropped',
    ji.rows.every((r) => typeof r.mi === 'number' && Number.isFinite(r.mi)));
}

console.log('\n══ frames: what the profile actually freezes ══');
{
  const pats = T.parsePatterns(fx('twc-patterns-kaze.json'));
  const frames = [
    T.toFrame('名詞', pats.find((p) => p.id === 'J001'),
      T.parseCollocates(fx('twc-colloc-kaze-J001.json'), 'N.25644.J001')),
    T.toFrame('名詞', pats.find((p) => p.id === 'H007'),
      T.parseCollocates(fx('twc-colloc-kaze-H007.json'), 'N.25644.H007')),
  ];
  check('a frame carries the grammar verbatim as its label', frames[0].label === '風＋助詞');
  check('frame direction is decided by frequency weight, not row count',
    frames[0].direction === 'head-initial' && frames[1].direction === 'head-final');
  check('frame keeps the pattern freq and share', frames[0].freq === 284 && frames[0].share === 88.2);

  const prof = G.profileFromFrames({ frames, total: 322 }, '風', 'twc', 1234);
  check('profileFromFrames accepts them', prof.frames.length === 2);
  check('ranked by corpus frequency, not by list length',
    prof.frames[0].label === '風＋助詞' && prof.frames[0].items.length < prof.frames[1].items.length,
    `${prof.frames[0].items.length} vs ${prof.frames[1].items.length}`);
  check('MI/logDice survive the freeze', prof.frames[0].measured?.[0]?.logDice === -2.83);
  check('measured stays parallel to items',
    prof.frames.every((f) => f.measured.length === f.items.length &&
      f.measured.every((m, i) => m.text === f.items[i])));
  check('share survives', prof.frames[0].share === 88.2);
  check('the flat views stay populated for existing consumers', prof.collocates.length > 0);
  check('and the key itself is never listed as its own collocate',
    !prof.collocates.includes('風'));

  // §28 S6 — a truncated list must never read as a total.
  const many = { ...frames[1], items: Array.from({ length: 50 }, (_, i) => `x${i}`), total: 50 };
  const cut = G.profileFromFrames({ frames: [many] }, '風', 'twc', 0);
  check(`truncation stays honest: ${cut.frames[0].items.length} shown of ${cut.frames[0].total}`,
    cut.frames[0].items.length === G.FRAME_ITEMS && cut.frames[0].total === 50);

  // …and when even the TOTAL is a cap, it must not pass for a count. 走る's
  // 走る＋名詞 returns the requested 100 rows and has more; rendering that as
  // "100件" would be a number the corpus never said.
  const capped = G.profileFromFrames({ frames: [{ ...many, complete: false }] }, '風', 'twc', 0);
  check('an incomplete list marks its total as a floor', capped.frames[0].atLeast === true);
  check('…while a complete one does not', cut.frames[0].atLeast === undefined);
  check('and a whole pattern that fits is reported exactly',
    T.parseCollocates(fx('twc-colloc-kaze-J001.json'), 'N.25644.J001').complete === true);
}

console.log('\n══ attested sentences, and where they came from ══');
{
  const ex = T.parseExamples(fx('twc-example-no-ii.json'));
  check('examples parse', ex.rows.length > 0, `${ex.rows.length}`);
  const first = ex.rows[0];
  check('the sentence is verbatim', first.text === 'いいのいいの！', first.text);
  check('the document title is kept, parens stripped',
    first.source === 'オートレースイラストコラム：AUTORACE（オートレース）ビギナーズ', first.source);
  // §28 S2 — an example without a checkable source is indistinguishable from an
  // invented one. The corpus gives a URL for every sentence; keep it.
  check('the URL survives, trailing CR trimmed',
    first.url === 'http://www.autorace-sp.jp/column/index.html', JSON.stringify(first.url));
  check('the citation ref is kept', first.ref === '001-020.008.04819 S650', first.ref);
  check('records is the corpus total, not the page', ex.records === 161, String(ex.records));
  check('and 9 pages means this is not the whole list', ex.complete === false);

  // The corpus supplies the highlight, so the panel never guesses.
  check('the span is the corpus’s own highlight',
    first.text.slice(...first.span) === 'のいい', JSON.stringify(first.text.slice(...first.span)));
  check('highlight is resolved for the caller', first.highlight === 'のいい', first.highlight);
  check('every row has a span inside its own text',
    ex.rows.every((r) => r.span[1] <= r.text.length && r.span[1] >= r.span[0]));

  // THE trap: the collocation list is lemmatised, the sentences are surface.
  // 「子供の風」 is really attested as 「子どものかぜ」 — so verifying identity by
  // string equality would throw away correct data.
  const kaze = T.parseExamples(fx('twc-example-kaze.json'));
  check('lemma ≠ surface: 子供の風 is attested as 子どものかぜ',
    kaze.rows[0].highlight === '子どものかぜ', kaze.rows[0].highlight);
  check('…and that batch is NOT rejected', kaze.rows.length > 0 && !kaze.mismatch);
}

console.log('\n══ identity is checked on the count ══');
{
  // `records` equals the collocate's freq exactly — measured across three
  // orders of magnitude (風を 145, 子供の風 2, 走っている 16,760).
  check('子供の風: freq 2 = records 2', T.parseExamples(fx('twc-example-kaze.json'), 2).mismatch === false);
  check('のいい: freq 161 = records 161', T.parseExamples(fx('twc-example-no-ii.json'), 161).mismatch === false);
  const wrong = T.parseExamples(fx('twc-example-no-ii.json'), 145);
  check('a count that disagrees is refused, not filed', wrong.mismatch === true && wrong.rows.length === 0);
  check('no expectation given → nothing is refused', T.parseExamples(fx('twc-example-kaze.json')).mismatch === false);
  // The freq really is the one the collocation list reports for that row.
  const h = T.parseCollocates(fx('twc-colloc-kaze-H007.json'), 'N.25644.H007');
  check('and the freq used is the collocate’s own', h.rows[0].freq === 2, String(h.rows[0].freq));
}

console.log('\n══ provenance survives the freeze (§28 S2) ══');
{
  const pats = T.parsePatterns(fx('twc-patterns-kaze.json'));
  const frames = [T.toFrame('名詞', pats.find((p) => p.id === 'J001'),
    T.parseCollocates(fx('twc-colloc-kaze-J001.json'), 'N.25644.J001'))];
  const ex = T.parseExamples(fx('twc-example-no-ii.json')).rows;
  const prof = G.profileFromFrames({ frames, examples: ex }, '風', 'twc', 5);

  check('sourced examples are stored', prof.sourced?.length > 0, `${prof.sourced?.length}`);
  check('each keeps its document and URL',
    prof.sourced.every((s) => s.source && s.url));
  check('and its span', prof.sourced[0].span[0] === 2 && prof.sourced[0].span[1] === 5);
  // §28 S1 — existing consumers read `examples: string[]` and must keep working.
  check('the flat examples list mirrors them',
    prof.examples.length === prof.sourced.length &&
    prof.examples.every((t, i) => t === prof.sourced[i].text));
  check('capped at 8 like the flat list', G.profileFromFrames(
    { frames, examples: Array.from({ length: 30 }, (_, i) => ({ text: `文${i}`, source: 's', url: 'u' })) },
    '風', 'twc', 0).sourced.length === 8);
  check('duplicate sentences are deduped', G.profileFromFrames(
    { frames, examples: [{ text: 'おなじ文' }, { text: 'おなじ文' }] }, '風', 'twc', 0).sourced.length === 1);
  // Real sentences REPLACE the collocate-derived fallback rather than joining
  // it — a citable sentence and a bare phrase must not share a row (§28 S3).
  const noEx = G.profileFromFrames({ frames }, '風', 'twc', 0);
  check('without examples the old fallback still fills the list', noEx.sourced === undefined);
  check('with examples, the fallback is not mixed in',
    prof.examples.every((t) => ex.some((e) => e.text === t)));
}

console.log('\n══ examples land on the collocate they were FETCHED for ══');
{
  // The defect: `profileToEntries` keyed its example map on `ex.highlight` and
  // looked it up by the collocate's lemmatised `text`. Those never match, so
  // every entry a TWC fetch produced carried `exampleSentences: []` — a fetch
  // that ran, cost ~11 rate-limited round trips, and silently dropped every
  // sentence it paid for. Both halves are pinned here.
  const colloc = T.parseCollocates(fx('twc-colloc-kaze-H007.json'), 'N.25644.H007');
  const rows = T.parseExamples(fx('twc-example-kaze.json')).rows;

  // 1. Prove the string join CANNOT work, so nobody restores it.
  const texts = new Set(colloc.rows.map((r) => r.text));
  const highlights = [...new Set(rows.map((r) => r.highlight).filter(Boolean))];
  check(`string join is impossible: 0 of ${highlights.length} highlights equal any collocate text`,
    highlights.length > 0 && highlights.every((h) => !texts.has(h)),
    JSON.stringify(highlights));

  // 2. The id join, on the same data, lands every sentence.
  const target = colloc.rows[0];
  check('the collocate has an id to join on', !!target.id, target.id);
  const stamped = rows.map((r) => ({ ...r, collocationId: target.id, collocate: target.text }));
  const byId = T.groupExamplesByCollocation(stamped);
  check('every sentence lands on its collocate',
    byId.get(target.id)?.length === rows.length, `${byId.get(target.id)?.length} of ${rows.length}`);
  check('…and on no other', byId.size === 1, `${byId.size}`);
  check('an unstamped batch is dropped rather than filed under a guess',
    T.groupExamplesByCollocation(rows).size === 0);

  // 3. The id reaches the frame, which is where the entry adapter reads it.
  const pats = T.parsePatterns(fx('twc-patterns-kaze.json'));
  const frame = T.toFrame('名詞', pats.find((p) => p.id === 'H007'), colloc);
  check('measured rows carry their collocation id', frame.measured.every((m) => !!m.id));
  check('and it is the id the example map is keyed by', byId.has(frame.measured[0].id),
    `${frame.measured[0].id}`);
  const frozen = G.profileFromFrames({ frames: [frame] }, '風', 'twc', 0);
  check('the id survives the freeze', frozen.frames[0].measured?.[0]?.id === frame.measured[0].id);

  // 4. Provenance travels with the sentence (§28 S2).
  const cited = T.citationsByCollocation(stamped.map((s) => ({ ...s, source: '文書', url: 'http://x/y' })));
  check('a citation is recoverable per collocation', cited.get(target.id) === '文書 http://x/y',
    cited.get(target.id));
  check('the fixture sentences carry a real one of their own',
    !!T.citationsByCollocation(stamped).get(target.id),
    T.citationsByCollocation(stamped).get(target.id));
  check('and a sentence with neither document nor url contributes none',
    T.citationsByCollocation(stamped.map((s) => ({ ...s, source: '', url: '' }))).size === 0);
}

console.log('\n══ the two kinds of example evidence stay apart (§28 S3) ══');
{
  const pats = T.parsePatterns(fx('twc-patterns-kaze.json'));
  const frames = [T.toFrame('名詞', pats.find((p) => p.id === 'J001'),
    T.parseCollocates(fx('twc-colloc-kaze-J001.json'), 'N.25644.J001'))];

  const attested = G.profileFromFrames({
    frames, examples: [{ text: '風を切って走った。', source: '文書', url: 'http://x', kind: 'attested', frame: '風＋助詞', collocate: '風を' }],
  }, '風', 'twc', 0);
  check('an attested sentence keeps its kind', attested.sourced[0].kind === 'attested');
  check('and the pairing it attests', attested.sourced[0].collocate === '風を' && attested.sourced[0].frame === '風＋助詞');

  const listed = G.profileFromFrames({
    frames, examples: [{ text: '風のように鳴った', source: '青空文庫', kind: 'phrase', frame: '風 ～' }],
  }, '風', 'twc', 0);
  check('a listed phrase keeps its kind', listed.sourced[0].kind === 'phrase');

  // A profile frozen before `kind` existed still has to render as one or the
  // other — a url is the only evidence available that a document stood behind it.
  const legacy = G.profileFromFrames({
    frames, examples: [{ text: 'あ', url: 'http://x' }, { text: 'い' }],
  }, '風', 'twc', 0);
  check('legacy example with a url reads as attested', legacy.sourced[0].kind === 'attested');
  check('legacy example without one reads as a listed phrase', legacy.sourced[1].kind === 'phrase');
}

console.log('\n══ examples are never MANUFACTURED from collocates ══');
{
  // `profileFromFrames` used to also invent examples: every frame item between 6
  // and 120 characters was copied into `examples` and rendered in the 用例 row
  // with the 用例 affordance. 「走っている」 is a collocate that happens to be
  // long; presenting it as a sentence somebody wrote is a claim the source never
  // made. A source with no examples must now say so by having none (§28 S6).
  const long = '風のようにびゅうびゅう鳴っていた';
  const p = G.profileFromFrames({
    frames: [{ pos: '名詞', direction: 'head-initial', label: '風 ～', items: [long, '風が'] }],
  }, '風', 'hyogen', 0);
  check('a long collocate does not become an example', p.examples.length === 0, JSON.stringify(p.examples));
  check('…and no empty sourced array is invented either', p.sourced === undefined);
  check('but it is still a collocate', p.collocates.includes(long) || p.frames[0].items.includes(long));
}

console.log('\n══ Hyogen frames still work unchanged (§28 S1) ══');
{
  // The frame type grew three optional fields; a source that supplies none must
  // behave exactly as before.
  const p = G.profileFromFrames({
    frames: [
      { pos: '名詞', direction: 'head-initial', label: '～ 風', items: ['風が吹く', 'そよ風'] },
      { pos: '名詞', direction: 'head-final', label: '風 ～', items: ['強い風', '冷たい風', '春の風'] },
    ],
  }, '風', 'hyogen', 7);
  check('no freq → still ordered by how much each frame holds', p.frames[0].items.length === 3);
  check('and no empty measured/freq/share keys are invented',
    p.frames.every((f) => f.measured === undefined && f.freq === undefined && f.share === undefined));
  check('total still falls back to the item count', p.frames[0].total === 3);
}

console.log(`\n${fail ? '✗' : '✓'} twc: ${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
