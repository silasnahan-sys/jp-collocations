// Hand-written type sidecar for the vendored engine's operator lexicon.

export interface EngineOperator {
  id: string;
  category: string;
  gloss_ja?: string;
  gloss_en?: string;
  cognitive_effect?: string;
  priority?: number;
  triggers?: Array<{ surface: string; scope?: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

export const OPERATORS: EngineOperator[];
export const OP_BY_ID: Map<string, EngineOperator>;
export const OPERATOR_COUNT: number;
export const TRIGGER_COUNT: number;
export const TRIGGER_INDEX: Map<string, unknown>;
