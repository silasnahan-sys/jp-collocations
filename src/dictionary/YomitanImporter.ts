/**
 * YomitanImporter — parses Yomitan/Yomichan dictionary ZIP files.
 *
 * A Yomitan dict is a ZIP containing:
 *   index.json           — dictionary metadata
 *   tag_bank_N.json      — tag definitions
 *   term_bank_N.json     — term entries
 *   term_meta_bank_N.json — frequency / pitch accent data
 *
 * We use the browser-native JSZip-free approach:
 * Obsidian bundles don't have JSZip, so we do a minimal ZIP parse
 * using the raw ArrayBuffer + DataView (deflate entries extracted via
 * DecompressionStream where available, otherwise stored-only).
 */

import type {
  YomitanIndex,
  YomitanTermTuple,
  YomitanTagTuple,
  YomitanTag,
  YomitanPitchInfo,
  DictionaryTerm,
  DictionaryMeta,
  DictionaryData,
} from './types';

// ── Minimal ZIP reader (no external deps) ────────────────────

interface ZipEntry {
  filename: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number; // 0 = stored, 8 = deflate
  dataOffset: number;
}

function readZipEntries(buf: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buf);
  const entries: ZipEntry[] = [];

  // Find End of Central Directory
  let eocdOffset = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('Invalid ZIP: EOCD not found');

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdCount = view.getUint16(eocdOffset + 10, true);

  let offset = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const filenameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const filenameBytes = new Uint8Array(buf, offset + 46, filenameLen);
    const filename = new TextDecoder().decode(filenameBytes);

    // Calculate data offset from local file header
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const localFilenameLen = view.getUint16(localHeaderOffset + 26, true);
    const dataOffset = localHeaderOffset + 30 + localFilenameLen + localExtraLen;

    entries.push({
      filename, compressionMethod, compressedSize, uncompressedSize, dataOffset,
    });

    offset += 46 + filenameLen + extraLen + commentLen;
  }

  return entries;
}

async function extractEntry(buf: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const raw = new Uint8Array(buf, entry.dataOffset, entry.compressedSize);

  if (entry.compressionMethod === 0) {
    // Stored — no compression
    return new TextDecoder('utf-8').decode(raw);
  }

  if (entry.compressionMethod === 8) {
    // Deflate — use DecompressionStream if available (modern browsers/Electron)
    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate-raw' as CompressionFormat);
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();

      writer.write(raw).then(() => writer.close());

      const chunks: Uint8Array[] = [];
      let done = false;
      while (!done) {
        const result = await reader.read();
        if (result.done) { done = true; break; }
        chunks.push(result.value);
      }

      const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0);
      const merged = new Uint8Array(totalLen);
      let pos = 0;
      for (const c of chunks) {
        merged.set(c, pos);
        pos += c.byteLength;
      }

      return new TextDecoder('utf-8').decode(merged);
    }

    throw new Error(
      'ZIP entry is deflate-compressed but DecompressionStream is not available. ' +
      'Please re-export the dictionary as a stored (uncompressed) ZIP, or use a newer Obsidian/Electron version.'
    );
  }

  throw new Error(`Unsupported ZIP compression method: ${entry.compressionMethod}`);
}

// ── Importer ─────────────────────────────────────────────────

export class YomitanImporter {
  /**
   * Parse a Yomitan/Yomichan dictionary ZIP ArrayBuffer.
   * Returns a fully-indexed DictionaryData ready for lookup.
   */
  async import(
    zipBuffer: ArrayBuffer,
    onProgress?: (msg: string) => void,
  ): Promise<DictionaryData> {
    const progress = onProgress ?? (() => {});

    progress('Reading ZIP structure…');
    const zipEntries = readZipEntries(zipBuffer);

    // Sort entries by filename for deterministic order
    // Handle nested folder structures (e.g., "dict/index.json")
    // by stripping common prefix directories
    const fileMap = new Map<string, ZipEntry>();
    for (const e of zipEntries) {
      // Skip directories (end with /)
      if (e.filename.endsWith('/')) continue;
      // Store both full path and basename
      fileMap.set(e.filename, e);
    }

    // ── Detect nested structure (MarvNC collection often has folder prefix) ──
    // Find index.json — could be at root or inside a subfolder
    let prefix = '';
    let indexEntry = fileMap.get('index.json');
    if (!indexEntry) {
      // Search for index.json in subdirectories
      for (const [name, entry] of fileMap) {
        if (name.endsWith('/index.json') || name.endsWith('\\index.json')) {
          prefix = name.slice(0, name.lastIndexOf('index.json'));
          indexEntry = entry;
          break;
        }
      }
    }

    if (!indexEntry) throw new Error('Invalid Yomitan dictionary: missing index.json');

    /**
     * Resolve a filename pattern relative to any detected prefix.
     * Returns matching entries sorted by name.
     */
    function findFiles(pattern: RegExp): ZipEntry[] {
      const matches: ZipEntry[] = [];
      for (const [name, entry] of fileMap) {
        // Strip prefix for matching
        const relative = prefix && name.startsWith(prefix)
          ? name.slice(prefix.length)
          : name;
        if (pattern.test(relative)) {
          matches.push(entry);
        }
      }
      return matches.sort((a, b) => a.filename.localeCompare(b.filename));
    }

    // ── index.json ───────────────────────────────────────────
    progress('Parsing index…');
    const indexStr = await extractEntry(zipBuffer, indexEntry);
    const index: YomitanIndex = JSON.parse(indexStr);
    const format = index.format ?? index.version ?? 3;

    // ── tag_bank files ───────────────────────────────────────
    const tags = new Map<string, YomitanTag>();
    const tagEntries = findFiles(/^tag_bank_\d+\.json$/);
    for (const te of tagEntries) {
      progress(`Parsing ${te.filename}…`);
      const json = await extractEntry(zipBuffer, te);
      const tuples: YomitanTagTuple[] = JSON.parse(json);
      for (const [name, category, order, notes, score] of tuples) {
        tags.set(name, { name, category, order, notes, score });
      }
    }

    // ── term_bank files ──────────────────────────────────────
    const terms: DictionaryTerm[] = [];
    const expressionIndex = new Map<string, number[]>();
    const readingIndex = new Map<string, number[]>();

    const termEntries = findFiles(/^term_bank_\d+\.json$/);
    let termId = 0;

    for (const te of termEntries) {
      progress(`Loading ${te.filename}… (${terms.length} terms)`);
      const json = await extractEntry(zipBuffer, te);
      const tuples: YomitanTermTuple[] = JSON.parse(json);

      for (const tuple of tuples) {
        const [expression, reading, defTags, rules, score, definitions, sequence, termTags] = tuple;

        const term: DictionaryTerm = {
          id: termId,
          expression,
          reading: reading || expression,
          definitionTags: defTags ? defTags.split(' ').filter(Boolean) : [],
          rules: rules ? rules.split(' ').filter(Boolean) : [],
          score,
          definitions,
          sequence,
          termTags: termTags ? termTags.split(' ').filter(Boolean) : [],
        };

        terms.push(term);

        // Index by expression
        if (!expressionIndex.has(expression)) expressionIndex.set(expression, []);
        expressionIndex.get(expression)!.push(termId);

        // Index by reading
        const readKey = reading || expression;
        if (!readingIndex.has(readKey)) readingIndex.set(readKey, []);
        readingIndex.get(readKey)!.push(termId);

        termId++;
      }
    }

    // ── term_meta_bank files (frequency + pitch) ─────────────
    const frequencies = new Map<string, number>();
    const pitches = new Map<string, YomitanPitchInfo>();

    const metaEntries = findFiles(/^term_meta_bank_\d+\.json$/);
    let hasFrequency = false;
    let hasPitch = false;

    for (const me of metaEntries) {
      progress(`Loading ${me.filename}…`);
      const json = await extractEntry(zipBuffer, me);
      const metas: [string, string, unknown][] = JSON.parse(json);

      for (const [expr, type, data] of metas) {
        if (type === 'freq') {
          hasFrequency = true;
          if (typeof data === 'number') {
            frequencies.set(expr, data);
          } else if (typeof data === 'string') {
            const parsed = parseInt(data, 10);
            if (!isNaN(parsed)) frequencies.set(expr, parsed);
          } else if (data && typeof data === 'object') {
            // Handle various frequency object formats:
            // { frequency: N }, { value: N }, { value: { value: N } }
            // { frequency: { value: N } }, { reading: "...", frequency: N }
            // { reading: "...", frequency: { value: N, displayValue: "..." } }
            const obj = data as Record<string, unknown>;
            const val = obj.value ?? obj.frequency;
            if (typeof val === 'number') {
              frequencies.set(expr, val);
            } else if (typeof val === 'string') {
              const parsed = parseInt(val, 10);
              if (!isNaN(parsed)) frequencies.set(expr, parsed);
            } else if (val && typeof val === 'object' && val !== null) {
              const inner = val as Record<string, unknown>;
              const innerVal = inner.value ?? inner.frequency;
              if (typeof innerVal === 'number') {
                frequencies.set(expr, innerVal);
              } else if (typeof innerVal === 'string') {
                const parsed = parseInt(innerVal, 10);
                if (!isNaN(parsed)) frequencies.set(expr, parsed);
              }
            }
          }
        } else if (type === 'pitch') {
          hasPitch = true;
          pitches.set(expr, data as YomitanPitchInfo);
        }
      }
    }

    const meta: DictionaryMeta = {
      title: index.title,
      revision: index.revision,
      format,
      author: index.author ?? '',
      description: index.description ?? '',
      termCount: terms.length,
      tagCount: tags.size,
      hasFrequency,
      hasPitch,
      importedAt: Date.now(),
    };

    progress(`Done: ${terms.length} terms, ${tags.size} tags loaded from "${index.title}"`);

    return {
      meta,
      tags,
      terms,
      expressionIndex,
      readingIndex,
      frequencies,
      pitches,
    };
  }
}
