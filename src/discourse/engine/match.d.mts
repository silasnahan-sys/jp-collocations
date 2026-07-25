// Hand-written type sidecar for the vendored engine's per-sentence matcher.
// tsc resolves this declaration; esbuild bundles the real .mjs.

export interface EngineHit {
  opId: string;
  opCategory?: string;
  glossJa?: string;
  cognitiveEffect?: string;
  surface?: string;
  offset?: number;
  length?: number;
  scope?: string;
  position?: string;
  priority?: number;
  [k: string]: unknown;
}

export function matchSentence(text: string): { hits: EngineHit[]; backchannel?: unknown };
export function chainTree(hits: EngineHit[]): unknown;
