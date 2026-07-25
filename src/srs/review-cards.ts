/**
 * review-cards.ts — PURE builder of class-shaped review cards from catalog
 * patterns (the P4 drill semantics, applied to the pattern as the card unit).
 *
 * Each of the six classes trains its defining skill:
 *   🟡 serifu        聴解 — audio-first when a clip exists; recall the line
 *   🔵 collocation   連語想起 — recall the word bond inside its real sentence
 *   🟢 rhet-coll     表現産出 — produce the evocative expression for the scene
 *   💠 phrase-schema 型産出 — produce the whole frame
 *   🟠 skeletal      空所補充 — first link component shown, produce its mate
 *   🔴 discourse     応答産出 — prior turn shown, produce the response
 *
 * No Obsidian imports; the ReviewView renders the returned structure and
 * resolves audio itself. Golden-tested (golden/srs.mjs).
 */

import type { PatternEntry, Attestation } from '../notes/pattern-store.ts';
import { sweepTerms } from '../notes/pattern-store.ts';
import type { NoteClass } from '../notes/note-types.ts';
import type { GoldExample } from '../notes/discourse-gold.ts';

export const DRILL: Record<NoteClass, string> = {
  serifu: '聴解',
  collocation: '連語想起',
  rhet_collocation: '表現産出',
  phrase_schema: '型産出',
  skeletal: '空所補充',
  discourse: '応答産出',
};

export interface ReviewCard {
  patternId: string;
  cls: NoteClass;
  drill: string;
  /** the question side, top to bottom. */
  frontLines: string[];
  /** what the learner must produce. */
  answer: string;
  /** the answer side (answer first, then evidence). */
  backLines: string[];
  /** the attestation the card is built on (audio/jump resolution). */
  att: Attestation | null;
  /** 🟡 with a resolvable clip should play audio BEFORE showing text. */
  wantsAudio: boolean;
}

const BLANK = '【＿＿＿】';

/** Prefer hand-anchored yt (has clip potential), then any yt, then x, then rest. */
export function pickAttestation(p: PatternEntry): Attestation | null {
  const rank = (a: Attestation): number =>
    a.source === 'yt' && a.anchorId ? 0 : a.source === 'yt' ? 1 : a.source === 'x' ? 2 : 3;
  // confirmed only — an unratified sweep candidate must never become card material
  const sane = p.attestations.filter((a) => !a.status && a.quote && a.quote.trim().length >= 2);
  if (!sane.length) return null;
  return [...sane].sort((a, b) => rank(a) - rank(b) || b.quote.length - a.quote.length)[0];
}

/** Hide every occurrence of the terms in the text (longest term first). */
export function cloze(text: string, terms: string[]): string {
  let out = text;
  for (const t of [...terms].filter(Boolean).sort((a, b) => b.length - a.length)) {
    out = out.split(t).join(BLANK);
  }
  return out;
}

const softHint = (answer: string): string =>
  `ヒント: 「${answer.slice(0, 1)}…」（${answer.length}字）`;

const trimQuote = (q: string): string => (q.length > 140 ? q.slice(0, 140) + '…' : q);

/**
 * Build the review card for a pattern. `gold` (the pattern's discourse gold
 * example, if one exists) upgrades 🔴 cards to real prior-turn prompts.
 */
export function buildReviewCard(p: PatternEntry, gold?: GoldExample | null): ReviewCard {
  const att = pickAttestation(p);
  const quote = att ? trimQuote(att.quote) : '';
  const terms = sweepTerms(p).length ? sweepTerms(p) : [p.key];
  const front: string[] = [];
  const back: string[] = [];
  let answer = p.key;
  let wantsAudio = false;

  switch (p.class) {
    case 'serifu': {
      wantsAudio = !!(att && att.source === 'yt' && att.tStartSec != null);
      answer = p.key;
      if (quote && quote !== p.key) front.push(cloze(quote, [p.key]));
      else front.push('🎧 このセリフを聞き取って思い出す');
      front.push(softHint(answer));
      back.push(answer);
      if (quote && quote !== p.key) back.push(quote);
      break;
    }
    case 'skeletal': {
      const parts = p.payload.parts ?? [];
      answer = parts.slice(1).join(' 〜 ') || p.key;
      if (parts.length >= 2) {
        if (quote) front.push(cloze(quote, parts.slice(1)));
        front.push(`${parts[0]} 〜 ${BLANK}`);
        back.push(parts.map((x) => `**${x}**`).join(' 〜 '));
      } else {
        front.push(quote ? cloze(quote, terms) : BLANK);
        back.push(answer);
      }
      if (quote) back.push(quote);
      break;
    }
    case 'phrase_schema': {
      const frame = p.payload.frame ?? p.key;
      answer = frame;
      if (quote) front.push(cloze(quote, terms));
      front.push('この場面で言われた「型」（丸ごとの言い回し）は？');
      front.push(softHint(frame));
      back.push(frame);
      if (quote) back.push(quote);
      break;
    }
    case 'rhet_collocation': {
      const lemma = p.payload.lemma ?? p.key;
      answer = lemma;
      if (quote) front.push(cloze(quote, [lemma]));
      front.push('この場面を演じる（像を喚起する）表現は？');
      if (p.payload.halo) front.push(`ハロー: ${p.payload.halo}`);
      front.push(softHint(lemma));
      back.push(lemma + (p.payload.halo ? `（${p.payload.halo}）` : ''));
      if (quote) back.push(quote);
      break;
    }
    case 'discourse': {
      answer = gold?.utterance ?? p.key;
      const prior = gold?.contextBefore?.length ? gold.contextBefore[gold.contextBefore.length - 1] : null;
      if (prior) {
        front.push(`相手: 「${trimQuote(prior)}」`);
        front.push(`→ どう応じた？ ${BLANK}`);
      } else {
        front.push(quote ? cloze(quote, terms) : BLANK);
        front.push('この談話ムーブを再現する');
      }
      back.push(answer);
      if (gold?.act) back.push(`ムーブ: ${gold.act}` + (gold.edge ? `（${gold.edge.kind} → −${gold.edge.toOffset}）` : ''));
      if (gold?.contextAfter?.length) back.push(`続き: ${gold.contextAfter.join(' / ')}`);
      break;
    }
    default: { // collocation
      answer = p.key;
      front.push(quote ? cloze(quote, terms) : BLANK);
      front.push(softHint(answer));
      back.push(answer);
      if (quote) back.push(quote);
    }
  }

  if (p.payload.gloss) back.push(`⟶ ${p.payload.gloss}`);

  return {
    patternId: p.id,
    cls: p.class,
    drill: DRILL[p.class],
    frontLines: front,
    answer,
    backLines: back,
    att,
    wantsAudio,
  };
}

/** A pattern is reviewable when a card can be built with real material. */
export function isReviewable(p: PatternEntry): boolean {
  if (p.class === 'skeletal' && (p.payload.parts?.length ?? 0) >= 2) return true;
  return pickAttestation(p) != null;
}
