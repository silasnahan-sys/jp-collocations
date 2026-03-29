// ─── Yomitan Dictionary Parser ───────────────────────────────────────────────
// Parses Yomitan/Yomichan .zip dictionary files.
// Supports term_bank_*.json, kanji_bank_*.json and index.json.

import type {
  DictionaryIndex,
  KanjiEntry,
  TermEntry,
  TermDefinition,
  TermDefinitionContent,
} from "./types.ts";

/**
 * Raw row from a Yomitan term_bank_*.json file.
 * Format (v3): [term, reading, defTags, rules, score, glossary[], sequence, termTags]
 */
type RawTermRow = [string, string, string, string, number, unknown[], number, string];

/**
 * Raw row from a Yomitan kanji_bank_*.json file.
 * Format: [character, onyomi, kunyomi, tags, meanings[], stats{}]
 */
type RawKanjiRow = [string, string, string, string, string[], Record<string, string>];

export class YomitanDictionary {
  private indexData: DictionaryIndex | null = null;
  private termEntries: TermEntry[] = [];
  private kanjiEntries: KanjiEntry[] = [];

  get index(): DictionaryIndex | null {
    return this.indexData;
  }

  get terms(): TermEntry[] {
    return this.termEntries;
  }

  get kanji(): KanjiEntry[] {
    return this.kanjiEntries;
  }

  /** Load and parse a Yomitan dictionary ZIP file */
  async loadFromFile(file: File): Promise<void> {
    const buffer = await file.arrayBuffer();
    await this.loadFromArrayBuffer(buffer);
  }

  /** Load and parse a Yomitan dictionary from an ArrayBuffer */
  async loadFromArrayBuffer(buffer: ArrayBuffer): Promise<void> {
    const zipjs = await this.importJSZip();
    const { ZipReader, TextWriter, BlobReader } = zipjs;
    const blob = new Blob([buffer]);
    const reader = new ZipReader(new BlobReader(blob));
    const entries = await reader.getEntries();

    const fileMap = new Map<string, unknown>();
    for (const entry of entries) {
      // FileEntry (not DirectoryEntry) has getData
      const fileEntry = entry as { filename: string; getData?: (writer: unknown) => Promise<string> };
      if (!fileEntry.getData) continue;
      const name = fileEntry.filename;
      const text = await fileEntry.getData(new TextWriter());
      try {
        fileMap.set(name, JSON.parse(text));
      } catch {
        // ignore non-JSON files
      }
    }
    await reader.close();
    this.parseFileMap(fileMap);
  }

  /** Load from a plain object map (filename → parsed JSON), used in tests */
  loadFromFileMap(fileMap: Map<string, unknown>): void {
    this.parseFileMap(fileMap);
  }

  private parseFileMap(fileMap: Map<string, unknown>): void {
    // Parse index.json
    if (fileMap.has("index.json")) {
      this.indexData = fileMap.get("index.json") as DictionaryIndex;
    }

    const dictName = this.indexData?.title ?? "unknown";

    // Parse all term banks
    this.termEntries = [];
    const termBankKeys = [...fileMap.keys()]
      .filter(k => /^term_bank_\d+\.json$/.test(k))
      .sort();
    for (const key of termBankKeys) {
      const rows = fileMap.get(key) as RawTermRow[];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const entry = this.parseTermRow(row, dictName);
        if (entry) this.termEntries.push(entry);
      }
    }

    // Parse all kanji banks
    this.kanjiEntries = [];
    const kanjiBankKeys = [...fileMap.keys()]
      .filter(k => /^kanji_bank_\d+\.json$/.test(k))
      .sort();
    for (const key of kanjiBankKeys) {
      const rows = fileMap.get(key) as RawKanjiRow[];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const entry = this.parseKanjiRow(row, dictName);
        if (entry) this.kanjiEntries.push(entry);
      }
    }
  }

  private parseTermRow(row: RawTermRow, dictName: string): TermEntry | null {
    if (!Array.isArray(row) || row.length < 6) return null;
    const [term, reading, defTagsStr, , , glossaryItems, sequence, termTagsStr] = row;
    if (typeof term !== "string") return null;

    const tags = [
      ...(defTagsStr ? defTagsStr.split(" ").filter(Boolean) : []),
      ...(typeof termTagsStr === "string" ? termTagsStr.split(" ").filter(Boolean) : []),
    ];

    const content = this.parseGlossaryItems(glossaryItems);

    const definition: TermDefinition = {
      type: "term",
      dictionary: dictName,
      tags,
      content,
      sequence: typeof sequence === "number" ? sequence : undefined,
    };

    return {
      term,
      reading: typeof reading === "string" ? reading : term,
      definitions: [definition],
      dictionary: dictName,
    };
  }

  private parseGlossaryItems(items: unknown[]): TermDefinitionContent[] {
    if (!Array.isArray(items)) return [];
    return items.map(item => {
      if (typeof item === "string") {
        return { type: "text" as const, text: item };
      }
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        if (obj.type === "image") {
          return { type: "image" as const, content: obj };
        }
        return { type: "structured-content" as const, content: obj };
      }
      return { type: "text" as const, text: String(item) };
    });
  }

  private parseKanjiRow(row: RawKanjiRow, dictName: string): KanjiEntry | null {
    if (!Array.isArray(row) || row.length < 5) return null;
    const [character, onyomiStr, kunyomiStr, tagsStr, meanings, stats] = row;
    if (typeof character !== "string") return null;

    return {
      character,
      onyomi: typeof onyomiStr === "string" ? onyomiStr.split(" ").filter(Boolean) : [],
      kunyomi: typeof kunyomiStr === "string" ? kunyomiStr.split(" ").filter(Boolean) : [],
      tags: typeof tagsStr === "string" ? tagsStr.split(" ").filter(Boolean) : [],
      meanings: Array.isArray(meanings) ? meanings.filter(m => typeof m === "string") : [],
      stats: (typeof stats === "object" && stats !== null) ? stats as Record<string, string> : {},
      dictionary: dictName,
    };
  }

  // ── Dynamic import helper ─────────────────────────────────────────────────

  private importJSZip(): Promise<typeof import("@zip.js/zip.js")> {
    return import("@zip.js/zip.js");
  }
}
