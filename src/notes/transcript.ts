/**
 * transcript.ts — ⚠ the ONLY file that knows YouTube's caption endpoints
 * (DESIGN §4 TranscriptAdapter, isolation invariant #2).
 *
 * Fetches a video's transcript once (invariant #4: caller freezes it) and returns
 * it as timestamped lines. YouTube's caption transport is fragile and rotates, so
 * every reach into it is isolated here; errors are surfaced verbatim and the caller
 * degrades to a manual paste. The fetch degrades through a ladder, best → weakest:
 *
 *   Tier A — yt-dlp (desktop, ROBUST).  yt-dlp + a JS runtime (deno/node) solve
 *            YouTube's JS challenge and issue caption URLs that actually return
 *            content. This reuses the exact tooling the audio tier already sets up.
 *            VERIFIED against a real video (755 ja lines).
 *   Tier B — HTTP timedtext (mobile / no yt-dlp).  Pull `captionTracks` from the
 *            watch page's `ytInitialPlayerResponse`, then GET the track. NOTE: as of
 *            2024+ the WEB-issued timedtext URL is PO-token-gated and often returns
 *            EMPTY — so this tier is best-effort. When it yields nothing we say so
 *            (never fake a transcript) and the caller falls back to paste.
 *   Tier C — manual paste (always; handled by the caller/command).
 *
 * `fetch()` returns null ONLY when the video positively has no captions (skip, do
 * not fail — invariant #3). Any other failure throws `TranscriptError` so the exact
 * reason reaches the user.
 *
 * The pure parsers (`parseJson3`, `parseTimedtextXml`, `extractCaptionTracks`,
 * `pickTrack`) take no I/O so the golden harness exercises them on real fixtures.
 */

import { run, nodeReq, tail } from './audio-extractor.ts';

// ── data model (DESIGN §3) ─────────────────────────────────────────────────────

export interface TranscriptLine {
  index: number;     // 0-based position
  tStartSec: number; // caption start time
  text: string;
}

export type TranscriptSource = 'ytdlp' | 'timedtext' | 'innertube' | 'manual';

export interface Transcript {
  videoId: string;
  title: string;
  url: string;
  lang: string;      // e.g. "ja"
  source: TranscriptSource;
  fetchedAt: number; // epoch ms
  lines: TranscriptLine[];
}

export class TranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptError';
  }
}

/** One caption track as advertised by `ytInitialPlayerResponse`. */
export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;     // 'asr' for auto-captions; absent for human-authored
  name?: string;
}

// ── injected HTTP seam (Obsidian requestUrl in the plugin; node fetch in tests) ─

export interface HttpResponse { status: number; text: string; }
export interface HttpClient {
  get(url: string, headers?: Record<string, string>): Promise<HttpResponse>;
  post(url: string, body: string, headers?: Record<string, string>): Promise<HttpResponse>;
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── config ─────────────────────────────────────────────────────────────────────

export interface TranscriptFetchConfig {
  /** Preferred caption languages, best first. e.g. ['ja']. */
  langPref: string[];
  /** Prefer a human-authored track over the ASR one when both exist. */
  preferManual: boolean;
}

export const DEFAULT_TRANSCRIPT_CONFIG: TranscriptFetchConfig = {
  langPref: ['ja'],
  preferManual: true,
};

/** yt-dlp settings the transcript tier borrows from the audio config. */
export interface YtdlpTranscriptConfig {
  enabled: boolean;
  ytdlpPath: string;   // '' → 'yt-dlp' on PATH
  jsRuntime: string;   // '' → auto (deno/node on PATH)
  /** Absolute path to a writable temp dir for the subtitle file. */
  tmpDirAbs: string;
}

// ── PURE parsers ────────────────────────────────────────────────────────────────

/** Parse a timedtext `json3` document into lines. This is the format yt-dlp writes
 *  and the timedtext endpoint serves with `&fmt=json3`. */
export function parseJson3(text: string): TranscriptLine[] {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return []; }
  const events = (j as { events?: unknown[] })?.events ?? [];
  const out: TranscriptLine[] = [];
  let idx = 0;
  for (const evRaw of events) {
    const ev = evRaw as { segs?: { utf8?: string }[]; tStartMs?: number };
    if (!ev.segs) continue;
    const t = ev.segs.map((s) => s.utf8 ?? '').join('').replace(/\r?\n/g, ' ').trim();
    if (!t) continue;
    out.push({ index: idx++, tStartSec: Math.round((ev.tStartMs ?? 0) / 1000), text: t });
  }
  return out;
}

/** Parse a timedtext XML document (`srv1`/default `<transcript><text …>`). Fallback
 *  when json3 comes back empty. */
export function parseTimedtextXml(text: string): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  const re = /<text[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(text))) {
    const t = decodeXmlEntities(m[2]).replace(/<[^>]+>/g, '').replace(/\r?\n/g, ' ').trim();
    if (!t) continue;
    out.push({ index: idx++, tStartSec: Math.round(parseFloat(m[1])), text: t });
  }
  return out;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&#34;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Pull `ytInitialPlayerResponse` out of a watch-page HTML document. Null if absent
 *  (consent wall, bot page). */
export function extractPlayerResponse(html: string): unknown | null {
  const m =
    html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script>)/s) ||
    html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** The caption tracks advertised by a player-response object (HTML or InnerTube). */
export function extractCaptionTracks(playerResponse: unknown): CaptionTrack[] {
  const tracks =
    (playerResponse as {
      captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: unknown[] } };
    })?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const out: CaptionTrack[] = [];
  for (const tRaw of tracks) {
    const t = tRaw as { baseUrl?: string; languageCode?: string; kind?: string; name?: { simpleText?: string } };
    if (!t.baseUrl || !t.languageCode) continue;
    out.push({ baseUrl: t.baseUrl, languageCode: t.languageCode, kind: t.kind, name: t.name?.simpleText });
  }
  return out;
}

/** The video's title, if the player response carries it. */
export function extractTitle(playerResponse: unknown): string | null {
  const t = (playerResponse as { videoDetails?: { title?: string } })?.videoDetails?.title;
  return t && t.trim() ? t.trim() : null;
}

/** The playability status ('OK' | 'ERROR' | 'LOGIN_REQUIRED' | 'UNPLAYABLE' | …). */
export function playabilityStatus(playerResponse: unknown): string | null {
  return (playerResponse as { playabilityStatus?: { status?: string } })?.playabilityStatus?.status ?? null;
}

/** Choose the best track for the preferred languages. Manual over ASR when asked.
 *  Returns null if there are no tracks at all. */
export function pickTrack(tracks: CaptionTrack[], cfg: TranscriptFetchConfig): CaptionTrack | null {
  if (!tracks.length) return null;
  const isManual = (t: CaptionTrack) => t.kind !== 'asr';
  for (const lang of cfg.langPref) {
    const inLang = tracks.filter((t) => t.languageCode === lang || t.languageCode.startsWith(lang + '-'));
    if (!inLang.length) continue;
    if (cfg.preferManual) {
      const manual = inLang.find(isManual);
      if (manual) return manual;
    }
    return inLang[0];
  }
  // no preferred language present → prefer any manual track, else the first
  return tracks.find(isManual) ?? tracks[0];
}

// ── Tier B: HTTP timedtext ──────────────────────────────────────────────────────

/** Fetch the caption-track list via the watch page. Returns [] when the video has
 *  no captions, or throws TranscriptError on a hard failure (bot wall, offline). */
async function fetchTracksHttp(http: HttpClient, videoId: string): Promise<{ tracks: CaptionTrack[]; title: string | null }> {
  const url = `https://www.youtube.com/watch?v=${videoId}&hl=en&bpctr=9999999999&has_verified=1`;
  let resp: HttpResponse;
  try {
    resp = await http.get(url, { 'user-agent': BROWSER_UA, 'accept-language': 'ja,en;q=0.9', cookie: 'CONSENT=YES+cb' });
  } catch (e) {
    throw new TranscriptError(`Network error contacting YouTube: ${(e as Error).message}`);
  }
  if (resp.status !== 200) throw new TranscriptError(`YouTube watch page returned HTTP ${resp.status}.`);
  const pr = extractPlayerResponse(resp.text);
  if (!pr) throw new TranscriptError('Could not read ytInitialPlayerResponse (consent wall or page shape changed).');
  const status = playabilityStatus(pr);
  if (status && status !== 'OK') {
    throw new TranscriptError(`Video not playable (playabilityStatus: ${status}).`);
  }
  return { tracks: extractCaptionTracks(pr), title: extractTitle(pr) };
}

/** GET one caption track and parse it (json3 first, XML fallback). */
async function fetchTrackLines(http: HttpClient, track: CaptionTrack): Promise<TranscriptLine[]> {
  let j3: HttpResponse;
  try {
    j3 = await http.get(track.baseUrl + '&fmt=json3', { 'user-agent': BROWSER_UA });
  } catch (e) {
    throw new TranscriptError(`Network error fetching captions: ${(e as Error).message}`);
  }
  const lines = parseJson3(j3.text);
  if (lines.length) return lines;
  // json3 empty (PO-token gate) → try the default XML form
  let xml: HttpResponse;
  try { xml = await http.get(track.baseUrl, { 'user-agent': BROWSER_UA }); } catch { return []; }
  return parseTimedtextXml(xml.text);
}

// ── Tier A: yt-dlp (desktop) ────────────────────────────────────────────────────

/** Build the yt-dlp arg vector for a subtitles-only fetch (PURE; verified recipe).
 *  Writes `<template>.<lang>.json3`. Prefers manual subs, falls back to auto. */
export function buildYtdlpSubsArgs(cfg: YtdlpTranscriptConfig, langPref: string[], videoId: string, outTemplate: string): string[] {
  const langs = langPref.length ? langPref.join(',') : 'ja';
  const args: string[] = [];
  if (cfg.jsRuntime) args.push('--js-runtimes', cfg.jsRuntime);
  args.push(
    '--write-subs', '--write-auto-subs',
    '--sub-langs', langs,
    '--sub-format', 'json3',
    '--skip-download',
    '--no-playlist',
    '--no-warnings',
    '--socket-timeout', '30', '--retries', '3',
    '--no-progress', '--ignore-config',
    '-o', outTemplate,
    `https://youtu.be/${videoId}`,
  );
  return args;
}

interface YtdlpSubsResult {
  lines: TranscriptLine[];
  lang: string;
  /** True when yt-dlp ran cleanly but the video has NO captions (→ caller returns null). */
  noCaptions: boolean;
  error?: string;
  stderrTail?: string;
}

/** DESKTOP ONLY. Fetch a transcript with yt-dlp. Never throws; reports via result. */
export async function fetchViaYtdlp(cfg: YtdlpTranscriptConfig, langPref: string[], videoId: string): Promise<YtdlpSubsResult> {
  const bin = cfg.ytdlpPath || 'yt-dlp';
  const fs = nodeReq<{
    existsSync(p: string): boolean; readdirSync(p: string): string[];
    readFileSync(p: string, enc: string): string; unlinkSync(p: string): void;
  }>('fs');
  const path = nodeReq<{ join(...p: string[]): string }>('path');
  const prefix = `_ytsub_${videoId}`;
  const outTemplate = path.join(cfg.tmpDirAbs, `${prefix}.%(ext)s`);
  const args = buildYtdlpSubsArgs(cfg, langPref, videoId, outTemplate);

  // clear any stale sub files from a prior run
  const clean = () => {
    try { for (const f of fs.readdirSync(cfg.tmpDirAbs)) if (f.startsWith(prefix)) fs.unlinkSync(path.join(cfg.tmpDirAbs, f)); }
    catch { /* */ }
  };
  clean();

  let res: { code: number | null; stderr: string; stdout: string };
  try {
    res = await run(bin, args, 120_000);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { lines: [], lang: langPref[0] ?? 'ja', noCaptions: false, error: /ENOENT/.test(msg) ? `yt-dlp not found (${bin}).` : msg };
  }

  // find the produced .json3 (yt-dlp names it <prefix>.<lang>.json3, lang may be 'ja' or 'ja-orig')
  let subFile = '', subLang = langPref[0] ?? 'ja';
  try {
    for (const f of fs.readdirSync(cfg.tmpDirAbs)) {
      const m = f.startsWith(prefix) && f.match(/\.([\w-]+)\.json3$/);
      if (m) { subFile = path.join(cfg.tmpDirAbs, f); subLang = m[1]; break; }
    }
  } catch { /* */ }

  if (!subFile) {
    // ran clean but wrote no subs → genuinely no captions in the requested langs
    const jsHint = /No supported JavaScript runtime/i.test(res.stderr)
      ? ' A JavaScript runtime (deno or node) is required.' : '';
    if (res.code === 0) return { lines: [], lang: subLang, noCaptions: true };
    return { lines: [], lang: subLang, noCaptions: false, error: `yt-dlp produced no subtitles (exit ${res.code}).${jsHint}`, stderrTail: tail(res.stderr) };
  }

  let raw = '';
  try { raw = fs.readFileSync(subFile, 'utf8'); } catch { /* */ }
  const lines = parseJson3(raw);
  clean();
  if (!lines.length) return { lines: [], lang: subLang, noCaptions: false, error: 'Subtitle file was empty or unparseable.' };
  return { lines, lang: subLang, noCaptions: false };
}

// ── title (best-effort, mobile-safe, no auth) ───────────────────────────────────

/** Fetch a video's title via the public oEmbed endpoint. Null on any failure. */
export async function fetchTitle(http: HttpClient | null, videoId: string): Promise<string | null> {
  if (!http) return null;
  try {
    const r = await http.get(`https://www.youtube.com/oembed?url=https://youtu.be/${videoId}&format=json`);
    if (r.status !== 200) return null;
    const j = JSON.parse(r.text) as { title?: string };
    return j.title?.trim() || null;
  } catch { return null; }
}

// ── the adapter (DESIGN §4 TranscriptAdapter) ───────────────────────────────────

export class YouTubeTranscriptAdapter {
  private http: HttpClient | null;
  private cfg: TranscriptFetchConfig;
  private ytdlp: YtdlpTranscriptConfig | null;

  constructor(http: HttpClient | null, cfg: TranscriptFetchConfig, ytdlp: YtdlpTranscriptConfig | null) {
    this.http = http;
    this.cfg = cfg;
    this.ytdlp = ytdlp;
  }

  /** True when at least one tier can run. */
  isAvailable(): boolean {
    return !!(this.ytdlp?.enabled) || !!this.http;
  }

  /**
   * Fetch a transcript, degrading down the tier ladder. Returns null when the
   * video positively has no captions (skip). Throws TranscriptError (verbatim
   * reason) on a hard failure — the caller then offers manual paste.
   */
  async fetch(videoId: string): Promise<Transcript | null> {
    const reasons: string[] = [];
    let title: string | null = null;

    // Tier A — yt-dlp (desktop, robust)
    if (this.ytdlp?.enabled) {
      const r = await fetchViaYtdlp(this.ytdlp, this.cfg.langPref, videoId);
      if (r.lines.length) {
        title = (await fetchTitle(this.http, videoId)) ?? title;
        return this.assemble(videoId, r.lines, r.lang, 'ytdlp', title);
      }
      if (r.noCaptions) return null;
      reasons.push(`yt-dlp: ${r.error ?? 'no output'}${r.stderrTail ? ` — ${r.stderrTail}` : ''}`);
    }

    // Tier B — HTTP timedtext (mobile / no yt-dlp)
    if (this.http) {
      try {
        const { tracks, title: t } = await fetchTracksHttp(this.http, videoId);
        title = t ?? title;
        if (tracks.length === 0) return null;              // positively no captions
        const pick = pickTrack(tracks, this.cfg);
        if (pick) {
          const lines = await fetchTrackLines(this.http, pick);
          if (lines.length) return this.assemble(videoId, lines, pick.languageCode, 'timedtext', title);
          reasons.push('timedtext returned empty (YouTube PO-token gate — enable the desktop yt-dlp tier for a reliable fetch).');
        }
      } catch (e) {
        reasons.push(e instanceof TranscriptError ? e.message : `http: ${(e as Error).message}`);
      }
    }

    if (!this.isAvailable()) reasons.push('No transcript tier is configured (enable the yt-dlp desktop tier or provide network access).');
    throw new TranscriptError(`Could not fetch a transcript for ${videoId}. ${reasons.join(' | ')}`);
  }

  private assemble(videoId: string, lines: TranscriptLine[], lang: string, source: TranscriptSource, title: string | null): Transcript {
    return {
      videoId,
      title: title ?? videoId,
      url: `https://youtu.be/${videoId}`,
      lang,
      source,
      fetchedAt: Date.now(),
      lines,
    };
  }
}
