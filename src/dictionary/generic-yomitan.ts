/**
 * generic-yomitan.ts — the adapter for EVERY dictionary that is not 英辞郎
 * (DESIGN §27.4's registry + generic fallback).
 *
 * Two things make this necessary rather than a nicety, both found by opening
 * the user's actual export rather than trusting the plan:
 *
 *  1. **Format.** 英辞郎's converter emitted glossary content as HTML STRINGS,
 *     which is why `eijiro.ts` can parse with a closed set of class names.
 *     Jitendex — and Yomitan's own format spec — use the structured-content
 *     NODE TREE (`{tag, content, data}`). Pointing the Eijiro adapter at
 *     jitendex parses exactly nothing. This walks the tree.
 *
 *  2. **Direction.** 英辞郎 is EN→JA: the English headword is the intention you
 *     search by, the Japanese gloss is what you reach for. Jitendex is JA→EN —
 *     the mirror. A production lexicon has to keep the JAPANESE on the
 *     `surface` side in both cases, or half the corpus indexes backwards.
 *     `index.json`'s sourceLanguage/targetLanguage decides; there is no
 *     guessing from content.
 *
 * PURE. Golden: golden/generic-yomitan.mjs.
 */

import type { NoteClass } from '../notes/note-types.ts';
import { toFrame, classHintForFrame } from './frames.ts';
import type { DictHeadword, DictSense, ReachCandidate, EijiroTuple } from './eijiro.ts';
import {
  profileFor, FLATTENED_GLOSS_CHARS,
  type TreeProfile, type TreeRole, type EntryNode, type ComparisonTable, type MemberItem,
} from './entry-parts.ts';

/** Which side of the pair is Japanese. */
export type Direction = 'ja->en' | 'en->ja';

export function directionOf(index: { sourceLanguage?: string; targetLanguage?: string } | null): Direction {
  // Absent metadata is common in hand-rolled dictionaries; JA→EN is the
  // overwhelming default for a Japanese learner's Yomitan install.
  const src = (index?.sourceLanguage ?? 'ja').toLowerCase();
  return src.startsWith('en') ? 'en->ja' : 'ja->en';
}


/**
 * Join two runs of text the way JAPANESE is written.
 *
 * Japanese does not space its words, so a blanket separator puts a gap at every
 * node boundary — and a book marks a boundary at every ruby, every 見出相当部 ━,
 * every emphasis span. A separator is only wanted where BOTH sides are
 * Latin/digits, so `Homarus americanus` stays spaced and the Japanese closes up.
 */
export function joinRun(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  const x = a[a.length - 1], y = b[0];
  return /[A-Za-z0-9]/.test(x) && /[A-Za-z0-9]/.test(y) ? `${a} ${b}` : a + b;
}

/** Flatten a structured-content tree (or plain string) to readable text. */
export function flattenContent(node: unknown, sep = ''): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n) => flattenContent(n, sep)).filter(Boolean).join(sep);
  const o = node as { tag?: string; content?: unknown; text?: string };
  // FURIGANA IS NOT TEXT. `<ruby>学<rt>がっ</rt></ruby>` concatenated to `学がっ`,
  // so 明鏡's `人・物・時などが来ることや` was stored as
  // `人 ひと ・ 物 もの ・ 時 とき などが 来 く ることや` — the reading spliced into
  // the word it annotates, in every book that ships ruby. `rt` is the reading
  // and `rp` its parenthesis fallback; neither belongs in the run of text.
  if (o.tag === 'rt' || o.tag === 'rp') return '';
  if (typeof o.text === 'string') return o.text;
  // block-ish tags read better with a separator so senses do not run together
  const blocky = o.tag === 'div' || o.tag === 'li' || o.tag === 'br' || o.tag === 'ul' || o.tag === 'ol';
  return flattenContent(o.content, blocky ? ' ' : sep).trim();
}

/**
 * `flattenContent`, but spaced the way Japanese is written (`joinRun`).
 *
 * For the text a ROLE captures, every node boundary is a boundary the book drew
 * for typesetting, not a word break: 三省堂 marks the headword stand-in ━ and
 * each 用例 as its own span, so flattening its 用例G with a blanket " " gave
 * `「 郵便物を ━ ・ 春の おとずれを ━ 」` — the book's own example, respaced by us.
 * The whole-node `rest` path has always joined this way; this is the same rule
 * on the road the roles take.
 */
export function flattenRun(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenRun).reduce(joinRun, '');
  const o = node as { tag?: string; content?: unknown; text?: string };
  if (o.tag === 'rt' || o.tag === 'rp') return '';
  if (typeof o.text === 'string') return o.text;
  return flattenRun(o.content).trim();
}

/**
 * Every name a node carries, for matching against a profile.
 *
 * The books in the user's export use THREE different conventions for the same
 * idea, all found by reading the real trees:
 *   • `data.class`   — 新英和 (`.level2`), 大辞泉 (`.L3`), Oxford (`.類語定義`)
 *   • `data.content` — Yomitan's own spec, used by Jitendex (`sense`, `glossary`)
 *   • data object KEYS   — プログレッシブ (`{"p":"","meaning":""}`, `{"hinshi":""}`)
 *   • data object VALUES — 大辞林 (`{"name":"大語義"}`, `{"name":"品詞"}`)
 *
 * Reading all four through one function is what lets ONE walker serve every
 * dictionary, and what keeps a profile a plain list of names rather than code.
 * Values are included last so an explicit `class`/`content` always wins.
 */
export function marksOf(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const d = (node as Record<string, unknown>).data;
  if (!d || typeof d !== 'object') return [];
  const rec = d as Record<string, unknown>;
  const out: string[] = [];
  const cls = typeof rec.class === 'string' ? rec.class : '';
  if (cls) out.push(cls);
  if (typeof rec.content === 'string') out.push(rec.content);
  // When the node STATES a class, that class is its name. Yomitan's converter
  // also emits every class TOKEN as its own data key, so `class="L3 bold small
  // IM"` arrives carrying a key literally named `L3` — which matched 大辞泉's
  // `senseAt: ['L3']` and turned a printed sense number into a sense (the bare
  // "1" and "2" after the real senses of やや). Keys are only a naming
  // convention for the books that have no class at all — プログレッシブ's
  // `{"p":"","meaning":""}` and 大辞林's `{"name":"大語義"}` are untouched.
  if (!cls) for (const k of Object.keys(rec)) out.push(k);
  for (const v of Object.values(rec)) if (typeof v === 'string' && v) out.push(v);
  return out;
}

/**
 * SPLIT a structured-content tree into senses (DESIGN §27.4, Pass 2).
 *
 * The old adapter asked for `data.content === 'glossary'` blocks and, finding
 * none, flattened the ENTIRE tree into one string. For Jitendex that worked;
 * for every other book in the user's export it produced one "sense" holding the
 * whole article — 新英和's `wait` came out as a single 2,967-character gloss,
 * and the survey showed literally every dictionary in the vault reporting 1.0
 * senses per entry.
 *
 * The real trees, read off the 11.9GB export, mark senses in four different
 * ways, so this tries them in order of how much the SOURCE actually tells us:
 *
 *   1. the book's own class vocabulary (`profile.senseAt`) — 新英和 `.level2`,
 *      大辞泉 `.L3`, the Oxford thesaurus `.類語定義`;
 *   2. Yomitan's semantic roles (`data.content: 'sense' | 'sense-group'`) —
 *      Jitendex and anything following the spec;
 *   3. list structure — one sense per `<li>`;
 *   4. top-level block children — better than one blob for the books that mark
 *      nothing at all (用例.jp, 大辞林).
 *
 * Never invents a division: if none of the four finds one, the caller gets a
 * single sense and the entry is honestly flat.
 */
export function splitSenseNodes(node: unknown, profile?: TreeProfile): unknown[] {
  const marks = new Set(profile?.senseAt ?? []);

  const collect = (n: unknown, want: (o: Record<string, unknown>) => boolean, out: unknown[]): unknown[] => {
    if (n == null) return out;
    if (Array.isArray(n)) { for (const c of n) collect(c, want, out); return out; }
    if (typeof n !== 'object') return out;
    const o = n as Record<string, unknown>;
    if (want(o)) { out.push(o); return out; }        // a sense does not nest
    collect(o.content, want, out);
    return out;
  };

  // 1. the book's own vocabulary
  if (marks.size) {
    const roles = profile?.roles ?? {};
    const hits = collect(node, (o) => {
      const ms = marksOf(o);
      // A node the book marks `skip` can never OPEN a sense. 大辞泉's printed
      // sense number carries `class="L3 bold FM"` and also a data KEY named
      // `L3` — and the key matched `senseAt`, so the number itself became a
      // sense: the bare "1" and "2" sitting after the real senses of やや.
      if (ms.some((m) => roles[m] === 'skip')) return false;
      return ms.some((m) => marks.has(m));
    }, []);
    if (hits.length) return hits;
  }
  // 2. Yomitan's semantic roles
  const roleHits = collect(node, (o) => {
    const m = (o.data as Record<string, string> | undefined)?.content;
    return m === 'sense' || m === 'sense-group';
  }, []);
  if (roleHits.length) return roleHits;
  // 3. list items
  const li = collect(node, (o) => o.tag === 'li', []);
  if (li.length > 1) return li;
  // 4. block children — descending through single wrappers first.
  // Almost every export wraps the article in one outer <div>, so checking only
  // the top level found one node and gave up; the senses are its children.
  const BLOCK = ['div', 'ul', 'ol', 'p', 'section'];
  let level: unknown[] = Array.isArray(node) ? node : [node];
  for (let depth = 0; depth < 6; depth++) {
    const blocks = level.filter((n) => n && typeof n === 'object'
      && BLOCK.includes(String((n as Record<string, unknown>).tag ?? '')));
    if (blocks.length > 1) return blocks;
    const only = level.length === 1 ? level[0] : blocks.length === 1 ? blocks[0] : null;
    if (!only || typeof only !== 'object') break;
    const inner = (only as Record<string, unknown>).content;
    if (inner == null) break;
    level = Array.isArray(inner) ? inner : [inner];
  }
  return [node];
}

/**
 * Pull the text of every node the profile gives `role`, and return the rest of
 * the sense's text with those nodes removed — so a `pos` or an `example` is
 * lifted OUT of the gloss instead of being duplicated inside it.
 */
export function harvestRoles(
  node: unknown, profile: TreeProfile | undefined,
): { rest: string; got: Partial<Record<TreeRole, string[]>> } {
  const roles = profile?.roles ?? {};
  const got: Partial<Record<TreeRole, string[]>> = {};
  const keep: string[] = [];

  const visit = (n: unknown): void => {
    if (n == null) return;
    if (Array.isArray(n)) { for (const c of n) visit(c); return; }
    if (typeof n === 'string') { if (n.trim()) keep.push(n); return; }
    if (typeof n === 'number') { keep.push(String(n)); return; }
    if (typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    // Yomitan renders a collapsible example block as <details><summary>例文３件.
    // That summary is a COUNT LABEL for a UI affordance, and gluing it into the
    // gloss is what put the user's `例文NN件` markers mid-paragraph. Dropped only
    // when it really is a bare count: the same books also use <summary> for
    // headword variants (擬音語's `ああんと`, `あんぐりと`) and for section labels
    // (`Usage`, `文型 & コロケーション`), which are content and must survive.
    // Furigana again, on the OTHER road out of the tree. `flattenContent`
    // already drops `rt`, but this walker collects raw strings itself — so
    // 明鏡's `<ruby><rb>人</rb><rt>ひと</rt></ruby>` still arrived as `人 ひと`,
    // and every kanji in the book carried its reading spliced in after it.
    if (o.tag === 'rt' || o.tag === 'rp') return;
    if (o.tag === 'summary' && isCountLabel(flattenContent(o.content, ' '))) return;
    let role: TreeRole | undefined;
    for (const m of marksOf(o)) { if (roles[m]) { role = roles[m]; break; } }
    if (role) {
      if (role === 'skip') return;                     // dropped entirely
      // The two example HALVES keep the blanket separator, and only they.
      //
      // Their captured text is the one thing here that gets re-read afterwards:
      // ライトハウス prints the syntactic pattern and the sentence inside a single
      // ExJapanese block, marking the boundary with a node
      // (`<span bunkei>V＋with＋名</span> 著者の述べていることは…`) and nothing else.
      // Joined the Japanese way that boundary vanishes, the frame lift downstream
      // has nothing to cut on, and `V＋with＋名著者の述べている…` ships as the
      // sentence. Everywhere else a node boundary is typesetting, not a word
      // break — see `joinRun` — so everywhere else closes up.
      const t = (role === 'example-en' || role === 'example-ja'
        ? flattenContent(o.content, ' ') : flattenRun(o.content)).trim();
      if (t) (got[role] ??= []).push(t);
      // 'sense' is a container: its own text still belongs to this sense.
      if (role !== 'sense') return;
    }
    visit(o.content);
  };
  visit(node);
  // Japanese does not space its words. Each `<ruby>` is its own node, so
  // joining the collected runs with " " turned 明鏡's 人・物・時などが来ることや into
  // `人 ・ 物 ・ 時 などが 来 ることや` — a space at every kanji that carried a
  // reading. `joinRun` is the rule; the role capture above uses it too.
  const joined = keep.reduce((s, p) => {
    if (!s) return p;
    const a = s[s.length - 1], b = p[0];
    return /[A-Za-z0-9]/.test(a) && /[A-Za-z0-9]/.test(b) ? `${s} ${p}` : s + p;
  }, '');
  // Squeeze HORIZONTAL whitespace only. The old `/\s{2,}/g → ' '` also ate
  // newlines, and `keep.join(' ')` guarantees a space lands next to every one of
  // them — so every "。\n" became "。 " and the newline split on the very next
  // line of adaptGenericEntry had nothing left to split on. That single
  // character class is why 擬音語・擬態語辞典 stayed one 412-char sense through a
  // full re-conversion while its source tree carried six explicit separators.
  const rest = joined
    .replace(/[^\S\n]+/g, ' ')       // runs of spaces/tabs → one space
    .replace(/ ?\n[ \n]*/g, '\n')    // keep the break, drop padding around it
    .trim();
  return { rest, got };
}

/** `例文３件` / `用例12件` — a count label, not lexical content. */
export function isCountLabel(text: string): boolean {
  return /^[^\d\n]{0,8}[0-9０-９]+\s*件$/.test(String(text ?? '').trim());
}

/** The two circled-number runs Japanese dictionaries number senses with. */
const CIRCLED_RUNS = ['①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳', '❶❷❸❹❺❻❼❽❾❿'];

/**
 * Split on the book's OWN sense numbers — ①②③ / ❶❷❸.
 *
 * Read off the export rather than assumed: 大辞林, 三省堂国語, 明鏡, 新選国語,
 * 旺文社漢字典 and 擬音語 all number senses this way, and most of them contain no
 * newline at all — so the newline default could never reach them and they stayed
 * one paragraph (大辞林: 334,748 headwords at 1.2 senses each, max gloss 2,143).
 *
 * Only a run that starts at ① and stays CONSECUTIVE counts. A stray ③ quoted
 * inside a definition cannot open a sense, so this reads the dictionary's own
 * numbering instead of guessing at a delimiter — the same bar the newline
 * default has to clear.
 */
export function splitCircled(text: string): string[] {
  const s = String(text ?? '');
  for (const run of CIRCLED_RUNS) {
    if (!s.includes(run[0]) || !s.includes(run[1])) continue;
    const cuts: number[] = [];
    let next = 0;
    for (let i = 0; i < s.length && next < run.length; i++) {
      if (s[i] === run[next]) { cuts.push(i); next++; }
    }
    if (cuts.length < 2) continue;
    const out: string[] = [];
    const lead = s.slice(0, cuts[0]).trim();
    if (lead) out.push(lead);                       // headword apparatus before ①
    for (let i = 0; i < cuts.length; i++) {
      const chunk = s.slice(cuts[i], cuts[i + 1] ?? s.length).trim();
      if (chunk) out.push(chunk);
    }
    if (out.length > 1) return out;
  }
  return [s];
}

/** The bare part-of-speech markers a kokugo entry opens with. Closed set. */
const BARE_POS = new Set([
  '名', '代', '動', '形', '形動', '副', '接', '助', '感', '連体', '接頭', '接尾',
  '自', '他', '数', '前', '冠', '略',
]);

/**
 * Is this chunk only grammatical apparatus — no lexical content of its own?
 *
 * The text before ① is usually the headword's part of speech (明鏡 `［他五］`,
 * 新選 `名`), sometimes just noise (大辞林 `（ ）`, ライトハウス `1`). Left alone it
 * becomes a first "sense" that defines nothing. Measured on the real export:
 * 5 of 67 multi-sense entries opened with one.
 *
 * SHORTNESS IS NOT THE TEST. A first cut stripped brackets and digits and
 * called anything ≤3 characters apparatus — which swallowed 新英和's real sense
 * `1 待つ`, because `待つ` is two characters. What actually marks apparatus is
 * that it is bracketed, or carries no word at all, or is one of a closed set of
 * bare POS markers. Everything else is content and stays a sense (§28 S6).
 */
export function isApparatusOnly(text: string): boolean {
  const s = String(text ?? '').trim();
  if (!s) return false;
  // No word in it at all — 大辞林's `（ ）`, ライトハウス's `1`.
  if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(s)) return true;
  // A wholly bracketed grammar label — 明鏡's `［他五］`, `〘名・自サ変〙`.
  if (/^[［[(（〘〔【]/.test(s) && /[］\])）〙〕】]$/.test(s) && s.length <= 12) return true;
  return BARE_POS.has(s);
}

/**
 * Turn a leading apparatus-only "sense" into the part of speech of the ones
 * that follow it.
 *
 * Applied to BOTH roads out of the walker, because the same lead-in arrives by
 * either: 明鏡 makes `［他五］` its own `.level0` NODE, while ライトハウス leaves
 * `1` as TEXT before the first ❶. Only ever demotes — the lead's own `pos`
 * wins if it had one, and a list of one is returned untouched, so an entry that
 * *is* a bare `［名］` is never emptied out.
 */
export function liftLeadPos(list: DictSense[]): DictSense[] {
  if (list.length < 2 || !isApparatusOnly(list[0].gloss)) return list;
  const pos = list[0].pos
    ?? list[0].gloss.replace(/^[［[(（]|[］\])）]$/g, '').trim();
  if (!pos) return list.slice(1);
  return list.slice(1).map((s) => (s.pos ? s : { ...s, pos }));
}

/**
 * How a book divides senses in its TEXT, when its tree divided nothing.
 *
 * Order is by how loudly the source says it: an explicit per-book separator,
 * then the author's own sense numbers, then their line breaks. Never invents a
 * division — a text with none comes back as one chunk (§28 S6).
 */
export function splitSenseText(text: string, re?: RegExp): string[] {
  const s = String(text ?? '');
  if (re) {
    const byRe = s.split(re).map((x) => x.trim()).filter(Boolean);
    if (byRe.length > 1) return byRe;
  }
  const byNum = splitCircled(s);
  if (byNum.length > 1) return byNum.flatMap((c) => refineChunk(c, 0));
  return s.split(/\n+/).map((x) => x.trim()).filter(Boolean);
}

/**
 * A chunk that is STILL a wall of text after one division gets the next one.
 *
 * Two real cases, neither reachable by a single pass:
 *  • エースクラウン uses TWO numbering runs in one entry — ❶❷❸ for the senses and
 *    ①②③ for the 成句 below them. Splitting on ① alone left the whole ❶❷❸❹ run
 *    inside one 812-character lead.
 *  • Sanseido WISDOM ships 12,015-character CSV rows that happen to contain a
 *    ①, so numbering pre-empted the newline split its senses actually need —
 *    max gloss went 78 → 11,013 until this refined it back.
 *
 * Refining only subdivides a division the source already made, so it cannot
 * invent one; the size gate and depth cap keep it from chasing its own tail.
 */
function refineChunk(chunk: string, depth: number): string[] {
  if (chunk.length <= FLATTENED_GLOSS_CHARS) return [chunk];
  if (depth < 2) {
    const again = splitCircled(chunk);          // the OTHER numbering run
    if (again.length > 1) return again.flatMap((c) => refineChunk(c, depth + 1));
  }
  const lines = chunk.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  return lines.length > 1 ? lines : [chunk];
}

const tagOf = (o: Record<string, unknown>): string => String(o.tag ?? '');

/** Every child of `o` as an array, whatever shape `content` is in. */
const kidsOf = (o: Record<string, unknown>): unknown[] => {
  const c = o.content;
  if (c == null) return [];
  return Array.isArray(c) ? c : [c];
};

/** Depth-first search for the first descendant satisfying `want`. */
function findNode(
  n: unknown, want: (o: Record<string, unknown>) => boolean,
): Record<string, unknown> | null {
  if (n == null) return null;
  if (Array.isArray(n)) {
    for (const c of n) { const hit = findNode(c, want); if (hit) return hit; }
    return null;
  }
  if (typeof n !== 'object') return null;
  const o = n as Record<string, unknown>;
  if (want(o)) return o;
  return findNode(o.content, want);
}

/** Every descendant satisfying `want`, without descending into a match. */
function findAll(
  n: unknown, want: (o: Record<string, unknown>) => boolean, out: Array<Record<string, unknown>> = [],
): Array<Record<string, unknown>> {
  if (n == null) return out;
  if (Array.isArray(n)) { for (const c of n) findAll(c, want, out); return out; }
  if (typeof n !== 'object') return out;
  const o = n as Record<string, unknown>;
  if (want(o)) { out.push(o); return out; }
  findAll(o.content, want, out);
  return out;
}

/**
 * Read a `<table>` as a COMPARISON — the relation the flat model could not hold.
 *
 * 類語例解's 類語対比表 is a real HTML table: the header row is the publisher's
 * FRAMES with the slot already written in (「私には…むずかしい」), each body row is
 * a candidate surface, and each cell is its ○/△/− judgement. Oxford's 類語スケール
 * is the same relation in the same tag. Kept verbatim — a judgement is the
 * publisher's own token, never normalized into a score.
 */
export function readComparison(table: unknown): ComparisonTable | null {
  const rows = findAll(table, (o) => tagOf(o) === 'tr');
  if (rows.length < 2) return null;
  const cellsOf = (tr: Record<string, unknown>): Array<{ head: boolean; text: string }> =>
    findAll(tr, (o) => tagOf(o) === 'th' || tagOf(o) === 'td')
      .map((c) => ({ head: tagOf(c) === 'th', text: flattenContent(c.content, ' ').trim() }));

  const head = cellsOf(rows[0]);
  // A leading empty corner cell is the row-label column, not a frame.
  const cols = head.slice(head.length && !head[0].text ? 1 : 0).map((c) => c.text);
  // A comparison compares across at least two dimensions. Jitendex ships a
  // one-column READINGS table (官物: ①→かんぶつ, ＊→かんもつ) which satisfies
  // every other test here and is not a comparison at all.
  if (cols.length < 2) return null;

  const body: ComparisonTable['rows'] = [];
  for (const tr of rows.slice(1)) {
    const cs = cellsOf(tr);
    if (cs.length < 2) continue;
    body.push({ item: cs[0].text, cells: cs.slice(1).map((c) => c.text) });
  }
  // Not every table is a comparison. Jitendex ships a one-row FORMS table
  // (columns ∅ / 稍 / 漸 for やや) whose cells are empty — reading that as a
  // judgement matrix would assert a comparison the book never made. A real
  // comparison judges at least two items and actually fills its cells.
  if (body.length < 2) return null;
  const filled = body.reduce((n, r) => n + r.cells.filter((c) => c).length, 0);
  if (filled < body.length) return null;
  return { cols, rows: body };
}

/**
 * Read a `<ul>` as a MEMBER SET — the 語群 a thesaurus entry compares.
 *
 * 類語例解's 使い方 lists each synonym as `<li><a>ちょっと</a><span>[副]</span>…`.
 * Rendering those five as five "senses" is what made the entry unreadable; they
 * are one set, and the set is the unit.
 */
export function readMembers(list: unknown): MemberItem[] {
  const out: MemberItem[] = [];
  for (const li of findAll(list, (o) => tagOf(o) === 'li')) {
    const link = findNode(li, (o) => tagOf(o) === 'a');
    const text = flattenContent(link?.content ?? null, ' ').trim();
    if (!text) continue;
    // Everything after the link: a POS in brackets, then any gloss.
    const rest = flattenContent(li.content, ' ').replace(text, '').trim();
    // A MEMBER is a lexical item. 用例.jp links the SOURCE WORK of each
    // citation (`ミラー／大久保康雄訳『南回帰線(下)』`), which satisfies "has a
    // link" and is not a word at all — reading those as a 語群 asserted a
    // synonym set made of book titles.
    if (text.length > 12 || /[『』（）()／]/.test(text)) continue;
    const pos = /^[［[(（]?\s*([^\]］)）]{1,8})\s*[］\])）]/.exec(rest)?.[1]?.trim();
    const gloss = (pos ? rest.slice(rest.indexOf(pos) + pos.length + 1) : rest)
      .replace(/^[］\])）\s]+/, '').trim();
    out.push({ text, ...(pos ? { pos } : {}), ...(gloss ? { gloss } : {}) });
  }
  return out;
}

/**
 * Build an entry's RELATION TREE.
 *
 * The shape is read from the TAG and the label from the SOURCE, which is why
 * this needs almost no per-book data: `<table>` is always a comparison,
 * `<details>` is always a titled section, `<ol>` is always ordered distinctions.
 * An unprofiled dictionary therefore gets its structure too — the profile only
 * has to supply names the tag cannot give (a `div` that is really a section).
 */
export function buildNodes(node: unknown, depth = 0, head = '', profile?: TreeProfile): EntryNode[] {
  const out: EntryNode[] = [];
  if (node == null || depth > 12) return out;
  if (Array.isArray(node)) {
    for (const c of node) out.push(...buildNodes(c, depth, head, profile));
    return out;
  }
  if (typeof node !== 'object') return out;
  const o = node as Record<string, unknown>;
  const tag = tagOf(o);
  const role = String((o.data as Record<string, string> | undefined)?.content ?? '');

  // ── Yomitan's own semantic roles (Jitendex follows the spec exactly) ──────
  //
  // `sense-group` is a POS GROUPING, not a sense: Jitendex prints ✱particle
  // over ①②, then ✱copula ✱Kansai over ③, numbering CONTINUOUSLY across the
  // groups. Losing the grouping turns eight senses of や into a flat eight.
  if (role === 'sense-group') {
    const tagList = findAll(o, (x) => {
      const r = String((x.data as Record<string, string> | undefined)?.content ?? '');
      // dialect-info is what prints Jitendex's green `Kansai` badge — leaving
      // it out dropped exactly the label that says WHO says it (§27.1 register).
      return r === 'part-of-speech-info' || r === 'misc-info' || r === 'dialect-info';
    }).map((x) => flattenContent(x.content, ' ').trim()).filter(Boolean);
    // One badge per group: `Kansai` is printed on each sense that carries it,
    // and repeating it in the group header says nothing extra.
    const seenTag = new Set<string>();
    const tags = tagList.filter((t) => !seenTag.has(t) && seenTag.add(t));
    const children = buildNodes(o.content, depth + 1, head, profile)
      .filter((c) => !(c.shape === 'prose' && tags.includes(c.text ?? '')));
    if (children.length) {
      out.push({ shape: 'pos-group', ...(tags.length ? { tags } : {}), children });
      return out;
    }
  }

  // A `sense` holds a `glossary` of ALTERNATIVE renderings — Yomitan prints
  // them `a little | partially | somewhat`, one sense with several ways to say
  // it, not several senses. Its `extra-info` carries the note / see-also /
  // example boxes that belong to THIS sense and nothing else.
  if (role === 'sense') {
    const gl = findNode(o, (x) => String((x.data as Record<string, string> | undefined)?.content ?? '') === 'glossary');
    const alts = gl
      ? findAll(gl, (x) => tagOf(x) === 'li').map((li) => flattenContent(li.content, '').trim()).filter(Boolean)
      : [];
    const extra = findNode(o, (x) => String((x.data as Record<string, string> | undefined)?.content ?? '') === 'extra-info');
    const children = extra ? buildNodes(extra.content, depth + 1, head, profile) : [];
    const text = alts.join(' | ') || flattenContent(o.content, ' ').trim();
    if (text || children.length) {
      out.push({ shape: 'senses', ...(text ? { text } : {}), ...(children.length ? { children } : {}) });
      return out;
    }
  }

  // The boxes Yomitan draws beside a sense: a `Note` and a `See also` carrying
  // the target's OWN gloss. Both reuse the closed part vocabulary rather than
  // inventing shapes, so the renderer already knows how to draw them.
  if (role === 'sense-note' || role === 'xref') {
    const pick = (kind: string): string => {
      const n = findNode(o, (x) => String((x.data as Record<string, string> | undefined)?.content ?? '') === kind);
      return flattenContent(n?.content ?? null, ' ').trim();
    };
    const label = pick(role === 'xref' ? 'xref-label' : 'sense-note-label');
    const text = role === 'xref'
      ? [pick('xref-content'), pick('xref-glossary')].filter(Boolean).join(' — ')
      : pick('sense-note-content');
    if (text) {
      out.push({
        shape: 'prose', ...(label ? { label } : {}),
        parts: [{ kind: role === 'xref' ? 'xref' : 'note', text }],
      });
      return out;
    }
  }

  // An example ships as two halves plus provenance — `-a` is the Japanese,
  // `-b` the translation, and `source`/`source-type` a real Tatoeba id.
  if (role === 'example-sentence') {
    const half = (kind: string): string => {
      const n = findNode(o, (x) => String((x.data as Record<string, string> | undefined)?.content ?? '') === kind);
      return flattenContent(n?.content ?? null, '').trim();
    };
    const ja = half('example-sentence-a');
    const en = half('example-sentence-b');
    const d = (o.data ?? {}) as Record<string, string>;
    const cite = d['source-type'] && d.source ? `${d['source-type']}:${d.source}` : '';
    // The book marks the occurrence itself — keep it, so the citation can be
    // shown keyword-in-context rather than as an undifferentiated sentence.
    const kw = findNode(o, (x) =>
      String((x.data as Record<string, string> | undefined)?.content ?? '') === 'example-keyword');
    const hit = flattenContent(kw?.content ?? null, '').trim() || head;
    if (ja || en) {
      out.push({
        shape: 'examples', ...(ja ? { text: ja } : {}), ...(en ? { en } : {}),
        ...(cite ? { cite } : {}), ...(hit ? { hit } : {}),
      });
      return out;
    }
  }

  // The book's own illustration. 新英和 draws Homarus americanus beside sense
  // 1a, and that plate is the definition doing work no gloss can do. Yomitan
  // stores it as a media path; the bytes live in the export's `media` table.
  // 新英和 hangs the media path on a SPAN (`{img:'', src:'pics/L/lobster.jpg'}`)
  // and leaves the `<img>` tag itself empty, so the path — not the tag — is the
  // signal worth keying on.
  {
    const d = (o.data ?? {}) as Record<string, string>;
    const src = String(d.path ?? d.src ?? '').trim();
    if (src && /\.(avif|png|jpe?g|gif|webp|svg)$/i.test(src)) {
      // A GAIJI is not an illustration. 明鏡 ships `gaiji/参考1.svg` — a glyph
      // standing in for a character the font lacks, meant to sit INSIDE a line
      // of text at its size. Presenting it as a plate beside the entry (which
      // is what happened) reads as though the dictionary drew a picture.
      // Nothing here can inline it, so it is dropped rather than misrepresented.
      if (/(^|\/)gaiji\//i.test(src)) return out;
      // Nor is a UI ICON. 大辞泉 draws its pronunciation button with
      // `<span data-audio src="Audio.png">`, which is furniture for a control
      // the entry does not even have here — presenting it as a plate is the
      // same category error as the gaiji. The node says so itself (`audio`).
      //
      // `svg-logo/` is the same furniture wearing a different folder: 三省堂
      // draws its frequency rank as `svg-logo/最重要語.svg` inside the headword
      // block, and that one badge was enough to make the whole 見出部 — reading,
      // accent, 表記, 品詞 — survive as a relation "section" beside the entry.
      if (marksOf(o).includes('audio') || /(^|\/)(audio|icons?|ui|svg-logos?)\//i.test(src)
        || /^(audio|speaker|icon)[\w-]*\.\w+$/i.test(src)) return out;
      out.push({ shape: 'image', src, ...(d.alt ? { text: d.alt } : {}) });
      return out;
    }
  }

  // A member set written INLINE — 大辞泉's 類語 list is `<a>気持ちよい</a>・<a>快い</a>…`
  // hung off `class="C"`, the same relation as Oxford's 類語一覧 in a different
  // wrapper. Left unmapped it was harvested as prose, and 爽快's definition ran
  // on through forty synonyms.
  if (profile?.membersAt?.length && marksOf(o).some((m) => profile.membersAt!.includes(m))) {
    const words = findAll(o, (x) => tagOf(x) === 'a')
      .map((a) => flattenContent(a.content, '').trim())
      .filter((w) => w && w.length <= 12 && !/[『』（）()／]/.test(w));
    if (words.length > 1) {
      // The book labels the set itself (補足ロゴ「類語」); keep its own word.
      const logo = findNode(o, (x) => marksOf(x).includes('補足ロゴ'));
      const label = flattenContent(logo?.content ?? null, '').trim();
      out.push({
        shape: 'members', ...(label ? { label } : {}),
        items: words.map((w) => ({ text: w })),
      });
      return out;
    }
    // The same relation again, in a THIRD wrapper: ライトハウス prints its
    // near-synonym set as a boxed table — one row per word, the word in bold and
    // its nuance in （…）, with the shared Japanese equivalent in a cell of its
    // own. It is not a `comparison` (rows 2..n have a single cell, so
    // `readComparison` rightly refuses to read a judgement matrix into it), and
    // there is no `<a>` anywhere; unread, the whole panel became a "sense" of
    // `interesting` reading `interesting興味や関心をそそるおもしろいamusing…`.
    const rows = findAll(o, (x) => tagOf(x) === 'tr');
    if (rows.length > 1) {
      const items: MemberItem[] = [];
      let head = '';
      for (const tr of rows) {
        for (const cell of findAll(tr, (x) => tagOf(x) === 'td' || tagOf(x) === 'th')) {
          const bold = findNode(cell, (x) => marksOf(x).includes('b'));
          const text = flattenRun(bold?.content ?? null).trim();
          if (!text) {
            // A cell with no bold word is not a member — it is the Japanese
            // equivalent the whole box is about, which is the box's own title.
            if (!head) head = flattenRun(cell.content).trim();
            continue;
          }
          const gloss = flattenRun(cell.content).trim().slice(text.length)
            .replace(/^[\s（(]+|[）)\s]+$/g, '').trim();
          items.push({ text, ...(gloss ? { gloss } : {}) });
        }
      }
      if (items.length > 1) {
        out.push({ shape: 'members', ...(head ? { label: head } : {}), items });
        return out;
      }
    }
  }

  // A SUB-ENTRY pointer — 新明解 prints 爽快味 at the foot of 爽快 as
  // `<div data-subentries="子項目">子<a>爽快味</a>`. The word is the LINK; the 子
  // beside it is the book's name for the relation, which is why this reads the
  // anchor rather than the div's text and why the div arrived as a fourth
  // "sense" of 爽快 reading `子爽快味` while it was unmapped.
  if (profile?.subEntryAt?.length && marksOf(o).some((m) => profile.subEntryAt!.includes(m))) {
    const words = findAll(o, (x) => tagOf(x) === 'a')
      .map((a) => flattenContent(a.content, '').trim())
      .filter(Boolean);
    // No anchor means the book wrote the pointer as plain text; taking the div's
    // own words then would re-admit the `子` label, so nothing is emitted rather
    // than something wrong (§28 S6).
    if (words.length) {
      out.push({ shape: 'derived', items: words.map((w) => ({ text: w })) });
      return out;
    }
  }

  if (tag === 'table') {
    const table = readComparison(o);
    if (table) { out.push({ shape: 'comparison', table }); return out; }
  }

  if (tag === 'details') {
    const summary = findNode(o, (x) => tagOf(x) === 'summary');
    const label = flattenContent(summary?.content ?? null, ' ').trim();
    const body = kidsOf(o).filter((c) => c !== summary);
    const children = buildNodes(body, depth + 1, head, profile);
    out.push({ shape: 'section', ...(label ? { label } : {}), ...(children.length ? { children } : {}) });
    return out;
  }

  if (tag === 'ol') {
    // Yomitan NUMBERS SENSES with an <ol>, so an ordered list is only a set of
    // contrastive distinctions (類語例解's 使い分け) when it does not contain
    // senses. Without this guard Jitendex's ①②③ for や came out as three
    // "distinctions" with their note and see-also boxes melted into the text.
    const holdsSenses = findNode(o, (x) =>
      String((x.data as Record<string, string> | undefined)?.content ?? '') === 'sense');
    const items = holdsSenses ? [] : findAll(o, (x) => tagOf(x) === 'li')
      .map((li) => flattenContent(li.content, ' ').trim()).filter(Boolean);
    if (items.length) {
      out.push({ shape: 'distinctions', children: items.map((t) => ({ shape: 'prose' as const, text: t })) });
      return out;
    }
  }

  if (tag === 'ul') {
    // A set needs more than one member: a single linked <li> is a cross
    // reference (Jitendex's "See also やだ"), not a 語群.
    const items = readMembers(o);
    if (items.length > 1) { out.push({ shape: 'members', items }); return out; }
    // A `<ul>` of SENTENCES with no lexical links is a concordance, not a
    // definition list. 用例.jp is a corpus: each <li> is one attested sentence
    // split `before | やや | after`, i.e. keyword-in-context. Storing those ten
    // citations as ten "senses" is a category error — they are attestations,
    // the evidential tier this plugin is built on (§20.3), and they belong to
    // ONE entry rather than dividing it.
    const cites = findAll(o, (x) => tagOf(x) === 'li').map((li) => {
      // 用例.jp names the work each citation came from; that is provenance and
      // belongs on the citation, not glued to its front.
      const link = findNode(li, (x) => tagOf(x) === 'a');
      const src = flattenContent(link?.content ?? null, '').trim();
      const all = flattenContent(li.content, '').trim();
      const text = src && all.startsWith(src) ? all.slice(src.length).trim() : all;
      return { text, cite: src };
    }).filter((c) => c.text.length > 24);
    if (cites.length > 1) {
      // ATTESTED or merely illustrative? Only the book can say, so it is
      // declared per-dictionary and defaults to `examples` (§20.3).
      const attested = profile?.corpus === true;
      out.push({
        shape: attested ? 'attestations' : 'examples',
        children: cites.map((c) => ({
          shape: 'prose' as const, text: c.text,
          ...(c.cite ? { cite: c.cite } : {}),
          ...(head && c.text.includes(head) ? { hit: head } : {}),
        })),
      });
      return out;
    }
  }

  // A `div` the book NAMED is a section — 類語例解 marks every one of its parts
  // this way (`{"name":"共通する意味"}`, `{"name":"類語対比表"}`).
  const named = typeof (o.data as Record<string, unknown> | undefined)?.name === 'string'
    ? String((o.data as Record<string, string>).name) : '';
  if (named && named !== 'header') {
    const children = buildNodes(o.content, depth + 1, head, profile);
    // The section's own title is repeated as its first text child; drop it.
    const body = children.filter((c) => !(c.shape === 'prose' && c.text === named));
    out.push({ shape: 'section', label: named, ...(body.length ? { children: body } : {}) });
    return out;
  }

  const kids = buildNodes(o.content, depth + 1, head, profile);
  if (kids.length) { out.push(...kids); return out; }

  const text = flattenContent(o.content, ' ').trim();
  if (text) out.push({ shape: 'prose', text });
  return out;
}

/**
 * Read a plain-text entry as a set of DERIVED FORMS.
 *
 * Sanseido WISDOM's 包括 is not nine senses — it is a headword line and three
 * derivations, each with its own part of speech, gloss and examples:
 *
 *   ほうかつ 【包括】
 *   包括的(な) 形容詞          ← derivedAt matches: form + POS
 *   【総合的な】｟やや書｠ comprehensive ; …
 *   ▸ 中東の包括的平和          ← exampleAt: the Japanese half
 *   comprehensive peace in the Middle East.   ← and its translation
 *   包括的に 副詞
 *   …
 *
 * Returns null when the book is not organized this way, so nothing is imposed
 * on a dictionary that does not say it.
 */
export function readDerived(chunks: string[], profile?: TreeProfile): EntryNode | null {
  const at = profile?.derivedAt;
  if (!at) return null;
  const groups: EntryNode[] = [];
  let cur: EntryNode | null = null;
  for (const line of chunks) {
    const m = at.exec(line);
    if (m) {
      cur = { shape: 'senses', label: (m[1] ?? line).trim(), ...(m[2] ? { tags: [m[2].trim()] } : {}) };
      groups.push(cur);
      continue;
    }
    if (!cur) continue;                       // head matter before the first form
    const ex = profile?.exampleAt?.exec(line);
    if (ex && ex.index === 0) {
      (cur.children ??= []).push({ shape: 'examples', text: line.replace(profile!.exampleAt!, '').trim() });
      continue;
    }
    // A line right after an example with no marker of its own is its
    // TRANSLATION — the book puts the pair on two lines and nothing else.
    const last = cur.children?.[cur.children.length - 1];
    if (last && last.shape === 'examples' && !last.en) { last.en = line; continue; }
    cur.text = cur.text ? `${cur.text} ${line}` : line;
  }
  return groups.length > 1 ? { shape: 'derived', children: groups } : null;
}

/**
 * Split an example that the book glued together with no marker between halves.
 *
 * エースクラウン writes `■He is wearing a blue tie today.彼はきょうはブルーの…` —
 * the English sentence runs straight into its translation. The boundary is
 * where Latin ends and Japanese begins, which is unambiguous here precisely
 * because the two scripts cannot overlap.
 */
export function splitGluedPair(s: string): { en?: string; ja?: string } {
  const t = s.trim();
  const m = /^([\s\S]*?[.!?？！])\s*([぀-ヿ一-鿿　-〿][\s\S]*)$/.exec(t);
  if (m) return { en: m[1].trim(), ja: m[2].trim() };
  // Not every example is a sentence: `family ties家族のきずな` is a PHRASE with no
  // terminal punctuation, so fall back to the script boundary itself — the
  // last Latin character before the first run of Japanese.
  const b = /^([\s\S]*[A-Za-z0-9'’)\].\s-]+?)([぀-ヿ一-鿿][\s\S]*)$/.exec(t);
  if (b && /[A-Za-z]/.test(b[1])) return { en: b[1].trim(), ja: b[2].trim() };
  return /[A-Za-z]/.test(t) ? { en: t } : { ja: t };
}

/**
 * Read a plain-text entry as PART-OF-SPEECH SECTIONS.
 *
 * エースクラウン numbers its noun senses ❶❷❸❹ and then starts over at ❶ for the
 * verb, so without the `━ 名` / `━ 動` dividers the two runs collide. Each
 * section becomes a `pos-group`, its senses split by the book's own numbering,
 * and its `■` examples lifted out as EN/JA pairs.
 */
export function readPosSections(text: string, profile?: TreeProfile): EntryNode[] {
  const re = profile?.posSectionAt;
  if (!re) return [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const cuts: Array<{ at: number; end: number; label: string }> = [];
  for (let m = g.exec(text); m; m = g.exec(text)) {
    cuts.push({ at: m.index, end: m.index + m[0].length, label: (m[1] ?? '').trim() });
  }
  if (cuts.length < 2) return [];              // one section is not a division

  const out: EntryNode[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const body = text.slice(cuts[i].end, cuts[i + 1]?.at ?? text.length);
    const senses: EntryNode[] = [];
    // BOTH runs, unconditionally. エースクラウン uses ❶❷❸ for senses and ①②③ for
    // the 成句 beneath them, and `splitSenseText` only reaches the second run
    // when the first chunk is over the flat-text threshold — which `tie`'s verb
    // section is not, so its whole ❶❷❸❹ run stayed inside one lead. Inside a
    // section the book's own numbering is unambiguous, so it always divides.
    const chunks = splitCircled(body).flatMap((c) => splitCircled(c));
    for (const chunk of chunks) {
      const bits = chunk.split(profile?.exampleAt ?? /■/).map((x) => x.trim()).filter(Boolean);
      if (!bits.length) continue;
      const kids = bits.slice(1).map((b) => ({ shape: 'examples' as const, ...splitGluedPair(b) }))
        .map((e) => ({ ...e, text: e.ja ?? e.en ?? '' }));
      senses.push({
        shape: 'senses', text: bits[0],
        ...(kids.length ? { children: kids } : {}),
      });
    }
    if (senses.length) out.push({ shape: 'pos-group', ...(cuts[i].label ? { tags: [cuts[i].label] } : {}), children: senses });
  }
  return out.length > 1 ? out : [];
}

/**
 * Does this node carry a relation the flat sense list could not have held?
 *
 * A tree of nothing but `prose` is exactly what `senses` already stores, and
 * keeping it would double every entry on disk for no gain. Only a comparison,
 * a member set, ordered distinctions, or a titled section containing one of
 * those earns its bytes.
 */
const RELATION_SHAPES = new Set<EntryNode['shape']>([
  'comparison', 'members', 'distinctions', 'attestations', 'derived', 'pos-group', 'image',
]);

export function hasRelation(n: EntryNode, profile?: TreeProfile): boolean {
  if (RELATION_SHAPES.has(n.shape)) return true;
  // An example earns its bytes only once it is a real PAIR or carries
  // provenance — otherwise `senses[].example` already holds it.
  if (n.shape === 'examples' && (n.en || n.cite)) return true;
  // A section the book named for a relation BETWEEN WORDS is the exception to
  // "prose is already in senses[]": 類語例解's 反対語 reaches neither list, so
  // the prose rule was not deduplicating it, it was deleting it.
  if (n.label && profile?.relationAt?.includes(n.label)) return true;
  return (n.children ?? []).some((c) => hasRelation(c, profile));
}

/** Does this node carry any of `marks`, without a `skip` role overriding it? */
function marked(o: Record<string, unknown>, marks: Set<string>, roles: Record<string, TreeRole>): boolean {
  const ms = marksOf(o);
  if (ms.some((m) => roles[m] === 'skip')) return false;
  return ms.some((m) => marks.has(m));
}

/**
 * A sense that has SUB-SENSES, as the book prints it.
 *
 * 新英和's `lobster` is not six senses — it is `1` with `a` ロブスター, `b` イセエビ,
 * `c` ザリガニ, then `2`, `3`, `4`. Flattening the hierarchy loses which
 * readings are varieties of the same thing, which is the entire point of the
 * lettering. `senses[]` keeps every leaf for the index; this keeps the shape.
 */
export function buildSenseTree(
  node: unknown, profile: TreeProfile | undefined, head = '',
): EntryNode[] {
  const senseMarks = new Set(profile?.senseAt ?? []);
  const subMarks = new Set(profile?.subSenseAt ?? []);
  const roles = profile?.roles ?? {};
  if (!senseMarks.size || !subMarks.size) return [];

  // The levels are SIBLINGS, not nested: 新英和 emits `.level2`, then its
  // `.level3` children at the SAME depth, and the hierarchy lives only in the
  // class name. So this walks them in document order and lets a `level2` open a
  // group that the following `level3`s join — reading the sequence the way the
  // page is printed, rather than assuming a containment the tree never had.
  const all = findAll(node, (o) => marked(o, senseMarks, roles));
  const out: EntryNode[] = [];
  let cur: EntryNode | null = null;
  for (const s of all) {
    const { rest, got } = harvestRoles(s, profile);
    if (!rest && !got.example?.length) continue;
    const item: EntryNode = {
      shape: 'senses',
      ...(rest ? { text: rest } : {}),
      ...(got.example?.length
        ? { children: got.example.map((e) => ({ shape: 'examples' as const, text: e, ...(head ? { hit: head } : {}) })) }
        : {}),
    };
    if (marked(s, subMarks, roles) && cur) (cur.children ??= []).push(item);
    else { cur = item; out.push(item); }
  }
  // Only worth storing when the book actually lettered something: a run of
  // top-level senses with no children is just the flat list again.
  return out.some((g) => (g.children ?? []).some((c) => c.shape === 'senses')) ? out : [];
}

/**
 * Yomitan's collapsible example block, matched to the sense it belongs to.
 *
 * `<details><summary>例文５件</summary>…` is how this export ships the examples
 * for a sense — and the block is a SIBLING of the sense node, not a child of it.
 * `splitSenseNodes` returns the senses, so the block was never inside anything
 * the harvest looked at and every sentence in it was dropped: 明鏡 measured 0%
 * examples across 108,388 headwords while its shards held the definitions fine.
 *
 * The pairing is document order, which is the only claim being made — the book
 * prints the examples immediately after the sense they illustrate, so a block
 * belongs to the last sense opened before it. A block appearing before any
 * sense has nothing to attach to and is left alone rather than guessed at.
 *
 * The summary itself is dropped: `例文５件` is a count for a UI affordance, not
 * a sentence (`isCountLabel`, which also protects the books that use `<summary>`
 * for real content like 擬音語's headword variants).
 */
export function detailExamplesBySense(
  root: unknown, senses: unknown[],
): Map<unknown, string[]> {
  const out = new Map<unknown, string[]>();
  if (!senses.length) return out;
  const isSense = new Set(senses);
  let current: unknown = null;

  const walk = (n: unknown): void => {
    if (n == null || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const c of n) walk(c); return; }
    const o = n as Record<string, unknown>;
    if (isSense.has(o)) { current = o; return; }   // a sense does not nest
    if (o.tag === 'details') {
      const kids = Array.isArray(o.content) ? o.content : [o.content];
      const summary = kids.find((c) => c && typeof c === 'object'
        && (c as Record<string, unknown>).tag === 'summary');
      if (summary && isCountLabel(flattenContent(
        (summary as Record<string, unknown>).content, ' '))) {
        const body = kids.filter((c) => c !== summary)
          .map((c) => flattenRun(c)).join('').trim();
        if (body && current) {
          const list = out.get(current) ?? [];
          list.push(body);
          out.set(current, list);
        }
        return;                                    // consumed, summary and all
      }
    }
    walk(o.content);
  };
  walk(root);
  return out;
}

/** Collect the text of every node whose data.content matches `kind`. */
export function pickByDataContent(node: unknown, kind: string, out: string[] = []): string[] {
  if (node == null) return out;
  if (Array.isArray(node)) { for (const n of node) pickByDataContent(n, kind, out); return out; }
  if (typeof node !== 'object') return out;
  const o = node as { data?: Record<string, string>; content?: unknown };
  if (o.data?.content === kind) {
    const t = flattenContent(o.content, ' ').trim();
    if (t) out.push(t);
    return out;                       // do not descend into a matched block
  }
  pickByDataContent(o.content, kind, out);
  return out;
}

/**
 * Adapt one tuple from any Yomitan dictionary.
 *
 * Senses come from `glossary` entries; a `structured-content` value is walked,
 * a plain string is taken as-is, and a deinflection tuple is skipped (it is
 * grammar plumbing, never a definition).
 */
export function adaptGenericEntry(
  tuple: EijiroTuple,
  opts: {
    direction?: Direction;
    evocativeHead?: (s: string) => boolean;
    /** the book's tree vocabulary; omit for the honest generic walk. */
    tree?: TreeProfile;
  } = {},
): DictHeadword {
  const [expression, reading, defTags, rules, , glossary, sequence] = tuple;
  const dir = opts.direction ?? 'ja->en';

  const senses: DictSense[] = [];
  const relations: EntryNode[] = [];
  // A plain-string glossary has no tree to walk, but it still has the author's
  // own line breaks. Sanseido WISDOM is CSV-derived and ships ONE 12,015-char
  // string per entry; skipping the split here is why it stayed a wall of text
  // through a full re-conversion while every structured book improved.
  const splitPlain = (text: string): void => {
    const chunks = splitSenseText(text, opts.tree?.splitText);
    // A book organized by DERIVATION rather than by sense says so in its own
    // line shapes; reading it as senses produced nine unrelated fragments.
    const derived = readDerived(chunks, opts.tree);
    if (derived) relations.push(derived);
    // A plain-text book whose only surviving structure is typographic: the
    // `━ 名` / `━ 動` dividers that keep two runs of ❶❷❸ from colliding.
    relations.push(...readPosSections(text, opts.tree));
    for (const c of chunks) senses.push({ gloss: c });
  };
  for (const g of glossary ?? []) {
    if (typeof g === 'string') {
      if (g.trim()) splitPlain(g);
      continue;
    }
    if (Array.isArray(g)) continue;                       // deinflection tuple
    const o = g as { type?: string; text?: string; content?: unknown };
    if (o.type === 'text' && o.text?.trim()) { splitPlain(o.text); continue; }
    if (o.type !== 'structured-content') continue;

    // The relation tree is read from the SAME content, independently of the
    // sense split — a comparison table is not a sense and must not compete to
    // become one. Kept only when it found a relation prose cannot express.
    for (const n of buildNodes(o.content, 0, expression, opts.tree)) {
      if (hasRelation(n, opts.tree)) relations.push(n);
    }
    // The sense HIERARCHY, when the book letters its sub-senses. Read from the
    // same content and kept beside the flat list, never instead of it.
    relations.push(...buildSenseTree(o.content, opts.tree, expression));

    // Yomitan's own marked-up glossary blocks stay the preferred road — that is
    // what Jitendex ships and it is unambiguous.
    const marked = pickByDataContent(o.content, 'glossary');
    const notes = pickByDataContent(o.content, 'extra-info');
    if (marked.length) {
      for (const t of marked) {
        const gloss = t.trim();
        if (!gloss) continue;
        senses.push({ gloss, ...(notes.length ? { note: notes.join(' ') } : {}) });
      }
      continue;
    }

    // Everything else: split into senses first, THEN read each one's roles.
    // This is the whole of Pass 2 — the old code flattened here instead.
    const nodes = splitSenseNodes(o.content, opts.tree);
    // A book that marks nothing structurally still separates senses in its
    // TEXT. Only reached when the tree gave us ONE node — i.e. we are already
    // in blob territory — so a real structural split is never overridden.
    //
    // The newline default is safe in a way a guess would not be: a `\n` inside
    // a definition is a deliberate line break by the dictionary's own author,
    // never decoration. Splitting there can over-segment slightly; it cannot
    // merge two senses or invent a division. That is the right trade against a
    // 12,015-character paragraph (Sanseido WISDOM, a CSV-derived book with no
    // markup at all).
    if (nodes.length === 1) {
      const { rest, got } = harvestRoles(nodes[0], opts.tree);
      const chunks = splitSenseText(rest, opts.tree?.splitText);
      if (chunks.length > 1) {
        const pos = got.pos?.[0];
        // The roles harvested this block's examples before the text split ran,
        // and this branch used to drop them on the floor — 三省堂's 待つ came
        // out as four definitions with every 用例 it prints deleted.
        //
        // The book supplies one example GROUP per sense, in the order it prints
        // them, so an exact 1:1 count is the book's own pairing and nothing is
        // being guessed. Any other count means the correspondence is unknown:
        // attaching the nth to the nth would then claim a sentence illustrates
        // a sense the editors never put it under, so they are left off rather
        // than misfiled (§28 S6, and §12 — never assert machine output).
        const ex = got.example ?? [];
        const paired = ex.length === chunks.length;
        senses.push(...liftLeadPos(chunks.map((c, i) => ({
          gloss: c,
          ...(pos ? { pos } : {}),
          ...(paired && ex[i].trim() ? { example: ex[i].trim() } : {}),
          ...(notes.length ? { note: notes.join(' ') } : {}),
        }))));
        continue;
      }
    }

    // ZIP the example halves the book named separately, ONCE per glossary block.
    //
    // Per sense node was wrong: プログレッシブ hangs `<span {p,example}>` as a
    // SIBLING of its `meaning` nodes, so a per-sense harvest never saw the
    // examples at all and they were dropped outright — glosses clean, sentences
    // gone. Harvesting the whole block finds them wherever the book put them.
    // The nth of one half belongs to the nth of the other.
    {
      const w = harvestRoles(o.content, opts.tree).got;
      const a = w['example-en'] ?? [], b = w['example-ja'] ?? [];
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i]?.trim(), y = b[i]?.trim();
        if (!x && !y) continue;
        // Which half is which is the BOOK's naming, not ours — プログレッシブ puts
        // the English sentence under `jpexam`, so neither side is assumed to be
        // Japanese. Whichever half actually contains kana/kanji is the JA one.
        let jp = [x, y].find((s) => s && /[぀-ヿ一-鿿]/.test(s));
        const other = [x, y].find((s) => s && s !== jp);
        if (!jp && !other) continue;
        // ライトハウス prints the syntactic pattern INSIDE the example block, so
        // it arrived glued to the front of the translation:
        // `V ＋ with ＋ 名 著者の述べていることは事実と一致しない.` That is a FRAME —
        // what the verb combines with — and belongs beside the pair, labelled.
        let label: string | undefined;
        const pat = jp && /^([VSCO](?:\s*[＋+]\s*[^\s＋+]+)+)\s*/.exec(jp);
        if (jp && pat) { label = pat[1].replace(/\s+/g, ''); jp = jp.slice(pat[0].length).trim(); }
        relations.push({
          shape: 'examples',
          ...(jp ? { text: jp } : { text: other! }),
          ...(jp && other ? { en: other } : {}),
          ...(label ? { label } : {}),
          ...(expression ? { hit: expression } : {}),
        });
      }
    }

    // The examples this book hangs BESIDE its senses rather than inside them.
    const asides = detailExamplesBySense(o.content, nodes);

    const block: DictSense[] = [];
    for (const node of nodes) {
      const { rest, got } = harvestRoles(node, opts.tree);
      const aside = (asides.get(node) ?? []).join('').trim();
      // The fallback chain matters: a THESAURUS sense is often a synonym set
      // with no prose definition at all (Oxford's 類語グループ holds a 類語一覧 and
      // nothing else). Reading "no gloss" as "no sense" silently deleted those
      // entries — the adapter reported 0.7 senses per entry, i.e. it was losing
      // them. A sense is empty only when NOTHING was harvested.
      // A book may divide its senses in TEXT even inside a node the tree
      // already separated. 新明解 gives 爽快 two blocks, and the first still
      // holds `一【壮快】…二【爽快】…` — two senses numbered in kanji. The
      // whole-entry text split never reached it because the tree had produced
      // more than one node. Only fires when the profile declares a separator,
      // so it stays per-book data rather than a guess.
      if (opts.tree?.splitNodeText && rest) {
        const parts = splitSenseText(rest, opts.tree.splitNodeText);
        if (parts.length > 1) {
          for (const t of parts) {
            block.push({ gloss: t, ...(got.pos?.[0] ? { pos: got.pos[0] } : {}) });
          }
          continue;
        }
      }
      // A role-harvested example is the book naming it; the aside is the book
      // placing it. Both are the book's own, so both are kept.
      const example = [(got.example ?? []).join(' ').trim(), aside].filter(Boolean).join(' ');
      const gloss = (got.gloss?.join(' ') || rest || got.frame?.join(' ') || '').trim();
      if (!gloss && !example) continue;
      block.push({
        gloss: gloss || example || '',
        ...(got.pos?.[0] ? { pos: got.pos[0] } : {}),
        ...(got.context?.[0] ? { situation: got.context[0] } : {}),
        ...(got.register?.[0] ? { register: got.register[0] } : {}),
        ...(gloss && example ? { example } : {}),
        ...(got.note?.length ? { note: got.note.join(' ') }
          : notes.length ? { note: notes.join(' ') } : {}),
        ...(got.xref?.length ? { xrefs: got.xref } : {}),
      });
    }
    // A CORPUS defines nothing. 用例.jp is one headword and N attested
    // sentences; storing those sentences as ten "senses" states that the book
    // gave ten definitions, and then the same text is rendered twice — once as
    // definitions, once as citations. The citations are the entry.
    if (opts.tree?.corpus && relations.some((n) => n.shape === 'attestations')) continue;
    senses.push(...liftLeadPos(block));
  }

  const posTags = String(defTags ?? '').split(/\s+/).filter(Boolean);
  const evocative = opts.evocativeHead?.(expression) ?? false;

  const reachFor: ReachCandidate[] = [];
  for (const s of senses) {
    // The JAPANESE side is always `surface` — that is the production unit the
    // six classes describe, whichever way the dictionary is pointed.
    const surface = dir === 'ja->en' ? expression : s.gloss;
    const intention = dir === 'ja->en' ? s.gloss : expression;
    if (!surface || !intention) continue;
    const frame = toFrame(surface);
    // Same bar as the Eijiro adapter: an expression earns a place, a bare
    // single-word look-up does not.
    const isExpression = /[\s・…]/.test(surface.trim()) || surface.trim().length >= 4;
    if (frame.fixed && !evocative && !isExpression) continue;
    reachFor.push({
      intention, surface,
      frameKey: frame.key,
      intentionKey: toFrame(intention).key,
      slots: frame.slots.length,
      classHint: classHintForFrame(frame, { evocativeHead: evocative }) as NoteClass,
    });
  }

  return {
    expression,
    ...(reading ? { reading } : {}),
    pos: posTags,
    ...(rules === '人名' ? { kind: 'name' as const } : {}),
    senses,
    ...(relations.length ? { nodes: relations } : {}),
    reachFor, xrefs: [], sequence,
  };
}

export function adaptGenericBank(
  bank: EijiroTuple[],
  opts: {
    direction?: Direction;
    evocativeHead?: (s: string) => boolean;
    tree?: TreeProfile;
    /** dictionary TITLE — looks the tree vocabulary up from the one table. */
    dictionary?: string;
  } = {},
): DictHeadword[] {
  // One row per book, in entry-parts.ts, describes both how it is CONVERTED and
  // how it is READ. Resolving it here means the caller passes a title, never a
  // second copy of the book's vocabulary.
  const tree = opts.tree ?? (opts.dictionary ? profileFor(opts.dictionary).tree : undefined);
  const out: DictHeadword[] = [];
  for (const t of bank) {
    if (!Array.isArray(t) || !t[5]?.length) continue;
    out.push(adaptGenericEntry(t, { ...opts, tree }));
  }
  return out;
}

/**
 * §27.4's registry. 英辞郎 gets its bespoke adapter because its HTML carries
 * production structure (frames, 〔situations〕) that the generic walker would
 * flatten into prose. Everything else gets the generic one — which is a real
 * fallback, not a stub: it produces the same DictHeadword/ReachCandidate shape
 * and lands in the same frame key space.
 */
export function isEijiro(title: string): boolean {
  return /英辞郎|eijiro/i.test(String(title ?? ''));
}
