/**
 * golden/ui-gestures.mjs — the input layer, finally under test.
 *
 * Two rules the plugin learned the expensive way and then held only in prose:
 *
 *  1. `draggable="true"` SUPPRESSES TEXT SELECTION inside the element it is set
 *     on. Arming a whole row therefore silently costs the ability to select
 *     anything written in it. The fix was `{ grip }` — and nothing stopped the
 *     next call site from forgetting.
 *
 *  2. A lookup that lands after the selection moved on must write into NOTHING,
 *     and a lookup that THREW must not read as "no such word". One of those is
 *     a race, the other is a claim about the language we are in no position to
 *     make.
 *
 * Both are decided by a few attribute writes and a counter, which is exactly
 * what a small DOM can check. Run:  node golden/ui-gestures.mjs
 */
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { installDom, tick } from './stub/dom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(HERE, 'stub', 'loader.mjs')));

const dom = installDom();
const src = (...p) => pathToFileURL(join(HERE, '..', 'src', ...p)).href;

const DragOut = await import(src('ui', 'drag-out.ts'));
const Echo = await import(src('ui', 'selection-echo.ts'));
const Posture = await import(src('ui', 'posture.ts'));

let n = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  n++;
  if (cond) console.log(`  ✓ ${name}`);
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const row = () => {
  const r = dom.body.createDiv('jp-row');
  const head = r.createDiv('jp-row-head');
  const bodyText = r.createDiv({ cls: 'jp-row-body', text: '日本語の本文' });
  return { r, head, bodyText };
};
const PAYLOAD = () => ({ text: '気になる', kind: 'entry', sub: 'きになる' });

console.log('══ the drag is armed on the GRIP, never on the prose ══');
{
  const { r, head } = row();
  DragOut.makeDraggable(r, PAYLOAD, { grip: head });

  ok(head.getAttribute('draggable') === 'true', 'the grip carries draggable');
  ok(r.getAttribute('draggable') === null,
    'the ROW does not — this is the whole rule; `draggable` kills selection inside it');
  ok(head.hasClass('jp-draggable'), 'the grip is marked as the handle');
  ok(!r.hasClass('jp-draggable'), 'the row is not');
  ok(head.listenerCount('dragstart') === 1, 'dragstart is bound to the grip');
  ok(r.listenerCount('dragstart') === 0, 'and not to the row');
  ok(head.listenerCount('pointerdown') === 1,
    'the synthetic carry is on the grip too — a long press held on the row is how touch opens a selection');
}

console.log('\n══ without a grip, the element itself is armed (unchanged) ══');
{
  const { r } = row();
  DragOut.makeDraggable(r, PAYLOAD);
  ok(r.getAttribute('draggable') === 'true', 'no grip → the element is the handle');
  ok(r.listenerCount('dragstart') === 1, 'bound once');
}

console.log('\n══ arming twice does not double-bind ══');
{
  const { r, head } = row();
  DragOut.makeDraggable(r, PAYLOAD, { grip: head });
  DragOut.makeDraggable(r, PAYLOAD, { grip: head });
  DragOut.makeDraggable(r, PAYLOAD, { grip: head });
  // Rows re-render constantly; a re-arm that stacked listeners would fire the
  // drag three times and put three pills in the air.
  ok(head.listenerCount('dragstart') === 1, 'a re-render cannot stack dragstart handlers');
  ok(head.listenerCount('pointerdown') === 1, '…nor pointer handlers');
}

console.log('\n══ what LIFTS is the row; what you lifted it BY is the grip ══');
{
  const { r, head } = row();
  DragOut.makeDraggable(r, PAYLOAD, { grip: head });
  const dt = { setData() {}, setDragImage() {}, effectAllowed: '' };
  head.fire('dragstart', { dataTransfer: dt });
  ok(r.hasClass('jp-draggable--lifted'),
    'the ROW dims — the thing you are carrying is the row, not the handle');
  ok(!head.hasClass('jp-draggable--lifted'), 'the grip itself does not');
  head.fire('dragend');
  ok(!r.hasClass('jp-draggable--lifted'), 'and it comes back on dragend');
}

console.log('\n══ a payload with no text declines the drag ══');
{
  const { r, head } = row();
  DragOut.makeDraggable(r, () => ({ text: '   ', kind: 'entry' }), { grip: head });
  const dt = { setData() {}, setDragImage() {}, effectAllowed: '' };
  const e = head.fire('dragstart', { dataTransfer: dt });
  ok(e.defaultPrevented, 'an empty row is not draggable — the drag is cancelled, not sent blank');
  ok(!r.hasClass('jp-draggable--lifted'), 'and nothing is dimmed for a drag that never started');
}

console.log('\n══ all three flavours go on the wire, every time ══');
{
  const { r, head } = row();
  DragOut.makeDraggable(r, PAYLOAD, { grip: head });
  const sent = {};
  head.fire('dragstart', {
    dataTransfer: { effectAllowed: '', setData: (k, v) => (sent[k] = v), setDragImage() {} },
  });
  ok(sent['text/plain'] === '気になる', 'text/plain — Apple Notes, the editor, anything');
  ok(/<b>気になる<\/b>/.test(sent['text/html'] ?? ''), 'text/html — the shape survives arrival');
  const own = JSON.parse(sent['application/x-jpc-drag'] ?? '{}');
  ok(own.kind === 'entry' && own.text === '気になる',
    'application/x-jpc-drag — our own receivers keep provenance (§28 S2)');
}

// ── the selection echo ────────────────────────────────────────────────────────

Posture.configurePosture({ override: 'desk' });

const echoHost = () => {
  const host = dom.body.createDiv('jp-host');
  host.setRect({ left: 0, top: 0, width: 800, height: 600 });
  return host;
};
const bar = (host) => host.children.find((c) => c.hasClass('jp-echo')) ?? null;
const headOf = (host) => bar(host)?.children.find((c) => c.hasClass('jp-echo-head')) ?? null;
/** Drive one selection through the echo's 160ms settle. */
const selectAndSettle = async (host, node, text) => {
  dom.selection.select(node, text);
  dom.document.fire('selectionchange');
  await tick(200);
};

console.log('\n══ a slow answer cannot land in a card that moved on ══');
{
  const host = echoHost();
  const text1 = host.createDiv({ cls: 'p', text: 'あああ' });
  let release;
  const pending = new Promise((r) => (release = r));
  let calls = 0;

  Echo.attachSelectionEcho(host, {
    surface: 'dict',
    run: () => {},
    look: (q) => { calls++; return q === '第一' ? pending : Promise.resolve({ headword: q, def: '二番目' }); },
  });

  await selectAndSettle(host, text1, '第一');
  ok(calls === 1, 'the first selection asked the shelf');
  const firstHead = headOf(host);
  ok(!!firstHead, 'a card appeared with a waiting head');

  // The hand moves on before the shelf answers.
  await selectAndSettle(host, text1, '第二');
  ok(headOf(host)?.textContent.includes('第二'), 'the second answer is showing');

  // …and only NOW does the first lookup come back.
  release({ headword: '第一', def: 'これは古い答え' });
  await tick(20);
  const shown = headOf(host)?.textContent ?? '';
  ok(!shown.includes('これは古い答え'),
    'the stale answer writes into NOTHING — it does not overwrite the live card');
  ok(shown.includes('第二'), 'the live answer is untouched', shown);
}

console.log('\n══ a read that threw is not a word that does not exist ══');
{
  const host = echoHost();
  const p = host.createDiv({ cls: 'p', text: 'text' });
  Echo.attachSelectionEcho(host, {
    surface: 'dict', run: () => {},
    look: () => Promise.reject(new Error('shelf unreadable')),
  });
  await selectAndSettle(host, p, '壊れた');
  await tick(20);
  const t = headOf(host)?.textContent ?? '';
  ok(t.includes('辞書を読めませんでした'), 'a failed read says so', t);
  ok(!t.includes('該当なし'),
    '…and never says "no such word", which is a claim a thrown read cannot support');
}

console.log('\n══ absent and blank are different facts (§28 S6) ══');
{
  const host = echoHost();
  const p = host.createDiv({ cls: 'p', text: 'text' });
  Echo.attachSelectionEcho(host, { surface: 'dict', run: () => {}, look: () => Promise.resolve(null) });
  await selectAndSettle(host, p, 'ないもの');
  await tick(20);
  const head = headOf(host);
  ok(head?.textContent.includes('辞書に該当なし'), 'the shelf having nothing is stated, not left blank');
  ok(head?.hasClass('jp-echo-head--none'), 'and marked, so it cannot be styled as an answer');
}

console.log('\n══ a phrase with no verbs still has a meaning ══');
{
  const host = echoHost();
  const p = host.createDiv({ cls: 'p', text: 'text' });
  Echo.attachSelectionEcho(host, {
    surface: 'dict',
    run: () => {},
    look: () => Promise.resolve({ headword: '手前', reading: 'てまえ', def: 'this side' }),
  });
  await selectAndSettle(host, p, '手前');
  await tick(20);
  // Before the answer existed, a card with no verbs simply did not appear —
  // which is the case where you most needed to be told what the phrase was.
  ok(!!bar(host), 'the card appears for the answer alone');
  ok(headOf(host)?.textContent.includes('てまえ'), 'the reading is on it');
}

console.log('\n══ a selection outside this view is not this view\'s business ══');
{
  const host = echoHost();
  const elsewhere = dom.body.createDiv({ cls: 'other', text: 'よそ' });
  Echo.attachSelectionEcho(host, {
    surface: 'dict', run: () => {},
    look: () => Promise.resolve({ headword: 'x', def: 'y' }),
  });
  await selectAndSettle(host, elsewhere, '他所の選択');
  ok(!bar(host), 'a highlight in the pane next door raises no card here');
}

console.log('\n══ a one-character tap is not a selection ══');
{
  const host = echoHost();
  const p = host.createDiv({ cls: 'p', text: 'text' });
  let asked = 0;
  Echo.attachSelectionEcho(host, {
    surface: 'dict', run: () => {},
    look: () => { asked++; return Promise.resolve(null); },
  });
  await selectAndSettle(host, p, '国');
  ok(!bar(host) && asked === 0, 'a stray tap that grabbed one character asks nothing');
}

console.log('\n══ detaching leaves nothing behind ══');
{
  const host = echoHost();
  const p = host.createDiv({ cls: 'p', text: 'text' });
  const before = dom.document.listenerCount('selectionchange');
  const detach = Echo.attachSelectionEcho(host, {
    surface: 'dict', run: () => {}, look: () => Promise.resolve(null),
  });
  await selectAndSettle(host, p, 'のこる');
  await tick(20);
  ok(dom.document.listenerCount('selectionchange') === before + 1, 'one listener while armed');
  detach();
  ok(dom.document.listenerCount('selectionchange') === before, 'and none after detach');
  ok(!bar(host), 'the card goes with it');
  ok(!host.hasClass('jp-echo-host'), 'and so does the positioning context it added');
}

console.log('\n══ arming the same host twice returns the same detach ══');
{
  const host = echoHost();
  const deps = { surface: 'dict', run: () => {}, look: () => Promise.resolve(null) };
  const a = Echo.attachSelectionEcho(host, deps);
  const b = Echo.attachSelectionEcho(host, deps);
  ok(a === b, 'idempotent per element — a re-render cannot stack echoes');
  a();
}

console.log(fail ? `\n✗ ${fail}/${n} checks failed` : `\n✓ all ${n} checks pass`);
process.exit(fail ? 1 : 0);
