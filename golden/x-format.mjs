/**
 * golden/x-format.mjs — proves the tweet → vault-markdown path:
 *
 *   formatTweetCallout (the canonical [!x-tweet] block used by insert AND
 *   collections), joinCollocationParts, shouldCollapse, parseMediaList
 *   (GraphQL extended_entities + syndication shapes), and the corpus JSONL
 *   media round-trip.
 *
 * Run:  node golden/x-format.mjs
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require(join(HERE, '..', 'node_modules', 'esbuild'));

// ── Bundle the production modules (obsidian stubbed) ────────────────────
const dir = mkdtempSync(join(tmpdir(), 'jpc-xfmt-'));
const stub = join(dir, 'obsidian-stub.js');
writeFileSync(stub, `
module.exports = {
  Notice: class {}, Modal: class {}, Setting: class {}, TFile: class {},
  TFolder: class {}, normalizePath: (p) => p, requestUrl: async () => ({}),
};
`);
const p = (rel) => join(HERE, '..', 'src', rel).replace(/\\/g, '/');
writeFileSync(join(dir, 'entry.ts'), `
export { formatTweetCallout, joinCollocationParts, shouldCollapse, formatDateYMD } from '${p('x/tweet-format.ts')}';
export { parseMediaList } from '${p('x/XClient.ts')}';
export { XCorpusStore } from '${p('x/XCorpusStore.ts')}';
`);
await esbuild.build({
  entryPoints: [join(dir, 'entry.ts')], bundle: true, platform: 'node', format: 'cjs',
  outfile: join(dir, 'xfmt.cjs'), logLevel: 'silent', alias: { obsidian: stub },
});
const { formatTweetCallout, joinCollocationParts, shouldCollapse, parseMediaList, XCorpusStore } =
  require(join(dir, 'xfmt.cjs'));

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── Fixture tweet (the user's real example, multiline + emoji) ──────────
const tweet = {
  id: '1',
  url: 'https://x.com/kinniku/status/1',
  text: '今週頭からトレーニング休んでて今日から再開したけど、全然本調子じゃない😭\n鼻喉両方やられてたからか全然呼吸整わないしやってて胸焼けもする\nこの調子もさすがに今日まで…と思いたい🥶',
  authorHandle: 'kinniku',
  authorName: '筋肉',
  createdAt: Date.UTC(2026, 5, 30, 12, 0, 0),
  lang: 'ja',
  favoriteCount: 12, retweetCount: 3, replyCount: 1, quoteCount: 0,
  hasMedia: true,
  media: [
    { type: 'photo', thumb: 'https://pbs.twimg.com/media/AAA?name=small', url: 'https://pbs.twimg.com/media/AAA?name=large' },
    { type: 'video', thumb: 'https://pbs.twimg.com/vid_thumb/BBB.jpg', url: 'https://video.twimg.com/BBB.mp4' },
  ],
  capturedAt: Date.UTC(2026, 6, 9),
  queries: ['"さすがに" lang:ja'],
};

console.log('— formatTweetCallout —');
const block = formatTweetCallout(tweet, { collocations: ['この…も…まで', 'さすがに'] });
const lines = block.split('\n');
check('every line is callout-quoted', lines.every(l => l.startsWith('>')));
check('title has handle link + date', /^> \[!x-tweet\] \[@kinniku\]\(https:\/\/x\.com\/kinniku\/status\/1\) ・ \d{4}\/\d{2}\/\d{2}$/.test(lines[0]), lines[0]);
check('tweet linebreaks preserved as separate quoted lines',
  lines[1].includes('今週頭から') && lines[2].includes('鼻喉両方') && lines[3].includes('この調子も'));
check('collocation line present with both surfaces',
  block.includes('> 🔖 `この…も…まで` `さすがに`'));
check('photo embedded', block.includes('> ![](https://pbs.twimg.com/media/AAA?name=small)'));
check('video is a linked poster (not bare embed)',
  block.includes('> [▶ ![](https://pbs.twimg.com/vid_thumb/BBB.jpg)](https://video.twimg.com/BBB.mp4)'));
check('metrics line present', /> ❤ 12 🔁 3 💬 1$/.test(block));
check('no trailing newline (caller controls spacing)', !block.endsWith('\n'));
const noColl = formatTweetCallout(tweet, { includeMedia: false });
check('media/collocations omittable', !noColl.includes('![](') && !noColl.includes('🔖'));

console.log('— joinCollocationParts / shouldCollapse —');
check('parts join with … gaps', joinCollocationParts(['この', ' も ', 'まで']) === 'この…も…まで');
check('single part passes through', joinCollocationParts(['さすがに']) === 'さすがに');
check('short tweet not collapsed', shouldCollapse('短いツイート') === false);
check('the ~5-line fixture tweet stays open (fits on screen)', shouldCollapse(tweet.text) === false);
check('a long note-tweet collapses', shouldCollapse(tweet.text + '\n' + tweet.text) === true);
check('many short lines collapse', shouldCollapse('あ\nい\nう\nえ\nお\nか\nき') === true);

console.log('— parseMediaList (GraphQL shape) —');
const gql = parseMediaList([
  { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/CCC' },
  {
    type: 'video', media_url_https: 'https://pbs.twimg.com/vid/DDD.jpg',
    video_info: { variants: [
      { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/DDD.m3u8' },
      { content_type: 'video/mp4', bitrate: 320000, url: 'https://video.twimg.com/DDD-low.mp4' },
      { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/DDD-high.mp4' },
    ] },
  },
  { type: 'photo' }, // no URL → dropped
]);
check('photo gets sized thumb/full URLs',
  gql[0]?.thumb === 'https://pbs.twimg.com/media/CCC?name=small' &&
  gql[0]?.url === 'https://pbs.twimg.com/media/CCC?name=large');
check('video picks highest-bitrate mp4', gql[1]?.url === 'https://video.twimg.com/DDD-high.mp4');
check('video thumb is the poster frame', gql[1]?.thumb === 'https://pbs.twimg.com/vid/DDD.jpg');
check('entry without URL dropped', gql.length === 2);

console.log('— parseMediaList (syndication photos[] shape) —');
const synd = parseMediaList([{ url: 'https://pbs.twimg.com/media/EEE?format=jpg' }]);
check('photos[] {url} accepted as photo', synd.length === 1 && synd[0].type === 'photo');

console.log('— corpus JSONL media round-trip —');
const store = new XCorpusStore(async () => {});
store.addTweets([tweet]);
const jsonl = store.exportJsonl();
const rec = JSON.parse(jsonl.trim().split('\n')[0]);
check('export carries media[]', Array.isArray(rec.media) && rec.media.length === 2);
check('export carries hasMedia', rec.hasMedia === true);
const store2 = new XCorpusStore(async () => {});
const { added } = store2.importJsonl(jsonl);
const back = store2.get('1');
check('import restores media', added === 1 && back?.media?.length === 2 &&
  back.media[1].url === 'https://video.twimg.com/BBB.mp4');
check('import restores hasMedia', back?.hasMedia === true);

console.log(`\n${fail === 0 ? '✓' : '✗'} x-format: ${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
