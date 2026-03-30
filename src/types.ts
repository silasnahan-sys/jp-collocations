export enum PartOfSpeech {
  Noun = "名詞",
  Verb = "動詞",
  Adjective_i = "い形容詞",
  Adjective_na = "な形容詞",
  Adverb = "副詞",
  Particle = "助詞",
  AuxVerb = "助動詞",
  Conjunction = "接続詞",
  Interjection = "感動詞",
  Prefix = "接頭詞",
  Suffix = "接尾詞",
  Expression = "表現",
  Other = "その他",
}

export enum CollocationSource {
  Hyogen = "hyogen.info",
  Manual = "manual",
  Import = "import",
  Classified = "classified",
  Tsukuba = "tsukuba",
  NinjAL = "ninjal",
  UserCorpus = "user-corpus",
}

export enum Register {
  Spoken = "spoken",
  Written = "written",
  Formal = "formal",
  Casual = "casual",
  Literary = "literary",
  Academic = "academic",
  Slang = "slang",
}

export enum JLPTLevel {
  N5 = "N5",
  N4 = "N4",
  N3 = "N3",
  N2 = "N2",
  N1 = "N1",
}

export enum BoundaryType {
  Phrase = "phrase",
  MultiPhrase = "multi-phrase",
  Clause = "clause",
  Idiom = "idiom",
  Compound = "compound",
}

export enum CollocationStrength {
  Weak = "weak",
  Moderate = "moderate",
  Strong = "strong",
  Fixed = "fixed",
}

/**
 * IdiomaticityLayer — How compositional vs idiomatic is this expression?
 *
 * Layer 1 (Free): Any logically valid combination. The meaning is fully
 *   compositional. e.g. 赤い車, 大きい犬.
 *
 * Layer 2 (Preferred): One option is statistically preferred over equally
 *   grammatical alternatives. The combination is "more natural" but you
 *   can often predict why. e.g. 激しい雨 (not 強い雨 — 激しい implies
 *   violent/fierce, while 強い implies power; rain "rages" more than it
 *   "is strong"), とても疲れた vs かなり疲れた (both work; register differs).
 *
 * Layer 3 (Collocation): Strong statistical bond. At least one element has
 *   a restricted semantic prosody or restricted co-occurrence range. The
 *   native speaker "just knows" this pairing. e.g. かなりの量 (かなり
 *   strongly prefers noun phrases denoting measurable quantities), 心が動く
 *   (心 as subject of 動く is semi-idiomatic — the heart "moves" emotionally).
 *
 * Layer 4 (SemiIdiom): One element takes on a specialized, partly
 *   non-compositional meaning within the phrase. You can still guess the
 *   meaning from context but the meaning of one word is "stretched".
 *   e.g. 足を引っ張る (pull someone's leg / hold back — feet are literal
 *   but the meaning is metaphorical), 顔を出す (show one's face / attend).
 *
 * Layer 5 (FullIdiom): Fully non-compositional. The combined meaning
 *   cannot be derived from the parts. Changing one word breaks the idiom.
 *   e.g. 猫の手も借りたい (so busy you'd borrow a cat's paw = desperately
 *   short-handed), 石の上にも三年 (perseverance pays off).
 *
 * The layer interacts with register: めっちゃ疲れている and とても疲れている
 * are both Layer 2 (preferred adverb-predicate collocations) but differ in
 * register (Slang/Casual vs Neutral/Written). めっちゃ is register-BOUND —
 * it cannot appear in formal written Japanese without a deliberate stylistic
 * effect, which makes the collocation relation additionally constrained.
 */
export enum IdiomaticityLayer {
  Free = "free",
  Preferred = "preferred",
  Collocation = "collocation",
  SemiIdiom = "semi-idiom",
  FullIdiom = "full-idiom",
}

/**
 * CollocationRelation — The *type* of semantic/syntactic relation
 * holding between the two elements of the collocation.
 *
 * This is the most important axis: two collocations can have the same
 * surface pattern (Adv+V) but very different relational types.
 *
 * IntensifierGradient: An adverb on a scale of degree modifies a
 *   stative predicate. The pairing is constrained by both the adverb's
 *   register and its semantic prosody (positive/negative/neutral).
 *   e.g. とても疲れている, めっちゃ疲れている, すごく嬉しい, 非常に困難な.
 *   Key fact: the adverb's register RESTRICTS its collocates — めっちゃ
 *   co-occurs almost exclusively with casual speech contexts, so めっちゃ
 *   困難な状況 sounds jarring while とても困難な状況 is neutral.
 *
 * SemanticPreference: Noun A "selects" adjective/verb B because of
 *   semantic compatibility; alternatives are grammatical but unnatural.
 *   e.g. 激しい雨 (not 強い雨 — 激しい encodes "violent/uncontrolled
 *   intensity", matching rain's quality better than 強い which encodes
 *   "raw power"). 深い意味 (not *重い意味 — meaning can be deep, not heavy).
 *
 * SyntacticPreference: The collocation is driven primarily by grammatical
 *   structure preference: a particular argument structure is strongly
 *   preferred. e.g. かなりの量 (quantifier + の + 量 — the の-modification
 *   pattern is strongly preferred over 量がかなりある, even though both
 *   are grammatical, because かなりの量 is a nominal chunk that works as
 *   a compact modifier). Compare: 量が多い = free predication (SubjectPred),
 *   かなりの量 = tighter nominal collocation (NounModification).
 *
 * BodyIdiom: Body part noun takes extended/metaphorical meaning.
 *   The body part retains a connection to the physical but the combination
 *   has additional pragmatic weight. e.g. 腰が低い (humble attitude,
 *   lit. "low waist"), 鼻が高い (proud, lit. "high nose"), 顔が広い
 *   (well-connected, lit. "wide face").
 *
 * VerbComplement: A verb strongly selects for a specific nominal
 *   complement (object/subject). Without this complement the verb sounds
 *   incomplete. e.g. 決断を下す (make a decision — 下す requires a formal
 *   "authority" noun), 責任を取る (take responsibility), 役割を果たす.
 *
 * AdverbialColoring: The adverb adds a specific shade of manner/degree
 *   that is not predicted by the verb's meaning alone, and this shade is
 *   lexically particular — a synonym adverb would have a noticeably
 *   different nuance. e.g. じっくり考える (think carefully/thoroughly,
 *   with time and depth) vs ゆっくり考える (think slowly, temporal pace)
 *   — both are Adv+V but じっくり encodes qualitative depth, ゆっくり
 *   encodes tempo. The collocate VERB matters too: じっくり is nearly
 *   restricted to deliberative verbs (考える, 選ぶ, 検討する).
 *
 * RegisterBound: The collocation exists primarily because one element is
 *   register-specific; the relation itself is semantically free (any
 *   intensifier could modify the predicate) but the register of the
 *   adverb/particle CONSTRAINS the environment to a particular social
 *   register. e.g. めっちゃ疲れている — めっちゃ is Kansai/youth slang;
 *   its co-occurrence with any predicate is register-constrained, not
 *   semantically constrained. The whole phrase belongs in casual register.
 *
 * CulturalFixed: Expression is tied to Japanese cultural knowledge/
 *   practices. Understanding requires cultural background.
 *   e.g. お世話になっております (formal greeting), よろしくお願いします.
 *
 * AspectualPattern: The collocation expresses a specific aspect (ongoing,
 *   completive, inceptive, continuative) where the specific aspectual
 *   form interacts with the verb to create a preferred pairing.
 *   e.g. ずっと〜ている (ongoing continuative), ようやく〜た (finally
 *   completive — ようやく specifically marks relief at completion).
 *
 * NominalChunk: Two nouns (or N+の+N) form a tight chunk that resists
 *   modification or re-ordering. Weaker than compound word but stronger
 *   than free modification. e.g. かなりの量, 重大な決断, 深刻な問題.
 *
 * FixedFormula: Completely frozen expression; replacing any element
 *   destroys the meaning. Includes proverbs, set phrases, greetings.
 *   e.g. 猫の手も借りたい, 石の上にも三年, お疲れ様でした.
 *
 * DiscourseConnector: Expression functions as a discourse-level
 *   connective; its collocational force comes from its function in
 *   organizing discourse rather than from semantics of its parts.
 *   e.g. それにしても, だからこそ, にもかかわらず.
 */
export enum CollocationRelation {
  IntensifierGradient = "intensifier-gradient",
  SemanticPreference = "semantic-preference",
  SyntacticPreference = "syntactic-preference",
  BodyIdiom = "body-idiom",
  VerbComplement = "verb-complement",
  AdverbialColoring = "adverbial-coloring",
  RegisterBound = "register-bound",
  CulturalFixed = "cultural-fixed",
  AspectualPattern = "aspectual-pattern",
  NominalChunk = "nominal-chunk",
  FixedFormula = "fixed-formula",
  DiscourseConnector = "discourse-connector",
}

/**
 * RegisterConstraint — How tightly the register is constrained.
 * Free = can appear in any register.
 * Preferred = one register is more natural but others are possible.
 * Bound = essentially locked to one register; using it elsewhere
 *   creates a marked stylistic effect (humorous, ironic, etc.).
 */
export enum RegisterConstraint {
  Free = "free",
  Preferred = "preferred",
  Bound = "bound",
}

/**
 * IntensifierInfo — Rich metadata for intensifier-gradient collocations.
 * Describes a word's position on the intensity scale and its
 * register/semantic-prosody constraints.
 */
export interface IntensifierInfo {
  /** Position on scale 0–10 (0 = diminutive, 10 = maximum) */
  intensityLevel: number;
  /** Semantic prosody: does this intensifier prefer positive, negative, or neutral predicates? */
  semanticProsody: "positive" | "negative" | "neutral" | "negative-preferred";
  /** Register this intensifier is bound to */
  registerConstraint: RegisterConstraint;
  /** Alternatives at different register levels for the SAME intensity: e.g. ["とても","すごく","かなり"] */
  scaleAlternatives?: string[];
}

export interface CollocationEntry {
  id: string;
  headword: string;
  headwordReading: string;
  collocate: string;
  fullPhrase: string;
  headwordPOS: PartOfSpeech;
  collocatePOS: PartOfSpeech;
  pattern: string;
  exampleSentences: string[];
  source: CollocationSource;
  tags: string[];
  notes: string;
  frequency: number;
  createdAt: number;
  updatedAt: number;
  // Extended fields (all optional for backward compatibility)
  register?: Register;
  jlptLevel?: JLPTLevel;
  boundaryType?: BoundaryType;
  strength?: CollocationStrength;
  miScore?: number;
  tScore?: number;
  logDice?: number;
  constituentTokens?: string[];
  synonymCollocations?: string[];
  antonymCollocations?: string[];
  negativeExamples?: string[];
  literalMeaning?: string;
  figurativeMeaning?: string;
  typicalContext?: string;
  relatedEntries?: string[];
  // Relational collocation model
  idiomaticityLayer?: IdiomaticityLayer;
  collocationRelation?: CollocationRelation;
  registerConstraint?: RegisterConstraint;
  /**
   * For IntensifierGradient collocations: metadata about the intensifier's
   * position on the degree scale, its register binding, and scale-mates.
   */
  intensifierInfo?: IntensifierInfo;
  /**
   * IDs of entries that express the SAME meaning/relation at a different
   * idiomaticity layer or register. e.g. とても疲れている ↔ めっちゃ疲れている
   * ↔ 非常に疲れている — all three are cross-register counterparts.
   */
  crossRegisterVariants?: string[];
  /**
   * IDs of entries competing for the SAME semantic slot with a different
   * preferred word. e.g. 激しい雨 competes with 強い雨 (less preferred),
   * 大雨 (compound), 豪雨 (formal). These are semantically near but
   * differ in collocation strength, layer, or register.
   */
  competingExpressions?: string[];
  /**
   * For NominalChunk / SemanticPreference: explain WHY this specific
   * combination is preferred over grammatical alternatives.
   * e.g. "かなりの量 is preferred over 量がかなりある because かなりの
   * forms a tight pre-nominal quantifier chunk — it scopes more
   * directly over 量 as a modifier. 量が多い is a free predicational
   * statement, not a collocation in the strong sense."
   */
  collocationalRationale?: string;
}

export interface CollocationIndex {
  byHeadword: Map<string, string[]>;
  byPOS: Map<string, string[]>;
  byPattern: Map<string, string[]>;
  byTag: Map<string, string[]>;
  byRegister: Map<string, string[]>;
  byJLPT: Map<string, string[]>;
  byBoundaryType: Map<string, string[]>;
  byStrength: Map<string, string[]>;
  byConstituent: Map<string, string[]>;
  byIdiomaticityLayer: Map<string, string[]>;
  byCollocationRelation: Map<string, string[]>;
}

export interface SearchOptions {
  query: string;
  posFilter?: PartOfSpeech[];
  tagFilter?: string[];
  sourceFilter?: CollocationSource[];
  patternFilter?: string;
  fuzzy?: boolean;
  maxResults?: number;
  sortBy?: "headword" | "frequency" | "createdAt" | "updatedAt" | "miScore" | "tScore" | "logDice" | "strength";
  sortDir?: "asc" | "desc";
  registerFilter?: Register[];
  jlptFilter?: JLPTLevel[];
  boundaryTypeFilter?: BoundaryType[];
  strengthFilter?: CollocationStrength[];
  minMiScore?: number;
  includeNegativeExamples?: boolean;
  idiomaticityLayerFilter?: IdiomaticityLayer[];
  collocationRelationFilter?: CollocationRelation[];
  /** Only include entries with cross-register variants (useful for comparing 疲れている intensifiers) */
  hasCrossRegisterVariants?: boolean;
  /** Only include entries with collocationalRationale (useful for learning why a pairing is preferred) */
  hasRationale?: boolean;
}

export interface SearchResult {
  entry: CollocationEntry;
  score: number;
}

export interface PluginSettings {
  hyogenEnabled: boolean;
  hyogenRateLimit: number;
  hyogenWordList: string[];
  defaultSortOrder: "headword" | "frequency" | "createdAt" | "updatedAt";
  entriesPerPage: number;
  showReadings: boolean;
  fuzzySearchSensitivity: number;
  maxResults: number;
  dataFilePath: string;
  tsukubaEnabled: boolean;
  tsukubaRateLimit: number;
  tsukubaWordList: string[];
  showRegisterBadges: boolean;
  showJLPTBadges: boolean;
  showStrengthMeter: boolean;
  showNegativeExamples: boolean;
  showIdiomaticityLayer: boolean;
  showCollocationRationale: boolean;
  enableSurferBridge: boolean;
  collocationScanCacheSize: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  hyogenEnabled: false,
  hyogenRateLimit: 2000,
  hyogenWordList: [],
  defaultSortOrder: "frequency",
  entriesPerPage: 50,
  showReadings: true,
  fuzzySearchSensitivity: 0.6,
  maxResults: 100,
  dataFilePath: "jp-collocations-data.json",
  tsukubaEnabled: false,
  tsukubaRateLimit: 2000,
  tsukubaWordList: [],
  showRegisterBadges: true,
  showJLPTBadges: true,
  showStrengthMeter: true,
  showNegativeExamples: true,
  showIdiomaticityLayer: true,
  showCollocationRationale: true,
  enableSurferBridge: true,
  collocationScanCacheSize: 50,
};

export interface StoreStats {
  total: number;
  byPOS: Record<string, number>;
  bySource: Record<string, number>;
}
