/**
 * golden/turns.mjs — §23.4-2 sentence-grain turn model: (line,char)
 * boundaries, the one-tap component split, and the slice math shared with the
 * context window. Locked against the real ゆる哲学ラジオ failure case.
 *
 * Run:  node golden/turns.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const T = await import(pathToFileURL(join(HERE, '..', 'src', 'discourse', 'turns.ts')).href);
const C = await import(pathToFileURL(join(HERE, '..', 'src', 'discourse', 'components.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

// the real case: one caption line holding aizuchi + reaction + the floor return
const LINES = [
  { text: 'フランス革命がないと今の僕らの暮らし全然違います。', tStartSec: 10 },
  { text: 'うん。そこまで言う。急にゆる歴史ラジオ回とね、', tStartSec: 14 },
  { text: '思った方もいらっしゃると思うんですけども、今さ、', tStartSec: 17 },
];

console.log('══ slices & text with (line,char) boundaries ══');
{
  const turns = [{ start: 0, speaker: 'A' }, { start: 1, speaker: 'B' }];
  check('line-grain turn text joins with no separator',
    T.turnTextOf(LINES, turns, 1) === LINES[1].text + LINES[2].text);
  const mid = [{ start: 0, speaker: 'A' }, { start: 1, speaker: 'B' }, { start: 1, char: 10, speaker: 'A' }];
  check('mid-line boundary splits the line between two turns',
    T.turnTextOf(LINES, mid, 1) === 'うん。そこまで言う。' &&
    T.turnTextOf(LINES, mid, 2) === '急にゆる歴史ラジオ回とね、' + LINES[2].text,
    JSON.stringify([T.turnTextOf(LINES, mid, 1), T.turnTextOf(LINES, mid, 2)]));
  const slices = T.turnLineSlices(LINES, mid, 2);
  check('the tail turn marks its first slice as partial', slices[0]?.partialStart === true && slices.length === 2);
  check('locateInTurn maps a turn offset back to absolute (line,char)',
    JSON.stringify(T.locateInTurn(LINES, mid, 2, LINES[1].text.length - 10 + 3)) === JSON.stringify({ line: 2, char: 3 }));
}

console.log('══ the one-tap fix: うん。そこまで言う。急に… ══');
{
  // initial (wrong) seg: the whole reaction line glued to the NEXT line as one turn labelled B
  const turns = [{ start: 0, speaker: 'A' }, { start: 1, speaker: 'B' }];
  const text = T.turnTextOf(LINES, turns, 1);
  const marks = C.analyzeUnits(T.turnTextOf(LINES, turns, 0), text);
  const ret = marks.find((m) => m.kind === 'return');
  check('the return mark is present on the glued turn', !!ret, JSON.stringify(marks));
  const spans = C.sentenceUnitSpans(text);
  check('unit spans align 1:1 with sentenceUnits', spans.map((s) => s.unit).join('|') === C.sentenceUnits(text).join('|'));
  const next = T.applyComponentSplit(LINES, turns, 1, spans[ret.unit].start, 'return');
  check('tapping 戻り splits at the sentence boundary', next?.length === 3, JSON.stringify(next));
  check('the reaction head stays with the LISTENER (B, other than A)',
    next?.[1].speaker === 'B' && next?.[1].start === 1 && !(next?.[1].char ?? 0));
  check('the floor RETURNS to the pre-reaction speaker (A) mid-line',
    next?.[2].speaker === 'A' && next?.[2].start === 1 && next?.[2].char === 10, JSON.stringify(next));
}

console.log('══ aizuchi / reaction flips ══');
{
  const turns = [{ start: 0, speaker: 'A' }, { start: 1, speaker: 'A' }];
  // head-of-turn aizuchi: no new boundary — the whole turn is the listener's
  const relabel = T.applyComponentSplit(LINES, turns, 1, 0, 'aizuchi');
  check('head aizuchi relabels the turn as the listener (≠ prev speaker)',
    relabel?.[1].speaker === 'B' && relabel.length === 2, JSON.stringify(relabel));
  check('already-the-listener yields null (nothing to change)',
    T.applyComponentSplit(LINES, [{ start: 0, speaker: 'A' }, { start: 1, speaker: 'B' }], 1, 0, 'aizuchi') === null);
  // mid-turn reaction: split, tail = other voice
  const mid = T.applyComponentSplit(LINES, turns, 1, 3, 'reaction');
  check('mid-turn reaction splits with the other voice on the tail',
    mid?.length === 3 && mid[2].speaker === 'B' && mid[2].char === 3);
  check('echo never splits', T.applyComponentSplit(LINES, turns, 1, 3, 'echo') === null);
}

console.log('══ sanitize & manual split ══');
{
  const messy = [
    { start: 1, char: 9, speaker: 'A' }, { start: 1, char: 9, speaker: 'B' },
    { start: 5, speaker: 'C' }, { start: -1, speaker: 'D' }, { start: 1, char: 999, speaker: 'D' },
  ];
  const clean = T.sanitizeTurns(messy, LINES);
  check('sanitize dedupes (line,char), clamps, forces 0:0 head',
    clean.length === 2 && clean[0].start === 0 && clean[1].char === 9, JSON.stringify(clean));
  const turns = [{ start: 0, speaker: 'A' }];
  const split = T.splitTurnAt(LINES, turns, 0, LINES[0].text.length, 'B');
  check('manual split at a line boundary lands on (line,0)',
    split?.[1].start === 1 && !(split?.[1].char ?? 0) && split?.[1].speaker === 'B');
  check('split outside the turn is refused', T.splitTurnAt(LINES, [{ start: 0, speaker: 'A' }], 0, 9999) === null);
  check('duplicate boundary is refused', T.splitTurnAt(LINES, split, 0, LINES[0].text.length) === null);
}

console.log('══ layer-3 relations (§23.4-5): drawn arrows ══');
{
  const turns = [{ start: 0, speaker: 'A' }, { start: 1, speaker: 'B' }, { start: 1, char: 10, speaker: 'A' }];
  const r1 = T.addRelation([], turns[1], turns[0], '→', 1000);
  check('arrow drawn with (line,char) endpoints', r1?.length === 1 && r1[0].to.start === 0 && r1[0].from.start === 1, JSON.stringify(r1));
  check('self-arrow refused', T.addRelation([], turns[1], turns[1], '→', 1000) === null);
  const r2 = T.addRelation(r1, turns[1], turns[0], '↧', 2000);
  check('re-drawing the same pair RETYPES, never duplicates', r2?.length === 1 && r2[0].type === '↧');
  const r3 = T.addRelation(r2, turns[2], turns[1], '↳', 3000);
  check('distinct pairs coexist', r3?.length === 2);
  check('sentence-grain endpoint keyed by (line,char)', T.relationKey(r3[1]) === '1:10>1:0');
  check('remove by key', T.removeRelation(r3, '1:10>1:0').length === 1);
  check('type cycles →/↳/↧', T.cycleRelationType('→') === '↳' && T.cycleRelationType('↧') === '→');
  // a merged-away turn takes its arrows with it
  const merged = [{ start: 0, speaker: 'A' }, { start: 1, speaker: 'B' }];   // 1:10 gone
  const alive = T.sanitizeRelations(r3, merged);
  check('sanitize drops arrows to/from vanished turns', alive.length === 1 && T.relationKey(alive[0]) === '1:0>0:0', JSON.stringify(alive));
}

console.log('══ layer-4 readings (§23.4-6): plural, lens-tagged, never forced ══');
{
  // the user's canonical case: 「うん。そこまで言う。」 carries
  // tsukkomi@micro AND framing-shift@meta simultaneously — blur is data
  let m = T.addReading({}, '1:0', 'micro', 'ツッコミ', 100);
  m = T.addReading(m, '1:0', 'meta', '枠替え', 200);
  check('one turn holds readings under multiple lenses', m?.['1:0']?.length === 2, JSON.stringify(m));
  check('same lens + same label deduped', T.addReading(m, '1:0', 'micro', 'ツッコミ', 300) === null);
  check('same label under a DIFFERENT lens coexists (perspectival)',
    T.addReading(m, '1:0', 'thought', 'ツッコミ', 300)?.['1:0']?.length === 3);
  check('empty label refused', T.addReading(m, '1:0', 'micro', '  ', 300) === null);
  const removed = T.removeReading(m, '1:0', 'micro', 'ツッコミ');
  check('remove targets exactly (lens,label)', removed['1:0']?.length === 1 && removed['1:0'][0].lens === 'meta');
  check('removing the last reading drops the key', T.removeReading(removed, '1:0', 'meta', '枠替え')['1:0'] === undefined);
  const alive = T.sanitizeReadings({ '1:0': m['1:0'], '9:9': m['1:0'] }, [{ start: 1, speaker: 'A' }]);
  check('readings of merged-away turns are dropped', alive['1:0']?.length === 2 && alive['9:9'] === undefined);
}

console.log(fail ? `\n✗ turns: ${fail} failed (${pass} passed)` : `\n✓ turns: all ${pass} pass`);
process.exit(fail ? 1 : 0);
