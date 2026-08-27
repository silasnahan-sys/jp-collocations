/**
 * usage.ts — X as a corpus, which is not the same thing as X as a feed.
 *
 * The 𝕏 view calls itself 検索辞書 and behaves like a search box: type a phrase,
 * get a reverse-chronological list of whole tweets. But a reverse-chronological
 * list of whole tweets is *Twitter*, and the user already has Twitter. What the
 * plugin holds that Twitter does not is a **frozen, local, countable corpus** —
 * 976,401 characters of contemporary written Japanese from 1,729 different
 * people — and a corpus answers questions a feed structurally cannot:
 *
 *   how often ・ with what ・ in what shape ・ said by how many different people
 *
 * That last one is the honest one and the reason this module exists. Forty hits
 * from three accounts is one person's tic wearing a crowd's clothes; forty hits
 * from thirty-eight accounts is the language. A feed cannot tell you which you
 * are looking at. A corpus can, and must, because the whole reason to consult X
 * rather than a dictionary is to find out what people *actually* write — and a
 * finding you cannot check the spread of is not that.
 *
 * ## KWIC, and why the window is the point
 *
 * Keyword-in-context alignment — every hit stacked with the phrase in the same
 * column — is the oldest tool in corpus linguistics and it is the one thing the
 * card feed makes impossible. Aligned, the recurring left and right environment
 * becomes visible at a glance; unaligned, it is 533 characters of someone's
 * opinion with your phrase somewhere inside.
 *
 * It also fixes a real defect. `xJoinPattern` was attaching whole tweets to
 * catalog entries as 用例: p90 of those quotes is 4,691 characters and the
 * longest is 9,721 — a marketing thread filed as evidence for 「だよね」. You
 * cannot see a phrase working inside 9,721 characters, which makes it a
 * haystack rather than a scene (§22: context is meaning). The window built here
 * is the same window that becomes the attestation quote, so the display fix and
 * the storage fix are one mechanism rather than two that will drift.
 *
 * ## What this deliberately does not claim
 *
 * No morphology. The codebase has no segmenter and does not pretend to (see
 * `discourse-grammar.ts`), so "what it travels with" is reported as the literal
 * adjacent characters, never as *words*. 「という」 before 「わけだから」 is a
 * string this corpus really contains; calling it a lexeme would be an assertion
 * nothing here can support (§12).
 */

import type { XTweet } from './x-types.ts';

/** Characters of context kept on each side of the hit. */
const WINDOW = 22;
/** Adjacent-string lengths reported as neighbours. */
const NEIGHBOUR_SIZES = [2, 3, 4] as const;
/** A neighbour needs this many sightings AND this many distinct authors. */
const NEIGHBOUR_MIN_COUNT = 2;
const NEIGHBOUR_MIN_AUTHORS = 2;
const MAX_NEIGHBOURS = 5;
/** Ceiling on rendered concordance lines — the panel is a sample, and says so. */
export const MAX_KWIC = 24;

/**
 * Where a sentence really ends.
 *
 * Kept separate from the soft kind because the two sides of the window want
 * different things. Walking LEFT, any boundary is a clean place to start — a
 * clause reads fine. Walking RIGHT, stopping at the first 「、」 is fatal: most
 * connective phrases are followed immediately by one, so the right-hand column
 * of the concordance came out empty for exactly the phrases a concordance is
 * for. 「んだけど ▍ 、」 tells you nothing; 「んだけど ▍ 、それがだめで」 is the
 * finding.
 */
const HARD_BOUNDARY = /[。．！？!?\n]/;
/** Hard boundaries plus clause-level punctuation — a fine place to START. */
const ANY_BOUNDARY = /[。．！？!?\n「」（）()【】…‥、,]/;
/**
 * A neighbour has to carry at least one character that means something. Tweets
 * are full of line breaks, so without this the top "words before 「だよね」" come
 * out as 「。\n」 and 「。\n\n」 — two spellings of a paragraph break, reported as
 * a finding about Japanese.
 */
const CONTENTFUL = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{L}\p{N}]/u;
/** One line, always: a newline inside a KWIC row breaks the alignment that IS
 *  the point of a KWIC row. */
const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();

export interface KwicLine {
  /** context before the hit, right-aligned (its END is what matters). */
  left: string;
  /** the hit exactly as it appears. */
  hit: string;
  right: string;
  /** true when `left`/`right` were cut mid-sentence rather than at a boundary. */
  clippedLeft: boolean;
  clippedRight: boolean;
  /** §28 S2 — the door back, always. */
  url: string;
  handle: string;
  at: number;
}

export interface Neighbour {
  text: string;
  count: number;
  /** how many DIFFERENT people wrote it. The spread signal, per neighbour. */
  authors: number;
}

export interface XUsage {
  term: string;
  /** tweets containing the term. */
  hits: number;
  /** distinct authors among them. */
  authors: number;
  /** corpus size the count was measured against — a rate needs its denominator. */
  corpus: number;
  /** oldest and newest hit, epoch ms. Null when there are no hits. */
  span: { from: number; to: number } | null;
  lines: KwicLine[];
  /** how many hits exist beyond `lines` (never silently truncated). */
  more: number;
  before: Neighbour[];
  after: Neighbour[];
}

/** Trim a left context to the last boundary inside the window, else hard-cut. */
function leftWindow(text: string, at: number): { text: string; clipped: boolean } {
  const start = Math.max(0, at - WINDOW);
  const raw = text.slice(start, at);
  // Walk forward to the last boundary so the fragment starts somewhere real.
  for (let i = 0; i < raw.length; i++) {
    if (ANY_BOUNDARY.test(raw[i])) return { text: flat(raw.slice(i + 1)), clipped: false };
  }
  return { text: flat(raw), clipped: start > 0 };
}

function rightWindow(text: string, from: number): { text: string; clipped: boolean } {
  const end = Math.min(text.length, from + WINDOW);
  const raw = text.slice(from, end);
  for (let i = 0; i < raw.length; i++) {
    // Hard boundaries only, and keep the character — 「。」 is part of the
    // fragment it closes. A 「、」 is walked straight through: see the note on
    // HARD_BOUNDARY for the column it was emptying.
    if (HARD_BOUNDARY.test(raw[i])) return { text: flat(raw.slice(0, i + 1)), clipped: false };
  }
  return { text: flat(raw), clipped: end < text.length };
}

/**
 * The fragment a KWIC line represents, as one readable string.
 *
 * This — not the tweet — is what becomes an attestation quote. Mean tweet
 * length in the live corpus is 533 characters; this is at most ~70 and centres
 * on the phrase, which is the difference between evidence and a haystack.
 */
export function kwicQuote(l: KwicLine): string {
  return `${l.clippedLeft ? '…' : ''}${l.left}${l.hit}${l.right}${l.clippedRight ? '…' : ''}`
    .replace(/\s+/g, ' ').trim();
}

/**
 * Build the usage panel for `term` over `tweets`.
 *
 * One line per tweet, first occurrence only: a thread that repeats the phrase
 * eight times is one person saying it, and letting it contribute eight lines
 * would inflate exactly the number the spread signal exists to keep honest.
 */
export function buildXUsage(tweets: readonly XTweet[], term: string, corpusSize: number): XUsage {
  const needle = term.normalize('NFC').trim();
  const empty: XUsage = {
    term: needle, hits: 0, authors: 0, corpus: corpusSize, span: null,
    lines: [], more: 0, before: [], after: [],
  };
  if (!needle) return empty;

  const lines: KwicLine[] = [];
  const authors = new Set<string>();
  let from = Infinity, to = -Infinity;
  // neighbour string → the set of handles that wrote it (count = set-size-free
  // tally kept alongside, because one author may use it repeatedly).
  const beforeTally = new Map<string, { count: number; who: Set<string> }>();
  const afterTally = new Map<string, { count: number; who: Set<string> }>();
  const bump = (m: Map<string, { count: number; who: Set<string> }>, raw: string, who: string): void => {
    // Collapse the whitespace first, so 「。\n」 and 「。\n\n」 are one neighbour
    // rather than two, then require something contentful in what is left.
    const k = flat(raw);
    if (!k || !CONTENTFUL.test(k)) return;
    let e = m.get(k);
    if (!e) { e = { count: 0, who: new Set() }; m.set(k, e); }
    e.count++;
    e.who.add(who);
  };

  let hits = 0;
  for (const t of tweets) {
    const text = (t.text ?? '').normalize('NFC');
    const at = text.indexOf(needle);
    if (at < 0) continue;
    hits++;
    authors.add(t.authorHandle);
    if (t.createdAt) { from = Math.min(from, t.createdAt); to = Math.max(to, t.createdAt); }

    const l = leftWindow(text, at);
    const r = rightWindow(text, at + needle.length);
    if (lines.length < MAX_KWIC) {
      lines.push({
        left: l.text, hit: needle, right: r.text,
        clippedLeft: l.clipped, clippedRight: r.clipped,
        url: t.url, handle: t.authorHandle, at: t.createdAt,
      });
    }
    // Literal adjacent strings. Not words — the module header says why.
    for (const n of NEIGHBOUR_SIZES) {
      if (at >= n) bump(beforeTally, text.slice(at - n, at), t.authorHandle);
      const after = text.slice(at + needle.length, at + needle.length + n);
      if (after.length === n) bump(afterTally, after, t.authorHandle);
    }
  }

  const rank = (m: Map<string, { count: number; who: Set<string> }>): Neighbour[] =>
    [...m.entries()]
      // Two sightings from two different people. One author repeating a phrase
      // is that author's habit, and a corpus panel that reports it as usage is
      // making the same mistake the spread number exists to prevent.
      .filter(([, e]) => e.count >= NEIGHBOUR_MIN_COUNT && e.who.size >= NEIGHBOUR_MIN_AUTHORS)
      .map(([text, e]) => ({ text, count: e.count, authors: e.who.size }))
      // Longer strings say more, so a longer one at the same count wins.
      .sort((a, b) => b.count - a.count || b.text.length - a.text.length || a.text.localeCompare(b.text))
      // Drop a short string that is only ever a tail of a longer, equally
      // common one — 「うわけ」 under 「というわけ」 is the same finding twice.
      .filter((n, _i, all) => !all.some((o) => o !== n && o.count >= n.count && o.text.endsWith(n.text) && o.text.length > n.text.length))
      .slice(0, MAX_NEIGHBOURS);

  if (!hits) return empty;
  return {
    term: needle,
    hits,
    authors: authors.size,
    corpus: corpusSize,
    span: from <= to ? { from, to } : null,
    lines,
    more: Math.max(0, hits - lines.length),
    before: rank(beforeTally),
    after: rank(afterTally),
  };
}

/**
 * How much to trust the count, in one word the panel can print.
 *
 * Not a confidence score — a shape description. `narrow` says the hits cluster
 * in few hands and the reader should look at who; `spread` says many different
 * people wrote it. Both are facts about the corpus, neither is a claim about
 * the language, which is the line §12 draws.
 */
export function spreadOf(u: XUsage): 'thin' | 'narrow' | 'spread' {
  if (u.hits < 4) return 'thin';
  return u.authors >= Math.ceil(u.hits * 0.6) ? 'spread' : 'narrow';
}

// ── §29 rung 2: the environment PROMOTED — from decoration into structure ──

export interface EnvGroup {
  side: 'before' | 'after';
  /** the recurring fragment itself */
  text: string;
  count: number;
  /** distinct voices — the spread signal, per environment */
  authors: number;
  /** tweet ids whose first occurrence sits in this environment */
  ids: string[];
}

/**
 * Recurring KWIC environments as GROUPS (§29.2 rung 2): when several voices
 * put the same fragment beside the term, the ENVIRONMENT is the answer and
 * the tweets are its evidence. The thresholds are the ones the display
 * already used (count ≥ minCount across ≥ minAuthors distinct handles) —
 * this promotes them from decoration into ranking structure. A tweet joins
 * only its strongest group, so the groups partition rather than double-count.
 */
export function environmentGroups(
  tweets: readonly XTweet[],
  term: string,
  minCount = 3,
  minAuthors = 2,
): EnvGroup[] {
  const needle = term.normalize('NFC').trim();
  if (!needle) return [];
  type Tally = { count: number; who: Set<string>; ids: string[] };
  const tally = new Map<string, Tally>();
  const bump = (side: 'before' | 'after', raw: string, who: string, id: string): void => {
    const k = flat(raw);
    if (!k || !CONTENTFUL.test(k)) return;
    const key = `${side}${k}`;
    let e = tally.get(key);
    if (!e) { e = { count: 0, who: new Set(), ids: [] }; tally.set(key, e); }
    e.count++;
    e.who.add(who);
    e.ids.push(id);
  };
  for (const t of tweets) {
    const text = (t.text ?? '').normalize('NFC');
    const at = text.indexOf(needle);
    if (at < 0) continue;
    bump('before', leftWindow(text, at).text, t.authorHandle, t.id);
    bump('after', rightWindow(text, at + needle.length).text, t.authorHandle, t.id);
  }
  const groups: EnvGroup[] = [];
  for (const [key, e] of tally) {
    if (e.count < minCount || e.who.size < minAuthors) continue;
    const [side, text] = key.split('') as ['before' | 'after', string];
    groups.push({ side, text, count: e.count, authors: e.who.size, ids: e.ids });
  }
  groups.sort((a, b) => b.count * b.authors - a.count * a.authors);
  // Strongest claim wins: a tweet evidences ONE group.
  const claimed = new Set<string>();
  for (const g of groups) {
    g.ids = g.ids.filter((id) => !claimed.has(id));
    for (const id of g.ids) claimed.add(id);
  }
  return groups.filter((g) => g.ids.length > 0);
}

/**
 * Label-ness (§29.2 rung 2, forced by fixture B): the fraction of a string's
 * occurrences that are line-initial, standalone-line, or hashtag — versus
 * mid-clause. アウトプット opens a study log like a heading; がっつり is
 * real but lives mid-sentence as commentary. "Usable as a calendar-entry
 * label" has this computable positional correlate — reported as a fact
 * about POSITION, never as a verdict about the word.
 */
export function labelNess(
  tweets: readonly XTweet[],
  term: string,
): { occ: number; label: number; ratio: number } {
  const needle = term.normalize('NFC').trim();
  let occ = 0, label = 0;
  if (!needle) return { occ, label, ratio: 0 };
  for (const t of tweets) {
    const text = (t.text ?? '').normalize('NFC');
    let at = text.indexOf(needle);
    while (at !== -1) {
      occ++;
      const prev = at === 0 ? '' : text[at - 1];
      const lineInitial = at === 0 || prev === '\n';
      const hashtag = prev === '#' || prev === '＃';
      if (lineInitial || hashtag) label++;
      at = text.indexOf(needle, at + 1);
    }
  }
  return { occ, label, ratio: occ ? label / occ : 0 };
}
