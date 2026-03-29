// Shared type contracts for cross-plugin communication between
// jp-collocations and jp-sentence-surfer-.

export type DiscourseCategory =
  | 'topic-initiation'
  | 'reasoning'
  | 'modality'
  | 'connective'
  | 'confirmation'
  | 'rephrasing'
  | 'filler'
  | 'quotation';

export type DiscoursePosition = 'utterance-initial' | 'utterance-final' | 'mid-utterance' | 'any';

export interface SurferCollocationEntry {
  id: string;
  surface: string;
  reading?: string;
  meaning?: string;
  discourseCategory?: DiscourseCategory;
  discoursePosition?: DiscoursePosition;
  pragmaticFunction?: string;
  register?: string;
  coOccurrences?: string[];
  _discourseContexts?: DiscourseContext[];
  exampleSentences?: Array<{
    text: string;
    source: string;
    timestamp?: string;
  }>;
  sourceFile?: string;
  capturedAt?: string;
  granularity?: string;
  tags?: string[];
}

export interface DiscourseContext {
  openingMarkers: string[];
  closingMarkers: string[];
  internalMarkers: string[];
  patternTags: string[];
  granularity: string;
  sourceText: string;
  sourceFile: string;
  position: number;
}

export interface CollocationMatch {
  entry: SurferCollocationEntry;
  startOffset: number;
  endOffset: number;
  matchedSurface: string;
}

export interface DiscourseStats {
  totalEntries: number;
  byCategory: Record<DiscourseCategory, number>;
  byPosition: Record<DiscoursePosition, number>;
  topCoOccurrences: Array<{ pair: [string, string]; count: number }>;
  topMarkers: Array<{ surface: string; count: number }>;
}
