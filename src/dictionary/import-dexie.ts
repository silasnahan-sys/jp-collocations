/**
 * import-dexie.ts — converting all 36 dictionaries out of Yomitan's single
 * 12.7GB backup (DESIGN §27.4/§27.5).
 *
 * The zip path handles one dictionary at a time and can present each as a
 * `BankSource`. The Dexie backup cannot: it is ONE file holding every
 * dictionary's rows, so the only affordable read is a single sequential pass
 * with the rows routed to their dictionaries as they go
 * (`DictionaryRouter`, bounded).
 *
 * Consequences that shape this file:
 *   • a dictionary's sidecar is reset on its FIRST batch and appended to
 *     afterwards — resetting per batch would erase everything but the last;
 *   • `meta.json` can only be written at the END, when the counts are known;
 *   • progress is reported in BYTES, because the row total is not knowable
 *     until the pass finishes.
 *
 * Everything impure (the file handle) is injected, so the golden drives the
 * real pipeline off a string.
 */

import {
  DexieRowStream, parseRow, parseDictionaryRow, DictionaryRouter, type TermTuple,
} from './dexie-stream.ts';
import { importBatch, sidecarDirFor } from './import-eijiro.ts';
import { writeMeta, DEFAULT_SHARDS, type SidecarIO, type SidecarMeta } from './sidecar.ts';
import { isEijiro, type Direction } from './generic-yomitan.ts';
import type { EijiroTuple } from './eijiro.ts';

/** Chunks of the backup, in order. Node supplies a read stream; the golden a string. */
export type ChunkSource = AsyncIterable<string>;

export interface DexieProgress {
  bytes: number;
  rows: number;
  dictionaries: number;
  /** the dictionary most recently flushed, for the notice line. */
  current: string;
}

export interface DexieImportResult {
  dictionaries: Array<{ title: string; headwords: number; frames: number; dir: string; adapter: string }>;
  rows: number;
  bytes: number;
  ms: number;
  /** rows that would not parse — surfaced, never silently dropped (§28 S6). */
  unparseable: number;
  /** rows belonging to dictionaries no longer registered — skipped, and SAID. */
  orphans: number;
  /** titles found in the dictionaries table (0 = table not seen). */
  registered: number;
  /** dictionaries deliberately not converted because they already were. */
  skipped: string[];
  /** true when the run was cancelled: metas stay marked `partial`. */
  stopped: boolean;
}

export interface DexieImportOpts {
  shards?: number;
  root?: string;
  /** how many rows may be buffered across all dictionaries at once. */
  bufferRows?: number;
  /** skip dictionaries whose title matches — e.g. one already converted from a zip. */
  skip?: (title: string) => boolean;
  /** JA→EN unless the title says otherwise; the backup carries no per-dict language. */
  directionFor?: (title: string) => Direction;
  onProgress?: (p: DexieProgress) => void;
  shouldStop?: () => boolean;
  now?: () => number;
}

/**
 * Stream the backup and convert every dictionary in it.
 *
 * NOTE on direction: the Dexie backup records no sourceLanguage per dictionary.
 * A Japanese learner's install is overwhelmingly JA→EN, and 英辞郎 (the one
 * EN→JA dictionary here) is detected by title and routed to its own adapter,
 * which handles direction itself. `directionFor` exists for anything else.
 */
export async function importDexie(
  io: SidecarIO, chunks: ChunkSource, opts: DexieImportOpts = {},
): Promise<DexieImportResult> {
  const shards = opts.shards ?? DEFAULT_SHARDS;
  const now = opts.now ?? (() => Date.now());
  const t0 = now();

  const stream = new DexieRowStream('terms');
  // Read the `dictionaries` table from the SAME pass. It sits at the front of
  // the file, so by the time terms arrive the registered set is known — and it
  // is needed: the user's backup carries 97 distinct titles on terms against 36
  // registered, the surplus being orphans of removed/superseded dictionaries.
  // Converting those would make 61 folders of stale entries.
  const dictStream = new DexieRowStream('dictionaries');
  const registered = new Set<string>();

  const seen = new Map<string, { heads: number; frames: number; dir: string; adapter: string }>();
  const skipped = new Set<string>();
  let rows = 0, bytes = 0, unparseable = 0, stopped = false, orphans = 0;

  const router = new DictionaryRouter(async (title, tuples) => {
    if (opts.skip?.(title)) { skipped.add(title); return; }
    const first = !seen.has(title);
    const res = await importBatch(io, title, tuples as unknown as EijiroTuple[], {
      shards, root: opts.root, reset: first,
      direction: opts.directionFor?.(title) ?? 'ja->en',
    });
    const prev = seen.get(title);
    const acc = {
      heads: (prev?.heads ?? 0) + res.heads,
      frames: (prev?.frames ?? 0) + res.frames,
      dir: res.dir,
      adapter: res.adapter,
    };
    seen.set(title, acc);
    // Meta as we go, NOT at the end. A pass over a 12.7GB backup takes over an
    // hour, and writing meta only on completion meant an interrupted — or
    // merely unfinished — run left gigabytes of correct shards that discovery
    // could not see at all, because a folder without meta is not a dictionary.
    // Marked partial, so a dictionary that is still being filled reads as
    // provisional rather than as a finished install. ~150 bytes per batch.
    await writeMeta(io, res.dir, {
      title, revision: 'dexie', shards,
      headwords: acc.heads, frames: acc.frames, builtAt: now(), format: 1, partial: true,
    });
    opts.onProgress?.({ bytes, rows, dictionaries: seen.size, current: title });
  }, opts.bufferRows ?? 20_000);

  for await (const chunk of chunks) {
    if (opts.shouldStop?.()) { stopped = true; break; }
    bytes += chunk.length;
    for (const raw of dictStream.feed(chunk)) {
      const d = parseDictionaryRow(raw);
      if (d) registered.add(d.title.trim());
    }
    for (const raw of stream.feed(chunk)) {
      const r = parseRow(raw);
      if (!r) { unparseable++; continue; }
      // An empty registered set means the table has not been seen (a fragment,
      // or a future format change) — then convert everything rather than
      // silently converting nothing.
      if (registered.size && !registered.has(String(r.dictionary).trim())) { orphans++; continue; }
      rows++;
      await router.add(r);
    }
  }
  if (!stopped) await router.drain();
  else await router.drain();          // a cancelled run still lands what it read

  // Meta was written per batch (above). This pass only settles the final
  // counts and clears `partial` — and only for a run that actually finished,
  // so a cancelled run stays honestly marked as incomplete.
  const dictionaries: DexieImportResult['dictionaries'] = [];
  for (const [title, v] of seen) {
    const meta: SidecarMeta = {
      title, revision: 'dexie', shards,
      headwords: v.heads, frames: v.frames, builtAt: now(), format: 1,
      ...(stopped ? { partial: true } : {}),
    };
    await writeMeta(io, sidecarDirFor(title, opts.root), meta);
    dictionaries.push({ title, headwords: v.heads, frames: v.frames, dir: v.dir, adapter: v.adapter });
  }
  dictionaries.sort((a, b) => b.headwords - a.headwords);

  return {
    dictionaries, rows, bytes, ms: now() - t0, unparseable, orphans,
    registered: registered.size, skipped: [...skipped].sort(), stopped,
  };
}

/** Titles already converted from a zip, so the backup pass can skip them. */
export function skipTitles(titles: string[]): (t: string) => boolean {
  const set = new Set(titles.map((t) => t.trim()));
  return (t) => set.has(t.trim()) || (set.size > 0 && isEijiro(t) && [...set].some(isEijiro));
}

export type { TermTuple };
