/**
 * golden/eijiro.mjs — the PURE 英辞郎 adapter, on entries lifted VERBATIM from
 * the user's own export (golden/fixtures/eijiro.entries.json).
 *
 * §27.7 step 1. The checks enforce the inversion, not just the parse:
 *   • 〔…〕 is a situation, not part of the gloss (§27.1 property 2)
 *   • be ～ / a ～ is a declared SHAPE, and is not doubled by the source's
 *     duplicate label spans
 *   • slotted headwords land in the shared frame key space (frames.ts), so
 *     Eijiro frames and the user's hand-drawn 🟠/💠 collide on one key
 *   • 人名 never becomes a production candidate (§27.4 — never study noise)
 *   • classHint is a suggestion and never 🔴
 *
 *   node golden/eijiro.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
const { transpileModule } = ts;

const HERE = dirname(fileURLToPath(import.meta.url));
const SRCDIR = join(HERE, '..', 'src', 'dictionary');

// Load the SHIPPED sources (frames.ts is a real import of eijiro.ts, so inline
// it as a data: module and rewrite the specifier).
const framesJs = transpileModule(readFileSync(join(SRCDIR, 'frames.ts'), 'utf8'), {
  compilerOptions: { module: 'ESNext', target: 'ES2022' },
}).outputText;
const framesUrl = 'data:text/javascript;base64,' + Buffer.from(framesJs).toString('base64');

let eijiroTs = readFileSync(join(SRCDIR, 'eijiro.ts'), 'utf8');
const eijiroJs = transpileModule(eijiroTs, {
  compilerOptions: { module: 'ESNext', target: 'ES2022' },
}).outputText.replace(/from ['"]\.\/frames\.ts['"]/g, `from '${framesUrl}'`);
const { adaptEijiroEntry, buildFrameIndex, splitSituation, stripTags } =
  await import('data:text/javascript;base64,' + Buffer.from(eijiroJs).toString('base64'));
const { normalizeFrame, frameMatches } = await import(framesUrl);

const FIX = JSON.parse(readFileSync(join(HERE, 'fixtures', 'eijiro.entries.json'), 'utf8'));

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => {
  n++;
  if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg}`);
};
const adapt = (hw, opts) => adaptEijiroEntry(FIX[hw], opts);

console.log('══ helpers ══');
ok(stripTags('<div class="x">あ<span>い</span></div>') === 'あい', 'stripTags flattens');
{
  const r = splitSituation('〔人さし指と中指で作る〕勝利を意味するVサイン');
  ok(r.situation === '人さし指と中指で作る', 'the 〔…〕 bracket is extracted as a SITUATION');
  ok(r.gloss === '勝利を意味するVサイン', 'and removed from the gloss (it is not a definition)');
}

console.log('\n══ 〔situation〕 + frame label — "V for Victory" sign ══');
{
  const h = adapt('"V for Victory" sign');
  ok(h.senses.length === 1, 'one sense', `(${h.senses.length})`);
  ok(h.senses[0].situation === '人さし指と中指で作る', 'situation captured');
  ok(h.senses[0].gloss === '勝利を意味するVサイン', 'gloss is clean of the bracket');
  ok(h.reachFor.length === 1, 'it IS a reach-for unit (a situation makes it one)');
  ok(h.reachFor[0].shape === 'the ～', 'the declared shape is kept', `(${h.reachFor[0].shape})`);
  ok(!/the ～\s*the ～/.test(String(h.reachFor[0].shape)),
    'the source duplicates its label span — the shape must NOT be doubled');
}

console.log('\n══ DIRECTION — the thing that is easy to get backwards ══');
{
  // EN→JP used as a PRODUCTION dictionary: the English headword is the
  // intention you search by, the Japanese is what you reach for. Class and
  // frame must come from the JAPANESE side, because that is the production
  // unit the six classes describe. (Computing them from the English labelled
  // 8,087 of one 10k bank 🟡 — every multi-word English headword.)
  const c = adapt('$__ in arrears').reachFor[0];
  ok(c.intention === '$__ in arrears', 'intention is the ENGLISH headword');
  ok(c.surface === '＿ドルの支払いが滞っている', 'surface is the JAPANESE', `(${c.surface})`);
  ok(c.frameKey === '＿ドルの支払いが滞っている', 'frameKey keys the JAPANESE', `(${c.frameKey})`);
  ok(c.intentionKey === '＿ in arrears', 'the English side gets its own key', `(${c.intentionKey})`);
  ok(frameMatches(c.intentionKey, '$500 in arrears'), 'a real English phrase reaches the intention');
  ok(c.slots === 1, 'one slot on the Japanese side', `(${c.slots})`);
  ok(c.shape === 'be ～', 'the be ～ shape is kept', `(${c.shape})`);
  ok(c.classHint === 'skeletal', 'declared shape + one slot → 🟠', `(${c.classHint})`);
}

console.log('\n══ BOTH slot kinds in one sentence — the example-sentence case ══');
{
  const c = adapt('$__ will automatically be taken off your ~ purchase').reachFor[0];
  ok(!!c, 'a sentence-length gapped entry is a reach-for unit');
  ok(c.slots === 2, 'both slots counted on the Japanese', `(${c.slots})`);
  ok(c.frameKey === '～を買うと自動的に＿ドル値引きされる',
    'the Japanese sentence is gapped on both slot kinds', `(${c.frameKey})`);
  ok(c.classHint === 'phrase_schema', 'two slots → 💠', `(${c.classHint})`);
  ok(frameMatches(c.frameKey, 'コーヒーを買うと自動的に500ドル値引きされる'),
    'a real Japanese sentence reaches the gapped frame');
  ok(frameMatches(c.intentionKey, '$20 will automatically be taken off your next purchase'),
    'and the English intention still reaches from the other side');
}

console.log('\n══ bracketed alternatives are display, not structure ══');
{
  const c = adapt('$__ discount per person').reachFor[0];
  ok(!c.frameKey.includes('['), 'no [値引き] noise in the KEY', `(${c.frameKey})`);
  ok(c.surface.includes('['), 'but the SURFACE keeps them — that is what you read',
    `(${c.surface})`);
}

console.log('\n══ supplement / xref / multi-sense ══');
{
  const h = adapt('"bring it on" gesture');
  ok(!!h.senses[0].note, 'div.supplement becomes the sense note', `(${h.senses[0].note})`);
}
{
  const h = adapt('"');
  ok(h.senses.length === 2, 'an <ol class="senses"> yields every <li>', `(${h.senses.length})`);
  ok(h.senses.every((s) => s.pos === '名'), 'each li keeps its own sense-pos');
  ok(h.xrefs.includes('inch') && h.xrefs.includes('double quotation mark'),
    'xrefs collected', `(${JSON.stringify(h.xrefs)})`);
  ok(h.xrefs.length === 2, 'the source duplicates xref spans — they must be deduped',
    `(${h.xrefs.length})`);
}
{
  const h = adapt("'tween");
  ok(h.pos.length === 2, 'entry-header pos tags collected', `(${JSON.stringify(h.pos)})`);
}

console.log('\n══ 人名 is never a production candidate (§27.4) ══');
{
  const h = adapt('(Hugo) Alvar (Henrik) Aalto');
  ok(h.kind === 'name', 'rules="人名" → kind name');
  ok(h.reachFor.length === 0, 'a person name yields NO reach-for candidate — never study noise');
  ok(h.senses.length >= 1, 'but it is still looked-up-able');
}

console.log('\n══ the frame index — the join with the catalog ══');
{
  const heads = Object.keys(FIX).map((k) => adapt(k));
  const idx = buildFrameIndex(heads);
  ok(idx.size > 0, 'index built', `(${idx.size} frames)`);
  ok(idx.has('＿ドルの支払いが滞っている'), 'a frame is addressable by its normalized Japanese key');
  // THE point: a frame the USER draws by hand, in their OWN notation, must hit
  // the same bucket as Eijiro's. This is the join that makes one product.
  const userDrew = normalizeFrame('○○を買うと自動的に＿ドル値引きされる');
  ok(idx.has(userDrew), "a hand-drawn frame lands on the SAME key as Eijiro's", `(${userDrew})`);
  const names = heads.filter((h) => h.kind === 'name');
  ok(names.every((h) => h.reachFor.length === 0), 'no name leaked into the reach-for index');
}

console.log('\n══ the two classes a dictionary may never assert ══');
{
  const heads = Object.keys(FIX).map((k) => adapt(k));
  const hints = heads.flatMap((h) => h.reachFor.map((c) => c.classHint));
  ok(hints.length > 0, 'candidates exist to check', `(${hints.length})`);
  ok(!hints.includes('discourse'),
    '🔴 never — responsivity is dialogic and needs a prior turn');
  ok(!hints.includes('serifu'),
    '🟡 never — the citation test needs someone to have SAID it; a gloss is not an utterance');
}

console.log('\n══ determinism ══');
{
  const a = JSON.stringify(Object.keys(FIX).map((k) => adapt(k)));
  const b = JSON.stringify(Object.keys(FIX).map((k) => adapt(k)));
  ok(a === b, 'adaptation is byte-deterministic');
}

console.log(`\n${fail ? '✗' : '✓'} eijiro: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
