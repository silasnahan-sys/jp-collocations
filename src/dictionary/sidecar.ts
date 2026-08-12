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

/**
 * Where the shelf lives — the dotted variant wins when it is the one on disk.
 *
 * §19 says these are ordinary vault files, and that was right about ACCESS and
 * wrong about VISIBILITY. Measured 2026-08-06: 51,016 shard files in a vault of
 * 636 notes, all of them registered and watched by Obsidian at startup for no
 * benefit — nothing in this plugin ever reaches the shelf through the Vault
 * API. A leading dot makes Obsidian skip the folder wholesale while
 * `vault.adapter` still reads it, `getResourcePath` for dictionary media
 * included.
 *
 * Resolved at load rather than stored, because the SETTING rides in the synced
 * blob while the FOLDER may not have travelled with it. One synced setting has
 * to work on a device that dotted its shelf and a device that did not, so
 * whichever exists wins, dotted first. Neither present (fresh install) → the
 * configured name, so nothing is created in a hidden folder by surprise.
 */
export const dottedRoot = (root: string): string =>
  root.startsWith('.') ? root : `.${root}`;

export async function resolveBigDictRoot(
  exists: (path: string) => Promise<boolean>,
  configured: string,
): Promise<string> {
  const root = configured.trim() || 'JP Dictionaries';
  const dotted = dottedRoot(root);
  if (await exists(dotted).catch(() => false)) return dotted;
  if (await exists(root).catch(() => false)) return root;
  return root;
}

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
  /**
   * Rows in the intention (meaning-side) index. ABSENT means the dictionary was
   * converted before the family existed and simply has no meaning-side index —
   * which is not damage, so verification must not report it as such. Zero means
   * it was built and is genuinely empty.
   */
  intents?: number;
  builtAt: number;
  /** schema version of the line format, so a future change can migrate. */
  format: 1;
  /**
   * True while a conversion is still adding to this dictionary, or when the
   * meta was reconstructed by `repairSidecarMeta`. The counts are then a
   * RUNNING total, not a final one, and the dictionary must be presented as
   * provisional rather than as a finished install (§12: machine output looks
   * provisional). Absent/false means a conversion wrote it and completed.
   */
  partial?: boolean;
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
/**
 * The MEANING side (§27.2). Keyed on the normalized ENGLISH — the intention you
 * search by — where `framePath` is keyed on the normalized Japanese shape.
 *
 * §27.0.1 says a phrase is one meaning externalized twice, so the index has to
 * be reachable from both externalizations. Without this family the shelf can
 * only be asked "what does this Japanese say?", never "how is this said?" — and
 * the donor essay's own query, "at some point" → どっかのタイミングで, is the
 * one the storage layer could not serve.
 */
export const intentPath = (dir: string, shard: number) => `${dir}/intent-${pad(shard)}.jsonl`;

/** The three shard families, so maintenance code enumerates rather than repeats. */
export type ShardFamily = 'head' | 'frame' | 'intent';
export const SHARD_FAMILIES: ShardFamily[] = ['head', 'frame', 'intent'];
export const shardPathFor = (family: ShardFamily, dir: string, shard: number): string =>
  family === 'head' ? headPath(dir, shard)
    : family === 'frame' ? framePath(dir, shard)
      : intentPath(dir, shard);

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

/**
 * One stored intention line. Identical to a frame line except that the line key
 * is the ENGLISH key, so the Japanese frame each candidate realizes can no
 * longer be implied by the file it sits in and has to be carried on the
 * candidate as `f`.
 */
export interface StoredIntentCandidate extends StoredCandidate { f: string }
export interface IntentLine { k: string; c: StoredIntentCandidate[] }

export const packCandidate = (c: ReachCandidate): StoredCandidate => ({
  s: c.surface, i: c.intention, h: c.classHint,
  ...(c.shape ? { p: c.shape } : {}), ...(c.situation ? { t: c.situation } : {}),
});

export const unpackCandidate = (c: StoredCandidate, frameKey: string): ReachCandidate => ({
  surface: c.s, intention: c.i, classHint: c.h as ReachCandidate['classHint'],
  ...(c.p ? { shape: c.p } : {}), ...(c.t ? { situation: c.t } : {}),
  frameKey, intentionKey: intentionKeyOf(c.i), slots: (frameKey.match(/[～＿]/g) ?? []).length,
});

/**
 * The intention key. `normalizeFrame` over the English side — the SAME function
 * the Japanese side is keyed with, because §27.7 keeps one key space, and
 * because the adapters already compute this exact value
 * (`intentionKey: toFrame(expression, shape).key`) before discarding it.
 *
 * Note `unpackCandidate` used to return `intentionKey: ''`, which is why an
 * English want could never be satisfied: the key was computed at import, thrown
 * away at write, and blanked again at read.
 */
export function intentionKeyOf(intention: string): string {
  return normalizeFrame(intention);
}

const unpackIntentCandidate = (c: StoredIntentCandidate, intentionKey: string): ReachCandidate => ({
  surface: c.s, intention: c.i, classHint: c.h as ReachCandidate['classHint'],
  ...(c.p ? { shape: c.p } : {}), ...(c.t ? { situation: c.t } : {}),
  frameKey: c.f, intentionKey, slots: (c.f.match(/[～＿]/g) ?? []).length,
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
 * Same again, for the MEANING side — keyed on the normalized English.
 *
 * The candidate set is identical to `planFrameShards`; only the key changes.
 * That is the point: one phrase, indexed by both of its externalizations, so
 * the same row answers "what does this Japanese say?" and "how do I say this?"
 */
export function planIntentShards(
  entries: DictHeadword[], shards: number = DEFAULT_SHARDS,
): Map<number, IntentLine[]> {
  const byKey = new Map<string, StoredIntentCandidate[]>();
  for (const e of entries) {
    for (const c of e.reachFor) {
      const k = c.intentionKey || intentionKeyOf(c.intention);
      const f = normalizeFrame(c.frameKey);
      if (!k || !f) continue;
      const packed: StoredIntentCandidate = { ...packCandidate(c), f };
      const list = byKey.get(k);
      if (list) list.push(packed); else byKey.set(k, [packed]);
    }
  }
  const plan = new Map<number, IntentLine[]>();
  for (const [k, c] of byKey) {
    const s = hashKey(normalizeLookupKey(k)) % shards;
    const list = plan.get(s);
    const line: IntentLine = { k, c };
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
): Promise<{ heads: number; frames: number; intents: number }> {
  const heads = planHeadShards(entries, shards);
  const frames = planFrameShards(entries, shards);
  const intents = planIntentShards(entries, shards);
  let h = 0, f = 0, i = 0;
  for (const [shard, lines] of heads) {
    await io.append(headPath(dir, shard), lines.map(encodeLine).join(''));
    h += lines.length;
  }
  for (const [shard, lines] of frames) {
    await io.append(framePath(dir, shard), lines.map(encodeLine).join(''));
    f += lines.length;
  }
  for (const [shard, lines] of intents) {
    await io.append(intentPath(dir, shard), lines.map(encodeLine).join(''));
    i += lines.length;
  }
  return { heads: h, frames: f, intents: i };
}

export async function writeMeta(io: SidecarIO, dir: string, meta: SidecarMeta): Promise<void> {
  await io.write(metaPath(dir), JSON.stringify(meta, null, 1));
}

export async function readMeta(io: SidecarIO, dir: string): Promise<SidecarMeta | null> {
  const t = await io.read(metaPath(dir));
  if (!t) return null;
  try { return JSON.parse(t) as SidecarMeta; } catch { return null; }
}

// ── repair ───────────────────────────────────────────────────────────────────

/**
 * Sort a folder's files into head shards, frame shards and meta.
 * Tolerant of anything else in the folder (sync conflict copies, .DS_Store).
 */
export function classifyShardFiles(
  files: string[],
): { head: number[]; frame: number[]; intent: number[]; hasMeta: boolean } {
  const head: number[] = [], frame: number[] = [], intent: number[] = [];
  const bucket = { head, frame, intent };
  let hasMeta = false;
  for (const f of files) {
    const name = f.split('/').pop() ?? '';
    if (name === 'meta.json') { hasMeta = true; continue; }
    const m = /^(head|frame|intent)-(\d+)\.jsonl$/.exec(name);
    if (!m) continue;
    bucket[m[1] as keyof typeof bucket].push(Number(m[2]));
  }
  return { head, frame, intent, hasMeta };
}

/**
 * Entries in one shard file.
 *
 * Every line is written with a trailing newline, so counting newlines counts
 * entries — and a torn final line (no newline, i.e. a run killed mid-write) is
 * correctly not counted, matching what `decodeLines` will refuse to parse.
 */
export function countJsonlLines(body: string): number {
  let lines = 0;
  for (let i = 0; i < body.length; i++) if (body.charCodeAt(i) === 10) lines++;
  return lines;
}

/**
 * How many shards a folder was written with, when no meta survives to say.
 *
 * `expected` (the configured count) is trusted whenever it can be — the repair
 * runs in the same install that did the conversion. It is only overridden when
 * the files themselves prove it wrong, i.e. a shard index at or beyond it.
 * Deriving from `max index + 1` alone would be wrong for any dictionary too
 * small to touch its highest shard, so the derived value is rounded up to a
 * power of two, which is the only shape a shard count has ever had here.
 */
export function inferShardCount(indices: number[], expected: number = DEFAULT_SHARDS): number {
  if (!indices.length) return expected;
  const max = Math.max(...indices);
  if (max < expected) return expected;
  let s = 1;
  while (s <= max) s *= 2;
  return s;
}

export interface SidecarRepair {
  title: string; dir: string; headwords: number; frames: number; intents: number;
  shards: number; bytes: number;
}

export interface RepairResult {
  /** folders that had shards but no usable meta, now readable. */
  repaired: SidecarRepair[];
  /** folders that already had a readable meta — untouched. */
  alreadyOk: string[];
  /** folders under the root holding no shard files at all. */
  empty: string[];
}

/**
 * Reconstruct `meta.json` for every dictionary folder that has shards but no
 * readable meta, making it findable again.
 *
 * This exists because a conversion used to write meta only after the whole
 * 12.7GB backup had been read: a run that was interrupted — or merely still
 * running — left gigabytes of perfectly good shards that `BigDictStore` could
 * not see, because discovery requires a meta. One missing 150-byte file hid
 * 1.8GB of working dictionary. `importDexie` now writes meta as it goes, so
 * this is the rescue path for runs that predate that (and for a killed run).
 *
 * The counts are recovered by reading the shards — the only honest source —
 * and the result is marked `partial`, because nothing on disk can tell us
 * whether the conversion that wrote them ever finished.
 */
export async function repairSidecarMeta(
  io: SidecarIO,
  root: string,
  opts: {
    shards?: number;
    now?: () => number;
    onProgress?: (p: { title: string; done: number; total: number; bytes: number }) => void;
    shouldStop?: () => boolean;
  } = {},
): Promise<RepairResult> {
  const expected = opts.shards ?? DEFAULT_SHARDS;
  const now = opts.now ?? (() => Date.now());
  const out: RepairResult = { repaired: [], alreadyOk: [], empty: [] };
  if (!io.listFolders || !io.listFiles) return out;

  const names = await io.listFolders(root).catch(() => [] as string[]);
  let done = 0, bytes = 0;
  for (const name of names) {
    if (opts.shouldStop?.()) break;
    done++;
    const dir = `${root}/${name}`;
    const files = await io.listFiles(dir).catch(() => [] as string[]);
    const { head, frame, intent, hasMeta } = classifyShardFiles(files);
    if (hasMeta && (await readMeta(io, dir))) { out.alreadyOk.push(name); continue; }
    if (!head.length && !frame.length && !intent.length) { out.empty.push(name); continue; }

    const shards = inferShardCount([...head, ...frame, ...intent], expected);
    const present: Record<ShardFamily, number[]> = { head, frame, intent };
    const counted: Record<ShardFamily, number> = { head: 0, frame: 0, intent: 0 };
    let folderBytes = 0;
    for (const family of SHARD_FAMILIES) {
      for (const s of present[family]) {
        const body = await io.read(shardPathFor(family, dir, s));
        if (!body) continue;
        folderBytes += body.length;
        counted[family] += countJsonlLines(body);
      }
      opts.onProgress?.({ title: name, done, total: names.length, bytes: bytes + folderBytes });
    }
    bytes += folderBytes;

    await writeMeta(io, dir, {
      title: name, revision: 'repaired', shards,
      headwords: counted.head, frames: counted.frame,
      // Only claim an intention index when shards for one are actually there —
      // an absent family is "never built", which is different from "empty".
      ...(intent.length ? { intents: counted.intent } : {}),
      builtAt: now(), format: 1, partial: true,
    });
    out.repaired.push({
      title: name, dir, headwords: counted.head, frames: counted.frame,
      intents: counted.intent, shards, bytes: folderBytes,
    });
  }
  out.repaired.sort((a, b) => b.headwords - a.headwords);
  return out;
}

// ── deriving the intention index ─────────────────────────────────────────────

export interface IntentBuildResult {
  dir: string; shards: number;
  /** distinct intention keys written. */
  keys: number;
  /** candidate rows written (one phrase can answer many wants). */
  candidates: number;
  /** frame rows read to produce them. */
  framesRead: number;
  passes: number;
  ms: number;
}

/**
 * Build the meaning-side index for a dictionary that is ALREADY converted.
 *
 * No re-import, no source archive, no adapter: `StoredCandidate.i` is the
 * English text, already sitting in every frame shard, so the whole index is a
 * re-keying of data the vault holds. (This is why the missing entry points in
 * §27.2 were never a data problem — the meaning was on disk the whole time,
 * and only the key was thrown away.)
 *
 * MEMORY is the entire design constraint. An intention key's candidates are
 * scattered across every frame shard, so grouping them means holding them; for
 * 英辞郎 that is ~1.8M rows at once. Instead each pass claims a RANGE of target
 * shards and reads the frame index looking only for those, so peak memory is
 * roughly `total / passes` and the cost is `passes` sequential reads of a file
 * set that is already on local disk.
 */
export async function buildIntentIndex(
  io: SidecarIO, dir: string,
  opts: {
    shards?: number;
    /** how many times to sweep the frame index. Higher = less memory. */
    passes?: number;
    now?: () => number;
    onProgress?: (p: { pass: number; passes: number; shard: number; of: number; candidates: number }) => void;
    shouldStop?: () => boolean;
  } = {},
): Promise<IntentBuildResult> {
  const shards = opts.shards ?? DEFAULT_SHARDS;
  const passes = Math.max(1, Math.min(opts.passes ?? 4, shards));
  const now = opts.now ?? (() => Date.now());
  const t0 = now();
  const width = Math.ceil(shards / passes);

  // A rebuild must not append to a previous one.
  for (let s = 0; s < shards; s++) {
    const p = intentPath(dir, s);
    if (await io.exists(p)) await io.remove(p);
  }

  let keys = 0, candidates = 0, framesRead = 0, stopped = false;
  for (let pass = 0; pass < passes && !stopped; pass++) {
    const lo = pass * width, hi = Math.min(lo + width, shards);
    if (lo >= hi) break;
    const byKey = new Map<string, StoredIntentCandidate[]>();

    for (let s = 0; s < shards; s++) {
      if (opts.shouldStop?.()) { stopped = true; break; }
      const body = await io.read(framePath(dir, s));
      if (!body) continue;
      for (const l of decodeLines<FrameLine>(body)) {
        if (pass === 0) framesRead++;
        for (const c of l.c) {
          const k = intentionKeyOf(c.i);
          if (!k) continue;
          const target = hashKey(normalizeLookupKey(k)) % shards;
          if (target < lo || target >= hi) continue;
          const row: StoredIntentCandidate = { ...c, f: l.k };
          const list = byKey.get(k);
          if (list) list.push(row); else byKey.set(k, [row]);
        }
      }
      opts.onProgress?.({ pass: pass + 1, passes, shard: s + 1, of: shards, candidates });
    }
    if (stopped) break;

    const plan = new Map<number, IntentLine[]>();
    for (const [k, c] of byKey) {
      const s = hashKey(normalizeLookupKey(k)) % shards;
      const list = plan.get(s);
      const line: IntentLine = { k, c };
      if (list) list.push(line); else plan.set(s, [line]);
      keys++;
      candidates += c.length;
    }
    for (const [s, lines] of plan) {
      await io.append(intentPath(dir, s), lines.map(encodeLine).join(''));
    }
  }

  return { dir, shards, keys, candidates, framesRead, passes, ms: now() - t0 };
}

// ── verification ─────────────────────────────────────────────────────────────

/**
 * Entries-per-shard above which a MISSING shard file proves damage.
 *
 * Shard membership is FNV-1a mod `shards`, so keys land near-uniformly: with λ
 * entries per shard, the chance a given shard is legitimately empty is about
 * e^-λ. At λ=20 that is 512·e^-20 ≈ 1e-6 across a full shard set, so an absent
 * file is evidence rather than coincidence. Below the floor a genuinely small
 * dictionary can miss shards honestly, and only a line count can decide — which
 * is why absence is not reported as a problem there.
 */
const DENSITY_FLOOR = 20;

export type SidecarProblem =
  /** no readable meta — `repairSidecarMeta`'s job, not this one's. */
  | { kind: 'no-meta' }
  /** shard files that must exist at this density and do not. */
  | { kind: 'missing-shards'; family: ShardFamily; missing: number[]; present: number; of: number }
  /** meta's count and the bytes on disk disagree (deep only). */
  | { kind: 'count-mismatch'; family: ShardFamily; claimed: number; found: number }
  /** a shard index at or beyond meta.shards: the hash width changed under the data. */
  | { kind: 'shard-overflow'; family: ShardFamily; max: number; shards: number };

export interface SidecarVerdict {
  title: string;
  dir: string;
  /** false if anything below would make a lookup lie. */
  ok: boolean;
  /** meta says a conversion is unfinished or was reconstructed. Not a fault. */
  partial: boolean;
  claimed: { headwords: number; frames: number; intents: number | null; shards: number };
  found: {
    headShards: number; frameShards: number; intentShards: number;
    /** null unless `deep` — presence-only verification does not read shards. */
    headwords: number | null; frames: number | null; intents: number | null;
    bytes: number;
  };
  problems: SidecarProblem[];
  /** true when this dictionary has no meaning-side index at all (§27.2). */
  noIntentIndex: boolean;
}

/** "0–325, 400" — so a 326-shard hole reads as a hole, not as 326 numbers. */
export function summarizeIndices(nums: number[]): string {
  const s = [...nums].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? String(s[i]) : `${s[i]}–${s[j]}`);
    i = j + 1;
  }
  return out.join(', ');
}

const FAMILY_JA: Record<ShardFamily, string> = {
  head: '見出し', frame: '表現', intent: '意図',
};

/** One line of Japanese for the notice. Data and presentation stay separate. */
export function describeSidecarProblem(p: SidecarProblem): string {
  switch (p.kind) {
    case 'no-meta':
      return 'meta.json が読めません（「変換済み辞書を修復」で再生成できます）';
    case 'missing-shards':
      return `${FAMILY_JA[p.family]}シャードが ${p.present}/${p.of} しかありません` +
        `（欠落: ${summarizeIndices(p.missing)}）— この範囲の検索は無言で空を返します`;
    case 'count-mismatch':
      return `${FAMILY_JA[p.family]}件数が meta と不一致: ` +
        `meta ${p.claimed.toLocaleString()} / 実際 ${p.found.toLocaleString()}`;
    case 'shard-overflow':
      return `シャード番号 ${p.max} が meta.shards=${p.shards} を超えています（ハッシュ幅の不一致）`;
  }
}

/**
 * Check one converted dictionary folder against its own meta.
 *
 * This exists because `repairSidecarMeta` cannot: it skips any folder whose
 * meta is readable, which is precisely the state a HALF-DELETED dictionary is
 * left in. `dropSidecar` deleted `listFiles` order sequentially, where
 * `frame-*` sorts before `head-*` before `meta.json`, so an interrupted drop
 * removes a contiguous run of frame shards and leaves both the heads and the
 * meta describing them intact. On this vault that cost 英辞郎 its shards 0–325
 * — 64% of the reach-for index — while meta still claimed 1,759,832 frames and
 * the repair command reported the dictionary as 正常.
 *
 * Nothing surfaced it because a missing shard file is not an error anywhere:
 * `read` returns null, `decodeLines(null)` returns [], and the caller sees a
 * word with no frames rather than a dictionary with no file (§28 S6 — degrade
 * honestly). Presence-only is nearly free (one `listFiles`); `deep` reads every
 * shard and is the only way to catch a truncated one.
 */
export async function verifySidecar(
  io: SidecarIO, dir: string,
  opts: { deep?: boolean; title?: string; shards?: number } = {},
): Promise<SidecarVerdict> {
  const meta = await readMeta(io, dir);
  const files = io.listFiles ? await io.listFiles(dir).catch(() => [] as string[]) : [];
  const { head, frame, intent } = classifyShardFiles(files);
  const shards = meta?.shards ?? opts.shards ?? DEFAULT_SHARDS;
  const present: Record<ShardFamily, number[]> = { head, frame, intent };

  const v: SidecarVerdict = {
    title: opts.title ?? meta?.title ?? dir.split('/').pop() ?? dir,
    dir,
    ok: true,
    partial: !!meta?.partial,
    claimed: {
      headwords: meta?.headwords ?? 0, frames: meta?.frames ?? 0,
      intents: meta?.intents ?? null, shards,
    },
    found: {
      headShards: head.length, frameShards: frame.length, intentShards: intent.length,
      headwords: null, frames: null, intents: null, bytes: 0,
    },
    problems: [],
    noIntentIndex: false,
  };
  if (!meta) {
    v.ok = false;
    v.problems.push({ kind: 'no-meta' });
    return v;
  }

  // A dictionary converted before the intention family existed simply has no
  // meaning-side index. That is a MISSING CAPABILITY, not damage — it is
  // reported on the verdict and never as a problem, or every book on the shelf
  // would read as broken the moment the family was introduced.
  v.noIntentIndex = meta.intents == null && intent.length === 0;

  const claimedFor: Record<ShardFamily, number> = {
    head: meta.headwords ?? 0,
    frame: meta.frames ?? 0,
    intent: meta.intents ?? 0,
  };

  for (const family of SHARD_FAMILIES) {
    if (family === 'intent' && v.noIntentIndex) continue;
    const have = present[family];
    const claimed = claimedFor[family];
    if (have.length) {
      const max = Math.max(...have);
      if (max >= shards) v.problems.push({ kind: 'shard-overflow', family, max, shards });
    }
    // Absence is only evidence when the density makes an empty shard impossible.
    if (claimed / shards >= DENSITY_FLOOR && have.length < shards) {
      const has = new Set(have);
      const missing: number[] = [];
      for (let s = 0; s < shards; s++) if (!has.has(s)) missing.push(s);
      v.problems.push({ kind: 'missing-shards', family, missing, present: have.length, of: shards });
    }
  }

  if (opts.deep) {
    const counted: Record<ShardFamily, number> = { head: 0, frame: 0, intent: 0 };
    for (const family of SHARD_FAMILIES) {
      for (const s of present[family]) {
        const body = await io.read(shardPathFor(family, dir, s));
        if (!body) continue;
        v.found.bytes += body.length;
        counted[family] += countJsonlLines(body);
      }
    }
    v.found.headwords = counted.head;
    v.found.frames = counted.frame;
    v.found.intents = v.noIntentIndex ? null : counted.intent;
    for (const family of SHARD_FAMILIES) {
      if (family === 'intent' && v.noIntentIndex) continue;
      if (counted[family] !== claimedFor[family]) {
        v.problems.push({ kind: 'count-mismatch', family, claimed: claimedFor[family], found: counted[family] });
      }
    }
  }

  v.ok = v.problems.length === 0;
  return v;
}

/** Every converted dictionary under `root`, worst first. */
export async function verifyAllSidecars(
  io: SidecarIO, root: string,
  opts: {
    deep?: boolean;
    shards?: number;
    onProgress?: (p: { title: string; done: number; total: number; bytes: number }) => void;
    shouldStop?: () => boolean;
  } = {},
): Promise<SidecarVerdict[]> {
  if (!io.listFolders || !io.listFiles) return [];
  const names = await io.listFolders(root).catch(() => [] as string[]);
  const out: SidecarVerdict[] = [];
  let done = 0, bytes = 0;
  for (const name of names) {
    if (opts.shouldStop?.()) break;
    done++;
    const v = await verifySidecar(io, `${root}/${name}`, {
      deep: opts.deep, title: name, shards: opts.shards,
    });
    // A folder with no shards and no meta is not a dictionary — say nothing.
    if (!v.claimed.headwords && !v.found.headShards && !v.found.frameShards && !v.found.intentShards) continue;
    bytes += v.found.bytes;
    out.push(v);
    opts.onProgress?.({ title: name, done, total: names.length, bytes });
  }
  return out.sort((a, b) => Number(a.ok) - Number(b.ok) || b.problems.length - a.problems.length);
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
/**
 * THE MEANING-SIDE LOOKUP (§27.2). One shard read, same as everything else.
 *
 * `intention` is the English want as written — "at some point", "undergo". It
 * is normalized through the shared frame key space, so the caller does not have
 * to know how the index was keyed.
 */
export async function lookupIntent(
  io: SidecarIO, dir: string, intention: string, shards: number = DEFAULT_SHARDS,
): Promise<ReachCandidate[]> {
  const k = intentionKeyOf(intention);
  if (!k) return [];
  const text = await io.read(intentPath(dir, hashKey(normalizeLookupKey(k)) % shards));
  const out: ReachCandidate[] = [];
  for (const l of decodeLines<IntentLine>(text)) {
    if (l.k !== k) continue;
    for (const c of l.c) out.push(unpackIntentCandidate(c, k));
  }
  return out;
}

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
  // META FIRST, always. The deletes below are sequential, so an interrupted
  // drop leaves a partly-emptied folder — and if meta survives it, the folder
  // still looks like a finished dictionary: `repairSidecarMeta` skips anything
  // with readable meta, and lookups into the deleted shards return [] with no
  // error. That is how 英辞郎 lost frame shards 0–325 while still reporting
  // 1,759,832 frames and passing the repair command as 正常. Removing meta
  // first inverts the failure: an interrupted drop now leaves shards with no
  // meta, which repair CAN see and marks 暫定 (§28 S6 — degrade honestly).
  if (await io.exists(metaPath(dir))) await io.remove(metaPath(dir));

  // Preferred: ask what is there (one call) and delete exactly that.
  if (io.listFiles) {
    const files = await io.listFiles(dir).catch(() => [] as string[]);
    for (const f of files) await io.remove(f);
    return;
  }
  // Fallback for IOs without listing: probe every shard path.
  for (let s = 0; s < shards; s++) {
    for (const p of [headPath(dir, s), framePath(dir, s), intentPath(dir, s)]) {
      if (await io.exists(p)) await io.remove(p);
    }
  }
  if (await io.exists(metaPath(dir))) await io.remove(metaPath(dir));
}
