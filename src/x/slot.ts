/**
 * slot.ts — §29 rung 4: the construction boundary (PURE; fixture C).
 *
 * "Is this filler filling this slot?" — the boundary test one scale up from
 * rung 0's word test (§29.1's one move at three scales). Measured 2026-08-25
 * on the live corpus: the 言えば/言うと/言ったら family has 113 occurrences
 * and 27 of them are impostors wearing the frame's clothes — 蒼き狼と言えば
 * is a TOPIC, not a manner — so a table that cannot exclude them is worse
 * than no table. Three cheap tests, NO parser (the plugin's standing bet):
 *
 *   ① one-character left-context cues exclude impostors at the boundary:
 *      preceding と = quotative/topic (かと = rhetorical alternative,
 *      caught as its own cue), preceding そう = lexicalized そう言えば.
 *   ② morphological typing via the injected oracle (deinflect + lookup):
 *      悪く → 悪い's く-form; plus the corpus-taught particles — 結論から,
 *      極論を — which a prescriptive list would have missed (§29.3: the
 *      corpus teaches から and を).
 *   ③ distribution across the frame family: real fillers recur across
 *      言えば/言うと/言ったら; a chained clause appears once, before one.
 *
 * Rows that stay ambiguous are typed 灰 and KEPT, juxtaposed in their own
 * group — the machine offers, never adjudicates (HOLE rule 1, §27.0.2).
 */

import type { Oracle } from './relevance.ts';

/**
 * The frame families this table knows. A TABLE, stated as one: families are
 * corpus-taught, and the first is fixture C's measured 113-occurrence case.
 * `familyOf` answers [anchor] for anything unlisted — a one-member family
 * still gets cues and typing, it just cannot earn the recurrence signal.
 */
const FAMILIES: readonly (readonly string[])[] = [
  ['言えば', '言うと', '言ったら'],
  ['考えると', '考えれば', '考えたら'],
  ['見ると', '見れば', '見たら'],
];

export function familyOf(anchor: string): readonly string[] {
  for (const fam of FAMILIES) if (fam.includes(anchor)) return fam;
  return [anchor];
}

/** The anchor a query is asking the slot question about, if any: the query
 *  IS a family surface, or ends in one (悪く言えば → 言えば). */
export function anchorIn(query: string): string | null {
  const q = query.trim();
  for (const fam of FAMILIES) {
    for (const a of fam) if (q === a || q.endsWith(a)) return a;
  }
  return null;
}

export type FillerType = 'く' | 'に' | 'で' | 'て' | 'から' | 'を' | '語' | '灰';

export interface SlotRow {
  filler: string;
  type: FillerType;
  count: number;
  /** which family surfaces this filler appeared before */
  surfaces: string[];
  /** test ③: seen across ≥2 family surfaces */
  recurring: boolean;
}

export interface Impostor {
  cue: 'と' | 'かと' | 'そう';
  /** the filler-side context that wore the frame's clothes, e.g. 蒼き狼 */
  text: string;
  count: number;
}

export interface SlotTable {
  anchor: string;
  family: readonly string[];
  /** total family occurrences examined (fixture C: 113) */
  occurrences: number;
  /** typed manner rows, count-desc — the table itself */
  rows: SlotRow[];
  /** the 灰 group: kept, juxtaposed, never dropped and never asserted */
  gray: SlotRow[];
  /** excluded by cue, NAMED — an exclusion the hand cannot audit is a verdict */
  impostors: Impostor[];
  /** co-occurrences with the second anchor, when one was asked about */
  coAnchor?: { anchor: string; count: number };
}

/** Boundary that ends a filler walk leftward. */
const FILLER_STOP = /[。．！？!?\n「」（）()【】…‥、,\s]/;
const MAX_FILLER = 12;

/** Walk left from `at` to collect the filler span (never across a boundary). */
function fillerBefore(text: string, at: number): string {
  let start = at;
  while (start > 0 && at - start < MAX_FILLER && !FILLER_STOP.test(text[start - 1])) start--;
  return text.slice(start, at);
}

/**
 * Type one filler morphologically. Particle endings first (the surface says
 * them itself); a く-ending must DEINFLECT to a real word (悪く → 悪い) or
 * it is not an adverbial; a bare dictionary word types 語; everything else
 * is 灰 — honestly ambiguous, never silently dropped.
 */
export function typeFiller(filler: string, oracle: Oracle): FillerType {
  if (!filler) return '灰';
  if (filler.endsWith('から')) return 'から';
  if (filler.endsWith('を')) return 'を';
  if (filler.endsWith('に')) return 'に';
  if (filler.endsWith('で')) return 'で';
  if (filler.endsWith('て') || filler.endsWith('って')) return 'て';
  if (filler.endsWith('く')) {
    // The adverbial may wear a modifier (かなり冷たく): walk the TAILS until
    // one deinflects to a real word — 冷たく → 冷たい proves the く-form
    // whatever precedes it. Same shortest-meaningful-suffix logic as the
    // echo's grow-back, pointed the other way.
    const chars = [...filler];
    for (let i = 0; i < chars.length - 1; i++) {
      const tail = chars.slice(i).join('');
      for (const c of oracle.deinflect(tail)) {
        if (c.term !== tail && oracle.isWord(c.term)) return 'く';
      }
    }
    return '灰';
  }
  if (oracle.isWord(filler)) return '語';
  return '灰';
}

/**
 * Build the slot table for `anchor` over the corpus. Every occurrence of
 * every family surface is examined once; cues exclude BEFORE typing (an
 * impostor must never enter the manner table, however well it would type).
 */
export function slotTable(
  tweets: readonly { text: string }[],
  anchor: string,
  oracle: Oracle,
  opts: { secondAnchor?: string } = {},
): SlotTable {
  const family = familyOf(anchor);
  const rowMap = new Map<string, { type: FillerType; count: number; surfaces: Set<string> }>();
  const impMap = new Map<string, Impostor>();
  let occurrences = 0;
  let co = 0;

  for (const t of tweets) {
    const text = (t.text ?? '').normalize('NFC');
    for (const surface of family) {
      let at = text.indexOf(surface);
      while (at !== -1) {
        occurrences++;
        if (opts.secondAnchor && text.includes(opts.secondAnchor)) co++;

        // ① the cues, at the boundary itself
        const p1 = at > 0 ? text[at - 1] : '';
        const p2 = at > 1 ? text[at - 2] : '';
        const cue: Impostor['cue'] | null =
          p1 === 'と' ? (p2 === 'か' ? 'かと' : 'と')
            : (p2 + p1 === 'そう' ? 'そう' : null);
        if (cue) {
          const ctx = fillerBefore(text, cue === 'そう' ? at - 2 : at - (cue === 'かと' ? 2 : 1));
          const key = `${cue}${ctx}`;
          const e = impMap.get(key);
          if (e) e.count++;
          else impMap.set(key, { cue, text: ctx, count: 1 });
        } else {
          // ② the filler, typed
          const filler = fillerBefore(text, at);
          if (filler) {
            let e = rowMap.get(filler);
            if (!e) { e = { type: typeFiller(filler, oracle), count: 0, surfaces: new Set() }; rowMap.set(filler, e); }
            e.count++;
            e.surfaces.add(surface);
          }
        }
        at = text.indexOf(surface, at + 1);
      }
    }
  }

  // ③ family distribution, then the 灰 partition
  const all: SlotRow[] = [...rowMap.entries()].map(([filler, e]) => ({
    filler,
    type: e.type,
    count: e.count,
    surfaces: [...e.surfaces],
    recurring: e.surfaces.size >= 2,
  }));
  all.sort((a, b) => b.count - a.count || (a.filler < b.filler ? -1 : 1));
  const rows = all.filter((r) => r.type !== '灰');
  const gray = all.filter((r) => r.type === '灰');
  const impostors = [...impMap.values()].sort((a, b) => b.count - a.count);

  return {
    anchor,
    family,
    occurrences,
    rows,
    gray,
    impostors,
    ...(opts.secondAnchor ? { coAnchor: { anchor: opts.secondAnchor, count: co } } : {}),
  };
}
