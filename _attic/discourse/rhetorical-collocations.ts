/**
 * rhetorical-collocations.ts — Lexicon of idiomatic referencing units
 * (the "blue" layer). Distinct from CollocationStore (vocabulary).
 *
 * Each entry is a short, evaluatively-loaded chunk that invokes a
 * familiar semantic frame and contributes affective / stance loading
 * to L4 interpretation.
 */

import type { Stance } from './citation-types';

export type SemanticFrame =
  | 'TRAGIC_OUTCOME_with_implied_blame'
  | 'MORAL_CONDEMNATION'
  | 'MORAL_PROBLEMATICITY'
  | 'ENLIGHTENMENT_REFORM_JUSTIFICATION'
  | 'BUREAUCRATIC_DIFFUSION_OF_RESPONSIBILITY'
  | 'INSTITUTIONAL_LEGITIMACY_INVOCATION'
  | 'EPISTEMIC_REFORM'
  | 'COMMON_SENSE_APPEAL'
  | 'POLITICAL_ALIGNMENT_SHIFT'
  | 'COUNTER_FORMATION'
  | 'INEVITABILITY_FRAMING';

export type EvaluativeOrientation =
  | 'positive'
  | 'negative'
  | 'sympathetic'
  | 'critical'
  | 'neutral-evaluative';

export type Register =
  | 'formal'
  | 'colloquial'
  | 'political'
  | 'academic'
  | 'mixed';

export interface RhetoricalCollocation {
  id: string;
  surface: string;
  variants: string[];
  frame: SemanticFrame;
  orientation: EvaluativeOrientation;
  register: Register;
  /** What the speaker presupposes the hearer accepts when using this. */
  presupposes: string[];
  /** Bias to feed into L4 stance inference. */
  stance_bias?: Stance;
}

/** Seed inventory — to be expanded from corpus annotation. */
export const COLLOCATION_SEED: RhetoricalCollocation[] = [
  {
    id: 'CLC_muzan_ni_mo',
    surface: '無残にも',
    variants: ['無残に', '無惨にも'],
    frame: 'TRAGIC_OUTCOME_with_implied_blame',
    orientation: 'sympathetic',
    register: 'mixed',
    presupposes: ['the outcome was avoidable', 'an agent failed in their duty'],
    stance_bias: 'accuse',
  },
  {
    id: 'CLC_doutoku_teki_ni_mazui',
    surface: '道徳的にまずい',
    variants: ['道徳的に問題', '倫理的にまずい'],
    frame: 'MORAL_CONDEMNATION',
    orientation: 'critical',
    register: 'mixed',
    presupposes: ['shared moral baseline'],
    stance_bias: 'accuse',
  },
  {
    id: 'CLC_meishin_daha_no_tame',
    surface: '迷信打破のため',
    variants: ['迷信を打破', '因習打破'],
    frame: 'ENLIGHTENMENT_REFORM_JUSTIFICATION',
    orientation: 'positive',
    register: 'formal',
    presupposes: ['existing beliefs are unfounded', 'reform is justified'],
  },
  {
    id: 'CLC_seido_toka_kankatsu',
    surface: '制度とか管轄',
    variants: ['制度や管轄', '制度・管轄'],
    frame: 'BUREAUCRATIC_DIFFUSION_OF_RESPONSIBILITY',
    orientation: 'critical',
    register: 'colloquial',
    presupposes: ['responsibility is fragmented across institutions'],
  },
  {
    id: 'CLC_seigen_ga_hiki_nikui',
    surface: '制限が引きにくい',
    variants: ['線引きが難しい', '制限を引くのが難しい'],
    frame: 'BUREAUCRATIC_DIFFUSION_OF_RESPONSIBILITY',
    orientation: 'neutral-evaluative',
    register: 'mixed',
    presupposes: ['categorical boundaries are unclear'],
  },
  {
    id: 'CLC_hansei_jira',
    surface: '反成リジラ',
    variants: ['反成形', 'カウンター形成'],
    frame: 'COUNTER_FORMATION',
    orientation: 'neutral-evaluative',
    register: 'colloquial',
    presupposes: ['an opposing movement is being constituted'],
  },
];

/** Find all rhetorical collocations occurring in a sentence. */
export function detectCollocations(
  sentence: string,
): { id: string; surface: string; charStart: number; charEnd: number; collocation: RhetoricalCollocation }[] {
  const out: { id: string; surface: string; charStart: number; charEnd: number; collocation: RhetoricalCollocation }[] = [];
  for (const cl of COLLOCATION_SEED) {
    const surfaces = [cl.surface, ...cl.variants];
    for (const surf of surfaces) {
      let idx = 0;
      while ((idx = sentence.indexOf(surf, idx)) !== -1) {
        out.push({ id: cl.id, surface: surf, charStart: idx, charEnd: idx + surf.length, collocation: cl });
        idx += surf.length;
      }
    }
  }
  return out.sort((a, b) => a.charStart - b.charStart);
}
