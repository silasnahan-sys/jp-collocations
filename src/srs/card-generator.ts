/**
 * card-generator.ts — SRS card generation for Obsidian Spaced Repetition plugin
 *
 * Generates two types of cards:
 *
 * 1. **Discourse Chunk Cards** (スクリプトカード)
 *    Front: Progressive spoiler reveal of discourse chunks
 *    - Each "bit" is in a spoiler (%%hidden%%) that fades in one by one
 *    - Discourse grammar annotations (underlines, color coding) show relationships
 *    - The learner reads like a script, predicting what comes next
 *    Back: Full chunk with all annotations visible + template name + register
 *
 * 2. **Collocation Cards** (コロケーションカード)
 *    Front: Headword + collocate pattern with gap
 *    Back: Full phrase + example sentences + frequency info
 *
 * Output format: Obsidian Spaced Repetition plugin markdown
 *   - Uses `#flashcards` tag or `#flashcards/jp-discourse` etc.
 *   - Front/back separated by `?` (single-line) or `?` + `---` (multi-line)
 *   - Spoiler text via `%%spoiler%%` (Obsidian native) rendered hidden
 *
 * Mobile-first: Cards are readable on iOS with proper font sizing
 * and touch-friendly spoiler interaction.
 */

import type { DiscourseChunk, ChunkBit } from './chunk-extractor';
import type { CollocationEntry } from '../types';
import { detectPatterns, CATEGORY_COLORS, type PatternMatch } from '../discourse/discourse-grammar';
import {
  getCSJFrequency,
  getCSJTier,
  getFillerProfile,
  computeCSJRegisterScore,
  detectSpokenVariations,
} from '../data/csj-spoken-data';
import {
  extractCollocations,
  identifyCollocationInSelection,
  type ExtractedCollocation,
} from './collocation-extractor';
import {
  analyzeRelations,
  splitClauses,
  RELATION_COLORS,
  type SentenceRelation,
} from '../discourse/sentence-relations';
import { PATTERN_BY_ID } from '../discourse/discourse-patterns';
import {
  heuristicResolver,
  type RelationsResolver,
} from '../discourse/relations-resolver';

// ═══════════════════════════════════════════════════════════
// MODULE-LEVEL RESOLVER
// ═══════════════════════════════════════════════════════════
// Card generation runs in many contexts (modal, command, sample dump) and we
// don't want to thread `resolver: RelationsResolver` through six call layers.
// Host plugin calls `setCardGenResolver(makeRelationsResolver(bridge))` once
// at startup; everything inside this module consults the singleton.
let cardGenResolver: RelationsResolver = heuristicResolver;
export function setCardGenResolver(r: RelationsResolver): void {
  cardGenResolver = r;
}

// ── Types ────────────────────────────────────────────────────

export interface SRSCard {
  /** Unique ID */
  id: string;
  /** Card type */
  type: 'discourse-chunk' | 'collocation' | 'context-chunk' | 'phrase-in-context' | 'relation-chunk';
  /** The front of the card as markdown */
  front: string;
  /** The back of the card as markdown */
  back: string;
  /** Tags for the spaced repetition plugin */
  tags: string[];
  /** Source file path (for linking back) */
  sourceFile?: string;
  /** Difficulty estimate 1-5 */
  difficulty: number;
  /** Full markdown as it would be written to a file */
  markdown: string;
  /**
   * For 'context-chunk' cards only:
   * The structured analysis needed for the interactive fade-in reveal UI.
   * This is NOT written to markdown — it's used by CardPreviewModal for live rendering.
   */
  chunkAnalysis?: import('./grammar-set-engine').ChunkAnalysis;
  renderSegments?: import('./grammar-set-engine').ChunkRenderSegment[];
  /**
   * For 'phrase-in-context' cards:
   * The phrase that's blanked out + context around it + auto-detected collocation info.
   */
  phraseData?: PhraseInContextData;
  /**
   * For 'relation-chunk' cards:
   * Sections with inter-bit relation visualization data.
   */
  relationData?: RelationChunkData;
}

/** Card Type 1: phrase blanked in its context chunk */
export interface PhraseInContextData {
  /** The blanked phrase (the answer) */
  phrase: string;
  /** Start offset of phrase in contextText */
  phraseStart: number;
  /** End offset of phrase in contextText */
  phraseEnd: number;
  /** The full context chunk the phrase lives in */
  contextText: string;
  /** Auto-detected collocation info (if any) */
  collocation?: import('./collocation-extractor').ExtractedCollocation;
  /** Hint: the type of collocation pattern */
  hint: string;
}

/** Card Type 2: sectioned chunk with relation visualization */
export interface RelationChunkData {
  /** Sections — each section is one "idea unit" that fades in */
  sections: RelationSection[];
  /** All inter-section relations */
  relations: SectionRelation[];
  /** Full text */
  fullText: string;
  /** Register */
  register: string;
}

export interface RelationSection {
  id: number;
  /** Text of this section */
  text: string;
  start: number;
  end: number;
  /** Grammar bits within this section (sub-spans with discourse annotations) */
  bits: SectionBit[];
  /** Section label */
  label: string;
  labelEn: string;
  /** Color for this section */
  color: string;
}

export interface SectionBit {
  text: string;
  start: number;
  end: number;
  /** Discourse pattern annotation (if any) */
  patternId?: string;
  patternLabel?: string;
  color?: string;
}

export interface SectionRelation {
  /** Source section ID */
  fromSection: number;
  /** Target section ID */
  toSection: number;
  /** Source bit offset within section */
  fromBitStart: number;
  /** Target bit offset within section */
  toBitStart: number;
  /** Relation type */
  type: string;
  /** Display label */
  label: string;
  labelEn: string;
  /** Color for the arrow/line */
  color: string;
}

export interface CardGenerationOptions {
  /** Tag hierarchy for SR plugin (default: 'flashcards/jp') */
  tagPrefix: string;
  /** Include timestamps in cards (default: false) */
  includeTimestamps: boolean;
  /** Include register annotations (default: true) */
  includeRegister: boolean;
  /** Include relation arrows between bits (default: true) */
  includeRelations: boolean;
  /** Max bits per card (default: 6) */
  maxBitsPerCard: number;
  /** Include English glosses (default: true) */
  includeEnglish: boolean;
  /** Speaker labels format */
  speakerFormat: 'letter' | 'number' | 'icon';
}

export const DEFAULT_CARD_OPTIONS: CardGenerationOptions = {
  tagPrefix: 'flashcards/jp',
  includeTimestamps: false,
  includeRegister: true,
  includeRelations: true,
  maxBitsPerCard: 6,
  includeEnglish: true,
  speakerFormat: 'icon',
};

// ── Speaker display ──────────────────────────────────────────

const SPEAKER_ICONS = ['🔵', '🟠', '🟢', '🟣'];
const SPEAKER_LETTERS = ['A', 'B', 'C', 'D'];

function speakerLabel(speaker: number, format: CardGenerationOptions['speakerFormat']): string {
  if (speaker < 0) return '';
  switch (format) {
    case 'icon': return SPEAKER_ICONS[speaker % 4];
    case 'letter': return SPEAKER_LETTERS[speaker % 4];
    case 'number': return `[${speaker + 1}]`;
  }
}

// ── Discourse annotation (underlines + color hints) ──────────

/**
 * Annotate text with discourse grammar markers.
 * Uses Obsidian markdown:
 *   - **bold** for key discourse markers
 *   - <u>underline</u> for logical connectives
 *   - <mark>highlight</mark> for pragmatic functions
 *   - <span style="color:X"> for category color
 */
function annotateBit(bit: ChunkBit, includeRelations: boolean): string {
  let text = bit.text;

  // Sort patterns by offset descending so we can insert markup without shifting offsets
  const sorted = [...bit.patterns].sort((a, b) => b.offset - a.offset);

  for (const p of sorted) {
    const start = p.offset;
    const end = start + p.matchedText.length;

    // Only annotate if within bit text bounds
    if (start >= 0 && end <= text.length) {
      const before = text.slice(0, start);
      const match = text.slice(start, end);
      const after = text.slice(end);

      // Choose annotation style based on category
      const cat = p.pattern.category;
      if (cat === 'C') {
        // Logical connectives → underline
        text = `${before}<u>${match}</u>${after}`;
      } else if (cat === 'E' || cat === 'D') {
        // Interactional/boundary → bold
        text = `${before}**${match}**${after}`;
      } else {
        // Other → subtle highlight
        text = `${before}==${match}==${after}`;
      }
    }
  }

  return text;
}

// ── Card generation: Discourse Chunks ────────────────────────

/**
 * Generate a discourse chunk card.
 *
 * FRONT: Progressive spoiler reveal
 *   Each bit is wrapped in %%spoiler%% tags.
 *   The learner taps/clicks to reveal one bit at a time.
 *   Relation arrows show the connection between bits.
 *
 * BACK: Full annotated text
 *   All bits visible with discourse annotations.
 *   Template name, register, and flow info shown.
 */
function generateChunkCard(
  chunk: DiscourseChunk,
  options: CardGenerationOptions,
): SRSCard {
  const bits = chunk.bits.slice(0, options.maxBitsPerCard);

  // ── FRONT: Progressive spoiler ──
  const frontLines: string[] = [];

  // Context header
  if (chunk.templateMatch) {
    frontLines.push(`> 📝 **${chunk.templateMatch.name}** ${chunk.templateMatch.nameEn}`);
    frontLines.push('');
  }

  if (options.includeRegister) {
    frontLines.push(`> レジスター: ${chunk.register}`);
    frontLines.push('');
  }

  for (let i = 0; i < bits.length; i++) {
    const bit = bits[i];
    const speaker = speakerLabel(bit.speaker, options.speakerFormat);
    const timestamp = options.includeTimestamps && bit.timestamp ? `\`${bit.timestamp}\` ` : '';

    // Each bit in spoiler tags — user reveals progressively
    const annotated = annotateBit(bit, options.includeRelations);
    frontLines.push(`%%${timestamp}${speaker} ${annotated}%%`);

    // Relation arrow between bits (visible, not hidden)
    if (options.includeRelations && bit.relationToNext && i < bits.length - 1) {
      frontLines.push(`<small>${bit.relationToNext}</small>`);
    }
  }

  const front = frontLines.join('\n');

  // ── BACK: Full annotated text ──
  const backLines: string[] = [];

  // Full text with annotations (all visible)
  for (let i = 0; i < bits.length; i++) {
    const bit = bits[i];
    const speaker = speakerLabel(bit.speaker, options.speakerFormat);
    const annotated = annotateBit(bit, options.includeRelations);
    const timestamp = options.includeTimestamps && bit.timestamp ? `\`${bit.timestamp}\` ` : '';

    backLines.push(`${timestamp}${speaker} ${annotated}`);

    if (options.includeRelations && bit.relationToNext && i < bits.length - 1) {
      backLines.push(`<small>${bit.relationToNext}</small>`);
    }
  }

  backLines.push('');
  backLines.push('---');

  // Template info
  if (chunk.templateMatch) {
    backLines.push(`📝 **${chunk.templateMatch.name}** (${chunk.templateMatch.nameEn}) — confidence: ${(chunk.templateMatch.confidence * 100).toFixed(0)}%`);
  }

  // Flows
  if (chunk.flows.length > 0) {
    backLines.push(`🔗 ${chunk.flows.map(f => `${f.name}`).join(' · ')}`);
  }

  // Register + speaker count
  backLines.push(`🎭 ${chunk.register} · ${chunk.speakerCount}人`);

  // Pattern inventory
  const allPatterns = bits.flatMap(b => b.patterns);
  if (allPatterns.length > 0) {
    const patternList = allPatterns
      .slice(0, 8)
      .map(p => `${p.pattern.surface} (${p.pattern.gloss})`)
      .join(' · ');
    backLines.push(`📌 ${patternList}`);
  }

  // CSJ register enrichment
  const fullText = bits.map(b => b.text).join('');
  const surfaces = allPatterns.map(p => p.pattern.surface);
  const csjReg = computeCSJRegisterScore(fullText, surfaces);
  backLines.push(`📊 CSJ: ${csjReg.label} (${csjReg.labelEn}) · ${csjReg.speechType !== 'unknown' ? csjReg.speechType : ''}`);

  // Spoken variations detected
  const { variations } = detectSpokenVariations(fullText);
  if (variations.length > 0) {
    const varList = variations.slice(0, 4).map(v =>
      `${v.standard}→${v.variant} (${v.type})`
    ).join(' · ');
    backLines.push(`💬 話し言葉: ${varList}`);
  }

  if (chunk.sourceFile) {
    backLines.push(`📄 [[${chunk.sourceFile}]]`);
  }

  const back = backLines.join('\n');

  // Difficulty based on pattern count + speaker count
  const difficulty = Math.min(5, Math.max(1,
    Math.ceil(allPatterns.length / 3) + (chunk.speakerCount > 1 ? 1 : 0)
  ));

  // Tags
  const tags = [`${options.tagPrefix}/discourse`];
  if (chunk.templateMatch) {
    tags.push(`${options.tagPrefix}/template/${chunk.templateMatch.name}`);
  }
  if (chunk.register) {
    tags.push(`${options.tagPrefix}/register/${chunk.register}`);
  }

  // Full markdown for SR plugin
  const tagLine = tags.map(t => `#${t}`).join(' ');
  const markdown = `${tagLine}\n${front}\n?\n${back}\n`;

  return {
    id: chunk.id,
    type: 'discourse-chunk',
    front,
    back,
    tags,
    sourceFile: chunk.sourceFile,
    difficulty,
    markdown,
  };
}

// ── Card generation: Collocations ────────────────────────────

/**
 * Generate a collocation card.
 *
 * FRONT: Headword with gap for collocate
 *   「頭」を ______
 *   (Hint: 動詞)
 *
 * BACK: Full phrase + examples + metadata
 */
function generateCollocationCard(
  entry: CollocationEntry,
  options: CardGenerationOptions,
): SRSCard {
  const front = [
    `**${entry.headword}** ${entry.pattern ? `〔${entry.pattern}〕` : ''} ＿＿＿＿`,
    '',
    `> ヒント: ${entry.collocatePOS || entry.headwordPOS}`,
  ].join('\n');

  const backLines = [
    `**${entry.fullPhrase || `${entry.headword} ${entry.collocate}`}**`,
    '',
  ];

  if (entry.headwordReading) {
    backLines.push(`読み: ${entry.headwordReading}`);
  }

  backLines.push(`品詞: ${entry.headwordPOS} + ${entry.collocatePOS}`);

  if (entry.pattern) {
    backLines.push(`型: ${entry.pattern}`);
  }

  if (entry.exampleSentences.length > 0) {
    backLines.push('', '**例文:**');
    for (const s of entry.exampleSentences.slice(0, 3)) {
      backLines.push(`- ${s}`);
    }
  }

  if (entry.notes) {
    backLines.push('', `📝 ${entry.notes}`);
  }

  // TWC-sourced entries show MI scores + corpus info
  if (entry.tags.includes('twc')) {
    backLines.push('', '📊 **筑波ウェブコーパス** (1.1B words)');
  }

  if (entry.tags.length > 0) {
    backLines.push('', entry.tags.map(t => `\`${t}\``).join(' '));
  }

  const back = backLines.join('\n');

  const tags = [
    `${options.tagPrefix}/collocation`,
    `${options.tagPrefix}/pos/${entry.headwordPOS}`,
  ];

  const tagLine = tags.map(t => `#${t}`).join(' ');
  const markdown = `${tagLine}\n${front}\n?\n${back}\n`;

  const difficulty = Math.min(5, Math.max(1,
    entry.frequency > 3 ? 1 : entry.frequency > 1 ? 2 : 3
  ));

  return {
    id: `col-${entry.id}`,
    type: 'collocation',
    front,
    back,
    tags,
    difficulty,
    markdown,
  };
}

// ── Card generation: individual lexicon items from chunks ─────

/**
 * Generate individual pattern cards from bits within a chunk.
 * These go into the lexicon as separate entries for each discourse marker found.
 *
 * Front: Context sentence with the marker in %%spoiler%%
 * Back: Pattern surface + gloss + category + register + variation tips
 */
function generatePatternCards(
  chunk: DiscourseChunk,
  options: CardGenerationOptions,
): SRSCard[] {
  const cards: SRSCard[] = [];

  for (const bit of chunk.bits) {
    for (const p of bit.patterns) {
      const context = bit.text;
      // Replace the matched pattern with a spoiler
      const start = p.offset;
      const end = start + p.matchedText.length;
      if (start >= 0 && end <= context.length) {
        const frontText = context.slice(0, start) +
          '%%' + p.matchedText + '%%' +
          context.slice(end);

        const front = [
          `${speakerLabel(bit.speaker, options.speakerFormat)} ${frontText}`,
          '',
          `> 何が入る？ (${p.pattern.categoryLabel})`,
        ].join('\n');

        const back = [
          `**${p.pattern.surface}** — ${p.pattern.gloss}`,
          '',
          options.includeEnglish ? `${p.pattern.glossEn}` : '',
          `分類: ${p.pattern.category}: ${p.pattern.categoryLabel}`,
          `機能: ${p.pattern.pragmaticFunction}`,
          `レジスター: ${p.pattern.register}`,
          `頻度: Tier ${getCSJTier(p.pattern.surface)}`,
          (() => {
            const csj = getCSJFrequency(p.pattern.surface);
            if (!csj) return '';
            return `CSJ: ${csj.perMillion}/M (APS:${csj.apsFreq} SPS:${csj.spsFreq} ratio:${csj.casualAcademicRatio.toFixed(1)})`;
          })(),
          (() => {
            const filler = getFillerProfile(p.pattern.surface);
            if (!filler) return '';
            return `フィラー: ${filler.position} · ${filler.pragmaticFunction} · ${filler.dominantType}`;
          })(),
          '',
          `文脈: ${context}`,
        ].filter(Boolean).join('\n');

        const tags = [
          `${options.tagPrefix}/pattern`,
          `${options.tagPrefix}/cat/${p.pattern.category}`,
        ];
        const tagLine = tags.map(t => `#${t}`).join(' ');

        cards.push({
          id: `pat-${p.pattern.id}-${chunk.id}`,
          type: 'discourse-chunk',
          front,
          back,
          tags,
          sourceFile: chunk.sourceFile,
          difficulty: Math.min(5, p.pattern.frequencyTier + 1),
          markdown: `${tagLine}\n${front}\n?\n${back}\n`,
        });
      }
    }
  }

  return cards;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Generate all card types from discourse chunks.
 * Returns: discourse chunk cards + individual pattern cards
 */
export function generateCardsFromChunks(
  chunks: DiscourseChunk[],
  options: Partial<CardGenerationOptions> = {},
): SRSCard[] {
  const opts = { ...DEFAULT_CARD_OPTIONS, ...options };
  const cards: SRSCard[] = [];

  for (const chunk of chunks) {
    // Main chunk card (progressive spoiler)
    cards.push(generateChunkCard(chunk, opts));

    // Individual pattern cards from bits
    cards.push(...generatePatternCards(chunk, opts));
  }

  return cards;
}

/**
 * Generate collocation cards from CollocationEntry[].
 */
export function generateCollocationCards(
  entries: CollocationEntry[],
  options: Partial<CardGenerationOptions> = {},
): SRSCard[] {
  const opts = { ...DEFAULT_CARD_OPTIONS, ...options };
  return entries.map(e => generateCollocationCard(e, opts));
}

/**
 * Combine all cards into a single markdown file content
 * suitable for the Spaced Repetition plugin.
 */
export function buildCardFileContent(cards: SRSCard[]): string {
  const lines = [
    '---',
    'tags: [flashcards/jp]',
    '---',
    '',
  ];

  // Group by type
  const discourseCards = cards.filter(c => c.type === 'discourse-chunk');
  const collocationCards = cards.filter(c => c.type === 'collocation');

  if (discourseCards.length > 0) {
    lines.push('## 談話スクリプトカード');
    lines.push('');
    for (const card of discourseCards) {
      lines.push(card.markdown);
      lines.push('');
    }
  }

  if (collocationCards.length > 0) {
    lines.push('## コロケーションカード');
    lines.push('');
    for (const card of collocationCards) {
      lines.push(card.markdown);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Generate a complete flashcard note with YAML frontmatter,
 * title, and cards separated by horizontal rules.
 */
export function generateCardNote(
  cards: SRSCard[],
  title: string,
  options: Partial<CardGenerationOptions> = {},
): string {
  const opts = { ...DEFAULT_CARD_OPTIONS, ...options };
  const lines: string[] = [];

  lines.push('---');
  lines.push(`title: "${title}"`);
  lines.push(`created: ${new Date().toISOString().split('T')[0]}`);
  lines.push(`tags: [${opts.tagPrefix}]`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${title}`);
  lines.push('');

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    lines.push(`<!-- Card ${i + 1}: ${card.type} -->`);
    lines.push('');
    lines.push(card.front);
    lines.push('');
    lines.push('?');
    lines.push('');
    lines.push(card.back);

    if (i < cards.length - 1) {
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════
// CONTEXT-CHUNK CARDS — "I know the words but not the script"
// ══════════════════════════════════════════════════════════════

import {
  analyzeChunkForSets,
  buildRenderSegments,
  type ChunkAnalysis,
  type ChunkRenderSegment,
} from './grammar-set-engine';

/**
 * Generate context-chunk cards from raw text.
 *
 * A context-chunk card:
 *   FRONT: The entire chunk, initially hidden. Grammar sets are revealed
 *          one at a time via fade-in animation. Each set = a connected
 *          group of discourse patterns that form one "idea move."
 *   BACK: Full annotated text with all grammar visible + analysis metadata.
 *
 * The card markdown (for SR plugin export) uses %%spoiler%% tags per set.
 * The interactive UI (CardPreviewModal) uses chunkAnalysis + renderSegments
 * for the live fade-in reveal experience.
 */
export function generateContextChunkCards(
  text: string,
  sourceFile?: string,
  options: Partial<CardGenerationOptions> = {},
): SRSCard[] {
  const opts = { ...DEFAULT_CARD_OPTIONS, ...options };
  const cards: SRSCard[] = [];

  // Split text into discourse chunks first
  const chunks = extractContextChunks(text);

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunkText = chunks[ci];
    const analysis = analyzeChunkForSets(chunkText, { filePath: sourceFile });
    const renderSegs = buildRenderSegments(analysis);

    // ── Build markdown FRONT ──
    // Each grammar set is a spoiler block; bridge text between sets is also spoiled
    const frontLines: string[] = [];
    frontLines.push(`> 📝 文脈チャンク ${ci + 1}/${chunks.length} · ${analysis.totalSets} sets · ${analysis.register}`);
    frontLines.push('');

    for (let si = 0; si < analysis.grammarSets.length; si++) {
      const set = analysis.grammarSets[si];
      const setSegs = renderSegs.filter(s => s.revealStep === si);
      const setText = setSegs.map(s => s.text).join('');
      frontLines.push(`%%【${set.label}】${setText}%%`);
    }
    const front = frontLines.join('\n');

    // ── Build markdown BACK ──
    const backLines: string[] = [];
    backLines.push(chunkText);
    backLines.push('');
    backLines.push('---');
    backLines.push(`📊 ${analysis.grammarSets.length} grammar sets:`);
    for (const set of analysis.grammarSets) {
      const patList = set.patterns.map(p => p.matchedText).join(' · ');
      backLines.push(`  ${set.id + 1}. **${set.label}** (${set.labelEn}) — ${set.groupingReason}`);
      backLines.push(`     ${patList}`);
    }
    if (analysis.relations.length > 0) {
      backLines.push(`🔗 ${analysis.relations.length} relations`);
    }
    if (analysis.flows.length > 0) {
      backLines.push(`🔗 ${analysis.flows.map(f => f.flow.name).join(' · ')}`);
    }
    backLines.push(`🎭 ${analysis.register}`);
    if (sourceFile) backLines.push(`📄 [[${sourceFile}]]`);

    const back = backLines.join('\n');

    const tags = [`${opts.tagPrefix}/context-chunk`];
    if (analysis.register) tags.push(`${opts.tagPrefix}/register/${analysis.register}`);

    const tageLine = tags.map(t => `#${t}`).join(' ');
    const markdown = `${tageLine}\n${front}\n?\n${back}\n`;

    const difficulty = Math.min(5, Math.max(1,
      Math.ceil(analysis.grammarSets.length / 2) + (analysis.relations.length > 3 ? 1 : 0),
    ));

    cards.push({
      id: `ctx-chunk-${ci}-${Date.now()}`,
      type: 'context-chunk',
      front,
      back,
      tags,
      sourceFile,
      difficulty,
      markdown,
      chunkAnalysis: analysis,
      renderSegments: renderSegs,
    });
  }

  return cards;
}

/**
 * Split text into context-appropriate chunks for card generation.
 */
function extractContextChunks(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim());
  const chunks: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= 200) {
      if (para.trim()) chunks.push(para.trim());
      continue;
    }

    const sentences = para.split(/(?<=[。！？])/g).filter(s => s.trim());
    let currentChunk: string[] = [];

    for (const sent of sentences) {
      currentChunk.push(sent);
      const combined = currentChunk.join('');
      const patterns = detectPatterns(sent);
      const hasTopicShift = patterns.some(p =>
        p.pattern.category === 'D' &&
        (p.pattern.pragmaticFunction === 'topic-shift' || p.pattern.pragmaticFunction === 'topic-close')
      );

      if (
        (hasTopicShift && currentChunk.length >= 2) ||
        currentChunk.length >= 4 ||
        combined.length >= 250
      ) {
        chunks.push(combined.trim());
        currentChunk = [];
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('').trim());
    }
  }

  return chunks.filter(c => c.length > 10);
}

// ══════════════════════════════════════════════════════════════
// CARD TYPE 1: PHRASE-BLANK-IN-CONTEXT
// The selected phrase is blanked (＿＿＿) inside its context chunk.
// Auto-detects collocation from the selection.
// ══════════════════════════════════════════════════════════════

/**
 * Generate a phrase-in-context cloze card from a selection + surrounding text.
 *
 * @param selection The user's selected text (the answer)
 * @param fullText  The full paragraph/file text for context extraction
 * @param selectionStart Character offset of selection in fullText
 */
export function generatePhraseInContextCard(
  selection: string,
  fullText: string,
  selectionStart: number,
  sourceFile?: string,
  options: Partial<CardGenerationOptions> = {},
): SRSCard {
  const opts = { ...DEFAULT_CARD_OPTIONS, ...options };

  // Extract context chunk around the selection (±150 chars, but align to sentence boundaries)
  const contextRadius = 150;
  let ctxStart = Math.max(0, selectionStart - contextRadius);
  let ctxEnd = Math.min(fullText.length, selectionStart + selection.length + contextRadius);

  // Snap to sentence boundaries (。！？ or newline)
  const sentEndBefore = fullText.lastIndexOf('。', ctxStart);
  if (sentEndBefore >= 0 && selectionStart - sentEndBefore < contextRadius * 2) {
    ctxStart = sentEndBefore + 1;
  }
  const sentEndAfter = fullText.indexOf('。', ctxEnd);
  if (sentEndAfter >= 0 && sentEndAfter - (selectionStart + selection.length) < contextRadius * 2) {
    ctxEnd = sentEndAfter + 1;
  }

  const rawContext = fullText.slice(ctxStart, ctxEnd);
  const leadingTrimmed = rawContext.length - rawContext.trimStart().length;
  const contextText = rawContext.trim();
  let phraseStart = selectionStart - ctxStart - leadingTrimmed;
  let phraseEnd = phraseStart + selection.length;

  // Clamp to valid range in case of boundary edge cases
  phraseStart = Math.max(0, Math.min(phraseStart, contextText.length));
  phraseEnd = Math.max(phraseStart, Math.min(phraseEnd, contextText.length));

  // Auto-detect collocation
  const before = fullText.slice(Math.max(0, selectionStart - 30), selectionStart);
  const after = fullText.slice(selectionStart + selection.length, selectionStart + selection.length + 30);
  const collocation = identifyCollocationInSelection(selection, before, after);

  const hint = collocation
    ? `${collocation.patternLabel} (${collocation.patternLabelEn})`
    : 'フレーズ';

  // FRONT: context with blank
  const blanked = contextText.slice(0, phraseStart)
    + '【＿＿＿＿＿】'
    + contextText.slice(phraseEnd);

  const frontLines = [blanked, '', `> ヒント: ${hint}`];
  if (collocation && collocation.confidence > 0.7) {
    frontLines.push(`> 型: ${collocation.patternLabel}`);
  }
  const front = frontLines.join('\n');

  // BACK: full context with phrase highlighted + collocation info
  const highlighted = contextText.slice(0, phraseStart)
    + `**${selection}**`
    + contextText.slice(phraseEnd);

  const backLines = [highlighted, '', '---'];
  backLines.push(`答え: **${selection}**`);
  if (collocation) {
    backLines.push(`コロケーション: ${collocation.surface} (${collocation.patternLabel})`);
    backLines.push(`信頼度: ${(collocation.confidence * 100).toFixed(0)}%`);
  }

  // Detect discourse patterns in the context
  const patterns = detectPatterns(contextText);
  if (patterns.length > 0) {
    backLines.push(`📌 ${patterns.slice(0, 5).map(p => `${p.matchedText}(${p.pattern.gloss})`).join(' · ')}`);
  }

  if (sourceFile) backLines.push(`📄 [[${sourceFile}]]`);
  const back = backLines.join('\n');

  const tags = [`${opts.tagPrefix}/phrase-in-context`];
  if (collocation) tags.push(`${opts.tagPrefix}/collocation/${collocation.type}`);

  const tagLine = tags.map(t => `#${t}`).join(' ');
  const markdown = `${tagLine}\n${front}\n?\n${back}\n`;

  return {
    id: `pic-${Date.now()}-${selectionStart}`,
    type: 'phrase-in-context',
    front,
    back,
    tags,
    sourceFile,
    difficulty: collocation ? Math.min(5, Math.max(1, Math.ceil((1 - collocation.confidence) * 5))) : 3,
    markdown,
    phraseData: {
      phrase: selection,
      phraseStart,
      phraseEnd,
      contextText,
      collocation: collocation ?? undefined,
      hint,
    },
  };
}

// ══════════════════════════════════════════════════════════════
// CARD TYPE 2: RELATION CHUNK — sections with visualized relations
// The WHOLE context chunk on ONE card. Sections fade in one by one.
// Within each section, bits have colored relationship lines between them.
// ══════════════════════════════════════════════════════════════

/**
 * Build relation-chunk card data: dynamic sections based on discourse
 * structure, with inter-section and intra-section relations drawn as
 * colored arrows/lines.
 */
export function generateRelationChunkCards(
  text: string,
  sourceFile?: string,
  options: Partial<CardGenerationOptions> = {},
): SRSCard[] {
  const opts = { ...DEFAULT_CARD_OPTIONS, ...options };
  const cards: SRSCard[] = [];
  const chunks = extractContextChunks(text);

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunkText = chunks[ci];
    const card = buildRelationChunkCard(chunkText, ci, chunks.length, sourceFile, opts);
    if (card) cards.push(card);
  }

  return cards;
}

function buildRelationChunkCard(
  chunkText: string,
  chunkIdx: number,
  totalChunks: number,
  sourceFile: string | undefined,
  opts: CardGenerationOptions,
): SRSCard | null {
  // Detect patterns + relations
  const patterns = detectPatterns(chunkText);
  const { relations, source: relSource } = cardGenResolver(chunkText, { filePath: sourceFile });

  // Split into sentences, then group into dynamic sections
  const sentences = chunkText.split(/(?<=[。！？\n])/g).filter(s => s.trim());
  const sections: RelationSection[] = [];
  let secId = 0;
  let offset = 0;

  // Dynamic section boundaries: split when
  //   1. Topic shift detected
  //   2. Speaker change (if transcript)
  //   3. Relation boundary (source → target crosses)
  //   4. Max 2 sentences per section
  let currentSentences: string[] = [];
  let currentStart = 0;

  for (const sent of sentences) {
    const sentStart = chunkText.indexOf(sent, offset);
    if (sentStart < 0) continue; // safety: skip if not found
    offset = sentStart + sent.length;

    currentSentences.push(sent);

    const sentPatterns = detectPatterns(sent);
    const hasTopicShift = sentPatterns.some(p =>
      p.pattern.pragmaticFunction === 'topic-shift' ||
      p.pattern.pragmaticFunction === 'topic-close'
    );

    const shouldSplit = hasTopicShift || currentSentences.length >= 2;

    if (shouldSplit) {
      const sectionText = currentSentences.join('');
      const sectionStart = chunkText.indexOf(sectionText, currentStart);
      if (sectionStart < 0) {
        currentSentences = [];
        continue;
      }

      sections.push(buildSection(
        secId++, sectionText, sectionStart, sectionStart + sectionText.length,
        patterns, chunkText
      ));

      currentStart = sectionStart + sectionText.length;
      currentSentences = [];
    }
  }

  // Remaining sentences
  if (currentSentences.length > 0) {
    const sectionText = currentSentences.join('');
    const sectionStart = chunkText.indexOf(sectionText, currentStart);
    if (sectionStart >= 0) {
      sections.push(buildSection(
        secId++, sectionText, sectionStart,
        sectionStart + sectionText.length, patterns, chunkText
      ));
    }
  }

  if (sections.length === 0) return null;

  // Build cross-section relations
  const sectionRelations: SectionRelation[] = [];
  for (const rel of relations) {
    const fromSec = sections.find(s => rel.source.start >= s.start && rel.source.start < s.end);
    const toSec = sections.find(s => rel.target.start >= s.start && rel.target.start < s.end);
    if (fromSec && toSec) {
      sectionRelations.push({
        fromSection: fromSec.id,
        toSection: toSec.id,
        fromBitStart: rel.source.start - fromSec.start,
        toBitStart: rel.target.start - toSec.start,
        type: rel.type,
        label: rel.label,
        labelEn: rel.labelEn,
        color: rel.colorClass,
      });
    }
  }

  const relationData: RelationChunkData = {
    sections,
    relations: sectionRelations,
    fullText: chunkText,
    register: computeCSJRegisterScore(chunkText, patterns.map(p => p.pattern.surface)).label,
  };

  // FRONT: sections as spoiler blocks
  const frontLines = [`> 🔗 関係チャンク ${chunkIdx + 1}/${totalChunks} · ${sections.length} sections`];
  for (const sec of sections) {
    frontLines.push(`%%【${sec.label}】${sec.text}%%`);
  }
  const front = frontLines.join('\n');

  // BACK: full text + relation summary
  const backLines = [chunkText, '', '---', `📊 ${sections.length} sections · ${sectionRelations.length} relations`];
  for (const rel of sectionRelations) {
    backLines.push(`  ${rel.label} (${rel.labelEn}): §${rel.fromSection + 1} → §${rel.toSection + 1}`);
  }
  if (sourceFile) backLines.push(`📄 [[${sourceFile}]]`);
  const back = backLines.join('\n');

  const tags = [`${opts.tagPrefix}/relation-chunk`];
  const tagLine = tags.map(t => `#${t}`).join(' ');
  const markdown = `${tagLine}\n${front}\n?\n${back}\n`;

  return {
    id: `relchunk-${chunkIdx}-${Date.now()}`,
    type: 'relation-chunk',
    front,
    back,
    tags,
    sourceFile,
    difficulty: Math.min(5, Math.max(1, sections.length + (sectionRelations.length > 2 ? 1 : 0))),
    markdown,
    relationData,
  };
}

/** Build a RelationSection from patterns within a text span */
function buildSection(
  id: number,
  text: string,
  start: number,
  end: number,
  allPatterns: PatternMatch[],
  _fullText: string,
): RelationSection {
  // Find patterns in this section's span
  const sectionPatterns = allPatterns.filter(
    p => p.offset >= start && p.offset + p.matchedText.length <= end
  );

  // Build bits: pattern spans + bridge text between them
  const bits: SectionBit[] = [];
  let cursor = 0;
  const sorted = [...sectionPatterns].sort((a, b) => a.offset - b.offset);

  for (const p of sorted) {
    const pStart = p.offset - start;
    const pEnd = pStart + p.matchedText.length;

    if (pStart > cursor) {
      bits.push({ text: text.slice(cursor, pStart), start: cursor, end: pStart });
    }
    bits.push({
      text: p.matchedText,
      start: pStart,
      end: pEnd,
      patternId: p.pattern.id,
      patternLabel: p.pattern.gloss,
      color: CATEGORY_COLORS[p.pattern.category] ?? '#95a5a6',
    });
    cursor = pEnd;
  }
  if (cursor < text.length) {
    bits.push({ text: text.slice(cursor), start: cursor, end: text.length });
  }

  // Determine section label from dominant pattern
  const domPat = sectionPatterns[0];
  const label = domPat ? (PATTERN_BY_ID.get(domPat.pattern.id)?.gloss ?? text.slice(0, 8) + '…') : text.slice(0, 8) + '…';
  const labelEn = domPat ? (PATTERN_BY_ID.get(domPat.pattern.id)?.glossEn ?? '') : '';
  const color = domPat ? (CATEGORY_COLORS[domPat.pattern.category] ?? '#95a5a6') : '#95a5a6';

  return { id, text, start, end, bits, label, labelEn, color };
}
