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
): string[] {
  const [start, end] = clipWindow(req, cfg);
  const args: string[] = [];
  if (cfg.ffmpegPath) args.push('--ffmpeg-location', cfg.ffmpegPath);
  if (cfg.jsRuntime) args.push('--js-runtimes', cfg.jsRuntime);
  args.push(
    '-f', '140/bestaudio[ext=m4a]/bestaudio',   // m4a first → clean, precise cuts
    '--download-sections', `*${start}-${end}`,
    '-x', '--audio-format', cfg.audioFormat,
    '--no-playlist',
    '--no-part',
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

function nodeReq<T = unknown>(mod: string): T {
  return getRequire()(mod) as T;
}

/** True if this runtime can spawn processes (desktop Electron with Node). */
export function nodeRuntimeAvailable(): boolean {
  try { return typeof getRequire() === 'function'; } catch { return false; }
}

interface SpawnedProc {
  stderr: { on(ev: 'data', cb: (b: unknown) => void): void };
  stdout: { on(ev: 'data', cb: (b: unknown) => void): void };
  on(ev: 'error', cb: (e: Error) => void): void;
  on(ev: 'close', cb: (code: number | null) => void): void;
}

/** Run a binary, resolving with {code, stderr}. Rejects only on spawn failure. */
function run(bin: string, args: string[]): Promise<{ code: number | null; stderr: string; stdout: string }> {
  const cp = nodeReq<{ spawn(c: string, a: string[], o: unknown): SpawnedProc }>('child_process');
  return new Promise((resolve, reject) => {
    let stderr = '', stdout = '';
    let proc: SpawnedProc;
    try {
      proc = cp.spawn(bin, args, { windowsHide: true });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    proc.stderr.on('data', (b) => { stderr += String(b); });
    proc.stdout.on('data', (b) => { stdout += String(b); });
    proc.on('error', (e) => reject(e));
    proc.on('close', (code) => resolve({ code, stderr, stdout }));
  });
}

const tail = (s: string, n = 6): string => s.trim().split(/\r?\n/).slice(-n).join('\n');

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
  const args = buildYtdlpArgs(req, cfg, outPath);
  const command = commandLine(bin, args);
  const base: ExtractResult = { ok: false, outPath: '', bytes: 0, durationSec: 0, command };

  let res: { code: number | null; stderr: string; stdout: string };
  try {
    res = await run(bin, args);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = /ENOENT/.test(msg) ? `yt-dlp が見つかりません（${bin}）。設定でパスを指定してください。` : msg;
    return { ...base, error: hint };
  }

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
  const name = clipFileName(req.videoId, Math.floor(req.startSec));   // clip_<id>_<startSec>.mp3
  return cfg.audioFormat === 'mp3' ? name : name.replace(/\.mp3$/, `.${cfg.audioFormat}`);
}
