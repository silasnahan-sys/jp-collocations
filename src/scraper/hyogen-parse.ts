/**
 * hyogen-parse.ts — the real Hyogen DOM, as a PURE parser (golden:
 * golden/hyogen.mjs, pinned against a byte fixture of a live page).
 *
 * ## Why this file exists
 *
 * `HyogenScraper.parseHtml` looked for `<tr>/<td>`. A Hyogen word page has 17
 * `<tr>` and every one of them is chrome — header, sidebar, ads, and the
 * あかさたな kana index at the foot. So the parser returned **10 entries**
 * (`風あ` `風か` `風さ` … the kana nav bar), assigned them all POS 動詞 because
 * a layout row happened to contain the substring 動詞, and **reported no
 * error**. It read as a working feature with a thin corpus for weeks. The real
 * page carries **22,558 collocations**.
 *
 * That is the most dangerous failure shape there is — plausible output, no
 * exception — which is why this parser is pure, separated from transport, and
 * pinned byte-for-byte.
 *
 * ## The actual shape (measured against collocation.hyogen.info/word/風)
 *
 * ```html
 * <div class="col_font1">名詞</div>                       ← POS section header
 * <div class="col_midasi1"><b>風</b>[名詞]<b> ～ </b>      ← HEAD-INITIAL (風～)
 *      [絞込み： <a href="…/風/no">の～</a>｜<a href="…/風/ha">は～</a>…]
 * </div>
 * <div class="font8"></div>                               ← an empty one, always
 * <div class="font8">風のように鳴った　　風に御する　　…</div>  ← items, split on U+3000×2
 *
 * <div class="col_midasi1"><b>～ 風</b>[名詞]1</div>        ← HEAD-FINAL, sense 1
 * <div class="font8">声は風の　　憑り風に　　…</div>
 * <div class="col_midasi1"><b>～ 風</b>[名詞]2</div>        ← HEAD-FINAL, sense 2
 * <div class="col_midasi1"><b>複合名詞</b></div>            ← COMPOUND
 * ```
 *
 * ## The three facts the old model had nowhere to put
 *
 * 1. **Direction.** `風 ～` (the headword governs what follows) and `～ 風`
 *    (the headword is governed) are different collocational facts about the
 *    same word. Hyogen states it in `col_midasi1`; the old code dropped it.
 * 2. **The item is already a full phrase.** Hyogen items CONTAIN the headword
 *    (`風が吹く`, not `が吹く`). The old code did `fullPhrase = headword +
 *    collocate` and produced `風風が吹く`. So `fullPhrase` is the verbatim item
 *    and `collocate` is DERIVED by removing the headword.
 * 3. **Particle facets.** The 絞込み links (`の～` `は～` `が～` `を～`) are the
 *    ways the word attaches — the grammatical half of a collocational profile,
 *    and the thing a flat list of strings cannot hold.
 *
 * Hyogen publishes no 利用規約, 転載 or 著作権 restriction and its corpus is
 * 青空文庫-derived (public domain). Its own 2s rate limit is respected upstream.
 */

/** Which side of the collocation the headword sits on. */
export type HyogenDirection = 'head-initial' | 'head-final' | 'compound';

export interface HyogenSection {
  /** POS section this sense sits under (名詞 / 動詞 / 形容詞 …). */
  pos: string;
  direction: HyogenDirection;
  /** Hyogen's own sense number, when the head carries one (`～ 風[名詞]2`). */
  sense?: number;
  /** The head line verbatim, for display — never re-derived. */
  label: string;
  /** Full phrases, verbatim, in page order. Each CONTAINS the headword. */
  items: string[];
}

export interface HyogenFacet {
  /** の～ / は～ / が～ / を～ — how the word attaches. */
  label: string;
  /** the particle slug from the URL (`no` / `ha` / `ga` / `wo`). */
  slug: string;
  url: string;
}

export interface HyogenProfile {
  headword: string;
  sections: HyogenSection[];
  facets: HyogenFacet[];
  /** total items across every section — the honest count. */
  total: number;
}

/** U+3000 ×2 is Hyogen's item separator. A single one occurs inside items. */
const ITEM_SEP = '　　';

const stripTags = (s: string): string =>
  s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

/**
 * Read direction + sense out of a `col_midasi1` head.
 *
 * The direction is carried by WHICH SIDE the ～ sits on, and the two forms are
 * written differently by the site:
 *   `<b>風</b>[名詞]<b> ～ </b>`  → head-initial
 *   `<b>～ 風</b>[名詞]1`          → head-final, sense 1
 *   `<b>複合名詞</b>`              → compound
 */
export function parseHead(html: string, headword: string): { direction: HyogenDirection; sense?: number; label: string } {
  const text = stripTags(html).replace(/\[絞込み：[\s\S]*$/, '').replace(/\s+/g, ' ').trim();
  if (/複合/.test(text)) return { direction: 'compound', label: text };

  const senseMatch = text.match(/\]\s*(\d+)\s*$/);
  const sense = senseMatch ? Number(senseMatch[1]) : undefined;

  // Where does ～ sit relative to the headword in the head line?
  const tilde = text.search(/[～〜~]/);
  const head = text.indexOf(headword);
  const direction: HyogenDirection =
    tilde >= 0 && head >= 0 ? (tilde < head ? 'head-final' : 'head-initial')
    : tilde >= 0 ? 'head-initial'
    : 'compound';

  return { direction, ...(sense !== undefined ? { sense } : {}), label: text };
}

/** The 絞込み particle links — the attachment facets. */
export function parseFacets(html: string): HyogenFacet[] {
  const out: HyogenFacet[] = [];
  const seen = new Set<string>();
  const re = /<a\s+href="(https?:\/\/collocation\.hyogen\.info\/word\/[^"\/]+\/([a-z]+))"[^>]*>([^<]+)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, url, slug, label] = m;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ label: label.trim(), slug, url });
  }
  return out;
}

/**
 * Parse a Hyogen word page into a structured profile.
 *
 * Walks `col_font1` / `col_midasi1` / `font8` in DOCUMENT ORDER, because that
 * order is the only thing binding a POS header to the senses under it and a
 * sense head to its item list. A class-by-class scan loses the association.
 */
export function parseHyogenProfile(html: string, headword: string): HyogenProfile {
  const sections: HyogenSection[] = [];
  let pos = '';
  let pending: { direction: HyogenDirection; sense?: number; label: string } | null = null;
  let facets: HyogenFacet[] = [];

  const re = /<div class="(col_font1|col_midasi1|font8)">([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, cls, body] = m;
    if (cls === 'col_font1') { pos = stripTags(body).trim(); continue; }
    if (cls === 'col_midasi1') {
      if (!facets.length) facets = parseFacets(body);
      pending = parseHead(body, headword);
      continue;
    }
    // font8 — the items. The page emits an EMPTY font8 before the first real
    // one; skipping it here rather than filtering later keeps section/head
    // alignment exact.
    const items = stripTags(body).split(ITEM_SEP).map((s) => s.trim()).filter(Boolean);
    if (!items.length || !pending) continue;
    sections.push({ pos: pos || '', ...pending, items });
    pending = null;
  }

  return { headword, sections, facets, total: sections.reduce((n, s) => n + s.items.length, 0) };
}

/**
 * One Hyogen item promoted to the 用例 channel.
 *
 * Structurally assignable to `GohoExample` without importing it — this file is
 * pure and its golden transpiles it standalone, so it stays dependency-free.
 */
export interface HyogenExample {
  text: string;
  source: string;
  url?: string;
  /** Always `phrase`: Hyogen LISTS these, it does not cite a document for each.
   *  See `GohoExample.kind` — the distinction decides how they render. */
  kind: 'phrase';
  /** the section head this item was listed under. */
  frame: string;
}

/** Below this an item is 「風に」 — a collocate, not something you could say. */
const EXAMPLE_MIN = 6;
/** Above this it is a run-on fragment of classical prose, not an example. */
const EXAMPLE_MAX = 60;

/**
 * The items worth showing as 用例, spread across the ways the word attaches.
 *
 * Hyogen is the only source in the plugin with 青空文庫 phrases, and until now
 * they reached the panel only as collocate chips — visually identical to a bare
 * particle pairing, and the 用例 row rendered nothing at all for this source.
 *
 * Two decisions worth stating, because both are places a guess would have been
 * easy:
 *
 * 1. **Page order is kept.** Items are filtered by length band and otherwise
 *    taken in the order Hyogen lists them. Ranking them (longest-first,
 *    most-sentence-like-first) would be this parser inventing a judgement the
 *    source did not make — the same rule that stops `parseCollocates` from
 *    re-sorting a corpus's own frequency order.
 * 2. **Round-robin across sections, not the first N.** 風～ and ～風 are
 *    different facts about the word (the whole reason `direction` exists), so
 *    eight examples of one behaviour teach less than two examples of four.
 *    Same principle as the TWC scraper's one-batch-per-frame example pass.
 */
export function hyogenExamples(
  profile: HyogenProfile,
  url?: string,
  opts: { max?: number; perSection?: number } = {},
): HyogenExample[] {
  const max = opts.max ?? 8;
  const perSection = opts.perSection ?? 2;

  const pools = profile.sections.map((s) => {
    const seen = new Set<string>();
    const items: string[] = [];
    for (const t of s.items) {
      const n = [...t].length;
      if (n < EXAMPLE_MIN || n > EXAMPLE_MAX || seen.has(t)) continue;
      seen.add(t);
      items.push(t);
      if (items.length >= perSection) break;
    }
    return { frame: s.label, items };
  });

  const out: HyogenExample[] = [];
  const taken = new Set<string>();
  for (let round = 0; round < perSection && out.length < max; round++) {
    for (const p of pools) {
      if (out.length >= max) break;
      const text = p.items[round];
      if (!text || taken.has(text)) continue;
      taken.add(text);
      out.push({
        text,
        // The corpus behind the string; the url is the page it is listed on,
        // which is what a reader can actually check.
        source: '青空文庫',
        ...(url ? { url } : {}),
        kind: 'phrase',
        frame: p.frame,
      });
    }
  }
  return out;
}

/**
 * The collocate — the part of the item that ISN'T the headword.
 *
 * Derived, never concatenated (`headword + collocate` was the old bug and gave
 * `風風が吹く`). Direction decides which side to keep, and it has to: splicing
 * the headword out of the middle turns 「声は風の」 into 「声はの」, which is not
 * a phrase in any language. Head-final means the collocate PRECEDES
 * (「声は風の」 → 「声は」); head-initial means it FOLLOWS
 * (「風のように鳴った」 → 「のように鳴った」).
 *
 * Returns '' when the item IS the headword, and the item unchanged when the
 * headword does not occur (compound sections list orthographic variants).
 */
export function collocateOf(item: string, headword: string, direction: HyogenDirection = 'head-initial'): string {
  const i = item.indexOf(headword);
  if (i < 0) return item;
  if (direction === 'head-final') return item.slice(0, i).trim();
  if (direction === 'head-initial') return item.slice(i + headword.length).trim();
  // compound: the headword is glued into a word (夜風 / 風速) — either side is
  // the modifier, so keep whichever is non-empty.
  return (item.slice(0, i) || item.slice(i + headword.length)).trim();
}
