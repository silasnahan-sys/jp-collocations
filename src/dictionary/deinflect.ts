/**
 * deinflect.ts — rule-based Japanese deinflection (DESIGN §13.4).
 *
 * The dictionary previously had NO deinflection: looking up 食べた or 飲んで
 * found nothing. This module generates candidate dictionary forms by
 * iteratively rewriting the query's tail against a curated rule table
 * (Yomitan's algorithm shape), breadth-first up to MAX_DEPTH hops. It never
 * decides what's a word — it only proposes candidates; the DictionaryStore
 * validates each against its real indexes, so overgeneration is harmless
 * (е.g. える→う fires on 見える but the dictionary rejects 見う… while
 * accepting 見える itself via the exact path).
 *
 * PURE — no Obsidian imports — and golden-tested (golden/deinflect.mjs).
 */

export interface Deinflection {
  /** candidate dictionary form. */
  term: string;
  /** human-readable trail, e.g. ['past'] or ['progressive', 'past']. */
  trail: string[];
}

interface Rule { from: string; to: string; name: string }

/**
 * Every rule is tail-anchored and ALL matching rules fire (breadth-first, not
 * first-match) — 買った yields both 買う (った→う) and 買っる (た→る); the
 * dictionary keeps the first and rejects the second.
 */
const RULES: Rule[] = [
  // ── normalizations that unlock other rules ──
  { from: 'ませんでした', to: 'ます', name: 'polite past negative' },
  { from: 'ましょう', to: 'ます', name: 'polite volitional' },
  { from: 'ました', to: 'ます', name: 'polite past' },
  { from: 'ません', to: 'ます', name: 'polite negative' },
  { from: 'なかった', to: 'ない', name: 'past negative' },
  { from: 'たら', to: 'た', name: 'conditional' },
  { from: 'たり', to: 'た', name: 'alternative' },
  { from: 'だら', to: 'だ', name: 'conditional' },
  { from: 'だり', to: 'だ', name: 'alternative' },

  // ── contractions / auxiliaries → て/で ──
  { from: 'ちゃった', to: 'た', name: 'contraction (〜てしまった)' },
  { from: 'じゃった', to: 'だ', name: 'contraction (〜でしまった)' },
  { from: 'ちゃう', to: 'て', name: 'contraction (〜てしまう)' },
  { from: 'じゃう', to: 'で', name: 'contraction (〜でしまう)' },
  { from: 'ている', to: 'て', name: 'progressive' },
  { from: 'ていた', to: 'て', name: 'progressive past' },
  { from: 'ています', to: 'て', name: 'progressive polite' },
  { from: 'でいる', to: 'で', name: 'progressive' },
  { from: 'でいた', to: 'で', name: 'progressive past' },
  { from: 'でいます', to: 'で', name: 'progressive polite' },
  { from: 'てる', to: 'て', name: 'progressive (contracted)' },
  { from: 'てた', to: 'て', name: 'progressive past (contracted)' },
  { from: 'でる', to: 'で', name: 'progressive (contracted)' },
  { from: 'ておく', to: 'て', name: 'preparatory (〜ておく)' },
  { from: 'とく', to: 'て', name: 'preparatory (contracted)' },
  { from: 'てある', to: 'て', name: 'resultative (〜てある)' },
  { from: 'てみる', to: 'て', name: 'attemptive (〜てみる)' },
  { from: 'てください', to: 'て', name: 'request' },

  // ── godan past / te-form ──
  { from: 'った', to: 'う', name: 'past' }, { from: 'った', to: 'つ', name: 'past' }, { from: 'った', to: 'る', name: 'past' },
  { from: 'いた', to: 'く', name: 'past' }, { from: 'いだ', to: 'ぐ', name: 'past' },
  { from: 'した', to: 'す', name: 'past' },
  { from: 'んだ', to: 'ぬ', name: 'past' }, { from: 'んだ', to: 'ぶ', name: 'past' }, { from: 'んだ', to: 'む', name: 'past' },
  { from: 'って', to: 'う', name: 'te-form' }, { from: 'って', to: 'つ', name: 'te-form' }, { from: 'って', to: 'る', name: 'te-form' },
  { from: 'いて', to: 'く', name: 'te-form' }, { from: 'いで', to: 'ぐ', name: 'te-form' },
  { from: 'して', to: 'す', name: 'te-form' },
  { from: 'んで', to: 'ぬ', name: 'te-form' }, { from: 'んで', to: 'ぶ', name: 'te-form' }, { from: 'んで', to: 'む', name: 'te-form' },

  // ── ichidan past / te-form (dictionary validates) ──
  { from: 'た', to: 'る', name: 'past' },
  { from: 'て', to: 'る', name: 'te-form' },

  // ── negative ──
  { from: 'わない', to: 'う', name: 'negative' }, { from: 'かない', to: 'く', name: 'negative' },
  { from: 'がない', to: 'ぐ', name: 'negative' }, { from: 'さない', to: 'す', name: 'negative' },
  { from: 'たない', to: 'つ', name: 'negative' }, { from: 'なない', to: 'ぬ', name: 'negative' },
  { from: 'ばない', to: 'ぶ', name: 'negative' }, { from: 'まない', to: 'む', name: 'negative' },
  { from: 'らない', to: 'る', name: 'negative' },
  { from: 'ない', to: 'る', name: 'negative' },

  // ── polite (ます attaches to the i-stem) ──
  { from: 'います', to: 'う', name: 'polite' }, { from: 'きます', to: 'く', name: 'polite' },
  { from: 'ぎます', to: 'ぐ', name: 'polite' }, { from: 'します', to: 'す', name: 'polite' },
  { from: 'ちます', to: 'つ', name: 'polite' }, { from: 'にます', to: 'ぬ', name: 'polite' },
  { from: 'びます', to: 'ぶ', name: 'polite' }, { from: 'みます', to: 'む', name: 'polite' },
  { from: 'ります', to: 'る', name: 'polite' },
  { from: 'ます', to: 'る', name: 'polite' },

  // ── desiderative (たい attaches to the i-stem) ──
  { from: 'いたい', to: 'う', name: 'desiderative' }, { from: 'きたい', to: 'く', name: 'desiderative' },
  { from: 'ぎたい', to: 'ぐ', name: 'desiderative' }, { from: 'したい', to: 'す', name: 'desiderative' },
  { from: 'ちたい', to: 'つ', name: 'desiderative' }, { from: 'にたい', to: 'ぬ', name: 'desiderative' },
  { from: 'びたい', to: 'ぶ', name: 'desiderative' }, { from: 'みたい', to: 'む', name: 'desiderative' },
  { from: 'りたい', to: 'る', name: 'desiderative' },
  { from: 'たい', to: 'る', name: 'desiderative' },

  // ── passive / potential / causative ──
  { from: 'われる', to: 'う', name: 'passive' }, { from: 'かれる', to: 'く', name: 'passive' },
  { from: 'がれる', to: 'ぐ', name: 'passive' }, { from: 'される', to: 'す', name: 'passive' },
  { from: 'たれる', to: 'つ', name: 'passive' }, { from: 'なれる', to: 'ぬ', name: 'passive' },
  { from: 'ばれる', to: 'ぶ', name: 'passive' }, { from: 'まれる', to: 'む', name: 'passive' },
  { from: 'られる', to: 'る', name: 'passive/potential' },
  { from: 'わせる', to: 'う', name: 'causative' }, { from: 'かせる', to: 'く', name: 'causative' },
  { from: 'がせる', to: 'ぐ', name: 'causative' }, { from: 'させる', to: 'す', name: 'causative' },
  { from: 'たせる', to: 'つ', name: 'causative' }, { from: 'なせる', to: 'ぬ', name: 'causative' },
  { from: 'ばせる', to: 'ぶ', name: 'causative' }, { from: 'ませる', to: 'む', name: 'causative' },
  { from: 'らせる', to: 'る', name: 'causative' },
  { from: 'させる', to: 'る', name: 'causative' },
  // godan potential (え-row + る)
  { from: 'える', to: 'う', name: 'potential' }, { from: 'ける', to: 'く', name: 'potential' },
  { from: 'げる', to: 'ぐ', name: 'potential' }, { from: 'せる', to: 'す', name: 'potential' },
  { from: 'てる', to: 'つ', name: 'potential' }, { from: 'ねる', to: 'ぬ', name: 'potential' },
  { from: 'べる', to: 'ぶ', name: 'potential' }, { from: 'める', to: 'む', name: 'potential' },
  { from: 'れる', to: 'る', name: 'potential' },

  // ── conditional / volitional ──
  { from: 'えば', to: 'う', name: 'conditional' }, { from: 'けば', to: 'く', name: 'conditional' },
  { from: 'げば', to: 'ぐ', name: 'conditional' }, { from: 'せば', to: 'す', name: 'conditional' },
  { from: 'てば', to: 'つ', name: 'conditional' }, { from: 'ねば', to: 'ぬ', name: 'conditional' },
  { from: 'べば', to: 'ぶ', name: 'conditional' }, { from: 'めば', to: 'む', name: 'conditional' },
  { from: 'れば', to: 'る', name: 'conditional' },
  { from: 'おう', to: 'う', name: 'volitional' }, { from: 'こう', to: 'く', name: 'volitional' },
  { from: 'ごう', to: 'ぐ', name: 'volitional' }, { from: 'そう', to: 'す', name: 'volitional' },
  { from: 'とう', to: 'つ', name: 'volitional' }, { from: 'のう', to: 'ぬ', name: 'volitional' },
  { from: 'ぼう', to: 'ぶ', name: 'volitional' }, { from: 'もう', to: 'む', name: 'volitional' },
  { from: 'ろう', to: 'る', name: 'volitional' },
  { from: 'よう', to: 'る', name: 'volitional' },

  // ── i-adjectives ──
  { from: 'くなかった', to: 'い', name: 'adj past negative' },
  { from: 'くない', to: 'い', name: 'adj negative' },
  { from: 'かった', to: 'い', name: 'adj past' },
  { from: 'ければ', to: 'い', name: 'adj conditional' },
  { from: 'くて', to: 'い', name: 'adj te-form' },
  { from: 'く', to: 'い', name: 'adverbial' },
];

/** Irregulars checked whole-tail (する/くる families). */
const IRREGULAR: Array<{ from: string; to: string; name: string }> = [
  { from: 'しなかった', to: 'する', name: 'negative past (する)' },
  { from: 'しました', to: 'する', name: 'polite past (する)' },
  { from: 'しません', to: 'する', name: 'polite negative (する)' },
  { from: 'しない', to: 'する', name: 'negative (する)' },
  { from: 'します', to: 'する', name: 'polite (する)' },
  { from: 'して', to: 'する', name: 'te-form (する)' },
  { from: 'した', to: 'する', name: 'past (する)' },
  { from: 'できる', to: 'する', name: 'potential (する)' },
  { from: 'される', to: 'する', name: 'passive (する)' },
  { from: 'させる', to: 'する', name: 'causative (する)' },
  { from: 'しよう', to: 'する', name: 'volitional (する)' },
  { from: 'こなかった', to: 'くる', name: 'negative past (くる)' },
  { from: 'こない', to: 'くる', name: 'negative (くる)' },
  { from: 'きます', to: 'くる', name: 'polite (くる)' },
  { from: 'きました', to: 'くる', name: 'polite past (くる)' },
  { from: 'きて', to: 'くる', name: 'te-form (くる)' },
  { from: 'きた', to: 'くる', name: 'past (くる)' },
  { from: 'こられる', to: 'くる', name: 'passive/potential (くる)' },
  { from: 'こさせる', to: 'くる', name: 'causative (くる)' },
  { from: 'こよう', to: 'くる', name: 'volitional (くる)' },
];

const MAX_DEPTH = 4;
const MAX_CANDIDATES = 64;

/**
 * All candidate dictionary forms for `text`, shortest trails first, the input
 * itself excluded. A candidate needs ≥1 char of stem left (rules never consume
 * the whole word).
 */
export function deinflect(text: string): Deinflection[] {
  const out: Deinflection[] = [];
  const seen = new Set<string>([text]);
  let frontier: Deinflection[] = [{ term: text, trail: [] }];

  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const next: Deinflection[] = [];
    for (const cur of frontier) {
      // whole-tail irregulars: only from the raw query (depth 0) — chains are
      // already encoded in the table.
      if (depth === 0) {
        for (const r of IRREGULAR) {
          if (cur.term.endsWith(r.from)) {
            const stem = cur.term.slice(0, -r.from.length);
            const term = stem + r.to;
            if (!seen.has(term)) {
              seen.add(term);
              const d = { term, trail: [r.name] };
              out.push(d);
              // irregulars are terminal — dictionary forms.
            }
          }
        }
      }
      for (const r of RULES) {
        if (!cur.term.endsWith(r.from)) continue;
        const stem = cur.term.slice(0, -r.from.length);
        if (stem.length < 1) continue;
        const term = stem + r.to;
        if (seen.has(term)) continue;
        seen.add(term);
        const d = { term, trail: [...cur.trail, r.name] };
        out.push(d);
        next.push(d);
        if (out.length >= MAX_CANDIDATES) return out;
      }
    }
    frontier = next;
  }
  return out;
}
