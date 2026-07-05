/**
 * golden/audio.mjs — DESKTOP audio-extractor integration test (DESIGN §12 Tier 1).
 *
 * Runs the REAL src/notes/audio-extractor.ts against the REAL yt-dlp/ffmpeg/deno,
 * downloading an actual clip and validating it. Proves the tier works end-to-end
 * (not just that the code compiles). Hits the network → run manually, not in CI:
 *
 *   node --experimental-strip-types golden/audio.mjs
 *
 * Simulates Obsidian's desktop `globalThis.require` (Electron nodeIntegration) so
 * the module's lazy `nodeReq` resolves. Prepends winget Links to PATH so yt-dlp
 * auto-detects deno as its JS runtime, exactly as a freshly-launched Obsidian does.
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';

// Obsidian desktop exposes a global `require`; emulate it for the module under test.
globalThis.require = createRequire(import.meta.url);

// Make deno discoverable (yt-dlp auto-detects it) — mirrors persisted user PATH.
const links = join(homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links');
process.env.PATH = links + ';' + process.env.PATH;

const HERE = dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'audio-extractor.ts')).href);
const { buildYtdlpArgs, clipWindow, extractClip, detectTools, DEFAULT_AUDIO_EXTRACTION, ffprobeFrom } = mod;

let fail = 0, n = 0;
const ok = (cond, msg) => { n++; if (!cond) { fail++; console.log(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); };

// ── pure logic ──
console.log('\n══ pure arg building ══');
const cfg0 = { ...DEFAULT_AUDIO_EXTRACTION, ffmpegPath: 'C:\\ff\\bin', jsRuntime: 'node:C:\\n\\node.exe' };
const args = buildYtdlpArgs({ videoId: 'abc', startSec: 100, endSec: 108 }, cfg0, 'out.mp3');
ok(args.includes('--download-sections') && args[args.indexOf('--download-sections') + 1] === '*100-108', 'section range built');
ok(args.includes('--ffmpeg-location') && args.includes('C:\\ff\\bin'), 'ffmpeg-location passed');
ok(args.includes('--js-runtimes') && args.includes('node:C:\\n\\node.exe'), 'js-runtime passed');
ok(args[args.length - 1] === 'https://youtu.be/abc', 'url last');
const [ws, we] = clipWindow({ videoId: 'x', startSec: 50 }, { ...DEFAULT_AUDIO_EXTRACTION, clipLengthSec: 12 });
ok(ws === 50 && we === 62, `default window 50→62 (got ${ws}→${we})`);
ok(ffprobeFrom('C:\\ff\\bin\\ffmpeg.exe').endsWith('ffprobe.exe'), 'ffprobe derived from ffmpeg binary');
ok(ffprobeFrom('C:\\ff\\bin').endsWith('ffprobe.exe'), 'ffprobe derived from ffmpeg dir');

// ── detection ──
console.log('\n══ tool detection ══');
const tools = detectTools();
console.log('  detected:', JSON.stringify(tools, null, 0));
ok(tools.ytdlp !== '' || true, 'detectTools ran');   // informational

const cfg = {
  ...DEFAULT_AUDIO_EXTRACTION, enabled: true,
  ytdlpPath: tools.ytdlp || 'yt-dlp',
  ffmpegPath: tools.ffmpeg,
  jsRuntime: tools.jsRuntime,   // '' when deno on PATH
};
const scratch = mkdtempSync(join(tmpdir(), 'jpc-audio-'));

// ── REAL download: valid in-range clip (jNQXAC9IVRw "Me at the zoo" ~19s) ──
console.log('\n══ real clip 5→13 ══');
const good = join(scratch, 'clip_good.mp3');
const r1 = await extractClip({ videoId: 'jNQXAC9IVRw', startSec: 5, endSec: 13 }, cfg, good);
console.log('  command:', r1.command);
if (!r1.ok) console.log('  stderr:', r1.stderrTail);
ok(r1.ok, `extract ok (${r1.bytes}B, ${r1.durationSec?.toFixed(2)}s)`);
ok(r1.ok && r1.bytes > 1024, 'clip is real audio (>1KB)');
ok(r1.ok && r1.durationSec >= 6 && r1.durationSec <= 10, `clip ~8s (got ${r1.durationSec?.toFixed(2)}s)`);
ok(existsSync(good), 'clip file exists on disk');

// ── honest failure: range past end of a 19s video → empty, must NOT claim success ──
console.log('\n══ out-of-range 30→38 (must fail honestly) ══');
const bad = join(scratch, 'clip_bad.mp3');
const r2 = await extractClip({ videoId: 'jNQXAC9IVRw', startSec: 30, endSec: 38 }, cfg, bad);
ok(!r2.ok, `out-of-range reported as failure (not faked): ${r2.error ?? ''}`);

// ── honest failure: bad binary → ENOENT surfaced, never a silent dud ──
console.log('\n══ missing binary (must fail honestly) ══');
const r3 = await extractClip({ videoId: 'jNQXAC9IVRw', startSec: 5, endSec: 13 },
  { ...cfg, ytdlpPath: 'definitely-not-a-real-binary-xyz' }, join(scratch, 'clip_none.mp3'));
ok(!r3.ok && !!r3.error, `missing yt-dlp reported: ${r3.error}`);
ok(!!r3.command, 'command still emitted for manual run (degrade-soft)');

try { rmSync(scratch, { recursive: true, force: true }); } catch {}

console.log(`\n${fail ? '✗' : '✓'} ${n - fail}/${n} audio-extractor checks pass`);
process.exit(fail ? 1 : 0);
