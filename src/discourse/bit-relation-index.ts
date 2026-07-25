/**
 * BitRelationIndex — sidecar-backed typed-relation index.
 *
 * Storage shape:
 *   - Per-file (keyed by NFC text hash): list of SidecarAnnotation
 *   - Cross-file pair lookup: pairId → { source, target, continuations[] }
 *
 * Consumers (initial):
 *   - src/context/ContextEngine.ts coPatterns — promoted from surface-window
 *     PMI to typed-relation ingest with directional source/target awareness.
 *     Graceful fallback to existing surface PMI when sidecar absent for the
 *     active file.
 */

import type {
  SidecarFile,
  SidecarAnnotation,
} from './sidecar-types';
import {
  MIN_SUPPORTED_PIPELINE_VERSION,
  SUPPORTED_SCHEMA_VERSION,
} from './sidecar-types';

export interface BitRelationPair {
  pairId: string;
  source: SidecarAnnotation;
  target: SidecarAnnotation;
  continuations: SidecarAnnotation[];
  /** Hash of the file the pair was sourced from. */
  textHash: string;
}

export interface BitRelationIndexLoadResult {
  loaded: boolean;
  /** Why the sidecar was rejected, if loaded === false. */
  reason?:
    | 'schema_version_mismatch'
    | 'pipeline_version_too_old'
    | 'text_hash_mismatch'
    | 'malformed';
  /** Diagnostic counts when loaded === true. */
  annotationCount?: number;
  pairCount?: number;
  /** Pairs that arrived without both source+target (kept as orphans). */
  orphanPairCount?: number;
}

/** Parse "1.2.3" → [1, 2, 3]. Returns null on malformed. */
function parseSemver(v: string): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** a >= b. Returns false if either is malformed. */
function semverGte(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return true;
    if (pa[i] < pb[i]) return false;
  }
  return true;
}

function isValidAnnotation(a: unknown): a is SidecarAnnotation {
  if (!a || typeof a !== 'object') return false;
  const o = a as Record<string, unknown>;
  return (
    typeof o.charStart === 'number' &&
    typeof o.charEnd === 'number' &&
    (o.charEnd as number) > (o.charStart as number) &&
    (o.charStart as number) >= 0 &&
    typeof o.kind === 'string' &&
    typeof o.label === 'string'
  );
}

export class BitRelationIndex {
  /** annotations by textHash → list (sorted by charStart asc, charEnd asc). */
  private byHash: Map<string, SidecarAnnotation[]> = new Map();
  /** pairId → resolved pair. */
  private pairs: Map<string, BitRelationPair> = new Map();
  /** Canonical NFC text per textHash. Required to slice annotation surfaces. */
  private nfcByHash: Map<string, string> = new Map();

  /**
   * Load a sidecar for a given file. `expectedTextHash` must match the hash
   * computed from the current NFC file content; mismatch returns
   * { loaded: false, reason: 'text_hash_mismatch' } and the caller falls back
   * to TS-native detection.
   *
   * `nfcText` is the canonicalized NFC text whose hash matches `expectedTextHash`.
   * It is retained so consumers can resolve annotation `[charStart, charEnd)`
   * back to surface forms without re-reading the file.
   *
   * Replaces any prior data for the same textHash.
   */
  loadSidecar(
    sidecar: SidecarFile,
    expectedTextHash: string,
    nfcText: string,
  ): BitRelationIndexLoadResult {
    if (!sidecar || typeof sidecar !== 'object') {
      return { loaded: false, reason: 'malformed' };
    }
    if (sidecar.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      return { loaded: false, reason: 'schema_version_mismatch' };
    }
    if (!semverGte(sidecar.pipelineVersion, MIN_SUPPORTED_PIPELINE_VERSION)) {
      return { loaded: false, reason: 'pipeline_version_too_old' };
    }
    if (typeof sidecar.textHash !== 'string' || sidecar.textHash !== expectedTextHash) {
      return { loaded: false, reason: 'text_hash_mismatch' };
    }
    if (!Array.isArray(sidecar.annotations)) {
      return { loaded: false, reason: 'malformed' };
    }

    // Drop any prior data for this hash.
    this.clearForHash(sidecar.textHash);

    // Filter to well-formed annotations and sort by (charStart, charEnd) so
    // range queries can early-exit.
    const valid = sidecar.annotations.filter(isValidAnnotation);
    valid.sort((a, b) => a.charStart - b.charStart || a.charEnd - b.charEnd);
    this.byHash.set(sidecar.textHash, valid);
    this.nfcByHash.set(sidecar.textHash, nfcText);

    // Build pairs: group by pairId, attach source/target/continuations.
    type Bucket = {
      source?: SidecarAnnotation;
      target?: SidecarAnnotation;
      conts: SidecarAnnotation[];
    };
    const buckets: Map<string, Bucket> = new Map();
    for (const ann of valid) {
      if (!ann.pairId) continue;
      let b = buckets.get(ann.pairId);
      if (!b) {
        b = { conts: [] };
        buckets.set(ann.pairId, b);
      }
      if (ann.role === 'source' && !b.source) b.source = ann;
      else if (ann.role === 'target' && !b.target) b.target = ann;
      else if (ann.role === 'continuation') b.conts.push(ann);
      else if (!b.source) b.source = ann;
      else if (!b.target) b.target = ann;
      else b.conts.push(ann);
    }

    let resolved = 0;
    let orphans = 0;
    for (const [pairId, b] of buckets) {
      if (b.source && b.target) {
        this.pairs.set(pairId, {
          pairId,
          source: b.source,
          target: b.target,
          continuations: b.conts,
          textHash: sidecar.textHash,
        });
        resolved++;
      } else {
        orphans++;
      }
    }

    return {
      loaded: true,
      annotationCount: valid.length,
      pairCount: resolved,
      orphanPairCount: orphans,
    };
  }

  /** All annotations whose [charStart, charEnd) intersects [nfcStart, nfcEnd). */
  getAnnotationsInRange(
    textHash: string,
    nfcStart: number,
    nfcEnd: number,
  ): SidecarAnnotation[] {
    const arr = this.byHash.get(textHash);
    if (!arr || arr.length === 0) return [];
    const out: SidecarAnnotation[] = [];
    for (const a of arr) {
      if (a.charStart >= nfcEnd) break;
      if (a.charEnd > nfcStart) out.push(a);
    }
    return out;
  }

  /** All annotations loaded for a given file hash (sorted by charStart). */
  getAnnotationsForHash(textHash: string): SidecarAnnotation[] {
    return this.byHash.get(textHash) ?? [];
  }

  /** Canonical NFC text for a loaded hash, or undefined if not loaded. */
  getNfcText(textHash: string): string | undefined {
    return this.nfcByHash.get(textHash);
  }

  /** Slice the NFC surface for a single annotation. Returns '' if hash unloaded. */
  surfaceOf(annotation: SidecarAnnotation, textHash: string): string {
    const nfc = this.nfcByHash.get(textHash);
    if (!nfc) return '';
    return nfc.slice(annotation.charStart, annotation.charEnd);
  }

  /**
   * Find all bit-relation pairs whose source OR target NFC surface contains
   * the given query (substring match against NFC-normalized text). Returns
   * pairs grouped with which side matched, across all loaded sidecars.
   *
   * For typed-relation co-occurrence: when the user queries "あの", surface
   * each pair where "あの" was a source or target, along with the paired
   * endpoint's text and the relation label.
   */
  findPairsContainingSurface(query: string): Array<{
    pair: BitRelationPair;
    matchedRole: 'source' | 'target';
    sourceSurface: string;
    targetSurface: string;
  }> {
    if (!query) return [];
    const nfcQuery = query.normalize('NFC');
    const out: Array<{
      pair: BitRelationPair;
      matchedRole: 'source' | 'target';
      sourceSurface: string;
      targetSurface: string;
    }> = [];
    for (const pair of this.pairs.values()) {
      const nfc = this.nfcByHash.get(pair.textHash);
      if (!nfc) continue;
      const src = nfc.slice(pair.source.charStart, pair.source.charEnd);
      const tgt = nfc.slice(pair.target.charStart, pair.target.charEnd);
      if (src.includes(nfcQuery)) {
        out.push({ pair, matchedRole: 'source', sourceSurface: src, targetSurface: tgt });
      } else if (tgt.includes(nfcQuery)) {
        out.push({ pair, matchedRole: 'target', sourceSurface: src, targetSurface: tgt });
      }
    }
    return out;
  }

  /** Resolve a pairId to its source + target + continuations. */
  getPair(pairId: string): BitRelationPair | undefined {
    return this.pairs.get(pairId);
  }

  /** True if a sidecar has been loaded for the given file hash. */
  hasHash(textHash: string): boolean {
    return this.byHash.has(textHash);
  }

  /**
   * Drop all data for a given textHash. Called when the active file's NFC
   * hash changes (user edited the file → old sidecar is invalid).
   */
  clearForHash(textHash: string): void {
    this.byHash.delete(textHash);
    this.nfcByHash.delete(textHash);
    for (const [pairId, p] of this.pairs) {
      if (p.textHash === textHash) this.pairs.delete(pairId);
    }
  }

  /** Drop everything. */
  clear(): void {
    this.byHash.clear();
    this.nfcByHash.clear();
    this.pairs.clear();
  }

  /** Total annotations across all loaded sidecars. */
  size(): number {
    let n = 0;
    for (const arr of this.byHash.values()) n += arr.length;
    return n;
  }

  /** Total resolved pairs. */
  pairCount(): number {
    return this.pairs.size;
  }

  /** Hashes with sidecar data loaded. */
  loadedHashes(): string[] {
    return Array.from(this.byHash.keys());
  }
}
