/**
 * goho.ts — normalize a corpus scrape into the 語法プロフィール an entry
 * caches (DESIGN §22.7). PURE — golden-tested in golden/goho.mjs.
 *
 * The profile is fetched ONCE per entry and frozen in `payload.goho`
 * (invariant §2.4 — a later site change cannot alter past entries); its
 * examples are capturable as `corpus`-stratum attestations through the
 * normal spine.
 */

import type { CollocationEntry } from '../types.ts';
import { normalizeJapanese } from '../utils/japanese.ts';

/**
 * One way the word attaches, with what attaches that way.
 *
 * THIS is the part a flat `collocates: string[]` could not hold, and it is the
 * whole point of a collocational profile: 「風が吹く」 and 「そよ風」 and
 * 「風のように」 are not twelve interchangeable strings, they are the word
 * behaving differently in three grammatical positions. NINJAL-LWP's value is
 * exactly this view; Hyogen states the same facts in `col_midasi1` and its
 * 絞込み links, and the old model dropped all of it on the floor.
 */
export interface GohoFrame {
  /** 名詞 / 動詞 / 形容詞 … — the POS section this behaviour sits under. */
  pos: string;
  /** 'head-initial' 風～ | 'head-final' ～風 | 'compound' 複合 */
  direction: string;
  /** the source's own sense number, when it distinguishes senses. */
  sense?: number;
  /** the head line verbatim (「～ 風[名詞]2」) — displayed, never re-derived. */
  label: string;
  /** `H007` — which index row this frame drilled, when the source has ids. */
  patternId?: string;
  /** the index category this pattern sits under ('' when unmeasured). */
  category?: string;
  /** examples of THIS behaviour, full phrases, verbatim. */
  items: string[];
  /** how many the source actually has, when more than `items` holds (§28 S6:
   *  a truncated list must never read as a total). */
  total: number;
  /** `total` is a FLOOR, not a count — the source had more than it handed over.
   *  A corpus answers "the first 100 of ?" as readily as "all 9 of 9", and the
   *  two must not render identically. */
  atLeast?: boolean;
  /** corpus occurrences of this whole way-of-attaching, when the source counts
   *  them. Hyogen does not; NINJAL-LWP does. */
  freq?: number;
  /** percent of the headword's occurrences that take this shape (0–100). This is
   *  the number that turns a list of behaviours into a profile: 風＋助詞 at 88%
   *  and 名詞＋の＋風 at 5% are not two equal facts. */
  share?: number;
  /** the same items carrying their association measures, when the source has
   *  them. Parallel to `items`, never instead of it — every existing consumer
   *  keeps reading `items` unchanged (§28 S1). */
  measured?: GohoMeasured[];
}

/**
 * One collocate with the numbers that say whether it is worth learning.
 *
 * Raw frequency alone cannot distinguish 「風を」 (common because を is common)
 * from 「クーラーの風」 (rare, but the pairing is the point). MI and logDice can,
 * which is the whole reason to consult NINJAL-LWP rather than a word list.
 */
export interface GohoMeasured {
  text: string;
  /** occurrences of this pairing in the corpus. */
  freq: number;
  /** mutual information — high means selective. */
  mi: number;
  /** logDice — bounded and comparable across corpora, unlike raw MI. */
  logDice: number;
  /**
   * The source's own id for this collocation (`H007.00001`), when it has one.
   *
   * Declared because it is genuinely stored: it is what joins an example batch
   * back to the pairing it attests, and that join cannot be done on the text —
   * TWC's grid is lemmatised while its sentences are surface. A field that
   * survives the freeze and is not in the type is drift waiting to happen.
   */
  id?: string;
}

/**
 * An attested sentence that knows where it came from.
 *
 * §28 S2 is "provenance is never dropped", and a bare `examples: string[]`
 * drops it by construction — a captured corpus example ended up sourced to the
 * literal word "corpus". A source that hands over the document and its URL
 * (NINJAL-LWP does, per sentence) should not have that thrown away on the way
 * into the freeze.
 */
export interface GohoExample {
  text: string;
  /** the document title. */
  source?: string;
  /** the page it came from — what makes the citation checkable. */
  url?: string;
  /** [start, end) offsets of the collocation inside `text`, from the source. */
  span?: [number, number];
  /** the source's own reference key, for citation. */
  ref?: string;
  /**
   * What KIND of evidence this sentence is. The two are not interchangeable and
   * must not render identically (§28 S3 — same affordance means same claim):
   *
   * - `attested` — somebody wrote this, in a document the source names and links.
   *   NINJAL-LWP hands over the title AND url per sentence, so the citation is
   *   checkable and the sentence can become a `corpus`-stratum attestation.
   * - `phrase` — the source lists this as a collocation phrase of its own
   *   compiling (Hyogen's 青空文庫-derived items). It is evidence that the
   *   pairing occurs, not a citation of one occurrence: there is no document
   *   behind THIS string, only the word page it was listed on.
   *
   * Absent on profiles frozen before this existed — treat as `attested` only
   * when a `url` is present, and as `phrase` otherwise.
   */
  kind?: 'attested' | 'phrase';
  /** the way-of-attaching (`GohoFrame.label`) this sentence is evidence FOR. */
  frame?: string;
  /**
   * The collocate it attests, when the source ties the sentence to one.
   *
   * Recorded because it CANNOT be recovered by matching later: TWC's collocate
   * list is lemmatised and its sentences are surface, so 「子供の風」 is attested
   * as 「子どものかぜ」 and any string join between the two returns nothing.
   * This is known at fetch time — we asked the corpus for this pairing — so it
   * is carried rather than re-derived.
   */
  collocate?: string;
}

/**
 * One row of the profile's INDEX: a way the word attaches, whether or not its
 * collocations have been fetched yet.
 *
 * This is the left-hand panel of NINJAL-LWP's own 語彙プロファイル, and its
 * absence was the biggest thing separating this box from the site. 風 has 20
 * patterns across 7 categories; the profile kept the top six by frequency and
 * the rest — 助詞＋形容詞, 助動詞, 接頭辞・接尾辞, 動詞連用形＋風 — did not get
 * truncated with a count, they vanished. A profile that silently drops whole
 * grammatical categories is not a profile of the word.
 *
 * The index is cheap: `/patternfreqorder/` returns every pattern in ONE
 * request. Fetching it whole and drilling on demand is strictly better than
 * guessing which six matter.
 */
export interface GohoPattern {
  /** `H007` — keys the collocation endpoint, and matches `GohoFrame.patternId`. */
  id: string;
  /** 「風＋助詞」「名詞＋の＋風」 — the grammar, verbatim. */
  name: string;
  /** the site's own grouping. '' when the id prefix has not been measured. */
  category: string;
  freq: number;
  /** percent of the headword's occurrences. */
  share: number;
}

export interface GohoProfile {
  fetchedAt: number;
  source: string;
  /** co-occurring phrases/collocates, the key itself excluded. */
  collocates: string[];
  /** real corpus example sentences, deduped. */
  examples: string[];
  /** the same sentences carrying their provenance, when the source supplies it.
   *  Parallel to `examples`, never instead of it (§28 S1). */
  sourced?: GohoExample[];
  /**
   * EVERY way the word attaches, whether drilled or not — the complete
   * enumeration, so nothing is dropped without being counted.
   *
   * `frames` is the subset that has actually been fetched. An index row with no
   * matching frame is a real, named, ranked way of attaching that you have not
   * opened yet — a hole with a label on it, not a gap in the data.
   */
  index?: GohoPattern[];
  /** the ways whose collocations have been fetched. Keyed to `index` by
   *  `GohoFrame.patternId`. */
  frames?: GohoFrame[];
  /** particle facets the source offers (の～ / は～ / が～ / を～) with their URLs,
   *  so the profile can say "there are 12,147 more of these, here". */
  facets?: Array<{ label: string; url: string }>;
  /** total attestations the source holds for this word, across all frames. */
  sourceTotal?: number;
}

const norm = (s: string): string => normalizeJapanese(s).replace(/\s+/g, '');

export function normalizeProfile(
  entries: CollocationEntry[],
  key: string,
  source: string,
  now: number,
): GohoProfile {
  const nKey = norm(key);
  const collocates: string[] = [];
  const seenC = new Set<string>();
  const examples: string[] = [];
  const seenE = new Set<string>();

  for (const e of entries) {
    for (const cand of [e.fullPhrase, e.collocate]) {
      const t = (cand ?? '').trim();
      const n = norm(t);
      if (!t || !n || n === nKey || seenC.has(n) || t.length > 20) continue;
      seenC.add(n);
      collocates.push(t);
    }
    for (const ex of e.exampleSentences ?? []) {
      const t = ex.trim();
      const n = norm(t);
      if (t.length < 6 || t.length > 120 || seenE.has(n)) continue;
      seenE.add(n);
      examples.push(t);
    }
  }

  return {
    fetchedAt: now,
    source,
    collocates: collocates.slice(0, 12),
    examples: examples.slice(0, 8),
  };
}

/** Per-frame item cap. A Hyogen word can carry 12,147 items in ONE frame; the
 *  profile is frozen into the plugin blob, so the whole list is not storable and
 *  would not be readable if it were. `total` keeps the truncation honest and the
 *  facet URL keeps the rest reachable. */
export const FRAME_ITEMS = 24;
/** Frames kept, most-attested first. */
export const MAX_FRAMES = 6;
/** Example sentences kept per profile, across all frames. */
export const MAX_EXAMPLES = 8;

/**
 * Fold a structured source profile into the frozen `payload.goho`.
 *
 * Kept separate from `normalizeProfile` (which flattens `CollocationEntry[]`
 * from any adapter) because the structure is the thing worth having: this is
 * the function that decides what survives the freeze, and it deliberately keeps
 * the GRAMMAR (frame, direction, sense, facets) over raw volume.
 */
export function profileFromFrames(
  input: {
    frames: Array<{
      pos: string; direction: string; sense?: number; label: string; items: string[];
      freq?: number; share?: number; measured?: GohoMeasured[]; total?: number;
      patternId?: string; category?: string;
      /** false when the source had more than it returned. */
      complete?: boolean;
    }>;
    /** the complete enumeration of ways-of-attaching, drilled or not. */
    index?: GohoPattern[];
    facets?: Array<{ label: string; url: string }>;
    total?: number;
    /** attested sentences with provenance. When a source supplies these, they
     *  are the real examples and the collocate-derived fallback is not used. */
    examples?: GohoExample[];
  },
  key: string,
  source: string,
  now: number,
): GohoProfile {
  const nKey = norm(key);
  const frames: GohoFrame[] = [...input.frames]
    // Corpus frequency ranks the ways of attaching when the source counts them;
    // a source that does not (Hyogen) falls back to how much it holds, which is
    // the behaviour this function has always had.
    .sort((a, b) => (b.freq ?? 0) - (a.freq ?? 0) || b.items.length - a.items.length)
    .slice(0, MAX_FRAMES)
    .map((f) => ({
      pos: f.pos, direction: f.direction, label: f.label,
      ...(f.patternId ? { patternId: f.patternId } : {}),
      ...(f.category ? { category: f.category } : {}),
      ...(f.sense !== undefined ? { sense: f.sense } : {}),
      items: f.items.slice(0, FRAME_ITEMS),
      // A source may know its true total exceeds what it handed us; only fall
      // back to counting when it does not say (§28 S6).
      total: f.total ?? f.items.length,
      /**
       * The total is a FLOOR only when the source never stated one.
       *
       * This used to be "the source was truncated", which conflated two
       * different facts. Since `records` arrived, TWC states an exact 種類 count
       * (「のを… 3,868種類」) even on a truncated fetch, so "24 / 3,868件" is a
       * true sentence and rendering it as "3,868+件" would hedge a number the
       * corpus was certain about. The '+' now appears only where the count
       * really is just "how many we happened to receive".
       */
      ...(f.complete === false && f.total === undefined ? { atLeast: true } : {}),
      ...(f.freq !== undefined ? { freq: f.freq } : {}),
      ...(f.share !== undefined ? { share: f.share } : {}),
      // Copied field-by-field rather than passed through: an adapter's row type
      // may carry more than the frozen shape declares, and the freeze is
      // permanent (§2.4) — whatever lands here is what a reader gets forever.
      ...(f.measured?.length ? {
        measured: f.measured.slice(0, FRAME_ITEMS).map((m) => ({
          text: m.text, freq: m.freq, mi: m.mi, logDice: m.logDice,
          ...(m.id ? { id: m.id } : {}),
        })),
      } : {}),
    }));

  // The flat collocate view stays populated so every existing consumer keeps
  // working — this is additive, not a replacement (§28 S1: one object,
  // re-rendered).
  const collocates: string[] = [];
  const seenC = new Set<string>();
  for (const f of frames) {
    for (const it of f.items) {
      const n = norm(it);
      if (!n || n === nKey) continue;
      if (it.length <= 20 && !seenC.has(n)) { seenC.add(n); collocates.push(it); }
    }
  }

  /**
   * Examples come from `input.examples` or they do not exist.
   *
   * They used to also be MANUFACTURED here, by re-reading the frame items and
   * keeping every one between 6 and 120 characters. That is not a weaker source
   * of examples, it is a different thing wearing the label: 「走っている」 is a
   * collocate that happens to be long, and it was rendered in the 用例 row with
   * the 用例 affordance — an implicit claim that somebody said it in a sentence,
   * which the source never made. A source with no examples now says so by
   * having none (§28 S6), and both real kinds arrive through this one channel
   * carrying `kind`, so a citable sentence and a listed phrase can never render
   * identically (§28 S3).
   */
  const sourced: GohoExample[] = [];
  const seenS = new Set<string>();
  for (const ex of input.examples ?? []) {
    const t = (ex.text ?? '').trim();
    const n = norm(t);
    if (!t || !n || seenS.has(n)) continue;
    seenS.add(n);
    sourced.push({
      text: t,
      ...(ex.source ? { source: ex.source } : {}),
      ...(ex.url ? { url: ex.url } : {}),
      ...(ex.span && ex.span[1] > ex.span[0] ? { span: ex.span } : {}),
      ...(ex.ref ? { ref: ex.ref } : {}),
      // Absent `kind` means a profile frozen before the distinction existed; a
      // url is the only evidence available that a document stood behind it.
      kind: ex.kind ?? (ex.url ? 'attested' : 'phrase'),
      ...(ex.frame ? { frame: ex.frame } : {}),
      ...(ex.collocate ? { collocate: ex.collocate } : {}),
    });
  }
  const kept = sourced.slice(0, MAX_EXAMPLES);

  return {
    fetchedAt: now,
    source,
    collocates: collocates.slice(0, 12),
    // The flat view is a projection of `sourced`, never a second population of
    // it — the two disagreeing is the bug this shape exists to prevent.
    examples: kept.map((e) => e.text),
    ...(kept.length ? { sourced: kept } : {}),
    frames,
    // Every way of attaching, drilled or not. Frozen whole because it is ONE
    // request and because the alternative — keeping six and discarding the
    // rest — throws away categories, not just rows.
    ...(input.index?.length ? { index: input.index } : {}),
    ...(input.facets?.length ? { facets: input.facets } : {}),
    ...(input.total ? { sourceTotal: input.total } : {}),
  };
}
