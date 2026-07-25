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

const RESPONSIVE_HEADS = /^(えー|ええ|うん|いや|まあ|あー|は?い|そう|なるほど|だって|でも|ってか|つーか)/;
const INTERACTIONAL_TAIL = /(じゃん|よね|でしょ|っけ|かよ|かな|もんね|わけ|んだよ|のよ|ぞ|ぜ)[？?！!。]?$/;
const SENTENCE_FINAL = /(です|ます|だ|た|ない|よ|ね|わ)[？?！!。]?$/;
const CASE_PARTICLE = /[をがにでへとも]/;
const VERBAL_TAIL = /[うくぐすつぬぶむる]$/;
const SLOT_RE = /[○〇]{2,}/;
const KANA_RE = /^[぀-ヿー]+$/;

/** Structural evidence per class. Scores 0..10-ish; every point has a why. */
export function structuralSignals(noteRaw: string): ClassSignal[] {
  const note = normalizeJapanese(noteRaw).trim();
  const compact = note.replace(/\s+/g, '');
  const out = new Map<NoteClass, ClassSignal>(
    NOTE_CLASSES.map((c) => [c, { cls: c, score: 0, why: [] }]),
  );
  const add = (c: NoteClass, pts: number, why: string): void => {
    const s = out.get(c)!;
    s.score += pts;
    s.why.push(why);
  };

  // notation is the strongest structural evidence (the user's own convention)
  const tildeParts = compact.split(/[〜~]/).filter(Boolean);
  if (tildeParts.length >= 2) add('skeletal', 8, '〜記法（部品リンク）');
  if (SLOT_RE.test(compact)) add('phrase_schema', 8, '○○スロット記法');

  // responsivity / interactional shape → 🔴 (and partly 🟡)
  if (RESPONSIVE_HEADS.test(compact)) add('discourse', 3, '応答的な出だし');
  if (INTERACTIONAL_TAIL.test(compact)) { add('discourse', 2, '対話的な終助詞'); add('serifu', 2, '発話らしい終わり'); }

  // utterance shape → 🟡 serifu
  if (compact.length >= 10 && SENTENCE_FINAL.test(compact)) add('serifu', 3, '文らしい長さ+文末形');
  if (/[。？！?!]/.test(compact)) add('serifu', 2, '文末記号を含む');

  // tight noun+particle+verb, no slots → 🔵 collocation
  if (!SLOT_RE.test(compact) && tildeParts.length < 2 && compact.length >= 3 && compact.length <= 9
      && CASE_PARTICLE.test(compact) && VERBAL_TAIL.test(compact)) {
    add('collocation', 5, '名詞+助詞+動詞の密な形');
  }

  // a bare short lemma (esp. single kanji word / short kana) → 🟢 candidate
  // (the evocation test is human-only; this is only a weak hint)
  if (compact.length <= 4 && !CASE_PARTICLE.test(compact) && !SLOT_RE.test(compact) && tildeParts.length < 2) {
    add('rhet_collocation', 2, '裸のレンマらしい短さ');
    if (!KANA_RE.test(compact)) add('rhet_collocation', 1, '漢字レンマ');
  }

  return [...out.values()];
}

/**
 * Calibrate structural scores with the user's own record:
 *  - priors: how often the user ACTUALLY chooses each class (+ smoothing)
 *  - transfers: when past suggestion X was overridden to Y, future X
 *    evidence partially counts toward Y too
 */
export function suggestClass(note: string, history: HistoryItem[]): ClassSignal[] {
  const structural = structuralSignals(note);

  const chosen = new Map<NoteClass, number>();
  const transfer = new Map<string, number>(); // "X→Y" override counts
  let overridden = 0;
  for (const h of history) {
    chosen.set(h.chosen, (chosen.get(h.chosen) ?? 0) + 1);
    if (h.suggested && h.suggested !== h.chosen) {
      transfer.set(`${h.suggested}→${h.chosen}`, (transfer.get(`${h.suggested}→${h.chosen}`) ?? 0) + 1);
      overridden++;
    }
  }
  const total = history.length;
  const structTop = [...structural].sort((a, b) => b.score - a.score)[0];

  const calibrated = structural.map((s) => {
    const sig: ClassSignal = { cls: s.cls, score: s.score, why: [...s.why] };
    // prior: smoothed user frequency, worth up to ~3 points
    if (total >= 5) {
      const prior = ((chosen.get(s.cls) ?? 0) + 1) / (total + NOTE_CLASSES.length);
      const pts = prior * 3 * NOTE_CLASSES.length;
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

  void overridden;
  return calibrated.sort((a, b) => b.score - a.score);
}
