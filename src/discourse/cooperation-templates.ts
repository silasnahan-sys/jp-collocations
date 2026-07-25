/**
 * cooperation-templates.ts — Slot-based cooperation template matcher
 *
 * From PR#11: Models common interactional patterns between speakers
 * as templates with fillable slots. These templates capture the
 * 共話 (co-construction) patterns that are fundamental to Japanese
 * discourse — where meaning is built cooperatively between participants.
 *
 * Templates model multi-turn sequences like:
 *   A: [Claim + ヘッジ] → B: [Backchannel] → A: [Elaboration]
 *   A: [Question]       → B: [Answer + わけ] → A: [なるほど]
 *
 * This is especially important for YT transcripts where two or more
 * speakers cooperatively build arguments.
 */

import { PATTERN_BY_ID, type PatternCategory, type DiscoursePatternDef } from './discourse-patterns';
import type { PatternMatch } from './discourse-grammar';

// ── Types ────────────────────────────────────────────────────

export type SlotType =
  | 'claim'
  | 'hedge'
  | 'backchannel'
  | 'elaboration'
  | 'question'
  | 'answer'
  | 'agreement'
  | 'disagreement'
  | 'concession'
  | 'rebuttal'
  | 'evidence'
  | 'summary'
  | 'topic-shift'
  | 'repair'
  | 'filler'
  | 'emotional-response'
  | 'any';

export interface TemplateSlot {
  /** Slot label */
  type: SlotType;
  /** Pattern categories that can fill this slot */
  acceptedCategories: PatternCategory[];
  /** Specific pragmatic functions that fill this slot */
  acceptedFunctions: string[];
  /** Is this slot optional? */
  optional: boolean;
  /** Speaker role (for multi-speaker tracking) */
  speaker: 'A' | 'B' | 'any';
  /** Japanese description of what fills this slot */
  description: string;
}

export interface CooperationTemplate {
  id: string;
  /** Template name in Japanese */
  name: string;
  /** Template name in English */
  nameEn: string;
  /** Ordered sequence of slots */
  slots: TemplateSlot[];
  /** Description of when this pattern occurs */
  context: string;
  /** Frequency in YT transcripts: 1=very common, 4=rare */
  frequencyTier: 1 | 2 | 3 | 4;
}

export interface TemplateMatch {
  template: CooperationTemplate;
  /** The patterns that filled each slot (index corresponds to slot index) */
  filledSlots: Array<PatternMatch | null>;
  /** Match confidence: ratio of filled slots to total slots */
  confidence: number;
}

// ══════════════════════════════════════════════════════════════
// TEMPLATE DEFINITIONS
// ══════════════════════════════════════════════════════════════

export const COOPERATION_TEMPLATES: CooperationTemplate[] = [
  // ── CT01: 譲歩→反論 (Concession → Rebuttal) ─────────────
  {
    id: 'CT01', name: '譲歩→反論', nameEn: 'Concession → Rebuttal',
    context: 'Speaker acknowledges the other\'s point, then presents counter-argument',
    frequencyTier: 1,
    slots: [
      {
        type: 'concession', acceptedCategories: ['A'],
        acceptedFunctions: ['concession'], optional: false,
        speaker: 'A', description: '相手の意見を認める（確かに、もちろん）',
      },
      {
        type: 'backchannel', acceptedCategories: ['E'],
        acceptedFunctions: ['backchannel', 'agreement'], optional: true,
        speaker: 'B', description: '相手の譲歩に反応（うん、そうそう）',
      },
      {
        type: 'rebuttal', acceptedCategories: ['A', 'C'],
        acceptedFunctions: ['contrast', 'disagreement'], optional: false,
        speaker: 'A', description: '反論を提示（でも、ただ）',
      },
      {
        type: 'claim', acceptedCategories: ['B'],
        acceptedFunctions: ['assertion', 'emphasis'], optional: false,
        speaker: 'A', description: '主張を展開（んですよ、わけです）',
      },
    ],
  },

  // ── CT02: 情報提示→反応 (Information → Response) ─────────
  {
    id: 'CT02', name: '情報提示→反応', nameEn: 'Information → Response',
    context: 'Speaker presents new information, listener responds',
    frequencyTier: 1,
    slots: [
      {
        type: 'claim', acceptedCategories: ['A', 'B'],
        acceptedFunctions: ['information-source', 'assertion'], optional: false,
        speaker: 'A', description: '情報を提示（実は、んですよ）',
      },
      {
        type: 'emotional-response', acceptedCategories: ['E'],
        acceptedFunctions: ['surprise', 'backchannel'], optional: false,
        speaker: 'B', description: '驚き・関心を示す（へえ、マジで）',
      },
      {
        type: 'elaboration', acceptedCategories: ['C', 'B'],
        acceptedFunctions: ['elaboration', 'cause'], optional: true,
        speaker: 'A', description: '詳細を追加（しかも、というのは）',
      },
    ],
  },

  // ── CT03: 質問→回答→評価 (Q→A→Evaluation) ──────────────
  {
    id: 'CT03', name: '質問→回答→評価', nameEn: 'Q → A → Evaluation',
    context: 'Question-answer-evaluation triad (IRE pattern)',
    frequencyTier: 1,
    slots: [
      {
        type: 'question', acceptedCategories: ['B', 'E'],
        acceptedFunctions: ['confirmation-seeking'], optional: false,
        speaker: 'A', description: '質問する（じゃないですか、でしょう）',
      },
      {
        type: 'answer', acceptedCategories: ['B'],
        acceptedFunctions: ['assertion', 'cause'], optional: false,
        speaker: 'B', description: '回答する（わけですよ、んですよ）',
      },
      {
        type: 'agreement', acceptedCategories: ['E'],
        acceptedFunctions: ['backchannel', 'agreement'], optional: false,
        speaker: 'A', description: '評価する（なるほど、たしかに）',
      },
    ],
  },

  // ── CT04: 段階的説明 (Stepwise Explanation) ──────────────
  {
    id: 'CT04', name: '段階的説明', nameEn: 'Stepwise Explanation',
    context: 'Speaker builds explanation step by step with listener backchanneling',
    frequencyTier: 1,
    slots: [
      {
        type: 'claim', acceptedCategories: ['A'],
        acceptedFunctions: ['sequence', 'topic-initiation'], optional: false,
        speaker: 'A', description: '序論を開始（まず、そもそも）',
      },
      {
        type: 'backchannel', acceptedCategories: ['E'],
        acceptedFunctions: ['backchannel'], optional: true,
        speaker: 'B', description: '受信確認（うん、はい）',
      },
      {
        type: 'elaboration', acceptedCategories: ['C'],
        acceptedFunctions: ['addition', 'cause'], optional: false,
        speaker: 'A', description: '展開する（しかも、なので）',
      },
      {
        type: 'backchannel', acceptedCategories: ['E'],
        acceptedFunctions: ['backchannel', 'agreement'], optional: true,
        speaker: 'B', description: '理解を示す（なるほど）',
      },
      {
        type: 'summary', acceptedCategories: ['A', 'D'],
        acceptedFunctions: ['summary', 'rephrasing'], optional: false,
        speaker: 'A', description: 'まとめる（結局、というわけで）',
      },
    ],
  },

  // ── CT05: 共感構築 (Empathy Building) ───────────────────
  {
    id: 'CT05', name: '共感構築', nameEn: 'Empathy Building',
    context: 'Both speakers cooperatively build shared understanding',
    frequencyTier: 1,
    slots: [
      {
        type: 'claim', acceptedCategories: ['B'],
        acceptedFunctions: ['assertion', 'hedge'], optional: false,
        speaker: 'A', description: '意見を述べる（んですけど）',
      },
      {
        type: 'agreement', acceptedCategories: ['E'],
        acceptedFunctions: ['agreement', 'backchannel'], optional: false,
        speaker: 'B', description: '共感を示す（わかるわかる、そうそう）',
      },
      {
        type: 'elaboration', acceptedCategories: ['B', 'C'],
        acceptedFunctions: ['addition', 'elaboration'], optional: false,
        speaker: 'B', description: '話を膨らませる（しかも、それに）',
      },
      {
        type: 'agreement', acceptedCategories: ['E'],
        acceptedFunctions: ['agreement', 'emotional'], optional: false,
        speaker: 'A', description: '相互共感（たしかに、な）',
      },
    ],
  },

  // ── CT06: 引用→オチ (Quotation → Punchline) ─────────────
  {
    id: 'CT06', name: '引用→オチ', nameEn: 'Quotation → Punchline',
    context: 'Builds up narrative tension through quotation, leading to a punchline or twist.',
    frequencyTier: 2,
    slots: [
      {
        type: 'claim', acceptedCategories: ['A'],
        acceptedFunctions: ['sequence', 'attention'], optional: true,
        speaker: 'A', description: '場面設定（そしたらさ、でね）',
      },
      {
        type: 'claim', acceptedCategories: ['G'],
        acceptedFunctions: ['quotation'], optional: false,
        speaker: 'A', description: '引用する（って言ったら、って）',
      },
      {
        type: 'emotional-response', acceptedCategories: ['E'],
        acceptedFunctions: ['surprise', 'emotional', 'backchannel'], optional: false,
        speaker: 'B', description: '反応する（えー、マジで、やば）',
      },
    ],
  },

  // ── CT07: 自己修正 (Self-Repair) ────────────────────────
  {
    id: 'CT07', name: '自己修正', nameEn: 'Self-Repair',
    context: 'Speaker corrects or rephrases their own statement',
    frequencyTier: 2,
    slots: [
      {
        type: 'claim', acceptedCategories: ['B'],
        acceptedFunctions: ['assertion', 'hedge'], optional: false,
        speaker: 'A', description: '最初の発話',
      },
      {
        type: 'repair', acceptedCategories: ['A', 'C'],
        acceptedFunctions: ['self-repair', 'rephrasing'], optional: false,
        speaker: 'A', description: '修正する（ていうか、というか）',
      },
      {
        type: 'claim', acceptedCategories: ['A', 'B'],
        acceptedFunctions: ['rephrasing', 'summary'], optional: false,
        speaker: 'A', description: '言い直し（つまり、要するに）',
      },
    ],
  },

  // ── CT08: 話題転換 (Topic Transition) ───────────────────
  {
    id: 'CT08', name: '話題転換', nameEn: 'Topic Transition',
    context: 'One speaker transitions to a new topic',
    frequencyTier: 2,
    slots: [
      {
        type: 'summary', acceptedCategories: ['D'],
        acceptedFunctions: ['summary', 'topic-close'], optional: true,
        speaker: 'A', description: '前の話題を閉じる（という感じで）',
      },
      {
        type: 'topic-shift', acceptedCategories: ['D'],
        acceptedFunctions: ['topic-shift', 'topic-initiation'], optional: false,
        speaker: 'A', description: '話題転換（ところで、そういえば）',
      },
      {
        type: 'backchannel', acceptedCategories: ['E'],
        acceptedFunctions: ['backchannel'], optional: true,
        speaker: 'B', description: '受容する（うん）',
      },
    ],
  },

  // ── CT09: 証拠列挙 (Evidence Enumeration) ──────────────
  {
    id: 'CT09', name: '証拠列挙', nameEn: 'Evidence Enumeration',
    context: 'Speaker systematically presents multiple pieces of evidence',
    frequencyTier: 2,
    slots: [
      {
        type: 'claim', acceptedCategories: ['A'],
        acceptedFunctions: ['sequence'], optional: false,
        speaker: 'A', description: '第一証拠（1つはさ、まず）',
      },
      {
        type: 'backchannel', acceptedCategories: ['E'],
        acceptedFunctions: ['backchannel'], optional: true,
        speaker: 'B', description: '受信確認',
      },
      {
        type: 'evidence', acceptedCategories: ['A', 'C'],
        acceptedFunctions: ['sequence', 'addition'], optional: false,
        speaker: 'A', description: '追加証拠（あともう1個、さらに）',
      },
      {
        type: 'summary', acceptedCategories: ['A', 'D'],
        acceptedFunctions: ['summary', 'result'], optional: true,
        speaker: 'A', description: '結論（結局、だから）',
      },
    ],
  },

  // ── CT10: 伝聞→評価→展開 (Hearsay → Evaluation → Development) ──
  {
    id: 'CT10', name: '伝聞→評価→展開', nameEn: 'Hearsay → Evaluation',
    context: 'Speaker reports hearsay, evaluates it, then develops their point',
    frequencyTier: 2,
    slots: [
      {
        type: 'claim', acceptedCategories: ['B', 'G'],
        acceptedFunctions: ['hearsay', 'quotation', 'evidential'], optional: false,
        speaker: 'A', description: '伝聞を報告（らしい、って言ってた）',
      },
      {
        type: 'backchannel', acceptedCategories: ['E'],
        acceptedFunctions: ['surprise', 'backchannel'], optional: true,
        speaker: 'B', description: '反応（へえ）',
      },
      {
        type: 'claim', acceptedCategories: ['G', 'F'],
        acceptedFunctions: ['epistemic', 'hedge'], optional: false,
        speaker: 'A', description: '評価する（と思う、気がする）',
      },
    ],
  },
];

// ══════════════════════════════════════════════════════════════
// TEMPLATE MATCHING ENGINE
// ══════════════════════════════════════════════════════════════

/**
 * Match cooperation templates against a sequence of pattern matches.
 * Returns all templates that match, sorted by confidence.
 *
 * @param matches - Pattern matches from a text, in order
 * @param minConfidence - Minimum filled-slot ratio to count as a match (default: 0.5)
 */
export function matchTemplates(
  matches: PatternMatch[],
  minConfidence: number = 0.5,
): TemplateMatch[] {
  const results: TemplateMatch[] = [];

  for (const template of COOPERATION_TEMPLATES) {
    const result = tryMatchTemplate(template, matches);
    if (result && result.confidence >= minConfidence) {
      results.push(result);
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

function tryMatchTemplate(
  template: CooperationTemplate,
  matches: PatternMatch[],
): TemplateMatch | null {
  const filledSlots: Array<PatternMatch | null> = new Array(template.slots.length).fill(null);
  let matchIdx = 0;

  for (let slotIdx = 0; slotIdx < template.slots.length; slotIdx++) {
    const slot = template.slots[slotIdx];
    let filled = false;

    // Scan forward through remaining matches for one that fits this slot
    for (let i = matchIdx; i < matches.length; i++) {
      if (fitsSlot(matches[i], slot)) {
        filledSlots[slotIdx] = matches[i];
        matchIdx = i + 1;
        filled = true;
        break;
      }
    }

    // If required slot wasn't filled, template doesn't match (unless optional)
    if (!filled && !slot.optional) {
      // Still continue — the template might partially match
    }
  }

  // Calculate confidence
  const requiredSlots = template.slots.filter(s => !s.optional);
  const filledRequired = filledSlots.filter((s, i) =>
    s !== null && !template.slots[i].optional,
  ).length;
  const filledOptional = filledSlots.filter((s, i) =>
    s !== null && template.slots[i].optional,
  ).length;

  if (filledRequired === 0) return null;

  const confidence = requiredSlots.length > 0
    ? (filledRequired + filledOptional * 0.5) / template.slots.length
    : 0;

  return { template, filledSlots, confidence };
}

function fitsSlot(match: PatternMatch, slot: TemplateSlot): boolean {
  const p = match.pattern;

  // Check category
  if (slot.acceptedCategories.length > 0 &&
      !slot.acceptedCategories.includes(p.category)) {
    return false;
  }

  // Check pragmatic function
  if (slot.acceptedFunctions.length > 0 &&
      !slot.acceptedFunctions.includes(p.pragmaticFunction)) {
    return false;
  }

  return true;
}
