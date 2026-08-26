/**
 * relevance.ts — §29 rung 0: does this substring MEAN this word?
 *
 * ## Why this is the floor under everything
 *
 * MEASURED 2026-08-25 on the live corpus (2,480 tweets, 1,183,143 chars):
 * 足して occurs 23 times and **every one of them is a false friend** —
 * 満足して×15, 不足して×7, 補足して×1, and zero occurrences of 足す. The X
 * view ranked all 23 by recency and called them results. No ranking repairs
 * that, because the list is not mis-ordered; it is wrong. Precision comes
 * first or nothing above it means anything.
 *
 * ## The test, and why it is the same test three times
 *
 * §29.1: greedy matching fails at three boundaries — word, construction,
 * register — and the SAME move fixes each: extend the context, ask whether the
 * extension produces a swallower, type what remains. This module is that move
 * at the word scale. `deinflect` is pure and synchronous and `DictionaryStore`
 * is in-memory, so the whole thing runs at render time with no async plumbing.
 *
 * A hit is a FALSE FRIEND when some extension of the matched span is itself a
 * word the shelf knows: 満足して ⊃ 足して, so the match belongs to 満足する and
 * not to 足す. False friends are never deleted — they are demoted to a
 * collapsed 部分一致 tail that NAMES its swallowers (§28 S6: degrade honestly,
 * in place). A confident list of 23 wrong answers is the failure this replaces;
 * an empty list would be the same failure wearing modesty.
 *
 * ## What this deliberately does NOT do
 *
 * No segmenter, no parser — typing is deinflect+lookup only, which is the
 * plugin's standing bet (§29.4). The consequence, stated rather than hidden:
 * the test cannot tell a swallower that KILLS the reading (満足 ⊅ 足す) from a
 * compound that CONTAINS it (第一印象 ⊃ 印象). Both are demoted, both are
 * named, and the hand can see and overrule either — which is why the tail is a
 * tail and not a deletion. `reach` is exposed as a knob rather than guessed at.
 *
 * Verdict labels (顕在/偏在/競合/沈黙・有意/沈黙・無力/圏外) are rung 3 and live
 * in probe.ts; rung 0's job is to make the counts honest enough to label.
 */

/** The two dictionary faculties this needs, injected so the core stays pure. */
export interface Oracle {
  /** surface → candidate dictionary forms with their trails (deinflect.ts). */
  deinflect: (s: string) => Array<{ term: string; trail: string[] }>;
  /** does the shelf hold this as a headword? */
  isWord: (s: string) => boolean;
}

/** One raw substring occurrence, before it has been believed. */
export interface RawHit {
  /** the document it sits in — a tweet id, a note path, anything stable. */
  id: string;
  /** the full text the span indexes into. */
  text: string;
  /** [start, end) of the matched substring in `text`. */
  span: [number, number];
}

export type HitVerdict =
  /** the span really is the query's word, with the trail that proves it. */
  | { kind: 'true'; trail: string[] }
  /** a longer word covers the span; `swallower` is that word, as the shelf spells it. */
  | { kind: 'partial'; swallower: string; surface: string };

export interface JudgedHit extends RawHit {
  verdict: HitVerdict;
}

export interface TrueHitResult {
  /** hits that survived the boundary test, in input order. */
  hits: JudgedHit[];
  /** the demoted tail — never dropped, always named. */
  partial: JudgedHit[];
  /** distinct swallowers, most frequent first, for the tail's own label. */
  swallowers: Array<{ term: string; count: number }>;
}

/** How far to extend on each side when hunting a swallower. A KNOB (§29.4). */
export const DEFAULT_REACH = 4;

/** Is this surface a word the shelf knows, directly or after deinflection? */
function readsAsWord(surface: string, oracle: Oracle): string | null {
  if (oracle.isWord(surface)) return surface;
  for (const d of oracle.deinflect(surface)) {
    if (oracle.isWord(d.term)) return d.term;
  }
  return null;
}

/**
 * Every word the MATCH ITSELF resolves to.
 *
 * Load-bearing: an extension only swallows the match when it belongs to a
 * DIFFERENT word. 足してみた deinflects straight back to 足す, so without this
 * the test demoted the very hits it exists to protect — the query's own word,
 * wearing more inflection, reported as its own false friend. 満足する ∉ {足す}
 * is a swallower; 足す ∈ {足す} is just a longer sleeve.
 */
function ownWords(match: string, oracle: Oracle): Set<string> {
  const own = new Set<string>();
  if (oracle.isWord(match)) own.add(match);
  for (const d of oracle.deinflect(match)) {
    if (oracle.isWord(d.term)) own.add(d.term);
  }
  return own;
}

/**
 * Judge ONE occurrence. Extensions are tried smallest-first, so the swallower
 * reported is the tightest one — 満足する for 満足して, not whatever longer
 * string also happens to parse.
 */
export function judgeHit(
  text: string,
  span: [number, number],
  oracle: Oracle,
  reach: number = DEFAULT_REACH,
): HitVerdict {
  const [s, e] = span;
  const match = text.slice(s, e);
  const own = ownWords(match, oracle);

  // smallest-first: total extension 1, then 2, … so the tightest cover wins
  for (let total = 1; total <= reach * 2; total++) {
    for (let left = 0; left <= Math.min(total, reach); left++) {
      const right = total - left;
      if (right > reach) continue;
      const from = s - left;
      const to = e + right;
      if (from < 0 || to > text.length) continue;
      const surface = text.slice(from, to);
      if (surface === match) continue;
      const word = readsAsWord(surface, oracle);
      if (word && !own.has(word)) return { kind: 'partial', swallower: word, surface };
    }
  }

  // Nothing swallows it. Carry the trail when the match itself deinflects to
  // something the shelf knows — that is the 〈…〉 badge's evidence (invariant 3).
  for (const d of oracle.deinflect(match)) {
    if (own.has(d.term)) return { kind: 'true', trail: d.trail };
  }
  return { kind: 'true', trail: [] };
}

/**
 * Judge every occurrence and split the list. Input order is preserved inside
 * each half: ranking is rung 1's job and does not belong here.
 */
export function trueHits(
  raw: RawHit[],
  oracle: Oracle,
  reach: number = DEFAULT_REACH,
): TrueHitResult {
  const hits: JudgedHit[] = [];
  const partial: JudgedHit[] = [];
  const counts = new Map<string, number>();

  for (const r of raw) {
    const verdict = judgeHit(r.text, r.span, oracle, reach);
    if (verdict.kind === 'true') hits.push({ ...r, verdict });
    else {
      partial.push({ ...r, verdict });
      counts.set(verdict.swallower, (counts.get(verdict.swallower) ?? 0) + 1);
    }
  }

  const swallowers = [...counts.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));

  return { hits, partial, swallowers };
}

/**
 * Every occurrence of `query` in `text`, as spans. Plain indexOf — finding is
 * not the hard part and never was; believing is.
 */
export function occurrences(id: string, text: string, query: string): RawHit[] {
  const out: RawHit[] = [];
  if (!query) return out;
  let i = text.indexOf(query);
  while (i !== -1) {
    out.push({ id, text, span: [i, i + query.length] });
    i = text.indexOf(query, i + 1);
  }
  return out;
}

/**
 * The tail's own sentence — 「部分一致 23件（満足する×15・不足する×7・補足する×1）」.
 * A count with no nouns attached is the thing this section exists to stop.
 */
export function partialLabel(r: TrueHitResult): string {
  if (!r.partial.length) return '';
  const named = r.swallowers.slice(0, 3).map((s) => `${s.term}×${s.count}`).join('・');
  const rest = r.swallowers.length > 3 ? `・ほか${r.swallowers.length - 3}語` : '';
  return `部分一致 ${r.partial.length}件（${named}${rest}）`;
}


/* ── §29 rung 1: relevance is a FUNCTION OF CLASS ───────────────────────────
 *
 * The old sort was one formula for everything — newest first — which is the
 * one axis that means nothing about language. But there is no single better
 * formula either, and that is the actual finding: **each note-type has its own
 * notion of what a relevant hit even IS.** A 🟡 wants a verbatim echo. A 🟠
 * wants its two anchors in order with little between them. A 🟢 does not want
 * its string at all — it wants its halo, the context that evokes it. Ranking
 * them with one comparator is the same category error as rendering six classes
 * in one colour.
 *
 * So: one comparator per class, each returning a score AND its own stated
 * reason. Every offer carries its why (§21 / HOLE rule 1) — a ranked list whose
 * order cannot explain itself is a verdict, and the machine does not get to
 * issue verdicts. Recency and likes survive only as tiebreaks, which is the one
 * honest role they ever had.
 *
 * Scores are 0..10-ish and deliberately coarse. This ships crude with knobs
 * exposed, per house rule, and gets tuned on glass.
 */

/** The catalog entry being asked about — what makes "relevant" mean something. */
export interface Probe {
  cls: string;
  key: string;
  payload?: {
    parts?: string[];
    frame?: string;
    lemma?: string;
    halo?: string;
  };
}

export interface Ranked<T> {
  item: T;
  score: number;
  /** why this rank — shown, never hidden. */
  why: string;
}

/** How far apart 🟠 anchors may sit before the link stops reading as one. A KNOB. */
export const DEFAULT_LINK_WINDOW = 30;

/** Fixed material of a 💠 frame: the parts either side of its ○○ holes. */
function frameFixed(frame: string): string[] {
  return frame.split(/[○〇]{2,}/).map((p) => p.trim()).filter((p) => p.length >= 2);
}

/** Ordered occurrence of every part, with the total material between them. */
function orderedGap(text: string, parts: string[]): { found: boolean; gap: number } {
  let cursor = 0;
  let gap = 0;
  for (let i = 0; i < parts.length; i++) {
    const at = text.indexOf(parts[i], cursor);
    if (at === -1) return { found: false, gap: 0 };
    if (i > 0) gap += at - cursor;
    cursor = at + parts[i].length;
  }
  return { found: true, gap };
}

/**
 * Score ONE text against the probe, in the probe's own class's terms.
 * Exported so a caller can explain a single row without re-ranking the list.
 */
export function scoreFor(text: string, probe: Probe, window: number = DEFAULT_LINK_WINDOW): { score: number; why: string } {
  const p = probe.payload ?? {};

  switch (probe.cls) {
    /* 🟡 セリフ — the whole thought. A verbatim echo is the only strong hit;
     * anything else is a different utterance that happens to share material. */
    case 'serifu': {
      if (probe.key && text.includes(probe.key)) return { score: 10, why: '逐語のこだま' };
      const half = probe.key.slice(0, Math.max(4, Math.floor(probe.key.length / 2)));
      if (half.length >= 4 && text.includes(half)) return { score: 4, why: '前半が一致' };
      return { score: 1, why: '素材の一部だけ' };
    }

    /* 🔵 連語 — a two-word bond. Adjacency IS the claim: the closer the
     * components sit, the more it is the bond rather than coincidence. */
    case 'collocation': {
      const parts = p.parts?.length ? p.parts : [probe.key];
      if (parts.length < 2) {
        return text.includes(probe.key)
          ? { score: 6, why: '連語そのもの' }
          : { score: 0, why: '不一致' };
      }
      const o = orderedGap(text, parts);
      if (!o.found) return { score: 0, why: '成分がそろわない' };
      if (o.gap === 0) return { score: 10, why: '成分が隣接' };
      if (o.gap <= 4) return { score: 7, why: `成分間 ${o.gap}字` };
      return { score: 3, why: `成分は離れている（${o.gap}字）` };
    }

    /* 🟢 修辞連語 — a lemma radiating a halo. The STRING is not the hit; the
     * evoked context is. A bare lemma with none of its halo is the weak case,
     * which is exactly backwards from how substring search treats it. */
    case 'rhet_collocation': {
      const lemma = p.lemma ?? probe.key;
      const halo = p.halo ?? '';
      const hasLemma = !!lemma && text.includes(lemma);
      const hasHalo = halo.length >= 2 && text.includes(halo);
      if (hasLemma && hasHalo) return { score: 10, why: 'レンマ＋ハロー' };
      if (hasHalo) return { score: 7, why: 'ハローの文脈' };
      if (hasLemma) return { score: 3, why: 'レンマのみ（喚起は未確認）' };
      return { score: 0, why: '不一致' };
    }

    /* 🟠 骨格構文 — the link survives while the fillers are context. Parts in
     * ORDER is the test; the material between them is the 介在プロフィール,
     * a result rather than noise, so it is reported rather than thresholded
     * away. */
    case 'skeletal': {
      const parts = (p.parts ?? []).filter((x) => x.length >= 1);
      if (parts.length < 2) return { score: 0, why: '成分が足りない' };
      const o = orderedGap(text, parts);
      if (!o.found) return { score: 0, why: '順序どおりに現れない' };
      if (o.gap > window) return { score: 2, why: `離れすぎ（${o.gap}字）` };
      if (o.gap <= 6) return { score: 10, why: `密なリンク（介在 ${o.gap}字）` };
      return { score: 6, why: `リンク成立（介在 ${o.gap}字）` };
    }

    /* 💠 慣用構文 — the frame is solid and the holes are open. A hit needs the
     * FIXED material, in order; what fills the hole is the finding, not the
     * criterion. */
    case 'phrase_schema': {
      const fixed = frameFixed(p.frame ?? probe.key);
      if (!fixed.length) return { score: 0, why: '固定部がない' };
      const o = orderedGap(text, fixed);
      if (!o.found) return { score: 0, why: '固定部がそろわない' };
      return o.gap <= window
        ? { score: 9, why: `型が成立（穴 ${o.gap}字）` }
        : { score: 3, why: `固定部は離れている（${o.gap}字）` };
    }

    /* 🔴 談話 — what the utterance DOES to the conversation. Without prior
     * turns on a tweet, position is the only witness available: a move that
     * opens a post is doing discourse work, one buried mid-clause is usually
     * the same string doing something else. Weak by construction, and it says
     * so — this is the class a corpus of isolated posts can least support. */
    case 'discourse': {
      const at = text.indexOf(probe.key);
      if (at === -1) return { score: 0, why: '不一致' };
      if (at === 0) return { score: 8, why: '発話の冒頭' };
      if (at <= 6) return { score: 5, why: '冒頭近く' };
      return { score: 2, why: '節中（談話機能は未確認）' };
    }

    default:
      return text.includes(probe.key) ? { score: 5, why: '一致' } : { score: 0, why: '不一致' };
  }
}

/**
 * Rank in the probe's class's own terms. `tie` is the ONLY place recency or
 * likes may speak — they break ties between linguistically equal hits and
 * never decide the order themselves.
 */
export function rankByClass<T extends { text: string }>(
  items: T[],
  probe: Probe,
  tie: (a: T, b: T) => number = () => 0,
  window: number = DEFAULT_LINK_WINDOW,
): Array<Ranked<T>> {
  return items
    .map((item) => {
      const { score, why } = scoreFor(item.text, probe, window);
      return { item, score, why };
    })
    .sort((a, b) => b.score - a.score || tie(a.item, b.item));
}
