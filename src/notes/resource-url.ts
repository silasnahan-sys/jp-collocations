/**
 * resource-url.ts — telling "somewhere on the web" apart from "a file on this
 * device", which is one question the plugin was answering in four places and
 * getting wrong in all of them.
 *
 * ## Why this is not obvious
 *
 * Obsidian hands out a URL for a vault file, and the URL's SHAPE depends on the
 * platform it is running on:
 *
 *   desktop   app://<hash>/C:/Users/silas/Documents/Lenovo/manga/panel.png?17
 *   iPadOS    capacitor://localhost/_capacitor_file_/var/mobile/…/Lenovo/…png
 *   Android   http://localhost/_capacitor_file_/storage/emulated/0/Lenovo/…png
 *
 * The Android one is a genuine `http://` URL that points at a file six
 * centimetres away. So `/^https?:/` — the test four different call sites used
 * to mean "remote, not ours" — is a claim about the SCHEME that was being read
 * as a claim about the LOCATION, and on Android those come apart completely.
 * Every vault image on that platform read as a web address.
 *
 * ## The bigger half, which is not platform-specific at all
 *
 * Dragging a picture that is ALREADY in the vault — a manga panel out of a
 * note and into the tray — is not a file drag. `dataTransfer.files` is empty
 * and `text/uri-list` carries the `<img>`'s resource URL instead. Every
 * platform then classified that as a link and minted a URL card pointing at
 * `app://…?<mtime>`, which stops resolving the moment the file is touched.
 * The most natural way to move a picture you already have produced a card that
 * looked fine and was dead.
 *
 * So the answer is not "stop calling it remote" but "recognise it as a vault
 * path" — which needs the vault, because the URL carries an ABSOLUTE path and
 * nothing in the string says where the vault root falls inside it. `pathTails`
 * offers every possibility, longest first; `InVault` is the only thing that can
 * say which one is real.
 */

/** Android's file bridge and iOS's Capacitor URLs both carry this segment. */
export const LOCAL_FILE = '_capacitor_file_';

/**
 * Ask the vault whether a candidate names a real file, and get back the path it
 * really has. Both roads in one call: an exact vault-relative path, and a
 * shortest-form link text that only the vault's own index can expand.
 */
export type InVault = (candidate: string) => string | null;

/** `scheme` and the part after `scheme://host/`, or null for a bare path. */
function split(url: string): { scheme: string; rest: string } | null {
  const m = /^([a-z][a-z0-9+.\-]*):\/\/[^/]*\/?(.*)$/i.exec(url);
  return m ? { scheme: m[1].toLowerCase(), rest: m[2] } : null;
}

/**
 * Does this URL point at a file on THIS DEVICE, through Obsidian's own bridge?
 *
 * True for every platform's vault-resource shape. Note the http(s) case: the
 * scheme is not the signal, `_capacitor_file_` is.
 */
export function isDeviceUrl(url: string): boolean {
  const s = split(url.trim());
  if (!s) return false;
  if (s.scheme === 'app' || s.scheme === 'capacitor' || s.scheme === 'file') return true;
  return (s.scheme === 'http' || s.scheme === 'https') && s.rest.startsWith(LOCAL_FILE);
}

/**
 * Is this a genuine web address — something a browser should open?
 *
 * The complement of `isDeviceUrl` for http(s) only, so `app://` and friends are
 * neither remote nor "text that happens to have a colon in it". A dev server on
 * `http://localhost:8080` IS remote by this rule, and rightly: it is a page.
 * Only the `_capacitor_file_` bridge is a file.
 */
export function isRemoteUrl(url: string): boolean {
  const t = url.trim();
  return /^https?:\/\/\S+$/i.test(t) && !isDeviceUrl(t);
}

/**
 * Every vault-relative path a resource URL could be hiding, longest first.
 *
 * A desktop URL holds `…/Documents/Lenovo/manga/panel.png` and an iPad one
 * holds `…/Application/<uuid>/Documents/Lenovo/manga/panel.png`; in both, the
 * vault root sits at an unknowable depth. Trying every tail from longest to
 * shortest and stopping at the first the vault recognises finds it on any
 * platform, at any depth, in any folder — and longest-first means the most
 * specific match wins when a filename repeats.
 *
 * Empty for anything that is not a path at all: `data:`, `blob:`, and real web
 * addresses.
 */
export function pathTails(src: string): string[] {
  if (!src) return [];
  const s = src.trim();
  if (!s || /^(?:data|blob):/i.test(s)) return [];
  // The query is a cache buster (`?<mtime>`); the hash is never ours.
  const noQuery = s.split('?')[0].split('#')[0];
  const parts0 = split(noQuery);
  let raw = noQuery;
  if (parts0) {
    if (!isDeviceUrl(noQuery)) return [];   // the open internet: not a path
    raw = parts0.rest;
  }
  if (raw.startsWith(LOCAL_FILE)) raw = raw.slice(LOCAL_FILE.length);
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* keep raw */ }
  const parts = decoded.split('/').filter((p) => p.length > 0);
  return parts.map((_, i) => parts.slice(i).join('/'));
}

/**
 * The vault path inside an image's `src` or a dragged URI, or null.
 *
 * With `inVault` the answer is VERIFIED — the returned path is one the vault
 * confirmed it holds, so a card built from it can never render a broken image,
 * and a URL the vault does not know comes back null rather than as a guess
 * (§28 S6). Without it (the golden, and any caller with no vault to ask) this
 * falls back to slicing at `attachments/`, this plugin's own folder.
 */
export function vaultPathOf(src: string, inVault?: InVault): string | null {
  const tails = pathTails(src);
  if (!tails.length) return null;
  if (inVault) {
    for (const t of tails) {
      const hit = inVault(t);
      if (hit) return hit;
    }
    return null;
  }
  const decoded = tails[0];
  const at = decoded.lastIndexOf('/attachments/');
  return at >= 0 ? decoded.slice(at + 1) : decoded;
}

/** Does this URL name a picture? Extension only — a resource URL has no MIME. */
export function looksLikeImageUrl(url: string): boolean {
  return /\.(?:png|jpe?g|webp|gif|bmp|heic|avif)$/i.test(url.split('?')[0].split('#')[0]);
}
