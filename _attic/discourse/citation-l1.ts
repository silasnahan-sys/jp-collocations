/**
 * citation-l1.ts — と / って / という node-type disambiguator.
 *
 * Given a sentence string, finds every と-family particle occurrence and
 * classifies it into one of ToNodeKind. This is the gate for L2+: only
 * CITATION_TOKINDS proceed.
 *
 * Approach: single linear scan + local window inspection. We do NOT run
 * a morphological analyzer — heuristics are tuned against
 * `_tmp_inyou_gold.json` and validated by `_tmp_classifier_eval.mjs`.
 *
 * Performance contract: O(n) in sentence length, no regex backtracking
 * on right context (anchored RE only, length-capped windows).
 */

import type { CitationLocator, ToNodeKind } from './citation-types';

export interface L1Hit {
  /** Surface form of the matched particle / complementizer. */
  marker: '\u3068' | '\u3063\u3066' | '\u3068\u3044\u3046' | '\u3068\u3044\u3046\u3053\u3068' | '\u3063\u3066\u3044\u3046' | '\u3063\u3066\u3044\u3046\u3053\u3068';
  /** Char offset of marker start (within the sentence). */
  offset: number;
  /** Char offset of marker end (exclusive). */
  endOffset: number;
  /** Classified node-kind. */
  toKind: ToNodeKind;
  /** Span of the cited content (best-effort left edge → marker start). */
  citedStart: number;
  citedEnd: number;
  /** Surface form of the cited span. */
  citedSurface: string;
  /** Local right-context window used for classification. */
  rightContext: string;
  /** Why we picked this kind (for debugging / eval error analysis). */
  rationale: string;
  /** L1 confidence 0..1 — softer when right-context is ambiguous. */
  confidence: number;
}

// ── Right-context probes (anchored at marker end) ─────────────────
// Each probe inspects the ~24 chars AFTER the と / って.
// Patterns are matched in priority order; first match wins.

interface Probe {
  re: RegExp;
  kind: ToNodeKind;
  confidence: number;
  rationale: string;
}

const RIGHT_PROBES: Probe[] = [
  // Authority-invocation verbs (passive cognitive) → citation, quote-particle
  { re: /^(?:\u3055\u308c|\u3055\u308c\u308b|\u3055\u308c\u3066|\u3055\u308c\u305f|\u3055\u308c\u3066\u3044\u308b|\u3055\u308c\u3066\u3044\u305f)/, kind: 'quote-particle', confidence: 0.92, rationale: 'auth-invocation: とされる/とされている' },
  { re: /^(?:\u8003\u3048\u3089\u308c|\u601d\u308f\u308c|\u8a00\u308f\u308c|\u898b\u3089\u308c)/, kind: 'quote-particle', confidence: 0.92, rationale: 'auth-invocation: と考えられる/と思われる/と言われる/と見られる' },

  // Speech / cognition verbs → quote-particle (high confidence)
  { re: /^(?:\u8a00[\u3046\u3063\u308f\u3048\u3044]|\u601d[\u3046\u3063\u308f\u3048\u3044]|\u8003\u3048|\u611f\u3058|\u805e[\u304b\u3044\u3051\u3053]|\u66f8[\u3044\u304b\u3051\u3053]|\u547c[\u3076\u3093\u3070\u3093\u3060])/, kind: 'quote-particle', confidence: 0.95, rationale: 'speech/cognition verb follows' },
  { re: /^(?:\u3044\u3046|\u3044\u3063\u3066|\u3044\u308f|\u3044\u308f\u305a)/, kind: 'quote-particle', confidence: 0.85, rationale: 'いう/いって follows (hiragana speech verb)' },
  { re: /^(?:\u601d\u3063\u305f|\u601d\u3046|\u601d\u3063\u3066|\u601d\u3063\u3061\u3083)/, kind: 'quote-particle', confidence: 0.95, rationale: 'mental-cite verb 思う family' },

  // Reification: ということ / という+N
  { re: /^\u3044\u3046\u3053\u3068/, kind: 'complementizer', confidence: 0.95, rationale: 'ということ reification to コト-NP' },
  { re: /^\u3044\u3046(?:\u306e|\u306e\u306f|\u306e\u304c|\u306e\u3082|\u3082\u306e|\u306f\u306a\u3057|\u3088\u3046)/, kind: 'complementizer', confidence: 0.85, rationale: 'というの/というもの/というよう reification' },
  // という followed by content-noun (kanji/katakana run) → complementizer
  { re: /^\u3044\u3046[\u4e00-\u9fff\u30a0-\u30ff\u3041-\u3093]{1,12}/, kind: 'complementizer', confidence: 0.80, rationale: 'という+N reification' },

  // Depictive/cognitive: とする / とみなす / とおく / と決める
  { re: /^(?:\u3057|\u3057\u3066|\u3057\u305f|\u3059\u308b)/, kind: 'depictive', confidence: 0.70, rationale: 'とする depictive (cognitive complement)' },
  { re: /^(?:\u307f\u306a[\u3057\u3059\u305b]|\u898b\u306a[\u3057\u3059])/, kind: 'depictive', confidence: 0.85, rationale: 'とみなす depictive' },
  { re: /^\u6c7a\u3081[\u305f\u308b\u3066]/, kind: 'depictive', confidence: 0.80, rationale: 'と決める depictive' },

  // Resultative — NON-citation
  { re: /^(?:\u306a\u3063?\u305f|\u306a\u308b|\u306a\u3063\u3066|\u306a\u308a)/, kind: 'resultative', confidence: 0.90, rationale: 'となる resultative state-becoming' },
  { re: /^(?:\u5316[\u3057\u3059])/, kind: 'resultative', confidence: 0.90, rationale: 'と化す resultative' },

  // Conditional — NON-citation. と + clause continuation.
  { re: /^(?:\u3001|\u3000|\u3001\s)/, kind: 'conditional', confidence: 0.55, rationale: 'と、 — likely conditional/temporal (low-conf gate)' },
];

// ── Left-context indicators ───────────────────────────────────────

/** Direct quote bracket immediately preceding と. */
const RE_LEFT_BRACKET = /\u300c[^\u300d]{1,80}\u300d$/;

/** Hearsay / common-knowledge ending that already absorbs the と. */
const RE_HEARSAY_RIGHT = /^(?:\u3089\u3057\u3044|\u305d\u3046\u3060|\u305d\u3046\u3067\u3059|\u307f\u305f\u3044)/;

// ── Particle finder ───────────────────────────────────────────────

/** Match と (alone), って, という, ということ, っていう, っていうこと. */
const RE_PARTICLE = /\u3068\u3044\u3046\u3053\u3068|\u3063\u3066\u3044\u3046\u3053\u3068|\u3068\u3044\u3046|\u3063\u3066\u3044\u3046|\u3063\u3066|\u3068/g;

const RIGHT_WINDOW = 24;
const LEFT_WINDOW = 80;

/**
 * Walk left from `offset` and find the start of the cited span — the
 * nearest sentence-internal boundary (。、？！「 or BOS).
 */
function citedLeftEdge(text: string, offset: number): number {
  const start = Math.max(0, offset - LEFT_WINDOW);
  let edge = start;
  // bracket has priority
  for (let i = offset - 1; i >= start; i--) {
    const ch = text.charAt(i);
    if (ch === '\u300c') { return i; }              // 「 opening
    if (ch === '\u3002' || ch === '\u3001' || ch === '\uff1f' || ch === '\uff01' || ch === '?' || ch === '!') {
      edge = i + 1;
      break;
    }
  }
  // skip whitespace
  while (edge < offset && /\s/.test(text.charAt(edge))) { edge++; }
  return edge;
}

/** Tighten coordinator/comitative detection: と with NP on both sides. */
function looksComitativeOrList(text: string, leftStart: number, leftEnd: number, rightCtx: string): boolean {
  const left = text.slice(leftStart, leftEnd);
  // Left side must look like a single noun (no predicate ending).
  const leftIsNoun = /^[\u4e00-\u9fff\u30a0-\u30ff\u3041-\u3093A-Za-z0-9\u30fc]{1,16}$/.test(left.trim());
  if (!leftIsNoun) { return false; }
  // Right side must start with another noun-like token followed by particle.
  // Allow: NP+の / NP+が / NP+を / NP+は / NP+, …
  // Reject if right starts with a verbal morpheme — that's caught above.
  const rightNoun = /^[\u4e00-\u9fff\u30a0-\u30ff\u3041-\u3093A-Za-z0-9\u30fc]{1,16}(?:\u306e|\u304c|\u3092|\u306f|\u3082|\u3068|\u3001|\u3067|\u306b|$)/.test(rightCtx);
  return rightNoun;
}

export interface L1Options {
  /** Override or extend right-context probes (prepended). */
  extraProbes?: Probe[];
  /** Drop hits with confidence below this. Default 0. */
  minConfidence?: number;
}

/**
 * Classify every と-family marker in a sentence.
 *
 * @param sentence  NFC-normalized sentence text
 * @param locatorBase  CitationLocator for sentence start (transcriptId,
 *                     sentenceIdx, charStart=sentence's offset in transcript,
 *                     charEnd ignored — recomputed per hit)
 */
export function classifyL1(sentence: string, locatorBase: Omit<CitationLocator, 'charEnd'>, opts: L1Options = {}): L1Hit[] {
  const minConf = opts.minConfidence ?? 0;
  const probes = opts.extraProbes ? [...opts.extraProbes, ...RIGHT_PROBES] : RIGHT_PROBES;
  const hits: L1Hit[] = [];

  RE_PARTICLE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_PARTICLE.exec(sentence)) !== null) {
    const offset = m.index;
    const marker = m[0] as L1Hit['marker'];
    const endOffset = offset + marker.length;
    const right = sentence.slice(endOffset, endOffset + RIGHT_WINDOW);

    // Skip if the longer marker already consumed this position (regex
    // alternation handles longest-first ordering already, but be safe).
    if (hits.length > 0) {
      const prev = hits[hits.length - 1];
      if (offset < prev.endOffset) { continue; }
    }

    // Hearsay markers ARE citations; we treat the と as a quote-particle
    // when followed by らしい / そうだ etc. (the と is then optional in
    // surface, but if present it's still citational).
    let toKind: ToNodeKind = 'unknown';
    let confidence = 0.4;
    let rationale = 'no probe matched';

    // Direct-bracket left context dominates: 「…」と → quote-particle
    const leftSlice = sentence.slice(Math.max(0, offset - LEFT_WINDOW), offset);
    if (RE_LEFT_BRACKET.test(leftSlice) && (marker === '\u3068' || marker === '\u3063\u3066')) {
      toKind = 'quote-particle';
      confidence = 0.98;
      rationale = 'direct 「」 bracket left + と/って';
    } else {
      // Long markers (という, ということ, etc.) already encode complementizer
      // semantics; classify by suffix.
      if (marker === '\u3068\u3044\u3046\u3053\u3068' || marker === '\u3063\u3066\u3044\u3046\u3053\u3068') {
        toKind = 'complementizer';
        confidence = 0.95;
        rationale = 'ということ/っていうこと explicit complementizer';
      } else if (marker === '\u3068\u3044\u3046' || marker === '\u3063\u3066\u3044\u3046') {
        // という + N → complementizer; ということ already handled
        if (/^[\u4e00-\u9fff\u30a0-\u30ff\u3041-\u3093]{1,12}/.test(right)) {
          toKind = 'complementizer';
          confidence = 0.85;
          rationale = 'という/っていう + N reification';
        } else {
          toKind = 'quote-particle';
          confidence = 0.7;
          rationale = 'という/っていう no N — speech-act use';
        }
      } else {
        // Bare と or って — run probes
        let matched = false;
        for (const p of probes) {
          if (p.re.test(right)) {
            toKind = p.kind;
            confidence = p.confidence;
            rationale = p.rationale;
            matched = true;
            break;
          }
        }
        if (!matched) {
          // Last-resort heuristics
          const citedStart = citedLeftEdge(sentence, offset);
          if (looksComitativeOrList(sentence, citedStart, offset, right)) {
            toKind = 'comitative';
            confidence = 0.65;
            rationale = 'NP と NP shape — comitative/list';
          } else if (endOffset >= sentence.length - 2) {
            // Sentence-final と (truncated terminal)
            toKind = 'quote-particle';
            confidence = 0.75;
            rationale = 'sentence-final と — truncated-terminal citation';
          } else {
            // Default to quote-particle with low confidence (will be
            // pruned by minConfidence if caller is strict).
            toKind = 'quote-particle';
            confidence = 0.45;
            rationale = 'fallback: と with no strong cue';
          }
        }
      }
    }

    if (confidence < minConf) { continue; }

    const citedStart = citedLeftEdge(sentence, offset);
    hits.push({
      marker,
      offset,
      endOffset,
      toKind,
      citedStart,
      citedEnd: offset,
      citedSurface: sentence.slice(citedStart, offset),
      rightContext: right,
      rationale,
      confidence,
    });
  }

  return hits;
}

/** Convenience: get only citation-bearing hits (drop comitative/resultative/etc.). */
export function classifyL1Citations(sentence: string, locatorBase: Omit<CitationLocator, 'charEnd'>, opts: L1Options = {}): L1Hit[] {
  return classifyL1(sentence, locatorBase, opts).filter(h => h.toKind === 'quote-particle' || h.toKind === 'complementizer' || h.toKind === 'depictive');
}
