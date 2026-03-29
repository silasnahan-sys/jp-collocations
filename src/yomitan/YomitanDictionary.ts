import type { DictionaryIndex, TermBankEntry, TagBankEntry, YomitanEntry, ImportedDictionary } from "./types.ts";

export class YomitanDictionary {
  static async importFromZip(
    file: File,
    onProgress?: (msg: string) => void
  ): Promise<{ meta: ImportedDictionary; entries: YomitanEntry[] }> {
    onProgress?.("Reading ZIP file…");

    // Use the browser's native DecompressionStream via a simple ZIP parser
    const buffer = await file.arrayBuffer();
    const files = await YomitanDictionary.parseZip(buffer);

    onProgress?.("Parsing index.json…");
    const indexFile = files["index.json"];
    if (!indexFile) throw new Error("Missing index.json in dictionary ZIP");
    const index: DictionaryIndex = JSON.parse(new TextDecoder().decode(indexFile));

    // Parse tag banks
    const tags: Record<string, string> = {};
    for (const [name, data] of Object.entries(files)) {
      if (/^tag_bank_\d+\.json$/.test(name)) {
        const rows: TagBankEntry[] = JSON.parse(new TextDecoder().decode(data));
        for (const [tagName, , , notes] of rows) {
          tags[tagName] = notes;
        }
      }
    }

    // Parse term banks
    const entries: YomitanEntry[] = [];
    const termBankNames = Object.keys(files)
      .filter(n => /^term_bank_\d+\.json$/.test(n))
      .sort((a, b) => {
        const na = parseInt(a.match(/\d+/)?.[0] ?? "0");
        const nb = parseInt(b.match(/\d+/)?.[0] ?? "0");
        return na - nb;
      });

    for (const bankName of termBankNames) {
      onProgress?.(`Parsing ${bankName}…`);
      const rows: TermBankEntry[] = JSON.parse(new TextDecoder().decode(files[bankName]));
      for (const [expression, reading, definitionTags, rules, score, definitions, sequence, termTags] of rows) {
        entries.push({
          expression,
          reading,
          definitionTags,
          rules,
          score,
          definitions,
          sequence,
          termTags,
          dictionaryTitle: index.title,
        });
      }
    }

    const meta: ImportedDictionary = {
      id: `${index.title}-${index.revision}`,
      title: index.title,
      revision: index.revision,
      format: index.format,
      entryCount: entries.length,
      importedAt: Date.now(),
      enabled: true,
    };

    return { meta, entries };
  }

  // Minimal ZIP parser (handles stored + deflated files)
  private static async parseZip(buffer: ArrayBuffer): Promise<Record<string, Uint8Array>> {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const files: Record<string, Uint8Array> = {};

    // Find End of Central Directory
    let eocdOffset = -1;
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset < 0) throw new Error("Invalid ZIP: no EOCD signature");

    const centralDirOffset = view.getUint32(eocdOffset + 16, true);
    const totalEntries = view.getUint16(eocdOffset + 10, true);

    let offset = centralDirOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (view.getUint32(offset, true) !== 0x02014b50) break;
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const fileNameLen = view.getUint16(offset + 28, true);
      const extraLen = view.getUint16(offset + 30, true);
      const commentLen = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const fileName = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + fileNameLen));
      offset += 46 + fileNameLen + extraLen + commentLen;

      // Read local file header
      const lhExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + fileNameLen + lhExtraLen;
      const compressedData = bytes.slice(dataStart, dataStart + compressedSize);

      if (method === 0) {
        // Stored
        files[fileName] = compressedData;
      } else if (method === 8) {
        // Deflated — use DecompressionStream
        const ds = new DecompressionStream("deflate-raw");
        const writer = ds.writable.getWriter();
        writer.write(compressedData);
        writer.close();
        const chunks: Uint8Array[] = [];
        const reader = ds.readable.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const out = new Uint8Array(uncompressedSize);
        let pos = 0;
        for (const chunk of chunks) {
          out.set(chunk, pos);
          pos += chunk.length;
        }
        files[fileName] = out;
      }
    }

    return files;
  }
}
