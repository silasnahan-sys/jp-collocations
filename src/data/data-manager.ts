/**
 * data-manager.ts — the ONE owner of the plugin-data blob (AUDIT §1).
 *
 * Before this existed, every store persisted via read-modify-write of the
 * whole data.json, and loadSettings() captured the entire blob — store keys
 * included — into this.settings, which saveSettings() then wrote back. Any
 * settings save therefore reverted every store to its plugin-load snapshot.
 *
 * Contract:
 *  - load() once at startup; the in-memory blob is canonical from then on.
 *    Nobody re-reads the file after load.
 *  - setKey / deleteKey / setSettings / mutate change the canonical blob and
 *    schedule ONE debounced write; rapid callers coalesce, and writes are
 *    serialized — a write never overlaps another (kills the lost-update race
 *    between concurrently persisting stores).
 *  - setSettings can only touch non-underscore keys: store keys are protected
 *    by the SHAPE of the operation, not by caller discipline.
 *  - Every write first saves the previous good serialization to the .bak path
 *    (a crash mid-write can no longer destroy the corpus); a corrupt main
 *    file is restored from .bak on load.
 *
 * ## Partitioning — why one file stopped being enough
 *
 * The contract above says "schedule ONE debounced write", and for a long time
 * that write was the whole blob. Measured on the live vault 2026-08-06:
 * data.json was **15.17 MB**, of which `_patternStore` alone was 11.4 MB
 * (18,143 attestations). Every flush() serialized all of it, wrote the previous
 * copy to .bak, then wrote the new one — **~30 MB of file IO to record that a
 * checkbox moved.** On a desktop NVMe that is ~90ms and invisible. In Obsidian
 * for iPadOS it is seconds, on the main thread, every 800ms while you study.
 *
 * The fix is not to store less. It is to stop making unrelated keys share a
 * write. Every store in this plugin persists through exactly ONE `setKey(key,
 * …)` call, so which key changed is known exactly — no diffing, no guessing.
 * A store key whose serialization is large gets its own file, and a flush
 * writes only the files whose keys were actually touched. Marking a card no
 * longer rewrites the corpus.
 *
 * Ordering is chosen so that an interrupted flush cannot lose a key: partition
 * files are written FIRST, the manifest-bearing main file LAST, and partition
 * files are deleted only after the main file no longer points at them. A crash
 * at any point leaves a main file whose `_parts` list is satisfiable — either
 * the key is still inline in the older main, or its file is already there.
 * (The same reasoning as dropSidecar's meta-first rule, which is where the
 * 英辞郎 frame index was lost by getting it backwards.)
 *
 * A partition that is listed but unreadable is NOT treated as an empty store.
 * It is quarantined: reads see nothing, writes to that key are REFUSED, and
 * load() reports it. Silently presenting an empty corpus and then persisting
 * that emptiness over the .bak is precisely how a 64% hole went unnoticed for
 * weeks in the dictionary sidecars.
 *
 * PURE — no Obsidian imports; file IO is injected. Golden-tested in
 * golden/storage.mjs.
 */

export interface BlobFileIO {
  /** Raw file text, or null when the file does not exist. */
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  /** Optional. Without it, a demoted partition file is emptied instead of
   *  removed — harmless, just a stray file. */
  remove?(path: string): Promise<void>;
}

export interface BlobLoadResult {
  /** true when the main file was unparseable and .bak was loaded instead. */
  restoredFromBackup: boolean;
  /** true when the main file existed but neither it nor .bak parsed. */
  corrupt: boolean;
  /** Store keys the manifest promised and neither the partition file nor its
   *  .bak could supply. These keys are QUARANTINED: absent from the blob and
   *  refusing writes, so a missing file cannot be overwritten with emptiness. */
  missingPartitions: string[];
}

export interface PartitionOptions {
  /** Folder for partition files. Partitioning is OFF when this is absent, and
   *  the manager behaves exactly as the single-file version did. */
  dir: string;
  /**
   * A store key is promoted to its own file once its serialization reaches
   * this many characters. Demotion happens at half of it — the gap is
   * hysteresis, so a key sitting exactly on the line does not flip families
   * (and pay two extra writes) on every single flush.
   */
  minChars?: number;
}

/** Manifest key inside the main file: which store keys live in their own file. */
const PARTS_KEY = '_parts';
const DEFAULT_MIN_CHARS = 64 * 1024;

/** Only store keys (leading `_`) are ever partitioned, and only when the name
 *  maps to a filename injectively. Anything else stays inline — a key that
 *  cannot be named safely is not worth a clever encoding. */
const PARTITIONABLE = /^_[A-Za-z0-9_-]+$/;

export class DataManager {
  private blob: Record<string, unknown> = {};
  /** Last serialization known to be fully on disk, per file path — the .bak
   *  source. Keyed by path so each file backs up only its own history. */
  private lastGood = new Map<string, string>();
  private writeChain: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waiters: (() => void)[] = [];
  /** Store keys changed since the last completed write. */
  private dirtyKeys = new Set<string>();
  /** The settings slice / small-key body changed, or the manifest must move. */
  private mainDirty = false;
  /** Keys currently living in their own file, per the manifest we will write. */
  private parts = new Set<string>();
  /** Listed by the manifest but unreadable — reads see nothing, writes refuse. */
  private quarantined = new Set<string>();
  /** Completed main-file writes this session (debug dump + goldens). */
  writes = 0;
  /** Completed partition-file writes this session. */
  partWrites = 0;

  private io: BlobFileIO;
  private path: string;
  private bakPath: string;
  private debounceMs: number;
  private partDir: string | null;
  private minChars: number;

  // no parameter properties: golden suites run this file under Node's
  // strip-only TS loader, which rejects them
  constructor(
    io: BlobFileIO,
    path: string,
    bakPath: string,
    debounceMs = 800,
    partition?: PartitionOptions,
  ) {
    this.io = io;
    this.path = path;
    this.bakPath = bakPath;
    this.debounceMs = debounceMs;
    this.partDir = partition?.dir ?? null;
    this.minChars = partition?.minChars ?? DEFAULT_MIN_CHARS;
  }

  /** Where a store key's own file lives. Injective over PARTITIONABLE keys. */
  partPath(key: string): string { return `${this.partDir}/part${key}.json`; }

  async load(): Promise<BlobLoadResult> {
    const raw = await this.io.read(this.path).catch(() => null);
    if (raw == null) {
      this.blob = {};
      return { restoredFromBackup: false, corrupt: false, missingPartitions: [] };
    }
    const main = parseObjectOrNull(raw);
    let restoredFromBackup = false;
    if (main) {
      this.blob = main;
      this.lastGood.set(this.path, raw);
    } else {
      const bakRaw = await this.io.read(this.bakPath).catch(() => null);
      const bak = bakRaw ? parseObjectOrNull(bakRaw) : null;
      if (!bak || !bakRaw) {
        this.blob = {};
        return { restoredFromBackup: false, corrupt: true, missingPartitions: [] };
      }
      this.blob = bak;
      restoredFromBackup = true;
      // Deliberately NO lastGood for the main path: what is on disk there is
      // corrupt, so there is no previous good main serialization. Leaving it
      // unset also stops flush()'s "identical, skip the write" shortcut from
      // mistaking the .bak text for the main file's current content and
      // leaving the corpse in place.
      // Re-materialize the main file NOW: restoring only into memory leaves
      // the corrupt/empty main on disk until the next change, and .bak is
      // the sole surviving copy for that whole window (observed live:
      // a truncated 0-byte data.json sat for hours on an idle session).
      this.mainDirty = true;
    }

    const missingPartitions = await this.loadPartitions();
    if (restoredFromBackup) void this.schedule();
    return { restoredFromBackup, corrupt: false, missingPartitions };
  }

  /** Pull every key the manifest promises back into the canonical blob. */
  private async loadPartitions(): Promise<string[]> {
    const listed = this.blob[PARTS_KEY];
    delete this.blob[PARTS_KEY];               // manifest is ours, never a store
    if (!this.partDir || !Array.isArray(listed)) return [];

    const missing: string[] = [];
    for (const key of listed) {
      if (typeof key !== 'string' || !PARTITIONABLE.test(key)) continue;
      const p = this.partPath(key);
      const text = await this.io.read(p).catch(() => null);
      let value = text == null ? undefined : parseAnyOrUndefined(text);
      let fromBak = false;
      if (value === undefined) {
        const bakText = await this.io.read(`${p}.bak`).catch(() => null);
        value = bakText == null ? undefined : parseAnyOrUndefined(bakText);
        // The .bak answered, so the good copy is the one we now hold. Mark the
        // key dirty and leave `lastGood` UNSET for this path — what is on disk
        // is a corpse, and seeding lastGood with the recovered text would make
        // flush()'s identical-content shortcut skip the repair and leave it.
        if (value !== undefined) { fromBak = true; this.dirtyKeys.add(key); }
      }
      if (value === undefined) {
        // Keep it in the manifest. The file is missing *now* — a sync that
        // has not caught up yet, a half-restored backup — and dropping the
        // pointer would turn a recoverable gap into a permanent one.
        missing.push(key);
        this.quarantined.add(key);
        this.parts.add(key);
        continue;
      }
      this.blob[key] = value;
      this.parts.add(key);
      if (text != null && !fromBak) this.lastGood.set(p, text);
    }
    return missing;
  }

  get<T>(key: string): T | undefined { return this.blob[key] as T | undefined; }
  has(key: string): boolean { return key in this.blob; }
  /** Keys whose file could not be read. Writes to these are refused. */
  quarantinedKeys(): string[] { return [...this.quarantined]; }
  /** Keys currently stored in their own file (debug dump). */
  partitionedKeys(): string[] { return [...this.parts].sort(); }

  /** The live canonical blob — READ-ONLY convenience for load-time wiring.
   *  Mutate only through setKey/setSettings/mutate so writes get scheduled. */
  snapshot(): Record<string, unknown> { return this.blob; }

  setKey(key: string, value: unknown): Promise<void> {
    // A quarantined key's file is missing, not empty. Writing here would
    // persist whatever the store defaulted to over the last good copy — the
    // exact shape of the sidecar loss this design is answering.
    if (this.quarantined.has(key)) {
      return Promise.reject(new Error(
        `[jp-collocations] refusing to write "${key}": its partition file is missing. `
        + `The in-memory value is a default, not your data.`));
    }
    this.blob[key] = value;
    return this.schedule(key);
  }

  deleteKey(key: string): Promise<void> {
    delete this.blob[key];
    this.quarantined.delete(key);
    return this.schedule(key);
  }

  /** Apply an in-place migration; schedules a write only if fn reports change.
   *  A migration may touch anything, so this dirties every key. */
  mutate(fn: (blob: Record<string, unknown>) => boolean): Promise<void> {
    if (!fn(this.blob)) return Promise.resolve();
    for (const k of Object.keys(this.blob)) this.dirtyKeys.add(k);
    return this.schedule();
  }

  /**
   * Move keys between inline and their own file to match the current sizes,
   * without changing any value. Call once after load(): it makes the FIRST
   * expensive write happen at startup rather than under the user's first tap,
   * and it is a no-op when the layout is already right.
   */
  repartition(): Promise<void> {
    if (!this.partDir || !this.planLayout()) return Promise.resolve();
    return this.schedule();
  }

  /** Overwrite .bak with the CURRENT on-disk state. Call after a migration
   *  that removed secrets — the normal rolling backup is one generation
   *  behind, which would keep the secret-bearing version alive in a synced
   *  file. Costs one backup generation; the corpus is intact in main. */
  async alignBackup(): Promise<void> {
    const main = this.lastGood.get(this.path);
    if (main != null) await this.io.write(this.bakPath, main);
    for (const key of this.parts) {
      const t = this.lastGood.get(this.partPath(key));
      if (t != null) await this.io.write(`${this.partPath(key)}.bak`, t);
    }
  }

  /** The settings-shaped view: every top-level key that is not a _store. */
  settingsSlice(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.blob)) if (!k.startsWith('_')) out[k] = v;
    return out;
  }

  /** Replace ONLY the settings keys; underscore store keys are unreachable
   *  through this path. */
  setSettings(settings: Record<string, unknown>): Promise<void> {
    for (const k of Object.keys(this.blob)) if (!k.startsWith('_')) delete this.blob[k];
    for (const [k, v] of Object.entries(settings)) if (!k.startsWith('_')) this.blob[k] = v;
    this.mainDirty = true;
    return this.schedule();
  }

  private schedule(key?: string): Promise<void> {
    if (key) this.dirtyKeys.add(key); else this.mainDirty = true;
    const done = new Promise<void>((res) => this.waiters.push(res));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, this.debounceMs);
    return done;
  }

  /**
   * Decide which keys deserve their own file. Returns true when the layout
   * moved, and dirties both the moved keys and the main file (the manifest
   * changed, and so did what main carries inline).
   */
  private planLayout(): boolean {
    if (!this.partDir) return false;
    const demoteAt = Math.floor(this.minChars / 2);
    let moved = false;
    for (const [k, v] of Object.entries(this.blob)) {
      if (!PARTITIONABLE.test(k) || this.quarantined.has(k)) continue;
      const size = JSON.stringify(v)?.length ?? 0;
      const isPart = this.parts.has(k);
      // hysteresis: promote at minChars, demote only below half of it
      const want = isPart ? size >= demoteAt : size >= this.minChars;
      if (want === isPart) continue;
      if (want) this.parts.add(k); else this.parts.delete(k);
      this.dirtyKeys.add(k);
      moved = true;
    }
    // a key that vanished from the blob leaves the manifest too — except a
    // quarantined one, which is absent precisely because its file is missing
    for (const k of [...this.parts]) {
      if (this.quarantined.has(k)) continue;
      if (!(k in this.blob)) { this.parts.delete(k); this.dirtyKeys.add(k); moved = true; }
    }
    if (moved) this.mainDirty = true;
    return moved;
  }

  /** Write now if dirty. Chained onto any in-flight write — never overlaps.
   *  Call on plugin unload. */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.dirtyKeys.size && !this.mainDirty) return this.writeChain;

    this.planLayout();

    // Serialize NOW, on the caller's turn, so the bodies cannot drift while
    // the chained write waits — the same reason the single-file version took
    // its snapshot before chaining.
    const partsToWrite: { path: string; text: string }[] = [];
    const filesToDrop: string[] = [];
    for (const key of this.dirtyKeys) {
      if (!this.partDir) continue;
      const p = this.partPath(key);
      if (this.parts.has(key)) partsToWrite.push({ path: p, text: JSON.stringify(this.blob[key]) });
      else if (this.lastGood.has(p)) filesToDrop.push(p);   // demoted or deleted
    }
    const mainObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.blob)) if (!this.parts.has(k)) mainObj[k] = v;
    if (this.parts.size) mainObj[PARTS_KEY] = [...this.parts].sort();
    const mainText = JSON.stringify(mainObj);

    this.dirtyKeys.clear();
    this.mainDirty = false;
    const waiters = this.waiters;
    this.waiters = [];

    this.writeChain = this.writeChain
      .then(async () => {
        // 1. partition files first — main's manifest must never promise a
        //    file that is not on disk yet
        for (const { path, text } of partsToWrite) {
          const prev = this.lastGood.get(path);
          if (prev === text) continue;              // untouched value, skip both writes
          if (prev != null) await this.io.write(`${path}.bak`, prev);
          await this.io.write(path, text);
          this.lastGood.set(path, text);
          this.partWrites++;
        }
        // 2. then main, which is what makes the new layout authoritative
        const prevMain = this.lastGood.get(this.path);
        if (prevMain !== mainText) {
          if (prevMain != null) await this.io.write(this.bakPath, prevMain);
          await this.io.write(this.path, mainText);
          this.lastGood.set(this.path, mainText);
          this.writes++;
        }
        // 3. only now is it safe to drop files main no longer points at
        for (const path of filesToDrop) {
          this.lastGood.delete(path);
          if (this.io.remove) await this.io.remove(path).catch(() => {});
          else await this.io.write(path, '').catch(() => {});
        }
      })
      .catch((e) => {
        // canonical state is still in memory; the next change retries the write
        console.error('[jp-collocations] blob write failed', e);
        this.mainDirty = true;
        for (const { path } of partsToWrite) {
          for (const [k] of Object.entries(this.blob)) if (this.partPath(k) === path) this.dirtyKeys.add(k);
        }
      })
      .finally(() => { for (const w of waiters) w(); });
    return this.writeChain;
  }
}

function parseObjectOrNull(s: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A partition body may legitimately be an array or an object, so the only
 *  failure worth reporting is "did not parse". `undefined` means unreadable. */
function parseAnyOrUndefined(s: string): unknown {
  try {
    const v: unknown = JSON.parse(s);
    return v === undefined ? undefined : v;
  } catch {
    return undefined;
  }
}
