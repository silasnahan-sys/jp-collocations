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
}

export interface CollocationIndex {
  byHeadword: Map<string, string[]>;
  byPOS: Map<string, string[]>;
  byPattern: Map<string, string[]>;
  byTag: Map<string, string[]>;
}

export interface SearchOptions {
  query: string;
  posFilter?: PartOfSpeech[];
  tagFilter?: string[];
  sourceFilter?: CollocationSource[];
  patternFilter?: string;
  fuzzy?: boolean;
  maxResults?: number;
  sortBy?: "headword" | "frequency" | "createdAt" | "updatedAt";
  sortDir?: "asc" | "desc";
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
  contextDataFilePath: string;
  /** Number of surrounding sentences to include in a context chunk. */
  contextRadius: number;
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
  contextDataFilePath: "jp-collocations-contexts.json",
  contextRadius: 3,
};

export interface StoreStats {
  total: number;
  byPOS: Record<string, number>;
  bySource: Record<string, number>;
}

// ── Discourse Grammar (談話文法) Types ─────────────────────────
// Taxonomy grounded in Japanese discourse grammar research:
//   佐久間まゆみ『文章・談話のしくみ』
//   メイナード泉子 K.『談話分析の可能性』
//   石黒圭『文章は接続詞で決まる』
//   市川孝『国語教育のための文章論概説』

/**
 * High-level discourse categories based on published 談話文法 research.
 * Each category groups related discourse functions.
 */
export enum DiscourseCategory {
  /** 接続表現 — Connective expressions (石黒 2008) */
  Connective = "接続表現",
  /** 文末表現 — Sentence-final modality (日本語モダリティ研究) */
  SentenceFinal = "文末表現",
  /** 話題管理 — Topic management (佐久間 2003) */
  TopicManagement = "話題管理",
  /** 相互行為 — Interactional functions (メイナード 1993) */
  Interactional = "相互行為",
  /** 情報構造 — Information structure (語用論) */
  InfoStructure = "情報構造",
  /** 談話標識 — Discourse markers */
  DiscourseMarker = "談話標識",
  /** ポライトネス — Politeness / register (Brown & Levinson → JP) */
  Politeness = "ポライトネス",
  /** 引用・発話 — Quotation and speech acts */
  Quotation = "引用・発話",
}

/**
 * Specific discourse functions within each category.
 * Values are Japanese labels used in the UI.
 */
export enum DiscourseFunction {
  // ── 接続表現 (Connective) ───────────────────
  /** 順接 — Logical consequence: だから、したがって、そのため */
  LogicalConsequence = "順接",
  /** 逆接 — Adversative/contrast: しかし、でも、けれども */
  Adversative = "逆接",
  /** 並列・累加 — Additive: また、そして、しかも */
  Additive = "並列・累加",
  /** 対比 — Comparison: 一方、それに対して */
  Comparison = "対比",
  /** 転換 — Topic change: ところで、さて */
  TopicChange = "転換",
  /** 補足 — Supplementation: なお、ちなみに、ただし */
  Supplement = "補足",
  /** 例示 — Exemplification: たとえば、具体的には */
  Exemplification = "例示",
  /** 言い換え — Rephrasing: つまり、要するに */
  Rephrase = "言い換え",

  // ── 文末表現 (Sentence-final) ───────────────
  /** 確認要求 — Confirmation seeking: よね、でしょう */
  ConfirmationSeeking = "確認要求",
  /** 同意要求 — Agreement seeking: ね、ねえ */
  AgreementSeeking = "同意要求",
  /** 主張 — Assertion: よ、わ、ぞ */
  Assertion = "主張",
  /** 推量 — Conjecture: だろう、かもしれない */
  Conjecture = "推量",
  /** 伝聞 — Hearsay: そうだ、って、らしい */
  Hearsay = "伝聞",
  /** 疑問 — Question: か、かな */
  Question = "疑問",
  /** 意志 — Volition: つもり、よう */
  Volition = "意志",

  // ── 話題管理 (Topic management) ─────────────
  /** 話題提示 — Topic introduction: は、って、というのは */
  TopicIntroduction = "話題提示",
  /** 話題転換 — Topic shift: ところで、そういえば */
  TopicShift = "話題転換",
  /** 話題深化 — Topic deepening: 実は、本当は */
  TopicDeepening = "話題深化",
  /** 話題回帰 — Topic return: 話を戻すと */
  TopicReturn = "話題回帰",

  // ── 相互行為 (Interactional) ────────────────
  /** あいづち — Back-channel: うん、ええ、なるほど */
  BackChannel = "あいづち",
  /** フィラー — Fillers: えーと、あのー、なんか */
  Filler = "フィラー",
  /** 修復 — Repair: いや、じゃなくて */
  Repair = "修復",
  /** 注目要素 — Attention-getter: ほら、ねえ、あのさ */
  AttentionGetter = "注目要素",

  // ── 情報構造 (Info structure) ────────────────
  /** 焦点 — Focus: こそ、さえ、まで */
  Focus = "焦点",
  /** 取り立て — Delimitation: だけ、しか、ばかり */
  Delimitation = "取り立て",

  // ── 談話標識 (Discourse markers) ────────────
  /** 開始標識 — Opening: えー、さあ、じゃあ */
  Opening = "開始標識",
  /** 展開標識 — Development: で、それで、そしたら */
  Development = "展開標識",
  /** 終結標識 — Closing: というわけで、以上 */
  Closing = "終結標識",

  // ── ポライトネス (Politeness) ────────────────
  /** ヘッジ — Hedging: ちょっと、少し、なんとなく */
  Hedging = "ヘッジ",
  /** 間接表現 — Indirect speech: ～と思うんですけど */
  Indirect = "間接表現",

  // ── 引用・発話 (Quotation) ──────────────────
  /** 直接引用 — Direct quotation: 「～」って */
  DirectQuotation = "直接引用",
  /** 間接引用 — Indirect quotation: ～と言った */
  IndirectQuotation = "間接引用",
}

/** Maps each DiscourseFunction to its parent DiscourseCategory. */
export const FUNCTION_TO_CATEGORY: Record<DiscourseFunction, DiscourseCategory> = {
  [DiscourseFunction.LogicalConsequence]: DiscourseCategory.Connective,
  [DiscourseFunction.Adversative]: DiscourseCategory.Connective,
  [DiscourseFunction.Additive]: DiscourseCategory.Connective,
  [DiscourseFunction.Comparison]: DiscourseCategory.Connective,
  [DiscourseFunction.TopicChange]: DiscourseCategory.Connective,
  [DiscourseFunction.Supplement]: DiscourseCategory.Connective,
  [DiscourseFunction.Exemplification]: DiscourseCategory.Connective,
  [DiscourseFunction.Rephrase]: DiscourseCategory.Connective,

  [DiscourseFunction.ConfirmationSeeking]: DiscourseCategory.SentenceFinal,
  [DiscourseFunction.AgreementSeeking]: DiscourseCategory.SentenceFinal,
  [DiscourseFunction.Assertion]: DiscourseCategory.SentenceFinal,
  [DiscourseFunction.Conjecture]: DiscourseCategory.SentenceFinal,
  [DiscourseFunction.Hearsay]: DiscourseCategory.SentenceFinal,
  [DiscourseFunction.Question]: DiscourseCategory.SentenceFinal,
  [DiscourseFunction.Volition]: DiscourseCategory.SentenceFinal,

  [DiscourseFunction.TopicIntroduction]: DiscourseCategory.TopicManagement,
  [DiscourseFunction.TopicShift]: DiscourseCategory.TopicManagement,
  [DiscourseFunction.TopicDeepening]: DiscourseCategory.TopicManagement,
  [DiscourseFunction.TopicReturn]: DiscourseCategory.TopicManagement,

  [DiscourseFunction.BackChannel]: DiscourseCategory.Interactional,
  [DiscourseFunction.Filler]: DiscourseCategory.Interactional,
  [DiscourseFunction.Repair]: DiscourseCategory.Interactional,
  [DiscourseFunction.AttentionGetter]: DiscourseCategory.Interactional,

  [DiscourseFunction.Focus]: DiscourseCategory.InfoStructure,
  [DiscourseFunction.Delimitation]: DiscourseCategory.InfoStructure,

  [DiscourseFunction.Opening]: DiscourseCategory.DiscourseMarker,
  [DiscourseFunction.Development]: DiscourseCategory.DiscourseMarker,
  [DiscourseFunction.Closing]: DiscourseCategory.DiscourseMarker,

  [DiscourseFunction.Hedging]: DiscourseCategory.Politeness,
  [DiscourseFunction.Indirect]: DiscourseCategory.Politeness,

  [DiscourseFunction.DirectQuotation]: DiscourseCategory.Quotation,
  [DiscourseFunction.IndirectQuotation]: DiscourseCategory.Quotation,
};

/**
 * Colour assigned to each DiscourseCategory for consistent visualization.
 * Research-informed: warm tones for interactional, cool for structural.
 */
export const CATEGORY_COLOURS: Record<DiscourseCategory, string> = {
  [DiscourseCategory.Connective]: "#4a90d9",       // blue — structural links
  [DiscourseCategory.SentenceFinal]: "#c678dd",     // purple — modality
  [DiscourseCategory.TopicManagement]: "#e5c07b",   // amber — topic flow
  [DiscourseCategory.Interactional]: "#e06c75",     // red — live interaction
  [DiscourseCategory.InfoStructure]: "#56b6c2",     // teal — information
  [DiscourseCategory.DiscourseMarker]: "#98c379",   // green — markers
  [DiscourseCategory.Politeness]: "#d19a66",        // orange — social
  [DiscourseCategory.Quotation]: "#be5046",         // brick — speech acts
};

/** A single discourse "bit" — an atomic grammar-thought unit within a chunk. */
export interface DiscourseBit {
  id: string;
  text: string;
  speaker: string;
  /** Colour key for connection lines/underlines linking related bits. */
  connectionGroup: number;
  /** Primary discourse function. */
  primaryFunction: DiscourseFunction | null;
  /** Parent category of the primary function. */
  category: DiscourseCategory | null;
  /** All discourse functions detected (a bit can exhibit multiple). */
  functions: DiscourseFunction[];
  /** Legacy label kept for backward compatibility. */
  discourseLabel: string;
  startOffset: number;
  endOffset: number;
}

/** A directional relationship between two discourse bits. */
export interface DiscourseRelation {
  fromBitId: string;
  toBitId: string;
  /** e.g. "topic-continuation", "example", "tag-question", "reaction" */
  relationType: string;
  /** Same colour key used in the connected bits. */
  connectionGroup: number;
}

/** A context chunk extracted around a collocation or phrase. */
export interface ContextChunk {
  id: string;
  /** Raw text of the chunk. */
  rawText: string;
  /** Parsed discourse bits within this chunk. */
  bits: DiscourseBit[];
  /** Relations between bits. */
  relations: DiscourseRelation[];
  /** Vault file path the chunk was extracted from. */
  sourceFile: string;
  /** The highlighted / selected phrase that triggered the chunk creation. */
  selectedPhrase: string;
  createdAt: number;
}

/** An indexed context entry stored in the Lexicon. */
export interface ContextEntry {
  id: string;
  /** Link back to the original collocation, if any. */
  collocationId: string | null;
  /** Link to the context chunk. */
  chunkId: string;
  /** The specific bit ids that were spoilered in card mode. */
  highlightedBitIds: string[];
  /** Markdown-formatted context for display. */
  formattedMarkdown: string;
  tags: string[];
  createdAt: number;
}

export type ViewMode = "search" | "grammar" | "connections" | "forms" | "sources" | "discourse" | "contexts";
