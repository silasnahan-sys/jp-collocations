// _tmp_pipeline/structure.mjs
// =====================================================================
// STRUCTURAL RELATIONS — the layer the user actually wanted.
//
// Grammar primitives are points on the timeline. Discourse meaning is
// produced by HOW THEY RELATE: which operator opens a frame that lasts
// until which other operator closes it; which adjacent primitives pack
// into a named construction; which medial operator pivots the sentence
// into a left-half + right-half.
//
// This module produces three structural artefacts per sentence:
//
//   spans   : [{label, openHit, closeHit?, start, end, complete}]
//             — e.g. でね …… と  opens 'quotative' at offset 0 and
//             closes at offset N when QUOTATIVE-SPEECH fires.
//
//   bundles : [{name, opIds, start, end, members, intent}]
//             — adjacent cluster of specific opIds within a tight window
//             forms a higher-order construction such as
//             っていうのはもうやはり = TYPE-FRAME-CONFIRMED.
//             (注: っていうのは は PERSPECTIVE-STAGE-OPEN であり
//              「定義開始」ではない。視座導入として扱う。)
//
//   pivots  : [{opId, anchor, leftSpan:[a,b], rightSpan:[c,d], type}]
//             — medial concessive/causal/quotative operator that splits
//             the sentence into two halves (なんですけど…, から…, と…).
//
// These are pure structure: they do not invent new categories, only make
// the relations between already-detected hits VISIBLE so the renderer
// can draw brackets, pills and arrows over them.
// =====================================================================

import { OP_BY_ID } from './lexicon.mjs';

/** Stable id used in render to key elements. */
function uid(prefix, ...parts) { return `${prefix}-${parts.join('-')}`; }

/* ---------------------------------------------------------------- *
 * 1. SPANS — opens_span / closes_span pairing
 * ---------------------------------------------------------------- */

/**
 * Pair every opens_span hit with the next closes_span hit carrying the
 * matching label. Hits with no closing partner produce an OPEN span that
 * runs to end-of-sentence.
 *
 * @param {string} text
 * @param {Array<any>} hits  output of applySentenceRules — sorted by offset
 * @returns {Array<{id:string,label:string,start:number,end:number,
 *   openHit:any, closeHit:any|null, complete:boolean}>}
 */
export function computeSpans(text, hits) {
  /** @type {Map<string, any[]>} */
  const openStacks = new Map();
  /** @type {Array<any>} */
  const spans = [];
  let counter = 0;

  for (const h of hits) {
    if (h.opensSpan) {
      const stack = openStacks.get(h.opensSpan) ?? [];
      stack.push(h);
      openStacks.set(h.opensSpan, stack);
    }
    if (h.closesSpan) {
      const stack = openStacks.get(h.closesSpan);
      if (stack && stack.length) {
        const opener = stack.pop();
        spans.push({
          id: uid('span', counter++),
          label: h.closesSpan,
          start: opener.offset,
          end: h.offset + h.length,
          openHit: opener,
          closeHit: h,
          complete: true,
        });
      }
    }
  }
  // Anything still on a stack is an unclosed span → runs to end-of-sentence.
  for (const [label, stack] of openStacks) {
    for (const opener of stack) {
      spans.push({
        id: uid('span', counter++),
        label,
        start: opener.offset,
        end: text.length,
        openHit: opener,
        closeHit: null,
        complete: false,
      });
    }
  }
  return spans.sort((a, b) => a.start - b.start || b.end - a.end);
}

/* ---------------------------------------------------------------- *
 * 2. BUNDLES — adjacent ordered cluster → named construction
 * ---------------------------------------------------------------- */

/**
 * Declarative bundle catalogue. Each bundle specifies:
 *   name     — opId of the emergent discourse op (must be layer:'d' in lexicon)
 *   seq      — ordered list of required opIds; matched left-to-right
 *   window   — max char distance between consecutive members (inclusive)
 *   optional — set of opIds that may appear interleaved without breaking
 *   intent   — short human label for the renderer
 */
const BUNDLE_CATALOGUE = [
  {
    name: 'TYPE-FRAME-CONFIRMED',
    seq: ['PERSPECTIVE-STAGE-OPEN', 'TEMPORAL-NOW', 'EXPECTATION-CONFIRM'],
    window: 8,
    optional: new Set(['FILLER-HESITATION']),
    intent: '視座導入+「もう」で時点固定+「やはり」で期待確認 → 共有前提に書き込む',
  },
  {
    name: 'PIVOT-OPEN-FILLER',
    seq: ['FILLER-HESITATION', 'PERSPECTIVE-STAGE-OPEN'],
    window: 12,
    optional: new Set(),
    intent: '間取りの後で視座導入 → 重い名詞句を舞台に上げる',
  },
];

/**
 * Scan hits left-to-right; for each bundle template attempt to match the
 * seq starting at each candidate position. Hits already consumed by an
 * earlier bundle are not re-used.
 *
 * @param {string} text
 * @param {Array<any>} hits
 * @returns {Array<{id:string, name:string, opIds:string[], start:number,
 *   end:number, members:any[], intent:string}>}
 */
export function detectBundles(text, hits) {
  const out = [];
  const consumed = new Set();
  let counter = 0;

  for (const template of BUNDLE_CATALOGUE) {
    for (let i = 0; i < hits.length; i++) {
      if (consumed.has(i)) continue;
      if (hits[i].opId !== template.seq[0]) continue;
      const members = [hits[i]];
      const memberIdxs = [i];
      let cursorOp = 1;
      let lastEnd = hits[i].offset + hits[i].length;
      for (let j = i + 1; j < hits.length && cursorOp < template.seq.length; j++) {
        if (consumed.has(j)) continue;
        const h = hits[j];
        if (h.offset - lastEnd > template.window) break;
        if (h.opId === template.seq[cursorOp]) {
          members.push(h);
          memberIdxs.push(j);
          lastEnd = h.offset + h.length;
          cursorOp++;
        } else if (template.optional.has(h.opId)) {
          continue;
        } else {
          // an unrelated hit inside the window breaks the bundle only if
          // it is itself a "heavy" operator; light/grammar primitives may
          // sit between members.
          const op = OP_BY_ID.get(h.opId);
          if ((op?.priority ?? 0) >= 5) break;
        }
      }
      if (cursorOp === template.seq.length) {
        out.push({
          id: uid('bun', counter++),
          name: template.name,
          opIds: members.map(m => m.opId),
          start: members[0].offset,
          end: members[members.length - 1].offset + members[members.length - 1].length,
          members,
          intent: template.intent,
        });
        memberIdxs.forEach(k => consumed.add(k));
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/* ---------------------------------------------------------------- *
 * 3. PIVOTS — medial concessive/causal/quotative split
 * ---------------------------------------------------------------- */

/** Operator categories that, when they fall in the sentence interior,
 *  carve the sentence into left-half (set-up) and right-half (payload). */
const PIVOT_CATEGORIES = new Set([
  'connective.concessive',
  'connective.causal',
  'quotative.attribution',
  // 'nominalization.definition' は P0.3 で除外(視座導入はピボットでない)
  'nominalization.explanation',
]);

/** Operators that almost always behave as pivots even outside those
 *  categories (explicit allow-list). Concessive/contrastive hinges
 *  outrank frame-openers — see rankPivots(). */
const PIVOT_OP_ALLOWLIST = new Set([
  'EXPLAIN-NOMINAL',          // なんですけど(も) — STRONG (rank 3, contrastive hinge)
  'CONCESSIVE-CONTRAST',      // けど・が — STRONG (rank 3)
  'GROUND-CLAIM',             // じゃないですか
  // 'PERSPECTIVE-STAGE-OPEN' は P0.3 で除外。視座導入であり、
  // 切断点ではなく舞台上げ。pivot に昇格させると req#21 のような
  // 召喚枠が誤分割される。視座は parts レイヤで観測する。
  'CAUSAL-DERIVE',            // から — MEDIUM (rank 2)
  'CAUSAL-DEPENDENT',         // ので — MEDIUM (rank 2)
  'QUOTATIVE-ATTRIB',         // という — WEAK (rank 1)
]);

/** Pivot rank — higher wins when multiple pivot candidates exist in one
 *  sentence. Discourse meaning: the contrastive hinge IS the pivot;
 *  frame-openers (like っていうのは) only become pivots in the absence
 *  of a stronger hinge. */
const PIVOT_RANK = {
  'EXPLAIN-NOMINAL':     3,
  'CONCESSIVE-CONTRAST': 3,
  'GROUND-CLAIM':        2,
  'CAUSAL-DERIVE':       2,
  'CAUSAL-DEPENDENT':    2,
  'PERSPECTIVE-STAGE-OPEN': 1,
  'QUOTATIVE-ATTRIB':    1,
};

/**
 * For each pivot-eligible hit located in the sentence interior (not at
 * position 0 and not within 2 chars of end), emit a pivot record with
 * leftSpan = [0, hit.offset], rightSpan = [hit.offset + hit.length, end].
 *
 * @param {string} text
 * @param {Array<any>} hits
 */
export function detectPivots(text, hits) {
  const all = [];
  const end = text.length;
  let counter = 0;
  for (const h of hits) {
    if (h.emergent) continue;
    const isPivot = PIVOT_OP_ALLOWLIST.has(h.opId) ||
                    PIVOT_CATEGORIES.has(h.opCategory);
    if (!isPivot) continue;
    const start = h.offset;
    const stop  = h.offset + h.length;
    // Must be medial — leave at least 2 chars on each side.
    if (start < 2 || stop > end - 2) continue;
    all.push({
      id: uid('pivot', counter++),
      opId: h.opId,
      opCategory: h.opCategory,
      anchor: { offset: start, length: stop - start, surface: h.surface },
      leftSpan: [0, start],
      rightSpan: [stop, end],
      type: PIVOT_OP_ALLOWLIST.has(h.opId) ? 'lex' : 'cat',
      rank: PIVOT_RANK[h.opId] ?? 1,
      intent: `${h.glossJa}を支点に左辺=前提、右辺=主張本体`,
    });
  }
  return rankPivots(all);
}

/** Keep only the highest-rank pivot(s). Discourse meaning: a sentence
 *  has ONE true pivot — the strongest hinge. Weaker frame-openers and
 *  causal connectors that also happen to be medial are demoted out of
 *  the pivot view; they remain visible as ordinary hits. When multiple
 *  pivots tie at the top rank (e.g. two けど), keep both. */
function rankPivots(pivots) {
  if (pivots.length <= 1) return pivots;
  const maxRank = Math.max(...pivots.map(p => p.rank));
  return pivots.filter(p => p.rank === maxRank);
}

/* ---------------------------------------------------------------- *
 * 4. DISCOURSE MOVES — meaning over morphology
 * ---------------------------------------------------------------- *
 * These detectors do not look for adjacency of N opIds and emit a
 * pseudo-bundle; they look for a relation TYPE between the hits that
 * carries a distinct cognitive force.
 *
 *   stance-package         TEMPORAL-NOW + EXPECTATION-CONFIRM (either
 *                          order, ≤4 chars apart) → one alignment move
 *
 *   parallel-frame-couple  same-label span opened twice in one sentence
 *                          with a CONCESSIVE-CONTRAST / EXPLAIN-NOMINAL
 *                          between them → mirrored opposition
 *
 *   suspended-narrative    sentence-final と (or という) with no
 *                          quotative-verb close → biographical hand-off
 *
 *   narrative-launch       sentence-initial でね / それで / それでね /
 *                          んでね / ほんで → new biographical installment
 * ---------------------------------------------------------------- */

/** @param {string} text @param {Array<any>} hits @param {Array<any>} spans */
export function detectMoves(text, hits, spans) {
  /** @type {Array<any>} */
  const moves = [];
  let counter = 0;

  // -------- stance-package: TEMPORAL-NOW <-> EXPECTATION-CONFIRM adjacency
  const nowHits  = hits.filter(h => h.opId === 'TEMPORAL-NOW');
  const expHits  = hits.filter(h => h.opId === 'EXPECTATION-CONFIRM');
  for (const n of nowHits) for (const e of expHits) {
    const a = n.offset < e.offset ? n : e;
    const b = n.offset < e.offset ? e : n;
    const gap = b.offset - (a.offset + a.length);
    if (gap < 0 || gap > 4) continue;
    moves.push({
      id: uid('move', counter++),
      name: 'STANCE-PACKAGE',
      start: a.offset,
      end: b.offset + b.length,
      members: [a.opId, b.opId],
      hostOpId: null,             // filled below if it sits inside a span
      intent: '時点固定+期待確認を一つの「君も既に知っているはずだよね」 として束ねる',
    });
  }
  // Attach each stance-package to the innermost span that contains it,
  // making the discourse role visible: "stance halo of frame X".
  for (const m of moves.filter(x => x.name === 'STANCE-PACKAGE')) {
    let host = null;
    for (const sp of spans) {
      if (sp.start <= m.start && sp.end >= m.end) {
        if (!host || (sp.end - sp.start) < (host.end - host.start)) host = sp;
      }
    }
    if (host) m.hostOpId = host.openHit.opId;
  }

  // -------- parallel-frame-couple: two same-label spans flanking a CONCESSIVE
  const concessiveHits = hits.filter(h =>
    h.opId === 'CONCESSIVE-CONTRAST' || h.opId === 'EXPLAIN-NOMINAL'
  );
  const byLabel = new Map();
  for (const sp of spans) {
    const arr = byLabel.get(sp.label) ?? [];
    arr.push(sp);
    byLabel.set(sp.label, arr);
  }
  for (const [label, list] of byLabel) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const left = list[i], right = list[j];
        const between = concessiveHits.find(h =>
          h.offset > left.start && h.offset < right.start
        );
        if (!between) continue;
        moves.push({
          id: uid('move', counter++),
          name: 'PARALLEL-FRAME-COUPLE',
          start: left.start,
          end: right.end,
          members: [left.openHit.opId, between.opId, right.openHit.opId],
          label,
          // Trim the left frame at the hinge — when the underlying span
          // is unclosed it would otherwise swallow the right frame.
          leftFrame:  { start: left.start,  end: Math.min(left.end, between.offset),
                         text: text.slice(left.start, Math.min(left.end, between.offset)) },
          hinge:      { offset: between.offset, surface: between.surface, opId: between.opId },
          rightFrame: { start: right.start, end: right.end,
                         text: text.slice(right.start, right.end) },
          intent: `同じ「${label}」枠が「${between.surface}」を挟んで二度開かれる → 二極対比`,
        });
      }
    }
  }

  // -------- suspended-narrative: sentence-final と without quotative-verb close
  const trimmed = text.replace(/[。．！？!?\s]+$/, '');
  const endsWithTo = /と$/.test(trimmed) || /という$/.test(trimmed);
  if (endsWithTo) {
    const closed = hits.some(h =>
      h.opId === 'QUOTATIVE-SPEECH' ||
      h.opId === 'PASSIVE-HEARSAY'   ||
      h.opId === 'EPISTEMIC-THINK'   ||
      h.closesSpan === 'quotative'
    );
    if (!closed) {
      moves.push({
        id: uid('move', counter++),
        name: 'SUSPENDED-NARRATIVE',
        start: trimmed.length - 1,
        end: trimmed.length,
        members: ['QUOTATIVE-ATTRIB'],
        intent: '文末「と」で引用閉じる動詞を出さず → 命題を伝記的事実として手渡す',
      });
    }
  }

  // -------- narrative-launch: sentence-initial でね / それで(ね) / んでね / ほんで
  const headMatch = text.match(/^[\s　]*((?:でね|それでね|それで|んでね|ほんで|そんでね|そんで)[、，])/);
  if (headMatch) {
    moves.push({
      id: uid('move', counter++),
      name: 'NARRATIVE-LAUNCH',
      start: headMatch.index ?? 0,
      end: (headMatch.index ?? 0) + headMatch[1].length,
      members: [],
      surface: headMatch[1],
      intent: '前ターンを引き取り新しい伝記的展開を起動',
    });
  }

  return moves.sort((a, b) => a.start - b.start);
}

/* ---------------------------------------------------------------- *
 * 5. Public sentence-level driver
 * ---------------------------------------------------------------- */

/**
 * Run all analyses on a sentence and return the structural artefacts.
 * Mutates nothing; caller stores onto sentence object.
 */
export function structuralAnalysis(text, hits) {
  const spans   = computeSpans(text, hits);
  const bundles = detectBundles(text, hits);
  const pivots  = detectPivots(text, hits);
  const moves   = detectMoves(text, hits, spans);
  return { spans, bundles, pivots, moves };
}
