import type { DiscourseBit, DiscourseRelation } from "../types.ts";

// ── Discourse grammar patterns (談話文法) ──────────────────────
// Each pattern detects a discourse function in Japanese transcripts.

interface DiscoursePattern {
  /** Regex applied per segment. */
  regex: RegExp;
  label: string;
  relationType: string;
}

const DISCOURSE_PATTERNS: DiscoursePattern[] = [
  // 話題化 — topic markers / topic shift
  { regex: /は[。、\s]|って[さねよ]|というのは/u, label: "話題化", relationType: "topic" },
  // 付加疑問文 — tag questions (よね, でしょ, じゃない)
  { regex: /よね[。？]?$|でしょ[う？]?$|じゃない[？]?$/u, label: "付加疑問文", relationType: "tag-question" },
  // 例示 — exemplification (たとえば, とか, みたいな)
  { regex: /たとえば|例えば|とか[、。\s]|みたいな/u, label: "例示", relationType: "example" },
  // 付加 — additive continuation (それに, しかも, あと)
  { regex: /^それに|^しかも|^あと[、\s]/u, label: "付加", relationType: "addition" },
  // 反応・相槌 — back-channel / reactions (はい, うん, そうそう, ほんと)
  { regex: /^はい[はい]*[。]?$|^うん[うん]*$|^そうそう|^ほんと[うに]?[？!。]?$/u, label: "相槌", relationType: "reaction" },
  // 理由・原因 — reason (から, ので, だって)
  { regex: /から[。、\s]|ので[。、\s]|^だって/u, label: "理由", relationType: "reason" },
  // 逆接 — contrast (でも, けど, が)
  { regex: /^でも|けど[。、\s]|^ただ[、\s]/u, label: "逆接", relationType: "contrast" },
  // 言い換え — rephrasing (つまり, 要するに, というか)
  { regex: /^つまり|^要するに|というか/u, label: "言い換え", relationType: "rephrase" },
  // 感嘆・詠嘆 — exclamation (あ、ああ, おお, えっ)
  { regex: /^[あぁ][、。!！]|^おお|^えっ|^わあ/u, label: "感嘆", relationType: "exclamation" },
  // 確認 — confirmation seeking (かな, だっけ, っけ)
  { regex: /かな[。]?$|だっけ[。？]?$|っけ[。？]?$/u, label: "確認", relationType: "confirmation" },
];

/** Timestamp pattern commonly found in YouTube transcripts: [MM:SS] or [HH:MM:SS] */
const TIMESTAMP_RE = /\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/g;

/**
 * Heuristic speaker detection for Y-transcripts.
 *
 * Strategies:
 * 1. Lines starting with a name/label followed by colon or 「 」.
 * 2. Alternating speakers inferred from back-channel markers.
 * 3. Significant pause / timestamp boundaries.
 */
function detectSpeaker(segment: string, previousSpeaker: string): string {
  // Named speaker pattern: "Name: text" or "Name「text」"
  const namedMatch = segment.match(/^([A-Za-z\u3040-\u9FFF]{1,10})[：:]\s*/u);
  if (namedMatch) return namedMatch[1];

  // If segment is entirely a reaction / back-channel, it's likely the other speaker
  if (/^(はい|うん|そうそう|ほんと|ああ|えっ|へえ|なるほど)[。！!？]*$/u.test(segment.trim())) {
    return previousSpeaker === "Speaker A" ? "Speaker B" : "Speaker A";
  }

  return previousSpeaker;
}

/**
 * Split raw text into segments suitable for discourse analysis.
 * Handles YouTube transcript quirks (timestamps, run-on lines, speaker markers).
 */
function splitIntoSegments(rawText: string): string[] {
  // Strip timestamps
  let cleaned = rawText.replace(TIMESTAMP_RE, " ");
  // Normalise whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // Split on sentence-ending punctuation while keeping the punctuation.
  // Also split on 。 or period followed by space.
  const rough = cleaned.split(/(?<=[。！？!?])\s*/u).filter(s => s.trim().length > 0);

  // Further split very long segments at 、 boundaries when they exceed ~60 chars
  const result: string[] = [];
  for (const seg of rough) {
    if (seg.length > 60 && seg.includes("、")) {
      // Split at natural clause breaks keeping a reasonable size
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

let nextBitId = 0;
function genBitId(): string {
  return `bit_${Date.now()}_${nextBitId++}`;
}

export interface AnalysisResult {
  bits: DiscourseBit[];
  relations: DiscourseRelation[];
}

/**
 * DiscourseAnalyzer — parses Japanese transcript / text into discourse bits
 * and identifies 談話文法 relations between them.
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

      // Detect which discourse pattern (if any) this segment matches
      let label = "";
      let relationType = "";
      for (const pat of DISCOURSE_PATTERNS) {
        if (pat.regex.test(seg)) {
          label = pat.label;
          relationType = pat.relationType;
          break;
        }
      }

      // Assign a connection group: consecutive segments from the same speaker
      // with matching or complementary discourse labels share a group.
      const prevBit = bits.length > 0 ? bits[bits.length - 1] : null;
      const sameSpeaker = prevBit && prevBit.speaker === currentSpeaker;
      const isReaction = relationType === "reaction" || relationType === "tag-question";
      if (!sameSpeaker && !isReaction) {
        groupCounter++;
      }

      const bit: DiscourseBit = {
        id: genBitId(),
        text: seg,
        speaker: currentSpeaker,
        connectionGroup: groupCounter,
        discourseLabel: label,
        startOffset: offset,
        endOffset: offset + seg.length,
      };
      bits.push(bit);
      offset += seg.length + 1; // +1 for implicit separator
    }

    // Build relations between adjacent bits that share a connectionGroup
    const relations: DiscourseRelation[] = [];
    for (let i = 1; i < bits.length; i++) {
      const prev = bits[i - 1];
      const curr = bits[i];
      if (prev.connectionGroup === curr.connectionGroup) {
        relations.push({
          fromBitId: prev.id,
          toBitId: curr.id,
          relationType: curr.discourseLabel || "continuation",
          connectionGroup: curr.connectionGroup,
        });
      }

      // Also link reactions back to the bit they react to
      if (curr.discourseLabel === "相槌" && prev.connectionGroup !== curr.connectionGroup) {
        relations.push({
          fromBitId: prev.id,
          toBitId: curr.id,
          relationType: "reaction",
          connectionGroup: curr.connectionGroup,
        });
      }
    }

    return { bits, relations };
  }

  /**
   * Given a larger text and a selected phrase, extract a context chunk
   * centred on the phrase with the given radius (number of segments on each side).
   */
  extractChunk(fullText: string, selectedPhrase: string, radius: number): string {
    const idx = fullText.indexOf(selectedPhrase);
    if (idx === -1) return fullText;

    // Expand to sentence boundaries
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

      const isSelected = rawText.indexOf(bit.text) !== -1 && selectedPhrase.includes(bit.text);
      const label = bit.discourseLabel ? ` \`${bit.discourseLabel}\`` : "";
      if (isSelected) {
        lines.push(`> **${bit.text}**${label}`);
      } else {
        lines.push(`> ${bit.text}${label}`);
      }
    }

    return lines.join("\n");
  }
}
