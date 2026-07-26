/**
 * golden/follow.mjs — §25 media engagement: the 今ここ clock, 発話セッション
 * model/store, mark cards, and the podcast player-screenshot recognizer.
 *
 * Run:  node golden/follow.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (f) => pathToFileURL(join(HERE, '..', 'src', 'notes', f)).href;
const F = await import(src('follow.ts'));
const S = await import(src('speak-session.ts'));
const P = await import(src('player-shot.ts'));
const I = await import(src('inbox.ts'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const T0 = 1_700_000_000_000;

console.log('══ FollowClock: manual sync + wall clock (clock c) ══');
{
  check('no clock → no position', F.clockPosition(null, T0) === null);
  let c = F.syncClock(125, T0);
  check('sync anchors position', F.clockPosition(c, T0) === 125);
  check('position advances on the wall clock', F.clockPosition(c, T0 + 10_000) === 135);
  c = F.pauseClock(c, T0 + 10_000);
  check('pause freezes position', F.clockPosition(c, T0 + 60_000) === 135);
  check('double pause is idempotent', F.pauseClock(c, T0 + 70_000) === c);
  c = F.resumeClock(c, T0 + 60_000);
  check('resume re-anchors from the frozen position', F.clockPosition(c, T0 + 65_000) === 140);
  check('double resume is idempotent', F.resumeClock(c, T0 + 65_000) === c);
}

console.log('══ currentLineIndex: position → line (binary search) ══');
{
  const lines = [
    { tStartSec: 0 }, { tStartSec: 10 }, { tStartSec: 25 }, { tStartSec: 60 },
  ];
  check('exact stamp wins', F.currentLineIndex(lines, 25) === 2);
  check('between stamps → the earlier line', F.currentLineIndex(lines, 24.9) === 1);
  check('past the end → last line', F.currentLineIndex(lines, 999) === 3);
  check('before the first stamp → -1', F.currentLineIndex(lines, -1) === -1);
  check('untimed lines never win', F.currentLineIndex([{ text: 'x' }, { tStartSec: 5 }], 10) === 1);
  check('all-untimed → -1', F.currentLineIndex([{}, {}], 10) === -1);
}

console.log('══ 発話セッション: model + points-from-RATINGS ══');
{
  const s = S.newSession({
    file: 'T/ep1.md', mode: 'narikiri', constraint: { kind: 'counter', goalPoints: 30 },
    role: 'B', aspects: S.DEFAULT_ASPECTS, now: T0,
  });
  check('session freezes the aspect list', s.aspects.length === 6 && s.aspects[0] === '一貫性');
  const m1 = S.newMark({ kind: 'speak', tSec: 100, lineIndex: 4, lineText: 'それは面白い', now: T0 + 1000 });
  const m2 = S.newMark({ kind: 'note', tSec: 200, lineIndex: 9, lineText: '感謝した方がいい', now: T0 + 2000 });
  s.marks.push(m1, m2);
  check('points are ZERO before any rating (speaking alone earns nothing)', S.sessionPoints(s) === 0);
  m1.ratings = { 一貫性: 3, 簡潔さ: 2 };
  check('points = sum of rating values', S.sessionPoints(s) === 5);
  m2.ratings = { 一貫性: 4 };            // ratings on a 📍 must not count
  check('📍 marks never earn points', S.sessionPoints(s) === 5);
  check('speakMarks filters 🎤 only', S.speakMarks(s).length === 1);
}

console.log('══ SpeakStore: persistence + rating rules ══');
{
  let saved = null;
  const store = new S.SpeakStore(async (d) => { saved = d; });
  const s = S.newSession({ file: 'T/ep1.md', mode: 'jiyu', constraint: { kind: 'none' }, aspects: ['一貫性'], now: T0 });
  await store.upsert(s);
  const mk = S.newMark({ kind: 'speak', lineIndex: 0, lineText: 'x', now: T0 + 1 });
  check('addMark on live session', await store.addMark(s.id, mk) && saved.sessions[0].marks.length === 1);
  check('rating clamps to 0–4 and drops junk', await store.rateMark(s.id, mk.id, { 一貫性: 3, bogus: 9 }) &&
    saved.sessions[0].marks[0].ratings['一貫性'] === 3 && !('bogus' in saved.sessions[0].marks[0].ratings));
  const noteMk = S.newMark({ kind: 'note', lineIndex: 1, lineText: 'y', now: T0 + 2 });
  await store.addMark(s.id, noteMk);
  check('rating a 📍 refused', !(await store.rateMark(s.id, noteMk.id, { 一貫性: 2 })));
  await store.end(s.id, T0 + 99);
  check('marks refused after end', !(await store.addMark(s.id, S.newMark({ kind: 'speak', lineIndex: 2, lineText: 'z', now: T0 + 100 }))));
  const re = new S.SpeakStore(async () => {});
  re.load(saved);
  check('roundtrips through load', re.forFile('T/ep1.md').length === 1 && re.all()[0].endedAt === T0 + 99);
}

console.log('══ mark cards (§25.1) ══');
{
  const m = I.markCard({ medium: 'podcast', file: 'P/ep.md', tSec: 754, sourceName: 'ゆる言語学ラジオ', seed: '皮肉', wallClock: T0 }, T0 + 5);
  check('mark card carries the pointer + seed as content', m.kind === 'mark' && m.mark.tSec === 754 && m.content === '皮肉' && m.origin === 'ゆる言語学ラジオ');
  const m2 = I.markCard({ medium: 'tv', sourceName: '番組', wallClock: T0 }, T0 + 5);
  check('seedless mark has empty content, never undefined', m2.content === '');
  check('mark cards never enter 読書セッション groups', I.sessionGroups([m, m2]).length === 0);
}

console.log('══ player-shot: elapsed parsing + episode matching ══');
{
  check('MM:SS', P.parseElapsed('12:34') === 754);
  check('H:MM:SS', P.parseElapsed('1:02:33') === 3753);
  check('remaining time (-12:34) rejected', P.parseElapsed('-12:34') === null);
  check('junk rejected', P.parseElapsed('12時34分') === null && P.parseElapsed(42) === null);

  const api = (obj) => JSON.stringify({ content: [{ text: '説明です\n' + JSON.stringify(obj) }] });
  const ok = P.parsePlayerShot(200, api({ episode: '#123 「皮肉」の言語学', show: 'ゆる言語学ラジオ', elapsed: '12:34' }));
  check('parses episode/show/elapsed out of chatty output', ok.ok && ok.shot.elapsedSec === 754 && ok.shot.show === 'ゆる言語学ラジオ');
  const noTime = P.parsePlayerShot(200, api({ episode: 'ep', elapsed: null }));
  check('missing elapsed → coarse mark (null), not failure', noTime.ok && noTime.shot.elapsedSec === null);
  check('missing episode → honest failure', !P.parsePlayerShot(200, api({ elapsed: '1:00' })).ok);
  check('HTTP error surfaced', !P.parsePlayerShot(500, '{}').ok);

  const notes = [
    { title: '#122 語源の話' },
    { title: '#123 「皮肉」の言語学 — アイロニー再考' },
    { title: '別番組 第4回' },
  ];
  check('truncated screenshot title matches by containment',
    P.matchEpisodeNote('#123 「皮肉」の言語学…', notes)?.title === notes[1].title);
  check('exact match wins', P.matchEpisodeNote('#122 語源の話', notes)?.title === notes[0].title);
  check('unrelated title → null, never a confident wrong pick',
    P.matchEpisodeNote('全然違うポッドキャスト', notes) === null);
}

console.log(fail ? `\n✗ follow: ${fail} failed (${pass} passed)` : `\n✓ follow: all ${pass} pass`);
process.exit(fail ? 1 : 0);
