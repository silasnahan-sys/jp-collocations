/**
 * rhetorical-program.ts — Turn-level rhetorical program model.
 *
 * This is the "red layer" done correctly. A turn is treated as an
 * ORDERED sequence of typed MOVES over slot-bound chunks, with
 * slot-inheritance under operator moves and span-shape labels above.
 *
 * Hierarchy (bottom-up):
 *   tokens
 *     → constructions (aqua)     — template shape of slot fillers
 *     → collocations  (blue)     — frame loading of slot fillers
 *     → chunks (= sites + their fills)
 *   → MOVES (typed, with operands)      ← this module starts here
 *   → SLOT BINDINGS (variables, not absolute roles)
 *   → SPAN SHAPES (形:流れ / 背側 / foreground / aside ...)
 *   → RHETORICAL SCHEMA (named macro the turn is enacting)
 *   → STRATEGIC GOAL (why the schema is being used)
 */

import type { CitationSite, CitationStack } from './citation-types';

// ── Slot variables (schema-bound) ─────────────────────────────────

/**
 * Slot variables are NOT absolute discourse positions. They are
 * placeholders that get bound when the turn enacts a specific schema.
 * Different schemas wire A/B/C to different functions — e.g. in a
 * COMPLAINT schema A is the indictment and B is the sympathetic
 * background; in an OBSERVATION schema A is the generalization and
 * B is the instance.
 */
export type SchemaSlot =
  | 'A'              // primary slot (claim / indictment / generalization)
  | 'B'              // secondary slot (background / instance / data)
  | 'C'              // tertiary slot (consequent / grounds / pivot)
  | 'D'              // quaternary (rare, e.g. counter-rebuttal in complex schemas)
  | 'intro'          // 導入 — schema-introducing move target
  | 'closing'        // schema-closing move target
  | 'aside'          // 余談 — out-of-schema material
  | 'flow';          // 流れ — connective glue, no semantic slot

// ── Typed move sub-classes ────────────────────────────────────────

export type ReformulationSubtype =
  | 'broaden'        // 広げる — scope expansion
  | 'narrow'         // 狭める — specification
  | 'abstract'       // 抽象化
  | 'concretize'     // 具体化
  | 'analogize'      // 喩え
  | 'lexical-rerun'  // 語の反復 (surface-form repetition)
  | 'paraphrase';    // neutral換言

export type RepetitionSubtype =
  | 'semantic'       // re-asserts the same proposition with new wording
  | 'lexical'        // 語の反復 — surface form repeated
  | 'emphatic';      // marked intensification

export type ElaborationSubtype =
  | 'grounds'        // 根拠
  | 'exemplification'// 例示
  | 'evidence'       // 証拠 (institutional / textual)
  | 'background'     // 背景 (scene-setting)
  | 'qualification'; // 留保

// ── The move algebra ──────────────────────────────────────────────

/**
 * BIND — opens a new slot binding by placing chunk into slot.
 * REFORMULATE / REPEAT / INVERT — operate on a previous step; the
 *   new chunk INHERITS the operand step's slot binding.
 * GROUND / EXEMPLIFY — elaborate an operand, may also bind a new slot.
 * INTRODUCE — turn / topic introduction; binds the 'intro' slot.
 * CONNECT — pure connective; binds 'flow'.
 */
export type MoveOp =
  | 'BIND'
  | 'REFORMULATE'
  | 'REPEAT'
  | 'INVERT'
  | 'GROUND'
  | 'EXEMPLIFY'
  | 'INTRODUCE'
  | 'CONNECT';

export interface RhetMoveStep {
  /** 1-based step number within the turn (your 1./2)/3.) numbering). */
  n: number;
  op: MoveOp;
  /** Site this move attaches to (the chunk being placed). null for pure CONNECT. */
  siteId: string | null;
  /** Slot this step binds. For operator moves, INHERITED from operand. */
  slot: SchemaSlot;
  /** For operator moves: the step it operates on. */
  operand?: number;            // step.n of operand
  /** Typed sub-class of the move, when applicable. */
  reformulationSubtype?: ReformulationSubtype;
  repetitionSubtype?: RepetitionSubtype;
  elaborationSubtype?: ElaborationSubtype;
  /** Inferred span-shape this step contributes to (set later). */
  spanShape?: SpanShape;
  /** 0..1 confidence in op + slot assignment. */
  confidence: number;
}

// ── Span shape (your 形:流れ / 背側 layer) ────────────────────────

export type SpanShape =
  | 'foreground-argument'   // the main argumentative spine
  | 'flow'                  // 流れ — connective / sequencing material
  | 'backside'              // 背側 — supporting / non-foregrounded
  | 'aside'                 // 余談 — parenthetical
  | 'wind-up'               // setup before main claim
  | 'wind-down'             // closure / dwindling after main claim
  | 'ratification-seeking'; // recruiting listener uptake

export interface SpanShapeRegion {
  /** Inclusive range of step.n values. */
  startStep: number;
  endStep: number;
  shape: SpanShape;
  confidence: number;
}

// ── Rhetorical schemas ────────────────────────────────────────────

/**
 * A schema is a named rhetorical macro the turn is enacting. It
 * specifies which slots SHOULD be filled and what move pattern is
 * canonical. We carry a CLOSED inventory of schemas and a recognizer;
 * an emergent-discovery pass over the corpus is a separate tool that
 * proposes new schema candidates to add to this inventory.
 */
export type SchemaId =
  | 'COMPLAINT_via_broadening_restatement'
  | 'OBSERVATION_then_generalization'
  | 'CONCESSION_then_pivot'
  | 'LAMENT_blame_call'
  | 'DEFINITION_then_problematization'
  | 'CITATION_then_endorsement'
  | 'CITATION_then_refutation'
  | 'ANALOGY_setup_then_application'
  | 'BACKGROUND_then_claim_then_grounds'
  | 'RECRUIT_via_rhetorical_question'
  | 'UNRECOGNIZED';

export type StrategicGoal =
  | 'INDICT_INSTITUTION_via_sympathetic_lament'
  | 'RECRUIT_listener_agreement'
  | 'ESTABLISH_neutral_observation'
  | 'CONCEDE_to_set_up_rebuttal'
  | 'DEFINE_to_enable_critique'
  | 'INVOKE_authority_to_endorse'
  | 'INVOKE_authority_to_refute'
  | 'ANALOGIZE_to_transfer_judgment'
  | 'BUILD_grounded_claim'
  | 'PROVOKE_via_rhetorical_question'
  | 'UNDETERMINED';

export interface SchemaCandidate {
  id: SchemaId;
  confidence: number;
  /** Binding from slot variables to step.n that filled them. */
  bindings: Partial<Record<SchemaSlot, number[]>>;
  /** Strategic goal this schema typically serves. */
  goal: StrategicGoal;
}

// ── The program ───────────────────────────────────────────────────

export interface RhetoricalProgram {
  /** Turn id (speaker + turn index) this program describes. */
  turnId: string;
  /** Ordered steps — the script the speaker enacted. */
  steps: RhetMoveStep[];
  /** Labeled regions over the steps (形:流れ / 背側 / ...). */
  spanShapes: SpanShapeRegion[];
  /** Ranked schema candidates (highest confidence first). */
  schemaCandidates: SchemaCandidate[];
  /** Strategic goal derived from the top schema candidate. */
  strategicGoal: StrategicGoal;
  /** Mapping from site.id → step.n it was placed by. */
  siteToStep: Record<string, number>;
}
