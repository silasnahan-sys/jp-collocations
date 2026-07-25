/**
 * context-tree.ts — the clean, tree-shaped context view for one pattern (PURE).
 *
 * The OLD lexicon produced junk because it sliced raw vault text with
 * `indexOf ±80 chars` — mid-word cuts, markdown syntax, anchor ids, endless
 * duplicates. This builds the tree from PatternStore ATTESTATIONS instead:
 * every attestation is already a located, provenanced, real quote. The tree is
 * source → (video / tweet-set / web / manual) → clean leaves, deduped and
 * capped, with the timestamp/anchor/clip metadata each leaf needs.
 *
 * The constellation (co-occurrence) is computed over the catalog: patterns
 * that share an attestation file with the focus pattern — a real signal, not a
 * substring guess. Golden-tested (golden/lexicon.mjs).
 */

import { stratumOf, type PatternEntry, type Attestation, type Medium, type Stratum } from '../notes/pattern-store.ts';

export interface ContextLeaf {
  quote: string;
  source: Attestation['source'];
  /** §22: the scene's medium (falls back to source on legacy attestations). */
  medium: Medium;
  /** §22.3: lived exposure vs curated language. */
  stratum: Stratum;
  file?: string;
  url?: string;
  videoId?: string | null;
  tStartSec?: number | null;
  anchorId?: string;
  /** the attestation this leaf renders (for jump/clip resolution). */
  att: Attestation;
  /** a yt attestation with a timestamp CAN have a downloadable clip. */
  clipEligible: boolean;
  /** came from the transcript sweep, not the user's own anchor. */
  swept: boolean;
  /** machine-suggested candidate awaiting ✓/✕ — NEVER mixed into the confirmed tree. */
  suggested: boolean;
}

export interface ContextGroup {
  source: Attestation['source'];
  /** display label — video/file basename, or "𝕏 ツイート" / "🌐 ウェブ" / "✍ 手動". */
  label: string;
  /** grouping key (file path for yt, source name otherwise). */
  key: string;
  leaves: ContextLeaf[];
  /** how many were dropped by the per-group cap. */
  overflow: number;
}

export interface ConstellationTerm {
  patternId: string;
  key: string;
  /** how many attestation files this pattern shares with the focus. */
  sharedFiles: number;
}

export interface ContextTree {
  groups: ContextGroup[];
  /**
   * suggested sightings from the class-aware sweep, quarantined in their own
   * bucket (rendered collapsed as 候補) — the zero-junk guarantee of `groups`
   * holds because nothing unratified ever enters it.
   */
  candidates: ContextLeaf[];
  constellation: ConstellationTerm[];
  totalLeaves: number;
}

const MAX_PER_GROUP = 12;
const MIN_QUOTE = 3;

const normQuote = (q: string): string => q.normalize('NFC').replace(/\s+/g, '').replace(/[、。,.!！?？]/g, '');

function fileBase(path: string): string {
  return path.split('/').pop()?.replace(/\.md$/, '') ?? path;
}

function leafOf(att: Attestation): ContextLeaf {
  return {
    quote: att.quote.trim(),
    source: att.source,
    medium: att.medium ?? att.source,
    stratum: stratumOf(att),
    file: att.file,
    url: att.scene?.deepLink ?? (att.source === 'x' || att.source === 'web' ? att.file : undefined),
    videoId: att.videoId,
    tStartSec: att.tStartSec,
    anchorId: att.anchorId,
    att,
    clipEligible: (att.source === 'yt' && att.tStartSec != null) || !!att.scene?.audio,
    swept: att.source === 'yt' && !att.anchorId,
    suggested: att.status === 'suggested',
  };
}

/** §22.2 group identity per medium — the label IS the scene's address. */
function groupOf(att: Attestation): { key: string; label: string } {
  const m: Medium = att.medium ?? att.source;
  const name = att.scene?.sourceName;
  switch (m) {
    case 'yt': return { key: att.file ?? 'yt', label: '▶ ' + fileBase(att.file ?? 'YouTube') };
    case 'podcast': return { key: att.file ?? `podcast:${name ?? ''}`, label: '🎙 ' + (name ?? fileBase(att.file ?? 'Podcast')) };
    case 'tv': return { key: att.file ?? `tv:${name ?? ''}`, label: '📺 ' + (name ?? fileBase(att.file ?? 'TV')) };
    case 'manga': return { key: `manga:${name ?? att.file ?? ''}`, label: '🗨 ' + (name ?? 'マンガ') };
    case 'book': return { key: `book:${name ?? att.file ?? ''}`, label: '📕 ' + (name ?? fileBase(att.file ?? '本')) };
    case 'note': return { key: `note:${name ?? ''}`, label: '📝 ' + (name ?? 'note.com') };
    case 'dict': return { key: `dict:${name ?? ''}`, label: '📖 ' + (name ?? '辞書') };
    case 'corpus': return { key: `corpus:${name ?? ''}`, label: '📊 ' + (name ?? 'コーパス') };
    case 'x': return { key: 'x', label: '𝕏 ツイート' };
    case 'web': return { key: 'web', label: '🌐 ウェブ' };
    default: return { key: 'manual', label: '✍ 手動メモ' };
  }
}

const MAX_CANDIDATES = 12;

/**
 * Build the context tree for `focus`. `allPatterns` powers the constellation
 * (pass the full catalog); omit it to skip co-occurrence.
 */
export function buildContextTree(focus: PatternEntry, allPatterns: PatternEntry[] = []): ContextTree {
  // ── group + clean the attestations ──
  const byKey = new Map<string, { group: ContextGroup; seen: Set<string> }>();
  const order: string[] = [];

  const candidates: ContextLeaf[] = [];
  const candSeen = new Set<string>();

  for (const att of focus.attestations) {
    const q = att.quote?.trim() ?? '';
    if (normQuote(q).length < MIN_QUOTE) continue;              // junk: too short / punctuation only

    if (att.status === 'suggested') {                           // quarantine: 候補, never the tree
      const nq = normQuote(q);
      if (candSeen.has(nq) || candidates.length >= MAX_CANDIDATES) continue;
      candSeen.add(nq);
      candidates.push(leafOf(att));
      continue;
    }

    const { key, label } = groupOf(att);

    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { group: { source: att.source, label, key, leaves: [], overflow: 0 }, seen: new Set() };
      byKey.set(key, bucket);
      order.push(key);
    }
    const nq = normQuote(q);
    if (bucket.seen.has(nq)) continue;                          // junk: duplicate quote in the same source
    bucket.seen.add(nq);
    if (bucket.group.leaves.length >= MAX_PER_GROUP) { bucket.group.overflow++; continue; }
    bucket.group.leaves.push(leafOf(att));
  }

  // sort leaves within a yt group by timestamp; anchored before swept
  for (const key of order) {
    const g = byKey.get(key)!.group;
    if (g.source === 'yt') {
      g.leaves.sort((a, b) =>
        Number(a.swept) - Number(b.swept) ||
        (a.tStartSec ?? 0) - (b.tStartSec ?? 0));
    }
  }

  // group order (§22.3): LIVED strata first, always — curated (dict/corpus)
  // is real language but not the user's exposure and renders after. Within a
  // stratum: dialogue mediums, then written, then x/web/manual.
  const mediumRank: Record<string, number> = { yt: 0, podcast: 1, tv: 2, manga: 3, book: 4, note: 5, x: 6, web: 7, manual: 8, dict: 9, corpus: 10 };
  const groups = order.map((k) => byKey.get(k)!.group)
    .sort((a, b) => {
      const sa = a.leaves[0] ? a.leaves[0].stratum : 'lived';
      const sb = b.leaves[0] ? b.leaves[0].stratum : 'lived';
      if (sa !== sb) return sa === 'lived' ? -1 : 1;
      const ma = a.leaves[0]?.medium ?? a.source;
      const mb = b.leaves[0]?.medium ?? b.source;
      return (mediumRank[ma] ?? 8) - (mediumRank[mb] ?? 8) || b.leaves.length - a.leaves.length;
    });

  // ── constellation: patterns sharing an attestation file (confirmed only —
  // an unratified candidate must not create co-occurrence signal) ──
  const focusFiles = new Set(focus.attestations.filter((a) => !a.status).map((a) => a.file).filter((f): f is string => !!f && isVaultLike(f)));
  const constellation: ConstellationTerm[] = [];
  if (focusFiles.size > 0) {
    for (const p of allPatterns) {
      if (p.id === focus.id) continue;
      let shared = 0;
      const counted = new Set<string>();
      for (const a of p.attestations) {
        if (!a.status && a.file && focusFiles.has(a.file) && !counted.has(a.file)) { shared++; counted.add(a.file); }
      }
      if (shared > 0) constellation.push({ patternId: p.id, key: p.key, sharedFiles: shared });
    }
    constellation.sort((a, b) => b.sharedFiles - a.sharedFiles || a.key.localeCompare(b.key, 'ja'));
  }

  candidates.sort((a, b) => (b.att.confidence ?? 0) - (a.att.confidence ?? 0));

  return {
    groups,
    candidates,
    constellation: constellation.slice(0, 16),
    totalLeaves: groups.reduce((n, g) => n + g.leaves.length, 0),
  };
}

/** Only vault-file attestations (yt/manual notes) seed constellation; URLs don't. */
function isVaultLike(file: string): boolean {
  return !/^https?:\/\//.test(file);
}
