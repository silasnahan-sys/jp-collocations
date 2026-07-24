/**
 * golden/calculus-precision.mjs — PINS the ✓✕ precision protocol.
 *
 * Three guarantees, per the sampler's own contract ("any rule change that
 * alters which moves fire must visit this protocol loudly, never silently"):
 *
 *  1. AMENDMENT V REGRESSION — the judged 2026-07-22 sample rows
 *     (golden/precision/judged-2026-07-22.jsonl, frozen) replay against the
 *     CURRENT recognizer: every suggested-✕ REJECT/GRANT row must NOT fire,
 *     the surviving suggested-✓ GRANT rows MUST, and the two deliberately
 *     demoted ✓ rows must fire contrast (the precision-first trade, pinned
 *     so it cannot silently regress in either direction).
 *  2. SAMPLE SYNC — samples.jsonl on disk matches what buildSamples()
 *     produces under the current rules. If a rule change alters firings,
 *     this fails until `node golden/precision-sample.mjs` is re-run (which
 *     merges annotations by id) — the loud visit, mechanically forced.
 *  3. SAMPLER DETERMINISM — buildSamples() is byte-stable across calls;
 *     ids are unique. This is the property that makes ratification-carry
 *     safe (annotations key on id).
 *
 *   node golden/calculus-precision.mjs
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (p) => import(pathToFileURL(join(HERE, p)).href);
const { recognizeEvents } = await imp('../src/discourse/calculus/moves.mjs');
const { buildSamples, loadSamples } = await imp('./precision-sample.mjs');

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name} ${extra}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// ── 1. Amendment V regression on the frozen judged sample ─────────────
console.log('══ Amendment V regression (judged 2026-07-22 rows, frozen) ══');
const judged = readFileSync(join(HERE, 'precision', 'judged-2026-07-22.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));

const KIND = { REJECT: 'reject', GRANT: 'concede' };
const fires = (text, kind) => recognizeEvents(text).events.some(e => e.kind === kind);

// Suggested-✓ GRANT rows that MUST keep firing (assent-anchored concessives)
const GRANT_KEEP = new Set(['nenko:219:GRANT:1', 'nenko:396:GRANT:2', 'nenko:666:GRANT:4',
                            'nenko:904:GRANT:5', 'nenko:1645:GRANT:11']);
// Suggested-✓ GRANT rows deliberately demoted to contrast (bare でも):
// pinned as a CONSCIOUS trade, not an accident.
const GRANT_DEMOTED = new Set(['nenko:1031:GRANT:6', 'nenko:1367:GRANT:9']);

let xDead = 0, xTotal = 0;
for (const r of judged.filter(r => (r.prim === 'REJECT' || r.prim === 'GRANT') && r.suggested === 'no')) {
  xTotal++;
  if (!fires(r.text, KIND[r.prim])) xDead++;
  else console.log(`    ⚠ ✕ row still fires: ${r.id}`);
}
ok(xDead === xTotal, `every suggested-✕ REJECT/GRANT row is dead`, `(${xDead}/${xTotal})`);

for (const id of GRANT_KEEP) {
  const r = judged.find(x => x.id === id);
  ok(r && fires(r.text, 'concede'), `✓ row keeps GRANT: ${id}`);
}
for (const id of GRANT_DEMOTED) {
  const r = judged.find(x => x.id === id);
  ok(r && !fires(r.text, 'concede') && fires(r.text, 'contrast'),
     `demoted ✓ row fires contrast, not GRANT: ${id}`);
}

// Hand innocents/positives beyond the sample (the probe cases)
console.log('══ anchor innocents / positives ══');
ok(!fires('いや、ほんとそれな、分かるよ', 'reject'), 'いや + agreement-preface does not REJECT');
ok(!fires('いやー、すごいですね', 'reject'), 'exclamative いや does not REJECT');
ok(fires('いや、違う、そうじゃなくて', 'reject'), 'いや + correction anchor REJECTs');
ok(fires('そうじゃなくて、逆だと思う', 'reject'), 'そうじゃなくて REJECTs');
ok(!fires('違うんかいって思ってます', 'reject'), 'quoted 違うんかい does not REJECT');
ok(fires('まあでも今日の結論と似たようなところですよね', 'concede'), 'まあでも GRANTs (assent head)');
ok(!fires('あ、でも世の空気感ってそっちに寄ってそう', 'concede'), 'あ、でも does not GRANT (new counterpoint)');
ok(fires('あ、でも世の空気感ってそっちに寄ってそう', 'contrast'), 'あ、でも fires contrast');
ok(!fires('もしかしたら俺が世間とズレてるのかもしんないけど', 'concede'), 'しかし inside もしかしたら is inert');
ok(fires('とはいえゆくゆくは自分も置いていくわけじゃないですか', 'concede'), 'とはいえ GRANTs');
ok(fires('面白いけどその仕組み無理じゃない', 'concede'), 'assessment head + けど GRANTs (面白いけど)');
// contrast-anchor innocents found by the labeling pass (2026-07-24)
ok(!fires('ラジオでも前に出てきたよねハイム&クラッツ', 'contrast'), 'particle でも (ラジオでも) is not contrast');
ok(!fires('読んでもらってという感じでタイトルいいですよね', 'contrast'), '読んでもらって is not contrast');
ok(!fires('けど多分人間の手でこういう命令があったら', 'contrast'), 'stranded けど-initial (ASR split) is not contrast');
ok(!fires('ですけども2個計算の仕方があって', 'contrast'), 'ですけども-initial (ASR split) is not contrast');
ok(fires('でもそれだとただいるだけのやつが高級取りになりますよ', 'contrast'), 'turn-initial でも counter fires contrast');
ok(fires('あ、でも世の空気感ってそっちに寄ってそう', 'contrast'), 'filler + でも still fires contrast');

// ── 2. sample sync: disk matches current rules ────────────────────────
console.log('══ sample sync (samples.jsonl ⇔ current rules) ══');
const fresh = buildSamples();
const disk = loadSamples();
const idsOf = (a) => a.map(s => s.id).sort().join('\n');
ok(disk.length === fresh.length, 'sample count matches current rules', `(disk ${disk.length} vs rules ${fresh.length})`);
ok(idsOf(disk) === idsOf(fresh), 'sample ids match current rules (else: re-run precision-sample.mjs — loudly)');

// ── 3. sampler determinism (the property ratification-carry rides on) ─
console.log('══ sampler determinism ══');
const a = JSON.stringify(buildSamples());
const b = JSON.stringify(buildSamples());
ok(a === b, 'buildSamples() is byte-deterministic');
ok(new Set(fresh.map(s => s.id)).size === fresh.length, 'sample ids are unique');

console.log(fail ? `\n✗ calculus-precision: ${pass}/${pass + fail} checks passed`
                 : `\n✓ calculus-precision: ${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
