/**
 * jimaku.ts — the ONLY jimaku.cc-aware module (DESIGN §25.4b).
 *
 * PURE — no Obsidian imports — golden-tested in golden/jimaku.mjs. The live
 * fetch (requestUrl) lives in main.ts and only passes bytes through here; all
 * knowledge of jimaku's endpoints and JSON shape is quarantined in this file
 * (the §2.2 adapter-isolation rule that `plex.ts` follows).
 *
 * WHY this exists: Plex only has the subtitles that happen to be muxed into
 * the file. For a large part of a real library — live-action drama, older
 * anime, anything ripped from a stream that shipped English-only — there is no
 * Japanese track at all, and the pipeline stopped dead with
 * 「この作品には字幕トラックがありません」. Everything downstream (照合・走査・
 * 談話モード・⚡) already worked; the only missing piece was the one thing the
 * plugin could fetch for you. jimaku.cc is where those subtitles are, and its
 * API is small: search for the work, list the files, download one.
 *
 * Field names are the documented API shape (openapi.json): Entry.{id, name,
 * english_name, japanese_name, anilist_id, tmdb_id, last_modified, flags} and
 * FileEntry.{name, url, size, last_modified}. Auth is the raw API key in the
 * `Authorization` header — NOT `Bearer <key>`.
 */

export interface JimakuEntry {
  id: number;
  /** romaji name — always present. */
  name: string;
  englishName?: string;
  japaneseName?: string;
  anilistId?: number;
  /** `(tv|movie):(\d+)` */
  tmdbId?: string;
  lastModified?: string;
  notes?: string;
  /** `anime`, `unverified`, `external`, `movie` — advisory only. */
  flags?: Record<string, boolean>;
}

export interface JimakuFile {
  name: string;
  /** absolute download URL. May be off-host — see `jimakuDownloadHeaders`. */
  url: string;
  size?: number;
  lastModified?: string;
}

export type JimakuEntriesResult =
  | { ok: true; entries: JimakuEntry[] }
  | { ok: false; error: string };

export type JimakuFilesResult =
  | { ok: true; files: JimakuFile[] }
  | { ok: false; error: string };

export const JIMAKU_API_BASE = 'https://jimaku.cc/api';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** The auth header. The key goes in RAW — jimaku does not use `Bearer`. */
export function jimakuHeaders(apiKey: string): Record<string, string> {
  return { Authorization: apiKey.trim(), Accept: 'application/json' };
}

/**
 * Headers for downloading a file body.
 *
 * `FileEntry.url` is whatever host jimaku chose to serve from, and an API key
 * is a credential: sending it to a third-party host because it appeared in a
 * JSON field would leak it. Only jimaku's own hosts get the header.
 */
export function jimakuDownloadHeaders(url: string, apiKey: string): Record<string, string> {
  const host = url.replace(/^[a-z]+:\/\//i, '').split('/')[0].split('@').pop()?.toLowerCase() ?? '';
  const bare = host.replace(/:\d+$/, '');
  const ours = bare === 'jimaku.cc' || bare.endsWith('.jimaku.cc');
  return ours ? { Authorization: apiKey.trim() } : {};
}

/**
 * `GET /api/entries/search`.
 *
 * `anime` defaults to TRUE server-side, so live-action work is invisible
 * unless it is passed explicitly — which is exactly the half of a library
 * that has no Japanese track muxed in. Callers should search both.
 */
export function jimakuSearchUrl(
  opts: { query?: string; anilistId?: number; tmdbId?: string; anime?: boolean },
  base = JIMAKU_API_BASE,
): string {
  const p: string[] = [];
  if (opts.query?.trim()) p.push(`query=${encodeURIComponent(opts.query.trim())}`);
  if (opts.anilistId != null) p.push(`anilist_id=${encodeURIComponent(String(opts.anilistId))}`);
  if (opts.tmdbId) p.push(`tmdb_id=${encodeURIComponent(opts.tmdbId)}`);
  if (opts.anime !== undefined) p.push(`anime=${opts.anime ? 'true' : 'false'}`);
  return `${base.replace(/\/+$/, '')}/entries/search${p.length ? `?${p.join('&')}` : ''}`;
}

/** `GET /api/entries/{id}/files` — `episode` is a best-effort server filter. */
export function jimakuFilesUrl(entryId: number, episode?: number, base = JIMAKU_API_BASE): string {
  const q = episode != null && Number.isFinite(episode) ? `?episode=${encodeURIComponent(String(episode))}` : '';
  return `${base.replace(/\/+$/, '')}/entries/${encodeURIComponent(String(entryId))}/files${q}`;
}

/** The human page for an entry — provenance a note can link back to. */
export function jimakuEntryPageUrl(entryId: number): string {
  return `https://jimaku.cc/entry/${entryId}`;
}

/**
 * Explain a non-200. Split out because every jimaku endpoint fails the same
 * few ways and each one has a different thing for the user to DO: a missing
 * key is a settings trip, a 429 is a wait, a 404 is a stale entry id.
 * `headers` is optional so the pure tests need not fake a header bag.
 */
function jimakuHttpError(status: number, headers?: Record<string, string>): string | null {
  if (status === 200) return null;
  if (status === 401 || status === 403) {
    return 'jimaku がリクエストを拒否しました — 設定の API キーを確認してください'
      + '（jimaku.cc にログイン → プロフィール → API キーを発行）。';
  }
  if (status === 429) {
    const after = headers?.['x-ratelimit-reset-after'] ?? headers?.['X-RateLimit-Reset-After'];
    const sec = after ? Math.ceil(Number(after)) : NaN;
    return `jimaku のレート制限に達しました${Number.isFinite(sec) ? `（約${sec}秒後に再試行）` : ''}。`;
  }
  if (status === 404) return 'jimaku に該当の項目がありません（404）。';
  return `jimaku が HTTP ${status} を返しました。`;
}

/** Parse a search / entry response. */
export function parseJimakuEntries(
  status: number, body: string, headers?: Record<string, string>,
): JimakuEntriesResult {
  const httpErr = jimakuHttpError(status, headers);
  if (httpErr) return { ok: false, error: httpErr };
  let json: unknown;
  try { json = JSON.parse(body); }
  catch { return { ok: false, error: 'jimaku の応答が JSON ではありません。' }; }
  // A single-entry endpoint returns an object; search returns an array.
  const rows = Array.isArray(json) ? json : json && typeof json === 'object' ? [json] : [];
  const entries: JimakuEntry[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const id = num(o.id);
    const name = str(o.name);
    if (id == null || !name) continue;
    const flags = o.flags && typeof o.flags === 'object'
      ? Object.fromEntries(Object.entries(o.flags as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>
      : undefined;
    entries.push({
      id, name,
      ...(str(o.english_name) ? { englishName: str(o.english_name) } : {}),
      ...(str(o.japanese_name) ? { japaneseName: str(o.japanese_name) } : {}),
      ...(num(o.anilist_id) != null ? { anilistId: num(o.anilist_id) } : {}),
      ...(str(o.tmdb_id) ? { tmdbId: str(o.tmdb_id) } : {}),
      ...(str(o.last_modified) ? { lastModified: str(o.last_modified) } : {}),
      ...(str(o.notes) ? { notes: str(o.notes) } : {}),
      ...(flags && Object.keys(flags).length ? { flags } : {}),
    });
  }
  return { ok: true, entries };
}

/** Parse a files listing. */
export function parseJimakuFiles(
  status: number, body: string, headers?: Record<string, string>,
): JimakuFilesResult {
  const httpErr = jimakuHttpError(status, headers);
  if (httpErr) return { ok: false, error: httpErr };
  let json: unknown;
  try { json = JSON.parse(body); }
  catch { return { ok: false, error: 'jimaku の応答が JSON ではありません。' }; }
  const rows = Array.isArray(json) ? json : [];
  const files: JimakuFile[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const name = str(o.name);
    const url = str(o.url);
    if (!name || !url) continue;
    files.push({
      name, url,
      ...(num(o.size) != null ? { size: num(o.size) } : {}),
      ...(str(o.last_modified) ? { lastModified: str(o.last_modified) } : {}),
    });
  }
  return { ok: true, files };
}

// ── matching a work ─────────────────────────────────────────────────────────

/** Season words in every form a title writes them, for stripping/detecting. */
const SEASON_RE = /(?:season\s*(\d+)|(\d+)(?:st|nd|rd|th)\s*season|第\s*(\d+)\s*期|s(\d+)\b)/i;

/**
 * Fold a title to its comparable core: width-normalised, lower-cased, with
 * punctuation, spaces, bracketed tags and season markers removed. Plex shows
 * are titled by whoever scraped them and jimaku entries by whoever uploaded
 * them; the raw strings agree far less often than the works do.
 */
export function normalizeTitle(s: string): string {
  return (s ?? '')
    .normalize('NFKC')
    .replace(/[[(（【][^\])）】]*[\])）】]/g, ' ')
    .replace(SEASON_RE, ' ')
    .toLowerCase()
    .replace(/[!！?？:：・.,'"’”“、。~〜\-–—_/\\|*+&#@]/g, ' ')
    .replace(/\s+/g, '');
}

/** Which season a title claims, when it says so at all. */
export function seasonOf(title: string): number | undefined {
  const m = SEASON_RE.exec((title ?? '').normalize('NFKC'));
  if (!m) return undefined;
  const n = Number(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return Number.isFinite(n) ? n : undefined;
}

/** Dice coefficient over character bigrams — works for kana/kanji and latin
 *  alike, which a word-token overlap does not. */
function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a), gb = grams(b);
  let hits = 0, total = 0;
  for (const [g, n] of ga) { total += n; hits += Math.min(n, gb.get(g) ?? 0); }
  for (const [, n] of gb) total += n;
  return total ? (2 * hits) / total : 0;
}

/** 0–1 similarity of a query to ONE title string. */
function titleSim(query: string, candidate: string): number {
  const a = normalizeTitle(query), b = normalizeTitle(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return 0.62 + 0.33 * ratio;
  }
  return dice(a, b) * 0.85;
}

/** How well one entry matches the work being looked for (any of its names). */
export function entryScore(entry: JimakuEntry, show: string, season?: number): number {
  const forms = [entry.name, entry.englishName, entry.japaneseName].filter(Boolean) as string[];
  let best = 0;
  for (const f of forms) best = Math.max(best, titleSim(show, f));
  // Season agreement is a tiebreak between sibling entries, never a match on
  // its own: 「進撃の巨人 Season 3」 and 「進撃の巨人」 score alike otherwise.
  const entrySeason = forms.map((f) => seasonOf(f)).find((s) => s != null);
  if (season != null && season > 1) {
    if (entrySeason === season) best += 0.12;
    else if (entrySeason == null) best -= 0.04;
    else best -= 0.12;
  } else if (season === 1 && entrySeason != null && entrySeason > 1) {
    best -= 0.12;
  }
  return Math.max(0, Math.min(1.2, best));
}

export interface JimakuEntryPick {
  entry: JimakuEntry | null;
  score: number;
  /** true only when ONE entry is clearly the work — see `pickJimakuEntry`. */
  confident: boolean;
  /** every entry, best first — what the picker shows when confidence fails. */
  ranked: Array<{ entry: JimakuEntry; score: number }>;
}

/**
 * Rank entries against a show name, and say whether the top one may be used
 * WITHOUT asking.
 *
 * The machine is a recall machine (DESIGN §12): a wrong entry here produces a
 * complete, plausible, wrong transcript, which is worse than no transcript.
 * So "confident" is deliberately strict — a strong absolute match AND a clear
 * gap to the runner-up. Anything less goes to the picker for a human to
 * ratify.
 */
export function pickJimakuEntry(
  entries: JimakuEntry[], show: string, season?: number,
): JimakuEntryPick {
  const ranked = entries
    .map((entry) => ({ entry, score: entryScore(entry, show, season) }))
    .sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (!top) return { entry: null, score: 0, confident: false, ranked };
  const gap = ranked.length > 1 ? top.score - ranked[1].score : 1;
  const confident = top.score >= 0.86 && gap >= 0.12;
  return { entry: top.entry, score: top.score, confident, ranked };
}

// ── choosing a file ─────────────────────────────────────────────────────────

/** Formats `parseSubtitles` can actually read (srt.ts handles SRT/VTT/ASS). */
const TEXT_SUB_EXTS = new Set(['srt', 'ass', 'ssa', 'vtt', 'sbv', 'txt']);
/** Containers we cannot open in a plugin — named so the refusal can say so. */
const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz']);

export const extOf = (name: string): string =>
  (name.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] ?? '').toLowerCase();

export const isTextSubtitleFile = (name: string): boolean => TEXT_SUB_EXTS.has(extOf(name));
export const isArchiveFile = (name: string): boolean => ARCHIVE_EXTS.has(extOf(name));

/** Release-group noise that would otherwise read as an episode number. */
const NOISE_RE = /\b(?:\d{3,4}p|x?26[45]|hevc|avc|aac|flac|opus|10\s?bit|8\s?bit|bd(?:rip)?|web(?:-?dl|rip)?|hdtv|dvd(?:rip)?|amzn|nf|crunchyroll|multi|dual|[0-9a-f]{8}|v\d)\b/gi;

export interface EpisodeRef { season?: number; episode?: number }

/**
 * Read an episode number out of a filename or a Plex episode title.
 *
 * Ordered by how unambiguous the notation is. Resolution/codec/CRC tokens are
 * scrubbed first, because `[1080p]`, `x264` and an 8-hex CRC all contain runs
 * of digits that beat the real number otherwise.
 */
export function episodeNumberFrom(raw: string): EpisodeRef {
  if (!raw) return {};
  const cleaned = raw
    .normalize('NFKC')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')          // extension
    .replace(NOISE_RE, ' ');

  const se = /\bS(\d{1,2})[\s._-]*E(\d{1,3})\b/i.exec(cleaned);
  if (se) return { season: Number(se[1]), episode: Number(se[2]) };

  const jp = /第\s*(\d{1,3})\s*話/.exec(cleaned);
  if (jp) return { episode: Number(jp[1]) };

  const ep = /\b(?:ep|episode)[\s._-]*(\d{1,3})\b/i.exec(cleaned);
  if (ep) return { episode: Number(ep[1]) };

  const hash = /#\s*(\d{1,3})\b/.exec(cleaned);
  if (hash) return { episode: Number(hash[1]) };

  // " - 04 ", " - 04v2", "…- 04." — the fansub convention.
  const dash = /[-–—]\s*(\d{1,3})(?:\s*v\d)?\s*(?:[[(.]|$)/.exec(cleaned);
  if (dash) return { episode: Number(dash[1]) };

  const bracket = /[[(](\d{1,3})[\])]/.exec(cleaned);
  if (bracket) return { episode: Number(bracket[1]) };

  // A bare trailing number, last: "Sousou no Frieren 04".
  const bare = /(?:^|\s)(\d{1,3})\s*$/.exec(cleaned.trim());
  if (bare) return { episode: Number(bare[1]) };

  return {};
}

/** Signs/songs/credits tracks — the file that looks right until the
 *  transcript has forty lines in it (same trap as Plex's `forced`). */
const SIGNS_RE = /(sign|song|op\b|ed\b|ncop|nced|credit|karaoke|lyric|コメンタリ|ソング|歌詞)/i;

export interface JimakuFilePick {
  file: JimakuFile | null;
  score: number;
  confident: boolean;
  ranked: Array<{ file: JimakuFile; score: number }>;
}

/**
 * Choose the subtitle file to download.
 *
 * The jimaku `episode=` filter is documented as best-effort, so an entry's
 * listing routinely comes back holding a whole season plus signs tracks plus a
 * .zip of everything. In order — a file must be READABLE (text format; an
 * archive is not something a plugin can open), it must be the RIGHT EPISODE
 * when the episode is known, signs/songs tracks lose heavily, and size breaks
 * the remaining ties (a dialogue script is bigger than a signs script).
 */
export function pickJimakuFile(files: JimakuFile[], opts: { episode?: number } = {}): JimakuFilePick {
  const usable = files.filter((f) => isTextSubtitleFile(f.name));
  const ep = opts.episode;

  const score = (f: JimakuFile): number => {
    let n = 0;
    const fileEp = episodeNumberFrom(f.name).episode;
    if (ep != null) {
      if (fileEp === ep) n += 1000;
      else if (fileEp != null) n -= 1000;      // a different episode is never right
      else n -= 40;                            // unnumbered: possible, unproven
    }
    const e = extOf(f.name);
    n += e === 'srt' ? 6 : e === 'ass' || e === 'ssa' ? 5 : e === 'vtt' ? 4 : 1;
    if (SIGNS_RE.test(f.name)) n -= 400;
    n += Math.min((f.size ?? 0) / 20000, 5);   // bigger = more dialogue, capped
    return n;
  };

  const ranked = usable.map((file) => ({ file, score: score(file) })).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (!top || top.score < 0) return { file: null, score: top?.score ?? 0, confident: false, ranked };

  // Confident = there is nothing else this could reasonably be. Not a score
  // threshold: the question is whether a RIVAL exists — another file claiming
  // the same episode that is not a signs/songs track. Two uploaders' releases
  // of episode 4 are a coin flip and belong in the picker; a dialogue track
  // sitting next to its own signs track is not a choice at all.
  const namesEpisode = ep != null && episodeNumberFrom(top.file.name).episode === ep;
  const rivals = ranked.filter(({ file }) => file !== top.file
    && episodeNumberFrom(file.name).episode === ep
    && !SIGNS_RE.test(file.name));
  const confident = namesEpisode ? rivals.length === 0 : ranked.length === 1;
  return { file: top.file, score: top.score, confident, ranked };
}

/** Why no file could be chosen — shown verbatim instead of a silent no-op. */
export function jimakuFileRefusal(files: JimakuFile[], episode?: number): string | null {
  if (!files.length) return 'この項目にはファイルがありません。';
  if (pickJimakuFile(files, { episode }).file) return null;
  const archives = files.filter((f) => isArchiveFile(f.name));
  if (archives.length && archives.length === files.length) {
    return `字幕がアーカイブ（${[...new Set(archives.map((f) => extOf(f.name)))].join('、')}）でのみ配布されています。`
      + 'プラグインでは展開できないので、jimaku.cc から手動でダウンロードして取り込んでください。';
  }
  if (episode != null) {
    const eps = [...new Set(files.map((f) => episodeNumberFrom(f.name).episode).filter((e) => e != null))];
    if (eps.length) {
      return `第${episode}話のファイルが見つかりません（この項目にあるのは ${eps.sort((a, b) => (a as number) - (b as number)).join('、')} 話）。`;
    }
  }
  return '読み取れる字幕ファイル（.srt / .ass / .vtt）がありません。';
}

const KB = 1024;
export function fmtBytes(n?: number): string {
  if (n == null) return '';
  if (n < KB) return `${n} B`;
  if (n < KB * KB) return `${(n / KB).toFixed(1)} KB`;
  return `${(n / KB / KB).toFixed(1)} MB`;
}

/** One line per file, for the picker and the 接続テスト. */
export function describeJimakuFile(f: JimakuFile): string {
  const ep = episodeNumberFrom(f.name).episode;
  const bits = [
    ...(ep != null ? [`第${ep}話`] : []),
    extOf(f.name) || '形式不明',
    ...(f.size != null ? [fmtBytes(f.size)] : []),
    ...(f.lastModified ? [f.lastModified.slice(0, 10)] : []),
    ...(isArchiveFile(f.name) ? ['展開不可'] : []),
    ...(SIGNS_RE.test(f.name) ? ['看板/歌のみ?'] : []),
  ];
  return `${f.name} — ${bits.join(' / ')}`;
}

/** The label a picker row shows for an entry: every name it is known by. */
export function describeJimakuEntry(e: JimakuEntry): string {
  const alt = [e.japaneseName, e.englishName].filter((n) => n && n !== e.name);
  return alt.length ? `${e.name}（${alt.join(' / ')}）` : e.name;
}

/**
 * The search key for a Plex episode: the SHOW, never the episode title.
 *
 * jimaku indexes works, not episodes, so 「檻の中の少女」 (an episode title)
 * finds nothing while 「相棒」 finds the entry with all 21 seasons in it. When
 * only an episode title is known, its episode markers are stripped and what is
 * left is the best available guess.
 */
export function jimakuQueryFor(ep: { show?: string; title?: string }): string {
  const show = ep.show?.trim();
  if (show) return show;
  const t = (ep.title ?? '').trim();
  return t
    .replace(/\bS\d{1,2}[\s._-]*E\d{1,3}\b/i, ' ')
    .replace(/第\s*\d{1,3}\s*話/, ' ')
    .replace(/[-–—]\s*\d{1,3}\s*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
