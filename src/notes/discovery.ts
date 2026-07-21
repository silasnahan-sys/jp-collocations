/**
 * discovery.ts — 💡 find the collocations you never wrote down (§21 core).
 * PURE — golden-tested in golden/discovery.mjs.
 *
 * Philosophy: this is NOT a generator of language — it is a counter of YOUR
 * exposure. It chunks the transcripts you actually watched, keeps chunks
 * that recur across MULTIPLE sources, drops everything already in the
 * catalog or previously dismissed, and ranks by how BONDED the pair is.
 * Every discovery arrives as a candidate for the normal classify-capture.
 *
 * The precision floor (§27.x — the foundation for ratification):
 * this is a PRODUCTION lexicon, so a discovery is only worth a human's ✓✕ if
 * it could plausibly be a *reach-for unit* — something whose value exceeds
 * the sum of its parts. Discovery does NOT classify (the six-class decision
 * is human, via ✓✕ — see the sweep/classifier split), but it refuses to
 * surface the things that are categorically NOT reach-for units:
 *   1. Bare サ変 verbs (説明する, 理解する, 存在する) — transparent dictionary
 *      words. They are chunked (for example-span highlighting) but never
 *      surfaced as discoveries; a する-verb becomes interesting only inside a
 *      larger frame, which the NPV shape already catches.
 *   2. Compound-particle mis-parses (人にとって → 人にとう, 私について) —
 *      にとって/について/に対して are particles, not noun+case+verb.
 *   3. Pure-kana verb FRAGMENTS (なう, とう) that only pass the u-row shortcut
 *      with no inflectional evidence — ASR debris, not verbs. Real kana verbs
 *      (かける, する, なる) still pass.
 * Ranking is by ASSOCIATION, not raw frequency: a verb that pairs with many
 * different nouns (する/なる/いる) is a light verb, so its pairs are demoted
 * below verbs that bond with a single noun (手を抜く, 気を遣う). Breadth of
 * recurrence across sources still counts — but genericness no longer wins.
 *
 * Accuracy of the shape itself: discovery deliberately does NOT use the
 * legacy regex extractor (its compound-verb rule slurps particles — 電話をかける
 * came out as 話をかける). One shape is done RIGHT: noun(kanji run) + case
 * particle + verb, where the verb must be deinflect-VALIDATED and is
 * canonicalized to its lemma — so 電話をかけて and 電話をかける count as the
 * same exposure, and non-verbs never produce chunks.
 */

import { deinflect } from '../dictionary/deinflect.ts';
import { normalizeJapanese } from '../utils/japanese.ts';
import type { MatcherLine } from './local-matcher.ts';

export interface DiscoverySource {
  /** transcript path or corpus label (for provenance on the capture). */
  file: string;
  lines: MatcherLine[];
}

export interface Discovery {
  /** canonical surface: noun + particle + verb LEMMA. */
  surface: string;
  /** distinct sources it appeared in. */
  files: number;
  /** total occurrences (all inflections). */
  count: number;
  /** best real occurrence — becomes the capture's example/attestation. */
  example: { file: string; tStartSec: number | null; line: string };
  score: number;
}

const norm = (s: string): string => normalizeJapanese(s).replace(/\s+/g, '');
const U_ROW = /[うくぐすつぬぶむる]$/;
const KANJI = /[㐀-䶿一-鿿]/;
/** noun (1–3 kanji) + case particle + verb (optional kanji head + kana tail) */
const NPV_RE = /([㐀-䶿一-鿿]{1,3})(を|に|が|で)([㐀-䶿一-鿿]?[ぁ-ん]{1,6})/g;
/** suru-verbal noun: exactly 2 kanji + する group (the standard shape —
 *  greedier captures swallow preceding words: 毎日勉強する ≠ a noun). */
const SURU_RE = /([㐀-䶿一-鿿]{2})(する|した|して|しない|します|しよう|すれば)/g;

/** Compound particles that a naive noun+case+verb reader mis-splits into a
 *  fake chunk (人にとって → 人+に+とう). Guarded by exact prefix at the
 *  noun boundary, so real chunks that merely share a particle survive. */
const COMPOUND_PARTICLES = [
  'にとっての', 'にとって', 'については', 'について', 'における', 'においては',
  'において', 'に対して', 'に対する', 'に関して', 'に関する', 'によって', 'により',
  'にわたって', 'にわたる', 'にあたって', 'につれて', 'にしたがって', 'に従って',
  'をめぐって', 'をめぐる', 'を通じて', 'を通して', 'をもって',
];

/** Real pure-kana dictionary-form verbs. Japanese writes a smallish, near-closed
 *  set of verbs in kana, and ASR emits them constantly; everything else that is
 *  kana-only and merely ends in an u-row char (つけてく, いいなう, ですねうぬ,
 *  するぬ) is clause debris the deinflector cannot vouch for. On REAL transcripts
 *  the blind "ends in う-row → trust it" shortcut was the top source of garbage
 *  (§27.x-2), because ASR run-on lines have no punctuation to stop the noun+verb
 *  reader. So a kana-only verb is trusted ONLY if it is in this set; kanji-headed
 *  verbs (組む, 帰る, 入れる) are trusted directly. Fable should grow this set from
 *  the user's ratified data — it is a lexicon stub, deliberately conservative. */
const KANA_VERBS = new Set([
  'する', 'なる', 'ある', 'いる', 'いく', 'くる', 'やる', 'みる', 'える', 'うる',
  'かける', 'かかる', 'つける', 'つく', 'とる', 'のる', 'いれる', 'くれる', 'あげる',
  'もらう', 'あう', 'いう', 'かう',
]);

/** Resolve a verb slice to its dictionary-form lemma, or null if the slice
 *  is not a verb we can vouch for. Longest slice wins; within a slice the
 *  SHORTEST validated lemma wins (real lemmas are shorter than fabrications). */
export function verbLemma(slice: string): string | null {
  for (let end = slice.length; end >= 2; end--) {
    const v = slice.slice(0, end);
    const kanaOnly = !KANJI.test(v);
    // Trust a slice as already-dictionary-form only when it is kanji-headed
    // (組む, 帰る) or a known kana verb (なる, かける). A bare kana tail that
    // merely ends in an u-row kana (つけてく, ですねうぬ) is clause debris — no
    // blind shortcut; it must earn its place through the deinflector below.
    if (U_ROW.test(v) && (!kanaOnly || KANA_VERBS.has(v))) return v;
    // deinflect deliberately OVERGENERATES (上がった → 上がう/上がつ/上がる/上がっる)
    // and assumes a dictionary validates the output; discovery has none, so we
    // approximate: keep only kanji-headed / known-kana candidates and take the
    // SHORTEST — real lemmas (出る, 上がる) are shorter than the mechanical
    // tail-swap fabrications (出まする, 出ましる, 上がっる). Same-length residue
    // (上がう vs 上がる) is irreducible without real morphology — Fable/kuromoji.
    const cands = deinflect(v)
      .map((d) => d.term)
      .filter((t) => U_ROW.test(t) && t.length >= 2 && (KANJI.test(t) || KANA_VERBS.has(t)));
    if (cands.length) return cands.sort((a, b) => a.length - b.length)[0];
  }
  return null;
}

/** One extracted chunk with its parts, so discovery can reason about the
 *  noun/verb bond (association ranking) and drop bare サ変. */
export interface Chunk {
  surface: string;
  kind: 'npv' | 'suru';
  /** noun+particle head (npv only) — the association key's left side. */
  head?: string;
  /** verb lemma (npv only) — the association key's right side. */
  verb?: string;
}

/** All canonical chunks in one line, with parts. Exported for reuse. */
export function chunkLineParts(text: string): Chunk[] {
  const out: Chunk[] = [];
  NPV_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NPV_RE.exec(text)) !== null) {
    // a rejected match must NOT consume its span — a valid chunk may start
    // inside it (先輩に+気を would otherwise eat 気を遣って)
    const retry = m.index + 1;
    // reject a noun that is actually mid-compound (kanji directly before)
    const before = text[m.index - 1] ?? '';
    if (KANJI.test(before)) { NPV_RE.lastIndex = retry; continue; }
    // reject a compound particle mis-read as noun+case+verb (人にとって)
    const rest = text.slice(m.index + m[1].length);
    if (COMPOUND_PARTICLES.some((cp) => rest.startsWith(cp))) { NPV_RE.lastIndex = retry; continue; }
    const lemma = verbLemma(m[3]);
    if (!lemma) { NPV_RE.lastIndex = retry; continue; }
    out.push({ surface: `${m[1]}${m[2]}${lemma}`, kind: 'npv', head: `${m[1]}${m[2]}`, verb: lemma });
  }
  SURU_RE.lastIndex = 0;
  while ((m = SURU_RE.exec(text)) !== null) {
    out.push({ surface: `${m[1]}する`, kind: 'suru' });
  }
  return out;
}

/** All canonical chunk surfaces in one line. Exported for the goldens and
 *  for example-span highlighting (which still wants サ変 spans). */
export function chunkLine(text: string): string[] {
  return chunkLineParts(text).map((c) => c.surface);
}

export interface DiscoverInput {
  sources: DiscoverySource[];
  /** normalized keys already in the catalog (they are NOT discoveries). */
  knownKeys: string[];
  /** normalized surfaces the user dismissed before (never re-propose). */
  dismissed?: string[];
  minFiles?: number;
  minCount?: number;
  limit?: number;
}

export function discoverCollocations(input: DiscoverInput): Discovery[] {
  const known = new Set(input.knownKeys.map(norm));
  const dismissed = new Set((input.dismissed ?? []).map(norm));
  const minFiles = input.minFiles ?? 2;
  const minCount = input.minCount ?? 3;

  interface Acc {
    surface: string;
    verb: string;
    files: Set<string>;
    count: number;
    best: { file: string; tStartSec: number | null; line: string };
  }
  const acc = new Map<string, Acc>();
  // association substrate: how many DISTINCT noun-heads each verb takes. A
  // verb that pairs with many nouns is a light/functional verb (する/なる/いる),
  // so its pairs are transparent and get demoted below single-bond verbs.
  const verbHeads = new Map<string, Set<string>>();

  for (const src of input.sources) {
    for (const line of src.lines) {
      for (const chunk of chunkLineParts(line.text)) {
        // bare サ変 is chunked for span-highlighting but is never a
        // reach-for unit on its own — it does not enter discovery.
        if (chunk.kind !== 'npv') continue;
        const key = norm(chunk.surface);
        if (key.length < 3 || key.length > 12) continue;
        if (known.has(key) || dismissed.has(key)) continue;
        if (chunk.verb && chunk.head) {
          let heads = verbHeads.get(chunk.verb);
          if (!heads) { heads = new Set(); verbHeads.set(chunk.verb, heads); }
          heads.add(chunk.head);
        }
        let a = acc.get(key);
        if (!a) {
          a = { surface: chunk.surface, verb: chunk.verb ?? '', files: new Set(), count: 0, best: { file: src.file, tStartSec: line.tStartSec ?? null, line: line.text } };
          acc.set(key, a);
        }
        a.files.add(src.file);
        a.count++;
      }
    }
  }

  const out: Discovery[] = [];
  for (const a of acc.values()) {
    if (a.files.size < minFiles || a.count < minCount) continue;
    // breadth beats raw frequency (hearing it across many videos = it's part
    // of the language, not one speaker's tic); then divide by the verb's
    // promiscuity so a broadly-heard *specific* bond outranks a broadly-heard
    // *light-verb* pair. spread 1 → ×1, spread 2 → ×0.5, spread 8 → ×0.25.
    const spread = verbHeads.get(a.verb)?.size ?? 1;
    const specificity = 1 / (1 + Math.log2(spread));
    const recurrence = a.files.size * 10 + a.count;
    out.push({
      surface: a.surface,
      files: a.files.size,
      count: a.count,
      example: a.best,
      score: recurrence * specificity,
    });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, input.limit ?? 30);
}
