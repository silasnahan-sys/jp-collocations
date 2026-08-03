/**
 * entry-parts.ts — THE vocabulary of dictionary-entry parts (DESIGN §26.1/§27.1).
 *
 * ## Why this exists
 *
 * 35 dictionaries, each with its own apparatus: 英辞郎 marks a production
 * condition 〔何かが起きるまで〕 and a register 話/英; 新英和大辞典 marks a
 * complement frame 〔for, till, until〕 and registers 《諺》《口語》《米》; the
 * Oxford thesaurus marks 類語訳 and 文型&コロケーション. Rendering each of those
 * with its own layout module gives fidelity and guarantees DRIFT — 35 code paths
 * that must be kept agreeing forever, and that silently diverge between 辞書 and
 * 語彙. Rendering them all through one lowest-common-denominator "definition"
 * string is what produced the 2,967-character paragraph this module replaces.
 *
 * ## The resolution
 *
 * **A dictionary's identity is WHICH parts it has and WHAT IT CALLS them —
 * never HOW they are drawn.**
 *
 *   • fidelity  → lives HERE, as declarative per-dictionary DATA (`PROFILES`).
 *     A profile may only *recognize and label*; it has no ability to draw.
 *   • consistency → lives in `ui/entry-grammar.ts`, the ONE renderer.
 *
 * So 《諺》 shows up exactly as 新英和 writes it and 話 exactly as 英辞郎 writes
 * it — the publisher's own token, verbatim — while both render as the same
 * *kind* of mark, in the same place, in the same color, on every surface. That
 * is §26.0 rule 4 (one grammar everywhere) applied to a shelf of dictionaries
 * instead of to one app, and it is the same trick Monokakido pulls: ACE CROWN
 * and 大辞泉 are different books sharing one typeset system.
 *
 * Adding a dictionary is a row in a table. It is never a new module, so there
 * is nothing for a second module to drift from. `golden/entry-parts.mjs` pins
 * that: every profile emits only known kinds, and no profile can draw.
 *
 * PURE — no Obsidian, no DOM.
 */

import type { DictSense } from './eijiro.ts';

// ── the closed vocabulary ────────────────────────────────────────────────────

/**
 * Every part a dictionary entry can have. CLOSED on purpose: a kind that is not
 * in this list cannot be rendered, which is what stops a profile from inventing
 * a private visual language.
 *
 * The split is semantic, not typographic — `context` and `frame` look different
 * because they ANSWER different questions, not because two books happen to use
 * different brackets:
 *
 *   context  — WHEN you would reach for this (§27.1 production-condition:
 *              〔何かが起きるまで〕). The reach-for index keys on it.
 *   frame    — WHAT it combines with (〔for, till, until〕, 文型&コロケーション).
 *   register — WHO says it and where (話 / 英 / 《諺》 / 《口語》 / 《米》).
 */
export const PART_KINDS = [
  'pron', 'pos', 'level', 'inflect',      // head matter
  'sense',                                 // a sense number/divider
  'context', 'frame', 'register',          // the meaning-discriminating apparatus
  'gloss', 'alt',                          // the definition proper
  'example',                               // an EN/JA pair
  'note', 'xref',                          // supplement ◆ / cross-reference ⇒
] as const;

export type PartKind = (typeof PART_KINDS)[number];

export interface EntryPart {
  kind: PartKind;
  /** the publisher's own token, verbatim — never normalized into "our" wording. */
  text: string;
  /** for `example`: the Japanese half, when the pair could be separated. */
  ja?: string;
  /** for `example`: the source-language half. */
  en?: string;
}

/**
 * The closed vocabulary of SHAPES — v2 of the same idea one level up.
 *
 * `PART_KINDS` answers "what is this token"; a shape answers "what is the
 * RELATION between these things". The distinction was forced by the real books:
 * a flat list of parts cannot hold 類語例解's 類語対比表 (five synonyms judged
 * ○/△/− against four frames), so the whole table — the most valuable thing in
 * the book — was silently dropped at conversion.
 *
 * Read off the export, the same relations recur under DIFFERENT NAMES:
 *
 * | relation    | 類語例解      | Oxford        | ACE CROWN / 新英和      |
 * |-------------|---------------|---------------|-------------------------|
 * | shared      | 共通する意味   | 類語定義       | —                       |
 * | members     | 使い方 `<ul>` | 類語一覧       | —                       |
 * | comparison  | 類語対比表     | 類語スケール    | —                       |
 * | distinction | 使い分け `<ol>`| —             | —                       |
 * | patterned   | —             | 文型M          | 文型[be+名詞], V+with+名 |
 * | section     | div[name]     | details/summary| ▶例文N件                |
 *
 * Two books with no shared vocabulary use the SAME relations. So what varies per
 * book is the NAME; what is shared is the SHAPE. That is the whole anti-drift
 * argument: there is one renderer per SHAPE (about eight), never one per book.
 * Adding a dictionary stays a table row; adding a shape is one renderer that all
 * 35 books gain at once — convergence, not drift. §26.0(4) holds more strongly
 * than under the flat model: a comparison always means "which item fits which
 * frame", in every book, under the publisher's own label.
 */
export const ENTRY_SHAPES = [
  'section',        // a titled container — <details>/<summary>, div[data.name]
  'senses',         // an ordered list of senses, which may nest (a/b/c)
  'pos-group',      // POS/dialect badges GROUPING senses — Jitendex ✱particle,
                    // 新英和 `— n.` / `— vi.`, ACE CROWN `— 助`
  'members',        // a SET of lexical items sharing a meaning (語群)
  'derived',        // morphological derivatives as sub-entries — WISDOM's
                    // 包括的(な)形容詞 / 包括的に副詞 / 包括する動詞, and 子見出し
  'comparison',     // items × frames → judgement (類語対比表, 類語スケール)
  'distinctions',   // ordered contrastive prose (使い分け)
  'examples',       // a group of example pairs, optionally under a pattern
  'attestations',   // ATTESTED corpus citations, keyword-in-context (用例.jp)
  'image',          // the book's own illustration (新英和's lobster plate)
  'prose',          // a definition or note paragraph
] as const;

export type EntryShape = (typeof ENTRY_SHAPES)[number];

/** One lexical item in a `members` set — a synonym, with its own apparatus. */
export interface MemberItem {
  text: string;
  pos?: string;
  gloss?: string;
}

/**
 * A comparison, verbatim from the source.
 *
 * `cols` are the publisher's frames — 類語例解 writes them WITH THE SLOT already
 * in place (「私には…むずかしい」), which is the plugin's own frame notation
 * (`toFrame`/`SLOT_ANY`). `cells[i][j]` is the judgement of `rows[i]` in
 * `cols[j]` (○ / △ / −), kept as the publisher's own token, never normalized
 * into a score.
 */
export interface ComparisonTable {
  cols: string[];
  rows: Array<{ item: string; cells: string[] }>;
}

/**
 * One node of an entry's relation tree.
 *
 * Stored on the headword alongside the flat `senses`, never instead of it: the
 * reach-for index and every existing golden keep reading `senses`, and a view
 * that has not learned a shape yet still has prose to fall back on (§28 S6).
 */
export interface EntryNode {
  shape: EntryShape;
  /** the publisher's OWN title for this node, verbatim (類語対比表 / 類語スケール). */
  label?: string;
  text?: string;
  parts?: EntryPart[];
  items?: MemberItem[];
  table?: ComparisonTable;
  children?: EntryNode[];
  /**
   * The badges the book prints on a `pos-group` or a sense — Jitendex's
   * `particle` / `Kansai` / `archaic` / `masculine`. Registers and word classes
   * both land here as the publisher's own tokens; the renderer decides shape,
   * never this module.
   */
  tags?: string[];
  /**
   * `examples`/`attestations` only. `text` holds the Japanese; `en` the
   * source-language half; `hit` the headword form as it occurs, so a
   * keyword-in-context citation can be shown the way 用例.jp shows it; `cite`
   * the publisher's provenance (Jitendex ships a Tatoeba id).
   */
  en?: string;
  hit?: string;
  cite?: string;
  /**
   * The book's OWN grading of an example. 研究社 新和英 prints `►` for the
   * example that carries the sense and `・` for the ones that merely illustrate
   * it; flattening that away loses the editors' ranking. 0 = primary.
   */
  rank?: number;
  /**
   * `image` only — the media path exactly as the dictionary wrote it
   * (`lobster.avif`). Resolved at render time against the book's own media
   * folder, so a vault that never extracted the images simply shows nothing
   * rather than a broken frame (§28 S6).
   */
  src?: string;
}

/** One sense, as an ordered list of its parts. */
export interface SenseBlock {
  /** 1-based sense number as displayed; absent when the entry has one sense. */
  n?: number;
  parts: EntryPart[];
  /**
   * This entry's tree was flattened at conversion — what looks like one sense is
   * really the whole article as prose. Set so the view can SAY so rather than
   * quietly presenting a wall of text as a definition (§28 S6).
   */
  flat?: boolean;
}

/**
 * Above this, a lone "sense" is not a sense — it is a whole entry that
 * `flattenContent` collapsed into one string at conversion time. Real per-sense
 * glosses in this vault sit at a median of 60–90 characters and a p95 of
 * 300–600; a single 2,967-character one is an artifact, not a definition.
 */
export const FLATTENED_GLOSS_CHARS = 600;

/** Is this stored entry a flattened article rather than a real sense list? */
export function isFlattened(senses: DictSense[]): boolean {
  return senses.length === 1 && String(senses[0]?.gloss ?? '').length > FLATTENED_GLOSS_CHARS;
}

// ── the per-dictionary table (DATA — profiles cannot draw) ───────────────────

/**
 * How ONE dictionary marks its apparatus. Every field is a recognizer: a literal
 * bracket pair or a literal marker token. There is deliberately no hook, no
 * callback and no render option — a profile describes a book, it does not
 * describe a layout.
 */
/**
 * What a node's `data.class` / `data.content` MEANS in one particular book.
 * `skip` drops the node's text entirely (furigana echoes, audio buttons).
 */
export type TreeRole =
  | 'sense' | 'pos' | 'gloss' | 'example' | 'context' | 'frame'
  | 'register' | 'note' | 'xref' | 'headword' | 'skip'
  // head matter — naming it does not yet give it its own field on a sense, but
  // it does LIFT it out of the gloss, which is where 新英和's `/lɑ́(ː)bstɚ/` and
  // its inflection list were sitting.
  | 'pron' | 'inflect'
  /**
   * The two HALVES of an example, named separately by the books that mark them
   * separately — プログレッシブ `enexam`/`jpexam`, ライトハウス `ExEnglish`/`ExJapanese`.
   *
   * A single `example` role concatenates whatever it collects, which is what
   * produced ライトハウス's `…期待するThe farmers are waiting for rain.V＋for＋名 農家の
   * 人たちは…` — gloss, English, pattern and translation in one run. Naming the
   * halves lets them be ZIPPED into pairs instead of glued into prose.
   */
  | 'example-en' | 'example-ja';

/**
 * The conversion-time half of a profile: how this book's structured-content
 * tree is marked up.
 *
 * It lives in the SAME row as the read-time recognizers on purpose — one row
 * per dictionary describing everything about that book, so "adding a
 * dictionary" stays a single table edit and there is never a second place that
 * knows about 新英和. Read off the user's real 11.9GB export, not assumed:
 * 新英和 marks sense depth with `.level2`/`.level3`, the Oxford thesaurus uses
 * explicit Japanese class names (`.類語定義`, `.文型`), Jitendex uses Yomitan's
 * `data.content` roles, and 用例.jp / 大辞林 mark nothing at all.
 */
export interface TreeProfile {
  /** class/content values that BEGIN a new sense. */
  senseAt?: string[];
  /** class/content value → what it means here. */
  roles?: Record<string, TreeRole>;
  /**
   * Marks that open a SUB-sense — 新英和's `a` / `b` / `c` under a numbered
   * sense (`.level3` inside `.level2`), 大辞泉's `L4` under `L3`.
   *
   * Deliberately separate from `senseAt`, which stays listing BOTH levels: the
   * flat `senses[]` should keep every leaf, because that is what the reach-for
   * index and search read. This only tells the RELATION tree where the
   * hierarchy is, so the entry can be typeset the way the book prints it —
   * `1 a … b … c …` — without the flat view losing granularity.
   */
  subSenseAt?: string[];
  /**
   * Last resort, for a book that marks NOTHING structurally: the literal token
   * it uses in the TEXT to separate senses. 明鏡 has no classes at all and
   * writes `\n〘名・自サ変〙…\n「━しきった顔」` — the newline really is the
   * separator, so splitting on it reads the source rather than guessing at it.
   * Applied ONLY when no structural split was found.
   */
  splitText?: RegExp;
  /**
   * A line that HEADS a derived form rather than continuing the entry.
   *
   * Sanseido WISDOM does not organize 包括 by sense at all — it organizes it by
   * DERIVATION: `包括的(な) 形容詞`, then `包括的に 副詞`, then `包括する 動詞`, each
   * with its own gloss and examples. Read as senses they are nine unrelated
   * fragments; read as derived forms they are three sub-entries, which is what
   * the book is actually saying. Capture group 1 is the form, group 2 its POS.
   */
  derivedAt?: RegExp;
  /**
   * The token that opens an EXAMPLE line, and (optionally) the one that opens a
   * lesser example. 研究社 新和英 prints `►` for the example that carries the
   * sense and `・` for the ones that merely illustrate it — the editors' own
   * ranking, which flattening throws away.
   */
  exampleAt?: RegExp;
  /**
   * This book's sentences are ATTESTED — drawn from a corpus — rather than
   * written by its editors.
   *
   * It has to be declared, never inferred: 用例.jp cites 『南回帰線』 and Wikipedia,
   * while NEW斎藤 and ことわざ・慣用句の百科事典 ship editor-written illustrations that
   * look identical in the tree. Guessing promoted authored examples to
   * attestations, which misstates provenance — and evidential strength is the
   * one thing this plugin's example cascade is ordered by (§20.3). Undeclared
   * means `examples`, the honest degrade.
   */
  corpus?: boolean;
  /**
   * The token that opens a PART-OF-SPEECH SECTION in a plain-text book.
   *
   * エースクラウン's Yomitan export is one string with all markup stripped, so its
   * structure survives only typographically: `━ 名（複ties…）` then ❶❷❸❹, then
   * `━ 動（三単現ties…）` and ❶❷❸❹ again. Without this the two runs of ❶ collide
   * and the noun and verb senses read as one confused list. Capture group 1 is
   * the part of speech.
   *
   * (The boxed 文型[be+名詞] headers of the Monokakido app are NOT in this
   * export — the conversion dropped them. Nothing here invents them.)
   */
  posSectionAt?: RegExp;
  /**
   * The token this book prints INSTEAD of repeating the headword.
   *
   * 新明解 writes `━な━に` for 爽快な・爽快に; 大辞泉 writes 「朝の―な気分」. Stored
   * verbatim — that is what the page says, and rewriting it would be editing
   * the source — but the reader should not have to hold the substitution in
   * their head, so the RENDERER expands it in place (§26.1: the mark always
   * means "the headword goes here", one grammar everywhere).
   */
  headwordMark?: RegExp;
  /**
   * Marks whose content is a MEMBER SET written inline — `<a>気持ちよい</a>・
   * <a>快い</a>・…` rather than a `<ul>`.
   *
   * 大辞泉 hangs its 類語 list off `class="C"` with a 補足ロゴ reading 類語, so it
   * is the same relation as Oxford's 類語一覧 in a different wrapper. Unmapped,
   * the whole list was harvested as prose and 爽快's definition ran on for
   * forty synonyms.
   */
  membersAt?: string[];
  /**
   * Marks whose content is a SUB-ENTRY POINTER — a headword this entry sends
   * you to, printed at the foot of the article rather than inside a sense.
   *
   * 新明解 hangs 爽快味 off 爽快 as `<div data-subentries="子項目">子<a>爽快味</a>`.
   * The `子` is the book's label for the relation, not part of the word, so the
   * pointer is read off the LINK — the same signal `membersAt` reads for an
   * inline 語群. Unmapped, the whole div was harvested as prose and became a
   * fourth "sense" of 爽快 reading `子爽快味`, a definition the book never wrote.
   *
   * Deliberately not the `xref` role, which 大辞泉 uses for its own 子見出し:
   * there the pointer sits INSIDE a sense and belongs to it, so `sense.xrefs`
   * is its home. Here it is a sibling of the senses and belongs to the entry.
   */
  subEntryAt?: string[];
  /**
   * A separator that divides senses INSIDE a node the tree already separated.
   *
   * Deliberately not `splitText`: that one is the whole-entry fallback, reached
   * only when the tree produced a single node, and letting it also run per node
   * made a structural split lose to a newline — exactly what `splitSenseNodes`'
   * ordering pins against. 新明解 needs its own knob because its 爽快 block
   * genuinely holds two kanji-numbered senses (`一【壮快】` / `二【爽快】`) inside
   * one structural node.
   */
  splitNodeText?: RegExp;
  /**
   * Named sections that state a WORD-TO-WORD relation in prose.
   *
   * `hasRelation` keeps a section only when something inside it is a shape
   * `senses[]` could not have held — a table, a member set, ordered
   * distinctions. That rule is right for 共通する意味, whose prose the sense list
   * already carries, and wrong for 類語例解's 反対語: the book prints that as one
   * unlinked line (`▼総合⇔分析`) which the sense path never receives either, so
   * the antonym was dropped from the entry ENTIRELY — 痛快's 愉快⇔不愉快・不快 is
   * in neither `senses` nor `nodes` in the shipped shards.
   *
   * Kept verbatim rather than split into members: reading the ⇔ would file
   * 愉快 — the group's own SYNONYM, printed left of the arrow — as an antonym of
   * 痛快, which is wrong structure rather than less of it (§28 S6).
   */
  relationAt?: string[];
}

export interface DictProfile {
  id: string;
  /** matched against the dictionary title as stored in the sidecar meta. */
  match: RegExp;
  /** how this book's structured-content tree is marked (conversion time). */
  tree?: TreeProfile;
  /** bracket pairs carrying a production-CONDITION (§27.1). */
  context?: Array<[string, string]>;
  /** bracket pairs carrying a register/dialect/style label. */
  register?: Array<[string, string]>;
  /** bracket pairs carrying a substitutable alternative — 待ち伏せ[見張り]場所. */
  alt?: Array<[string, string]>;
  /** bracket pairs carrying a complement frame / collocation pattern. */
  frame?: Array<[string, string]>;
  /** literal tokens that introduce example blocks (例文２２件, ▶). */
  exampleMarker?: RegExp;
  /** literal cross-reference markers. */
  xrefMarker?: RegExp;
  /**
   * This book glues an example onto the end of the gloss with NO marker at all
   * (英辞郎 does: `待つ、待機するI have learned to wait. 私は…`). Only set this
   * where it is true of the source — it licenses the one inferred split in this
   * module, and inference is exactly what we are trying to avoid elsewhere.
   */
  gluedLatinExample?: boolean;
  /**
   * This book prints its 用例 as a run of 「…」 CLOSING the definition.
   *
   * The 国語辞典 convention: `十二支の第三。とら。「甲寅・戊寅」`. Where a book marks
   * the block (大辞泉's `ExG`, 三省堂's `用例G`) the converter stores it and this
   * never runs — a stored field always wins. It exists for the books that mark
   * NOTHING: 現代国語例解 and 新選国語 carry no example class at all, and 新明解
   * carries no classes whatsoever, so the quotes are the only signal there is.
   *
   * Measured over the user's own shards before being switched on, because the
   * same brackets quote non-examples everywhere: it fires only on a 「…」 run
   * with nothing after the final 」, which is what leaves 「…」などの形で and
   * 「…」に同じ (a usage note and a cross-reference) inside the definition. It
   * stays per-book for the same reason — ネット用語辞典 prints 237 quotations
   * mid-sentence to 2 trailing, and 擬音語・擬態語辞典 is a citation book whose
   * quotes run across lines.
   */
  quotedExample?: boolean;
  /**
   * Repairs the `話 話遅らせる` artifact in shards converted before the parser
   * kept register apart: 英辞郎 emits the token twice as two classes
   * (`span.label` + `span.register`) and the old converter dropped only one, so
   * the survivor was left glued to the front of the gloss.
   *
   * Safe because it keys on VERBATIM REPETITION — the same short token twice in
   * a row — which is an artifact signature, not a reading of the content. New
   * conversions supply `sense.register` directly and never reach this path.
   */
  leadingDupRegister?: boolean;
}

/**
 * The shelf. Order matters only in that the FIRST match wins, so put specific
 * titles before family patterns.
 *
 * Everything not listed falls through to `GENERIC`, which recognizes only
 * literal, unambiguous brackets — a dictionary we have not profiled yet must
 * degrade to *less* structure, never to WRONG structure (§28 S6).
 */
export const PROFILES: DictProfile[] = [
  {
    id: 'eijiro',
    match: /英辞郎|eijiro/i,
    context: [['〔', '〕']],
    alt: [['[', ']'], ['［', '］']],
    xrefMarker: /^[→⇒]\s*/,
    // 英辞郎's own export has no example markup; see golden/entry-parts.mjs.
    gluedLatinExample: true,
    leadingDupRegister: true,
  },
  {
    id: 'shin-eiwa',
    match: /新英和|研究社\s*新和英|新和英大辞典/,
    // `.level2`/`.level3` ARE the sense hierarchy — the thing whose loss turned
    // `wait` into one 2,967-character paragraph.
    tree: {
      senseAt: ['level2', 'level3'],
      // `lobster` is not six senses: it is 1 with a ロブスター / b イセエビ /
      // c ザリガニ, then 2, 3, 4. The lettering says those three are varieties
      // of ONE thing, which is exactly what flattening destroys.
      subSenseAt: ['level3'],
      roles: {
        level2: 'sense', level3: 'sense', pos: 'pos',
        派生語: 'xref', gaiji: 'skip', audio: 'skip',
        // `num`/`num3` are the PRINTED sense numbers. The view numbers senses
        // itself, so leaving them in produced `1 1 【動物】…` — the same trap
        // プログレッシブ's profile already warns about this; the rule was simply
        // never carried across the rest of the shelf.
        num: 'skip', num3: 'skip', spellout: 'skip', image: 'skip', img: 'skip',
        // and these are the example apparatus, previously glued into the gloss
        用例: 'example', 用例訳: 'example', 用例注: 'note',
        pron: 'pron', inflec: 'inflect', slabel: 'context', glabel: 'register',
      },
    },
    // 〔for, till, until〕 here is a COMPLEMENT FRAME, not a situation — the same
    // bracket doing a different job than in 英辞郎. This is precisely why the
    // mapping is per-dictionary data rather than one global bracket rule.
    frame: [['〔', '〕']],
    register: [['《', '》']],
    alt: [['[', ']'], ['［', '］']],
    exampleMarker: /例文\s*[０-９0-9]+\s*件/,
    xrefMarker: /⇒/,
  },
  {
    id: 'progressive',
    match: /プログレッシブ/,
    // This book names its parts in the data object's KEYS, not in a class:
    // `{"p":"","meaning":""}`, `{"hinshi":""}`, `{"jpexam":""}`. `number` is
    // dropped because the view numbers senses itself — keeping it would print
    // "1 (自) （…を）待つ" with two numbers.
    tree: {
      senseAt: ['meaning'],
      roles: {
        // `enexam` and `excf` were unmapped, so the English half AND the
        // `V＋for＋名` pattern both leaked into the definition. `excf` is a
        // complement FRAME — what the verb combines with — not prose.
        // `example` here is likewise the CONTAINER of enexam/jpexam — left
        // unmapped so it stays transparent and the halves below it are reached.
        // `excf` is NOT the V＋for＋名 pattern — it is a container at the top of
        // the entry, and mapping it to `frame` harvested the WHOLE article into
        // one part. Verified by harvesting the block and finding a single
        // `frame` holding `dis·a·gree /dìsəɡríː/ [動] (自) 1 〈人が〉…`.
        enexam: 'example-en', jpexam: 'example-ja', kumi: 'skip',
        meaning: 'sense', hinshi: 'pos',
        number: 'skip', hatsuon: 'skip', 発音: 'skip', maintitle: 'skip',
        headword: 'headword',
      },
    },
    register: [['《', '》']],
    alt: [['[', ']'], ['［', '］']],
    xrefMarker: /⇒/,
  },
  {
    id: 'lighthouse',
    match: /ライトハウス/,
    // `.L1`/`.L2`/`.L4` are this book's sense levels — the same idea 新英和
    // spells `.level2`. `.red` and `.small` are typographic, so they are left
    // as ordinary text rather than pretending to be semantic.
    tree: {
      senseAt: ['L1', 'L2', 'L4'],
      roles: {
        L1: 'sense', L2: 'sense', L4: 'sense',
        // `L1T`/`L4T` are NOT the part-of-speech label — they are the block the
        // label OPENS, and they run to the end of that block. Read off the real
        // export: `interesting`'s single L1T holds 400 characters — `━━形`, the
        // gloss, `［⇔ dull, uninteresting, boring］` and all five example pairs.
        // Given a role they were consumed whole and never descended into, which
        // deleted every example inside: the book marks 5 EN / 5 JA halves for
        // `interesting` and the harvest saw none, 4 for `disagree` and it saw
        // the 2 that happened to sit under an L4 instead.
        //
        // This is the same lesson as `example` below, and the same fix — an
        // unmapped mark is transparent, which is what a container should be.
        BM: 'skip', FM: 'skip',
        // The book marks its example halves explicitly and none of it was
        // mapped, so `wait` came out as five senses each holding its own
        // English sentence, pattern and translation in one unbroken run.
        // `example` is a WRAPPER around the two halves. Giving it any role at
        // all consumes the block and never descends, which deleted the very
        // sentences this was meant to rescue — leaving the gloss clean and the
        // examples gone. An unmapped mark is transparent, which is what a
        // container should be.
        ExEnglish: 'example-en', ExJapanese: 'example-ja',
        NBracket: 'frame', PronC: 'pron', PronS: 'skip',
        Headword: 'headword', HeadG: 'skip', Hdot: 'skip', rank: 'skip',
        // The boxed コラム panels, which are not definitions and were competing
        // to be them once `L1T` stopped swallowing everything:
        //   Fbox2G   — a two-cell badge holding `!` and `アク`, i.e. ⚠アクセント.
        //              Three characters of UI furniture; there is no honest way
        //              to render "mind the accent" out of it, so it goes rather
        //              than becoming a "sense" of `interesting` reading `!アク`.
        //   ColumnG  — the boxed panel itself. `skip` keeps it out of `senses[]`
        //   ColumnSubG  and `membersAt` lifts the synonym table inside it into a
        //              relation, the same pairing 大辞泉's 類語 list uses.
        Fbox2G: 'skip', ColumnG: 'skip', ColumnSubG: 'skip',
      },
      membersAt: ['ColumnG', 'ColumnSubG'],
    },
    register: [['《', '》']],
    exampleMarker: /例文\s*[０-９0-9]+\s*件/,
    xrefMarker: /⇒/,
  },
  {
    id: 'wisdom',
    match: /WISDOM|ウィズダム/i,
    // A CSV-derived book: no markup at all, newlines as separators, ▸ before
    // each example, and 〖…〗 naming WHICH sense — a production-condition in
    // this book's own notation (§27.1).
    //
    // And it is organized by DERIVATION, not by sense: 包括 is a headword line
    // plus 包括的(な)形容詞 / 包括的に副詞 / 包括する動詞, each with its own gloss
    // and example pair. Nine "senses" was the shape of that mistake.
    tree: {
      splitText: /\n+/,
      derivedAt: /^(.+?)\s+(名詞|動詞|形容詞|形容動詞|副詞|接続詞|感動詞|代名詞|前置詞)$/,
      exampleAt: /^▸\s*/,
    },
    context: [['〖', '〗']],
    alt: [['[', ']']],
    exampleMarker: /▸/,
  },
  {
    id: 'ruigo-reikai',
    // MUST precede `oxford-thesaurus`, which this book matched only because both
    // titles contain 類語 — and then inherited an English thesaurus's typography
    // (《…》 as a register, ▶ as the example marker) for a Japanese book that
    // writes neither. None of Oxford's marks (類語グループ / 類語定義 / 文コロ例)
    // occur here, so the borrowed `tree` did nothing; the read-time brackets did.
    match: /類語例解/,
    // It needs no role table: this book NAMES every part of its own article —
    // `{"name":"共通する意味"}`, 使い方, 使い分け, 類語対比表, 関連語, 反対語 — and
    // `buildNodes` already reads a named div as a section. 5,238 of its
    // 類語対比表 arrive as real comparison grids that way.
    tree: {
      relationAt: ['反対語'],
    },
  },
  {
    id: 'oxford-thesaurus',
    match: /オックスフォード|類語|thesaurus/i,
    // This book names its own apparatus in Japanese, which is as explicit as a
    // source ever gets: 類語定義 is the sense, 類語一覧 the synonym set, 文型 the
    // pattern, 文コロ例 the pattern-and-collocation examples.
    tree: {
      // 類語定義 sits INSIDE 類語グループ, so listing both would never reach it —
      // `splitSenseNodes` does not descend into a node it has already matched.
      senseAt: ['類語グループ'],
      roles: {
        類語グループ: 'sense', 類語定義: 'gloss', 類語和訳: 'gloss',
        類語一覧: 'frame', 文型: 'frame', 文コロ例: 'example',
        類語本文: 'note', headword: 'headword', head: 'skip',
        childhead: 'skip',
        // Read off the real tree: these carry the example pairs and the group
        // translation, and being unmapped is why `shoreline` came back as one
        // 356-char gloss with `例文１件 … ノート …` run together inside it.
        用例: 'example', 用例訳: 'example', example: 'example',
        類語グループ訳: 'gloss', 文型M: 'frame',
      },
    },
    frame: [['文型', '']],
    register: [['《', '》']],
    exampleMarker: /▶/,
  },
  {
    id: 'ace-crown',
    match: /エースクラウン|ACE CROWN/i,
    // The export is ONE plain string — every tag stripped — so the book's
    // structure survives only as typography: `━ 名` / `━ 動` sections, ❶❷❸
    // senses restarting inside each, `■` examples with the translation glued
    // straight onto the English, and ⦅…⦆ labels.
    tree: {
      posSectionAt: /━\s*([^\s（(]{1,4})/,
      exampleAt: /■/,
    },
    register: [['⦅', '⦆']],
    context: [['〔', '〕']],
    alt: [['［', '］']],
    exampleMarker: /■/,
  },
  {
    id: 'youreijp',
    match: /用例\.jp/,
    // Not a dictionary of senses at all: one headword, then N sentences drawn
    // from real texts (『南回帰線』, Wikipedia) with the word marked in place.
    // Stored as senses it became ten 244-character "definitions"; it is a
    // CONCORDANCE, and its citations are the attested tier §20.3 is ordered by.
    tree: { corpus: true },
  },
  {
    id: 'shinmeikai',
    match: /新明解/,
    // Its own row, ahead of `kokugo` — which still names 新明解 in `match` as
    // the fallback should this one ever be removed. The export carries almost
    // no classes at all (`子項目` is the only one), so where 大辞泉 is read by
    // vocabulary this book is read by TYPOGRAPHY.
    //
    // 爽快 stores as `━な━に一【壮快】…二【爽快】…`. Two separate notations:
    //   ━  stands for the HEADWORD (━な = 爽快な, ━に = 爽快に) — kept verbatim
    //      here and expanded at render time, so storage stays faithful;
    //   一 / 二 are the sense numbers, written in kanji. Splitting on a bare
    //      `一` would cut ordinary prose to ribbons, so the split requires the
    //      numeral to be followed by the book's own 【…】 sense head.
    tree: {
      // `skip` keeps the sub-entry out of `senses[]`; `subEntryAt` lifts it into
      // a relation. The same pairing 大辞泉's 類語 list uses (`C` / `membersAt`).
      roles: { 子項目: 'skip' },
      subEntryAt: ['子項目'],
      splitNodeText: /(?=[一二三四五六七八九十]【)/,
      headwordMark: /[━―—]/g,
    },
    register: [['《', '》'], ['〘', '〙']],
    alt: [['［', '］']],
    xrefMarker: /⇒/,
    quotedExample: true,
  },
  {
    id: 'kokugo',
    match: /大辞泉|大辞林|明鏡|新明解|三省堂国語|新選国語|現代国語例解/,
    // Three vocabularies in one row, because these are three books that happen
    // to share a shelf: 大辞泉 numbers senses `.L3`, 大辞林 names them
    // `data.name = 大語義`, 明鏡 第三版 uses `.level0`/`.level1`. They cannot
    // collide, so the shelf still costs one table entry.
    tree: {
      // `L3 bold FM` is the printed sense NUMBER, not a sense. Listing it here
      // is what produced 大辞泉's bare `"1"` and `"2"` senses after the real
      // ones, and left every gloss reading `1 いくらか…` under a `[1]` box.
      senseAt: ['L3', 'L3A', '大語義', '語義', 'level0', 'level1'],
      roles: {
        L3: 'sense', L3A: 'sense', 'L3 bold FM': 'skip',
        // 大辞泉 marks its examples `ExG` — unmapped, so 「―な答え」 sat inside
        // the definition instead of beside it.
        ExG: 'example', 補足ロゴ: 'skip', MAccentM: 'skip', MAccentAudioG: 'skip',
        子項目: 'skip',
        // the 類語 block — lifted whole into a members relation, so it stops
        // running on inside the definition
        C: 'skip',
        // The example GROUP, not just the examples inside it. 三省堂 writes
        // `<div 用例G>「<span 用例>郵便物を━</span>・<span 用例>春のおとずれを━</span>」`
        // — mapping only the inner spans consumed the sentences and left the
        // group's own 「 ・ 」 behind, so every sense ended in an empty
        // 「・・・・」. Consuming the group takes its punctuation with it, which
        // is exactly why 大辞泉's ExG is mapped the same way.
        用例G: 'example',
        大語義: 'sense', 語義: 'sense', 品詞: 'pos', 用例: 'example',
        level0: 'sense', level1: 'sense', 使い方: 'note', 書き方: 'note',
        sanko: 'note', 子見出し: 'xref',
        見出: 'headword', 見出部: 'skip', 見出仮名: 'skip', 表記: 'skip',
        表記G: 'skip', アクセント: 'skip', アクセントG: 'skip', カナ: 'skip',
        audio: 'skip', gaiji: 'skip', furigana: 'skip', meikyo: 'skip',
      },
      membersAt: ['C'],
      // 現代国語例解 hangs 待てば海路の日和あり off 待つ exactly the way 新明解
      // hangs 爽快味 off 爽快 — same mark, same shape, so the same pair of knobs
      // rather than a second reading of it.
      subEntryAt: ['子項目'],
      headwordMark: /[―━]/g,
      // 明鏡 marks nothing; its newlines are the sense boundaries.
      splitText: /\n+/,
    },
    register: [['《', '》'], ['〘', '〙']],
    alt: [['［', '］']],
    xrefMarker: /⇒/,
    quotedExample: true,
  },
];

/** The fallback: literal brackets only, nothing inferred. */
export const GENERIC: DictProfile = {
  id: 'generic',
  match: /.^/,                       // never matches by title; used explicitly
  register: [['《', '》']],
  xrefMarker: /⇒/,
};

export function profileFor(dictionary: string): DictProfile {
  return PROFILES.find((p) => p.match.test(String(dictionary ?? ''))) ?? GENERIC;
}

// ── parsing ──────────────────────────────────────────────────────────────────

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A run of 「…」 that CLOSES a definition — see `quotedExample`.
 *
 * Anchored at the end on purpose. Anything following the final 」 means the
 * quotation is being talked ABOUT rather than shown, which is the whole
 * difference between 「合格発表を待つ」 (an example) and 「…に俟つ」の形で (a note).
 */
const TRAILING_QUOTES = /(?:\s*「[^「」]*」)+\s*$/;

/** Pull every `open…close` span out of `text`, returning the rest and the hits. */
function takeBrackets(
  text: string, pairs: Array<[string, string]> | undefined,
): { rest: string; found: string[] } {
  if (!pairs?.length) return { rest: text, found: [] };
  let rest = text;
  const found: string[] = [];
  for (const [open, close] of pairs) {
    if (!open) continue;
    // An empty close means "a bare marker word", e.g. 文型 — take the token only.
    const re = close
      ? new RegExp(`${esc(open)}([^${esc(close)}]*)${esc(close)}`, 'g')
      : new RegExp(`${esc(open)}`, 'g');
    rest = rest.replace(re, (_m, inner) => {
      const t = String(inner ?? open).trim();
      if (t) found.push(t);
      return ' ';
    });
  }
  return { rest, found };
}

/**
 * Split a glued `gloss + example` (英辞郎's shape) at the first point where a
 * Latin-script SENTENCE begins after Japanese text.
 *
 * This is the ONE inferred split in the module and it is deliberately narrow:
 * it fires only on a capital letter that follows a Japanese character, and only
 * when the tail actually looks like a sentence (it ends in . ! ? or contains a
 * Japanese translation after the Latin run). A gloss like `IT技術` or an
 * embedded acronym must NOT trigger it, which is what the tests pin.
 *
 * ONE implementation, used both when converting (so new shards store the halves
 * separately) and when reading legacy shards that already glued them — two call
 * sites of one function, rather than two functions that will disagree.
 */
export function splitGluedExample(text: string): { gloss: string; example?: string } {
  const s = String(text ?? '');
  // a Japanese char, then an uppercase Latin letter or a quote starting a sentence
  const m = /[ぁ-んァ-ヶ一-龯、。）】〕」]([A-Z"'“(])/.exec(s);
  if (!m || m.index < 1) return { gloss: s.trim() };
  const cut = m.index + 1;
  const head = s.slice(0, cut).trim();
  const tail = s.slice(cut).trim();
  // The tail must read as a sentence, not as an acronym glued to a noun.
  const sentence = /[.!?]/.test(tail) && /\s/.test(tail);
  if (!head || !tail || !sentence) return { gloss: s.trim() };
  return { gloss: head, example: tail };
}

/**
 * Split one example run into its source-language and Japanese halves.
 * Returns the whole thing as `en` when no Japanese follows — an example we
 * cannot split is still an example, and mislabelling it would be worse.
 */
export function splitExamplePair(text: string): { en?: string; ja?: string } {
  const s = String(text ?? '').trim();
  if (!s) return {};
  const m = /^([^ぁ-んァ-ヶ一-龯]*[.!?])\s*([\s\S]*[ぁ-んァ-ヶ一-龯][\s\S]*)$/.exec(s);
  if (!m) return /[ぁ-んァ-ヶ一-龯]/.test(s) ? { ja: s } : { en: s };
  return { en: m[1].trim(), ja: m[2].trim() };
}

/**
 * One stored `DictSense` → its ordered parts, according to the book's profile.
 *
 * Order is semantic and fixed for every dictionary — register, then context,
 * then frame, then the gloss, then examples, then notes and xrefs. That fixed
 * order is half of "one grammar everywhere": the eye learns where to look once.
 */
export function partsOfSense(sense: DictSense, profile: DictProfile): EntryPart[] {
  const parts: EntryPart[] = [];
  const push = (kind: PartKind, text: string): void => {
    const t = text.trim();
    if (t) parts.push({ kind, text: t });
  };

  if (sense.pos) push('pos', sense.pos);

  let body = String(sense.gloss ?? '');

  // xref-only stubs read as a cross-reference, not as an empty definition.
  if (profile.xrefMarker) {
    const xm = profile.xrefMarker.exec(body);
    if (xm && xm.index === 0) {
      push('xref', body.replace(profile.xrefMarker, ''));
      body = '';
    }
  }

  // Legacy-shard repair, before any other reading of the gloss.
  let dupRegister: string | undefined;
  if (profile.leadingDupRegister && !sense.register) {
    const m = /^\s*(\S{1,3})\s+\1(?=\S|\s|$)/.exec(body);
    if (m) { dupRegister = m[1]; body = body.slice(m[0].length); }
  }

  const reg = takeBrackets(body, profile.register); body = reg.rest;
  const ctx = takeBrackets(body, profile.context);  body = ctx.rest;
  const frm = takeBrackets(body, profile.frame);    body = frm.rest;

  // A field the converter stored is ALWAYS preferred over one recovered from
  // the gloss text: same part, but known rather than inferred. The recovery
  // path exists only for shards written before the converter kept them apart,
  // so a re-conversion silently upgrades every entry with no display change.
  if (sense.register) push('register', sense.register);
  else if (dupRegister) push('register', dupRegister);
  else for (const r of reg.found) push('register', r);

  if (sense.situation) push('context', sense.situation);
  for (const c of ctx.found) push('context', c);
  for (const f of frm.found) push('frame', f);

  // examples: the stored field, else the explicit marker, else glued-Latin
  let examples: string[] = [];
  if (sense.example) {
    examples = [sense.example];
  } else if (profile.exampleMarker) {
    const parts2 = body.split(profile.exampleMarker);
    if (parts2.length > 1) { body = parts2[0]; examples = parts2.slice(1); }
  }
  if (!examples.length && profile.gluedLatinExample) {
    const { gloss, example } = splitGluedExample(body);
    body = gloss;
    if (example) examples = [example];
  }
  if (!examples.length && profile.quotedExample) {
    const q = TRAILING_QUOTES.exec(body);
    // Only when a definition is left standing in front of it — a gloss that is
    // nothing BUT a quotation is a citation entry, not a definition plus its
    // example, and emptying it would leave the sense with no text at all.
    if (q && body.slice(0, q.index).trim()) {
      examples = [q[0].trim()];
      body = body.slice(0, q.index).trim();
    }
  }

  const alt = takeBrackets(body, profile.alt); body = alt.rest;
  push('gloss', body.replace(/\s{2,}/g, ' '));
  for (const a of alt.found) push('alt', a);

  for (const ex of examples) {
    const { en, ja } = splitExamplePair(ex);
    const text = [en, ja].filter(Boolean).join(' ');
    if (text) parts.push({ kind: 'example', text, ...(en ? { en } : {}), ...(ja ? { ja } : {}) });
  }

  if (sense.note) push('note', sense.note);
  for (const x of sense.xrefs ?? []) push('xref', x);
  return parts;
}

/** A whole stored entry → its senses, as parts. */
export function partsOfEntry(
  entry: { senses: DictSense[]; xrefs?: string[] },
  dictionary: string,
): SenseBlock[] {
  const profile = profileFor(dictionary);
  const senses = entry.senses ?? [];

  // A flattened article must NOT be mined for apparatus. Every 《register》 in
  // those 2,967 characters belongs to some sense buried inside it, so hoisting
  // them to the top attaches 《諺》《米》《口語》 to the whole entry — a claim the
  // source never made. Wrong structure is worse than none (§28 S6), so this
  // degrades to honest prose and says why.
  if (isFlattened(senses)) {
    const gloss = String(senses[0].gloss ?? '').trim();
    return [{ flat: true, parts: gloss ? [{ kind: 'gloss', text: gloss }] : [] }];
  }

  const multi = senses.length > 1;
  return senses.map((s, i) => ({
    ...(multi ? { n: i + 1 } : {}),
    parts: partsOfSense(s, profile),
  }));
}
