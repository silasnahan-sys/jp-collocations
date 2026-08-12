/**
 * citation-types.ts — 20-axis citation taxonomy (schema_version: 20-axis-v1).
 *
 * Operationalizes the gold-annotated set in `_tmp_inyou_gold.json` as
 * compile-time types. Authority for axis values: see §"Framework facts"
 * in the project root and the gold sidecar.
 *
 * Design intent:
 *   - Every axis is a closed string-literal union → exhaustive switches
 *     work, and adding a value is a one-line schema bump that the
 *     compiler will surface across the entire classifier.
 *   - Axes split into L1..L5 buckets matching the classifier pipeline:
 *       L1 = と-node type (gates everything)
 *       L2 = intrinsic axes (single-site features only)
 *       L3 = sentence composition (lamination + parent/children/siblings)
 *       L4 = discourse-relational (footing, stance, cite_illoc, disc_fn,
 *            evidence_depth, upstream_frame, uptake, auth_resp,
 *            orientation)
 *       L5 = cross-turn chain (uptake_target, recruits, chain typing)
 *   - All offsets are NFC char offsets within the source transcript, to
 *     match the existing sidecar wire format.
 */

// ── L1: と-node typing ─────────────────────────────────────────────

/**
 * What kind of grammatical role the と / って / ということ etc. is playing.
 * This is the FIRST decision the pipeline makes; everything else is gated
 * on `quote-particle` or `complementizer`. Non-citation uses are filtered
 * out at this layer.
 */
export type ToNodeKind =
  | 'quote-particle'        // と / って attaching reported / projected speech
  | 'complementizer'        // ということ / という(N) reifying clause→NP
  | 'depictive'             // 〜とする, 〜と考える (cognitive complement, still citational)
  | 'resultative'           // 〜となる, 〜と化す (state-becoming; NON-citation)
  | 'comitative'            // X と Y (with); NON-citation
  | 'conditional'           // 〜と (when/if); NON-citation
  | 'list-coordinator'      // X と Y と Z; NON-citation
  | 'unknown';

// ── L2: intrinsic axes (single-site morphosyntax) ─────────────────

/**
 * FORM — gold values are compositional (e.g. 'speech-verb+reified-NP').
 * We allow the canonical atomic forms plus the gold compound strings;
 * compound forms are passed through as opaque strings.
 */
export type Form =
  // Atomic canonical forms
  | 'bracketed-direct'             // 「…」と  (was: direct-quote)
  | 'speech-verb'                  // と言った / と聞いた  (was: reported-quote)
  | 'mental-verb'                  // と思う / と感じる  (was: mental-cite)
  | 'hearsay-suffix'               // らしい / そうだ / みたい
  | 'hypothetical-quote'           // と言ったら
  | 'conditional'                  // と (when/if) used citationally
  | 'conditional-rhetorical'
  | 'common-knowledge-cite'
  | 'truncated-terminal'
  | 'truncated-terminal+nominalizer'
  | 'truncated-terminal+conditional'
  | 'reified-NP'
  | 'nominalized-of-saying'        // ってこと / ということ as NP-of-utterance
  | 'nominalized-of-saying+ratification'
  | 'topic-label'                  // という点で / という形で
  | 'topic-label+reformulative'
  | 'reformulative'                // restatement (echo / digest)
  | 'interjection-cite'
  | 'analogy'                      // かのよう / みたいな
  | 'authority-invocation'         // とされる / と言われている
  | 'echo+ratification-particle'
  | 'perception-verb-chain+terminal-と'
  | 'section-wrap'
  | 'section-wrap+interrogative'
  | 'speech-verb+evidential'
  | 'speech-verb+interrogative-tag'
  | 'speech-verb+reified-NP'
  | 'speech-verb-NP'
  | 'speech-verb-extension'
  | 'speech-verb-in-negated-uncertainty-modal'
  | 'speech-verb-modal-neg'
  | 'speech-verb-negated'
  | 'speech-verb-negated-doubly-cited'
  | 'mental-verb+narrator-evidential'
  | 'passive-attribution+reified-NP'
  | 'bracketed-direct+speech-verb'
  | 'unknown';

export type InternalIlloc =
  | 'assertion'
  | 'question'
  | 'imperative'
  | 'request'
  | 'exclamation'
  | 'evaluation'
  | 'fragment'
  | 'categorization'
  | 'command'                      // synonym for imperative w/ social force
  | 'complaint'
  | 'negated-illoc'
  | 'volitional'                   // Xしよう / Xたい
  | null;          // no inner illocution (reified-NP, authority-invocation)

export type Scope =
  | 'word'
  | 'single-lexeme'
  | 'NP'
  | 'clause'
  | 'multi-clause'
  | 'proposition'                  // full propositional content
  | 'complex-prop'                 // proposition with internal structure
  | 'discourse-chunk'              // multi-turn span
  | 'meta-chunk'                   // discourse-about-discourse
  | null;

/** Reformulation vector — how the citation reshapes the cited content. */
export type ReformVec =
  | 'factualization'
  | 'positionalization'
  | 'narrativization'
  | 'formalization'
  | 'diagnosalization'
  | 'downgrade-specificity'
  | 'upgrade-specificity'
  | 'intensify-commitment'
  | 'soften-commitment'
  | 'lateral-sub'                  // substitute lateral category
  | 'register-shift'
  | 'n/a';

export type Fidelity =
  | 'verbatim'
  | 'near-verbatim'
  | 'paraphrase'
  | 'typification'
  | 'caricature'
  | 'reconstruction'
  | 'projection';

export type DeicticShift =
  | 'full-shift'          // pronouns/tense fully shifted to voice
  | 'partial-shift'
  | 'no-shift'            // uses speaker's deictic anchor
  | 'free-indirect';

export interface TemporalTriple {
  /** Utterance time of the matrix speaker. */
  utt: 'now' | 'past' | 'future' | 'timeless';
  /** When the cited voice spoke (or would have spoken). */
  voice: 'immediate' | 'past' | 'future' | 'hypothetical' | 'habitual' | 'projected';
  /** What the cited content refers to. */
  rel: 'now' | 'past' | 'future' | 'timeless' | 'counterfactual';
}

/** Negation scope when the citation is embedded under a negative. */
export type CiteNegScope =
  | 'none'
  | 'inner-predicate'
  | 'outer-matrix'
  | 'wide-cite'
  | 'quantifier'
  | 'predicate-neg'
  | 'illocution-neg'                // cited illocution itself is negated
  | 'modal-neg';                    // negation interacts with modal

/** Aspect of mental-cite verbs (と思う family). */
export type MentalCiteAspect =
  | 'punctual'
  | 'momentary'                     // synonym for punctual in gold
  | 'durative'
  | 'habitual-evaluative'
  | 'iterative'
  | 'retrospective-revised'         // と思っていた → と思う revision
  | null;

export type Prosody =
  | 'rising'
  | 'falling'
  | 'flat'
  | 'emphatic'
  | 'unknown';

// ── L3: sentence composition ──────────────────────────────────────

/**
 * Lamination: layered embedding within ONE sentence's citation stack.
 */
export type Lamination =
  | 'leaf'                          // no inner citation
  | 'inner'                         // appears inside another
  | 'outer'                         // contains an inner
  | 'pivot'                         // both inner and outer
  | 'shallow-nest'                  // one level of nesting
  | 'parallel-siblings';            // sibling sites, no nesting

/** Argument macro position within the host sentence. */
export type PosArg =
  | 'claim'
  | 'warrant'
  | 'backing'
  | 'qualifier'
  | 'rebuttal'
  | 'counter-rebuttal'
  | 'topic'
  | 'opening'
  | 'closing'
  | 'transition'
  | 'evaluation'
  | 'illustration'
  | 'digression'
  | 'aside'
  | 'concession-before-rebuttal'
  | null;

/**
 * Rhetorical MOVE — orthogonal to pos_arg.
 * pos_arg says *where* a chunk sits in the argument macro; rhet_move says
 * *what transformation* the speaker is performing on prior material with
 * this chunk. Corresponds to the user's red F / P / 反復 / 広げる / 根拠 /
 * 例示 / 導入 / 流れ annotations. 'plain' = no marked move.
 */
export type RhetMove =
  | 'plain'
  | 'reformulation'        // F: 言い直し
  | 'inversion'            // P: 倒置法
  | 'repetition'           // 反復
  | 'expansion'            // 広げる (reformulation that broadens scope)
  | 'grounding'            // 根拠 (gives reason for prior)
  | 'exemplification'      // 例示
  | 'introduction'         // 導入 (turn / topic introduction move)
  | 'transition';          // 流れ (structural connective)

/**
 * Intra-sentence edge between two sites in the same CitationStack.
 * Distinct from L5 cross-turn chains and from parent/child containment.
 * Captures the red arrows in the user's annotation style.
 */
export type IntraEdgeKind =
  | 'reformulates'   // from is a reformulation of to
  | 'inverts'        // from is an inversion of to
  | 'repeats'        // from repeats to (with surface overlap)
  | 'expands'        // from expands to (reformulation + scope-broadening)
  | 'grounds'        // from gives grounds for to
  | 'exemplifies'    // from is an example of to
  | 'introduces'    // from introduces / sets up to
  | 'connects';      // pure connective / flow link

export interface IntraSentenceEdge {
  fromSiteId: string;
  toSiteId: string;
  kind: IntraEdgeKind;
  /** 0..1 confidence the edge is real (vs. spurious co-occurrence). */
  confidence: number;
}

// ── L4: discourse-relational ──────────────────────────────────────

export type Footing =
  | 'auto'                             // speaker as default self-voice
  | 'self-prior'
  | 'self-now'
  | 'self-past'                        // synonym for self-prior in gold
  | 'self-counterfactual'
  | 'self-as-projector'                // speaker projecting onto another
  | 'other-specific'
  | 'named-third'                      // explicitly named other
  | 'other-generic'
  | 'common-knowledge'                 // gnomic / shared cultural voice
  | 'institutional'
  | 'institutional+projected-imagined'
  | 'collective-volitional-self'
  | 'participant-observer'
  | 'interlocutor-current'             // present listener
  | 'interlocutor-past'                // listener's prior utterance
  | 'interlocutor-as-fictional-third'
  | 'meta-discourse-voice'
  | 'narrator-voice'
  | 'anonymous-textual'
  | 'agentless-passive'                // とされる without overt agent
  | 'projected-third'
  | 'hypothetical-other'
  | 'generic-other-counterfactual';

export type AuthResp =
  | 'claimed'                  // speaker owns it
  | 'attributed'               // explicitly given to other
  | 'projected'                // imagined / not actually said
  | 'collective-distributed'   // we / they-as-group, diffuse
  | 'anonymous-textual'        // text/genre
  | 'fictive-attribution'      // playful pseudo-cite
  | 'unclaimed';               // suspended

export type Orientation =
  | 'retrospective-distal'
  | 'retrospective-proximate'
  | 'prospective'
  | 'prospective-distal'
  | 'counterfactual-emergent'
  | 'self-digest-for-ratification'
  | 'cross-turn-uptake'
  | 'cross-turn-uptake+storyworld-entry'
  | 'simultaneous'
  | 'atemporal'
  | 'exophoric'                        // pointing outside the discourse
  | 'intra-discourse'                  // within current discourse
  | 'intra-turn-repair'                // within-turn self-repair
  | 'inward-interior'                  // speaker's inner state
  | 'inward-retrospective'             // remembered inner state
  | 'lateral-imagined'                 // imagined parallel scene
  | 'metalinguistic'                   // about the language itself
  | 'downward-projected'               // projected onto subordinate
  | 'storyworld-entry'
  | 'retrospective-distal→prospective-distal'
  | 'inward-interior→prospective-distal';

export type Stance =
  | 'neutral-report'
  | 'hedged-report'
  | 'endorse-commit'                   // strong endorsement
  | 'endorse-via-authority'
  | 'endorsement'
  | 'distance-doubt'                   // distance with doubt
  | 'distancing'
  | 'irony-mock'
  | 'self-mocking'
  | 'mock'
  | 'challenge'
  | 'contest-direct'                   // direct contest
  | 'contest-ironic'                   // ironic contest
  | 'recruitment-via-mutual-memory'
  | 'sympathy-alignment'
  | 'align'                            // simple alignment
  | 'concede-for-rebuttal'             // concede en route to rebuttal
  | 'accusation'
  | 'accuse'                           // synonym for accusation
  | 'defense'
  | 'playful';

export type CiteIlloc =
  | 'report'
  | 'claim'                            // direct claim via citation
  | 'reify'
  | 'define'
  | 'digest'                           // summarize / restate
  | 'pivot'                            // pivot the discourse
  | 'rally'                            // rally support
  | 'recruit'
  | 'solidarize'                       // build solidarity
  | 'mock'
  | 'mock+solidarize'
  | 'accuse'
  | 'concede'
  | 'corroborate'                      // back up with parallel
  | 'reformulate'
  | 'project'
  | 'evaluate'
  | 'hedge'                            // softening cite
  | 'lament'                           // express regret
  | 'pre-empt'                         // pre-empt counter
  | 'test'                             // test the proposition
  | 'ratify+test'                      // ratify and test
  | 'invoke-authority';

export type DiscFn =
  | 'reification-for-arg'
  | 'reification-for-arg→accusation'
  | 'evidence-marshalling'
  | 'warrant'
  | 'counterevidence'
  | 'invoke-as-evidence'
  | 'invoke-as-precedent'
  | 'topic-label'
  | 'topic-intro'
  | 'transitional-pivot'
  | 'transitional-pivot→warrant'
  | 'self-digest-for-ratification'
  | 'ratification-solicitation'
  | 'ratifying-extension'
  | 'meta-lexical-search'
  | 'meta-framing'
  | 'comedic-defamiliarization'
  | 'comic-deflation'
  | 'opposition-setup'
  | 'concession-bridge'
  | 'concession'
  | 'closing-formula'
  | 'closing-commitment'
  | 'section-closure'
  | 'definition'
  | 'definition→bridge'
  | 'factualization'
  | 'lateral-reformulation'
  | 'storyworld-entry'
  | 'accusation'
  | 'anticipated-objection'
  | 'anticipated-objection-reversed'
  | 'blame-deflection'
  | 'common-ground-invocation'
  | 'common-ground-invocation→rally'
  | 'empathetic-alignment';

export type EvidenceDepth =
  | 'direct'                          // direct experience
  | '0-hop-experiential'
  | '1-hop-personal'
  | '1-hop-personal+observation'
  | '1-hop-document'
  | '2-hop'
  | '2-hop-attributed'
  | '>2-hop'
  | 'n-hop-rumor'
  | 'textual'
  | 'common-knowledge'
  | 'collective-memory'
  | 'mythical-anonymous'
  | 'hypothetical'
  | 'projected'
  | null;

export type Uptake =
  | 'taken-up'
  | 'ratified'                        // listener confirms / agrees
  | 'repaired-by-other'               // listener corrects
  | 'ignored'
  | 'pending'
  | 'self-uptake'
  | 'cross-turn-uptake';

export type UpstreamFrame =
  | 'no-frame'
  | 'narrative-frame'
  | 'argument-frame'
  | 'meta-frame'
  | 'institutional-frame'
  | 'concession'                      // operating under a concession
  | 'hedging'                         // operating under hedge
  | 'resumption';                     // resumption of prior thread

// ── L5: cross-turn chain typing ───────────────────────────────────

export type ChainKind =
  | 'self-echo'                // speaker re-cites own prior
  | 'other-uptake'             // listener cites speaker
  | 'collaborative-reformulation'
  | 'empathetic-projection'    // 3+ turns of attributed inner-states
  | 'accusation-defense'
  | 'recruitment-confirmation'
  | 'storyworld-entry'         // enter narrative voice
  | 'storyworld-exit'          // pop out of narrative
  | 'reification-ladder';      // successive reifications

// ── Site / Stack / Chain shapes ───────────────────────────────────

/** A unique pointer into the corpus. */
export interface CitationLocator {
  transcriptId: string;        // e.g. 'jcpmovie/UynodqYcNxM.txt'
  sentenceIdx: number;         // 0-based sentence index within transcript
  charStart: number;           // NFC offset within the sentence
  charEnd: number;             // exclusive
}

/**
 * A single citation site = one と / って / ということ etc. occurrence
 * that survived L1 (i.e. is a citation, not coordinator / comitative).
 *
 * All L2 axes are populated by L2. L3 fills lamination + pos_arg +
 * parent/children/siblings. L4 fills the relational axes. L5 fills
 * uptake_target + recruits + chain pointers.
 */
export interface CitationSite {
  id: string;                  // stable per-transcript id (e.g. 't0042:s2')
  locator: CitationLocator;
  surface: string;             // the raw cited span (NFC)

  // L1
  toKind: ToNodeKind;

  // L2 intrinsic
  form: Form;
  internal_illoc: InternalIlloc;
  scope: Scope;
  reform_vec: ReformVec;
  fidelity: Fidelity;
  deictic_shift: DeicticShift;
  temporal: TemporalTriple;
  cite_neg_scope: CiteNegScope;
  mental_cite_aspect: MentalCiteAspect;
  prosody: Prosody;

  // L3 sentence composition
  lamination: Lamination;
  pos_arg: PosArg;
  rhet_move: RhetMove;
  parent: string | null;       // site id of enclosing site (same sentence)
  children: string[];          // site ids of enclosed sites
  siblings: string[];          // site ids of co-argument sites

  // L4 discourse-relational
  footing: Footing;
  auth_resp: AuthResp;
  orientation: Orientation;
  stance: Stance;
  cite_illoc: CiteIlloc;
  disc_fn: DiscFn;
  evidence_depth: EvidenceDepth;
  upstream_frame: UpstreamFrame;
  uptake: Uptake;

  // L5 cross-turn
  uptake_target: string | null;   // site id this one picks up (any sentence)
  recruits: string[];             // role tags like 'listener-as-confirmer'
  chainId: string | null;         // CitationChain.id this site belongs to

  // diagnostics
  layerCompleted: 1 | 2 | 3 | 4 | 5;
  confidence: { l1: number; l2: number; l3: number; l4: number; l5: number };
}

/** All sites within ONE sentence, with their lamination relationships
 *  already resolved. The stack is a forest of parent/child trees with
 *  sibling links across roots. */
export interface CitationStack {
  sentenceIdx: number;
  sites: CitationSite[];
  rootSiteIds: string[];       // sites with parent === null
  /** Edges between sites in this same sentence (red F/P/反復/広げる moves). */
  intra_edges: IntraSentenceEdge[];
}

/** A chain of sites across two or more sentences (possibly across turns). */
export interface CitationChain {
  id: string;
  kind: ChainKind;
  members: string[];           // ordered site ids
  /** "Anchor" voice — the figure whose words/thoughts thread the chain. */
  anchorFooting: Footing;
  /** Whether the chain has terminated (uptake-closed) or is still open. */
  closed: boolean;
}

/** Speaker / voice graph: every distinct "voice" the transcript instantiates.
 *  Nodes are voices, edges are citation relations (X cites Y, X uptakes Y).
 *  This is what feeds the visualization layer in L5. */
export interface SourceGraphNode {
  voiceId: string;             // synthesized; e.g. 'speaker:0' or 'voice:党'
  footing: Footing;
  attestations: string[];      // site ids where this voice surfaces
}

export interface SourceGraphEdge {
  fromVoiceId: string;
  toVoiceId: string;
  relation: 'cites' | 'uptakes' | 'reformulates' | 'accuses' | 'defends' | 'recruits';
  siteId: string;              // the site instantiating this edge
}

export interface SourceGraph {
  nodes: SourceGraphNode[];
  edges: SourceGraphEdge[];
  chains: CitationChain[];
}

/** Top-level result of running the full pipeline on one transcript. */
export interface TranscriptCitations {
  transcriptId: string;
  stacks: CitationStack[];     // one per sentence with ≥1 site
  graph: SourceGraph;
  /**
   * Per-turn rhetorical programs (typed move sequences + slot bindings
   * + span shapes + schema candidates). Imported lazily to avoid a
   * cycle; see ./rhetorical-program.ts for the full model.
   */
  programs: import('./rhetorical-program').RhetoricalProgram[];
  stats: {
    sentencesScanned: number;
    sitesFound: number;
    rejectedByL1: number;
    durationMs: number;
  };
}

// ── Defaults (mirror gold sidecar) ────────────────────────────────

export const DEFAULT_TEMPORAL: TemporalTriple = {
  utt: 'now',
  voice: 'immediate',
  rel: 'now',
};

/** Default-fill for a site after L1 only. L2..L5 will overwrite. */
export function newSite(
  id: string,
  locator: CitationLocator,
  surface: string,
  toKind: ToNodeKind,
): CitationSite {
  return {
    id,
    locator,
    surface,
    toKind,
    form: 'unknown',
    internal_illoc: null,
    scope: null,
    reform_vec: 'n/a',
    fidelity: 'paraphrase',
    deictic_shift: 'full-shift',
    temporal: { ...DEFAULT_TEMPORAL },
    cite_neg_scope: 'none',
    mental_cite_aspect: null,
    prosody: 'unknown',
    lamination: 'leaf',
    pos_arg: null,
    rhet_move: 'plain',
    parent: null,
    children: [],
    siblings: [],
    footing: 'auto',
    auth_resp: 'claimed',
    orientation: 'intra-discourse',
    stance: 'neutral-report',
    cite_illoc: 'claim',
    disc_fn: 'warrant',
    evidence_depth: null,
    upstream_frame: 'no-frame',
    uptake: 'pending',
    uptake_target: null,
    recruits: [],
    chainId: null,
    layerCompleted: 1,
    confidence: { l1: 1, l2: 0, l3: 0, l4: 0, l5: 0 },
  };
}

/** Citation-bearing toKind values (the ones L2+ must process). */
export const CITATION_TOKINDS: ReadonlySet<ToNodeKind> = new Set([
  'quote-particle',
  'complementizer',
  'depictive',
]);

/** Non-citation toKind values (filtered out after L1). */
export const NONCITATION_TOKINDS: ReadonlySet<ToNodeKind> = new Set([
  'resultative',
  'comitative',
  'conditional',
  'list-coordinator',
]);
