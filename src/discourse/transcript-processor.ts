/**
 * transcript-processor.ts — YouTube transcript parsing & speaker segmentation
 *
 * Handles the real structure of vault notes containing YT transcripts:
 *   [00:00:22] こんばんは。安倍マフライムMC
 *   [00:00:23] の山崎レ奈です。
 *   [00:00:25] さあ、始まりました。
 *
 * Key capabilities:
 *   • Strip timestamps for clean discourse analysis
 *   • Merge continuation lines (speaker continues across timestamps)
 *   • Detect speaker changes via discourse markers & heuristics
 *   • Preserve timestamp→offset mapping for back-reference
 *   • Handle Obsidian formatting (==highlights==, **bold**, ^blockids)
 *   • Handle stray numbers that got split onto their own lines
 *   • Strip URLs while preserving them separately
 *
 * Design principle: 文脈 ＝ 意味
 *   Context IS meaning — so we never destroy information, we separate
 *   the layers (timestamps, speaker, text) for independent access.
 */

// ── Types ────────────────────────────────────────────────────

export interface TimestampedLine {
  /** Raw timestamp string e.g. "00:00:22" */
  timestamp: string;
  /** Seconds from start */
  seconds: number;
  /** The text content after the timestamp */
  text: string;
  /** Original line number (1-based) in the source file */
  lineNumber: number;
}

export interface TranscriptTurn {
  /** Speaker ID (0-based, inferred — not named) */
  speaker: number;
  /** Start timestamp (seconds) */
  startTime: number;
  /** End timestamp (seconds, from next turn's start or last line) */
  endTime: number;
  /** Start timestamp string */
  startTimestamp: string;
  /** The merged, clean text of this turn */
  text: string;
  /** Original line numbers that comprise this turn */
  lineNumbers: number[];
  /** Whether a speaker change was detected here */
  isSpeakerChange: boolean;
}

export interface TranscriptAnalysis {
  /** All parsed turns with speaker assignment */
  turns: TranscriptTurn[];
  /** Clean text with timestamps stripped (all turns concatenated) */
  cleanText: string;
  /** Number of detected speakers */
  speakerCount: number;
  /** Map from clean-text character offset → { timestamp, speaker } */
  offsetMap: OffsetMapping[];
  /** Any URLs found and extracted */
  extractedUrls: string[];
  /** Total duration in seconds */
  durationSeconds: number;
}

export interface OffsetMapping {
  /** Character offset in the clean text */
  cleanOffset: number;
  /** Corresponding timestamp in seconds */
  seconds: number;
  /** Timestamp string */
  timestamp: string;
  /** Speaker ID */
  speaker: number;
}

// ── Constants ────────────────────────────────────────────────

/** Matches [HH:MM:SS] or [MM:SS] timestamp format */
const TIMESTAMP_RE = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;

/** Matches a line that is ONLY a timestamp + optional whitespace */
const TIMESTAMP_LINE_RE = /^\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*$/;

/** Matches a line that starts with a timestamp */
const TIMESTAMPED_LINE_RE = /^\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)/;

/** Lines that are just a number (got split from next line) */
const LONE_NUMBER_RE = /^\s*(\d{1,4})\s*$/;

/** Obsidian block ID reference */
const BLOCK_ID_RE = /\^[a-z0-9]+$/;

/** URL pattern (http/https) */
const URL_RE = /https?:\/\/[^\s\]）」』】\)]+/g;

/** Obsidian highlight syntax */
const HIGHLIGHT_RE = /==(.*?)==/g;

/** Obsidian bold syntax */
const BOLD_RE = /\*\*(.*?)\*\*/g;

/**
 * Discourse markers that strongly signal a NEW speaker is starting.
 * These are common turn-initial expressions in Japanese conversation.
 * Sorted longest-first for greedy matching.
 */
const TURN_INITIAL_MARKERS: string[] = [
  // Strong turn-openers (new speaker almost certain)
  'ありがとうございました',
  'よろしくお願いします',
  'よろしくお願いいたします',
  'お願いいたします',
  'お願いします',
  'おっしゃる通り',
  'ありがとうございます',
  'そうですよね',
  'そうなんですよ',
  'いやいやいや',
  'なるほどですね',
  'どうですか',
  'いかがでしょうか',
  'そうでした',
  'そうですね',
  'ということは',
  'ごめんなさい',
  'なるほど',
  'ではゲスト',
  'では行きましょう',
  'では西田さん',
  'では早速',
  '分かりました',
  'はい。',
  'ええ、',
  'ええ。',
  'うん。',
  'いや、',
  'あ、',
];

/**
 * Patterns that weakly suggest a speaker change — only used when
 * combined with other signals (time gap, sentence-final before).
 */
const WEAK_TURN_MARKERS: string[] = [
  'で、', 'ま、', 'あの、', 'えっと、', 'だから',
  'それで', 'ただ、', 'でも', 'しかし', 'つまり',
];

/**
 * Sentence-final patterns that suggest the current speaker is done.
 * Used to detect likely turn boundaries.
 */
const SENTENCE_FINAL_PATTERNS: string[] = [
  'ですよね。', 'ですかね。', 'ですか?', 'ですか？',
  'ですよ。', 'ますよ。', 'ますね。', 'ましたよね。',
  'ですけどね。', 'と思いますね。', 'でしょうね。',
  'ですよね', 'と思います。', 'ございます。',
  'ませんか。', 'ませんか？', 'でしょうか。', 'でしょうか？',
  'ましたね。', 'ましたよね。', 'かなと。',
  'と思うんですけど。', 'と思っています。',
  'しましたよね。', 'んですよね。', 'じゃないですか。',
  'してください。',
];

// ── Core parsing ─────────────────────────────────────────────

/**
 * Parse timestamp string "HH:MM:SS" or "MM:SS" into seconds.
 */
export function parseTimestamp(ts: string): number {
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/**
 * Format seconds back to HH:MM:SS string.
 */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Parse raw text into timestamped lines.
 * Handles:
 *   - Lone numbers merged with next line
 *   - Block IDs stripped
 *   - Empty timestamp-only lines skipped
 */
export function parseTimestampedLines(rawText: string): TimestampedLine[] {
  const rawLines = rawText.split('\n');
  const result: TimestampedLine[] = [];
  let pendingNumber: string | null = null;
  let pendingLineNum = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const lineNum = i + 1;
    let line = rawLines[i];

    // Strip block IDs (^ky2dgq at end of line)
    line = line.replace(BLOCK_ID_RE, '').trimEnd();

    // Check for lone number line — merge with next content
    const loneNum = line.match(LONE_NUMBER_RE);
    if (loneNum) {
      pendingNumber = loneNum[1];
      pendingLineNum = lineNum;
      continue;
    }

    // Check for timestamp-only line — skip
    if (TIMESTAMP_LINE_RE.test(line)) continue;

    // Check for timestamped line
    const tsMatch = line.match(TIMESTAMPED_LINE_RE);
    if (tsMatch) {
      let text = tsMatch[2].trim();

      // Prepend any pending number
      if (pendingNumber !== null) {
        text = pendingNumber + text;
        pendingNumber = null;
      }

      if (text) {
        result.push({
          timestamp: tsMatch[1],
          seconds: parseTimestamp(tsMatch[1]),
          text,
          lineNumber: lineNum,
        });
      }
      continue;
    }

    // Non-timestamped, non-number line — could be continuation or non-transcript text
    // If there's a pending number and this isn't empty, prepend it
    if (pendingNumber !== null && line.trim()) {
      // This line has no timestamp — it might be raw continuation
      // Append pending number to it if the last entry exists
      if (result.length > 0) {
        result[result.length - 1].text += pendingNumber + line.trim();
      }
      pendingNumber = null;
      continue;
    }
    pendingNumber = null;

    // Non-transcript line with content — append to previous if exists
    if (line.trim() && result.length > 0) {
      result[result.length - 1].text += line.trim();
    }
  }

  return result;
}

// ── Obsidian / URL cleaning ──────────────────────────────────

/**
 * Extract and remove URLs from text, returning both the cleaned text and the URLs.
 */
export function extractUrls(text: string): { cleaned: string; urls: string[] } {
  const urls: string[] = [];
  const cleaned = text.replace(URL_RE, (match) => {
    urls.push(match);
    return '';
  });
  return { cleaned: cleaned.replace(/\s{2,}/g, ' '), urls };
}

/**
 * Strip Obsidian-specific formatting while preserving the content.
 * ==highlighted text== → highlighted text
 * **bold text** → bold text
 */
export function stripObsidianFormatting(text: string): string {
  return text
    .replace(HIGHLIGHT_RE, '$1')
    .replace(BOLD_RE, '$1')
    .replace(/\\\[/g, '[')   // escaped brackets
    .replace(/\\\]/g, ']');
}

/**
 * Full cleaning pipeline: remove timestamps, URLs, Obsidian formatting.
 * Returns pure Japanese text ready for discourse analysis.
 */
export function cleanForAnalysis(text: string): string {
  let clean = text;
  // Remove timestamps
  clean = clean.replace(TIMESTAMP_RE, '');
  // Remove block IDs
  clean = clean.replace(/\^[a-z0-9]+/g, '');
  // Strip Obsidian formatting (preserve content)
  clean = stripObsidianFormatting(clean);
  // Remove URLs
  clean = clean.replace(URL_RE, '');
  // Collapse whitespace
  clean = clean.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return clean;
}

/**
 * Strip only timestamps from text (preserving everything else).
 * Use this when you want to keep URLs and formatting intact.
 */
export function stripTimestamps(text: string): string {
  return text.replace(TIMESTAMP_RE, '').replace(/^\s+/gm, '').replace(/\n{3,}/g, '\n\n');
}

// ── Speaker change detection ─────────────────────────────────

/**
 * Detect whether a turn-initial text signals a new speaker.
 *
 * Uses multiple heuristics:
 *   1. Strong turn-initial markers (はい。, そうですね, etc.)
 *   2. Time gap between lines (>2s gap = likely new speaker)
 *   3. Previous line ended with sentence-final pattern
 *   4. Question→Answer adjacency
 */
function detectSpeakerChange(
  current: TimestampedLine,
  previous: TimestampedLine | null,
  prevEndedSentence: boolean,
): boolean {
  if (!previous) return true; // First line is always a "new speaker"

  const text = current.text;
  const timeGap = current.seconds - previous.seconds;

  // Strong turn-initial markers → almost certainly new speaker
  for (const marker of TURN_INITIAL_MARKERS) {
    if (text.startsWith(marker)) return true;
  }

  // Time gap > 2 seconds + previous ended a sentence → new speaker
  if (timeGap >= 2 && prevEndedSentence) return true;

  // Time gap > 3 seconds alone → likely new speaker regardless
  if (timeGap >= 3) return true;

  // Short interjection patterns at start (single-mora responses)
  if (/^[うはえあ][\s、。]/.test(text) && prevEndedSentence) return true;

  // Weak markers + sentence-final before → probable change
  if (prevEndedSentence) {
    for (const marker of WEAK_TURN_MARKERS) {
      if (text.startsWith(marker)) return true;
    }
  }

  return false;
}

/**
 * Check if a text line ends with a sentence-final pattern.
 */
function endsSentence(text: string): boolean {
  const trimmed = text.trimEnd();
  for (const pat of SENTENCE_FINAL_PATTERNS) {
    if (trimmed.endsWith(pat)) return true;
  }
  // Also check for plain 。ending
  if (trimmed.endsWith('。') || trimmed.endsWith('？') || trimmed.endsWith('?')) return true;
  return false;
}

// ── Turn merging ─────────────────────────────────────────────

/**
 * Merge consecutive timestamped lines into speaker turns.
 *
 * Lines belong to the same turn when:
 *   - No speaker change is detected (see heuristics above)
 *   - The previous line didn't end with a sentence-final pattern + gap
 *   - The line appears to continue a sentence (starts mid-word, particle, etc.)
 *
 * Handles the common case where a sentence spans multiple timestamp lines:
 *   [00:00:22] こんばんは。安倍マフライムMC
 *   [00:00:23] の山崎レ奈です。
 *   → merged: "こんばんは。安倍マフライムMCの山崎レ奈です。"
 */
export function mergeIntoTurns(lines: TimestampedLine[]): TranscriptTurn[] {
  if (lines.length === 0) return [];

  const turns: TranscriptTurn[] = [];
  let currentSpeaker = 0;
  let currentTexts: string[] = [];
  let currentLineNumbers: number[] = [];
  let currentStartTime = lines[0].seconds;
  let currentStartTimestamp = lines[0].timestamp;
  let prevLine: TimestampedLine | null = null;
  let prevEndedSentence = false;

  for (const line of lines) {
    const isNewSpeaker = detectSpeakerChange(line, prevLine, prevEndedSentence);

    if (isNewSpeaker && currentTexts.length > 0) {
      // Flush current turn
      turns.push({
        speaker: currentSpeaker,
        startTime: currentStartTime,
        endTime: line.seconds,
        startTimestamp: currentStartTimestamp,
        text: joinTurnTexts(currentTexts),
        lineNumbers: currentLineNumbers,
        isSpeakerChange: true,
      });

      // Advance speaker (cycle through 0-3 for up to 4 speakers)
      if (isNewSpeaker && prevLine) {
        currentSpeaker = (currentSpeaker + 1) % 4;
      }
      currentTexts = [];
      currentLineNumbers = [];
      currentStartTime = line.seconds;
      currentStartTimestamp = line.timestamp;
    }

    currentTexts.push(line.text);
    currentLineNumbers.push(line.lineNumber);
    prevEndedSentence = endsSentence(line.text);
    prevLine = line;
  }

  // Flush last turn
  if (currentTexts.length > 0) {
    turns.push({
      speaker: currentSpeaker,
      startTime: currentStartTime,
      endTime: prevLine ? prevLine.seconds + 1 : currentStartTime + 1,
      startTimestamp: currentStartTimestamp,
      text: joinTurnTexts(currentTexts),
      lineNumbers: currentLineNumbers,
      isSpeakerChange: true,
    });
  }

  // Refine speaker count by analyzing unique speaker IDs
  return turns;
}

/**
 * Join multiple text fragments from consecutive timestamp lines
 * into a single coherent Japanese text.
 *
 * Handles:
 *   - Lines that continue mid-sentence (no space/punct at boundary)
 *   - Lines that start a new sentence (。before, new statement after)
 *   - Particle continuations (の, が, を, で, に, は, と, も, から, etc.)
 */
function joinTurnTexts(texts: string[]): string {
  if (texts.length === 0) return '';
  if (texts.length === 1) return texts[0].trim();

  let result = texts[0].trim();

  for (let i = 1; i < texts.length; i++) {
    const next = texts[i].trim();
    if (!next) continue;

    const prevChar = result[result.length - 1];
    const nextChar = next[0];

    // If previous ends with punctuation/sentence-ender AND next starts
    // a clear new sentence, add a space for readability
    if (isSentenceEnd(prevChar) && !isContinuationStart(nextChar)) {
      result += next;
    } else {
      // Direct concatenation — the text continues mid-sentence
      result += next;
    }
  }

  return result;
}

function isSentenceEnd(ch: string): boolean {
  return '。？！?!…」』】）)〉》'.includes(ch);
}

function isContinuationStart(ch: string): boolean {
  // Particles, auxiliary verbs, continuations — these mean the previous
  // line's sentence hasn't ended
  return 'のがをでにはともからけどってていたなくりれるんだしさ'.includes(ch);
}

// ── Full transcript processing ───────────────────────────────

/**
 * Check if text contains transcript-format timestamps.
 */
export function isTranscriptFormat(text: string): boolean {
  // Need at least 3 timestamp markers to consider it a transcript
  const matches = text.match(TIMESTAMP_RE);
  return (matches?.length ?? 0) >= 3;
}

/**
 * Full transcript processing pipeline.
 *
 * Input: raw note text with [HH:MM:SS] timestamps
 * Output: structured transcript with speaker turns, clean text, offset mapping
 */
export function processTranscript(rawText: string): TranscriptAnalysis {
  // Extract URLs before processing
  const { cleaned: textNoUrls, urls } = extractUrls(rawText);

  // Parse into timestamped lines
  const lines = parseTimestampedLines(textNoUrls);

  // Merge into speaker turns
  const turns = mergeIntoTurns(lines);

  // Build clean text and offset map
  const offsetMap: OffsetMapping[] = [];
  const textParts: string[] = [];
  let currentOffset = 0;

  for (const turn of turns) {
    const cleanTurnText = stripObsidianFormatting(turn.text);

    offsetMap.push({
      cleanOffset: currentOffset,
      seconds: turn.startTime,
      timestamp: turn.startTimestamp,
      speaker: turn.speaker,
    });

    textParts.push(cleanTurnText);
    currentOffset += cleanTurnText.length + 1; // +1 for separator
  }

  const cleanText = textParts.join('\n');

  // Count unique speakers
  const speakerIds = new Set(turns.map(t => t.speaker));

  // Duration
  const duration = turns.length > 0
    ? turns[turns.length - 1].endTime
    : 0;

  return {
    turns,
    cleanText,
    speakerCount: speakerIds.size,
    offsetMap,
    extractedUrls: urls,
    durationSeconds: duration,
  };
}

// ── Offset lookup ────────────────────────────────────────────

/**
 * Given a character offset in the clean text, find the corresponding
 * timestamp and speaker.
 */
export function lookupOffset(
  offsetMap: OffsetMapping[],
  cleanOffset: number,
): { timestamp: string; seconds: number; speaker: number } | null {
  if (offsetMap.length === 0) return null;

  // Binary search for the mapping entry
  let lo = 0, hi = offsetMap.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (offsetMap[mid].cleanOffset <= cleanOffset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return {
    timestamp: offsetMap[lo].timestamp,
    seconds: offsetMap[lo].seconds,
    speaker: offsetMap[lo].speaker,
  };
}

// ── Selection cleaning ───────────────────────────────────────

/**
 * Clean a user's selection from a transcript note.
 *
 * When a user selects text in Obsidian that includes timestamps,
 * this removes the timestamps and reassembles the text properly.
 * Useful for the surfer "select → analyze" workflow.
 */
export function cleanSelection(selectedText: string): string {
  if (!isTranscriptFormat(selectedText)) {
    // Not transcript format — just strip Obsidian formatting
    return stripObsidianFormatting(selectedText).trim();
  }

  // Process as transcript
  const result = processTranscript(selectedText);
  return result.cleanText;
}

// ── Per-speaker extraction ───────────────────────────────────

/**
 * Extract all text spoken by a specific speaker.
 * Useful for analyzing individual speaker's discourse patterns.
 */
export function getTextBySpeaker(
  analysis: TranscriptAnalysis,
  speakerId: number,
): string {
  return analysis.turns
    .filter(t => t.speaker === speakerId)
    .map(t => stripObsidianFormatting(t.text))
    .join('\n');
}

/**
 * Get a summary of each speaker's contribution.
 */
export function getSpeakerSummary(
  analysis: TranscriptAnalysis,
): Array<{ speaker: number; turnCount: number; charCount: number; firstTimestamp: string }> {
  const map = new Map<number, { turnCount: number; charCount: number; firstTimestamp: string }>();

  for (const turn of analysis.turns) {
    const existing = map.get(turn.speaker);
    if (existing) {
      existing.turnCount++;
      existing.charCount += turn.text.length;
    } else {
      map.set(turn.speaker, {
        turnCount: 1,
        charCount: turn.text.length,
        firstTimestamp: turn.startTimestamp,
      });
    }
  }

  return Array.from(map.entries())
    .map(([speaker, data]) => ({ speaker, ...data }))
    .sort((a, b) => a.speaker - b.speaker);
}
