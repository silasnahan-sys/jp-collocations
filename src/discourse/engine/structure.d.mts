// Hand-written type sidecar for the vendored engine's structural analysis
// (spans / bundles / pivots / discourse-moves).

import type { EngineHit } from './match.mjs';

export interface EngineComposite {
  id: string;
  name: string;
  start: number;
  end: number;
  opIds?: string[];
  members?: string[];
  intent?: string;
  [k: string]: unknown;
}

export function structuralAnalysis(
  text: string,
  hits: EngineHit[],
): { spans: unknown[]; bundles: EngineComposite[]; pivots: unknown[]; moves: EngineComposite[] };
