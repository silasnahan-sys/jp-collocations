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

// ── Subtitles: the spine, not an extra ─────────────────────────────────────
// Plex knows which episode is playing AND carries its subtitle tracks. Until
// now nothing asked, so a Plex session gave you a clock over a transcript you
// had to hand-source from jimaku and paste in yourself. Choosing the track is
// the whole difficulty: a release ships several and the wrong one is silently
// useless rather than obviously broken.
const SUB_BODY = JSON.stringify({
  MediaContainer: {
    Metadata: [{
      title: 'Episode 1', grandparentTitle: '進撃の巨人', ratingKey: 45678,
      viewOffset: 60000, Player: { state: 'playing' },
      Media: [{ Part: [{
        key: '/library/parts/9876/x/episode.mkv',
        Stream: [
          { streamType: 1, codec: 'h264' },
          { streamType: 2, codec: 'aac', languageCode: 'jpn' },
          { id: 11, streamType: 3, codec: 'pgs', languageCode: 'jpn', key: '/library/streams/11', title: '日本語(画像)' },
          { id: 12, streamType: 3, codec: 'ass', languageCode: 'jpn', key: '/library/streams/12', title: 'Signs & Songs', forced: true },
          { id: 13, streamType: 3, codec: 'ass', languageCode: 'jpn', key: '/library/streams/13', title: 'Full Dialogue' },
          { id: 14, streamType: 3, codec: 'srt', languageCode: 'eng', key: '/library/streams/14', selected: true },
          { id: 15, streamType: 3, codec: 'ass', languageCode: 'jpn' },
        ],
      }] }],
    }],
  },
});

console.log('\n══ streams come off the session ══');
{
  const r = P.parsePlexSessions(200, SUB_BODY);
  const s = r.ok ? r.sessions[0] : { streams: [] };
  check('ratingKey read — the note can find this episode again', s.ratingKey === '45678', s.ratingKey);
  check('every stream parsed', s.streams.length === 7, String(s.streams.length));
  check('subtitle streams filtered by streamType 3', P.subtitleStreams(s).length === 5,
    String(P.subtitleStreams(s).length));
  check('a session with no Stream[] degrades to []',
    P.parsePlexSessions(200, playingBody).sessions[0].streams.length === 0);
}

console.log('\n══ picking the track: the wrong one is silently useless ══');
{
  const subs = P.subtitleStreams(P.parsePlexSessions(200, SUB_BODY).sessions[0]);
  const pick = P.pickSubtitleStream(subs);
  check('picks the Japanese FULL DIALOGUE track', pick && pick.key === '/library/streams/13',
    pick ? `${pick.key} ${pick.title}` : 'null');
  check('never a forced track — signs and songs are not a transcript',
    pick.forced !== true);
  check('never an image format — PGS/VobSub have nothing to parse',
    P.isTextSubtitle(pick) && !P.isTextSubtitle(subs[0]));
  check('never a track the server will not serve (no key)',
    !!pick.key);
  check('the English selected track loses to Japanese',
    pick.languageCode === 'jpn');

  // language preference is the caller's, not baked in
  const en = P.pickSubtitleStream(subs, { langPref: ['en', 'eng'] });
  check('langPref is honoured', en && en.languageCode === 'eng', en ? en.languageCode : 'null');

  // `selected` only breaks ties within the same language
  const tie = P.pickSubtitleStream([
    { streamType: 3, codec: 'srt', languageCode: 'ja', key: '/a' },
    { streamType: 3, codec: 'srt', languageCode: 'ja', key: '/b', selected: true },
  ]);
  check('selected breaks a tie', tie.key === '/b', tie.key);
}

console.log('\n══ refusing honestly beats an empty transcript ══');
{
  check('nothing to refuse when a pick exists',
    P.subtitleRefusal(P.subtitleStreams(P.parsePlexSessions(200, SUB_BODY).sessions[0])) === null);
  check('no subtitle tracks at all is SAID',
    /字幕トラックがありません/.test(P.subtitleRefusal([])));
  const imagesOnly = [{ streamType: 3, codec: 'pgs', languageCode: 'jpn', key: '/library/streams/11' }];
  check('image-only is explained by name, not as "0 cues"',
    /画像形式/.test(P.subtitleRefusal(imagesOnly)) && /pgs/.test(P.subtitleRefusal(imagesOnly)),
    P.subtitleRefusal(imagesOnly));
  const noKey = [{ streamType: 3, codec: 'ass', languageCode: 'jpn' }];
  check('an unfetchable track is explained too', !!P.subtitleRefusal(noKey), P.subtitleRefusal(noKey));
}

console.log('\n══ stream URLs ══');
{
  check('stream URL joins key + token',
    P.plexStreamUrl('http://tv:32400/', '/library/streams/13', 'TOK')
      === 'http://tv:32400/library/streams/13?X-Plex-Token=TOK');
  check('a key without a leading slash still works',
    P.plexStreamUrl('http://tv:32400', 'library/streams/13', 'TOK')
      === 'http://tv:32400/library/streams/13?X-Plex-Token=TOK');
  check('metadata URL for streams a session did not carry',
    P.plexMetadataUrl('http://tv:32400', '45678', 'TOK')
      === 'http://tv:32400/library/metadata/45678?X-Plex-Token=TOK');
  check('tokens are escaped', P.plexStreamUrl('http://h', '/s', 'a b&c').endsWith('a%20b%26c'));
}

console.log('\n══ the 接続テスト line — verify against a real server ══');
{
  const lines = P.describeSubtitles(P.subtitleStreams(P.parsePlexSessions(200, SUB_BODY).sessions[0]));
  check('one line per subtitle track', lines.length === 5, String(lines.length));
  check('names the image format so the user can see why it was skipped',
    lines.some((l) => /画像形式/.test(l)), lines.join(' | '));
  check('flags the forced track', lines.some((l) => /forced/.test(l)));
  check('flags an unfetchable track', lines.some((l) => /取得不可/.test(l)));
}

// ── Browsing: the other door ────────────────────────────────────────────────
// The only way in used to be "whatever is playing right now", fuzzy-matched to
// the open note — so the plugin's TV support required standing in front of the
// TV. Sections arrive as Directory[], content as Metadata[]; a caller should
// not have to know which endpoint returns which.
console.log('\n══ library listings ══');
{
  const sections = JSON.stringify({
    MediaContainer: { Directory: [
      { key: '2', title: 'アニメ', type: 'show' },
      { key: '3', title: '映画', type: 'movie' },
    ] },
  });
  const r = P.parsePlexItems(200, sections);
  check('sections parse from Directory[]', r.ok && r.items.length === 2, JSON.stringify(r));
  check('and keep their navigation key', r.items[0].key === '2', r.items[0].key);

  const episodes = JSON.stringify({
    MediaContainer: { Metadata: [
      { ratingKey: 101, title: '二千年後の君へ', type: 'episode', index: 1, parentTitle: 'シーズン 1', grandparentTitle: '進撃の巨人' },
      { ratingKey: 102, title: 'その日', type: 'episode', index: 2, parentTitle: 'シーズン 1', grandparentTitle: '進撃の巨人' },
    ] },
  });
  const e = P.parsePlexItems(200, episodes);
  check('episodes parse from Metadata[]', e.ok && e.items.length === 2);
  check('ratingKey is a string whatever the server sent', e.items[0].ratingKey === '101',
    JSON.stringify(e.items[0].ratingKey));
  check('episode label is S01E01 — title',
    P.episodeLabel(e.items[0]) === 'S01E01 — 二千年後の君へ', P.episodeLabel(e.items[0]));
  check('a label without numbers falls back to the title',
    P.episodeLabel({ title: 'ある映画', type: 'movie' }) === 'ある映画');

  const mixed = JSON.stringify({
    MediaContainer: {
      Directory: [{ key: '2', title: 'アニメ', type: 'show' }],
      Metadata: [{ ratingKey: 7, title: 'ある作品', type: 'show' }],
    },
  });
  check('a response carrying BOTH is read whole',
    P.parsePlexItems(200, mixed).items.length === 2);
  check('items with no title are dropped, not rendered blank',
    P.parsePlexItems(200, JSON.stringify({ MediaContainer: { Metadata: [{ ratingKey: 9 }] } })).items.length === 0);
  check('search results keep only what can be opened',
    P.playableItems([
      { title: 'a', type: 'show' }, { title: 'b', type: 'artist' },
      { title: 'c', type: 'episode' }, { title: 'd', type: 'collection' },
    ]).length === 2);
}

console.log('\n══ listing failures are the server\'s words, not "no results" ══');
{
  check('401 names the token', /X-Plex-Token/.test(P.parsePlexItems(401, '').error));
  check('500 names the status', /500/.test(P.parsePlexItems(500, '').error));
  check('non-JSON is said', /JSON/.test(P.parsePlexItems(200, '<html>').error));
  check('an empty library is ok:true with no items',
    P.parsePlexItems(200, '{"MediaContainer":{}}').ok === true
      && P.parsePlexItems(200, '{"MediaContainer":{}}').items.length === 0);
}

console.log('\n══ browse URLs ══');
{
  const B = 'http://tv:32400/';
  check('sections', P.plexSectionsUrl(B, 'T') === 'http://tv:32400/library/sections?X-Plex-Token=T');
  check('section contents',
    P.plexSectionItemsUrl(B, '2', 'T') === 'http://tv:32400/library/sections/2/all?X-Plex-Token=T');
  check('a section key with slashes is normalised',
    P.plexSectionItemsUrl(B, '/2/', 'T') === 'http://tv:32400/library/sections/2/all?X-Plex-Token=T');
  check('seasons', P.plexChildrenUrl(B, '45', 'T').includes('/library/metadata/45/children'));
  check('ALL episodes in one request (seasons are a level you rarely want)',
    P.plexLeavesUrl(B, '45', 'T').includes('/library/metadata/45/allLeaves'));
  check('search escapes the query',
    P.plexSearchUrl(B, '進撃 の', 'T').includes('query=%E9%80%B2%E6%92%83%20%E3%81%AE'));
}

console.log(fail ? `\n✗ plex: ${fail} failed (${pass} passed)` : `\n✓ plex: all ${pass} pass`);
process.exit(fail ? 1 : 0);
