# HANDOFF — remaining DESIGN §25 + §26 items (written 2026-07-19 for a successor model)

Read DESIGN.md §25 and **§26** first (the contracts), then this file (the
execution spec). CLAUDE.md has build/module conventions. The auto-memory
index summarizes everything else. This file exists so the remaining work is
mechanical.

## Item 0 — THE MONOKAKIDO REALIZATION (§26) — highest priority, read this first

Previous agents failed this by carbon-copying features. The user's words:
"seamless integration should be defined in all concrete and theoretical
ways… don't do gimmicky shit, real innovation." DESIGN §26 now contains
the full contract: §26.0 defines seamlessness (5 properties + 5
operational tests + the gimmick hard-rejection), §26.1 the frame-by-frame
grammar, §26.2 the application to OUR objects, §26.3 per-platform verbs,
§26.4 the build order.

**MANDATORY before writing any code: Read the six reference stills in
`_ref_monokakido/` (f01, f12, f18, f25, f32, f40)** — they are frames from
the user's own recording of ACE CROWN 4 (Monokakido iOS) and are the
ground truth for the grammar. Do not work from your training-data idea of
Monokakido. If you need more frames, the recipe:
`ffmpeg -i "C:/Users/silas/Documents/vibecode/videos/ScreenRecording_07-15-2026 18-17-42_1.mp4" -vf "fps=1,scale=-2:1000" out/f%02d.png`.

Execution notes per §26.4 step (files are the anchors, §26 is the spec):

1. **Grammar tokens**: one CSS block at the top of the plugin section of
   `styles.css` defining `--jpc-sem-headword`, `--jpc-sem-example`,
   `--jpc-sem-idiom`, `--jpc-sem-warn`, `--jpc-box-banner`,
   `--jpc-badge-box` (+ the six §7 class colors that already exist as
   rails). Then migrate `LexiconPanel.ts` detail + `DictionaryView.ts` +
   `ContextWindow.ts` styles to consume them. NO new colors anywhere
   after this — that is the point.
2. **Knowledge boxes**: one helper (suggest `src/ui/knowledge-box.ts`,
   `renderKnowledgeBox(host, { title, tone: 'goho'|'gen'|'naze'|'warn'|'family' })`
   returning the body element). Wire: 語法 block (LexiconPanel, exists) →
   box; scaffold 生成 rows → box; §23 readings on 🔴 entries → box; the
   ❗ personal box sources from `ReconLibrary` corrections (homophone/
   kanji-swap records) + `rejectedAtts` for the entry — both already
   persisted, grep `corrections` in `src/notes/recon-library.ts` and
   `rejectedAtts` in `src/notes/pattern-store.ts`. The 🟢 family box:
   `PatternStore` entries share `payload.gestureFamily` — compose members
   + their `gestureName`s. Every box must cite real stored data; empty →
   box absent (no placeholder boxes, gimmick test).
3. **Space-walking**: LexiconPanel detail — neighbor = adjacent row in
   the CURRENT filtered/sorted list (the list already exists in memory);
   render `〈prev | next〉` pills fixed at the panel's bottom corners
   (44px, thumb zone). DictionaryView — adjacent term in the dictionary's
   sorted term index. ≡ = floating pill listing the entry's section
   anchors (scroll-to). ▾ on the headword: if the same normalized surface
   exists in catalog AND dictionary AND/OR corpus (unified-search's
   `linkLegacy` shows the merge precedent), cycle the rendering.
4. **Selection-echo**: `document.addEventListener('selectionchange')`
   scoped to plugin view containers only; banner shows the selection
   enlarged + 検索/🏷️/💭 actions in the thumb zone on mobile. Debounce;
   never render for selections inside the Obsidian editor.
5. **Platform verbs**: phone footer bar — a small helper view-footer
   (`Platform.isMobile`) added to LexiconPanel/DictionaryView/ReviewView/
   TrayView; swipe on the entry header (touchstart/end deltaX >60px) =
   neighbor walk. Pencil hover peek: `pointerover` with
   `e.pointerType === 'pen'` on 飛び込み-tappable words → floating
   preview card (reuse the dictLookup path from §20 飛び込み); feature-
   detect, silently absent without hover support. Desktop mouse hover =
   same preview on `mouseenter` when `!Platform.isMobile`.
6. Ghost transition LAST, and drop it if it janks on the iPad mini.

Acceptance for EVERY §26 change: state which of the §26.0 tests (a)–(e)
it passes, in the commit/DESIGN note. If you cannot name the step it
removes, do not build it.

## Non-negotiable house rules (violating these = a bug, not a style choice)

1. `npm run build` must pass (tsc gate — type errors do NOT show in dev) and
   `node golden/all.mjs --offline` must stay green before anything is "done".
   Build auto-deploys to BOTH `Documents/Lenovo` and `Desktop/Lenovo` vaults.
2. Every pure piece gets golden checks (see `golden/follow.mjs` for the house
   style: `check(name, cond)`, exit code, registered in `golden/all.mjs`).
3. **Shortcuts (iOS) are BANNED from hot paths** — user ratified 2026-07-19.
4. Marks law (§25.1): live phases emit marks, never typing/classification.
   It is a floor for attention-poor postures, not a ceiling.
5. One adapter file per external silo (§2.2), errors surfaced verbatim,
   every stage degrades soft, no silent caps.
6. Secrets are device-local: follow `src/data/blob-migrations.ts` — new
   secrets go through `app.saveLocalStorage`, get scrubbed from settings
   saves, never sync. (`ocrApiKey`, X cookies, YT cookie are the precedents.)
7. Three hands (§23.5): every new interactive surface gets Pencil/touch
   (44px+), keyboard single-key verbs with visible hints, and mouse.
8. Imports inside `src/notes/*` / `src/ui/*` use explicit `.ts` extensions
   (verbatimModuleSyntax); `src/main.ts` uses extensionless — match the file.
9. The user's standard: "seamlessly integrated 100% perfect" — pentimento
   not popups; when unsure of feel, expose a tuning constant, don't guess.

## State as of this handoff (all shipped, all green)

- §25 core: `src/notes/follow.ts` (clock c), `src/notes/speak-session.ts` +
  `_speakSessions`, `src/ui/FollowAlongView.ts` (view `jp-follow-view`, cmd
  `open-follow-along`), mark cards in `src/notes/inbox.ts` (`MarkRef`,
  `markCard`, `sessionGroups`), tray 📷 multi-select + 読書セッション groups +
  🎧 `recognizePlayerShot` (`src/notes/player-shot.ts`), `settings.speak`
  {aspects[6], goalPoints 30} + SettingsTab section. Golden:
  `golden/follow.mjs` (37), `golden/inbox.mjs` (21).
- main.ts helpers to reuse: `resolveMarkContext(mark)` (mark → CaptureContext
  from transcript@tSec), `recognizePlayerShot(card)`, `openFollowAlong(file?)`.

## Item A — Plex clock (b) + clips  [BUILT 2026-07-21 — awaiting user's server URL + token to verify live]

**Status:** shipped to the documented Plex shape. `src/notes/plex.ts` (PURE:
`parsePlexSessions`/`pickPlexSession`/`plexSessionsUrl`/`plexPartUrl`/
`buildPlexClipArgs`/`buildPlexStillArgs`), golden `golden/plex.mjs` (28 checks,
in all.mjs). `settings.plex = {baseUrl, token(secret), clipPreSec, clipPostSec}`
in types.ts; token scrubbed to device-local storage via SECRET_LS_KEYS.plexToken
(blob-migrations.ts). Live poll `JPCollocationsPlugin.fetchPlexSessions()` +
desktop clip cutter `cutPlexClip()` in main.ts. FollowAlongView: 「📺 Plex同期」
header chip (polls 5s → syncClock/pauseClock, session-picked by note title/show,
degrades soft to clock (c)); a tap during Plex-sync is a mark not a resync;
debrief marks gain a 🎬 clip button (cuts audio+still from the still-synced
session's Part into `<transcriptFolder>/_clips`). SettingsTab "Plex / TV 連携"
section + a 接続テスト button (verify field names against the real server).

**Remaining (real-data / refinement, for Fable or a later pass):**
- VERIFY the Plex JSON field names against the user's real `/status/sessions`
  (built to the documented shape; the 接続テスト button is the check).
- Auto-EMBED the cut clip/still into the capture note (today 🎬 cuts + saves to
  `_clips/` and Notices the path; it is not yet attached to the capture).
- Persist the session Part key so clips can be cut when reopening a PAST debrief
  (today clips need the session still live-synced in the open view).

Original spec (for reference):
Goal: FollowAlong syncs itself from the Plex server instead of a manual tap.

1. Settings: add `settings.plex = { baseUrl: string }` in `src/types.ts`
   (+ DEFAULT). The TOKEN is a secret → store via the blob-migrations
   pattern (localStorage key like the X cookies; scrub from settings saves;
   SettingsTab input like `ocrApiKey`'s).
2. New file `src/notes/plex.ts` (the ONLY Plex-aware file):
   - `parsePlexSessions(status: number, body: string)` PURE →
     `{ ok: true; sessions: Array<{ title: string; show?: string; viewOffsetSec: number; paused: boolean }> } | { ok: false; error: string }`.
     Endpoint: `GET {baseUrl}/status/sessions?X-Plex-Token={token}` with
     header `Accept: application/json`. Response shape:
     `MediaContainer.Metadata[]` where `title` = episode, `grandparentTitle`
     = show, `viewOffset` = ms, `Player.state` = 'playing'|'paused'.
     VERIFY field names against the user's real server before trusting this.
   - Fetch via Obsidian `requestUrl` (`throw: false`), same as XClient.
3. FollowAlongView integration: when `settings.plex.baseUrl` is set, header
   gains a 「Plex同期」 toggle chip. On: poll every 5s →
   `this.clock = syncClock(viewOffsetSec, Date.now())`, and if `paused`,
   `pauseClock`. Pick the session whose title fuzzy-matches the open note's
   frontmatter `title`/`show` (reuse `matchEpisodeNote` from
   `src/notes/player-shot.ts` — it's generic over `{title}`), else the only
   session, else Notice the list. Off/error → clock (c) manual sync keeps
   working (degrade soft, error verbatim).
4. Clips at marks (desktop-only, ffmpeg): mark harvest for `medium:'tv'`
   marks can cut audio via ffmpeg reading the Plex part URL directly:
   `{baseUrl}{Media.Part.key}?X-Plex-Token=…` with `-ss {tSec-pre} -t {len}`.
   Reuse the run/tool helpers in `src/notes/audio-extractor.ts`
   (`clipFromLocal` is the shape). Gate on `Platform.isDesktopApp` +
   detectTools. This is a nice-to-have tier — ship the clock first.
5. Golden: `parsePlexSessions` fixtures (playing, paused, empty, HTTP 401
   → error verbatim). Add to follow.mjs or a new plex.mjs in all.mjs.

## Remaining item B — Kindle book artifact + 💭 register  [needs user's first real export to lock parser]

Goal (§25.6): ONE note per book, imports merge idempotently BY LOCATION,
typed captures and 💭 thoughts interleave, nothing user-written is ever
disturbed.

1. New file `src/notes/book-import.ts` (PURE):
   - `parseKindleExport(text)` → `{ book?: string; author?: string;
     highlights: Array<{ loc: string; text: string; note?: string }>;
     residue: string[] }`. Accept THREE shapes: (a) Kindle iOS app
     引用をエクスポート (lines like `ハイライト(黄色) | 位置: 1,234`,
     publisher boilerplate to strip), (b) read.amazon.com/notebook paste
     (`位置: 1234` / `Location 1234` markers between highlight blocks),
     (c) fallback: plain paragraphs, loc = sequence number. NFKC-normalize
     locs (`1,234` → `1234`). Unparsed lines land in `residue` — surfaced
     in a Notice, NEVER silently dropped. **The user "just uses the app"**:
     lock the parser against their first real export; formats above are
     educated guesses, the export is the truth.
   - `mergeIntoArtifact(existingMd: string, parsed)` → `{ md: string;
     added: number }`. Each highlight is a block:
     `> [!quote] 位置 {loc}` + quoted text + trailing marker
     `%% kloc:{fnv(loc|text-head-20)} %%`. Merge is INSERT-ONLY, anchored
     on the `%% kloc:… %%` markers: existing blocks (and everything the
     user wrote between them — 💭 prose, typed callouts) are preserved
     byte-for-byte; new highlights insert at the loc-sorted position.
     Golden must prove: re-import = 0 added; interleaved user prose
     survives; out-of-order import lands sorted.
2. Rewire command `import-written` (main.ts ~line 868): Kindle mode now
   (a) shows the guided path text (already specced in DESIGN §25.6),
   (b) resolves/creates the ONE artifact note per book title under the
   written-imports folder (frontmatter `source: book`, `title`, `author`),
   (c) runs mergeIntoArtifact instead of creating a new note per paste.
3. 💭 register (cross-medium, NOT a class):
   - `CaptureModal` (`src/ui/CaptureModal.ts`): add a 7th chip 💭 (key 7)
     AFTER the six class chips, visually distinct (no rail color). Selecting
     it swaps the payload area for one textarea; Save calls a new
     `CaptureDeps.appendThought?: (opts: { file?: string; url?: string;
     text: string }) => Promise<void>` and does NOT touch PatternStore,
     classSuggested, or gold. If the context has no source file, fall back
     to appending into the daily note (or Notice honestly).
   - main.ts `makeCaptureDeps()`: implement appendThought — append to the
     source artifact/transcript under a `💭` blockquote with a timestamp
     comment marker for idempotence; preserve trailing newline discipline.
4. note.com: same artifact shape per article (`source: note`, `url` in
   frontmatter). `import-written` note mode already close — just ensure
   captures with `source.url` matching an artifact append there.

## Remaining item C — manga page-chain (small, self-contained)

Goal (§25.7): discourse context flows ACROSS pages within a 読書セッション.

1. In `src/notes/inbox.ts` add PURE
   `sessionDialogue(g: ReadingSession): Array<{ text: string; cardId: string; bbox: [number,number,number,number]; image: string }>`
   = OCR'd bubbles of the group's image cards concatenated in shot order
   (skip cards without bubbles). Golden: order spans cards; un-OCR'd cards
   skipped.
2. In `src/ui/TrayView.ts` `renderCard` image case: when the card belongs
   to a session (pass the group into renderCard or precompute a
   cardId→dialogue-index map in renderSession), bubble-row `onclick`
   builds contextBefore/After from the CROSS-PAGE dialogue (±3 bubbles
   over the whole session) instead of the current same-card slice
   (`TrayView.ts` around the `c.bubbles.forEach` block). Scene stays
   THIS card's image+bbox — only the text context widens.

## Remaining item D — X thread-parent fetch

Goal (§25.8): a captured reply carries the exchange it responds to.

1. `src/x/XClient.ts` `fetchTweetById` uses the syndication endpoint
   (`cdn.syndication.twimg.com/tweet-result`). The JSON for replies carries
   a `parent` object (and `in_reply_to_status_id_str`); quotes carry
   `quoted_tweet`. **PROBE FIRST with a real reply-tweet id** — field names
   from memory are not trustworthy. Depth 1 only; quoted counts as parent.
2. Schema: `XTweet` gains optional `parentText?: string` +
   `parentAuthor?: string`. Corpus JSONL round-trip must carry them —
   update `golden/x-format.mjs` (it golden-locks the JSONL schema).
3. UI: `src/ui/XSearchView.ts` tweet card renders the parent as a dimmed
   quote block above the body; the capture path passes
   `contextBefore: [parentText]` so 🔴 captures get their responsivity
   context.

## Also worth doing (cheap, high value)

- **Validate the player-shot prompt** on the user's first real Apple
  Podcasts screenshot. If elapsed is misread, fix `PLAYER_PROMPT` in
  `src/notes/player-shot.ts` (the parse layer is golden-locked and won't
  need touching). Same for MANGA_PROMPT drift.
- **FollowAlong feel-tuning** after the user's first real session: knobs
  are `LONG_PRESS_MS` (550) and `SCROLL_HOLD_MS` (8000) in
  `src/ui/FollowAlongView.ts`, and the `.jp-follow-line--now` type size
  (20px) in styles.css. The user WILL give feel feedback — treat it as
  ratification data, not complaint.
- If the user reports the 🎤 rating row too heavy mid-pause: the designed
  fallback is "skip now, rate at debrief" which already works — consider
  a collapsed one-line summary variant before inventing anything new.

## Open user inputs (ask when relevant, don't stall on them)

- Plex server URL + X-Plex-Token (item A).
- First real Kindle export paste (item B — lock the parser on it).
- Manatan URL scheme probe result (deep-link door; absent is fine, the
  stored spread is the return destination).
- なりきり: whether the qualitative 0–4 stays or evolves — the schema
  (`speak-session.ts` ratings record) already holds any per-aspect numeric
  method; UI is the only thing that would change.
