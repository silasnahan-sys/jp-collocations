/**
 * import-eijiro.ts — the conversion pipeline (DESIGN §27.7 step 3).
 *
 * Turns an extracted Yomitan export folder into vault sidecars. The adapter and
 * the sidecar layer are both pure; this is the orchestration between them, and
 * it is written so the whole corpus is NEVER resident: one term bank is read,
 * adapted, appended and dropped before the next is opened. 英辞郎 is 237 banks
 * / 522MB, so anything that accumulates would die on desktop and never have a
 * chance on a phone.
 *
 * Sources are injected (`BankSource`), so the golden runs the real pipeline
 * against in-memory banks and `main.ts` supplies a Node-fs reader on desktop.
 */

import { adaptEijiroBank, type EijiroTuple, type AdaptOpts, type DictHeadword } from './eijiro.ts';
import { adaptGenericBank, directionOf, isEijiro, type Direction } from './generic-yomitan.ts';
import {
  appendBatch, writeMeta, dropSidecar, DEFAULT_SHARDS, type SidecarIO, type SidecarMeta,
} from './sidecar.ts';

/** Where the term banks come from — a folder on disk, a zip, a test double. */
export interface BankSource {
  /** index.json, parsed. sourceLanguage decides the direction (§27.4). */
  index(): Promise<{
    title: string; revision?: string; description?: string;
    sourceLanguage?: string; targetLanguage?: string;
  } | null>;
  /** Names of the term bank files, in a stable order. */
  bankNames(): Promise<string[]>;
  /** One bank's parsed tuples. Called once per bank and not retained. */
  bank(name: string): Promise<EijiroTuple[]>;
}

export interface ImportProgress {
  bank: number;
  banks: number;
  headwords: number;
  frames: number;
  /** current bank file name, for the notice line. */
  name: string;
}

export interface ImportResult {
  title: string;
  headwords: number;
  frames: number;
  banks: number;
  /** banks that failed to parse — reported, never silently swallowed (§28 S6). */
  failed: string[];
  dir: string;
  ms: number;
  /** which §27.4 adapter ran — visible, so a wrong pick is not silent. */
  adapter: 'eijiro' | 'generic';
  /** which side was treated as Japanese. */
  direction: Direction;
}

export interface ImportOpts extends AdaptOpts {
  shards?: number;
  /** vault folder that holds every big dictionary. */
  root?: string;
  onProgress?: (p: ImportProgress) => void;
  /** cooperative cancel — checked between banks. */
  shouldStop?: () => boolean;
  now?: () => number;
}

/**
 * Convert ONE dictionary's already-streamed tuples into its sidecar. Used by
 * the Dexie path, where the 36 dictionaries arrive interleaved from a single
 * 12.7GB pass and cannot be presented as separate `BankSource`s.
 *
 * `reset` drops the previous sidecar; it must be true for the FIRST batch of a
 * dictionary and false afterwards, or each batch would erase the last.
 */
export async function importBatch(
  io: SidecarIO,
  title: string,
  tuples: EijiroTuple[],
  opts: ImportOpts & { reset?: boolean; direction?: Direction } = {},
): Promise<{ dir: string; heads: number; frames: number; adapter: 'eijiro' | 'generic' }> {
  const shards = opts.shards ?? DEFAULT_SHARDS;
  const dir = sidecarDirFor(title, opts.root);
  if (opts.reset) { await dropSidecar(io, dir, shards); await io.mkdir(dir); }
  const eijiro = isEijiro(title);
  const heads = eijiro
    ? adaptEijiroBank(tuples, { evocativeHead: opts.evocativeHead })
    // The TITLE selects the book's tree vocabulary from the one profile table,
    // so a batch converted here splits into senses the same way as a full run.
    : adaptGenericBank(tuples, {
      direction: opts.direction ?? 'ja->en', evocativeHead: opts.evocativeHead, dictionary: title,
    });
  const res = await appendBatch(io, dir, heads, shards);
  return { dir, heads: res.heads, frames: res.frames, adapter: eijiro ? 'eijiro' : 'generic' };
}

/** Vault-safe folder name for a dictionary title. */
export function sidecarDirFor(title: string, root = 'JP Dictionaries'): string {
  const safe = String(title).replace(/[\\/:*?"<>|#^[\]]/g, '_').trim() || 'dictionary';
  return `${root}/${safe}`;
}

/**
 * Run the conversion. Rebuilds from scratch: the previous sidecar is dropped
 * first, because appending into a half-old dictionary would leave stale
 * headwords that no longer exist in the source and nothing would ever notice.
 */
export async function importEijiro(
  io: SidecarIO, src: BankSource, opts: ImportOpts = {},
): Promise<ImportResult> {
  const shards = opts.shards ?? DEFAULT_SHARDS;
  const now = opts.now ?? (() => Date.now());
  const t0 = now();

  const idx = await src.index();
  const title = idx?.title ?? '英辞郎';
  const dir = sidecarDirFor(title, opts.root);

  // §27.4 registry. 英辞郎 gets its bespoke adapter because its HTML carries
  // production structure (frame labels, 〔situations〕) that a generic walker
  // would flatten into prose. Everything else — jitendex, the kokugo, the
  // thesaurus — is structured-content node trees, and points the other way
  // (JA→EN), so both the parser AND the direction must switch.
  const eijiro = isEijiro(title);
  const direction: Direction = directionOf(idx);
  const adapt = (bank: EijiroTuple[]): DictHeadword[] => eijiro
    ? adaptEijiroBank(bank, { evocativeHead: opts.evocativeHead })
    : adaptGenericBank(bank, { direction, evocativeHead: opts.evocativeHead, dictionary: title });

  await dropSidecar(io, dir, shards);
  await io.mkdir(dir);

  const names = await src.bankNames();
  let headwords = 0, frames = 0, done = 0;
  const failed: string[] = [];

  for (const name of names) {
    if (opts.shouldStop?.()) break;
    let tuples: EijiroTuple[];
    try {
      tuples = await src.bank(name);
    } catch {
      // §28 S6: a bank that will not parse is REPORTED, never counted as zero
      // and never silently skipped into a "successful" import.
      failed.push(name);
      done++;
      continue;
    }
    const heads = adapt(tuples);
    const res = await appendBatch(io, dir, heads, shards);
    headwords += res.heads;
    frames += res.frames;
    done++;
    opts.onProgress?.({ bank: done, banks: names.length, headwords, frames, name });
  }

  const meta: SidecarMeta = {
    title,
    revision: idx?.revision ?? '',
    shards,
    headwords,
    frames,
    builtAt: now(),
    format: 1,
  };
  await writeMeta(io, dir, meta);

  return { title, headwords, frames, banks: done, failed, dir, ms: now() - t0, adapter: eijiro ? "eijiro" : "generic", direction };
}
