/**
 * Sidecar wire format — frozen v1 schema.
 *
 * Negotiated between jp-collocations (plugin) and jp-collocation-and-parser-logic
 * (Python pipeline). Any change here is `schemaVersion: 2` with a documented
 * migration. See agent-to-agent negotiation transcript for rationale.
 *
 * Wire is NFC-normalized char offsets. The plugin translates to raw display
 * coordinates via buildNfcOffsetMap (src/utils/japanese.ts) before painting.
 *
 * The production sidecar is `<hash>.json`. A debug sibling `<hash>.debug.json`
 * is emitted only by `unified_pipeline.py --vault --debug` and carries
 * evidence / pipelineLayer / seed-DSL traces. Plugin reads `.debug.json` only
 * when present.
 */

/** Kind of annotation. Stable customer-facing taxonomy — no pipeline internals. */
export type SidecarAnnotationKind =
  | 'role'
  | 'bit_relation'
  | 'rhetorical_construction'
  | 'seed_classification';

/**
 * Role within a paired relation:
 *   - 'source' = first half of the rel_kind (e.g. "withdraw" in withdraw_and_reformulate)
 *   - 'target' = second half (e.g. "reformulate")
 *   - 'continuation' = chain member attached to an existing (source, target) pair.
 *
 * Continuations inherit pairId from their (source, target) pair and do not
 * contribute to pairId derivation. Source+target ordering must round-trip to
 * reconstruct the rel_kind name.
 */
export type SidecarAnnotationRole = 'source' | 'target' | 'continuation';

/** Pipeline reconciliation outcome (the irreplaceable signal). */
export type SidecarReconciliation = 'locked' | 'top_down_only' | 'bottom_up_only';

export interface SidecarAnnotation {
  /** Offset in NFC text. */
  charStart: number;
  /** Exclusive offset in NFC text. */
  charEnd: number;
  kind: SidecarAnnotationKind;
  /** e.g. 'pivot' | 'withdraw_and_reformulate' | 'premise_challenger' | ... */
  label: string;
  /** Deterministic: sha1(rel_kind|src_start|src_end|tgt_start|tgt_end)[:12]. */
  pairId?: string;
  role?: SidecarAnnotationRole;
  /** 0..1 */
  confidence?: number;
  reconciliation?: SidecarReconciliation;
}

export interface SidecarFile {
  schemaVersion: 1;
  /** sha256(NFC(rawFileText)) hex. */
  textHash: string;
  textNormalization: 'NFC';
  /** Semver of unified_pipeline.py. */
  pipelineVersion: string;
  /** unix ms. */
  producedAt: number;
  annotations: SidecarAnnotation[];
}

/** Minimum pipeline version the plugin will load without warning. */
export const MIN_SUPPORTED_PIPELINE_VERSION = '1.0.0';

/** Current schema version this plugin expects. */
export const SUPPORTED_SCHEMA_VERSION = 1 as const;
