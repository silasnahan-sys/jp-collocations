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
 * Above this many suggested sightings, an entry has stopped being a triage
 * queue and become a distribution.
 *
 * Twenty candidates is an afternoon of ✓/✕. 「ですね」 has 3,565, 「かな」 2,008,
 * 「んですけど」 1,641 — and the 候補 list showed twelve of them with no hint the
 * rest existed. Thirty-two such entries hold 17,891 of the catalog's 18,065
 * sightings, against 174 the user has actually confirmed. That backlog is not
 * clearable and was never meant to be: a particle that occurs in every other
 * sentence is not a thing you noticed, it is a thing the language does.
 *
 * So past this line the answer is not a shorter queue, it is a different
 * question — not "is this one real" but "what does this word DO", which the
 * sweep already recorded in `matchKind` and nothing ever read back.
 */
const PROFILE_MIN = 40;

/** The sweep writes `concordance:<position>[:<MOVE>]`. */
const MATCH_KIND_RE = /^concordance:([a-z]+)(?::([A-Z][A-Z-]*))?$/;

/**
 * Japanese for each discourse move, taken from the engine that emits them
 * (discourse/engine/interaction.mjs documents every opId with the surface form
 * it fires on). Rendering the raw `EXPLAIN-REVEAL` at the user would be showing
 * them our internals; the book form is 「んですよ 説明→開示」.
 */
const MOVE_JA: Record<string, string> = {
  'AGREE-MARK': '同意を示す',
  'CONFIRMATION-SEEK': '承認を求める',
  'CONFIRM-SEEK': '承認を求める',
  'CONFIRM-APPEAL': '確認を誘う',
  'GROUND-CLAIM': '暗黙の同意を地固めする',
  'EXPLAIN-REVEAL': '説明して開示する（んですよ）',
  'EXPLAIN-ALIGN': '説明して差し出す（んですね）',
  'EXPLAIN-CONFIRM': '説明して確認を求める（んですよね）',
  'EXPLAIN-HEDGE': '説明して留保する（んですけど）',
  'EXPLAIN-STATE': '説明を中立に置く（んです）',
  'EXPLAIN-CAUSE': '説明を因果の前提にする（んだから）',
  'EXPLANATORY-Q': '説明を求める',
  'CONJECTURE-STATE': '婉曲に推量する（でしょう）',
  'CONJECTURE-ALIGN': '推量して共感を求める（でしょうね）',
  'CONJECTURE-PROBE': '推量で問う（でしょうか）',
  'CONJECTURE-APPEAL': '推量して確認を誘う（でしょ）',
  'REASON-GROUND': '道理を足場にする（わけで）',
  'REASON-CAUSE': '道理を因果の前提にする（わけだから）',
  'REASON-CONCEDE': '道理に留保をつける（わけだけど）',
  'REASON-REVEAL': '道理を開示する（わけですよ）',
  'REASON-ALIGN': '道理の整合を求める（わけですね）',
  'REASON-STATE': '道理を中立に置く（わけです）',
  'HEARSAY-TOSS': '伝聞を放る（んだって）',
  'DANGLING-CAUSAL': '論拠だけ置く（言い差しの因果）',
  'HEDGE-INCOMPLETE': '言い差してぼかす',
  'MUSING-MODAL': '独り言のように置く',
  'RIGHT-DISLOCATION': '後から言い足す（右方転位）',
  'BUILD-ON': '相手の上に積む',
};

const POSITION_JA: Record<string, string> = {
  final: '文末', clausal: '節末', medial: '文中',
};

/** One discourse move this word was observed performing. */
export interface UsageMove {
  /** the engine's own id, kept so the row can be traced back. */
  move: string;
  label: string;
  count: number;
  /** share of the sightings that carried a named move (0–1). */
  share: number;
  /** a few real lines, deduped — evidence, not decoration. */
  examples: string[];
}

/**
 * What a high-frequency word DOES, read off the sweep's own `matchKind`.
 *
 * This is the artifact that replaces an unclearable ✓/✕ queue: 3,565 sightings
 * of 「ですね」 are not 3,565 questions, they are one answer with 3,565 pieces of
 * evidence behind it.
 */
export interface UsageProfile {
  /** every suggested sighting — not the twelve the 候補 list shows. */
  total: number;
  /** how many carried a named move; the rest knew only where they sat. */
  classified: number;
  moves: UsageMove[];
  positions: Array<{ position: string; label: string; count: number }>;
}

const MAX_PROFILE_EXAMPLES = 3;

/**
 * Is this quote worth showing as evidence for a claim about usage?
 *
 * The profile's whole argument is "here is what the word does, and here are the
 * lines that show it" — so a line that shows nothing weakens the claim rather
 * than supporting it. The sweep matches inside raw transcript text, which
 * carries deep links and embeds, and the first draft of this box duly offered
 * 「(https://youtu.be/0z91Gp-V8fE?t=65」 as proof that 「ですね」 marks agreement.
 *
 * Kept deliberately narrow: reject what is structurally unreadable, not what
 * looks untidy. ASR noise is still a real line the user really heard.
 */
function usableEvidence(q: string): boolean {
  if (normQuote(q).length < MIN_QUOTE) return false;
  if (/https?:\/\//.test(q) || /\[\[/.test(q)) return false;
  return /[぀-ヿ㐀-䶿一-鿿]/.test(q);      // must contain Japanese to be a line
}

/**
 * Fold a pattern's suggested sightings into a usage profile, or null when there
 * are too few to be a distribution — below `PROFILE_MIN` the ✓/✕ list is still
 * the honest interface, and inventing statistics from nine data points would be
 * wrong structure rather than less of it.
 */
export function buildUsageProfile(focus: PatternEntry): UsageProfile | null {
  const suggested = focus.attestations.filter((a) => a.status === 'suggested');
  if (suggested.length < PROFILE_MIN) return null;

  const byMove = new Map<string, { count: number; examples: string[]; seen: Set<string> }>();
  const byPos = new Map<string, number>();
  let classified = 0;

  for (const a of suggested) {
    const m = MATCH_KIND_RE.exec(a.matchKind ?? '');
    if (!m) continue;
    const [, position, move] = m;
    byPos.set(position, (byPos.get(position) ?? 0) + 1);
    if (!move) continue;
    classified++;
    let e = byMove.get(move);
    if (!e) { e = { count: 0, examples: [], seen: new Set() }; byMove.set(move, e); }
    e.count++;
    const q = a.quote?.trim() ?? '';
    const nq = normQuote(q);
    // Evidence has to be readable to count as evidence: a bare deep link proves
    // nothing, and the same line three times proves it once.
    if (q && usableEvidence(q) && !e.seen.has(nq) && e.examples.length < MAX_PROFILE_EXAMPLES) {
      e.seen.add(nq);
      e.examples.push(q);
    }
  }
  if (!classified) return null;      // position-only sweep: nothing to say yet

  const moves: UsageMove[] = [...byMove.entries()]
    .map(([move, e]) => ({
      move,
      label: MOVE_JA[move] ?? move,
      count: e.count,
      share: e.count / classified,
      examples: e.examples,
    }))
    .sort((a, b) => b.count - a.count || a.move.localeCompare(b.move));

  const positions = [...byPos.entries()]
    .map(([position, count]) => ({ position, label: POSITION_JA[position] ?? position, count }))
    .sort((a, b) => b.count - a.count);

  return { total: suggested.length, classified, moves, positions };
}

/**
 * The single move this form mostly performs, or null when it doesn't have one.
 *
 * Same tally as `buildUsageProfile`, asked a smaller question and therefore
 * allowed a smaller floor. The profile is a *distribution* and needs enough
 * sightings to be one (40); this is a *label*, and a form seen a dozen times
 * doing one thing eleven of them has earned it. Callers pass their own floor
 * so the threshold is visible at the decision, not buried here.
 *
 * Returns null rather than a weak guess: an entry with no dominant move keeps
 * standing on its own, which is §28 S6's "less structure, never wrong
 * structure" applied to grouping.
 */
export function dominantMove(
  focus: PatternEntry,
  opts: { minSightings?: number; minShare?: number } = {},
): { move: string; label: string; count: number; classified: number; share: number } | null {
  const minSightings = opts.minSightings ?? 8;
  const minShare = opts.minShare ?? 0.5;
  const byMove = new Map<string, number>();
  let classified = 0;
  for (const a of focus.attestations) {
    if (a.status !== 'suggested') continue;
    const m = MATCH_KIND_RE.exec(a.matchKind ?? '');
    if (!m?.[2]) continue;
    classified++;
    byMove.set(m[2], (byMove.get(m[2]) ?? 0) + 1);
  }
  if (classified < minSightings) return null;
  const ranked = [...byMove.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [best, count] = ranked[0] ?? ['', 0];
  // A STRICT plurality, not merely the first of several equals. A form split
  // evenly between two moves does not have a dominant one, and breaking that
  // tie alphabetically would file it under a coin flip.
  if (!best || count === (ranked[1]?.[1] ?? -1)) return null;
  const share = count / classified;
  if (share < minShare) return null;
  return { move: best, label: MOVE_JA[best] ?? best, count, classified, share };
}

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
