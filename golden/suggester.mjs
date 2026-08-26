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

console.log('╬ a caller hint beats a WEAK read and loses to a STRONG one ╬');
{
  // The 🔵 road: a 語法 profile row IS a collocation by provenance.
  // 「強い風」 is a canonical one - and structure's only word about it is
  // the 1-3 point "short enough to be a bare lemma" heuristic, which used to
  // preselect 🟢修辞連語 and destroy the one road into the starved class.
  const weak = S.suggestClass('強い風', []);
  const weakTop = weak[0];
  check('a real collocation row gets only a WEAK structural read',
    weakTop.score > 0 && weakTop.score < S.HINT_FLOOR);
  const hinted = S.chooseSuggested(weak, 'collocation', 'serifu');
  check('the caller hint wins over a weak read',
    hinted.cls === 'collocation' && hinted.from === 'hint');
  check('and it names the signal it outranked', !!hinted.beat && hinted.beat.why.length > 0);

  // A strong read is real evidence and still wins: notation scores 8.
  const strong = S.suggestClass('んだったら〜じゃん', []);
  check('a STRONG read outranks the hint',
    S.chooseSuggested(strong, 'collocation', 'serifu').cls === 'skeletal');

  // With no hint on the table the old rule stands: any nomination wins.
  check('no hint -> any nomination wins',
    S.chooseSuggested(weak, undefined, 'serifu').cls === weakTop.cls);

  // Nothing nominated and no hint -> the notation derivation is the floor.
  const none = S.suggestClass('common divisor,common multiple.', []);
  check('nothing nominated, no hint -> derivation',
    S.chooseSuggested(none, undefined, 'serifu').from === 'derivation');
  check('nothing nominated, with a hint -> the hint, unbeaten',
    S.chooseSuggested(none, 'collocation', 'serifu').beat === undefined);
}

console.log(fail ? `\n✗ suggester: ${fail} failed (${pass} passed)` : `\n✓ suggester: all ${pass} pass`);
process.exit(fail ? 1 : 0);
