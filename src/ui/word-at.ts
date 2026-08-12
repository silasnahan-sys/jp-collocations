/**
 * word-at.ts — the longest dictionary-validated word under a screen point.
 *
 * Extracted verbatim from `LexiconPanel.wordAt`, where it had been private, so
 * that the transcript can use the IDENTICAL resolver rather than a second one
 * that agrees with it most of the time. §26.0 property 4 — one grammar
 * everywhere — is a claim about behaviour, and two copies of a heuristic is the
 * usual way that claim quietly stops being true.
 *
 * The method is deliberately not tokenization. There is no morphological
 * analyser in the plugin and guessing word boundaries without one produces
 * confident nonsense on exactly the sentences a learner is stuck on. Instead it
 * probes the dictionary with progressively shorter strings from the tapped
 * character and takes the longest thing the dictionary is willing to confirm —
 * deinflection included, since that is the dictionary layer's job. If nothing
 * resolves, nothing happens. "Dictionary or nothing" is the whole rule.
 *
 * 8 characters is the probe ceiling: long enough for 待ち合わせ場所 and every
 * realistic compound, short enough that a miss costs eight failed map lookups
 * rather than a scan, which matters when this runs on every hover frame.
 */

/** The subset of a lookup hit this module needs — anything the dictionary
 *  layer returns satisfies it, so no import from `dictionary/` is required and
 *  this file stays a leaf. */
export type WordHit = unknown;

/**
 * Resolve a viewport point to the longest word the dictionary confirms there.
 *
 * `lookup` is the caller's dictionary — passed in rather than imported so this
 * works identically for the catalog, the dictionary view and the transcript,
 * each of which reaches its store by a different route.
 */
export function wordAtPoint<T>(
  x: number,
  y: number,
  lookup: (probe: string) => T[],
): T | null {
  // `caretRangeFromPoint` is the WebKit/Blink spelling and is what Obsidian
  // runs on everywhere — desktop Electron and the iOS webview alike. Optional
  // because the standards-track name differs and an older webview may have
  // neither; a missing API means no peek, never a crash.
  const range = (document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  }).caretRangeFromPoint?.(x, y);
  const node = range?.startContainer;
  if (!range || !node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? '';
  const off = Math.min(range.startOffset, Math.max(0, text.length - 1));
  for (let n = Math.min(8, text.length - off); n >= 1; n--) {
    const probe = text.slice(off, off + n).trim();
    // Kana, kanji and CJK-ext-A only. A probe that is punctuation or latin is
    // not a word we can look up, and skipping it here avoids the round trip.
    if (!probe || !/[぀-ヿ㐀-䶿一-鿿]/.test(probe)) continue;
    const hits = lookup(probe);
    if (hits.length) return hits[0];
  }
  return null;
}
