/**
 * CollocationParser — breaks down Japanese collocation entries into their
 * constituent grammatical and discourse-grammar components so that both
 * jp-collocations and jp-sentence-surfer- can consume structured data.
 *
 * Design goals
 * ─────────────
 * • Zero runtime dependencies beyond the types already defined in types.ts
 *   and surfer-types.ts.
 * • Rule-based (no MeCab / external API required) so it works offline inside
 *   Obsidian.
 * • Composable: each analysis step is a pure function so the surfer plugin can
 *   cherry-pick just the parts it needs.
 */

import type { CollocationEntry, PartOfSpeech } from "../types.ts";
import type { DiscourseCategory, DiscoursePosition } from "../surfer-types.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Discourse-marker lexicon
// ──────────────────────────────────────────────────────────────────────────────

/** Maps a surface form to its most likely discourse category. */
const DISCOURSE_MARKER_MAP: ReadonlyMap<string, DiscourseCategory> = new Map([
  // topic-initiation
  ["さて", "topic-initiation"],
  ["ところで", "topic-initiation"],
  ["では", "topic-initiation"],
  ["それでは", "topic-initiation"],
  ["話は変わりますが", "topic-initiation"],
  ["ちなみに", "topic-initiation"],
  // reasoning
  ["なぜなら", "reasoning"],
  ["なぜかというと", "reasoning"],
  ["というのは", "reasoning"],
  ["だから", "reasoning"],
  ["したがって", "reasoning"],
  ["ゆえに", "reasoning"],
  ["よって", "reasoning"],
  ["そのため", "reasoning"],
  ["それゆえ", "reasoning"],
  ["要するに", "reasoning"],
  ["結局", "reasoning"],
  // modality
  ["たぶん", "modality"],
  ["おそらく", "modality"],
  ["きっと", "modality"],
  ["もしかしたら", "modality"],
  ["どうやら", "modality"],
  ["はずだ", "modality"],
  ["べきだ", "modality"],
  ["かもしれない", "modality"],
  ["にちがいない", "modality"],
  ["はずがない", "modality"],
  ["わけがない", "modality"],
  ["ようだ", "modality"],
  ["らしい", "modality"],
  // connective
  ["そして", "connective"],
  ["また", "connective"],
  ["さらに", "connective"],
  ["加えて", "connective"],
  ["一方", "connective"],
  ["他方", "connective"],
  ["しかし", "connective"],
  ["でも", "connective"],
  ["ただし", "connective"],
  ["けれども", "connective"],
  ["ところが", "connective"],
  ["それに", "connective"],
  ["その上", "connective"],
  ["しかも", "connective"],
  ["だが", "connective"],
  // confirmation
  ["そうですね", "confirmation"],
  ["なるほど", "confirmation"],
  ["確かに", "confirmation"],
  ["たしかに", "confirmation"],
  ["ですよね", "confirmation"],
  ["ですね", "confirmation"],
  ["よね", "confirmation"],
  ["ね", "confirmation"],
  // rephrasing
  ["つまり", "rephrasing"],
  ["言い換えると", "rephrasing"],
  ["換言すると", "rephrasing"],
  ["別の言い方をすると", "rephrasing"],
  ["要は", "rephrasing"],
  ["むしろ", "rephrasing"],
  // filler
  ["えーと", "filler"],
  ["ええと", "filler"],
  ["あの", "filler"],
  ["まあ", "filler"],
  ["なんか", "filler"],
  ["その", "filler"],
  // quotation
  ["によると", "quotation"],
  ["によれば", "quotation"],
  ["曰く", "quotation"],
  ["いわく", "quotation"],
  ["いわゆる", "quotation"],
  ["〜とのことだ", "quotation"],
]);

/** Markers that typically appear at utterance-initial position. */
const INITIAL_MARKERS = new Set([
  "さて", "ところで", "では", "それでは", "そして", "また", "さらに", "加えて",
  "一方", "他方", "しかし", "でも", "ただし", "けれども", "ところが", "それに",
  "その上", "しかも", "だが", "なぜなら", "というのは", "だから", "したがって",
  "ゆえに", "よって", "そのため", "それゆえ", "つまり", "すなわち", "要するに",
  "結局", "話は変わりますが", "ちなみに", "言い換えると", "換言すると", "要は",
  "むしろ", "なるほど",
]);

/** Markers that typically appear at utterance-final position. */
const FINAL_MARKERS = new Set([
  "ですね", "よね", "ね", "ですよね", "そうですね", "なるほど",
  "はずだ", "べきだ", "かもしれない", "にちがいない", "はずがない",
  "わけがない", "ようだ", "らしい",
]);

// ──────────────────────────────────────────────────────────────────────────────
// Collocation pattern rules
// ──────────────────────────────────────────────────────────────────────────────

/** Named structural patterns in Japanese collocations. */
export type CollocationPattern =
  | "N+V"          // 研究する、決断を下す
  | "V+N"          // 食べ物を探す
  | "N+の+N"       // 日本の文化
  | "V+て+V"       // 走って帰る
  | "Adj+N"        // 難しい問題
  | "N+に+V"       // 仕事に取り組む
  | "N+を+V"       // 結論を出す
  | "V+ながら"     // 歩きながら
  | "V+てから"     // 食べてから
  | "set-phrase"   // fixed idiomatic expression
  | "discourse-marker"
  | "unknown";

// Simple heuristic pattern rules applied to the fullPhrase string.
const PATTERN_RULES: Array<{ test: (s: string) => boolean; pattern: CollocationPattern }> = [
  { test: s => DISCOURSE_MARKER_MAP.has(s), pattern: "discourse-marker" },
  { test: s => /[てでた]から/.test(s), pattern: "V+てから" },
  { test: s => /ながら/.test(s), pattern: "V+ながら" },
  { test: s => /[てで][いるたた]/.test(s) || /[てで][行来帰]/.test(s), pattern: "V+て+V" },
  { test: s => /を[するしたして]/.test(s) || /を[^\sのにをがもはで]{1,6}(する|した|して)/.test(s), pattern: "N+を+V" },
  { test: s => /に[取組取組取組つい]/.test(s) || /に[^\sのにをがもはで]{1,4}する/.test(s), pattern: "N+に+V" },
  { test: s => /の[^\sのにをがもはで]+$/.test(s), pattern: "N+の+N" },
  { test: s => /[いうえおつく]い[^\s]/.test(s), pattern: "Adj+N" },
  { test: s => /[するしたして]$/.test(s), pattern: "N+V" },
];

// ──────────────────────────────────────────────────────────────────────────────
// Result types
// ──────────────────────────────────────────────────────────────────────────────

export interface ParsedCollocation {
  /** Original entry. */
  entry: CollocationEntry;
  /** Detected structural pattern. */
  pattern: CollocationPattern;
  /** Constituent morpheme-level tokens (best-effort, no external tokenizer). */
  tokens: CollocationToken[];
  /** Discourse-grammar annotation if the full phrase or headword is a discourse marker. */
  discourseAnnotation: DiscourseAnnotation | null;
  /** Pragmatic register inferred from surface cues. */
  register: "formal" | "neutral" | "informal";
  /** Whether the collocation forms part of a set / idiomatic phrase. */
  isSetPhrase: boolean;
}

export interface CollocationToken {
  surface: string;
  role: "headword" | "collocate" | "particle" | "auxiliary" | "connector" | "other";
  pos?: PartOfSpeech;
}

export interface DiscourseAnnotation {
  category: DiscourseCategory;
  position: DiscoursePosition;
  pragmaticFunction: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const FORMAL_ENDINGS = ["ます", "です", "ございます", "であります", "であろう", "でしょう"];
const INFORMAL_ENDINGS = ["だ", "じゃ", "んだ", "んで", "てる", "でる", "や", "やん", "ちゃう"];
const PARTICLES = new Set(["は", "が", "を", "に", "で", "へ", "と", "から", "まで", "より", "の", "も", "か"]);

function inferRegister(surface: string): "formal" | "neutral" | "informal" {
  if (FORMAL_ENDINGS.some(e => surface.endsWith(e))) return "formal";
  if (INFORMAL_ENDINGS.some(e => surface.endsWith(e))) return "informal";
  return "neutral";
}

function detectPattern(entry: CollocationEntry): CollocationPattern {
  const phrase = entry.fullPhrase ?? `${entry.headword}${entry.collocate}`;
  for (const rule of PATTERN_RULES) {
    if (rule.test(phrase)) return rule.pattern;
  }
  return "unknown";
}

/**
 * Naively tokenise a collocation phrase into headword / collocate / particle
 * segments. Without MeCab we do a best-effort split based on the structured
 * fields already present in CollocationEntry.
 */
function tokenise(entry: CollocationEntry): CollocationToken[] {
  const tokens: CollocationToken[] = [];

  // Emit headword
  tokens.push({ surface: entry.headword, role: "headword", pos: entry.headwordPOS });

  // Scan for Japanese particles between headword and collocate inside fullPhrase
  const phrase = entry.fullPhrase ?? `${entry.headword}${entry.collocate}`;
  const afterHeadword = phrase.slice(entry.headword.length);
  let remaining = afterHeadword;

  // Peel leading particles
  while (remaining.length > 0) {
    const ch = remaining[0];
    if (PARTICLES.has(ch)) {
      tokens.push({ surface: ch, role: "particle" });
      remaining = remaining.slice(1);
    } else {
      break;
    }
  }

  // Emit collocate
  if (entry.collocate) {
    const collocateIdx = remaining.indexOf(entry.collocate);
    if (collocateIdx > 0) {
      // anything before the collocate is a connector / auxiliary
      tokens.push({ surface: remaining.slice(0, collocateIdx), role: "connector" });
    }
    tokens.push({ surface: entry.collocate, role: "collocate", pos: entry.collocatePOS });
    remaining = remaining.slice(Math.max(0, collocateIdx) + entry.collocate.length);
  }

  // Emit any trailing auxiliary / conjugation suffix
  if (remaining.length > 0) {
    tokens.push({ surface: remaining, role: "auxiliary" });
  }

  return tokens;
}

function buildDiscourseAnnotation(entry: CollocationEntry): DiscourseAnnotation | null {
  const surface = entry.fullPhrase ?? entry.headword;

  // Direct lookup
  const category = DISCOURSE_MARKER_MAP.get(surface)
    ?? DISCOURSE_MARKER_MAP.get(entry.headword);
  if (!category) return null;

  let position: DiscoursePosition = "any";
  if (INITIAL_MARKERS.has(surface) || INITIAL_MARKERS.has(entry.headword)) {
    position = "utterance-initial";
  } else if (FINAL_MARKERS.has(surface) || FINAL_MARKERS.has(entry.headword)) {
    position = "utterance-final";
  }

  const PRAGMATIC_FUNCTIONS: Record<DiscourseCategory, string> = {
    "topic-initiation": "新話題の導入",
    "reasoning": "理由・根拠の提示",
    "modality": "話者の態度・確信度の表明",
    "connective": "命題間の論理関係の明示",
    "confirmation": "聞き手との認識共有の確認",
    "rephrasing": "先行命題の言い換え・明確化",
    "filler": "発話権の保持・思考の間繋ぎ",
    "quotation": "他者の発話・情報源の引用",
  };

  return {
    category,
    position,
    pragmaticFunction: PRAGMATIC_FUNCTIONS[category],
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Parse a single CollocationEntry into a rich ParsedCollocation object.
 */
export function parseCollocation(entry: CollocationEntry): ParsedCollocation {
  return {
    entry,
    pattern: detectPattern(entry),
    tokens: tokenise(entry),
    discourseAnnotation: buildDiscourseAnnotation(entry),
    register: inferRegister(entry.fullPhrase ?? entry.headword),
    isSetPhrase:
      detectPattern(entry) === "set-phrase" ||
      detectPattern(entry) === "discourse-marker",
  };
}

/**
 * Parse an array of CollocationEntry objects.
 */
export function parseAll(entries: CollocationEntry[]): ParsedCollocation[] {
  return entries.map(parseCollocation);
}

/**
 * Group ParsedCollocation results by their detected structural pattern.
 */
export function groupByPattern(
  parsed: ParsedCollocation[]
): Map<CollocationPattern, ParsedCollocation[]> {
  const map = new Map<CollocationPattern, ParsedCollocation[]>();
  for (const p of parsed) {
    const group = map.get(p.pattern) ?? [];
    group.push(p);
    map.set(p.pattern, group);
  }
  return map;
}

/**
 * Filter ParsedCollocations that carry a discourse annotation.
 */
export function filterDiscourseMarkers(
  parsed: ParsedCollocation[]
): ParsedCollocation[] {
  return parsed.filter(p => p.discourseAnnotation !== null);
}

/**
 * Extract discourse statistics from a set of CollocationEntry objects.
 * Useful for rendering the DiscourseView chart.
 */
export function computeDiscourseStats(entries: CollocationEntry[]): {
  byCategoryCount: Map<DiscourseCategory, number>;
  byPatternCount: Map<CollocationPattern, number>;
  byRegisterCount: Map<"formal" | "neutral" | "informal", number>;
  discourseMarkerCount: number;
  totalCount: number;
} {
  const parsed = parseAll(entries);

  const byCategoryCount = new Map<DiscourseCategory, number>();
  const byPatternCount = new Map<CollocationPattern, number>();
  const byRegisterCount = new Map<"formal" | "neutral" | "informal", number>();
  let discourseMarkerCount = 0;

  for (const p of parsed) {
    if (p.discourseAnnotation) {
      const cat = p.discourseAnnotation.category;
      byCategoryCount.set(cat, (byCategoryCount.get(cat) ?? 0) + 1);
      discourseMarkerCount++;
    }
    byPatternCount.set(p.pattern, (byPatternCount.get(p.pattern) ?? 0) + 1);
    byRegisterCount.set(p.register, (byRegisterCount.get(p.register) ?? 0) + 1);
  }

  return {
    byCategoryCount,
    byPatternCount,
    byRegisterCount,
    discourseMarkerCount,
    totalCount: entries.length,
  };
}
