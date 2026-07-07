/**
 * golden/history.mjs — regression for the live watch-history adapter
 * (DESIGN §4 YtHistoryAdapter). All offline: SAPISIDHASH auth, section-date
 * parsing, response extraction (against a REAL captured logged-out response +
 * a synthetic logged-in one), and the date-range continuation walk driven by a
 * mock HTTP client. The single unverifiable-offline part — the exact logged-in
 * JSON — is confirmed by the in-app "Reconciliation Health Check" which dumps the
 * real response; this suite locks everything else.
 *
 *   node --experimental-strip-types golden/history.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const C = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'yt-history-client.ts')).href);

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => { n++; if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg}`); };

// ── cookie normalization (raw string OR pasted cURL) ──
console.log('\n══ normalizeCookieInput ══');
const RAW = 'SID=x; SAPISID=ABC123def; HSID=y';
ok(C.normalizeCookieInput(RAW) === RAW, 'raw cookie passes through');
ok(C.normalizeCookieInput('  ' + RAW + '  ') === RAW, 'trims raw');
ok(C.normalizeCookieInput(`curl 'https://www.youtube.com/youtubei/v1/browse' -H 'cookie: ${RAW}' -H 'accept: */*'`) === RAW, 'extracts from bash cURL -H cookie', `(${C.normalizeCookieInput(`curl 'x' -H 'cookie: ${RAW}'`)})`);
ok(C.normalizeCookieInput(`curl "https://x" -H "cookie: ${RAW}"`) === RAW, 'extracts from double-quoted -H');
ok(C.normalizeCookieInput(`curl 'https://x' -b '${RAW}'`) === RAW, 'extracts from -b');
ok(C.normalizeCookieInput(`curl 'https://x' --cookie '${RAW}'`) === RAW, 'extracts from --cookie');
ok(C.normalizeCookieInput('') === '', 'empty → empty');

// ── cookie + auth ──
console.log('\n══ cookie + SAPISIDHASH ══');
const cookie = 'SID=x; SAPISID=ABC123def; __Secure-1PAPISID=ONEPEE; __Secure-3PAPISID=THREEPEE; HSID=y';
ok(C.cookieValue(cookie, 'SAPISID') === 'ABC123def', 'cookieValue extracts SAPISID');
ok(C.cookieValue(cookie, 'NOPE') === null, 'cookieValue null when absent');
const nowSec = 1700000000;
const auth = await C.sapisidAuth(cookie, nowSec);
const expectHash = createHash('sha1').update(`${nowSec} ABC123def https://www.youtube.com`).digest('hex');
ok(auth.startsWith(`SAPISIDHASH ${nowSec}_${expectHash}`), 'SAPISIDHASH matches reference formula', `(${auth.slice(0, 30)}…)`);
ok(auth.includes('SAPISID1PHASH ') && auth.includes('SAPISID3PHASH '), 'emits 1P + 3P hashes when cookies present');
ok((await C.sapisidAuth('SID=only', nowSec)) === null, 'no SAPISID → null (not a logged-in cookie)');
ok((await C.sapisidAuth('__Secure-3PAPISID=Z', nowSec))?.startsWith('SAPISIDHASH '), 'falls back to 3PAPISID for base hash');

// ── section-date parsing (fixed clock: Wed 2026-07-01) ──
console.log('\n══ parseSectionDate ══');
const NOW = Date.parse('2026-07-01T12:00:00'); // a Wednesday (local)
const day = (label) => { const ms = C.parseSectionDate(label, NOW); return ms == null ? null : new Date(ms).toISOString().slice(0, 10); };
ok(day('Today') === '2026-07-01', 'Today', `(${day('Today')})`);
ok(day('Yesterday') === '2026-06-30', 'Yesterday', `(${day('Yesterday')})`);
ok(day('Monday') === '2026-06-29', 'weekday → most recent past', `(${day('Monday')})`);
ok(day('Jun 15, 2026') === '2026-06-15', 'absolute date with year', `(${day('Jun 15, 2026')})`);
ok(day('Jun 15') === '2026-06-15', 'absolute date, year inferred', `(${day('Jun 15')})`);
ok(C.parseSectionDate('garble', NOW) === null, 'unrecognized → null');

// ── extraction: REAL logged-out response ──
console.log('\n══ extractHistoryPage (real logged-out fixture) ══');
const loggedOut = JSON.parse(readFileSync(join(HERE, 'fehistory_loggedout.json'), 'utf8'));
const po = C.extractHistoryPage(loggedOut, NOW);
ok(po.loggedOut === true, 'detects loggedOut on real response');
ok(po.videos.length === 0, 'no videos when logged out', `(${po.videos.length})`);

// ── extraction: synthetic logged-in response (matches real container shape) ──
console.log('\n══ extractHistoryPage (logged-in shape) ══');
const sec = (label, vids) => ({ itemSectionRenderer: {
  header: { itemSectionHeaderRenderer: { title: { runs: [{ text: label }] } } },
  contents: vids.map((v) => ({ videoRenderer: { videoId: v[0], title: v[1].simple ? { simpleText: v[1].t } : { runs: [{ text: v[1].t }] } } })),
} });
const loggedIn = {
  responseContext: { mainAppWebResponseContext: { loggedOut: false } },
  contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: {
    contents: [
      sec('Today', [['aaaaaaaaaaa', { t: '今日の動画' }], ['bbbbbbbbbbb', { t: 'Second', simple: true }]]),
      sec('Yesterday', [['ccccccccccc', { t: '昨日の動画' }]]),
      { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'TOKEN_1' } } } },
    ],
  } } } }] } },
};
const pi = C.extractHistoryPage(loggedIn, NOW);
ok(pi.videos.length === 3, 'extracts 3 videos across sections', `(${pi.videos.length})`);
ok(pi.videos[0].id === 'aaaaaaaaaaa' && pi.videos[0].title === '今日の動画', 'videoRenderer runs title');
ok(pi.videos[1].title === 'Second', 'videoRenderer simpleText title');
ok(new Date(pi.videos[0].watchedAt).toISOString().slice(0, 10) === '2026-07-01', 'Today video dated');
ok(new Date(pi.videos[2].watchedAt).toISOString().slice(0, 10) === '2026-06-30', 'Yesterday video dated');
ok(pi.continuation === 'TOKEN_1', 'reads continuation token');

// ── date-range walk over a mock HTTP client ──
// listWatched uses the real Date.now() internally, so the fixture uses ABSOLUTE
// date-section labels (clock-independent) rather than Today/Yesterday.
console.log('\n══ listWatched date-range walk (mock http) ══');
const page1 = {
  responseContext: { mainAppWebResponseContext: { loggedOut: false } },
  contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: {
    contents: [
      sec('Jul 1, 2026', [['aaaaaaaaaaa', { t: '動画A' }], ['bbbbbbbbbbb', { t: '動画B' }]]),
      sec('Jun 30, 2026', [['ccccccccccc', { t: '動画C' }]]),
      { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'TOKEN_1' } } } },
    ],
  } } } }] } },
};
const page2 = {
  responseContext: { mainAppWebResponseContext: { loggedOut: false } },
  onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [
    sec('Jun 20, 2026', [['ddddddddddd', { t: '古い動画' }]]),   // older than the window → triggers stop
  ] } }],
};
const mockHttp = { get: async () => ({ status: 200, text: '{}' }), post: async (_u, body) => {
  const isFirst = body.includes('FEhistory');
  return { status: 200, text: JSON.stringify(isFirst ? page1 : page2) };
} };
const client = new C.YtHistoryClient(mockHttp, () => ({ cookie, apiKey: 'k', clientVersion: 'v', hl: 'en', gl: 'US' }));
const res = await client.listWatched(
  { since: Date.parse('2026-06-30T00:00:00'), until: Date.parse('2026-07-01T23:59:59') },
  { maxVideos: 100 },
);
ok(res.videos.length === 3, 'keeps only in-range videos (Today+Yesterday)', `(${res.videos.length})`);
ok(res.stopped === 'reached-since', 'stops when a section predates since', `(${res.stopped})`);
ok(res.pages === 2, 'walked 2 pages', `(${res.pages})`);
ok(!res.videos.some((v) => v.id === 'ddddddddddd'), 'excludes the out-of-range video');

// loggedOut mid-fetch → throws
const outClient = new C.YtHistoryClient({ get: async () => ({ status: 200, text: '{}' }), post: async () => ({ status: 200, text: JSON.stringify(loggedOut) }) }, () => ({ cookie, apiKey: 'k', clientVersion: 'v', hl: 'en', gl: 'US' }));
let threw = false;
try { await outClient.listWatched({ since: 0, until: NOW }, { maxVideos: 10 }); } catch (e) { threw = e instanceof C.YtHistoryError; }
ok(threw, 'throws YtHistoryError when cookie is logged out');

console.log(`\n${fail ? '✗' : '✓'} history golden: ${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
