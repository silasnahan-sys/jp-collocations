// ─── Yomitan Dictionary Store ────────────────────────────────────────────────
// IndexedDB-backed persistent storage for imported Yomitan dictionaries.
// Stores term entries, kanji entries, and import metadata.

import type { App } from "obsidian";
import type {
  DictionaryIndex,
  ImportedDictionary,
  KanjiEntry,
  TermEntry,
} from "./types.ts";
import type { DictionaryMeta } from "./types.ts";
import { getDictMetaByTitle } from "./constants.ts";

const DB_NAME = "jp-collocations-yomitan";
const DB_VERSION = 1;

// Object store names
const STORE_TERMS = "terms";
const STORE_KANJI = "kanji";
const STORE_DICTS = "dictionaries";

export class YomitanStore {
  private db: IDBDatabase | null = null;
  // Keep an in-memory list of imported dictionaries for fast UI access
  private _imported: ImportedDictionary[] = [];

  constructor(private readonly app: App) {}

  get importedDictionaries(): ImportedDictionary[] {
    return this._imported;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async open(): Promise<void> {
    if (this.db) return;
    this.db = await this.openDB();
    await this.loadImportedList();
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = ev => {
        const db = (ev.target as IDBOpenDBRequest).result;
        // Terms store: keyed by auto-incrementing id, indexed by term and dictionary
        if (!db.objectStoreNames.contains(STORE_TERMS)) {
          const ts = db.createObjectStore(STORE_TERMS, { autoIncrement: true });
          ts.createIndex("term", "term", { unique: false });
          ts.createIndex("reading", "reading", { unique: false });
          ts.createIndex("dictionary", "dictionary", { unique: false });
          ts.createIndex("term_dict", ["term", "dictionary"], { unique: false });
        }
        // Kanji store
        if (!db.objectStoreNames.contains(STORE_KANJI)) {
          const ks = db.createObjectStore(STORE_KANJI, { autoIncrement: true });
          ks.createIndex("character", "character", { unique: false });
          ks.createIndex("dictionary", "dictionary", { unique: false });
        }
        // Dictionary metadata store: keyed by title
        if (!db.objectStoreNames.contains(STORE_DICTS)) {
          db.createObjectStore(STORE_DICTS, { keyPath: "index.title" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async loadImportedList(): Promise<void> {
    this._imported = await this.getAllFromStore<ImportedDictionary>(STORE_DICTS);
  }

  // ── Import ────────────────────────────────────────────────────────────────

  async importDictionary(
    index: DictionaryIndex,
    terms: TermEntry[],
    kanji: KanjiEntry[],
    overrideMeta?: DictionaryMeta,
  ): Promise<ImportedDictionary> {
    if (!this.db) await this.open();

    // Remove existing data for this dictionary title first
    await this.deleteDictionary(index.title);

    const meta: DictionaryMeta = overrideMeta ?? getDictMetaByTitle(index.title) ?? {
      abbreviation: index.title.slice(0, 8),
      jaTitle: index.title,
      color: "#6B7280",
      category: "専門用語",
      language: "ja",
    };

    const imported: ImportedDictionary = {
      meta,
      index,
      termCount: terms.length,
      importedAt: Date.now(),
    };

    const tx = this.db!.transaction([STORE_TERMS, STORE_KANJI, STORE_DICTS], "readwrite");
    const termStore = tx.objectStore(STORE_TERMS);
    const kanjiStore = tx.objectStore(STORE_KANJI);
    const dictStore = tx.objectStore(STORE_DICTS);

    for (const term of terms) {
      termStore.add(term);
    }
    for (const k of kanji) {
      kanjiStore.add(k);
    }
    dictStore.put(imported);

    await this.txComplete(tx);

    this._imported = this._imported.filter(d => d.index.title !== index.title);
    this._imported.push(imported);

    return imported;
  }

  /** Remove all data for a given dictionary title */
  async deleteDictionary(title: string): Promise<void> {
    if (!this.db) await this.open();

    const tx = this.db!.transaction([STORE_TERMS, STORE_KANJI, STORE_DICTS], "readwrite");
    await this.deleteByIndex(tx.objectStore(STORE_TERMS), "dictionary", title);
    await this.deleteByIndex(tx.objectStore(STORE_KANJI), "dictionary", title);
    tx.objectStore(STORE_DICTS).delete(title);
    await this.txComplete(tx);

    this._imported = this._imported.filter(d => d.index.title !== title);
  }

  // ── Lookup ────────────────────────────────────────────────────────────────

  /** Look up terms by exact headword */
  async lookupTerm(term: string): Promise<TermEntry[]> {
    if (!this.db) await this.open();
    return this.getByIndex<TermEntry>(STORE_TERMS, "term", term);
  }

  /** Look up terms by reading */
  async lookupReading(reading: string): Promise<TermEntry[]> {
    if (!this.db) await this.open();
    return this.getByIndex<TermEntry>(STORE_TERMS, "reading", reading);
  }

  /** Prefix search across all terms (returns up to maxResults) */
  async prefixSearch(prefix: string, maxResults = 50): Promise<TermEntry[]> {
    if (!this.db) await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_TERMS, "readonly");
      const store = tx.objectStore(STORE_TERMS);
      const index = store.index("term");
      const range = IDBKeyRange.bound(prefix, prefix + "\uFFFF");
      const results: TermEntry[] = [];
      const cursor = index.openCursor(range);
      cursor.onsuccess = (ev) => {
        const c = (ev.target as IDBRequest<IDBCursorWithValue>).result;
        if (c && results.length < maxResults) {
          results.push(c.value as TermEntry);
          c.continue();
        } else {
          resolve(results);
        }
      };
      cursor.onerror = () => reject(cursor.error);
    });
  }

  /** Prefix search on readings */
  async prefixSearchReading(prefix: string, maxResults = 50): Promise<TermEntry[]> {
    if (!this.db) await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_TERMS, "readonly");
      const store = tx.objectStore(STORE_TERMS);
      const index = store.index("reading");
      const range = IDBKeyRange.bound(prefix, prefix + "\uFFFF");
      const results: TermEntry[] = [];
      const cursor = index.openCursor(range);
      cursor.onsuccess = (ev) => {
        const c = (ev.target as IDBRequest<IDBCursorWithValue>).result;
        if (c && results.length < maxResults) {
          results.push(c.value as TermEntry);
          c.continue();
        } else {
          resolve(results);
        }
      };
      cursor.onerror = () => reject(cursor.error);
    });
  }

  /** Look up a kanji entry */
  async lookupKanji(character: string): Promise<KanjiEntry[]> {
    if (!this.db) await this.open();
    return this.getByIndex<KanjiEntry>(STORE_KANJI, "character", character);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private getByIndex<T>(storeName: string, indexName: string, key: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).index(indexName).getAll(key);
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  }

  private getAllFromStore<T>(storeName: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  }

  private deleteByIndex(
    store: IDBObjectStore,
    indexName: string,
    key: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const index = store.index(indexName);
      const range = IDBKeyRange.only(key);
      const req = index.openCursor(range);
      req.onsuccess = (ev) => {
        const cursor = (ev.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  private txComplete(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error("Transaction aborted"));
    });
  }
}
