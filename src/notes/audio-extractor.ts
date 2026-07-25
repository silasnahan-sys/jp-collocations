/**
 * audio-extractor.ts — DESKTOP-ONLY yt-dlp MP3 clip tier (DESIGN §12 Tier 1).
 *
 * Turns a reconciled span's `{ videoId, startSec, endSec }` into a small local
 * audio clip (`clip_<id>_<start>.mp3`, ~0.05–2 MB) that a card embeds for
 * Anki-style in-context listening. The timestamp stays the durable primitive
 * (Tier 0 deep-link always works); this only *enriches* it when the desktop
 * tools are present.
 *
 * HARD CONSTRAINTS (all learned by actually running it, 2026-07-04):
 *  - Desktop only. Node's `child_process`/`fs` do not exist on mobile Obsidian, so
 *    this module NEVER imports them at top level (that would crash the plugin at
 *    load on a phone). It lazy-`require`s them, and every entry point is guarded by
 *    `Platform.isDesktopApp` at the call site (main.ts).
 *  - A JavaScript runtime is REQUIRED. Modern YouTube needs a JS runtime (deno,
 *    auto-detected on PATH, or node via `--js-runtimes node:<path>`) to decipher
 *    stream signatures; without one, yt-dlp silently downloads empty fragments.
 *    We surface this as a real, named error instead of producing a 1 KB dud.
 *  - ffmpeg is required for `-x`/clipping and is often NOT on PATH (winget puts it
 *    in a package dir), so we pass `--ffmpeg-location` when we can find it.
 *  - The section is `*START-END`. Requesting a range past the video length yields
 *    an empty file — we validate duration/size and report it, never pretend.
 *
 * ToS: downloading YouTube audio is a personal-use gray area. This is gated behind
 * an explicit opt-in setting; the plugin ships no downloader and auto-installs
 * nothing. If the tools are absent it degrades to *emitting the command* so the
 * user can run it themselves (see `ytDlpClipCommand`).
 */

import { clipFileName } from './audio-provider.ts';

/** Resolved tool config (paths already discovered; '' means "use bare name / auto"). */
export interface AudioExtractionConfig {
  enabled: boolean;
  /** yt-dlp binary. '' → 'yt-dlp' (PATH). */
  ytdlpPath: string;
  /** ffmpeg *directory or binary*. '' → let yt-dlp find it on PATH. */
  ffmpegPath: string;
  /** JS runtime spec e.g. 'node:C:\\...\\node.exe'. '' → auto (deno/node on PATH). */
  jsRuntime: string;
  /** Extracted audio container. mp3 = Obsidian-native playback. */
  audioFormat: 'mp3' | 'm4a' | 'opus';
  /** Clip length in seconds when the span has no explicit end. */
  clipLengthSec: number;
  /** Seconds of lead-in before the located start (context; clamped at 0). */
  preRollSec: number;
  /** Vault-relative folder the clips are written into. */
  outputFolder: string;
  /** Full youtube.com Cookie header — threaded at CALL time from the history
   *  settings (never persisted here). YouTube bot-walls anonymous downloads
   *  ("Sign in to confirm you're not a bot"); the logged-in cookie passes. */
  cookieHeader?: string;
  /** Stable absolute path for the persistent cookie JAR (see ensureCookieJar).
   *  Threaded at call time (plugin dir); without it a throwaway temp file is
   *  used, which breaks on the SECOND run once YouTube rotates the tokens. */
  cookieJarAbs?: string;
}

/** FNV-1a of the pasted header — identifies which paste seeded the jar. */
export function cookieHeaderHash(header: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < header.length; i++) { h ^= header.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/**
 * Persistent cookie jar for yt-dlp. CRITICAL (verified 2026-07-11): YouTube
 * ROTATES the session tokens on every authenticated player request, and yt-dlp
 * writes the rotated cookies back into its `--cookies` file. Regenerating the
 * file from the originally-pasted header therefore works exactly ONCE — the
 * next run presents rotated-out tokens and the media URL 403s. So the jar
 * lives at a stable path that yt-dlp owns across runs (like a browser profile),
 * and is re-seeded from the header only when the USER pastes a new one (hash
 * recorded in a sidecar `.meta` file — yt-dlp rewrites the jar itself, so the
 * marker cannot live inside it).
 */
export function ensureCookieJar(cookieHeader: string | undefined, jarAbs: string | undefined, tag: string): { path: string | null; temp: boolean } {
  if (!cookieHeader?.trim()) return { path: null, temp: false };
  if (!jarAbs) return { path: writeCookiesFile(cookieHeader, tag), temp: true };
  try {
    const fs = nodeReq<{
      existsSync(p: string): boolean; readFileSync(p: string, e: string): string; writeFileSync(p: string, s: string): void;
    }>('fs');
    const hash = cookieHeaderHash(cookieHeader);
    const meta = jarAbs + '.meta';
    if (fs.existsSync(jarAbs) && fs.existsSync(meta) && fs.readFileSync(meta, 'utf8').trim() === hash) {
      return { path: jarAbs, temp: false };            // same paste → reuse the (rotated) jar
    }
    const lines = ['# Netscape HTTP Cookie File'];
    for (const pair of cookieHeader.split(';')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      if (!name) continue;
      lines.push(`.youtube.com\tTRUE\t/\tTRUE\t2147483647\t${name}\t${pair.slice(eq + 1).trim()}`);
    }
    if (lines.length < 2) return { path: null, temp: false };
    fs.writeFileSync(jarAbs, lines.join('\n') + '\n');
    fs.writeFileSync(meta, hash + '\n');
    return { path: jarAbs, temp: false };
  } catch { return { path: writeCookiesFile(cookieHeader, tag), temp: true }; }
}

/** Cookie header → a temp Netscape cookies.txt for `--cookies`. Returns the
 *  absolute path, or null when the header is empty / fs unavailable. The file
 *  contains SECRETS: callers delete it after the run (best-effort). */
export function writeCookiesFile(cookieHeader: string | undefined, tag: string): string | null {
  if (!cookieHeader?.trim()) return null;
  try {
    const fs = nodeReq<{ writeFileSync(p: string, s: string): void }>('fs');
    const os = nodeReq<{ tmpdir(): string }>('os');
    const path = nodeReq<{ join(...p: string[]): string }>('path');
    const lines = ['# Netscape HTTP Cookie File'];
    for (const pair of cookieHeader.split(';')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) continue;
      lines.push(`.youtube.com\tTRUE\t/\tTRUE\t2147483647\t${name}\t${value}`);
    }
    if (lines.length < 2) return null;
    const p = path.join(os.tmpdir(), `_yt_cookies_${tag}.txt`);
    fs.writeFileSync(p, lines.join('\n') + '\n');
    return p;
  } catch { return null; }
}

/** Best-effort removal of a secrets file. */
export function removeCookiesFile(p: string | null): void {
  if (!p) return;
  try { nodeReq<{ unlinkSync(q: string): void }>('fs').unlinkSync(p); } catch { /* */ }
}

export const DEFAULT_AUDIO_EXTRACTION: AudioExtractionConfig = {
  enabled: false,           // opt-in (ToS)
  ytdlpPath: '',
  ffmpegPath: '',
  jsRuntime: '',
  audioFormat: 'mp3',
  clipLengthSec: 12,
  preRollSec: 0,
  outputFolder: 'JP Audio Clips',
};

export interface ExtractRequest {
  videoId: string;
  startSec: number;
  /** Explicit end; if omitted, start + clipLengthSec is used. */
  endSec?: number;
}

export interface ExtractResult {
  ok: boolean;
  /** Absolute path to the produced clip (present iff ok). */
  outPath: string;
  bytes: number;
  durationSec: number;
  /** The exact command that was (or would be) run — always populated, for transparency. */
  command: string;
  error?: string;
  /** Last lines of yt-dlp/ffmpeg stderr on failure, for diagnosis. */
  stderrTail?: string;
}

/** Resolve the [start, end] window for a request (clamped, end after start). */
export function clipWindow(req: ExtractRequest, cfg: AudioExtractionConfig): [number, number] {
  const start = Math.max(0, Math.floor(req.startSec - Math.max(0, cfg.preRollSec)));
  const rawEnd = req.endSec != null ? Math.floor(req.endSec) : Math.floor(req.startSec + cfg.clipLengthSec);
  const end = Math.max(start + 1, rawEnd);
  return [start, end];
}

/**
 * Build the yt-dlp argument vector (PURE — no I/O, unit-testable). This is the
 * exact recipe verified to produce a valid clip: audio-only format, section
 * range, extract to the chosen format, JS runtime + ffmpeg location when known.
 */
export function buildYtdlpArgs(
  req: ExtractRequest,
  cfg: AudioExtractionConfig,
  outPath: string,
  cookiesFile?: string | null,
): string[] {
  const [start, end] = clipWindow(req, cfg);
  const args: string[] = [];
  if (cfg.ffmpegPath) args.push('--ffmpeg-location', cfg.ffmpegPath);
  if (cfg.jsRuntime) args.push('--js-runtimes', cfg.jsRuntime);
  if (cookiesFile) args.push('--cookies', cookiesFile);
  args.push(
    '-f', '140/bestaudio[ext=m4a]/bestaudio',   // m4a first → clean, precise cuts
    '--download-sections', `*${start}-${end}`,
    '-x', '--audio-format', cfg.audioFormat,
    '--no-playlist',
    '--no-part',
    // Stall guards: abort a wedged network read, cap retries, quiet progress, and
    // never read a user config that might add interactive/hanging behaviour.
    '--socket-timeout', '30',
    '--retries', '3',
    '--fragment-retries', '3',
    '--no-progress',
    '--ignore-config',
    '-o', outPath,
    `https://youtu.be/${req.videoId}`,
  );
  return args;
}

/** Human-readable command line (for logging + the emit-command degrade path). */
export function commandLine(bin: string, args: string[]): string {
  const q = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  return [q(bin || 'yt-dlp'), ...args.map(q)].join(' ');
}

// ── desktop-only runtime bits (lazy; never touched on mobile) ──────────────────

/** Get Node's `require` in the Obsidian desktop (Electron) runtime. Obsidian
 *  exposes it lexically in the CJS module scope — NOT reliably on globalThis — so
 *  `(0,eval)("require")` (opaque to esbuild) is the robust way to reach it; fall
 *  back to window/globalThis. Throws on mobile (no nodeIntegration). */
function getRequire(): (m: string) => unknown {
  let r: unknown;
  try { r = eval('require'); } catch { /* not in lexical scope */ }         // direct eval → module scope
  if (typeof r !== 'function') { try { r = (0, eval)('require'); } catch { /* not global */ } } // indirect → global
  if (typeof r !== 'function') r = (globalThis as { require?: unknown }).require;
  if (typeof r !== 'function' && typeof window !== 'undefined') r = (window as { require?: unknown }).require;
  if (typeof r !== 'function') throw new Error('Node require unavailable (mobile / no nodeIntegration)');
  return r as (m: string) => unknown;
}

export function nodeReq<T = unknown>(mod: string): T {
  return getRequire()(mod) as T;
}

/** True if this runtime can spawn processes (desktop Electron with Node). */
export function nodeRuntimeAvailable(): boolean {
  try { return typeof getRequire() === 'function'; } catch { return false; }
}

/** Which of the require strategies (if any) resolves — for diagnostics. */
export function requireStrategy(): string {
  try { if (typeof eval('require') === 'function') return 'direct-eval'; } catch { /* */ }
  try { if (typeof (0, eval)('require') === 'function') return 'indirect-eval'; } catch { /* */ }
  if (typeof (globalThis as { require?: unknown }).require === 'function') return 'globalThis';
  if (typeof window !== 'undefined' && typeof (window as { require?: unknown }).require === 'function') return 'window';
  return 'none';
}

/** Spawn `bin args` and capture the result — for a `--version`-style probe. Never throws. */
export async function probeBinary(bin: string, args: string[]): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string; error?: string }> {
  try {
    const { code, stdout, stderr } = await run(bin, args);
    return { ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (e) {
    return { ok: false, code: null, stdout: '', stderr: '', error: e instanceof Error ? e.message : String(e) };
  }
}

interface SpawnedProc {
  stderr: { on(ev: 'data', cb: (b: unknown) => void): void };
  stdout: { on(ev: 'data', cb: (b: unknown) => void): void };
  on(ev: 'error', cb: (e: Error) => void): void;
  on(ev: 'close', cb: (code: number | null) => void): void;
  kill(signal?: string): void;
}

/** Hard wall-clock cap per child process. A stalled yt-dlp is killed and reported
 *  as a failure so it can never freeze the whole batch. */
const RUN_TIMEOUT_MS = 150_000;

/** Run a binary, resolving with {code, stderr}. Rejects only on spawn failure.
 *  Ignores stdin (so the child can't block waiting for input) and self-kills on
 *  timeout (resolving with a synthetic failure code, never hanging). */
export function run(bin: string, args: string[], timeoutMs = RUN_TIMEOUT_MS): Promise<{ code: number | null; stderr: string; stdout: string }> {
  const cp = nodeReq<{ spawn(c: string, a: string[], o: unknown): SpawnedProc }>('child_process');
  return new Promise((resolve, reject) => {
    let stderr = '', stdout = '', settled = false;
    let proc: SpawnedProc;
    try {
      proc = cp.spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill(); } catch { /* already gone */ }
      resolve({ code: -1, stderr: stderr + `\n[jp-collocations: killed after ${Math.round(timeoutMs / 1000)}s timeout]`, stdout });
    }, timeoutMs);
    proc.stderr.on('data', (b) => { stderr += String(b); });
    proc.stdout.on('data', (b) => { stdout += String(b); });
    proc.on('error', (e) => { if (settled) return; settled = true; clearTimeout(timer); reject(e); });
    proc.on('close', (code) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ code, stderr, stdout }); });
  });
}

export const tail = (s: string, n = 6): string => s.trim().split(/\r?\n/).slice(-n).join('\n');

/** Probe a media file's duration (seconds) with ffprobe; 0 if unknown/missing. */
async function probeDuration(ffprobeBin: string, file: string): Promise<number> {
  try {
    const { stdout } = await run(ffprobeBin, [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) ? d : 0;
  } catch {
    return 0;
  }
}

/** ffprobe path derived from an ffmpeg dir/binary path ('' if not derivable). */
export function ffprobeFrom(ffmpegPath: string): string {
  if (!ffmpegPath) return 'ffprobe';
  const isBin = /ffmpeg(\.exe)?$/i.test(ffmpegPath);
  if (isBin) return ffmpegPath.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe'));
  const sep = ffmpegPath.includes('\\') ? '\\' : '/';
  const exe = ffmpegPath.includes('\\') ? 'ffprobe.exe' : 'ffprobe';
  return ffmpegPath.replace(/[\\/]$/, '') + sep + exe;
}

/** The ffmpeg binary path derived from an ffmpeg dir/binary setting. */
export function ffmpegBinFrom(ffmpegPath: string): string {
  if (!ffmpegPath) return 'ffmpeg';
  if (/ffmpeg(\.exe)?$/i.test(ffmpegPath)) return ffmpegPath;
  const sep = ffmpegPath.includes('\\') ? '\\' : '/';
  const exe = ffmpegPath.includes('\\') ? 'ffmpeg.exe' : 'ffmpeg';
  return ffmpegPath.replace(/[\\/]$/, '') + sep + exe;
}

// ── BATCH PATH: download full audio ONCE, cut clips locally (DESIGN §12) ───────
// `--download-sections` makes yt-dlp seek into the video *per clip*, which is slow
// and, for later timestamps in a long video, hangs. When several clips come from
// the SAME video, download the audio stream once (one nsig solve, one connection)
// and cut every clip locally with ffmpeg — instant and hang-proof.

export interface FullAudioResult {
  ok: boolean; srcPath: string; bytes: number; command: string; error?: string; stderrTail?: string;
}

/** yt-dlp args to fetch the whole audio-only stream (no sectioning). */
export function buildFullAudioArgs(cfg: AudioExtractionConfig, videoId: string, outTemplate: string, cookiesFile?: string | null): string[] {
  const args: string[] = [];
  if (cfg.ffmpegPath) args.push('--ffmpeg-location', cfg.ffmpegPath);
  if (cfg.jsRuntime) args.push('--js-runtimes', cfg.jsRuntime);
  // VERIFIED RECIPE (2026-07-11, yt-dlp ≥2026.07.04): cookies + DEFAULT clients
  // fully download (yt-dlp mints the PO tokens via its JS runtime). Do NOT force
  // player_client=tv — on current yt-dlp that path serves range-limited URLs
  // that 403 past the first chunk. Keep yt-dlp updated (`winget upgrade yt-dlp`).
  if (cookiesFile) args.push('--cookies', cookiesFile);
  args.push(
    '-f', '140/bestaudio[ext=m4a]/bestaudio',
    '--no-playlist', '--no-part',
    '--socket-timeout', '30', '--retries', '3', '--fragment-retries', '3',
    '--no-progress', '--ignore-config',
    '-o', outTemplate,
    `https://youtu.be/${videoId}`,
  );
  return args;
}

function findByPrefix(dir: string, prefix: string): string | null {
  try {
    const fs = nodeReq<{ readdirSync(p: string): string[] }>('fs');
    const path = nodeReq<{ join(...p: string[]): string }>('path');
    for (const f of fs.readdirSync(dir)) if (f.startsWith(prefix) && !f.endsWith('.part')) return path.join(dir, f);
  } catch { /* */ }
  return null;
}

/** Download the full audio-only stream into `folderAbs` as `_srcaudio_<id>.<ext>`.
 *  DESKTOP ONLY. Never throws. Generous timeout (audio for a long video is ~tens of MB). */
export async function downloadFullAudio(cfg: AudioExtractionConfig, videoId: string, folderAbs: string): Promise<FullAudioResult> {
  const bin = cfg.ytdlpPath || 'yt-dlp';
  const prefix = `_srcaudio_${videoId}`;
  const outTemplate = `${folderAbs}/${prefix}.%(ext)s`;
  const jar = ensureCookieJar(cfg.cookieHeader, cfg.cookieJarAbs, videoId);
  const cookiesFile = jar.path;
  const args = buildFullAudioArgs(cfg, videoId, outTemplate, cookiesFile);
  const command = commandLine(bin, args);
  const fs = nodeReq<{ existsSync(p: string): boolean; statSync(p: string): { size: number }; unlinkSync(p: string): void }>('fs');

  const stale = findByPrefix(folderAbs, prefix);
  if (stale) { try { fs.unlinkSync(stale); } catch { /* */ } }

  let res: { code: number | null; stderr: string; stdout: string };
  try {
    res = await run(bin, args, 240_000);   // 4 min ceiling for the single full download
  } catch (e) {
    if (jar.temp) removeCookiesFile(cookiesFile);
    const msg = e instanceof Error ? e.message : String(e);
    const hint = /ENOENT/.test(msg) ? `yt-dlp が見つかりません（${bin}）。` : msg;
    return { ok: false, srcPath: '', bytes: 0, command, error: hint };
  }
  if (jar.temp) removeCookiesFile(cookiesFile);   // the persistent jar must survive (rotated tokens live there)
  const src = findByPrefix(folderAbs, prefix);
  const bytes = src && fs.existsSync(src) ? fs.statSync(src).size : 0;
  if (res.code !== 0 || !src || bytes < 1024) {
    const jsHint = /No supported JavaScript runtime/i.test(res.stderr)
      ? '\nJavaScript ランタイム（deno か node）が必要です。' : '';
    const botHint = /confirm you.re not a bot|--cookies/i.test(res.stderr) && !cookiesFile
      ? '\nYouTube がログインを要求しています — 設定「視聴履歴（Cookie）」に youtube.com の Cookie を貼ると通ります。' : '';
    return { ok: false, srcPath: '', bytes, command, error: `full-audio ダウンロード失敗 (exit ${res.code}, ${bytes}B)${jsHint}${botHint}`, stderrTail: tail(res.stderr) };
  }
  return { ok: true, srcPath: src, bytes, command };
}

/** Cut one clip from a LOCAL audio file with ffmpeg (no network → never hangs). */
export async function clipFromLocal(
  cfg: AudioExtractionConfig, srcPath: string, startSec: number, endSec: number, outPath: string,
): Promise<ExtractResult> {
  const ff = ffmpegBinFrom(cfg.ffmpegPath);
  const start = Math.max(0, Math.floor(startSec));
  const dur = Math.max(1, Math.floor(endSec) - start);
  // m4a source → stream-copy for m4a (instant, lossless); re-encode for mp3/opus.
  const codec = cfg.audioFormat === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '4']
    : cfg.audioFormat === 'opus' ? ['-c:a', 'libopus', '-b:a', '96k']
    : ['-c:a', 'copy'];
  const args = ['-y', '-ss', String(start), '-i', srcPath, '-t', String(dur), '-vn', ...codec, outPath];
  const command = commandLine(ff, args);
  const baseR: ExtractResult = { ok: false, outPath: '', bytes: 0, durationSec: 0, command };

  let res: { code: number | null; stderr: string; stdout: string };
  try {
    res = await run(ff, args, 60_000);
  } catch (e) {
    return { ...baseR, error: e instanceof Error ? e.message : String(e) };
  }
  const fs = nodeReq<{ existsSync(p: string): boolean; statSync(p: string): { size: number } }>('fs');
  const exists = fs.existsSync(outPath);
  const bytes = exists ? fs.statSync(outPath).size : 0;
  if (res.code !== 0 || !exists || bytes < 512) {
    return { ...baseR, error: `ffmpeg 切り出し失敗 (exit ${res.code}, ${bytes}B)`, stderrTail: tail(res.stderr) };
  }
  const durationSec = await probeDuration(ffprobeFrom(cfg.ffmpegPath), outPath);
  return { ok: true, outPath, bytes, durationSec, command };
}

/**
 * Extract one clip. DESKTOP ONLY — the caller MUST guard with Platform.isDesktopApp.
 * Never throws; returns {ok:false, error, command} so callers can show the command
 * for the user to run manually (degrade-soft).
 */
export async function extractClip(
  req: ExtractRequest,
  cfg: AudioExtractionConfig,
  outPath: string,
): Promise<ExtractResult> {
  const bin = cfg.ytdlpPath || 'yt-dlp';
  const jar = ensureCookieJar(cfg.cookieHeader, cfg.cookieJarAbs, `clip_${req.videoId}`);
  const args = buildYtdlpArgs(req, cfg, outPath, jar.path);
  const command = commandLine(bin, args);
  const base: ExtractResult = { ok: false, outPath: '', bytes: 0, durationSec: 0, command };

  let res: { code: number | null; stderr: string; stdout: string };
  try {
    res = await run(bin, args);
  } catch (e) {
    if (jar.temp) removeCookiesFile(jar.path);
    const msg = e instanceof Error ? e.message : String(e);
    const hint = /ENOENT/.test(msg) ? `yt-dlp が見つかりません（${bin}）。設定でパスを指定してください。` : msg;
    return { ...base, error: hint };
  }
  if (jar.temp) removeCookiesFile(jar.path);

  // Validate the produced file — a nonzero exit OR an empty/too-short clip is failure.
  const fs = nodeReq<{ existsSync(p: string): boolean; statSync(p: string): { size: number } }>('fs');
  const exists = fs.existsSync(outPath);
  const bytes = exists ? fs.statSync(outPath).size : 0;

  if (res.code !== 0 || !exists || bytes < 1024) {
    const jsHint = /No supported JavaScript runtime/i.test(res.stderr)
      ? '\nJavaScript ランタイム（deno か node）が必要です。設定で jsRuntime を指定してください。'
      : '';
    return {
      ...base,
      error: `yt-dlp 失敗 (exit ${res.code}, ${bytes}B)${jsHint}`,
      stderrTail: tail(res.stderr),
    };
  }

  const durationSec = await probeDuration(ffprobeFrom(cfg.ffmpegPath), outPath);
  return { ok: true, outPath, bytes, durationSec, command };
}

/** Locate yt-dlp / ffmpeg / a JS runtime on this desktop (best-effort; '' if none). */
export interface DetectedTools {
  ytdlp: string;
  ffmpeg: string;   // directory containing ffmpeg (for --ffmpeg-location)
  jsRuntime: string; // '' if deno on PATH (auto); else 'node:<path>'
  notes: string[];
}

export function detectTools(): DetectedTools {
  const notes: string[] = [];
  let ytdlp = '', ffmpeg = '', jsRuntime = '';
  let fs: { existsSync(p: string): boolean; readdirSync(p: string): string[] };
  let path: { join(...p: string[]): string };
  let os: { homedir(): string };
  try {
    fs = nodeReq('fs'); path = nodeReq('path'); os = nodeReq('os');
  } catch {
    return { ytdlp, ffmpeg, jsRuntime, notes: ['desktop tools unavailable'] };
  }
  const home = os.homedir();
  const exists = (p: string) => { try { return fs.existsSync(p); } catch { return false; } };

  // yt-dlp: winget Links (on PATH) or bare name
  const wingetLinks = path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links');
  const ytCand = path.join(wingetLinks, 'yt-dlp.exe');
  ytdlp = exists(ytCand) ? ytCand : '';
  if (!ytdlp) notes.push('yt-dlp: bare PATH lookup (install: winget install yt-dlp.yt-dlp)');

  // ffmpeg: winget puts it in a versioned Packages dir; scan for it
  const pkgRoot = path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const d of fs.readdirSync(pkgRoot)) {
      if (!/FFmpeg/i.test(d)) continue;
      const inner = path.join(pkgRoot, d);
      for (const sub of fs.readdirSync(inner)) {
        const binDir = path.join(inner, sub, 'bin');
        if (exists(path.join(binDir, 'ffmpeg.exe'))) { ffmpeg = binDir; break; }
      }
      if (ffmpeg) break;
    }
  } catch { /* no packages dir */ }
  if (!ffmpeg) notes.push('ffmpeg: not found in winget dir; relying on PATH');

  // JS runtime: deno on winget Links → auto-detected by yt-dlp (leave ''); else node
  const denoCand = path.join(wingetLinks, 'deno.exe');
  if (exists(denoCand)) {
    notes.push('deno present → yt-dlp auto-detects it (no jsRuntime needed)');
  } else {
    const nodeCand = 'C:\\Program Files\\nodejs\\node.exe';
    if (exists(nodeCand)) { jsRuntime = `node:${nodeCand}`; notes.push('using node as JS runtime'); }
    else notes.push('no JS runtime found — install deno (winget install DenoLand.Deno)');
  }

  return { ytdlp, ffmpeg, jsRuntime, notes };
}

/** The stable clip file name for a request. Keyed on `startSec` (NOT the preroll-
 *  shifted window) so it matches the card AudioProvider's `clip_<id>_<sec>.mp3`
 *  probe exactly — preroll only affects the clip's *content*, never its name. */
export function clipNameFor(req: ExtractRequest, cfg: AudioExtractionConfig): string {
  return clipFileName(req.videoId, Math.floor(req.startSec), cfg.audioFormat);   // clip_<id>_<sec>.<fmt>
}
