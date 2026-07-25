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

  /** Upsert entries from a (re)reconciliation of one file — preserves class
   *  already set, and a 'commentary' triage (a re-run must not re-flag it). */
  upsertMany(entries: LibraryEntry[]): void {
    for (const e of entries) {
      const prev = this.byId.get(e.blockId);
      const status = prev?.status === 'commentary' && e.status === 'needs-review' ? 'commentary' : e.status;
      this.byId.set(e.blockId, prev ? { ...e, noteClass: prev.noteClass, status } : e);
    }
    void this.persist();
  }

  /** Drop all entries anchored in a given file (before rewriting it). */
  removeForFile(file: string): void {
    for (const [id, e] of this.byId) if (e.file === file) this.byId.delete(id);
  }

  /** Drop entries for one (transcript, source-notes) pair — a re-run of that
   *  notes file replaces exactly its own entries, never another run's. */
  removeForSourceNote(transcriptFile: string, sourceNote: string): void {
    for (const [id, e] of this.byId) {
      if (e.file === transcriptFile && e.sourceNote === sourceNote) this.byId.delete(id);
    }
  }

  /** Drop one entry (triage edit-retry replaces it under a new block id). */
  remove(blockId: string): void {
    if (this.byId.delete(blockId)) void this.persist();
  }

  /** Triage: flip an entry's status (e.g. needs-review ⇄ commentary). */
  setStatus(blockId: string, status: LibraryEntry['status']): LibraryEntry | undefined {
    const e = this.byId.get(blockId);
    if (!e) return undefined;
    e.status = status;
    void this.persist();
    return e;
  }

  setClass(blockId: string, cls: NoteClass): LibraryEntry | undefined {
    const e = this.byId.get(blockId);
    if (!e) return undefined;
    e.noteClass = cls;
    void this.persist();
    return e;
  }

  get(blockId: string): LibraryEntry | undefined { return this.byId.get(blockId); }

  /** All entries anchored in a given file. */
  forFile(file: string): LibraryEntry[] {
    return [...this.byId.values()].filter((e) => e.file === file);
  }

  /** Patch one entry's anchorId (cluster re-formed on a later run). */
  setAnchorId(blockId: string, anchorId: string): void {
    const e = this.byId.get(blockId);
    if (e && e.anchorId !== anchorId) { e.anchorId = anchorId; void this.persist(); }
  }

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
