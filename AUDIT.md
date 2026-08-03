# AUDIT — full-potential review (2026-07-18)

Everything below was verified against the working tree and the LIVE vault
(`Obsidian Vault/.obsidian/plugins/jp-collocations/`), not inferred from docs.
Ordered by severity. §9 is the punch list.

---

## 1. CRITICAL — the data layer can silently destroy your corpus

The plugin's real product is the attestation corpus (250 catalog patterns, 592
tweets, the recon library, SRS history, `_discourseSeg`). All of it lives in
one `data.json` that is currently **62 MB** and handled in ways that lose data.

### 1.1 `saveSettings()` reverts every store to plugin-load state ⚠ armed, live

`loadSettings()` does `Object.assign({}, DEFAULT_SETTINGS, stored)` — so
`this.settings` carries **every** `_key` (`_patternStore`, `_xCorpus`,
`_srsDeck`, `_reconLibrary`, `_discourseGold`, `_surferBridge`,
`_discourseSeg`, `_dictStore`) as a snapshot from plugin load. The stores copy
that data into private Maps and write **new** objects on change — the snapshot
in `this.settings` goes stale immediately.

`saveSettings()` = `saveData(this.settings)` → writes the stale snapshots back.

**Concrete loss scenario (any session):** ratify 50 sweep candidates → toggle
any setting (or save X cookies — `XSearchView` calls `saveSettings()` 9 ways)
→ all 50 ratifications reverted on disk. Next reload loads the reverted state.
This may be a contributor to historical "the store is mysteriously empty"
events. **Highest-priority fix in the plugin.**

Also: every settings **keystroke** (textarea `onChange` fires per keystroke)
triggers a full 62 MB write.

### 1.2 The 62 MB blob is mostly derived, rebuildable index

Measured composition of the live `data.json`:

| key | serialized chars |
|---|---|
| `_surferBridge.discourseIndex` | 18.3 M |
| `_surferBridge.kwicIndex` | 11.8 M |
| `_xCorpus` | 446 K |
| `_reconLibrary` + `_patternStore` | ~157 K |
| everything else | < 10 K |

**99.5 % of the blob is two derived indexes** that `backgroundIndexVault()`
can rebuild from vault text. Persisting them buys a slightly faster cold start
and costs: 62 MB parsed on **every** `loadData()` call (every store persist
does read-modify-write → parse 62 MB + serialize 62 MB **per ✓ tap, per SRS
grade, per swept transcript**), double residency in RAM (settings snapshot +
live index), multi-second saves on mobile, and 62 MB per Obsidian-sync cycle.

### 1.3 Structural fixes (one coherent design, not eight patches)

1. **One `DataManager`.** A single in-memory canonical blob object; stores
   call `setKey('_patternStore', data)`; writes are **serialized through one
   queue** (kills the read-modify-write races between concurrent persists) and
   debounced. `saveSettings` writes only settings keys through the same
   manager. No store ever calls `loadData()` after startup.
2. **Stop persisting derived indexes.** Drop `discourseIndex`/`kwicIndex` from
   the blob; rebuild in the existing idle-batched background pass on load.
   `data.json` goes from 62 MB → ~600 KB instantly. (Migration: delete the
   keys once, on next load.)
3. **Vault-native catalog.** The pattern catalog + gold stores are the crown
   jewels and currently have **no export** and no backup. Mirror them to
   Markdown/JSONL files in the vault (append-only for gold): survives plugin
   death, diffable, syncs as text, user-editable, and Obsidian-philosophy
   correct (files over app). The blob then becomes an index, not the truth.
4. **Crash-safety.** `saveData` is not write-then-rename; the app dying
   mid-write of a large JSON can corrupt the whole file. Keep a rolling
   `data.json.bak` (previous good version) — 1 line in the DataManager.
5. **Sync blast radius.** Two devices editing one 62 MB JSON = whole-file
   last-writer-wins conflicts. After (2) and (3) this mostly disappears.

## 2. HIGH — secrets are stored in synced plaintext

All of these live in files that sync wherever the vault syncs (Obsidian Sync,
iCloud, git if `.obsidian` is versioned):

- **X `auth_token` + `ct0`** — full account session — in `settings.x` in `data.json`.
- **YouTube cookies** — in `settings.ytHistory` AND as plaintext
  `_yt_cookies.txt` sitting in the plugin folder.
- **Anthropic API key** (`ocrApiKey`) — in `data.json`.

Obsidian has a device-local store that does **not** sync:
`app.saveLocalStorage()/loadLocalStorage()`. Move all three there (settings UI
unchanged; storage layer swapped; one-time migration scrubs them from the
blob). Also delete `_yt_cookies.txt` after use or relocate it. Until then, a
shared/synced vault is a session-hijack away.

Related hygiene: the deploy step copies `esbuild.config.mjs`, `package.json`,
`package-lock.json`, `tsconfig.json` into the vault plugin dir — dev files
don't belong in the vault; copy only `main.js`/`manifest.json`/`styles.css`.

## 3. Performance

- **`onload` parses the 62 MB blob twice** (`loadSettings()` then the
  `stored = await this.loadData()` at main.ts:140). After §1.3 this is moot,
  but until then, pass `stored` into `loadSettings`.
- **Note-open cost:** `active-leaf-change` → re-index file → debounced
  **full-blob** save. Every note you open schedules a 62 MB disk write.
- **Bundle 1.7 MB** — fine for desktop, heavy for phones. `discourse/` is 44 %
  (935 KB) of bundled source; `discourse-patterns.ts` alone is 118 KB of
  data-as-code (could load lazily from JSON).
- **219 KB of `src/` is confirmed unreachable** (esbuild metafile): the whole
  citation L1–L5 pipeline, `rhetorical-*`, `program-builder`,
  `schema-driven-l4`, `TextClassifier`, duplicate `ChunkExtractor.ts` /
  `CardGenerator.ts`, `surfer-types.ts`. Delete or move to `_attic/`; the
  bundle doesn't shrink (esbuild already tree-shakes) but the maintenance
  surface and confusion do. The dead-code map memory matches reality.
- **styles.css is 138 KB** — likely accreted; a dedupe pass is worth an hour.

## 4. Product surface — the plugin has features but no center

Counted: **45 commands, 7 views, 8 ribbon icons.** Eight ribbon icons from one
plugin is Obsidian anti-social; 45 palette entries make every command hard to
find. The functionality is there; the *product* isn't yet.

- **Pick the center.** The ⚡ PipelineView (watch→capture→review) is already
  the de-facto daily loop; the 語彙 tab is the reference surface. Proposal:
  ONE ribbon icon → a hub with the ⚡ flow + tabs (語彙 / X / 辞書 / 談話 /
  復習); everything else demoted to palette commands. (This matches the
  monokakido aesthetic already chosen.)
- **Command diet:** merge the 6 `fetch-*`/`generate-srs-*` variants behind
  their views; prefix consistently (`JP:`), bilingual naming is currently
  inconsistent (some EN, some JP).
- **Empty states as onboarding.** The dictionary view with 0 imported
  dictionaries and the X view with no cookies should each render a one-screen
  "here's how to get value in 2 minutes" instead of empty lists. The
  seed-data moment (first launch) is the one chance to demonstrate the loop:
  consider shipping 20 curated catalog patterns with attestations wired to a
  public-domain transcript so every surface demos itself.
- **Capture friction is the core metric.** The whole system's value scales
  with noticings-per-week. Measure taps from "heard something" → saved. A
  global quick-capture hotkey (selection or clipboard → CaptureModal with
  auto-context) would shortcut the common case from any note.

## 5. Language engine — one unlock dominates everything else

- **Morphology.** Every remaining matcher weakness (sweep residual false
  positives, dictionary lookup edge cases, KWIC tokenization, the halted 🔴
  parser's segmentation) traces to the absence of a tokenizer. The CLI's
  `morph_pattern` true-hit filter already exists in `_tmp_pipeline` as
  reference. Options by weight: port the existing deinflect-driven
  chunker upward (free), TinySegmenter (~25 KB, dictionary-free, mediocre but
  cheap), or a WASM Vibrato/kuromoji with compact dict (good, ~5–15 MB,
  desktop-first with graceful mobile degrade). Recommendation: desktop-gated
  real tokenizer + current deinflect heuristics as the mobile fallback, behind
  one `tokenize()` seam so callers don't know the difference.
- **Sweep learned reranker** — blocked on label volume by design; the ✓✕
  export already exists. Revisit at ~300 labels.
- **🔴 parser resume point** — the gold store + `_discourseSeg` corpora are
  accumulating exactly the training/eval data the halt was waiting for. When
  ~100 gold examples exist, the eval harness (suggested-vs-ratified) can gate
  any parser change objectively — that was the point of the capture spine.
- **Dictionary** — deinflection landed; the store in the live vault has **0
  dictionaries imported**, so lookups fall through. Either bundle a JMdict
  subset (freq-top-N, ~2–5 MB) or make the import path the dictionary view's
  empty state (§4).

## 6. SRS & pedagogy

The scheduler is honest SM-2 (golden-tested, 365-day cap). Upgrades in value
order:

1. **Leech handling** — a card lapsing 5+ times should flag itself for
   rewrite/suspend instead of eating minutes forever (biggest real-world Anki
   lesson, cheap to add to `schedule()`).
2. **FSRS-lite** — modern scheduling is meaningfully more efficient than SM-2
   (fewer reviews, same retention). A pure-TS FSRS implementation slots behind
   the same `schedule()` seam; keep SM-2 as fallback. Not urgent; do after
   leeches.
3. **Production cards** — current fronts are recognition-shaped (P4 drill
   semantics). The 6-class taxonomy begs for class-appropriate *production*
   prompts: 🟠 "link A to B" (give parts, produce utterance), 💠 "fill the
   frame", 🟢 "what gesture does 〈lemma〉 evoke here". This is where the
   taxonomy pays off pedagogically, not just organizationally.
4. **Interleave by class** in queue building (currently pure due-order), and
   surface lapse-streaks in the 語彙 detail so the dictionary and SRS loop
   feed each other.

## 7. Robustness

- YT transcript fetch has throttle+429 backoff (recent work, good). The
  fetch paths still assume YouTube page-shape stability — isolate the
  shape-knowledge the way `XClient` isolates X's (it's ~there; keep it so).
- X live search stays blocked on `x-client-transaction-id`; the working paths
  (syndication 🔗, JSONL import, auto-collect) are correctly documented.
  Implementing the transaction-id algorithm is possible but is an
  anti-bot-evasion arms race — recommend staying on the working paths.
- Error observability: pipeline logs on failure (good). Add one
  `debug: dump state` command — store sizes, blob key sizes, last-save
  timestamps, engine version — 30 lines that turn "it's mysteriously empty"
  into a diagnosis. (`recon-health-check` covers recon only.)

## 8. Dev infrastructure

- **No CI.** 19 golden suites exist and pass — but nothing runs them. Add
  GitHub Actions: `npm run build && npm run golden && npm run lint` on push.
  Locally, make `npm run build` run goldens too (they're fast).
- **The golden suites cannot see the worst bugs** — §1.1 lives in `main.ts`
  orchestration, which is untested by design (pure modules only). Add one
  `golden/storage.mjs` with a fake `loadData`/`saveData` harness asserting:
  settings save preserves store keys; concurrent persists don't drop keys;
  migration drops legacy index keys. That suite would have caught §1.1.
- **Repo hygiene:** ~60 `_tmp_*` files at root (this audit adds none — its
  probe lives in the job dir). Sweep them into `_attic/` or delete; commit
  `.eslintrc.json` and `CLAUDE.md`; the working tree has 25+ modified files
  that should land as commits (the branch name no longer matches its
  content).
- **Version discipline:** manifest/package still 1.0.0 while the plugin has
  shipped ~17 DESIGN sections. Adopt version bumps per DESIGN section — free
  changelog.

## 9. Punch list (ordered)

| # | What | Size | Payoff | Status |
|---|---|---|---|---|
| 1 | DataManager: single canonical blob, serialized debounced writes, settings split from store keys | M | stops active data loss (§1.1, §1.3.1) | ✅ 2026-07-18, DESIGN §18 |
| 2 | Stop persisting `discourseIndex`/`kwicIndex` + one-time migration | S | 62 MB → ~600 KB; every save/load 100× cheaper | ✅ DESIGN §18 |
| 3 | Secrets → `saveLocalStorage` + scrub from blob + delete `_yt_cookies.txt` | S | closes session-hijack exposure | ✅ DESIGN §18 (incl. `.bak` realign) |
| 4 | Rolling `data.json.bak` | XS | survives crash-corrupt | ✅ DESIGN §18 |
| 5 | `golden/storage.mjs` persistence suite + CI workflow | S | locks 1–4 forever | ✅ 29 checks + ci.yml |
| 6 | Catalog + gold → vault-native Markdown/JSONL mirror | M | corpus becomes un-killable, files-over-app | ✅ DESIGN §19 (`JP Lexicon/` + restore cmd) |
| 7 | One-ribbon hub view; command diet; empty-state onboarding | M | the plugin becomes a product | ◐ ribbons 8→1 hub menu done; command diet + empty states remain |
| 8 | Leech handling; then production-shaped cards per class | S/M | pedagogy catches up with the taxonomy | ◐ leeches done (DESIGN §19); production cards remain |
| 9 | `tokenize()` seam: desktop tokenizer, deinflect fallback | L | lifts sweep/dictionary/KWIC/🔴 all at once | ⬜ own session |
| 10 | Delete 219 KB dead src; styles.css dedupe; `_tmp_*` sweep | S | maintenance sanity | ◐ 15 files → `_attic/` (surfer-types is ALIVE — type-imports are invisible to the metafile); css dedupe + `_tmp_*` sweep remain |
| 11 | Debug-dump command | XS | diagnosability | ✅ `debug-dump` |
| 12 | FSRS-lite behind `schedule()` seam | M | fewer reviews, same retention | ⬜ own session |

Items 1–5 removed every known way the plugin can lose your data. Item 9 is
the single biggest capability unlock remaining.
