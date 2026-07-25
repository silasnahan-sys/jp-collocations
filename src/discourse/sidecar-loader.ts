/**
 * Sidecar loader plumbing: canonicalize raw file text, compute the text hash,
 * read `<vault>/.obsidian/plugins/jp-collocations/analysis/<hash>.json` via the
 * Obsidian vault adapter, and feed the result into a `BitRelationIndex`.
 *
 * Mirror of the Python side:
 *   - Python `unified_pipeline.py --vault` reads each `.md` with `read_text(encoding="utf-8")`
 *     which applies universal newlines (CRLF/CR → LF). It then NFC-normalizes and
 *     hashes with sha256. Sidecar is written to `<hash>.json`.
 *   - The plugin must apply the **same** canonicalization (LF + NFC) before
 *     hashing or any byte-for-byte difference breaks the hash match.
 *
 * The wire format is frozen in src/discourse/sidecar-types.ts (schema v1).
 */

import type { App } from 'obsidian';
import type { SidecarFile } from './sidecar-types';
import type {
  BitRelationIndex,
  BitRelationIndexLoadResult,
} from './bit-relation-index';

const SIDECAR_DIR_REL = '.obsidian/plugins/jp-collocations/analysis';

/**
 * Canonicalize raw file bytes (as decoded by Obsidian's vault.read) into the
 * exact NFC text the Python pipeline hashed: universal newlines (CRLF and CR
 * collapse to LF), then Unicode NFC.
 */
export function canonicalizeForHash(rawText: string): string {
  return rawText.replace(/\r\n?/g, '\n').normalize('NFC');
}

/**
 * Compute the sha256 hex digest of an NFC string using Web Crypto so it works
 * on iOS Obsidian (no node: imports). Returns lowercase hex.
 */
export async function computeTextHash(nfcText: string): Promise<string> {
  const bytes = new TextEncoder().encode(nfcText);
  // crypto.subtle is available in Obsidian Desktop, Mobile, and Node ≥15.
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, '0');
  }
  return out;
}

/** Vault-relative path to the sidecar JSON for a given text hash. */
export function sidecarPathFor(textHash: string): string {
  return `${SIDECAR_DIR_REL}/${textHash}.json`;
}

export interface SidecarLoadOutcome {
  /** True iff a sidecar was found AND accepted by BitRelationIndex. */
  applied: boolean;
  /** The NFC-canonicalized text hash. Always returned for caller logging. */
  textHash: string;
  /** Reason for non-application. 'absent' when no sidecar file exists. */
  reason?:
    | 'absent'
    | 'read_error'
    | 'parse_error'
    | BitRelationIndexLoadResult['reason'];
  /** Forwarded counts when applied. */
  annotationCount?: number;
  pairCount?: number;
  orphanPairCount?: number;
}

/**
 * Best-effort load. Never throws; on any failure returns `applied: false` with
 * a reason and the caller falls back to TS-native detection.
 */
export async function loadSidecarForFile(
  app: App,
  rawText: string,
  index: BitRelationIndex,
): Promise<SidecarLoadOutcome> {
  const nfc = canonicalizeForHash(rawText);
  const textHash = await computeTextHash(nfc);
  const path = sidecarPathFor(textHash);

  const adapter = app.vault.adapter;
  let exists = false;
  try {
    exists = await adapter.exists(path);
  } catch {
    return { applied: false, textHash, reason: 'read_error' };
  }
  if (!exists) {
    return { applied: false, textHash, reason: 'absent' };
  }

  let raw: string;
  try {
    raw = await adapter.read(path);
  } catch {
    return { applied: false, textHash, reason: 'read_error' };
  }

  let parsed: SidecarFile;
  try {
    parsed = JSON.parse(raw) as SidecarFile;
  } catch {
    return { applied: false, textHash, reason: 'parse_error' };
  }

  const res = index.loadSidecar(parsed, textHash, nfc);
  if (!res.loaded) {
    return { applied: false, textHash, reason: res.reason };
  }
  return {
    applied: true,
    textHash,
    annotationCount: res.annotationCount,
    pairCount: res.pairCount,
    orphanPairCount: res.orphanPairCount,
  };
}
