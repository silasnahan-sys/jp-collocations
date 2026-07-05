/**
 * audio-provider.ts — the decoupled audio resolver (DESIGN §12).
 *
 * The *timestamp* is the durable primitive; audio is optional enrichment layered
 * on top of it. This module ships Tier 0 (the deep-link, always available, mobile
 * + desktop, no ToS issue) so a card can always point at the exact moment it came
 * from. Tier 1 (a locally extracted MP3 clip via yt-dlp, desktop opt-in) plugs in
 * later behind the same `AudioProvider` seam without any redesign: `resolve()`
 * returns a local clip if one exists, else the deep-link — it never throws.
 *
 * Pure and Obsidian-free so the golden harness can exercise it.
 */

/** A resolved way to hear a span. `href` is a URL (deeplink) or a vault path (local). */
export interface AudioClip {
  kind: 'deeplink' | 'local' | 'none';
  href: string;
  label: string;
}

export interface AudioProvider {
  /** Resolve a clip for a span. Local mp3 if present, else the deep-link. Never throws. */
  resolve(videoId: string | null, startSec: number | null, endSec?: number | null): AudioClip;
}

/** Pull an 11-char YouTube video id out of a URL or a bare id. Null if none found. */
export function parseYouTubeId(s: string | null | undefined): string | null {
  if (!s) return null;
  const str = s.trim();
  // bare id
  if (/^[A-Za-z0-9_-]{11}$/.test(str)) return str;
  // youtu.be/ID , watch?v=ID , /embed/ID , /shorts/ID , /live/ID
  const m = str.match(
    /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/|\/v\/)([A-Za-z0-9_-]{11})/,
  );
  return m ? m[1] : null;
}

/** `https://youtu.be/<id>?t=<sec>` — opens the moment. Null if no id/time. */
export function youtubeDeepLink(videoId: string | null, startSec: number | null): string | null {
  if (!videoId) return null;
  const t = startSec != null && startSec >= 0 ? `?t=${Math.floor(startSec)}` : '';
  return `https://youtu.be/${videoId}${t}`;
}

/** The yt-dlp command that would extract *only* this clip as mp3 (DESIGN §12 Tier 1).
 *  We emit the command (opt-in, desktop) rather than shipping a downloader. */
export function ytDlpClipCommand(videoId: string, startSec: number, endSec: number, outName: string): string {
  const a = Math.max(0, Math.floor(startSec));
  const b = Math.max(a + 1, Math.floor(endSec));
  return `yt-dlp --download-sections "*${a}-${b}" -x --audio-format mp3 -o "${outName}" "https://youtu.be/${videoId}"`;
}

/** Deterministic clip file name for a span (mobile-safe, no timestamps of its own). */
export function clipFileName(videoId: string, startSec: number): string {
  return `clip_${videoId}_${Math.floor(startSec)}.mp3`;
}

/**
 * Tier 0 provider: always resolves to the YouTube deep-link (or `none` if the
 * span has no resolvable video id). This is the default; a desktop build can pass
 * a `localExists` probe to upgrade to `kind: 'local'` when a clip file is present.
 */
export function deepLinkProvider(localExists?: (path: string) => boolean): AudioProvider {
  return {
    resolve(videoId, startSec) {
      if (videoId && localExists) {
        const path = clipFileName(videoId, startSec ?? 0);
        if (localExists(path)) return { kind: 'local', href: path, label: '🔊 音声クリップ' };
      }
      const link = youtubeDeepLink(videoId, startSec);
      if (link) return { kind: 'deeplink', href: link, label: '▶ YouTube' };
      return { kind: 'none', href: '', label: '' };
    },
  };
}
