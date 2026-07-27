/**
 * plex.ts — the ONLY Plex-aware module (DESIGN §25.4, HANDOFF item A).
 * PURE — no Obsidian imports — golden-tested in golden/plex.mjs. The live
 * fetch (requestUrl) and the ffmpeg clip cut live in main.ts and only pass
 * bytes through the pure functions here; all knowledge of Plex's endpoint and
 * JSON shape is quarantined in this file (the §2.2 adapter-isolation rule).
 *
 * Clock (b): the server's /status/sessions reports the playing episode's
 * `viewOffset` (ms) and `Player.state`; FollowAlong turns that into a
 * syncClock so the transcript follows the shared-TV playback with no manual
 * tap. Clips: each mark can be cut from the session's Media.Part URL at the
 * mark's timestamp, landing a real 📺 scene.
 *
 * Field names are the documented Plex Web API shape (MediaContainer.Metadata[],
 * grandparentTitle, viewOffset ms, Player.state, Media[].Part[].key). The
 * parser is deliberately TOLERANT (missing Player, Media, string-vs-number
 * offsets) so an unverified server degrades to "no session" rather than a
 * crash — verify the exact names against a real /status/sessions before
 * trusting edge fields.
 */

import { matchEpisodeNote } from './player-shot.ts';

export interface PlexSession {
  /** episode title (`title`); falls back to the show name when absent. */
  title: string;
  /** show / series name (`grandparentTitle`). */
  show?: string;
  /** current playback position, seconds (from `viewOffset` ms). */
  viewOffsetSec: number;
  /** true when the player is paused OR buffering — both freeze the clock. */
  paused: boolean;
  /** `Media[0].Part[0].key` — the streamable path, for clip cutting. */
  partKey?: string;
  /** total media length, seconds (from `duration` ms), when reported. */
  durationSec?: number;
  /** library id of the episode — how a note finds this media again later. */
  ratingKey?: string;
  /** every stream on the chosen Part. Subtitles are why this is here. */
  streams: PlexStream[];
}

/**
 * One stream on a media Part. `streamType` is Plex's: 1 video, 2 audio,
 * 3 subtitle. The fields are optional because a server that reports fewer of
 * them should degrade to a worse CHOICE, never to a crash.
 */
export interface PlexStream {
  /** `/library/streams/…`. Absent when the track cannot be served directly. */
  key?: string;
  streamType: number;
  codec?: string;
  /** `jpn` / `ja` — the reliable one. `language` is a display name. */
  languageCode?: string;
  language?: string;
  title?: string;
  displayTitle?: string;
  /** the track the player is currently showing. */
  selected?: boolean;
  /** signs-and-songs only: never a transcript. */
  forced?: boolean;
}

export type PlexSessionsResult =
  | { ok: true; sessions: PlexSession[] }
  | { ok: false; error: string };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const msToSec = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n / 1000 : 0;
};

/** Trim whitespace and any trailing slash from a user-typed base URL. */
export function normalizePlexBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/** `GET {base}/status/sessions?X-Plex-Token=…` — the session-poll endpoint. */
export function plexSessionsUrl(baseUrl: string, token: string): string {
  return `${normalizePlexBaseUrl(baseUrl)}/status/sessions?X-Plex-Token=${encodeURIComponent(token.trim())}`;
}

/** The streamable URL for a media Part, for ffmpeg to read directly. */
export function plexPartUrl(baseUrl: string, partKey: string, token: string): string {
  const key = partKey.startsWith('/') ? partKey : `/${partKey}`;
  return `${normalizePlexBaseUrl(baseUrl)}${key}?X-Plex-Token=${encodeURIComponent(token.trim())}`;
}

/**
 * Parse a /status/sessions response body. PURE — takes the HTTP status and raw
 * text so the transport stays in main.ts and this stays golden-testable. Auth
 * failures and non-200s surface a verbatim, actionable error; an empty server
 * (nothing playing) is a successful result with `sessions: []`.
 */
export function parsePlexSessions(status: number, body: string): PlexSessionsResult {
  if (status === 401 || status === 403) {
    return { ok: false, error: `Plex がリクエストを拒否しました (HTTP ${status}) — X-Plex-Token を確認してください。` };
  }
  if (status !== 200) {
    return { ok: false, error: `Plex サーバーが HTTP ${status} を返しました（ベースURLがサーバーのルートを指しているか確認してください）。` };
  }
  let json: { MediaContainer?: { Metadata?: unknown } };
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, error: 'Plex の応答が JSON ではありません（Accept: application/json とベースURLを確認）。' };
  }
  const metadata = asArray(json?.MediaContainer?.Metadata);
  const sessions: PlexSession[] = [];
  for (const raw of metadata) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Record<string, unknown>;
    const player = asArray(m.Player)[0] as Record<string, unknown> | undefined;
    const state = str(player?.state) || 'playing';
    const part = (asArray(asArray(m.Media)[0] && (asArray(m.Media)[0] as Record<string, unknown>).Part)[0]) as Record<string, unknown> | undefined;
    const title = str(m.title) || str(m.grandparentTitle) || '(無題)';
    const durationSec = msToSec(m.duration);
    sessions.push({
      title,
      show: str(m.grandparentTitle) || undefined,
      viewOffsetSec: msToSec(m.viewOffset),
      paused: state !== 'playing',
      partKey: part && str(part.key) ? str(part.key) : undefined,
      ...(durationSec ? { durationSec } : {}),
      ...(str(m.ratingKey) || typeof m.ratingKey === 'number'
        ? { ratingKey: String(m.ratingKey) } : {}),
      streams: parseStreams(part?.Stream),
    });
  }
  return { ok: true, sessions };
}

const bool = (v: unknown): boolean | undefined =>
  v === true || v === 1 || v === '1' ? true
    : v === false || v === 0 || v === '0' ? false : undefined;

/** `Part.Stream[]` → typed streams. Anything unrecognisable is dropped. */
export function parseStreams(raw: unknown): PlexStream[] {
  const out: PlexStream[] = [];
  for (const s of asArray(raw)) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    const type = typeof o.streamType === 'number' ? o.streamType : Number(o.streamType);
    if (!Number.isFinite(type)) continue;
    const forced = bool(o.forced);
    const selected = bool(o.selected);
    out.push({
      streamType: type,
      ...(str(o.key) ? { key: str(o.key) } : {}),
      ...(str(o.codec) ? { codec: str(o.codec) } : {}),
      ...(str(o.languageCode) ? { languageCode: str(o.languageCode) } : {}),
      ...(str(o.language) ? { language: str(o.language) } : {}),
      ...(str(o.title) ? { title: str(o.title) } : {}),
      ...(str(o.displayTitle) ? { displayTitle: str(o.displayTitle) } : {}),
      ...(selected === undefined ? {} : { selected }),
      ...(forced === undefined ? {} : { forced }),
    });
  }
  return out;
}

/** `/library/metadata/{ratingKey}` — streams when a session did not carry them. */
export function plexMetadataUrl(baseUrl: string, ratingKey: string, token: string): string {
  return `${normalizePlexBaseUrl(baseUrl)}/library/metadata/${encodeURIComponent(ratingKey)}`
    + `?X-Plex-Token=${encodeURIComponent(token.trim())}`;
}

/** The body of one stream — the subtitle file itself. */
export function plexStreamUrl(baseUrl: string, streamKey: string, token: string): string {
  const key = streamKey.startsWith('/') ? streamKey : `/${streamKey}`;
  return `${normalizePlexBaseUrl(baseUrl)}${key}?X-Plex-Token=${encodeURIComponent(token.trim())}`;
}

/**
 * Image-based subtitle formats. These are PICTURES of text: there is nothing to
 * parse, and OCR is not something this plugin does. Choosing one would produce
 * an empty transcript with no explanation, so they are excluded by name and the
 * caller is told why (§28 S6 — refuse loudly rather than no-op).
 */
const IMAGE_SUB_CODECS = new Set([
  'pgs', 'hdmv_pgs_subtitle', 'vobsub', 'dvd_subtitle', 'dvbsub', 'dvb_subtitle', 'xsub', 'eia_608',
]);

export function isTextSubtitle(s: PlexStream): boolean {
  return !IMAGE_SUB_CODECS.has((s.codec ?? '').toLowerCase());
}

/** Subtitle streams only (`streamType === 3`). */
export function subtitleStreams(session: Pick<PlexSession, 'streams'>): PlexStream[] {
  return session.streams.filter((s) => s.streamType === 3);
}

const langOf = (s: PlexStream): string => (s.languageCode || s.language || '').toLowerCase();

/**
 * Choose the subtitle track to read as a transcript.
 *
 * Not simply "the Japanese one": a release commonly ships several, and the
 * wrong choice is silently useless rather than obviously broken. In order —
 *
 *   • it must be FETCHABLE (`key`); a track Plex will not serve is not an option
 *   • it must be TEXT; PGS/VobSub are pictures (see IMAGE_SUB_CODECS)
 *   • language preference, in the caller's order
 *   • `forced` tracks lose heavily — signs and songs, not dialogue, and they
 *     look like a valid Japanese track right up until the transcript has
 *     forty lines in it
 *   • the track the player already has selected breaks remaining ties
 */
export function pickSubtitleStream(
  streams: PlexStream[], opts: { langPref?: string[] } = {},
): PlexStream | null {
  const pref = (opts.langPref ?? ['ja', 'jpn', 'japanese']).map((l) => l.toLowerCase());
  const usable = streams.filter((s) => s.streamType === 3 && s.key && isTextSubtitle(s));
  if (!usable.length) return null;

  const score = (s: PlexStream): number => {
    const lang = langOf(s);
    const idx = pref.findIndex((p) => lang === p || lang.startsWith(p));
    let n = idx >= 0 ? (pref.length - idx) * 100 : 0;
    if (s.forced) n -= 250;              // outranks any language match
    if (s.selected) n += 30;
    if (/full|dialog/i.test(s.title ?? s.displayTitle ?? '')) n += 10;
    if (/sign|song|forced/i.test(s.title ?? s.displayTitle ?? '')) n -= 200;
    return n;
  };
  return [...usable].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/**
 * Why no subtitle could be chosen — shown verbatim instead of "0 cues".
 * Returns null when a pick IS possible.
 */
export function subtitleRefusal(streams: PlexStream[]): string | null {
  const subs = streams.filter((s) => s.streamType === 3);
  if (!subs.length) return 'この作品には字幕トラックがありません。';
  if (pickSubtitleStream(subs)) return null;
  const images = subs.filter((s) => !isTextSubtitle(s));
  if (images.length === subs.length) {
    return `字幕は画像形式（${[...new Set(images.map((s) => s.codec ?? '?'))].join('、')}）のみで、`
      + '文字として読み取れません。テキスト字幕(.srt/.ass)を追加してください。';
  }
  return 'サーバーが取り出せる字幕トラックがありません（Plexが直接配信できるトラックがない）。';
}

/** One line per subtitle track, for the 接続テスト — verify against a real server. */
export function describeSubtitles(streams: PlexStream[]): string[] {
  return streams.filter((s) => s.streamType === 3).map((s) => {
    const bits = [
      s.languageCode || s.language || '言語不明',
      s.codec ?? '形式不明',
      ...(s.forced ? ['forced'] : []),
      ...(s.selected ? ['選択中'] : []),
      ...(s.key ? [] : ['取得不可']),
      ...(isTextSubtitle(s) ? [] : ['画像形式']),
    ];
    return `${s.title || s.displayTitle || '(無題)'} — ${bits.join(' / ')}`;
  });
}

// ── Browsing the library ────────────────────────────────────────────────────
// The only way in used to be "whatever is playing right now", fuzzy-matched to
// the open note — and with several sessions and no confident match it gave up.
// That makes the plugin's TV support depend on standing in front of the TV.

/** A library section, show, season or episode — one shape for all of them. */
export interface PlexItem {
  /** library id; what every other endpoint takes. */
  ratingKey?: string;
  /** navigation key, for sections (`/library/sections/2/all`). */
  key?: string;
  title: string;
  /** `show` | `season` | `episode` | `movie` | section types. */
  type?: string;
  /** episode or season number. */
  index?: number;
  /** season title for an episode; show title for a season. */
  parentTitle?: string;
  /** show title for an episode. */
  grandparentTitle?: string;
  year?: number;
  /** episodes under a show/season. */
  leafCount?: number;
}

export type PlexItemsResult =
  | { ok: true; items: PlexItem[] }
  | { ok: false; error: string };

export function plexSectionsUrl(baseUrl: string, token: string): string {
  return `${normalizePlexBaseUrl(baseUrl)}/library/sections?X-Plex-Token=${encodeURIComponent(token.trim())}`;
}

/** Everything in a section (`/all`). */
export function plexSectionItemsUrl(baseUrl: string, sectionKey: string, token: string): string {
  const k = sectionKey.replace(/^\/+|\/+$/g, '');
  return `${normalizePlexBaseUrl(baseUrl)}/library/sections/${encodeURIComponent(k)}/all`
    + `?X-Plex-Token=${encodeURIComponent(token.trim())}`;
}

/** Direct children — a show's seasons. */
export function plexChildrenUrl(baseUrl: string, ratingKey: string, token: string): string {
  return `${normalizePlexBaseUrl(baseUrl)}/library/metadata/${encodeURIComponent(ratingKey)}/children`
    + `?X-Plex-Token=${encodeURIComponent(token.trim())}`;
}

/**
 * EVERY episode under a show, in one request. Seasons are a level you almost
 * never want to navigate when the goal is "that episode I was watching".
 */
export function plexLeavesUrl(baseUrl: string, ratingKey: string, token: string): string {
  return `${normalizePlexBaseUrl(baseUrl)}/library/metadata/${encodeURIComponent(ratingKey)}/allLeaves`
    + `?X-Plex-Token=${encodeURIComponent(token.trim())}`;
}

export function plexSearchUrl(baseUrl: string, query: string, token: string): string {
  return `${normalizePlexBaseUrl(baseUrl)}/search?query=${encodeURIComponent(query.trim())}`
    + `&limit=50&X-Plex-Token=${encodeURIComponent(token.trim())}`;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Parse any library listing. Plex returns sections under `Directory[]` and
 * content under `Metadata[]`, sometimes both in one response, so both are read
 * and concatenated rather than the caller having to know which endpoint
 * returns which.
 */
export function parsePlexItems(status: number, body: string): PlexItemsResult {
  if (status === 401 || status === 403) {
    return { ok: false, error: `Plex がリクエストを拒否しました (HTTP ${status}) — X-Plex-Token を確認してください。` };
  }
  if (status !== 200) return { ok: false, error: `Plex サーバーが HTTP ${status} を返しました。` };
  let json: { MediaContainer?: { Directory?: unknown; Metadata?: unknown } };
  try { json = JSON.parse(body); }
  catch { return { ok: false, error: 'Plex の応答が JSON ではありません。' }; }

  const items: PlexItem[] = [];
  for (const raw of [...asArray(json?.MediaContainer?.Directory), ...asArray(json?.MediaContainer?.Metadata)]) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const title = str(o.title);
    if (!title) continue;
    const ratingKey = str(o.ratingKey) || (num(o.ratingKey) != null ? String(o.ratingKey) : '');
    items.push({
      title,
      ...(ratingKey ? { ratingKey } : {}),
      ...(str(o.key) ? { key: str(o.key) } : {}),
      ...(str(o.type) ? { type: str(o.type) } : {}),
      ...(num(o.index) != null ? { index: num(o.index) } : {}),
      ...(str(o.parentTitle) ? { parentTitle: str(o.parentTitle) } : {}),
      ...(str(o.grandparentTitle) ? { grandparentTitle: str(o.grandparentTitle) } : {}),
      ...(num(o.year) != null ? { year: num(o.year) } : {}),
      ...(num(o.leafCount) != null ? { leafCount: num(o.leafCount) } : {}),
    });
  }
  return { ok: true, items };
}

/** `S01E04 — タイトル` when the numbers are there, else just the title. */
export function episodeLabel(item: PlexItem): string {
  const season = item.parentTitle?.match(/(\d+)/)?.[1];
  const ep = item.index;
  const code = season && ep != null
    ? `S${String(season).padStart(2, '0')}E${String(ep).padStart(2, '0')}`
    : ep != null ? `E${String(ep).padStart(2, '0')}` : '';
  return code ? `${code} — ${item.title}` : item.title;
}

/** Only the things worth opening: shows and movies from a mixed search. */
export function playableItems(items: PlexItem[]): PlexItem[] {
  return items.filter((i) => i.type === 'show' || i.type === 'movie' || i.type === 'episode');
}

/**
 * Choose which live session the open transcript note is following. One session
 * → that one. Many → the one whose episode/show fuzzy-matches the note's
 * frontmatter `title`/`show` (reuses the podcast episode matcher). No confident
 * match among several → null, so the caller can list them rather than guess.
 */
export function pickPlexSession(
  sessions: PlexSession[],
  note: { title?: string; show?: string } | null,
): PlexSession | null {
  if (sessions.length === 0) return null;
  if (sessions.length === 1) return sessions[0];
  const title = note?.title?.trim();
  if (title) {
    const byEpisode = matchEpisodeNote(title, sessions);
    if (byEpisode) return byEpisode;
  }
  const show = note?.show?.trim();
  if (show) {
    const withShow = sessions.filter((s) => s.show).map((s) => ({ title: s.show as string, s }));
    const byShow = matchEpisodeNote(show, withShow);
    if (byShow) return byShow.s;
  }
  return null;
}

/** ffmpeg args to cut ONE audio clip from a (network) source URL at [start,end].
 *  Input-seek (`-ss` before `-i`) matches clipFromLocal so the seek is fast. */
export function buildPlexClipArgs(
  srcUrl: string, startSec: number, endSec: number, outPath: string, audioFormat: 'mp3' | 'opus' | 'm4a',
): string[] {
  const start = Math.max(0, Math.floor(startSec));
  const dur = Math.max(1, Math.floor(endSec) - start);
  const codec = audioFormat === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '4']
    : audioFormat === 'opus' ? ['-c:a', 'libopus', '-b:a', '96k']
    : ['-c:a', 'aac', '-b:a', '128k'];   // mkv source → re-encode (no stream-copy)
  return ['-y', '-loglevel', 'error', '-ss', String(start), '-i', srcUrl, '-t', String(dur), '-vn', ...codec, outPath];
}

/** ffmpeg args to grab ONE still frame from a (network) source URL at a time. */
export function buildPlexStillArgs(srcUrl: string, atSec: number, outPath: string): string[] {
  const at = Math.max(0, Math.floor(atSec));
  return ['-y', '-loglevel', 'error', '-ss', String(at), '-i', srcUrl, '-frames:v', '1', '-q:v', '2', outPath];
}
