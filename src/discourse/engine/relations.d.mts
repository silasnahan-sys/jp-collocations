// Hand-written type sidecar for the vendored engine's sentence-rule filter.

import type { EngineHit } from './match.mjs';

export function applySentenceRules(sentenceText: string, hits: EngineHit[]): EngineHit[];
export function applyDocumentRules(turns: unknown[]): unknown[];
