/**
 * variation-trees.ts — Stem family variation tree builder
 *
 * From PR#11: Groups related discourse markers into "family trees"
 * based on shared stems, showing how a single grammatical concept
 * branches into register-, formality-, and function-specific variants.
 *
 * Example tree for stem 「わけ」:
 *   わけ (stem)
 *   ├── わけだから     [neutral, cause]
 *   ├── わけですよ     [polite, assertion]
 *   ├── わけなんですよ [polite, emphasis]
 *   ├── わけで         [neutral, result]
 *   ├── わけですけど   [polite, hedge]
 *   ├── わけじゃん     [casual, confirmation]
 *   ├── わけなのよ     [casual, feminine assertion]
 *   └── わけですけれども [formal, hedge]
 *
 * This helps learners see that a single concept (理由・推論 for わけ)
 * manifests across many register/function combinations.
 */

import {
  ALL_PATTERNS,
  PATTERN_BY_ID,
  type DiscoursePatternDef,
  type PatternRegister,
} from './discourse-patterns';

// ── Types ────────────────────────────────────────────────────

export interface VariationNode {
  /** Pattern ID (e.g. "B012") */
  patternId: string;
  surface: string;
  register: PatternRegister;
  pragmaticFunction: string;
  frequencyTier: number;
  /** How this variant extends the stem */
  extension: string;
}

export interface VariationTree {
  /** The shared stem */
  stem: string;
  /** Japanese label for the stem concept */
  conceptLabel: string;
  /** English label for the stem concept */
  conceptLabelEn: string;
  /** All variants sharing this stem */
  variants: VariationNode[];
  /** Total frequency across all variants */
  totalFrequency: number;
}

// ── Pre-defined stem families ────────────────────────────────

/** Manually curated stems with conceptual labels */
const STEM_DEFINITIONS: Array<{
  stem: string;
  concept: string;
  conceptEn: string;
}> = [
  { stem: 'わけ', concept: '推論・理由づけ', conceptEn: 'reasoning/justification' },
  { stem: 'はず', concept: '期待・予測', conceptEn: 'expectation/prediction' },
  { stem: 'もの', concept: '理由・正当化', conceptEn: 'reason/legitimization' },
  { stem: 'んです', concept: '説明的モダリティ', conceptEn: 'explanatory modality' },
  { stem: 'んだ', concept: '説明（普通体）', conceptEn: 'explanation (plain)' },
  { stem: 'そう', concept: '様態・伝聞', conceptEn: 'manner/hearsay' },
  { stem: 'みたい', concept: '類似・推測', conceptEn: 'resemblance/conjecture' },
  { stem: 'らしい', concept: '証拠推測', conceptEn: 'evidence-based conjecture' },
  { stem: 'じゃない', concept: '否定確認', conceptEn: 'negative confirmation' },
  { stem: 'でしょう', concept: '推量確認', conceptEn: 'conjectural confirmation' },
  { stem: 'なんか', concept: '曖昧化', conceptEn: 'vagueness marker' },
  { stem: 'ていう', concept: '引用', conceptEn: 'quotation' },
  { stem: 'って', concept: '口語引用', conceptEn: 'colloquial quotation' },
  { stem: 'という', concept: '引用（中立）', conceptEn: 'quotation (neutral)' },
  { stem: 'だから', concept: '因果帰結', conceptEn: 'causal consequence' },
  { stem: 'けど', concept: '逆接・ヘッジ', conceptEn: 'adversative/hedge' },
  { stem: 'まあ', concept: '緩和', conceptEn: 'softening' },
  { stem: 'やっぱ', concept: '予想確認', conceptEn: 'confirming expectation' },
  { stem: 'そもそも', concept: '根本前提', conceptEn: 'fundamental premise' },
  { stem: 'つまり', concept: '要約・言い換え', conceptEn: 'summary/rephrasing' },
  { stem: 'ところ', concept: '局面・場面', conceptEn: 'phase/scene' },
  { stem: 'ちゃ', concept: '口語完了', conceptEn: 'colloquial completion' },
  { stem: 'ておく', concept: '準備', conceptEn: 'preparation' },
  { stem: 'ている', concept: '進行・結果', conceptEn: 'progressive/resultative' },
  { stem: 'てくる', concept: '接近変化', conceptEn: 'approach/change' },
  { stem: 'ていく', concept: '離反進行', conceptEn: 'departure/progression' },
  { stem: '確か', concept: '譲歩', conceptEn: 'concession' },
  { stem: 'でも', concept: '逆接', conceptEn: 'adversative' },
  { stem: '結局', concept: '結論', conceptEn: 'conclusion' },
  { stem: '実は', concept: '真相吐露', conceptEn: 'revelation' },
];

// ── Build variation trees ────────────────────────────────────

/**
 * Build all variation trees from the pattern database.
 * Also performs auto-discovery of stems not in the manual list.
 */
export function buildVariationTrees(): VariationTree[] {
  const trees: VariationTree[] = [];
  const claimed = new Set<string>(); // pattern IDs already in a tree

  // Phase 1: Manual stems
  for (const def of STEM_DEFINITIONS) {
    const variants: VariationNode[] = [];
    for (const p of ALL_PATTERNS) {
      if (claimed.has(p.id)) continue;
      if (p.surface.includes(def.stem) || p.tokens.some(t => t.includes(def.stem))) {
        variants.push({
          patternId: p.id,
          surface: p.surface,
          register: p.register,
          pragmaticFunction: p.pragmaticFunction,
          frequencyTier: p.frequencyTier,
          extension: p.surface.replace(def.stem, ''),
        });
        claimed.add(p.id);
      }
    }

    if (variants.length > 0) {
      trees.push({
        stem: def.stem,
        conceptLabel: def.concept,
        conceptLabelEn: def.conceptEn,
        variants: variants.sort((a, b) => a.frequencyTier - b.frequencyTier),
        totalFrequency: variants.reduce((s, v) => s + (5 - v.frequencyTier), 0),
      });
    }
  }

  // Phase 2: Auto-discover stems from unclaimed patterns with shared prefixes
  const unclaimed = ALL_PATTERNS.filter(p => !claimed.has(p.id));
  const prefixGroups = new Map<string, DiscoursePatternDef[]>();

  for (const p of unclaimed) {
    // Try 2-3 char prefixes of the surface
    for (let len = 3; len >= 2; len--) {
      if (p.surface.length >= len) {
        const prefix = p.surface.slice(0, len);
        if (!prefixGroups.has(prefix)) prefixGroups.set(prefix, []);
        prefixGroups.get(prefix)!.push(p);
      }
    }
  }

  // Groups with 3+ members become auto-discovered trees
  for (const [prefix, group] of prefixGroups) {
    const unique = [...new Set(group.map(p => p.id))];
    if (unique.length < 3) continue;
    if (unique.some(id => claimed.has(id))) continue;

    const variants: VariationNode[] = [];
    for (const id of unique) {
      const p = PATTERN_BY_ID.get(id)!;
      if (claimed.has(p.id)) continue;
      variants.push({
        patternId: p.id, surface: p.surface,
        register: p.register, pragmaticFunction: p.pragmaticFunction,
        frequencyTier: p.frequencyTier,
        extension: p.surface.slice(prefix.length),
      });
      claimed.add(p.id);
    }

    if (variants.length >= 3) {
      // Derive concept from dominant subcategory
      const subcats = new Map<string, number>();
      for (const v of variants) {
        const p = PATTERN_BY_ID.get(v.patternId);
        if (p) subcats.set(p.subcategory, (subcats.get(p.subcategory) ?? 0) + 1);
      }
      const dominant = [...subcats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '混合';

      trees.push({
        stem: prefix,
        conceptLabel: dominant,
        conceptLabelEn: `auto:${prefix}`,
        variants: variants.sort((a, b) => a.frequencyTier - b.frequencyTier),
        totalFrequency: variants.reduce((s, v) => s + (5 - v.frequencyTier), 0),
      });
    }
  }

  return trees.sort((a, b) => b.totalFrequency - a.totalFrequency);
}

/**
 * Get the variation tree that contains a specific pattern.
 */
export function getTreeForPattern(
  trees: VariationTree[],
  patternId: string,
): VariationTree | undefined {
  return trees.find(t => t.variants.some(v => v.patternId === patternId));
}

/**
 * Get a register progression for a stem — shows how the same concept
 * escalates from casual → formal.
 */
export function getRegisterProgression(tree: VariationTree): VariationNode[] {
  const order: PatternRegister[] = [
    'slang', 'casual', 'neutral', 'polite', 'formal', 'honorific', 'humble', 'academic', 'any',
  ];
  return [...tree.variants].sort(
    (a, b) => order.indexOf(a.register) - order.indexOf(b.register),
  );
}
