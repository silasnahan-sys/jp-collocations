// ============================================================
// RelationshipRegistry — registers all 13 seed discourse
// relationship types and exposes a runtime-extensible registry.
// ============================================================

import {
  registerRelationshipType,
  registerBitType,
  RELATIONSHIP_TYPE_REGISTRY,
  BIT_TYPE_REGISTRY,
  type DiscourseRelationshipTypeDef,
  type BitTypeDef,
} from "./discourse-types.ts";

// --- 13 seed relationship types ------------------------------------------

const SEED_RELATIONSHIP_TYPES: DiscourseRelationshipTypeDef[] = [
  {
    id: "hedge_stance_softening",
    label: "Hedge / Stance Softening",
    description:
      "A preceding assertion is hedged or softened by a following bit containing ような感じ, みたいな, らしい, etc.",
    examplePattern: "1本読んだ → ||ような感じ||",
    tags: ["hedge", "stance", "softening", "modality"],
  },
  {
    id: "split_morpheme_coconstruction",
    label: "Split-Morpheme Co-construction",
    description:
      "A single grammatical unit is split across consecutive bits: deictic → verb-stem → concessive, etc.",
    examplePattern: "||そこに|| → ||並ん|| → ||でても||",
    tags: ["morpheme", "co-construction", "concessive"],
  },
  {
    id: "perspective_framing",
    label: "Perspective Framing",
    description:
      "An entity + 的 is followed by a case particle to establish an experiencer perspective.",
    examplePattern: "||黒が君的|| → ||には||",
    tags: ["perspective", "deictic", "stance", "的には"],
  },
  {
    id: "interactional_pivot",
    label: "Interactional Pivot",
    description:
      "A single-token realization marker (あ, え, ん, etc.) acts as a discourse turning point.",
    examplePattern: "||あ||",
    tags: ["interactional", "pivot", "realization", "discourse-marker"],
  },
  {
    id: "epistemic_continuation_blend",
    label: "Epistemic-Continuation Blend",
    description:
      "A progressive-conditional form is fused with a certainty or continuation adverb.",
    examplePattern: "||んでると確かに||",
    tags: ["epistemic", "progressive", "conditional", "certainty"],
  },
  {
    id: "discontinuous_parallel",
    label: "Discontinuous Parallel",
    description:
      "A たり enumeration pattern where matched bits span non-adjacent positions in the utterance.",
    examplePattern: "||があったり|| … ||たりしてて||",
    tags: ["parallel", "enumeration", "たり", "discontinuous"],
  },
  {
    id: "causal_concessive_cascade",
    label: "Causal-Concessive Cascade",
    description:
      "A three-node chain: reason clause → resulting action → concessive/softening terminal.",
    examplePattern: "||って思うところがあるから|| → ||急に我に変える|| → ||んだけど||",
    tags: ["causal", "concessive", "cascade", "から", "んだけど"],
  },
  {
    id: "assertion_deflation",
    label: "Assertion-Deflation",
    description:
      "A strong assertion is progressively weakened across consecutive bits ending in んじゃない? and/or みたいな.",
    examplePattern: "||そのまま|| → ||持ってきた|| → ||んじゃない||? → ||みたいな||",
    tags: ["assertion", "deflation", "weakening", "んじゃない", "みたいな"],
  },
  {
    id: "connector_compounding",
    label: "Connector Compounding",
    description:
      "Multiple discourse connectors are stacked inside a single bit: filler + causal + sequential + quotative.",
    examplePattern: "||ま、だからそれで言うと||",
    tags: ["connector", "filler", "causal", "sequential", "stacking"],
  },
  {
    id: "fuzzy_reference_chain",
    label: "Fuzzy Reference Chain",
    description:
      "Content is wrapped in approximation markers (っぽい, とか, その辺) creating vague reference.",
    examplePattern: "||元々の民和||っぽいものとかその辺の||",
    tags: ["fuzzy", "approximation", "っぽい", "とか", "reference"],
  },
  {
    id: "extended_reasoning_stance_cap",
    label: "Extended Reasoning → Stance Cap",
    description:
      "A long reasoning clause is capped by a stance/evidential marker (わけだけど, ということで, etc.).",
    examplePattern: "||価値観を...感じる|| → ||わけだけど||",
    tags: ["reasoning", "stance", "evidential", "わけだけど"],
  },
  {
    id: "epistemic_speculation_cascade",
    label: "Epistemic Speculation Cascade",
    description:
      "Progressive epistemic softening across bits, building from certainty marker to tentative conclusion.",
    examplePattern: "||きっと|| → ||俺|| → ||みたいなのが|| → ||読めば|| → ||なんか|| → ||普通に読める|| → ||のかもしれない||",
    tags: ["epistemic", "speculation", "cascade", "きっと", "のかもしれない"],
  },
  {
    id: "discourse_fade_trailoff",
    label: "Discourse Fade / Trail-off",
    description:
      "The segment ends with a boundary marker (==, …, 。。。) indicating conclusion or trailing-off.",
    examplePattern: "…== at end of segment",
    tags: ["fade", "trail-off", "boundary", "conclusion"],
  },
];

// --- Seed bit types -------------------------------------------------------

const SEED_BIT_TYPES: BitTypeDef[] = [
  { id: "assertion", label: "Assertion", description: "A declarative claim.", color: "#4a90e2" },
  { id: "hedge", label: "Hedge", description: "Softening or uncertainty marker.", color: "#f5a623" },
  { id: "deictic", label: "Deictic", description: "Pointing or reference expression.", color: "#7ed321" },
  { id: "connector", label: "Connector", description: "Discourse connector or filler.", color: "#9b59b6" },
  { id: "pivot", label: "Pivot", description: "Interactional pivot token.", color: "#e74c3c" },
  { id: "modal_cap", label: "Modal Cap", description: "Stance or modal ending.", color: "#1abc9c" },
  { id: "causal", label: "Causal", description: "Causal clause or connector.", color: "#e67e22" },
  { id: "concessive", label: "Concessive", description: "Concessive clause or particle.", color: "#3498db" },
  { id: "fuzzy_ref", label: "Fuzzy Reference", description: "Approximation or vague reference.", color: "#95a5a6" },
  { id: "boundary", label: "Boundary", description: "Discourse boundary or fade marker.", color: "#2c3e50" },
  { id: "enumeration", label: "Enumeration", description: "Part of a たり/や enumeration.", color: "#d35400" },
  { id: "speculation", label: "Speculation", description: "Epistemic speculation marker.", color: "#8e44ad" },
  { id: "generic", label: "Generic", description: "Unclassified discourse bit.", color: "#bdc3c7" },
];

// --- Public API -----------------------------------------------------------

let _seeded = false;

/** Registers all 13 seed relationship types and 13 seed bit types.
 *  Idempotent — safe to call multiple times. */
export function seedRegistry(): void {
  if (_seeded) return;
  for (const def of SEED_RELATIONSHIP_TYPES) {
    registerRelationshipType(def);
  }
  for (const def of SEED_BIT_TYPES) {
    registerBitType(def);
  }
  _seeded = true;
}

/** Returns the registry size (number of registered relationship types). */
export function registrySize(): number {
  return RELATIONSHIP_TYPE_REGISTRY.size;
}

/** Returns the bit-type registry size. */
export function bitTypeRegistrySize(): number {
  return BIT_TYPE_REGISTRY.size;
}

/** Re-exports for convenience. */
export {
  registerRelationshipType,
  registerBitType,
  RELATIONSHIP_TYPE_REGISTRY,
  BIT_TYPE_REGISTRY,
};
