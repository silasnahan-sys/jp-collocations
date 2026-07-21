/**
 * golden/plex.mjs — §25.4 Plex clock (b) + clips. The pure parser/picker/URL/
 * arg builders that quarantine all Plex knowledge (src/notes/plex.ts). The
 * live poll + ffmpeg run live in main.ts and only pass bytes through these.
 *
 * Run:  node golden/plex.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const P = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'plex.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const playingBody = JSON.stringify({
  MediaContainer: {
    size: 1,
    Metadata: [{
      title: 'The Body in Question',
      grandparentTitle: 'Bones',
      type: 'episode',
      viewOffset: 725000,      // 12:05
      duration: 1320000,       // 22:00
      Player: { state: 'playing' },
      Media: [{ Part: [{ key: '/library/parts/9876/1700000000/episode.mkv', duration: 1320000 }] }],
    }],
  },
});

console.log('══ parsePlexSessions: the documented shape ══');
{
  const r = P.parsePlexSessions(200, playingBody);
  check('playing session parses ok', r.ok && r.sessions.length === 1, JSON.stringify(r));
  const s = r.ok ? r.sessions[0] : {};
  check('episode title read (title)', s.title === 'The Body in Question', s.title);
  check('show read (grandparentTitle)', s.show === 'Bones', s.show);
  check('viewOffset ms → seconds', s.viewOffsetSec === 725, String(s.viewOffsetSec));
  check('duration ms → seconds', s.durationSec === 1320, String(s.durationSec));
  check('not paused when state=playing', s.paused === false, String(s.paused));
  check('partKey read (Media[0].Part[0].key)', s.partKey === '/library/parts/9876/1700000000/episode.mkv', s.partKey);
}

console.log('══ paused / buffering both freeze the clock ══');
{
  const paused = playingBody.replace('"state":"playing"', '"state":"paused"');
  const buffering = playingBody.replace('"state":"playing"', '"state":"buffering"');
  check('state=paused → paused true', P.parsePlexSessions(200, paused).sessions[0].paused === true);
  check('state=buffering → paused true', P.parsePlexSessions(200, buffering).sessions[0].paused === true);
}

console.log('══ empty server + auth/transport failures ══');
{
  const empty = P.parsePlexSessions(200, JSON.stringify({ MediaContainer: { size: 0 } }));
  check('nothing playing → ok with 0 sessions', empty.ok && empty.sessions.length === 0, JSON.stringify(empty));
  const unauth = P.parsePlexSessions(401, '<html>401</html>');
  check('HTTP 401 → ok:false, verbatim + token hint', !unauth.ok && /401/.test(unauth.error) && /Token/.test(unauth.error), JSON.stringify(unauth));
  check('HTTP 500 → ok:false with status', (() => { const r = P.parsePlexSessions(500, ''); return !r.ok && /500/.test(r.error); })());
  const notJson = P.parsePlexSessions(200, 'not json at all');
  check('200 but non-JSON → ok:false (soft)', !notJson.ok, JSON.stringify(notJson));
}

console.log('══ tolerance: unverified servers degrade, never crash ══');
{
  // viewOffset as a string, no Player block, no Media block
  const loose = JSON.stringify({
    MediaContainer: { Metadata: [{ title: 'X', viewOffset: '90000' }] },
  });
  const r = P.parsePlexSessions(200, loose);
  const s = r.ok ? r.sessions[0] : {};
  check('string viewOffset coerced', s.viewOffsetSec === 90, String(s.viewOffsetSec));
  check('missing Player → defaults to playing', s.paused === false, String(s.paused));
  check('missing Media → partKey undefined', s.partKey === undefined, String(s.partKey));
  check('music item with no viewOffset → 0, not NaN', (() => {
    const m = P.parsePlexSessions(200, JSON.stringify({ MediaContainer: { Metadata: [{ title: 'song' }] } }));
    return m.ok && m.sessions[0].viewOffsetSec === 0;
  })());
}

console.log('══ pickPlexSession: which session is the note following ══');
{
  const solo = P.parsePlexSessions(200, playingBody).sessions;
  check('single session always wins', P.pickPlexSession(solo, null) === solo[0]);

  const many = [
    { title: 'The Body in Question', show: 'Bones', viewOffsetSec: 10, paused: false },
    { title: '容疑者Xの献身', show: 'ガリレオ', viewOffsetSec: 20, paused: false },
  ];
  check('multi: matches note title fuzzily', P.pickPlexSession(many, { title: '容疑者Xの献身' })?.show === 'ガリレオ');
  check('multi: matches by show when title misses', P.pickPlexSession(many, { show: 'Bones' })?.title === 'The Body in Question');
  check('multi: no confident match → null (caller lists)', P.pickPlexSession(many, { title: '全然関係ないタイトル' }) === null);
}

console.log('══ URL + ffmpeg arg builders ══');
{
  check('base URL trailing slash trimmed', P.normalizePlexBaseUrl('http://10.0.0.5:32400/') === 'http://10.0.0.5:32400');
  check('sessions URL carries token', P.plexSessionsUrl('http://10.0.0.5:32400', 'TOK') === 'http://10.0.0.5:32400/status/sessions?X-Plex-Token=TOK');
  check('part URL joins key + token', P.plexPartUrl('http://10.0.0.5:32400', '/library/parts/1/f.mkv', 'T K') === 'http://10.0.0.5:32400/library/parts/1/f.mkv?X-Plex-Token=T%20K');

  const clip = P.buildPlexClipArgs('http://h/part?X-Plex-Token=T', 725, 733, '/out/clip.mp3', 'mp3');
  check('clip: input-seek (-ss before -i)', clip.indexOf('-ss') < clip.indexOf('-i') && clip[clip.indexOf('-ss') + 1] === '725');
  check('clip: duration is end-start', clip[clip.indexOf('-t') + 1] === '8');
  check('clip: audio-only + mp3 codec + out last', clip.includes('-vn') && clip.includes('libmp3lame') && clip[clip.length - 1] === '/out/clip.mp3');

  const still = P.buildPlexStillArgs('http://h/part?X-Plex-Token=T', 725, '/out/still.jpg');
  check('still: single frame at -ss', still.includes('-frames:v') && still[still.indexOf('-frames:v') + 1] === '1' && still[still.indexOf('-ss') + 1] === '725');
}

console.log(fail ? `\n✗ plex: ${fail} failed (${pass} passed)` : `\n✓ plex: all ${pass} pass`);
process.exit(fail ? 1 : 0);
