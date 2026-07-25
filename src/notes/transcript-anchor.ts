/**
 * transcript-anchor.ts — anchor reconciled spans INSIDE the actual transcript
 * file (DESIGN §1.5, invariant #1: markdown/single-source-of-truth).
 *
 * The previous implementation wrote callouts into a separate `-reconciled.md`
 * report — a copy. This module instead wraps the matched transcript lines *in
 * place* in a typed, colored callout terminated by a stable `^recon-<hash>`
 * block id, so every embed (`![[transcript#^id]]` in the library and on cards)
 * shows the REAL transcript lines — timestamps and all — with the matched
 * phrase ==highlighted==.
 *
 * "Enough but not too much" context: the window around a matched span grows
 * per side until it carries a minimum of characters AND seconds of speech,
 * keeps extending while the boundary line ends mid-clause (ASR captions have
 * no 。, so continuative particles are the boundary signal), and is hard-capped
 * in lines and seconds. The same window drives the audio clip range, so what
 * you hear is what you see.
 *
 * Everything here is pure (no Obsidian imports) and inverse-tested:
 * `stripAnchors(applyAnchors(md)) === md`, so re-running never duplicates or
 * corrupts (invariants #4/#5). Re-annotation is a deterministic function of
 * (pristine transcript + this run's results).
 */

import { normalizeJapanese } from '../utils/japanese.ts';
import { NOTE_TYPES, CALLOUT_TO_CLASS, DEFAULT_NOTE_CLASS, type NoteClass } from './note-types.ts';
import { CAPTION_STAMP_RE, cleanCaptionText, type ReconciledResult } from './pipeline.ts';
import type { MatcherLine } from './local-matcher.ts';
import { blockIdFor } from './annotate.ts';

// ── context window ("enough but not too much") ───────────────────────────────

export interface ContextWindowOpts {
  /** Minimum context characters per side before we may stop. */
  minChars?: number;
  /** Minimum seconds of speech per side before we may stop. */
  minSec?: number;
  /** Hard cap on extra lines per side. */
  maxLinesPerSide?: number;
  /** Hard cap on seconds per side. */
  maxSecPerSide?: number;
}

export interface LineWindow { startLine: number; endLine: number; }

const DEFAULTS: Required<ContextWindowOpts> = {
  minChars: 24,
  minSec: 6,
  maxLinesPerSide: 4,
  maxSecPerSide: 30,
};

/** Line-final continuative — the sentence flows on (captions carry no 。). */
const CONTINUATIVE =
  /(て|で|に|を|が|は|と|も|へ|や|から|けど|けれど|し|たら|なら|ので|のに|、)$/;

/**
 * Grow a context window around a matched span. Each side: always ≥1 line when
 * available; keep adding lines until both the char and the time minimums are
 * met; then keep extending only while the clause is visibly unfinished at the
 * boundary; never exceed the hard caps.
 */
export function contextWindow(
  lines: MatcherLine[],
  span: { startLine: number; endLine: number },
  opts: ContextWindowOpts = {},
): LineWindow {
  const o = { ...DEFAULTS, ...opts };
  const t = (i: number): number | undefined => lines[i]?.tStartSec;

  // before side
  let start = span.startLine;
  {
    let chars = 0;
    const t0 = t(span.startLine);
    for (let added = 0; added < o.maxLinesPerSide && start > 0; added++) {
      const cand = start - 1;
      const sec = t0 != null && t(cand) != null ? t0 - (t(cand) as number) : null;
      if (sec != null && sec > o.maxSecPerSide) break;
      const minsMet = added > 0 && chars >= o.minChars && (sec == null || (t0 as number) - (t(start) as number) >= o.minSec);
      // After the minimums, only keep going if the line we'd add flows INTO the
      // window (it ends mid-clause) — the natural boundary is behind it.
      if (minsMet && !CONTINUATIVE.test(lines[cand].text)) break;
      start = cand;
      chars += lines[cand].text.length;
    }
  }

  // after side
  let end = span.endLine;
  {
    let chars = 0;
    const tEdge = t(span.endLine);
    for (let added = 0; added < o.maxLinesPerSide && end < lines.length - 1; added++) {
      const cand = end + 1;
      const sec = tEdge != null && t(cand) != null ? (t(cand) as number) - tEdge : null;
      if (sec != null && sec > o.maxSecPerSide) break;
      const secSoFar = tEdge != null && t(end) != null ? (t(end) as number) - tEdge : null;
      const minsMet = added > 0 && chars >= o.minChars && (secSoFar == null || secSoFar >= o.minSec);
      // After the minimums, extend only while OUR outermost line is unfinished.
      if (minsMet && !CONTINUATIVE.test(lines[end].text)) break;
      end = cand;
      chars += lines[cand].text.length;
    }
  }

  return { startLine: start, endLine: end };
}

// ── plan (windows + clusters + clip ranges) ──────────────────────────────────

export interface PlannedAnchor {
  /** Unique per result — the library key (= blockIdFor(result)). */
  id: string;
  result: ReconciledResult;
  window: LineWindow;
  /** Audio range covering the whole window (what you hear = what you see). */
  clipStartSec: number | null;
  clipEndSec: number | null;
}

export interface AnchorCluster {
  /** The block id actually written into the transcript (embeds target this). */
  anchorId: string;
  window: LineWindow;
  items: PlannedAnchor[];
}

export interface AnchorPlan {
  items: PlannedAnchor[];
  clusters: AnchorCluster[];
  /** item id → the cluster anchor id its embeds should use. */
  anchorIdOf: Map<string, string>;
}

/** Median gap between consecutive timestamps (fallback line duration). */
function medianGapSec(lines: MatcherLine[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1].tStartSec, b = lines[i].tStartSec;
    if (a != null && b != null && b > a) gaps.push(b - a);
  }
  if (!gaps.length) return 5;
  gaps.sort((x, y) => x - y);
  return gaps[Math.floor(gaps.length / 2)];
}

function clipRange(lines: MatcherLine[], w: LineWindow): { start: number | null; end: number | null } {
  const start = lines[w.startLine]?.tStartSec ?? null;
  const endLineT = lines[w.endLine]?.tStartSec ?? null;
  if (start == null || endLineT == null) return { start: null, end: null };
  const nextT = lines[w.endLine + 1]?.tStartSec;
  const lastDur = nextT != null && nextT > endLineT
    ? Math.min(15, nextT - endLineT)
    : Math.min(15, medianGapSec(lines));
  return { start: Math.max(0, Math.floor(start)), end: Math.ceil(endLineT + lastDur + 0.5) };
}

/**
 * Plan the anchoring of one reconciliation run: a window per located result,
 * overlapping windows merged into clusters (one callout block each — Obsidian
 * allows one block id per block), and a clip range per item.
 */
export function planAnchors(
  results: ReconciledResult[],
  lines: MatcherLine[],
  opts: ContextWindowOpts = {},
): AnchorPlan {
  const items: PlannedAnchor[] = [];
  for (const r of results) {
    if (!r.best) continue;
    const window = contextWindow(lines, r.best, opts);
    const { start, end } = clipRange(lines, window);
    items.push({ id: blockIdFor(r), result: r, window, clipStartSec: start, clipEndSec: end });
  }
  // sort by position; merge overlapping windows into clusters
  const sorted = [...items].sort(
    (a, b) => a.window.startLine - b.window.startLine || a.window.endLine - b.window.endLine || a.id.localeCompare(b.id),
  );
  const clusters: AnchorCluster[] = [];
  for (const it of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && it.window.startLine <= last.window.endLine) {
      last.window = {
        startLine: last.window.startLine,
        endLine: Math.max(last.window.endLine, it.window.endLine),
      };
      last.items.push(it);
    } else {
      clusters.push({ anchorId: it.id, window: { ...it.window }, items: [it] });
    }
  }
  // anchor id: the earliest-starting item's id, deterministic
  const anchorIdOf = new Map<string, string>();
  for (const c of clusters) {
    c.items.sort((a, b) => (a.result.best!.startLine - b.result.best!.startLine) || a.id.localeCompare(b.id));
    c.anchorId = c.items[0].id;
    for (const it of c.items) anchorIdOf.set(it.id, c.anchorId);
  }
  return { items, clusters, anchorIdOf };
}

// ── md-line mapping (mirror of parseTranscriptLines) ─────────────────────────

/** md line numbers of each PARSED transcript line (same filter as parseTranscriptLines). */
export function mapParsedToMdLines(md: string): { mdLines: string[]; mdOf: number[] } {
  const mdLines = md.split('\n');
  const mdOf: number[] = [];
  for (let i = 0; i < mdLines.length; i++) {
    const m = mdLines[i].match(CAPTION_STAMP_RE);
    if (!m) continue;
    if (cleanCaptionText(m[4] || '')) mdOf.push(i);
  }
  return { mdLines, mdOf };
}

// ── highlight (best-effort, never corrupts) ──────────────────────────────────

/** Per-char normalized form + norm-index → raw-index map (spaces dropped,
 *  matching the matcher's lineNorm). */
function normRawMap(raw: string): { norm: string; rawIdx: number[] } {
  let norm = '';
  const rawIdx: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const n = normalizeJapanese(raw[i]).replace(/\s+/g, '');
    for (let k = 0; k < n.length; k++) { norm += n[k]; rawIdx.push(i); }
  }
  return { norm, rawIdx };
}

/** Wrap raw[a..b] (inclusive) in ==…==; returns raw unchanged when degenerate. */
function wrapRaw(raw: string, a: number, b: number): string {
  if (a < 0 || b < a || b >= raw.length) return raw;
  return raw.slice(0, a) + '==' + raw.slice(a, b + 1) + '==' + raw.slice(b + 1);
}

/**
 * Highlight the portion of `rawText` covered by the (normalized) span text.
 * `role`: whole line ('mid'), the span's first line ('first' → suffix), last
 * line ('last' → prefix), or single-line ('only' → substring). Best-effort: on
 * any normalization drift the line is returned unhighlighted.
 */
export function highlightLine(
  rawText: string,
  spanNorm: string,
  role: 'only' | 'first' | 'mid' | 'last',
): string {
  if (rawText.includes('==')) return rawText;           // already marked — don't nest
  // User-annotated lines (<mark>, ~~…~~, [[wikilinks]], %%comments%%) — inserting
  // ==…== could split a marker pair and corrupt rendering. Degrade soft: skip.
  if (/[<>]|~~|\[\[|%%/.test(rawText)) return rawText;
  const { norm, rawIdx } = normRawMap(rawText);
  if (!norm.length || !spanNorm.length) return rawText;
  if (role === 'mid') return wrapRaw(rawText, rawIdx[0], rawIdx[rawIdx.length - 1]);
  if (role === 'only') {
    const pos = norm.indexOf(spanNorm);
    if (pos < 0) return rawText;
    return wrapRaw(rawText, rawIdx[pos], rawIdx[pos + spanNorm.length - 1]);
  }
  if (role === 'first') {
    // longest suffix of this line that prefixes the span
    for (let k = Math.min(norm.length, spanNorm.length); k >= 2; k--) {
      if (norm.endsWith(spanNorm.slice(0, k))) {
        return wrapRaw(rawText, rawIdx[norm.length - k], rawIdx[norm.length - 1]);
      }
    }
    return rawText;
  }
  // 'last': longest prefix of this line that suffixes the span
  for (let k = Math.min(norm.length, spanNorm.length); k >= 2; k--) {
    if (norm.startsWith(spanNorm.slice(spanNorm.length - k))) {
      return wrapRaw(rawText, rawIdx[0], rawIdx[k - 1]);
    }
  }
  return rawText;
}

// ── render one cluster callout ───────────────────────────────────────────────

const fmtTime = (s: number | null | undefined): string =>
  s == null ? '??:??' : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`;

function correctionLine(c: { kind: string; noteText: string; transcriptText: string }): string {
  const mark = c.kind === 'homophone' ? '⚠️ 同音校正' : c.kind === 'kanji-swap' ? '⚠️ 漢字違い' : '⚠️ 相違';
  return `> ${mark}: 「${c.noteText}」→「${c.transcriptText}」`;
}

function itemMeta(it: PlannedAnchor, cls: NoteClass, lead: boolean): string[] {
  const r = it.result;
  const def = NOTE_TYPES[cls];
  const flag = r.status === 'needs-review' ? ' 🔶要確認' : '';
  const head = `${def.emoji} **${r.reconciled || r.note}** · ~${fmtTime(r.tStartSec)} · ${(r.confidence * 100).toFixed(0)}% · ${r.status}${flag}`;
  const out: string[] = [];
  if (!lead) out.push(`> ${head}`);
  out.push(`> **メモ:** ${r.note}`);
  for (const c of r.corrections) out.push(correctionLine(c));
  return out;
}

/**
 * The callout block for one cluster: typed header, per-item meta, then the REAL
 * transcript window lines (quoted, timestamps kept, matched spans highlighted),
 * terminated by the `^anchorId` all embeds reference.
 *
 * `windowRaw` = the raw md lines of the window (may include non-stamped lines);
 * `mdOfWindow[k]` = index INTO windowRaw of the window's k-th PARSED line.
 */
export function renderClusterCallout(
  cluster: AnchorCluster,
  windowRaw: string[],
  mdOfWindow: number[],
  classOf: (id: string) => NoteClass | undefined,
): string[] {
  const first = cluster.items[0];
  const cls0 = classOf(first.id) ?? DEFAULT_NOTE_CLASS;
  const def = NOTE_TYPES[cls0];
  const anyReview = cluster.items.some((i) => i.result.status === 'needs-review');
  const fold = anyReview ? '+' : '-';
  const flag = first.result.status === 'needs-review' ? ' 🔶要確認' : '';
  const out: string[] = [
    `> [!${def.callout}]${fold} ${def.emoji} ${first.result.reconciled || first.result.note} · ~${fmtTime(first.result.tStartSec)} · ${(first.result.confidence * 100).toFixed(0)}% · ${first.result.status}${flag}`,
  ];
  out.push(...itemMeta(first, cls0, true));  // メモ + corrections (head already in title)
  for (const it of cluster.items.slice(1)) {
    out.push('> ');
    out.push(...itemMeta(it, classOf(it.id) ?? DEFAULT_NOTE_CLASS, false));
  }
  out.push('>');

  // window body: quote raw lines; highlight each item's span
  const body = [...windowRaw];
  for (const it of cluster.items) {
    const span = it.result.best!;
    const spanNorm = normalizeJapanese(span.text).replace(/\s+/g, '');
    for (let ln = span.startLine; ln <= span.endLine; ln++) {
      const bi = mdOfWindow[ln - cluster.window.startLine];
      if (bi == null || bi < 0 || bi >= body.length) continue;
      const role = span.startLine === span.endLine ? 'only'
        : ln === span.startLine ? 'first'
        : ln === span.endLine ? 'last' : 'mid';
      // highlight only the text after the [stamp] (bare or link-wrapped)
      const m = body[bi].match(/^(\s*\[(?:\d{1,2}:)?\d{1,2}:\d{2}\](?:\((?:https?|obsidian):[^)\s]*\))?\s*)(.*)$/);
      if (m) body[bi] = m[1] + highlightLine(m[2], spanNorm, role);
      else body[bi] = highlightLine(body[bi], spanNorm, role);
    }
  }
  // Quote the window. Non-stamped lines (blank/free text inside the window) are
  // escaped with ⋮ so stripAnchors can restore them verbatim. Lines that ALREADY
  // carry a user's ==highlight== also take the escape path: strip removes every
  // `==` from plain-quoted lines (to undo OUR highlights), so a user's marks
  // must travel the verbatim route or they would be destroyed on re-run.
  const stamped = new Set(mdOfWindow);
  body.forEach((b, i) => out.push(stamped.has(i) && !windowRaw[i].includes('==') ? `> ${b}` : `> ⋮${b}`));
  out.push(`^${cluster.anchorId}`);
  return out;
}

// ── apply / strip (exact inverses) ───────────────────────────────────────────

/**
 * Write the plan's callouts into a PRISTINE transcript (run stripAnchors first
 * if the file may already carry anchors). Splices bottom-up so line indexes
 * stay valid. Adds exactly one blank line before and after each callout —
 * stripAnchors removes exactly those.
 */
export function applyAnchors(
  pristineMd: string,
  plan: AnchorPlan,
  classOf: (id: string) => NoteClass | undefined = () => undefined,
): string {
  if (!plan.clusters.length) return pristineMd;
  const { mdLines, mdOf } = mapParsedToMdLines(pristineMd);
  const byPos = [...plan.clusters].sort((a, b) => b.window.startLine - a.window.startLine);
  const out = [...mdLines];
  for (const cluster of byPos) {
    const mdStart = mdOf[cluster.window.startLine];
    const mdEnd = mdOf[cluster.window.endLine];
    if (mdStart == null || mdEnd == null || mdEnd < mdStart) continue;  // defensive
    const windowRaw = out.slice(mdStart, mdEnd + 1);
    // window-relative index of each parsed line in the window
    const mdOfWindow: number[] = [];
    for (let k = cluster.window.startLine; k <= cluster.window.endLine; k++) mdOfWindow.push(mdOf[k] - mdStart);
    const callout = renderClusterCallout(cluster, windowRaw, mdOfWindow, classOf);
    out.splice(mdStart, mdEnd - mdStart + 1, '', ...callout, '');
  }
  return out.join('\n');
}

const CALLOUT_HEADER_RE = new RegExp(
  `^> \\[!(?:${Object.keys(CALLOUT_TO_CLASS).join('|')})\\][+-]? `,   // includes legacy keywords
);
const QUOTED_STAMP_RE = /^>\s?(\s*\[(?:\d{1,2}:)?\d{1,2}:\d{2}\]\s*.*)$/;
const ANCHOR_LINE_RE = /^\^recon-[a-z0-9]+\s*$/;

/**
 * Remove every reconciliation callout, restoring the pristine transcript:
 * quoted window lines are un-quoted and un-highlighted, meta lines and the
 * `^recon-*` anchors are dropped, and the one blank line added on each side of
 * a callout is swallowed. Exact inverse of applyAnchors.
 */
export function stripAnchors(md: string): string {
  const src = md.split('\n');
  const out: string[] = [];
  // A block is OURS only when its quoted run terminates in a ^recon- anchor —
  // a user's own [!serifu]/[!discourse]… callout is left untouched.
  const isOurs = (headerIdx: number): boolean => {
    let j = headerIdx + 1;
    while (j < src.length && src[j].startsWith('>')) j++;
    return j < src.length && ANCHOR_LINE_RE.test(src[j]);
  };
  for (let i = 0; i < src.length; i++) {
    if (!CALLOUT_HEADER_RE.test(src[i]) || !isOurs(i)) { out.push(src[i]); continue; }
    // swallow the single blank line applyAnchors put before the callout
    if (out.length && out[out.length - 1] === '') out.pop();
    // consume the callout
    i++;
    for (; i < src.length; i++) {
      if (ANCHOR_LINE_RE.test(src[i])) break;                 // end of block
      const esc = src[i].match(/^> ⋮(.*)$/);
      if (esc) { out.push(esc[1]); continue; }                 // escaped non-stamped line
      const q = src[i].match(QUOTED_STAMP_RE);
      if (q) { out.push(q[1].replace(/==/g, '')); continue; } // real transcript line
      if (src[i].startsWith('>')) continue;                    // meta / blank-quote line
      // malformed (no anchor line) — keep the line and bail out of the block
      out.push(src[i]);
      break;
    }
    // swallow the single blank line applyAnchors put after the callout
    if (src[i + 1] === '') i++;
  }
  return out.join('\n');
}
