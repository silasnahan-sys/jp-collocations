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

## The HOLE — read this before touching 願い, frames, or the sweep

This is the concept most often flattened into something conventional, and doing
so quietly removes the reason the project exists. Source: **DESIGN §27.0.2**
(and §27.0.1, which it corrects). Both are short. Read them.

A hole is **negative space that is held open on purpose**. It is not a TODO, not
a coverage gap, not a missing feature, not an empty state to fill with a
placeholder. §27.0.2's exact words: *"The HOLES are as real as the nodes, and
more alive."*

The governing case is the donor essay's: the user wanted to say **"at some
point"**, found no phrase that captured it, carried the want around
un-externalized, and later *heard* a podcaster say **どっかのタイミングで** and
recognized it instantly. Three things about that story are load-bearing:

- **The WANT came first**, before any surface existed to look up.
- **The finding came by hearing**, not by searching.
- **The event was the COLLISION** — not the entry, not the storage.

### The same shape at three scales

Once you see it, it is everywhere in this codebase, and they are one idea:

| scale | the hole | where |
|---|---|---|
| a meaning you cannot yet say | a **Reach** — a felt want in your own words | `notes/reach.ts`, `ReachModal`, `open-reach` |
| an utterance with its word taken out | a **frame** — `gapFrame(sentence, word)`; **the key IS the absence** | `dictionary/frames.ts`, `BigDictStore.frame()` |
| a phrase you are rebuilding from memory | a **cloze blank** (穴埋め) | `SelectionModes` `'blank'`, `generatePhraseInContextCard` |

**This is what makes the plugin unconventional, in one sentence: every other
dictionary is entered by a string you have; all three of these are entered by
something you don't have.** The unit of study is a hole, not an item.
`BigDictStore.frame()` is called "THE REACH-FOR QUERY" for that reason — you
hand it a shape with a gap and it returns what other people put in the gap.

### The four rules, and how each gets broken

1. **The machine never fills a hole; it OFFERS.** Every offer carries a `why`
   that states its own weak, skeletal reason (*"shares a written token"*), never
   *"this means that"*. Only the user's felt recognition fills it.
   → *Broken by:* ranking offers into a verdict, auto-filling a best match,
   or writing a `why` that asserts equivalence. `golden/reach.mjs` pins this.
2. **Juxtapose, don't tell.** §27.0.2: *never print "逆に = actually", set the
   scenes side by side and let the flash happen.* The 似ている表現 box (§26.2) is
   this move; so is the cross-lingual case.
   → *Broken by:* adding a translation field, a gloss row, or an "equivalent".
3. **A filled hole stays visible.** `recognize()` sets `filled` and keeps the
   reach and every offer. The trace of how you came to it is the record —
   deleting on fill throws away the only evidence the collision happened.
   → *Broken by:* treating `filled` as "done" and hiding or removing the row.
4. **Success is not coverage — it is how often the artifact makes another flash
   happen.** A hole is not progress toward being closed.
   → *Broken by:* any metric of the form "N% of reaches answered", and by the
   volume-is-not-evidence failure generally (§28 gimmick test).

### The corollary that keeps getting missed

**A hole is starved by anything that shrinks the incoming attested stream**,
because a collision needs arrivals to collide with. So bugs that look like
plumbing are hole bugs — all three of these were, and all three are fixed
(2026-08-01):

- `attestationKey` dropped the quote, capping every untimed source at ONE
  sighting. Fewer arrivals, fewer collisions.
- `watchReaches` was called from **`sweepCatalog` only** — the full sweep the
  audit established nobody runs — so an open 願い sat for weeks while captures
  landed past it daily. Now also called from `autoSweepAfterCapture`, i.e. on
  arrival, via `incomingFrom()`.
- The `frame` offer reason was **unreachable**: no caller supplied `frameKey`,
  and the test was `frameKey.includes(gloss)` (prose against a slotted Japanese
  shape — false in every real case). `incomingFrom()` now derives a frameKey
  from 💠/🟠 payloads through `toFrame`, and `collide` compares frame keys in
  that one key space. `golden/reach.mjs` pins it — the branch was dead because
  it was the only one never tested.

## Build & module conventions

- Bundled by `esbuild.config.mjs` from the single entry point `src/main.ts`. `obsidian`, `electron`, and all `@codemirror/*` / `@lezer/*` packages are marked **external** (provided by the Obsidian runtime) — never bundle them.
- `tsconfig.json` uses `allowImportingTsExtensions` + `verbatimModuleSyntax`. Imports therefore **include the `.ts` extension** in some files (e.g. `from "../types.ts"`) and `import type` must be used for type-only imports. Match the style of the file you edit.
- Type errors only surface in `npm run build`, not `npm run dev`. Run the build before considering a change done.

## Architecture

`main.ts` (`JPCollocationsPlugin`, ~6,100 lines) wires everything in `onload()`: it constructs the data stores, registers **9 views**, the settings tab, **68 commands**, ONE ribbon icon (it opens the tray; right-click is the whole-surface menu), two `obsidian://` protocol handlers, two status-bar items, an editor CodeMirror extension, and a reading-mode markdown post-processor.

Four data/logic layers, all owned by the plugin instance:

- **`CollocationStore`** (`data/`) — the classic lexicon. Persists to a JSON file under the plugin dir (`dataFilePath`), seeds from `data/seed-data.ts` on first load, maintains inverted indexes (by headword/POS/pattern/tag). `SearchEngine` (`search/`) queries it with Japanese-aware fuzzy + grammar-expanded matching (`utils/japanese.ts`, `utils/grammar.ts`).
- **`DictionaryStore`** (`dictionary/`) — imported Yomitan dictionaries; backs `DictionaryView`.
- **`SurferBridge`** (`surfer-bridge.ts`) — owns discourse analysis and "surfer-originated" entries. Aggregates the `discourse/` engines (pattern detection, inverted index, KWIC concordance, co-occurrence constellations, variation trees, cooperation templates) and the sidecar system. Persisted inside the plugin's `loadData()`/`saveData()` blob under `_surferBridge`.
- **`ContextEngine`** (`context/`) — read-only aggregator ("hivemind") that joins all of the above for a given word/pattern to produce unified context cards. Holds no state of its own.

State persistence is split: `CollocationStore` writes its own JSON file; everything else (`_surferBridge`, `_dictStore`, settings) is merged into Obsidian's single plugin-data blob via `loadData`/`saveData` — preserve sibling keys when writing (note the `{ ...existing, _key: data }` spread pattern).

### Plugin-to-plugin API

`main.ts` exposes a large public method surface (`analyzeText`, `findCollocationsInText`, `searchKWIC`, `generatePhraseCard`, etc.) intended to be called by a separate **`jp-sentence-surfer`** plugin via `app.plugins.plugins['jp-collocations'].method(...)`. These are an external contract, not dead code — don't remove them just because nothing in this repo calls them.

### Four invariants fixed 2026-08-01 — each was silent, each has a golden

Full writeup: `AUDIT-PARTS-2026-08-01.md`. Each of these failed with **no error
and no empty state**, which is why they survived three audits. If you change
code near one, run its golden.

1. **The engine LOCATES; the catalogue ANNOTATES — keep them joined.**
   `accurate-patterns.ts` synthesizes a `DiscoursePatternDef` per engine
   operator. It used to hard-code `register:'any'`, `position:'any'`,
   `frequencyTier:2`, `coOccurrence:[]`, and since `detectPatternsAccurate`
   emits only those defs, all 515 hand-authored defs became unreachable and
   `estimateRegister({any:N})` returned **`普通体` for every text in the plugin** —
   every SRS card body, every `…/register/…` tag, every context card.
   Now `annotate()` inherits those four fields from the def matching **the
   surface that actually fired** (not the operator: CONCESSIVE-CONTRAST is
   formal as しかし and casual as でも). 57/126 operators inherit; the constants
   remain only as the fallback. → `golden/patterns.mjs`
2. **`attestationKey` includes the quote.** It was `file|tStartSec|source`.
   Prose and tweets have no `tStartSec`, so every sighting in one Kindle note or
   one long-form post collapsed to one key and `upsertEntry` silently dropped the
   rest — a book with 40 sightings stored ONE. `legacyAttestationKey` +
   `isRejected()` keep pre-existing ✕ rejections working; never write the legacy
   form. → `golden/patternstore.mjs`
3. **`BigDictStore.lookup` deinflects.** A sharded store is exact-match by
   construction, so the 35 converted books were reachable only from the citation
   form. Fallback runs only on a miss, candidates are sorted by (trail length,
   **term length** — `deinflect` overgenerates and the right answer is the
   shortest, not the first), capped at `MAX_DEINFLECT_CANDIDATES`, and
   `lookupKeys` groups by shard so N candidates cost N *unique* shard reads.
   Hits carry `deinflection` for the 〈…〉 badge. → `golden/big-dict.mjs`
4. **A sidecar has THREE shard families, and the third is optional.**
   `head-NNN` (headword) / `frame-NNN` (Japanese shape) / `intent-NNN` (the
   English — §27.2's meaning side). All three key through the SAME
   normalization: `intentionKeyOf` is `normalizeFrame`, so a want and the row
   filed under it cannot drift apart. `meta.intents` absent means "never built"
   and must never be read as damage — `verifySidecar` reports it as
   `noIntentIndex` and `BigDictStore.intention()` skips those books in silence
   rather than returning an empty answer. Building it needs no re-import:
   `buildIntentIndex` re-keys `StoredCandidate.i`, which every frame row already
   carries. `buildIntentIndex`'s `passes` is a MEMORY knob only — an intention
   key's candidates are scattered across every frame shard, so a single grouping
   pass would hold ~1.8M rows at once; more passes, less peak memory, identical
   output. → `golden/intent-index.mjs`
5. **Verify is not repair.** `repairSidecarMeta` skips any folder whose meta is
   readable, which is exactly the state a half-finished `dropSidecar` leaves —
   so damage that kept its meta was reported as 正常. `dropSidecar` now deletes
   `meta.json` FIRST (an interrupt then leaves something repair can see), and
   `verifyAllSidecars` runs from the repair command. A missing shard file is
   silent everywhere else: `read` → null → `decodeLines` → `[]`.
   → `golden/sidecar-verify.mjs`
6. **The blob is PARTITIONED — a save writes only the keys that changed.**
   Measured 2026-08-06 on the live vault: `data.json` was **15.17 MB**
   (`_patternStore` 11.4 MB of it) and every debounced flush wrote all of it
   twice, bak + main. **~30 MB of IO to record that a checkbox moved** —
   invisible on desktop, seconds of main-thread stall on iPadOS. Every store
   persists through exactly one `setKey(key, …)`, so which key changed is known
   exactly; keys over 64 KB get `part_<key>.json`. Ordinary saves dropped
   **275×**. Rules: partition files are written BEFORE the main file that
   promises them (`_parts` manifest — the dropSidecar lesson, item 5); a listed
   partition that will not read is QUARANTINED, not treated as an empty store,
   and `setKey` on it REJECTS; promotion at 64 KB, demotion at 32 KB so a key
   on the line cannot flip every flush. → `golden/storage.mjs`
7. **`frontmatterSources` is plural, or singular-with-a-wikilink.** The key
   regex was `sources?`, which also matched the medium tag every transcript
   carries (`source: tv`), so the ⚡ gate accepted every transcript and then
   failed at `getFirstLinkpathDest('tv')`. The two cases differ by SHAPE: a
   reference is a `[[wikilink]]`, a medium tag is a bare word. Use
   `frontmatterMedium()` for the latter and `isCaptureNote()` for the test.
   `ensureSourceFrontmatter` now writes the plural list form.
   → `golden/capture-rung.mjs`
8. **Never call `getRightLeaf` for a surface — use `surfaceLeaf()`.** Obsidian's
   right sidebar is a resizable panel on a desktop and a FIXED NARROW DRAWER on
   mobile. Five of the six surfaces mounted there unconditionally, so a 1366px
   iPad rendered the 辞書 in a phone-width column — the whole "shrunk up on
   mobile" complaint, and not the views' fault. `presentation()` decides:
   sidebar only on `desk` at ≥880px, main pane everywhere else.
   The drawer was only tolerable because it kept the editor reachable, and that
   is no longer its job: **`openSurface` is a TOGGLE** over a place-stack
   (`ui/suite-nav.ts`) — press 辞書 to go, press it again to land back on the
   sentence you left with cursor and scroll restored. Revisiting a place
   TRUNCATES the stack rather than pushing, so wandering cannot accumulate.
   Every surface also gets a command, because a command is what a hotkey — and
   therefore an Elecom/Logi button mapped to a keystroke in its own driver —
   can reach; mouse buttons above 4 never arrive at a webview at all, so that
   indirection is the only thing that can work for them.
   → `golden/suite-nav.mjs`
9. **Two fingers are heard; three are not — so every gesture is also a command.**
   A webview receives two-finger pan as `wheel.deltaX` and pinch as `wheel` with
   `ctrlKey`. It receives NOTHING for 3/4-finger swipes (Windows and iPadOS
   consume them) and nothing for mouse buttons above 4. Those are reached by
   binding them to a keystroke in Windows Touchpad → Advanced gestures or in
   Elecom Mouse Assistant / Logi Options+, which then hits an Obsidian command.
   Never add a gesture without its command. The swipe reducer
   (`ui/input-map.ts`) has two non-obvious rules, both load-bearing: a
   vertically-dominant wheel event RESETS the horizontal accumulator (a
   touchpad drifts sideways on every scroll — 600px of one-sided drift must not
   swipe), and a fired swipe LATCHES until the touchpad rests (one flick emits
   dozens of events). → `golden/input-map.mjs`
10. **Posture is re-evaluated on rotation.** `applyPostureClasses()` used to run
   once at load, so turning the iPad left every ergonomic in its launch shape —
   the same once-per-device mistake as `Platform.isPhone`, one layer up. Use
   `watchViewport()`; it debounces (iOS reports stale dimensions *during*
   `orientationchange`, so that is correctness, not throttling) and fires only
   on a real posture/orientation change. Body carries `jp-orient-*`.

11. **Never put a non-passive scroll listener on `document`.** A `wheel` or
   `touchmove` listener registered `{ passive: false }` on `document` declares
   that ANY scroll anywhere might be cancelled, so the browser must run that
   JavaScript before it will scroll — the editor, settings, the file explorer,
   everything loses the compositor fast path, and it is felt as scrolling that
   will not glide. Testing `e.target.closest('…')` inside the handler does not
   help; by then the scroll is already blocked. Bind to OUR panes instead
   (`layout-change` + a `WeakSet`), and only in `desk` posture — a finger never
   emits `wheel`. Same rule for `touch-action: none`: it takes BOTH axes, so a
   row that only draws horizontally must say `pan-y` or it eats the page's
   scroll.

12. **`draggable` goes on a grip, never on a body you would want to read.**
   `draggable="true"` revokes text selection inside the element it is set on,
   and a selection and a drag both open as press-then-move, so no element can
   serve both — whichever the browser claims, the other is gone. On any row
   whose body is words (a 用例, a mark, a tray card, an entry), selection is
   worth more. Pass `makeDraggable(row, payload, { grip })`: the attribute and
   both drag paths bind to the grip, the row still dims while its copy is in
   the air. Use the head where one exists (辞書 `headerRow`, 𝕏 `head`, 語彙
   `.jp-lex-row-top`), otherwise `.jp-lex-exgrip`.

13. **A selection answers AND acts, in place — never a trip.** The plugin had
   both halves of a lookup and neither was whole: `HoverPeek` gave the meaning
   but carried no verbs, refused touch outright, and lived on two surfaces;
   `selection-echo` gave the verbs but never said what the phrase meant. Either
   way the loop closed somewhere else, and *that trip* is the whole cost of
   looking something up mid-video. They are now one card: `SelectionEchoDeps`
   takes `look` (text → `PeekData`, off the shelf) and `open` (the way into the
   full entry), rendered as a head above the verb row. Wire it once through
   `ViewChrome.lookUp`/`openWord` — per-surface lookup would let two surfaces
   disagree about what a word means. Selection, not hover, is the arming
   gesture: it is the only one a Pencil, a finger, a trackpad and a keyboard
   all produce, and on the phone (video + PiP + なりきり) hover does not exist.
   Every surface is armed, **including 辞書** — the note that used to exclude it
   ("it already answers a selection with `offerCapture`") was simply wrong:
   `offerCapture` hangs off an explicit ⚡ button in `entry-grammar.ts`
   (`b.onclick`), never off a selection, so the one surface whose job is
   answering "what does this mean" could not answer it about a word inside its
   own glosses. The two cover different gestures and do not collide.

14. **A plugin surface must opt back INTO text selection.** Obsidian sets
   `user-select: none` on the app shell and re-enables it only for the editor
   and the preview, so everything a plugin renders inherits `none`. This
   stylesheet knew it and opted back in at five elements out of hundreds —
   which meant that on the iPad most plugin content could not be selected at
   all, and by rule 13 that disarms the entire lookup layer on the device it
   was designed for. The opt-in is now stated once per view root and inherits;
   the opt-outs are chrome you press rather than read. Scope every such rule to
   a `.jp-*` root — a bare `button { user-select: none }` reaches Obsidian's own
   ribbon and settings.

15. **The dock asks two questions: is this control an ICON, or does it need
   WIDTH?** `edgeDock` returns a full-width bottom sheet on a phone and a ~58px
   vertical rail on a tablet. Views posted *everything* into it, so 辞書, 𝕏 and
   語彙 were putting a text input, mode chips and a completions dropdown into
   that rail — reported as 「the search tab … isnt very useable … it COVERS
   stuff」. That is a category error, not a styling miss. Use `edgeDock` for
   fingertip-sized controls and `wideDock` for query boxes, chip rows and
   lists; on a phone both return the same element, so nothing stacks.

16. **An overlay must be movable and dismissible, or it is an obstruction.**
   The tablet rail is the only dock that floats over content, and it was pinned
   at `top: 50%` — the vertical middle, which is where the line you are reading
   is. `floating-rail.ts` gives it a grip: drag to move (compositor-only
   `transform` during the gesture; changing `top` per frame relayouts the pane
   and *is* the stutter), snap to the nearer edge on release, tap to fold it to
   a puck. Position is stored as `{edge, y-as-a-FRACTION}` — an iPad rotates and
   resizes, and a pixel offset puts the control the user placed off-screen the
   first time it does.

17. **Nothing about a file changes because you looked at a different pane.**
   `active-leaf-change` fires for plugin-to-plugin tab switches, and
   `getActiveFile()` keeps returning the last markdown file, so every tab switch
   re-ran `detectPatterns` over that whole note, rebuilt both indexes, re-read
   the sidecar and scheduled a write — the felt "lag between tabs". Guard on
   `(path, mtime)`. Related: keep derived per-file data in a `Map` keyed by
   path, never an append-only array — `_utteranceCache.push()` meant a
   re-indexed file was counted twice (then five times, then forty) in the
   constellation, and a deleted file could never stop voting.

### Corpus adapters (`scraper/`) — the 語法プロフィール, §22.7

Two sources feed the one frozen `payload.goho`. Both are **enrichment**: one
user-initiated word at a time, fetched once, frozen (`§2.4` — a later site change
cannot alter past entries). Neither crawls. Parsing is pure and fixture-tested;
only the transport touches the network.

- **NINJAL-LWP for TWC** (`TsukubaWebCorpusScraper.ts` + `twc-parse.ts`,
  `golden/twc.mjs`) — preferred when `twcEnabled`. Four POST endpoints:
  `/headwordlist_all/` (a jqGrid `filters` rule resolves 風 in ONE request —
  never walk the 5,028 pages), `/patternfreqorder/<hwId>/` (every way the word
  attaches, with freq + share; 87 for 走る), `/collocation/<hwId>.<patId>/`
  (that way's collocates with freq / MI / logDice), and
  `/example/<hwId>.<patId>.<rank>/` (attested sentences, each with its document
  title AND url). The pattern ids from `/patternfreqorder/` are the complete
  enumeration — they include the `C###` group ids and all of them key the
  collocation endpoint. **The example endpoint's body field is
  `headword_collocation_id`, not `collocation_id`** despite taking a collocation
  id — from `loadExample` in the site's own JS.

  Two traps in the example layer. Identity is verified on **`records` == the
  collocate's `freq`** (exact across three orders of magnitude), *not* on the
  highlighted text: the collocation list is lemmatised while sentences are
  surface, so 「子供の風」 is really attested as 「子どものかぜ」 and string
  matching would reject correct data. And `bold_start`/`bold_end` are the
  corpus's own [start, end) offsets into the sentence — use them, don't search.

  **Homographs are not collapsed.** 風 is two words here: 形容動詞 フウ (80,779)
  and 名詞 カゼ (322). `resolve()` returns both ranked by the corpus's own
  frequency, `profile()` takes the top one and hands back `alternates`, which
  become facet buttons. Do not "fix" this by preferring 名詞 — that would be
  overriding measured data with a guess.
- **Hyogen** (`HyogenScraper.ts` + `hyogen-parse.ts`, `golden/hyogen.mjs`) —
  fallback, and the only source with 青空文庫 example phrases.

**The method must be POST.** This is the entire difference and it is the reason
TWC produced nothing for years. `GET /collocation/N.25644.J001/` with identical
parameters returns **HTTP 200 with well-formed JSON** — the global first page of
a 43-million-row table, every row belonging to こと, for every word you ask
about. There is no error, no empty result, and no signal of any kind. Measured
2026-08-02: no cookie, no CSRF token and no extra headers are needed (`GET /`
sets no cookie and the pages carry no `csrfmiddlewaretoken`), so do not add a
handshake — POST alone is load-bearing. `parseCollocates` re-checks
`headword_collocation_id` on every row so this lie cannot reach the store again;
`golden/twc.mjs` keeps the real bad response as a fixture.

Two more measured facts worth not rediscovering: the site **403s on bursts**
("temporarily unavailable"), so every request is spaced by `rateLimit` — and the
collocation grid **sorts globally across pages**, so `rows=100` really does give
the true top 100 by frequency rather than an arbitrary page re-sorted.

Envelope metadata is junk and nothing trusts it: the pattern response says
`"total": 0, "records": 1` for every word, and the collocation response's `total`
is a **page** count. Counts are what was actually returned; `GohoFrame.atLeast`
marks a total that is only a floor, so "24 / 1,000+件" never renders as a
confident 1,000.

### Resolver injection

A single sidecar-aware `RelationsResolver` (`makeRelationsResolver`) is built in `onload()` and pushed into the editor decorations, card generator, grammar-set engine, reading-mode highlighter, and collocation view via `setXxxResolver(...)` setters. This is how the discourse subsystem shares one source of truth; if you add a consumer of relations, inject the same resolver rather than building a new one.

### `discourse/` subsystem (caveats)

This is the largest and least-mature area. **The three caveats that used to be
here are out of date and were sending agents to re-fix fixed things** — the
substring matcher was replaced (PARSER-AUDIT Phase 2), `DictionaryStore` and now
`BigDictStore` both deinflect, and the duplicate cased files
(`ChunkExtractor.ts` / `CardGenerator.ts`) no longer exist. Dead code is also
not this subsystem's problem: measured 2026-08-01, **191 of 192 modules are
reachable** from `src/main.ts` (only `discourse/calculus/handmarks.mjs` is
orphaned). What is true today:

- **`detectPatterns` is one line**: `return detectPatternsAccurate(text)`
  (`discourse-grammar.ts`). The engine (`discourse/engine/`, 39 `.mjs`, ~11k LOC,
  126 operators) LOCATES; `discourse-patterns.ts` (515 hand-authored defs)
  ANNOTATES. **These two must stay joined** — see the §1 warning below.
- `detectPatternsLegacy` still exists and still runs: `analyzeUtterance` uses it
  for `detectLogicalFlows`. Both matchers execute on every utterance.
- Measured coverage on 4,937 sentences of real conversation: **97 of 126
  operators ever fire; 7 produce 50% of all hits.** `TOPIC-PRESENT` (「って」)
  alone is 21.6%, and ~25% of those are verb te-forms (思って/持って/取って)
  because `scope:'after-noun'` is implemented as "the previous character is
  Japanese" (`match.mjs` `isAfterKanjiOrKatakana`). Only 20 of 576 triggers carry
  any lexical guard. **Do not quote the operator count as a capability.**
- Speaker attribution is still text-guessed (`R4:floor-continues` decides 94% of
  turns); `components.ts` is wired to `DiscourseModeView` as suggestion pills but
  **not** under the calculus, and its `_componentGold` has no reader and no
  exporter.

Before extending any `discourse/` module, check what actually reaches it —
`scoreboard.mjs`/`moves.mjs` are used only by `FollowAlongView`, `concordance.mjs`
only by `main.ts`, and `engine.ts`'s `analyzeDiscourse` only by a health probe.

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
