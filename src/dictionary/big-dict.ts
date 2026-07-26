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

import type { DictHeadword, ReachCandidate } from './eijiro.ts';
import {
  readMeta, lookupHead, lookupFrame, normalizeLookupKey, headPath, framePath,
  decodeLines, hashKey, type SidecarIO, type SidecarMeta, type HeadLine, type FrameLine,
} from './sidecar.ts';
import { normalizeFrame } from './frames.ts';

export interface BigDictHit {
  dictionary: string;
  entry: Omit<DictHeadword, 'reachFor'>;
}

export interface BigFrameHit {
  dictionary: string;
  candidate: ReachCandidate;
}

/** Bounded LRU over shard file bodies. */
class ShardCache {
  private map = new Map<string, string | null>();
  constructor(private cap: number) {}
  get(k: string): string | null | undefined {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k)!;
    this.map.delete(k); this.map.set(k, v);        // touch → most recent
    return v;
  }
  set(k: string, v: string | null): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }
  clear(): void { this.map.clear(); }
  get size(): number { return this.map.size; }
}

export class BigDictStore {
  private metas: Array<{ dir: string; meta: SidecarMeta }> = [];
  private cache: ShardCache;
  private loaded = false;

  constructor(
    private io: SidecarIO,
    private root = 'JP Dictionaries',
    opts: { cacheShards?: number } = {},
  ) {
    this.cache = new ShardCache(opts.cacheShards ?? 6);
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

  installed(): Array<{ title: string; headwords: number; frames: number; dir: string }> {
    return this.metas.map(({ dir, meta }) => ({
      title: meta.title, headwords: meta.headwords, frames: meta.frames, dir,
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
   */
  async lookup(expression: string, limit = 20): Promise<BigDictHit[]> {
    await this.ready();
    const k = normalizeLookupKey(expression);
    if (!k) return [];
    const out: BigDictHit[] = [];
    for (const { dir, meta } of this.metas) {
      const body = await this.shard(headPath(dir, hashKey(k) % meta.shards));
      for (const l of decodeLines<HeadLine>(body)) {
        if (l.k !== k) continue;
        out.push({ dictionary: meta.title, entry: l.e });
        if (out.length >= limit) return out;
      }
    }
    return out;
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
    const out: BigFrameHit[] = [];
    for (const { dir, meta } of this.metas) {
      const body = await this.shard(framePath(dir, hashKey(normalizeLookupKey(k)) % meta.shards));
      for (const l of decodeLines<FrameLine>(body)) {
        if (l.k !== k) continue;
        for (const c of l.c) {
          out.push({
            dictionary: meta.title,
            candidate: {
              surface: c.s, intention: c.i,
              classHint: c.h as ReachCandidate['classHint'],
              ...(c.p ? { shape: c.p } : {}), ...(c.t ? { situation: c.t } : {}),
              frameKey: k, intentionKey: '',
              slots: (k.match(/[～＿]/g) ?? []).length,
            },
          });
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  }

  /** Uninstall detection / manual invalidation after a re-convert. */
  invalidate(): void { this.loaded = false; this.cache.clear(); }

  /** Exposed for the golden: how many shard bodies are resident. */
  cachedShards(): number { return this.cache.size; }
}

/** Re-exported so callers need only this module. */
export { lookupHead, lookupFrame };
