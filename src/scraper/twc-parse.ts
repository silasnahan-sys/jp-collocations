/**
 * twc-parse.ts — NINJAL-LWP for TWC, the JSON layer. PURE (no Obsidian, no
 * network). Golden: golden/twc.mjs, against byte fixtures captured 2026-08-02.
 *
 * ## What TWC actually is, and why the old scraper got nothing
 *
 * `TsukubaWebCorpusScraper` fetched `/search/?q=風&options=exact` and scraped
 * the HTML. That page contains no data. The 語彙プロファイル is drawn by three
 * jqGrid panels that each POST for their own JSON, and every one of them is
 * rejected unless you carry Django's CSRF token — which is why every earlier
 * attempt got either an empty parse or, worse, HTTP 200 with the *global first
 * page* of a 43-million-row table (こと's collocates, silently, for every word).
 *
 * The three verified endpoints, all POST, all requiring `X-CSRFToken`:
 *
 * | endpoint | key field in the body | gives |
 * |---|---|---|
 * | `/headwordlist_all/` | `filters` (jqGrid rule on `headword`) | 風 → `N.25644`, reading, romaji, corpus freq |
 * | `/patternfreqorder/<hwId>/` | `headword_id` | every way the word attaches, with freq + share |
 * | `/collocation/<hwId>.<patId>/` | `headword_collocation_id` + `_search=true` | the collocates of ONE way, with freq / MI / logDice |
 *
 * ## What this gives that nothing else in the plugin has
 *
 * Hyogen says a word attaches head-initially or head-finally. TWC says *how
 * often*, *in what proportion*, and — through MI and logDice — whether a pairing
 * is frequent merely because both halves are frequent, or genuinely bound. Those
 * are different facts, and 「風が」 vs 「クーラーの風」 is exactly the distinction
 * a learner needs and a frequency list cannot make.
 *
 * The headword's own position is marked with braces in every row —
 * `{風}を` head-initial, `子供の{風}` head-final — so direction is per-collocate
 * data from the corpus, not an assumption made by the parser.
 *
 * ## Honesty (§28 S6)
 *
 * The pattern response carries `"total": 0, "records": 1`, which are junk;
 * the collocation response's `total` is a PAGE count, not a row count. Nothing
 * here trusts either. Counts are what was actually returned, and `complete` says
 * whether the server had more.
 */

// ── shapes ───────────────────────────────────────────────────────────────────

/**
 * Where the headword sits inside the collocation, read off the braces.
 *
 * `unmarked` is not a fourth position — it means the corpus made no positional
 * claim. The 近接動詞 patterns (「走る ⇨ 動詞」) list bare co-occurring words with
 * no braces at all (`"する"`, `"なる"`), because those words merely appear near
 * the headword rather than attaching to it. Rendering that as 「走る～」 would
 * assert something the source did not say.
 */
export type TwcDirection = 'head-initial' | 'head-final' | 'circumfix' | 'unmarked';

export interface TwcHeadword {
  /** `N.25644` — the id every other endpoint is keyed on. */
  id: string;
  headword: string;
  /** カタカナ reading as the corpus displays it. */
  yomi: string;
  romaji: string;
  /** occurrences in TWC, as the site reports them. */
  freq: number;
  /** 名詞 / 動詞 / 形容詞 / 形容動詞 / 副詞, derived from the id prefix. */
  pos: string;
}

export interface TwcPattern {
  /** `J001`, `H007` — the second half of a collocation key. */
  id: string;
  /** 「風＋助詞」「名詞＋の＋風」 — the grammar, verbatim. */
  name: string;
  freq: number;
  /** percent of the headword's occurrences, as the site reports it. */
  share: number;
  /** the site's own grouping for this pattern, from the id prefix. '' when the
   *  prefix has not been measured — see `patternCategory`. */
  category: string;
}

export interface TwcCollocate {
  /** `H007.00001`. */
  id: string;
  /** verbatim, braces intact: `子供の{風}`. */
  surface: string;
  /** the collocation with the braces removed: `子供の風`. */
  text: string;
  /** just the part that is NOT the headword: `子供の`. */
  collocate: string;
  direction: TwcDirection;
  freq: number;
  /** mutual information — high means the pair is selective. */
  mi: number;
  /** logDice — comparable across corpora, unlike raw MI. */
  logDice: number;
}

export interface TwcCollocationList {
  patternId: string;
  rows: TwcCollocate[];
  /** false when the server reported further pages — the count is a floor. */
  complete: boolean;
  /**
   * How many DISTINCT collocations this pattern has — the site's own 種類 count
   * (「のを… 3,868種類」 in its grid header).
   *
   * The envelope's `records`, which nothing read until now. Without it the only
   * number available was `rows.length`, i.e. how big a page we asked for, and
   * the panel printed that as the total — so a pattern with 3,868 kinds
   * rendered as "24 / 100+件". The cap must never read as the count (§28 S6),
   * and reading a page size as a count is a stronger version of the same lie.
   */
  records: number;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Headword-id prefix → part of speech. Verified against live lookups
 * (風/N, 走る/V, 高い/AJ, 静か/AN, ゆっくり/AV). Unknown prefixes return '',
 * which the renderer already treats as "no POS to show" rather than guessing.
 */
const POS_BY_PREFIX: Record<string, string> = {
  N: '名詞', V: '動詞', AJ: '形容詞', AN: '形容動詞', AV: '副詞',
};

export function posOfId(headwordId: string): string {
  const m = /^([A-Z]+)\./.exec(headwordId ?? '');
  return m ? (POS_BY_PREFIX[m[1]] ?? '') : '';
}

/**
 * Pattern-id prefix → the category NINJAL-LWP files that pattern under.
 *
 * This is the grouping in the site's own left-hand panel — 助詞＋動詞, 他の名詞
 * との共起, 接頭辞・接尾辞 — and it was being discarded. `posOfId` reads the
 * HEADWORD id's prefix; nothing read the PATTERN id's, so 20 ways of attaching
 * arrived as one flat frequency-ordered list and the grammatical shape of the
 * profile was thrown away on the floor.
 *
 * Measured off a live 風 lookup (`golden/fixtures/twc-patterns-kaze.json`),
 * where the prefixes partition exactly as the site groups them:
 *
 *   A×7  風を… 風が… 風に… 風で…      → 助詞＋動詞
 *   B×1  動詞連用形＋風                 → 動詞
 *   C×3  風が＋形容詞 風に＋形容詞      → 助詞＋形容詞
 *   H×6  風＋名詞 名詞＋の＋風 並立     → 他の名詞との共起
 *   I×1  接頭辞＋風                     → 接頭辞・接尾辞
 *   J×1  風＋助詞                       → 助詞
 *   K×1  風＋助動詞                     → 助動詞
 *
 * **Only those seven are in the table, because only those seven were measured.**
 * The site's panel for の shows further groups (形容詞, 連体詞, 副詞化, 体言止め,
 * 未分類) whose prefixes have not been observed, and assigning them a letter
 * from the pattern of the others would be inventing data — the same reason
 * `posOfId` returns '' for an unknown prefix rather than guessing. An
 * uncategorised pattern still renders: it keeps its own `name`, which is the
 * part that actually says what it is.
 */
const CATEGORY_BY_PREFIX: Record<string, string> = {
  A: '助詞＋動詞',
  B: '動詞',
  C: '助詞＋形容詞',
  H: '他の名詞との共起',
  I: '接頭辞・接尾辞',
  J: '助詞',
  K: '助動詞',
};

/** The category for a pattern id (`H007` → 他の名詞との共起), or '' when the
 *  prefix has not been measured. Never a guess. */
export function patternCategory(patternId: string): string {
  const m = /^([A-Z]+)/.exec(patternId ?? '');
  return m ? (CATEGORY_BY_PREFIX[m[1]] ?? '') : '';
}

/** `N.25644` + `H007` → `N.25644.H007`, the key both the URL and the body need. */
export const collocationKey = (headwordId: string, patternId: string): string =>
  `${headwordId}.${patternId}`;

/**
 * Split a braced collocation into what precedes the headword, the headword, and
 * what follows. `子供の{風}` → `{ before: '子供の', head: '風', after: '' }`.
 * A row without braces yields an empty head and is treated as head-initial by
 * `directionOf`, since there is nothing to say otherwise.
 */
export function splitBraces(surface: string): { before: string; head: string; after: string } {
  const m = /^([^{]*)\{([^}]*)\}([\s\S]*)$/.exec(surface ?? '');
  if (!m) return { before: '', head: '', after: surface ?? '' };
  return { before: m[1], head: m[2], after: m[3] };
}

export function directionOf(surface: string): TwcDirection {
  const { before, head, after } = splitBraces(surface);
  // No braces at all: the corpus marked no position. Say so rather than default
  // to one — see `TwcDirection`.
  if (!head) return 'unmarked';
  if (before && after) return 'circumfix';
  if (before) return 'head-final';
  return 'head-initial';
}

// ── parsers ──────────────────────────────────────────────────────────────────

interface JsonGrid { rows?: unknown[] | null; total?: number | null }

const rowsOf = (json: unknown): Record<string, unknown>[] => {
  const g = (json ?? {}) as JsonGrid;
  return Array.isArray(g.rows) ? (g.rows as Record<string, unknown>[]) : [];
};
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * `/headwordlist_all/` rows → headwords.
 *
 * `want` filters to exact-surface matches when given: a `cn` (contains) query
 * for 風 also returns 風景 and 風呂, which are different words, not senses.
 */
export function parseHeadwords(json: unknown, want?: string): TwcHeadword[] {
  const out: TwcHeadword[] = [];
  for (const r of rowsOf(json)) {
    const id = str(r.headword_id);
    const headword = str(r.headword);
    if (!id || !headword) continue;
    if (want && headword !== want) continue;
    out.push({
      id, headword,
      yomi: str(r.yomi_display ?? r.yomi1),
      romaji: str(r.romaji_display ?? r.romaji1),
      freq: num(r.freq),
      pos: posOfId(id),
    });
  }
  // Most-attested first: a word's common reading should not sit under a rarity.
  return out.sort((a, b) => b.freq - a.freq);
}

/**
 * `/patternfreqorder/<hwId>/` rows → the ways the word attaches.
 *
 * NB the envelope's `total` is 0 and `records` is 1 for every word; both are
 * meaningless here, so the count is `rows.length` and nothing else.
 */
export function parsePatterns(json: unknown): TwcPattern[] {
  const out: TwcPattern[] = [];
  for (const r of rowsOf(json)) {
    const id = str(r.id);
    const name = str(r.name);
    if (!id || !name) continue;
    out.push({ id, name, freq: num(r.freq), share: num(r.percentage), category: patternCategory(id) });
  }
  return out.sort((a, b) => b.freq - a.freq);
}

/**
 * `/collocation/<hwId>.<patId>/` rows → the collocates of ONE way.
 *
 * **Guards against the silent-wrong-word failure.** Unkeyed or mis-keyed
 * requests return HTTP 200 with the global first page of the whole table, whose
 * rows are tagged with a different `headword_collocation_id`. That is not an
 * error the transport can see, so it is caught here: rows whose key does not
 * match the one we asked for are dropped, and if that empties the list the
 * caller learns the request was rejected rather than publishing こと's
 * collocates under 風.
 */
export function parseCollocates(json: unknown, expectKey: string): TwcCollocationList {
  const g = (json ?? {}) as JsonGrid;
  const patternId = expectKey.split('.').slice(2).join('.');
  const rows: TwcCollocate[] = [];
  for (const r of rowsOf(json)) {
    if (expectKey && str(r.headword_collocation_id) !== expectKey) continue;
    const surface = str(r.collocation);
    if (!surface) continue;
    const { before, head, after } = splitBraces(surface);
    rows.push({
      id: str(r.collocation_id),
      surface,
      text: before + head + after,
      collocate: (before + after).trim(),
      direction: directionOf(surface),
      freq: num(r.freq),
      mi: num(r.mi),
      logDice: num(r.logdice),
    });
  }
  // `total` is a PAGE count. One page means what we hold is the whole list.
  const pages = num(g.total);
  // `records` is the row count the server holds. On a single-page response it
  // equals `rows.length`, which is why the fixtures never exposed the bug.
  const records = num((g as { records?: number }).records) || rows.length;
  return { patternId, rows, complete: pages <= 1, records };
}

// ── examples ─────────────────────────────────────────────────────────────────

/**
 * One attested sentence, with everything needed to cite it.
 *
 * This is the layer that makes a corpus worth more than a word list: the
 * plugin's own rule is that provenance is never dropped (§28 S2), and until now
 * a 語法 example was a bare string with "corpus" as its source. TWC hands over
 * the document title AND its URL for every sentence, so a captured example can
 * carry where it actually came from.
 */
export interface TwcExample {
  /** the sentence, verbatim. */
  text: string;
  /** the document it came from, parens stripped. */
  source: string;
  /** the page it came from. */
  url: string;
  /** [start, end) character offsets of the collocation inside `text` — the
   *  corpus's own highlight, so the panel never has to search for it. */
  span: [number, number];
  /**
   * The highlighted substring, resolved from `span`.
   *
   * This is the SURFACE form, and it is usually not the collocation's own text:
   * 「子供の風」 is attested as 「子どものかぜ」, 「風を」 as 「かぜを」. The
   * collocation list is lemmatised; the sentences are what people actually
   * wrote. That difference is information, not noise — which is also why
   * identity is checked on counts below and never on string equality.
   */
  highlight: string;
  /** NR/SP/OM/OC/OY when the corpus tags one; often blank. */
  subcorpus: string;
  /** `fileid`/`sentenceid` — the site's /context/ key, kept for citation. */
  ref: string;

  // ── stamped by the transport, not parsed from the response ──
  //
  // The response says nothing about which collocation it answers; the REQUEST
  // does. Recording it at fetch time is the whole fix for the join below —
  // `highlight` is surface and `TwcCollocate.text` is lemmatised, so any later
  // attempt to pair them by string returns nothing (measured: 0 of 2 on the
  // committed fixtures — 「子供の風」 is attested as 「子どものかぜ」).
  /** `H007.00001` — the collocation this batch was requested for. */
  collocationId?: string;
  /** that collocation's lemmatised text, as the grid lists it. */
  collocate?: string;
  /** the way-of-attaching it belongs to (`TwcPattern.name`). */
  frame?: string;
}

export interface TwcExampleList {
  rows: TwcExample[];
  /** how many the corpus holds, from the envelope's `records`. */
  records: number;
  /** false when further pages exist. */
  complete: boolean;
  /**
   * True when the response is not the collocation we asked for.
   *
   * Unlike `/collocation/`, this endpoint 500s on a malformed request rather
   * than silently substituting — but "loud today" is not "loud forever", so
   * identity is checked from the data. See `parseExamples`.
   */
  mismatch: boolean;
}

/**
 * `/example/<hwId>.<patId>.<rank>/` rows → citable sentences.
 *
 * **Identity is checked on the count, not the text.** `expectFreq` is the
 * collocate's corpus frequency, and the envelope's `records` equals it exactly
 * — measured across three orders of magnitude (風を 145, 子供の風 2, 走っている
 * 16,760). Verifying on the highlighted string instead would reject correct
 * data, because the collocation list is lemmatised while the sentences are
 * surface: 「子供の風」 is really attested as 「子どものかぜ」.
 */
export function parseExamples(json: unknown, expectFreq?: number): TwcExampleList {
  const g = (json ?? {}) as JsonGrid & { records?: number };
  const rows: TwcExample[] = [];

  for (const r of rowsOf(json)) {
    const text = str(r.example);
    if (!text) continue;
    let start = num(r.bold_start);
    let end = num(r.bold_end);
    // A span the corpus cannot justify is dropped rather than used to slice at
    // random offsets.
    if (!(start >= 0 && end > start && end <= text.length)) { start = 0; end = 0; }
    rows.push({
      text,
      // The site wraps the title in parens; the parens are presentation.
      source: str(r.source).replace(/^\(|\)$/g, '').trim(),
      // Every url in the corpus dump carries a trailing CR.
      url: str(r.url).trim(),
      span: [start, end],
      highlight: end > start ? text.slice(start, end) : '',
      subcorpus: str(r.subcorpus),
      ref: [str(r.fileid), str(r.sentenceid)].filter(Boolean).join(' '),
    });
  }

  const records = num(g.records);
  const mismatch = expectFreq !== undefined && rows.length > 0 && records !== expectFreq;
  return {
    rows: mismatch ? [] : rows,
    records,
    complete: num(g.total) <= 1,
    mismatch,
  };
}

/**
 * Group attested sentences by the collocation they were FETCHED FOR.
 *
 * The join has to be on the id because it cannot be on the text. The
 * collocation grid is lemmatised and the sentences are surface, so the two
 * strings differ by construction — 「子供の風」 is attested as 「子どものかぜ」 —
 * and the previous version, which keyed this map on `highlight` and looked it up
 * by the collocate's `text`, matched **0 of 2 rows on the committed fixtures**
 * and therefore shipped every entry with an empty example list, silently.
 *
 * This is the same rule as `parseExamples` verifying on `records` rather than on
 * the highlighted string: when a corpus lemmatises, the number is the identity
 * and the text is not.
 */
export function groupExamplesByCollocation(examples: readonly TwcExample[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const ex of examples) {
    if (!ex.collocationId || !ex.text) continue;
    const at = out.get(ex.collocationId) ?? [];
    at.push(ex.text);
    out.set(ex.collocationId, at);
  }
  return out;
}

/** First citation per collocation, so a captured example is not sourced to the
 *  literal word "corpus" (§28 S2). */
export function citationsByCollocation(examples: readonly TwcExample[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const ex of examples) {
    if (!ex.collocationId || out.has(ex.collocationId)) continue;
    const cite = [ex.source, ex.url].filter(Boolean).join(' ');
    if (cite) out.set(ex.collocationId, cite);
  }
  return out;
}

// ── the frame view ───────────────────────────────────────────────────────────

/** A collocate with its association measures, for `GohoFrame.measured`. */
export interface TwcMeasured {
  text: string;
  freq: number;
  mi: number;
  logDice: number;
  /** `H007.00001` — the row's own collocation id. Carried so an example batch
   *  can be joined back to the collocate it was fetched FOR, by key rather than
   *  by comparing a lemmatised list against surface sentences. */
  id?: string;
}

export interface TwcFrame {
  pos: string;
  direction: TwcDirection;
  label: string;
  items: string[];
  /** the pattern's DISTINCT-collocation count (`records`), not the page size. */
  total: number;
  freq: number;
  share: number;
  measured: TwcMeasured[];
  /** false when the source had more collocates than were fetched. */
  complete: boolean;
  /** `H007` — which pattern this frame drilled, so a frozen frame can be
   *  matched back to its row in the index. */
  patternId: string;
  /** the index category this pattern sits under. */
  category: string;
}

/**
 * A pattern plus its collocates → one frame, the shape `payload.goho.frames`
 * already speaks (DESIGN §22.7).
 *
 * The frame's direction is the direction its collocates actually have, by
 * weight of frequency rather than by counting rows — one high-frequency
 * head-initial collocate describes the pattern better than nine rare
 * head-final ones. Patterns whose collocates genuinely straddle both sides
 * (「〜の風が〜」) come out as `circumfix` and the renderer shows no arrow it
 * cannot justify.
 */
export function toFrame(
  headwordPos: string,
  pattern: TwcPattern,
  list: TwcCollocationList,
): TwcFrame {
  const weight: Record<string, number> = {
    'head-initial': 0, 'head-final': 0, circumfix: 0, unmarked: 0,
  };
  for (const c of list.rows) weight[c.direction] += Math.max(1, c.freq);
  let direction: TwcDirection = 'head-initial';
  for (const d of ['head-final', 'circumfix', 'unmarked'] as TwcDirection[]) {
    if (weight[d] > weight[direction]) direction = d;
  }

  const measured = [...list.rows].sort((a, b) => b.freq - a.freq);
  return {
    pos: headwordPos,
    direction,
    label: pattern.name,
    patternId: pattern.id,
    category: pattern.category,
    items: measured.map((c) => c.text),
    // The pattern's real 種類 count. This used to be `measured.length` — how
    // many rows one request returned — so a truncated frame reported the page
    // size as its total.
    total: Math.max(list.records, measured.length),
    freq: pattern.freq,
    share: pattern.share,
    measured: measured.map((c) => ({ text: c.text, freq: c.freq, mi: c.mi, logDice: c.logDice, id: c.id })),
    // "we hold every distinct collocation this pattern has" — which is a
    // different question from "is the total we print exact". Since `records`
    // arrived, the total IS exact even when this is false, so the UI can offer
    // to fetch more without the count having to hedge.
    complete: measured.length >= list.records,
  };
}
