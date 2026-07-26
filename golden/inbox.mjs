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

console.log(fail ? `\n✗ inbox: ${fail} failed (${pass} passed)` : `\n✓ inbox: all ${pass} pass`);
process.exit(fail ? 1 : 0);
