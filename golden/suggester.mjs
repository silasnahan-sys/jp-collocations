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

console.log('══ history RANKS, it never NOMINATES (the 2026-08 audit rule) ══');
{
  // The filmed misfire: English dictionary apparatus + a skewed history used
  // to preselect the user's most-ratified class (🔴) with zero structural
  // evidence. Non-Japanese text has no evidence for ANY class, and no amount
  // of history may invent one.
  check('non-Japanese text scores zero everywhere', S.suggestClass('common divisor,common multiple.', []).every((s) => s.score === 0));
  const skew = Array.from({ length: 20 }, () => ({ chosen: 'discourse' }));
  check('a skewed history cannot create a suggestion from nothing',
    S.suggestClass('common divisor,common multiple.', skew)[0].score === 0);
  // and even for Japanese, the prior lands only on structurally nominated
  // classes: a tight collocation shape with a 🔴-heavy history must not flip
  // to 🔴 (which scored nothing structurally).
  check('prior cannot lift a class structure never nominated',
    S.suggestClass('気になる', skew).find((s) => s.cls === 'discourse').score === 0);
}

console.log('══ evidence beyond the span (relationally defined classes) ══');
{
  const pos = (r, c) => r.findIndex((s) => s.cls === c);
  // 🔴 is defined by responsivity: a witnessed prior turn strengthens it
  const iso = S.suggestClass({ note: 'いやそれはないでしょ', hasPriorTurns: false }, []);
  const ctx = S.suggestClass({ note: 'いやそれはないでしょ', hasPriorTurns: true }, []);
  check('prior turns strengthen 🔴', ctx.find((s) => s.cls === 'discourse').score > iso.find((s) => s.cls === 'discourse').score);
  // a dictionary is nobody's utterance: 🔴 impossible, 🟡 weakened
  const dict = S.suggestClass({ note: 'いやそれはないでしょ', medium: 'dict' }, []);
  check('dict medium zeroes 🔴', dict.find((s) => s.cls === 'discourse').score === 0);
  check('dict suppression carries its why', dict.find((s) => s.cls === 'discourse').why.some((w) => w.includes('辞書')));
  const utter = 'そんなこと言われても困りますよ。';
  const whole = S.suggestClass({ note: utter, example: utter }, []);
  const span = S.suggestClass({ note: utter }, []);
  check('whole-utterance selection strengthens 🟡', whole.find((s) => s.cls === 'serifu').score > span.find((s) => s.cls === 'serifu').score);
  // the lexeme probe gives 🔵 real endpoints — and the window now admits
  // captures at real length (外的要因に左右される, IMG_1144)
  const probe = (s) => ['外的要因', '左右される'].includes(s);
  const withProbe = S.suggestClass({ note: '外的要因に左右される', lexeme: probe }, []);
  check('real-length collocation is nominated', withProbe[0].cls === 'collocation');
  check('probe-backed components add evidence', withProbe[0].why.some((w) => w.includes('辞書に載る')));
}

console.log(fail ? `\n✗ suggester: ${fail} failed (${pass} passed)` : `\n✓ suggester: all ${pass} pass`);
process.exit(fail ? 1 : 0);
