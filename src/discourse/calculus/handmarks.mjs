// src/discourse/calculus/handmarks.mjs
// =====================================================================
// THE TRUTH CHANNEL — 談話モード hand-marks → reducer turns
// ---------------------------------------------------------------------
// The automatic evidence chain (turns.mjs) is a RECALL machine: fragment
// merging, backchannel lifting, and floor inference are declared
// heuristics. The plugin already ships the truth surface for exactly
// these judgments: 談話モード (src/discourse/turns.ts) — tap-boundary,
// speaker-cycle, (line,char)-grain TurnRefs, with the reaction/floor-
// return semantics locked by its own golden. This adapter feeds those
// hand-marks straight into the calculus, completing the project's
// ratified pattern: AUTO CHAIN = RECALL, HAND MARKS = TRUTH.
//
// Reuses turns.ts's own slice math (sortTurns/sanitizeTurns/turnTextOf)
// so the text a hand-marked turn carries here is byte-identical to what
// 談話モード shows the user — no drift between the two surfaces.
//
// Hand-marked turns whose text is PURE backchannel (うん。) are lifted
// into grounding events like the auto chain does — but with the speaker
// GIVEN, not inferred (`given: true`). A reaction turn WITH content
// (うん。そこまで言う。) stays a real turn: it makes moves.
// =====================================================================

import { sortTurns, sanitizeTurns, turnTextOf } from '../turns.ts';
import { gradeBackchannel } from './turns.mjs';

/**
 * @param {{text:string, tStartSec?:number}[]} lines  transcript lines (LineLike)
 * @param {{start:number, char?:number, speaker:string}[]} turnRefs  hand-marked TurnRefs
 * @returns {{turns: object[], stats: {handMarked:number, lifted:number}}}
 *   turns are reducer-ready: { tSec, speaker, speakerSource:'hand', text, grounding }
 */
export function turnsFromHandMarks(lines, turnRefs) {
  const refs = sanitizeTurns(sortTurns([...(turnRefs ?? [])]), lines);
  const raw = refs.map((ref, i) => ({
    tSec: lines[ref.start]?.tStartSec ?? null,
    tEnd: lines[Math.max(ref.start, (refs[i + 1]?.start ?? lines.length) - 1)]?.tStartSec ?? null,
    speaker: ref.speaker,
    speakerSource: 'hand',
    speakerRule: 'hand-marked',
    text: turnTextOf(lines, refs, i),
    grounding: [],
    ref,
  }));

  const turns = [];
  for (const t of raw) {
    const grade = gradeBackchannel(t.text);
    if (grade && turns.length) {
      turns[turns.length - 1].grounding.push({
        tSec: t.tSec, grade, text: t.text, by: t.speaker, given: true,
      });
      continue;
    }
    turns.push(t);
  }
  return { turns, stats: { handMarked: refs.length, lifted: raw.length - turns.length } };
}
