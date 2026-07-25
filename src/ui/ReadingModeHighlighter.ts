/**
 * ReadingModeHighlighter — Markdown post-processor that highlights discourse
 * signals in reading mode (rendered HTML).
 *
 * Two signals are layered (sidecar wins on overlap):
 *   1. Sidecar bit_relations  — authoritative typed pairs from the pipeline
 *   2. Heuristic patterns     — TS regex-on-connector, best-guess only
 *
 * Alignment for sidecar:
 *   The resolver requires the paragraph text to appear verbatim inside the
 *   indexed raw file. Plain prose hits; markdown-styled paragraphs (bold,
 *   links, inline code) miss and fall back to heuristic-only for that
 *   paragraph. This is intentional — silent best-guess alignment would
 *   mislabel offsets.
 */

import type { MarkdownPostProcessorContext } from 'obsidian';
import { detectPatterns } from '../discourse/discourse-grammar';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../discourse/discourse-grammar';
import type { PatternCategory } from '../discourse/discourse-patterns';
import type { RelationsResolver } from '../discourse/relations-resolver';
import { heuristicResolver } from '../discourse/relations-resolver';
import type { SentenceRelation } from '../discourse/sentence-relations';

/** Module-level resolver — set by main.ts at onload. Defaults to heuristic-only. */
let readingResolver: RelationsResolver = heuristicResolver;
export function setReadingResolver(r: RelationsResolver): void {
  readingResolver = r;
}

interface Mark {
  start: number;          // offset in concatenated paragraph text
  end: number;            // exclusive
  className: string;
  borderColor?: string;
  title: string;
  priority: number;       // higher wins overlaps (sidecar=2, heuristic=1)
}

export function getReadingModePostProcessor() {
  return (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    if (document.body.hasClass('jp-reading-hl-off')) return;
    const paragraphs = el.querySelectorAll('p, li, blockquote > p, td');
    for (const p of Array.from(paragraphs)) {
      highlightParagraph(p as HTMLElement, ctx.sourcePath);
    }
  };
}

function highlightParagraph(el: HTMLElement, sourcePath: string | undefined): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  if (textNodes.length === 0) return;

  const fullText = textNodes.map(n => n.textContent || '').join('');
  if (fullText.length < 2) return;

  const marks: Mark[] = [];

  // Pass 1: sidecar bit_relations (priority 2).
  // Resolver returns sidecar only when the paragraph text is unambiguously
  // locatable in the raw file; otherwise it returns heuristic and we ignore
  // its `relations` here (the heuristic pattern pass below covers that).
  const resolved = readingResolver(fullText, { filePath: sourcePath });
  if (resolved.source === 'sidecar') {
    for (const rel of resolved.relations) {
      pushRelationEndpoint(marks, rel, 'source');
      pushRelationEndpoint(marks, rel, 'target');
    }
  }

  // Pass 2: heuristic patterns (priority 1).
  const patternMatches = detectPatterns(fullText);
  for (const m of patternMatches) {
    const cat = m.pattern.category as PatternCategory;
    const color = CATEGORY_COLORS[cat] || '#888';
    marks.push({
      start: m.offset,
      end: m.offset + m.matchedText.length,
      className: 'jp-reading-discourse-hl jp-reading-discourse-hl--heuristic',
      borderColor: color,
      title: `[heuristic] ${m.pattern.surface} — ${m.pattern.gloss} (${CATEGORY_LABELS[cat] || cat})`,
      priority: 1,
    });
  }

  if (marks.length === 0) return;

  const kept = dedupeMarks(marks);
  if (kept.length === 0) return;

  // Wrap from end → start so earlier marks' offsets remain valid.
  // Re-walk per mark (cheap; paragraphs are small) so earlier text-node
  // splits don't invalidate later lookups.
  for (let i = kept.length - 1; i >= 0; i--) {
    applyMark(el, kept[i]);
  }
}

function pushRelationEndpoint(
  marks: Mark[],
  rel: SentenceRelation,
  which: 'source' | 'target',
): void {
  const endpoint = rel[which];
  if (endpoint.end <= endpoint.start) return;
  const role = which === 'source' ? 'src' : 'tgt';
  marks.push({
    start: endpoint.start,
    end: endpoint.end,
    className:
      `jp-reading-discourse-hl jp-reading-discourse-hl--sidecar ` +
      `${rel.colorClass} jp-reading-discourse-hl--${role}`,
    title:
      `[sidecar] ${rel.labelEn || rel.label} (${role}) — ` +
      `conf ${(rel.confidence ?? 0).toFixed(2)}`,
    priority: 2,
  });
}

/**
 * Sort by start asc, priority desc, length desc. Drop marks that overlap any
 * already-kept (higher-priority) mark.
 */
function dedupeMarks(marks: Mark[]): Mark[] {
  marks.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return (b.end - b.start) - (a.end - a.start);
  });
  const kept: Mark[] = [];
  for (const m of marks) {
    let conflict = false;
    for (const k of kept) {
      if (m.start < k.end && m.end > k.start) { conflict = true; break; }
    }
    if (!conflict) kept.push(m);
  }
  kept.sort((a, b) => a.start - b.start);
  return kept;
}

/**
 * Re-walk the element's current text nodes to find the one containing
 * `mark.start`, then split it. Marks crossing a tag boundary (e.g. <strong>)
 * are silently dropped — sidecar spans rarely cross inline tags in Japanese
 * prose, and heuristic matches are short.
 */
function applyMark(el: HTMLElement, mark: Mark): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = (node.textContent || '').length;
    const nodeStart = offset;
    const nodeEnd = offset + len;
    offset = nodeEnd;

    if (mark.start < nodeStart || mark.start >= nodeEnd) continue;
    const localStart = mark.start - nodeStart;
    const localEnd = mark.end - nodeStart;
    if (localEnd > len) return;

    const text = node.textContent || '';
    const before = text.slice(0, localStart);
    const matched = text.slice(localStart, localEnd);
    const after = text.slice(localEnd);
    const parent = node.parentNode;
    if (!parent) return;

    const span = document.createElement('span');
    span.className = mark.className;
    span.textContent = matched;
    if (mark.borderColor) span.style.borderBottomColor = mark.borderColor;
    span.title = mark.title;

    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));
    frag.appendChild(span);
    if (after) frag.appendChild(document.createTextNode(after));
    parent.replaceChild(frag, node);
    return;
  }
}
