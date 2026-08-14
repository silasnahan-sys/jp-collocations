/**
 * golden/analysis-bundle.mjs — one utterance, many cuts.
 *
 * The fixtures are the user's own worked examples (2026-08-14), verbatim.
 * The properties that matter:
 *   - layers are DERIVED from carves, and their classes are entailed
 *     (nothing carved → セリフ; slots → 慣用構文; link → 骨格構文);
 *   - になる-style GLUE yields a core layer whose key generalizes
 *     (～予定ではなかった must catch 行く予定ではなかった);
 *   - においては holds DUAL CITIZENSHIP — chunk and link share the token,
 *     and the membrane is recorded, not lost;
 *   - the 。-crossing link arms BOTH keys (はず(。)～まずは AND はず～まずは);
 *   - 修辞連語 is never entailed — only withLemma creates it (the machine
 *     does not judge 喚起).
 *
 * Run:  node golden/analysis-bundle.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const B = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'analysis-bundle.ts')).href);
const F = await import(pathToFileURL(join(HERE, '..', 'src', 'dictionary', 'frames.ts')).href);

let n = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  n++;
  if (cond) console.log(`  ✓ ${name}`);
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

/* ── F1: こんな人間になる予定ではなかった ─────────────────────────────── */
{
  const text = 'こんな人間になる予定ではなかった';
  const b = B.deriveBundle(text, [
    { kind: 'slot', start: 0, end: 5, contentType: '思' },          // こんな人間
    { kind: 'axis', start: 0, end: 3, mates: ['そんな', 'あんな'] }, // こんな
    { kind: 'glue', start: 5, end: 8 },                             // になる
  ]);

  ok(b.layers.length === 3, 'F1: three layers — whole thought, frame, core');
  const [l0, fr, core] = b.layers;
  ok(l0.cls === 'serifu' && l0.role === 'whole' && l0.notation === text,
    'L0 is the whole thought, セリフ by entailment (capture begins life as the thought)');
  ok(fr.cls === 'phrase_schema' && fr.role === 'frame',
    'slots opened + frame held entails 慣用構文');
  ok(fr.notation.includes('〔思〕'),
    'the slot carries its CONTENT-type (thought-sized, not NP-sized)', fr.notation);
  ok(fr.key === B.keyOf('～になる予定ではなかった'),
    'content-type is display apparatus — the KEY is typeless', fr.key);
  ok(Array.isArray(fr.axes) && fr.axes[0].text === 'こんな' && fr.axes[0].mates.includes('そんな'),
    'the axis (paradigm pivot) is recorded with its mates');
  ok(core.role === 'core' && core.glue?.[0] === 'になる',
    'glue demotion derives the core, and remembers what it demoted');
  ok(core.key === B.keyOf('～予定ではなかった'),
    'the core key strips the glue', core.key);
  ok(F.frameMatches(core.key, '行く予定ではなかった'),
    'THE point: the glue-stripped core catches 行く予定ではなかった');
  ok(!F.frameMatches(core.key, '予定だった'),
    'and does not catch what it should not');
  const fills = F.fillersOf(core.key, '行く予定ではなかった');
  ok(Array.isArray(fills) && fills.includes('行く'),
    'the filler is recoverable (行く) — the frame is a hole, entered by what fills it');
  ok(b.edges.some((e) => e.kind === 'derives' && e.from === 0 && e.to === 1),
    'derivation edge L0→frame exists');
  ok(b.edges.some((e) => e.kind === 'glue' && e.surfaces?.includes('になる')),
    'the glue edge names its surfaces');
  const keys = B.matchKeysOf(b);
  ok(keys.length === 3 && new Set(keys).size === 3 && keys.every(Boolean),
    'one capture arms a FAN of keys — full, frame, core — deduped, no empties');
}

/* ── F2: においては問題ないと考えている ─────────────────────────────── */
{
  const text = 'においては問題ないと考えている';
  const a = [0, 'においては'.length];                       // においては
  const chunkEnd = 'においては問題ない'.length;             // 9
  const bStart = text.indexOf('と考えている');
  const b = B.deriveBundle(text,
    [{ kind: 'range', start: 0, end: chunkEnd }],
    [{ a: [a[0], a[1]], b: [bStart, text.length] }]);

  ok(b.layers.length === 3, 'F2: whole + chunk + link');
  const chunk = b.layers.find((l) => l.role === 'chunk');
  const link = b.layers.find((l) => l.role === 'link');
  ok(chunk?.cls === 'phrase_schema' && chunk.notation === 'においては問題ない',
    'the range carve is the said-whole chunk (the user\'s own 慣用 filing)');
  ok(link?.cls === 'skeletal' && link.key === B.keyOf('においては～と考えている'),
    'the stroke is the 骨格 link — A～B is a frame whose middle is one big slot');
  const mem = B.membranesOf(b);
  ok(mem.length === 1 && mem[0].text === 'においては',
    'においては holds dual citizenship — the membrane is recorded', JSON.stringify(mem));
  ok(F.frameMatches(link.key, 'においては問題ないと考えている'),
    'the link key matches its own source surface');
  ok(F.frameMatches(link.key, 'においては現実的だと考えている'),
    'and matches a different filler between the poles (the link survives)');
}

/* ── F3: the 。-crossing link (the user's はず(。)〜まずは, generated) ── */
{
  const text = '遅くないはず。まずは今月';
  const aS = text.indexOf('はず'); const bS = text.indexOf('まずは');
  const b = B.deriveBundle(text, [], [{ a: [aS, aS + 2], b: [bS, bS + 3] }]);
  const link = b.layers.find((l) => l.role === 'link');
  ok(link.notation === 'はず(。)～まずは',
    'crossing a sentence boundary GENERATES the (。) notation the user hand-typed', link.notation);
  ok(link.keys.length === 2 && link.keys.includes(B.keyOf('はず～まずは')),
    'both keys armed — strict (。) and loose', JSON.stringify(link.keys));
}

/* ── F4: entailment refuses what only the hand can judge ───────────── */
{
  const plain = B.deriveBundle('程々にという感じ');
  ok(plain.layers.length === 1 && plain.layers[0].cls === 'serifu',
    'no carves → only the thought; nothing else is invented');
  ok(!plain.layers.some((l) => l.cls === 'rhet_collocation'),
    '修辞連語 is NEVER entailed — 喚起 is felt, not derived');
  const withL = B.withLemma(plain, [0, 3], '程々にという感じ');
  const lem = withL.layers.find((l) => l.cls === 'rhet_collocation');
  ok(lem?.notation === '程々に' && lem.keys.length === 2,
    'withLemma records the hand\'s judgement, halo key armed alongside');
  ok(withL.edges.some((e) => e.to === withL.layers.length - 1 && e.kind === 'derives'),
    'the lemma layer stays tied to the whole it was heard in');
}

/* ── key space sanity ──────────────────────────────────────────────── */
ok(B.keyOf('〜予定ではなかった') === B.keyOf('～予定ではなかった'),
  'user 〜 and canonical ～ fold to one key (ONE key space, or two products)');

console.log(`\n${fail ? '✗' : '✓'} analysis-bundle: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
