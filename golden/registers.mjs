/**
 * golden/registers.mjs — 二重写し, the Move-2 inspector's two registers.
 *
 * The film (IMG_1213): the Edit panel keeps the STORED address while the
 * candidate rides the block, and only release rewrites the panel. The rule
 * under test is not "does it diff" — it is that two registers exist only when
 * there are genuinely two, that the strip names only what MOVES, and that
 * nothing is written until the commit.
 *
 * Run:  node golden/registers.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const R = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'registers.ts')).href);

let n = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  n++;
  if (cond) console.log(`  ✓ ${name}`);
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};
const byField = (fields, f) => fields.find((x) => x.field === f);

console.log('══ a first capture has ONE truth ══');
{
  const c = { note: 'はず〜まずは', cls: 'skeletal', parts: ['はず', 'まずは'] };
  ok(R.diffRegisters(null, c).length === 0,
    'nothing stored → no register strip at all', String(R.diffRegisters(null, c).length));
  ok(R.isDirty(R.diffRegisters(null, c)) === false,
    'and a first capture is not "dirty" against a record that does not exist');
  ok(R.snapshotOf(null) === null, 'no entry snapshots to null');
}

console.log('══ the re-cut: what the last filing recorded, beside what this one would ══');
{
  // 保存して別分類も — the span was filed once; the hand re-marks it.
  const stored = R.snapshotOf({
    note: 'はず〜まずは', key: 'はず〜まずは',
    class: 'skeletal',
    payload: { parts: ['はず', 'まずは'], gloss: '反実仮想へ視点を移す' },
  });
  ok(stored.note === 'はず〜まずは' && stored.cls === 'skeletal',
    'a catalog entry reads into the comparable shape');
  // The key is DERIVED — a 🟠 key is its parts joined. Comparing a typed
  // headword against the key would report a change on every untouched
  // capture, so the note wins and the key is only the fallback.
  ok(R.snapshotOf({ note: '書いた形', key: 'は〜ま', class: 'skeletal' }).note === '書いた形',
    'the note beats the derived key');
  ok(R.snapshotOf({ key: 'k', class: 'serifu' }).note === 'k',
    'and the key is the fallback when no note was kept');

  const candidate = {
    note: 'はず(。)〜まずは',
    cls: 'skeletal',
    parts: ['はず', 'まずは'],
    gloss: '',
    frame: '○○はず',
  };
  const d = R.diffRegisters(stored, candidate);

  ok(byField(d, 'note').kind === 'changed', '見出し moved', byField(d, 'note').kind);
  ok(byField(d, 'cls').kind === 'same', 'the class did not');
  ok(byField(d, 'parts').kind === 'same', 'identical parts compare equal through the 〜 join');
  ok(byField(d, 'frame').kind === 'added', 'a field the record lacked is ADDED', byField(d, 'frame').kind);
  ok(byField(d, 'gloss').kind === 'removed', 'a field emptied by the hand is REMOVED', byField(d, 'gloss').kind);

  const moved = R.changedOnly(d);
  ok(moved.length === 3, 'the strip names only what moves — three, not seven', String(moved.length));
  ok(!moved.some((f) => f.field === 'parts'), 'and never prints the unchanged inventory');
  ok(R.isDirty(d) === true, 'the capture is dirty against the record');
}

console.log('══ the arrow is the whole point ══');
{
  const stored = R.snapshotOf({ key: 'あ', class: 'serifu', payload: { lemma: '程々に' } });
  const d = R.diffRegisters(stored, { note: 'あ', cls: 'serifu', lemma: '程々' });
  const line = R.registerLine(byField(d, 'lemma'));
  ok(line === 'レンマ: 程々に → 程々', 'stored on the left, candidate on the right', line);

  const added = R.registerLine({ field: 'frame', label: '型', candidate: '○○です', kind: 'added' });
  ok(added === '型: — → ○○です', 'an addition still shows the empty left register', added);

  const gone = R.registerLine({ field: 'gloss', label: '語釈', stored: 'x', kind: 'removed' });
  ok(gone === '語釈: x → —', 'a removal still shows what would be lost', gone);

  const same = R.registerLine({ field: 'note', label: '見出し', stored: 'あ', candidate: 'あ', kind: 'same' });
  ok(same === '見出し: あ', 'an unchanged field states one value, not an arrow', same);
}

console.log('══ the summary sizes the change before the eye reads it ══');
{
  const stored = R.snapshotOf({ key: 'あ', class: 'serifu', payload: {} });
  ok(R.registerSummary(R.diffRegisters(stored, { note: 'あ', cls: 'serifu' })) === '台帳の記録と同じ',
    'no movement says so plainly');
  const two = R.diffRegisters(stored, { note: 'い', cls: 'skeletal' });
  ok(R.registerSummary(two).includes('2点'), 'otherwise it counts', R.registerSummary(two));
}

console.log('══ comparison is by VALUE, not by shape ══');
{
  const stored = R.snapshotOf({ key: 'k', class: 'skeletal', payload: { parts: ['はず', 'まずは'] } });
  ok(byField(R.diffRegisters(stored, { note: 'k', cls: 'skeletal', parts: ['はず', 'まずは'] }), 'parts').kind === 'same',
    'the same parts in a new array are the same value');
  ok(byField(R.diffRegisters(stored, { note: 'k', cls: 'skeletal', parts: ['はず', '', 'まずは'] }), 'parts').kind === 'same',
    'an empty component is not a change — the join drops it');
  ok(byField(R.diffRegisters(stored, { note: 'k', cls: 'skeletal', parts: ['まずは', 'はず'] }), 'parts').kind === 'changed',
    'but ORDER is meaning: reversed poles are a different link');
  const ws = R.snapshotOf({ key: 'k', class: 'serifu', payload: { gloss: '  x  ' } });
  ok(byField(R.diffRegisters(ws, { note: 'k', cls: 'serifu', gloss: 'x' }), 'gloss').kind === 'same',
    'and surrounding whitespace is not an edit');
}

console.log(`\n${fail ? '✗' : '✓'} registers: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
