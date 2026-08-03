/**
 * concordance.mjs — THE MOVE CONCORDANCE (DISCOURSE-VERDICT.md §11 fail branch,
 * ratified by measurement 2026-07-25: M1 = 21.5% < 25%).
 *
 * The board tried to be a state model of a conversation and could not carry it
 * — hard-move coverage stalled at 21.5% and every *relational* primitive moved
 * +0 when the seam was fixed. What the seam fix DID buy was enormous: on imiron
 * じゃないですか 7→54, ですよね 3→66, よね 0→60, じゃん 0→11 real instances made
 * visible. That is a concordance asset, not a state-model asset, and a
 * production lexicon (DESIGN §27) needed exactly the former.
 *
 * So the unit here is the MARKER INSTANCE, not the move:
 *
 *   • what this file ASSERTS — "この marker occurred here, in this position, in
 *     this turn, at this timestamp." That is a literal substring plus the
 *     clause-final position test. It is high precision by construction.
 *   • what it REFUSES to assert — what the speaker was *doing*. The operator id
 *     rides along as `opId`, a HINT, never a key and never a result. §12
 *     demoted the move label to bookkeeping; this file is where that demotion
 *     is enforced.
 *   • what it OBSERVES rather than infers — uptake. Whether the NEXT turn
 *     carries a grounding token is a fact about the text. Whether common ground
 *     was established is not, and is not recorded here.
 *
 * Pure: no Obsidian, no store, no I/O — golden-testable (golden/concordance.mjs).
 * Rows are shaped so `main.ts` can pour them straight into `PatternStore` as
 * 🔴 discourse entries with `status:'suggested'` attestations. Per DESIGN §28 S5
 * there is ONE road in; the concordance is not a new store, it is the discourse
 * class of the catalog that already exists.
 */

import { matchSentence } from './engine/match.mjs';
import { gradeBackchannel } from './calculus/turns.mjs';

/**
 * Interactional markers worth a concordance entry: the closed-class,
 * turn-final morphology a learner needs to REACH FOR (DESIGN §27's inversion).
 * Deliberately NOT the full operator lexicon — a concordance of every causal
 * から would be noise. These are the ones §5.2 measured as being dropped.
 */
export const CONCORDANCE_MARKERS = [
  'んじゃないですかね', 'じゃないですかね', 'んじゃないですか', 'じゃないですか',
  'んじゃないかな', 'んじゃないの', 'んじゃない',
  'んですけれども', 'んですけども', 'んですけど', 'ですけれども', 'ですけども', 'ですけど',
  'んですよね', 'んですかね', 'んですね', 'んですよ',
  'ですよね', 'ますよね', 'でしょうね', 'でしょう', 'でしょ',
  'ですかね', 'ますかね', 'ですね', 'ますね',
  'だよね', 'んだよね', 'よね', 'じゃん', 'かな',
];

/** Longest-first, so ですよね is never recorded as a bare よね. */
const MARKERS_BY_LEN = [...CONCORDANCE_MARKERS].sort((a, b) => b.length - a.length);

/**
 * Position of a marker inside its turn — the CA "position" half of position +
 * composition (DESIGN §23, §8). Purely skeletal, no content read.
 *   'final'  — nothing substantive after it (the canonical interactional slot)
 *   'clausal'— clause-final but the turn continues (the seam fix made these
 *              visible at all; they were 96% invisible before)
 *   'medial' — inside a clause; weakest evidence, kept but marked
 */
export function positionOf(text, offset, marker) {
  const after = text.slice(offset + marker.length);
  const rest = after.replace(/^[、。，,.!?！？\s]+/, '');
  if (rest.length === 0) return 'final';
  if (/^[、。，,.!?！？]/.test(after)) return 'clausal';
  return rest.length <= 6 ? 'clausal' : 'medial';
}

/**
 * Observable uptake after a marker. Fact about the text, not inference.
 *
 * CRITICAL: `transcriptToTurns` LIFTS backchannel lines out of the line stream
 * and onto the preceding turn's `grounding[]` (and Amendment v2.1 de-fuses
 * embedded uptake runs there too). So the response to a marker almost never
 * survives as a separate next TURN — reading only `next.text` scores ~0% uptake
 * on both corpora and silently reports "nobody ever responds", which is false.
 * The uptake lives in the marker turn's own grounding, with the next turn's
 * opening as the fallback for a genuine floor change.
 */
function uptakeOf(turn, next) {
  const grades = (turn?.grounding ?? []).map((g) => g.grade);
  if (grades.includes('accept')) return 'accept';
  if (grades.includes('ack')) return 'ack';
  if (!next) return null;
  const g = gradeBackchannel(next.text);
  if (g) return g;
  // a turn that OPENS with a grounding run counts as uptake even when it
  // continues into new content (the de-fuse case, Amendment v2.1)
  if (/^(なるほど|確かに|たしかに|そうですね|そうそう|はいはい)/.test(String(next.text).slice(0, 12))) return 'accept';
  return null;
}

/** Contest markers in the next turn — again observable, not a REJECT claim. */
const CONTEST_RE = /^(いや|でも|ただ|とはいえ|しかし|そうじゃなく|違う|ちが)/;

/**
 * Build the concordance from turns (`calculus/turns.mjs` → `transcriptToTurns`).
 *
 * @param {{tSec:number,tEnd?:number,speaker:string|null,speakerSource?:string,text:string}[]} turns
 * @param {{source?:object, markers?:string[]}} opts
 *   `source` is copied verbatim onto every row (file/videoId/medium — §28 S2:
 *   a row with no door back is an orphan and must not be produced).
 * @returns {ConcordanceRow[]}
 */
export function buildConcordance(turns, opts = {}) {
  const markers = opts.markers ? [...opts.markers].sort((a, b) => b.length - a.length) : MARKERS_BY_LEN;
  const source = opts.source ?? {};
  /** @type {ConcordanceRow[]} */
  const rows = [];

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const text = String(t.text ?? '');
    if (!text) continue;

    // operator hits over the WHOLE turn, used only to attach an opId hint.
    // Offsets are per-clause in moves.mjs; here we just need a lookup by span.
    let opAt = new Map();
    try {
      for (const h of matchSentence(text).hits) opAt.set(h.offset, h.opId);
    } catch { opAt = new Map(); }

    // scan longest-first, never re-reading inside an accepted marker
    let k = 0;
    const taken = [];
    while (k < text.length) {
      let hit = null;
      for (const m of markers) if (text.startsWith(m, k)) { hit = m; break; }
      if (!hit) { k++; continue; }
      taken.push({ marker: hit, offset: k });
      k += hit.length;
    }
    if (!taken.length) continue;

    const prev = turns[i - 1];
    const next = turns[i + 1];
    const nextText = next ? String(next.text ?? '') : '';

    for (const { marker, offset } of taken) {
      rows.push({
        marker,
        opId: opAt.get(offset) ?? null,      // HINT ONLY — never the key
        position: positionOf(text, offset, marker),
        offset,
        tSec: t.tSec,
        speaker: t.speaker ?? null,
        speakerSource: t.speakerSource ?? 'inferred',
        quote: text,
        before: prev ? String(prev.text ?? '') : '',
        after: nextText,
        // observable uptake, NOT a common-ground claim
        uptake: uptakeOf(t, next),
        contested: nextText ? CONTEST_RE.test(nextText.trim()) : false,
        turnIndex: i,
        source,
      });
    }
  }
  return rows;
}

/**
 * Group rows into concordance ENTRIES — one per marker. This is the shape that
 * becomes a 🔴 catalog entry: the marker is the headword, every row an
 * attestation.
 */
export function groupByMarker(rows) {
  const byMarker = new Map();
  for (const r of rows) {
    let e = byMarker.get(r.marker);
    if (!e) { e = { marker: r.marker, rows: [], opIds: new Map() }; byMarker.set(r.marker, e); }
    e.rows.push(r);
    if (r.opId) e.opIds.set(r.opId, (e.opIds.get(r.opId) ?? 0) + 1);
  }
  return [...byMarker.values()]
    .map((e) => ({ ...e, count: e.rows.length, ...uptakeProfile(e.rows) }))
    .sort((a, b) => b.count - a.count);
}

/**
 * The number a learner actually wants, and the only "analysis" this file does:
 * **when they said this, what came back?** Every term is a count of observable
 * tokens in the next turn — no register, no inference, nothing to be wrong
 * about beyond the tokenizer.
 */
export function uptakeProfile(rows) {
  let accept = 0, ack = 0, contested = 0, silent = 0;
  for (const r of rows) {
    if (r.contested) contested++;
    else if (r.uptake === 'accept') accept++;
    else if (r.uptake === 'ack') ack++;
    else silent++;
  }
  const n = rows.length || 1;
  return {
    uptake: { accept, ack, contested, none: silent },
    // share of occurrences that drew *some* audible response
    responseRate: Number(((accept + ack + contested) / n).toFixed(3)),
  };
}

/**
 * Position profile — how this marker distributes across the turn. The seam fix's
 * real finding, made legible: markers that live clause-medially were invisible
 * to the recognizer for the whole project's history.
 */
export function positionProfile(rows) {
  const p = { final: 0, clausal: 0, medial: 0 };
  for (const r of rows) p[r.position]++;
  return p;
}

/**
 * Rows → attestation-shaped records for `PatternStore` (DESIGN §28 S5: one road
 * in). Everything is `status:'suggested'` — the machine is a recall machine and
 * the hand is the classifier (§28 S3). `matchKind` carries the demoted move
 * hint so it is visible without ever being authoritative.
 */
export function toAttestations(entry, now = 0) {
  return entry.rows.map((r) => ({
    source: r.source?.source ?? 'yt',
    medium: r.source?.medium ?? 'yt',
    file: r.source?.file,
    videoId: r.source?.videoId ?? null,
    tStartSec: r.tSec,
    // A scene is worth carrying whenever EITHER half exists. Gating on
    // `deepLink` alone dropped the 番組名 of every source that has no URL — a
    // Plex episode, a jimaku import, a local podcast — so the one thing that
    // could say "this came from 進撃の巨人 S1E01" was discarded precisely for
    // the media that have no other door back (§28 S2/S6).
    scene: (r.source?.deepLink || r.source?.sourceName)
      ? {
          ...(r.source.deepLink ? { deepLink: r.source.deepLink } : {}),
          ...(r.source.sourceName ? { sourceName: r.source.sourceName } : {}),
        }
      : undefined,
    quote: r.quote,
    addedAt: now,
    status: 'suggested',
    matchKind: `concordance:${r.position}${r.opId ? `:${r.opId}` : ''}`,
    confidence: r.position === 'final' ? 0.9 : r.position === 'clausal' ? 0.75 : 0.5,
  }));
}
