/**
 * query-builder.ts — translate structured search intent into the strings X's
 * advanced search understands, and parse freeform input back into terms.
 *
 * The same XSearchQuery drives both the live scrape (via buildRawQuery) and the
 * offline corpus filter (via matchesQuery in XCorpusStore), so cached and live
 * results behave identically.
 */

import type { XSearchQuery } from './x-types';
import { normalizeJapanese } from '../utils/japanese';

/**
 * Split a freeform search box into terms, honouring "double-quoted phrases".
 * Whitespace separates terms; quotes group a multi-word phrase into one term.
 *
 *   parseTerms('以前の でさえ')        -> ['以前の', 'でさえ']
 *   parseTerms('"as soon as" 以前の')  -> ['as soon as', '以前の']
 */
export function parseTerms(raw: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const term = (m[1] ?? m[2] ?? '').trim();
    if (term) terms.push(term);
  }
  return terms;
}

/** Quote a term for X's exact-phrase matching when it contains spaces, or is
 *  a multi-character run we want matched verbatim (Japanese is unsegmented, so
 *  quoting keeps 以前の together rather than letting X tokenise it loosely). */
function quoteTerm(term: string): string {
  const t = term.trim();
  if (!t) return '';
  if (/^[-"]/.test(t)) return t; // already an operator/quoted — leave as-is
  // Bare single ASCII word can stay unquoted; everything else gets quoted.
  if (/^[A-Za-z0-9_]+$/.test(t)) return t;
  return `"${t.replace(/"/g, '')}"`;
}

/**
 * Build the raw advanced-search query string for X's SearchTimeline.
 * Example output: `"以前の" "でさえ" lang:ja min_faves:5 -"RT"`
 */
export function buildRawQuery(q: XSearchQuery): string {
  const parts: string[] = [];

  for (const t of q.allTerms) {
    const quoted = quoteTerm(t);
    if (quoted) parts.push(quoted);
  }

  const anyQuoted = q.anyTerms.map(quoteTerm).filter(Boolean);
  if (anyQuoted.length === 1) {
    parts.push(anyQuoted[0]);
  } else if (anyQuoted.length > 1) {
    parts.push(`(${anyQuoted.join(' OR ')})`);
  }

  for (const t of q.noneTerms) {
    const quoted = quoteTerm(t);
    if (quoted) parts.push(`-${quoted}`);
  }

  if (q.lang) parts.push(`lang:${q.lang}`);
  if (q.fromUser) parts.push(`from:${q.fromUser.replace(/^@/, '')}`);
  if (q.toUser) parts.push(`to:${q.toUser.replace(/^@/, '')}`);
  if (q.minFaves > 0) parts.push(`min_faves:${q.minFaves}`);
  if (q.minRetweets > 0) parts.push(`min_retweets:${q.minRetweets}`);
  if (q.minReplies > 0) parts.push(`min_replies:${q.minReplies}`);
  if (q.since) parts.push(`since:${q.since}`);
  if (q.until) parts.push(`until:${q.until}`);

  return parts.join(' ').trim();
}

/** True if the query carries no constraints at all (nothing to search). */
export function isEmptyQuery(q: XSearchQuery): boolean {
  return (
    q.allTerms.length === 0 &&
    q.anyTerms.length === 0 &&
    q.noneTerms.length === 0 &&
    !q.fromUser &&
    !q.toUser &&
    q.minFaves === 0 &&
    q.minRetweets === 0 &&
    q.minReplies === 0
  );
}

/**
 * The terms that should be highlighted in a result (everything the user wants
 * to *see*, i.e. required + any-of, but not excluded). Normalised for display
 * matching by callers as needed.
 */
export function highlightTerms(q: XSearchQuery): string[] {
  return [...q.allTerms, ...q.anyTerms].map(t => t.trim()).filter(Boolean);
}

/** Normalise a term the way the corpus index does, so live/offline agree. */
export function normTerm(term: string): string {
  return normalizeJapanese(term.trim());
}
