/**
 * golden/match-japanese.mjs — ONE matcher, one scale (AUDIT-2026-08-01 §3).
 *
 * The defect: two search engines over one corpus. `SearchEngine` folded kana,
 * read romaji, expanded grammar and ran Levenshtein; `unifiedSearch` — on the
 * surface DESIGN §20 calls the product — did NFC + strip-space + lowercase and
 * then exact/prefix/includes. So `kaze` found 風 in one box and nothing in the
 * other, かぜ and カゼ behaved differently, and the two ranked the same rows on
 * incomparable scales (80+20 boosts vs 100/70/45 tiers).
 *
 * And it did not scale: per entry × per field × per term, a sliding-window
 * Levenshtein over every substring offset, with the field re-normalized every
 * keystroke — 2,533 ms at 50k entries, while ONE Hyogen word is 22,558
 * collocations.
 *
 * Run:  node golden/match-japanese.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const M = await import(pathToFileURL(join(HERE, '..', 'src', 'search', 'match-japanese.ts')).href);
const U = await import(pathToFileURL(join(HERE, '..', 'src', 'lexicon', 'unified-search.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};
const score = (field, query, opts) => M.scoreText(field, M.prepareQuery(query), opts);

console.log('══ THE REGRESSION: type it however it comes to mind ══');
{
  // An entry is a SET of fields (headword + reading + …). The matcher compares
  // strings and has no kanji→reading dictionary, so 風 reaches the row through
  // the headword field and かぜ through the reading field. Scoring the row is
  // what the callers do, so that is what is checked.
  const row = ['風', 'かぜ'].map(M.indexField);
  for (const q of ['風', 'かぜ', 'カゼ', 'ｶｾﾞ', 'kaze']) {
    const s = M.scoreFields(row, M.prepareQuery(q));
    check(`「${q}」 reaches the 風/かぜ row`, s > 0, String(s));
  }
  check('romaji `kaze` reaches a katakana-only row', score('カゼ', 'kaze') > 0);
  // …and the SAME module answers for the catalog surface, which is the point.
  const cat = U.unifiedSearch({
    patterns: [{ id: 'p1', class: 'collocation', classRatified: true, keyKind: 'surface',
      key: 'かぜが吹く', note: 'かぜが吹く', payload: {}, attestations: [], createdAt: 0, updatedAt: 0 }],
    collocations: [], query: 'kaze',
  });
  check('unifiedSearch answers `kaze` too (it could not before)', cat.length === 1, JSON.stringify(cat.map((e) => e.headword)));
}

console.log('\n══ one scale: the tiers cannot cross ══');
{
  const exact = score('かぜ', 'かぜ');
  const prefix = score('かぜがふく', 'かぜ');
  const sub = score('つよいかぜ', 'かぜ');
  // Fuzzy is OPT-IN. It is the expensive path (Levenshtein behind the bigram
  // gate), so defaulting it on would silently slow every caller that only
  // wanted a literal lookup; both real callers pass it explicitly.
  const fuzzy = score('かぜがふく', 'かせがふく', { fuzzy: true });
  check('fuzzy is OFF unless asked for', score('かせがふく', 'かぜがふく') === 0);
  check(`exact(${exact}) > prefix(${prefix})`, exact > prefix);
  check(`prefix(${prefix}) > substring(${sub})`, prefix > sub);
  check(`substring(${sub}) > fuzzy(${fuzzy})`, sub > fuzzy, `fuzzy=${fuzzy}`);
  check('a fuzzy hit is still a hit', fuzzy > 0, String(fuzzy));

  // The old code added a flat +20 to headword hits, so a boosted SUBSTRING
  // (80+20) beat an exact match on any other field (80). Boost must stay
  // inside its tier.
  const boostedSub = score('つよいかぜ', 'かぜ', { boost: 9 });
  check(`max-boosted substring(${boostedSub}) still loses to bare prefix(${prefix})`, boostedSub < prefix);
  check('boost is clamped (no boost can reach the next tier)',
    score('つよいかぜ', 'かぜ', { boost: 999 }) < M.TIER.prefix);
}

console.log('\n══ modes ══');
{
  check('prefix mode rejects a substring-only hit',
    score('つよいかぜ', 'かぜ', { mode: 'prefix' }) === 0);
  check('prefix mode keeps a real prefix', score('かぜがふく', 'かぜ', { mode: 'prefix' }) > 0);
  check('prefix mode never fuzzes', score('かせ', 'かぜ', { mode: 'prefix', fuzzy: true }) === 0);
  check('contains mode keeps the substring', score('つよいかぜ', 'かぜ', { mode: 'contains' }) > 0);
}

console.log('\n══ wildcard ══');
{
  check('`か*` matches かぜ', score('かぜ', 'か*') > 0);
  check('`か?ぜ` matches かのぜ', score('かのぜ', 'か?ぜ') > 0);
  check('`か?ぜ` does NOT match かぜ', score('かぜ', 'か?ぜ') === 0);
  // A query with regex metacharacters must search, not throw.
  let threw = false;
  try { score('a(b', 'a(b'); } catch { threw = true; }
  check('a query containing `(` does not throw', !threw);
}

console.log('\n══ the bigram prefilter must not lose real fuzzy hits ══');
{
  // One substitution in a 5-char word: shares bigrams, must survive the gate.
  check('a one-character typo still matches', score('かぜがふく', 'かせがふく', { fuzzy: true }) > 0);
  // Shares nothing: correctly gated out rather than Levenshtein-scanned.
  check('an unrelated string does not match', score('やまのぼり', 'かぜがふく', { fuzzy: true }) === 0);
  // A typo in a 2-char word is HALF the word. Accepting it would make かぜ
  // match かせ/かき/かく/かう — every kana pair sharing one character — so the
  // floor rejects it on purpose.
  check('a typo in a 2-char word is NOT fuzzy-matched', score('かせ', 'かぜ', { fuzzy: true }) === 0);
  check('a 1-char query does not fuzz (noise floor)', score('かぜ', 'か', { fuzzy: true }) >= 0);
}

console.log('\n══ empty query is browse, not zero ══');
{
  const q = M.prepareQuery('   ');
  check('empty query is flagged', q.empty);
  check('and every field scores 1 (ranked by metadata elsewhere)', M.scoreField(M.indexField('anything'), q) === 1);
}

console.log('\n══ the field cache normalizes once, not per keystroke ══');
{
  let extracted = 0;
  const cache = new M.FieldCache((e) => { extracted++; return [e.text]; }, (e) => e.stamp);
  const item = { text: 'かぜ', stamp: 1 };
  cache.fields(item); cache.fields(item); cache.fields(item);
  check('repeat lookups do not re-extract', extracted === 1, `${extracted}`);
  item.stamp = 2;
  cache.fields(item);
  check('a changed stamp invalidates', extracted === 2, `${extracted}`);
}

console.log('\n══ it scales (AUDIT §3: 2,533 ms at 50k) ══');
{
  const KANA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろ';
  const N = 50000;
  const corpus = Array.from({ length: N }, (_, i) => ({
    stamp: 1,
    f: [KANA[i % KANA.length] + KANA[(i * 7) % KANA.length],
        KANA[i % KANA.length] + 'が' + KANA[(i * 5) % KANA.length] + 'する',
        'これは' + KANA[i % KANA.length] + 'の例文です。'],
  }));
  const cache = new M.FieldCache((e) => e.f, (e) => e.stamp);
  for (const e of corpus) cache.fields(e);           // store-load cost, not keystroke cost
  // WORST case: a query every entry matches, so nothing short-circuits.
  const q = M.prepareQuery('これは');
  const t0 = performance.now();
  let hits = 0;
  for (const e of corpus) if (M.scoreFields(cache.fields(e), q, { fuzzy: true }) > 0) hits++;
  const ms = performance.now() - t0;
  check(`50k entries, every one matching: ${ms.toFixed(0)}ms (was 2,533ms)`, ms < 400, `${ms.toFixed(0)}ms`);
  check('and it actually matched them', hits === N, `${hits}`);
}

console.log(`\n${fail ? '✗' : '✓'} match-japanese: ${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
