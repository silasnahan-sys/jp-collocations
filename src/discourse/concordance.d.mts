/** Types for concordance.mjs (the §11 fail-branch product). See that file. */

/** Where the row came from — §28 S2: a row with no door back is an orphan. */
export interface ConcordanceSource {
  source?: 'yt' | 'x' | 'web' | 'manual';
  medium?: string;
  file?: string;
  videoId?: string | null;
  deepLink?: string;
  sourceName?: string;
}

/** Skeletal position of the marker inside its turn (CA position+composition). */
export type MarkerPosition = 'final' | 'clausal' | 'medial';

/** ONE occurrence of ONE interactional marker, with the door back to hear it. */
export interface ConcordanceRow {
  /** the surface — the concordance KEY. */
  marker: string;
  /** operator id if one matched at this offset — a HINT, never the key (§12). */
  opId: string | null;
  position: MarkerPosition;
  offset: number;
  tSec: number;
  speaker: string | null;
  speakerSource: string;
  quote: string;
  before: string;
  after: string;
  /** observable next-turn/grounding token — NOT a common-ground claim. */
  uptake: 'accept' | 'ack' | null;
  contested: boolean;
  turnIndex: number;
  source: ConcordanceSource;
}

export interface UptakeCounts { accept: number; ack: number; contested: number; none: number }

/** One marker = one catalog headword; its rows are its attestations. */
export interface ConcordanceEntry {
  marker: string;
  rows: ConcordanceRow[];
  /** operator hints seen for this marker, with counts. Demoted, never a key. */
  opIds: Map<string, number>;
  count: number;
  uptake: UptakeCounts;
  responseRate: number;
}

export interface ConcordanceAttestation {
  source: string;
  medium: string;
  file?: string;
  videoId: string | null;
  tStartSec: number;
  scene?: { deepLink: string; sourceName?: string };
  quote: string;
  addedAt: number;
  status: 'suggested';
  matchKind: string;
  confidence: number;
}

export declare const CONCORDANCE_MARKERS: string[];

export declare function positionOf(text: string, offset: number, marker: string): MarkerPosition;

export declare function buildConcordance(
  turns: Array<{ tSec: number; tEnd?: number; speaker: string | null; speakerSource?: string; text: string; grounding?: Array<{ grade: 'ack' | 'accept' }> }>,
  opts?: { source?: ConcordanceSource; markers?: string[] },
): ConcordanceRow[];

export declare function groupByMarker(rows: ConcordanceRow[]): ConcordanceEntry[];
export declare function uptakeProfile(rows: ConcordanceRow[]): { uptake: UptakeCounts; responseRate: number };
export declare function positionProfile(rows: ConcordanceRow[]): Record<MarkerPosition, number>;
export declare function toAttestations(entry: ConcordanceEntry, now?: number): ConcordanceAttestation[];
