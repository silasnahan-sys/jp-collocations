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
    });
  }
  return { ok: true, sessions };
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
