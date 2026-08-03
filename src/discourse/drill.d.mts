/** Types for drill.mjs (the DISCOURSE-VERDICT §4 repair). See that file. */

/** One freeze point. `options` is a function of BOARD STATE only — never of
 *  `answerPrim`. That is the invariant the whole module exists to hold. */
export interface DrillCase {
  /** index of the turn the learner is frozen at. */
  freezeIdx: number;
  /** index of the turn carrying the answer (within HORIZON_TURNS of freezeIdx). */
  answerIdx: number;
  atSec: number | null;
  answerSec: number | null;
  answerPrim: string;
  speaker: string;
  text: string;
  options: string[];
  gapTurns: number;
  gapSec: number | null;
}

/** Freeze points that yielded no question, itemised — never silently capped. */
export interface DrillDropped {
  /** no drillable move inside the horizon. */
  noMove: number;
  /** the move was inside the turn horizon but beyond the seconds horizon. */
  tooFar: number;
  /** the board afforded fewer than MIN_OPTIONS drillable moves. */
  thinOptions: number;
  /** the move that fired was not in the state-derived option set. Patching it in
   *  is exactly how the §4 leak was created, so the case is dropped instead. */
  answerNotAfforded: number;
}

/**
 * The three floors a score must be read against.
 *   chance     — mean 1/K; blind guessing.
 *   marginal   — always answer the file's most common primitive. One parameter.
 *   optionOnly — leave-one-out prediction from the option set alone.
 * `optionOnly - marginal` is what knowing the board's affordances is worth.
 */
export interface DrillBaseline {
  n: number;
  distinctSets: number;
  optionOnly: number;
  marginal: number;
  chance: number;
  topPrim: string | null;
  tells: Array<{ options: string; prim: string; n: number }>;
}

export declare const DRILLABLE: Set<string>;
export declare const HORIZON_TURNS: number;
export declare const HORIZON_SEC: number;
export declare const MIN_OPTIONS: number;
export declare const MAX_OPTIONS: number;

/** NOTE the absent answer parameter — non-leakage is enforced by signature. */
export declare function drillOptions(afforded: string[], seed: number, max?: number): string[];

export declare function buildDrillCases(
  input: {
    turns: Array<{ speaker?: string | null; text?: string; tSec?: number | null }>;
    snaps: Array<{ prims?: string[] }>;
    afford: Map<number, string[]>;
  },
  opts?: { horizonTurns?: number; horizonSec?: number; maxOptions?: number },
): { cases: DrillCase[]; dropped: DrillDropped };

export declare function drillBaseline(cases: DrillCase[]): DrillBaseline;
export declare function caseAtOrAfter(cases: DrillCase[], posSec: number | null): DrillCase | null;
