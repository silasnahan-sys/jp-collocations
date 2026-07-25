/**
 * grammar-set-engine.ts — Determines "connected grammar sets" within a discourse chunk.
 *
 * PRINCIPLE: 文脈＝意味 · コンテキストは意味
 *
 * The problem this solves:
 *   "I know all the words, but I don't know the script."
 *
 * A learner might recognize けど, ので, だから individually, but doesn't
 * understand how they form the DISCOURSE SCRIPT — the web of connections
 * that gives the paragraph its meaning and direction.
 *
 * This engine analyzes a chunk of Japanese text and groups the discourse
 * patterns into "GrammarSets" — groups of patterns that work together
 * as a SINGLE IDEA UNIT. Each set represents one "move" in the discourse:
 *
 *   Set 1: [でも … のに]           → concession move
 *   Set 2: [だから … わけで]        → result/reason move
 *   Set 3: [つまり … ということ]     → reformulation move
 *   Set 4: [まあ … けどね]          → softened assertion
 *
 * The SRS card then hides each set independently. The learner reveals
 * them one at a time, learning the "script" — how ideas connect.
 *
 * Grouping rules (priority order):
 *   1. RELATION PAIRS — patterns linked by cross-clause/cross-sentence relations
 *   2. FLOW CHAINS — patterns that form a logical flow (from LOGICAL_FLOWS)
 *   3. CLAUSE CONNECTIVE PAIRS — a connector + what it connects to
 *   4. FUNCTIONAL UNITS — patterns with the same pragmatic function in proximity
 *   5. ORPHAN PATTERNS — anything not grouped gets its own singleton set
 *
 * Each set gets:
 *   - A group label (JP + EN)
 *   - A color (from the dominant category)
 *   - A "reveal order" (sequence for SRS reveal; follows text flow)
 */

import {
  detectPatterns,
  detectLogicalFlows,
  type PatternMatch,
  type LogicalFlowMatch,
} from '../discourse/discourse-grammar';
import {
  analyzeRelations,
  splitClauses,
  type SentenceRelation,
  type ClauseParse,
} from '../discourse/sentence-relations';
import {
  heuristicResolver,
  type RelationsResolver,
} from '../discourse/relations-resolver';
import {
  PATTERN_BY_ID,
  LOGICAL_FLOWS,
  type PatternCategory,
  type PragmaticFunction,
} from '../discourse/discourse-patterns';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../discourse/discourse-grammar';

// ══════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════

export interface GrammarSet {
  /** Unique ID within the chunk */
  id: number;
  /** Human label for this set (JP) */
  label: string;
  /** Human label (EN) */
  labelEn: string;
  /** Why these patterns were grouped */
  groupingReason: 'relation-pair' | 'flow-chain' | 'clause-pair' | 'functional-unit' | 'orphan';
  /** The patterns in this set, ordered by text position */
  patterns: PatternMatch[];
  /** Text spans this set covers — [start, end] character offsets in the full chunk text */
  spans: Array<{ start: number; end: number }>;
  /** The dominant category of this set */
  dominantCategory: PatternCategory;
  /** Color from dominant category */
  color: string;
  /** Reveal order (0-based, follows text position of first pattern) */
  revealOrder: number;
}

export interface ChunkAnalysis {
  /** The original text */
  text: string;
  /** All detected patterns */
  patterns: PatternMatch[];
  /** All detected relations */
  relations: SentenceRelation[];
  /** All detected flows */
  flows: LogicalFlowMatch[];
  /** The grammar sets — the core output */
  grammarSets: GrammarSet[];
  /** Sentences with clause parses */
  sentences: Array<{ text: string; start: number; end: number; clauses: ClauseParse[] }>;
  /** Estimated register */
  register: string;
  /** Total number of sets (for SRS reveal) */
  totalSets: number;
  /** Where the `relations` array came from — 'sidecar' is authoritative,
   *  'heuristic' is unvalidated TS regex fallback. UI MUST surface this. */
  relationSource: 'sidecar' | 'heuristic';
}

// ══════════════════════════════════════════════════════════════
// GROUPING LABELS
// ══════════════════════════════════════════════════════════════

const RELATION_LABELS: Record<string, { jp: string; en: string }> = {
  'cause-effect':         { jp: '原因→結果', en: 'Cause → Effect' },
  'concession-counter':   { jp: '譲歩→反論', en: 'Concession → Counter' },
  'conditional':          { jp: '条件→帰結', en: 'Condition → Result' },
  'temporal-sequence':    { jp: '時間順序', en: 'Temporal Sequence' },
  'purpose':              { jp: '目的→手段', en: 'Purpose → Means' },
  'means':                { jp: '手段→結果', en: 'Means → Result' },
  'contrast':             { jp: '対比', en: 'Contrast' },
  'addition':             { jp: '追加', en: 'Addition' },
  'elaboration':          { jp: '詳述', en: 'Elaboration' },
  'exemplification':      { jp: '例示', en: 'Exemplification' },
  'topic-shift':          { jp: '話題転換', en: 'Topic Shift' },
  'topic-return':         { jp: '話題回帰', en: 'Topic Return' },
  'summary-of':           { jp: '要約', en: 'Summary' },
  'evidence-for':         { jp: '根拠', en: 'Evidence' },
  'counter-to':           { jp: '反証', en: 'Counter-evidence' },
  'hedge-then-assert':    { jp: 'ぼかし→主張', en: 'Hedge → Assert' },
  'question-answer':      { jp: '質問→応答', en: 'Question → Answer' },
  'assertion-agreement':  { jp: '主張→同意', en: 'Assertion → Agreement' },
  'assertion-disagreement': { jp: '主張→反論', en: 'Assertion → Disagreement' },
  'tsukkomi-boke':        { jp: 'ボケ→ツッコミ', en: 'Boke → Tsukkomi' },
  'setup-punchline':      { jp: '前振り→オチ', en: 'Setup → Punchline' },
  'scaffolding':          { jp: '構造標識', en: 'Scaffolding' },
};

const FUNCTION_LABELS: Record<string, { jp: string; en: string }> = {
  'hedge':           { jp: 'ぼかし表現', en: 'Hedging' },
  'softening':       { jp: '和らげ表現', en: 'Softening' },
  'emphasis':        { jp: '強調表現', en: 'Emphasis' },
  'assertion':       { jp: '主張表現', en: 'Assertion' },
  'concession':      { jp: '譲歩表現', en: 'Concession' },
  'contrast':        { jp: '対比表現', en: 'Contrast' },
  'quotation':       { jp: '引用表現', en: 'Quotation' },
  'hearsay':         { jp: '伝聞表現', en: 'Hearsay' },
  'surprise':        { jp: '驚き表現', en: 'Surprise' },
  'backchannel':     { jp: '相槌', en: 'Backchannel' },
  'agreement':       { jp: '同意表現', en: 'Agreement' },
  'disagreement':    { jp: '異議表現', en: 'Disagreement' },
  'self-repair':     { jp: '言い直し', en: 'Self-Repair' },
  'filler':          { jp: 'フィラー', en: 'Filler' },
  'turn-taking':     { jp: '発話権取り', en: 'Turn-Taking' },
};

// ══════════════════════════════════════════════════════════════
// MAIN ENGINE
// ══════════════════════════════════════════════════════════════

// MODULE-LEVEL RESOLVER
// ── same pattern as card-generator: host plugin injects the sidecar-aware
// resolver once at startup; heuristic-only fallback when not injected.
let gseResolver: RelationsResolver = heuristicResolver;
export function setGrammarSetResolver(r: RelationsResolver): void {
  gseResolver = r;
}

/**
 * Analyze a text chunk and produce grammar sets.
 *
 * This is the core function — it determines how patterns group together
 * to form coherent "moves" in the discourse.
 *
 * `ctx.filePath` enables sidecar-authoritative relation lookup when the chunk
 * came from an indexed vault file. Without it, the resolver falls back to
 * the heuristic.
 */
export function analyzeChunkForSets(
  text: string,
  ctx: { filePath?: string } = {},
): ChunkAnalysis {
  // Step 1: Detect everything
  const patterns = detectPatterns(text);
  const { relations, source: relationSource } = gseResolver(text, { filePath: ctx.filePath });
  const flows = detectLogicalFlows(patterns);

  // Step 2: Parse sentences and clauses
  const sentenceTexts = text.split(/(?<=[。！？\n])/g).filter(s => s.trim());
  const sentences: ChunkAnalysis['sentences'] = [];
  let offset = 0;
  for (const st of sentenceTexts) {
    const idx = text.indexOf(st, offset);
    const clauses = splitClauses(st, idx);
    sentences.push({ text: st, start: idx, end: idx + st.length, clauses });
    offset = idx + st.length;
  }

  // Step 3: Build grammar sets
  const sets: GrammarSet[] = [];
  const assigned = new Set<number>(); // Track pattern indices already assigned to a set
  let setId = 0;

  // ── Phase 1: RELATION PAIRS ──────────────────────────────
  // Patterns that are linked by detected cross-clause/cross-sentence relations
  for (const rel of relations) {
    // Find patterns near the source and target spans
    const sourcePatterns = findPatternsInSpan(patterns, rel.source.start, rel.source.end, assigned);
    const targetPatterns = findPatternsInSpan(patterns, rel.target.start, rel.target.end, assigned);

    if (sourcePatterns.length === 0 && targetPatterns.length === 0) continue;

    const combined = [...sourcePatterns, ...targetPatterns]
      .sort((a, b) => a.offset - b.offset);

    if (combined.length === 0) continue;

    // Mark as assigned
    for (const p of combined) {
      assigned.add(patterns.indexOf(p));
    }

    const labels = RELATION_LABELS[rel.type] ?? { jp: rel.label, en: rel.labelEn };
    const domCat = getDominantCategory(combined);

    sets.push({
      id: setId++,
      label: labels.jp,
      labelEn: labels.en,
      groupingReason: 'relation-pair',
      patterns: combined,
      spans: getSpans(combined),
      dominantCategory: domCat,
      color: CATEGORY_COLORS[domCat] ?? '#95a5a6',
      revealOrder: 0, // Will be recalculated
    });
  }

  // ── Phase 2: FLOW CHAINS ─────────────────────────────────
  // Patterns that form a recognized logical flow sequence
  for (const flow of flows) {
    const flowPatterns = flow.matches.filter(m => !assigned.has(patterns.indexOf(m)));
    if (flowPatterns.length < 2) continue;

    for (const p of flowPatterns) {
      assigned.add(patterns.indexOf(p));
    }

    const domCat = getDominantCategory(flowPatterns);
    sets.push({
      id: setId++,
      label: flow.flow.name,
      labelEn: flow.flow.nameEn ?? flow.flow.name,
      groupingReason: 'flow-chain',
      patterns: flowPatterns.sort((a, b) => a.offset - b.offset),
      spans: getSpans(flowPatterns),
      dominantCategory: domCat,
      color: CATEGORY_COLORS[domCat] ?? '#95a5a6',
      revealOrder: 0,
    });
  }

  // ── Phase 3: CLAUSE CONNECTIVE PAIRS ─────────────────────
  // A connector pattern + the pattern it connects to in the adjacent clause
  for (const sentence of sentences) {
    for (let ci = 0; ci < sentence.clauses.length - 1; ci++) {
      const clause = sentence.clauses[ci];
      const nextClause = sentence.clauses[ci + 1];

      // Find the connector pattern at the end of this clause
      const connectorPats = findPatternsInSpan(
        patterns,
        Math.max(clause.start, clause.end - 10), // last 10 chars
        clause.end,
        assigned,
      );

      // Find patterns in the start of the next clause
      const nextPats = findPatternsInSpan(
        patterns,
        nextClause.start,
        Math.min(nextClause.end, nextClause.start + 15), // first 15 chars
        assigned,
      );

      const combined = [...connectorPats, ...nextPats];
      if (combined.length < 2) continue;

      for (const p of combined) {
        assigned.add(patterns.indexOf(p));
      }

      const connType = clause.connectorType ?? 'terminal';
      const labels = CONNECTOR_LABELS[connType] ?? { jp: '節接続', en: 'Clause Connection' };
      const domCat = getDominantCategory(combined);

      sets.push({
        id: setId++,
        label: labels.jp,
        labelEn: labels.en,
        groupingReason: 'clause-pair',
        patterns: combined.sort((a, b) => a.offset - b.offset),
        spans: getSpans(combined),
        dominantCategory: domCat,
        color: CATEGORY_COLORS[domCat] ?? '#95a5a6',
        revealOrder: 0,
      });
    }
  }

  // ── Phase 4: FUNCTIONAL UNITS ────────────────────────────
  // Group remaining patterns by pragmatic function if they're close together
  const unassigned = patterns.filter((_, i) => !assigned.has(i));

  // Group by function + proximity (within 30 chars)
  const funcGroups = new Map<string, PatternMatch[]>();
  for (const p of unassigned) {
    const fn = p.pattern.pragmaticFunction;
    if (!funcGroups.has(fn)) funcGroups.set(fn, []);
    funcGroups.get(fn)!.push(p);
  }

  for (const [fn, pats] of funcGroups) {
    // Sub-group by proximity: patterns within 40 chars of each other
    const sorted = [...pats].sort((a, b) => a.offset - b.offset);
    let group: PatternMatch[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (curr.offset - (prev.offset + prev.matchedText.length) <= 40) {
        group.push(curr);
      } else {
        // Emit this group
        if (group.length >= 2) {
          for (const p of group) assigned.add(patterns.indexOf(p));
          const labels = FUNCTION_LABELS[fn] ?? { jp: fn, en: fn };
          const domCat = getDominantCategory(group);
          sets.push({
            id: setId++,
            label: labels.jp,
            labelEn: labels.en,
            groupingReason: 'functional-unit',
            patterns: group,
            spans: getSpans(group),
            dominantCategory: domCat,
            color: CATEGORY_COLORS[domCat] ?? '#95a5a6',
            revealOrder: 0,
          });
        }
        group = [curr];
      }
    }
    // Emit final group
    if (group.length >= 2) {
      for (const p of group) assigned.add(patterns.indexOf(p));
      const labels = FUNCTION_LABELS[fn] ?? { jp: fn, en: fn };
      const domCat = getDominantCategory(group);
      sets.push({
        id: setId++,
        label: labels.jp,
        labelEn: labels.en,
        groupingReason: 'functional-unit',
        patterns: group,
        spans: getSpans(group),
        dominantCategory: domCat,
        color: CATEGORY_COLORS[domCat] ?? '#95a5a6',
        revealOrder: 0,
      });
    }
  }

  // ── Phase 5: ORPHANS ─────────────────────────────────────
  // Any still-unassigned pattern gets its own singleton set
  const stillUnassigned = patterns.filter((_, i) => !assigned.has(i));
  for (const p of stillUnassigned) {
    const def = PATTERN_BY_ID.get(p.pattern.id);
    const cat = p.pattern.category;
    sets.push({
      id: setId++,
      label: def?.gloss ?? p.matchedText,
      labelEn: def?.glossEn ?? p.matchedText,
      groupingReason: 'orphan',
      patterns: [p],
      spans: [{ start: p.offset, end: p.offset + p.matchedText.length }],
      dominantCategory: cat,
      color: CATEGORY_COLORS[cat] ?? '#95a5a6',
      revealOrder: 0,
    });
  }

  // ── Calculate reveal order ───────────────────────────────
  // Sort by the position of the first pattern in each set (text flow)
  sets.sort((a, b) => {
    const aFirst = Math.min(...a.patterns.map(p => p.offset));
    const bFirst = Math.min(...b.patterns.map(p => p.offset));
    return aFirst - bFirst;
  });
  for (let i = 0; i < sets.length; i++) {
    sets[i].revealOrder = i;
    sets[i].id = i;
  }

  // ── Estimate register ────────────────────────────────────
  const regScores: Record<string, number> = {};
  for (const p of patterns) {
    const r = p.pattern.register;
    regScores[r] = (regScores[r] ?? 0) + 1;
  }
  const register = Object.entries(regScores).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '普通体';

  return {
    text,
    patterns,
    relations,
    flows,
    grammarSets: sets,
    sentences,
    register,
    totalSets: sets.length,
    relationSource,
  };
}

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

/** Find patterns whose offset falls within [start, end), excluding already-assigned ones */
function findPatternsInSpan(
  patterns: PatternMatch[],
  start: number,
  end: number,
  assigned: Set<number>,
): PatternMatch[] {
  return patterns.filter((p, i) => {
    if (assigned.has(i)) return false;
    const pStart = p.offset;
    const pEnd = p.offset + p.matchedText.length;
    // Pattern overlaps with the span
    return pStart < end && pEnd > start;
  });
}

/** Get the dominant category from a list of pattern matches */
function getDominantCategory(patterns: PatternMatch[]): PatternCategory {
  const counts: Record<string, number> = {};
  for (const p of patterns) {
    const c = p.pattern.category;
    counts[c] = (counts[c] ?? 0) + 1;
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'C') as PatternCategory;
}

/** Convert pattern list to non-overlapping spans */
function getSpans(patterns: PatternMatch[]): GrammarSet['spans'] {
  const sorted = [...patterns].sort((a, b) => a.offset - b.offset);
  const spans: GrammarSet['spans'] = [];
  for (const p of sorted) {
    const s = p.offset;
    const e = p.offset + p.matchedText.length;
    // Merge with previous span if overlapping/adjacent
    if (spans.length > 0 && s <= spans[spans.length - 1].end + 1) {
      spans[spans.length - 1].end = Math.max(spans[spans.length - 1].end, e);
    } else {
      spans.push({ start: s, end: e });
    }
  }
  return spans;
}

/** Connector type → label */
const CONNECTOR_LABELS: Record<string, { jp: string; en: string }> = {
  'te-form':   { jp: 'て形接続', en: 'Te-form connection' },
  'ba-form':   { jp: 'ば条件', en: 'Ba-conditional' },
  'tara-form': { jp: 'たら条件', en: 'Tara-conditional' },
  'nara-form': { jp: 'なら仮定', en: 'Nara-hypothetical' },
  'node':      { jp: 'ので理由', en: 'Node-reason' },
  'kara':      { jp: 'から原因', en: 'Kara-cause' },
  'kedo':      { jp: 'けど譲歩', en: 'Kedo-concession' },
  'ga':        { jp: 'が逆接', en: 'Ga-but' },
  'shi':       { jp: 'し並列', en: 'Shi-addition' },
  'noni':      { jp: 'のに不満', en: 'Noni-despite' },
  'tame':      { jp: 'ため目的', en: 'Tame-purpose' },
  'you-ni':    { jp: 'ように目標', en: 'You ni-goal' },
  'nagara':    { jp: 'ながら同時', en: 'Nagara-while' },
  'tsutsu':    { jp: 'つつ進行', en: 'Tsutsu-ongoing' },
  'terminal':  { jp: '文末', en: 'Sentence end' },
};

// ══════════════════════════════════════════════════════════════
// CARD-ORIENTED HELPERS
// ══════════════════════════════════════════════════════════════

/**
 * Build the "reveal map" for a chunk — describes exactly which characters
 * should be hidden in which reveal step.
 *
 * Returns an array of RevealSteps. Each step specifies:
 *   - The text spans to reveal (the grammar patterns themselves)
 *   - The "bridge text" between the previous set and this one (also hidden initially)
 *
 * The idea: the ENTIRE chunk starts hidden. Revealing set 0 shows both
 * the grammar patterns in set 0 AND the non-grammar text surrounding them
 * (up to the start of set 1). Revealing set 1 shows set 1's patterns + bridge.
 *
 * This way, the learner reconstructs the full text idea by idea.
 */
export interface RevealStep {
  /** Which grammar set this step reveals */
  setId: number;
  /** Label for this step */
  label: string;
  labelEn: string;
  /** Color for this step */
  color: string;
  /** Text segments to reveal in this step (ordered by position) */
  segments: Array<{
    start: number;
    end: number;
    /** Whether this segment is a discourse pattern (styled) or bridge text (plain) */
    type: 'pattern' | 'bridge';
    /** Pattern ID if type === 'pattern' */
    patternId?: string;
    /** The actual text */
    text: string;
  }>;
}

/**
 * Build reveal steps for a chunk analysis.
 *
 * Strategy: divide the full text into segments that belong to each reveal step.
 * Each step reveals the grammar set's patterns PLUS the surrounding text
 * that connects this set to the next.
 */
export function buildRevealSteps(analysis: ChunkAnalysis): RevealStep[] {
  const { text, grammarSets } = analysis;

  if (grammarSets.length === 0) {
    // No grammar sets — single step reveals everything
    return [{
      setId: 0,
      label: 'テキスト全体',
      labelEn: 'Full text',
      color: '#95a5a6',
      segments: [{ start: 0, end: text.length, type: 'bridge', text }],
    }];
  }

  // Build a timeline of all pattern spans with their set assignments
  interface TimelineEntry {
    start: number; end: number;
    setId: number;
    patternId?: string;
    isPattern: boolean;
  }

  const timeline: TimelineEntry[] = [];

  for (const set of grammarSets) {
    for (const p of set.patterns) {
      timeline.push({
        start: p.offset,
        end: p.offset + p.matchedText.length,
        setId: set.id,
        patternId: p.pattern.id,
        isPattern: true,
      });
    }
  }

  // Sort by position
  timeline.sort((a, b) => a.start - b.start);

  // Now assign bridge text (non-pattern text) to the nearest set
  // Bridge text before the first set → belongs to set 0
  // Bridge text between set N and set N+1 → belongs to set N+1 (revealed with later set)
  const steps: RevealStep[] = [];
  const setMap = new Map<number, RevealStep>();

  for (const set of grammarSets) {
    const step: RevealStep = {
      setId: set.id,
      label: set.label,
      labelEn: set.labelEn,
      color: set.color,
      segments: [],
    };
    setMap.set(set.id, step);
    steps.push(step);
  }

  // Walk through the text assigning each character range to a step
  let cursor = 0;

  for (let ti = 0; ti < timeline.length; ti++) {
    const entry = timeline[ti];

    // Bridge text before this entry
    if (entry.start > cursor) {
      // Bridge text goes to this entry's set (reveals with the pattern)
      const step = setMap.get(entry.setId);
      if (step) {
        step.segments.push({
          start: cursor,
          end: entry.start,
          type: 'bridge',
          text: text.slice(cursor, entry.start),
        });
      }
    }

    // The pattern itself
    const step = setMap.get(entry.setId);
    if (step) {
      step.segments.push({
        start: entry.start,
        end: entry.end,
        type: 'pattern',
        patternId: entry.patternId,
        text: text.slice(entry.start, entry.end),
      });
    }

    cursor = Math.max(cursor, entry.end);
  }

  // Trailing text after all patterns → belongs to last set
  if (cursor < text.length) {
    const lastStep = steps[steps.length - 1];
    if (lastStep) {
      lastStep.segments.push({
        start: cursor,
        end: text.length,
        type: 'bridge',
        text: text.slice(cursor),
      });
    }
  }

  // Sort each step's segments by position
  for (const step of steps) {
    step.segments.sort((a, b) => a.start - b.start);
  }

  // Redistribute bridge text: if a bridge segment is in the middle of
  // two patterns from DIFFERENT sets, split it — first half to earlier set,
  // second half to later set. This ensures the reveal feels natural.
  // For now, keep it simple: bridge belongs to whichever set's pattern follows it.

  return steps;
}

/**
 * Given a ChunkAnalysis, produce the complete rendering data
 * that the card UI needs: an ordered list of text segments,
 * each tagged with its reveal step.
 */
export interface ChunkRenderSegment {
  /** Character position in original text */
  start: number;
  end: number;
  /** The text content */
  text: string;
  /** Which reveal step this belongs to (index in grammarSets) */
  revealStep: number;
  /** Whether this is a discourse pattern or plain text */
  isPattern: boolean;
  /** Pattern ID if isPattern */
  patternId?: string;
  /** The grammar set's label */
  setLabel?: string;
  setLabelEn?: string;
  /** Color for this segment's set */
  color?: string;
}

/**
 * Flatten a ChunkAnalysis into an ordered list of render segments.
 * Every character in the text is assigned to exactly one reveal step.
 */
export function buildRenderSegments(analysis: ChunkAnalysis): ChunkRenderSegment[] {
  const steps = buildRevealSteps(analysis);
  const segments: ChunkRenderSegment[] = [];

  for (const step of steps) {
    for (const seg of step.segments) {
      segments.push({
        start: seg.start,
        end: seg.end,
        text: seg.text,
        revealStep: step.setId,
        isPattern: seg.type === 'pattern',
        patternId: seg.patternId,
        setLabel: step.label,
        setLabelEn: step.labelEn,
        color: step.color,
      });
    }
  }

  // Sort by position
  segments.sort((a, b) => a.start - b.start);

  // Fill any gaps (text not covered by any step) → assign to nearest previous step
  const filled: ChunkRenderSegment[] = [];
  let cursor = 0;
  for (const seg of segments) {
    if (seg.start > cursor) {
      // Gap — assign to previous step or step 0
      const prevStep = filled.length > 0 ? filled[filled.length - 1].revealStep : 0;
      filled.push({
        start: cursor,
        end: seg.start,
        text: analysis.text.slice(cursor, seg.start),
        revealStep: prevStep,
        isPattern: false,
      });
    }
    filled.push(seg);
    cursor = Math.max(cursor, seg.end);
  }

  // Trailing text
  if (cursor < analysis.text.length) {
    const lastStep = filled.length > 0 ? filled[filled.length - 1].revealStep : 0;
    filled.push({
      start: cursor,
      end: analysis.text.length,
      text: analysis.text.slice(cursor),
      revealStep: lastStep,
      isPattern: false,
    });
  }

  return filled;
}
