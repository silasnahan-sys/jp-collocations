/**
 * reading-resolver.ts — turns the imported Yomitan dictionary into the
 * word-level ReadingResolver the reconciler's homophone detection needs.
 *
 * The matcher (local-matcher.ts) is pure and takes an injected resolver so it
 * can run offline (golden set uses a fixture). In the live plugin, this adapter
 * backs it with `DictionaryStore`, so 効く / 利く / 聞く all resolve to きく and a
 * kanji-choice ASR error becomes a confident homophone correction. Degrades to
 * null (→ surface-only) when no dictionary is imported.
 */

import type { DictionaryStore } from '../dictionary/DictionaryStore.ts';
import type { ReadingResolver } from './local-matcher.ts';
import { toHiragana, normalizeJapanese } from '../utils/japanese.ts';

/**
 * Build a memoised resolver. Prefers an exact expression match (so 効く→きく,
 * not a longer entry that merely contains 効く); returns the reading in
 * hiragana, or null when the word is unknown. Yomitan's empty-reading
 * convention (expression is already kana) resolves to the expression itself.
 */
export function makeDictionaryReadingResolver(store: DictionaryStore): ReadingResolver {
  const cache = new Map<string, string | null>();
  return (surface: string): string | null => {
    const key = normalizeJapanese(surface);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    let reading: string | null = null;
    try {
      const results = store.lookup(key);
      if (results.length) {
        const exact = results.find((r) => normalizeJapanese(r.term.expression) === key);
        const pick = exact ?? results[0];
        const raw = pick.term.reading?.trim() || pick.term.expression;
        reading = toHiragana(normalizeJapanese(raw));
      }
    } catch {
      reading = null; // never throw into the pure matcher
    }
    cache.set(key, reading);
    return reading;
  };
}
