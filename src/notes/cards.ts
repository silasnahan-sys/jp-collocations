/**
 * cards.ts — reconciliation → SRS cards with LIVE timestamp anchoring (DESIGN §11).
 *
 * A card here is a *view over an anchored transcript span*, never a new content
 * note (invariant #1, #5 — same anti-explosion rule as the library). Each card is
 * authored from a reconciled span and inherits its `{ file, blockId, videoId,
 * tStartSec }`, which it renders as two live anchors:
 *
 *   • a transcript block-link  `[[<reconciled-file>#^<blockId>]]`  — traceable to
 *     the exact source span, no copied content, and
 *   • a YouTube deep-link      `https://youtu.be/<id>?t=<sec>`     — opens the
 *     moment (via the decoupled AudioProvider, so audio can upgrade to a local
 *     clip later with no redesign).
 *
 * The front is a graduated fade-in cloze: the phrase is blanked in its ±context
 * so you recall what was actually said before the anchor reveals it. Card ids are
 * derived from the block id (no `Date.now()`), so re-running is idempotent.
 *
 * Pure + Obsidian-free → runs in the golden harness.
 */

import { NOTE_TYPES, DEFAULT_NOTE_CLASS, type NoteClass } from './note-types.ts';
import type { ReconciledResult } from './pipeline.ts';
import {
  deepLinkProvider,
  youtubeDeepLink,
  type AudioProvider,
  type AudioClip,
} from './audio-provider.ts';

/** Everything a card needs to anchor back to the transcript span it views. */
export interface CardAnchor {
  /** The reconciled/anchored file where `^blockId` lives (block-link target). */
  file: string;
  blockId: string;
  /** Resolved YouTube id for the source media, or null (deep-link degrades soft). */
  videoId: string | null;
  tStartSec: number | null;
  /** `[[transcript]]` the span was located in (for provenance display). */
  transcriptRef: string | null;
}

export interface ReconCard {
  /** Stable id = `card-<blockId>` — idempotent across re-runs. */
  id: string;
  blockId: string;
  noteClass: NoteClass;
  front: string;
  back: string;
  tags: string[];
  /** Full markdown for the SR plugin (front `?` back). */
  markdown: string;
  anchor: CardAnchor;
  /** Short human label for section headers / navigation. */
  heading: string;
}

export interface BuildCardsOptions {
  tagPrefix?: string;               // default 'flashcards/jp-recon'
  audio?: AudioProvider;            // default: Tier-0 deep-link provider
  videoId?: string | null;         // source media id (→ deep-links); null = block-link only
  transcriptRef?: string | null;   // `[[transcript]]`
  /** The file the `^blockId` blocks live in (block-link target). */
  anchoredFile?: string;
  /** Per-block class from the source of truth (library / parsed callouts). */
  classOf?: (blockId: string) => NoteClass | undefined;
  /** Include spans still flagged needs-review (default false — anchor is uncertain). */
  includeNeedsReview?: boolean;
  /**
   * Map a result's own block id to the block id actually written into the
   * anchored file (the cluster anchor when in-transcript windows merged).
   * Defaults to identity — the card id itself always stays per-result.
   */
  anchorIdOf?: (blockId: string) => string | undefined;
  /** True when the clip has a `.voicesync.json` sidecar → the card embeds the
   *  speaker-synced karaoke block instead of a bare audio embed. */
  voiceSyncFor?: (clipName: string) => boolean;
}

const fmtClock = (s: number | null): string =>
  s == null ? '??:??' : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const BLANK = '【＿＿＿＿＿】';

/** Split a 🟠 link answer into its components (mirror of pipeline's notation:
 *  〜 / → / … between parts). Kept local so cards stay dependency-light. */
function linkParts(s: string): string[] {
  return s.split(/[〜~→…]+/).map((p) => p.trim()).filter((p) => p.length >= 2);
}

/** What each 分類 drills — shown on the front so the task is explicit. */
const DRILL: Record<NoteClass, string> = {
  serifu: '聴解',
  collocation: '連語想起',
  rhet_collocation: '表現産出',
  phrase_schema: '型産出',
  skeletal: '空所補充',
  discourse: '応答産出',
};

/** A non-revealing hint: first char + length. (The raw memo IS the answer —
 *  showing it on the front made every card trivially easy.) */
const softHint = (answer: string): string =>
  `> ヒント: 「${answer.slice(0, 1)}…」（${answer.length}字）`;

/**
 * Class-shaped FRONT (§P4): each of the six classes trains the skill that
 * defines it (v2 taxonomy) instead of one generic cloze —
 *   🟡 serifu    audio-FIRST dictation: hear the clip, recall the line
 *   🔵 collocation  recall the word bond from blanked context
 *   🟢 rhet-coll    produce the evocative expression the scene calls for
 *   💠 phrase-schema  produce the holistic 型 said in this situation
 *   🟠 skeletal     gap-fill: first component given → complete the link
 *   🔴 discourse    responsivity: previous turn given → produce the response
 */
function renderFront(
  cls: NoteClass,
  r: ReconciledResult,
  answer: string,
  clip: AudioClip,
  voiceSync: boolean,
): string {
  const def = NOTE_TYPES[cls];
  const before = r.contextBefore.map((c) => `…${c}`).join(' ');
  const after = r.contextAfter.map((c) => `${c}…`).join(' ');
  const cloze = [before, BLANK, after].filter(Boolean).join(' ') || BLANK;
  const head = `${def.emoji} **${def.label} · ${DRILL[cls]}** · ~${fmtClock(r.tStartSec)}`;
  const lines: string[] = [head, ''];

  switch (cls) {
    case 'serifu': {
      // audio-first: the sound is the prompt; no text hint at all
      if (clip.kind === 'local') {
        lines.push('🎧 まず聞いてください:');
        if (voiceSync) lines.push('```jp-voicesync', JSON.stringify({ clip: clip.href }), '```');
        else lines.push(`![[${clip.href}]]`);
        lines.push('', cloze);
      } else {
        if (clip.kind === 'deeplink') lines.push(`🎧 まず聞いてください: ${clip.href}`, '');
        lines.push(cloze);
      }
      break;
    }
    case 'skeletal': {
      const parts = linkParts(answer);
      if (parts.length >= 2) {
        // the first component is the trigger; producing its mate is the drill
        lines.push(cloze, '', `**${parts[0]}** 〜 【＿＿＿】`);
      } else {
        lines.push(cloze, '', softHint(answer));
      }
      break;
    }
    case 'discourse': {
      // responsivity: the prior turn is the whole prompt
      const prior = r.contextBefore.length ? r.contextBefore.map((c) => `> ${c}`).join('\n') : `> （直前の発話）`;
      lines.push('相手:', prior, '', `→ どう応じた？ ${BLANK}`);
      break;
    }
    case 'phrase_schema':
      lines.push(cloze, '', 'この場面で言われた「型」（丸ごとの言い回し）は？', softHint(answer));
      break;
    case 'rhet_collocation':
      lines.push(cloze, '', 'この場面を演じる（イメージを喚起する）表現は？', softHint(answer));
      break;
    default:  // collocation
      lines.push(cloze, '', softHint(answer));
  }
  return lines.join('\n');
}

/** Render the anchor footer shared by every card (block-link + deep-link + audio). */
function renderAnchor(anchor: CardAnchor, clip: AudioClip, voiceSync: boolean): string[] {
  const lines: string[] = ['', '---'];
  // transcript block-link — the durable, always-present anchor (invariant #1)
  lines.push(`⏱ **原文:** ![[${anchor.file}#^${anchor.blockId}]]`);
  const deep = youtubeDeepLink(anchor.videoId, anchor.tStartSec);
  if (deep) lines.push(`▶ **YouTube (${fmtClock(anchor.tStartSec)}):** ${deep}`);
  if (clip.kind === 'local') {
    if (voiceSync) {
      // speaker-synced karaoke player (VoiceSyncRenderer) — supersedes the bare embed
      lines.push('```jp-voicesync', JSON.stringify({ clip: clip.href }), '```');
    } else {
      lines.push(`${clip.label}: ![[${clip.href}]]`);
    }
  }
  if (anchor.transcriptRef) lines.push(`📄 ${anchor.transcriptRef}`);
  return lines;
}

/** One reconciled span → one anchored cloze card. */
export function buildReconCard(
  r: ReconciledResult,
  blockId: string,
  opts: BuildCardsOptions = {},
): ReconCard {
  const tagPrefix = opts.tagPrefix ?? 'flashcards/jp-recon';
  const audio = opts.audio ?? deepLinkProvider();
  const noteClass = opts.classOf?.(blockId) ?? DEFAULT_NOTE_CLASS;
  const def = NOTE_TYPES[noteClass];

  const answer = r.reconciled || r.note;
  const anchor: CardAnchor = {
    file: opts.anchoredFile ?? '',
    blockId: opts.anchorIdOf?.(blockId) ?? blockId,   // embeds target the cluster anchor
    videoId: opts.videoId ?? null,
    tStartSec: r.tStartSec,
    transcriptRef: opts.transcriptRef ?? null,
  };

  // ── FRONT: class-shaped drill (each 分類 trains its defining skill) ──
  const clip = audio.resolve(anchor.videoId, r.tStartSec);
  const voiceSync = clip.kind === 'local' && (opts.voiceSyncFor?.(clip.href) ?? false);
  const front = renderFront(noteClass, r, answer, clip, voiceSync);

  // ── BACK: the answer + any corrections + the live anchors ──
  const shownAnswer = noteClass === 'skeletal' && linkParts(answer).length >= 2
    ? linkParts(answer).map((p) => `**${p}**`).join(' 〜 ')   // both components bolded
    : `**${answer}**`;
  const backLines = [shownAnswer, ''];
  if (noteClass === 'discourse' && r.contextAfter.length) {
    backLines.push(`続き: ${r.contextAfter.join(' / ')}`);
  }
  if (r.note && r.note !== answer) backLines.push(`メモ(raw): ~~${r.note}~~ → **${answer}**`);
  for (const c of r.corrections) {
    const mark = c.kind === 'homophone' ? '⚠️ 同音校正' : c.kind === 'kanji-swap' ? '⚠️ 漢字違い' : '⚠️ 相違';
    backLines.push(`${mark}: 「${c.noteText}」→「${c.transcriptText}」`);
  }
  backLines.push(...renderAnchor(anchor, clip, voiceSync));
  const back = backLines.join('\n');

  const tags = [tagPrefix, `${tagPrefix}/${def.callout}`];
  if (r.status === 'needs-review') tags.push(`${tagPrefix}/needs-review`);
  const tagLine = tags.map((t) => `#${t}`).join(' ');
  const markdown = `${tagLine}\n${front}\n?\n${back}\n`;

  const heading = `${def.emoji} ${answer.slice(0, 28)}${answer.length > 28 ? '…' : ''} · ${fmtClock(r.tStartSec)}`;
  return { id: `card-${blockId}`, blockId, noteClass, front, back, tags, markdown, anchor, heading };
}

/**
 * Build anchored cards for a reconciled file. `blockIdFor` maps a result to its
 * anchored block id (pass `annotate.blockIdFor`), `anchoredFile` is the file the
 * `^blockId` blocks live in (the block-link target).
 */
export function buildReconCards(
  results: ReconciledResult[],
  anchoredFile: string,
  blockIdFor: (r: ReconciledResult) => string,
  opts: BuildCardsOptions = {},
): ReconCard[] {
  const withFile: BuildCardsOptions = { ...opts, anchoredFile };
  const out: ReconCard[] = [];
  for (const r of results) {
    if (r.status === 'needs-review' && !opts.includeNeedsReview) continue;
    if (!r.best) continue;                       // no anchor → nothing to view
    out.push(buildReconCard(r, blockIdFor(r), withFile));
  }
  return out;
}

/** Assemble the full cards file for the SR plugin (idempotent, block-id keyed).
 *  Every card sits under its own `## 🎴` heading with a divider, so the file
 *  reads as discrete cards (outline pane / fold / Ctrl+click navigation) while
 *  staying exactly parseable by the spaced-repetition plugin (`front ? back`
 *  blocks are untouched; headings and rules live BETWEEN blocks). */
export function renderCardsFile(cards: ReconCard[], opts: { transcriptRef?: string | null; sourceLabel?: string } = {}): string {
  const out: string[] = ['---'];
  if (opts.transcriptRef) out.push(`source: ${opts.transcriptRef}`);
  if (opts.sourceLabel) out.push(`source_media: ${opts.sourceLabel}`);
  out.push('tags: [flashcards/jp-recon]', 'generated: jp-collocations reconciliation cards', '---', '');
  out.push('# 照合フラッシュカード（タイムスタンプ・アンカー付き）', '');
  out.push(`> ${cards.length} 枚。各カードは文字起こしの該当ブロックへのビュー（原文リンク＋YouTube 時刻リンク＋音声クリップ）。新規ノートは作りません。`, '');
  cards.forEach((c, i) => {
    out.push(`## 🎴 ${i + 1}. ${c.heading}`, '');
    out.push(c.markdown, '');
    out.push('---', '');
  });
  return out.join('\n');
}
