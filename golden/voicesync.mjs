/**
 * golden/voicesync.mjs — the speech-enrichment layer (voice-lab).
 *
 * Pure parts always run against REAL captured fixtures (whisper JSON from the
 * user's actual clip, including the model's hallucinated speaker-name labels):
 * token parsing + label stripping, diarization-stdout parsing, and the merge
 * rules (shortest-turn-wins on overlap, backchannel pills, segment breaking).
 *
 * LIVE leg (whisper + sherpa on fixtures/voicesync.wav) runs only when the
 * speech tools are installed — skipped honestly otherwise.
 *
 * Run:  node golden/voicesync.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
globalThis.require = createRequire(import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (p) => import(pathToFileURL(join(HERE, '..', 'src', 'notes', p)).href);
const V = await load('voice-lab.ts');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('══ whisper segment parsing (REAL fixture incl. hallucinated labels) ══');
const wjson = readFileSync(join(HERE, 'fixtures', 'voicesync-whisper.json'), 'utf8');
const segs = V.parseWhisperSegments(wjson);
check('segments parsed', segs.length >= 8, `got ${segs.length}`);
const joined = segs.map((s) => s.text).join('');
check('hallucinated 「樋口:」「ヤンヤン:」 labels stripped', !joined.includes('樋口') && !joined.includes('ヤンヤン'), joined.slice(0, 80));
check('no mojibake debris', !joined.includes('�'));
check('real speech kept', joined.includes('自分が価値を生んでいる実感'));
const tokens = V.charTokens(segs);
check('char tokens interpolated inside segments', tokens.length > 150 && tokens.every((t) => t.t1 > t.t0));
check('char timing monotone within a segment', tokens[1].t0 >= tokens[0].t0);
check('multibyte chars intact (whole-char units)', tokens.every((t) => [...t.text].length === 1 && t.text !== '�'));
check('lexical boundaries marked (one per whisper segment)', tokens.filter((t) => t.segStart).length === segs.length);

console.log('══ lexical-boundary display segmentation (seamless-handover fix) ══');
{
  // B→C handover with NO pause and the SAME diarized speaker (the exact case
  // no local embedding model can hear) — the whisper boundary must still cut.
  const toks = [
    { t0: 0.0, t1: 0.5, text: 'かな', spk: 'speaker_00', segStart: true },
    { t0: 0.5, t1: 1.0, text: 'り割り切れる', spk: 'speaker_00' },
    { t0: 1.0, t1: 1.5, text: 'だから', spk: 'speaker_00', segStart: true },   // ← new clause, same spk, zero gap
    { t0: 1.5, t1: 2.0, text: '世の層が', spk: 'speaker_00' },
  ];
  const segs2 = V.rebuildSegments(toks);
  check('display segment breaks at the lexical boundary', segs2.length === 2,
    `got ${segs2.length}: ${segs2.map((s) => s.text).join(' | ')}`);
  check('so one-click reattribution can fix the handover', segs2[1].text === 'だから世の層が');
  // manual split persists: reassign tail + segStart flag → rebuild keeps the cut
  for (let k = 2; k < 4; k++) toks[k].spk = 'speaker_05';
  const segs3 = V.rebuildSegments(toks);
  check('after reassign, tail is its own speaker segment', segs3.length === 2 && segs3[1].spk === 'speaker_05');
}

console.log('══ diarization stdout parsing ══');
const diarOut = ['Started', '0.031 -- 33.967 speaker_00', '2.427 -- 2.984 speaker_01', '26.710 -- 28.145 speaker_01', 'junk line'].join('\n');
const turns = V.parseDiarTurns(diarOut);
check('turns parsed + sorted', turns.length === 3 && turns[0].spk === 'speaker_00' && turns[1].t0 === 2.427);

console.log('══ merge rules ══');
{
  const toks = [
    { t0: 1.0, t1: 1.4, text: 'そこ' },
    { t0: 2.5, t1: 2.9, text: 'うん' },     // inside BOTH turns → shortest (01) wins + overlap flag
    { t0: 5.0, t1: 5.5, text: 'それで' },
    { t0: 9.0, t1: 9.4, text: '次に' },      // >0.8s gap → new segment even for same speaker
  ];
  const trns = [
    { t0: 0.0, t1: 10.0, spk: 'speaker_00' },
    { t0: 2.4, t1: 3.0, spk: 'speaker_01' },
    { t0: 7.0, t1: 7.5, spk: 'speaker_01' },  // token-less → backchannel pill material
  ];
  const d = V.mergeVoiceSync(toks, trns, 'clip_x.mp3', 10);
  check('overlap token → SHORTEST active turn', d.tokens[1].spk === 'speaker_01' && d.tokens[1].overlap === true);
  check('non-overlap tokens → main speaker', d.tokens[0].spk === 'speaker_00' && d.tokens[2].spk === 'speaker_00');
  check('segments break on speaker change AND >0.8s gaps', d.segments.length === 4,
    `got ${d.segments.length}: ${d.segments.map((s) => s.spk + ':' + s.text).join(' | ')}`);
  check('token-less turn survives for pill rendering', d.turns.some((t) => t.t0 === 7.0));
  check('sidecar name', V.voiceSyncSidecarName('clip_x.mp3') === 'clip_x.mp3.voicesync.json');
}

console.log('══ §23.4-3 diarization tier: speaker-lettered transcript lines ══');
{
  const P = await load('pipeline.ts');
  const trns = [
    { t0: 0.0, t1: 10.0, spk: 'speaker_01' },   // first VOICE heard → A (cluster ids don't decide)
    { t0: 10.5, t1: 14.0, spk: 'speaker_00' },  // second voice → B
    { t0: 12.0, t1: 12.6, spk: 'speaker_01' },
  ];
  const L = V.lettersForTurns(trns);
  check('letters follow first appearance, not cluster id', L['speaker_01'] === 'A' && L['speaker_00'] === 'B', JSON.stringify(L));
  check('nested interjection: short span goes to the interjector (IoU)',
    V.speakerForSpan(trns, 11.9, 12.5) === 'speaker_01');
  check('long span stays with the floor-holder despite the interjection',
    V.speakerForSpan(trns, 10.6, 14.0) === 'speaker_00');
  check('span outside all turns → nearest within 2s', V.speakerForSpan(trns, 14.5, 15.0) === 'speaker_00');
  check('span far from any turn → null (never invent a voice)', V.speakerForSpan(trns, 30, 31) === null);
  const segs3 = [
    { t0: 0.2, t1: 4.0, text: 'フランス革命がないと今の暮らし全然違います。' },
    { t0: 10.6, t1: 12.0, text: 'うん。そこまで言う。' },
    { t0: 30.0, t1: 31.0, text: '遠い沈黙のあとの声。' },
  ];
  const lines = V.speakerStampLines(segs3, trns);
  check('lines carry [HH:MM:SS] letter: text', lines[0] === '[00:00:00] A: フランス革命がないと今の暮らし全然違います。', lines[0]);
  check('second voice lettered B', lines[1].includes(' B: うん。'));
  check('unattributable segment stays unlettered', lines[2] === '[00:00:30] 遠い沈黙のあとの声。', lines[2]);
  check('enrolled names win over letters', V.speakerStampLines(segs3, trns, { speaker_01: '堀元' })[0].includes(' 堀元: '));
  // the round trip: 談話モード reads the letters back as layer-1 truth
  const parsed = P.parseTranscriptLines(lines.join('\n'));
  check('parseTranscriptLines strips the letter into .speaker', parsed[0].speaker === 'A' && parsed[1].speaker === 'B');
  check('parsed text is clean speech (no letter prefix)', parsed[0].text.startsWith('フランス革命') && parsed[1].text === 'うん。そこまで言う。');
  check('unlettered line has no speaker', parsed[2].speaker === undefined);
  check('letters beyond H are content, not speakers',
    P.parseTranscriptLines('[00:00:05] I: の話ではない')[0]?.speaker === undefined);
  check('a real sentence starting with a colon-word is NOT eaten',
    P.parseTranscriptLines('[00:00:05] それ: 違う')[0]?.text === 'それ: 違う');
}

console.log('══ voice enrollment (name clusters via reference spans) ══');
{
  // [ref堀元 0–8 ‖ 1s ‖ clip] shape — exactly the verified concat layout
  const turns = [
    { t0: 0.0, t1: 8.1, spk: 'speaker_00' },     // owns the ref span → 堀元
    { t0: 2.9, t1: 3.3, spk: 'speaker_01' },     // stray blip inside ref — must NOT steal the name
    { t0: 9.0, t1: 39.0, spk: 'speaker_00' },    // same voice in the clip
    { t0: 13.6, t1: 14.0, spk: 'speaker_02' },   // the other host
  ];
  const r = V.nameTurnsByRefs(turns, [{ name: '堀元', t0: 0, t1: 8 }], 9.0);
  check('ref cluster named (majority owner)', r.names['speaker_00'] === '堀元');
  check('stray blip does not steal the name', r.names['speaker_01'] === undefined);
  check('clip turns shifted to clip time', r.turns[0].t0 === 0 && Math.abs(r.turns[0].t1 - 30) < 0.01);
  check('ref-only turns dropped from clip', r.turns.every((t) => t.t1 > 0) && r.turns.length === 2);
}

console.log('══ LIVE (gated on installed speech tools) ══');
const tools = V.detectSpeechTools('');
if (tools.ready && existsSync(join(HERE, 'fixtures', 'voicesync.wav'))) {
  // run the real engines through enrichClip on the fixture wav (already 16k
  // mono — ffmpeg conversion is a no-op re-encode)
  const { tmpdir } = await import('node:os');
  const det = (await load('audio-extractor.ts')).detectTools();
  const r = await V.enrichClip(tools, det.ffmpeg, join(HERE, 'fixtures', 'voicesync.wav'), 'voicesync.wav', tmpdir());
  check('live enrichClip produces data', !!r.data, r.error);
  if (r.data) {
    check('live: tokens + turns + segments', r.data.tokens.length > 100 && r.data.turns.length >= 2 && r.data.segments.length >= 1,
      `tokens=${r.data.tokens.length} turns=${r.data.turns.length} segments=${r.data.segments.length}`);
    check('live: multiple speakers detected', new Set(r.data.turns.map((t) => t.spk)).size >= 2);
    console.log(`  (live: ${r.data.tokens.length} tokens, ${r.data.turns.length} turns, ${r.data.segments.length} segments)`);
  }
} else {
  console.log(`  ⏭ SKIPPED — speech tools ${tools.ready ? 'ok' : 'not installed'} / fixture wav ${existsSync(join(HERE, 'fixtures', 'voicesync.wav')) ? 'ok' : 'missing'}`);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} voicesync: ${pass}/${pass + fail} checks passed`);
process.exitCode = fail === 0 ? 0 : 1;
