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

import { adaptEijiroBank, type EijiroTuple, type AdaptOpts } from './eijiro.ts';
import {
  appendBatch, writeMeta, dropSidecar, DEFAULT_SHARDS, type SidecarIO, type SidecarMeta,
} from './sidecar.ts';

/** Where the term banks come from — a folder on disk, a zip, a test double. */
export interface BankSource {
  /** index.json, parsed. */
  index(): Promise<{ title: string; revision?: string; description?: string } | null>;
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
    const heads = adaptEijiroBank(tuples, { evocativeHead: opts.evocativeHead });
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

  return { title, headwords, frames, banks: done, failed, dir, ms: now() - t0 };
}
