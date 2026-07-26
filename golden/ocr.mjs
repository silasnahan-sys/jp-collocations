/**
 * golden/ocr.mjs — handwriting-OCR stage regression (DESIGN §5, Architecture B).
 *
 * Pure parts always run: request-body shape (model pinned, image block first),
 * response parsing, schema validation (reject malformed), escalation decision,
 * idempotent materialization into the notes file, and the hand-off contract
 * (materialized phrases are exactly what extractNotePhrases feeds the matcher).
 *
 * LIVE part (real Anthropic call) runs ONLY when both are present:
 *   - env ANTHROPIC_API_KEY
 *   - golden/fixtures/handwriting.png  (a real handwritten-page photo)
 * Otherwise it reports SKIP honestly (never fakes a pass).
 *
 * Run:  node golden/ocr.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (p) => import(pathToFileURL(join(HERE, '..', 'src', 'notes', p)).href);
const C = await load('claude-client.ts');
const O = await load('ocr-reconciler.ts');
const { extractNotePhrases } = await load('pipeline.ts');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('══ request body (pinned model, vision blocks) ══');
const body = JSON.parse(C.buildVisionBody({
  apiKey: 'k', model: C.OCR_MODEL_DEFAULT, prompt: O.OCR_PROMPT,
  images: [{ base64: 'AAAA', mediaType: 'image/png' }, { base64: 'BBBB', mediaType: 'image/jpeg' }],
}));
check('model pinned to the Haiku constant', body.model === 'claude-haiku-4-5-20251001');
check('escalation constant is Opus', C.OCR_MODEL_ESCALATION === 'claude-opus-4-8');
check('all image blocks precede the prompt, in order', body.messages[0].content.length === 3 &&
  body.messages[0].content[0].source.data === 'AAAA' && body.messages[0].content[1].source.data === 'BBBB' &&
  body.messages[0].content[2].type === 'text');
check('base64 source shape', body.messages[0].content[0].source.type === 'base64' && body.messages[0].content[0].source.media_type === 'image/png');
check('prompt forbids correction (書かれている通り)', O.OCR_PROMPT.includes('書かれている通り') && O.OCR_PROMPT.includes('訂正'));
check('prompt locks the JSON schema', O.OCR_PROMPT.includes('{"phrases":[{"text":'));
check('prompt explains tiles read top-to-bottom', O.OCR_PROMPT.includes('タイル'));
check('prompt asks per-LINE transcription with bullet flag (merging is OURS)',
  O.OCR_PROMPT.includes('"bullet"') && O.OCR_PROMPT.includes('折り返し'));

console.log('══ deterministic bullet merge ══');
{
  const merged = O.mergeBulletLines({ phrases: [
    { text: 'の原理に委ねたら', confidence: 0.8, bullet: true },
    { text: 'そうなら', confidence: 0.6, bullet: false },          // hanging wrap → same note
    { text: 'んだったら〜', confidence: 0.9, bullet: true },
    { text: 'なきゃ', confidence: 0.9, bullet: false },            // connector junction → gapped join
    { text: '別のメモ', confidence: 0.9, bullet: true },
    { text: '先頭が続きでも前がなければ独立', confidence: 0.9, bullet: false },
  ].slice(0, 5) });
  check('wrap folds into the note above (direct join)', merged.phrases[0].text === 'の原理に委ねたらそうなら');
  check('merged confidence = min of parts', merged.phrases[0].confidence === 0.6);
  check('connector junction joins with 〜', merged.phrases[1].text === 'んだったら〜なきゃ');
  check('bullet lines stay separate', merged.phrases.length === 3 && merged.phrases[2].text === '別のメモ');
  const legacy = O.mergeBulletLines({ phrases: [{ text: 'あ', confidence: 0.9 }, { text: 'い', confidence: 0.9 }] });
  check('missing bullet field defaults to separate items (backward compat)', legacy.phrases.length === 2);
}

console.log('══ planTiles (tall Apple-Notes strips) ══');
{
  const small = O.planTiles(800, 600);
  check('small image → one full tile', small.length === 1 && small[0].w === 800 && small[0].h === 600);
  const strip = O.planTiles(280, 3090);           // the real fixture's shape
  check('280×3090 strip → 3 vertical tiles', strip.length === 3, `got ${strip.length}`);
  check('tiles cover the full height', strip[0].y === 0 && strip[strip.length - 1].y + strip[strip.length - 1].h === 3090);
  check('neighbouring tiles overlap', strip[1].y < strip[0].y + strip[0].h && strip[2].y < strip[1].y + strip[1].h);
  check('every tile fits the useful resolution', strip.every((t) => t.h <= 1400 + 80 && t.w === 280));
  const wide = O.planTiles(3000, 400);
  check('wide image tiles horizontally', wide.length > 1 && wide.every((t) => t.y === 0 && t.h === 400));
  const huge = O.planTiles(300, 100000);
  check('tile count capped (huge input never explodes)', huge.length <= 12);
  check('narrow strip gets 3× magnification', O.tileUpscale(280) === 3);
  check('ordinary page gets no magnification', O.tileUpscale(1200) === 1 && O.tileUpscale(700) === 2);
  check('mid-width scrawl (880px) gets 2× (round, not floor)', O.tileUpscale(880) === 2);
}

console.log('══ response parsing ══');
const ok = C.parseVisionResponse(200, JSON.stringify({ content: [{ type: 'text', text: '{"phrases":[]}' }] }));
check('200 → text extracted', ok.ok && ok.text === '{"phrases":[]}');
const err = C.parseVisionResponse(401, JSON.stringify({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
check('401 → verbatim error surfaced', !err.ok && err.error.includes('authentication_error') && err.error.includes('401'));
const empty = C.parseVisionResponse(200, JSON.stringify({ content: [] }));
check('empty content → honest failure', !empty.ok);

console.log('══ schema validation ══');
const good = O.parseOcrResponse('{"phrases":[{"text":"レバレッジが効く","confidence":0.9},{"text":"頭にある形","confidence":0.4}]}');
check('valid page parses', good && good.phrases.length === 2 && good.phrases[1].confidence === 0.4);
const fenced = O.parseOcrResponse('はい、抽出しました。\n```json\n{"phrases":[{"text":"述語論理"}]}\n```');
check('code fences + prose tolerated, default confidence', fenced && fenced.phrases[0].text === '述語論理' && fenced.phrases[0].confidence === 0.7);
check('garbage rejected', O.parseOcrResponse('すみません、読めませんでした。') === null);
check('malformed phrase rejected (text not a string)', O.parseOcrResponse('{"phrases":[{"text":42}]}') === null);
check('empty-text phrases dropped, page kept', O.parseOcrResponse('{"phrases":[{"text":"  "},{"text":"形"}]}').phrases.length === 1);

console.log('══ escalation decision ══');
check('unparseable → escalate', O.shouldEscalate(null) === true);
check('zero phrases → escalate', O.shouldEscalate({ phrases: [] }) === true);
check('low mean confidence → escalate', O.shouldEscalate({ phrases: [{ text: 'あ', confidence: 0.3 }, { text: 'い', confidence: 0.5 }] }) === true);
check('confident page → no escalation', O.shouldEscalate({ phrases: [{ text: 'あ', confidence: 0.9 }] }) === false);

console.log('══ escalation orchestration (fake transport) ══');
{
  const calls = [];
  const fake = (responses) => ({
    post: async (_u, body) => {
      calls.push(JSON.parse(body).model);
      return { status: 200, text: JSON.stringify({ content: [{ type: 'text', text: responses.shift() }] }) };
    },
  });
  const img = [{ base64: 'AA', mediaType: 'image/png' }];
  const r1 = await O.ocrImage(fake(['{"phrases":[{"text":"効く","confidence":0.95}]}']), { apiKey: 'k' }, img);
  check('confident haiku pass → no second call', r1.escalated === false && r1.modelUsed === C.OCR_MODEL_DEFAULT && calls.length === 1);
  calls.length = 0;
  const r2 = await O.ocrImage(fake(['ダメでした', '{"phrases":[{"text":"効く","confidence":0.8}]}']), { apiKey: 'k' }, img);
  check('unparseable haiku → opus rescues', r2.escalated === true && r2.modelUsed === C.OCR_MODEL_ESCALATION && r2.page.phrases.length === 1 && calls[1] === C.OCR_MODEL_ESCALATION);
  calls.length = 0;
  const r3 = await O.ocrImage(fake(['読めない', 'こちらも読めない']), { apiKey: 'k' }, img);
  check('both tiers fail → null page + honest error', r3.page === null && typeof r3.error === 'string');
  const r4 = await O.ocrImage({ post: async () => ({ status: 429, text: '{"error":{"type":"rate_limit_error","message":"slow down"}}' }) }, { apiKey: 'k' }, img);
  check('API error carried verbatim', r4.page === null && r4.error.includes('rate_limit_error'));
}

console.log('══ materialization (idempotent) + text-path hand-off ══');
{
  const page = { phrases: [{ text: 'レバレッジが効く', confidence: 0.9 }, { text: '頭にある形', confidence: 0.5 }] };
  const notes0 = '---\nsource: [[testtranscript]]\n---\n\n![[page1.png]]\n';
  const hash = O.imageHash(new Uint8Array([1, 2, 3]));
  const m1 = O.mergeOcrPhrases(notes0, page, 'page1.png', hash);
  check('phrases appended under a marked heading', m1.added === 2 && m1.md.includes(O.ocrMarker(hash)) && m1.md.includes('- レバレッジが効く'));
  const m2 = O.mergeOcrPhrases(m1.md, page, 'page1.png', hash);
  check('re-run is a no-op (marker)', m2.added === 0 && m2.md === m1.md);
  const extracted = extractNotePhrases(m1.md);
  check('extractNotePhrases picks up exactly the OCR phrases', extracted.includes('レバレッジが効く') && extracted.includes('頭にある形'));
  check('the heading/marker line is NOT a phrase', extracted.every((p) => !p.includes('ocr:') && !p.includes('手書きOCR')));
  const noisy = extractNotePhrases('---\nsource: [[t]]\n---\nhttps://youtu.be/abc\n\n![[page.png]]\n- 本物のメモ\n');
  check('embeds and bare URLs are NOT phrases', JSON.stringify(noisy) === '["本物のメモ"]', JSON.stringify(noisy));
  check('image hash is stable', O.imageHash(new Uint8Array([1, 2, 3])) === hash && O.imageHash(new Uint8Array([1, 2, 4])) !== hash);
}

console.log('══ LIVE OCR (gated: API key + fixtures/handwriting.png) ══');
// key: env ANTHROPIC_API_KEY, or the one the user pasted in plugin settings.
// NOTE (DESIGN §18): the secrets migration blanks notes.ocrApiKey in data.json
// (it moves to Obsidian's device-local storage, unreadable from node) — after
// the plugin reloads once, set ANTHROPIC_API_KEY to keep this live check alive.
const key = process.env.ANTHROPIC_API_KEY || (() => {
  try {
    const data = JSON.parse(readFileSync(
      'C:/Users/silas/Documents/Obsidian Vault/.obsidian/plugins/jp-collocations/data.json', 'utf8'));
    return data?.notes?.ocrApiKey || '';
  } catch { return ''; }
})();
const fixture = join(HERE, 'fixtures', 'handwriting.png');
if (key && existsSync(fixture)) {
  // Tile the strip exactly the way the plugin does (same planTiles), cropping
  // with ffmpeg since node has no canvas.
  const png = readFileSync(fixture);
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const up = O.tileUpscale(Math.min(width, height));
  const tiles = O.planTiles(width, height, { maxDim: Math.floor(1400 / up) });
  console.log(`  fixture ${width}×${height} → ${tiles.length} tile(s), upscale ×${up}`);
  const { detectTools } = await load('audio-extractor.ts');
  const ffmpeg = (await detectTools({})).ffmpeg || 'ffmpeg';
  const { execFileSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const images = [];
  try {
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const out = join(tmpdir(), `_hw_tile_${i}.png`);
      execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', fixture,
        '-vf', `crop=${t.w}:${t.h}:${t.x}:${t.y},scale=${t.w * up}:${t.h * up}:flags=lanczos`, out]);
      images.push({ base64: readFileSync(out).toString('base64'), mediaType: 'image/png' });
    }
  } catch (e) {
    console.log(`  ⏭ SKIPPED — ffmpeg unavailable for tiling (${e.message.slice(0, 80)})`);
  }
  if (images.length) {
    const http = {
      post: async (url, body, headers) => {
        const r = await fetch(url, { method: 'POST', body, headers });
        return { status: r.status, text: await r.text() };
      },
    };
    const res = await O.ocrImage(http, { apiKey: key }, images);
    check('live OCR returns phrases', !!res.page && res.page.phrases.length > 0, res.error);
    if (res.page) {
      console.log(`  model: ${res.modelUsed}${res.escalated ? ' (escalated)' : ''} — ${res.page.phrases.length} phrases:`);
      for (const p of res.page.phrases) console.log(`    ${p.confidence < 0.6 ? '⚠' : ' '} ${p.text} (${p.confidence})`);
    }
  }
} else {
  console.log(`  ⏭ SKIPPED — ${key ? '' : 'no API key (env or plugin settings); '}${existsSync(fixture) ? '' : 'no golden/fixtures/handwriting.png'}`);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ocr: ${pass}/${pass + fail} checks passed`);
// NO process.exit(): after a live fetch, hard-exit races undici's socket
// teardown and aborts with 0xC0000409 on Windows. Let the loop drain.
process.exitCode = fail === 0 ? 0 : 1;
