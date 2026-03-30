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
  enableSurferBridge: true,
  collocationScanCacheSize: 50,
};

export interface StoreStats {
  total: number;
  byPOS: Record<string, number>;
  bySource: Record<string, number>;
}
