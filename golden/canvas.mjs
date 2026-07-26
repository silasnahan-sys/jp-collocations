/**
 * golden/canvas.mjs — TokenCanvas pure core (§22.4): tokenization accuracy,
 * marks → class/payload derivation (the gestures ARE the tests), suggestion
 * snapping.
 *
 * Run:  node golden/canvas.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const C = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'token-canvas.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const texts = (tokens) => tokens.map((t) => t.text);

console.log('══ tokenization: honest boundaries ══');
{
  const t = C.tokenizeForCanvas('その話、気になるでしょ。');
  check('roundtrip: tokens reassemble exactly', texts(t).join('') === 'その話、気になるでしょ。');
  check('punctuation is its own token', t.some((x) => x.text === '、' && x.kind === 'punct'));
  const fallback = C.tokenizeForCanvas('昨日書いた手紙');
  check('kanji keeps its okurigana (書いた whole)', texts(fallback).includes('書いた'), JSON.stringify(texts(fallback)));

  // with a dictionary probe, validated words win over script runs
  const dict = new Set(['気になる', '話', 'でしょ']);
  const probed = C.tokenizeForCanvas('その話、気になるでしょ。', (s) => dict.has(s));
  check('probe: longest validated match wins (気になる one token)', texts(probed).includes('気になる'), JSON.stringify(texts(probed)));
  check('probe miss degrades to runs, never guesses', texts(probed).join('') === 'その話、気になるでしょ。');
}

console.log('══ marks → capture: the gesture is the semantics ══');
{
  const t = C.tokenizeForCanvas('行くんだったらさ、早く準備しなきゃじゃん');
  const idx = (s) => t.findIndex((x) => x.text.includes(s));

  // drag = span
  const span = C.deriveFromMarks(t, { ...C.emptyMarks(), span: [0, 2] });
  check('span derives surface note, class left to suggester', span.cls === null && span.note.length > 0);

  // multi-tap = 🟠 parts
  const parts = C.deriveFromMarks(t, { ...C.emptyMarks(), parts: [idx('だったら'), idx('じゃん')] });
  check('picked bones → skeletal with 〜 notation', parts.cls === 'skeletal' && parts.note.includes('〜') && parts.payload.parts.length === 2, JSON.stringify(parts));

  // strike = 💠 slots
  const t2 = C.tokenizeForCanvas('行けば行くほど');
  const struck = C.deriveFromMarks(t2, { ...C.emptyMarks(), span: [0, t2.length - 1], struck: [0] });
  check('struck run becomes ○○ slot in the frame', struck.cls === 'phrase_schema' && struck.payload.frame.startsWith('○○'), JSON.stringify(struck));
  const t3 = C.tokenizeForCanvas('AをBに変える');
  const twoSlots = C.deriveFromMarks(t3, { ...C.emptyMarks(), struck: [t3.findIndex((x) => x.text === 'A'), t3.findIndex((x) => x.text === 'B')] });
  check('two struck runs → two slots', (twoSlots.payload.frame.match(/○○/g) ?? []).length === 2, JSON.stringify(twoSlots));

  // circle = 🟢 lemma + halo (probe splits 破綻 from its rendering)
  const dict4 = new Set(['破綻', 'として']);
  const t4 = C.tokenizeForCanvas('概念として破綻している', (s) => dict4.has(s));
  const kanji = t4.findIndex((x) => x.text === '破綻');
  const circ = C.deriveFromMarks(t4, { ...C.emptyMarks(), circled: kanji, halo: [kanji, t4.length - 1] });
  check('circle → lemma, halo carries the rendering', circ.cls === 'rhet_collocation' && circ.payload.lemma.includes('破綻') && circ.payload.halo.includes('している'), JSON.stringify(circ));

  // priority: circle > strike > parts > span
  const mixed = C.deriveFromMarks(t4, { span: [0, 1], parts: [0, 1], struck: [1], circled: kanji });
  check('most deliberate mark wins (circle beats all)', mixed.cls === 'rhet_collocation');
  check('empty marks → empty derivation', C.deriveFromMarks(t, C.emptyMarks()).note === '');
}

console.log('══ pentimento: suggestions snap outward ══');
{
  const t = C.tokenizeForCanvas('その話、気になるでしょ。');
  const range = C.suggestionToTokenRange(t, { start: 3, end: 8, label: '💡' });
  check('char span → token range covering it', range && t.slice(range[0], range[1] + 1).map((x) => x.text).join('').includes('気になる'), JSON.stringify(range));
  check('out-of-range suggestion → null', C.suggestionToTokenRange(t, { start: 99, end: 120, label: '' }) === null);
}

console.log(fail ? `\n✗ canvas: ${fail} failed (${pass} passed)` : `\n✓ canvas: all ${pass} pass`);
process.exit(fail ? 1 : 0);
