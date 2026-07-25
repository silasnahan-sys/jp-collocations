/**
 * voice-lab.ts — local speech enrichment for clip cards (DESIGN: voicesync).
 *
 * Two engines, both standalone Windows binaries (opt-in, desktop-only — the
 * same external-tool pattern as yt-dlp):
 *   • whisper.cpp  — clean JP re-transcription of a clip with PER-TOKEN
 *     timestamps (`-ml 1 -oj`). YT captions are the fallback truth for
 *     anchoring; THIS is the clean display/sync text.
 *   • sherpa-onnx  — offline speaker diarization (pyannote segmentation +
 *     speaker embeddings): who speaks when, OVERLAP-aware, so cut-ins and
 *     backchannels are represented as overlapping turns instead of being
 *     smeared into the main speaker.
 *
 * The merge produces a `.voicesync.json` sidecar next to each clip mp3 — the
 * exact structure the `jp-voicesync` renderer consumes. Everything except the
 * process spawns is PURE and golden-tested against real captured fixtures.
 *
 * VERIFIED RECIPE (2026-07-12, user's machine): 34s clip → whisper small
 * ~10s CPU (197 tokens), diarization ~9s (RTF 0.28), overlapping backchannels
 * detected. Known model quirk handled here: whisper small HALLUCINATES
 * speaker-name labels into dialogue text (「樋口:」 — an invented name);
 * `parseWhisperTokens` strips them.
 */

import { run, nodeReq, tail } from './audio-extractor.ts';
import { fmtStamp } from './srt.ts';

// ── config ─────────────────────────────────────────────────────────────────────

/** A named voice: a short reference wav extracted when the user first named
 *  the speaker. Future clips are diarized WITH the references prepended —
 *  whichever cluster owns a reference span IS that person (enrollment by
 *  concatenation; verified live 2026-07-12: ref cluster == target's voice). */
export interface VoiceProfile {
  name: string;
  /** vault-relative wav path (16k mono). */
  refWav: string;
  /** reference duration in seconds (known at extraction; avoids ffprobe). */
  durSec: number;
}

export interface VoiceSyncSettings {
  /** Master opt-in (desktop only; needs the tools below). */
  enabled: boolean;
  /** Root folder of the speech tools (whisper + sherpa + models). '' → default. */
  toolsDir: string;
  /** Named voices (cross-episode auto-identification). */
  profiles: VoiceProfile[];
  /** Diarization clustering threshold. LOWER = more voices found. 0.55 default:
   *  never merging a distinct voice beats phantom splits (splits are visible
   *  and one-click correctable; merges silently mis-attribute speech). */
  clusterThreshold: number;
}

export const DEFAULT_VOICE_SYNC: VoiceSyncSettings = {
  enabled: false,
  toolsDir: '',
  profiles: [],
  clusterThreshold: 0.55,
};

/** Resolved absolute tool paths (null when a piece is missing). */
export interface SpeechTools {
  whisperCli: string | null;
  whisperModel: string | null;
  diarBin: string | null;
  segModel: string | null;
  embModel: string | null;
  /** All five present. */
  ready: boolean;
}

/** Locate the tools under `toolsDir` (or the default install root). Pure-ish:
 *  only existsSync probes. Layout = whatever the install instructions create. */
export function detectSpeechTools(toolsDir: string): SpeechTools {
  const out: SpeechTools = { whisperCli: null, whisperModel: null, diarBin: null, segModel: null, embModel: null, ready: false };
  try {
    const fs = nodeReq<{ existsSync(p: string): boolean; readdirSync(p: string): string[] }>('fs');
    const path = nodeReq<{ join(...p: string[]): string }>('path');
    const os = nodeReq<{ homedir(): string }>('os');
    const root = toolsDir || path.join(os.homedir(), 'AppData', 'Local', 'jp-collocations', 'speech-tools');
    if (!fs.existsSync(root)) return out;
    const probe = (rel: string): string | null => {
      const p = path.join(root, rel);
      return fs.existsSync(p) ? p : null;
    };
    out.whisperCli = probe('whisper/Release/whisper-cli.exe') ?? probe('whisper/whisper-cli.exe') ?? probe('whisper-cli.exe');
    // Best model first — large-v3-turbo: no hallucinated speaker labels, far
    // better JP (店売→転売), RTF ≈1.3 on CPU. small is the fast fallback.
    out.whisperModel = probe('models/ggml-large-v3-turbo.bin') ?? probe('models/ggml-medium.bin')
      ?? probe('models/ggml-small.bin') ?? probe('models/ggml-base.bin');
    // sherpa dir name carries its version — scan for it
    try {
      for (const d of fs.readdirSync(root)) {
        if (/^sherpa-onnx-v.*win-x64/.test(d)) {
          out.diarBin = probe(path.join(d, 'bin', 'sherpa-onnx-offline-speaker-diarization.exe'));
          if (out.diarBin) break;
        }
      }
    } catch { /* */ }
    out.segModel = probe('sherpa-onnx-pyannote-segmentation-3-0/model.onnx');
    out.embModel = probe('models/3dspeaker_embed.onnx');
    out.ready = !!(out.whisperCli && out.whisperModel && out.diarBin && out.segModel && out.embModel);
  } catch { /* mobile / no node */ }
  return out;
}

// ── data model (the sidecar) ────────────────────────────────────────────────────

export interface VsToken {
  t0: number; t1: number; text: string; spk: string; overlap?: boolean;
  /** First character of a whisper LEXICAL segment — display segments break
   *  here so seamless speaker handovers (which diarization cannot hear) fall
   *  on correctable boundaries. */
  segStart?: boolean;
}
export interface VsTurn { t0: number; t1: number; spk: string }
export interface VsSegment { spk: string; t0: number; t1: number; text: string; tokenIdx: [number, number]; overlap?: boolean }

export interface VoiceSyncData {
  version: 1;
  clip: string;                       // clip basename (mp3)
  durationSec: number;
  tokens: VsToken[];
  turns: VsTurn[];                    // raw diarization turns (incl. token-less backchannels)
  segments: VsSegment[];              // display grouping of tokens
  /** spk id → human name; filled by the (future) naming UI. */
  speakers: Record<string, string>;
}

export function voiceSyncSidecarName(clipName: string): string {
  return `${clipName}.voicesync.json`;
}

// ── PURE parsers ────────────────────────────────────────────────────────────────

const tsToSec = (ts: string): number => {
  const [h, m, s] = ts.split(':');
  return +h * 3600 + +m * 60 + parseFloat(s.replace(',', '.'));
};


/**
 * whisper.cpp `-oj` JSON (NATURAL segments — never `-ml 1`, which splits BPE
 * tokens mid-multibyte-character and mojibakes Japanese) → cleaned segments.
 * Strips the model's hallucinated speaker-name labels (「樋口:」-style tags the
 * small model invents at segment starts) and any U+FFFD debris.
 */
export function parseWhisperSegments(json: string): { t0: number; t1: number; text: string }[] {
  let j: unknown;
  try { j = JSON.parse(json); } catch { return []; }
  const raw = ((j as { transcription?: { timestamps?: { from: string; to: string }; text?: string }[] }).transcription ?? [])
    .filter((s) => s.text != null && s.timestamps)
    .map((s) => ({ t0: tsToSec(s.timestamps!.from), t1: tsToSec(s.timestamps!.to), text: s.text as string }));
  const out: { t0: number; t1: number; text: string }[] = [];
  for (const seg of raw) {
    const text = seg.text
      .replace(/�+/g, '')                                    // mojibake debris
      .replace(/^\s*[^\s、。？?！!:：]{1,8}[:：]\s*/, '')          // hallucinated 「名前:」 tag
      .trim();
    if (text) out.push({ t0: seg.t0, t1: seg.t1, text });
  }
  return out;
}

/**
 * Karaoke units: one token per CHARACTER, times linearly interpolated inside
 * each natural segment. Visually indistinguishable from true token timing at
 * 1–3s segment granularity, and immune to byte-split corruption by design.
 */
export function charTokens(segments: { t0: number; t1: number; text: string }[]): { t0: number; t1: number; text: string; segStart?: boolean }[] {
  const out: { t0: number; t1: number; text: string; segStart?: boolean }[] = [];
  for (const seg of segments) {
    const chars = [...seg.text];
    const n = chars.length;
    if (!n) continue;
    const dur = Math.max(0.05, seg.t1 - seg.t0);
    chars.forEach((ch, i) => {
      out.push({ t0: seg.t0 + (dur * i) / n, t1: seg.t0 + (dur * (i + 1)) / n, text: ch, ...(i === 0 ? { segStart: true } : {}) });
    });
  }
  return out;
}

/**
 * Rebuild display segments from the token stream (used after any edit and at
 * merge time). Breaks on: speaker change, >0.8s silence gap, or a whisper
 * LEXICAL boundary — diarization is deaf to seamless handovers between similar
 * voices (verified: B/C in the user's clip are one cluster down to threshold
 * 0.25 on every available embedding model), so clause boundaries are the only
 * honest cut points, and they make manual reattribution a single click.
 */
export function rebuildSegments(tokens: VsToken[]): VsSegment[] {
  const segments: VsSegment[] = [];
  tokens.forEach((tk, i) => {
    const last = segments[segments.length - 1];
    if (last && last.spk === tk.spk && tk.t0 - last.t1 <= 0.8 && !tk.segStart) {
      last.text += tk.text;
      last.t1 = tk.t1;
      last.tokenIdx[1] = i;
      if (tk.overlap) last.overlap = true;
    } else {
      segments.push({ spk: tk.spk, t0: tk.t0, t1: tk.t1, text: tk.text, tokenIdx: [i, i], ...(tk.overlap ? { overlap: true } : {}) });
    }
  });
  return segments;
}

/** sherpa-onnx diarization stdout → turns ("S.SSS -- E.EEE speaker_XX" lines). */
export function parseDiarTurns(stdout: string): VsTurn[] {
  return [...stdout.matchAll(/^\s*([\d.]+)\s*--\s*([\d.]+)\s+(speaker[_ ]?\d+)\s*$/gm)]
    .map((m) => ({ t0: +m[1], t1: +m[2], spk: m[3].replace(' ', '_') }))
    .sort((a, b) => a.t0 - b.t0);
}

/**
 * Merge tokens × turns into the sidecar structure.
 *  - a token belongs to the SHORTEST turn active at its midpoint — during an
 *    overlap the interjector's brief turn wins, which matches what the ear
 *    attributes; `overlap` is flagged either way.
 *  - turns that received NO tokens are kept as-is (rendered as 相槌 pills —
 *    whisper only hears the dominant voice; we never invent text for them).
 *  - display segments break on speaker change or a >0.8s silence gap.
 */
export function mergeVoiceSync(
  tokens: { t0: number; t1: number; text: string; segStart?: boolean }[],
  turns: VsTurn[],
  clipName: string,
  durationSec: number,
): VoiceSyncData {
  const vsTokens: VsToken[] = tokens.map((tk) => {
    const mid = (tk.t0 + tk.t1) / 2;
    const active = turns.filter((x) => mid >= x.t0 && mid <= x.t1)
      .sort((a, b) => (a.t1 - a.t0) - (b.t1 - b.t0));
    return {
      ...tk,
      spk: active[0]?.spk ?? turns[0]?.spk ?? 'speaker_00',
      ...(active.length > 1 ? { overlap: true } : {}),
    };
  });
  return { version: 1, clip: clipName, durationSec, tokens: vsTokens, turns, segments: rebuildSegments(vsTokens), speakers: {} };
}

// ── §23.4-3 diarization tier: speaker-letter a whole transcript ─────────────────
// Local audio means layer-1 (WHO speaks WHEN) is a diarization answer, not a
// text inference. These PURE helpers turn sherpa turns + whisper segments into
// the `[HH:MM:SS] A: …` line format 談話モード reads back as ground truth.

/** Diarization cluster ids → stable letters (A, B, C, …) in order of first
 *  appearance — the same order a reader meets the voices. */
export function lettersForTurns(turns: VsTurn[]): Record<string, string> {
  const letters: Record<string, string> = {};
  let n = 0;
  for (const t of [...turns].sort((a, b) => a.t0 - b.t0)) {
    if (!(t.spk in letters)) letters[t.spk] = String.fromCharCode(65 + Math.min(n++, 25));
  }
  return letters;
}

/** Which diarized voice owns [t0,t1]? Highest IoU (overlap ÷ union) wins —
 *  raw overlap would hand every nested interjection (「うん」 inside the
 *  floor-holder's long turn) to the WRONG voice, while IoU gives a short
 *  segment to the interjector and a long one to the floor-holder. With NO
 *  overlapping turn, the nearest within `maxGapSec` claims it (diarization
 *  trims edges); beyond that we honestly don't know → null. */
export function speakerForSpan(turns: VsTurn[], t0: number, t1: number, maxGapSec = 2): string | null {
  let best: string | null = null, bestIou = 0;
  for (const t of turns) {
    const ov = Math.min(t.t1, t1) - Math.max(t.t0, t0);
    if (ov <= 0) continue;
    const iou = ov / (Math.max(t.t1, t1) - Math.min(t.t0, t0));
    if (iou > bestIou) { bestIou = iou; best = t.spk; }
  }
  if (best) return best;
  let nearest: string | null = null, gap = Infinity;
  for (const t of turns) {
    const g = t.t0 > t1 ? t.t0 - t1 : t.t1 < t0 ? t0 - t.t1 : 0;
    if (g < gap) { gap = g; nearest = t.spk; }
  }
  return gap <= maxGapSec ? nearest : null;
}

/**
 * Whisper segments × sherpa turns → speaker-lettered transcript lines:
 * `[HH:MM:SS] A: text`. Segments the diarizer can't attribute keep the plain
 * unlettered form (never invent a voice). Named clusters (voice enrollment)
 * keep their NAME instead of a letter.
 */
export function speakerStampLines(
  segs: { t0: number; t1: number; text: string }[],
  turns: VsTurn[],
  speakerNames: Record<string, string> = {},
): string[] {
  const letters = lettersForTurns(turns);
  return segs.map((s) => {
    const spk = speakerForSpan(turns, s.t0, s.t1);
    const label = spk ? (speakerNames[spk] ?? letters[spk]) : null;
    return label ? `${fmtStamp(s.t0)} ${label}: ${s.text}` : `${fmtStamp(s.t0)} ${s.text}`;
  });
}

// ── voice enrollment (PURE mapping part) ────────────────────────────────────────

export interface RefSpan { name: string; t0: number; t1: number }

/**
 * After diarizing [ref1 ‖ sil ‖ ref2 ‖ … ‖ clip]: assign names to the clusters
 * that dominate each reference span, keep only the clip's own turns, and shift
 * them back to clip time. Returns the clip-local turns + spkId→name map.
 */
export function nameTurnsByRefs(
  turns: VsTurn[], refSpans: RefSpan[], clipOffset: number,
): { turns: VsTurn[]; names: Record<string, string> } {
  const names: Record<string, string> = {};
  for (const ref of refSpans) {
    let best = '', bestOverlap = 0;
    const bySpk = new Map<string, number>();
    for (const t of turns) {
      const ov = Math.min(t.t1, ref.t1) - Math.max(t.t0, ref.t0);
      if (ov > 0) bySpk.set(t.spk, (bySpk.get(t.spk) ?? 0) + ov);
    }
    for (const [spk, ov] of bySpk) if (ov > bestOverlap) { bestOverlap = ov; best = spk; }
    // demand the cluster actually OWNS the reference (>50% of it) — a stray
    // overlap must not steal a name
    if (best && bestOverlap >= (ref.t1 - ref.t0) * 0.5) names[best] = ref.name;
  }
  const clipTurns = turns
    .filter((t) => t.t1 > clipOffset + 0.05)
    .map((t) => ({ spk: t.spk, t0: Math.max(0, t.t0 - clipOffset), t1: t.t1 - clipOffset }));
  return { turns: clipTurns, names };
}

// ── IO: run the engines on one clip ─────────────────────────────────────────────

export interface VoiceSyncResult {
  data: VoiceSyncData | null;
  error?: string;
}

const ffBin = (ffmpegDir: string): string => (ffmpegDir ? `${ffmpegDir.replace(/[\\/]$/, '')}/ffmpeg` : 'ffmpeg');

/** mp3 → mono 16k wav (whisper/sherpa input). Returns the wav path or null. */
async function toWav16k(ffmpegDir: string, srcAbs: string, dstAbs: string): Promise<boolean> {
  const r = await run(ffBin(ffmpegDir), ['-y', '-loglevel', 'error', '-i', srcAbs, '-ar', '16000', '-ac', '1', dstAbs], 120_000).catch(() => null);
  return !!r && r.code === 0;
}

/** Cut a [t0,t1] slice of a clip as a 16k mono reference wav (voice enrollment). */
export async function extractRefWav(
  ffmpegDir: string, srcAbs: string, t0: number, t1: number, outAbs: string,
): Promise<boolean> {
  const dur = Math.max(1, Math.min(10, t1 - t0));   // 1–10s is plenty for a voice print
  const r = await run(ffBin(ffmpegDir),
    ['-y', '-loglevel', 'error', '-ss', t0.toFixed(2), '-t', dur.toFixed(2), '-i', srcAbs, '-ar', '16000', '-ac', '1', outAbs],
    120_000).catch(() => null);
  return !!r && r.code === 0;
}

/** Build [ref1 ‖ 1s ‖ ref2 ‖ 1s ‖ … ‖ clip] and return the spans + clip offset. */
async function buildEnrollConcat(
  ffmpegDir: string, refs: { name: string; absWav: string; durSec: number }[],
  clipWavAbs: string, outAbs: string,
): Promise<{ refSpans: RefSpan[]; clipOffset: number } | null> {
  const GAP = 1.0;
  const inputs: string[] = [];
  const refSpans: RefSpan[] = [];
  let t = 0;
  for (const r of refs) {
    inputs.push('-i', r.absWav);
    refSpans.push({ name: r.name, t0: t, t1: t + r.durSec });
    t += r.durSec + GAP;
  }
  const clipOffset = t;
  inputs.push('-i', clipWavAbs);
  // interleave 1s silence between every input via concat filter
  const n = refs.length + 1;
  const silences = refs.map((_, i) => `aevalsrc=0:d=${GAP}:s=16000[s${i}]`).join(';');
  const order = refs.map((_, i) => `[${i}:0][s${i}]`).join('') + `[${refs.length}:0]`;
  const filter = `${silences};${order}concat=n=${2 * n - 1}:v=0:a=1[out]`;
  const r = await run(ffBin(ffmpegDir),
    ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '[out]', outAbs], 180_000)
    .catch(() => null);
  return r && r.code === 0 ? { refSpans, clipOffset } : null;
}

/**
 * Enrich ONE clip: wav-convert → whisper (tokens) → diarize (turns) → merge.
 * Never throws. ~20s CPU for a 30s clip with the small model.
 */
export async function enrichClip(
  tools: SpeechTools,
  ffmpegDir: string,
  clipAbs: string,
  clipName: string,
  tmpDirAbs: string,
  /** Named voices — when given, diarization runs on [refs ‖ clip] and the
   *  matching clusters come back NAMED (data.speakers). */
  profiles: { name: string; absWav: string; durSec: number }[] = [],
  clusterThreshold = 0.55,
): Promise<VoiceSyncResult> {
  if (!tools.ready) return { data: null, error: '音声解析ツールが未検出です（設定 → VoiceSync）。' };
  const fs = nodeReq<{ readFileSync(p: string, e: string): string; unlinkSync(p: string): void; existsSync(p: string): boolean }>('fs');
  const path = nodeReq<{ join(...p: string[]): string }>('path');
  const base = clipName.replace(/[^\w.-]/g, '_');
  const wav = path.join(tmpDirAbs, `_vs_${base}.wav`);
  const concat = path.join(tmpDirAbs, `_vs_${base}.enroll.wav`);
  const outPrefix = path.join(tmpDirAbs, `_vs_${base}`);
  const slice = path.join(tmpDirAbs, `_vs_${base}.slice.wav`);
  const slicePrefix = path.join(tmpDirAbs, `_vs_${base}.slice`);
  const cleanup = () => {
    for (const p of [wav, concat, slice, `${outPrefix}.json`, `${slicePrefix}.json`]) {
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* */ }
    }
  };
  const whisperTo = async (input: string, prefix: string): Promise<{ t0: number; t1: number; text: string }[] | null> => {
    const w = await run(tools.whisperCli as string,
      ['-m', tools.whisperModel as string, '-l', 'ja', '-oj', '-of', prefix, input], 600_000);
    if (w.code !== 0 || !fs.existsSync(`${prefix}.json`)) return null;
    return parseWhisperSegments(fs.readFileSync(`${prefix}.json`, 'utf8'));
  };
  try {
    if (!(await toWav16k(ffmpegDir, clipAbs, wav))) return { data: null, error: 'wav 変換に失敗（ffmpeg）。' };

    // whisper on the CLIP: natural segments (never -ml 1 — it byte-splits JP
    // characters into mojibake), karaoke timing by character interpolation.
    const segs = await whisperTo(wav, outPrefix);
    if (!segs) return { data: null, error: 'whisper 失敗（JSON なし）' };
    let tokens = charTokens(segs);
    if (!tokens.length) return { data: null, error: 'whisper がテキストを返しませんでした。' };

    // diarization — with voice enrollment when profiles exist.
    let diarInput = wav;
    let enroll: { refSpans: RefSpan[]; clipOffset: number } | null = null;
    const usable = profiles.filter((p) => fs.existsSync(p.absWav));
    if (usable.length) {
      enroll = await buildEnrollConcat(ffmpegDir, usable, wav, concat);
      if (enroll) diarInput = concat;
    }
    const d = await run(tools.diarBin as string, [
      `--segmentation.pyannote-model=${tools.segModel}`,
      `--embedding.model=${tools.embModel}`,
      `--clustering.cluster-threshold=${clusterThreshold}`,
      diarInput,
    ], 300_000);
    let turns = parseDiarTurns(d.stdout + '\n' + d.stderr);
    let speakerNames: Record<string, string> = {};
    if (enroll) {
      const named = nameTurnsByRefs(turns, enroll.refSpans, enroll.clipOffset);
      turns = named.turns;
      speakerNames = named.names;
    }

    // SECOND PASS — recover speech whisper missed under crosstalk: a diarized
    // turn ≥0.8s that got (almost) no tokens is re-transcribed from its own
    // slice, tokens spliced back with the turn's speaker.
    const tokenless = turns.filter((t) => {
      if (t.t1 - t.t0 < 0.8) return false;
      const n = tokens.filter((tk) => { const m = (tk.t0 + tk.t1) / 2; return m >= t.t0 && m <= t.t1; }).length;
      return n < 2;
    }).slice(0, 6);
    for (const t of tokenless) {
      const cut = await run(ffBin(ffmpegDir),
        ['-y', '-loglevel', 'error', '-ss', t.t0.toFixed(2), '-t', (t.t1 - t.t0).toFixed(2), '-i', wav, slice], 120_000)
        .catch(() => null);
      if (!cut || cut.code !== 0) continue;
      const sub = await whisperTo(slice, slicePrefix);
      if (!sub?.length) continue;
      tokens.push(...charTokens(sub).map((tk) => ({ t0: tk.t0 + t.t0, t1: tk.t1 + t.t0, text: tk.text })));
    }
    tokens = tokens.sort((a, b) => a.t0 - b.t0);

    const durationSec = Math.max(tokens[tokens.length - 1]?.t1 ?? 0, turns[turns.length - 1]?.t1 ?? 0);
    const data = mergeVoiceSync(tokens, turns, clipName, durationSec);
    data.speakers = speakerNames;
    return { data };
  } catch (e) {
    return { data: null, error: String(e instanceof Error ? e.message : e) };
  } finally {
    cleanup();
  }
}
