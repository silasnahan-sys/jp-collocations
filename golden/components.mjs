/**
 * golden/components.mjs — §23 discourse micro-components, tested against the
 * user's REAL ゆる哲学ラジオ failure cases verbatim.
 *
 * Run:  node golden/components.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const C = await import(pathToFileURL(join(HERE, '..', 'src', 'discourse', 'components.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('══ the 感謝 case: echo as lexical retake ══');
{
  const text = 'みんなもっとね、フランス革命に感謝した方がいい。感謝。日頃の感謝が足りてない。';
  const marks = C.analyzeUnits('', text);
  const echo = marks.find((m) => m.kind === 'echo');
  check('「感謝。」 detected as echo of the preceding clause', echo && echo.unit === 1 && echo.echoed === '感謝', JSON.stringify(marks));
  check('the elaboration after the echo is NOT flagged', !marks.some((m) => m.unit === 2));
  check('echo never suggests a speaker flip (self-retake default)', echo && echo.speakerFlip === false);
  check('echo carries WHAT was echoed (layer-4 gets the evidence)', echo?.echoed === '感謝');
}

console.log('══ the そこまで言う case: reaction cluster + floor return ══');
{
  const prev = 'フランス革命がないと今の僕らの暮らし全然違います。';
  const text = 'うん。そこまで言う。急にゆる歴史ラジオ回とね、思った方もいらっしゃると思うんですけども、今さ、';
  const marks = C.analyzeUnits(prev, text);
  check('うん = aizuchi, flips to the listener', marks.some((m) => m.unit === 0 && m.kind === 'aizuchi' && m.speakerFlip));
  check('そこまで言う = reaction shape, stays with the listener', marks.some((m) => m.unit === 1 && m.kind === 'reaction' && m.speakerFlip));
  check('急に… = floor RETURN to the pre-reaction speaker', marks.some((m) => m.unit === 2 && m.kind === 'return' && m.speakerFlip), JSON.stringify(marks));
}

console.log('══ connective & quotative (annotation-only components) ══');
{
  check('でも、 with pause = connective', C.detectConnective('でも、そうじゃなくて') === 'でも');
  check('bare つまり。 fragment = connective', C.detectConnective('つまり。') === 'つまり');
  check('ということは、 (multi-char) fires', C.detectConnective('ということは、革命は必然だった') === 'ということは');
  check('connective buried in flow does NOT fire', C.detectConnective('でもそうじゃなくて') === null);
  check('non-initial connective does NOT fire', C.detectConnective('それはでも、違う') === null);
  check('「」bracket quote wins, returns quoted material', C.detectQuotative('彼は「もうやめよう」と言った') === 'もうやめよう');
  check('って+言う fires without brackets', C.detectQuotative('もうやめようって言ってた') === 'って言っ');
  check('と思う fires', C.detectQuotative('必然だったと思うんですよ') === 'と思う');
  check('bare という (nominalizer) never fires', C.detectQuotative('革命という事件') === null);
  const marks = C.analyzeUnits('', 'でも、それは違う。彼は「もうやめよう」と言った。');
  check('analyzeUnits marks connective with evidence, no flip',
    marks.some((m) => m.unit === 0 && m.kind === 'connective' && m.evidence === 'でも' && !m.speakerFlip), JSON.stringify(marks));
  check('analyzeUnits marks quotative with quoted evidence, no flip',
    marks.some((m) => m.unit === 1 && m.kind === 'quotative' && m.evidence === 'もうやめよう' && !m.speakerFlip));
  check('flip components take precedence over annotations on the same unit',
    C.analyzeUnits('前の文。', 'うん。').every((m) => m.kind === 'aizuchi'));
}

console.log('══ precision guards ══');
{
  check('ほう alone = aizuchi not echo', C.analyzeUnits('暮らし全然違います。', 'ほう。')[0]?.kind === 'aizuchi');
  check('a full sentence is never an echo', C.detectEcho('感謝した方がいい', '感謝した方がいいと思うんですよね') === null);
  check('fragment NOT in prev clause → no echo', C.detectEcho('全然違います', '感謝') === null);
  check('identical clause is repetition, not echo-fragment', C.detectEcho('感謝', '感謝') === null);
  check('plain exposition yields no marks at all', C.analyzeUnits('前の文です。', '人類史に最も影響を与えた事件がフランス革命だなと。').length === 0);
  check('sentence units split on 。！？ keeping them attached', C.sentenceUnits('うん。そこまで言う。急にね').length === 3);
}

console.log(fail ? `\n✗ components: ${fail} failed (${pass} passed)` : `\n✓ components: all ${pass} pass`);
process.exit(fail ? 1 : 0);
