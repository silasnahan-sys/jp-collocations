/**
 * recon-library.ts — the persisted index of anchored reconciliation callouts.
 *
 * Holds only LibraryEntry references (block IDs + metadata), never note copies
 * (invariant #1). Persisted under `_reconLibrary` in the plugin-data blob.
 * Keyed by block ID so re-runs upsert rather than duplicate (invariant #5).
 */

import type { LibraryEntry } from './annotate.ts';
import type { NoteClass } from './note-types.ts';

export interface ReconLibraryData {
  entries: LibraryEntry[];
}

export class ReconLibrary {
  private byId = new Map<string, LibraryEntry>();

  constructor(private persist: () => void | Promise<void>) {}

  loadFromData(data?: ReconLibraryData): void {
    this.byId.clear();
    for (const e of data?.entries ?? []) this.byId.set(e.blockId, e);
  }

  toData(): ReconLibraryData {
    return { entries: this.all() };
  }

  /** Upsert entries from a (re)reconciliation of one file — preserves class already set. */
  upsertMany(entries: LibraryEntry[]): void {
    for (const e of entries) {
      const prev = this.byId.get(e.blockId);
      this.byId.set(e.blockId, prev ? { ...e, noteClass: prev.noteClass } : e);
    }
    void this.persist();
  }

  /** Drop all entries anchored in a given file (before rewriting it). */
  removeForFile(file: string): void {
    for (const [id, e] of this.byId) if (e.file === file) this.byId.delete(id);
  }

  setClass(blockId: string, cls: NoteClass): LibraryEntry | undefined {
    const e = this.byId.get(blockId);
    if (!e) return undefined;
    e.noteClass = cls;
    void this.persist();
    return e;
  }

  get(blockId: string): LibraryEntry | undefined { return this.byId.get(blockId); }

  /** Prior class map for one file (feeds annotate so re-runs keep the class). */
  classMapForFile(file: string): Map<string, NoteClass> {
    const m = new Map<string, NoteClass>();
    for (const e of this.byId.values()) if (e.file === file) m.set(e.blockId, e.noteClass);
    return m;
  }

  all(): LibraryEntry[] {
    return [...this.byId.values()].sort(
      (a, b) => a.file.localeCompare(b.file) || (a.tStartSec ?? 0) - (b.tStartSec ?? 0),
    );
  }

  count(): number { return this.byId.size; }
}
