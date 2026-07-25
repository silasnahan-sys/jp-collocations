/**
 * annotate.ts — idempotent typed-callout writer + Big-5 router (DESIGN §8.4/§9).
 *
 * Turns reconciled results into Obsidian callouts with STABLE block IDs
 * (`^recon-<hash>` = hash of note+span+time), so re-running merges/updates and
 * never duplicates (invariant #5). The callout keyword carries the Big-5 class
 * (invariant #1: Markdown is source of truth); the library holds only references
 * `![[file#^id]]`, never copies (invariant #1). Class is preserved across
 * re-runs by looking up the prior class per block ID.
 */

import { NOTE_TYPES, CALLOUT_TO_CLASS, DEFAULT_NOTE_CLASS, type NoteClass } from './note-types.ts';
import type { ReconciledResult } from './pipeline.ts';

export interface LibraryEntry {
  blockId: string;
  noteClass: NoteClass;
  file: string;              // the file the anchor lives in (the TRANSCRIPT note)
  note: string;
  reconciled: string;
  tStartSec: number | null;
  /** 'commentary' = user triaged a needs-review note as "not a transcript
   *  quote, keep as my own remark" — never re-flagged, never anchored. */
  status: 'auto' | 'needs-review' | 'commentary';
  confidence: number;
  corrections: number;
  /** Block id embeds should target (= cluster anchor). Absent → unanchored
   *  (unmatched note) or a legacy entry pointing at a `-reconciled.md` report. */
  anchorId?: string;
  /** The notes file this phrase came from — scopes re-run replacement. */
  sourceNote?: string;
  /** Context-window bounds (parsed-line indexes) + the audio range they imply. */
  startLine?: number;
  endLine?: number;
  clipStartSec?: number | null;
  clipEndSec?: number | null;
  /** Matched-span bounds — lets a later run re-anchor this entry without
   *  re-reconciling its notes file (the transcript is frozen, so parsed-line
   *  indexes stay valid). */
  spanStartLine?: number;
  spanEndLine?: number;
}

/** FNV-1a → base36. Deterministic, mobile-safe (no crypto). */
export function hashId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function blockIdFor(r: Pick<ReconciledResult, 'note' | 'reconciled' | 'tStartSec'>): string {
  return 'recon-' + hashId(`${r.note}|${r.reconciled}|${r.tStartSec ?? ''}`);
}

const fmtTime = (s: number | null): string =>
  s == null ? '??:??' : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** One reconciled result → a typed callout block terminated by its `^recon-id`. */
export function renderCallout(r: ReconciledResult, cls: NoteClass, index: number): string {
  const def = NOTE_TYPES[cls];
  const id = blockIdFor(r);
  const fold = r.status === 'needs-review' ? '+' : '-';   // open the ones needing review
  const flag = r.status === 'needs-review' ? ' 🔶要確認' : '';
  const head = `${def.emoji} ${index + 1}. ${r.reconciled || r.note} · ~${fmtTime(r.tStartSec)} · ${(r.confidence * 100).toFixed(0)}% · ${r.status}${flag}`;
  const lines: string[] = [`> [!${def.callout}]${fold} ${head}`];
  lines.push(`> **メモ:** ${r.note}`);
  if (r.best) {
    if (r.contextBefore.length || r.contextAfter.length) {
      const ctx = [...r.contextBefore.map((c) => `…${c}`), `**${r.reconciled}**`, ...r.contextAfter.map((c) => `${c}…`)].join(' / ');
      lines.push(`> **文脈:** ${ctx}`);
    }
    for (const c of r.corrections) {
      const mark = c.kind === 'homophone' ? '⚠️ 同音校正' : c.kind === 'kanji-swap' ? '⚠️ 漢字違い' : '⚠️ 相違';
      lines.push(`> ${mark}: 「${c.noteText}」→「${c.transcriptText}」`);
    }
  } else {
    lines.push('> （対応が見つかりません — 要確認）');
  }
  lines.push(`^${id}`);   // block anchor, referenced as ![[file#^id]]
  return lines.join('\n');
}

export interface AnchorFileOptions {
  transcriptRef?: string;
  sourceLabel?: string;
  /** prior class per block ID (from the persisted library) — preserved on re-run. */
  priorClass?: Map<string, NoteClass>;
}

/** Render the full anchored report file (frontmatter + typed callouts). */
export function renderAnchoredFile(results: ReconciledResult[], opts: AnchorFileOptions = {}): string {
  const prior = opts.priorClass ?? new Map<string, NoteClass>();
  const auto = results.filter((r) => r.status === 'auto').length;
  const out: string[] = ['---'];
  if (opts.transcriptRef) out.push(`source: ${opts.transcriptRef}`);
  if (opts.sourceLabel) out.push(`source_media: ${opts.sourceLabel}`);
  out.push(`reconciled: ${results.length} notes — ${auto} auto, ${results.length - auto} needs-review`);
  out.push('generated: jp-collocations reconciliation pipeline');
  out.push('---', '');
  out.push('# 照合ノート（自動生成・型付き）', '');
  out.push('> 各カラー = ノート種別（🟡セリフ 🔵連語 🟢修辞連語 💠慣用構文 🟠骨格構文 🔴談話）。ライブラリで種別を変更できます。', '');
  results.forEach((r, i) => {
    const cls = prior.get(blockIdFor(r)) ?? DEFAULT_NOTE_CLASS;
    out.push(renderCallout(r, cls, i), '');
  });
  return out.join('\n');
}

/** Library entries for the persisted index (invariant #1: references, not copies). */
export function buildEntries(results: ReconciledResult[], file: string, priorClass?: Map<string, NoteClass>): LibraryEntry[] {
  const prior = priorClass ?? new Map<string, NoteClass>();
  return results.map((r) => {
    const blockId = blockIdFor(r);
    return {
      blockId,
      noteClass: prior.get(blockId) ?? DEFAULT_NOTE_CLASS,
      file,
      note: r.note,
      reconciled: r.reconciled,
      tStartSec: r.tStartSec,
      status: r.status,
      confidence: r.confidence,
      corrections: r.corrections.length,
    };
  });
}

/**
 * Library entries for an IN-TRANSCRIPT anchoring run (the successor of
 * `buildEntries`): every result becomes an entry keyed by its own block id;
 * located results additionally carry the cluster anchor id their embeds
 * target, the window bounds, and the window-derived audio range.
 */
export function buildAnchoredEntries(
  results: ReconciledResult[],
  plan: {
    items: Array<{ id: string; window: { startLine: number; endLine: number }; clipStartSec: number | null; clipEndSec: number | null }>;
    anchorIdOf: Map<string, string>;
  },
  transcriptFile: string,
  sourceNote: string,
  priorClass?: Map<string, NoteClass>,
): LibraryEntry[] {
  const prior = priorClass ?? new Map<string, NoteClass>();
  const byId = new Map(plan.items.map((it) => [it.id, it]));
  return results.map((r) => {
    const blockId = blockIdFor(r);
    const it = byId.get(blockId);
    return {
      blockId,
      noteClass: prior.get(blockId) ?? DEFAULT_NOTE_CLASS,
      file: transcriptFile,
      note: r.note,
      reconciled: r.reconciled,
      tStartSec: r.tStartSec,
      status: r.status,
      confidence: r.confidence,
      corrections: r.corrections.length,
      anchorId: it ? plan.anchorIdOf.get(blockId) : undefined,
      sourceNote,
      startLine: it?.window.startLine,
      endLine: it?.window.endLine,
      clipStartSec: it?.clipStartSec,
      clipEndSec: it?.clipEndSec,
      spanStartLine: r.best?.startLine,
      spanEndLine: r.best?.endLine,
    };
  });
}

/**
 * Rebuild a minimal ReconciledResult from a persisted entry so a NEW run over
 * the same (frozen) transcript can re-anchor another notes file's entries
 * without re-reconciling them. Correction detail isn't persisted — the callout
 * regains everything else (span, window, highlight, confidence, status).
 */
export function entryToResult(e: LibraryEntry): ReconciledResult | null {
  if (e.spanStartLine == null || e.spanEndLine == null) return null;
  return {
    note: e.note,
    reconciled: e.reconciled,
    tStartSec: e.tStartSec,
    best: {
      startLine: e.spanStartLine,
      endLine: e.spanEndLine,
      tStartSec: e.tStartSec ?? undefined,
      text: e.reconciled,
      score: e.confidence,
    },
    confidence: e.confidence,
    status: e.status === 'auto' ? 'auto' : 'needs-review',
    corrections: [],
    contextBefore: [],
    contextAfter: [],
    alternatives: [],
  };
}

/** Recover class per block ID from an anchored file's Markdown (source of truth). */
export function parseClasses(md: string): Map<string, NoteClass> {
  const map = new Map<string, NoteClass>();
  const re = /> \[!([a-z-]+)\][+-]?[\s\S]*?\n\^(recon-[a-z0-9]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const cls = CALLOUT_TO_CLASS[m[1]];
    if (cls) map.set(m[2], cls);
  }
  return map;
}

/** Rewrite one callout's class keyword in an anchored file (for retype from the library). */
export function retypeInMarkdown(md: string, blockId: string, newClass: NoteClass): string {
  const kw = NOTE_TYPES[newClass].callout;
  const emoji = NOTE_TYPES[newClass].emoji;
  // Find the callout whose OWN quoted run terminates in ^blockId — every line
  // between header and anchor must be a `>` line, so the match can never leak
  // across neighbouring callouts. Swap the [!keyword] and the leading emoji.
  const re = new RegExp(
    `(> \\[!)([a-z-]+)(\\][+-]? )(?:🟡|🟢|🔵|🩵|🔴|🟠|💠)( [^\\n]*\\n(?:>[^\\n]*\\n)*\\^${blockId})(?=\\s|$)`,
  );
  return md.replace(re, `$1${kw}$3${emoji}$4`);
}
