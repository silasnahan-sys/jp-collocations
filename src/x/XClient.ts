/**
 * XClient — scrapes X's internal GraphQL SearchTimeline endpoint.
 *
 * Auth is the user's logged-in session: the auth_token + ct0 cookies plus the
 * static public web bearer token. Requests go through Obsidian's requestUrl,
 * which bypasses CORS and works on both desktop and mobile.
 *
 * This talks to an *unofficial* endpoint. Operation ids and feature flags
 * rotate when X ships new bundles, so bearer / queryId / features are all
 * user-overridable in settings, and errors are surfaced verbatim (X's "feature
 * cannot be null" errors name exactly what to add).
 */

import { requestUrl } from 'obsidian';
import type { XSettings, XSearchQuery, XScrapeResult, XTweet, XTweetMedia } from './x-types';
import { buildRawQuery } from './query-builder';
import { XTransactionGenerator } from './XTransactionId';

export class XScrapeError extends Error {
  /** HTTP status, or 0 for transport/parse failures. */
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'XScrapeError';
    this.status = status;
  }
}

export class XClient {
  private getSettings: () => XSettings;
  // Cached signer. The signing material is static per web-app shell, so one
  // generator serves many requests; rebuilt on demand if it ever fails.
  private txnGen: XTransactionGenerator | null = null;
  private txnGenPromise: Promise<XTransactionGenerator> | null = null;

  constructor(getSettings: () => XSettings) {
    this.getSettings = getSettings;
  }

  /**
   * Lazily build (and cache) the x-client-transaction-id signer. Fetches X's
   * web-app shell + ondemand chunk via requestUrl (CORS-free, mobile-safe) and
   * parses with the platform DOMParser. Returns null if the signer can't be
   * built (caller proceeds unsigned — the request will surface X's own error).
   */
  private async ensureTxnGen(): Promise<XTransactionGenerator | null> {
    if (this.txnGen) return this.txnGen;
    if (!this.txnGenPromise) {
      const s = this.getSettings();
      const cookie = `auth_token=${s.authToken.trim()}; ct0=${s.csrfToken.trim()}`;
      const browserHeaders: Record<string, string> = {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      };
      this.txnGenPromise = XTransactionGenerator.create({
        parseHtml: (html) => {
          if (typeof DOMParser === 'undefined') {
            throw new Error('x-client-transaction-id: no DOMParser in this runtime.');
          }
          return new DOMParser().parseFromString(html, 'text/html');
        },
        fetchText: async (url) => {
          const r = await requestUrl({
            url,
            method: 'GET',
            headers: url.includes('x.com') ? { ...browserHeaders, cookie } : browserHeaders,
            throw: false,
          });
          return r.text ?? '';
        },
      });
    }
    try {
      this.txnGen = await this.txnGenPromise;
      return this.txnGen;
    } catch {
      // Allow a later retry to rebuild rather than caching the failure forever.
      this.txnGenPromise = null;
      return null;
    }
  }

  /** Forget the cached signer (e.g. after X rotates its shell → repeated 404). */
  resetTxnGen(): void {
    this.txnGen = null;
    this.txnGenPromise = null;
  }

  /** True when the scraper has everything it needs to make a live request. */
  isConfigured(): boolean {
    const s = this.getSettings();
    return !!(s.enabled && s.authToken.trim() && s.csrfToken.trim() && s.bearerToken.trim());
  }

  /** Human-readable reason the scraper can't run live, or null if it can. */
  configIssue(): string | null {
    const s = this.getSettings();
    if (!s.enabled) return 'X scraping is disabled in settings.';
    if (!s.authToken.trim()) return 'Missing auth_token cookie (set it in settings).';
    if (!s.csrfToken.trim()) return 'Missing ct0 cookie (set it in settings).';
    if (!s.bearerToken.trim()) return 'Missing bearer token (set it in settings).';
    return null;
  }

  /**
   * Run one page of live search. Pass the previous page's cursor to paginate.
   * Throws XScrapeError on auth/transport/parse failure.
   */
  async search(query: XSearchQuery, cursor?: string): Promise<XScrapeResult> {
    const issue = this.configIssue();
    if (issue) throw new XScrapeError(issue);

    const s = this.getSettings();
    const rawQuery = buildRawQuery(query);
    if (!rawQuery) throw new XScrapeError('Empty query — nothing to search.');

    const variables: Record<string, unknown> = {
      rawQuery,
      count: Math.max(10, Math.min(100, s.resultLimit || 40)),
      querySource: 'typed_query',
      product: query.product,
    };
    if (cursor) variables.cursor = cursor;

    let features: unknown;
    try {
      features = JSON.parse(s.featuresJson);
    } catch {
      throw new XScrapeError('Features JSON in settings is not valid JSON.');
    }

    const url =
      `https://x.com/i/api/graphql/${encodeURIComponent(s.searchQueryId)}/SearchTimeline` +
      `?variables=${encodeURIComponent(JSON.stringify(variables))}` +
      `&features=${encodeURIComponent(JSON.stringify(features))}`;

    const bearer = s.bearerToken.startsWith('Bearer ') ? s.bearerToken : `Bearer ${s.bearerToken}`;
    const headers: Record<string, string> = {
      authorization: bearer,
      'x-csrf-token': s.csrfToken.trim(),
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': s.defaultLang || 'en',
      'content-type': 'application/json',
      cookie: `auth_token=${s.authToken.trim()}; ct0=${s.csrfToken.trim()}`,
    };

    // X gates GraphQL behind a per-request signature. The path signed is the
    // endpoint path WITHOUT the query string (matches the browser client).
    const gen = await this.ensureTxnGen();
    if (gen) {
      try {
        const path = `/i/api/graphql/${s.searchQueryId}/SearchTimeline`;
        headers['x-client-transaction-id'] = await gen.generate('GET', path);
      } catch { /* proceed unsigned; X's error will surface */ }
    }

    let resp;
    try {
      resp = await requestUrl({ url, method: 'GET', headers, throw: false });
    } catch (e) {
      throw new XScrapeError(`Network error contacting X: ${(e as Error).message}`);
    }

    if (resp.status === 401 || resp.status === 403) {
      throw new XScrapeError(
        `X rejected the request (HTTP ${resp.status}). Your cookies likely expired — ` +
        `re-copy auth_token and ct0 from a logged-in x.com session.`,
        resp.status,
      );
    }
    if (resp.status === 429) {
      throw new XScrapeError('Rate limited by X (HTTP 429). Wait a bit before searching again.', 429);
    }
    if (resp.status === 404) {
      // The id we actually sent — surfaced so the user can confirm a freshly
      // pasted/auto-fetched id really did reach X (a common point of confusion).
      const sentId = s.searchQueryId.trim() || '(empty)';
      const signed = headers['x-client-transaction-id'] ? 'signed' : 'UNSIGNED';
      throw new XScrapeError(
        `SearchTimeline returned HTTP 404 (queryId: ${sentId}, request ${signed}). ` +
        (signed === 'UNSIGNED'
          ? 'The anti-bot signature could not be built (X shell fetch/parse failed) — retry, or check connectivity. '
          : 'The request was signed but still rejected — X may have just rotated its web-app shell. ' +
            'Retry once (the signer auto-rebuilds); if it persists the queryId may also be stale (🔑 → 詳細 → 「queryId 自動取得」). ') +
        'As a fallback use 🔗 (add tweet by URL, no auth) or ⤓ (import a JSONL corpus).',
        404,
      );
    }

    let json: any;
    try {
      json = resp.json;
    } catch {
      throw new XScrapeError(`X returned a non-JSON response (HTTP ${resp.status}).`, resp.status);
    }

    if (json?.errors?.length) {
      const msg = json.errors.map((e: any) => e?.message).filter(Boolean).join('; ');
      // Missing-feature errors name the exact flag to add — pass them through verbatim
      // so the user can paste it into 詳細 → Features JSON.
      throw new XScrapeError(`X GraphQL error: ${msg || 'unknown'}`, resp.status);
    }
    if (resp.status !== 200) {
      throw new XScrapeError(`X returned HTTP ${resp.status} (queryId: ${s.searchQueryId.trim() || '(empty)'}).`, resp.status);
    }

    return this.parse(json, rawQuery);
  }

  /**
   * Best-effort discovery of the current SearchTimeline operation id.
   *
   * X bakes its GraphQL operation ids into the web client's JS bundles. We load
   * the logged-in homepage, find the referenced `client-web` bundles, and scan
   * them for the `{queryId:"…",operationName:"SearchTimeline"}` record. Returns
   * the id (caller persists it) or null if it couldn't be found.
   */
  async discoverSearchQueryId(): Promise<string | null> {
    const s = this.getSettings();
    const cookie = `auth_token=${s.authToken.trim()}; ct0=${s.csrfToken.trim()}`;
    // A browser-ish UA + Accept makes X serve the full SPA shell (with all bundle
    // refs) rather than a stripped fallback page.
    const browserHeaders: Record<string, string> = {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    };

    let html = '';
    try {
      const resp = await requestUrl({
        url: 'https://x.com/',
        method: 'GET',
        headers: { ...browserHeaders, cookie },
        throw: false,
      });
      html = resp.text ?? '';
    } catch {
      return null;
    }
    if (!html) return null;

    const urls = [...new Set(
      html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web[^"')\s]+\.js/g) ?? [],
    )];
    if (urls.length === 0) return null;
    // Likely-relevant bundles first (the ops map tends to live in main/api/endpoints/
    // ondemand chunks). A bundle naming SearchTimeline in its URL is the surest hit.
    const score = (u: string) =>
      (/\/(main|api|endpoints|shared|ondemand)[.~]/.test(u) ? 2 : 0) +
      (u.includes('SearchTimeline') ? 5 : 0);
    const candidates = urls.sort((a, b) => score(b) - score(a)).slice(0, 24);

    // The ops record can serialize fields in either order; try the tight
    // adjacency forms first, then a looser bounded fallback. We validate the
    // captured value so a loose match can't persist a neighbouring op's id.
    const patterns = [
      /queryId:"([^"]+)",operationName:"SearchTimeline"/,
      /operationName:"SearchTimeline",[^}]*?queryId:"([^"]+)"/,
      /operationName:"SearchTimeline"[\s\S]{0,80}?queryId:"([^"]+)"/,
      /queryId:"([^"]+)"[\s\S]{0,80}?operationName:"SearchTimeline"/,
    ];
    for (const url of candidates) {
      try {
        const r = await requestUrl({ url, method: 'GET', headers: browserHeaders, throw: false });
        const js = r.text ?? '';
        // Exact-token guard: skip bundles that only mention SearchTimelineV2 etc.
        if (!/SearchTimeline"/.test(js)) continue;
        for (const re of patterns) {
          const m = js.match(re);
          if (m?.[1] && looksLikeQueryId(m[1])) return m[1];
        }
      } catch {
        /* skip unreadable bundle */
      }
    }
    return null;
  }

  /**
   * Fetch a single tweet by id via X's public syndication endpoint — no auth
   * required, so this works as a capture path even without cookies. Used by the
   * "add tweet by URL" flow. Returns null if the tweet can't be retrieved.
   */
  async fetchTweetById(id: string): Promise<XTweet | null> {
    const cleanId = id.replace(/\D/g, '');
    if (!cleanId) return null;
    // The syndication endpoint requires a `token` param derived from the id. This
    // is the canonical algorithm the official embed (react-tweet) uses; the
    // endpoint is lenient but a malformed token can yield an empty 404 page.
    const token =
      (((Number(cleanId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '')) || '0';
    const url =
      `https://cdn.syndication.twimg.com/tweet-result?id=${cleanId}&token=${token}&lang=en`;
    let resp;
    try {
      resp = await requestUrl({ url, method: 'GET', throw: false });
    } catch (e) {
      throw new XScrapeError(`Network error fetching tweet: ${(e as Error).message}`);
    }
    if (resp.status !== 200) {
      throw new XScrapeError(`Could not fetch tweet (HTTP ${resp.status}).`, resp.status);
    }
    let j: any;
    try {
      j = resp.json;
    } catch {
      throw new XScrapeError('Tweet endpoint returned non-JSON.');
    }
    if (!j || j.__typename === 'TweetTombstone') return null;

    const handle = j?.user?.screen_name ?? '';
    const created = Date.parse(j?.created_at ?? '');
    const now = Date.now();
    // Syndication ships either twitter-style mediaDetails (media_url_https,
    // type, video_info) or a simpler photos[] ({url}) — handle both.
    const rawMedia = j?.mediaDetails ?? j?.photos ?? [];
    const mediaList = parseMediaList(rawMedia);
    return {
      id: String(j.id_str ?? cleanId),
      url: `https://x.com/${handle || 'i'}/status/${j.id_str ?? cleanId}`,
      text: unescapeEntities(j?.text ?? ''),
      authorHandle: handle,
      authorName: j?.user?.name ?? handle,
      createdAt: Number.isNaN(created) ? now : created,
      lang: j?.lang ?? 'und',
      favoriteCount: j?.favorite_count ?? 0,
      retweetCount: j?.conversation_count ?? 0,
      replyCount: j?.conversation_count ?? 0,
      quoteCount: 0,
      hasMedia: mediaList.length > 0,
      media: mediaList.length > 0 ? mediaList : undefined,
      capturedAt: now,
      queries: [],
    };
  }

  // ── Response parsing ───────────────────────────────────────

  private parse(json: any, rawQuery: string): XScrapeResult {
    const instructions =
      json?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ?? [];

    const tweets: XTweet[] = [];
    let cursor: string | null = null;
    const now = Date.now();

    const handleEntry = (entry: any) => {
      const content = entry?.content;
      if (!content) return;

      if (content.entryType === 'TimelineTimelineCursor' || content.cursorType) {
        if (content.cursorType === 'Bottom' && content.value) cursor = content.value;
        return;
      }

      // Single tweet item
      if (content.itemContent) {
        const t = this.parseTweetResult(content.itemContent?.tweet_results?.result, rawQuery, now);
        if (t) tweets.push(t);
        return;
      }

      // Module (clusters of items, e.g. on the Top tab)
      if (Array.isArray(content.items)) {
        for (const it of content.items) {
          const r = it?.item?.itemContent?.tweet_results?.result;
          const t = this.parseTweetResult(r, rawQuery, now);
          if (t) tweets.push(t);
        }
      }
    };

    for (const ins of instructions) {
      if (Array.isArray(ins?.entries)) {
        for (const entry of ins.entries) handleEntry(entry);
      } else if (ins?.entry) {
        handleEntry(ins.entry);
      }
    }

    return { tweets, cursor };
  }

  private parseTweetResult(resultRaw: any, rawQuery: string, capturedAt: number): XTweet | null {
    if (!resultRaw) return null;
    // Unwrap visibility-limited wrapper.
    const result = resultRaw.__typename === 'TweetWithVisibilityResults' ? resultRaw.tweet : resultRaw;
    const legacy = result?.legacy;
    const id: string | undefined = result?.rest_id ?? legacy?.id_str;
    if (!legacy || !id) return null;

    // Author can live in legacy or the newer `core` shape.
    const userResult = result?.core?.user_results?.result;
    const userLegacy = userResult?.legacy ?? {};
    const userCore = userResult?.core ?? {};
    const authorHandle = userCore.screen_name ?? userLegacy.screen_name ?? '';
    const authorName = userCore.name ?? userLegacy.name ?? authorHandle;

    // Prefer the untruncated long-form text when present.
    const noteText = result?.note_tweet?.note_tweet_results?.result?.text;
    const text = unescapeEntities(noteText ?? legacy.full_text ?? '');

    const created = Date.parse(legacy.created_at ?? '');
    const media = legacy?.extended_entities?.media ?? legacy?.entities?.media ?? [];
    const mediaList = parseMediaList(media);
    const viewsRaw = result?.views?.count;
    const viewCount = viewsRaw != null ? Number(viewsRaw) : undefined;

    return {
      id,
      url: `https://x.com/${authorHandle || 'i'}/status/${id}`,
      text,
      authorHandle,
      authorName,
      createdAt: Number.isNaN(created) ? capturedAt : created,
      lang: legacy.lang ?? 'und',
      favoriteCount: legacy.favorite_count ?? 0,
      retweetCount: legacy.retweet_count ?? 0,
      replyCount: legacy.reply_count ?? 0,
      quoteCount: legacy.quote_count ?? 0,
      viewCount: viewCount != null && !Number.isNaN(viewCount) ? viewCount : undefined,
      hasMedia: (Array.isArray(media) && media.length > 0) || mediaList.length > 0,
      media: mediaList.length > 0 ? mediaList : undefined,
      capturedAt,
      queries: [rawQuery],
    };
  }
}

/**
 * X GraphQL operation ids are URL-safe base64-ish tokens, ~22 chars (e.g.
 * "MJpyQGqgklrVl_0X9gNy3A"). This guards the looser discovery regexes from
 * persisting a stray capture (a feature flag name, a hash fragment, etc.).
 */
function looksLikeQueryId(s: string): boolean {
  return /^[A-Za-z0-9_-]{16,32}$/.test(s);
}

/**
 * Normalise a twitter media entity array (GraphQL extended_entities.media or
 * syndication mediaDetails/photos) into the plugin's XTweetMedia shape.
 * URLs only — nothing is downloaded. Exported for the golden suite.
 */
export function parseMediaList(raw: unknown): XTweetMedia[] {
  if (!Array.isArray(raw)) return [];
  const out: XTweetMedia[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const mm = m as any;
    // Syndication photos[] fallback: { url } only.
    const base: string = mm.media_url_https ?? mm.media_url ?? mm.url ?? '';
    if (!base || !/^https?:\/\//.test(base)) continue;
    const type: XTweetMedia['type'] =
      mm.type === 'video' || mm.type === 'animated_gif' ? mm.type : 'photo';
    if (type === 'photo') {
      // pbs.twimg.com photo URLs accept ?name=<size> — small thumb, large view.
      const sizable = /pbs\.twimg\.com\/media\//.test(base);
      out.push({
        type,
        thumb: sizable ? `${base}?name=small` : base,
        url: sizable ? `${base}?name=large` : base,
      });
    } else {
      // Video / gif: poster frame as thumb; best mp4 variant as the target.
      const variants: any[] = mm.video_info?.variants ?? [];
      const mp4 = variants
        .filter(v => v?.content_type === 'video/mp4' && v?.url)
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
      out.push({ type, thumb: base, url: mp4?.url ?? mm.expanded_url ?? base });
    }
  }
  return out;
}

/** Decode the handful of HTML entities X leaves in legacy full_text. */
function unescapeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
