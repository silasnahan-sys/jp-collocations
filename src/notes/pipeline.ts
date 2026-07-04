/**
 * pipeline.ts — reconciliation orchestrator (DESIGN §5, text-note path §10).
 *
 * Pure and Obsidian-free so it runs in the golden harness. Takes note phrases +
 * a transcript, runs the LocalMatcher, and produces reconciled results + a
 * Markdown report shaped like `samplenotes-reconciled.md`. The Obsidian command
 * (main.ts) reads/writes vault files and injects the DictionaryStore resolver.
 */

import { match, type MatcherLine, type ReadingResolver, type Correction, type MatchSpan } from './local-matcher.ts';

/** Below this combined confidence a result is flagged for human review (DESIGN §5/#7). */
export const RECONCILE_THRESHOLD = 0.7;

export interface ReconciledResult {
  note: string;                 // the user's raw phrase
  best: MatchSpan | null;
  tStartSec: number | null;
  reconciled: string;           // the located transcript span (the anchor / "校正")
  confidence: number;
  status: 'auto' | 'needs-review';
  corrections: Correction[];
  contextBefore: string[];
  contextAfter: string[];
  alternatives: MatchSpan[];
}

/** Parse a transcript markdown into timestamped lines. Handles inline caption
 *  stamps `[HH:MM:SS]` / `[MM:SS]`; falls back to untimed lines otherwise. */
export function parseTranscriptLines(md: string): MatcherLine[] {
  const lines: MatcherLine[] = [];
  let idx = 0;
  let sawStamp = false;
  for (const rawLn of md.split('\n')) {
    const m = rawLn.match(/\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]\s*(.*)/);
    if (m) {
      sawStamp = true;
      const h = m[1] ? +m[1] : 0;
      const text = (m[4] || '').replace(/\[音楽\]/g, '').trim();
      if (text) lines.push({ index: idx++, tStartSec: h * 3600 + +m[2] * 60 + +m[3], text });
    }
  }
  if (sawStamp) return lines;
  // no timestamps: treat each non-empty, non-heading line as an untimed line
  for (const rawLn of md.split('\n')) {
    const t = rawLn.trim();
    if (!t || t.startsWith('#') || t.startsWith('---')) continue;
    lines.push({ index: idx++, text: t });
  }
  return lines;
}

/** Pull the `source:` transcript reference out of YAML frontmatter, if present. */
export function frontmatterSource(md: string): string | null {
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const m = fm[1].match(/^\s*source(?:_transcript)?:\s*(.+?)\s*$/m);
  if (!m) return null;
  return m[1].replace(/^["'\[]+|["'\]]+$/g, '').trim() || null;
}

/** Extract candidate note phrases from a notes file: plain text lines, list
 *  items, and callout bodies — skipping frontmatter, headings, and blockquotes. */
export function extractNotePhrases(md: string): string[] {
  const body = md.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const out: string[] = [];
  for (const rawLn of body.split('\n')) {
    let t = rawLn.trim();
    if (!t || t.startsWith('#') || t.startsWith('>') || t.startsWith('---') || t.startsWith('```')) continue;
    t = t.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '').replace(/^\[[ x]\]\s+/, '');
    t = t.replace(/[*_`~]/g, '').trim();
    if (t.length >= 2) out.push(t);
  }
  return out;
}

/** Reconcile note phrases against a transcript. */
export function reconcile(notes: string[], lines: MatcherLine[], readingOf?: ReadingResolver): ReconciledResult[] {
  return notes.map((note) => {
    const r = match(note, lines, readingOf);
    const status: 'auto' | 'needs-review' = r.best && r.confidence >= RECONCILE_THRESHOLD ? 'auto' : 'needs-review';
    return {
      note,
      best: r.best,
      tStartSec: r.best?.tStartSec ?? null,
      reconciled: r.best?.text ?? '',
      confidence: r.confidence,
      status,
      corrections: r.corrections,
      contextBefore: r.contextBefore,
      contextAfter: r.contextAfter,
      alternatives: r.alternatives,
    };
  });
}

const fmtTime = (s: number | null): string =>
  s == null ? '??:??' : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** Render results as a Markdown report (shape of samplenotes-reconciled.md). */
export function renderReport(results: ReconciledResult[], opts: { sourceLabel?: string; transcriptRef?: string } = {}): string {
  const auto = results.filter((r) => r.status === 'auto').length;
  const review = results.length - auto;
  const out: string[] = [];
  out.push('---');
  if (opts.transcriptRef) out.push(`source: ${opts.transcriptRef}`);
  if (opts.sourceLabel) out.push(`source_media: ${opts.sourceLabel}`);
  out.push(`reconciled: ${results.length} notes — ${auto} auto, ${review} needs-review`);
  out.push('generated: jp-collocations reconciliation pipeline');
  out.push('---');
  out.push('');
  out.push('# 照合ノート（自動生成）');
  out.push('');
  out.push('> 各ノート = あなたのメモを文字起こし（＝実際に言われたこと）で位置づけ・校正したもの。');
  out.push('> ⚠️ = 校正候補（要確認）。確信度が低いものは needs-review。');
  out.push('');

  results.forEach((r, i) => {
    const flag = r.status === 'needs-review' ? ' 🔶 要確認' : '';
    out.push(`## ${i + 1}. ${r.note}${flag}`);
    out.push(`- **メモ(raw):** ${r.note}`);
    if (r.best) {
      out.push(`- **校正(located):** ${r.reconciled}`);
      out.push(`- **時刻:** ~${fmtTime(r.tStartSec)} ｜ 確信度: ${(r.confidence * 100).toFixed(0)}% ｜ ${r.status}`);
      if (r.contextBefore.length || r.contextAfter.length) {
        const ctx = [...r.contextBefore.map((c) => `…${c}`), `**${r.reconciled}**`, ...r.contextAfter.map((c) => `${c}…`)].join(' / ');
        out.push(`- **文脈:** ${ctx}`);
      }
      for (const c of r.corrections) {
        const mark = c.kind === 'homophone' ? '⚠️ 同音校正' : c.kind === 'kanji-swap' ? '⚠️ 漢字違い' : '⚠️ 相違';
        out.push(`- ${mark}: 「${c.noteText}」→「${c.transcriptText}」（${c.reason}）`);
      }
    } else {
      out.push('- **校正:** （対応が見つかりません — 要確認）');
    }
    out.push('');
  });
  return out.join('\n');
}
