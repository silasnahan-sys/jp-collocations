/**
 * schema-driven-l4.ts — Once a turn's RhetoricalProgram has a
 * confident top schema candidate, the per-site discourse-relational
 * axes (footing / auth_resp / orientation / stance / cite_illoc /
 * disc_fn) are LARGELY DETERMINED by (schemaId, slot, op).
 *
 * This module exposes a single post-pass that overlays those
 * schema-derived priors onto the L4 output. The cue-driven L4
 * inference still runs first; this overlay only fires when the
 * program is confident, and only writes axis values that the schema
 * has a strong opinion on per slot+op.
 *
 * Confidence gate: only the top candidate is considered, and only
 * when its confidence >= SCHEMA_OVERRIDE_THRESHOLD.
 */

import type {
  AuthResp,
  CitationSite,
  CitationStack,
  CiteIlloc,
  DiscFn,
  Footing,
  Orientation,
  Stance,
} from './citation-types';
import type {
  MoveOp,
  RhetMoveStep,
  RhetoricalProgram,
  SchemaId,
  SchemaSlot,
} from './rhetorical-program';

export const SCHEMA_OVERRIDE_THRESHOLD = 0.7;

// ── Axis prior records ────────────────────────────────────────────

interface AxisPriors {
  footing?: Footing;
  auth_resp?: AuthResp;
  orientation?: Orientation;
  stance?: Stance;
  cite_illoc?: CiteIlloc;
  disc_fn?: DiscFn;
}

/** Op-level modifiers — applied AFTER slot-level priors. */
const OP_PRIORS: Partial<Record<MoveOp, AxisPriors>> = {
  GROUND:      { disc_fn: 'warrant' },
  EXEMPLIFY:   { disc_fn: 'invoke-as-evidence', cite_illoc: 'invoke-authority' },
  INTRODUCE:   { disc_fn: 'topic-intro' },
  CONNECT:     { disc_fn: 'transitional-pivot' },
  // REFORMULATE / REPEAT / INVERT / BIND don't have universal op defaults;
  // they depend on the schema + slot.
};

/**
 * For each schema, define priors per slot and (optionally) per op.
 * Slots not listed → no override. Op-level entries override slot-level.
 */
interface SchemaSpec {
  bySlot: Partial<Record<SchemaSlot, AxisPriors>>;
  byOp?: Partial<Record<MoveOp, AxisPriors>>;
}

const SCHEMA_PRIORS: Partial<Record<SchemaId, SchemaSpec>> = {
  COMPLAINT_via_broadening_restatement: {
    bySlot: {
      A: { stance: 'accuse', disc_fn: 'accusation' },
      B: { stance: 'sympathy-alignment', disc_fn: 'warrant' },
      C: { disc_fn: 'warrant' },
    },
    byOp: {
      REFORMULATE: { cite_illoc: 'reformulate', disc_fn: 'lateral-reformulation' },
    },
  },
  OBSERVATION_then_generalization: {
    bySlot: {
      A: { stance: 'neutral-report', disc_fn: 'reification-for-arg' },
      B: { stance: 'neutral-report', disc_fn: 'warrant' },
    },
    byOp: {
      REFORMULATE: { cite_illoc: 'reformulate' },
    },
  },
  CONCESSION_then_pivot: {
    bySlot: {
      A: { stance: 'contest-direct', disc_fn: 'counterevidence' },
      B: { stance: 'concede-for-rebuttal', disc_fn: 'concession', cite_illoc: 'concede' },
      D: { stance: 'concede-for-rebuttal', disc_fn: 'concession' },
    },
    byOp: {
      INVERT: { stance: 'contest-direct', disc_fn: 'counterevidence' },
    },
  },
  LAMENT_blame_call: {
    bySlot: {
      A: { stance: 'accuse', disc_fn: 'accusation' },
      B: { stance: 'sympathy-alignment', disc_fn: 'warrant' },
      C: { disc_fn: 'warrant' },
    },
  },
  DEFINITION_then_problematization: {
    bySlot: {
      intro: { cite_illoc: 'define', disc_fn: 'definition', stance: 'neutral-report' },
      A:     { stance: 'contest-direct', disc_fn: 'counterevidence' },
    },
  },
  CITATION_then_endorsement: {
    bySlot: {
      B: { footing: 'institutional', cite_illoc: 'invoke-authority',
           disc_fn: 'invoke-as-evidence', auth_resp: 'attributed' },
      A: { stance: 'endorse-via-authority', disc_fn: 'warrant' },
    },
  },
  CITATION_then_refutation: {
    bySlot: {
      B: { footing: 'institutional', cite_illoc: 'invoke-authority',
           disc_fn: 'invoke-as-evidence', auth_resp: 'attributed' },
      A: { stance: 'contest-direct', disc_fn: 'counterevidence' },
    },
    byOp: {
      INVERT: { stance: 'contest-direct', disc_fn: 'counterevidence' },
    },
  },
  ANALOGY_setup_then_application: {
    bySlot: {
      A: { disc_fn: 'reification-for-arg' },
      B: { disc_fn: 'warrant' },
    },
    byOp: {
      REFORMULATE: { cite_illoc: 'reformulate', disc_fn: 'lateral-reformulation' },
    },
  },
  BACKGROUND_then_claim_then_grounds: {
    bySlot: {
      A: { disc_fn: 'reification-for-arg', stance: 'neutral-report' },
      B: { disc_fn: 'warrant', stance: 'neutral-report' },
      C: { disc_fn: 'warrant' },
    },
  },
  RECRUIT_via_rhetorical_question: {
    bySlot: {
      A: { stance: 'recruitment-via-mutual-memory',
           cite_illoc: 'rally',
           disc_fn: 'common-ground-invocation→rally' },
    },
  },
  UNRECOGNIZED: { bySlot: {} },
};

// ── Application ───────────────────────────────────────────────────

function mergePriors(base: AxisPriors, ...layers: (AxisPriors | undefined)[]): AxisPriors {
  const out: AxisPriors = { ...base };
  for (const l of layers) {
    if (!l) continue;
    for (const k of Object.keys(l) as (keyof AxisPriors)[]) {
      const v = l[k];
      if (v !== undefined) (out as any)[k] = v;
    }
  }
  return out;
}

function applyPriorsToSite(site: CitationSite, priors: AxisPriors): void {
  if (priors.footing       !== undefined) site.footing       = priors.footing;
  if (priors.auth_resp     !== undefined) site.auth_resp     = priors.auth_resp;
  if (priors.orientation   !== undefined) site.orientation   = priors.orientation;
  if (priors.stance        !== undefined) site.stance        = priors.stance;
  if (priors.cite_illoc    !== undefined) site.cite_illoc    = priors.cite_illoc;
  if (priors.disc_fn       !== undefined) site.disc_fn       = priors.disc_fn;
}

/**
 * Overlay schema-driven priors onto the sites of all stacks belonging
 * to the given programs. Mutates sites in place. Only fires for
 * programs whose top schema candidate is at or above the threshold.
 */
export function applyProgramOverrides(
  programs: RhetoricalProgram[],
  stacks: CitationStack[],
): { programsApplied: number; sitesOverridden: number } {
  // Build site-id → site index for fast lookup
  const siteById = new Map<string, CitationSite>();
  for (const stack of stacks) {
    for (const site of stack.sites) siteById.set(site.id, site);
  }

  let programsApplied = 0;
  let sitesOverridden = 0;

  for (const program of programs) {
    const top = program.schemaCandidates[0];
    if (!top || top.id === 'UNRECOGNIZED') continue;
    if (top.confidence < SCHEMA_OVERRIDE_THRESHOLD) continue;
    const spec = SCHEMA_PRIORS[top.id];
    if (!spec) continue;
    programsApplied += 1;

    for (const step of program.steps) {
      if (!step.siteId) continue;
      const site = siteById.get(step.siteId);
      if (!site) continue;
      const slotPriors = spec.bySlot[step.slot];
      const schemaOpPriors = spec.byOp?.[step.op];
      const globalOpPriors = OP_PRIORS[step.op];
      const priors = mergePriors({}, slotPriors, globalOpPriors, schemaOpPriors);
      if (Object.keys(priors).length === 0) continue;
      applyPriorsToSite(site, priors);
      // Bump confidence to reflect schema-grounded override
      site.confidence.l4 = Math.max(site.confidence.l4 ?? 0, 0.8);
      sitesOverridden += 1;
    }
  }

  return { programsApplied, sitesOverridden };
}
