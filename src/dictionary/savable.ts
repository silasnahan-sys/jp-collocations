/**
 * savable.ts — WHAT can be taken out of a dictionary entry, and AS WHAT.
 *
 * The third turn of the same screw. §27.4 v1 said a dictionary's identity is
 * which PARTS it has; v2 said which RELATIONS it uses. This says the same thing
 * about capture:
 *
 * > **A save is a typed EDGE, not a tag.**
 *
 * Tagging a selection `連語` records that you noticed something. It does not
 * record WHAT the dictionary told you — that ちと is the old-fashioned way to
 * say ちょっと, that ちょいと is only △ in 「…お待ちください」, that `wait` takes
 * `V＋for＋名`, that 雨が降るのを待つ is a complement clause and 待ち受ける is a
 * compound verb. Those are different facts with different endpoints, and a flat
 * category throws all of them into one bucket.
 *
 * So a capture is (SUBJECT, RELATION, OBJECT?) with the source's own evidence
 * attached — and the RELATION vocabulary is closed, exactly like PART_KINDS and
 * ENTRY_SHAPES, so a new dictionary can add rows but never a private notion.
 *
 * ## What makes it per-dictionary without per-dictionary code
 *
 * `offeredBy()` derives the menu from the STRUCTURE the book supplied. A book
 * with a `members` shape can offer 類語; one with a `comparison` can offer a
 * judgement; one whose examples carry both halves can offer 対訳. Nothing is
 * offered that the source did not assert, so the menu is honest per book and
 * there is still exactly one table (§28 S6).
 *
 * PURE — no Obsidian, no DOM. Golden: golden/savable.mjs.
 */

import type { EntryNode, EntryPart, PartKind, EntryShape } from './entry-parts.ts';

// ── the closed relation vocabulary ───────────────────────────────────────────

/**
 * How a captured thing relates to the headword it came from.
 *
 * Grouped by what KIND of fact each records, because the groups behave
 * differently: a lexical relation needs a second lexical endpoint, an evidence
 * relation needs a sentence, a construction relation needs a slot, and a
 * constraint relation modifies something that already exists.
 */
export const SAVE_RELATIONS = [
  // lexical — subject and object are both words
  '類語', '対義語', '上位語', '下位語', '派生形', '言い換え', '使い分け',
  // evidence — subject is a sentence
  '用例', '実例', '対訳',
  // construction — subject is a pattern the headword enters
  '格フレーム', '連体修飾', '複合動詞', '副詞修飾', '形容詞修飾', '補文',
  '態・授受', '前置詞型', '慣用句', 'コロケーション',
  // constraint — subject qualifies a sense rather than standing alone
  '位相', '産出条件', '文型', '判定',
  // personal
  '注意',
] as const;

export type SaveRelation = (typeof SAVE_RELATIONS)[number];

export interface RelationSpec {
  /** Needs a second lexical endpoint (類語 OF what?). */
  binary: boolean;
  /** One line, in the user's language — the whole teaching of the relation. */
  hint: string;
  /** Which half of a pair the subject is, when direction is meaningful. */
  directed?: boolean;
}

export const RELATION_SPECS: Record<SaveRelation, RelationSpec> = {
  類語: { binary: true, hint: '同じ意味を分け合う語 — どちらを選ぶかは使い分けが決める' },
  対義語: { binary: true, hint: '反対の語（⇔ / ↔ が出典の印）' },
  上位語: { binary: true, hint: 'より広い語（犬→動物）', directed: true },
  下位語: { binary: true, hint: 'より狭い語（動物→犬）', directed: true },
  派生形: { binary: true, hint: '同じ語幹の別品詞（包括→包括的に）', directed: true },
  言い換え: { binary: true, hint: '同じ内容の別の言い方' },
  使い分け: { binary: true, hint: '二語の違いそのもの — 出典の説明を証拠として持つ' },

  用例: { binary: false, hint: '辞書が書いた例文 — その語義の証拠' },
  実例: { binary: false, hint: '実際に使われた文（出典つき）— 証拠として最も強い' },
  対訳: { binary: false, hint: '訳の対 — 英日どちらから引いても同じ対象', directed: true },

  格フレーム: { binary: false, hint: '格助詞の型（〜を待つ / 〜に仕える）— 助詞が関係そのもの' },
  連体修飾: { binary: false, hint: '名詞にかかる節（待っている人）' },
  複合動詞: { binary: false, hint: '動詞＋動詞（待ち受ける）' },
  副詞修飾: { binary: false, hint: '様態・程度の修飾（じっと待つ）' },
  形容詞修飾: { binary: false, hint: '名詞を修飾する形（やや大きめの）' },
  補文: { binary: false, hint: '節を目的語に取る型（雨が降るのを待つ）' },
  '態・授受': { binary: false, hint: '受身・使役・授受（待たれる / 待ってくれる）' },
  前置詞型: { binary: false, hint: '英語の V＋前置詞（wait for）' },
  慣用句: { binary: false, hint: '意味が部分の和にならない型（首を長くして待つ）' },
  コロケーション: { binary: false, hint: '上のどれでもない単なる共起' },

  位相: { binary: false, hint: '誰が・どこで言うか（《口語》《諺》）— 語義にかかる制約' },
  産出条件: { binary: false, hint: 'いつこの語に手を伸ばすか（〔驚き〕）' },
  文型: { binary: false, hint: '共起の型（V＋for＋名）' },
  判定: { binary: false, hint: 'その型に入るかの可否（○ / △ / −）— 出典の判定' },

  注意: { binary: false, hint: '自分が間違えたところ' },
};

/**
 * The collocation relations, in the order a learner would narrow through them.
 *
 * The user's point: "連語" is not one thing. 〜を待つ, 待っている人, 待ち受ける,
 * じっと待つ and 雨が降るのを待つ are five different facts about how 待つ combines,
 * and a single bucket loses the distinction that makes any of them reusable.
 * `コロケーション` is last on purpose — it is the honest fallback when none of
 * the specific relations applies, never the default.
 */
export const COLLOCATION_KINDS: SaveRelation[] = [
  '格フレーム', '補文', '連体修飾', '複合動詞', '副詞修飾', '形容詞修飾',
  '態・授受', '前置詞型', '慣用句', 'コロケーション',
];

// ── what a given selection can become ────────────────────────────────────────

/** Where a selection came from — provenance travels with every capture. */
export interface Selection {
  text: string;
  /** the other half, when the thing selected was a pair. */
  en?: string;
  /** the shape it was sitting in, when it came from the relation tree. */
  shape?: EntryShape;
  /** the part kind, when it came from a sense's parts. */
  kind?: PartKind;
  dictionary?: string;
  headword?: string;
  /** the publisher's own label above it (類語対比表, 使い分け, 例文３件). */
  label?: string;
  /** provenance for an attestation — the work it was quoted from. */
  cite?: string;
}

const LEXICAL = new Set<PartKind>(['gloss', 'alt', 'xref']);

/**
 * Which relations this selection can honestly become.
 *
 * Derived from the STRUCTURE, never from a per-dictionary list: a members set
 * is a synonym set because the book grouped those words under one meaning; a
 * comparison cell is a judgement because the book judged it. A book that
 * asserts none of this offers only the general relations, which is the honest
 * floor rather than a guess.
 */
export function offeredBy(sel: Selection): SaveRelation[] {
  const out: SaveRelation[] = [];
  const add = (...r: SaveRelation[]) => { for (const x of r) if (!out.includes(x)) out.push(x); };

  switch (sel.shape) {
    case 'members':
      // The book put these words in one 語群 — that IS the synonym claim, and
      // 使い分け is the reason to prefer one, so both come from the same place.
      add('類語', '使い分け', '対義語');
      break;
    case 'comparison':
      // A cell is the publisher judging a word against a FRAME, which is the
      // reach-for question itself.
      add('判定', '文型', '格フレーム', '使い分け');
      break;
    case 'distinctions':
      add('使い分け', '類語');
      break;
    case 'derived':
      add('派生形', '言い換え');
      break;
    case 'attestations':
      add('実例', ...COLLOCATION_KINDS);
      break;
    case 'examples':
      add(sel.en ? '対訳' : '用例', '用例', ...COLLOCATION_KINDS);
      break;
    case 'pos-group':
      add('位相', '文型');
      break;
    default:
      break;
  }

  switch (sel.kind) {
    case 'example': add('用例', ...(sel.en ? (['対訳'] as SaveRelation[]) : []), ...COLLOCATION_KINDS); break;
    case 'frame': add('文型', '格フレーム', '前置詞型', '判定'); break;
    case 'context': add('産出条件', '使い分け'); break;
    case 'register': add('位相'); break;
    case 'xref': add('類語', '対義語', '言い換え'); break;
    case 'pos': add('文型'); break;
    default: break;
  }

  if (sel.kind && LEXICAL.has(sel.kind)) add('類語', '対義語', '言い換え');
  // Anything at all can be marked as a thing you got wrong.
  add('注意');
  return out;
}

/**
 * Markers by which a source states a relation OUTRIGHT, so it need not be asked.
 *
 * 類語例解 writes `⇔うんと` inside 関連語 — that is the book saying ちと and うんと
 * are opposites, and throwing it away only to ask the user later would be
 * discarding evidence we already have.
 */
export const RELATION_MARKERS: Array<{ re: RegExp; relation: SaveRelation }> = [
  { re: /^[⇔↔]\s*/, relation: '対義語' },
  { re: /^[⇒→⇨]\s*/, relation: '言い換え' },
  { re: /^[＝=]\s*/, relation: '言い換え' },
  { re: /^[≒〜~]\s*/, relation: '類語' },
];

/** Read a stated relation off a token, if the source marked one. */
export function statedRelation(text: string): { relation: SaveRelation; target: string } | null {
  for (const { re, relation } of RELATION_MARKERS) {
    const m = re.exec(String(text ?? '').trim());
    if (m) {
      const target = String(text).trim().replace(re, '').trim();
      if (target) return { relation, target };
    }
  }
  return null;
}

/** The case particles, and what each one's frame is called when it heads one. */
const CASE_PARTICLES = ['を', 'に', 'が', 'と', 'で', 'へ', 'から', 'まで', 'より'];

/** Tokens that mark a clause standing where a noun would — a complement. */
const COMPLEMENTIZERS = ['のを', 'ことを', 'のが', 'ことが', 'のに', 'ことに', 'のは', 'ことは'];

/**
 * Which collocation relation a surface form actually instantiates.
 *
 * The user's point, and it is the same point as everywhere else here: 連語 is
 * not a category, it is a family of DIFFERENT relations, and lumping them
 * throws away the only thing that makes one reusable. 雨が降るのを待つ and
 * 待っている人 and 待ち受ける and じっと待つ are four different facts about 待つ:
 * a complement clause, an adnominal, a compound verb, a manner modifier.
 *
 * Reads the surface rather than guessing: the particle IS the case frame, the
 * complementizer IS the complement, adjacency of two verb stems IS compounding.
 * Falls through to plain `コロケーション` when the form says none of that, which
 * is the honest floor rather than a coin flip.
 */
export function classifyCollocation(surface: string, headword: string): SaveRelation {
  const s = String(surface ?? '').trim();
  const hw = String(headword ?? '').trim();
  if (!s) return 'コロケーション';

  // English first — a headword followed by a preposition is a different animal.
  if (/^[\x20-\x7e]+$/.test(s)) {
    return /\b(for|to|on|at|in|with|about|of|from|up|out|off|over|after)\b/i.test(s)
      ? '前置詞型' : 'コロケーション';
  }

  const at = hw ? s.indexOf(hw) : -1;
  const before = at > 0 ? s.slice(0, at) : '';
  const after = at >= 0 ? s.slice(at + hw.length) : '';

  // A clause sitting where a noun would sit.
  if (COMPLEMENTIZERS.some((c) => before.endsWith(c))) return '補文';

  // The headword modifying a following noun — 待つ人, 待っている人, やや大きめの品.
  // A Japanese verb ends its dictionary form in the u-row, so that whole row
  // has to count; testing only る/た missed 待つ人 entirely.
  if (after && /^[ぁ-んァ-ヶ]{0,4}[一-鿿]/.test(after)
    && /(?:[うくすつぬぶむるぐずづ]|た|ない|な|の|い)$/.test(before + hw)) {
    return '連体修飾';
  }

  // Voice and benefactive are marked ON the verb, after it.
  if (/^(られ|れ|させ|せ|てもら|てくれ|てあげ|ておく|てしま)/.test(after)) return '態・授受';

  // Two verb stems with nothing between them. The FIRST element must be a
  // 連用形 — an i-row kana or a bare kanji stem — which is exactly what
  // separates 待ち+受ける (compound) from 待つ+人 (adnominal).
  const renyou = /[いきしちにひみりぎじびぢ]$/;
  if (at > 0 && /[一-鿿]$/.test(before) && /^[一-鿿]/.test(hw)) return '複合動詞';
  if (at === 0 && renyou.test(hw) && /^[一-鿿]/.test(after) && /[うくすつぬぶむるぐ]$/.test(after)) {
    return '複合動詞';
  }

  // Manner BEFORE case, because `と` is both the quotative/comitative particle
  // AND the adverbial ending — so じっと待つ was being read as a case frame.
  if (/(っと|り|と|く)$/.test(before) && /^[ぁ-んァ-ヶ]+$/.test(before.replace(/[、。\s]/g, ''))) {
    return '副詞修飾';
  }

  // The particle before the headword IS the case frame — but a case particle
  // attaches to a NOMINAL, so require one rather than any kana run.
  for (const p of CASE_PARTICLES) {
    if (!before.endsWith(p)) continue;
    const head = before.slice(0, -p.length);
    if (/[一-鿿ァ-ヶA-Za-z0-9０-９]$/.test(head) || head.length >= 2) return '格フレーム';
  }
  // An adjectival form attaching to a noun headword.
  if (/(い|な|の)$/.test(before) && /^[一-鿿ァ-ヶ]/.test(hw)) return '形容詞修飾';

  return 'コロケーション';
}

/**
 * A capture, ready to be written into the lexicon.
 *
 * `evidence` is what makes this worth more than a bookmark: the sentence, the
 * judgement, or the 使い分け line the dictionary gave, kept verbatim so the
 * claim can always be traced back to who made it.
 */
export interface TypedCapture {
  relation: SaveRelation;
  subject: string;
  object?: string;
  evidence?: string;
  dictionary?: string;
  headword?: string;
  cite?: string;
}

export function buildCapture(
  sel: Selection, relation: SaveRelation, object?: string,
): TypedCapture {
  return {
    relation,
    subject: sel.text,
    ...(object ? { object } : {}),
    ...(RELATION_SPECS[relation].binary && !object && sel.headword ? { object: sel.headword } : {}),
    ...(sel.en ? { evidence: sel.en } : sel.label ? { evidence: sel.label } : {}),
    ...(sel.dictionary ? { dictionary: sel.dictionary } : {}),
    ...(sel.headword ? { headword: sel.headword } : {}),
    ...(sel.cite ? { cite: sel.cite } : {}),
  };
}
