/**
 * golden/paradigm.mjs — 32 rows that are one phenomenon.
 *
 * The 談話 shelf in the shipped catalog is 31 sentence-final variants plus one
 * piece of ASR wreckage. `foldParadigms` groups them on two axes — what the
 * user's own concordance says each form DOES, and a short declared table of
 * spelling variants — with the corpus vetoing the table whenever they disagree.
 *
 * Every key, count and move id below is real, taken from the live data.json, so
 * this suite pins the fold against the actual shape of the problem rather than
 * a tidy invention. The load-bearing cases:
 *
 *   • でしょ / でしょう share a skeleton but the corpus calls them
 *     CONJECTURE-APPEAL and CONJECTURE-PROBE → they must NOT fold.
 *   • んですけれども has no move of its own but shares んですけど's skeleton →
 *     it folds, and the family is named by the member that knows.
 *
 * Run:  node golden/paradigm.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const P = await import(pathToFileURL(join(HERE, '..', 'src', 'lexicon', 'paradigm.ts')).href);
const CT = await import(pathToFileURL(join(HERE, '..', 'src', 'lexicon', 'context-tree.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

/** n suggested sightings of one move, with distinguishable quotes. */
const sights = (n, move) => Array.from({ length: n }, (_, i) => ({
  source: 'yt', file: 'f.md', quote: `これは${i}行目ですよ`, addedAt: 1,
  status: 'suggested', matchKind: move ? `concordance:final:${move}` : 'concordance:final',
}));

/** A UnifiedEntry as the list actually builds it, over a real PatternEntry. */
const entry = (key, move, n, confirmed = 0, cls = 'discourse') => ({
  id: `p-${key}`, kind: 'pattern', headword: key, cls,
  attestationCount: confirmed, sources: [], score: 0,
  pattern: {
    id: `p-${key}`, class: cls, classRatified: true, keyKind: 'surface', key, note: key,
    payload: {}, createdAt: 1, updatedAt: 1,
    attestations: [
      ...sights(n, move),
      ...Array.from({ length: confirmed }, (_, i) => ({ source: 'yt', file: 'f.md', quote: `確定${i}`, addedAt: 1 })),
    ],
  },
});

const names = (fold) => fold.paradigms.map((p) => p.members.map((m) => m.headword).join('+'));

console.log('\n══ dominantMove: a label needs less evidence than a distribution ══');
{
  const e = (n, move) => ({ attestations: sights(n, move) });
  check('7 named sightings is not enough', CT.dominantMove(e(7, 'AGREE-MARK')) === null);
  check('8 is', CT.dominantMove(e(8, 'AGREE-MARK'))?.move === 'AGREE-MARK');
  check('the move is glossed, never shown as its id',
    CT.dominantMove(e(20, 'AGREE-MARK'))?.label === '同意を示す');
  check('position-only sightings name no move',
    CT.dominantMove({ attestations: sights(200, null) }) === null);
  check('confirmed attestations are not sightings',
    CT.dominantMove({ attestations: [{ source: 'yt', quote: 'a', addedAt: 1, matchKind: 'concordance:final:AGREE-MARK' }] }) === null);
  // A form split down the middle has no dominant move, and saying it does
  // would be exactly the "wrong structure" §28 S6 forbids.
  const split = { attestations: [...sights(50, 'AGREE-MARK'), ...sights(50, 'GROUND-CLAIM')] };
  check('a 50/50 split has no dominant move', CT.dominantMove(split) === null);
  const clear = { attestations: [...sights(70, 'AGREE-MARK'), ...sights(30, 'GROUND-CLAIM')] };
  check('70/30 does', CT.dominantMove(clear)?.move === 'AGREE-MARK');
  check('…and reports its own share honestly', Math.abs(CT.dominantMove(clear).share - 0.7) < 1e-9);
}

console.log('\n══ axis 1: forms the corpus says do the same job ══');
{
  // The real GROUND-CLAIM family, with its real counts.
  const list = [
    entry('じゃないですか', 'GROUND-CLAIM', 244),
    entry('じゃん', 'GROUND-CLAIM', 128),
    entry('んじゃない', 'GROUND-CLAIM', 40),
    entry('んじゃないかな', 'GROUND-CLAIM', 13),
  ];
  const f = P.foldParadigms(list);
  check('four spellings, one family', f.paradigms.length === 1 && f.paradigms[0].members.length === 4);
  check('nothing is left loose', f.loose.length === 0);
  check('named by what it does, not what it looks like', f.paradigms[0].label === '暗黙の同意を地固めする');
  check('and it says so', f.paradigms[0].basis === 'move');
  check('the sightings behind the grouping are summed', f.paradigms[0].sightings === 425);
  check('the surface line lists members then counts the rest',
    P.paradigmSurface(f.paradigms[0]) === 'じゃないですか・じゃん・んじゃない ほか1語',
    P.paradigmSurface(f.paradigms[0]));
}

console.log('\n══ axis 2: declared spelling variants ══');
{
  check('けれども・けども・けど are one morpheme', P.skeleton('んですけれども') === 'んですけど' && P.skeleton('んですけども') === 'んですけど');
  check('でしょう → でしょ', P.skeleton('でしょう') === 'でしょ');
  check('ではない → じゃない', P.skeleton('ではないですか') === 'じゃないですか');
  check('のです → んです', P.skeleton('のですけど') === 'んですけど');
  // The line this table must never cross.
  check('です is NOT stripped — it would file ですけど with ですね', P.skeleton('ですけど') === 'ですけど');
  check('ます is NOT stripped either', P.skeleton('ますね') === 'ますね');
  check('ですけど and んですけど stay different words',
    P.skeleton('ですけど') !== P.skeleton('んですけど'));

  // Three real rows, none of which carries a named move.
  const f = P.foldParadigms([entry('ですけど', null, 575), entry('ですけども', null, 51), entry('ですけれども', null, 51)]);
  check('spelling alone can fold', f.paradigms.length === 1 && f.paradigms[0].members.length === 3);
  check('…and admits that is all it knows', f.paradigms[0].basis === 'spelling');
  check('a spelling family is named by its own best member', f.paradigms[0].label === 'ですけど');
}

console.log('\n══ the veto: when the two axes disagree, the corpus wins ══');
{
  // The real case. Same skeleton (でしょ), different jobs in this corpus.
  const f = P.foldParadigms([
    entry('でしょ', 'CONJECTURE-APPEAL', 126),
    entry('でしょう', 'CONJECTURE-PROBE', 162),
  ]);
  check('でしょ and でしょう do NOT fold', f.paradigms.length === 0, JSON.stringify(names(f)));
  check('both stay in the list', f.loose.length === 2);
  // …but the veto needs BOTH sides to actually know something.
  const g = P.foldParadigms([
    entry('んですけど', 'HEDGE-INCOMPLETE', 230),
    entry('んですけれども', null, 131),
    entry('んですけども', null, 118),
  ]);
  check('a member with no move rides the skeleton in', g.paradigms.length === 1 && g.paradigms[0].members.length === 3);
  check('and the family is named by the member that knows', g.paradigms[0].label === '言い差してぼかす');
  check('…which is a move basis, not a spelling one', g.paradigms[0].basis === 'move');
}

console.log('\n══ what must never be folded ══');
{
  const f = P.foldParadigms([
    entry('ですね', 'AGREE-MARK', 1903),
    entry('んですね', 'EXPLAIN-ALIGN', 191),
    entry('んですよ', 'EXPLAIN-REVEAL', 585),
  ]);
  check('three different moves, three separate rows', f.paradigms.length === 0 && f.loose.length === 3);

  // Only the 談話 shelf. A 台詞 that happens to end in ね is not a particle.
  const g = P.foldParadigms([
    entry('やっぱりそうですね', 'AGREE-MARK', 40, 0, 'serifu'),
    entry('ですね', 'AGREE-MARK', 1903),
  ]);
  check('a serifu never joins a discourse family', g.paradigms.length === 0, JSON.stringify(names(g)));
  check('…and passes through untouched', g.loose.length === 2);

  const h = P.foldParadigms([entry('ですね', 'AGREE-MARK', 1903)]);
  check('a family of one is just an entry', h.paradigms.length === 0 && h.loose.length === 1);
  check('an empty list folds to nothing', P.foldParadigms([]).paradigms.length === 0);
}

console.log('\n══ order is never silently reshuffled ══');
{
  // Ranked list: the fold must keep the caller's ordering, both for families
  // (by their best-ranked member) and for the singletons it dissolves.
  const list = [
    entry('ですね', 'AGREE-MARK', 1903),
    entry('じゃん', 'GROUND-CLAIM', 128),
    entry('かな', null, 133),
    entry('じゃないですか', 'GROUND-CLAIM', 244),
  ];
  const f = P.foldParadigms(list);
  check('the family sits where its best-ranked member sat', f.paradigms.length === 1);
  check('members inside a family sort by weight, not by list order',
    f.paradigms[0].members[0].headword === 'じゃないですか', JSON.stringify(names(f)));
  check('loose entries keep the incoming order',
    f.loose.map((e) => e.headword).join() === 'ですね,かな', f.loose.map((e) => e.headword).join());
  // Confirmed usages decide member order; sightings only break the tie.
  const g = P.foldParadigms([entry('よね', 'CONFIRMATION-SEEK', 244), entry('だよね', 'CONFIRMATION-SEEK', 57, 30)]);
  check('the member with real 用例 leads its family',
    g.paradigms[0].members[0].headword === 'だよね');
  check('a family sums its members\' confirmed usages', g.paradigms[0].attestations === 30);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} paradigm: ${pass}/${pass + fail} checks passed`);
if (fail) process.exitCode = 1;
