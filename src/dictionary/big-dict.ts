/**
 * big-dict.ts — the READ side of the sidecar dictionaries (DESIGN §27.5/§27.2).
 *
 * The conversion pipeline writes ~536MB of perfectly good shards and, until
 * this file existed, nothing ever read them: `lookupHead`/`lookupFrame` were
 * golden-tested but no view called them, so converting a dictionary produced
 * files you could not search from inside the plugin. This closes that.
 *
 * Three things it has to get right:
 *
 *  1. **Discovery without a registry.** Installed dictionaries are whatever
 *     folders exist under the root with a readable `meta.json`. The folders ARE
 *     the registry (§19 files-over-app) — dropping one in or deleting it is
 *     install and uninstall, with nothing to keep in sync.
 *
 *  2. **A shard cache, bounded.** A lookup reads one ~535KB file per
 *     dictionary. Typing "破綻" letter by letter would re-read the same shard
 *     four times, and the second character usually lands in a *different*
 *     shard, so a naive cache of one is useless. A small LRU keeps interactive
 *     search cheap while staying phone-safe — this is the one place the big
 *     dictionaries are allowed to hold memory, and the cap is why.
 *
 *  3. **Never block.** Every call is async and the UI treats results as
 *     arriving late. `DictionaryStore` stays the synchronous path for the small
 *     imported dictionaries; this is additive.
 */

import type { DictHeadword, DictSense, ReachCandidate } from './eijiro.ts';
import type { DictLookupResult, YomitanTag } from './types.ts';
import {
  readMeta, lookupHead, lookupFrame, normalizeLookupKey, headPath, framePath, intentPath,
  intentionKeyOf, decodeLines, hashKey,
  type SidecarIO, type SidecarMeta, type HeadLine, type FrameLine, type IntentLine,
} from './sidecar.ts';
import { normalizeFrame } from './frames.ts';
import { deinflect } from './deinflect.ts';
import { partsOfEntry } from './entry-parts.ts';

export interface BigDictHit {
  dictionary: string;
  /** the normalized headword key this hit matched — the deinflected form when
   *  the query was inflected, so the caller can say which form it landed on. */
  key: string;
  entry: Omit<DictHeadword, 'reachFor'>;
  /** the inflection trail, when the query only matched after deinflection
   *  (食べた → 食べる). Absent on an exact hit. Rendered as the 〈…〉 badge. */
  deinflection?: string[];
}

/**
 * How many deinflected candidates a miss is allowed to probe.
 *
 * `deinflect` returns up to 64. In `DictionaryStore` each candidate is a Map
 * lookup and 64 is free; here each distinct shard is a FILE READ per installed
 * dictionary, so the same number would be ~2,200 reads on a total miss. Four
 * covers the real cases — the common trails (past / te-form / negative /
 * polite / passive-causative chains) all surface within the first few once
 * candidates are sorted by trail length — and bounds a miss at 4 unique shards
 * per dictionary, which the byte-capped cache absorbs.
 */
const MAX_DEINFLECT_CANDIDATES = 4;

export interface BigFrameHit {
  dictionary: string;
  candidate: ReachCandidate;
}

/**
 * Bounded LRU over shard file bodies, bounded by BYTES.
 *
 * A count-based cap cannot express the real constraint. One query reads one
 * shard per installed dictionary, and this vault has 31 — so a `lookup` plus a
 * `frame` is 62 reads, while shards range from a few KB (日本語俗語辞書) to
 * ~1MB (英辞郎). A cap of 6 entries meant every keystroke evicted the previous
 * keystroke's shards and nothing was ever reused; a cap of 62 entries would
 * mean anything from 0.5MB to 60MB resident depending on which dictionaries
 * happened to be installed. Bytes are what memory actually costs, so bytes are
 * what is capped.
 */
class ShardCache {
  private map = new Map<string, string | null>();
  private bytes = 0;
  constructor(private maxBytes: number) {}
  private static cost(v: string | null): number {
    // A miss is worth caching too — it is what stops a repeated absent lookup
    // re-reading 31 files — but it is not free to hold, so charge it something.
    return v === null ? 64 : v.length;
  }
  get(k: string): string | null | undefined {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k)!;
    this.map.delete(k); this.map.set(k, v);        // touch → most recent
    return v;
  }
  set(k: string, v: string | null): void {
    const prev = this.map.get(k);
    if (this.map.has(k)) { this.bytes -= ShardCache.cost(prev ?? null); this.map.delete(k); }
    this.map.set(k, v);
    this.bytes += ShardCache.cost(v);
    while (this.bytes > this.maxBytes && this.map.size > 1) {
      const oldest = this.map.keys().next().value as string;
      this.bytes -= ShardCache.cost(this.map.get(oldest) ?? null);
      this.map.delete(oldest);
    }
  }
  clear(): void { this.map.clear(); this.bytes = 0; }
  get size(): number { return this.map.size; }
  get heldBytes(): number { return this.bytes; }
}

/**
 * Round-robin `groups` into one capped list: every group's 1st item, then every
 * group's 2nd, and so on. Group order is preserved within each round, so the
 * store's own ordering still decides who speaks first — it just no longer
 * decides who speaks *at all*.
 *
 * PURE — golden: golden/big-dict.mjs.
 */
export function interleave<T>(groups: T[][], limit: number): T[] {
  const out: T[] = [];
  if (limit <= 0) return out;
  const deepest = groups.reduce((n, g) => Math.max(n, g.length), 0);
  for (let round = 0; round < deepest; round++) {
    for (const g of groups) {
      if (round >= g.length) continue;
      out.push(g[round]);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export class BigDictStore {
  private metas: Array<{ dir: string; meta: SidecarMeta }> = [];
  private cache: ShardCache;
  private loaded = false;

  constructor(
    private io: SidecarIO,
    private root = 'JP Dictionaries',
    opts: { cacheBytes?: number } = {},
  ) {
    // 24MB holds a full query's worth of shards for a large install, so typing
    // the second character reuses the first character's reads. The caller
    // lowers it on mobile.
    this.cache = new ShardCache(opts.cacheBytes ?? 24 * 1024 * 1024);
  }

  /** Which dictionaries are installed. Cheap — one meta.json each. */
  async refresh(): Promise<Array<{ dir: string; meta: SidecarMeta }>> {
    const found: Array<{ dir: string; meta: SidecarMeta }> = [];
    const names = (await this.io.listFolders?.(this.root)) ?? [];
    for (const name of names) {
      const dir = `${this.root}/${name}`;
      const meta = await readMeta(this.io, dir);
      if (meta) found.push({ dir, meta });
    }
    // biggest first: 英辞郎 answers most production questions
    found.sort((a, b) => b.meta.headwords - a.meta.headwords);
    this.metas = found;
    this.loaded = true;
    this.cache.clear();
    return found;
  }

  private async ready(): Promise<void> { if (!this.loaded) await this.refresh(); }

  installed(): Array<{
    title: string; headwords: number; frames: number; dir: string;
    /** null when this dictionary has no meaning-side index (§27.2). */
    intents: number | null; shards: number;
    partial: boolean; revision: string;
  }> {
    return this.metas.map(({ dir, meta }) => ({
      title: meta.title, headwords: meta.headwords, frames: meta.frames, dir,
      intents: meta.intents ?? null, shards: meta.shards,
      // `partial` means a conversion is still filling this, or the meta was
      // reconstructed by repair — either way the counts are a running total
      // and the UI must not present it as a settled install.
      partial: meta.partial === true, revision: meta.revision,
    }));
  }

  async isEmpty(): Promise<boolean> { await this.ready(); return this.metas.length === 0; }

  /** Read a shard body through the cache. */
  private async shard(path: string): Promise<string | null> {
    const hit = this.cache.get(path);
    if (hit !== undefined) return hit;
    const body = await this.io.read(path);
    this.cache.set(path, body);
    return body;
  }

  /**
   * Look a headword up across every installed dictionary.
   * One shard read per dictionary, cached — never a scan.
   *
   * BREADTH BEFORE DEPTH (fixed 2026-08-01). This used to walk the dictionaries
   * in order and `return` the moment `limit` was reached. `metas` is sorted
   * biggest-first, so the limit was spent on whichever books happened to be
   * largest and the tail was never read at all. Measured on this vault
   * (35 installed, `limit: 40`): 「気」 returned 40 hits from 11 dictionaries
   * while 17 actually hold it — and the six silently dropped were
   * 用例.jp, 使い方の分かる類語例解辞典, 現代国語例解辞典, NHK日本語発音アクセント新辞典,
   * NEW斎藤和英大辞典 and WISDOM. Sorting by headword count is a proxy for size,
   * not for worth, and it had inverted itself: the small specialist books this
   * plugin exists to reach (例文, 使い分け, アクセント) were exactly the ones cut,
   * on exactly the high-frequency words where you most want a second opinion.
   *
   * So: gather per dictionary, then interleave. Every book that holds the word
   * gets its first entry in before any book gets its second. The extra cost is
   * near zero — 3.5MB of shard reads for a full sweep of this install, inside a
   * 24MB (8MB mobile) cache, and the early return only ever fired for the
   * handful of words where it did the damage.
   */
  async lookup(expression: string, limit = 20): Promise<BigDictHit[]> {
    await this.ready();
    const k = normalizeLookupKey(expression);
    if (!k) return [];
    const exact = await this.lookupKeys([k], limit);
    if (exact.length) return exact;

    // ── deinflection fallback (AUDIT-PARTS §6) ──────────────────────────────
    //
    // A sharded store is exact-match BY CONSTRUCTION: the shard is chosen by
    // hashing the key, so a form you have not computed cannot be probed for.
    // That made the whole converted shelf — 35 books, 6.4M headwords —
    // reachable only from the citation form, which is the one form you already
    // know. Running text never arrives that way: 食べた, 面白かった,
    // 言われている, 持ってきて all returned nothing while the small imported
    // Yomitan store (which has deinflected since it shipped) answered.
    //
    // Same contract as `DictionaryStore.lookup`: exact first and cheap, then
    // candidates as PROPOSALS validated against the real shards, shortest trail
    // first, hits tagged with their trail so the UI's 〈…〉 badge can say how it
    // got there. `lookupKeys` groups candidates by shard so N candidates cost
    // at most N *unique* shard reads per dictionary rather than N.
    // Ordering decides correctness here, not just cost. `deinflect` deliberately
    // OVERGENERATES — that is free for `DictionaryStore`, where every candidate
    // is validated by a Map lookup, and it is not free here, where validation is
    // a file read. So the true candidate has to be inside the cap.
    //
    // Sort by (trail length, then term length). Shorter term = the rule consumed
    // more of the inflectional tail, i.e. explained more of the surface, which is
    // exactly what a correct deinflection does. 面白かった generates five trail-1
    // candidates — 面白かう / 面白かつ / 面白かる / 面白かっる / 面白い — and the real
    // one is enumerated LAST but is the shortest; by count alone a cap of 4 threw
    // away the only right answer.
    const trailOf = new Map<string, string[]>();
    for (const d of deinflect(k).sort(
      (a, b) => a.trail.length - b.trail.length || a.term.length - b.term.length,
    )) {
      const key = normalizeLookupKey(d.term);
      if (!key || key === k || trailOf.has(key)) continue;
      trailOf.set(key, d.trail);                       // shortest trail wins
      if (trailOf.size >= MAX_DEINFLECT_CANDIDATES) break;
    }
    if (!trailOf.size) return [];
    const hits = await this.lookupKeys([...trailOf.keys()], limit);
    return hits.map((h) => ({ ...h, deinflection: trailOf.get(h.key) }));
  }

  /**
   * Look several keys up at once, breadth-first across dictionaries.
   *
   * Keys are grouped by the shard they hash into, so a dictionary is read once
   * per distinct shard rather than once per key — the deinflection fallback
   * proposes up to `MAX_DEINFLECT_CANDIDATES` forms and most of a query's
   * candidates collide into a handful of shards.
   *
   * The breadth-before-depth rule of `lookup` is preserved: gather per
   * dictionary, then interleave, so every book that holds the word gets its
   * first entry in before any book gets its second.
   */
  private async lookupKeys(keys: string[], limit: number): Promise<BigDictHit[]> {
    const want = new Set(keys);
    if (!want.size) return [];
    const perDict: BigDictHit[][] = [];
    for (const { dir, meta } of this.metas) {
      const shards = new Set<number>();
      for (const k of want) shards.add(hashKey(k) % meta.shards);
      const found: BigDictHit[] = [];
      for (const s of shards) {
        const body = await this.shard(headPath(dir, s));
        for (const l of decodeLines<HeadLine>(body)) {
          if (want.has(l.k)) found.push({ dictionary: meta.title, key: l.k, entry: l.e });
        }
      }
      if (found.length) perDict.push(found);
    }
    return interleave(perDict, limit);
  }

  /**
   * THE REACH-FOR QUERY (§27.2). Give it a frame — Eijiro's notation, your own
   * 🟠/💠 slots, or a sentence you gapped with `gapFrame` — and get every
   * curated candidate that realizes it.
   */
  async frame(frame: string, limit = 40): Promise<BigFrameHit[]> {
    await this.ready();
    const k = normalizeFrame(frame);
    if (!k) return [];
    // Same breadth-before-depth rule as `lookup`, and it matters more here: a
    // frame is a question about how OTHER PEOPLE fill this shape, so hearing
    // one book forty times is the wrong answer by construction.
    const perDict: BigFrameHit[][] = [];
    for (const { dir, meta } of this.metas) {
      const body = await this.shard(framePath(dir, hashKey(normalizeLookupKey(k)) % meta.shards));
      const found: BigFrameHit[] = [];
      for (const l of decodeLines<FrameLine>(body)) {
        if (l.k !== k) continue;
        for (const c of l.c) {
          found.push({
            dictionary: meta.title,
            candidate: {
              surface: c.s, intention: c.i,
              classHint: c.h as ReachCandidate['classHint'],
              ...(c.p ? { shape: c.p } : {}), ...(c.t ? { situation: c.t } : {}),
              frameKey: k, intentionKey: '',
              slots: (k.match(/[～＿]/g) ?? []).length,
            },
          });
        }
      }
      if (found.length) perDict.push(found);
    }
    return interleave(perDict, limit);
  }

  /**
   * THE INTENTION QUERY (§27.2) — the reach-for query run from the other end.
   *
   * `frame()` asks "what fills this Japanese shape?"; this asks "how is this
   * said?" and takes the want in English, as felt: "at some point", "undergo".
   * §27.0.1's claim is that a phrase is one meaning externalized twice, so the
   * shelf has to be reachable from either externalization — and until the
   * intent shards existed it was reachable from only one, which is why an
   * English want could sit open forever without ever receiving an offer.
   *
   * Dictionaries with no intention index are skipped in silence, not counted as
   * empty answers: the honest report of "not indexed" belongs to verification,
   * not to every query (§28 S6).
   */
  async intention(intention: string, limit = 40): Promise<BigFrameHit[]> {
    await this.ready();
    const k = intentionKeyOf(intention);
    if (!k) return [];
    const perDict: BigFrameHit[][] = [];
    for (const { dir, meta } of this.metas) {
      if (meta.intents == null) continue;      // never built — not an empty answer
      const body = await this.shard(intentPath(dir, hashKey(normalizeLookupKey(k)) % meta.shards));
      const found: BigFrameHit[] = [];
      for (const l of decodeLines<IntentLine>(body)) {
        if (l.k !== k) continue;
        for (const c of l.c) {
          found.push({
            dictionary: meta.title,
            candidate: {
              surface: c.s, intention: c.i,
              classHint: c.h as ReachCandidate['classHint'],
              ...(c.p ? { shape: c.p } : {}), ...(c.t ? { situation: c.t } : {}),
              frameKey: c.f, intentionKey: k,
              slots: (c.f.match(/[～＿]/g) ?? []).length,
            },
          });
        }
      }
      if (found.length) perDict.push(found);
    }
    return interleave(perDict, limit);
  }

  /** Does any installed dictionary have a meaning-side index at all? */
  hasIntentIndex(): boolean { return this.metas.some((m) => m.meta.intents != null); }

  /** Uninstall detection / manual invalidation after a re-convert. */
  invalidate(): void { this.loaded = false; this.cache.clear(); }

  /** Exposed for the golden: how many shard bodies are resident. */
  cachedShards(): number { return this.cache.size; }
  /** Exposed for the golden: the cap is on bytes, so bytes are what is checked. */
  cachedBytes(): number { return this.cache.heldBytes; }
}

/** Re-exported so callers need only this module. */
export { lookupHead, lookupFrame };

// ── adapting to the dictionary UI ────────────────────────────────────────────

/**
 * One sidecar sense as one displayable definition line.
 *
 * The bracket is kept as a bracket on purpose. §27.1: `situation` is a
 * production-CONDITION ("when you would say this"), not a gloss, and Eijiro
 * writes it 〔…〕 — flattening it into the definition text would lose the one
 * thing that makes the entry answer a reach-for question rather than a
 * look-up one.
 */
export function senseLine(s: DictSense): string {
  const parts: string[] = [];
  if (s.pos) parts.push(`【${s.pos}】`);
  if (s.gloss) parts.push(s.gloss);
  if (s.situation) parts.push(`〔${s.situation}〕`);
  if (s.note) parts.push(`◆${s.note}`);
  return parts.join(' ').trim();
}

/**
 * A sidecar hit in the shape `DictionaryView` already renders.
 *
 * The 31 converted dictionaries were invisible in the 辞書 view because that
 * view only ever queried `DictionaryStore` — 6.1M headwords sat on disk with
 * no way in, which is precisely the §28 seam (a lookup losing REACHABILITY
 * crossing a subsystem boundary). Adapting here rather than teaching the view
 * a second entry shape is what keeps ONE visual grammar: a sidecar hit gets
 * the same card, the same 辞書 badge, the same 🏷️ capture road and the same
 * class marks as an imported one, because it IS the same object by the time
 * the view sees it.
 *
 * PURE — golden: golden/big-dict.mjs.
 */
export function bigHitToLookupResult(hit: BigDictHit, id = 0): DictLookupResult {
  const e = hit.entry;
  const tags: YomitanTag[] = (e.pos ?? []).slice(0, 5).map((p, i) => ({
    name: p, category: 'partOfSpeech', order: i, notes: p, score: 0,
  }));
  return {
    term: {
      id,
      expression: e.expression,
      // The card hides the reading row when it equals the expression, which is
      // the right look for an entry that never carried one.
      reading: e.reading || e.expression,
      definitionTags: [],
      rules: [],
      score: 0,
      definitions: e.senses.map(senseLine).filter(Boolean),
      sequence: e.sequence,
      termTags: e.pos ?? [],
    },
    dictionary: hit.dictionary,
    tags,
    // §26.1 — the same senses, as typeset parts. `definitions` above stays
    // populated as the fallback (and for anything that reads plain text, like
    // the capture path), so this is additive rather than a second source.
    entryBlocks: partsOfEntry(e, hit.dictionary),
    // Carried straight through: the walker already decided WHICH relations this
    // book has; nothing here may reinterpret them.
    ...(e.nodes?.length ? { entryNodes: e.nodes } : {}),
    // How the query reached this entry, when it only did so after deinflection.
    // Dropping it here would show 食べる for 食べた with nothing saying why —
    // the 〈…〉 badge is the honesty (§28 S6) that this is a derived hit.
    ...(hit.deinflection?.length ? { deinflection: hit.deinflection } : {}),
  };
}

/**
 * Drop sidecar hits the local store already rendered, so a dictionary that was
 * both imported AND converted does not appear twice.
 *
 * The key carries `sequence` because one expression legitimately has MANY
 * entries in one dictionary — 英辞郎 especially — and a key of
 * expression+dictionary alone would silently collapse them into the first one.
 */
export function dedupeAgainst(
  hits: BigDictHit[], already: DictLookupResult[],
): DictLookupResult[] {
  const key = (expr: string, reading: string, seq: number, dict: string) =>
    `${expr}|${reading}|${seq}|${dict}`;
  const seen = new Set(already.map((r) =>
    key(r.term.expression, r.term.reading, r.term.sequence, r.dictionary)));
  const out: DictLookupResult[] = [];
  hits.forEach((h, i) => {
    const e = h.entry;
    const k = key(e.expression, e.reading || e.expression, e.sequence, h.dictionary);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(bigHitToLookupResult(h, i));
  });
  return out;
}
