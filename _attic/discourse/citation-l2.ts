/**
 * citation-l2.ts — Intrinsic-axis classifier.
 *
 * Per-site axes that depend ONLY on the site itself plus immediate
 * morphosyntactic context (no discourse history, no cross-sentence
 * resolution). Run after L1 has tagged the と-node.
 */

import type {
  CiteNegScope,
  CitationSite,
  DeicticShift,
  Fidelity,
  Form,
  InternalIlloc,
  MentalCiteAspect,
  Prosody,
  ReformVec,
  Scope,
  TemporalTriple,
} from './citation-types';
import { newSite } from './citation-types';
import type { L1Hit } from './citation-l1';

// ── Right-context probes for FORM (re-runs L1 probes but with FORM tags) ──

/** Right-context window: enough to capture multi-char verb endings + suffix. */
const RIGHT_FORM_WINDOW = 28;

interface FormProbe { re: RegExp; form: Form; aspect?: MentalCiteAspect; }
const FORM_PROBES: FormProbe[] = [
  { re: /^\u3055\u308c\u308b|^\u3055\u308c\u3066\u3044\u308b|^\u3055\u308c\u305f|^\u8a00\u308f\u308c|^\u8003\u3048\u3089\u308c|^\u601d\u308f\u308c|^\u898b\u3089\u308c/, form: 'authority-invocation' },
  { re: /^\u601d\u3063\u3066\u3044\u308b|^\u8003\u3048\u3066\u3044\u308b|^\u611f\u3058\u3066\u3044\u308b/, form: 'mental-verb', aspect: 'durative' },
  { re: /^\u601d\u3046\u3053\u3068\u304c[\u591a\u3088\u3088]/, form: 'mental-verb', aspect: 'habitual-evaluative' },
  { re: /^\u601d\u3063\u3061\u3083/, form: 'mental-verb', aspect: 'iterative' },
  { re: /^\u601d\u3046|^\u601d\u3063\u305f|^\u601d\u3063\u3066|^\u8003\u3048(?:\u305f|\u308b|\u3066)|^\u611f\u3058(?:\u305f|\u308b|\u3066)/, form: 'mental-verb', aspect: 'momentary' },
  { re: /^\u8a00\u3063\u305f\u3089|^\u601d\u3063\u305f\u3089|^\u805e\u3044\u305f\u3089/, form: 'hypothetical-quote' },
  { re: /^\u8a00\u3046\u3058\u3083\u306a\u3044|^\u3044\u3046\u3084\u3064|^\u3044\u3046\u3042\u308c|^\u307f\u305f\u3044\u306a[\u3001\u3002]/, form: 'common-knowledge-cite' },
  { re: /^\u8a00\u3063\u305f|^\u8a00\u3044\u307e\u3057\u305f|^\u8a00\u3063\u3066\u3044\u305f|^\u805e\u3044\u305f|^\u66f8\u3044\u3066\u3042\u3063\u305f|^\u8a00\u308f\u308c\u305f/, form: 'speech-verb' },
  { re: /^\u3089\u3057\u3044|^\u305d\u3046\u3060|^\u305d\u3046\u3067\u3059|^\u307f\u305f\u3044/, form: 'hearsay-suffix' },
];

/** Reified-NP head-noun → reform_vec. */
const REFORM_NOUNS: Array<{ re: RegExp; vec: ReformVec }> = [
  { re: /^\u3053\u3068|^\u4e8b/, vec: 'factualization' },
  { re: /^\u7acb\u5834|^\u4e3b\u5f35|^\u8003\u3048|^\u610f\u898b|^\u7acb\u3061\u5834/, vec: 'positionalization' },
  { re: /^\u8a71|^\u30a8\u30d4\u30bd\u30fc\u30c9|^\u4f8b/, vec: 'narrativization' },
  { re: /^\u5f62|^\u5f62\u5f0f|^\u3084\u308a\u65b9|^\u624b\u6cd5/, vec: 'formalization' },
  { re: /^\u554f\u984c|^\u75c7\u72b6|^\u614b/, vec: 'diagnosalization' },
];

// ── Cited-span (inner) probes ─────────────────────────────────────

const RE_INNER_QUESTION = /[\uff1f?\u304b\u3051\u3063\u3051]\s*$|\u306e\u304b\s*$|\u3060\u308d\u3046\u304b\s*$/;
const RE_INNER_IMPERATIVE = /(?:[\u3082\u308d]ろ|\u306a\u3055\u3044|\u305f\u307e\u3048|\u305a\u306b)\s*$/;
const RE_INNER_REQUEST = /(?:\u3066\u304f\u3060\u3055\u3044|\u3066\u304f\u308c|\u3066\u3082\u3089\u3048\u308b\u304b)\s*$/;
const RE_INNER_EXCLAMATIVE = /[\uff01!]\s*$/;
const RE_INNER_EVALUATIVE = /(?:\u3044\u3044\u306d|\u3059\u3054\u3044|\u3084\u3070\u3044|\u3072\u3069\u3044|\u3060\u3081\u3060|\u73cd\u3057\u3044)\s*$/;

/** Negation inside the cited span (predicate-internal). */
const RE_INNER_NEGATION = /(?:\u306a\u3044|\u307e\u305b\u3093|\u306c|\u305a)(?:[\u3093\u3088\u306d\u3051\u3069\u3055]|$)/;

/** Negation in matrix on the cite verb (と…ない). */
const RE_OUTER_NEGATION = /^(?:\u601d\u308f\u306a|\u8a00\u308f\u306a|\u8003\u3048\u306a|\u611f\u3058\u306a)/;

/** とは限らない / と決まってない family. */
const RE_PREDICATE_NEG = /^(?:[\u3068\u306b]?[\u306f]?\u9650\u3089\u306a\u3044|\u6c7a\u307e\u3063\u3066\u306a\u3044|\u3068\u306f\u9650\u3089\u306a\u3044)/;

/** Quantifier-negation: 誰も…と言わない. We can detect …も…ない locally. */
const RE_QUANTIFIER_NEG_LEFT = /(?:\u8ab0\u3082|\u4f55\u3082|\u3069\u3053\u3082|\u3069\u308c\u3082|\u3069\u306e[\u4e00-\u9fff]+\u3082)/;

// ── Tense / temporal cues in cited span ───────────────────────────

const RE_INNER_PAST = /(?:\u305f|\u3060\u3063\u305f|\u3067\u3057\u305f|\u307e\u3057\u305f)\s*$/;
const RE_INNER_FUTURE = /(?:\u3060\u308d\u3046|\u3067\u3057\u3087\u3046|\u3059\u308b\u3060\u308d\u3046|\u3066\u3044\u304f|\u3066\u3057\u307e\u3046|\u3057\u3088\u3046|\u3084\u308d\u3046)\s*$/;
const RE_OUTER_PAST = /^(?:[\u8a00\u601d\u8003\u805e\u898b][\u3046\u3063\u308f\u3048\u3044]?(?:\u305f|\u307e\u3057\u305f|\u3066\u3044\u305f))/;

// ── First-person pronouns / deictic anchors ──────────────────────

const RE_FIRST_PERSON = /(?:\u79c1|\u50d5|\u4ffa|\u3046\u3061|\u305d\u306e\u30fb?\u308f\u305f\u3057)/;
const RE_SECOND_PERSON = /(?:\u3042\u306a\u305f|\u541b|\u304a\u524d|\u3042\u3093\u305f)/;

// ── Prosody — punctuation only (we don't have audio) ──────────────

function detectProsody(cited: string): Prosody {
  if (/[\uff01!]{1,}\s*$/.test(cited)) { return 'emphatic'; }
  if (/[\uff1f?]\s*$/.test(cited)) { return 'rising'; }
  if (/\u3002\s*$/.test(cited)) { return 'falling'; }
  return 'unknown';
}

// ── Per-axis helpers ──────────────────────────────────────────────

function detectInternalIlloc(cited: string): InternalIlloc {
  const trimmed = cited.trim();
  if (!trimmed) { return null; }
  if (RE_INNER_QUESTION.test(trimmed)) { return 'question'; }
  if (RE_INNER_REQUEST.test(trimmed)) { return 'request'; }
  if (RE_INNER_IMPERATIVE.test(trimmed)) { return 'imperative'; }
  if (RE_INNER_EXCLAMATIVE.test(trimmed)) { return 'exclamation'; }
  if (RE_INNER_EVALUATIVE.test(trimmed)) { return 'evaluation'; }
  // Fragment vs assertion: assertion needs a verbal ending.
  if (/(?:\u305f|\u308b|\u3046|\u3044|\u3060|\u3067\u3059|\u307e\u3059|\u3060\u308d\u3046|\u3067\u3057\u3087\u3046)\s*$/.test(trimmed)) {
    return 'assertion';
  }
  return 'fragment';
}

function detectScope(cited: string, form: Form): Scope {
  const c = cited.trim();
  if (!c) { return null; }
  if (form === 'reified-NP' || form === 'topic-label' || form === 'nominalized-of-saying') { return 'NP'; }
  // Word: ≤4 chars and single kanji/katakana run
  if (c.length <= 4 && /^[\u4e00-\u9fff\u30a0-\u30ff]+$/.test(c)) { return 'single-lexeme'; }
  // Multi-clause: has internal 、 or sentence-final + further verb
  if ((c.match(/[\u3001]/g) ?? []).length >= 2) { return 'complex-prop'; }
  if (/[\u3002\uff1f\uff01]/.test(c.slice(0, -1))) { return 'complex-prop'; }
  // Clause: contains a predicate ending
  if (/(?:\u305f|\u308b|\u3046|\u3060|\u3067\u3059|\u307e\u3059|\u306a\u3044|\u307e\u305b\u3093)$/.test(c)) { return 'proposition'; }
  return 'NP';
}

function detectReformVec(rightCtx: string, form: Form): ReformVec {
  if (form !== 'reified-NP') { return 'n/a'; }
  // rightCtx starts right after the marker; if marker was という, the N is at start
  const after = rightCtx.replace(/^(?:\u3044\u3046|\u3063\u3066\u3044\u3046)/, '');
  for (const r of REFORM_NOUNS) {
    if (r.re.test(after)) { return r.vec; }
  }
  return 'n/a';
}

function detectFidelity(form: Form, cited: string): Fidelity {
  switch (form) {
    case 'bracketed-direct': return 'verbatim';
    case 'authority-invocation': return 'typification';
    case 'hypothetical-quote': return 'projection';
    case 'hearsay-suffix': return 'paraphrase';
    case 'common-knowledge-cite': return 'typification';
    case 'reified-NP': return 'typification';
    case 'mental-verb':
      return 'paraphrase';
    default: return 'paraphrase';
  }
}

function detectDeicticShift(form: Form, cited: string): DeicticShift {
  if (form === 'bracketed-direct') { return 'no-shift'; }
  if (form === 'authority-invocation' || form === 'reified-NP') { return 'full-shift'; }
  if (RE_FIRST_PERSON.test(cited) || RE_SECOND_PERSON.test(cited)) { return 'partial-shift'; }
  return 'full-shift';
}

function detectTemporal(form: Form, cited: string, rightCtx: string): TemporalTriple {
  const utt: TemporalTriple['utt'] = 'now';
  let voice: TemporalTriple['voice'] = 'immediate';
  let rel: TemporalTriple['rel'] = 'now';

  if (RE_OUTER_PAST.test(rightCtx)) { voice = 'past'; }
  if (form === 'hypothetical-quote') { voice = 'hypothetical'; rel = 'counterfactual'; }
  if (form === 'authority-invocation') { voice = 'habitual'; rel = 'timeless'; }
  if (form === 'common-knowledge-cite' || form === 'reified-NP') { voice = 'habitual'; rel = 'timeless'; }

  if (RE_INNER_PAST.test(cited)) { rel = 'past'; }
  if (RE_INNER_FUTURE.test(cited)) { rel = 'future'; }

  return { utt, voice, rel };
}

function detectCiteNegScope(cited: string, rightCtx: string, leftCtx: string): CiteNegScope {
  if (RE_PREDICATE_NEG.test(rightCtx)) { return 'predicate-neg'; }
  if (RE_OUTER_NEGATION.test(rightCtx)) { return 'outer-matrix'; }
  if (RE_INNER_NEGATION.test(cited)) { return 'inner-predicate'; }
  if (RE_QUANTIFIER_NEG_LEFT.test(leftCtx) && /\u306a\u3044|\u307e\u305b\u3093/.test(rightCtx)) { return 'quantifier'; }
  return 'none';
}

function detectMentalCiteAspect(form: Form, rightCtx: string, currentAspect?: MentalCiteAspect): MentalCiteAspect {
  if (form !== 'mental-verb') { return null; }
  if (currentAspect) { return currentAspect; }
  if (/^\u601d\u3063\u3066\u3044\u308b|^\u8003\u3048\u3066\u3044\u308b/.test(rightCtx)) { return 'durative'; }
  if (/^\u601d\u3046\u3053\u3068\u304c[\u591a\u3088]/.test(rightCtx)) { return 'habitual-evaluative'; }
  if (/^\u601d\u3063\u3061\u3083/.test(rightCtx)) { return 'iterative'; }
  return 'momentary';
}

// ── Main entry ────────────────────────────────────────────────────

export interface L2Result {
  site: CitationSite;
}

export function classifyL2(
  hit: L1Hit,
  sentence: string,
  siteId: string,
  locator: { transcriptId: string; sentenceIdx: number; charStart: number },
): L2Result {
  const cited = hit.citedSurface;
  const rightCtx = sentence.slice(hit.endOffset, hit.endOffset + RIGHT_FORM_WINDOW);
  const leftCtx = sentence.slice(Math.max(0, hit.citedStart - 24), hit.citedStart);
  const sentenceStart = hit.citedStart === 0 || /^[\s\u3000]*$/.test(sentence.slice(0, Math.max(0, hit.citedStart - cited.length)));
  const atSentenceEnd = hit.endOffset >= sentence.length - 2;

  // ── FORM (rich rule cascade) ────────────────────────────────────
  let form: Form = 'unknown';
  let aspect: MentalCiteAspect = null;
  let confidence = 0.6;

  const isToiu = hit.marker === 'という' || hit.marker === 'っていう' ||
                 hit.marker === 'ということ' || hit.marker === 'っていうこと';

  // -------------- LONG MARKERS (という / っていう / ということ) ---------
  if (isToiu) {
    const tail = rightCtx; // text after the marker itself
    // ──── Topic-label markers: のは / ってのは / っての ────────────
    if (/^のは|^のが|^のを|^のも|^のと|^ってのは|^っての/.test(tail)) {
      form = 'topic-label'; confidence = 0.95;
    }
    // ──── Reformulation: というか / っていうか / ってのは → reformulative ──
    else if (/^か(?:[、。\s]|$)|^か[^\u4e00-\u9fff\u3041-\u3093]/.test(tail)) {
      // Could be reformulative or topic-label+reformulative
      // Heuristic: if cited content is short (< 8 chars), reformulative;
      // if cited contains a topic marker, topic-label+reformulative.
      if (/(?:は|って)$/.test(cited) || cited.length > 12) form = 'topic-label+reformulative';
      else form = 'reformulative';
      confidence = 0.9;
    }
    // ──── Section-wrap (sentence-initial ということで / sentence-final ということです) ──
    else if (sentenceStart && /^で/.test(tail)) {
      form = 'section-wrap'; confidence = 0.95;
    }
    else if ((hit.marker === 'ということ' || hit.marker === 'っていうこと') &&
             /^(?:です|でし[たょ]|だ|になり|ですね|でした)/.test(tail)) {
      form = atSentenceEnd || /^[\u4e00-\u9fff\u3041-\u3093]{0,4}$/.test(tail.slice(0, 6))
        ? 'section-wrap'
        : 'nominalized-of-saying+ratification';
      confidence = 0.9;
    }
    else if (hit.marker === 'ということ' || hit.marker === 'っていうこと') {
      form = 'nominalized-of-saying'; confidence = 0.9;
    }
    // ──── Reified-NP with explicit head noun ───────────────────────
    else if (/^(?:形|状況|事実|立場|活動|件|ところ|感じ|話|場面|考え|意見|主張|姿勢|傾向|問題|現象|風潮|流れ|動き|声|気持ち)/.test(tail)) {
      form = 'reified-NP'; confidence = 0.95;
    }
    // ──── Bare という + abstract noun (default reified-NP) ─────────
    else if (/^[\u4e00-\u9fff\u30a0-\u30ff]/.test(tail)) {
      form = 'reified-NP'; confidence = 0.85;
    }
    // ──── という alone (speech-act use) ─────────────────────────────
    else {
      form = 'reified-NP'; confidence = 0.6;
    }
  } else {
    // -------------- SHORT MARKERS (と / って) ───────────────────────
    // Direct-bracket: 「…」と
    if (/「[^」]{1,80}」$/.test(sentence.slice(Math.max(0, hit.citedStart - 1), hit.citedStart + cited.length))) {
      form = 'bracketed-direct'; confidence = 0.95;
      // bracketed-direct + speech-verb compound
      if (/^(?:言|聞|叫|呼)/.test(rightCtx)) {
        form = 'bracketed-direct+speech-verb'; confidence = 0.95;
      }
    }
    // Compound and high-priority probes (ordered)
    // ── Speech-verb + evidential: 言ったそうです / 言うらしい ──────────
    else if (/^(?:言|聞|書|呼)[\u3041-\u3093]{0,3}(?:そう|らしい|だそう|みたい)/.test(rightCtx)) {
      form = 'speech-verb+evidential'; confidence = 0.95;
    }
    // ── Speech-verb in negated uncertainty: 言ったかどうか…知らない/わからない ─
    else if (/^(?:言|思|聞|考)[\u3041-\u3093]{0,3}か(?:どう)?か[\u3001\s\u4e00-\u9fff\u3041-\u3093]*?(?:知り|わかり|分か)/.test(rightCtx)) {
      form = 'speech-verb-in-negated-uncertainty-modal'; confidence = 0.9;
    }
    // ── Speech-verb negated: 言わない/言ってない/言いません/とも言わない ──
    else if (/^(?:言|思|聞|考)[\u3041-\u3093]{0,3}(?:な[いく]|ません|ず|なかった|ぬ)/.test(rightCtx) ||
             /^(?:言|思|聞)[\u3041-\u3093]{0,3}って(?:な[いく]|ません)/.test(rightCtx)) {
      // Doubly-cited negation: たとえば と言わないと言う / って言ってないって言う
      if (/って言/.test(rightCtx.slice(4))) form = 'speech-verb-negated-doubly-cited';
      else form = 'speech-verb-negated';
      confidence = 0.9;
    }
    // ── Speech-verb + interrogative tag: 言ったじゃないですか / 言ったでしょう ─
    else if (/^(?:言|聞)[\u3041-\u3093]{0,3}(?:じゃないですか|でしょ|だろう|よね)/.test(rightCtx)) {
      form = 'speech-verb+interrogative-tag'; confidence = 0.9;
    }
    // ── Speech-verb past: 言った / 言いました / 言ってた / 聞いた ─────
    else if (/^(?:言|聞|書|呼|叫|語|述|教)[\u3041-\u3093]{0,2}(?:った|いました|ってた|ってました|いた|った|られた|られて)/.test(rightCtx)) {
      form = 'speech-verb'; confidence = 0.9;
    }
    // ── Authority invocation: とされる / と言われている / と考えられる ──
    else if (/^(?:され|言われ|考えられ|思われ|見られ|認められ)/.test(rightCtx)) {
      form = 'authority-invocation'; confidence = 0.95;
    }
    // ── Mental verb (durative): 思っている / 考えている ───────────────
    else if (/^(?:思|考|感|信)[\u3041-\u3093]{0,2}(?:っている|えている|じている|じてる|っとる)/.test(rightCtx)) {
      form = 'mental-verb'; aspect = 'durative'; confidence = 0.9;
    }
    // ── Mental verb (habitual-evaluative): 思うことが多い / 思うことがある ─
    else if (/^(?:思|考|感)[\u3041-\u3093]{0,2}ことが(?:多|よく|ある)/.test(rightCtx)) {
      form = 'mental-verb'; aspect = 'habitual-evaluative'; confidence = 0.9;
    }
    // ── Mental verb (iterative): 思っちゃう / 思っちゃった ─────────────
    else if (/^(?:思|考)[\u3041-\u3093]{0,2}っちゃ/.test(rightCtx)) {
      form = 'mental-verb'; aspect = 'iterative'; confidence = 0.9;
    }
    // ── Mental verb (momentary): 思う/思った/思って / 考えた / 感じる ──
    else if (/^(?:思|考|感|信)[\u3041-\u3093]{0,2}(?:う|った|って|える|えた|じる|じた|じて)/.test(rightCtx)) {
      form = 'mental-verb'; aspect = 'momentary'; confidence = 0.9;
    }
    // ── Hypothetical quote: 言ったら / 思ったら / 聞いたら ─────────────
    else if (/^(?:言|思|聞)[\u3041-\u3093]{0,2}ったら/.test(rightCtx)) {
      form = 'hypothetical-quote'; confidence = 0.9;
    }
    // ── Common-knowledge cite: 言うじゃない / いうやつ / みたいな ─────
    else if (/^(?:言うじゃない|いうやつ|いうあれ|みたいな[、。])/.test(rightCtx)) {
      form = 'common-knowledge-cite'; confidence = 0.85;
    }
    // ── Hearsay suffix alone: らしい / そうだ / そうです ──────────────
    else if (/^(?:らしい|そう[だでです]|みたい)/.test(rightCtx)) {
      form = 'hearsay-suffix'; confidence = 0.85;
    }
    // ── Voice from nowhere: って声/って意見/って話/って言われ ─────────
    else if (/^(?:声|意見|話|言い方|考え方)/.test(rightCtx)) {
      form = 'speech-verb'; confidence = 0.8;
    }
    // ── Passive attribution from source: …によると + cited ─────────
    else if (/による[とな](?:[、\s]|$)/.test(leftCtx) || /による(?:と|調査)/.test(leftCtx)) {
      form = 'passive-attribution+reified-NP'; confidence = 0.9;
    }
    // ── Perception-verb chain: 聞くによると / 見るに / 聞くに ───────
    else if (/(?:聞く|見る|読む)に(?:よる)?と$/.test(leftCtx + rightCtx.slice(0, 4))) {
      form = 'perception-verb-chain+terminal-と'; confidence = 0.85;
    }
    // ── Sentence-final terminal cite ─────────────────────────────
    else if (atSentenceEnd) {
      // 〜じゃないか + と + . → truncated-terminal+conditional or +nominalizer
      if (/(?:じゃないか|んじゃないか|だろうか)$/.test(cited) || /(?:じゃないか|んじゃないか)/.test(cited.slice(-8))) {
        form = 'truncated-terminal+conditional'; confidence = 0.9;
      } else if (/(?:んだ|のだ|ものだ|わけだ)$/.test(cited)) {
        form = 'truncated-terminal+nominalizer'; confidence = 0.85;
      } else {
        form = 'truncated-terminal'; confidence = 0.8;
      }
    }
    // ── Speech-verb future/imperative: 言おう / 言え ─────────────────
    else if (/^(?:言|聞)[\u3041-\u3093]{0,2}(?:おう|え)/.test(rightCtx)) {
      form = 'speech-verb'; confidence = 0.85;
    }
    // ── Generic speech-verb (catchall: starts with verb-like) ─────
    else if (/^[\u4e00-\u9fff]/.test(rightCtx)) {
      form = 'speech-verb'; confidence = 0.6;
    } else {
      form = 'unknown'; confidence = 0.4;
    }
  }

  // ── Compound: reified-NP + speech-verb (X というのを言ってきた) ──
  if (form === 'reified-NP' && /(?:言って|言ってきた|言ってる|言われ|主張)/.test(rightCtx)) {
    form = 'speech-verb+reified-NP';
  }
  // ── Compound: reified-NP + conditional (X というのが + condition) ──
  // (kept simple for now)

  // ── Build site with all axes ────────────────────────────────────
  const site = newSite(
    siteId,
    { ...locator, charEnd: locator.charStart + hit.endOffset },
    cited,
    hit.toKind,
  );

  site.form = form;
  site.internal_illoc = (form === 'reified-NP' || form === 'authority-invocation' || form === 'topic-label' || form === 'nominalized-of-saying') ? null : detectInternalIlloc(cited);
  site.scope = detectScope(cited, form);
  site.reform_vec = detectReformVec(rightCtx, form);
  site.fidelity = detectFidelity(form, cited);
  site.deictic_shift = detectDeicticShift(form, cited);
  site.temporal = detectTemporal(form, cited, rightCtx);
  site.cite_neg_scope = detectCiteNegScope(cited, rightCtx, leftCtx);
  site.mental_cite_aspect = detectMentalCiteAspect(form, rightCtx, aspect);
  site.prosody = detectProsody(cited);

  site.layerCompleted = 2;
  site.confidence.l2 = confidence;

  return { site };
}
