/**
 * CardGenerator.ts — SRS card generation for Obsidian Spaced Repetition plugin
 *
 * Generates TWO types of cards:
 *
 * 1. **Collocation Cards** — standard vocabulary/collocation cards
 *    Front: headword + collocate pattern (with reading hint)
 *    Back: full phrase, examples, definition
 *
 * 2. **Discourse Chunk Cards** ("Script Cards") — the "antidote" to
 *    "you know all the words but you don't know the script"
 *
 *    These use SPOILER TAGS (%%hidden%%) for progressive reveal:
 *    - The card shows the full context chunk
 *    - Each "bit" (discourse unit) is initially hidden
 *    - Bits are revealed one by one, like reading a script
 *    - Discourse markers are color-coded and underlined
 *    - Relations between bits are visually shown
 *    - User self-grades: did they predict the discourse flow?
 *
 * Output format: Obsidian Spaced Repetition plugin compatible
 *   - Uses #flashcards tag
 *   - Multi-line cards with ? separator
 *   - Supports both inline (::) and multi-line (?) formats
 *
 * Bold (**text**) and highlights (==text==) are PRESERVED and ADDABLE
 * by the plugin — these mark key discourse patterns on the cards.
 */

import type { CollocationEntry } from '../types';
import type { DiscourseChunk, DiscourserBit } from './ChunkExtractor';
import { RELATION_LABELS } from './ChunkExtractor';
import { CATEGORY_COLORS } from '../discourse/discourse-grammar';
import type { PatternCategory } from '../discourse/discourse-patterns';

// ── Types ────────────────────────────────────────────────────

export type CardType = 'collocation' | 'discourse-chunk';

export interface SRSCard {
  /** Unique card ID */
  id: string;
  /** Card type */
  type: CardType;
  /** The front of the card (question/prompt) */
  front: string;
  /** The back of the card (answer/reveal) */
  back: string;
  /** Tags for the Spaced Repetition plugin */
  tags: string[];
  /** Source file this card was generated from */
  sourceFile: string;
  /** Difficulty estimate (1-5): higher = more discourse layers to predict */
  difficulty: number;
  /** The raw markdown output for writing to a note */
  markdown: string;
}

export interface CardGeneratorOptions {
  /** Tag used to mark flashcard notes (default: #flashcards) */
  flashcardTag: string;
  /** Include readings on collocation cards */
  showReadings: boolean;
  /** Include English glosses on discourse cards */
  showEnglish: boolean;
  /** Maximum bits to reveal at once on discourse cards */
  maxRevealBits: number;
  /** Use color coding for discourse markers */
  colorCode: boolean;
  /** Folder to write card notes into */
  outputFolder: string;
}

export const DEFAULT_CARD_OPTIONS: CardGeneratorOptions = {
  flashcardTag: '#flashcards',
  showReadings: true,
  showEnglish: false,
  maxRevealBits: 8,
  colorCode: true,
  outputFolder: 'JP SRS Cards',
};

// ── Speaker labels/colors ────────────────────────────────────

const SPEAKER_COLORS = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12'];
const SPEAKER_LABELS = ['🅰', '🅱', '🅲', '🅳'];

// ══════════════════════════════════════════════════════════════
// COLLOCATION CARD GENERATOR
// ══════════════════════════════════════════════════════════════

/**
 * Generate a collocation flashcard.
 *
 * Front: headword pattern with collocate hint
 * Back: full phrase, reading, examples, notes
 */
export function generateCollocationCard(
  entry: CollocationEntry,
  options: CardGeneratorOptions = DEFAULT_CARD_OPTIONS,
): SRSCard {
  const front = buildCollocationFront(entry, options);
  const back = buildCollocationBack(entry, options);

  const tags = [
    options.flashcardTag,
    '#jp-collocation',
    `#pos-${entry.headwordPOS}`,
  ];
  if (entry.tags.length > 0) {
    tags.push(...entry.tags.map(t => `#${t}`));
  }

  const markdown = formatAsSpacedRepetition(front, back, tags);

  return {
    id: `col-${entry.id}`,
    type: 'collocation',
    front,
    back,
    tags,
    sourceFile: '',
    difficulty: 1 + Math.min(4, Math.floor(entry.fullPhrase.length / 8)),
    markdown,
  };
}

function buildCollocationFront(
  entry: CollocationEntry,
  options: CardGeneratorOptions,
): string {
  const lines: string[] = [];

  // Pattern hint
  lines.push(`**${entry.headwordPOS}** ${entry.pattern}`);
  lines.push('');

  // Headword with blank for collocate
  lines.push(`### ${entry.headword} ＋ ＿＿＿＿`);

  if (options.showReadings && entry.headwordReading) {
    lines.push(`<small>${entry.headwordReading}</small>`);
  }

  // Context hint from first example, if available
  if (entry.exampleSentences.length > 0) {
    const example = entry.exampleSentences[0];
    // Mask the collocate in the example
    const masked = example.replace(
      entry.collocate,
      `**【＿＿】**`
    );
    lines.push('');
    lines.push(`> ${masked}`);
  }

  return lines.join('\n');
}

function buildCollocationBack(
  entry: CollocationEntry,
  options: CardGeneratorOptions,
): string {
  const lines: string[] = [];

  lines.push(`### ${entry.fullPhrase}`);
  if (options.showReadings && entry.headwordReading) {
    lines.push(`<small>${entry.headwordReading}</small>`);
  }
  lines.push('');
  lines.push(`**${entry.headword}** ＋ **${entry.collocate}**`);
  lines.push(`パターン: ${entry.pattern}`);

  if (entry.exampleSentences.length > 0) {
    lines.push('');
    lines.push('**例文:**');
    for (const ex of entry.exampleSentences) {
      lines.push(`- ${ex}`);
    }
  }

  if (entry.notes) {
    lines.push('');
    lines.push(`📝 ${entry.notes}`);
  }

  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════
// DISCOURSE CHUNK CARD GENERATOR ("Script Cards")
// ══════════════════════════════════════════════════════════════

/**
 * Generate a discourse chunk flashcard with progressive spoiler reveal.
 *
 * The card presents a conversational chunk where each "bit" (speaker turn /
 * discourse unit) is in a spoiler that gets revealed one at a time.
 *
 * Front: Setup context + first bit visible, rest in spoilers
 * Back: Full chunk with all discourse annotations visible
 *
 * The idea: "you know all the words, but you don't know the script"
 * — so you predict the discourse flow bit by bit, like rehearsing
 * a script you haven't read yet.
 */
export function generateDiscourseChunkCard(
  chunk: DiscourseChunk,
  options: CardGeneratorOptions = DEFAULT_CARD_OPTIONS,
): SRSCard {
  const front = buildChunkFront(chunk, options);
  const back = buildChunkBack(chunk, options);

  const tags = [
    options.flashcardTag,
    '#jp-discourse',
    `#chunk-${chunk.chunkFunction}`,
  ];
  if (chunk.templateMatch) {
    tags.push(`#template-${chunk.templateMatch.replace(/[→・]/g, '-')}`);
  }

  const markdown = formatAsSpacedRepetition(front, back, tags);

  return {
    id: chunk.id,
    type: 'discourse-chunk',
    front,
    back,
    tags,
    sourceFile: chunk.sourceFile,
    difficulty: Math.min(5, Math.ceil(chunk.complexity / 2)),
    markdown,
  };
}

/**
 * Build the FRONT of a discourse chunk card.
 *
 * Shows:
 *   - Chunk metadata (type, speakers, duration)
 *   - First bit fully visible (the "setup")
 *   - Remaining bits in SPOILER TAGS (%%...%%) so they fade in
 *     one at a time when the user clicks each one
 *   - Discourse markers are **bolded** and ==highlighted== with
 *     color via CSS classes
 */
function buildChunkFront(
  chunk: DiscourseChunk,
  options: CardGeneratorOptions,
): string {
  const lines: string[] = [];

  // Header
  lines.push(`#### 🎭 ${chunk.chunkFunctionLabel}`);
  if (chunk.templateMatch) {
    lines.push(`<small>テンプレート: ${chunk.templateMatch} (${Math.round(chunk.templateConfidence * 100)}%)</small>`);
  }
  if (chunk.startTimestamp) {
    lines.push(`<small>⏱ ${chunk.startTimestamp} — ${chunk.endTimestamp} · ${chunk.speakerCount}人</small>`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // First bit is fully visible (the "setup")
  if (chunk.bits.length > 0) {
    lines.push(formatBitVisible(chunk.bits[0], options));
    if (chunk.bits.length > 1) {
      const rel = chunk.bits[0].relationToNext;
      const label = RELATION_LABELS[rel] ?? '→';
      lines.push('');
      lines.push(`<small>${label}</small>`);
    }
  }

  // Remaining bits in spoiler tags — each one is a reveal
  for (let i = 1; i < chunk.bits.length; i++) {
    const bit = chunk.bits[i];
    lines.push('');

    // Spoiler wrapper — the %%...%% syntax hides content in reading mode
    // We use a custom div with class for CSS-powered fade-in
    lines.push(`<div class="jp-srs-spoiler" data-bit="${i}">`);
    lines.push('');
    lines.push(formatBitVisible(bit, options));
    lines.push('');
    lines.push('</div>');

    // Relation arrow to next bit (if not last)
    if (i < chunk.bits.length - 1) {
      const rel = bit.relationToNext;
      const label = RELATION_LABELS[rel] ?? '→';
      lines.push('');
      lines.push(`<small>${label}</small>`);
    }
  }

  return lines.join('\n');
}

/**
 * Build the BACK of a discourse chunk card.
 *
 * Shows everything revealed with full discourse annotations:
 *   - All bits fully visible
 *   - Discourse markers bolded and underlined with category colors
 *   - Relations between bits explicitly labeled
 *   - Template match info
 *   - Register and formality analysis
 */
function buildChunkBack(
  chunk: DiscourseChunk,
  options: CardGeneratorOptions,
): string {
  const lines: string[] = [];

  lines.push(`#### 🎭 ${chunk.chunkFunctionLabel} — 全文解説`);
  lines.push('');

  for (let i = 0; i < chunk.bits.length; i++) {
    const bit = chunk.bits[i];

    lines.push(formatBitAnnotated(bit, options));

    if (i < chunk.bits.length - 1) {
      const rel = bit.relationToNext;
      const label = RELATION_LABELS[rel] ?? '→';
      lines.push(`  ↓ *${label}*`);
    }
    lines.push('');
  }

  // Summary section
  lines.push('---');
  lines.push('');

  if (chunk.templateMatch) {
    lines.push(`**テンプレート:** ${chunk.templateMatch}`);
  }

  // Collect all unique discourse functions
  const functions = [...new Set(chunk.bits.map(b => `${b.functionLabel} (${b.function})`))];
  lines.push(`**談話機能:** ${functions.join(' · ')}`);

  // Collect all unique markers
  const markers = chunk.bits
    .flatMap(b => b.patterns)
    .map(p => `==${p.surface}==`)
    .filter((v, i, a) => a.indexOf(v) === i);
  if (markers.length > 0) {
    lines.push(`**マーカー:** ${markers.join(' ')}`);
  }

  return lines.join('\n');
}

/**
 * Format a bit for visible display (no annotations, just speaker + text + markers highlighted).
 */
function formatBitVisible(bit: DiscourserBit, options: CardGeneratorOptions): string {
  const speaker = SPEAKER_LABELS[bit.speaker % 4];
  let text = bit.text;

  // Bold discourse markers for visibility
  if (options.colorCode && bit.patterns.length > 0) {
    // Sort by offset descending so replacements don't shift positions
    const sorted = [...bit.patterns].sort((a, b) => b.offset - a.offset);
    for (const p of sorted) {
      const before = text.slice(0, p.offset);
      const marker = text.slice(p.offset, p.offset + p.length);
      const after = text.slice(p.offset + p.length);
      // Use == highlights == which the plugin preserves
      text = `${before}==${marker}===${after}`;
    }
  }

  const parts: string[] = [];
  parts.push(`${speaker} ${text}`);

  if (bit.timestamp) {
    parts.push(`<small class="jp-srs-timestamp">${bit.timestamp}</small>`);
  }

  return parts.join(' ');
}

/**
 * Format a bit with full discourse annotations.
 */
function formatBitAnnotated(bit: DiscourserBit, options: CardGeneratorOptions): string {
  const speaker = SPEAKER_LABELS[bit.speaker % 4];
  let text = bit.text;

  // Bold discourse markers
  if (bit.patterns.length > 0) {
    const sorted = [...bit.patterns].sort((a, b) => b.offset - a.offset);
    for (const p of sorted) {
      const before = text.slice(0, p.offset);
      const marker = text.slice(p.offset, p.offset + p.length);
      const after = text.slice(p.offset + p.length);
      text = `${before}**==${marker}==**${after}`;
    }
  }

  const lines: string[] = [];
  lines.push(`${speaker} ${text}`);

  // Annotation line
  const annotations: string[] = [];
  annotations.push(`〔${bit.functionLabel}〕`);
  annotations.push(`[${bit.register}]`);

  if (bit.patterns.length > 0) {
    const markerList = bit.patterns
      .map(p => `${p.surface}(${p.categoryLabel})`)
      .join(', ');
    annotations.push(markerList);
  }

  lines.push(`<small>${annotations.join(' · ')}</small>`);

  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════
// BATCH GENERATION
// ══════════════════════════════════════════════════════════════

/**
 * Generate all collocation cards from an array of entries.
 */
export function generateCollocationCards(
  entries: CollocationEntry[],
  options: CardGeneratorOptions = DEFAULT_CARD_OPTIONS,
): SRSCard[] {
  return entries.map(e => generateCollocationCard(e, options));
}

/**
 * Generate all discourse chunk cards from chunks.
 */
export function generateDiscourseCards(
  chunks: DiscourseChunk[],
  options: CardGeneratorOptions = DEFAULT_CARD_OPTIONS,
): SRSCard[] {
  return chunks.map(c => generateDiscourseChunkCard(c, options));
}

// ══════════════════════════════════════════════════════════════
// FORMATTING — Spaced Repetition plugin format
// ══════════════════════════════════════════════════════════════

/**
 * Format a card as a Spaced Repetition plugin-compatible markdown block.
 *
 * Uses the multi-line card format:
 *   front text
 *   ?
 *   back text
 *
 * With tags at the top of the note.
 */
function formatAsSpacedRepetition(
  front: string,
  back: string,
  tags: string[],
): string {
  const lines: string[] = [];

  // Tags
  lines.push(tags.join(' '));
  lines.push('');

  // Front
  lines.push(front);
  lines.push('');

  // Separator
  lines.push('?');
  lines.push('');

  // Back
  lines.push(back);

  return lines.join('\n');
}

/**
 * Generate a complete flashcard note containing multiple cards.
 * This creates a single note file with all cards separated by ---
 */
export function generateCardNote(
  cards: SRSCard[],
  title: string,
  options: CardGeneratorOptions = DEFAULT_CARD_OPTIONS,
): string {
  const lines: string[] = [];

  // YAML frontmatter
  lines.push('---');
  lines.push(`title: "${title}"`);
  lines.push(`created: ${new Date().toISOString().split('T')[0]}`);
  lines.push(`tags: [${options.flashcardTag.replace('#', '')}]`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${title}`);
  lines.push('');

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];

    // Card header comment
    lines.push(`<!-- Card ${i + 1}: ${card.type} -->`);
    lines.push('');

    // Front
    lines.push(card.front);
    lines.push('');
    lines.push('?');
    lines.push('');
    // Back
    lines.push(card.back);

    // Separator between cards
    if (i < cards.length - 1) {
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n');
}
