/**
 * golden/transcript.mjs — regression for the YouTube ingestion adapters
 * (DESIGN §4 TranscriptAdapter/YtHistoryAdapter, §6 golden gate, §8 Step 2).
 *
 * The PURE parsers (json3 / timedtext-xml / player-response / Takeout history) run
 * offline against real-shaped fixtures — this is the tripwire that must stay green
 * after any change to the caption or history plumbing. A final NETWORK-gated block
 * runs the REAL yt-dlp tier end-to-end (skipped automatically when yt-dlp/deno are
 * absent), proving the desktop path actually fetches a transcript, not just parses.
 *
 *   node --experimental-strip-types golden/transcript.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';

globalThis.require = createRequire(import.meta.url);
const links = join(homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links');
if (existsSync(links)) process.env.PATH = links + ';' + process.env.PATH;

const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (p) => import(pathToFileURL(join(HERE, '..', 'src', 'notes', p)).href);

const T = await imp('transcript.ts');
const A = await imp('transcript-assembly.ts');
const H = await imp('yt-history.ts');

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => { n++; if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg}`); };

// ── json3 (the format yt-dlp writes + timedtext serves) ──
console.log('\n══ parseJson3 ══');
const j3 = JSON.stringify({ events: [
  { tStartMs: 0, segs: [{ utf8: '[音楽]' }] },
  { tStartMs: 2100, segs: [{ utf8: 'こんにちは' }, { utf8: '世界' }] },
  { tStartMs: 4000, segs: [{ utf8: '\n' }] },              // whitespace-only → dropped
  { tStartMs: 6500, segs: [{ utf8: 'テスト' }] },
] });
const l3 = T.parseJson3(j3);
ok(l3.length === 3, 'drops whitespace-only events', `(${l3.length})`);
ok(l3[1].text === 'こんにちは世界' && l3[1].tStartSec === 2, 'joins segs + ms→sec');
ok(l3.every((l, i) => l.index === i), 'reindexes after drop');
ok(T.parseJson3('nonsense').length === 0, 'garbage → []');

// ── timedtext xml fallback ──
console.log('\n══ parseTimedtextXml ══');
const xml = '<transcript><text start="1.4" dur="2">効く&#38;<b>利く</b></text><text start="5" dur="1">世界&#39;s</text></transcript>';
const lx = T.parseTimedtextXml(xml);
ok(lx.length === 2 && lx[0].tStartSec === 1, 'parses start + rounds');
ok(lx[0].text === '効く&利く', 'strips tags + decodes entities', `(${lx[0].text})`);
ok(lx[1].text === "世界's", 'decodes &#39;');

// ── player-response track extraction + pick ──
console.log('\n══ captionTracks + pickTrack ══');
const pr = { playabilityStatus: { status: 'OK' }, videoDetails: { title: 'X 動画' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [
  { baseUrl: 'U_ja_asr', languageCode: 'ja', kind: 'asr', name: { simpleText: '日本語 (自動)' } },
  { baseUrl: 'U_ja', languageCode: 'ja', name: { simpleText: '日本語' } },
  { baseUrl: 'U_en', languageCode: 'en' },
] } } };
const tracks = T.extractCaptionTracks(pr);
ok(tracks.length === 3, 'extracts all tracks');
ok(T.extractTitle(pr) === 'X 動画' && T.playabilityStatus(pr) === 'OK', 'title + status');
ok(T.pickTrack(tracks, { langPref: ['ja'], preferManual: true }).baseUrl === 'U_ja', 'prefers manual ja');
ok(T.pickTrack(tracks, { langPref: ['ja'], preferManual: false }).baseUrl === 'U_ja_asr', 'asr first when !preferManual');
ok(T.pickTrack(tracks, { langPref: ['fr'], preferManual: true }).baseUrl === 'U_ja', 'no pref lang → first manual');
ok(T.extractCaptionTracks({}) .length === 0 && T.pickTrack([], { langPref: ['ja'], preferManual: true }) === null, 'no captions → []/null');
ok(T.extractPlayerResponse('x=ytInitialPlayerResponse = {"a":1}; var y') ?.a === 1, 'extractPlayerResponse from html');

// ── assembly (round-trips through parseTranscriptLines) ──
console.log('\n══ assembly ══');
const t = { videoId: 'Zdfhde6iasg', title: '言語学ラジオ: 早解き', url: 'https://youtu.be/Zdfhde6iasg', lang: 'ja', source: 'ytdlp', fetchedAt: 1751700000000, lines: [
  { index: 0, tStartSec: 8, text: 'イエイいいね' }, { index: 1, tStartSec: 3670, text: '概要欄にリンク' } ] };
const file = A.renderTranscriptFile(t);
ok(/\nvideo: https:\/\/youtu\.be\/Zdfhde6iasg\n/.test(file), 'file has video: frontmatter (lights up reconcile/cards/audio)');
ok(/title: "言語学ラジオ: 早解き"/.test(file), 'quotes colon-bearing title');
ok(file.includes('[00:08] イエイいいね') && file.includes('[1:01:10] 概要欄にリンク'), 'stamps MM:SS and H:MM:SS');
ok(A.transcriptFileBaseName(t) === '言語学ラジオ 早解き (Zdfhde6iasg)', 'base name sanitized + id', `(${A.transcriptFileBaseName(t)})`);
const d1 = A.upsertVideoSection('# 2026-06-28\n', t);
const d2 = A.upsertVideoSection(d1.md, t);
ok(d1.changed && d1.md.includes('%% yt:Zdfhde6iasg %%'), 'section inserted with marker');
ok(!d2.changed && d2.md === d1.md, 'section idempotent (frozen, invariant #4)');

// verify the written file round-trips through the pipeline parser
const P = await imp('pipeline.ts');
const back = P.parseTranscriptLines(file);
ok(back.length === 2 && back[0].tStartSec === 8 && back[1].tStartSec === 3670, 'round-trips through parseTranscriptLines', `(${back.length})`);

// ── history parsers ──
console.log('\n══ yt-history ══');
const takeout = JSON.stringify([
  { header: 'YouTube', title: 'Watched 言語学ラジオ', titleUrl: 'https://www.youtube.com/watch?v=Zdfhde6iasg', time: '2026-06-28T10:00:00Z' },
  { header: 'YouTube', title: 'Watched ad', titleUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', time: '2026-06-27T10:00:00Z', details: [{ name: 'From Google Ads' }] },
  { header: 'YouTube', title: 'Watched removed' },                                   // no url
  { header: 'YouTube', title: 'Watched 言語学ラジオ (again)', titleUrl: 'https://youtu.be/Zdfhde6iasg', time: '2026-06-29T10:00:00Z' }, // dup, newer
]);
const hj = H.parseWatchHistoryJson(takeout);
ok(hj.length === 1 && hj[0].id === 'Zdfhde6iasg', 'json: dedupes, drops ad/removed', `(${JSON.stringify(hj.map(v=>v.id))})`);
ok(hj[0].watchedAt === Date.parse('2026-06-29T10:00:00Z'), 'json: keeps most-recent watch');
ok(hj[0].title === '言語学ラジオ (again)', 'json: strips "Watched " prefix');
const hh = H.parseWatchHistoryHtml('<a href="https://www.youtube.com/watch?v=Zdfhde6iasg">言語学ラジオ</a><br>Jun 28, 2026, 7:00:00 PM JST');
ok(hh.length === 1 && hh[0].id === 'Zdfhde6iasg' && hh[0].title === '言語学ラジオ', 'html: extracts id + title');
const hp = H.parsePastedVideos('https://youtu.be/Zdfhde6iasg?si=x  dQw4w9WgXcQ\nhttps://www.youtube.com/watch?v=jNQXAC9IVRw');
ok(hp.length === 3, 'paste: 3 mixed forms', `(${hp.length})`);
ok(H.parseHistory(takeout).source === 'takeout-json' && H.parseHistory('dQw4w9WgXcQ').source === 'paste', 'auto-detect source');
const filtered = H.filterByRange(hj.concat([{ id: 'old', title: '', url: '', watchedAt: Date.parse('2020-01-01Z') }]), { since: Date.parse('2026-06-01Z'), until: Date.parse('2026-07-01Z') });
ok(filtered.length === 1 && filtered[0].id === 'Zdfhde6iasg', 'range filter drops out-of-range');

// ── NETWORK-gated: REAL yt-dlp fetch end-to-end ──
console.log('\n══ live yt-dlp fetch (network; auto-skip if tools absent) ══');
const ytdlp = join(links, 'yt-dlp.exe');
if (existsSync(ytdlp)) {
  // Same persistent cookie jar as the plugin (anonymous fetches bot-wall intermittently).
  const PLUGIN_DIR = 'C:/Users/silas/Documents/Obsidian Vault/.obsidian/plugins/jp-collocations';
  let cookieHeader;
  try {
    const { readFileSync } = await import('node:fs');
    cookieHeader = JSON.parse(readFileSync(join(PLUGIN_DIR, 'data.json'), 'utf8'))?.ytHistory?.cookie || undefined;
  } catch { /* anonymous */ }
  const cfg = { enabled: true, ytdlpPath: ytdlp, jsRuntime: '', tmpDirAbs: tmpdir(),
    cookieHeader, cookieJarAbs: cookieHeader ? join(PLUGIN_DIR, '_yt_cookies.txt') : undefined };
  const r = await T.fetchViaYtdlp(cfg, ['ja'], 'Zdfhde6iasg');
  ok(r.lines.length > 100, 'fetchViaYtdlp → real ja lines', `(${r.lines.length}${r.error ? ', ' + r.error : ''})`);
  ok(r.lines.some((l) => /[ぁ-んァ-ン一-龯]/.test(l.text)), 'lines contain japanese');
  const adapter = new T.YouTubeTranscriptAdapter(null, T.DEFAULT_TRANSCRIPT_CONFIG, cfg);
  const tr = await adapter.fetch('Zdfhde6iasg');
  ok(tr && tr.source === 'ytdlp' && tr.lines.length > 100, 'adapter.fetch → Transcript');
} else {
  console.log('  … skipped (yt-dlp not installed)');
}

console.log(`\n${fail ? '✗' : '✓'} transcript golden: ${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
