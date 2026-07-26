/**
 * sidecar.ts — sharded vault storage for the BIG dictionaries (DESIGN §27.5).
 *
 * `DictionaryStore` holds every term in memory and serializes into the plugin
 * data blob. That is correct for a 30k-entry Yomitan dict and catastrophic for
 * 英辞郎's 2.36M — AUDIT §18 already recorded a 62MB blob from exactly this
 * mistake, and the blob is rewritten wholesale on every save. So the big dicts
 * live in the vault as ordinary files instead:
 *
 *   JP Dictionaries/<title>/meta.json          — what this is, how it is sharded
 *   JP Dictionaries/<title>/head-NNN.jsonl     — headwords, one JSON per line
 *   JP Dictionaries/<title>/frame-NNN.jsonl    — the reach-for index
 *
 * **There is deliberately no index file.** A headword→shard map for 2.36M
 * entries would itself be tens of MB and would have to be loaded to answer one
 * lookup — the blob problem again, wearing a different hat. Instead the shard
 * is a pure function of the key: normalize → hash → shard. Lookup reads exactly
 * ONE file (~1MB at 512 shards) and scans it. Nothing is held in memory between
 * queries, which is what makes this phone-safe.
 *
 * Files-over-app (§19): these are plain JSONL in the vault. They sync like any
 * other file, they can be inspected with a text editor, and deleting the folder
 * uninstalls the dictionary.
 *
 * The core is PURE with IO injected — golden: golden/sidecar.mjs.
 */

import type { DictHeadword, ReachCandidate } from './eijiro.ts';
import { normalizeFrame } from './frames.ts';

/** Minimal IO surface, so the core tests without Obsidian. */
export interface SidecarIO {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  append(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Subfolder names of a directory. Needed to DISCOVER installed dictionaries
   *  — there is no registry file, the folders are the registry (§19). */
  listFolders?(path: string): Promise<string[]>;
  /** File paths directly inside a directory. Lets dropSidecar delete what is
   *  actually there instead of probing 2×shards paths that mostly do not
   *  exist — 1,024 adapter calls before a conversion even starts. */
  listFiles?(path: string): Promise<string[]>;
}

export interface SidecarMeta {
  title: string;
  revision: string;
  /** number of head-*.jsonl shards. Changing this invalidates every path. */
  shards: number;
  headwords: number;
  frames: number;
  builtAt: number;
  /** schema version of the line format, so a future change can migrate. */
  format: 1;
}

export const DEFAULT_SHARDS = 512;

/**
 * FNV-1a over the normalized key. Deterministic across platforms and runs —
 * the shard path IS the index, so this function changing is a data migration.
 */
export function hashKey(key: string): number {
  let h = 0x811c9dc5;
  const s = String(key).normalize('NFKC');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Which shard a key lives in. Pure — no file, no index, no state. */
export function shardOf(key: string, shards: number = DEFAULT_SHARDS): number {
  return hashKey(normalizeLookupKey(key)) % shards;
}

/**
 * The lookup key normalization. Must be applied identically at write and read
 * time or entries become unreachable — hence one exported function, not two
 * call sites doing "roughly the same thing".
 */
export function normalizeLookupKey(key: string): string {
  return String(key ?? '').normalize('NFKC').trim().toLowerCase();
}

const pad = (n: number) => String(n).padStart(3, '0');
export const metaPath = (dir: string) => `${dir}/meta.json`;
export const headPath = (dir: string, shard: number) => `${dir}/head-${pad(shard)}.jsonl`;
export const framePath = (dir: string, shard: number) => `${dir}/frame-${pad(shard)}.jsonl`;

// ── line format ──────────────────────────────────────────────────────────────

/**
 * One stored headword line. Written 2.36M times for 英辞郎 alone, so density is
 * a feature, not an optimization: the first full run produced **1,075 MB**
 * because `reachFor` duplicated text already present in `senses` AND was
 * written again into the frame shards. The head shard therefore stores the
 * LOOK-UP half only; the reach-for half lives in the frame shards, which is
 * also the honest split (§27.2: look-up and reach-for are different questions).
 */
export interface HeadLine { k: string; e: Omit<DictHeadword, 'reachFor'> }

/**
 * One stored frame line. Candidate fields are single-letter because this file
 * set is ~1.7M rows: s=surface(JP), i=intention(EN), h=classHint, p=shape,
 * t=situation. Expanded back to `ReachCandidate` on read.
 */
export interface StoredCandidate { s: string; i: string; h: string; p?: string; t?: string }
export interface FrameLine { k: string; c: StoredCandidate[] }

const packCandidate = (c: ReachCandidate): StoredCandidate => ({
  s: c.surface, i: c.intention, h: c.classHint,
  ...(c.shape ? { p: c.shape } : {}), ...(c.situation ? { t: c.situation } : {}),
});

const unpackCandidate = (c: StoredCandidate, frameKey: string): ReachCandidate => ({
  surface: c.s, intention: c.i, classHint: c.h as ReachCandidate['classHint'],
  ...(c.p ? { shape: c.p } : {}), ...(c.t ? { situation: c.t } : {}),
  frameKey, intentionKey: '', slots: (frameKey.match(/[～＿]/g) ?? []).length,
});

export const encodeLine = (o: unknown): string => JSON.stringify(o) + '\n';

/** Parse a JSONL body, skipping blank lines and surviving a torn last line. */
export function decodeLines<T>(text: string | null): T[] {
  if (!text) return [];
  const out: T[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try { out.push(JSON.parse(line) as T); } catch { /* torn write — skip */ }
  }
  return out;
}

// ── writing ──────────────────────────────────────────────────────────────────

/**
 * Group entries into their shards. Returned as a Map so the caller can write
 * one file per shard in a batched loop rather than 2.36M appends.
 */
export function planHeadShards(
  entries: DictHeadword[], shards: number = DEFAULT_SHARDS,
): Map<number, HeadLine[]> {
  const plan = new Map<number, HeadLine[]>();
  for (const e of entries) {
    const k = normalizeLookupKey(e.expression);
    const s = hashKey(k) % shards;
    const list = plan.get(s);
    // reachFor is deliberately NOT stored here — see HeadLine.
    const { reachFor: _drop, ...lookupHalf } = e;
    const line: HeadLine = { k, e: lookupHalf };
    if (list) list.push(line); else plan.set(s, [line]);
  }
  return plan;
}

/** Same, for the reach-for index — keyed on the normalized FRAME. */
export function planFrameShards(
  entries: DictHeadword[], shards: number = DEFAULT_SHARDS,
): Map<number, FrameLine[]> {
  const byKey = new Map<string, ReachCandidate[]>();
  for (const e of entries) {
    for (const c of e.reachFor) {
      const k = normalizeFrame(c.frameKey);
      if (!k) continue;
      const list = byKey.get(k);
      if (list) list.push(c); else byKey.set(k, [c]);
    }
  }
  const plan = new Map<number, FrameLine[]>();
  for (const [k, c] of byKey) {
    const s = hashKey(normalizeLookupKey(k)) % shards;
    const list = plan.get(s);
    const line: FrameLine = { k, c: c.map(packCandidate) };
    if (list) list.push(line); else plan.set(s, [line]);
  }
  return plan;
}

/**
 * Append one batch of adapted entries. Import streams bank-by-bank, so this is
 * called ~237 times rather than once with everything in memory — the whole
 * point of sharding is that the full corpus never has to be resident.
 */
export async function appendBatch(
  io: SidecarIO, dir: string, entries: DictHeadword[], shards: number = DEFAULT_SHARDS,
): Promise<{ heads: number; frames: number }> {
  const heads = planHeadShards(entries, shards);
  const frames = planFrameShards(entries, shards);
  let h = 0, f = 0;
  for (const [shard, lines] of heads) {
    await io.append(headPath(dir, shard), lines.map(encodeLine).join(''));
    h += lines.length;
  }
  for (const [shard, lines] of frames) {
    await io.append(framePath(dir, shard), lines.map(encodeLine).join(''));
    f += lines.length;
  }
  return { heads: h, frames: f };
}

export async function writeMeta(io: SidecarIO, dir: string, meta: SidecarMeta): Promise<void> {
  await io.write(metaPath(dir), JSON.stringify(meta, null, 1));
}

export async function readMeta(io: SidecarIO, dir: string): Promise<SidecarMeta | null> {
  const t = await io.read(metaPath(dir));
  if (!t) return null;
  try { return JSON.parse(t) as SidecarMeta; } catch { return null; }
}

// ── reading ──────────────────────────────────────────────────────────────────

/**
 * Look up one headword. Reads exactly one shard file and nothing else.
 * Multiple entries can share an expression (Eijiro has many); all are returned.
 */
export async function lookupHead(
  io: SidecarIO, dir: string, expression: string, shards: number = DEFAULT_SHARDS,
): Promise<Array<Omit<DictHeadword, 'reachFor'>>> {
  const k = normalizeLookupKey(expression);
  const text = await io.read(headPath(dir, hashKey(k) % shards));
  return decodeLines<HeadLine>(text).filter((l) => l.k === k).map((l) => l.e);
}

/**
 * Look up a frame — the reach-for query. Same single-file read.
 * The caller passes any notation; `normalizeFrame` makes Eijiro's `$__`, the
 * user's `～` and a gapped sentence land on the same shard and the same key.
 */
export async function lookupFrame(
  io: SidecarIO, dir: string, frame: string, shards: number = DEFAULT_SHARDS,
): Promise<ReachCandidate[]> {
  const k = normalizeFrame(frame);
  if (!k) return [];
  const text = await io.read(framePath(dir, hashKey(normalizeLookupKey(k)) % shards));
  const out: ReachCandidate[] = [];
  for (const l of decodeLines<FrameLine>(text)) if (l.k === k) out.push(...l.c.map((x) => unpackCandidate(x, k)));
  return out;
}

/**
 * Coalesce appends in memory and flush them in few, large writes.
 *
 * The conversion appends to up to 2×`shards` files per batch. For 英辞郎 that
 * is 237 batches × ~1024 shards ≈ 242,000 individual filesystem calls — slow
 * enough to time out even when each call is cheap. Buffering by path and
 * flushing when the total crosses `maxBytes` turns that into roughly
 * `total ÷ maxBytes` rounds: for a 536MB conversion at 32MB, about 17.
 *
 * `flush()` MUST run before a conversion reports success, or the tail of every
 * shard is still in memory. Reads are served from the buffer first, so a lookup
 * during a conversion cannot observe a half-written file.
 */
export function bufferedSidecarIO(
  inner: SidecarIO, opts: { maxBytes?: number } = {},
): SidecarIO & { flush: () => Promise<void>; pendingBytes: () => number } {
  const pending = new Map<string, string[]>();
  let bytes = 0;
  const cap = opts.maxBytes ?? 32 * 1024 * 1024;

  const flush = async (): Promise<void> => {
    if (!pending.size) return;
    // Snapshot then clear, so an append arriving mid-flush is not lost.
    const batch = [...pending.entries()];
    pending.clear();
    bytes = 0;
    for (const [path, parts] of batch) await inner.append(path, parts.join(''));
  };

  return {
    async read(path) {
      const buffered = pending.get(path);
      const base = await inner.read(path);
      if (!buffered) return base;
      return (base ?? '') + buffered.join('');
    },
    async write(path, text) {
      pending.delete(path);                 // a write supersedes buffered appends
      await inner.write(path, text);
    },
    async append(path, text) {
      const list = pending.get(path);
      if (list) list.push(text); else pending.set(path, [text]);
      bytes += text.length;
      if (bytes >= cap) await flush();
    },
    async exists(path) {
      return pending.has(path) || inner.exists(path);
    },
    mkdir: (path) => inner.mkdir(path),
    async remove(path) {
      pending.delete(path);
      await inner.remove(path);
    },
    listFolders: inner.listFolders ? (p: string) => inner.listFolders!(p) : undefined,
    listFiles: inner.listFiles ? (p: string) => inner.listFiles!(p) : undefined,
    flush,
    pendingBytes: () => bytes,
  };
}

/** Remove a dictionary: delete its folder's files. Uninstall = delete. */
export async function dropSidecar(
  io: SidecarIO, dir: string, shards: number = DEFAULT_SHARDS,
): Promise<void> {
  // Preferred: ask what is there (one call) and delete exactly that.
  if (io.listFiles) {
    const files = await io.listFiles(dir).catch(() => [] as string[]);
    for (const f of files) await io.remove(f);
    return;
  }
  // Fallback for IOs without listing: probe every shard path.
  for (let s = 0; s < shards; s++) {
    for (const p of [headPath(dir, s), framePath(dir, s)]) {
      if (await io.exists(p)) await io.remove(p);
    }
  }
  if (await io.exists(metaPath(dir))) await io.remove(metaPath(dir));
}
