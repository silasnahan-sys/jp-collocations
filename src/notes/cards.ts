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
}

const fmtClock = (s: number | null): string =>
  s == null ? '??:??' : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const BLANK = '【＿＿＿＿＿】';

/** Render the anchor footer shared by every card (block-link + deep-link + audio). */
function renderAnchor(anchor: CardAnchor, clip: AudioClip): string[] {
  const lines: string[] = ['', '---'];
  // transcript block-link — the durable, always-present anchor (invariant #1)
  lines.push(`⏱ **原文:** ![[${anchor.file}#^${anchor.blockId}]]`);
  const deep = youtubeDeepLink(anchor.videoId, anchor.tStartSec);
  if (deep) lines.push(`▶ **YouTube (${fmtClock(anchor.tStartSec)}):** ${deep}`);
  if (clip.kind === 'local') lines.push(`${clip.label}: ![[${clip.href}]]`);
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
    blockId,
    videoId: opts.videoId ?? null,
    tStartSec: r.tStartSec,
    transcriptRef: opts.transcriptRef ?? null,
  };

  // ── FRONT: the phrase blanked in its ±context (graduated cloze) ──
  const before = r.contextBefore.map((c) => `…${c}`).join(' ');
  const after = r.contextAfter.map((c) => `${c}…`).join(' ');
  const clozeLine = [before, BLANK, after].filter(Boolean).join(' ');
  const frontLines = [
    `${def.emoji} **${def.label}** · ~${fmtClock(r.tStartSec)}`,
    '',
    clozeLine || BLANK,
    '',
    `> ヒント: あなたのメモ「${r.note}」`,
  ];
  const front = frontLines.join('\n');

  // ── BACK: the answer + any corrections + the live anchors ──
  const clip = audio.resolve(anchor.videoId, r.tStartSec);
  const backLines = [`**${answer}**`, ''];
  if (r.note && r.note !== answer) backLines.push(`メモ(raw): ~~${r.note}~~ → **${answer}**`);
  for (const c of r.corrections) {
    const mark = c.kind === 'homophone' ? '⚠️ 同音校正' : c.kind === 'kanji-swap' ? '⚠️ 漢字違い' : '⚠️ 相違';
    backLines.push(`${mark}: 「${c.noteText}」→「${c.transcriptText}」`);
  }
  backLines.push(...renderAnchor(anchor, clip));
  const back = backLines.join('\n');

  const tags = [tagPrefix, `${tagPrefix}/${def.callout}`];
  if (r.status === 'needs-review') tags.push(`${tagPrefix}/needs-review`);
  const tagLine = tags.map((t) => `#${t}`).join(' ');
  const markdown = `${tagLine}\n${front}\n?\n${back}\n`;

  return { id: `card-${blockId}`, blockId, noteClass, front, back, tags, markdown, anchor };
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

/** Assemble the full cards file for the SR plugin (idempotent, block-id keyed). */
export function renderCardsFile(cards: ReconCard[], opts: { transcriptRef?: string | null; sourceLabel?: string } = {}): string {
  const out: string[] = ['---'];
  if (opts.transcriptRef) out.push(`source: ${opts.transcriptRef}`);
  if (opts.sourceLabel) out.push(`source_media: ${opts.sourceLabel}`);
  out.push('tags: [flashcards/jp-recon]', 'generated: jp-collocations reconciliation cards', '---', '');
  out.push('# 照合フラッシュカード（タイムスタンプ・アンカー付き）', '');
  out.push('> 各カードは文字起こしの該当ブロックへのビュー（原文リンク＋YouTube 時刻リンク）。新規ノートは作りません。', '');
  for (const c of cards) {
    out.push(c.markdown, '');
  }
  return out.join('\n');
}
