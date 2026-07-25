/**
 * collections.ts — user "collections": ordinary markdown files the X view
 * appends to.
 *
 * A collection is just a note (Philosophy.md, Lifting.md, …) inside
 * `settings.x.collectionsFolder`. Saving from the sidebar appends a canonical
 * `[!x-tweet]` callout block (see tweet-format.ts) to the REAL file — so what
 * the sidebar shows is always an embed of vault truth, the file stays fully
 * user-editable, and the plugin's own vault indexing picks the content up.
 */

import { normalizePath, TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';

/** All markdown files inside the collections folder (recursive), A→Z. */
export function listCollections(app: App, folder: string): TFile[] {
  const root = app.vault.getAbstractFileByPath(normalizePath(folder));
  if (!(root instanceof TFolder)) return [];
  const out: TFile[] = [];
  const walk = (f: TFolder) => {
    for (const child of f.children) {
      if (child instanceof TFile && child.extension === 'md') out.push(child);
      else if (child instanceof TFolder) walk(child);
    }
  };
  walk(root);
  out.sort((a, b) => a.basename.localeCompare(b.basename));
  return out;
}

/** Sanitise a user-typed collection name into a safe file basename. */
export function safeCollectionName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|#^[\]]/g, '').slice(0, 80);
}

/**
 * Append a block to a collection file, creating folder/file on first use.
 * Returns the file so callers can open/link it.
 */
export async function appendToCollection(
  app: App,
  filePath: string,
  block: string,
): Promise<TFile> {
  const path = normalizePath(filePath);
  const dir = path.split('/').slice(0, -1).join('/');
  if (dir && !app.vault.getAbstractFileByPath(dir)) {
    await app.vault.createFolder(dir).catch(() => { /* concurrent create */ });
  }
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.process(existing, (txt) =>
      (txt.trimEnd() ? txt.trimEnd() + '\n\n' : '') + block + '\n',
    );
    return existing;
  }
  return app.vault.create(path, block + '\n');
}
