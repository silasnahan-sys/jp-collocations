import type { DiscourseBit, DiscourseRelation } from "../types.ts";
import { DiscourseCategory, DiscourseFunction, FUNCTION_TO_CATEGORY } from "../types.ts";

// ─────────────────────────────────────────────────────────────
// Research-grounded 談話文法 pattern database
// ─────────────────────────────────────────────────────────────
// Sources:
//   石黒圭『文章は接続詞で決まる』(2008) — connective taxonomy
//   佐久間まゆみ『文章・談話のしくみ』(2003) — topic management
//   メイナード泉子 K.『談話分析の可能性』(1993) — interactional
//   南不二男『文の姿勢』— sentence-final modality
//   市川孝『国語教育のための文章論概説』— text coherence
//   Brown & Levinson (1987) → Japanese politeness (宇佐美 2002)

interface DiscoursePattern {
  regex: RegExp;
  fn: DiscourseFunction;
  /** Relation type label used when linking bits. */
  relationType: string;
}

// ── I. 接続表現 (Connective expressions) — 石黒 2008 ──────────

const CONNECTIVE_PATTERNS: DiscoursePattern[] = [
  // 順接 — Logical consequence
  { regex: /^だから[、\s]|^したがって|^そのため[、\s]?|^それで[、\s]|^そこで[、\s]|^ゆえに/u, fn: DiscourseFunction.LogicalConsequence, relationType: "logical-consequence" },
  // 逆接 — Adversative
  { regex: /^しかし[、\s]?|^でも[、\s]?|^けれども|^ところが|^だが[、\s]?|にもかかわらず|^けど[、\s]?|^ただ[、\s]/u, fn: DiscourseFunction.Adversative, relationType: "adversative" },
  // 並列・累加 — Additive
  { regex: /^また[、\s]?|^そして[、\s]?|^それに[、\s]?|^しかも[、\s]?|^その上[、\s]?|^加えて|^かつ[、\s]?|^さらに[、\s]?|^おまけに/u, fn: DiscourseFunction.Additive, relationType: "additive" },
  // 対比 — Comparison
  { regex: /^一方[、\s]?|^それに対して|^反面|^逆に[、\s]?|^他方/u, fn: DiscourseFunction.Comparison, relationType: "comparison" },
  // 転換 — Topic change (also 話題転換 in topic management)
  { regex: /^ところで[、\s]?|^さて[、\s]?|^それはそうと|^話は変わる/u, fn: DiscourseFunction.TopicChange, relationType: "topic-change" },
  // 補足 — Supplementation
  { regex: /^なお[、\s]?|^ちなみに[、\s]?|^ただし[、\s]?|^もっとも[、\s]?/u, fn: DiscourseFunction.Supplement, relationType: "supplement" },
  // 例示 — Exemplification
  { regex: /^たとえば|^例えば|^具体的には|とか[、。\s]|みたいな[、。\s]?$/u, fn: DiscourseFunction.Exemplification, relationType: "exemplification" },
  // 言い換え — Rephrasing
  { regex: /^つまり[、\s]?|^すなわち|^要するに|^いわば|^換言すれば|^言い換えると|というか[、\s]/u, fn: DiscourseFunction.Rephrase, relationType: "rephrase" },
];

// ── II. 文末表現 (Sentence-final modality) ────────────────────

const SENTENCE_FINAL_PATTERNS: DiscoursePattern[] = [
  // 確認要求 — Confirmation seeking
  { regex: /よね[。？]?$|でしょう?[。？]?$|じゃない[。？]?$|じゃないですか[。？]?$|ではないか[。？]?$/u, fn: DiscourseFunction.ConfirmationSeeking, relationType: "confirmation-seeking" },
  // 同意要求 — Agreement seeking
  { regex: /[^よ]ね[。]?$|ねえ[。]?$/u, fn: DiscourseFunction.AgreementSeeking, relationType: "agreement-seeking" },
  // 主張 — Assertion
  { regex: /[^ね]よ[。！]?$|わ[。！]?$|ぞ[。！]?$|ぜ[。！]?$|んだ[。]?$/u, fn: DiscourseFunction.Assertion, relationType: "assertion" },
  // 推量 — Conjecture
  { regex: /だろう[。？]?$|かもしれない[。]?$|かも[。]?$|はず[。]?$/u, fn: DiscourseFunction.Conjecture, relationType: "conjecture" },
  // 伝聞 — Hearsay
  { regex: /そうだ[。]?$|そうです[。]?$|って[。]?$|らしい[。]?$|と聞いた|だって[。]?$/u, fn: DiscourseFunction.Hearsay, relationType: "hearsay" },
  // 疑問 — Question
  { regex: /か[。？]?$|かな[。？]?$|かしら[。？]?$/u, fn: DiscourseFunction.Question, relationType: "question" },
  // 意志 — Volition
  { regex: /つもり[。]?$|[よう]う[。！]?$|するぞ[。！]?$/u, fn: DiscourseFunction.Volition, relationType: "volition" },
];

// ── III. 話題管理 (Topic management) — 佐久間 2003 ────────────

const TOPIC_MANAGEMENT_PATTERNS: DiscoursePattern[] = [
  // 話題提示 — Topic introduction
  { regex: /^.{1,12}は[、\s]|って[さねよ]|というのは|について|に関して/u, fn: DiscourseFunction.TopicIntroduction, relationType: "topic-introduction" },
  // 話題転換 — Topic shift
  { regex: /^そういえば|^ところで|^それはそうと|^話変わるけど/u, fn: DiscourseFunction.TopicShift, relationType: "topic-shift" },
  // 話題深化 — Topic deepening
  { regex: /^実は|^実際のところ|^本当は|^正直[、\s]|^ぶっちゃけ/u, fn: DiscourseFunction.TopicDeepening, relationType: "topic-deepening" },
  // 話題回帰 — Topic return
  { regex: /^話を戻す|^元の話|^さっきの話|^本題に戻る/u, fn: DiscourseFunction.TopicReturn, relationType: "topic-return" },
];

// ── IV. 相互行為 (Interactional) — メイナード 1993 ────────────

const INTERACTIONAL_PATTERNS: DiscoursePattern[] = [
  // あいづち — Back-channel
  { regex: /^はい[はい]*[。]?$|^うん[うん]*[。]?$|^ええ[。]?$|^そうそう[そう]*|^なるほど[。！]?$|^へえ[ー]*[。！]?$|^ほんと[うに]?[。？！]?$|^そうですね[。]?$|^確かに[。]?$/u, fn: DiscourseFunction.BackChannel, relationType: "back-channel" },
  // フィラー — Fillers
  { regex: /^えーと|^あのー|^まあ[、\s]|^こう[、\s]|^なんか[、\s]|^えっと|^あの[、\s]|^そのー|^ほら[、\s]/u, fn: DiscourseFunction.Filler, relationType: "filler" },
  // 修復 — Repair
  { regex: /^いや[、\s]|^じゃなくて|^っていうか|^ごめん|^違う[、\s]|^そうじゃなくて/u, fn: DiscourseFunction.Repair, relationType: "repair" },
  // 注目要素 — Attention-getter
  { regex: /^ほら[、！]|^ねえ[、！]|^あのさ[、]?|^ちょっと[、！]|^聞いて[。！]?/u, fn: DiscourseFunction.AttentionGetter, relationType: "attention-getter" },
];

// ── V. 情報構造 (Information structure) ───────────────────────

const INFO_STRUCTURE_PATTERNS: DiscoursePattern[] = [
  // 焦点 — Focus particles
  { regex: /こそ[、。\s]|さえ[、。\s]|まで[も]?[、。\s]/u, fn: DiscourseFunction.Focus, relationType: "focus" },
  // 取り立て — Delimitation particles
  { regex: /だけ[、。\s]|しか[、。\s]|ばかり[、。\s]|のみ[、。\s]/u, fn: DiscourseFunction.Delimitation, relationType: "delimitation" },
];

// ── VI. 談話標識 (Discourse markers) ──────────────────────────

const DISCOURSE_MARKER_PATTERNS: DiscoursePattern[] = [
  // 開始標識 — Opening
  { regex: /^えー[、\s]|^さあ[、\s]|^じゃあ[、\s]|^では[、\s]|^はい[、\s]じゃあ/u, fn: DiscourseFunction.Opening, relationType: "opening" },
  // 展開標識 — Development
  { regex: /^で[、\s](?!も)|^それで[、\s]|^そしたら|^そうすると|^すると/u, fn: DiscourseFunction.Development, relationType: "development" },
  // 終結標識 — Closing
  { regex: /^というわけで|^以上|^じゃ[、\s]?$/u, fn: DiscourseFunction.Closing, relationType: "closing" },
];

// ── VII. ポライトネス (Politeness) ────────────────────────────

const POLITENESS_PATTERNS: DiscoursePattern[] = [
  // ヘッジ — Hedging
  { regex: /ちょっと[、\s]|少し[、\s]|なんとなく|多分|もしかして|たぶん/u, fn: DiscourseFunction.Hedging, relationType: "hedging" },
  // 間接表現 — Indirect
  { regex: /と思うんですけど|と思いますが|かなと思って|ないかなと/u, fn: DiscourseFunction.Indirect, relationType: "indirect" },
];

// ── VIII. 引用・発話 (Quotation) ──────────────────────────────

const QUOTATION_PATTERNS: DiscoursePattern[] = [
  // 直接引用 — Direct quotation
  { regex: /「.+」って|「.+」と/u, fn: DiscourseFunction.DirectQuotation, relationType: "direct-quotation" },
  // 間接引用 — Indirect quotation
  { regex: /と言った|と言って|って言う|って言った|と思った/u, fn: DiscourseFunction.IndirectQuotation, relationType: "indirect-quotation" },
];

/** All patterns in priority order. Earlier patterns take precedence as primary. */
const ALL_PATTERNS: DiscoursePattern[] = [
  ...INTERACTIONAL_PATTERNS,    // highest: back-channel detection
  ...CONNECTIVE_PATTERNS,       // high: structural connectives
  ...TOPIC_MANAGEMENT_PATTERNS,
  ...SENTENCE_FINAL_PATTERNS,
  ...QUOTATION_PATTERNS,
  ...DISCOURSE_MARKER_PATTERNS,
  ...POLITENESS_PATTERNS,
  ...INFO_STRUCTURE_PATTERNS,   // lowest: particle-level
];

// ── Utility ─────────────────────────────────────────────────

/** Timestamp pattern commonly found in YouTube transcripts: [MM:SS] or [HH:MM:SS] */
const TIMESTAMP_RE = /\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/g;

let nextBitId = 0;
function genBitId(): string {
  return `bit_${Date.now()}_${Math.random().toString(36).slice(2, 5)}_${nextBitId++}`;
}

// ── Speaker detection ───────────────────────────────────────
// Heuristic for Y-transcripts: named speakers, back-channel alternation.

const BACKCHANNEL_ONLY_RE = /^(はい|うん|ええ|そうそう|なるほど|へえ|ほんと|確かに|あ[あー]*|おお+)[。！!？ー]*$/u;

function detectSpeaker(segment: string, previousSpeaker: string): string {
  // Named speaker pattern: "Name: text" or "Name「text」"
  const namedMatch = segment.match(/^([A-Za-z\u3040-\u9FFF]{1,10})[：:]\s*/u);
  if (namedMatch) return namedMatch[1];

  // If segment is entirely a back-channel, likely the other speaker
  if (BACKCHANNEL_ONLY_RE.test(segment.trim())) {
    return previousSpeaker === "Speaker A" ? "Speaker B" : "Speaker A";
  }

  return previousSpeaker;
}

// ── Segment splitting ───────────────────────────────────────

function splitIntoSegments(rawText: string): string[] {
  // Strip timestamps
  let cleaned = rawText.replace(TIMESTAMP_RE, " ");
  // Normalise whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // Split on sentence-ending punctuation
  const rough = cleaned.split(/(?<=[。！？!?])\s*/u).filter(s => s.trim().length > 0);

  // Further split very long segments at clause boundaries
  const result: string[] = [];
  for (const seg of rough) {
    if (seg.length > 60 && seg.includes("、")) {
      const parts = seg.split(/(?<=、)/u);
      let buf = "";
      for (const p of parts) {
        if (buf.length + p.length > 60 && buf.length > 0) {
          result.push(buf.trim());
          buf = p;
        } else {
          buf += p;
        }
      }
      if (buf.trim()) result.push(buf.trim());
    } else {
      result.push(seg.trim());
    }
  }
  return result;
}

// ── Multi-pattern matcher ───────────────────────────────────

interface MatchResult {
  primary: DiscourseFunction | null;
  all: DiscourseFunction[];
  primaryRelationType: string;
}

function matchPatterns(segment: string): MatchResult {
  const matched: { fn: DiscourseFunction; relationType: string }[] = [];

  for (const pat of ALL_PATTERNS) {
    if (pat.regex.test(segment)) {
      // Avoid duplicating the same function
      if (!matched.some(m => m.fn === pat.fn)) {
        matched.push({ fn: pat.fn, relationType: pat.relationType });
      }
    }
  }

  if (matched.length === 0) {
    return { primary: null, all: [], primaryRelationType: "continuation" };
  }

  return {
    primary: matched[0].fn,
    all: matched.map(m => m.fn),
    primaryRelationType: matched[0].relationType,
  };
}

// ── Public API ──────────────────────────────────────────────

export interface AnalysisResult {
  bits: DiscourseBit[];
  relations: DiscourseRelation[];
}

/**
 * DiscourseAnalyzer — parses Japanese transcript / text into discourse bits
 * and identifies 談話文法 relations between them.
 *
 * Based on the research taxonomy of:
 *   石黒圭 (connectives), 佐久間まゆみ (topic management),
 *   メイナード泉子 (interactional), 南不二男 (modality).
 */
export class DiscourseAnalyzer {
  /**
   * Analyse raw text, returning bits and relations.
   */
  analyse(rawText: string): AnalysisResult {
    const segments = splitIntoSegments(rawText);
    const bits: DiscourseBit[] = [];
    let currentSpeaker = "Speaker A";
    let groupCounter = 0;
    let offset = 0;

    for (const seg of segments) {
      currentSpeaker = detectSpeaker(seg, currentSpeaker);

      const match = matchPatterns(seg);
      const category = match.primary ? FUNCTION_TO_CATEGORY[match.primary] : null;
      const label = match.primary ?? "";

      // Connection group: consecutive same-speaker segments share a group.
      // Back-channel / reactions cross-link instead of breaking the group.
      const prevBit = bits.length > 0 ? bits[bits.length - 1] : null;
      const sameSpeaker = prevBit && prevBit.speaker === currentSpeaker;
      const isBackChannel = match.primary === DiscourseFunction.BackChannel;
      if (!sameSpeaker && !isBackChannel) {
        groupCounter++;
      }

      const bit: DiscourseBit = {
        id: genBitId(),
        text: seg,
        speaker: currentSpeaker,
        connectionGroup: groupCounter,
        primaryFunction: match.primary,
        category,
        functions: match.all,
        discourseLabel: String(label),
        startOffset: offset,
        endOffset: offset + seg.length,
      };
      bits.push(bit);
      offset += seg.length + 1;
    }

    const relations = this.buildRelations(bits);
    return { bits, relations };
  }

  /**
   * Build relations based on discourse structure:
   * 1. Same connection-group adjacency → continuation / specific relation
   * 2. Back-channel → links back to the preceding bit from the other speaker
   * 3. Topic management → links to the prior topic bit
   * 4. Connectives → links back to what they connect
   */
  private buildRelations(bits: DiscourseBit[]): DiscourseRelation[] {
    const relations: DiscourseRelation[] = [];

    for (let i = 1; i < bits.length; i++) {
      const prev = bits[i - 1];
      const curr = bits[i];

      // Same group adjacency
      if (prev.connectionGroup === curr.connectionGroup) {
        relations.push({
          fromBitId: prev.id,
          toBitId: curr.id,
          relationType: curr.primaryFunction
            ? curr.discourseLabel
            : "continuation",
          connectionGroup: curr.connectionGroup,
        });
      }

      // Back-channel cross-link
      if (curr.primaryFunction === DiscourseFunction.BackChannel &&
          prev.connectionGroup !== curr.connectionGroup) {
        relations.push({
          fromBitId: prev.id,
          toBitId: curr.id,
          relationType: "あいづち",
          connectionGroup: curr.connectionGroup,
        });
      }

      // Connective linking — connective at start links back to prior clause
      if (curr.category === DiscourseCategory.Connective &&
          prev.connectionGroup !== curr.connectionGroup) {
        relations.push({
          fromBitId: prev.id,
          toBitId: curr.id,
          relationType: curr.discourseLabel,
          connectionGroup: curr.connectionGroup,
        });
      }

      // Agreement / confirmation seeking → link to what is being confirmed
      if ((curr.primaryFunction === DiscourseFunction.ConfirmationSeeking ||
           curr.primaryFunction === DiscourseFunction.AgreementSeeking) &&
          prev.speaker === curr.speaker &&
          prev.connectionGroup !== curr.connectionGroup) {
        relations.push({
          fromBitId: prev.id,
          toBitId: curr.id,
          relationType: curr.discourseLabel,
          connectionGroup: curr.connectionGroup,
        });
      }

      // Repair → links to what is being repaired
      if (curr.primaryFunction === DiscourseFunction.Repair) {
        relations.push({
          fromBitId: prev.id,
          toBitId: curr.id,
          relationType: "修復",
          connectionGroup: curr.connectionGroup,
        });
      }
    }

    return relations;
  }

  /**
   * Given a larger text and a selected phrase, extract a context chunk
   * centred on the phrase with the given radius.
   */
  extractChunk(fullText: string, selectedPhrase: string, radius: number): string {
    const idx = fullText.indexOf(selectedPhrase);
    if (idx === -1) return fullText;

    const before = fullText.slice(0, idx);
    const after = fullText.slice(idx + selectedPhrase.length);

    const sentencesBefore = before.split(/(?<=[。！？!?])\s*/u).filter(Boolean);
    const sentencesAfter = after.split(/(?<=[。！？!?])\s*/u).filter(Boolean);

    const contextBefore = sentencesBefore.slice(-radius).join("");
    const contextAfter = sentencesAfter.slice(0, radius).join("");

    return contextBefore + selectedPhrase + contextAfter;
  }

  /**
   * Format a chunk with its bits into highlighted markdown.
   */
  formatChunkMarkdown(rawText: string, selectedPhrase: string, bits: DiscourseBit[]): string {
    const lines: string[] = [];
    lines.push(`> **Context Chunk**`);
    lines.push(`>`);

    let currentSpeaker = "";
    for (const bit of bits) {
      if (bit.speaker !== currentSpeaker) {
        currentSpeaker = bit.speaker;
        lines.push(`> _${currentSpeaker}_:`);
      }

      // Use offset-based overlap detection for accuracy
      const phraseIdx = rawText.indexOf(selectedPhrase);
      const overlaps = phraseIdx !== -1 &&
        bit.startOffset < phraseIdx + selectedPhrase.length &&
        bit.endOffset > phraseIdx;

      const fnLabels = bit.functions.length > 0
        ? ` \`${bit.functions.join("` `")}\``
        : "";
      const catLabel = bit.category ? ` [${bit.category}]` : "";

      if (overlaps) {
        lines.push(`> **${bit.text}**${fnLabels}${catLabel}`);
      } else {
        lines.push(`> ${bit.text}${fnLabels}${catLabel}`);
      }
    }

    return lines.join("\n");
  }
}

