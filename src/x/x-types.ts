/**
 * x-types.ts — type contracts for the X (Twitter) advanced-search dictionary.
 *
 * The X dictionary scrapes X's internal GraphQL SearchTimeline endpoint using
 * the user's logged-in session cookies, then caches every tweet it sees into a
 * growing, offline-searchable local corpus (persisted under `_xCorpus` in the
 * plugin data blob). This file defines:
 *   - XTweet           — a single captured tweet (the corpus unit)
 *   - XSearchQuery     — a structured advanced-search request
 *   - XSearchProduct   — which X timeline tab to scrape
 *   - XCorpusData      — the serialized corpus (Maps → arrays)
 *   - XSettings        — auth + defaults, lives in PluginSettings.x
 */

/** Which X search tab to scrape. Mirrors X advanced-search "product" values. */
export type XSearchProduct = 'Latest' | 'Top' | 'Media';

/** One media attachment on a tweet (URLs only — nothing is downloaded). */
export interface XTweetMedia {
  type: 'photo' | 'video' | 'animated_gif';
  /** Small preview image (pbs.twimg.com …?name=small for photos, poster frame for video). */
  thumb: string;
  /** Full-size target: large photo URL, or the best mp4 variant for video/gif. */
  url: string;
}

/** A single captured tweet — the atomic unit of the X corpus. */
export interface XTweet {
  /** Tweet id_str (stable, unique). */
  id: string;
  /** Canonical permalink: https://x.com/<handle>/status/<id> */
  url: string;
  /** Full visible text (note_tweet / long-form aware, entities unescaped). */
  text: string;
  /** Author screen name without the leading @ (e.g. "kensanji"). */
  authorHandle: string;
  /** Author display name. */
  authorName: string;
  /** Tweet creation time, epoch milliseconds. */
  createdAt: number;
  /** BCP-47-ish language tag X assigned (e.g. "ja", "en", "und"). */
  lang: string;
  favoriteCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  /** Approximate view count if X exposed it, else undefined. */
  viewCount?: number;
  /** Whether the tweet carried photo/video/card media. */
  hasMedia: boolean;
  /** Media attachments (URLs only). Optional — older corpus entries lack it. */
  media?: XTweetMedia[];
  /** When this plugin first captured the tweet, epoch ms. */
  capturedAt: number;
  /**
   * Provenance: the raw advanced-search query strings under which this tweet
   * was captured. Lets the corpus explain *why* a tweet is present.
   */
  queries: string[];
  /**
   * Named saved-query / phrase ids this tweet matched (bundle-compatible
   * `matchedQueries`). Populated when importing the CLI cache JSONL or when a
   * tweet is captured under a named saved search. Co-occurrence = ≥2 ids here.
   */
  matchedQueries?: string[];
}

/**
 * A structured advanced-search request. `buildRawQuery` turns this into the
 * string X's search box understands; the same fields drive offline corpus
 * filtering so live and cached search behave identically.
 */
export interface XSearchQuery {
  /** Required terms (AND). Each is matched as an exact phrase. */
  allTerms: string[];
  /** Optional terms — at least one must appear (OR group). */
  anyTerms: string[];
  /** Excluded terms — none may appear. */
  noneTerms: string[];
  /** Restrict to a language, e.g. "ja". Empty = any. */
  lang: string;
  /** from:<user> filter (handle without @). Empty = any. */
  fromUser: string;
  /** to:<user> filter. Empty = any. */
  toUser: string;
  /** min_faves threshold (0 = no filter). */
  minFaves: number;
  /** min_retweets threshold (0 = no filter). */
  minRetweets: number;
  /** min_replies threshold (0 = no filter). */
  minReplies: number;
  /** since:YYYY-MM-DD (inclusive). Empty = no lower bound. */
  since: string;
  /** until:YYYY-MM-DD (exclusive, per X semantics). Empty = no upper bound. */
  until: string;
  /** Which timeline tab to scrape. */
  product: XSearchProduct;
}

/** Build an empty query with sane defaults. */
export function emptyQuery(lang = 'ja', product: XSearchProduct = 'Latest'): XSearchQuery {
  return {
    allTerms: [],
    anyTerms: [],
    noneTerms: [],
    lang,
    fromUser: '',
    toUser: '',
    minFaves: 0,
    minRetweets: 0,
    minReplies: 0,
    since: '',
    until: '',
    product,
  };
}

/** One page of scrape results plus the cursor needed to fetch the next page. */
export interface XScrapeResult {
  tweets: XTweet[];
  /** Bottom cursor for pagination, or null if no further page. */
  cursor: string | null;
}

/** Serialized corpus persisted in the plugin data blob (`_xCorpus`). */
export interface XCorpusData {
  /** Schema version for forward migration. */
  version: number;
  /** All captured tweets. The bigram index is rebuilt on load, not stored. */
  tweets: XTweet[];
}

/**
 * A named, reusable advanced search — the plugin port of the CLI's
 * phrases.yaml model. `surfaceOr` lists orthographic variants (表記ゆれ:
 * comma presence, long vowels, kanji/kana) that are searched individually; any
 * tweet matching a variant is tagged with this query's `id` in its
 * `matchedQueries`. Co-occurrence = a tweet carrying ≥2 distinct ids.
 */
export interface SavedQuery {
  id: string;
  label: string;
  /** OR-matched surface variants searched and tagged under this id. */
  surfaceOr: string[];
  /** Optional per-query language filter (falls back to defaultLang). */
  lang?: string;
  /** Optional per-query min_faves floor. */
  minFaves?: number;
}

/** Auth + defaults for the X scraper. Lives at PluginSettings.x. */
export interface XSettings {
  /** Master switch — when false, the view is offline-corpus only. */
  enabled: boolean;
  /** auth_token cookie from a logged-in x.com session. */
  authToken: string;
  /** ct0 cookie (also sent as the x-csrf-token header). */
  csrfToken: string;
  /** Public web bearer token. Overridable in case X rotates it. */
  bearerToken: string;
  /** GraphQL queryId for the SearchTimeline operation. Overridable. */
  searchQueryId: string;
  /**
   * JSON string of GraphQL feature flags. X rejects requests that omit
   * required flags (the error lists them), so this is user-overridable.
   */
  featuresJson: string;
  /** Default language filter for new searches. */
  defaultLang: string;
  /** Default timeline tab. */
  defaultProduct: XSearchProduct;
  /** How many tweets to request per scrape page. */
  resultLimit: number;
  /** Vault folder where tweets are exported as notes (auto-indexed by the plugin). */
  exportFolder: string;
  /**
   * Vault folder holding user "collections" — ordinary markdown files
   * (Philosophy.md, Lifting.md, …) that tweets/collocations are appended to as
   * `[!x-tweet]` callout blocks. The sidebar saves INTO these real files.
   */
  collectionsFolder: string;
  /** Path of the most recently used collection file (quick re-save target). */
  lastCollection: string;
  /** Named reusable advanced searches (the phrases.yaml model). */
  savedQueries: SavedQuery[];
  /**
   * iOS only: the Scriptable script name the mobile co-occurrence lookup invokes
   * (the WebView-based capture that sidesteps X's request signing). See
   * `mobile-capture.ts`.
   */
  scriptableScriptName: string;
  /** iOS only: max co-occurring tweets to bring back per mobile lookup. */
  mobileCaptureMax: number;
}

/**
 * Public web-app bearer token. This is the same static token x.com ships in
 * its own JS bundle (not a personal secret); it authorizes guest/cookie
 * GraphQL calls. Overridable in settings in case X rotates it.
 */
export const DEFAULT_X_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

/**
 * Known SearchTimeline GraphQL operation id. X changes these periodically when
 * it ships new bundles; if search starts 404ing, grab the current id from a
 * browser devtools "SearchTimeline" request and paste it in settings.
 */
export const DEFAULT_X_SEARCH_QUERY_ID = 'MJpyQGqgklrVl_0X9gNy3A';

/**
 * Feature-flag blob X's GraphQL gateway requires. Missing flags produce a
 * "following features cannot be null" error that names them, so this is
 * user-overridable from settings. This set tracks a late-2025 web bundle.
 */
export const DEFAULT_X_FEATURES: Record<string, boolean> = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: false,
  responsive_web_grok_share_attachment_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

export const DEFAULT_X_SETTINGS: XSettings = {
  enabled: false,
  authToken: '',
  csrfToken: '',
  bearerToken: DEFAULT_X_BEARER,
  searchQueryId: DEFAULT_X_SEARCH_QUERY_ID,
  featuresJson: JSON.stringify(DEFAULT_X_FEATURES),
  defaultLang: 'ja',
  defaultProduct: 'Latest',
  resultLimit: 40,
  exportFolder: 'X Tweets',
  collectionsFolder: 'JP Collections',
  lastCollection: '',
  scriptableScriptName: 'JP-X-Cooc',
  mobileCaptureMax: 40,
  // Seeded from the CLI's phrases.yaml so the named-query feature is discoverable.
  savedQueries: [
    { id: 'mou-yahari', label: 'もうやはり（聴き手予期の召喚）', surfaceOr: ['もうやはり', 'もう、やはり'] },
    { id: 'tte-iuno-wa', label: 'っていうのは（視点ステージ導入）', surfaceOr: ['っていうのは', 'ていうのは', 'というのは'] },
  ],
};
