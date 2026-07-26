/**
 * golden/suggester.mjs — the class-suggester (§21 core): structural signals
 * calibrated by the user's own suggested-vs-chosen record.
 *
 * Run:  node golden/suggester.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const S = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'class-suggester.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const top = (note, history = []) => S.suggestClass(note, history)[0];

console.log('══ structural signals (notation is the user\'s own convention) ══');
{
  check('〜 notation → skeletal', top('んだったら〜じゃん').cls === 'skeletal');
  check('○○ slot → phrase_schema', top('○○というわけだ').cls === 'phrase_schema');
  check('noun+particle+verb tight → collocation', top('気になる').cls === 'collocation');
  check('utterance with 文末形 → serifu', top('そんなこと言われても困りますよ。').cls === 'serifu');
  check('responsive head + interactional tail → discourse ranks high', (() => {
    const ranked = S.suggestClass('いやそれはないでしょ', []);
    return ranked.findIndex((s) => s.cls === 'discourse') <= 1;
  })());
  check('bare kanji lemma hints rhet_collocation', (() => {
    const ranked = S.suggestClass('破綻', []);
    return ranked.findIndex((s) => s.cls === 'rhet_collocation') <= 1;
  })());
  check('every score carries a why', S.suggestClass('気になる', []).every((s) => s.score === 0 || s.why.length > 0));
}

console.log('══ calibration: the user\'s record bends the ranking ══');
{
  // structural evidence is ambiguous here; history should break the tie
  const drift = Array.from({ length: 12 }, () => ({ chosen: 'discourse' }));
  const ranked = S.suggestClass('まあそれな', drift);
  const rankedNoHist = S.suggestClass('まあそれな', []);
  const pos = (r, c) => r.findIndex((s) => s.cls === c);
  check('user priors promote their frequent class', pos(ranked, 'discourse') <= pos(rankedNoHist, 'discourse'));

  // correction transfer: machine keeps saying collocation, user keeps
  // choosing rhet_collocation → future collocation-shaped notes carry 🟢 up
  const corrections = Array.from({ length: 4 }, () => ({ suggested: 'collocation', chosen: 'rhet_collocation' }));
  const t = S.suggestClass('腹を括る', corrections);
  check('override transfers lift the corrected class', pos(t, 'rhet_collocation') < pos(S.suggestClass('腹を括る', []), 'rhet_collocation'));
  check('transfer reason is visible', t.find((s) => s.cls === 'rhet_collocation').why.some((w) => w.includes('訂正')));
  check('small histories (<5) do not distort priors', (() => {
    const tiny = [{ chosen: 'discourse' }];
    return JSON.stringify(S.suggestClass('気になる', tiny)[0].cls) === JSON.stringify(S.suggestClass('気になる', [])[0].cls);
  })());
}

console.log(fail ? `\n✗ suggester: ${fail} failed (${pass} passed)` : `\n✓ suggester: all ${pass} pass`);
process.exit(fail ? 1 : 0);
