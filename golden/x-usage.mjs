/**
 * golden/x-usage.mjs — X as a corpus rather than a feed.
 *
 * The 𝕏 view held 1,832 tweets / 976,401 characters from 1,729 different
 * people and showed them as a reverse-chronological list. `buildXUsage` asks
 * the questions a corpus can answer and a feed cannot: how often, with what, in
 * what shape, and — the load-bearing one — **said by how many different
 * people**. Forty hits from three accounts is one person's tic; forty from
 * thirty-eight is the language, and only the second is worth putting in a
 * dictionary.
 *
 * It also carries a real defect fix. `xJoinPattern` attached WHOLE tweets to
 * catalog entries as 用例 — p90 4,691 characters, longest 9,721, a marketing
 * thread filed as evidence for 「だよね」. `kwicQuote` is the window that
 * replaces them, and the checks below pin its size and its centring.
 *
 * Run:  node golden/x-usage.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const U = await import(pathToFileURL(join(HERE, '..', 'src', 'x', 'usage.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

let seq = 0;
const tw = (text, handle = 'a' + (++seq), at = 1_700_000_000_000 + seq * 86400000) => ({
  id: String(seq), url: `https://x.com/${handle}/status/${seq}`, text,
  authorHandle: handle, authorName: handle, createdAt: at, lang: 'ja',
  favoriteCount: 0, retweetCount: 0, replyCount: 0, quoteCount: 0, hasMedia: false, capturedAt: at,
});

console.log('\n══ the count, and the denominator it means nothing without ══');
{
  const rows = [tw('これは面白いんだけど、まあいいや'), tw('やってみたんだけど、だめだった'), tw('関係ない話です')];
  const u = U.buildXUsage(rows, 'んだけど', 1832);
  check('hits counts tweets, not occurrences', u.hits === 2);
  check('the corpus size travels with the count', u.corpus === 1832);
  check('distinct authors are counted', u.authors === 2);
  check('the span is the oldest and newest hit', u.span.from < u.span.to);
  check('a term absent from the corpus yields a zeroed profile',
    U.buildXUsage(rows, 'ございません', 1832).hits === 0);
  check('…with no lines rather than an empty box', U.buildXUsage(rows, 'ございません', 1832).lines.length === 0);
  check('an empty term is not a search', U.buildXUsage(rows, '   ', 1832).hits === 0);
  // A thread repeating the phrase is ONE person saying it. Letting it count
  // eight times would inflate exactly the number spread exists to keep honest.
  const spammy = [tw('だよね。だよね。だよね。だよね。', 'loud')];
  check('one tweet contributes one line however often it repeats',
    U.buildXUsage(spammy, 'だよね', 1832).lines.length === 1);
  check('…and one hit', U.buildXUsage(spammy, 'だよね', 1832).hits === 1);
}

console.log('\n══ spread: the question a feed structurally cannot answer ══');
{
  const many = Array.from({ length: 40 }, (_, i) => tw(`今日は${i}的にいいんだけど、そうでもない`, `u${i}`));
  const few = Array.from({ length: 40 }, (_, i) => tw(`今日は${i}的にいいんだけど、そうでもない`, `u${i % 3}`));
  check('40 hits from 40 people is spread', U.spreadOf(U.buildXUsage(many, 'んだけど', 1832)) === 'spread');
  check('40 hits from 3 people is narrow', U.spreadOf(U.buildXUsage(few, 'んだけど', 1832)) === 'narrow');
  check('the narrow case still reports its real author count',
    U.buildXUsage(few, 'んだけど', 1832).authors === 3);
  check('3 hits is thin whoever wrote them',
    U.spreadOf(U.buildXUsage(many.slice(0, 3), 'んだけど', 1832)) === 'thin');
  // …and `thin` is about the count, not about disagreement.
  check('4 hits from 4 people escapes thin',
    U.spreadOf(U.buildXUsage(many.slice(0, 4), 'んだけど', 1832)) === 'spread');
}

console.log('\n══ the window: a scene, not a haystack ══');
{
  // A real-shaped long tweet: the phrase is buried 200 characters in.
  const long = tw('あ'.repeat(200) + '。そういうわけで今日は疲れたんだけど、明日もがんばります。' + 'い'.repeat(300));
  const u = U.buildXUsage([long], 'んだけど', 1832);
  const q = U.kwicQuote(u.lines[0]);
  check('the quote is a fragment, not the tweet', [...q].length < 70, `${[...q].length}字`);
  check('…and the tweet really was enormous', [...long.text].length > 500);
  check('the phrase is inside the quote', q.includes('んだけど'));
  check('the left context ends where the phrase begins', u.lines[0].left.endsWith('疲れた'));
  check('the right context starts where it ends', u.lines[0].right.startsWith('、明日'));
  // Cutting at a boundary is what makes the fragment readable Japanese rather
  // than an arbitrary slice — 22 characters back from 「んだけど」 lands mid-word.
  check('the window prefers a sentence boundary to a hard cut', !u.lines[0].clippedLeft);
  check('…and says so when it had to cut anyway',
    U.buildXUsage([tw('あ'.repeat(80) + 'んだけどね')], 'んだけど', 1832).lines[0].clippedLeft === true);
  check('an ellipsis marks a hard cut in the quote',
    U.kwicQuote(U.buildXUsage([tw('あ'.repeat(80) + 'んだけどね')], 'んだけど', 1832).lines[0]).startsWith('…'));
  // Tweets are full of line breaks; a newline inside a KWIC row destroys the
  // alignment that IS the point of a KWIC row.
  const multi = tw('質問です\n出願はどうすればよいか？\n実質、地域枠じゃないですか？');
  const m = U.buildXUsage([multi], 'じゃないですか', 1832);
  check('no newline survives into a KWIC row',
    !m.lines[0].left.includes('\n') && !m.lines[0].right.includes('\n'), JSON.stringify(m.lines[0]));
}

console.log('\n══ every line keeps its door back (§28 S2) ══');
{
  const u = U.buildXUsage([tw('これはいいんだけど、ね', 'kensanji')], 'んだけど', 1832);
  check('the permalink rides along', u.lines[0].url.includes('/status/'));
  check('the handle rides along', u.lines[0].handle === 'kensanji');
  check('and the timestamp', u.lines[0].at > 0);
}

console.log('\n══ neighbours: literal adjacent strings, never claimed as words ══');
{
  const rows = [
    tw('やってみたんだけど、それがだめで', 'a'), tw('言われたんだけど、それは違う', 'b'),
    tw('聞いたんだけど、それでいい', 'c'), tw('わからないんだけど、まあね', 'd'),
  ];
  const u = U.buildXUsage(rows, 'んだけど', 1832);
  check('a repeated right environment surfaces', u.after.some((n) => n.text.startsWith('、それ')), JSON.stringify(u.after));
  check('each neighbour reports how many PEOPLE wrote it',
    u.after.every((n) => n.authors >= 2 && n.authors <= n.count));
  // One author saying a thing twice is that author's habit. A corpus panel
  // that reports it as usage makes exactly the mistake spread exists to stop.
  const solo = [tw('ぜんぜんいいんだけど、ぴよぴよ', 'z'), tw('まあいいんだけど、ぴよぴよ', 'z')];
  check('two sightings from ONE author are not a neighbour',
    !U.buildXUsage(solo, 'んだけど', 1832).after.some((n) => n.text.includes('ぴよ')),
    JSON.stringify(U.buildXUsage(solo, 'んだけど', 1832).after));
  // Line breaks are punctuation, not vocabulary — without this the top
  // "neighbours" of 「だよね」 came out as 「。\n」 and 「。\n\n」.
  const breaks = [tw('そうだよね。\n\nうん', 'a'), tw('やっぱだよね。\nそう', 'b'), tw('まあだよね。\n\n\nね', 'c')];
  const b = U.buildXUsage(breaks, 'だよね', 1832);
  check('a punctuation-and-whitespace neighbour is not reported',
    !b.after.some((n) => !/[ぁ-んァ-ヶ一-龠]/.test(n.text)), JSON.stringify(b.after));
  // 「うわけ」 under 「というわけ」 at the same count is one finding printed twice.
  const nest = Array.from({ length: 6 }, (_, i) => tw(`これはというわけだから、${i}`, `n${i}`));
  const n = U.buildXUsage(nest, 'わけ', 1832);
  check('a shorter neighbour that is only a tail of a commoner one is dropped',
    !n.before.some((x) => x.text === 'うい') && n.before.length > 0, JSON.stringify(n.before));
  check('neighbours are capped', n.before.length <= 5 && n.after.length <= 5);
}

console.log('\n══ truncation is reported, never silent (§28 S6) ══');
{
  const many = Array.from({ length: 90 }, (_, i) => tw(`${i}番目のいいんだけどの話`, `u${i}`));
  const u = U.buildXUsage(many, 'んだけど', 1832);
  check('lines stop at the cap', u.lines.length === U.MAX_KWIC);
  check('hits still counts them all', u.hits === 90);
  check('and the remainder is stated', u.more === 90 - U.MAX_KWIC);
  check('no remainder when everything fits',
    U.buildXUsage(many.slice(0, 5), 'んだけど', 1832).more === 0);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} x-usage: ${pass}/${pass + fail} checks passed`);
if (fail) process.exitCode = 1;
