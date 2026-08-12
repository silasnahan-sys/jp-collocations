/**
 * rhetorical-constructions.ts — Inventory of slot-and-frame templates
 * that carry intrinsic rhetorical affect (the "aqua" layer).
 *
 * Each construction is a partially-open pattern. Matching one tells L4
 * a lot about footing, stance, evidence_depth and modal compression
 * BEFORE any cue-library regex fires.
 *
 * This module is currently a scaffold — populated with seed entries
 * and a matcher that the pipeline can opt into via the
 * `enableConstructions` flag in pipeline options.
 */

import type { Footing, Stance, EvidenceDepth } from './citation-types';

export type ConstructionFamily =
  | 'citation-shell'           // 〜っていう〜, 〜という形, 〜みたいな
  | 'emergence-manifestation'  // 〜っていうのが出てきます, 〜が起こる
  | 'analogy-parallelism'      // これも似たような原理で, 〜としては〜なり〜
  | 'possibility-inevitability'// 〜ようがない, 〜わけじゃん
  | 'scope-restriction'        // 〜としては, 〜に関しては
  | 'conditional-evaluative';  // 〜だっぱ〜とかも, 〜なら〜だけど

export interface ConstructionAffect {
  stance_bias?: Stance;
  footing_bias?: Footing;
  evidence_depth_bias?: EvidenceDepth;
  de_agentifies: boolean;
  modal_compression: number;   // 0..1: how much the construction forecloses alternatives
}

export interface RhetoricalConstruction {
  id: string;
  family: ConstructionFamily;
  /** Human-readable template; "{X}" marks an open slot. */
  template: string;
  detector: RegExp;
  affect: ConstructionAffect;
}

/** Seed inventory — to be expanded from corpus. */
export const CONSTRUCTION_SEED: RhetoricalConstruction[] = [
  {
    id: 'CTX_emergence_appears_present',
    family: 'emergence-manifestation',
    template: '{X}っていうのが出てきます',
    detector: /っていうのが出てき(?:ます|た|てる)/,
    affect: { de_agentifies: true, modal_compression: 0.3, footing_bias: 'agentless-passive', evidence_depth_bias: 'mythical-anonymous' },
  },
  {
    id: 'CTX_emergence_arises',
    family: 'emergence-manifestation',
    template: 'それに付随して{X}が起こる',
    detector: /それに付随して.{0,20}(?:起こ|生じ|発生)/,
    affect: { de_agentifies: true, modal_compression: 0.4 },
  },
  {
    id: 'CTX_analogy_similar_principle',
    family: 'analogy-parallelism',
    template: 'これも似たような原理で{X}',
    detector: /これも似たような(?:原理|論理|構造|パターン)/,
    affect: { de_agentifies: false, modal_compression: 0.5, stance_bias: 'neutral-report' },
  },
  {
    id: 'CTX_inevitability_no_way',
    family: 'possibility-inevitability',
    template: '{V}ようがない',
    detector: /[\u3041-\u3093\u4e00-\u9fff]ようがな(?:い|く)/,
    affect: { de_agentifies: true, modal_compression: 0.95, stance_bias: 'contest-direct' },
  },
  {
    id: 'CTX_inevitability_wakeja',
    family: 'possibility-inevitability',
    template: '{X}わけじゃん',
    detector: /わけじゃん|わけじゃないですか/,
    affect: { de_agentifies: false, modal_compression: 0.85, stance_bias: 'recruitment-via-mutual-memory' },
  },
  {
    id: 'CTX_scope_toshite_wa',
    family: 'scope-restriction',
    template: '{X}としては',
    detector: /としては(?:[、\s]|$)/,
    affect: { de_agentifies: false, modal_compression: 0.4 },
  },
  {
    id: 'CTX_scope_ni_kanshite',
    family: 'scope-restriction',
    template: '{X}に関しては',
    detector: /に関(?:して|しまして)は/,
    affect: { de_agentifies: false, modal_compression: 0.3 },
  },
  {
    id: 'CTX_citation_shell_to_iu_setsu',
    family: 'citation-shell',
    template: '{X}っていう{言説|話|意見|考え}',
    detector: /っていう(?:言説|話|意見|考え|主張|声|風潮|流れ)/,
    affect: { de_agentifies: true, modal_compression: 0.3, footing_bias: 'meta-discourse-voice', evidence_depth_bias: '1-hop-personal' },
  },
  {
    id: 'CTX_citation_shell_mitai_na',
    family: 'citation-shell',
    template: '{X}みたいな{N}',
    detector: /みたいな(?:[\u4e00-\u9fff\u3041-\u3093]{1,6})/,
    affect: { de_agentifies: true, modal_compression: 0.2, footing_bias: 'common-knowledge' },
  },
  {
    id: 'CTX_conditional_hedge_naradakedo',
    family: 'conditional-evaluative',
    template: '{X}なら{Y}だけど',
    detector: /なら.{0,20}だけど/,
    affect: { de_agentifies: false, modal_compression: 0.55, stance_bias: 'concede-for-rebuttal' },
  },
];

/**
 * Find all constructions matching the sentence. Returns matches in order
 * of appearance with the matched span.
 */
export function detectConstructions(
  sentence: string,
): { id: string; family: ConstructionFamily; charStart: number; charEnd: number; affect: ConstructionAffect }[] {
  const out: { id: string; family: ConstructionFamily; charStart: number; charEnd: number; affect: ConstructionAffect }[] = [];
  for (const ctx of CONSTRUCTION_SEED) {
    const re = new RegExp(ctx.detector.source, ctx.detector.flags.includes('g') ? ctx.detector.flags : ctx.detector.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(sentence)) !== null) {
      out.push({ id: ctx.id, family: ctx.family, charStart: m.index, charEnd: m.index + m[0].length, affect: ctx.affect });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return out.sort((a, b) => a.charStart - b.charStart);
}
