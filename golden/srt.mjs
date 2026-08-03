/**
 * golden/srt.mjs — subtitle files → the standard transcript note.
 *
 * `srt.ts` claimed "golden-tested in golden/srt.mjs" and this file did not
 * exist. It matters more now than it did: the Plex pipeline reads its transcript
 * out of a subtitle stream, so every episode of your own media enters the plugin
 * through this parser. If it drops cues, the whole chain downstream — reconcile,
 * sweep, 談話モード, ⚡ — is working from a transcript with holes in it and
 * nothing says so.
 *
 * The case that actually bit: ASS. Anime subtitles are ASS, on jimaku and inside
 * the MKVs Plex serves, and `parseSrt` looks for `-->` — so it returned ZERO
 * cues and the import read as "it did nothing".
 *
 *   node golden/srt.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
const { transpileModule } = ts;

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src', 'notes', 'srt.ts');
const js = transpileModule(readFileSync(SRC, 'utf8'), {
  compilerOptions: { module: 'ESNext', target: 'ES2022' },
}).outputText;
const S = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => {
  n++;
  if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg}`);
};

console.log('══ SRT ══');
{
  const srt = [
    '1', '00:00:01,500 --> 00:00:03,200', 'こんにちは。', '',
    '2', '00:00:04,000 --> 00:00:06,000', '<i>元気</i>ですか？', '',
    '3', '00:00:07,000 --> 00:00:08,000', '元気ですか？', '',   // == cue 2 once stripped
    '4', '01:23:45,670 --> 01:23:47,000', '遅い時間だ。', '',
  ].join('\n');
  const cues = S.parseSrt(srt);
  ok(cues.length === 3, 'three cues survive', `(${cues.length})`);
  ok(cues[0].startSec === 1, 'start seconds from the timestamp', `(${cues[0].startSec})`);
  ok(cues[1].text === '元気ですか？', 'styling tags stripped', `(${cues[1].text})`);
  ok(cues.length === 3,
    'dedup runs AFTER stripping — <i>元気</i>ですか？ and 元気ですか？ are one line');
  ok(cues[2].startSec === 5025, 'hours are read', `(${cues[2].startSec})`);
}

console.log('\n══ WebVTT ══');
{
  const vtt = ['WEBVTT', '', '00:00:02.000 --> 00:00:04.000', 'テスト字幕', ''].join('\n');
  const cues = S.parseSubtitles(vtt);
  ok(cues.length === 1 && cues[0].startSec === 2, 'WebVTT dot-millis parse', `(${cues.length})`);
}

console.log('\n══ rolled-up duplicates ══');
{
  const srt = [
    '1', '00:00:01,000 --> 00:00:02,000', 'そうですね', '',
    '2', '00:00:02,000 --> 00:00:03,000', 'そうですね', '',
    '3', '00:00:03,000 --> 00:00:04,000', 'はい', '',
  ].join('\n');
  ok(S.parseSrt(srt).length === 2, 'a repeated cue is not repeated in the transcript');
}

// ── ASS/SSA: what anime subtitles actually are ──────────────────────────────
const ASS = [
  '[Script Info]',
  'Title: Example',
  'ScriptType: v4.00+',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour',
  'Style: Default,Arial,20,&H00FFFFFF',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  'Dialogue: 0,0:00:01.50,0:00:03.20,Default,,0,0,0,,こんにちは。',
  'Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,{\\an8}看板の文字',
  'Comment: 0,0:00:06.50,0:00:07.00,Default,,0,0,0,,これは訳注',
  'Dialogue: 0,0:00:09.00,0:00:11.00,Default,,0,0,0,,一行目\\N二行目',
  'Dialogue: 0,0:00:12.00,0:00:14.00,Sign,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}',
  'Dialogue: 0,0:00:15.00,0:00:17.00,Default,,0,0,0,,Yes, I do.',
  'Dialogue: 0,1:23:45.67,1:23:47.00,Default,,0,0,0,,遅い時間だ。',
  'Dialogue: 0,0:00:08.00,0:00:08.90,Default,,0,0,0,,順番が前後している',
].join('\n');

console.log('\n══ ASS/SSA — the format that returned ZERO cues ══');
{
  ok(S.parseSrt(ASS).length === 0, 'parseSrt genuinely cannot read ASS (why this exists)');
  const cues = S.parseAss(ASS);
  const texts = cues.map((c) => c.text);

  // 7 Dialogue events, one of which is a drawing; the Comment is not an event.
  ok(cues.length === 6, 'six speakable cues survive', `(${cues.length}: ${texts.join(' | ')})`);
  ok(cues[0].startSec === 1, 'ASS H:MM:SS.cc times parse', `(${cues[0].startSec})`);
  ok(texts.includes('看板の文字'), 'override blocks {\\an8} are stripped');
  ok(!texts.some((t) => t.includes('訳注')), 'Comment: events are NOT dialogue');
  ok(texts.includes('一行目 二行目'), '\\N line breaks become a space');
  ok(!texts.some((t) => /m 0 0 l/.test(t)),
    'a drawing command is a SIGN, not a line of speech — dropped');
  ok(texts.includes('Yes, I do.'),
    'text containing a comma survives (Text is the remainder, not a field)');
  ok(cues.some((c) => c.startSec === 5025), 'unpadded ASS hours parse', '(1:23:45)');
  // declared LAST in the file at 0:00:08, must land before the 0:00:09 line
  ok(cues[2].text === '順番が前後している' && cues[3].text === '一行目 二行目',
    'events are sorted by time, not by file order', `(${cues[2].text} → ${cues[3].text})`);
}

console.log('\n══ format detection ══');
{
  ok(S.parseSubtitles(ASS).length === 6, 'parseSubtitles routes ASS to the ASS parser');
  ok(S.parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\nはい\n').length === 1,
    'and SRT to the SRT parser');
  ok(S.parseSubtitles('').length === 0, 'empty input is [] not a crash');
  ok(S.parseSubtitles('これはただの文章です').length === 0, 'prose is not a subtitle file');
}

console.log('\n══ a Format: line that reorders fields ══');
{
  // The order is declared per file. Hard-coding parts[9] would read the wrong
  // column here and put a margin number into the transcript.
  const odd = [
    '[Events]',
    'Format: Start, End, Style, Text',
    'Dialogue: 0:00:05.00,0:00:06.00,Default,本文です',
  ].join('\n');
  const cues = S.parseAss(odd);
  ok(cues.length === 1 && cues[0].text === '本文です' && cues[0].startSec === 5,
    'the declared field order is honoured', `(${JSON.stringify(cues)})`);
}

console.log('\n══ the transcript note ══');
{
  const { content, cueCount } = S.srtToNote({
    srt: ASS, title: '進撃の巨人 S1E01', sourceName: '進撃の巨人',
  });
  ok(cueCount === 6, 'ASS reaches srtToNote through parseSubtitles', `(${cueCount})`);
  ok(content.includes('source: tv'), 'frontmatter marks the medium');
  ok(content.includes('title: "進撃の巨人 S1E01"'), 'episode title');
  ok(content.includes('show: "進撃の巨人"'), 'show name, so a capture carries the scene');
  ok(content.includes('sub_source: jimaku'), 'defaults to the hand-sourced origin');
  ok(/\[00:00:01\] こんにちは。/.test(content), 'lines are [HH:MM:SS] text');

  const plex = S.srtToNote({
    srt: ASS, title: 'E01', subSource: 'plex',
    plex: { ratingKey: '12345', partKey: '/library/parts/9/file.mkv', lang: 'ja' },
  });
  ok(plex.content.includes('sub_source: plex'), 'a Plex-sourced note says so');
  ok(plex.content.includes('plex_rating_key: "12345"'),
    'and carries the episode id, so the note can find its media again later');
  ok(plex.content.includes('plex_part_key: "/library/parts/9/file.mkv"'),
    'and the part, so a clip can be cut without a live session');
  ok(!content.includes('plex_rating_key'), 'a hand-imported note carries no Plex keys');
}

// ── §25.4b: a jimaku-sourced note is the SAME note, plus its provenance ──────
{
  const jm = S.srtToNote({
    srt: ASS,
    title: '相棒 S21E04',
    sourceName: '相棒',
    subSource: 'jimaku',
    episode: { season: 21, episode: 4 },
    plex: { ratingKey: '55123', partKey: '/library/parts/1/f.mkv' },
    jimaku: { entryId: 771, fileName: '[G] Aibou - 04.srt' },
    subOffsetSec: 0,
  });
  ok(jm.content.includes('sub_source: jimaku'), 'the source of the text is recorded');
  ok(jm.content.includes('jimaku_entry: 771') && jm.content.includes('jimaku_file: "[G] Aibou - 04.srt"'),
    'WHICH release it was is recorded — the one thing about it that can be wrong');
  ok(jm.content.includes('plex_rating_key: "55123"') && jm.content.includes('plex_part_key:'),
    'and it still knows its Plex media, so 🎬 clips and Plex同期 keep working');
  ok(jm.content.includes('season: 21') && jm.content.includes('episode: 4'),
    'the episode number survives into the note');
  ok(jm.content.includes('sub_offset_sec: 0'),
    'the offset field is PRESENT at zero — a field you can see is a field you can fix');

  const embedded = S.srtToNote({ srt: ASS, title: "x", subSource: "plex" });
  ok(!embedded.content.includes('sub_offset_sec'),
    'a muxed subtitle needs no offset field: it cannot disagree with its own video');
  ok(!embedded.content.includes('jimaku_'), 'and carries no jimaku provenance');
}

console.log(`\n${fail ? '✗' : '✓'} srt: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
