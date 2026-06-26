// Hand-written type sidecar for the vendored discourse engine (analyze.mjs).
// The engine is plain JS (ported from the _tmp_pipeline reference, 196 tests
// passing); tsc resolves this declaration while esbuild bundles the real .mjs.
// Kept intentionally loose — the typed surface the plugin relies on lives in
// ../engine.ts (the wrapper), which narrows what it needs.

export interface RawDiscourseHit {
  opId: string;
  opCategory?: string;
  glossJa?: string;
  cognitiveEffect?: string;
  surface?: string;
  offset?: number;
  length?: number;
  voice?: string;
  [k: string]: unknown;
}

export interface RawDiscourseSentence {
  text: string;
  hits?: RawDiscourseHit[];
  [k: string]: unknown;
}

export interface RawDiscourseResult {
  sentences: RawDiscourseSentence[];
  stats?: { sentenceCount?: number; lexicon?: { operators?: number; triggers?: number } };
  [k: string]: unknown;
}

export function analyze(raw: string): RawDiscourseResult;
