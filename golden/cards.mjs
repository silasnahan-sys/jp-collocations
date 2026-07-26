/**
 * golden/cards.mjs — timestamp-anchoring regression (DESIGN §11).
 *
 * Reconciles the frozen cases, builds anchored cards, and asserts the anchoring
 * invariants: every card carries a transcript block-link `[[file#^id]]`, a
 * YouTube deep-link at the located second, a stable block-id-derived card id
 * (idempotent), and needs-review spans are excluded by default.
 *
 * Run:  node --experimental-strip-types golden/cards.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (p) => import(pathToFileURL(join(HERE, '..', 'src', 'notes', p)).href);
const { reconcile, parseTranscriptLines } = await load('pipeline.ts');
const { blockIdFor } = await load('annotate.ts');
const { buildReconCards } = await load('cards.ts');
const { parseYouTubeId, youtubeDeepLink } = await load('audio-provider.ts');

const suite = JSON.parse(readFileSync(join(HERE, '001.cases.json'), 'utf8'));
const md = readFileSync(join(HERE, suite.transcript), 'utf8');
const lines = parseTranscriptLines(md);
const readings = JSON.parse(readFileSync(join(HERE, 'readings.fixture.json'), 'utf8'));
const readingOf = (w) => (Object.prototype.hasOwnProperty.call(readings, w) ? readings[w] : null);

const VIDEO = 'dQw4w9WgXcQ';
const ANCHORED = 'notes/samplenotes-reconciled.md';

let fail = 0, n = 0;
const check = (cond, msg) => { n++; if (!cond) { fail++; console.log(`  ✗ ${msg}`); } };

// videoId parsing
check(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ?t=42') === VIDEO, 'parse youtu.be id');
check(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&x=1') === VIDEO, 'parse watch?v= id');
check(parseYouTubeId(VIDEO) === VIDEO, 'parse bare id');
check(parseYouTubeId('not a url') === null, 'reject non-id');
check(youtubeDeepLink(VIDEO, 754) === 'https://youtu.be/dQw4w9WgXcQ?t=754', 'deep-link at second');

const results = reconcile(suite.cases.map((c) => c.note), lines, readingOf);
const auto = results.filter((r) => r.status === 'auto');

const cards = buildReconCards(results, ANCHORED, blockIdFor, {
  videoId: VIDEO,
  transcriptRef: '[[testtranscript]]',
});

console.log(`\n══ cards ══  ${results.length} results → ${cards.length} cards (auto=${auto.length})`);

// needs-review excluded by default
check(cards.length === auto.length, `card count ${cards.length} == auto count ${auto.length} (needs-review excluded)`);

for (const c of cards) {
  const r = results.find((x) => blockIdFor(x) === c.blockId);
  check(!!r, `card ${c.id} maps to a result`);
  // idempotent id derived from block id
  check(c.id === `card-${c.blockId}`, `card id stable: ${c.id}`);
  // transcript block-link anchor present in the back
  check(c.back.includes(`![[${ANCHORED}#^${c.blockId}]]`), `block-link anchor present (${c.blockId})`);
  // YouTube deep-link at the located second
  const expect = youtubeDeepLink(VIDEO, r.tStartSec);
  check(c.back.includes(expect), `deep-link @${r.tStartSec}s present`);
  // front hides the answer behind a blank
  check(c.front.includes('＿'), `front blanks the phrase (${c.blockId})`);
}

// idempotency: same inputs → identical markdown
const again = buildReconCards(results, ANCHORED, blockIdFor, { videoId: VIDEO, transcriptRef: '[[testtranscript]]' });
check(JSON.stringify(cards.map((c) => c.markdown)) === JSON.stringify(again.map((c) => c.markdown)), 'idempotent re-run');

// in-transcript anchoring: embeds target the CLUSTER anchor while card ids stay per-result
const TRANSCRIPT = 'Transcripts/testtranscript.md';
const withAnchor = buildReconCards(results, TRANSCRIPT, blockIdFor, {
  videoId: VIDEO,
  anchorIdOf: () => 'recon-cluster0',
});
check(withAnchor.every((c) => c.back.includes(`![[${TRANSCRIPT}#^recon-cluster0]]`)), 'embed targets the cluster anchor in the transcript');
check(new Set(withAnchor.map((c) => c.id)).size === withAnchor.length, 'card ids stay unique per result under a shared anchor');

// no videoId → block-link only, no youtu.be
const noVid = buildReconCards(results, ANCHORED, blockIdFor, { videoId: null });
check(noVid.every((c) => c.back.includes(`![[${ANCHORED}`)), 'block-link present without videoId');
check(noVid.every((c) => !c.back.includes('youtu.be')), 'no deep-link without videoId (degrade soft)');

// local clip present (auto-regen path) → card embeds ![[clip_<id>_<sec>.mp3]]
const { deepLinkProvider } = await load('audio-provider.ts');
const firstAuto = auto[0];
const clipName = `clip_${VIDEO}_${Math.floor(firstAuto.tStartSec)}.mp3`;
const withClip = buildReconCards(results, ANCHORED, blockIdFor, {
  videoId: VIDEO,
  audio: deepLinkProvider((name) => name === clipName),   // only this one is "downloaded"
});
const clipCard = withClip.find((c) => c.back.includes(clipName));
check(!!clipCard && clipCard.back.includes(`![[${clipName}]]`), `fresh clip embeds ![[${clipName}]]`);
check(withClip.filter((c) => c.back.includes('.mp3]]')).length === 1, 'only the present clip embeds (others deep-link only)');

// ── class-shaped fronts (P4): each 分類 drills its defining skill ──
const { buildReconCard } = await load('cards.ts');
const synth = (note, reconciled) => ({
  note, reconciled, tStartSec: 100,
  best: { startLine: 3, endLine: 3, tStartSec: 100, text: reconciled, score: 0.9 },
  confidence: 0.9, status: 'auto', corrections: [],
  contextBefore: ['相手の直前の発話です'], contextAfter: ['そのあとの発話です'], alternatives: [],
});
const mk = (cls, note, reconciled, extra = {}) =>
  buildReconCard(synth(note, reconciled), 'recon-test1', { anchoredFile: 'T.md', videoId: VIDEO, classOf: () => cls, ...extra });

const sk = mk('skeletal', 'んだったら〜なきゃ', 'んだったら〜なきゃ');
check(sk.front.includes('んだったら') && sk.front.includes('【＿＿＿】') && !sk.front.includes('なきゃ'),
  '🟠 gap-fill: first component shown, mate blanked');
check(sk.back.includes('**んだったら** 〜 **なきゃ**'), '🟠 back bolds both components');

const di = mk('discourse', 'なるほどですね', 'なるほどですね');
check(di.front.includes('相手:') && di.front.includes('どう応じた') && !di.front.includes('なるほどですね'),
  '🔴 responsivity: prior turn is the prompt, response hidden');
check(di.back.includes('続き: そのあとの発話です'), '🔴 back shows the following turn');

const se = mk('serifu', '手先が器用', '手先が器用', {
  audio: deepLinkProvider((name) => name === `clip_${VIDEO}_100.mp3`),
});
check(se.front.includes('🎧') && se.front.includes(`![[clip_${VIDEO}_100.mp3]]`), '🟡 audio-first: clip on the FRONT');
check(!se.front.includes('あなたのメモ') && !se.front.includes('手先が器用'), '🟡 front never reveals the answer');

const ps = mk('phrase_schema', 'というところで納得している', 'というところで納得している');
check(ps.front.includes('型') && !ps.front.includes('というところで納得している'), '💠 型産出: answer hidden, task explicit');
check(ps.front.includes('「と…」'), '💠 soft hint = first char + length');

for (const c of [sk, di, se, ps]) {
  check(c.back.includes('![[T.md#^recon-test1]]'), `anchor footer intact on class card (${c.noteClass})`);
}

console.log(`\n${fail ? '✗' : '✓'} ${n - fail}/${n} anchoring checks pass`);

// show one real card
if (cards.length) {
  console.log('\n── sample card ──\n');
  console.log(cards[0].markdown);
}
process.exit(fail ? 1 : 0);
