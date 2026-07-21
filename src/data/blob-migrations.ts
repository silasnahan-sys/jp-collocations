/**
 * blob-migrations.ts — one-time cleanups applied to the canonical blob right
 * after load, plus the secret-splitting used on every settings save.
 *
 * AUDIT §1.2: the persisted discourse/KWIC indexes were 99.5% of the
 * historical 62MB data.json and are derived data — they rebuild from vault
 * text in the background, so they are stripped from the blob and never
 * written again.
 *
 * AUDIT §2: session cookies and API keys must not live in a file that syncs
 * with the vault. They move to Obsidian's device-local storage
 * (app.saveLocalStorage); the blob keeps only '' in those fields.
 *
 * PURE — no Obsidian imports — golden-tested in golden/storage.mjs.
 */

export interface SecretValues {
  xAuthToken?: string;
  xCsrfToken?: string;
  ytCookie?: string;
  ocrApiKey?: string;
  plexToken?: string;
}

/** Device-local storage keys, one per secret. */
export const SECRET_LS_KEYS: Record<keyof SecretValues, string> = {
  xAuthToken: 'jpc-secret-x-auth-token',
  xCsrfToken: 'jpc-secret-x-ct0',
  ytCookie: 'jpc-secret-yt-cookie',
  ocrApiKey: 'jpc-secret-ocr-api-key',
  plexToken: 'jpc-secret-plex-token',
};

/** Strip the persisted derived indexes. Returns true if the blob changed. */
export function stripDerivedIndexes(blob: Record<string, unknown>): boolean {
  const sb = blob._surferBridge as Record<string, unknown> | undefined;
  if (!sb || typeof sb !== 'object') return false;
  let changed = false;
  for (const k of ['discourseIndex', 'kwicIndex']) {
    if (k in sb) { delete sb[k]; changed = true; }
  }
  return changed;
}

/** Pull secrets OUT of the stored settings tree, blanking them in place.
 *  Returns whatever non-empty values were found (for the localStorage move). */
export function extractSecrets(blob: Record<string, unknown>): { changed: boolean; secrets: SecretValues } {
  const secrets: SecretValues = {};
  let changed = false;
  const take = (obj: unknown, field: string, dest: keyof SecretValues): void => {
    if (!obj || typeof obj !== 'object') return;
    const rec = obj as Record<string, unknown>;
    const v = rec[field];
    if (typeof v === 'string' && v) {
      secrets[dest] = v;
      rec[field] = '';
      changed = true;
    }
  };
  take(blob.x, 'authToken', 'xAuthToken');
  take(blob.x, 'csrfToken', 'xCsrfToken');
  take(blob.ytHistory, 'cookie', 'ytCookie');
  take(blob.notes, 'ocrApiKey', 'ocrApiKey');
  take(blob.plex, 'token', 'plexToken');
  return { changed, secrets };
}

/**
 * Split a LIVE settings object into a persistable scrubbed copy + the secret
 * values. The live object is not modified — the runtime keeps real secrets;
 * only the persisted copy is blanked.
 */
export function scrubSettingsForPersist<T extends Record<string, unknown>>(
  settings: T,
): { scrubbed: T; secrets: SecretValues } {
  const s = settings as Record<string, any>;
  const scrubbed: Record<string, any> = {
    ...s,
    x: s.x ? { ...s.x } : s.x,
    ytHistory: s.ytHistory ? { ...s.ytHistory } : s.ytHistory,
    notes: s.notes ? { ...s.notes } : s.notes,
    plex: s.plex ? { ...s.plex } : s.plex,
  };
  const secrets: SecretValues = {
    xAuthToken: s.x?.authToken || undefined,
    xCsrfToken: s.x?.csrfToken || undefined,
    ytCookie: s.ytHistory?.cookie || undefined,
    ocrApiKey: s.notes?.ocrApiKey || undefined,
    plexToken: s.plex?.token || undefined,
  };
  if (scrubbed.x) { scrubbed.x.authToken = ''; scrubbed.x.csrfToken = ''; }
  if (scrubbed.ytHistory) scrubbed.ytHistory.cookie = '';
  if (scrubbed.notes) scrubbed.notes.ocrApiKey = '';
  if (scrubbed.plex) scrubbed.plex.token = '';
  return { scrubbed: scrubbed as T, secrets };
}
