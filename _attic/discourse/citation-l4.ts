/**
 * citation-l4.ts — Discourse-relational axis resolver.
 *
 * Reads from a sliding window of previous CitationStacks (default 6
 * sentences) plus the matrix sentence's leading marker / topic state.
 *
 * Resolves: footing, auth_resp, orientation, stance, cite_illoc, disc_fn,
 * evidence_depth, upstream_frame, uptake (for prior sites).
 */

import type {
  AuthResp,
  CitationSite,
  CitationStack,
  CiteIlloc,
  DiscFn,
  EvidenceDepth,
  Footing,
  Orientation,
  Stance,
  UpstreamFrame,
} from './citation-types';

export interface L4Context {
  /** Recent stacks, oldest-first. Caller maintains the rolling window. */
  history: CitationStack[];
  /** Sentence text of the current sentence (for cue scans). */
  currentSentence: string;
  /** Leading marker text of current sentence, if any. */
  leadingMarker?: string | null;
  /** Whether speaker turn-id changed vs. previous sentence. */
  isTurnBoundary?: boolean;
}

// ── Cue libraries ─────────────────────────────────────────────────

const RE_CUE_COLLECTIVE = /(?:我々|われわれ|私たち|うちの党|党として|社として|一同|みんなで|俺ら|僕ら)/;
const RE_CUE_FIRST_PERSON = /(?:私|僕|俺|うち)(?:は|が|の|も)?/;
const RE_CUE_INSTITUTIONAL = /(?:政府|国会|裁判所|法律|規則|規定|法令|条例|規約|公明党|自民党|立憲民主党|共産党|民主党|維新|国民民主|党|政党|政権|官房|省庁|総務省|外務省|防衛省|警察|検察|SNS[、の]?(?:調査|アンケート|世論)|アンケート|世論調査|統計|報道|ニュース)/;
const RE_CUE_GENERIC_OTHER = /(?:世間|みんな|人々|人間は|皆さん|誰も|誰でも|普通)/;
const RE_CUE_TEXTUAL = /(?:本に|記事|論文|経典|文献|文章|サイト|ニュース|新聞|教科書|資料)/;
const RE_CUE_NAMED_OTHER = /(?:[\u4e00-\u9fff]{1,4})さん(?:は|が|も|を|に|の)/;
const RE_CUE_NAMED_PROPER = /(?:[\u4e00-\u9fff]{1,4})(?:さん|くん|先生|議員|大臣|総理|氏)/;
const RE_CUE_INTERLOCUTOR_2P = /(?:あなた|あんた|そっち|お前|君)/;
const RE_CUE_INTERLOCUTOR_Q = /(?:じゃないですか|でしょう?|ましたよね|ですよね)/;
const RE_CUE_HYPOTHETICAL_VOICE = /(?:って声が|っていう声|つって|って言われ|って思われ|って意見|って批判)/;

const RE_DEFINE_PATTERN = /(?:とは|というのは).+(?:のこと|を指し|を意味|を言う|である)/;
const RE_RECRUIT_PATTERN = /(?:よね|だよね|じゃない|でしょ|でしたよね)\s*$/;
const RE_ACCUSE_PATTERN = /(?:と言っているんだ|と主張している|と言い句を付け|という詭弁|と決めつけ|と批判)/;
const RE_CONCESSION = /(?:たしかに|確かに|それはそうなんだが|それはそうだ|そうかもしれない|まあそう)/;
const RE_REFORMULATE = /(?:つまり|すなわち|言い換えれば|要するに|というか|っていうか)/;
const RE_IRONY_CUES = /(?:いわゆる|いわば|ようなもの|というやつ|そんなバカな)/;
const RE_SELF_MOCKING = /(?:私.+とか言って|私.+とかさ)/;

const RE_INSTITUTIONAL_CONTEXT_NOUNS = /(?:党|政府|連合|連携|政策|制度|体制|公明党|自民党|立憲|改革|合流|安保|法律|法令|条例|裁判|議院|内閣|与党|野党)/;
const RE_PAST_COLLECTIVE_SPEECH = /(?:これまで|今まで|ずっと|長らく).{0,12}(?:言って|言ってきた|主張してきた|訴えてきた)/;
const RE_NARRATOR_VOICE = /そうです[。、]?\s*$|だそうです\s*$|ということです\s*$/;
const RE_HYPOTHETICAL_FRAME = /(?:仮に|もし|たとえば|例えば|あるいは|もしも|だとしたら|だったら|なら)/;
const RE_CUE_AGENTLESS_RHETORICAL = /(?:じゃないか|んじゃないか|んだと|のだと|わけだ)[。、\s]?$/;
const RE_CUE_PAST_HABITUAL = /(?:これまで|今まで|かねてから|以前から|ずっと|前から)/;

// ── Footing inference ─────────────────────────────────────────────

function inferFooting(site: CitationSite, ctx: L4Context, leftCtx: string): Footing {
  const sent = ctx.currentSentence;
  const sIdx = sent.indexOf(site.surface);
  const afterSite = sIdx >= 0 ? sent.slice(sIdx + site.surface.length, sIdx + site.surface.length + 24) : '';
  const broad = leftCtx + ' ' + sent;

  // 1. Form-specific overrides
  if (site.form === 'speech-verb+evidential' ||
      site.form === 'mental-verb+narrator-evidential' ||
      RE_NARRATOR_VOICE.test(sent)) return 'narrator-voice';
  if (site.form === 'section-wrap' || site.form === 'nominalized-of-saying+ratification') return 'meta-discourse-voice';
  if (site.form === 'reformulative' || site.form === 'topic-label+reformulative') {
    return RE_CUE_FIRST_PERSON.test(broad) ? 'auto' : 'meta-discourse-voice';
  }
  if (site.form === 'speech-verb-negated' || site.form === 'speech-verb-negated-doubly-cited' ||
      site.form === 'speech-verb-in-negated-uncertainty-modal' ||
      site.form === 'speech-verb+interrogative-tag') {
    if (RE_CUE_FIRST_PERSON.test(broad) && /(?:言った|思った|聞いた)/.test(afterSite)) return 'self-past';
    return 'interlocutor-current';
  }
  if (site.form === 'passive-attribution+reified-NP' ||
      site.form === 'perception-verb-chain+terminal-と') {
    if (RE_CUE_INSTITUTIONAL.test(broad)) return 'institutional';
    return 'participant-observer';
  }
  if (site.form === 'authority-invocation') {
    if (RE_CUE_TEXTUAL.test(broad)) return 'anonymous-textual';
    if (RE_CUE_INSTITUTIONAL.test(broad)) return 'institutional';
    return 'agentless-passive';
  }
  if (site.form === 'truncated-terminal+conditional' ||
      site.form === 'truncated-terminal+nominalizer') {
    if (RE_CUE_FIRST_PERSON.test(broad)) return 'self-as-projector';
    return 'agentless-passive';
  }
  if (site.form === 'common-knowledge-cite' || site.form === 'hearsay-suffix') return 'common-knowledge';
  if (site.form === 'hypothetical-quote' || site.form === 'conditional' ||
      site.form === 'conditional-rhetorical') {
    if (RE_HYPOTHETICAL_FRAME.test(sent)) return 'generic-other-counterfactual';
    return 'hypothetical-other';
  }
  if (RE_CUE_HYPOTHETICAL_VOICE.test(sent)) return 'hypothetical-other';

  // 2. Mental verb
  if (site.form === 'mental-verb') {
    if (RE_CUE_NAMED_PROPER.test(leftCtx)) return 'named-third';
    if (RE_CUE_INTERLOCUTOR_2P.test(leftCtx)) return 'interlocutor-current';
    if (RE_CUE_COLLECTIVE.test(broad)) return 'collective-volitional-self';
    if (/(?:思った|思ってた|思ってました|考えた|聞いた|信じた|感じた)/.test(afterSite)) return 'self-past';
    return 'auto';
  }

  // 3. Reified / topic-label / nominalized-of-saying / speech-verb+reified-NP
  if (site.form === 'reified-NP' || site.form === 'topic-label' ||
      site.form === 'nominalized-of-saying' || site.form === 'speech-verb+reified-NP') {
    if (RE_CUE_INSTITUTIONAL.test(broad) || RE_INSTITUTIONAL_CONTEXT_NOUNS.test(site.surface) ||
        RE_INSTITUTIONAL_CONTEXT_NOUNS.test(afterSite)) return 'institutional';
    if (RE_CUE_NAMED_PROPER.test(broad)) return 'named-third';
    if (RE_CUE_PAST_HABITUAL.test(leftCtx) && /(?:言って|主張)/.test(sent)) return 'interlocutor-past';
    if (RE_CUE_FIRST_PERSON.test(broad)) return 'auto';
    if (RE_CUE_COLLECTIVE.test(broad)) return 'collective-volitional-self';
    if (RE_CUE_GENERIC_OTHER.test(broad)) return 'common-knowledge';
    return 'auto';
  }

  // 4. Bracketed-direct / speech-verb (direct quote)
  if (site.form === 'bracketed-direct' || site.form === 'bracketed-direct+speech-verb' ||
      site.form === 'speech-verb') {
    if (RE_CUE_NAMED_PROPER.test(leftCtx)) return 'named-third';
    if (RE_CUE_INSTITUTIONAL.test(leftCtx)) return 'institutional';
    if (RE_CUE_INTERLOCUTOR_2P.test(leftCtx) || RE_CUE_INTERLOCUTOR_Q.test(sent)) return 'interlocutor-current';
    if (RE_CUE_COLLECTIVE.test(broad)) return 'collective-volitional-self';
    if (RE_CUE_GENERIC_OTHER.test(broad)) return 'common-knowledge';
    if (RE_CUE_FIRST_PERSON.test(broad)) return 'self-past';
    if (/(?:言った|言いました|言ってた|聞いた)/.test(afterSite)) return 'self-past';
    if (ctx.isTurnBoundary && ctx.history.length > 0) return 'interlocutor-past';
    return 'auto';
  }

  // 5. Truncated-terminal alone
  if (site.form === 'truncated-terminal') {
    if (RE_CUE_HYPOTHETICAL_VOICE.test(sent)) return 'hypothetical-other';
    return 'auto';
  }
  return 'auto';
}

function inferAuthResp(site: CitationSite, footing: Footing): AuthResp {
  if (footing === 'self-counterfactual' || footing === 'hypothetical-other' ||
      footing === 'generic-other-counterfactual' || footing === 'self-as-projector') return 'projected';
  if (footing === 'self-now' || footing === 'self-prior' || footing === 'self-past' || footing === 'auto') return 'claimed';
  if (footing === 'anonymous-textual' || footing === 'agentless-passive' || site.form === 'authority-invocation') return 'anonymous-textual';
  if (footing === 'collective-volitional-self') return 'collective-distributed';
  if (footing === 'common-knowledge' || footing === 'other-generic' || site.form === 'common-knowledge-cite') return 'collective-distributed';
  if (footing === 'other-specific' || footing === 'named-third' || footing === 'institutional' || footing === 'interlocutor-past' || footing === 'interlocutor-current' || footing === 'participant-observer') return 'attributed';
  if (footing === 'projected-third' || footing === 'interlocutor-as-fictional-third') return 'fictive-attribution';
  if (footing === 'meta-discourse-voice' || footing === 'narrator-voice') return 'unclaimed';
  return 'claimed';
}

function inferOrientation(site: CitationSite, ctx: L4Context): Orientation {
  const sent = ctx.currentSentence;
  const sIdx = sent.indexOf(site.surface);
  const afterSite = sIdx >= 0 ? sent.slice(sIdx + site.surface.length) : '';

  if (site.form === 'reformulative' || site.form === 'topic-label+reformulative') return 'intra-turn-repair';
  if (site.form === 'speech-verb+evidential' || site.form === 'section-wrap') return 'retrospective-distal';
  if (site.form === 'nominalized-of-saying+ratification') return 'metalinguistic';
  if (site.form === 'hypothetical-quote' || site.form === 'conditional' ||
      site.form === 'conditional-rhetorical' || RE_CUE_HYPOTHETICAL_VOICE.test(sent)) return 'lateral-imagined';
  if (site.form === 'truncated-terminal+conditional' || site.form === 'truncated-terminal+nominalizer') return 'downward-projected';
  if (site.form === 'authority-invocation' || site.form === 'passive-attribution+reified-NP' ||
      site.form === 'perception-verb-chain+terminal-と') return 'exophoric';
  if (site.form === 'mental-verb') return 'inward-interior';
  if (site.form === 'common-knowledge-cite' || site.form === 'hearsay-suffix') return 'metalinguistic';

  // Topic-label with future-oriented predicate → prospective-distal
  if (site.form === 'topic-label' && /(?:狙われ|考えて|目指す|なる|となる)/.test(afterSite)) return 'prospective-distal';

  // Past-tense matrix → retrospective
  if (site.temporal.voice === 'past' || /(?:言った|言いました|思った|聞いた|言ってた|なった|になりました)/.test(afterSite)) {
    if (ctx.history.length > 0) {
      const prev = ctx.history[ctx.history.length - 1];
      for (const ps of prev.sites) {
        if (overlap(ps.surface, site.surface) >= 3) return 'retrospective-proximate';
      }
    }
    return 'retrospective-distal';
  }
  if (site.temporal.voice === 'future' || site.temporal.voice === 'projected') return 'prospective-distal';
  if (ctx.isTurnBoundary) return 'cross-turn-uptake';
  if (site.form === 'reified-NP' || site.form === 'topic-label' ||
      site.form === 'speech-verb+reified-NP' || site.form === 'nominalized-of-saying') return 'metalinguistic';
  if (RE_REFORMULATE.test(sent)) return 'intra-turn-repair';
  return 'intra-discourse';
}

function inferStance(site: CitationSite, ctx: L4Context, leftCtx: string): Stance {
  const sentence = ctx.currentSentence;
  if (RE_IRONY_CUES.test(sentence)) {
    if (RE_SELF_MOCKING.test(sentence)) return 'self-mocking';
    return 'contest-ironic';
  }
  if (RE_ACCUSE_PATTERN.test(sentence)) return 'accuse';
  if (RE_CONCESSION.test(sentence)) return 'concede-for-rebuttal';
  if (RE_RECRUIT_PATTERN.test(sentence) && site.form === 'mental-verb') return 'recruitment-via-mutual-memory';
  if (site.form === 'hypothetical-quote' || site.form === 'conditional' ||
      site.form === 'conditional-rhetorical') return 'hedged-report';
  if (site.form === 'speech-verb-negated' || site.form === 'speech-verb-negated-doubly-cited' ||
      site.form === 'speech-verb-in-negated-uncertainty-modal') return 'contest-direct';
  if (site.form === 'authority-invocation' || site.form === 'passive-attribution+reified-NP') return 'endorse-via-authority';
  if (site.form === 'reified-NP' || site.form === 'topic-label' || site.form === 'speech-verb+reified-NP' ||
      site.form === 'nominalized-of-saying' || site.form === 'section-wrap') return 'neutral-report';
  if (/そうなんだが|とはいえ|しかし/.test(sentence)) return 'contest-direct';
  return 'neutral-report';
}

function inferCiteIlloc(site: CitationSite, stance: Stance, ctx: L4Context): CiteIlloc {
  if (RE_DEFINE_PATTERN.test(ctx.currentSentence)) return 'define';
  if (site.form === 'section-wrap') return 'digest';
  if (site.form === 'nominalized-of-saying+ratification') return 'ratify+test';
  if (site.form === 'reformulative' || site.form === 'topic-label+reformulative') return 'reformulate';
  if (site.form === 'reified-NP' || site.form === 'topic-label' || site.form === 'speech-verb+reified-NP') return 'reify';
  if (site.form === 'nominalized-of-saying') return 'digest';
  if (site.form === 'authority-invocation' || site.form === 'passive-attribution+reified-NP' ||
      site.form === 'perception-verb-chain+terminal-と' || site.form === 'speech-verb+evidential') return 'invoke-authority';
  if (site.form === 'hypothetical-quote' || site.form === 'conditional' ||
      site.form === 'conditional-rhetorical' || site.form === 'truncated-terminal+conditional') return 'project';
  if (site.form === 'speech-verb-negated' || site.form === 'speech-verb-negated-doubly-cited' ||
      site.form === 'speech-verb-in-negated-uncertainty-modal') return 'accuse';
  if (RE_REFORMULATE.test(ctx.currentSentence)) return 'digest';
  if (stance === 'accuse' || stance === 'accusation') return 'accuse';
  if (stance === 'concede-for-rebuttal' || stance === 'sympathy-alignment') return 'concede';
  if (stance === 'recruitment-via-mutual-memory') return 'rally';
  if (site.form === 'mental-verb') return 'claim';
  return 'claim';
}

function inferDiscFn(site: CitationSite, cite_illoc: CiteIlloc, ctx: L4Context): DiscFn {
  const sent = ctx.currentSentence;
  const sIdx = sent.indexOf(site.surface);
  const afterSite = sIdx >= 0 ? sent.slice(sIdx + site.surface.length, sIdx + site.surface.length + 16) : '';

  if (site.form === 'reformulative' || site.form === 'topic-label+reformulative') return 'lateral-reformulation';
  if (site.form === 'section-wrap') return 'section-closure';
  if (site.form === 'nominalized-of-saying+ratification') return 'self-digest-for-ratification';
  if (site.form === 'speech-verb-negated' || site.form === 'speech-verb-negated-doubly-cited' ||
      site.form === 'speech-verb-in-negated-uncertainty-modal') return 'counterevidence';
  if (site.form === 'speech-verb+evidential' || site.form === 'passive-attribution+reified-NP' ||
      site.form === 'perception-verb-chain+terminal-と') return 'invoke-as-evidence';
  if (site.form === 'authority-invocation') return 'invoke-as-evidence';
  if (site.form === 'truncated-terminal+conditional' || site.form === 'conditional-rhetorical') {
    if (/(?:じゃないか|んじゃないか)/.test(site.surface) || /(?:じゃないか|んじゃないか)/.test(afterSite)) return 'anticipated-objection';
    return 'meta-framing';
  }
  if (site.form === 'truncated-terminal+nominalizer') return 'meta-framing';
  if (site.form === 'mental-verb') {
    if (RE_HYPOTHETICAL_FRAME.test(sent)) return 'anticipated-objection';
    return 'warrant';
  }
  if (RE_PAST_COLLECTIVE_SPEECH.test(sent) &&
      (site.form === 'speech-verb+reified-NP' || site.form === 'speech-verb')) return 'invoke-as-precedent';
  // Reified-NP with strong factualization head noun → factualization
  if ((site.form === 'reified-NP' || site.form === 'speech-verb+reified-NP') &&
      /(?:事実|合流|吸収|併合)/.test(site.surface)) return 'factualization';

  if (cite_illoc === 'reify') return 'reification-for-arg';
  if (cite_illoc === 'invoke-authority') return 'invoke-as-evidence';
  if (cite_illoc === 'define') return 'definition';
  if (cite_illoc === 'digest') return 'self-digest-for-ratification';
  if (cite_illoc === 'accuse') return 'accusation';
  if (cite_illoc === 'concede') return 'concession';
  if (cite_illoc === 'rally') return 'common-ground-invocation→rally';
  if (site.form === 'topic-label') return 'topic-intro';
  if (site.form === 'hypothetical-quote') return 'anticipated-objection';
  if (ctx.isTurnBoundary) return 'transitional-pivot';
  return 'warrant';
}

function inferEvidenceDepth(site: CitationSite, footing: Footing): EvidenceDepth {
  // Form-specific overrides
  if (site.form === 'speech-verb+evidential') return '2-hop';
  if (site.form === 'speech-verb-negated' || site.form === 'speech-verb-negated-doubly-cited' ||
      site.form === 'speech-verb-in-negated-uncertainty-modal' ||
      site.form === 'speech-verb+interrogative-tag') return '1-hop-personal';
  if (site.form === 'passive-attribution+reified-NP' ||
      site.form === 'perception-verb-chain+terminal-と') return '1-hop-document';
  if (site.form === 'truncated-terminal+conditional' && footing === 'agentless-passive') return 'mythical-anonymous';
  if (site.form === 'hypothetical-quote' || site.form === 'conditional' ||
      site.form === 'conditional-rhetorical') return 'hypothetical';
  if (site.form === 'hearsay-suffix') return '>2-hop';
  if (site.form === 'common-knowledge-cite') return 'collective-memory';
  if (site.form === 'section-wrap' || site.form === 'nominalized-of-saying+ratification') return null;

  // Footing-driven
  if (footing === 'narrator-voice') return '2-hop';
  if (footing === 'self-now' || footing === 'self-prior' || footing === 'self-past' || footing === 'auto' ||
      footing === 'collective-volitional-self') return 'direct';
  if (footing === 'self-counterfactual' || footing === 'hypothetical-other' ||
      footing === 'generic-other-counterfactual' || footing === 'self-as-projector') return 'hypothetical';
  if (footing === 'meta-discourse-voice') {
    if (site.form === 'reified-NP' || site.form === 'topic-label' ||
        site.form === 'speech-verb+reified-NP') return '1-hop-personal';
    return null;
  }
  if (footing === 'other-specific' || footing === 'named-third' ||
      footing === 'interlocutor-past' || footing === 'interlocutor-current') return '1-hop-personal';
  if (footing === 'institutional' || footing === 'institutional+projected-imagined' ||
      footing === 'anonymous-textual') return '1-hop-document';
  if (footing === 'common-knowledge' || footing === 'other-generic') return 'collective-memory';
  if (footing === 'projected-third' || footing === 'agentless-passive') return 'mythical-anonymous';
  if (footing === 'participant-observer') return '1-hop-personal+observation';
  return null;
}

function inferUpstreamFrame(ctx: L4Context): UpstreamFrame {
  // If past N sentences had multiple sites with reify/reify-arg, we're in argument-frame
  if (ctx.history.length === 0) return 'no-frame';
  let reify = 0, narrative = 0, institutional = 0, meta = 0;
  for (const stk of ctx.history) {
    for (const s of stk.sites) {
      if (s.disc_fn === 'reification-for-arg' || s.disc_fn === 'opposition-setup') reify++;
      if (s.form === 'bracketed-direct' || s.form === 'speech-verb') narrative++;
      if (s.footing === 'institutional' || s.footing === 'anonymous-textual') institutional++;
      if (s.disc_fn === 'meta-lexical-search' || s.form === 'topic-label') meta++;
    }
  }
  const top = Math.max(reify, narrative, institutional, meta);
  if (top < 2) return 'no-frame';
  if (top === institutional) return 'institutional-frame';
  if (top === narrative) return 'narrative-frame';
  if (top === meta) return 'meta-frame';
  return 'argument-frame';
}

function overlap(a: string, b: string): number {
  // Length of longest common substring of length ≥ 2 (cheap-ish).
  let best = 0;
  const an = a.length, bn = b.length;
  if (an === 0 || bn === 0) return 0;
  const dp = new Array(bn + 1).fill(0);
  for (let i = 1; i <= an; i++) {
    let prev = 0;
    for (let j = 1; j <= bn; j++) {
      const tmp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev + 1;
        if (dp[j] > best) best = dp[j];
      } else {
        dp[j] = 0;
      }
      prev = tmp;
    }
  }
  return best;
}

// ── Main entry ────────────────────────────────────────────────────

export function classifyL4(
  stack: CitationStack,
  ctx: L4Context,
): CitationStack {
  for (const site of stack.sites) {
    // leftCtx: text before site within current sentence
    const leftCtx = ctx.currentSentence.slice(0, Math.max(0, site.locator.charStart - site.surface.length));

    const footing = inferFooting(site, ctx, leftCtx);
    const auth_resp = inferAuthResp(site, footing);
    const orientation = inferOrientation(site, ctx);
    const stance = inferStance(site, ctx, leftCtx);
    const cite_illoc = inferCiteIlloc(site, stance, ctx);
    const disc_fn = inferDiscFn(site, cite_illoc, ctx);
    const evidence_depth = inferEvidenceDepth(site, footing);
    const upstream_frame = inferUpstreamFrame(ctx);

    site.footing = footing;
    site.auth_resp = auth_resp;
    site.orientation = orientation;
    site.stance = stance;
    site.cite_illoc = cite_illoc;
    site.disc_fn = disc_fn;
    site.evidence_depth = evidence_depth;
    site.upstream_frame = upstream_frame;
    site.layerCompleted = Math.max(site.layerCompleted, 4) as CitationSite['layerCompleted'];
    site.confidence.l4 = 0.7;
  }
  return stack;
}
