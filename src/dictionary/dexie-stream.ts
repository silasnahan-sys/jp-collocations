/**
 * dexie-stream.ts — reading Yomitan's 12.7GB backup without parsing it.
 *
 * Yomitan's "export all dictionaries" produces ONE JSON file in Dexie's export
 * format. The user's is **12.7 GB, 36 dictionaries, 4,015,521 terms**. There is
 * no JSON.parse for that — Node's string cap is well below it and the object
 * graph would be far larger than the file. So this streams.
 *
 * The real shape, read off the user's file rather than assumed:
 *
 *   {"formatName":"dexie","data":{"tables":[…],"data":[
 *      {"tableName":"terms","inbound":true,"rows":[
 *         {"expression":"外字一覧","reading":"外字一覧","definitionTags":"","rules":"",
 *          "score":0,"glossary":["…"],"sequence":0,"termTags":"",
 *          "dictionary":"研究社　新和英大辞典　第５版","id":1,
 *          "$types":{"glossary":"arrayNonindexKeys"}},
 *         …]}]}}
 *
 * Two facts that make this tractable:
 *   • rows are OBJECTS with named fields, not positional tuples;
 *   • `dictionary` carries the TITLE STRING on every row, so there is no id
 *     table to join against and no ordering assumption to get wrong.
 *
 * A table may be split across several chunks (that is how Dexie streams), so
 * the scanner handles `"tableName"` appearing many times and simply keeps
 * emitting whenever the active table matches.
 *
 * PURE and incremental: feed it arbitrary chunks, it emits complete row strings
 * and never retains more than the row currently being assembled. `$types` is
 * typeson bookkeeping and is dropped.
 *
 * Golden: golden/dexie-stream.mjs, run against a fragment cut out of the real
 * 12.7GB file.
 */

/** One row, already narrowed to what the adapters need. */
export interface DexieTermRow {
  expression: string;
  reading: string;
  definitionTags: string;
  rules: string;
  score: number;
  glossary: unknown[];
  sequence: number;
  termTags: string;
  /** the dictionary TITLE (not an id) — grouping key. */
  dictionary: string;
}

/** The tuple shape the Eijiro/generic adapters already consume. */
export type TermTuple = [string, string, string, string, number, unknown[], number, string];

export function rowToTuple(r: DexieTermRow): TermTuple {
  return [
    String(r.expression ?? ''),
    String(r.reading ?? ''),
    String(r.definitionTags ?? ''),
    String(r.rules ?? ''),
    Number(r.score ?? 0),
    Array.isArray(r.glossary) ? r.glossary : [],
    Number(r.sequence ?? 0),
    String(r.termTags ?? ''),
  ];
}

const isTermRow = (o: unknown): o is DexieTermRow =>
  !!o && typeof o === 'object' && typeof (o as DexieTermRow).expression === 'string';

/**
 * Incremental extractor for the rows of one named Dexie table.
 *
 * State machine over the raw text — deliberately NOT a general JSON parser,
 * because a general parser would have to model the whole 12.7GB document. It
 * tracks only: are we inside the target table's `rows` array, and where does
 * the current object end (respecting strings and escapes).
 */
type ScanState = 'seek-table' | 'seek-rows' | 'in-rows';

export class DexieRowStream {
  private buf = '';
  /**
   * EXPLICIT state. An earlier version re-derived "where am I" from the buffer
   * each feed and trimmed anything it had not consumed — so when a chunk ended
   * between `"tableName":"terms"` and `"rows":[`, the marker was thrown away
   * and the stream silently produced nothing for the rest of the file. On a
   * 12.7GB read the boundary lands there eventually with probability 1, and the
   * failure is invisible (zero rows, no error). Hence: state is a field, and
   * trimming may only ever drop text the scanner has actually passed.
   */
  private state: ScanState = 'seek-table';
  private active = false;
  private depth = 0;
  private inStr = false;
  private esc = false;
  private start = -1;
  /**
   * Where to resume scanning in `buf`. Required because a partially-assembled
   * row is RETAINED across feeds: rescanning it from 0 while keeping `depth`
   * counts its opening brace twice, depth never returns to zero, and the stream
   * stalls forever holding one row. (That is a silent zero-rows failure on a
   * 12.7GB file, so it is worth a field.)
   */
  private resume = 0;
  /** rows emitted, for progress + the honest "did we read it all" check. */
  rows = 0;

  constructor(private table = 'terms') {}

  /**
   * Feed a chunk; returns the row strings completed by it.
   * Callers should JSON.parse each and drop it before the next — that is what
   * keeps a 12.7GB file inside a few MB of memory.
   */
  feed(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    let i = this.resume;
    const TAIL = 32;                      // longest marker is 13 chars

    while (i < this.buf.length) {
      // NOTE: every early return below re-bases `buf`, so it MUST also reset
      // `resume`. Leaving a stale resume makes the next feed start scanning
      // past the marker it is looking for — the stream then reads the first
      // table and silently ignores every later one.
      if (this.state === 'seek-table') {
        const t = this.buf.indexOf('"tableName":"', i);
        if (t === -1) {
          // keep only a tail that could still be a prefix of the marker
          this.buf = this.buf.slice(Math.max(i, this.buf.length - TAIL));
          this.resume = 0;
          return out;
        }
        const nameStart = t + '"tableName":"'.length;
        const nameEnd = this.buf.indexOf('"', nameStart);
        if (nameEnd === -1) {                          // name incomplete
          this.buf = this.buf.slice(t);
          this.resume = 0;
          return out;
        }
        this.active = this.buf.slice(nameStart, nameEnd) === this.table;
        this.state = 'seek-rows';         // REMEMBERED across feeds
        i = nameEnd + 1;
        continue;
      }

      if (this.state === 'seek-rows') {
        const rowsAt = this.buf.indexOf('"rows":[', i);
        if (rowsAt === -1) {
          // `active` survives in the field; only passed text is dropped
          this.buf = this.buf.slice(Math.max(i, this.buf.length - TAIL));
          this.resume = 0;
          return out;
        }
        i = rowsAt + '"rows":['.length;
        this.state = 'in-rows';
        this.depth = 0;
        this.start = -1;
        continue;
      }

      const c = this.buf[i];
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (c === '\\') this.esc = true;
        else if (c === '"') this.inStr = false;
        i++;
        continue;
      }
      if (c === '"') { this.inStr = true; i++; continue; }
      if (c === '{') {
        if (this.depth === 0) this.start = i;
        this.depth++;
        i++;
        continue;
      }
      if (c === '}') {
        this.depth--;
        i++;
        if (this.depth === 0 && this.start >= 0) {
          if (this.active) { out.push(this.buf.slice(this.start, i)); this.rows++; }
          this.start = -1;
          // drop everything consumed so far — the whole point
          this.buf = this.buf.slice(i);
          i = 0;
        }
        continue;
      }
      if (c === ']' && this.depth === 0) {
        // end of this table chunk's rows; go back to scanning for the next one
        this.state = 'seek-table';
        this.active = false;
        i++;
        this.buf = this.buf.slice(i);
        i = 0;
        continue;
      }
      i++;
    }

    // Consumed everything. Keep the partially-assembled row if there is one;
    // otherwise nothing inside the rows array is pending.
    if (this.state === 'in-rows') {
      if (this.start >= 0) {
        this.buf = this.buf.slice(this.start);
        this.start = 0;
        this.resume = this.buf.length;   // already scanned — do NOT rescan
      } else { this.buf = ''; this.resume = 0; }
    } else {
      this.buf = this.buf.slice(Math.max(0, this.buf.length - TAIL));
      this.resume = 0;                   // seek states re-match cheaply
    }
    return out;
  }

  /** Bytes currently buffered — the golden asserts this stays small. */
  buffered(): number { return this.buf.length; }
}

/**
 * A row of the `dictionaries` table — the REGISTERED dictionaries.
 *
 * This matters more than it looks. Measured on the user's real backup: the
 * terms table carries **97 distinct dictionary titles** while `dictionaries`
 * holds **36**. The extra 61 are orphaned rows from dictionaries that were
 * removed or superseded (an old Jitendex build, etc.) and were never garbage-
 * collected. Converting blind would create 61 junk sidecar folders full of
 * stale entries. The `dictionaries` table appears at the FRONT of the file, so
 * it can be captured in the same single pass and used to filter.
 *
 * Rows are typeson-wrapped: {"$":[id, {title, revision, counts, …}]}.
 */
export interface DexieDictionaryRow { title: string; revision?: string; version?: number }

export function parseDictionaryRow(text: string): DexieDictionaryRow | null {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    // typeson wrapper: {"$":[id, {...}]}
    const wrapped = o.$;
    const inner = Array.isArray(wrapped)
      ? wrapped.find((x) => x && typeof x === 'object')
      : (typeof o.title === 'string' ? o : null);
    const rec = inner as { title?: unknown; revision?: unknown; version?: unknown } | null;
    if (!rec || typeof rec.title !== 'string' || !rec.title) return null;
    return {
      title: rec.title,
      ...(typeof rec.revision === 'string' ? { revision: rec.revision } : {}),
      ...(typeof rec.version === 'number' ? { version: rec.version } : {}),
    };
  } catch { return null; }
}

/** Parse a row string, returning null for anything that is not a term row. */
export function parseRow(text: string): DexieTermRow | null {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    delete o.$types;                       // typeson bookkeeping, never data
    return isTermRow(o) ? (o as unknown as DexieTermRow) : null;
  } catch { return null; }
}

/**
 * Group a stream of rows by dictionary with BOUNDED memory.
 *
 * Rows arrive grouped in practice (Yomitan imported each dictionary in turn),
 * but nothing in the format guarantees it, so this never assumes: it buffers
 * per title and flushes whichever buffer is largest once the total crosses the
 * cap. Worst case is the cap, not 4M rows.
 */
export class DictionaryRouter {
  private buckets = new Map<string, TermTuple[]>();
  private total = 0;

  constructor(
    private flush: (dictionary: string, tuples: TermTuple[]) => Promise<void>,
    private cap = 20_000,
  ) {}

  async add(row: DexieTermRow): Promise<void> {
    const key = String(row.dictionary ?? '(unknown)');
    const list = this.buckets.get(key);
    if (list) list.push(rowToTuple(row));
    else this.buckets.set(key, [rowToTuple(row)]);
    this.total++;
    if (this.total >= this.cap) await this.flushLargest();
  }

  private async flushLargest(): Promise<void> {
    let biggest: string | null = null;
    let n = -1;
    for (const [k, v] of this.buckets) if (v.length > n) { n = v.length; biggest = k; }
    if (!biggest) return;
    const tuples = this.buckets.get(biggest)!;
    this.buckets.delete(biggest);
    this.total -= tuples.length;
    await this.flush(biggest, tuples);
  }

  /** Flush everything still held. Call once the stream ends. */
  async drain(): Promise<void> {
    while (this.buckets.size) await this.flushLargest();
  }

  /** Titles currently buffered — used by the golden to prove the bound. */
  pending(): number { return this.total; }
}
