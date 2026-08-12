/**
 * citation-l3.ts — Sentence-level composition (lamination, parent/children,
 * siblings, pos_arg).
 *
 * Given a sentence + its L2-classified sites, resolve the embedding tree
 * and assign argument-macro positions.
 */

import type {
  CitationSite,
  CitationStack,
  IntraSentenceEdge,
  Lamination,
  PosArg,
  RhetMove,
} from './citation-types';
import { CITATION_TOKINDS } from './citation-types';

/**
 * Build the citation tree for one sentence.
 *
 * Algorithm:
 *  1. Sort sites by citedStart asc, citedEnd desc (outer-first).
 *  2. For each site, walk back through earlier sites; if an earlier
 *     site STRICTLY CONTAINS this one (citedStart < this.citedStart
 *     and the earlier marker offset > this.locator.charEnd), it's a parent.
 *     We use the OUTERMOST such containing site as parent.
 *  3. Sites with same parent are siblings.
 *  4. lamination =
 *      'leaf'  if no children
 *      'outer' if has children but no parent
 *      'inner' if has parent but no children
 *      'pivot' if both
 */
export function composeStack(
  sentenceIdx: number,
  sites: CitationSite[],
  sentenceText: string = '',
): CitationStack {
  // Defensive copy + sort by extent (outer-first).
  const ordered = [...sites].sort((a, b) => {
    if (a.locator.charStart !== b.locator.charStart) return a.locator.charStart - b.locator.charStart;
    return b.locator.charEnd - a.locator.charEnd;
  });

  // Reset structural fields (we own them in L3).
  for (const s of ordered) {
    s.parent = null;
    s.children = [];
    s.siblings = [];
  }

  // Parent resolution: O(n²) — fine, sites/sentence rarely exceeds ~10.
  for (let i = 0; i < ordered.length; i++) {
    const inner = ordered[i];
    let bestParent: CitationSite | null = null;
    let bestSpan = Infinity;
    for (let j = 0; j < ordered.length; j++) {
      if (i === j) continue;
      const cand = ordered[j];
      // cand contains inner if cand.citedStart ≤ inner.start AND cand.markerEnd ≥ inner.markerEnd
      const candStart = cand.locator.charStart - (cand.surface.length); // surface = cited span
      const candEnd = cand.locator.charEnd;
      const innStart = inner.locator.charStart - inner.surface.length;
      const innEnd = inner.locator.charEnd;
      if (candStart <= innStart && candEnd >= innEnd && (candStart < innStart || candEnd > innEnd)) {
        const span = candEnd - candStart;
        if (span < bestSpan) { bestSpan = span; bestParent = cand; }
      }
    }
    if (bestParent) {
      inner.parent = bestParent.id;
      bestParent.children.push(inner.id);
    }
  }

  // Sibling resolution
  const byParent = new Map<string | null, CitationSite[]>();
  for (const s of ordered) {
    const k = s.parent;
    if (!byParent.has(k)) { byParent.set(k, []); }
    byParent.get(k)!.push(s);
  }
  for (const group of byParent.values()) {
    if (group.length < 2) continue;
    const ids = group.map(g => g.id);
    for (const g of group) {
      g.siblings = ids.filter(i => i !== g.id);
    }
  }

  // Lamination
  for (const s of ordered) {
    const hasParent = s.parent !== null;
    const hasChildren = s.children.length > 0;
    let lam: Lamination = 'leaf';
    if (hasParent && hasChildren) lam = 'pivot';
    else if (hasChildren) lam = 'outer';
    else if (hasParent) lam = 'inner';
    s.lamination = lam;
    s.layerCompleted = Math.max(s.layerCompleted, 3) as CitationSite['layerCompleted'];
    s.confidence.l3 = 0.85;
  }

  // Pos-arg assignment (heuristic; refined in L4 with discourse cues)
  assignPosArg(ordered);

  // Rhetorical move per site + intra-sentence edges between sites
  assignRhetMove(ordered, sentenceText);
  const intra_edges = computeIntraEdges(ordered, sentenceText);

  const rootSiteIds = ordered.filter(s => s.parent === null && CITATION_TOKINDS.has(s.toKind)).map(s => s.id);

  return { sentenceIdx, sites: ordered, rootSiteIds, intra_edges };
}

/**
 * Heuristic pos_arg assignment based on position in sentence and form.
 * Refinement loop in L4 can override.
 */
function assignPosArg(sites: CitationSite[]) {
  if (sites.length === 0) return;
  const maxEnd = Math.max(...sites.map(s => s.locator.charEnd));
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    const span = s.locator.charEnd - s.locator.charStart + s.surface.length;
    const startAbs = Math.max(0, s.locator.charStart - s.surface.length);
    const endFrac = s.locator.charEnd / Math.max(maxEnd, 1);
    const startFrac = startAbs / Math.max(maxEnd, 1);
    const isFirst = i === 0;
    const isLast = i === sites.length - 1;
    let pos: PosArg = null;
    // Sentence-wrap forms → closing
    if (s.form === 'section-wrap' || s.form === 'nominalized-of-saying+ratification' ||
        s.form === 'truncated-terminal' || s.form === 'truncated-terminal+conditional' ||
        s.form === 'truncated-terminal+nominalizer') {
      pos = 'closing';
    }
    // Reformulative / topic-label+reformulative → evaluation
    else if (s.form === 'reformulative' || s.form === 'topic-label+reformulative') {
      pos = 'evaluation';
    }
    // Speech-verb-NP / topic-label at sentence start → opening
    else if (s.form === 'speech-verb-NP' || (s.form === 'topic-label' && isFirst && startFrac < 0.2)) {
      pos = 'opening';
    }
    // Mental-verb → evaluation
    else if (s.form === 'mental-verb') {
      pos = 'evaluation';
    }
    // Hypothetical → counter-rebuttal
    else if (s.form === 'hypothetical-quote' || s.form === 'conditional' || s.form === 'conditional-rhetorical') {
      pos = 'counter-rebuttal';
    }
    // Common-knowledge / hearsay → illustration
    else if (s.form === 'hearsay-suffix' || s.form === 'common-knowledge-cite') {
      pos = 'illustration';
    }
    // Final-position cite (reified-NP at end) → closing
    else if (isLast && endFrac > 0.85 &&
             (s.form === 'reified-NP' || s.form === 'nominalized-of-saying' || s.form === 'speech-verb+reified-NP')) {
      pos = 'closing';
    }
    // Default for everything else: warrant
    else {
      pos = 'warrant';
    }
    s.pos_arg = pos;
  }
}

// ── Rhetorical move + intra-sentence edges ────────────────────────

/** Cue patterns for each rhetorical move (red layer). */
const RE_MOVE_REFORMULATION = /(?:つまり|すなわち|要するに|言い換えれば|というか|っていうか|要は)/;
const RE_MOVE_EXPANSION     = /(?:さらに言えば|もっと言えば|広く言えば|ひいては|延いては|もっと大きく言うと)/;
const RE_MOVE_GROUNDING     = /(?:なぜなら|というのも|だって|というのは|理由は|それは.+から)/;
const RE_MOVE_EXEMPLIFY     = /(?:例えば|たとえば|たとえると|例として|具体的には|みたいな)/;
const RE_MOVE_INTRODUCE     = /^(?:まず|今日は|今回は|えーと|あの|ところで|それで言うと)/;
const RE_MOVE_TRANSITION    = /(?:そして|それで|だから|したがって|そう(?:な|い)うことで|そういう意味で)/;
const RE_MOVE_INVERSION     = /(?:[\u3001\u3002]\s*[\u3041-\u3093\u30a1-\u30f3\u4e00-\u9fff]+(?:は|が|を|に|で)\s*[\u3001\u3002])/;

/**
 * Assign a rhet_move to each site based on cue patterns in the local
 * window around the site. Defaults to 'plain' when no cue fires.
 */
function assignRhetMove(sites: CitationSite[], sentenceText: string) {
  for (const s of sites) {
    const start = Math.max(0, s.locator.charStart - s.surface.length - 12);
    const end = Math.min(sentenceText.length, s.locator.charEnd + 12);
    const window = sentenceText.slice(start, end);
    let move: RhetMove = 'plain';
    if (RE_MOVE_EXPANSION.test(window)) move = 'expansion';
    else if (RE_MOVE_REFORMULATION.test(window) ||
             s.form === 'reformulative' ||
             s.form === 'topic-label+reformulative') move = 'reformulation';
    else if (RE_MOVE_GROUNDING.test(window)) move = 'grounding';
    else if (RE_MOVE_EXEMPLIFY.test(window) ||
             s.form === 'common-knowledge-cite' ||
             s.form === 'hearsay-suffix') move = 'exemplification';
    else if (RE_MOVE_INTRODUCE.test(sentenceText)) move = 'introduction';
    else if (RE_MOVE_TRANSITION.test(window)) move = 'transition';
    else if (RE_MOVE_INVERSION.test(window) && s.locator.charStart > sentenceText.length * 0.6) move = 'inversion';
    s.rhet_move = move;
  }
}

/** Longest-common-substring length (>= 2 mora) — cheap repetition detector. */
function longestCommonSubstring(a: string, b: string): number {
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  let best = 0;
  const dp = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    let prev = 0;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      if (a[i - 1] === b[j - 1]) { dp[j] = prev + 1; if (dp[j] > best) best = dp[j]; }
      else dp[j] = 0;
      prev = tmp;
    }
  }
  return best;
}

/**
 * Compute edges between sites in the same sentence. Pairs each later site
 * with each earlier site and emits an edge when a cue is present in the
 * inter-site span or when surfaces overlap (repetition).
 */
function computeIntraEdges(sites: CitationSite[], sentenceText: string): IntraSentenceEdge[] {
  const edges: IntraSentenceEdge[] = [];
  if (sites.length < 2 || !sentenceText) return edges;
  for (let i = 1; i < sites.length; i++) {
    const cur = sites[i];
    for (let j = 0; j < i; j++) {
      const prev = sites[j];
      const spanStart = Math.min(prev.locator.charEnd, cur.locator.charStart - cur.surface.length);
      const spanEnd = Math.max(prev.locator.charEnd, cur.locator.charStart - cur.surface.length);
      if (spanEnd <= spanStart) continue;
      const span = sentenceText.slice(spanStart, spanEnd);
      let kind: IntraSentenceEdge['kind'] | null = null;
      let conf = 0.6;
      if (RE_MOVE_EXPANSION.test(span)) { kind = 'expands'; conf = 0.8; }
      else if (RE_MOVE_REFORMULATION.test(span)) { kind = 'reformulates'; conf = 0.85; }
      else if (RE_MOVE_GROUNDING.test(span)) { kind = 'grounds'; conf = 0.8; }
      else if (RE_MOVE_EXEMPLIFY.test(span)) { kind = 'exemplifies'; conf = 0.75; }
      else if (RE_MOVE_TRANSITION.test(span)) { kind = 'connects'; conf = 0.65; }
      else {
        const lcs = longestCommonSubstring(prev.surface, cur.surface);
        if (lcs >= 4) { kind = 'repeats'; conf = Math.min(0.9, 0.5 + lcs * 0.08); }
      }
      // Inversion detection: same predicate but reordered particles around it
      if (!kind && /[はがをにで]/.test(prev.surface) && /[はがをにで]/.test(cur.surface) &&
          longestCommonSubstring(prev.surface, cur.surface) >= 2 &&
          cur.locator.charStart > sentenceText.length * 0.55) {
        kind = 'inverts'; conf = 0.55;
      }
      if (kind && cur.parent === null && prev.parent === null) {
        edges.push({ fromSiteId: cur.id, toSiteId: prev.id, kind, confidence: conf });
        break; // one edge per cur site (to the nearest earlier match)
      }
    }
    if (cur.rhet_move === 'introduction' && !edges.find(e => e.fromSiteId === cur.id)) {
      // introduction sites have no back-edge; skip
    }
  }
  return edges;
}
