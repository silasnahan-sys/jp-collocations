/**
 * relations-resolver.ts — single resolver for "what relations exist in this
 * text?". Sidecar-authoritative when available, heuristic only as fallback.
 *
 * Why this exists:
 *   Pre-existing call sites in card-generator / grammar-set-engine /
 *   EditorDecorations called `analyzeRelations(text)` directly. That function
 *   is regex-on-connector-suffix heuristic with zero validation. When a Python
 *   pipeline sidecar exists for the source file, its `bit_relation` pairs are
 *   authoritative (validated by reconciliation between top-down and bottom-up
 *   passes). This resolver makes the sidecar the default and demotes the
 *   heuristic to an explicitly-labelled fallback.
 *
 * Contract:
 *   - Returns the SAME shape as `analyzeRelations()` so it is a drop-in.
 *   - `source: 'sidecar' | 'heuristic'` MUST be honoured by callers when
 *     surfacing relations to the user (tooltips, card metadata, etc.) —
 *     unvalidated heuristic output must not be presented as authoritative.
 *   - Sentence/clause/pattern structure is still produced by the heuristic
 *     layer (it's an independent signal from typed relations). Only the
 *     `relations` array is replaced when the sidecar is available.
 */

import {
  analyzeRelations,
  type SentenceRelation,
  type SentenceParse,
  type ContextChunk,
  type RelationType,
  RELATION_COLORS,
} from './sentence-relations';
import type { SurferBridge } from '../surfer-bridge';
import type { SidecarAnnotation, SidecarReconciliation } from './sidecar-types';
import { buildNfcOffsetMap } from '../utils/japanese';

export interface ResolvedRelations {
  /**
   * Where `relations` came from:
   *   - 'sidecar'   — Python pipeline bit_relation pairs (authoritative)
   *   - 'heuristic' — TS regex-on-connector fallback (unvalidated)
   */
  source: 'sidecar' | 'heuristic';
  sentences: SentenceParse[];
  relations: SentenceRelation[];
  chunks: ContextChunk[];
  /** When source === 'sidecar', the textHash that produced the signal. */
  sidecarHash?: string;
  /**
   * When source === 'heuristic' AND a sidecar lookup was attempted, the
   * reason it failed (for diagnostics + UI honesty). undefined means no
   * sidecar was even attempted (no bridge / no filePath given).
   */
  fallbackReason?:
    | 'no-bridge'
    | 'no-file-path'
    | 'no-hash'
    | 'no-raw-text'
    | 'chunk-not-locatable'
    | 'no-pairs';
}

export interface ResolveContext {
  /** Surfer bridge holding the BitRelationIndex + per-file raw text. */
  bridge?: SurferBridge;
  /** Vault-relative file path of the document the text comes from. */
  filePath?: string;
}

/**
 * Map a sidecar reconciliation status → RelationType bucket. The bucket
 * choice drives `colorClass` (and therefore decoration colour).
 */
function reconciliationToType(r: SidecarReconciliation | undefined): RelationType {
  switch (r) {
    case 'locked':          return 'bit-relation-locked';
    case 'top_down_only':   return 'bit-relation-td';
    case 'bottom_up_only':  return 'bit-relation-bu';
    default:                return 'bit-relation-locked'; // conservative default
  }
}

/** Humanise a snake_case sidecar label for display. */
function humanizeLabel(label: string): string {
  return label.replace(/_/g, ' ');
}

/**
 * Translate a NFC [start,end) range into raw-text [start,end) using the
 * provided offset map. Returns null if the range falls outside the map.
 */
function nfcRangeToRaw(
  nfcStart: number,
  nfcEnd: number,
  rawFromNfc: Int32Array,
): { start: number; end: number } | null {
  if (nfcStart < 0 || nfcEnd > rawFromNfc.length || nfcStart >= nfcEnd) return null;
  const rawStart = rawFromNfc[nfcStart];
  // `rawFromNfc[nfcEnd]` is valid because the map has length nfcText.length+1.
  const rawEnd = nfcEnd < rawFromNfc.length
    ? rawFromNfc[nfcEnd]
    : rawFromNfc[rawFromNfc.length - 1];
  if (rawEnd <= rawStart) return null;
  return { start: rawStart, end: rawEnd };
}

/**
 * Build SentenceRelation entries from sidecar bit_relation annotations.
 * Returns null when the sidecar yields no usable pairs (caller falls back).
 *
 * `rangeStart` is the offset of `text` within the file's raw content (0 if
 * `text` IS the full file). Sidecar offsets, after NFC→raw translation, are
 * file-relative; we subtract `rangeStart` and filter to those entirely inside
 * `[0, text.length)`.
 */
function buildRelationsFromSidecar(
  bridge: SurferBridge,
  filePath: string,
  text: string,
  rangeStart: number,
  sentencesByOffset: SentenceParse[],
): { relations: SentenceRelation[]; hash: string } | null {
  const hash = bridge.getTextHashForFile(filePath);
  if (!hash) return null;
  const index = bridge.getBitRelationIndex();
  if (!index.hasHash(hash)) return null;
  const rawFileText = bridge.getRawTextForFile(filePath);
  if (rawFileText === undefined) return null;

  // Build NFC offset map on the raw file text (same canonical form the
  // pipeline hashed). This gives bidirectional NFC↔raw translation.
  const offsetMap = buildNfcOffsetMap(rawFileText);

  // Collect all bit_relation annotations and group by pairId.
  const anns = index.getAnnotationsForHash(hash);
  type Pair = { source?: SidecarAnnotation; target?: SidecarAnnotation };
  const pairs = new Map<string, Pair>();
  for (const ann of anns) {
    if (ann.kind !== 'bit_relation') continue;
    if (!ann.pairId) continue;
    let p = pairs.get(ann.pairId);
    if (!p) { p = {}; pairs.set(ann.pairId, p); }
    if (ann.role === 'source')      p.source = ann;
    else if (ann.role === 'target') p.target = ann;
    else if (!p.source)             p.source = ann;
    else if (!p.target)             p.target = ann;
  }
  if (pairs.size === 0) return null;

  const textEnd = rangeStart + text.length;

  // Sentence-index lookup for the source/target spans.
  function sentenceIdxFor(rawStart: number): number {
    for (let i = 0; i < sentencesByOffset.length; i++) {
      const s = sentencesByOffset[i];
      // sentence offsets are text-local (already shifted by rangeStart by the
      // heuristic), so compare against rawStart - rangeStart.
      const local = rawStart - rangeStart;
      if (local >= s.start && local < s.end) return i;
    }
    return 0;
  }

  const relations: SentenceRelation[] = [];
  for (const [, pair] of pairs) {
    if (!pair.source || !pair.target) continue;

    const srcRaw = nfcRangeToRaw(pair.source.charStart, pair.source.charEnd, offsetMap.rawFromNfc);
    const tgtRaw = nfcRangeToRaw(pair.target.charStart, pair.target.charEnd, offsetMap.rawFromNfc);
    if (!srcRaw || !tgtRaw) continue;

    // Filter to spans entirely inside the caller's `text` window.
    if (srcRaw.start < rangeStart || srcRaw.end > textEnd) continue;
    if (tgtRaw.start < rangeStart || tgtRaw.end > textEnd) continue;

    // Sidecar pairs always declare reconciliation on at least one role; pick
    // the strongest signal across the two roles.
    const recon =
      pair.source.reconciliation === 'locked' || pair.target.reconciliation === 'locked'
        ? 'locked'
        : (pair.source.reconciliation ?? pair.target.reconciliation);
    const type = reconciliationToType(recon);
    const colorClass = RELATION_COLORS[type];

    // Sidecar label is the rel_kind (e.g. "withdraw_and_reformulate").
    const labelEn = humanizeLabel(pair.source.label || pair.target.label || 'bit-relation');

    relations.push({
      type,
      source: {
        start: srcRaw.start - rangeStart,
        end:   srcRaw.end   - rangeStart,
        text:  text.slice(srcRaw.start - rangeStart, srcRaw.end - rangeStart),
        sentenceIdx: sentenceIdxFor(srcRaw.start),
      },
      target: {
        start: tgtRaw.start - rangeStart,
        end:   tgtRaw.end   - rangeStart,
        text:  text.slice(tgtRaw.start - rangeStart, tgtRaw.end - rangeStart),
        sentenceIdx: sentenceIdxFor(tgtRaw.start),
      },
      confidence: Math.max(
        pair.source.confidence ?? 0.5,
        pair.target.confidence ?? 0.5,
      ),
      label: labelEn,
      labelEn,
      colorClass,
      reason: `sidecar:${pair.source.label || pair.target.label || 'bit-relation'}`,
      triggers: [recon ?? 'unknown'],
    });
  }

  if (relations.length === 0) return null;
  return { relations, hash };
}

/**
 * Resolve relations for a text passage.
 *
 * Decision tree:
 *   1. If `ctx.bridge` + `ctx.filePath` present AND a sidecar is loaded for
 *      that file AND we can locate `text` within the file's raw content:
 *        → return sidecar relations (source: 'sidecar').
 *   2. Otherwise → run `analyzeRelations(text)` (source: 'heuristic').
 *
 * The heuristic structural output (sentences, chunks) is always returned —
 * it's a different signal from typed relations and the sidecar does not
 * supersede sentence splitting.
 */
export function resolveRelations(
  text: string,
  ctx: ResolveContext = {},
): ResolvedRelations {
  // Always run heuristic first — we need its sentences/chunks regardless.
  const heur = analyzeRelations(text);

  if (!ctx.bridge) {
    return { source: 'heuristic', ...heur };
  }
  if (!ctx.filePath) {
    return { source: 'heuristic', ...heur, fallbackReason: 'no-file-path' };
  }

  // Locate `text` inside the file's raw content to learn `rangeStart`.
  const rawFileText = ctx.bridge.getRawTextForFile(ctx.filePath);
  if (rawFileText === undefined) {
    return { source: 'heuristic', ...heur, fallbackReason: 'no-raw-text' };
  }
  if (!ctx.bridge.getTextHashForFile(ctx.filePath)) {
    return { source: 'heuristic', ...heur, fallbackReason: 'no-hash' };
  }

  // Cheap fast path: text IS the file (full-document case, e.g. EditorDecorations).
  let rangeStart: number;
  if (text === rawFileText) {
    rangeStart = 0;
  } else {
    // Chunk case: find the chunk inside the file. Require an unambiguous
    // match — if the chunk appears multiple times we cannot pick the right
    // one without more context, so fall back to heuristic rather than guess.
    const first = rawFileText.indexOf(text);
    if (first === -1) {
      return { source: 'heuristic', ...heur, fallbackReason: 'chunk-not-locatable' };
    }
    const second = rawFileText.indexOf(text, first + 1);
    if (second !== -1) {
      return { source: 'heuristic', ...heur, fallbackReason: 'chunk-not-locatable' };
    }
    rangeStart = first;
  }

  const sidecarBuilt = buildRelationsFromSidecar(
    ctx.bridge, ctx.filePath, text, rangeStart, heur.sentences,
  );
  if (!sidecarBuilt) {
    return { source: 'heuristic', ...heur, fallbackReason: 'no-pairs' };
  }

  return {
    source: 'sidecar',
    sentences: heur.sentences,
    chunks: heur.chunks,
    relations: sidecarBuilt.relations,
    sidecarHash: sidecarBuilt.hash,
  };
}

/**
 * A `Resolver` is a closure with the bridge baked in, so call sites that
 * don't statically know about SurferBridge can be passed a resolver and stay
 * dependency-light. Heuristic-only callers can use `heuristicResolver`.
 */
export type RelationsResolver = (
  text: string,
  ctx?: { filePath?: string },
) => ResolvedRelations;

export function makeRelationsResolver(bridge: SurferBridge | undefined): RelationsResolver {
  return (text, ctx) =>
    resolveRelations(text, { bridge, filePath: ctx?.filePath });
}

/** Heuristic-only resolver — for tests and contexts without a bridge. */
export const heuristicResolver: RelationsResolver = (text) =>
  resolveRelations(text, {});
