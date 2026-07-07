/**
 * yt-history-client.ts — ⚠ the ONLY file that knows YouTube's *internal* watch-
 * history API (DESIGN §4 YtHistoryAdapter, isolation invariant #2). This is the
 * live, complete, cross-device history — the same InnerTube `browse/FEhistory`
 * endpoint that powers youtube.com/feed/history.
 *
 * AUTH is the user's logged-in session cookie (pasted once, reused — exactly the
 * XClient pattern). YouTube signs internal requests with a `SAPISIDHASH`
 * Authorization header derived from the SAPISID cookie; we compute it with Web
 * Crypto (SHA-1), which works on desktop AND mobile. Cookies/keys rotate, so the
 * INNERTUBE key + client version are user-overridable and every error is surfaced
 * verbatim. Upper layers depend only on the stable `WatchedVideo` shape.
 *
 * The history feed is reverse-chronological with per-day date sections, so a DATE
 * RANGE is native: we walk continuations and stop as soon as a section's date
 * falls before `since`. The pure helpers (`cookieValue`, `sapisidAuth`,
 * `parseSectionDate`, `extractHistoryPage`) take no network so the golden harness
 * exercises them against a real captured response.
 */

import type { HttpClient } from './transcript.ts';
import type { WatchedVideo, DateRange } from './yt-history.ts';

export interface YtHistorySettings {
  /** Full youtube.com Cookie header, pasted once (like the X auth cookies). */
  cookie: string;
  /** INNERTUBE api key (public web default; overridable if it ever rotates). */
  apiKey: string;
  /** WEB client version (rotates; browse is lenient but keep it current-ish). */
  clientVersion: string;
  hl: string;
  gl: string;
}

export const DEFAULT_YT_HISTORY_SETTINGS: YtHistorySettings = {
  cookie: '',
  apiKey: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
  clientVersion: '2.20240726.00.00',
  hl: 'en',
  gl: 'US',
};

export class YtHistoryError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'YtHistoryError';
    this.status = status;
  }
}

const ORIGIN = 'https://www.youtube.com';

// ── PURE: cookie + auth ─────────────────────────────────────────────────────────

/**
 * Accept EITHER a raw `name=value; …` cookie string OR a whole "Copy as cURL"
 * blob and return just the cookie string. DevTools hides the Cookie line behind
 * "provisional headers" for cached requests, so pasting the cURL (which always
 * carries the cookie, via `-H 'cookie: …'` or `-b '…'`) is the reliable capture.
 * Non-cURL input is returned as-is so a raw paste still works.
 */
/** Parse a Netscape `cookies.txt` (what "Get cookies.txt" extensions export) into
 *  a `name=value; …` header. Handles the `#HttpOnly_` data-line prefix (those are
 *  cookies, not comments) and tab- or whitespace-separated columns. '' if none. */
export function parseNetscapeCookies(text: string): string {
  const pairs: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine;
    if (line.startsWith('#HttpOnly_')) line = line.slice('#HttpOnly_'.length);
    else if (!line.trim() || line.startsWith('#')) continue;
    let cols = line.split('\t');
    if (cols.length < 7) cols = line.trim().split(/\s+/);
    if (cols.length >= 7 && cols[5]) pairs.push(`${cols[5]}=${cols.slice(6).join(' ')}`);
  }
  return pairs.join('; ');
}

export function normalizeCookieInput(input: string): string {
  let s = (input || '').trim();
  if (!s) return '';
  // Netscape cookies.txt export (multi-line, tab-separated, mentions youtube).
  if (/^#\s*(Netscape|HTTP Cookie)/i.test(s) || (/\n/.test(s) && /\t/.test(s) && /youtube/i.test(s))) {
    const fromFile = parseNetscapeCookies(s);
    if (fromFile) return fromFile;
  }
  const looksCurl = /(^|\s)curl[\s.]/i.test(s) || /\s-H\s/.test(s) || /(^|\s)(-b|--cookie)\s/.test(s);
  if (!looksCurl) return s;
  // Windows "Copy as cURL (cmd)" uses `^` line-continuations and `^"` quoting.
  // Unescape it back to plain quotes so the extractors below apply uniformly.
  if (s.includes('^"') || /\^\r?\n/.test(s)) {
    s = s.replace(/\^\r?\n/g, ' ').replace(/\^(.)/g, '$1');
  }
  const unescape = (v: string) => v.replace(/\\(['"\\])/g, '$1').replace(/\\\r?\n/g, '').trim();
  // -H $'cookie: …' / -H "cookie: …" / -H 'cookie: …'
  const hdr = s.match(/-H\s+\$?(['"])\s*cookie:\s*([\s\S]*?)\1/i);
  if (hdr) return unescape(hdr[2]);
  // -b '…' / --cookie '…'
  const b = s.match(/(?:-b|--cookie)\s+\$?(['"])([\s\S]*?)\1/i);
  if (b) return unescape(b[2]);
  return s;   // looked like cURL but no cookie found — leave it so the user notices
}

/** Read one cookie value out of a Cookie header string. */
export function cookieValue(cookie: string, name: string): string | null {
  const re = new RegExp('(?:^|;\\s*)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]+)');
  const m = cookie.match(re);
  return m ? m[1] : null;
}

async function sha1Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build the `Authorization` value YouTube expects: SAPISIDHASH (+ 1P/3P variants
 * when those cookies exist). `nowSec` is injected so the result is testable.
 * Returns null when the cookie carries no SAPISID (→ not a logged-in cookie).
 */
export async function sapisidAuth(cookie: string, nowSec: number, origin = ORIGIN): Promise<string | null> {
  const sapisid = cookieValue(cookie, 'SAPISID') ?? cookieValue(cookie, '__Secure-3PAPISID');
  if (!sapisid) return null;
  const p1 = cookieValue(cookie, '__Secure-1PAPISID');
  const p3 = cookieValue(cookie, '__Secure-3PAPISID');
  const mk = async (sid: string | null, label: string) =>
    sid ? `${label} ${nowSec}_${await sha1Hex(`${nowSec} ${sid} ${origin}`)}` : null;
  const parts = [
    await mk(sapisid, 'SAPISIDHASH'),
    await mk(p1, 'SAPISID1PHASH'),
    await mk(p3, 'SAPISID3PHASH'),
  ].filter(Boolean);
  return parts.join(' ');
}

// ── PURE: date-section labels → epoch ms (day start) ────────────────────────────

const DAY = 86_400_000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Map a history section header ("Today" / "Yesterday" / "Monday" / "Jan 5, 2026")
 *  to a day-start epoch ms. `nowMs` injected for testability. Null if unrecognized. */
export function parseSectionDate(label: string, nowMs: number): number | null {
  const s = (label || '').trim();
  if (!s) return null;
  const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const low = s.toLowerCase();
  if (low === 'today') return startOfDay(nowMs);
  if (low === 'yesterday') return startOfDay(nowMs - DAY);
  const wd = WEEKDAYS.indexOf(low);
  if (wd >= 0) {
    // most recent PAST occurrence (history never labels today by weekday)
    const today = new Date(startOfDay(nowMs));
    let diff = (today.getDay() - wd + 7) % 7;
    if (diff === 0) diff = 7;
    return startOfDay(nowMs) - diff * DAY;
  }
  // absolute date. Guard first: V8's Date.parse is lenient enough to pull a year
  // out of "garble, 2026", so only parse labels that actually look like a date
  // (English month name or a numeric date). Then add the current year when the
  // label omits one ("Jan 5" alone parses to year 2001, not NaN).
  const looksDate = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(s) ||
    /\d{1,2}[/-]\d{1,2}/.test(s) || /\d{1,2},?\s+\d{4}/.test(s);
  if (!looksDate) return null;
  const hasYear = /\d{4}/.test(s);
  const parsed = Date.parse(hasYear ? s : `${s}, ${new Date(nowMs).getFullYear()}`);
  return Number.isNaN(parsed) ? null : startOfDay(parsed);
}

// ── PURE: response parsing ──────────────────────────────────────────────────────

/** First text found in a renderer OR view-model object (`content` for the newer
 *  *ViewModel shapes, `simpleText`/`runs` for classic renderers). */
function firstText(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.content === 'string') return o.content;         // lockupMetadataViewModel.title.content
  if (typeof o.simpleText === 'string') return o.simpleText;
  if (Array.isArray(o.runs)) return (o.runs as { text?: string }[]).map((r) => r.text ?? '').join('');
  return null;
}

/** Pull a videoId + title from a videoRenderer / reelItemRenderer / lockup. */
function videoFrom(item: unknown): { id: string; title: string } | null {
  const it = item as Record<string, any>;
  const vr = it?.videoRenderer;
  if (vr?.videoId) return { id: vr.videoId, title: firstText(vr.title) ?? vr.videoId };
  const reel = it?.reelItemRenderer;
  if (reel?.videoId) return { id: reel.videoId, title: firstText(reel.headline) ?? reel.videoId };
  const lockup = it?.lockupViewModel;
  if (lockup?.contentId && /^[A-Za-z0-9_-]{11}$/.test(lockup.contentId)) {
    return { id: lockup.contentId, title: firstText(lockup?.metadata?.lockupMetadataViewModel?.title) ?? lockup.contentId };
  }
  return null;
}

function continuationToken(node: unknown): string | null {
  const n = node as Record<string, any>;
  return (
    n?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ??
    n?.continuations?.[0]?.nextContinuationData?.continuation ??
    null
  );
}

/** The ordered renderer list from a first page or a continuation page. */
function pageItems(resp: unknown): { items: any[]; pageContinuation: string | null } {
  const r = resp as Record<string, any>;
  const slr = r?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer;
  if (Array.isArray(slr?.contents)) return { items: slr.contents, pageContinuation: continuationToken(slr) };
  for (const a of r?.onResponseReceivedActions ?? []) {
    const ci = a?.appendContinuationItemsAction?.continuationItems;
    if (Array.isArray(ci)) return { items: ci, pageContinuation: null };
  }
  return { items: [], pageContinuation: null };
}

export interface HistoryPage {
  videos: WatchedVideo[];   // watchedAt = section day (0 if the section had no date)
  continuation: string | null;
  loggedOut: boolean;
}

/** Parse one browse response into dated videos + the next continuation token. */
export function extractHistoryPage(resp: unknown, nowMs: number): HistoryPage {
  const loggedOut = (resp as any)?.responseContext?.mainAppWebResponseContext?.loggedOut === true;
  const { items, pageContinuation } = pageItems(resp);
  const videos: WatchedVideo[] = [];
  let continuation = pageContinuation;
  let curDate = 0;

  const walkSection = (sec: any) => {
    const label = firstText(sec?.header?.itemSectionHeaderRenderer?.title) ?? firstText(sec?.header);
    if (label) { const d = parseSectionDate(label, nowMs); if (d) curDate = d; }
    for (const it of sec?.contents ?? []) {
      const v = videoFrom(it);
      if (v) { videos.push({ id: v.id, title: v.title, url: `https://youtu.be/${v.id}`, watchedAt: curDate }); continue; }
      const tok = continuationToken(it);
      if (tok) continuation = tok;
    }
    const secCont = continuationToken(sec);
    if (secCont) continuation = secCont;
  };

  for (const node of items) {
    if (node?.itemSectionRenderer) { walkSection(node.itemSectionRenderer); continue; }
    const tok = continuationToken(node);
    if (tok) { continuation = tok; continue; }
    const v = videoFrom(node);
    if (v) videos.push({ id: v.id, title: v.title, url: `https://youtu.be/${v.id}`, watchedAt: curDate });
  }
  return { videos, continuation, loggedOut };
}

// ── the client (network) ────────────────────────────────────────────────────────

export interface HistoryFetchResult {
  videos: WatchedVideo[];
  pages: number;
  stopped: 'reached-since' | 'max-videos' | 'max-pages' | 'no-more';
}

export class YtHistoryClient {
  private http: HttpClient;
  private getSettings: () => YtHistorySettings;

  constructor(http: HttpClient, getSettings: () => YtHistorySettings) {
    this.http = http;
    this.getSettings = getSettings;
  }

  /** The cookie header, normalized (accepts a raw string or a pasted cURL blob). */
  private cookie(): string {
    return normalizeCookieInput(this.getSettings().cookie);
  }

  configIssue(): string | null {
    const cookie = this.cookie();
    if (!cookie) return 'YouTube のログイン Cookie が未設定です（設定に貼り付けてください）。';
    if (!cookieValue(cookie, 'SAPISID') && !cookieValue(cookie, '__Secure-3PAPISID'))
      return 'Cookie に SAPISID がありません。youtube.com のフル Cookie（または Copy as cURL）を貼り付けてください。';
    return null;
  }

  /** One raw browse call (first page when no continuation). Throws verbatim. */
  async fetchRaw(continuation?: string): Promise<unknown> {
    const s = this.getSettings();
    const cookie = this.cookie();
    const auth = await sapisidAuth(cookie, Math.floor(Date.now() / 1000));
    if (!auth) throw new YtHistoryError('Cookie に SAPISID がありません（フル Cookie を貼り付けてください）。');

    const url = `${ORIGIN}/youtubei/v1/browse?key=${encodeURIComponent(s.apiKey)}&prettyPrint=false`;
    const context = { client: { clientName: 'WEB', clientVersion: s.clientVersion, hl: s.hl, gl: s.gl, originalUrl: `${ORIGIN}/feed/history` } };
    const body = JSON.stringify(continuation ? { context, continuation } : { context, browseId: 'FEhistory' });
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: auth,
      cookie,
      origin: ORIGIN,
      'x-origin': ORIGIN,
      'x-goog-authuser': '0',
      'x-youtube-client-name': '1',
      'x-youtube-client-version': s.clientVersion,
    };

    let resp: { status: number; text: string };
    try {
      resp = await this.http.post(url, body, headers);
    } catch (e) {
      throw new YtHistoryError(`YouTube への接続に失敗: ${(e as Error).message}`);
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new YtHistoryError(`YouTube に拒否されました (HTTP ${resp.status})。Cookie が失効した可能性 — youtube.com から再取得してください。`, resp.status);
    }
    let json: any;
    try { json = JSON.parse(resp.text); } catch { throw new YtHistoryError(`YouTube が非 JSON を返しました (HTTP ${resp.status})。`, resp.status); }
    if (json?.error) throw new YtHistoryError(`YouTube API エラー: ${json.error?.message ?? 'unknown'}`, resp.status);
    if (resp.status !== 200) throw new YtHistoryError(`YouTube が HTTP ${resp.status} を返しました。`, resp.status);
    return json;
  }

  /**
   * Walk watch history newest→oldest, collecting videos within [since, until].
   * Stops as soon as a section predates `since` (reverse-chron), or at the video/
   * page caps. Throws YtHistoryError (verbatim) — caller degrades to Takeout/paste.
   */
  async listWatched(
    range: DateRange,
    opts: { maxVideos: number; maxPages?: number; onProgress?: (found: number, pages: number) => void } = { maxVideos: 50 },
  ): Promise<HistoryFetchResult> {
    const issue = this.configIssue();
    if (issue) throw new YtHistoryError(issue);
    const maxPages = opts.maxPages ?? 60;
    const nowMs = Date.now();
    const acc: WatchedVideo[] = [];
    const seen = new Set<string>();
    let continuation: string | undefined;
    let pages = 0;
    let stopped: HistoryFetchResult['stopped'] = 'no-more';

    while (pages < maxPages) {
      const resp = await this.fetchRaw(continuation);
      pages++;
      const page = extractHistoryPage(resp, nowMs);
      if (pages === 1 && page.loggedOut) throw new YtHistoryError('Cookie が無効/失効しています（loggedOut）。youtube.com から再取得して貼り付けてください。');

      let reachedSince = false;
      for (const v of page.videos) {
        if (v.watchedAt && v.watchedAt < range.since) { reachedSince = true; break; }
        if (v.watchedAt && v.watchedAt > range.until) continue;       // newer than window (rare at head)
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        acc.push(v);
      }
      opts.onProgress?.(acc.length, pages);
      if (reachedSince) { stopped = 'reached-since'; break; }
      if (acc.length >= opts.maxVideos) { stopped = 'max-videos'; break; }
      if (!page.continuation) { stopped = 'no-more'; break; }
      continuation = page.continuation;
      if (pages >= maxPages) { stopped = 'max-pages'; break; }
    }
    return { videos: acc.slice(0, opts.maxVideos), pages, stopped };
  }
}
