/**
 * ChunkExtractor.ts — Dynamic discourse chunk extraction
 *
 * "You know all the words, but you don't know the script."
 * This module extracts coherent discourse "chunks" from transcripts
 * where the chunk length is determined by HOW MUCH CONTEXT IS NEEDED
 * TO UNDERSTAND THE INTERACTION — making it highly dynamic.
 *
 * A "chunk" = a coherent back-and-forth between speakers that forms
 * a complete discourse unit (argument, Q&A, narrative arc, etc.)
 *
 * Each chunk contains multiple "bits" — discourse-grammar-defined
 * segments (turns annotated with their pragmatic function, register,
 * and relation to surrounding bits).
 *
 * The extraction uses cooperation templates + discourse boundaries
 * to find natural chunk boundaries, then annotates each bit with:
 *   - speaker identity
 *   - discourse function (concession, rebuttal, backchannel, etc.)
 *   - relation to previous/next bit (→反論, →共感, →展開, etc.)
 *   - any detected discourse markers with their categories
 */

import type { PatternMatch, UtteranceAnalysis } from '../discourse/discourse-grammar';
import { analyzeUtterance, detectPatterns, CATEGORY_LABELS, CATEGORY_COLORS } from '../discourse/discourse-grammar';
import { processTranscript, isTranscriptFormat, formatTimestamp, type TranscriptTurn, type TranscriptAnalysis } from '../discourse/transcript-processor';
import { matchTemplates, type TemplateMatch } from '../discourse/cooperation-templates';
import type { PatternCategory } from '../discourse/discourse-patterns';

// ── Types ────────────────────────────────────────────────────

export interface DiscourserBit {
  /** Index within the chunk */
  index: number;
  /** Speaker ID (0-based) */
  speaker: number;
  /** The clean text of this bit */
  text: string;
  /** Timestamp string (from transcript) */
  timestamp: string;
  /** Discourse function of this bit */
  function: string;
  /** Japanese label for the function */
  functionLabel: string;
  /** Relation to the NEXT bit (what this bit sets up) */
  relationToNext: string;
  /** Detected discourse patterns within this bit */
  patterns: Array<{
    surface: string;
    category: PatternCategory;
    categoryLabel: string;
    color: string;
    /** Character offset within this bit's text */
    offset: number;
    length: number;
  }>;
  /** Register of this specific bit */
  register: string;
}

export interface DiscourseChunk {
  /** Unique ID for this chunk */
  id: string;
  /** The ordered bits that make up this chunk */
  bits: DiscourserBit[];
  /** What cooperation template this chunk matches (if any) */
  templateMatch: string | null;
  /** Template confidence */
  templateConfidence: number;
  /** Overall discourse function of the entire chunk */
  chunkFunction: string;
  /** Japanese label for chunk function */
  chunkFunctionLabel: string;
  /** Start timestamp */
  startTimestamp: string;
  /** End timestamp */
  endTimestamp: string;
  /** Duration in seconds */
  durationSeconds: number;
  /** Number of speakers involved */
  speakerCount: number;
  /** Source file (vault-relative path) */
  sourceFile: string;
  /** The full clean text of the chunk (all bits joined) */
  fullText: string;
  /** Complexity score: how many discourse layers are active */
  complexity: number;
}

// ── Function label mapping ───────────────────────────────────

const FUNCTION_LABELS: Record<string, string> = {
  'topic-initiation': '話題提起',
  'topic-shift': '話題転換',
  'topic-return': '話題復帰',
  'topic-close': '話題終了',
  'sequence': '順序付け',
  'filler': 'フィラー',
  'attention': '注意喚起',
  'concession': '譲歩',
  'contrast': '対比',
  'cause': '原因',
  'result': '結果',
  'addition': '追加',
  'elaboration': '展開',
  'rephrasing': '言い換え',
  'summary': '要約',
  'hedge': 'ヘッジ',
  'softening': '緩和',
  'emphasis': '強調',
  'assertion': '主張',
  'confirmation-seeking': '確認要求',
  'agreement': '同意',
  'disagreement': '反対',
  'information-source': '情報源',
  'evidential': '証拠',
  'hearsay': '伝聞',
  'quotation': '引用',
  'desire': '願望',
  'obligation': '義務',
  'epistemic': '認知的',
  'surprise': '驚き',
  'regret': '残念',
  'backchannel': '相槌',
  'turn-taking': 'ターン取得',
  'turn-yielding': 'ターン譲渡',
  'emotional': '感情',
  'self-repair': '自己修正',
  'other-repair': '他者修正',
};

const RELATION_LABELS: Record<string, string> = {
  'setup→response': '提示→反応',
  'question→answer': '質問→回答',
  'claim→support': '主張→根拠',
  'concession→rebuttal': '譲歩→反論',
  'statement→backchannel': '発話→相槌',
  'quotation→reaction': '引用→反応',
  'explanation→understanding': '説明→理解',
  'topic→elaboration': '話題→展開',
  'evidence→conclusion': '証拠→結論',
  'repair→continuation': '修正→続行',
  'neutral': '→',
};

// ── Chunk Function Labels ────────────────────────────────────

const CHUNK_FUNCTION_LABELS: Record<string, string> = {
  'argument': '議論展開',
  'information-exchange': '情報交換',
  'narrative': '語り・物語',
  'negotiation': '交渉',
  'empathy-building': '共感構築',
  'topic-management': '話題管理',
  'clarification': '確認・明確化',
  'evaluation': '評価',
  'unknown': '不明',
};

// ── Core extraction ──────────────────────────────────────────

/**
 * Extract discourse chunks from transcript text.
 *
 * Dynamic length: each chunk includes exactly the number of turns
 * needed to form a coherent discourse unit. The algorithm:
 *   1. Parse transcript into speaker turns
 *   2. Run discourse analysis on each turn
 *   3. Find chunk boundaries using:
 *      - Cooperation template matches
 *      - Topic shift markers (category D)
 *      - Natural conversation arc completion
 *   4. Annotate each bit with function and relations
 */
export function extractChunks(
  rawText: string,
  sourceFile: string = '',
  options: { maxChunkTurns?: number; minChunkTurns?: number } = {},
): DiscourseChunk[] {
  const { maxChunkTurns = 12, minChunkTurns = 2 } = options;

  if (!isTranscriptFormat(rawText)) return [];

  const transcript = processTranscript(rawText);
  if (transcript.turns.length < minChunkTurns) return [];

  // Analyze each turn
  const turnAnalyses = transcript.turns.map(turn => ({
    turn,
    analysis: analyzeUtterance(turn.text),
  }));

  // Find chunk boundaries
  const boundaries = findChunkBoundaries(turnAnalyses, maxChunkTurns, minChunkTurns);

  // Build chunks from boundaries
  const chunks: DiscourseChunk[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    const chunkTurns = turnAnalyses.slice(start, end);

    if (chunkTurns.length < minChunkTurns) continue;

    const chunk = buildChunk(chunkTurns, sourceFile, chunks.length);
    if (chunk) chunks.push(chunk);
  }

  return chunks;
}

/**
 * Find natural chunk boundary positions (indices into turnAnalyses array).
 */
function findChunkBoundaries(
  turnAnalyses: Array<{ turn: TranscriptTurn; analysis: UtteranceAnalysis }>,
  maxTurns: number,
  minTurns: number,
): number[] {
  const n = turnAnalyses.length;
  if (n === 0) return [0];

  const boundaries: number[] = [0]; // Always start at 0
  let lastBound = 0;

  for (let i = 1; i < n; i++) {
    const turnsSinceLastBound = i - lastBound;
    const ta = turnAnalyses[i];

    let isBoundary = false;

    // Hard boundary: topic shift / boundary markers
    const hasTopicShift = ta.analysis.patterns.some(
      p => p.pattern.category === 'D' ||
           p.pattern.pragmaticFunction === 'topic-shift' ||
           p.pattern.pragmaticFunction === 'topic-initiation'
    );

    // Soft boundary signals
    const prevTA = turnAnalyses[i - 1];
    const prevEndedWithSummary = prevTA.analysis.patterns.some(
      p => p.pattern.pragmaticFunction === 'summary' ||
           p.pattern.pragmaticFunction === 'topic-close'
    );

    // New question after a completed exchange
    const startsQuestion = ta.analysis.patterns.some(
      p => p.pattern.pragmaticFunction === 'confirmation-seeking'
    );

    // Long time gap between turns (>5 sec)
    const timeGap = ta.turn.startTime - prevTA.turn.endTime;
    const hasLongGap = timeGap > 5;

    // Apply boundary logic
    if (turnsSinceLastBound >= maxTurns) {
      // Force boundary at max
      isBoundary = true;
    } else if (turnsSinceLastBound >= minTurns) {
      // Allow boundary if there's a signal
      if (hasTopicShift) isBoundary = true;
      if (prevEndedWithSummary && hasTopicShift) isBoundary = true;
      if (prevEndedWithSummary && startsQuestion) isBoundary = true;
      if (hasLongGap && turnsSinceLastBound >= 3) isBoundary = true;
    }

    // Check for cooperation template completion
    if (turnsSinceLastBound >= minTurns && turnsSinceLastBound <= maxTurns) {
      const recentPatterns = turnAnalyses
        .slice(lastBound, i)
        .flatMap(ta2 => ta2.analysis.patterns);
      const templateMatches = matchTemplates(recentPatterns);
      if (templateMatches.length > 0 && templateMatches[0].confidence >= 0.7) {
        // Template completed — good boundary if next turn starts something new
        if (hasTopicShift || startsQuestion || hasLongGap) {
          isBoundary = true;
        }
      }
    }

    if (isBoundary) {
      boundaries.push(i);
      lastBound = i;
    }
  }

  // Always include end
  if (boundaries[boundaries.length - 1] !== n) {
    boundaries.push(n);
  }

  return boundaries;
}

/**
 * Build a DiscourseChunk from a sequence of analyzed turns.
 */
function buildChunk(
  turnAnalyses: Array<{ turn: TranscriptTurn; analysis: UtteranceAnalysis }>,
  sourceFile: string,
  chunkIndex: number,
): DiscourseChunk | null {
  if (turnAnalyses.length === 0) return null;

  const bits: DiscourserBit[] = [];

  for (let i = 0; i < turnAnalyses.length; i++) {
    const { turn, analysis } = turnAnalyses[i];
    const nextTA = i < turnAnalyses.length - 1 ? turnAnalyses[i + 1] : null;

    // Determine this bit's primary function
    const primaryFunction = analysis.dominantFunctions[0] ?? 'assertion';

    // Determine relation to next bit
    const relation = nextTA
      ? inferRelation(analysis, nextTA.analysis, turn.speaker, nextTA.turn.speaker)
      : 'neutral';

    // Extract pattern annotations
    const patternAnnotations = analysis.patterns.map(p => ({
      surface: p.pattern.surface,
      category: p.pattern.category,
      categoryLabel: CATEGORY_LABELS[p.pattern.category] ?? p.pattern.category,
      color: CATEGORY_COLORS[p.pattern.category] ?? '#95a5a6',
      offset: p.offset,
      length: p.matchedText.length,
    }));

    bits.push({
      index: i,
      speaker: turn.speaker,
      text: turn.text,
      timestamp: turn.startTimestamp,
      function: primaryFunction,
      functionLabel: FUNCTION_LABELS[primaryFunction] ?? primaryFunction,
      relationToNext: relation,
      patterns: patternAnnotations,
      register: analysis.estimatedRegister,
    });
  }

  // Match cooperation templates for the whole chunk
  const allPatterns = turnAnalyses.flatMap(ta => ta.analysis.patterns);
  const templateMatches = matchTemplates(allPatterns);
  const bestTemplate = templateMatches.length > 0 ? templateMatches[0] : null;

  // Determine chunk-level function
  const chunkFunction = classifyChunkFunction(bits, bestTemplate);

  // Compute complexity
  const uniqueCategories = new Set(allPatterns.map(p => p.pattern.category)).size;
  const uniqueFunctions = new Set(allPatterns.map(p => p.pattern.pragmaticFunction)).size;
  const speakerChanges = bits.filter((b, i) => i > 0 && b.speaker !== bits[i - 1].speaker).length;
  const complexity = Math.min(10, uniqueCategories + uniqueFunctions * 0.5 + speakerChanges);

  const firstTurn = turnAnalyses[0].turn;
  const lastTurn = turnAnalyses[turnAnalyses.length - 1].turn;

  return {
    id: `chunk-${sourceFile.replace(/[^a-zA-Z0-9]/g, '_')}-${chunkIndex}`,
    bits,
    templateMatch: bestTemplate?.template.name ?? null,
    templateConfidence: bestTemplate?.confidence ?? 0,
    chunkFunction,
    chunkFunctionLabel: CHUNK_FUNCTION_LABELS[chunkFunction] ?? chunkFunction,
    startTimestamp: firstTurn.startTimestamp,
    endTimestamp: lastTurn.startTimestamp,
    durationSeconds: lastTurn.endTime - firstTurn.startTime,
    speakerCount: new Set(bits.map(b => b.speaker)).size,
    sourceFile,
    fullText: bits.map(b => b.text).join('\n'),
    complexity,
  };
}

/**
 * Infer the discourse relation between two consecutive bits.
 */
function inferRelation(
  current: UtteranceAnalysis,
  next: UtteranceAnalysis,
  currentSpeaker: number,
  nextSpeaker: number,
): string {
  const curFn = current.dominantFunctions[0] ?? '';
  const nextFn = next.dominantFunctions[0] ?? '';
  const sameSpeaker = currentSpeaker === nextSpeaker;

  // Question → Answer
  if (curFn === 'confirmation-seeking' && !sameSpeaker) return 'question→answer';

  // Statement → Backchannel
  if ((curFn === 'assertion' || curFn === 'emphasis') && nextFn === 'backchannel' && !sameSpeaker) {
    return 'statement→backchannel';
  }

  // Concession → Rebuttal
  if (curFn === 'concession' && (nextFn === 'contrast' || nextFn === 'disagreement')) {
    return 'concession→rebuttal';
  }

  // Claim → Support
  if (curFn === 'assertion' && (nextFn === 'cause' || nextFn === 'evidential') && sameSpeaker) {
    return 'claim→support';
  }

  // Quotation → Reaction
  if (curFn === 'quotation' && (nextFn === 'surprise' || nextFn === 'emotional') && !sameSpeaker) {
    return 'quotation→reaction';
  }

  // Explanation → Understanding
  if ((curFn === 'elaboration' || curFn === 'cause') && nextFn === 'agreement' && !sameSpeaker) {
    return 'explanation→understanding';
  }

  // Topic → Elaboration (same speaker continues)
  if (curFn === 'topic-initiation' && sameSpeaker) return 'topic→elaboration';

  // Evidence → Conclusion
  if (curFn === 'evidential' && (nextFn === 'summary' || nextFn === 'result')) {
    return 'evidence→conclusion';
  }

  // Self-repair
  if (curFn === 'self-repair') return 'repair→continuation';

  // Setup → Response (generic cross-speaker)
  if (!sameSpeaker) return 'setup→response';

  return 'neutral';
}

/**
 * Classify the overall function of a chunk.
 */
function classifyChunkFunction(
  bits: DiscourserBit[],
  templateMatch: TemplateMatch | null,
): string {
  if (templateMatch) {
    const tName = templateMatch.template.nameEn.toLowerCase();
    if (tName.includes('concession') || tName.includes('rebuttal')) return 'argument';
    if (tName.includes('question') || tName.includes('information')) return 'information-exchange';
    if (tName.includes('quotation') || tName.includes('punchline')) return 'narrative';
    if (tName.includes('empathy')) return 'empathy-building';
    if (tName.includes('repair')) return 'clarification';
    if (tName.includes('topic')) return 'topic-management';
    if (tName.includes('stepwise')) return 'information-exchange';
  }

  // Heuristic: look at dominant functions
  const fnCounts: Record<string, number> = {};
  for (const bit of bits) {
    fnCounts[bit.function] = (fnCounts[bit.function] ?? 0) + 1;
  }

  const topFn = Object.entries(fnCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  if (['concession', 'contrast', 'disagreement'].includes(topFn)) return 'argument';
  if (['confirmation-seeking', 'assertion'].includes(topFn)) return 'information-exchange';
  if (['quotation', 'surprise'].includes(topFn)) return 'narrative';
  if (['agreement', 'backchannel', 'emotional'].includes(topFn)) return 'empathy-building';
  if (['summary', 'result'].includes(topFn)) return 'evaluation';

  return 'information-exchange';
}

/**
 * Extract chunks from a selection of text (may or may not be transcript format).
 * For non-transcript text, creates a single chunk with sentence-level bits.
 */
export function extractChunksFromSelection(
  text: string,
  sourceFile: string = '',
): DiscourseChunk[] {
  if (isTranscriptFormat(text)) {
    return extractChunks(text, sourceFile);
  }

  // For plain text, split into sentences and create a single chunk
  const analysis = analyzeUtterance(text);
  if (analysis.patterns.length === 0) return [];

  // Create a single chunk with all sentences as bits
  const sentences = text.split(/(?<=[。！？!?])\s*/g).filter(s => s.trim());
  if (sentences.length === 0) return [];

  const bits: DiscourserBit[] = sentences.map((sent, i) => {
    const sentAnalysis = analyzeUtterance(sent);
    return {
      index: i,
      speaker: 0,
      text: sent,
      timestamp: '',
      function: sentAnalysis.dominantFunctions[0] ?? 'assertion',
      functionLabel: FUNCTION_LABELS[sentAnalysis.dominantFunctions[0] ?? 'assertion'] ?? '',
      relationToNext: i < sentences.length - 1 ? 'neutral' : 'neutral',
      patterns: sentAnalysis.patterns.map(p => ({
        surface: p.pattern.surface,
        category: p.pattern.category,
        categoryLabel: CATEGORY_LABELS[p.pattern.category] ?? p.pattern.category,
        color: CATEGORY_COLORS[p.pattern.category] ?? '#95a5a6',
        offset: p.offset,
        length: p.matchedText.length,
      })),
      register: sentAnalysis.estimatedRegister,
    };
  });

  const allPatterns = analysis.patterns;
  const templateMatches = matchTemplates(allPatterns);

  return [{
    id: `chunk-selection-0`,
    bits,
    templateMatch: templateMatches[0]?.template.name ?? null,
    templateConfidence: templateMatches[0]?.confidence ?? 0,
    chunkFunction: 'information-exchange',
    chunkFunctionLabel: '情報交換',
    startTimestamp: '',
    endTimestamp: '',
    durationSeconds: 0,
    speakerCount: 1,
    sourceFile,
    fullText: text,
    complexity: Math.min(10, new Set(allPatterns.map(p => p.pattern.category)).size * 2),
  }];
}

// Re-export relation labels for UI
export { RELATION_LABELS, FUNCTION_LABELS, CHUNK_FUNCTION_LABELS };
