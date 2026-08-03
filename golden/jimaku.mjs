/**
 * golden/jimaku.mjs — §25.4b jimaku.cc, the subtitle source for the shows
 * whose files carry no Japanese track. Pins the pure parsers/pickers that
 * quarantine all jimaku knowledge (src/notes/jimaku.ts); the live fetch lives
 * in main.ts and only passes bytes through these.
 *
 * The load-bearing tests here are the REFUSALS. A wrong entry or a signs-only
 * file produces a complete, plausible, wrong transcript — the failure mode
 * that looks like success — so "confident" is what has to stay strict.
 *
 * Run:  node golden/jimaku.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const J = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'jimaku.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const entry = (o) => ({
  id: 1, name: 'Name', flags: { anime: true }, last_modified: '2024-05-02T10:00:00Z', ...o,
});

console.log('══ URLs + auth ══');
{
  const u = J.jimakuSearchUrl({ query: '進撃の巨人' });
  check('search URL hits /entries/search', u.startsWith('https://jimaku.cc/api/entries/search?'), u);
  check('the query is percent-encoded', u.includes(encodeURIComponent('進撃の巨人')), u);
  check('anime is omitted when not asked for', !u.includes('anime='), u);

  const live = J.jimakuSearchUrl({ query: '相棒', anime: false });
  check('anime=false is explicit — live action is invisible without it',
    live.includes('anime=false'), live);

  check('anilist id search', J.jimakuSearchUrl({ anilistId: 16498 }).includes('anilist_id=16498'));
  check('tmdb id search', J.jimakuSearchUrl({ tmdbId: 'tv:1234' }).includes(`tmdb_id=${encodeURIComponent('tv:1234')}`));

  const f = J.jimakuFilesUrl(42, 4);
  check('files URL carries the entry id and episode', f.endsWith('/entries/42/files?episode=4'), f);
  check('no episode → no filter', J.jimakuFilesUrl(42).endsWith('/entries/42/files'));

  const h = J.jimakuHeaders('  abc123  ');
  check('the key goes in RAW — jimaku does not use Bearer', h.Authorization === 'abc123', JSON.stringify(h));
}

console.log('══ the API key never leaves jimaku ══');
{
  const own = J.jimakuDownloadHeaders('https://jimaku.cc/entry/1/download/x.srt', 'KEY');
  check('jimaku.cc gets the key', own.Authorization === 'KEY');
  const sub = J.jimakuDownloadHeaders('https://cdn.jimaku.cc/x.srt', 'KEY');
  check('a jimaku subdomain gets the key', sub.Authorization === 'KEY');
  const other = J.jimakuDownloadHeaders('https://evil.example.com/x.srt', 'KEY');
  check('any other host gets NOTHING — a credential is not a URL field',
    other.Authorization === undefined, JSON.stringify(other));
  const lookalike = J.jimakuDownloadHeaders('https://jimaku.cc.evil.example/x.srt', 'KEY');
  check('and a look-alike host does not fool the check',
    lookalike.Authorization === undefined, JSON.stringify(lookalike));
}

console.log('══ parsing entries ══');
{
  const body = JSON.stringify([
    entry({ id: 7, name: 'Shingeki no Kyojin', english_name: 'Attack on Titan', japanese_name: '進撃の巨人', anilist_id: 16498 }),
    entry({ id: 8, name: 'Nothing' }),
  ]);
  const r = J.parseJimakuEntries(200, body);
  check('two entries parse', r.ok && r.entries.length === 2, JSON.stringify(r));
  const e = r.ok ? r.entries[0] : {};
  check('snake_case → camelCase (english_name)', e.englishName === 'Attack on Titan', e.englishName);
  check('japanese_name read', e.japaneseName === '進撃の巨人', e.japaneseName);
  check('anilist_id read', e.anilistId === 16498, String(e.anilistId));
  check('flags kept', e.flags?.anime === true, JSON.stringify(e.flags));

  const single = J.parseJimakuEntries(200, JSON.stringify(entry({ id: 9 })));
  check('a single-object response also parses (the /{id} endpoint)',
    single.ok && single.entries.length === 1, JSON.stringify(single));

  const junk = J.parseJimakuEntries(200, JSON.stringify([{ id: 1 }, { name: 'no id' }, 'nope']));
  check('rows without id or name are dropped, not crashed on',
    junk.ok && junk.entries.length === 0, JSON.stringify(junk));
}

console.log('══ failures say what to DO ══');
{
  const noKey = J.parseJimakuEntries(401, '');
  check('401 sends you to the API key', !noKey.ok && noKey.error.includes('API キー'), JSON.stringify(noKey));
  const limited = J.parseJimakuEntries(429, '', { 'x-ratelimit-reset-after': '12.5' });
  check('429 is a WAIT, and says how long',
    !limited.ok && limited.error.includes('レート制限') && limited.error.includes('13'), JSON.stringify(limited));
  const gone = J.parseJimakuFiles(404, '');
  check('404 is a missing item, not an auth problem',
    !gone.ok && gone.error.includes('404') && !gone.error.includes('API キー'), JSON.stringify(gone));
  const html = J.parseJimakuEntries(200, '<html>oops</html>');
  check('a non-JSON body is reported, never parsed into silence',
    !html.ok && html.error.includes('JSON'), JSON.stringify(html));
  check('an empty result is SUCCESS with zero rows, not an error',
    J.parseJimakuEntries(200, '[]').ok);
}

console.log('══ picking the work ══');
{
  const entries = J.parseJimakuEntries(200, JSON.stringify([
    entry({ id: 1, name: 'Shingeki no Kyojin', english_name: 'Attack on Titan', japanese_name: '進撃の巨人' }),
    entry({ id: 2, name: 'Shingeki no Kyojin Season 3', japanese_name: '進撃の巨人 Season 3' }),
    entry({ id: 3, name: 'Kimetsu no Yaiba', japanese_name: '鬼滅の刃' }),
  ])).entries;

  const jp = J.pickJimakuEntry(entries, '進撃の巨人');
  check('a Japanese Plex title finds the Japanese name', jp.entry?.id === 1, JSON.stringify(jp.entry));
  check('but with a Season 3 sibling and no season known, it is NOT auto-picked '
    + '— season-1 subs over a season-3 episode is the silent-wrong case',
  jp.confident === false, String(jp.score));

  const en = J.pickJimakuEntry(entries, 'Attack on Titan');
  check('an English Plex title finds the same entry via english_name', en.entry?.id === 1);

  const solo = J.pickJimakuEntry(entries, '鬼滅の刃');
  check('a work with no sibling IS confident — the picker is for questions',
    solo.entry?.id === 3 && solo.confident === true, `${solo.entry?.id}/${solo.score}`);

  const s3 = J.pickJimakuEntry(entries, '進撃の巨人', 3);
  check('season 3 prefers the season-3 entry', s3.entry?.id === 2, JSON.stringify(s3.entry));
  const s1 = J.pickJimakuEntry(entries, '進撃の巨人', 1);
  check('season 1 prefers the unnumbered entry', s1.entry?.id === 1, JSON.stringify(s1.entry));

  const weak = J.pickJimakuEntry(entries, 'ぜんぜん違う作品');
  check('a work that is not there is NOT confidently something else',
    weak.confident === false, JSON.stringify(weak.entry));

  // The load-bearing one: near-identical siblings must go to the picker.
  const twins = J.parseJimakuEntries(200, JSON.stringify([
    entry({ id: 10, name: 'Kanojo, Okarishimasu' }),
    entry({ id: 11, name: 'Kanojo mo Kanojo' }),
  ])).entries;
  const t = J.pickJimakuEntry(twins, 'Kanojo, Okarishimasu');
  check('an exact match still wins over a near-twin', t.entry?.id === 10, JSON.stringify(t));

  const ambiguous = J.pickJimakuEntry(J.parseJimakuEntries(200, JSON.stringify([
    entry({ id: 20, name: 'Aibou Season 21' }),
    entry({ id: 21, name: 'Aibou Season 20' }),
  ])).entries, 'Aibou');
  check('two equally-plausible seasons are NOT auto-picked',
    ambiguous.confident === false, JSON.stringify(ambiguous.ranked.map((r) => [r.entry.id, r.score])));
  check('but they are ranked for the picker to show', ambiguous.ranked.length === 2);
}

console.log('══ episode numbers, out of names built by strangers ══');
{
  const ep = (s) => J.episodeNumberFrom(s).episode;
  check('S01E04', J.episodeNumberFrom('Aibou S01E04.srt').season === 1 && ep('Aibou S01E04.srt') === 4);
  check('第4話', ep('相棒 第4話.ass') === 4);
  check('fansub dash form', ep('[Group] Sousou no Frieren - 04 [1080p][A1B2C3D4].ass') === 4);
  check('… and the resolution did not win', ep('[Group] Frieren - 04 [1080p].ass') === 4);
  check('… nor the x264 tag', ep('Frieren - 12 [BDRip x264 FLAC].ass') === 12);
  check('EP04 / Episode 4', ep('Show EP04.srt') === 4 && ep('Show Episode 4.srt') === 4);
  check('#04', ep('Show #04.srt') === 4);
  check('bare trailing number', ep('Sousou no Frieren 04.srt') === 4);
  check('a v2 re-release is still that episode', ep('[G] Show - 07v2 [720p].ass') === 7);
  check('a year is not an episode', ep('Movie (2024).srt') === undefined, String(ep('Movie (2024).srt')));
  check('nothing numeric → nothing invented', ep('Show OP.ass') === undefined, String(ep('Show OP.ass')));
}

console.log('══ picking the file ══');
{
  const files = JSON.stringify([
    { name: '[G] Show - 03 [1080p].ass', url: 'https://jimaku.cc/f/3', size: 42000, last_modified: '2024-05-01T00:00:00Z' },
    { name: '[G] Show - 04 [1080p].ass', url: 'https://jimaku.cc/f/4', size: 44000, last_modified: '2024-05-02T00:00:00Z' },
    { name: '[G] Show - 04 [Signs].ass', url: 'https://jimaku.cc/f/4s', size: 3000 },
    { name: 'Show.zip', url: 'https://jimaku.cc/f/zip', size: 900000 },
  ]);
  const r = J.parseJimakuFiles(200, files);
  check('files parse', r.ok && r.files.length === 4, JSON.stringify(r).slice(0, 120));

  const p4 = J.pickJimakuFile(r.files, { episode: 4 });
  check('the right EPISODE is chosen', p4.file?.name.includes('- 04 [1080p]'), p4.file?.name);
  check('the signs track loses — it looks valid until the transcript has 40 lines',
    !p4.file?.name.includes('Signs'), p4.file?.name);
  check('and it is confident: the file names the episode', p4.confident === true);

  const zipOnly = J.parseJimakuFiles(200, JSON.stringify([
    { name: 'Show.zip', url: 'https://jimaku.cc/f/zip', size: 900000 },
  ])).files;
  check('an archive is not a subtitle', J.pickJimakuFile(zipOnly).file === null);
  const zipWhy = J.jimakuFileRefusal(zipOnly);
  check('and the refusal says it cannot be unpacked here',
    zipWhy?.includes('展開') === true, zipWhy);

  const wrongEp = J.jimakuFileRefusal(r.files, 9);
  check('asking for an episode that is not there lists the ones that are',
    wrongEp?.includes('3') && wrongEp?.includes('4'), wrongEp);

  // Two releases of the same episode: a coin-flip, so no auto-pick.
  const dupes = J.parseJimakuFiles(200, JSON.stringify([
    { name: '[A] Show - 04.ass', url: 'u1', size: 40000 },
    { name: '[B] Show - 04.srt', url: 'u2', size: 41000 },
  ])).files;
  const dp = J.pickJimakuFile(dupes, { episode: 4 });
  check('two releases of the same episode are NOT auto-picked', dp.confident === false);
  check('both are offered, best first', dp.ranked.length === 2);

  const lone = J.parseJimakuFiles(200, JSON.stringify([
    { name: 'movie.srt', url: 'u', size: 30000 },
  ])).files;
  check('a single unambiguous file needs no question',
    J.pickJimakuFile(lone).confident === true);
  check('but with an episode asked for, an unnumbered file stays a question',
    J.pickJimakuFile(lone, { episode: 4 }).confident === false);
}

console.log('══ the search key is the WORK, never the episode ══');
{
  check('the show wins when known',
    J.jimakuQueryFor({ show: '相棒', title: '檻の中の少女' }) === '相棒');
  check('S01E04 is stripped off a bare title',
    J.jimakuQueryFor({ title: 'Aibou S01E04' }) === 'Aibou',
    J.jimakuQueryFor({ title: 'Aibou S01E04' }));
  check('第4話 is stripped too',
    J.jimakuQueryFor({ title: '相棒 第4話' }) === '相棒',
    J.jimakuQueryFor({ title: '相棒 第4話' }));
}

console.log('══ what the user is shown ══');
{
  const e = J.parseJimakuEntries(200, JSON.stringify([
    entry({ id: 1, name: 'Shingeki no Kyojin', japanese_name: '進撃の巨人', english_name: 'Attack on Titan' }),
  ])).entries[0];
  const d = J.describeJimakuEntry(e);
  check('an entry shows every name it is known by', d.includes('進撃の巨人') && d.includes('Attack on Titan'), d);
  const f = J.describeJimakuFile({ name: '[G] Show - 04.ass', url: 'u', size: 44000, lastModified: '2024-05-02T00:00:00Z' });
  check('a file shows episode / format / size / date',
    f.includes('第4話') && f.includes('ass') && f.includes('43.0 KB') && f.includes('2024-05-02'), f);
}

console.log(fail ? `\n✗ jimaku: ${fail} failed (${pass} passed)` : `\n✓ jimaku: all ${pass} pass`);
process.exit(fail ? 1 : 0);
