/**
 * saved-queries.ts — running the named-query (phrases.yaml) model.
 *
 * Mirroring the CLI: each SavedQuery's surface variants are fetched
 * *individually* (not OR-combined), and every resulting tweet is tagged with
 * the query's id in `matchedQueries`. The corpus then accrues cross-query
 * provenance, so co-occurrence ("tweets that hit ≥2 of my saved phrases")
 * falls out of XCorpusStore.tweetsMatchingQueries.
 */

import type { XClient } from './XClient';
import type { XCorpusStore } from './XCorpusStore';
import type { SavedQuery, XSearchProduct } from './x-types';
import { emptyQuery } from './x-types';

export interface RunDefaults {
  lang: string;
  product: XSearchProduct;
}

export interface RunResult {
  queryId: string;
  fetched: number;
  added: number;
  errors: string[];
}

/** Pull a tweet id out of a status URL or a bare id string. */
export function extractTweetId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/status(?:es)?\/(\d{6,25})/) ?? s.match(/^(\d{6,25})$/);
  return m ? m[1] : null;
}

/** Run one saved query: fetch each surface variant, tag, merge. */
export async function runSavedQuery(
  client: XClient,
  corpus: XCorpusStore,
  sq: SavedQuery,
  defaults: RunDefaults,
): Promise<RunResult> {
  const result: RunResult = { queryId: sq.id, fetched: 0, added: 0, errors: [] };
  for (const surface of sq.surfaceOr) {
    const s = surface.trim();
    if (!s) continue;
    const q = emptyQuery(sq.lang ?? defaults.lang, defaults.product);
    q.allTerms = [s];
    if (sq.minFaves) q.minFaves = sq.minFaves;
    try {
      const { tweets } = await client.search(q);
      for (const t of tweets) t.matchedQueries = [sq.id];
      result.fetched += tweets.length;
      result.added += corpus.addTweets(tweets);
    } catch (e) {
      result.errors.push(`"${s}": ${(e as Error).message}`);
    }
  }
  return result;
}

/** Run every saved query in sequence (respectful of rate limits). */
export async function runAllSavedQueries(
  client: XClient,
  corpus: XCorpusStore,
  queries: SavedQuery[],
  defaults: RunDefaults,
  onProgress?: (done: number, total: number, current: string) => void,
): Promise<RunResult[]> {
  const out: RunResult[] = [];
  for (let i = 0; i < queries.length; i++) {
    onProgress?.(i, queries.length, queries[i].label);
    out.push(await runSavedQuery(client, corpus, queries[i], defaults));
  }
  return out;
}
