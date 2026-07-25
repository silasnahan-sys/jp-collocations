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
 * PURE — no Obsidian imports; file IO is injected. Golden-tested in
 * golden/storage.mjs.
 */

export interface BlobFileIO {
  /** Raw file text, or null when the file does not exist. */
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
}

export interface BlobLoadResult {
  /** true when the main file was unparseable and .bak was loaded instead. */
  restoredFromBackup: boolean;
  /** true when the main file existed but neither it nor .bak parsed. */
  corrupt: boolean;
}

export class DataManager {
  private blob: Record<string, unknown> = {};
  /** Last serialization known to be fully on disk — the .bak source. */
  private lastGoodText: string | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waiters: (() => void)[] = [];
  private dirty = false;
  /** Completed main-file writes this session (debug dump + goldens). */
  writes = 0;

  private io: BlobFileIO;
  private path: string;
  private bakPath: string;
  private debounceMs: number;

  // no parameter properties: golden suites run this file under Node's
  // strip-only TS loader, which rejects them
  constructor(io: BlobFileIO, path: string, bakPath: string, debounceMs = 800) {
    this.io = io;
    this.path = path;
    this.bakPath = bakPath;
    this.debounceMs = debounceMs;
  }

  async load(): Promise<BlobLoadResult> {
    const raw = await this.io.read(this.path).catch(() => null);
    if (raw == null) {
      this.blob = {};
      return { restoredFromBackup: false, corrupt: false };
    }
    const main = parseObjectOrNull(raw);
    if (main) {
      this.blob = main;
      this.lastGoodText = raw;
      return { restoredFromBackup: false, corrupt: false };
    }
    const bakRaw = await this.io.read(this.bakPath).catch(() => null);
    const bak = bakRaw ? parseObjectOrNull(bakRaw) : null;
    if (bak && bakRaw) {
      this.blob = bak;
      this.lastGoodText = bakRaw;
      // Re-materialize the main file NOW: restoring only into memory leaves
      // the corrupt/empty main on disk until the next change, and .bak is
      // the sole surviving copy for that whole window (observed live:
      // a truncated 0-byte data.json sat for hours on an idle session).
      void this.schedule();
      return { restoredFromBackup: true, corrupt: false };
    }
    this.blob = {};
    return { restoredFromBackup: false, corrupt: true };
  }

  get<T>(key: string): T | undefined { return this.blob[key] as T | undefined; }
  has(key: string): boolean { return key in this.blob; }

  /** The live canonical blob — READ-ONLY convenience for load-time wiring.
   *  Mutate only through setKey/setSettings/mutate so writes get scheduled. */
  snapshot(): Record<string, unknown> { return this.blob; }

  setKey(key: string, value: unknown): Promise<void> {
    this.blob[key] = value;
    return this.schedule();
  }

  deleteKey(key: string): Promise<void> {
    delete this.blob[key];
    return this.schedule();
  }

  /** Apply an in-place migration; schedules a write only if fn reports change. */
  mutate(fn: (blob: Record<string, unknown>) => boolean): Promise<void> {
    return fn(this.blob) ? this.schedule() : Promise.resolve();
  }

  /** Overwrite .bak with the CURRENT on-disk state. Call after a migration
   *  that removed secrets — the normal rolling backup is one generation
   *  behind, which would keep the secret-bearing version alive in a synced
   *  file. Costs one backup generation; the corpus is intact in main. */
  async alignBackup(): Promise<void> {
    if (this.lastGoodText != null) await this.io.write(this.bakPath, this.lastGoodText);
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
    return this.schedule();
  }

  private schedule(): Promise<void> {
    this.dirty = true;
    const done = new Promise<void>((res) => this.waiters.push(res));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, this.debounceMs);
    return done;
  }

  /** Write now if dirty. Chained onto any in-flight write — never overlaps.
   *  Call on plugin unload. */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.dirty) return this.writeChain;
    this.dirty = false;
    const waiters = this.waiters;
    this.waiters = [];
    const text = JSON.stringify(this.blob);
    this.writeChain = this.writeChain
      .then(async () => {
        if (this.lastGoodText != null && this.lastGoodText !== text) {
          await this.io.write(this.bakPath, this.lastGoodText);
        }
        await this.io.write(this.path, text);
        this.lastGoodText = text;
        this.writes++;
      })
      .catch((e) => {
        // canonical state is still in memory; the next change retries the write
        console.error('[jp-collocations] blob write failed', e);
        this.dirty = true;
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
