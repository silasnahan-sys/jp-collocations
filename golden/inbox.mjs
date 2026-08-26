/**
 * golden/inbox.mjs — 収集トレイ (§22.8): content-aware shaping + the
 * nothing-is-lost store rules.
 *
 * Run:  node golden/inbox.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const I = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'inbox.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const T0 = 1_700_000_000_000;

console.log('══ shapeDrop: real-time content-aware formatting ══');
{
  const url = I.shapeDrop('https://note.com/user/n/abc123', T0);
  check('URL → url card with host origin', url.kind === 'url' && url.origin === 'note.com');

  const dlg = I.shapeDrop('A: 行くんだったらさ\nB: えー本当に？\nA: うん、早くしなきゃ', T0);
  check('speaker lines → dialogue with parsed turns', dlg.kind === 'dialogue' && dlg.lines.length === 3 && dlg.lines[0].speaker === 'A' && dlg.lines[1].text === 'えー本当に？', JSON.stringify(dlg.lines));

  const sent = I.shapeDrop('彼は約束をちゃんと守った。', T0);
  check('one JP sentence → sentence', sent.kind === 'sentence');

  const word = I.shapeDrop('破綻', T0);
  check('short bare JP → word', word.kind === 'word');

  const en = I.shapeDrop('just some english notes', T0);
  check('non-JP text still kept (never rejected)', en.kind === 'text');

  const img = I.imageCard('attachments/manga-page.png', T0, 'Manatan');
  check('image card carries vault path + origin', img.kind === 'image' && img.content.endsWith('.png') && img.origin === 'Manatan');

  check('multi-line without speakers is NOT dialogue', I.shapeDrop('一行目の文です。\n二行目の文です。', T0).kind !== 'dialogue');
}

console.log('══ store: nothing lost, nothing duplicated ══');
{
  let saved = null;
  const store = new I.InboxStore(async (d) => { saved = d; });
  const card = I.shapeDrop('気になる話', T0);
  check('add persists', await store.add(card) && saved.cards.length === 1);
  check('identical re-drop refused (same content+time)', !(await store.add(card)) && store.size() === 1);
  const later = I.shapeDrop('気になる話', T0 + 5000);
  check('same content LATER is a new card (id is content+time)', await store.add(later) && store.size() === 2);
  check('newest first', store.all()[0].createdAt === T0 + 5000);
  await store.remove(card.id);
  check('remove persists', store.size() === 1 && saved.cards.length === 1);
  const re = new I.InboxStore(async () => {});
  re.load(saved);
  check('roundtrips through load', re.size() === 1 && re.all()[0].id === later.id);
}

console.log('══ sessionGroups: 読書セッション time-clustering (§25.7) ══');
{
  const MIN = 60_000;
  const img = (path, at) => I.imageCard(path, at);
  const cards = [
    img('a/p1.png', T0),                    // evening session, 3 shots
    img('a/p2.png', T0 + 2 * MIN),
    img('a/p3.png', T0 + 9 * MIN),
    I.shapeDrop('気になる話', T0 + 5 * MIN),  // non-image mixed in — ignored
    img('b/p1.png', T0 + 120 * MIN),        // next sitting (gap > 30min)
  ];
  const groups = I.sessionGroups(cards);
  check('two sessions from a >30min gap', groups.length === 2, `got ${groups.length}`);
  check('newest session first', groups[0].cards[0].content === 'b/p1.png');
  check('cards within a session in SHOT order (reading order)',
    groups[1].cards.map((c) => c.content).join(',') === 'a/p1.png,a/p2.png,a/p3.png',
    groups[1].cards.map((c) => c.content).join(','));
  check('non-image cards never enter a session', groups.flatMap((g) => g.cards).every((c) => c.kind === 'image'));
  check('session start/end span the shots', groups[1].start === T0 && groups[1].end === T0 + 9 * MIN);
  check('chain rule: each shot within gap of the PREVIOUS shot joins',
    I.sessionGroups([img('c/1.png', T0), img('c/2.png', T0 + 25 * MIN), img('c/3.png', T0 + 50 * MIN)]).length === 1);
  check('singleton session possible', I.sessionGroups([img('d/1.png', T0)]).length === 1);
  check('unsorted input is sorted by shot time',
    I.sessionGroups([img('e/2.png', T0 + MIN), img('e/1.png', T0)])[0].cards[0].content === 'e/1.png');
}

console.log('\n══ a mark carries WHAT WAS SAID, resolved once ══');
{
  // Measured on the live vault 2026-08-08: 98 of 106 tray cards were marks, and
  // every one rendered as a timestamp plus 「（メモなし）」 because a MarkRef held
  // only `file` + `tSec`. Ninety-eight indistinguishable rows is why none of
  // them were ever harvested — you could not tell which was which without
  // opening the capture modal on it, one at a time, to find out.
  const mk = (id, over = {}) => ({
    id, kind: 'mark', content: '', createdAt: T0,
    mark: { medium: 'yt', file: 'Transcripts/a.md', tSec: 120, wallClock: T0, ...over },
  });

  let writes = 0;
  const store = new I.InboxStore(async () => { writes++; });
  store.load({ cards: [
    mk('m1'),
    mk('m2', { lineText: '' }),                 // resolved, and there was nothing there
    mk('m3', { lineText: 'もう二度と行かない' }), // resolved
    mk('m4', { file: undefined }),               // unresolvable: no transcript
    mk('m5', { tSec: undefined }),               // unresolvable: no time
    { id: 'w1', kind: 'word', content: '破綻', createdAt: T0 },
  ] });

  const todo = store.marksNeedingLine().map((c) => c.id).sort();
  check('only marks that have never been looked up are queued',
    JSON.stringify(todo) === JSON.stringify(['m1']), JSON.stringify(todo));

  // The three states are three different FACTS. Collapsing "resolved to
  // nothing" into "not looked up" is what makes a mark retry on every render
  // for the rest of the vault's life.
  check('a mark resolved to nothing is NOT re-queued',
    !store.marksNeedingLine().some((c) => c.id === 'm2'));
  check('a mark with no file or no time is never queued',
    !store.marksNeedingLine().some((c) => c.id === 'm4' || c.id === 'm5'));
  check('a non-mark card is never queued',
    !store.marksNeedingLine().some((c) => c.id === 'w1'));

  const n = await store.setMarkLines([
    { id: 'm1', line: 'それはちょっと難しいですね' },
    { id: 'w1', line: 'ignored — not a mark' },
    { id: 'nope', line: 'ignored — no such card' },
  ]);
  check('only real mark cards are written', n === 1, String(n));
  check('the line is now on the mark',
    store.all().find((c) => c.id === 'm1').mark.lineText === 'それはちょっと難しいですね');
  check('…and the queue is empty, so the backfill runs exactly once ever',
    store.marksNeedingLine().length === 0);

  // One write for the whole batch. ~100 marks resolved through a per-card
  // setter would persist the blob ~100 times; this vault has already paid that
  // bill once (30MB of IO for a single checkbox).
  check('a batch is ONE persist, not one per card', writes === 1, `${writes} writes`);

  const none = await store.setMarkLines([]);
  check('an empty batch writes nothing at all', none === 0 && writes === 1);

  // Resolving to '' has to be persistable, or the unresolvable mark above
  // could never be marked unresolvable.
  await store.setMarkLines([{ id: 'm1', line: '' }]);
  check('an empty answer is a real, stored answer',
    store.all().find((c) => c.id === 'm1').mark.lineText === '' &&
    store.marksNeedingLine().length === 0);
}

console.log('══ 鋳造: duplicate is a mint, and the copy seats beside its sibling ══');
{
  const s = new I.InboxStore(async () => {});
  const a = I.shapeDrop('外的要因に左右される', 1000, 'test');
  const b = I.shapeDrop('まったく別のカード', 2000, 'test');
  await s.add(a);
  await s.add(b);
  const copy = await s.duplicate(a.id);
  check('the twin exists with a fresh id', !!copy && copy.id !== a.id);
  check('the twin keeps the sibling time (adjacent in the feed)', copy.createdAt === a.createdAt);
  check('the twin carries the content', copy.content === a.content);
  const order = s.all().map((c) => c.id);
  check('the copy seats directly after the original',
    order.indexOf(copy.id) === order.indexOf(a.id) + 1, order.join(','));
  const copy2 = await s.duplicate(a.id);
  check('a second mint gets its own id', copy2.id !== copy.id);
  check('a ghost id mints nothing', await s.duplicate('inb-nope') === null);
  // a shared container mutated later must not write through to the twin
  const withSaid = I.shapeDrop('はず', 3000, 'test');
  withSaid.said = 'やはり向き不向きがあるはずで';
  await s.add(withSaid);
  const twin = await s.duplicate(withSaid.id);
  twin.said = '書き換えた';
  check('twins are clones, not aliases', s.all().find((c) => c.id === withSaid.id).said === 'やはり向き不向きがあるはずで');
}

console.log('══ 現在線: the rail sits between the new and the already-read ══');
{
  const feed = [5000, 4000, 3000, 2000, 1000]; // desc, like the tray renders
  check('the rail sits before the first already-seen item',
    I.nowlineIndex(feed, 3500) === 2, String(I.nowlineIndex(feed, 3500)));
  check('a floor ON an item counts that item as seen',
    I.nowlineIndex(feed, 3000) === 2);
  check('nothing new → the rail at the top, saying so',
    I.nowlineIndex(feed, 9000) === 0);
  check('everything new → the rail under it all',
    I.nowlineIndex(feed, 500) === 5);
  check('never visited → no line to draw',
    I.nowlineIndex(feed, 0) === -1);
  const day = 24 * 60 * 60 * 1000;
  const noon = new Date(2026, 7, 26, 12, 4).getTime();
  check('same-day label is the minute alone',
    I.nowlineLabel(noon - 60_000, noon) === '前回ここまで ・ 12:03',
    I.nowlineLabel(noon - 60_000, noon));
  check('an older day carries its date',
    I.nowlineLabel(noon - 2 * day, noon).startsWith('前回ここまで ・ 8/24'),
    I.nowlineLabel(noon - 2 * day, noon));
}

console.log(fail ? `\n✗ inbox: ${fail} failed (${pass} passed)` : `\n✓ inbox: all ${pass} pass`);
process.exit(fail ? 1 : 0);
