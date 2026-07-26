/**
 * sidecar-io.ts — the Obsidian/Node edges of the big-dictionary pipeline.
 *
 * Everything impure lives here so `sidecar.ts`, `eijiro.ts` and
 * `import-eijiro.ts` stay pure and golden-testable (the §2.2 isolation rule).
 *
 * Two adapters:
 *   • `vaultSidecarIO` — writes the shards as ordinary vault files, so they
 *     sync, can be opened in a text editor, and uninstall by deletion (§19
 *     files-over-app).
 *   • `nodeBankSource` — reads an EXTRACTED Yomitan export folder from disk.
 *     Desktop only: the export lives outside the vault (70MB zip / 522MB
 *     extracted) and putting it inside would sync the whole thing. Mobile gets
 *     an honest error rather than a silent no-op (§28 S6).
 */

import { normalizePath, type App } from 'obsidian';
import { nodeReq, nodeRuntimeAvailable } from '../notes/audio-extractor.ts';
import type { SidecarIO } from './sidecar.ts';
import type { BankSource } from './import-eijiro.ts';
import type { EijiroTuple } from './eijiro.ts';

/** Vault-backed sidecar IO. Paths are vault-relative and normalized. */
export function vaultSidecarIO(app: App): SidecarIO {
  const a = app.vault.adapter;
  const p = (path: string) => normalizePath(path);
  return {
    async read(path) {
      const np = p(path);
      return (await a.exists(np)) ? a.read(np) : null;
    },
    async write(path, text) {
      const np = p(path);
      await ensureParent(app, np);
      await a.write(np, text);
    },
    async append(path, text) {
      const np = p(path);
      await ensureParent(app, np);
      // The adapter has no atomic append; read-modify-write is fine because
      // import writes one shard at a time from a single sequential loop.
      const prev = (await a.exists(np)) ? await a.read(np) : '';
      await a.write(np, prev + text);
    },
    async exists(path) { return a.exists(p(path)); },
    async mkdir(path) {
      const np = p(path);
      if (!(await a.exists(np))) await a.mkdir(np);
    },
    async remove(path) {
      const np = p(path);
      if (await a.exists(np)) await a.remove(np);
    },
    /** Installed dictionaries = the folders present. There is no registry. */
    async listFolders(path) {
      const np = p(path);
      if (!(await a.exists(np))) return [];
      const listed = await a.list(np);
      return (listed.folders ?? []).map((f) => f.split('/').filter(Boolean).pop() ?? '')
        .filter(Boolean);
    },
  };
}

async function ensureParent(app: App, path: string): Promise<void> {
  const dir = path.slice(0, path.lastIndexOf('/'));
  if (!dir) return;
  const a = app.vault.adapter;
  if (await a.exists(dir)) return;
  // create the chain, tolerating races with Obsidian's own folder creation
  const parts = dir.split('/');
  let cur = '';
  for (const seg of parts) {
    cur = cur ? `${cur}/${seg}` : seg;
    if (!(await a.exists(cur))) {
      try { await a.mkdir(cur); } catch { /* already created concurrently */ }
    }
  }
}

interface NodeFs {
  promises: {
    readdir(p: string): Promise<string[]>;
    readFile(p: string, enc: string): Promise<string>;
    stat(p: string): Promise<{ isDirectory(): boolean }>;
  };
}

/**
 * Read an extracted Yomitan export folder (index.json + term_bank_*.json).
 * Throws with a usable message when Node is unavailable or the folder is not
 * an export — an import that silently produces zero entries is worse than one
 * that refuses.
 */
export function nodeBankSource(folder: string): BankSource {
  if (!nodeRuntimeAvailable()) {
    throw new Error('辞書変換はデスクトップ専用です（モバイルにはNodeがありません）');
  }
  const fs = nodeReq<NodeFs>('fs');
  const join = (a: string, b: string) => `${a.replace(/[\\/]+$/, '')}/${b}`;

  return {
    async index() {
      try {
        const raw = await fs.promises.readFile(join(folder, 'index.json'), 'utf8');
        return JSON.parse(raw);
      } catch {
        throw new Error(`index.json が見つかりません: ${folder}\nYomitan辞書を展開したフォルダを指定してください。`);
      }
    },
    async bankNames() {
      const all = await fs.promises.readdir(folder);
      const banks = all.filter((f) => /^term_bank_\d+\.json$/.test(f));
      if (!banks.length) throw new Error(`term_bank_*.json が1つもありません: ${folder}`);
      // numeric order, so progress reads sensibly (1,2,…,10 not 1,10,100)
      return banks.sort((x, y) =>
        Number(/(\d+)/.exec(x)![1]) - Number(/(\d+)/.exec(y)![1]));
    },
    async bank(name) {
      const raw = await fs.promises.readFile(join(folder, name), 'utf8');
      const parsed = JSON.parse(raw) as EijiroTuple[];
      if (!Array.isArray(parsed)) throw new Error(`${name} is not a term bank array`);
      return parsed;
    },
  };
}
