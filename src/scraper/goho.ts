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

export interface GohoProfile {
  fetchedAt: number;
  source: string;
  /** co-occurring phrases/collocates, the key itself excluded. */
  collocates: string[];
  /** real corpus example sentences, deduped. */
  examples: string[];
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
