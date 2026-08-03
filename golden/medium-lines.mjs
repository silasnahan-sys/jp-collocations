/**
 * golden/medium-lines.mjs — every medium as lines the sweep can read.
 *
 * AUDIT-2026-08-01 §6.7 item 3. `sweepEntry` reads `lines[i].tStartSec ?? null`,
 * so the matcher was never transcript-specific — only the LINE PRODUCER was.
 * A phrase flicked in from a tweet or a note.com article could be classified
 * but never reconciled, so the fast road produced the weak artefact for every
 * medium except captioned video.
 *
 * The sharpest case: reading notes were already reaching the sweep.
 * `import-written` writes them into the transcript folder, so the sweep opened
 * each one, found no `[HH:MM:SS]`, and dropped it. The material was in the right
 * place and unreadable for want of an adapter.
 *
 * Run:  node golden/medium-lines.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const M = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'medium-lines.ts')).href);
const S = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'sweep-match.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` (${detail})` : ''}`); }
};

const NOTE_MD = `---
source: note
site: "テスト記事"
url: "https://note.com/x/n/abc"
---

# 見出し

気になるところが多かった。だから調べてみた。

- これは箇条書きの気になる例です。

![[image.png]]
https://example.com
`;

const BOOK_MD = `---
source: book
book_title: "テストの本"
---

第一章のはじまり。ここに気になる表現がある。
`;

const TRANSCRIPT_MD = `---
source: tv
title: "第1話"
---

[00:00:01] これは字幕です。
`;

console.log('\n══ a reading note is recognised as one ══');
{
  const n = M.readingSource(NOTE_MD);
  check('note.com article detected', n?.medium === 'note', n?.medium);
  check('its site name is carried', n?.sourceName === 'テスト記事', n?.sourceName);
  check('its URL becomes the door back', n?.url === 'https://note.com/x/n/abc');
  const b = M.readingSource(BOOK_MD);
  check('Kindle/book detected', b?.medium === 'book');
  check('book_title is carried', b?.sourceName === 'テストの本');
  check('a TRANSCRIPT is not a reading note', M.readingSource(TRANSCRIPT_MD) === null);
  check('a bare note is not a reading note', M.readingSource('# hi\n\ntext') === null);
}

console.log('\n══ prose → sentence lines (the unit that makes a quote judgeable) ══');
{
  const lines = M.proseLines(NOTE_MD);
  const texts = lines.map((l) => l.text);
  check('sentences are split, not paragraphs', texts.includes('気になるところが多かった。'), texts.join(' | ').slice(0, 80));
  check('the second sentence is its own line', texts.includes('だから調べてみた。'));
  check('list markers are stripped', texts.some((t) => t.startsWith('これは箇条書き')));
  check('frontmatter never becomes a line', !texts.some((t) => t.includes('source:') || t.includes('note.com')));
  check('headings are dropped', !texts.some((t) => t.includes('見出し')));
  check('embeds are dropped', !texts.some((t) => t.includes('image.png')));
  check('bare URLs are dropped', !texts.some((t) => t.startsWith('https://')));
  check('indices are sequential from 0', lines.every((l, i) => l.index === i));
  check('prose lines carry NO timestamp (and that is fine)',
    lines.every((l) => l.tStartSec === undefined));
}

console.log('\n══ tweets → sentence lines ══');
{
  const lines = M.tweetLines('@someone これは気になる話ですね。長文の続きです。 https://t.co/abc123');
  const texts = lines.map((l) => l.text);
  check('the @-mention head is stripped', !texts.some((t) => t.includes('@someone')), texts.join(' | '));
  check('the t.co tail is stripped', !texts.some((t) => t.includes('t.co')));
  check('sentences split inside a long-form tweet', texts.length === 2, `${texts.length} lines`);
  check('the sentence text survives intact', texts[0] === 'これは気になる話ですね。');
  check('an empty tweet yields nothing', M.tweetLines('').length === 0);
}

console.log('\n══ only Japanese tweets are swept ══');
{
  check('Japanese text detected', M.hasJapanese('気になる'));
  check('kana detected', M.hasJapanese('ですね'));
  check('pure English is not Japanese', !M.hasJapanese('this is a tweet'));
  const tweets = [
    { id: '1', url: 'u1', text: 'this is english', lang: 'en', createdAt: 3 },
    { id: '2', url: 'u2', text: '気になる', lang: 'ja', createdAt: 1 },
    { id: '3', url: 'u3', text: '日本語だけどlang未設定', lang: 'und', createdAt: 2 },
  ];
  const got = M.sweepableTweets(tweets);
  check('English is excluded', !got.some((t) => t.id === '1'), `${got.length} kept`);
  check('lang:ja is kept', got.some((t) => t.id === '2'));
  check('Japanese with a wrong lang tag is still kept', got.some((t) => t.id === '3'));
  check('newest first', got[0].id === '3');
}

console.log('\n══ END TO END — the sweep now finds a phrase in prose and in a tweet ══');
{
  const entry = {
    id: 'p1', key: '気になる', note: '気になる', class: 'collocation',
    payload: { parts: ['気になる'] }, attestations: [], rejectedAtts: [],
  };
  const fromProse = S.sweepEntry(entry, M.proseLines(NOTE_MD));
  check('a note.com article yields a sighting', fromProse.length >= 1, `${fromProse.length}`);
  check('the sighting has no timestamp and does not pretend to',
    fromProse.every((c) => c.tStartSec === null));
  check('it still carries a quote and a matchKind',
    fromProse.every((c) => !!c.quote && !!c.matchKind), fromProse[0]?.quote);

  const fromTweet = S.sweepEntry(entry, M.tweetLines('これは気になる話ですね。'));
  check('a tweet yields a sighting', fromTweet.length >= 1, `${fromTweet.length}`);

  const fromBook = S.sweepEntry(entry, M.proseLines(BOOK_MD));
  check('a Kindle highlight yields a sighting', fromBook.length >= 1);

  // The regression this whole item exists to prevent.
  check('reading-note prose is NOT empty (the old drop-on-the-floor bug)',
    M.proseLines(NOTE_MD).length > 0 && M.proseLines(BOOK_MD).length > 0);
}

console.log(`\n${fail ? '✗' : '✓'} medium-lines: ${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
