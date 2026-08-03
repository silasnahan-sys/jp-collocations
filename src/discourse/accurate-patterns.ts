/**
 * accurate-patterns.ts — boundary-aware drop-in for the legacy substring
 * `detectPatterns` (PARSER-AUDIT Phase 2).
 *
 * Runs the vendored engine's per-sentence core (morphological trigger matching
 * + sentence rules + structural bundles/moves) and adapts hits to the existing
 * `PatternMatch` shape, so every pill / highlight / index / card consumer gets
 * accurate hits without changing its own code. The heavy document layers
 * (voicing, FLOW_STATE, narrate) stay behind `engine.ts`.
 *
 * Offsets are relative to the exact string the caller passed (the legacy
 * matcher measured them against a whitespace-stripped copy).
 *
 * Engine operators are also registered into `PATTERN_BY_ID` / `ALL_PATTERNS`
 * at module load, so downstream `PATTERN_BY_ID.get(match.pattern.id)` lookups
 * (cards, views, indexes) resolve engine ids exactly like legacy ids.
 */

import { matchSentence } from './engine/match.mjs';
import type { EngineHit } from './engine/match.mjs';
import { applySentenceRules } from './engine/relations.mjs';
import { structuralAnalysis } from './engine/structure.mjs';
import type { EngineComposite } from './engine/structure.mjs';
import { OP_BY_ID } from './engine/lexicon.mjs';
import {
  PATTERN_BY_ID,
  PATTERNS_BY_SURFACE,
  ALL_PATTERNS,
  CATEGORY_LABELS,
  type DiscoursePatternDef,
  type PatternCategory,
  type PatternPosition,
  type PatternRegister,
  type PragmaticFunction,
} from './discourse-patterns';

/** Matches discourse-grammar's PatternMatch (type-only mirror to avoid a runtime cycle). */
interface AdapterMatch {
  pattern: DiscoursePatternDef;
  offset: number;
  matchedText: string;
}

// ── Engine category → legacy letter category ────────────────

const FULL_CAT: Record<string, PatternCategory> = {
  'topic.introduce': 'A',
  'topic.present-colloquial': 'A',
  'topic.stage-mark': 'A',
  'topic.shift': 'D',
  'discourse.topic-pivot': 'D',
  'meta.segue': 'D',
  'meta.wrap': 'D',
  'meta.summarize': 'D',
  'meta.confirm': 'E',
  'meta.repair': 'E',
  'discourse.filler': 'M',
  'discourse.narrative': 'L',
  'discourse.perspective-stage': 'L',
  'discourse.exam-frame': 'L',
  'discourse.genre-cite': 'G',
  'discourse.deepen-probe': 'E',
  'discourse.parallel': 'C',
  'discourse.bundle': 'N',
  'nominalization.explanatory': 'B',
  'nominalization.explanatory-hedge': 'B',
};

const PREFIX_CAT: Record<string, PatternCategory> = {
  topic: 'D',
  illocution: 'B',
  causal: 'C',
  concessive: 'C',
  conditional: 'C',
  meta: 'C',
  negation: 'C',
  anaphora: 'C',
  quantification: 'C',
  turn: 'E',
  epistemic: 'F',
  modality: 'F',
  deontic: 'F',
  frame: 'F',
  discourse: 'F',
  nominalization: 'F',
  quotative: 'G',
  evidential: 'G',
  aspect: 'H',
  voice: 'I',
  syntax: 'N',
};

function letterOf(engineCategory: string): PatternCategory {
  return FULL_CAT[engineCategory] ?? PREFIX_CAT[engineCategory.split('.')[0]] ?? 'N';
}

// ── Engine category → pragmatic function (feeds register/profile stats) ──

const FULL_FN: Record<string, PragmaticFunction> = {
  'topic.introduce': 'topic-initiation',
  'topic.shift': 'topic-shift',
  'discourse.topic-pivot': 'topic-shift',
  'topic.regarding': 'topic-nomination',
  'illocution.confirm-seek': 'confirmation-seeking',
  'illocution.agree': 'agreement',
  'illocution.strong-agree': 'agreement',
  'illocution.ground': 'explanation',
  'illocution.explanatory-q': 'explanation',
  'illocution.trail-off': 'hedge',
  'illocution.emphatic': 'emphasis',
  'illocution.exclamative': 'emotional',
  'illocution.noun-exclamative': 'emotional',
  'illocution.relief': 'emotional',
  'illocution.soliloquy': 'stance-marking',
  'illocution.understand-check': 'confirmation-seeking',
  'illocution.understand-report': 'agreement',
  'meta.additive': 'addition',
  'meta.infer': 'result',
  'meta.reason-frame': 'explanation',
  'meta.summarize': 'summary',
  'meta.wrap': 'summary',
  'meta.segue': 'topic-shift',
  'meta.confirm': 'confirmation-seeking',
  'meta.repair': 'self-repair',
  'meta.reference': 'shared-knowledge',
  'concessive.contrast': 'contrast',
  'concessive.hedge': 'hedge',
  'evidential.inference': 'evidential',
  'aspect.completive': 'completion',
  'aspect.experiential': 'experience',
  'aspect.experiential-q': 'experience',
  'aspect.now': 'progressive',
  'discourse.filler': 'filler',
  'turn.build-on': 'turn-taking',
  'turn.reject-correction': 'disagreement',
  'discourse.stance': 'stance-marking',
  'discourse.narrative': 'narration',
  'discourse.parallel': 'comparison',
  'discourse.exam-frame': 'explanation',
  'discourse.deepen-probe': 'clarification-request',
  'discourse.perspective-stage': 'scene-setting',
  'discourse.genre-cite': 'quotation',
  'syntax.right-dislocation': 'emphasis',
  'negation.ruleout': 'assertion',
};

const PREFIX_FN: Record<string, PragmaticFunction> = {
  causal: 'cause',
  concessive: 'concession',
  conditional: 'epistemic',
  epistemic: 'epistemic',
  modality: 'epistemic',
  deontic: 'deontic',
  evidential: 'hearsay',
  quotative: 'quotation',
  aspect: 'progressive',
  topic: 'topic-shift',
  illocution: 'assertion',
  turn: 'turn-taking',
  voice: 'politeness',
  frame: 'scene-setting',
  anaphora: 'shared-knowledge',
  quantification: 'emphasis',
  nominalization: 'evaluation',
  syntax: 'elaboration',
  negation: 'assertion',
  meta: 'elaboration',
  discourse: 'stance-marking',
};

function fnOf(engineCategory: string): PragmaticFunction {
  return FULL_FN[engineCategory] ?? PREFIX_FN[engineCategory.split('.')[0]] ?? 'stance-marking';
}

// ── The annotation join (AUDIT-PARTS §1) ───────────────────────────────
//
// The engine LOCATES; `discourse-patterns.ts` ANNOTATES. Phase 2 replaced the
// locator and kept the annotation SHAPE while filling it with constants —
// `register:'any'`, `position:'any'`, `frequencyTier:2`, `coOccurrence:[]` on
// every synthesized def. Since `detectPatternsAccurate` only ever emits defs
// from this map, that made all 515 hand-authored definitions (212 casual /
// 196 neutral / 24 formal) unreachable through the one function that produces
// matches — and every downstream consumer read a constant without erroring:
//
//   estimateRegister({any: N}) → weights.any = 0 → score 0 → ALWAYS '普通体'
//
// so a slangy tweet, an NHK bulletin and a drunk podcast all reported the same
// register, on every SRS card body, every `…/register/…` card tag, every
// context card and every variation tree.
//
// The fix is a join, not a deletion: the 515 defs are the asset. An operator
// inherits the four annotations from the legacy def that shares its trigger
// surface, and the constants survive only as the fallback for engine-only
// operators that no hand-authored def covers.

/** The most-frequent def among candidates — same rule `pickBestPattern` uses
 *  (tier 1 = very common). Several defs can share one surface; the common
 *  reading is the right default when the engine has already decided the op. */
function mostFrequent(defs: DiscoursePatternDef[]): DiscoursePatternDef | null {
  if (!defs.length) return null;
  return defs.reduce((a, b) => (a.frequencyTier <= b.frequencyTier ? a : b));
}

/**
 * The legacy def backing an operator, found through ANY of its trigger
 * surfaces — not just `triggers[0]`. An operator's triggers are written forms
 * of one construction, and the hand-authored catalogue may only carry one.
 *
 * This is the OPERATOR-level default only. Register in particular does not
 * belong to an operator, it belongs to the surface that was actually said:
 * CONCESSIVE-CONTRAST fires on both しかし (formal) and でも (casual), and
 * taking the first trigger reported every でも as formal. `annotate()` below
 * refines per hit; this is what a hit falls back to when its own surface is
 * not in the catalogue.
 */
function legacyDefFor(op: { triggers?: Array<{ surface?: string }> }): DiscoursePatternDef | null {
  for (const t of op.triggers ?? []) {
    const s = t?.surface;
    if (!s) continue;
    const hit = mostFrequent(PATTERNS_BY_SURFACE.get(s) ?? []);
    if (hit) return hit;
  }
  return null;
}

const ENGINE_DEF_BY_OP = new Map<string, DiscoursePatternDef>();

/** How many engine operators found a hand-authored def to inherit from.
 *  Exposed so the health check can report the join rather than assume it. */
let annotated = 0;

for (const op of OP_BY_ID.values()) {
  const cat = letterOf(op.category);
  const surface = op.triggers?.[0]?.surface ?? op.id;
  const legacy = legacyDefFor(op);
  if (legacy) annotated++;
  const def: DiscoursePatternDef = {
    id: op.id,
    surface,
    tokens: [surface],
    // Category, gloss and pragmatic function stay ENGINE-derived: the engine's
    // own taxonomy is what decided this hit, and overriding it with the legacy
    // def's would silently re-label matches the engine made on its own terms.
    // Only the four annotations the engine has no opinion about are inherited.
    category: cat,
    pragmaticFunction: fnOf(op.category),
    categoryLabel: CATEGORY_LABELS[cat],
    subcategory: op.category,
    gloss: op.gloss_ja ?? op.id,
    glossEn: op.gloss_en ?? op.cognitive_effect ?? op.id,
    // ── inherited, with the old constants as the honest fallback ──
    position: (legacy?.position ?? 'any') as PatternPosition,
    register: (legacy?.register ?? 'any') as PatternRegister,
    coOccurrence: legacy?.coOccurrence ?? [],
    frequencyTier: legacy?.frequencyTier ?? 2,
  };
  ENGINE_DEF_BY_OP.set(op.id, def);
  if (!PATTERN_BY_ID.has(op.id)) {
    PATTERN_BY_ID.set(op.id, def);
    ALL_PATTERNS.push(def);
  }
}

/** Operators that inherited a hand-authored annotation, out of the total.
 *  A number, not a boolean: the join is partial by nature (the engine has
 *  operators the catalogue never named) and pretending otherwise is the
 *  failure this fix exists to undo. */
export const ENGINE_ANNOTATED = { annotated, total: ENGINE_DEF_BY_OP.size };

/**
 * Per-HIT annotation. The operator-level def is the default; when the surface
 * this hit actually matched has its own hand-authored def, that one's
 * register / position / tier / co-occurrence win.
 *
 * This is the difference between "しかし and でも are the same operator" (true,
 * and the engine's job) and "しかし and でも are the same register" (false, and
 * the catalogue's job). Memoized per (op, surface) so the hot path allocates
 * one def per distinct pair rather than one per hit.
 */
const annotatedDefs = new Map<string, DiscoursePatternDef>();

function annotate(base: DiscoursePatternDef, surface: string): DiscoursePatternDef {
  const memoKey = `${base.id}|${surface}`;
  const memo = annotatedDefs.get(memoKey);
  if (memo) return memo;
  const legacy = mostFrequent(PATTERNS_BY_SURFACE.get(surface) ?? []);
  const def = legacy
    ? {
        ...base,
        position: legacy.position,
        register: legacy.register,
        coOccurrence: legacy.coOccurrence,
        frequencyTier: legacy.frequencyTier,
      }
    : base;
  annotatedDefs.set(memoKey, def);
  return def;
}

// ── Raw-text sentence splitting (exact offsets, no normalization) ────────

const SENTENCE_END = new Set(['。', '．', '！', '？', '!', '?', '\n', '‼', '⁇', '⁈', '⁉']);
const TRAILING_CLOSE = new Set(['」', '』', '）', ')', '”', '"', '』']);

interface RawSegment {
  start: number;
  text: string;
}

function splitRawSentences(text: string): RawSegment[] {
  const out: RawSegment[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!SENTENCE_END.has(text[i])) continue;
    let end = i + 1;
    while (end < text.length && TRAILING_CLOSE.has(text[end])) end++;
    const seg = text.slice(start, end);
    if (seg.trim()) out.push({ start, text: seg });
    start = end;
    i = end - 1;
  }
  if (start < text.length) {
    const seg = text.slice(start);
    if (seg.trim()) out.push({ start, text: seg });
  }
  return out;
}

// ── Emergent bundle/move promotion (mirrors analyze.mjs) ────────────────

function promoteComposites(hits: EngineHit[], text: string, items: EngineComposite[]): void {
  for (const c of items) {
    const op = OP_BY_ID.get(c.name);
    if (!op) continue;
    hits.push({
      opId: c.name,
      opCategory: op.category,
      glossJa: op.gloss_ja,
      surface: text.slice(c.start, c.end),
      offset: c.start,
      length: c.end - c.start,
      scope: 'composite',
      priority: (op.priority ?? 0) + 10,
    });
  }
}

// ── Detection with a small FIFO cache (hot per-sentence callers) ────────

const cache = new Map<string, AdapterMatch[]>();
const CACHE_MAX = 500;

/**
 * Boundary-aware pattern detection. Same contract as the legacy
 * `detectPatterns`: matches sorted by offset, offsets valid in `text`.
 */
export function detectPatternsAccurate(text: string): AdapterMatch[] {
  if (!text || !text.trim()) return [];
  const cached = cache.get(text);
  if (cached) return cached;

  const out: AdapterMatch[] = [];
  for (const seg of splitRawSentences(text)) {
    let hits: EngineHit[];
    try {
      hits = applySentenceRules(seg.text, matchSentence(seg.text).hits);
      const structure = structuralAnalysis(seg.text, hits);
      promoteComposites(hits, seg.text, structure.bundles);
      promoteComposites(hits, seg.text, structure.moves);
    } catch {
      continue; // the engine must never take down a render path
    }
    for (const h of hits) {
      const def = ENGINE_DEF_BY_OP.get(h.opId);
      const surface = h.surface ?? '';
      if (!def || !surface) continue;
      const offset = typeof h.offset === 'number' && h.offset >= 0 ? seg.start + h.offset : seg.start;
      out.push({ pattern: annotate(def, surface), offset, matchedText: surface });
    }
  }
  out.sort((a, b) => a.offset - b.offset || (b.matchedText.length - a.matchedText.length));

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(text, out);
  return out;
}

/** Number of engine operators registered as pattern defs (health check). */
export const ENGINE_PATTERN_COUNT = ENGINE_DEF_BY_OP.size;
