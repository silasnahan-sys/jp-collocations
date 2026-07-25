# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

An Obsidian community plugin: a searchable Japanese collocation lexicon that has grown into a broader Japanese-text analysis toolkit (collocations, a Yomitan-style dictionary, discourse-pattern detection, and SRS card generation). Ships as a single bundled `main.js` + `manifest.json` + `styles.css` dropped into a vault's `.obsidian/plugins/jp-collocations/`. Targets desktop **and** mobile (`isDesktopOnly: false`), so indexing code is deliberately batched/idle-scheduled to stay phone-friendly.

## Commands

```bash
npm install
npm run build   # tsc --noEmit type-check (skipLibCheck) then esbuild production bundle -> main.js
npm run dev     # esbuild watch mode (no type-check), inline sourcemaps
npm run lint    # eslint src --ext .ts
```

There is **no test runner**. The many `_tmp_*.mjs` / `_tmp_*` files at the repo root are untracked ad-hoc analysis/diagnostic scripts (run directly with `node`), not a test suite — do not treat them as one or assume they pass.

## "Seamless integration" — read this before designing anything

This phrase has a specific, non-obvious meaning in this project and **cannot be
deduced from the code**. It is defined twice, and you must read both:

- **DESIGN §26.0** — the five screen properties + the gimmick test (a feature
  that doesn't lower the step/glance count between intention and result is
  rejected, however well it demos).
- **DESIGN §28** — the whole-system version, which is the governing one. The
  plugin is one chain — *encounter → mark → reconcile → classify → attest →
  index → retrieve → drill → produce* — and a **seam is any point where a
  noticing loses identity, provenance, provisionality, or reachability crossing
  a subsystem boundary.** Six invariants (S1–S6) with falsifiable tests.

Two consequences that catch agents out:

1. **The 6-class taxonomy (`notes/note-types.ts`) is a visual grammar, not a
   data enum.** Its colors are RESERVED — no non-taxonomy element may use them.
   Everything class-colored routes through `ui/class-grammar.ts`
   (`classColor` / `applyClassRail` / `classDot` / `classBadge` / `classChips`);
   never re-inline `NOTE_TYPES[c].color`, and never build a second class picker.
   `golden/class-grammar.mjs` pins this.
2. **The machine is a recall machine; the hand is the classifier.** Anything
   machine-produced is `status:'suggested'`, must *look* provisional, and must be
   ratifiable in place. Never claim machine output is correct — see
   DESIGN §12 and the sweep-precision rule.

## Build & module conventions

- Bundled by `esbuild.config.mjs` from the single entry point `src/main.ts`. `obsidian`, `electron`, and all `@codemirror/*` / `@lezer/*` packages are marked **external** (provided by the Obsidian runtime) — never bundle them.
- `tsconfig.json` uses `allowImportingTsExtensions` + `verbatimModuleSyntax`. Imports therefore **include the `.ts` extension** in some files (e.g. `from "../types.ts"`) and `import type` must be used for type-only imports. Match the style of the file you edit.
- Type errors only surface in `npm run build`, not `npm run dev`. Run the build before considering a change done.

## Architecture

`main.ts` (`JPCollocationsPlugin`) wires everything in `onload()`: it constructs the data stores, registers two sidebar views, the settings tab, ~20 commands, two ribbon icons, an editor CodeMirror extension, and a reading-mode markdown post-processor.

Four data/logic layers, all owned by the plugin instance:

- **`CollocationStore`** (`data/`) — the classic lexicon. Persists to a JSON file under the plugin dir (`dataFilePath`), seeds from `data/seed-data.ts` on first load, maintains inverted indexes (by headword/POS/pattern/tag). `SearchEngine` (`search/`) queries it with Japanese-aware fuzzy + grammar-expanded matching (`utils/japanese.ts`, `utils/grammar.ts`).
- **`DictionaryStore`** (`dictionary/`) — imported Yomitan dictionaries; backs `DictionaryView`.
- **`SurferBridge`** (`surfer-bridge.ts`) — owns discourse analysis and "surfer-originated" entries. Aggregates the `discourse/` engines (pattern detection, inverted index, KWIC concordance, co-occurrence constellations, variation trees, cooperation templates) and the sidecar system. Persisted inside the plugin's `loadData()`/`saveData()` blob under `_surferBridge`.
- **`ContextEngine`** (`context/`) — read-only aggregator ("hivemind") that joins all of the above for a given word/pattern to produce unified context cards. Holds no state of its own.

State persistence is split: `CollocationStore` writes its own JSON file; everything else (`_surferBridge`, `_dictStore`, settings) is merged into Obsidian's single plugin-data blob via `loadData`/`saveData` — preserve sibling keys when writing (note the `{ ...existing, _key: data }` spread pattern).

### Plugin-to-plugin API

`main.ts` exposes a large public method surface (`analyzeText`, `findCollocationsInText`, `searchKWIC`, `generatePhraseCard`, etc.) intended to be called by a separate **`jp-sentence-surfer`** plugin via `app.plugins.plugins['jp-collocations'].method(...)`. These are an external contract, not dead code — don't remove them just because nothing in this repo calls them.

### Resolver injection

A single sidecar-aware `RelationsResolver` (`makeRelationsResolver`) is built in `onload()` and pushed into the editor decorations, card generator, grammar-set engine, reading-mode highlighter, and collocation view via `setXxxResolver(...)` setters. This is how the discourse subsystem shares one source of truth; if you add a consumer of relations, inject the same resolver rather than building a new one.

### `discourse/` subsystem (caveats)

This is the largest and least-mature area. Per prior analysis: the discourse pattern matcher is largely **naive substring matching** (it over-fires), the dictionary has **no deinflection**, and transcript speaker detection over-segments. A meaningful fraction of the subsystem (parts of the citation L1–L5 pipeline and rhetorical-construction modules, plus some duplicate SRS files — note both `chunk-extractor.ts`/`ChunkExtractor.ts` and `card-generator.ts`/`CardGenerator.ts` exist) is **unreachable dead code**. Before extending or relying on any `discourse/` module, verify it's actually reached from `main.ts` → `SurferBridge`/`ContextEngine`, and prefer the lower-cased file in a duplicate pair (those are the ones imported).

### `src/x/` — X (Twitter) advanced-search dictionary

A self-contained subsystem (modelled on `dictionary/`) that scrapes X's internal GraphQL `SearchTimeline` and caches results into a growing, offline-searchable corpus:

- **`XClient`** (`x/XClient.ts`) — the *only* file that knows X's quirks (auth, GraphQL shape, feature flags). Authenticates with the user's session cookies (`auth_token` + `ct0`) + the public web bearer token, via Obsidian `requestUrl` (works on mobile). `bearerToken` / `searchQueryId` / `featuresJson` are user-overridable in settings because X rotates them; auth/parse errors are surfaced verbatim. Upper layers depend only on the stable `XTweet` schema.
- **`XCorpusStore`** (`x/XCorpusStore.ts`) — persistent tweet corpus (`_xCorpus` in the plugin-data blob) with a character-bigram inverted index for fast exact-substring **co-occurrence** search (the headline feature: "tweets with BOTH 以前の AND でさえ"). Rebuilds the index on load. Imports/exports the companion CLI's JSONL schema (`likeCount`/`matchedQueries`/ISO `createdAt`).
- **`query-builder.ts`** — quote-aware term parsing + `buildRawQuery` (turns structured intent into X advanced-search syntax: `"以前の" "でさえ" lang:ja min_faves:5`). The same `XSearchQuery` drives live scrape and offline filter so they agree.
- **`saved-queries.ts`** — the phrases.yaml model: `SavedQuery {id,label,surfaceOr[]}` (in `settings.x.savedQueries`, seeded with two examples). `runSavedQuery` fetches each surface variant individually and tags resulting tweets with the query id in `matchedQueries`; cross-query co-occurrence (`tweetsMatchingQueries(ids, 2)`) is "a tweet that hit ≥2 saved queries" — the bundle's ★ feature. Also `extractTweetId`.
- **`export-notes.ts`** — writes tweets as vault Markdown notes with bundle-compatible frontmatter (`tweet_id`/`author`/`matched_queries`/`like`/…) into `settings.x.exportFolder`, so the plugin's own indexer re-ingests them (closes the loop).
- **`XSearchView`** (`ui/XSearchView.ts`, view type `jp-x-search-view`) — monokakido-style, mobile-first. Instant local search as-you-type; live scrape on Enter/検索 then merge; sort (latest/likes/RT); tweet cards carry **discourse-pattern pills** (`detectPatterns`), a ★ co-occurrence badge, and save/copy/insert/→note/open actions. In-view modals: cookies (`🔑`), corpus JSONL import-export + bulk note export (`⤓`), saved-queries manager + co-occurrence view (`📑`), and add-tweet-by-URL (`🔗`, via the no-auth syndication endpoint `XClient.fetchTweetById`).

`ContextEngine` takes the corpus and contributes X usage examples (`source: 'x'`) to every `ContextCard`, rendered as an "𝕏 用例" section in the dictionary's context panel — so looking up a word shows real tweet usage with its own pattern pills. Wired in `main.ts` (`makeXDeps`/`openXView`, xCorpus built before ContextEngine), with a settings section, ribbon icon, and `open-x-search` / `x-search-selection` commands. Saving a picked phrase routes through `addEntryFromSurfer` with the tweet as the example sentence.

**Design lineage:** the reference implementation is the CLI in `_tmp_pipeline/twitter/` (also vendored at the sibling `jp_collocations_complete_bundle/`). It uses `twscrape` (a Python cookie-pool subprocess) — fine for Node CLI, impossible in a mobile plugin — so the plugin reimplements the transport as cookie-auth GraphQL while keeping the CLI's concepts: isolation boundary, exact-phrase quoting, per-tweet `matchedQueries` provenance, and co-occurrence = a tweet matching ≥2 query terms. The JSONL interop lets the plugin and CLI share corpora. Not yet ported: the CLI's `morph_pattern` "true-hit" morphological filtering (depends on the Node morphology module).

### Out of tree

`otherlogic/` and the sibling `jp_collocations_complete_bundle/` are separate vendored sub-projects with their own `node_modules`/READMEs — not part of this plugin's build. Ignore unless explicitly asked. The `_tmp_*` files/dirs at repo root are untracked scratch.
