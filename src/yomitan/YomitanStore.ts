import type { YomitanEntry, ImportedDictionary, DictionaryBookmark, HistoryEntry } from "./types.ts";
import { YOMITAN_STORE_DB, YOMITAN_STORE_VERSION, MAX_HISTORY } from "./constants.ts";

export class YomitanStore {
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(YOMITAN_STORE_DB, YOMITAN_STORE_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains("entries")) {
          const store = db.createObjectStore("entries", { keyPath: ["dictionaryTitle", "expression", "sequence"] });
          store.createIndex("expression", "expression");
          store.createIndex("dictionaryTitle", "dictionaryTitle");
          store.createIndex("expressionReading", ["expression", "reading"]);
        }
        if (!db.objectStoreNames.contains("dictionaries")) {
          db.createObjectStore("dictionaries", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("bookmarks")) {
          db.createObjectStore("bookmarks", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("history")) {
          db.createObjectStore("history", { keyPath: "query" });
        }
      };
      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  }

  private tx(storeNames: string | string[], mode: IDBTransactionMode = "readonly"): IDBTransaction {
    if (!this.db) throw new Error("Database not open");
    return this.db.transaction(storeNames, mode);
  }

  async addDictionary(meta: ImportedDictionary, entries: YomitanEntry[]): Promise<void> {
    // Store metadata
    await this.put("dictionaries", meta);
    // Batch store entries
    const BATCH = 500;
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      await new Promise<void>((resolve, reject) => {
        const t = this.tx("entries", "readwrite");
        const store = t.objectStore("entries");
        for (const entry of batch) store.put(entry);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      });
    }
  }

  async deleteDictionary(id: string): Promise<void> {
    // Get title first
    const meta = await this.get<ImportedDictionary>("dictionaries", id);
    if (!meta) return;
    await this.delete("dictionaries", id);
    // Remove all entries for this dictionary
    await new Promise<void>((resolve, reject) => {
      const t = this.tx("entries", "readwrite");
      const store = t.objectStore("entries");
      const idx = store.index("dictionaryTitle");
      const req = idx.openCursor(IDBKeyRange.only(meta.title));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  async getDictionaries(): Promise<ImportedDictionary[]> {
    return this.getAll<ImportedDictionary>("dictionaries");
  }

  async updateDictionary(meta: ImportedDictionary): Promise<void> {
    await this.put("dictionaries", meta);
  }

  async searchEntries(query: string, dictTitles?: string[]): Promise<YomitanEntry[]> {
    if (!query.trim()) return [];
    return new Promise((resolve, reject) => {
      const t = this.tx("entries", "readonly");
      const store = t.objectStore("entries");
      const idx = store.index("expression");
      const results: YomitanEntry[] = [];
      const req = idx.openCursor(IDBKeyRange.bound(query, query + "\uffff"));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) { resolve(results); return; }
        const entry = cursor.value as YomitanEntry;
        if (!dictTitles || dictTitles.includes(entry.dictionaryTitle)) {
          results.push(entry);
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getBookmarks(): Promise<DictionaryBookmark[]> {
    return this.getAll<DictionaryBookmark>("bookmarks");
  }

  async addBookmark(bm: DictionaryBookmark): Promise<void> {
    await this.put("bookmarks", bm);
  }

  async removeBookmark(id: string): Promise<void> {
    await this.delete("bookmarks", id);
  }

  async getHistory(): Promise<HistoryEntry[]> {
    const all = await this.getAll<HistoryEntry>("history");
    return all.sort((a, b) => b.timestamp - a.timestamp);
  }

  async addHistory(query: string): Promise<void> {
    await this.put("history", { query, timestamp: Date.now() });
    // Trim history
    const all = await this.getHistory();
    if (all.length > MAX_HISTORY) {
      const toRemove = all.slice(MAX_HISTORY);
      for (const item of toRemove) await this.delete("history", item.query);
    }
  }

  async clearHistory(): Promise<void> {
    const t = this.tx("history", "readwrite");
    t.objectStore("history").clear();
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  private get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const t = this.tx(storeName);
      const req = t.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  private getAll<T>(storeName: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const t = this.tx(storeName);
      const req = t.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  }

  private put(storeName: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = this.tx(storeName, "readwrite");
      const req = t.objectStore(storeName).put(value);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private delete(storeName: string, key: IDBValidKey): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = this.tx(storeName, "readwrite");
      const req = t.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
