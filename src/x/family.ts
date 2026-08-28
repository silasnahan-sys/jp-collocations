/**
 * family.ts — the FORM family of a query term, attested by the corpus.
 *
 * The user's own study walk (2026-08-27 desk screenshots): search
 * 「障害 残って」, then retype the whole query as 「障害 残らない」 to see the
 * other polarity — the hand enumerating inflections one query at a time,
 * which is exactly the work a dictionary layer exists to do. The forms of
 * 残る that MATTER here are not the conjugation table's — they are the ones
 * this corpus actually contains, with counts, so every offered chip is a
 * door that opens onto something.
 *
 * Method, honest by construction:
 *   1. Name the lemma through the SAME oracle the true-hit layer uses
 *      (deinflect + isWord — no second morphology).
 *   2. The stem is the longest common prefix of term and lemma. 残って/残る
 *      → 残. A term whose lemma shares nothing (suppletion, kana flips)
 *      has no walkable stem and answers [] rather than guessing.
 *   3. Scan the corpus for stem occurrences; at each, the LONGEST following
 *      tail (≤6 chars) that deinflects back to the SAME lemma is that
 *      occurrence's surface form. Occurrences whose tail resolves to a
 *      different word (障害 vs 障る — different lemmas on one 障) never
 *      enter the family.
 *
 * PURE — corpus text and oracle injected. Golden: golden/x-pair.mjs.
 */

export interface FamilyOracle {
  deinflect: (s: string) => Array<{ term: string; trail: string[] }>;
  isWord: (s: string) => boolean;
}

export interface FamilyForm {
  /** the attested surface (残らない), never the query term itself. */
  form: string;
  count: number;
}

const MAX_TAIL = 6;
const MAX_FORMS = 8;
/** occurrences examined per corpus pass — breadth, bounded. */
const MAX_OCCURRENCES = 4000;

/** The dictionary form this term resolves to, or the term itself if the
 *  shelf holds it directly; null when the oracle cannot name it. */
export function lemmaOf(term: string, oracle: FamilyOracle): string | null {
  if (!term) return null;
  if (oracle.isWord(term)) {
    // The term may BE a dictionary form already (残る), or an inflected
    // surface the shelf happens to hold. Either way it names itself.
    return term;
  }
  const cands = oracle.deinflect(term)
    .filter((c) => c.term !== term && oracle.isWord(c.term))
    // deinflect overgenerates; shortest trail then shortest term is the
    // established preference (CLAUDE.md invariant 3).
    .sort((a, b) => a.trail.length - b.trail.length || a.term.length - b.term.length);
  return cands[0]?.term ?? null;
}

/**
 * The forms of `term`'s lemma that this corpus attests, counted, the query
 * term itself excluded. `texts` is the raw corpus material (tweet texts).
 */
export function formFamily(
  texts: string[], term: string, oracle: FamilyOracle,
): FamilyForm[] {
  const lemma = lemmaOf(term, oracle);
  if (!lemma) return [];
  const stem = commonPrefix(term, lemma);
  // A one-char kana stem (し from する) matches half the language; require
  // either length ≥2 or a non-kana (kanji) stem char.
  if (!stem || (stem.length < 2 && !/[一-龯]/.test(stem))) return [];

  const counts = new Map<string, number>();
  let seen = 0;
  for (const t of texts) {
    if (seen >= MAX_OCCURRENCES) break;
    let i = t.indexOf(stem);
    while (i >= 0 && seen < MAX_OCCURRENCES) {
      seen++;
      const tail = t.slice(i + stem.length, i + stem.length + MAX_TAIL);
      const form = longestFamilyForm(stem, tail, lemma, oracle);
      if (form && form !== term) counts.set(form, (counts.get(form) ?? 0) + 1);
      i = t.indexOf(stem, i + stem.length || i + 1);
    }
  }
  return [...counts.entries()]
    .map(([form, count]) => ({ form, count }))
    .sort((a, b) => b.count - a.count || a.form.length - b.form.length)
    .slice(0, MAX_FORMS);
}

/** The longest stem+tail-prefix that resolves to `lemma`; null if none. */
function longestFamilyForm(
  stem: string, tail: string, lemma: string, oracle: FamilyOracle,
): string | null {
  for (let n = tail.length; n >= 0; n--) {
    const cand = stem + tail.slice(0, n);
    if (cand.length < stem.length || cand.length < 2) break;
    if (cand === lemma) return cand;
    const back = oracle.deinflect(cand);
    if (back.some((c) => c.term === lemma)) return cand;
  }
  return null;
}

function commonPrefix(a: string, b: string): string {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return a.slice(0, n);
}
