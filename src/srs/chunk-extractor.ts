/**
 * chunk-extractor.ts — Discourse chunk extraction for SRS card generation
 *
 * Extracts "chunks" from text (plain or transcript) where each chunk is a
 * coherent unit of discourse — a back-and-forth, a logical sequence, a
 * cooperation template instance. The chunk boundary is determined by how
 * much context is needed for the meaning to be self-contained.
 *
 * Each chunk contains "bits" — individual discourse-grammar-annotated pieces
 * that form the building blocks of the chunk.
 *
 * Design principle: 文脈 ＝ 意味
 *   The chunk length is DYNAMIC — it ends when the discourse unit completes,
 *   not at an arbitrary character/line boundary.
 */

import {
  detectPatterns,
  analyzeUtterance,
  detectLogicalFlows,
  type PatternMatch,
  type UtteranceAnalysis,
  type LogicalFlowMatch,
} from '../discourse/discourse-grammar';
import {
  matchTemplates,
  type TemplateMatch,
  type CooperationTemplate,
} from '../discourse/cooperation-templates';
import {
  isTranscriptFormat,
  processTranscript,
  stripObsidianFormatting,
  type TranscriptTurn,
} from '../discourse/transcript-processor';
import type { PatternCategory } from '../discourse/discourse-patterns';

// ── Types ────────────────────────────────────────────────────

export interface ChunkBit {
  /** The text of this bit */
  text: string;
  /** Speaker ID (for transcript chunks), -1 for non-transcript */
  speaker: number;
  /** Start timestamp if from transcript */
  timestamp?: string;
  /** Discourse patterns detected in this bit */
  patterns: PatternMatch[];
  /** The dominant pragmatic function of this bit */
  dominantFunction: string;
  /** Register of this bit */
  register: string;
  /** Category breakdown */
  categoryBreakdown: Record<string, number>;
  /** Relation to the next bit (connector label) */
  relationToNext: string;
  /** Color for this bit's primary category */
  color: string;
}

export interface DiscourseChunk {
  /** Unique ID for this chunk */
  id: string;
  /** The ordered bits composing this chunk */
  bits: ChunkBit[];
  /** Full clean text of the chunk */
  fullText: string;
  /** The cooperation template this chunk matches (if any) */
  templateMatch?: { name: string; nameEn: string; confidence: number };
  /** Logical flows in this chunk */
  flows: Array<{ name: string; nameEn: string }>;
  /** Number of speakers involved */
  speakerCount: number;
  /** Overall register */
  register: string;
  /** Source file (if known) */
  sourceFile?: string;
  /** Start timestamp (if transcript) */
  startTimestamp?: string;
  /** Why this chunk length was chosen */
  boundaryReason: string;
}

// ── Category colors for bit annotation ───────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  A: '#e74c3c', B: '#3498db', C: '#2ecc71', D: '#f39c12',
  E: '#9b59b6', F: '#1abc9c', G: '#e67e22', H: '#34495e', I: '#fd79a8',
};

// ── Relations between consecutive bits ───────────────────────

function inferRelation(current: PatternMatch[], next: PatternMatch[]): string {
  if (!next.length) return '';
  const nextFirst = next[0].pattern;

  // Map pragmatic functions to relation labels
  const fnMap: Record<string, string> = {
    'concession': '→ 譲歩',
    'contrast': '→ 対比',
    'cause': '→ 原因',
    'result': '→ 結果',
    'addition': '→ 追加',
    'elaboration': '→ 展開',
    'rephrasing': '→ 言い換え',
    'summary': '→ まとめ',
    'agreement': '→ 同意',
    'disagreement': '→ 異議',
    'backchannel': '→ 相槌',
    'confirmation-seeking': '→ 確認',
    'quotation': '→ 引用',
    'hearsay': '→ 伝聞',
    'surprise': '→ 驚き',
    'topic-shift': '→ 話題転換',
    'topic-initiation': '→ 導入',
    'sequence': '→ 順序',
    'hedge': '→ ぼかし',
    'softening': '→ 和らげ',
    'emphasis': '→ 強調',
    'self-repair': '→ 修正',
    'turn-taking': '→ 発話権',
    'filler': '→ つなぎ',
  };

  return fnMap[nextFirst.pragmaticFunction] ?? '→';
}

// ── Chunk extraction from transcript ─────────────────────────

/**
 * Extract discourse chunks from transcript-format text.
 *
 * Algorithm:
 *   1. Process transcript → turns with speaker assignment
 *   2. For each cooperation template match → extract as chunk
 *   3. For remaining turns → group by discourse boundary signals
 *   4. Each group becomes a chunk, bounded by:
 *      - Template completion
 *      - Topic shift markers (category D)
 *      - Speaker change + sentence completion + 3s+ gap
 *      - Max ~6 turns (prevent runaway chunks)
 */
function extractFromTranscript(text: string, sourceFile?: string): DiscourseChunk[] {
  const transcript = processTranscript(text);
  const chunks: DiscourseChunk[] = [];
  const usedTurnIndices = new Set<number>();
  let chunkCounter = 0;

  // Phase 1: Template-based chunks
  // Analyze all turns and look for template matches
  const allTurnTexts = transcript.turns.map(t => t.text);
  const combinedForTemplates = allTurnTexts.join('\n');
  const allPatterns = detectPatterns(combinedForTemplates);
  const templateMatches = matchTemplates(allPatterns);

  for (const tm of templateMatches) {
    if (tm.confidence < 0.5) continue;

    // Find which turns correspond to this template's filled slots
    const slotOffsets = tm.filledSlots
      .filter((s): s is PatternMatch => s !== null)
      .map(s => s.offset);

    if (slotOffsets.length === 0) continue;

    // Map offsets to turn indices
    let accumOffset = 0;
    const turnRanges: Array<{ start: number; end: number; turnIdx: number }> = [];
    for (let i = 0; i < transcript.turns.length; i++) {
      const len = transcript.turns[i].text.length + 1; // +1 for \n
      turnRanges.push({ start: accumOffset, end: accumOffset + len, turnIdx: i });
      accumOffset += len;
    }

    const turnIndices = new Set<number>();
    for (const offset of slotOffsets) {
      for (const range of turnRanges) {
        if (offset >= range.start && offset < range.end) {
          turnIndices.add(range.turnIdx);
          break;
        }
      }
    }

    // Expand to include context turns (1 before, 1 after)
    const indices = [...turnIndices].sort((a, b) => a - b);
    const minIdx = Math.max(0, indices[0] - 1);
    const maxIdx = Math.min(transcript.turns.length - 1, indices[indices.length - 1] + 1);

    const chunkTurns: TranscriptTurn[] = [];
    for (let i = minIdx; i <= maxIdx; i++) {
      chunkTurns.push(transcript.turns[i]);
      usedTurnIndices.add(i);
    }

    const chunk = buildChunkFromTurns(chunkTurns, chunkCounter++, sourceFile);
    chunk.templateMatch = {
      name: tm.template.name,
      nameEn: tm.template.nameEn,
      confidence: tm.confidence,
    };
    chunk.boundaryReason = `テンプレート: ${tm.template.name} (confidence: ${(tm.confidence * 100).toFixed(0)}%)`;
    chunks.push(chunk);
  }

  // Phase 2: Discourse-boundary-based chunks for remaining turns
  let groupStart = -1;
  let currentGroup: TranscriptTurn[] = [];

  for (let i = 0; i < transcript.turns.length; i++) {
    if (usedTurnIndices.has(i)) {
      // Flush current group
      if (currentGroup.length > 0) {
        chunks.push(buildChunkFromTurns(currentGroup, chunkCounter++, sourceFile));
        currentGroup = [];
        groupStart = -1;
      }
      continue;
    }

    const turn = transcript.turns[i];
    const analysis = analyzeUtterance(turn.text);

    if (groupStart === -1) {
      groupStart = i;
      currentGroup = [turn];
      continue;
    }

    // Check boundary conditions
    const hasTopicShift = analysis.patterns.some(
      p => p.pattern.category === 'D' &&
      (p.pattern.pragmaticFunction === 'topic-shift' || p.pattern.pragmaticFunction === 'topic-close')
    );
    const tooLong = currentGroup.length >= 6;
    const prevTurn = currentGroup[currentGroup.length - 1];
    const bigGap = turn.startTime - prevTurn.startTime > 5;

    if (hasTopicShift || tooLong || bigGap) {
      // Flush and start new group
      if (currentGroup.length > 0) {
        const chunk = buildChunkFromTurns(currentGroup, chunkCounter++, sourceFile);
        chunk.boundaryReason = hasTopicShift ? '話題転換マーカー検出'
          : tooLong ? '最大ターン数到達 (6)'
          : '長い間 (>5s)';
        chunks.push(chunk);
      }
      currentGroup = [turn];
      groupStart = i;
    } else {
      currentGroup.push(turn);
    }
  }

  // Flush remaining
  if (currentGroup.length > 0) {
    const chunk = buildChunkFromTurns(currentGroup, chunkCounter++, sourceFile);
    chunk.boundaryReason = 'テキスト終了';
    chunks.push(chunk);
  }

  return chunks;
}

/**
 * Build a DiscourseChunk from a sequence of TranscriptTurns.
 */
function buildChunkFromTurns(
  turns: TranscriptTurn[],
  index: number,
  sourceFile?: string,
): DiscourseChunk {
  const bits: ChunkBit[] = [];

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const cleanText = stripObsidianFormatting(turn.text);
    const analysis = analyzeUtterance(cleanText);
    const nextTurn = i < turns.length - 1 ? turns[i + 1] : null;
    const nextPatterns = nextTurn ? detectPatterns(stripObsidianFormatting(nextTurn.text)) : [];

    const primaryCat = (Object.entries(analysis.categoryBreakdown) as [string, number][])
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'E';

    bits.push({
      text: cleanText,
      speaker: turn.speaker,
      timestamp: turn.startTimestamp,
      patterns: analysis.patterns,
      dominantFunction: analysis.dominantFunctions[0] ?? 'assertion',
      register: analysis.estimatedRegister,
      categoryBreakdown: analysis.categoryBreakdown as Record<string, number>,
      relationToNext: nextTurn ? inferRelation(analysis.patterns, nextPatterns) : '',
      color: CATEGORY_COLORS[primaryCat] ?? '#95a5a6',
    });
  }

  const fullText = turns.map(t => t.text).join('\n');
  const speakers = new Set(turns.map(t => t.speaker));
  const allPatterns = detectPatterns(fullText);
  const flows = detectLogicalFlows(allPatterns);

  // Estimate chunk register
  const regCounts: Record<string, number> = {};
  for (const bit of bits) {
    regCounts[bit.register] = (regCounts[bit.register] ?? 0) + 1;
  }
  const topReg = Object.entries(regCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '普通体';

  return {
    id: `chunk-${index}-${Date.now()}`,
    bits,
    fullText,
    flows: flows.map(f => ({ name: f.flow.name, nameEn: f.flow.nameEn })),
    speakerCount: speakers.size,
    register: topReg,
    sourceFile,
    startTimestamp: turns[0]?.startTimestamp,
    boundaryReason: '',
  };
}

// ── Chunk extraction from plain text ─────────────────────────

/**
 * Extract chunks from non-transcript Japanese text.
 * Uses sentence boundaries + discourse markers to find natural chunks.
 */
function extractFromPlainText(text: string, sourceFile?: string): DiscourseChunk[] {
  // Split into sentences
  const sentences = text.split(/(?<=[。！？\n])/g).filter(s => s.trim());
  const chunks: DiscourseChunk[] = [];
  let chunkCounter = 0;
  let currentGroup: string[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i].trim();
    if (!s) continue;

    currentGroup.push(s);

    // Check if we should end the chunk
    const combined = currentGroup.join('');
    const patterns = detectPatterns(s);
    const hasTopicShift = patterns.some(
      p => p.pattern.category === 'D' &&
      p.pattern.pragmaticFunction === 'topic-shift'
    );
    const hasEnoughContext = currentGroup.length >= 2;
    const tooLong = currentGroup.length >= 4;

    if ((hasTopicShift && hasEnoughContext) || tooLong) {
      const fullText = currentGroup.join('');
      const analysis = analyzeUtterance(fullText);
      const bits = currentGroup.map((text, idx) => {
        const a = analyzeUtterance(text);
        const nextPats = idx < currentGroup.length - 1
          ? detectPatterns(currentGroup[idx + 1]) : [];
        const primaryCat = (Object.entries(a.categoryBreakdown) as [string, number][])
          .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'C';
        return {
          text,
          speaker: -1,
          patterns: a.patterns,
          dominantFunction: a.dominantFunctions[0] ?? 'assertion',
          register: a.estimatedRegister,
          categoryBreakdown: a.categoryBreakdown as Record<string, number>,
          relationToNext: inferRelation(a.patterns, nextPats),
          color: CATEGORY_COLORS[primaryCat] ?? '#95a5a6',
        } as ChunkBit;
      });

      const flows = detectLogicalFlows(analysis.patterns);
      chunks.push({
        id: `chunk-${chunkCounter++}-${Date.now()}`,
        bits,
        fullText,
        flows: flows.map(f => ({ name: f.flow.name, nameEn: f.flow.nameEn })),
        speakerCount: 1,
        register: analysis.estimatedRegister,
        sourceFile,
        boundaryReason: hasTopicShift ? '話題転換' : '文数上限',
      });
      currentGroup = [];
    }
  }

  // Flush remaining
  if (currentGroup.length > 0) {
    const fullText = currentGroup.join('');
    const analysis = analyzeUtterance(fullText);
    const bits = currentGroup.map((text, idx) => {
      const a = analyzeUtterance(text);
      const nextPats = idx < currentGroup.length - 1
        ? detectPatterns(currentGroup[idx + 1]) : [];
      const primaryCat = (Object.entries(a.categoryBreakdown) as [string, number][])
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'C';
      return {
        text,
        speaker: -1,
        patterns: a.patterns,
        dominantFunction: a.dominantFunctions[0] ?? 'assertion',
        register: a.estimatedRegister,
        categoryBreakdown: a.categoryBreakdown as Record<string, number>,
        relationToNext: inferRelation(a.patterns, nextPats),
        color: CATEGORY_COLORS[primaryCat] ?? '#95a5a6',
      } as ChunkBit;
    });

    const flows = detectLogicalFlows(analysis.patterns);
    chunks.push({
      id: `chunk-${chunkCounter++}-${Date.now()}`,
      bits,
      fullText,
      flows: flows.map(f => ({ name: f.flow.name, nameEn: f.flow.nameEn })),
      speakerCount: 1,
      register: analysis.estimatedRegister,
      sourceFile,
      boundaryReason: 'テキスト終了',
    });
  }

  return chunks;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Extract discourse chunks from any text.
 * Auto-detects transcript format and routes accordingly.
 */
export function extractChunks(text: string, sourceFile?: string): DiscourseChunk[] {
  if (isTranscriptFormat(text)) {
    return extractFromTranscript(text, sourceFile);
  }
  return extractFromPlainText(text, sourceFile);
}

/**
 * Extract chunks from a specific text selection.
 * Smaller, more focused than full-file extraction.
 */
export function extractChunksFromSelection(
  selectedText: string,
  sourceFile?: string,
): DiscourseChunk[] {
  return extractChunks(selectedText, sourceFile);
}

// ── Relation & function label constants (re-exported for UI) ─

export const RELATION_LABELS: Record<string, string> = {
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

export const FUNCTION_LABELS: Record<string, string> = {
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

export const CHUNK_FUNCTION_LABELS: Record<string, string> = {
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
