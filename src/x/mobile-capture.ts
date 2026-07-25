/**
 * mobile-capture.ts — the iOS "co-occurrence lookup" round trip.
 *
 * X's live SearchTimeline is gated by a per-request anti-bot signature
 * (`x-client-transaction-id`) that only X's own JavaScript can produce, so a
 * cookie-only `requestUrl` call 404s. The reliable way to get *new* tweets on
 * iOS without reimplementing that signing is to let a real browser engine do
 * the work: Scriptable's `WebView` (a WKWebView) loads x.com's search page with
 * the user's logged-in session, X signs its own requests, and we scrape the
 * rendered results — entirely on-device, no unsigned request ever sent.
 *
 * The flow starts and ends in Obsidian with near-zero input:
 *   1. Obsidian command reads the query (clipboard/selection) and opens
 *      `scriptable:///run?scriptName=…&url=…&terms=…&success=obsidian://jp-x-capture`.
 *   2. Scriptable loads the x.com search, scrolls, scrapes, keeps only tweets
 *      containing ALL terms (true co-occurrence), and opens the `success` URL
 *      with the matches base64-encoded.
 *   3. Obsidian's protocol handler decodes them, merges them into the corpus,
 *      and shows the answer in the normal X view.
 *
 * This module is pure (URL/string building + the Scriptable script source); the
 * plugin wiring (command, protocol handler) lives in main.ts.
 */

import type { XSearchQuery } from './x-types';
import { buildRawQuery } from './query-builder';

/** Default Scriptable script name the user pastes the capture script under. */
export const SCRIPTABLE_DEFAULT_NAME = 'JP-X-Cooc';

/** obsidian:// action the Scriptable script calls back into. */
export const X_CAPTURE_ACTION = 'jp-x-capture';

/** How many co-occurring tweets to bring back per lookup (URL stays small). */
export const MOBILE_CAPTURE_MAX = 40;

export interface MobileCaptureLaunch {
  /** scriptable:// URL to open from Obsidian. */
  url: string;
  /** The x.com advanced-search query (shown to the user). */
  rawQuery: string;
}

/** The x.com "Latest" search results page for an advanced query. */
export function buildXSearchPageUrl(rawQuery: string): string {
  return `https://x.com/search?q=${encodeURIComponent(rawQuery)}&src=typed_query&f=live`;
}

/**
 * Build the `scriptable:///run?…` URL that launches the capture script. The
 * `success` callback carries the vault name so the round trip returns to *this*
 * vault. `terms` is the exact list the script filters co-occurrence on.
 */
export function buildScriptableLaunchUrl(opts: {
  scriptName: string;
  query: XSearchQuery;
  terms: string[];
  max: number;
  vaultName: string;
}): MobileCaptureLaunch {
  const rawQuery = buildRawQuery(opts.query);
  const pageUrl = buildXSearchPageUrl(rawQuery);
  // Carry the vault (so the round trip returns here) and the plain terms (so the
  // view can be re-seeded on return). Scriptable appends n / total / data.
  const success =
    `obsidian://${X_CAPTURE_ACTION}?vault=${encodeURIComponent(opts.vaultName)}` +
    `&q=${encodeURIComponent(opts.terms.join(' '))}`;
  const params = new URLSearchParams({
    scriptName: opts.scriptName || SCRIPTABLE_DEFAULT_NAME,
    url: pageUrl,
    terms: JSON.stringify(opts.terms),
    max: String(opts.max || MOBILE_CAPTURE_MAX),
    success,
  });
  return { url: `scriptable:///run?${params.toString()}`, rawQuery };
}

/**
 * Build the x.com search URL the Orion userscript auto-captures. Carries the
 * capture flag + vault so the userscript knows to scrape-and-return, and to
 * which vault. The co-occurrence terms are recovered from the quoted phrases in
 * `q`, so they don't need a separate parameter.
 */
export function buildBrowserCaptureUrl(opts: {
  query: XSearchQuery;
  vaultName: string;
}): { url: string; rawQuery: string } {
  const rawQuery = buildRawQuery(opts.query);
  const url =
    `https://x.com/search?q=${encodeURIComponent(rawQuery)}` +
    `&src=typed_query&f=live` +
    `&jpcap=1&jpvault=${encodeURIComponent(opts.vaultName)}`;
  return { url, rawQuery };
}

/**
 * Decode the base64 (UTF-8) JSONL payload returned in the `data` query
 * parameter (from Scriptable or the Orion userscript). Returns JSONL text ready
 * for `XCorpusStore.importJsonl`.
 */
export function decodeCaptureData(b64: string): string {
  if (!b64) return '';
  const bin = atob(b64);
  // atob yields a binary string; recover the original UTF-8 text.
  try {
    return decodeURIComponent(escape(bin));
  } catch {
    return bin;
  }
}

/**
 * The Scriptable script the user pastes once on iOS. Kept here as the single
 * source of truth so the settings "write script to vault" action stays in sync.
 *
 * No backticks / ${} inside, so it embeds cleanly in this template literal.
 */
export const SCRIPTABLE_SOURCE = [
  '// JP-X-Cooc — Scriptable capture for jp-collocations (Obsidian)',
  '// Auto-invoked by Obsidian. One-time setup:',
  '//   1. Create a new Scriptable script named exactly "JP-X-Cooc" and paste this in.',
  '//   2. Run it once, tap into the WebView, and log into x.com. The session persists.',
  '// After that, the Obsidian command does the rest automatically.',
  '',
  'const p = args.queryParameters || {};',
  'const pageUrl = p.url;',
  'let terms = [];',
  'try { terms = JSON.parse(p.terms || "[]"); } catch (e) { terms = []; }',
  'const maxN = parseInt(p.max || "40", 10) || 40;',
  'const success = p.success || "";',
  '',
  'async function scrape() {',
  '  const wv = new WebView();',
  '  await wv.loadURL(pageUrl);',
  '  const code = [',
  '    "(async () => {",',
  '    "  const sleep = ms => new Promise(r => setTimeout(r, ms));",',
  '    "  const out = {};",',
  '    "  for (let i = 0; i < 8; i++) {",',
  '    "    document.querySelectorAll(\'article[data-testid=\\"tweet\\"]\').forEach(a => {",',
  '    "      try {",',
  '    "        const link = a.querySelector(\'a[href*=\\"/status/\\"]\');",',
  '    "        const href = link ? link.href : \'\';",',
  '    "        const m = href.match(/\\\\/([^\\\\/]+)\\\\/status\\\\/(\\\\d+)/);",',
  '    "        if (!m) return;",',
  '    "        const handle = m[1]; const id = m[2];",',
  '    "        const tx = a.querySelector(\'[data-testid=\\"tweetText\\"]\');",',
  '    "        const text = tx ? tx.innerText : \'\';",',
  '    "        const tm = a.querySelector(\'time\');",',
  '    "        const created = tm ? tm.getAttribute(\'datetime\') : \'\';",',
  '    "        out[id] = { id: id, author: handle, text: text, createdAt: created, url: \'https://x.com/\' + handle + \'/status/\' + id };",',
  '    "      } catch (e) {}",',
  '    "    });",',
  '    "    window.scrollTo(0, document.body.scrollHeight);",',
  '    "    await sleep(1000);",',
  '    "  }",',
  '    "  completion(JSON.stringify(Object.values(out)));",',
  '    "})()"',
  '  ].join("\\n");',
  '  let raw = "[]";',
  '  try { raw = await wv.evaluateJavaScript(code, true); } catch (e) { raw = "[]"; }',
  '  try { return JSON.parse(raw) || []; } catch (e) { return []; }',
  '}',
  '',
  'function nfkc(s) { return (s || "").normalize("NFKC"); }',
  '',
  'async function main() {',
  '  // Manual run (no params from Obsidian) = setup mode: show x.com so you can',
  '  // log in. The session persists in Scriptable for later headless lookups.',
  '  if (!pageUrl || !success) {',
  '    const wv = new WebView();',
  '    await wv.loadURL("https://x.com/home");',
  '    await wv.present();',
  '    Script.complete();',
  '    return;',
  '  }',
  '  let rows = [];',
  '  try { rows = await scrape(); } catch (e) { rows = []; }',
  '  const want = terms.map(nfkc).filter(Boolean);',
  '  const matched = rows.filter(r => {',
  '    const t = nfkc(r.text);',
  '    return want.every(w => t.indexOf(w) !== -1);',
  '  });',
  '  const capped = matched.slice(0, maxN);',
  '  const jsonl = capped.map(r => JSON.stringify({',
  '    id: r.id, url: r.url, text: r.text, author: r.author,',
  '    createdAt: r.createdAt || new Date().toISOString(),',
  '    likeCount: 0, matchedQueries: []',
  '  })).join("\\n");',
  '  const b64 = Data.fromString(jsonl).toBase64String();',
  '  if (success) {',
  '    let ret = success + (success.indexOf("?") === -1 ? "?" : "&");',
  '    ret += "n=" + matched.length + "&total=" + rows.length + "&data=" + encodeURIComponent(b64);',
  '    Safari.open(ret);',
  '  }',
  '  Script.complete();',
  '}',
  '',
  'await main();',
  '',
].join('\n');

/**
 * The Orion (iOS) userscript — the route that actually works, since x.com's SPA
 * won't boot inside Scriptable's embedded WebView but runs fine in a real
 * browser. Auto-runs on a capture-flagged x.com search, scrapes the rendered
 * tweets, keeps only those containing ALL quoted terms, and redirects to the
 * plugin's `obsidian://jp-x-capture` handler. No GM_* APIs, so it works under
 * Orion's native userscripts or any Tampermonkey/Violentmonkey host.
 *
 * No backticks / ${} inside, so it embeds cleanly in this template literal.
 */
export const USERSCRIPT_SOURCE = [
  '// ==UserScript==',
  '// @name         JP-X-Cooc capture',
  '// @namespace    jp-collocations',
  '// @match        https://x.com/search*',
  '// @match        https://twitter.com/search*',
  '// @run-at       document-start',
  '// @grant        none',
  '// ==/UserScript==',
  '(function () {',
  '  "use strict";',
  '  // Read launch params at document-start, before x.com rewrites the URL.',
  '  var usp = new URLSearchParams(location.search);',
  '  if (usp.get("jpcap") !== "1") return;',
  '  var vault = usp.get("jpvault") || "";',
  '  var q = usp.get("q") || "";',
  '  var terms = [];',
  '  var re = /"([^"]+)"/g, mm;',
  '  while ((mm = re.exec(q)) !== null) terms.push(mm[1]);',
  '  if (terms.length < 2) return;',
  '  var MAX = 40, done = false;',
  '  function nfkc(s) { return (s || "").normalize("NFKC"); }',
  '',
  '  function scrapeInto(out) {',
  '    document.querySelectorAll(\'article[data-testid="tweet"]\').forEach(function (a) {',
  '      try {',
  '        var link = a.querySelector(\'a[href*="/status/"]\');',
  '        var href = link ? link.href : "";',
  '        var m = href.match(/\\/([^\\/]+)\\/status\\/(\\d+)/);',
  '        if (!m) return;',
  '        var handle = m[1], id = m[2];',
  '        var tx = a.querySelector(\'[data-testid="tweetText"]\');',
  '        var text = tx ? tx.innerText : "";',
  '        var tm = a.querySelector("time");',
  '        var created = tm ? tm.getAttribute("datetime") : "";',
  '        out[id] = { id: id, author: handle, text: text, createdAt: created, url: "https://x.com/" + handle + "/status/" + id };',
  '      } catch (e) {}',
  '    });',
  '  }',
  '',
  '  function finish(rows) {',
  '    if (done) return; done = true;',
  '    var want = terms.map(nfkc).filter(Boolean);',
  '    var matched = rows.filter(function (r) { var t = nfkc(r.text); return want.every(function (w) { return t.indexOf(w) !== -1; }); });',
  '    var capped = matched.slice(0, MAX);',
  '    var jsonl = capped.map(function (r) {',
  '      return JSON.stringify({ id: r.id, url: r.url, text: r.text, author: r.author, createdAt: r.createdAt || new Date().toISOString(), likeCount: 0, matchedQueries: [] });',
  '    }).join("\\n");',
  '    var b64 = btoa(unescape(encodeURIComponent(jsonl)));',
  '    var ret = "obsidian://jp-x-capture?vault=" + encodeURIComponent(vault)',
  '      + "&q=" + encodeURIComponent(terms.join(" "))',
  '      + "&n=" + matched.length + "&total=" + rows.length',
  '      + "&data=" + encodeURIComponent(b64);',
  '    location.href = ret;',
  '  }',
  '',
  '  function run() {',
  '    var out = {}, scrolls = 0;',
  '    var timer = setInterval(function () {',
  '      scrapeInto(out);',
  '      window.scrollTo(0, document.body.scrollHeight);',
  '      if (++scrolls >= 8) { clearInterval(timer); finish(Object.keys(out).map(function (k) { return out[k]; })); }',
  '    }, 1200);',
  '    setTimeout(function () { try { clearInterval(timer); } catch (e) {} finish(Object.keys(out).map(function (k) { return out[k]; })); }, 15000);',
  '  }',
  '',
  '  function waitForTweets() {',
  '    if (document.querySelector(\'article[data-testid="tweet"]\')) { run(); return; }',
  '    var tries = 0;',
  '    var t = setInterval(function () {',
  '      if (document.querySelector(\'article[data-testid="tweet"]\')) { clearInterval(t); run(); }',
  '      else if (++tries > 40) { clearInterval(t); finish([]); }',
  '    }, 500);',
  '  }',
  '',
  '  if (document.readyState === "complete" || document.readyState === "interactive") waitForTweets();',
  '  else window.addEventListener("DOMContentLoaded", waitForTweets);',
  '})();',
  '',
].join('\n');
