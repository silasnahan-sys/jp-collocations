export interface DictionaryIndex {
  title: string;
  format: number;
  revision: string;
  sequenced?: boolean;
  author?: string;
  url?: string;
  description?: string;
  attribution?: string;
}

// [expression, reading, definitionTags, rules, score, definitions, sequence, termTags]
export type TermBankEntry = [
  string,   // expression
  string,   // reading
  string,   // definitionTags
  string,   // rules
  number,   // score
  (string | StructuredContent)[],  // definitions
  number,   // sequence
  string    // termTags
];

export interface StructuredContent {
  type?: string;
  tag?: string;
  content?: string | StructuredContent | (string | StructuredContent)[];
  data?: Record<string, string>;
  style?: Record<string, string>;
  [key: string]: unknown;
}

// [kanji, onyomi, kunyomi, tags, meanings, stats]
export type KanjiBankEntry = [string, string, string, string, string[], Record<string, string>];

// [tagName, category, sortingOrder, notes, popularityScore]
export type TagBankEntry = [string, string, number, string, number];

export interface YomitanEntry {
  expression: string;
  reading: string;
  definitionTags: string;
  rules: string;
  score: number;
  definitions: (string | StructuredContent)[];
  sequence: number;
  termTags: string;
  dictionaryTitle: string;
}

export interface ImportedDictionary {
  id: string;
  title: string;
  revision: string;
  format: number;
  entryCount: number;
  importedAt: number;
  enabled: boolean;
}

export interface DictionaryBookmark {
  id: string;
  expression: string;
  reading: string;
  dictionaryTitle: string;
  savedAt: number;
  folder: string;
}

export interface HistoryEntry {
  query: string;
  timestamp: number;
}
