/**
 * golden/lexicon.mjs — the unified lexicon search + the clean context tree.
 *
 * Proves the monokakido index ranks the user's own catalog above the legacy
 * lexicon, autocomplete is prefix-true, and the context tree produces NO junk
 * (short/duplicate quotes dropped, grouped by real source, capped, constellation
 * from shared files not substring guesses).
 *
 * Run:  node golden/lexicon.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const US = await import(pathToFileURL(join(HERE, '..', 'src', 'lexicon', 'unified-search.ts')).href);
const CT = await import(pathToFileURL(join(HERE, '..', 'src', 'lexicon', 'context-tree.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const att = (source, file, sec, quote, anchored = true) => ({
  source, file, tStartSec: sec, quote, anchorId: anchored ? 'a' + sec : undefined, addedAt: 1,
});
const pat = (id, cls, key, atts, payload) => ({
  id, class: cls, classRatified: true, keyKind: 'surface', key, note: key,
  payload: payload ?? {}, attestations: atts ?? [], createdAt: 1, updatedAt: 1,
});

console.log('══ unified search: ranking ══');
{
  const patterns = [
    pat('p1', 'skeletal', 'んだったら〜なきゃ', [att('yt', 'T/A.md', 100, '転売するんだったら行き渡らなきゃ')], { parts: ['んだったら', 'なきゃ'] }),
    pat('p2', 'serifu', 'と言えるもの', [att('yt', 'T/B.md', 50, 'と言えるものですね'), att('yt', 'T/C.md', 20, 'と言えるものだ')]),
    pat('p3', 'phrase_schema', '材質が違う', [att('x', 'https://x.com/u/1', null, '材質が違えばね')]),
  ];
  const collocations = [
    // same surface as p3's key → tests stratum preference (not match-quality)
    { id: 'c1', headword: '材質が違う', headwordReading: 'ざいしつがちがう', collocate: '', fullPhrase: '材質が違う', pattern: 'N+が+V', exampleSentences: ['例'], tags: [], notes: '' },
  ];
  const r = US.unifiedSearch({ patterns, collocations, query: '材質が違う' });
  check('catalog pattern outranks legacy colloc at equal surface', r[0].kind === 'pattern' && r[0].id === 'p3', r.map((x) => x.kind + ':' + x.id).join(','));
  // same surface = the two worlds MERGE into the catalog row (no side-by-side)
  check('legacy collocation merged into the catalog row', r[0].merged === true && r[0].collocation?.id === 'c1' && !r.some((x) => x.kind === 'collocation' && x.id === 'c1'));
  // exact-match-first still holds across strata (dictionary semantics)
  const exactColloc = US.unifiedSearch({
    patterns: [pat('pz', 'serifu', '材質が違えばね', [att('yt', 'T/A.md', 1, '材質が違えばね全然')])],
    collocations: [{ id: 'cz', headword: '材質', fullPhrase: '材質', exampleSentences: [], tags: [] }],
    query: '材質',
  });
  check('exact legacy match beats catalog prefix match', exactColloc[0].id === 'cz');
  const exact = US.unifiedSearch({ patterns, collocations, query: 'と言えるもの' });
  check('exact key match wins', exact[0].id === 'p2' && exact[0].score >= 100);
  check('attestation count carried', exact[0].attestationCount === 2);
  check('sources badge collected', exact[0].sources.includes('yt'));
  const empty = US.unifiedSearch({ patterns, collocations, query: '' });
  check('empty query returns all (merged pair = one row), well-attested first', empty.length === 3 && empty[0].kind === 'pattern');
}

console.log('══ unified search: filters ══');
{
  const patterns = [
    pat('p1', 'skeletal', 'A', [att('yt', 'T/A.md', 1, 'AAAA')]),
    pat('p2', 'serifu', 'B', [att('x', 'https://x.com/1', null, 'BBBB')]),
  ];
  const byClass = US.unifiedSearch({ patterns, collocations: [], classes: ['skeletal'], query: '' });
  check('class filter keeps only that class', byClass.length === 1 && byClass[0].id === 'p1');
  const bySrc = US.unifiedSearch({ patterns, collocations: [], sources: ['x'], query: '' });
  check('source filter keeps only x-attested', bySrc.length === 1 && bySrc[0].id === 'p2');
  check('filtering excludes legacy lexicon', US.unifiedSearch({ patterns, collocations: [{ id: 'c', headword: 'A', fullPhrase: 'A', exampleSentences: [], tags: [] }], classes: ['skeletal'], query: 'A' }).every((e) => e.kind === 'pattern'));
}

console.log('══ autocomplete: prefix-true ══');
{
  const patterns = [
    pat('p1', 'serifu', '以前の私', [att('yt', 'T/A.md', 1, '以前の私であれば')]),
    pat('p2', 'serifu', '以心伝心', [att('yt', 'T/B.md', 1, '以心伝心だ')]),
    pat('p3', 'serifu', 'その以前', [att('yt', 'T/C.md', 1, 'その以前の話')]),
  ];
  const ac = US.autocomplete({ patterns, collocations: [], query: '以' });
  check('prefix matches surface-initial only', ac.every((e) => e.headword.startsWith('以')));
  check('substring-only (その以前) excluded from autocomplete', !ac.some((e) => e.id === 'p3'));
  check('empty query → no suggestions', US.autocomplete({ patterns, collocations: [], query: '' }).length === 0);
}

console.log('══ context tree: NO JUNK ══');
{
  const focus = pat('p1', 'skeletal', 'んだったら〜なきゃ', [
    att('yt', 'T/A.md', 100, '転売するんだったら行き渡らなきゃいけない'),
    att('yt', 'T/A.md', 60, '　'),                                   // junk: whitespace-only
    att('yt', 'T/A.md', 40, '。'),                                    // junk: punctuation-only
    att('yt', 'T/A.md', 100, '転売するんだったら行き渡らなきゃいけない'), // junk: exact duplicate
    att('yt', 'T/B.md', 20, '買うんだったら早くしなきゃ'),
    att('x', 'https://x.com/u/1', null, 'やるんだったらやらなきゃ意味ない'),
    { source: 'yt', file: 'T/A.md', tStartSec: 200, quote: 'あとで見つかった別の言い回し', anchorId: undefined, addedAt: 1 }, // swept (no anchor)
  ], { parts: ['んだったら', 'なきゃ'] });

  const tree = CT.buildContextTree(focus, [focus]);
  const allQuotes = tree.groups.flatMap((g) => g.leaves.map((l) => l.quote));
  check('whitespace/punctuation leaves dropped', !allQuotes.includes('　') && !allQuotes.includes('。'));
  check('duplicate quote deduped', allQuotes.filter((q) => q === '転売するんだったら行き渡らなきゃいけない').length === 1);
  check('grouped by source: 2 yt files + 1 x = 3 groups', tree.groups.length === 3);
  const ytA = tree.groups.find((g) => g.key === 'T/A.md');
  check('yt group label is the video basename', ytA.label.startsWith('▶ A'));
  check('anchored leaves sort before swept', ytA.leaves[ytA.leaves.length - 1].swept === true);
  check('clip eligibility flagged for yt+timestamp', ytA.leaves[0].clipEligible === true);
  const xg = tree.groups.find((g) => g.source === 'x');
  check('x leaf carries url, not clip', xg.leaves[0].url === 'https://x.com/u/1' && xg.leaves[0].clipEligible === false);
  check('totalLeaves counts survivors only', tree.totalLeaves === allQuotes.length);
}

console.log('══ context tree: cap + overflow ══');
{
  const many = [];
  for (let i = 0; i < 20; i++) many.push(att('yt', 'T/A.md', i, `別々の実際の引用その${i}番目`));
  const focus = pat('p1', 'serifu', 'X', many);
  const tree = CT.buildContextTree(focus);
  const g = tree.groups[0];
  check('per-group cap at 12', g.leaves.length === 12);
  check('overflow counted', g.overflow === 8);
}

console.log('══ constellation: shared-file co-occurrence ══');
{
  const focus = pat('p1', 'serifu', 'A', [att('yt', 'T/X.md', 1, 'AAAA'), att('yt', 'T/Y.md', 1, 'AAAA')]);
  const other1 = pat('p2', 'serifu', 'B', [att('yt', 'T/X.md', 2, 'BBBB'), att('yt', 'T/Y.md', 2, 'BBBB')]); // shares 2 files
  const other2 = pat('p3', 'serifu', 'C', [att('yt', 'T/X.md', 3, 'CCCC')]);                                 // shares 1
  const other3 = pat('p4', 'serifu', 'D', [att('yt', 'T/Z.md', 3, 'DDDD')]);                                 // shares 0
  const xonly = pat('p5', 'serifu', 'E', [att('x', 'https://x.com/1', null, 'EEEE')]);                        // url, not vault
  const tree = CT.buildContextTree(focus, [focus, other1, other2, other3, xonly]);
  const keys = tree.constellation.map((c) => c.key);
  check('co-occurring patterns found, ranked by shared files', keys[0] === 'B' && keys[1] === 'C');
  check('shared count correct', tree.constellation[0].sharedFiles === 2);
  check('non-sharing pattern excluded', !keys.includes('D'));
  check('focus itself excluded', !keys.includes('A'));
  check('url-only attestations do not seed constellation', !keys.includes('E'));
}

console.log('══ catalog ⇔ legacy merge ══');
{
  const coll = (id, headword, fullPhrase, extra = {}) => ({
    id, headword, fullPhrase, collocate: '', pattern: '', headwordPOS: '動詞',
    headwordReading: 'きになる', notes: '〜が気になる の形で使う', exampleSentences: ['試験の結果が気になる'],
    tags: [], ...extra,
  });
  const p = pat('p1', 'collocation', '気になる', [att('yt', 'T/A.md', 10, 'ずっと気になってた')]);
  const c = coll('c1', '気になる', '気になる');
  const other = coll('c2', '別の語', '別の語');
  const linked = US.linkLegacy([p], [c, other]);
  check('surface-equal pattern↔collocation linked', linked.get('p1')?.id === 'c1');
  const res = US.unifiedSearch({ patterns: [p], collocations: [c, other], query: '気になる' });
  const rows = res.filter((r) => r.headword === '気になる');
  check('merged pair renders as ONE row', rows.length === 1, JSON.stringify(rows.map((r) => r.id)));
  check('merged row is the catalog entry', rows[0]?.kind === 'pattern' && rows[0]?.merged === true);
  check('merged row inherits legacy reading+notes', rows[0]?.reading === 'きになる' && rows[0]?.gloss?.includes('気になる'));
  check('unlinked legacy still gets its own row', US.unifiedSearch({ patterns: [p], collocations: [c, other], query: '別の語' }).some((r) => r.id === 'c2'));
}

console.log('══ embedded just-enough example ══');
{
  const p = pat('p1', 'serifu', 'X', [
    { source: 'x', file: 'https://x.com/1', tStartSec: null, quote: 'ツイートの用例だよ', addedAt: 1 },
    att('yt', 'T/A.md', 5, 'アンカー済みの本物の用例'),
    { source: 'yt', file: 'T/B.md', tStartSec: 9, quote: '候補の引用は出ない', addedAt: 1, status: 'suggested' },
  ]);
  check('bestExample prefers anchored yt', US.bestExample(p) === 'アンカー済みの本物の用例');
  const only = pat('p2', 'serifu', 'Y', [{ source: 'yt', file: 'T/B.md', tStartSec: 9, quote: '候補だけ', addedAt: 1, status: 'suggested' }]);
  check('suggested-only pattern has NO example (never junk)', US.bestExample(only) === undefined);
  const row = US.unifiedSearch({ patterns: [p], collocations: [], query: '' }).find((r) => r.id === 'p1');
  check('row carries the example', row?.example === 'アンカー済みの本物の用例');
}

console.log('══ suggested candidates quarantined in tree ══');
{
  const p = pat('p1', 'serifu', 'X', [
    att('yt', 'T/A.md', 5, '確定の用例はツリーに入る'),
    { source: 'yt', file: 'T/B.md', tStartSec: 9, quote: '候補はツリーに入らない', addedAt: 1, status: 'suggested', matchKind: 'link', confidence: 0.6 },
  ]);
  const tree = CT.buildContextTree(p);
  check('confirmed leaf in tree', tree.totalLeaves === 1);
  check('candidate NOT in groups', !tree.groups.some((g) => g.leaves.some((l) => l.suggested)));
  check('candidate in its own bucket', tree.candidates.length === 1 && tree.candidates[0].suggested);
  const co = pat('p2', 'serifu', 'Z', [{ source: 'yt', file: 'T/B.md', tStartSec: 1, quote: 'ZZZZ', addedAt: 1 }]);
  const tree2 = CT.buildContextTree(p, [p, co]);
  check('suggested file does NOT seed constellation', !tree2.constellation.some((c) => c.key === 'Z'));
}

console.log('══ search modes (§20.1): 前方一致 / 含む / 用例全文 ══');
{
  const patterns = [
    pat('m1', 'collocation', '気になる', [
      { source: 'yt', file: 'T/A.md', tStartSec: 10, quote: 'その話がずっと気になってた', addedAt: 1 },
      { source: 'yt', file: 'T/B.md', tStartSec: 20, quote: '怪しい提案だと思う', addedAt: 1, status: 'suggested', matchKind: 'components' },
    ]),
    pat('m2', 'serifu', 'まさかの気配', []),
  ];
  const prefix = US.unifiedSearch({ patterns, collocations: [], query: '気に', mode: 'prefix' });
  check('prefix: 気に matches 気になる, not まさかの気配', prefix.length === 1 && prefix[0].id === 'm1');
  const contains = US.unifiedSearch({ patterns, collocations: [], query: '気配', mode: 'contains' });
  check('contains: 気配 finds mid-word', contains.length === 1 && contains[0].id === 'm2');
  const prefixMiss = US.unifiedSearch({ patterns, collocations: [], query: '気配', mode: 'prefix' });
  check('prefix mode rejects mid-word hits', prefixMiss.length === 0);
  const quotes = US.unifiedSearch({ patterns, collocations: [], query: 'ずっと', mode: 'quotes' });
  check('quotes: searches confirmed attestation text', quotes.length === 1 && quotes[0].id === 'm1');
  const quotesSuggested = US.unifiedSearch({ patterns, collocations: [], query: '怪しい提案', mode: 'quotes' });
  check('quotes: SUGGESTED candidates are not searchable', quotesSuggested.length === 0);
  const dflt = US.unifiedSearch({ patterns, collocations: [], query: '気配' });
  check('default mode stays contains (back-compat)', dflt.length === 1);
}

console.log(`\n${fail ? '✗' : '✓'} lexicon: ${pass}/${pass + fail}`);
process.exitCode = fail ? 1 : 0;
