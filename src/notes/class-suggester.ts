/**
 * class-suggester.ts — the note-type suggester, made real (§21 core). PURE —
 * golden-tested in golden/suggester.mjs.
 *
 * Two layers, both transparent (no opaque model — every score carries WHY):
 *
 *  1. STRUCTURAL evidence — the notation and shape of the note, per class
 *     (the same operational tests the classes are defined by, to the extent
 *     surface shape can hint at them: notation for 🟠/💠, responsivity
 *     markers for 🔴, utterance shape for 🟡, tight noun+particle+verb for
 *     🔵). Structure alone is exactly what the user called laughable, so:
 *  2. CALIBRATION from the user's own record — every capture stores
 *     `classSuggested` vs the chosen class. From that history we learn (a)
 *     the user's real class priors and (b) correction transfers ("when the
 *     machine says X, this user usually means Y"). The suggester keeps
 *     getting better from ordinary use — same suggested-vs-ratified loop as
 *     the sweep and the 🔴 gold store.
 *
 * ## The rule the 2026-08 audit added: history RANKS, it never NOMINATES.
 *
 * The prior used to be added to every class unconditionally, and for a skewed
 * history it reached ~10 points — more than any structural signal. So a span
 * with ZERO structural evidence (English dictionary apparatus, filmed) was
 * preselected as the user's historically most-ratified class, and the catalog
 * skew fed itself. Now the prior is capped and only lands on classes that
 * structure already nominated (score > 0); correction transfers stay ungated
 * because "structure says X, this user means Y" is exactly their job.
 *
 * The suggester also takes EVIDENCE beyond the bare span, because three of the
 * six classes are DEFINED relationally and a string cannot witness a relation:
 * 🔴 needs something to respond to (prior turns), 🟡 needs the span to be an
 * utterance someone produced (not a book's apparatus — `medium: 'dict'` is
 * curated text, so 🔴 is impossible there and 🟡 is weak), and 🔵/🟢 sharpen
 * when a dictionary probe can vouch that the components are real lexemes.
 *
 * The output is a RANKED list of suggestions with reasons; the modal
 * preselects the top one. It is never authority — the user's tap is the
 * classifier, and every override is the next training example.
 */

import type { NoteClass } from './note-types.ts';
import { NOTE_CLASSES } from './note-types.ts';
import { normalizeJapanese } from '../utils/japanese.ts';

export interface ClassSignal {
  cls: NoteClass;
  score: number;
  why: string[];
}

export interface HistoryItem {
  suggested?: NoteClass;
  chosen: NoteClass;
}

/** Everything the caller knows about the span — beyond the span itself. */
export interface ClassEvidence {
  /** the span being classified (the note/notation). */
  note: string;
  /** the full sentence/tweet/turn the span came from, when known. */
  example?: string;
  /** prior turns exist — responsivity (🔴's defining test) has a target. */
  hasPriorTurns?: boolean;
  /** the attestation medium; 'dict' = curated apparatus, nobody's utterance. */
  medium?: string;
  /** optional dictionary probe — "is this a lexeme the dictionaries know". */
  lexeme?: (s: string) => boolean;
}

const RESPONSIVE_HEADS = /^(えー|ええ|うん|いや|まあ|あー|は?い|そう|なるほど|だって|でも|ってか|つーか)/;
const INTERACTIONAL_TAIL = /(じゃん|よね|でしょ|っけ|かよ|かな|もんね|わけ|んだよ|のよ|ぞ|ぜ)[？?！!。]?$/;
const SENTENCE_FINAL = /(です|ます|だ|た|ない|よ|ね|わ)[？?！!。]?$/;
const CASE_PARTICLE = /[をがにでへとも]/;
const VERBAL_TAIL = /[うくぐすつぬぶむる]$/;
const SLOT_RE = /[○〇]{2,}/;
const KANA_RE = /^[぀-ヿー]+$/;
const JAPANESE_RE = /[ぁ-ゖァ-ヶ一-鿿ー]/;

/** Structural evidence per class. Scores 0..10-ish; every point has a why. */
export function structuralSignals(evidence: string | ClassEvidence): ClassSignal[] {
  const ev: ClassEvidence = typeof evidence === 'string' ? { note: evidence } : evidence;
  const note = normalizeJapanese(ev.note ?? '').trim();
  const compact = note.replace(/\s+/g, '');
  const out = new Map<NoteClass, ClassSignal>(
    NOTE_CLASSES.map((c) => [c, { cls: c, score: 0, why: [] }]),
  );
  const add = (c: NoteClass, pts: number, why: string): void => {
    const s = out.get(c)!;
    s.score += pts;
    s.why.push(why);
  };

  // The six classes classify JAPANESE expression. A span with no Japanese
  // script (an English gloss, dictionary apparatus, a bare number) has no
  // structural evidence for ANY class — and with the prior gated on structure,
  // nothing downstream can invent one. This is the guard the filmed
  // 「common divisor,common multiple. → 🔴談話」 misfire walked through.
  if (!JAPANESE_RE.test(compact)) return [...out.values()];

  // notation is the strongest structural evidence (the user's own convention)
  const tildeParts = compact.split(/[〜~]/).filter(Boolean);
  if (tildeParts.length >= 2) add('skeletal', 8, '〜記法（部品リンク）');
  if (SLOT_RE.test(compact)) add('phrase_schema', 8, '○○スロット記法');

  // responsivity / interactional shape → 🔴 (and partly 🟡)
  if (RESPONSIVE_HEADS.test(compact)) add('discourse', 3, '応答的な出だし');
  if (INTERACTIONAL_TAIL.test(compact)) { add('discourse', 2, '対話的な終助詞'); add('serifu', 2, '発話らしい終わり'); }
  // 🔴 is DEFINED by responsivity: with prior turns on record, the relation
  // has a witnessed target rather than an imagined one.
  if (ev.hasPriorTurns && out.get('discourse')!.score > 0) add('discourse', 2, '前の発話に応じる文脈がある');

  // utterance shape → 🟡 serifu
  if (compact.length >= 10 && SENTENCE_FINAL.test(compact)) add('serifu', 3, '文らしい長さ+文末形');
  if (/[。？！?!]/.test(compact)) add('serifu', 2, '文末記号を含む');
  // selecting the WHOLE utterance is itself a serifu gesture — the quote test
  // is about the line, and the hand took the line.
  if (ev.example && compact.length >= 8 && compact === normalizeJapanese(ev.example).trim().replace(/\s+/g, '')) {
    add('serifu', 2, '発話まるごとの選択');
  }

  // tight noun+particle+verb, no slots → 🔵 collocation. The window reaches 14
  // because real captures (外的要因に左右される) are longer than textbook pairs.
  if (!SLOT_RE.test(compact) && tildeParts.length < 2 && compact.length >= 3 && compact.length <= 14
      && CASE_PARTICLE.test(compact) && VERBAL_TAIL.test(compact)) {
    add('collocation', 5, '名詞+助詞+動詞の密な形');
    // when a dictionary can vouch for the components, the combination is a
    // combination OF LEXEMES — the substitution test has real endpoints.
    if (ev.lexeme) {
      const m = /^(.+?)[をがにでへとも](.+)$/.exec(compact);
      if (m && m[1].length >= 2 && m[2].length >= 2 && ev.lexeme(m[1]) && ev.lexeme(m[2])) {
        add('collocation', 3, '両成分とも辞書に載る語');
      }
    }
  }

  // a bare short lemma (esp. single kanji word / short kana) → 🟢 candidate
  // (the evocation test is human-only; this is only a weak hint)
  if (compact.length <= 4 && !CASE_PARTICLE.test(compact) && !SLOT_RE.test(compact) && tildeParts.length < 2) {
    add('rhet_collocation', 2, '裸のレンマらしい短さ');
    if (!KANA_RE.test(compact)) add('rhet_collocation', 1, '漢字レンマ');
    if (ev.lexeme?.(compact)) add('rhet_collocation', 1, '辞書に載る語');
  }

  // Curated text is nobody's utterance: a dictionary cannot respond to a
  // prior turn (🔴 impossible), and its sentences are composed, not overheard
  // (🟡 weak). Stated as whys so the reduction is as transparent as the points.
  if (ev.medium === 'dict') {
    const d = out.get('discourse')!;
    if (d.score > 0) { d.score = 0; d.why = ['辞書由来 — 応答する相手が存在しない']; }
    const s = out.get('serifu')!;
    if (s.score > 0) { s.score = Math.floor(s.score / 2); s.why.push('辞書由来 — 誰かのセリフではない'); }
  }

  return [...out.values()];
}

/** Cap for the calibration prior — it may RANK nominees, never outshout structure. */
const PRIOR_CAP = 2.5;

/**
 * Calibrate structural scores with the user's own record:
 *  - priors: how often the user ACTUALLY chooses each class (+ smoothing) —
 *    applied ONLY to classes structure nominated (score > 0), capped
 *  - transfers: when past suggestion X was overridden to Y, future X
 *    evidence partially counts toward Y too (deliberately ungated: this is
 *    the channel by which the user's corrections beat the machine's shape)
 */
export function suggestClass(evidence: string | ClassEvidence, history: HistoryItem[]): ClassSignal[] {
  const structural = structuralSignals(evidence);

  const chosen = new Map<NoteClass, number>();
  const transfer = new Map<string, number>(); // "X→Y" override counts
  for (const h of history) {
    chosen.set(h.chosen, (chosen.get(h.chosen) ?? 0) + 1);
    if (h.suggested && h.suggested !== h.chosen) {
      transfer.set(`${h.suggested}→${h.chosen}`, (transfer.get(`${h.suggested}→${h.chosen}`) ?? 0) + 1);
    }
  }
  const total = history.length;
  const structTop = [...structural].sort((a, b) => b.score - a.score)[0];

  const calibrated = structural.map((s) => {
    const sig: ClassSignal = { cls: s.cls, score: s.score, why: [...s.why] };
    // prior: smoothed user frequency — only where structure already nominated.
    // History ranks; it never nominates (see header).
    if (total >= 5 && s.score > 0) {
      const prior = ((chosen.get(s.cls) ?? 0) + 1) / (total + NOTE_CLASSES.length);
      const pts = Math.min(PRIOR_CAP, prior * 3 * NOTE_CLASSES.length);
      if (pts > 1) sig.why.push(`あなたの選択傾向 (${chosen.get(s.cls) ?? 0}/${total})`);
      sig.score += pts;
    }
    // transfer: the structural winner often gets overridden to this class
    if (structTop && structTop.score > 0) {
      const t = transfer.get(`${structTop.cls}→${s.cls}`) ?? 0;
      if (t >= 2) {
        const pts = Math.min(4, t);
        sig.score += pts;
        sig.why.push(`過去の訂正: ${structTop.cls}→${s.cls} ×${t}`);
      }
    }
    return sig;
  });

  return calibrated.sort((a, b) => b.score - a.score);
}

/**
 * What "real confidence" means, as a number, once a caller supplied a class.
 *
 * Structure's STRONG reads are the notation ones (8: 〜記法 / ○○スロット) and
 * the dense 名詞+助詞+動詞 shape (5). Its WEAK ones are 1–3 heuristics —
 * "short enough to be a bare lemma", "ends like an utterance".
 */
export const HINT_FLOOR = 4;

/** Where a preselected class came from — rendered as its own why. */
export interface SuggestionChoice {
  cls: NoteClass;
  from: 'structure' | 'hint' | 'derivation';
  /** the weak structural read a hint outranked, when there was one */
  beat?: ClassSignal;
}

/**
 * Which class the capture modal preselects.
 *
 * An explicit caller hint is better evidence than a weak heuristic — a
 * 語法プロフィール row IS a collocation, a sidecar candidate was classed by the
 * book, a tray mark was classed by the hand — and worse evidence than a strong
 * structural read. Without the floor, 「風を」 arriving from the collocation
 * grid was preselected 🟢 on nothing but its length, which is the calibration
 * prior's "nominating out of nothing" failure (§21) one layer up.
 *
 * Pure, so the contract is pinned by golden/suggester.mjs rather than living
 * inside a Modal where nothing can reach it.
 */
export function chooseSuggested(
  ranking: ClassSignal[],
  classHint: NoteClass | undefined,
  derived: NoteClass,
): SuggestionChoice {
  const top = ranking[0];
  const useTop = !!top && (classHint ? top.score >= HINT_FLOOR : top.score > 0);
  if (useTop && top) return { cls: top.cls, from: 'structure' };
  if (classHint) {
    return { cls: classHint, from: 'hint', beat: top && top.score > 0 ? top : undefined };
  }
  return { cls: derived, from: 'derivation' };
}
