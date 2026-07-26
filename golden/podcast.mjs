/**
 * golden/podcast.mjs — §22 podcast RSS parsing (fixture from the user's REAL
 * のらじお feed) + manga OCR response validation.
 *
 * Run:  node golden/podcast.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const R = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'podcast-rss.ts')).href);
const M = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'manga-ocr.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('══ RSS parsing (real のらじお shape) ══');
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<title><![CDATA[のらじお]]></title>
<item>
  <title><![CDATA[身体を柔らかくする]]></title>
  <link>https://podcasters.spotify.com/pod/show/noradio/episodes/ep-e3jt45p</link>
  <pubDate>Fri, 10 Jul 2026 12:00:00 GMT</pubDate>
  <enclosure url="https://anchor.fm/s/5a896804/podcast/play/120540793/https%3A%2F%2Fexample.mp3" length="29726847" type="audio/mpeg"/>
  <itunes:duration>00:15:28</itunes:duration>
</item>
<item>
  <title><![CDATA[動画だけの回]]></title>
  <enclosure url="https://example.com/ep.mp4" type="video/mp4"/>
</item>
<item>
  <title><![CDATA[秒数duration回]]></title>
  <enclosure url="https://example.com/ep2.mp3" type="audio/mpeg"/>
  <itunes:duration>930</itunes:duration>
</item>
</channel></rss>`;
  const feed = R.parsePodcastFeed(xml);
  check('show title from channel (CDATA)', feed.show === 'のらじお');
  check('audio episodes parsed, video skipped', feed.episodes.length === 2 && feed.episodes[0].title === '身体を柔らかくする');
  check('enclosure URL html-entities decoded', !feed.episodes[0].audioUrl.includes('&amp;'));
  check('HH:MM:SS duration → seconds', feed.episodes[0].durationSec === 928);
  check('bare-seconds duration parsed', feed.episodes[1].durationSec === 930);
  check('link carried for the deep-link door', feed.episodes[0].link.includes('spotify'));

  const note = R.podcastNote(feed.show, feed.episodes[0], 'Podcasts/身体を柔らかくする.mp3');
  check('note: source podcast + generated:pending + audio embed', note.includes('source: podcast') && note.includes('generated: pending') && note.includes('![[Podcasts/'));
}

console.log('══ manga OCR validation ══');
{
  const api = (bubbles) => JSON.stringify({ content: [{ text: JSON.stringify({ bubbles }) }] });
  const good = M.parseMangaOcr(200, api([
    { text: '聞かん名だ。', bbox: [120, 180, 90, 200] },
    { text: 'なんだね その会社は。', bbox: [110, 400, 95, 260] },
    { text: 'ぼんやり', bbox: [0, 0, 1200, 50] },        // out-of-range bbox
    { text: '', bbox: [1, 1, 1, 1] },                     // empty text
    { text: 'boxなし' },                                  // no bbox
  ]));
  check('valid bubbles survive', good.ok && good.bubbles.length === 2, JSON.stringify(good));
  check('bubble without locatable bbox rejected (scene contract)', good.ok && !good.bubbles.some((b) => b.text === 'boxなし'));
  check('out-of-range bbox rejected', good.ok && !good.bubbles.some((b) => b.text === 'ぼんやり'));
  const refusal = M.parseMangaOcr(200, JSON.stringify({ content: [{ text: '申し訳ありません' }] }));
  check('refusal → honest failure', !refusal.ok);
  const httpErr = M.parseMangaOcr(429, '{"error":{"message":"rate"}}');
  check('HTTP error surfaced', !httpErr.ok && httpErr.error.includes('429'));
  check('model is the ONE pinned constant', M.MANGA_MODEL === 'claude-haiku-4-5-20251001');
  check('prompt demands spread reading order + normalized bbox', M.MANGA_PROMPT.includes('右ページ') && M.MANGA_PROMPT.includes('0〜1000'));
}

console.log(fail ? `\n✗ podcast: ${fail} failed (${pass} passed)` : `\n✓ podcast: all ${pass} pass`);
process.exit(fail ? 1 : 0);
