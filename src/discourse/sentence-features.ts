/**
 * sentence-features.ts — Per-sentence feature extractor for discourse parsing.
 *
 * The adjacency-pair engine in `sentence-relations.ts` used to fire on a
 * single coarse `pragmaticFunction` tag, which produced lots of false
 * positives (most famously `assertion-disagreement` firing on any pair
 * where the second sentence started with `が` or `けど`).
 *
 * This module extracts the linguistic features the engine actually needs
 * to make those decisions reliably:
 *   - speechAct: declarative / interrogative / imperative / requestive / exclamative / fragment
 *   - polarity: affirmative / negative / unknown
 *   - terminalPredicate: the final verbal/adjectival/copular morphology
 *   - topicNPs: noun phrases marked by は / が / って (topic chain detection)
 *   - leadingMarker: utterance-initial discourse marker (with discourseRole)
 *   - oppositionTriggers: explicit semantic-flip markers (ではなく, とは違って, …)
 *   - negationTargets: predicate stems that the next sentence might be negating
 *   - repairTriggers: っていうか, じゃなくて, そうじゃなくて, …
 *   - hasBackchannelStart / hasReactionStart: leading interactive token
 *
 * Plus comparison helpers:
 *   - topicOverlap(f1, f2): do they share a topic NP?
 *   - detectNegationOf(f1, f2): does s2 explicitly negate s1's predicate head?
 */

import type { PatternMatch } from './discourse-grammar';
import type { SentenceParse } from './sentence-relations';
import { effectiveRole, effectiveStrength } from './discourse-roles';
import type { DiscourseRole } from './discourse-patterns';

export type SpeechAct =
  | 'declarative'
  | 'interrogative'
  | 'imperative'
  | 'requestive'
  | 'exclamative'
  | 'fragment';

export type Polarity = 'affirmative' | 'negative' | 'unknown';

export interface OppositionTrigger {
  text: string;
  /** Where the trigger appears: 'leading' (utterance-initial marker)
   *  or 'inline' (negative-equation phrase like ではなく / とは違って). */
  position: 'leading' | 'inline';
  strength: 'strong' | 'medium' | 'weak';
  /** Character offset within the sentence (best-effort). */
  offset?: number;
}

/** A single discourse marker surfaced in this sentence with role + offset. */
export interface MarkerHit {
  surface: string;
  role: DiscourseRole;
  strength: 'strong' | 'medium' | 'weak';
  offset: number;
  /** 'leading' = within first 2 chars; 'inline' = elsewhere. */
  position: 'leading' | 'inline';
  /** Pattern id, for debugging / linking back. */
  patternId?: string;
}

export interface LeadingMarkerInfo {
  surface: string;
  role: DiscourseRole;
  strength: 'strong' | 'medium' | 'weak';
  offset: number;
}

export interface SentenceFeatures {
  speechAct: SpeechAct;
  polarity: Polarity;
  /** The last 6 characters of the sentence's predicate region (best-effort). */
  terminalForm: string;
  /** The head (kanji/katakana run) of the terminal predicate, if extractable. */
  predicateHead: string | null;
  /** NPs (kanji/katakana runs ≥ 2) that appear before は / が / って / について. */
  topicNPs: string[];
  /** All content-word heads in the sentence (for general overlap). */
  contentHeads: string[];
  /** First utterance-initial discourse marker, if any. */
  leadingMarker: LeadingMarkerInfo | null;
  /** Explicit semantic-flip markers anywhere in the sentence. */
  oppositionTriggers: OppositionTrigger[];
  /** ALL recognised discourse markers in the sentence, classified by role.
   *  Includes the leading marker (if any) plus every inline contentful
   *  marker (opposition, concession, quotation, hypothetical, etc.). This is
   *  the data structure the demo / UI uses to visualise "what each piece
   *  contributes". */
  markerHits: MarkerHit[];
  /** Self-repair triggers (e.g. っていうか). */
  repairTriggers: string[];
  /** Sentence begins with a backchannel token (うん, ああ, なるほど). */
  hasBackchannelStart: boolean;
  /** Sentence begins with a strong reaction token (えー, うそ, まじ, やば). */
  hasReactionStart: boolean;
  /** Sentence begins with an explicit disagreement opener (いや, 違う). */
  hasDisagreementOpener: boolean;
  /** Whether the predicate is marked with an assertion suffix. */
  hasAssertionMarker: boolean;
  /** Whether the predicate is hedged. */
  hasHedge: boolean;
}

// ── Regexes ──────────────────────────────────────────────────

const RE_INTERROGATIVE_END = /(?:[？?]|か[？?\s]?$|かな$|かしら$|でしょうか$|の[？?]$|の\?$|っけ[？?]?$)/;
const RE_IMPERATIVE_END = /(?:[\u3041-\u3093ろ]ろ$|なさい$|たまえ$|な[！!]?$)/;
const RE_REQUESTIVE_END = /(?:てください|てくれ(?:る|ない|ます[？?]?)?$|てちょうだい|てもらえ(?:ます|る)?[？?]?$|ていただけ(?:ます|る)?[？?]?$)/;
const RE_EXCLAMATIVE_END = /[！!]{1,}$/;
const RE_NEGATION = /(?:ない|ません|ぬ|ず(?![っつ])|なく(?:て|な[いっ]|ね)|ねえ|無い)(?:[んよねけどさよ。！!？?]|$)/;

const RE_LEADING_BACKCHANNEL = /^(?:うん+|はい+|ええ+|そう+|ああ+|うー+ん|なるほど|たしかに|わかる|そりゃ)/;
const RE_LEADING_REACTION = /^(?:え[ー〜!?！？]*|へえ[ー〜]?|うそ[だよ]?|まじ[で]?|マジ|やば[い]?|すご[いー]+|ひど[いー]+)/;
const RE_LEADING_DISAGREEMENT = /^(?:いや+|違う+|それは違|そうじゃ(?:なくて|ない)|ちが(?:う|くて))/;

const RE_INLINE_OPPOSITION = /(?:ではなく|じゃなくて|とは違って|わけではない|わけじゃない|そうではない|そうじゃない|というよりは|というよりも|というより|そういう(?:こと|の|意味)じゃ(?:なくて|ない))/g;

const RE_REPAIR = /(?:っていうか|ていうか|そうじゃなくて|じゃなくて[、,]|違う違う|ちょっと違|あ、違|あ違|つーか)/g;

const RE_ASSERTION_MARKER = /(?:んですよ|んだよ|なんですよ|なんだよ|わけです|わけだよ|ですよ。|だよ。)/;
const RE_HEDGE_MARKER = /(?:かもしれない|かもしれません|かもね|と思う|と思います|気がする|な気がする|っぽい|みたいな|なんかさ)/;

const RE_TOPIC = /([\u4e00-\u9fff\u3400-\u4dbf\u30a1-\u30f6ー]{2,})(?:は|が(?!ち)|って|について|に関して)/g;
const RE_CONTENT_HEAD = /[\u4e00-\u9fff\u3400-\u4dbf]{2,}|[\u30a1-\u30f6ー]{3,}/g;

/** Last verbal/adjectival/copular head before terminal punctuation. */
function extractPredicateHead(text: string): string | null {
  // Strip trailing punctuation/markers
  const stripped = text.replace(/[。！？!?、,\s]+$/, '');
  // Find the last kanji+kana run
  const m = stripped.match(/([\u4e00-\u9fff]{1,}[\u3041-\u3093]{0,4})$/);
  if (m) return m[1];
  // Fallback: trailing kana run
  const k = stripped.match(/([\u3041-\u3093]{2,5})$/);
  return k ? k[1] : null;
}

function extractTerminalForm(text: string): string {
  const stripped = text.replace(/[\s]+$/, '');
  return stripped.slice(Math.max(0, stripped.length - 8));
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

export function extractSentenceFeatures(parse: SentenceParse): SentenceFeatures {
  const text = parse.text;
  const trimmed = text.trim();

  // ── Speech act ──
  let speechAct: SpeechAct;
  if (RE_INTERROGATIVE_END.test(trimmed)) speechAct = 'interrogative';
  else if (RE_REQUESTIVE_END.test(trimmed)) speechAct = 'requestive';
  else if (RE_IMPERATIVE_END.test(trimmed)) speechAct = 'imperative';
  else if (RE_EXCLAMATIVE_END.test(trimmed)) speechAct = 'exclamative';
  else if (trimmed.length < 6 && !/[。]$/.test(trimmed)) speechAct = 'fragment';
  else speechAct = 'declarative';

  // ── Polarity ──
  const terminalForm = extractTerminalForm(trimmed);
  let polarity: Polarity = 'affirmative';
  if (RE_NEGATION.test(terminalForm)) polarity = 'negative';
  else if (terminalForm.length < 2) polarity = 'unknown';

  const predicateHead = extractPredicateHead(trimmed);

  // ── Topic NPs ──
  const topicNPs: string[] = [];
  let m: RegExpExecArray | null;
  RE_TOPIC.lastIndex = 0;
  while ((m = RE_TOPIC.exec(text)) !== null) {
    topicNPs.push(m[1]);
  }

  // ── Content heads (broader) ──
  const contentHeads = text.match(RE_CONTENT_HEAD) ?? [];

  // ── Leading marker: must start within the first 2 chars (post-trim),
  // so a sentence-medial particle like the location で in 「沖縄で行われた」
  // doesn't wrongly act as a topic-shift opener. ──
  const leadOffset = text.length - text.trimStart().length;
  let leadingMarker: LeadingMarkerInfo | null = null;
  const sortedByOffset = [...parse.patterns].sort((a, b) => a.offset - b.offset);
  for (const pm of sortedByOffset) {
    if (pm.offset > leadOffset + 2) break;
    const role = effectiveRole(pm.pattern);
    if (pm.pattern.position === 'utterance-initial' || role !== 'other') {
      leadingMarker = {
        surface: pm.matchedText,
        role,
        strength: effectiveStrength(pm.pattern),
        offset: pm.offset,
      };
      break;
    }
  }

  // ── All inline marker hits (every discourse-role-bearing pattern). ──
  const markerHits: MarkerHit[] = [];
  const seenSpans = new Set<string>();
  for (const pm of sortedByOffset) {
    const role = effectiveRole(pm.pattern);
    if (role === 'other' && pm.pattern.position !== 'utterance-initial') continue;
    const key = `${pm.offset}-${pm.matchedText}`;
    if (seenSpans.has(key)) continue;
    seenSpans.add(key);
    markerHits.push({
      surface: pm.matchedText,
      role,
      strength: effectiveStrength(pm.pattern),
      offset: pm.offset,
      position: pm.offset <= leadOffset + 2 ? 'leading' : 'inline',
      patternId: pm.pattern.id,
    });
  }

  // ── Opposition triggers (leading + inline + pattern-driven) ──
  const oppositionTriggers: OppositionTrigger[] = [];
  if (leadingMarker && leadingMarker.role === 'opposition') {
    oppositionTriggers.push({
      text: leadingMarker.surface,
      position: 'leading',
      strength: leadingMarker.strength,
      offset: leadingMarker.offset,
    });
  }
  // Pattern-driven inline opposition (e.g. 一方で / それに対して / 反面)
  for (const h of markerHits) {
    if (h.role === 'opposition' && h.position === 'inline') {
      oppositionTriggers.push({
        text: h.surface,
        position: 'inline',
        strength: h.strength,
        offset: h.offset,
      });
    }
  }
  // Regex-driven inline opposition (negative-equation phrases)
  RE_INLINE_OPPOSITION.lastIndex = 0;
  let im: RegExpExecArray | null;
  while ((im = RE_INLINE_OPPOSITION.exec(text)) !== null) {
    oppositionTriggers.push({
      text: im[0],
      position: 'inline',
      strength: 'strong',
      offset: im.index,
    });
  }

  // ── Repair triggers ──
  const repairTriggers: string[] = [];
  RE_REPAIR.lastIndex = 0;
  let rm: RegExpExecArray | null;
  while ((rm = RE_REPAIR.exec(text)) !== null) {
    repairTriggers.push(rm[0]);
  }

  // ── Leading interactive tokens ──
  const hasBackchannelStart = RE_LEADING_BACKCHANNEL.test(trimmed);
  const hasReactionStart = RE_LEADING_REACTION.test(trimmed);
  const hasDisagreementOpener = RE_LEADING_DISAGREEMENT.test(trimmed);

  // ── Stance markers in predicate region ──
  const hasAssertionMarker = RE_ASSERTION_MARKER.test(terminalForm) ||
                             (leadingMarker?.role === 'assertion-marker');
  const hasHedge = RE_HEDGE_MARKER.test(terminalForm) ||
                   (leadingMarker?.role === 'hedge');

  return {
    speechAct,
    polarity,
    terminalForm,
    predicateHead,
    topicNPs: uniq(topicNPs),
    contentHeads: uniq(contentHeads),
    leadingMarker,
    oppositionTriggers,
    markerHits,
    repairTriggers: uniq(repairTriggers),
    hasBackchannelStart,
    hasReactionStart,
    hasDisagreementOpener,
    hasAssertionMarker,
    hasHedge,
  };
}

// ── Comparison helpers ──────────────────────────────────────────

/**
 * Returns a number in [0,1] representing how much the topics of two
 * sentences overlap. A shared topic NP scores 1.0; a shared content
 * head (broader) scores 0.6; otherwise 0.
 */
export function topicOverlap(a: SentenceFeatures, b: SentenceFeatures): number {
  if (a.topicNPs.length && b.topicNPs.length) {
    for (const t of a.topicNPs) {
      if (b.topicNPs.includes(t)) return 1.0;
    }
  }
  if (a.contentHeads.length && b.contentHeads.length) {
    for (const h of a.contentHeads) {
      if (b.contentHeads.includes(h) && h.length >= 2) return 0.6;
    }
  }
  return 0;
}

/**
 * Does s2 explicitly negate s1's predicate head?
 * (Looks for s1's predicate-head kanji root appearing inside s2 with
 * negative morphology nearby.)
 */
export function detectNegationOf(a: SentenceFeatures, b: SentenceFeatures, bText: string): boolean {
  if (!a.predicateHead || b.polarity !== 'negative') return false;
  // Extract the kanji root of s1's predicate
  const rootMatch = a.predicateHead.match(/[\u4e00-\u9fff]{1,}/);
  if (!rootMatch) return false;
  const root = rootMatch[0];
  if (root.length < 1) return false;
  return bText.includes(root);
}

/**
 * Clipped weighted-feature confidence aggregator.
 * Each `true` feature adds its weight; cap at 0.95.
 */
export function computeConfidence(
  base: number,
  contributions: Array<[boolean, number]>,
): number {
  let c = base;
  for (const [fired, w] of contributions) if (fired) c += w;
  if (c > 0.95) c = 0.95;
  if (c < 0) c = 0;
  return Math.round(c * 100) / 100;
}
