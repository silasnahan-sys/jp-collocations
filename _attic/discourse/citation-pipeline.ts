/**
 * citation-pipeline.ts — Orchestrator: feeds a transcript through L1..L5.
 *
 * Public API:
 *   - classifyTranscript(transcriptId, text) → TranscriptCitations
 *
 * Sentence splitting is naive (。/？/！/newline) — production callers
 * should pass already-segmented sentences via `classifyTranscriptSegmented`.
 */

import type {
  CitationLocator,
  CitationSite,
  CitationStack,
  TranscriptCitations,
} from './citation-types';
import { CITATION_TOKINDS } from './citation-types';
import { classifyL1 } from './citation-l1';
import { classifyL2 } from './citation-l2';
import { composeStack } from './citation-l3';
import { classifyL4, type L4Context } from './citation-l4';
import { classifyL5 } from './citation-l5';
import { buildRhetoricalProgram } from './program-builder';
import { applyProgramOverrides } from './schema-driven-l4';
import type { RhetoricalProgram } from './rhetorical-program';

const SENT_SPLIT_RE = /([\u3002\uff1f\uff01\n]+)/;

export interface Segment {
  text: string;
  /** Character offset of segment start within full transcript text. */
  charStart: number;
  /** Optional speaker id (for cross-turn segmentation). */
  speakerId?: string;
}

export function segmentTranscript(text: string): Segment[] {
  const parts = text.split(SENT_SPLIT_RE);
  const out: Segment[] = [];
  let cursor = 0;
  let buf = '';
  let segStart = 0;
  for (const p of parts) {
    if (!p) continue;
    if (buf === '') segStart = cursor;
    buf += p;
    if (/[\u3002\uff1f\uff01\n]/.test(p)) {
      const trimmed = buf.trim();
      if (trimmed.length > 0) {
        out.push({ text: buf, charStart: segStart });
      }
      buf = '';
    }
    cursor += p.length;
  }
  if (buf.trim().length > 0) out.push({ text: buf, charStart: segStart });
  return out;
}

const HISTORY_WINDOW = 6;

/**
 * Default span (in sentences) for one monologue program window.
 * Picked so a window covers roughly one paragraph-sized rhetorical
 * unit in a YouTube monologue (~6–10 sentences). When the corpus
 * carries speakerIds we ignore this and use the speaker boundary.
 */
const PROGRAM_WINDOW_SENTENCES = 8;
/**
 * Hard cap on sites per window. If a sentence-window happens to
 * accumulate more sites than this (very dense stretch), split it
 * further so the schema recognizer never sees a single mega-window.
 */
const PROGRAM_WINDOW_MAX_SITES = 18;

/**
 * Split a flat list of stacks into program-sized windows. Walks the
 * stacks in document order and starts a new window whenever EITHER
 * the sentence span exceeds PROGRAM_WINDOW_SENTENCES OR the running
 * site count exceeds PROGRAM_WINDOW_MAX_SITES.
 */
function sliceIntoProgramWindows(ss: CitationStack[]): CitationStack[][] {
  if (ss.length === 0) return [];
  const out: CitationStack[][] = [];
  let cur: CitationStack[] = [];
  let curStartSentence = ss[0].sentenceIdx;
  let curSiteCount = 0;
  for (const stack of ss) {
    const wouldExceedSpan = (stack.sentenceIdx - curStartSentence) >= PROGRAM_WINDOW_SENTENCES;
    const wouldExceedSites = (curSiteCount + stack.sites.length) > PROGRAM_WINDOW_MAX_SITES;
    if (cur.length > 0 && (wouldExceedSpan || wouldExceedSites)) {
      out.push(cur);
      cur = [];
      curStartSentence = stack.sentenceIdx;
      curSiteCount = 0;
    }
    cur.push(stack);
    curSiteCount += stack.sites.length;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

export interface ClassifyOptions {
  /**
   * Skip the schema-driven L4 overlay (programs are still built and
   * attached to the result). Useful for diagnostics that need to
   * capture the pre-overlay axis values, then call
   * `applyProgramOverrides` themselves with a before/after snapshot.
   */
  skipSchemaOverlay?: boolean;
}

export function classifyTranscriptSegmented(
  transcriptId: string,
  segments: Segment[],
  opts: ClassifyOptions = {},
): TranscriptCitations {
  const t0 = Date.now();
  const stacks: CitationStack[] = [];
  let sitesFound = 0;
  let rejectedByL1 = 0;
  let prevSpeaker: string | undefined = undefined;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const sentence = seg.text;

    const locatorBase: Omit<CitationLocator, 'charEnd'> = {
      transcriptId,
      sentenceIdx: i,
      charStart: seg.charStart,
    };

    // L1
    const l1Hits = classifyL1(sentence, locatorBase);
    const citationHits = l1Hits.filter(h => CITATION_TOKINDS.has(h.toKind));
    rejectedByL1 += (l1Hits.length - citationHits.length);
    if (citationHits.length === 0) {
      prevSpeaker = seg.speakerId;
      continue;
    }

    // L2 — build sites
    const sites: CitationSite[] = [];
    for (let k = 0; k < citationHits.length; k++) {
      const sid = `t:${transcriptId}:s${i}:c${k}`;
      const { site } = classifyL2(citationHits[k], sentence, sid, {
        transcriptId,
        sentenceIdx: i,
        charStart: seg.charStart + citationHits[k].offset,
      });
      sites.push(site);
    }
    sitesFound += sites.length;

    // L3 — compose stack
    const stack = composeStack(i, sites, sentence);

    // L4 — discourse-relational with rolling window
    const history = stacks.slice(-HISTORY_WINDOW);
    const ctx: L4Context = {
      history,
      currentSentence: sentence,
      isTurnBoundary: !!(seg.speakerId && prevSpeaker && seg.speakerId !== prevSpeaker),
    };
    classifyL4(stack, ctx);

    stacks.push(stack);
    prevSpeaker = seg.speakerId;
  }

  // L5 — cross-turn chains (single turn fallback if no speaker info)
  const speakerGroups = new Map<string, CitationStack[]>();
  if (segments.some(s => s.speakerId)) {
    for (let i = 0; i < stacks.length; i++) {
      const sp = segments[stacks[i].sentenceIdx]?.speakerId ?? '_';
      if (!speakerGroups.has(sp)) speakerGroups.set(sp, []);
      speakerGroups.get(sp)!.push(stacks[i]);
    }
  } else {
    speakerGroups.set('_', stacks);
  }
  const turns = Array.from(speakerGroups.entries()).map(([speakerId, ss]) => ({ speakerId, stacks: ss }));
  const graph = classifyL5({ turns });

  // Build per-turn rhetorical programs. We pass the sentence texts
  // indexed by sentenceIdx so the builder can run cue-window regexes.
  //
  // Scoping: a program represents one discourse unit. When the corpus
  // carries `speakerId`s we trust them (one program per speaker turn).
  // When it doesn't (monologue YouTube transcripts etc.) treating the
  // whole transcript as one program is wrong — schema priors then get
  // smeared over hundreds of sites. Instead, slice each speakerless
  // group into rolling windows of `PROGRAM_WINDOW_SENTENCES` sentences
  // capped at `PROGRAM_WINDOW_MAX_SITES` sites per window. This keeps
  // each program at a digestible discourse scope.
  const sentenceTexts: string[] = segments.map(s => s.text);
  const programs: RhetoricalProgram[] = [];
  let turnCounter = 0;
  const hasSpeakerInfo = segments.some(s => s.speakerId);
  for (const { speakerId, stacks: ss } of turns) {
    if (ss.length === 0) continue;
    const windows = hasSpeakerInfo
      ? [ss]
      : sliceIntoProgramWindows(ss);
    for (const win of windows) {
      if (win.length === 0) continue;
      const turnId = `${transcriptId}:turn${turnCounter}:${speakerId}`;
      programs.push(buildRhetoricalProgram(turnId, win, sentenceTexts));
      turnCounter += 1;
    }
  }

  // Schema-driven L4 overlay: when a turn's top schema candidate is
  // confident, override the cue-derived per-site axes with priors
  // bound to (schemaId, slot, op). Mutates sites in place.
  if (!opts.skipSchemaOverlay) {
    applyProgramOverrides(programs, stacks);
  }

  return {
    transcriptId,
    stacks,
    graph,
    programs,
    stats: {
      sentencesScanned: segments.length,
      sitesFound,
      rejectedByL1,
      durationMs: Date.now() - t0,
    },
  };
}

export function classifyTranscript(transcriptId: string, text: string, opts: ClassifyOptions = {}): TranscriptCitations {
  const segments = segmentTranscript(text);
  return classifyTranscriptSegmented(transcriptId, segments, opts);
}
