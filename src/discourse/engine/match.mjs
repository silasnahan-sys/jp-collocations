// _tmp_pipeline/match.mjs
// =====================================================================
// SENTENCE-LEVEL OPERATOR MATCHER
// ---------------------------------------------------------------------
// Given a single sentence (Japanese text), produce an ordered list of
// (operator, span) hits. Steps:
//
//   1. Tokenize: greedy-longest-match COMPOUNDS first, then char-by-char.
//      Result is a list of `token` records with surface + kind + offset.
//   2. Scan the lexicon TRIGGER_INDEX against the raw text (priority-sorted,
//      longest-first). For each match, validate:
//        - scope constraint (sentence-initial/final, clause-final, etc.)
//        - not_after / not_before exclusion windows
//        - filler suppression (if the token is in a filler slot)
//   3. Resolve overlaps: prefer higher-priority operator, then longer span.
//   4. Detect "sentence-final" position robustly: a trigger is sentence-
//      final iff (offset + length) is within the last N characters before
//      a hard punctuation or end-of-string.
//
// Output: array of HIT records, sorted by offset, with all metadata needed
// by relations.mjs to apply cross-operator relation rules.
// =====================================================================

import { COMPOUND_INDEX } from './compounds.mjs';
import { TRIGGER_INDEX, OPERATORS } from './lexicon.mjs';
import { STANDALONE_FILLERS, SENTENCE_INITIAL_MITIGATORS, isBackchannelOnly } from './fillers.mjs';

/** @typedef {{
 *   opId:string, opCategory:string, glossJa:string, cognitiveEffect:string,
 *   surface:string, offset:number, length:number,
 *   scope:string, position:'initial'|'medial'|'final'|'standalone',
 *   priority:number,
 *   opensSpan?:string, closesSpan?:string,
 *   composesWith?:Record<string,string>,
 *   requiresOneOf?:string[]
 * }} OperatorHit */

const HARD_PUNCT_RE = /[。！？!?]/;

/** Compute position of a match within a sentence. */
function classifyPosition(text, offset, length) {
  const trimmed = text.trim();
  if (!trimmed) return 'standalone';
  // Find first non-filler character offset.
  let initialEnd = 0;
  for (let i = 0; i < text.length; i++) {
    if (/\S/.test(text[i])) { initialEnd = i; break; }
  }
  // Sentence-final: match ends within ~6 chars of end (allowing trailing
  // copula + punctuation + final particles).
  const tail = text.slice(offset + length).trim();
  if (tail === '' || /^(?:です|ます|だ|ね|よ|な|か|っ|、|。|！|？|!|\?){0,6}$/.test(tail)) {
    return 'final';
  }
  if (offset <= initialEnd + 2) return 'initial';
  return 'medial';
}

/** Validate scope constraint against detected position. */
function scopeMatches(scope, position, text, offset, length) {
  switch (scope) {
    case 'anywhere': return true;
    case 'sentence-initial': return position === 'initial';
    case 'sentence-final':   return position === 'final';
    case 'clause-initial':   return position === 'initial' || isAfterClauseBoundary(text, offset);
    case 'clause-final':     return position === 'final' || isBeforeClauseBoundary(text, offset + length);
    case 'verbal-suffix':    return isAfterKanaVerbStem(text, offset);
    case 'copula-suffix':    return isAfterCopulaStem(text, offset);
    case 'adj-suffix':       return isAfterAdjStem(text, offset);
    case 'particle':         return true; // disambiguated later
    case 'after-noun':       return isAfterKanjiOrKatakana(text, offset);
    case 'after-verb':       return isAfterKanaVerbStem(text, offset);
    case 'after-clause':     return isAfterClauseBoundary(text, offset) || isAfterPredicate(text, offset);
    case 'standalone':       return position === 'standalone';
    default: return true;
  }
}

function isAfterClauseBoundary(text, offset) {
  if (offset === 0) return true;
  const prev = text[offset - 1];
  return /[、,。！？!?]/.test(prev);
}
function isBeforeClauseBoundary(text, offset) {
  if (offset >= text.length) return true;
  const next = text[offset];
  return /[、,。！？!?]/.test(next) || offset >= text.trimEnd().length;
}
function isAfterKanjiOrKatakana(text, offset) {
  if (offset === 0) return false;
  // Accept kanji, katakana, kana noun endings, and the も/が/を/に particle stems
  // (allows 〜どころで言えば where the noun cluster ends in hiragana).
  return /[一-龥々ァ-ヴーぁ-ん]/.test(text[offset - 1]);
}
function isAfterKanaVerbStem(text, offset) {
  if (offset === 0) return false;
  return /[一-龥々ぁ-ん]/.test(text[offset - 1]);
}
function isAfterCopulaStem(text, offset) {
  if (offset === 0) return false;
  const prev = text[offset - 1];
  return /[だで]/.test(prev) || /[一-龥々ァ-ヴーぁ-ん]/.test(prev);
}
function isAfterAdjStem(text, offset) {
  if (offset === 0) return false;
  return /[いくしさ]/.test(text[offset - 1]) || /[一-龥々]/.test(text[offset - 1]);
}
function isAfterPredicate(text, offset) {
  if (offset === 0) return false;
  // Predicate-final morphemes: verb finite (る/た/ない/etc.), i-adjective
  // final い, copula (だ/です/だった), aux (ある/いる/なる/みる).
  const slice = text.slice(Math.max(0, offset - 6), offset);
  if (/(?:る|た|だ|です|ます|ました|でした|ない|なかった|ある|あった|いる|いた|なる|なった|来る|来た|行く|行った|する|した|思う|思った|言う|言った|聞く|聞いた|見る|見た|書く|書いた|食べる|読む)$/.test(slice)) return true;
  // i-adjective final い (preceded by kana/kanji that isn't a particle).
  if (/[一-龥々ぁ-ん][いし]$/.test(slice) && !/[をにがはもでとへやかし]$/.test(slice)) {
    // exclude particle-final cases
    const beforePrev = text[offset - 2] || '';
    if (!/[をにがはもでとへやかしね]/.test(beforePrev)) return true;
  }
  return false;
}

/** Check exclusion windows. */
function notAfterOK(text, offset, list) {
  if (!list || !list.length) return true;
  const window = text.slice(Math.max(0, offset - 4), offset);
  return !list.some(s => window.endsWith(s));
}
function notBeforeOK(text, offset, length, list) {
  if (!list || !list.length) return true;
  const window = text.slice(offset + length, offset + length + 4);
  return !list.some(s => window.startsWith(s));
}

/**
 * Required-context constraints declared by the lexicon (typedef:
 * requires_preceding / requires_following). The value is a regex source
 * string (e.g. '[、。]' / '[たる]') matched against the text immediately
 * adjacent to the trigger. These were declared in the lexicon but never
 * enforced by the matcher, so constraints like
 *   { surface: 'なんか', scope: 'after-noun', requires_following: '[、。]' }
 * silently fired everywhere (every spoken-filler なんか mis-tagged as 例示).
 * Honoring them removes that systematic false-positive class.
 */
function precedingOK(text, offset, pattern) {
  if (!pattern) return true;
  return new RegExp('(?:' + pattern + ')$').test(text.slice(0, offset));
}
function followingOK(text, offset, length, pattern) {
  if (!pattern) return true;
  return new RegExp('^(?:' + pattern + ')').test(text.slice(offset + length));
}

/** Find all candidate hits, then resolve overlaps. */
export function matchSentence(text) {
  if (!text || isBackchannelOnly(text)) {
    return { hits: [], backchannel: isBackchannelOnly(text) };
  }
  /** @type {OperatorHit[]} */
  const candidates = [];

  for (const { op, trig } of TRIGGER_INDEX) {
    if (trig.surface) {
      let idx = 0;
      while ((idx = text.indexOf(trig.surface, idx)) !== -1) {
        const length = trig.surface.length;
        if (!notAfterOK(text, idx, trig.not_after)) { idx++; continue; }
        if (!notBeforeOK(text, idx, length, trig.not_before)) { idx++; continue; }
        if (!precedingOK(text, idx, trig.requires_preceding)) { idx++; continue; }
        if (!followingOK(text, idx, length, trig.requires_following)) { idx++; continue; }
        if (trig.requires_after_predicate && !isAfterPredicate(text, idx)) { idx++; continue; }
        const position = classifyPosition(text, idx, length);
        if (!scopeMatches(trig.scope, position, text, idx, length)) { idx++; continue; }

        // Filler suppression: token in filler slot AND token is a known filler
        if (position === 'initial' && SENTENCE_INITIAL_MITIGATORS.has(trig.surface)) {
          // mitigators do not emit operators (they modify, but we don't fire them as operators)
          idx++; continue;
        }
        if (STANDALONE_FILLERS.has(trig.surface) && position === 'standalone') { idx++; continue; }

        candidates.push({
          opId: op.id,
          opCategory: op.category,
          glossJa: op.gloss_ja,
          cognitiveEffect: op.cognitive_effect,
          surface: trig.surface,
          offset: idx,
          length,
          scope: trig.scope,
          position,
          priority: op.priority ?? 0,
          opensSpan: op.opens_span,
          closesSpan: op.closes_span,
          composesWith: op.composes_with,
          requiresOneOf: op.requires_one_of,
        });
        idx += length;
      }
    } else if (trig.regex) {
      const re = new RegExp(trig.regex.source, trig.regex.flags.includes('g') ? trig.regex.flags : trig.regex.flags + 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        const idx = m.index;
        const length = m[0].length;
        if (!notAfterOK(text, idx, trig.not_after)) continue;
        if (!notBeforeOK(text, idx, length, trig.not_before)) continue;
        if (!precedingOK(text, idx, trig.requires_preceding)) continue;
        if (!followingOK(text, idx, length, trig.requires_following)) continue;
        if (trig.requires_after_predicate && !isAfterPredicate(text, idx)) continue;
        const position = classifyPosition(text, idx, length);
        if (!scopeMatches(trig.scope, position, text, idx, length)) continue;
        candidates.push({
          opId: op.id,
          opCategory: op.category,
          glossJa: op.gloss_ja,
          cognitiveEffect: op.cognitive_effect,
          surface: m[0],
          offset: idx,
          length,
          scope: trig.scope,
          position,
          priority: op.priority ?? 0,
          opensSpan: op.opens_span,
          closesSpan: op.closes_span,
          composesWith: op.composes_with,
          requiresOneOf: op.requires_one_of,
        });
      }
    }
  }

  // Resolve overlaps: prefer higher priority, then longer length, then earlier offset.
  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.length !== a.length) return b.length - a.length;
    return a.offset - b.offset;
  });

  /** @type {OperatorHit[]} */
  const kept = [];
  /** Per-position acceptance: lower-priority hits that overlap an accepted
   *  hit on the SAME operator family are dropped; cross-family overlap is
   *  allowed (a meta-wrap at sentence end coexists with a causal-derive
   *  mid-sentence). */
  for (const c of candidates) {
    const conflict = kept.some(k =>
      // strict same-span same-op suppression
      (k.opId === c.opId && rangesOverlap(k, c)) ||
      // contained-within-same-op suppression (avoid "から" inside "からです")
      (k.surface.includes(c.surface) && rangesOverlap(k, c)) ||
      (c.surface.includes(k.surface) && rangesOverlap(k, c) && k.opId === c.opId)
    );
    if (!conflict) kept.push(c);
  }

  kept.sort((a, b) => a.offset - b.offset);
  return { hits: kept, backchannel: false };
}

function rangesOverlap(a, b) {
  return !(a.offset + a.length <= b.offset || b.offset + b.length <= a.offset);
}

/** Convenience: matched operator IDs as a chain string. */
export function chainString(hits) {
  return hits.map(h => h.opId).join(' → ');
}

/** Build a nested chain string: outer = sentence-final operators,
 *  middle = medial, inner = initial. Also collapses N consecutive
 *  same-opId hits into `LIST-OF-N(opId×N)` and surfaces cancelledBy.
 *
 *  Example:
 *    [SCENE-SHIFT(initial), EXEMPLIFY×3(medial), HEDGE-INCOMPLETE(final)]
 *    → "HEDGE-INCOMPLETE { EXEMPLIFY×3 { SCENE-SHIFT } }"
 */
export function chainTree(hits) {
  if (!hits || !hits.length) return '';
  // Collapse runs of identical adjacent opIds.
  const collapsed = [];
  for (const h of hits) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.opId === h.opId && last.position === h.position && !h.cancelled && !last.cancelled) {
      last.count = (last.count ?? 1) + 1;
    } else {
      collapsed.push({ ...h, count: 1 });
    }
  }
  // Bucket by position.
  const buckets = { initial: [], medial: [], final: [], standalone: [] };
  for (const h of collapsed) buckets[h.position ?? 'medial'].push(h);

  const fmt = (h) => {
    let s = h.opId;
    if (h.count > 1) s += `×${h.count}`;
    if (h.cancelled) s = `~~${s}~~`;
    if (h.cancelledBy) s += `⟂${h.cancelledBy}`;
    return s;
  };
  const seq = (arr) => arr.map(fmt).join(' · ');

  const inner = seq(buckets.initial);
  const middle = seq(buckets.medial);
  const outer = seq(buckets.final);
  const standalone = seq(buckets.standalone);

  // Nest: outer { middle { inner } }
  let core = inner;
  if (middle) core = core ? `${middle} { ${core} }` : middle;
  if (outer) core = core ? `${outer} { ${core} }` : outer;
  if (standalone) core = core ? `${core} · ${standalone}` : standalone;
  return core;
}
