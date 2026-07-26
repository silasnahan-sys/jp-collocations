/**
 * golden/scaffold.mjs — 生成 scaffold (DESIGN §20.3 Tier C) + retirement.
 *
 * The philosophy under test: generated lines survive ONLY if the sweep's own
 * deinflect-validated matcher confirms they contain the pattern, and the
 * scaffold retires the moment a real attestation lands.
 *
 * Run:  node golden/scaffold.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const S = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'scaffold.ts')).href);
const P = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'pattern-store.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const colloc = { class: 'collocation', keyKind: 'surface', key: '気になる', note: '気になる', payload: {} };
const link = { class: 'skeletal', keyKind: 'link', key: 'だったら〜じゃん', note: 'だったら〜じゃん', payload: { parts: ['だったら', 'じゃん'] } };

const apiBody = (examples) => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ examples }) }] });

console.log('══ scaffoldLineValid: the sweep matcher is the judge ══');
{
  check('inflected use validates (気になってた)', S.scaffoldLineValid(colloc, 'その話がずっと気になってた'));
  check('pattern absent → invalid', !S.scaffoldLineValid(colloc, '今日はいい天気ですね'));
  check('compound imposter → invalid (本気になって)', !S.scaffoldLineValid(colloc, 'あいつ本気になってきたな'));
  check('link needs BOTH parts', S.scaffoldLineValid(link, '行くんだったら早くすればいいじゃん') && !S.scaffoldLineValid(link, '行くんだったら早くしよう'));
}

console.log('══ parseScaffoldResponse: schema + validation gauntlet ══');
{
  const r = S.parseScaffoldResponse(colloc, 200, apiBody(['最近あの人のことが気になってしょうがない', '今日はいい天気ですね', '結果が気になるから早く教えて']));
  check('valid lines survive, pattern-free lines rejected', r.ok && r.examples.length === 2, JSON.stringify(r));
  const r2 = S.parseScaffoldResponse(colloc, 200, apiBody(['いい天気', '本気になってきた']));
  check('all-invalid → honest failure', !r2.ok && r2.error.includes('検証'), JSON.stringify(r2));
  const r3 = S.parseScaffoldResponse(colloc, 429, '{"error":{"message":"rate limited"}}');
  check('HTTP error surfaced', !r3.ok && r3.error.includes('429'));
  const r4 = S.parseScaffoldResponse(colloc, 200, JSON.stringify({ content: [{ type: 'text', text: 'すみません、できません' }] }));
  check('refusal (no JSON) → honest failure', !r4.ok);
  check('length bounds enforced', (() => {
    const short = S.parseScaffoldResponse(colloc, 200, apiBody(['気になる']));
    return !short.ok; // 4 chars < 6 → rejected → all-invalid
  })());
  check('model id is the ONE pinned constant', S.SCAFFOLD_MODEL === 'claude-haiku-4-5-20251001');
  check('prompt carries class-appropriate instruction', S.buildScaffoldPrompt(link).includes('骨格') && S.buildScaffoldPrompt(link).includes('だったら'));
}

console.log('══ retirement: reality replaces 生成 ══');
{
  const att = (confirmed) => ({ source: 'yt', file: 'T/v.md', tStartSec: 30, quote: '気になってた', addedAt: 1, ...(confirmed ? {} : { status: 'suggested' }) });
  let e = P.upsertEntry(undefined, '気になる', null, 1);
  e.payload.scaffold = ['最近あの人のことが気になってしょうがない'];
  e = P.upsertEntry(e, '気になる', att(false), 2);
  check('suggested sighting does NOT retire scaffold', e.payload.scaffold?.length === 1);
  e = P.upsertEntry(e, '気になる', att(true), 3);
  check('confirmed attestation retires scaffold', e.payload.scaffold === undefined);

  // the ✓-ratification path retires too
  const store = new P.PatternStore(async () => {});
  store.load({ entries: [{ ...P.upsertEntry(undefined, '気になる', att(false), 1), payload: { scaffold: ['例文だよ、気になるでしょ'] } }] });
  const entry = store.all()[0];
  check('(precondition) suggested + scaffold coexist', entry.attestations[0].status === 'suggested' && entry.payload.scaffold.length === 1);
  await store.ratifyAttestation(entry.id, P.attestationKey(entry.attestations[0]));
  check('ratify ✓ retires scaffold', store.all()[0].payload.scaffold === undefined && !store.all()[0].attestations[0].status);
}

console.log(fail ? `\n✗ scaffold: ${fail} failed (${pass} passed)` : `\n✓ scaffold: all ${pass} pass`);
process.exit(fail ? 1 : 0);
