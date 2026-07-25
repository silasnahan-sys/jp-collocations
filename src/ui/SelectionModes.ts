/**
 * SelectionModes.ts — Dynamic context-based text selection system
 *
 * Multiple ways to SELECT parts of sentences with highly contextual dynamic logic.
 * Designed for "sentence surfing" feel on mobile (iPhone 17 / iPad Mini 7).
 *
 * Selection modes:
 *   1. SENTENCE — tap to select full sentence (。-bounded)
 *   2. CLAUSE  — tap to select clause (connector-bounded: て、けど、から、etc.)
 *   3. PHRASE  — tap to select collocation/phrase around tap point
 *   4. PATTERN — tap to select the nearest discourse pattern
 *   5. BLANK   — tap on a word → auto-create phrase-in-context cloze card
 *
 * Works via a toolbar that floats at the bottom of the editor on mobile.
 */

import { Notice, type Editor } from 'obsidian';
import type { App } from 'obsidian';
import { extractCollocations } from '../srs/collocation-extractor';
import { detectPatterns, type PatternMatch } from '../discourse/discourse-grammar';

export type SelectionMode = 'sentence' | 'clause' | 'phrase' | 'pattern' | 'blank';

interface ModeConfig {
  id: SelectionMode;
  icon: string;
  label: string;
  labelEn: string;
}

export const SELECTION_MODES: ModeConfig[] = [
  { id: 'sentence', icon: '📝', label: '文', labelEn: 'Sentence' },
  { id: 'clause', icon: '🔗', label: '節', labelEn: 'Clause' },
  { id: 'phrase', icon: '🎯', label: '句', labelEn: 'Phrase' },
  { id: 'pattern', icon: '🎭', label: '文法', labelEn: 'Pattern' },
  { id: 'blank', icon: '✏️', label: '穴埋め', labelEn: 'Cloze' },
];

/**
 * Given a cursor position in text, expand the selection based on the active mode.
 * Returns [start, end] offsets in the text.
 */
export function expandSelection(
  text: string,
  cursorOffset: number,
  mode: SelectionMode,
): { start: number; end: number; selected: string } | null {
  switch (mode) {
    case 'sentence':
      return selectSentence(text, cursorOffset);
    case 'clause':
      return selectClause(text, cursorOffset);
    case 'phrase':
      return selectPhrase(text, cursorOffset);
    case 'pattern':
      return selectPattern(text, cursorOffset);
    case 'blank':
      return selectPhrase(text, cursorOffset); // same as phrase, but triggers card
    default:
      return null;
  }
}

function selectSentence(text: string, offset: number): { start: number; end: number; selected: string } | null {
  // Find sentence boundaries (。！？ or newlines)
  const terminators = /[。！？\n]/g;
  let sentStart = 0;
  let sentEnd = text.length;

  // Find start: last terminator before offset
  let m: RegExpExecArray | null;
  terminators.lastIndex = 0;
  while ((m = terminators.exec(text)) !== null) {
    if (m.index >= offset) {
      sentEnd = m.index + 1;
      break;
    }
    sentStart = m.index + 1;
  }

  // If we didn't find end yet, search forward
  if (sentEnd === text.length) {
    const after = text.indexOf('。', offset);
    if (after >= 0) sentEnd = after + 1;
  }

  const selected = text.slice(sentStart, sentEnd).trim();
  if (!selected) return null;
  return { start: sentStart, end: sentEnd, selected };
}

function selectClause(text: string, offset: number): { start: number; end: number; selected: string } | null {
  // Clause connectors that mark boundaries
  const connectors = /(?:て[、,]|で[、,]|けど|けれど|けれども|から|ので|のに|が[、,]|し[、,]|ば[、,]|たら|なら|ために|ように|[。！？\n])/g;

  let clauseStart = 0;
  let clauseEnd = text.length;

  connectors.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = connectors.exec(text)) !== null) {
    const boundEnd = m.index + m[0].length;
    if (boundEnd <= offset) {
      clauseStart = boundEnd;
    } else if (m.index >= offset) {
      clauseEnd = boundEnd;
      break;
    }
  }

  const selected = text.slice(clauseStart, clauseEnd).trim();
  if (!selected) return null;
  return { start: clauseStart, end: clauseEnd, selected };
}

function selectPhrase(text: string, offset: number): { start: number; end: number; selected: string } | null {
  // Find collocations near the cursor
  const collocations = extractCollocations(text);

  // Find the collocation whose span includes the cursor
  let best = collocations.find(c => c.start <= offset && c.end >= offset);

  // If no exact match, find the nearest one within 10 chars
  if (!best) {
    let minDist = Infinity;
    for (const c of collocations) {
      const dist = Math.min(Math.abs(c.start - offset), Math.abs(c.end - offset));
      if (dist < minDist && dist < 10) {
        minDist = dist;
        best = c;
      }
    }
  }

  if (best) {
    return { start: best.start, end: best.end, selected: best.surface };
  }

  // Fallback: select a "word-like" chunk (kanji+kana run)
  const wordRegex = /[\u4e00-\u9faf\u3400-\u4dbf\u3041-\u3096\u30a1-\u30f6ー]+/g;
  let match: RegExpExecArray | null;
  wordRegex.lastIndex = 0;
  while ((match = wordRegex.exec(text)) !== null) {
    if (match.index <= offset && match.index + match[0].length >= offset) {
      return { start: match.index, end: match.index + match[0].length, selected: match[0] };
    }
  }

  return null;
}

function selectPattern(text: string, offset: number): { start: number; end: number; selected: string } | null {
  const patterns = detectPatterns(text);

  // Find pattern spans that include the cursor
  let best: PatternMatch | null = null;
  let minDist = Infinity;

  for (const p of patterns) {
    const pEnd = p.offset + p.matchedText.length;
    if (p.offset <= offset && pEnd >= offset) {
      return { start: p.offset, end: pEnd, selected: p.matchedText };
    }
    const dist = Math.min(Math.abs(p.offset - offset), Math.abs(pEnd - offset));
    if (dist < minDist) {
      minDist = dist;
      best = p;
    }
  }

  // Select nearest pattern within 15 chars
  if (best && minDist < 15) {
    return {
      start: best.offset,
      end: best.offset + best.matchedText.length,
      selected: best.matchedText,
    };
  }

  return null;
}

/**
 * Render the selection mode toolbar into a container.
 * Returns a cleanup function.
 */
export function renderSelectionToolbar(
  container: HTMLElement,
  currentMode: SelectionMode,
  onModeChange: (mode: SelectionMode) => void,
): () => void {
  container.empty();
  container.addClass('jp-sel-toolbar');

  for (const mode of SELECTION_MODES) {
    const btn = container.createEl('button', {
      cls: `jp-sel-mode-btn ${mode.id === currentMode ? 'jp-sel-mode-btn--active' : ''}`,
    });
    btn.createSpan({ text: mode.icon, cls: 'jp-sel-mode-icon' });
    btn.createSpan({ text: mode.label, cls: 'jp-sel-mode-label' });
    btn.title = `${mode.label} (${mode.labelEn})`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onModeChange(mode.id);
    });
  }

  return () => container.empty();
}
