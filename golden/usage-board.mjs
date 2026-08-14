/**
 * golden/usage-board.mjs — the 類語 group as a place you can stand in.
 *
 * The properties that matter:
 *   - judgements are the publisher's OWN tokens (○/△/−), never normalized;
 *   - frames arrive verbatim, slots as the book printed them;
 *   - a book with members but no table still yields a board (judged: false,
 *     juxtapose-don't-tell) and neither yields null — an absence, not an
 *     empty frame;
 *   - every cell is a DOOR (member × frame × judgement), edges answer null;
 *   - the member step WRAPS — a five-member pass is a rhythm, not four
 *     strokes and a dead end.
 *
 * Run:  node golden/usage-board.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const U = await import(pathToFileURL(join(HERE, '..', 'src', 'dictionary', 'usage-board.ts')).href);

let n = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  n++;
  if (cond) console.log(`  ✓ ${name}`);
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const entry = [
  {
    shape: 'members', label: '使い方',
    items: [
      { text: '上がる', gloss: '広く一般に' },
      { text: '登る', gloss: '足を使って' },
      { text: '昇る', gloss: '空中を高く' },
    ],
  },
  {
    shape: 'comparison', label: '類語対比表',
    table: {
      cols: ['階段を～', '日が～', '屋上に～'],
      rows: [
        { item: '上がる', cells: ['○', '−', '○'] },
        { item: '登る', cells: ['○', '−', '△'] },
        { item: '昇る', cells: ['−', '○', '−'] },
      ],
    },
  },
];

{
  const b = U.boardFrom(entry);
  ok(b !== null && b.judged === true, 'a comparison table yields a judged board');
  ok(b.title === '類語対比表', 'the board wears the publisher\'s own title');
  ok(JSON.stringify(b.frames) === JSON.stringify(['階段を～', '日が～', '屋上に～']),
    'frames verbatim, slots as printed', JSON.stringify(b.frames));
  ok(b.members[1].cells[2] === '△' && b.members[2].cells[1] === '○' && b.members[0].cells[1] === '−',
    'judgement tokens are the editors\' own — ○/△/− transmitted, never scored');
  ok(b.members[0].gloss === '広く一般に',
    'member glosses join from the members shape (one board, both apparatuses)');

  const door = U.cellDoor(b, 1, 2);
  ok(door && door.member === '登る' && door.frame === '屋上に～' && door.judgement === '△',
    'a cell is a door: member × frame × judgement, ready for the examples join');
  ok(U.cellDoor(b, 9, 0) === null && U.cellDoor(b, 0, 9) === null,
    'off the board\'s edge answers null — callers never guess');

  ok(U.stepMember(b, 2, 1) === 0 && U.stepMember(b, 0, -1) === 2,
    'the member step wraps — the pass around the set is a rhythm');
}

{
  const membersOnly = [entry[0]];
  const b = U.boardFrom(membersOnly);
  ok(b !== null && b.judged === false && b.frames.length === 0,
    'members without a table still board — side by side, juxtapose-don\'t-tell');
  ok(b.members.length === 3 && b.members.every((m) => m.cells.length === 0),
    'no invented judgements: cells stay empty when the book did not judge');
  ok(U.boardFrom([{ shape: 'prose', text: '…' }]) === null,
    'neither members nor table → null: an absence, not an empty frame');
  ok(U.stepMember(b, 1, 1) === 2 && U.stepMember({ ...b, members: [] }, 0, 1) === 0,
    'stepping stays total, even on an empty board');
}

console.log(`\n${fail ? '✗' : '✓'} usage-board: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
