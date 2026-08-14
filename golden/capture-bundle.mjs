/**
 * golden/capture-bundle.mjs — canvas marks → the layered bundle → records.
 *
 * The properties:
 *   - the SAME canvas gestures that fed the flat path derive the lattice:
 *     strike=slots, span=chunk, tap-tap parts chain into links;
 *   - the new mark fields (glue / pivots / multi-token links) flow through;
 *   - records land in store conventions (○○ frames, parts for links,
 *     lemma/halo), share ONE bundleId, and the edges ride the L0 record only;
 *   - span+strike derives ONE chunk-with-holes, not a chunk plus a phantom
 *     whole-text frame.
 *
 * Run:  node golden/capture-bundle.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (p) => pathToFileURL(join(HERE, '..', 'src', p)).href;
const T = await import(src('notes/token-canvas.ts'));
const C = await import(src('notes/capture-bundle.ts'));

let n = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  n++;
  if (cond) console.log(`  ✓ ${name}`);
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const probeOf = (words) => (s) => words.includes(s);

/* ── F1: こんな人間になる予定ではなかった via canvas marks ─────────────── */
{
  const text = 'こんな人間になる予定ではなかった';
  const tokens = T.tokenizeForCanvas(text, probeOf(['こんな', '人間', 'になる', '予定', 'ではなかった']));
  ok(tokens.map((t) => t.text).join('|') === 'こんな|人間|になる|予定|ではなかった',
    'probe-backed tokenization lands the analysis units', tokens.map((t) => t.text).join('|'));

  const marks = {
    ...T.emptyMarks(),
    struck: [0, 1],                                        // こんな人間 → one slot run
    glue: [2],                                             // になる
    pivots: [{ index: 0, mates: ['そんな', 'あんな'] }],    // こんな
  };
  const b = C.bundleFromCanvas(text, tokens, marks);
  ok(b.layers.length === 3, 'strike+glue derive whole/frame/core', String(b.layers.length));

  const recs = C.bundleRecords(b);
  ok(recs.length === 3 && recs[0].cls === 'serifu' && recs[0].note === text,
    'record 0 is the whole thought');
  ok(recs[1].payload.frame === '○○になる予定ではなかった',
    'the frame record speaks the store\'s ○○ convention', recs[1].payload.frame);
  ok(recs[2].payload.frame === '○○予定ではなかった' && recs[2].payload.glueParts?.[0] === 'になる',
    'the core record strips the glue and remembers it', JSON.stringify(recs[2].payload));
  const ids = new Set(recs.map((r) => r.payload.bundleId));
  ok(ids.size === 1 && [...ids][0]?.startsWith('b_'),
    'one bundleId shared by every layer record');
  ok(!!recs[0].payload.bundleEdges?.length && !recs[1].payload.bundleEdges && !recs[2].payload.bundleEdges,
    'edges ride the L0 record ONCE');
}

/* ── F2: においては問題ないと考えている — chunk + multi-token-pole link ── */
{
  const text = 'においては問題ないと考えている';
  const tokens = T.tokenizeForCanvas(text, probeOf(['においては', '問題ない', 'と', '考えている']));
  const marks = {
    ...T.emptyMarks(),
    span: [0, 1],                                          // においては問題ない (chunk)
    links: [{ a: [0, 0], b: [2, 3] }],                     // においては ↔ と考えている
  };
  const b = C.bundleFromCanvas(text, tokens, marks);
  const recs = C.bundleRecords(b);
  const chunk = recs.find((r) => r.payload.frame === 'においては問題ない');
  const link = recs.find((r) => r.payload.parts);
  ok(!!chunk, 'the span carve records the said-whole chunk');
  ok(JSON.stringify(link?.payload.parts) === JSON.stringify(['においては', 'と考えている']),
    'the link record carries MULTI-token poles', JSON.stringify(link?.payload.parts));
  ok(recs[0].payload.bundleEdges?.some((e) => e.kind === 'shares-token'),
    'the においては membrane survives into the stored edges');
}

/* ── F3: tap-tap parts still chain into a link (fallback path) ────────── */
{
  const text = 'においては問題ないと考えている';
  const tokens = T.tokenizeForCanvas(text, probeOf(['においては', '問題ない', 'と', '考えている']));
  const marks = { ...T.emptyMarks(), parts: [1, 3] };      // 問題ない + 考えている
  const recs = C.bundleRecords(C.bundleFromCanvas(text, tokens, marks));
  const link = recs.find((r) => r.payload.parts);
  ok(JSON.stringify(link?.payload.parts) === JSON.stringify(['問題ない', '考えている']),
    'parts (≥2) chain pairwise when no pole-links are drawn');
}

/* ── F4: ◯ + halo → the lemma record (the hand\'s call, recorded) ─────── */
{
  const text = '程々にという感じ';
  const tokens = T.tokenizeForCanvas(text, probeOf(['程々に', 'という', '感じ']));
  const marks = { ...T.emptyMarks(), circled: 0, halo: [0, 1] };
  const recs = C.bundleRecords(C.bundleFromCanvas(text, tokens, marks));
  const lemma = recs.find((r) => r.cls === 'rhet_collocation');
  ok(lemma?.payload.lemma === '程々に' && lemma.payload.halo === '程々にという',
    '◯ records lemma + halo text verbatim', JSON.stringify(lemma?.payload));
}

/* ── F5: span+strike = ONE chunk with holes, no phantom whole-text frame ── */
{
  const text = '口にすると良くない';
  const tokens = T.tokenizeForCanvas(text, probeOf(['口にすると', '良くない']));
  const marks = { ...T.emptyMarks(), span: [0, 1], struck: [1] };
  const b = C.bundleFromCanvas(text, tokens, marks);
  ok(b.layers.length === 2, 'whole + chunk only — the strike belongs to its chunk', String(b.layers.length));
  const recs = C.bundleRecords(b);
  ok(recs[1].payload.frame === '口にすると○○',
    'the chunk carries its own hole', recs[1].payload.frame);
}

console.log(`\n${fail ? '✗' : '✓'} capture-bundle: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
