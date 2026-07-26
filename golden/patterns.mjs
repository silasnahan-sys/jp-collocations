/**
 * golden/patterns.mjs — PARSER-AUDIT Phase 2 regression.
 *
 * The engine-backed `detectPatterns` must:
 *   (a) never match inside content words — the legacy scanner's measured 13%
 *       false-positive class (さ in 小さい, わ in 問わない, で in まで …),
 *   (b) keep the true positives (ね/から/たら/けど/んです…),
 *   (c) report offsets valid in the EXACT string the caller passed
 *       (text.slice(offset, offset+len) === matchedText, every match),
 *   (d) stay fast enough for per-card / per-sentence UI use.
 *
 * The src chain mixes extensionless + .mjs imports, so this bundles
 * discourse-grammar.ts with esbuild first (like the plugin build does).
 *
 * Run:  node golden/patterns.mjs
 */
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require(join(HERE, '..', 'node_modules', 'esbuild'));

const outfile = join(mkdtempSync(join(tmpdir(), 'jpc-golden-')), 'grammar.cjs');
await esbuild.build({
  entryPoints: [join(HERE, '..', 'src', 'discourse', 'discourse-grammar.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  logLevel: 'silent',
});
const { detectPatterns, detectPatternsLegacy } = require(outfile);

let failures = 0;
let checks = 0;
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
const pass = (msg) => { console.log(`  ✓ ${msg}`); };
const check = (ok, msg) => { checks++; ok ? pass(msg) : fail(msg); };

// ── (c) offset fidelity helper — run on EVERY detection in this file ──
function offsetsValid(text, matches, label) {
  checks++;
  const bad = matches.filter((m) => text.slice(m.offset, m.offset + m.matchedText.length) !== m.matchedText);
  if (bad.length) {
    failures++;
    console.log(`  ✗ ${label}: ${bad.length} matches with offsets that don't slice back to matchedText`);
    for (const b of bad.slice(0, 3)) console.log(`      [${b.matchedText}] @${b.offset} → got 「${text.slice(b.offset, b.offset + b.matchedText.length)}」`);
    return false;
  }
  return true;
}

// ── (a) FP guards: no match fully inside these content words ─────────
console.log('\n══ FP guards (legacy scanner matched particles INSIDE these words) ══');
const FP_CASES = [
  { text: '小さい頃から好きだった。', trap: '小さい' },
  { text: 'お父さんが小さい声で話しました。', trap: 'お父さん' },
  { text: '年齢を問わない仕事ですから。', trap: '問わない' },
  { text: 'そう言われました。', trap: '言われ' },
  { text: '駅まで歩きました。', trap: 'まで' },
  { text: '個人的な意見ですけど。', trap: '個人的な' },
];
for (const { text, trap } of FP_CASES) {
  const ms = detectPatterns(text);
  offsetsValid(text, ms, `offsets 「${text}」`);
  const start = text.indexOf(trap);
  const end = start + trap.length;
  const inside = ms.filter((m) => m.offset >= start && m.offset + m.matchedText.length <= end && m.matchedText.length < trap.length);
  check(inside.length === 0,
    `no hit inside 「${trap}」 in 「${text}」` + (inside.length ? ` — got ${inside.map((m) => `${m.pattern.id}[${m.matchedText}]`).join(', ')}` : ''));
  const legacyInside = detectPatternsLegacy(text).filter((m) => {
    // legacy offsets are in whitespace-stripped text; these cases have no whitespace
    return m.offset >= start && m.offset + m.matchedText.length <= end && m.matchedText.length < trap.length;
  });
  if (legacyInside.length) console.log(`      (legacy fired ${legacyInside.length}× inside 「${trap}」 — the bug this gate guards)`);
}

// ── (b) TP guards: the engine must still see the real markers ────────
console.log('\n══ TP guards (real discourse markers must still fire) ══');
const TP_CASES = [
  { text: 'そうですね、でも行けなかったんですよ。', wants: ['ね', 'んです'] },
  { text: '忙しいから、時間がないんですよ。', wants: ['から'] },
  // NB: 行ったら is deliberately abstained (realis/irrealis ambiguity — the
  // lexicon's not_after guard); 降ったら is unambiguous conditional.
  { text: '雨が降ったら分かると思いますけど。', wants: ['たら', 'けど'] },
  { text: 'これはペンだと思います。', wants: ['と思'] },
  // Colloquial approximative 的な (kana-preceded) must still fire even though
  // attributive 漢語+的な (the FP guard above) must not.
  { text: 'もう帰りたい的な感じでした。', wants: ['的な'] },
];
for (const { text, wants } of TP_CASES) {
  const ms = detectPatterns(text);
  offsetsValid(text, ms, `offsets 「${text}」`);
  for (const w of wants) {
    check(ms.some((m) => m.matchedText.includes(w)),
      `「${w}」 detected in 「${text}」` + `  (got: ${ms.map((m) => m.matchedText).join('・') || 'nothing'})`);
  }
}

// ── (a)+(c)+(d) full-transcript sweep ────────────────────────────────
console.log('\n══ Transcript sweep (the PARSER-AUDIT baseline file) ══');
const md = readFileSync(join(HERE, 'patterns.transcript.md'), 'utf8');
const lines = md.split('\n')
  .map((ln) => ln.replace(/^\s*\[(?:\d{1,2}:)?\d{1,2}:\d{2}\]\s*/, '').replace(/\[音楽\]/g, '').trim())
  .filter((ln) => ln && !ln.startsWith('---') && !ln.startsWith('video:'));

let engineTotal = 0;
let legacyTotal = 0;
let offsetBad = 0;
const t0 = performance.now();
for (const ln of lines) {
  const ms = detectPatterns(ln);
  engineTotal += ms.length;
  for (const m of ms) {
    if (ln.slice(m.offset, m.offset + m.matchedText.length) !== m.matchedText) offsetBad++;
  }
}
const engineMs = performance.now() - t0;
const t1 = performance.now();
for (const ln of lines) legacyTotal += detectPatternsLegacy(ln).length;
const legacyMs = performance.now() - t1;

console.log(`  lines: ${lines.length} · engine hits: ${engineTotal} (${engineMs.toFixed(0)}ms) · legacy hits: ${legacyTotal} (${legacyMs.toFixed(0)}ms)`);
check(offsetBad === 0, `offset fidelity across transcript (${offsetBad} bad)`);
check(engineTotal > 100, `engine finds real structure (${engineTotal} hits)`);
check(engineTotal < legacyTotal, `engine fires less than the over-firing legacy scan (${engineTotal} < ${legacyTotal})`);
check(engineMs < 30000, `sweep under 30s (${engineMs.toFixed(0)}ms)`);
const perLine = engineMs / Math.max(1, lines.length);
check(perLine < 100, `per-line cost UI-safe (${perLine.toFixed(1)}ms/line, cold cache)`);

console.log(`\n${failures ? '✗' : '✓'} ${checks - failures}/${checks} checks pass`);
process.exit(failures ? 1 : 0);
