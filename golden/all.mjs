/**
 * golden/all.mjs — runs every golden suite in sequence, cross-platform.
 * Run:  npm run golden   (or: node golden/all.mjs)
 * Exit code is nonzero if any suite fails.
 *
 * --offline (auto-on under CI): skips the suites that hit LIVE YouTube via
 * local yt-dlp/ffmpeg — they flake with YouTube's bot-wall mood and cannot
 * pass from datacenter IPs. Everything else is deterministic. (ocr.mjs's
 * live-API check gates itself on a key and skips cleanly when absent.)
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const suites = [
  'storage.mjs', 'mirror.mjs', 'context.mjs', 'scaffold.mjs', 'suggester.mjs', 'discovery.mjs', 'scene.mjs', 'canvas.mjs', 'inbox.mjs', 'follow.mjs', 'goho.mjs', 'podcast.mjs', 'components.mjs', 'turns.mjs',
  'run.mjs', 'cards.mjs', 'patternstore.mjs', 'discourse-gold.mjs', 'deinflect.mjs', 'srs.mjs', 'plex.mjs', 'jimaku.mjs', 'srt.mjs',
  'lexicon.mjs', 'sweep.mjs', 'notation.mjs', 'hold.mjs', 'note-phrases.mjs', 'usage-profile.mjs', 'drop-intent.mjs', 'paradigm.mjs', 'capture-rung.mjs', 'capture-frontmatter.mjs', 'auto-sweep.mjs', 'tray-doors.mjs', 'medium-lines.mjs', 'ratify.mjs',
  'scoreboard.mjs', 'calculus-turns.mjs', 'calculus-corpus.mjs', 'calculus-precision.mjs', 'drill.mjs',
  'anchor.mjs', 'realformat.mjs', 'ocr.mjs',
  'voicesync.mjs', 'transcript.mjs', 'history.mjs', 'audio.mjs',
  'patterns.mjs', 'dictionary.mjs', 'dict-nav.mjs', 'x-transaction.mjs', 'x-format.mjs', 'x-usage.mjs', 'x-relevance.mjs', 'x-probe.mjs',
  'match-japanese.mjs', 'hyogen.mjs', 'twc.mjs',
  'class-grammar.mjs', 'entry-parts.mjs', 'analysis-bundle.mjs', 'capture-bundle.mjs', 'registers.mjs', 'shape-index.mjs', 'usage-board.mjs', 'savable.mjs', 'concordance.mjs', 'frames.mjs', 'eijiro.mjs', 'sidecar.mjs', 'import-eijiro.mjs', 'generic-yomitan.mjs', 'sidecar-verify.mjs', 'intent-index.mjs', 'suite-nav.mjs', 'input-map.mjs', 'big-dict.mjs', 'dexie-stream.mjs', 'import-dexie.mjs', 'reach.mjs',
  // The input layer. `ui-gestures` needs a DOM, which `golden/stub/` provides —
  // see that folder for why it is 150 hand-written lines and not jsdom.
  'floating-rail.mjs', 'touch-nav.mjs', 'ui-gestures.mjs', 'drop-bytes.mjs', 'clipboard-door.mjs', 'pane-size.mjs', 'bar-retreat.mjs', 'image-pair.mjs', 'selection-images.mjs', 'resource-url.mjs', 'drag-out-files.mjs',
  // Last, because it is the only suite that asks about the OTHERS: not whether
  // a mechanism is correct but whether a hand can reach it. It carries a ledger
  // of known holes and fails on any new one — see its header for why the
  // back-stack suite stayed green through the months navigation did not work.
  'reachability.mjs',
];
const ONLINE_SUITES = new Set(['transcript.mjs', 'audio.mjs']);
const offline = process.argv.includes('--offline') || !!process.env.CI;

let failed = 0, ran = 0;
for (const s of suites) {
  if (offline && ONLINE_SUITES.has(s)) {
    console.log(`⏭ ${s} skipped (offline: needs live YouTube + local yt-dlp/ffmpeg)`);
    continue;
  }
  ran++;
  const r = spawnSync(process.execPath, [join(HERE, s)], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.log(`\n✗ ${s} FAILED (exit ${r.status})\n`); }
}
console.log(failed ? `\n✗ ${failed}/${ran} suites failed` : `\n✓ all ${ran} golden suites pass${offline ? ' (offline)' : ''}`);
process.exit(failed ? 1 : 0);
