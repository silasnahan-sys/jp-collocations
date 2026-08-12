/**
 * program-builder.ts — Constructs a RhetoricalProgram from one turn's
 * worth of CitationStacks. Implements:
 *
 *   1. Step extraction        — per-site moves with operands
 *   2. Slot binding           — A/B/C variables under inheritance
 *   3. Span-shape segmentation — 形:流れ / 背側 / foreground / ...
 *   4. Schema recognition     — against the closed inventory
 *   5. Strategic-goal derivation
 *
 * The flat per-site `pos_arg` / `rhet_move` axes from L3 are now
 * DERIVED VIEWS of this richer structure.
 */

import type { CitationSite, CitationStack, IntraSentenceEdge } from './citation-types';
import type {
  RhetoricalProgram,
  RhetMoveStep,
  SchemaCandidate,
  SchemaSlot,
  SpanShape,
  SpanShapeRegion,
  ReformulationSubtype,
  RepetitionSubtype,
  ElaborationSubtype,
  MoveOp,
  StrategicGoal,
  SchemaId,
} from './rhetorical-program';

// ── Sub-type detectors ────────────────────────────────────────────

const RE_BROADEN     = /(?:広く言|もっと言|さらに言|大きく言|広げ|ひいては|延いては|もっと一般的に)/;
const RE_NARROW      = /(?:具体的に|正確には|限定すれば|より厳密に|そう言うと)/;
const RE_ABSTRACT    = /(?:抽象的に|一般化すると|つまり|要するに|総じて)/;
const RE_CONCRETIZE  = /(?:具体的に|たとえば|例えば|現実には|実際には)/;
const RE_ANALOGIZE   = /(?:みたいな|のような|っていうのと同じ|に似て|喩えるなら|たとえるなら)/;
const RE_PARAPHRASE  = /(?:言い換えれば|別の言い方をすると|っていうか|というか)/;

const RE_GROUNDS     = /(?:なぜなら|というのは|というのも|だって|理由は|それは.+から)/;
const RE_EXEMPLIFY   = /(?:例えば|たとえば|具体的には|たとえると)/;
const RE_EVIDENCE    = /(?:と言われ|とされ|報道|調査|統計|世論|データ)/;
const RE_BACKGROUND  = /(?:そもそも|もともと|元々|前提として|背景には)/;
const RE_QUALIFY     = /(?:ただし|もっとも|とはいえ|ある意味|一方で)/;

const RE_INTRODUCE   = /^(?:まず|今日は|今回は|あの|えーと|ところで|それで言うと|そもそも)/;
const RE_EMPHATIC    = /(?:本当に|めっちゃ|すごく|まじで|絶対|間違いなく)/;

// ── Step extraction ───────────────────────────────────────────────

/**
 * Walk the turn's sites in document order and emit one RhetMoveStep
 * per site. Uses the intra_edges already computed in L3 plus local
 * cue-window detection to type each step.
 */
function extractSteps(
  stacks: CitationStack[],
  sentenceTexts: string[],
): { steps: RhetMoveStep[]; siteToStep: Record<string, number> } {
  const steps: RhetMoveStep[] = [];
  const siteToStep: Record<string, number> = {};
  let n = 0;

  // Pre-index intra-edges by fromSiteId for quick lookup
  const edgeBySite: Map<string, IntraSentenceEdge> = new Map();
  for (const stack of stacks) {
    for (const e of stack.intra_edges) {
      edgeBySite.set(e.fromSiteId, e);
    }
  }

  // Pre-index site by id for operand→step.n resolution
  for (const stack of stacks) {
    const sentence = sentenceTexts[stack.sentenceIdx] ?? '';
    for (const site of stack.sites) {
      n += 1;
      siteToStep[site.id] = n;
      const window = localWindow(sentence, site);
      const isFirstOverall = n === 1;
      const edge = edgeBySite.get(site.id);

      let op: MoveOp = 'BIND';
      let operand: number | undefined;
      let slot: SchemaSlot = inferDefaultSlot(site, isFirstOverall);
      let reformulationSubtype: ReformulationSubtype | undefined;
      let repetitionSubtype: RepetitionSubtype | undefined;
      let elaborationSubtype: ElaborationSubtype | undefined;
      let confidence = 0.6;

      if (edge) {
        const opStepN = siteToStep[edge.toSiteId];
        const opStep = opStepN ? steps[opStepN - 1] : undefined;
        switch (edge.kind) {
          case 'reformulates':
            op = 'REFORMULATE';
            reformulationSubtype = detectReformulationSubtype(window);
            operand = opStepN;
            if (opStep) slot = opStep.slot;
            confidence = edge.confidence;
            break;
          case 'expands':
            op = 'REFORMULATE';
            reformulationSubtype = 'broaden';
            operand = opStepN;
            if (opStep) slot = opStep.slot;
            confidence = Math.max(edge.confidence, 0.75);
            break;
          case 'repeats':
            op = 'REPEAT';
            repetitionSubtype = detectRepetitionSubtype(site, opStep, window);
            operand = opStepN;
            if (opStep) slot = opStep.slot;
            confidence = edge.confidence;
            break;
          case 'inverts':
            op = 'INVERT';
            operand = opStepN;
            if (opStep) slot = opStep.slot;
            confidence = edge.confidence;
            break;
          case 'grounds':
            op = 'GROUND';
            elaborationSubtype = 'grounds';
            operand = opStepN;
            slot = 'C';
            confidence = edge.confidence;
            break;
          case 'exemplifies':
            op = 'EXEMPLIFY';
            elaborationSubtype = 'exemplification';
            operand = opStepN;
            if (opStep) slot = opStep.slot;
            confidence = edge.confidence;
            break;
          case 'introduces':
            op = 'INTRODUCE';
            operand = opStepN;
            slot = 'intro';
            confidence = edge.confidence;
            break;
          case 'connects':
            op = 'CONNECT';
            operand = opStepN;
            slot = 'flow';
            confidence = edge.confidence;
            break;
        }
      } else if (RE_INTRODUCE.test(sentence) && isFirstOverall) {
        op = 'INTRODUCE';
        slot = 'intro';
        confidence = 0.7;
      } else if (RE_GROUNDS.test(window)) {
        op = 'GROUND';
        elaborationSubtype = 'grounds';
        slot = 'C';
        if (steps.length > 0) operand = steps[steps.length - 1].n;
        confidence = 0.7;
      } else if (RE_BACKGROUND.test(window) || RE_EVIDENCE.test(window)) {
        op = 'BIND';
        elaborationSubtype = RE_EVIDENCE.test(window) ? 'evidence' : 'background';
        slot = 'B';
        confidence = 0.65;
      } else if (RE_QUALIFY.test(window)) {
        op = 'BIND';
        elaborationSubtype = 'qualification';
        slot = 'D';
        confidence = 0.6;
      }

      steps.push({
        n,
        op,
        siteId: site.id,
        slot,
        operand,
        reformulationSubtype,
        repetitionSubtype,
        elaborationSubtype,
        confidence,
      });
    }
  }

  return { steps, siteToStep };
}

function localWindow(sentence: string, site: CitationSite): string {
  const start = Math.max(0, site.locator.charStart - site.surface.length - 16);
  const end = Math.min(sentence.length, site.locator.charEnd + 16);
  return sentence.slice(start, end);
}

function inferDefaultSlot(site: CitationSite, isFirst: boolean): SchemaSlot {
  // First chunk usually opens the A or B slot depending on form
  if (isFirst) {
    if (site.form === 'topic-label' || site.form === 'reified-NP' || site.form === 'speech-verb-NP') return 'B';
    return 'A';
  }
  // Reified-NPs, topic-labels generally fill B (background / setup)
  if (site.form === 'reified-NP' || site.form === 'topic-label' || site.form === 'nominalized-of-saying') return 'B';
  // Truncated terminals, section-wraps generally fill closing
  if (site.form === 'section-wrap' || site.form === 'truncated-terminal' ||
      site.form === 'truncated-terminal+conditional' || site.form === 'truncated-terminal+nominalizer') return 'closing';
  // Mental verb / speech-verb assertions usually fill A
  if (site.form === 'mental-verb' || site.form === 'speech-verb' ||
      site.form === 'bracketed-direct' || site.form === 'speech-verb+evidential') return 'A';
  return 'A';
}

function detectReformulationSubtype(window: string): ReformulationSubtype {
  if (RE_BROADEN.test(window)) return 'broaden';
  if (RE_NARROW.test(window)) return 'narrow';
  if (RE_ABSTRACT.test(window)) return 'abstract';
  if (RE_CONCRETIZE.test(window)) return 'concretize';
  if (RE_ANALOGIZE.test(window)) return 'analogize';
  if (RE_PARAPHRASE.test(window)) return 'paraphrase';
  return 'paraphrase';
}

function detectRepetitionSubtype(
  site: CitationSite,
  opStep: RhetMoveStep | undefined,
  window: string,
): RepetitionSubtype {
  if (RE_EMPHATIC.test(window)) return 'emphatic';
  if (!opStep || !opStep.siteId) return 'semantic';
  // Lexical if surface form is mostly shared (L3's intra-edge detector
  // already used an LCS threshold, so a 'repeats' edge here implies
  // some surface overlap; treat it as lexical by default).
  return 'lexical';
}

// ── Span-shape segmentation ───────────────────────────────────────

/**
 * Group consecutive steps into shape regions based on slot patterns.
 * Heuristic v1: B/C/intro/flow → backside or wind-up; A → foreground;
 * trailing closing → wind-down; CONNECT-only → flow.
 */
function segmentShapes(steps: RhetMoveStep[]): SpanShapeRegion[] {
  const regions: SpanShapeRegion[] = [];
  if (steps.length === 0) return regions;
  let curShape: SpanShape | null = null;
  let regionStart = steps[0].n;

  function pushRegion(endStep: number) {
    if (curShape !== null) {
      regions.push({ startStep: regionStart, endStep, shape: curShape, confidence: 0.6 });
    }
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const shape = shapeForStep(step, i, steps);
    if (curShape === null) {
      curShape = shape;
      regionStart = step.n;
    } else if (shape !== curShape) {
      pushRegion(steps[i - 1].n);
      curShape = shape;
      regionStart = step.n;
    }
    step.spanShape = shape;
  }
  pushRegion(steps[steps.length - 1].n);
  return regions;
}

function shapeForStep(step: RhetMoveStep, idx: number, all: RhetMoveStep[]): SpanShape {
  if (step.slot === 'intro') return 'wind-up';
  if (step.slot === 'flow' || step.op === 'CONNECT') return 'flow';
  if (step.slot === 'aside') return 'aside';
  if (step.slot === 'closing' || (idx === all.length - 1 && step.slot === 'B')) return 'wind-down';
  if (step.slot === 'A') return 'foreground-argument';
  if (step.slot === 'B' || step.slot === 'C') {
    // If we're before the first A-binding, this is wind-up; otherwise backside
    const sawA = all.slice(0, idx).some(s => s.slot === 'A');
    if (!sawA) return 'wind-up';
    return 'backside';
  }
  if (step.slot === 'D') return 'backside';
  return 'flow';
}

// ── Schema recognizer (closed inventory v2 — tightened) ──────────
//
// Stricter rules learned from the v1 diagnostic run:
//   • require an operator-move signal (REFORMULATE / REPEAT / INVERT
//     / GROUND / EXEMPLIFY / INTRODUCE / CONNECT) above noise floor;
//     monologue windows that are pure BIND-streams should not match
//   • cap step count per schema — a 100-site mega-window must never
//     match a paragraph-sized rhetorical macro
//   • require BOTH the structural cue AND the move(s) the schema
//     names; a B→A subsequence alone is not enough for anything

interface SchemaSpec {
  id: SchemaId;
  goal: StrategicGoal;
  match: (steps: RhetMoveStep[], slotsByStep: Map<number, SchemaSlot>) => number;
}

/** Fraction of steps that are NON-BIND operator moves. */
function operatorDensity(steps: RhetMoveStep[]): number {
  if (steps.length === 0) return 0;
  return steps.filter(s => s.op !== 'BIND').length / steps.length;
}

/** Penalty for over-long windows. Steeply de-rates above ~14 steps. */
function lengthDecay(steps: RhetMoveStep[]): number {
  const n = steps.length;
  if (n <= 14) return 1.0;
  if (n <= 20) return 0.5;
  if (n <= 30) return 0.2;
  return 0.05;
}

/** Schema fires only if it has at least one true rhetorical signal. */
function hasAnyOperator(steps: RhetMoveStep[]): boolean {
  return steps.some(s => s.op !== 'BIND');
}

function hasOp(steps: RhetMoveStep[], op: MoveOp): boolean {
  return steps.some(s => s.op === op);
}

function hasReformulationOfKind(steps: RhetMoveStep[], kind: ReformulationSubtype): boolean {
  return steps.some(s => s.op === 'REFORMULATE' && s.reformulationSubtype === kind);
}

function hasElaborationOfKind(steps: RhetMoveStep[], kind: ElaborationSubtype): boolean {
  return steps.some(s => s.elaborationSubtype === kind);
}

function hasRepetitionOfKind(steps: RhetMoveStep[], kind: RepetitionSubtype): boolean {
  return steps.some(s => s.op === 'REPEAT' && s.repetitionSubtype === kind);
}

/** Require pattern to appear as a CONTIGUOUS (allowing flow/connect
 *  between) slot subsequence — much stricter than the old greedy
 *  scattered-subsequence match. */
function hasSequence(steps: RhetMoveStep[], pattern: SchemaSlot[]): boolean {
  for (let i = 0; i <= steps.length - pattern.length; i++) {
    let j = 0;
    for (let k = i; k < steps.length && j < pattern.length; k++) {
      if (steps[k].slot === 'flow') continue;
      if (steps[k].slot === pattern[j]) j++;
      else break;
    }
    if (j === pattern.length) return true;
  }
  return false;
}

const SCHEMA_INVENTORY: SchemaSpec[] = [
  {
    id: 'COMPLAINT_via_broadening_restatement',
    goal: 'INDICT_INSTITUTION_via_sympathetic_lament',
    match: (steps) => {
      // Must actually broaden, must have a complaint target (A), must
      // have sympathetic background (B). Window must be paragraph-sized.
      if (!hasReformulationOfKind(steps, 'broaden')) return 0;
      if (steps.filter(s => s.slot === 'A').length < 1) return 0;
      if (steps.filter(s => s.slot === 'B').length < 1) return 0;
      if (operatorDensity(steps) < 0.15) return 0;
      return 0.8 * lengthDecay(steps);
    },
  },
  {
    id: 'OBSERVATION_then_generalization',
    goal: 'ESTABLISH_neutral_observation',
    match: (steps) => {
      if (!hasReformulationOfKind(steps, 'abstract')) return 0;
      if (!hasSequence(steps, ['B', 'A'])) return 0;
      return 0.75 * lengthDecay(steps);
    },
  },
  {
    id: 'CONCESSION_then_pivot',
    goal: 'CONCEDE_to_set_up_rebuttal',
    match: (steps) => {
      const qualified = hasElaborationOfKind(steps, 'qualification');
      const inverted  = hasOp(steps, 'INVERT');
      if (!qualified && !inverted) return 0;
      if (!hasSequence(steps, ['B', 'A']) && !hasSequence(steps, ['D', 'A'])) return 0;
      const base = qualified && inverted ? 0.8 : 0.7;
      return base * lengthDecay(steps);
    },
  },
  {
    id: 'LAMENT_blame_call',
    goal: 'INDICT_INSTITUTION_via_sympathetic_lament',
    match: (steps) => {
      if (!hasOp(steps, 'GROUND')) return 0;
      if (steps.filter(s => s.slot === 'B').length < 2) return 0;
      if (steps.filter(s => s.slot === 'A').length < 1) return 0;
      if (operatorDensity(steps) < 0.2) return 0;
      return 0.75 * lengthDecay(steps);
    },
  },
  {
    id: 'DEFINITION_then_problematization',
    goal: 'DEFINE_to_enable_critique',
    match: (steps) => {
      const introStep = steps.find(s => s.slot === 'intro' && s.op === 'INTRODUCE');
      if (!introStep) return 0;
      if (!hasSequence(steps, ['intro', 'A'])) return 0;
      // Must also be one of the EARLY steps — definitions don't come
      // at step 30 of a 40-step monologue.
      if (introStep.n > 3) return 0;
      return 0.75 * lengthDecay(steps);
    },
  },
  {
    id: 'CITATION_then_endorsement',
    goal: 'INVOKE_authority_to_endorse',
    match: (steps) => {
      if (!hasElaborationOfKind(steps, 'evidence')) return 0;
      if (!hasSequence(steps, ['B', 'A'])) return 0;
      if (hasOp(steps, 'INVERT')) return 0; // refutation, not endorsement
      return 0.75 * lengthDecay(steps);
    },
  },
  {
    id: 'CITATION_then_refutation',
    goal: 'INVOKE_authority_to_refute',
    match: (steps) => {
      if (!hasElaborationOfKind(steps, 'evidence')) return 0;
      if (!hasOp(steps, 'INVERT')) return 0;
      return 0.8 * lengthDecay(steps);
    },
  },
  {
    id: 'ANALOGY_setup_then_application',
    goal: 'ANALOGIZE_to_transfer_judgment',
    match: (steps) => {
      if (!hasReformulationOfKind(steps, 'analogize')) return 0;
      return 0.8 * lengthDecay(steps);
    },
  },
  {
    id: 'BACKGROUND_then_claim_then_grounds',
    goal: 'BUILD_grounded_claim',
    match: (steps) => {
      // The structural canary that was wildly over-firing in v1.
      // Now we REQUIRE an actual GROUND op (i.e. real grounds, not
      // just any third site that happens to fall in slot C), AND the
      // window must be paragraph-scoped.
      if (!hasOp(steps, 'GROUND')) return 0;
      if (!hasSequence(steps, ['B', 'A', 'C'])) return 0;
      if (operatorDensity(steps) < 0.2) return 0;
      return 0.85 * lengthDecay(steps);
    },
  },
  {
    id: 'RECRUIT_via_rhetorical_question',
    goal: 'PROVOKE_via_rhetorical_question',
    match: (steps) => {
      if (steps.length > 12) return 0;
      const last = steps[steps.length - 1];
      if (!last || last.slot !== 'A') return 0;
      if (!hasRepetitionOfKind(steps, 'emphatic')) return 0;
      return 0.75;
    },
  },
];

function recognizeSchemas(steps: RhetMoveStep[]): SchemaCandidate[] {
  const slotsByStep = new Map<number, SchemaSlot>();
  for (const s of steps) slotsByStep.set(s.n, s.slot);
  const candidates: SchemaCandidate[] = [];
  for (const spec of SCHEMA_INVENTORY) {
    const conf = spec.match(steps, slotsByStep);
    if (conf > 0) {
      const bindings: Partial<Record<SchemaSlot, number[]>> = {};
      for (const s of steps) {
        if (!bindings[s.slot]) bindings[s.slot] = [];
        bindings[s.slot]!.push(s.n);
      }
      candidates.push({ id: spec.id, confidence: conf, bindings, goal: spec.goal });
    }
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  if (candidates.length === 0) {
    candidates.push({
      id: 'UNRECOGNIZED',
      confidence: 0.2,
      bindings: {},
      goal: 'UNDETERMINED',
    });
  }
  return candidates;
}

// ── Public entry ──────────────────────────────────────────────────

export function buildRhetoricalProgram(
  turnId: string,
  stacks: CitationStack[],
  sentenceTexts: string[],
): RhetoricalProgram {
  const { steps, siteToStep } = extractSteps(stacks, sentenceTexts);
  const spanShapes = segmentShapes(steps);
  const schemaCandidates = recognizeSchemas(steps);
  const strategicGoal = schemaCandidates[0]?.goal ?? 'UNDETERMINED';
  return { turnId, steps, spanShapes, schemaCandidates, strategicGoal, siteToStep };
}
