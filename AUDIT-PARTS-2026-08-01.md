# AUDIT — every pipeline, feature and command, on its own terms (2026-08-01, second pass)

Companion to `AUDIT-2026-08-01.md`. That document audited five *surfaces* and the
parser question. This one goes part by part and asks the question that was asked
of it: **what role is this trying to fill, and what is it actually doing?**

Method: 153 TS files / 57,636 LOC, 68 registered commands, 9 registered views.
Reachability was computed from `src/main.ts` over the real import graph (191/192
modules reachable — only `discourse/calculus/handmarks.mjs` is orphaned, so
"dead code" is *not* this project's problem and is not what follows). Every
number below was produced this session by running the shipped `.mjs` engine
modules against `golden/fixtures/{nenko,imiron}` — 4,937 sentences of real
Japanese conversation. Nothing was modified.

The findings are ordered by how much of the product they silently invalidate.

---

## 1. CRITICAL — the parser rewrite kept the old data model and filled it with constants

This is the largest thing in the codebase and nothing in the tree says it happened.

PARSER-AUDIT Phase 2 replaced the substring matcher. The replacement is wired
correctly — `detectPatterns()` is now one line, `return detectPatternsAccurate(text)`
(`discourse-grammar.ts:167`). Everything downstream still consumes
`DiscoursePatternDef`, the hand-authored record with `register` / `position` /
`frequencyTier` / `coOccurrence`. The adapter that bridges the two
(`accurate-patterns.ts:176-199`) manufactures a `DiscoursePatternDef` per engine
operator, and it manufactures them like this:

```ts
position: 'any',
register: 'any',
coOccurrence: [],
frequencyTier: 2,
```

Then `detectPatternsAccurate` emits **only** defs from that map
(`ENGINE_DEF_BY_OP.get(h.opId); if (!def) continue;` — line 275-277).

So: `discourse-patterns.ts` holds **515 hand-authored pattern definitions** with
real values — 212 `casual`, 196 `neutral`, 24 `formal`, 35 `any` — and **not one
of them can ever be returned by `detectPatterns` again.** They are still built,
still indexed into `PATTERNS_BY_SURFACE` and `PATTERNS_BY_CATEGORY`, still
shipped in the bundle. They are unreachable through the only function that
produces matches.

### What that constant does downstream

Traced end to end, not inferred:

| consumer | line | now computes |
|---|---|---|
| `analyzeUtterance` → `registerCounts` | `discourse-grammar.ts:308` | `{ any: N }` |
| `estimateRegister({any:N})` | `discourse-grammar.ts:346` | `weights.any = 0` → score 0 → **always `'普通体'`** |
| `chunk.register` (6 call sites) | `chunk-extractor.ts:291,316,366,380,403,417` | `'普通体'` |
| SRS card body | `card-generator.ts:289` | `> レジスター: 普通体` |
| SRS card **tag** | `card-generator.ts:385` | `…/register/普通体` on every card |
| `ContextCard.register` | `ContextEngine.ts:314` | `'any'` |
| variation-tree register sort | `variation-trees.ts:210` | all keys equal → sort is a no-op |
| `if (m.pattern.frequencyTier <= 2)` | `discourse-grammar.ts:459` | always true |
| `if (pattern.position === 'utterance-initial')` | `discourse-grammar.ts:456`, `sentence-features.ts:189` | **never** true |
| `if (role==='other' && position!=='utterance-initial') continue` | `sentence-features.ts:205` | always continues — the branch is dead |

`register` is the field that decides whether a phrase is sayable in a given
situation. It is the single most product-relevant annotation in the pattern
catalogue, it was hand-authored 480 times, and the plugin now reports `普通体`
for a slangy tweet, an NHK bulletin and a drunk podcast identically. Nothing
errors. Nothing is empty. It just says the same thing forever.

**This is the exact failure shape §1 of the first audit named for Hyogen** — a
feature that returns plausible output and no error — reproduced in the core
analysis path, three weeks later, by a change that was otherwise correct.

### Both matchers still run

`analyzeUtterance` line 298:

```ts
const flows = detectLogicalFlows(detectPatternsLegacy(text));
```

The retired 13%-false-positive substring matcher is still executed on every
utterance, on the same text, to produce the `flows` output that feeds
`chunk-extractor`. Two matchers, two answers, one call.

### Fix

Not "delete the legacy catalogue". The 515 defs are the *asset*; the engine is
the *locator*. Join them: in the `ENGINE_DEF_BY_OP` loop, look the operator's
first trigger surface up in `PATTERNS_BY_SURFACE` and inherit
`register`/`position`/`frequencyTier`/`coOccurrence` when a def exists, keeping
the constants only as the fallback for engine-only operators. That is ~10 lines
and it restores four annotations across every consumer at once. Then pin it:
a golden asserting `detectPatterns('でもさ、…').some(m => m.pattern.register !== 'any')`
would have caught this the day it landed.

---

## 2. CRITICAL — `scope` is declared morphologically and implemented as "is this a Japanese character"

Measured on the two fixtures.

The engine's whole claim over the substring matcher is boundary awareness.
`match.mjs` implements it with 14 scope predicates. Four of them are the same
test:

```ts
case 'after-noun':     return isAfterKanjiOrKatakana(text, offset);
case 'after-verb':     return isAfterKanaVerbStem(text, offset);
// isAfterKanjiOrKatakana: /[一-龥々ァ-ヴーぁ-ん]/.test(text[offset-1])
// isAfterKanaVerbStem:   /[一-龥々ぁ-ん]/.test(text[offset-1])
```

`after-noun` and `after-verb` — two constraints that exist to *distinguish* the
two cases — differ only by whether katakana is allowed. Both are true for
essentially any Japanese character. `copula-suffix` ORs a specific test with the
same catch-all and is therefore also unconditional.

**Of 576 triggers across 126 operators, exactly 20 carry any lexical guard at
all** (11 `not_after`, 3 `not_before`, 2 `requires_preceding`, 4
`requires_following`). 3.5%.

### The cost, measured

`TOPIC-PRESENT` (surface 「って」, `scope: 'after-noun'`) is the most-fired
operator in the system:

| | nenko | imiron | both |
|---|---|---|---|
| sentences | 690 | 4,247 | 4,937 |
| total hits | 924 | 4,322 | 5,246 |
| TOPIC-PRESENT | 204 | 930 | **1,134 = 21.6% of every hit** |
| …preceded by a verb te-form stem (思って/言って/持って/取って/使って/乗って/知って/終わって) | 56 | 230 | **286 = 25.2%** |

Real examples from the fixtures, verbatim:
`たいと思⟦って⟧いるん`, `ション取⟦って⟧いるの`, `スキルを持⟦って⟧会社を`,
`ビスを使⟦って⟧みんな`, `頭に乗⟦って⟧るの`, `条件を知⟦って⟧いるっ`.

The operator's `not_before` list (`言/いう/いっ/思/おも/聞/書/考/話/はな/こと/ね/さ`)
blocks the *quotative* 「〜って言う」. Nothing blocks the *te-form*, because
`after-noun` lets any kanji through. One in four of the plugin's most common
detection is a verb inflection mislabelled as a topic marker — and these
highlight in reading mode, colour pills in 談話モード, enter the discourse
index, and become concordance rows.

Second, smaller, same cause: on 「でもさ、それって…」 the engine emits
`TOPIC-STAGE-MARK@1:"もさ、"` — the tail of 「でも」 plus 「さ」, matched across a
morpheme boundary at offset 1.

### Operator coverage

| | |
|---|---|
| operators defined | 126 |
| operators that fire at least once in 4,937 sentences | **97 (77%)** |
| **never fire** | **30** |
| operators producing 50% of all hits | **7** |

The 30 that never fire are the interesting-sounding ones: `META-INFERENCE`,
`ADVICE-BETTER`, `RULE-OUT`, `UNDERSTANDING-CHECK`, `UNDERSTANDING-REPORT`,
`DEEPEN-PROBE-OPEN`, `EXAM-FRAME-MARK`, `STRATEGIC-CALCULUS`,
`COUNTERFACTUAL-IDENTIFY`, `NARRATIVE-LAUNCH`, `META-SEGUE`, `HEARSAY-TOSS`…

This is the same shape as §6.6's primitive census (REJECT = 0 over both files),
one layer down, and it has the same reading: **the lexicon's expressive range is
not the system's actual range.** Seven operators are the system. Reporting "126
discourse operators" is true of the file and false of the behaviour.

### Fix, in order

1. Make `after-noun` mean something. The minimum honest version is a
   negative test, not a positive one: reject when the preceding 1–2 characters
   complete a godan te-form (`[っんい]って` plus a stem list, or the far cheaper
   `text[offset-1] === 'っ'` plus a ~40-verb kanji stem set). Even the crude
   version removes most of the 25%.
2. Print the never-fired list in `recon-health-check`. An operator that has
   never fired against the user's own corpus is a hypothesis, not a feature, and
   the health check is the honest place to say so.
3. `structuralAnalysis` produced **1 bundle in 4,247 sentences** on imiron
   (11 and 161 moves). If bundles are meant to fire, they don't; if they aren't,
   the promotion pass in `accurate-patterns.ts:269-270` is paying for nothing.

---

## 3. CRITICAL — attestation identity drops the quote, so every untimed medium caps at one sighting per source

```ts
// pattern-store.ts:214
export const attestationKey = (a) => `${a.file ?? ''}|${a.tStartSec ?? ''}|${a.source}`;
```

The comment above it says *"one sighting per (file, second)."* For captioned
video that is right. For everything else there is no second, so it degenerates
to **one sighting per file**.

`upsertEntry` (line 239-252): when the key already exists and the incoming is
`status:'suggested'` with no `anchorId`, **no branch matches — the candidate is
silently discarded.** Not merged, not counted, not reported.

Now line this up against what was built this morning. `medium-lines.ts` added
three adapters so non-video media could finally be swept. Both untimed ones
produce `MatcherLine`s with no `tStartSec`:

- **Prose** (`proseLines`) — Kindle highlights and note.com articles. `import-written`
  writes **one note per book**. A book with 40 sightings of 「気になる」 yields
  `<path>||web` forty times → **one attestation, permanently.** The other 39 are
  unreachable and will be re-found and re-dropped on every future sweep.
- **Tweets** (`tweetLines`) — key is `<tweet-url>||x`, so distinct tweets are
  fine, but a long-form post with three sentence-hits keeps one.

The first audit measured the prose adapter as "ready and unexercised" and the
tweet adapter as "1,832 tweets newly sweepable — 「気になる」 finds 37 sightings
there." Those numbers are *candidate* counts from `sweepEntry`. The number that
survives `attestationKey` is smaller by however many share a file, and nothing
in the pipeline says so.

Second-order: `rejectedAtts` stores the same key. Rejecting one sighting in a
book bans **every** future sighting from that book for that pattern.

**Fix:** `${a.file}|${a.tStartSec ?? ''}|${a.source}|${a.quote}` — or a hash of
the quote to keep keys short. One line. Then `medium-lines.ts` does what it was
built to do. Without it, the Kindle/note road ships at 1/40th of its measured
recall, and the audit item recorded as BUILT is built up to the last hop.

---

## 4. HIGH — the ⚡ gate accepts any note with `source:`, and the project already knows

`frontmatterSources` (`pipeline.ts`) matches `sources?(?:_transcript)?:` — the
`s?` makes the **singular** `source:` match.

Every transcript this plugin writes carries a singular `source:` in its
frontmatter — `source: yt`, `source: tv` (Plex/jimaku), `source: podcast`,
`source: book`, `source: note`.

So opening any transcript and pressing ⚡:

1. `runFullPipeline` → `frontmatterSources(content)` returns `["tv"]` → **the
   guard passes**;
2. `prepareReconcile` → `getFirstLinkpathDest("tv", …)` → null →
   「文字起こしが見つかりません: tv」.

Confusing, but survivable — *unless the vault contains a note named `tv.md`,
`yt.md`, `book.md` or `note.md`*, in which case the pipeline resolves it and
reconciles the transcript against an unrelated note.

And the Notice that fires when the guard *does* reject says:

> frontmatter に `source: [[transcript]]`（複数可: カンマ/リスト）を追加してください

It instructs the singular form. A user who follows it exactly, on a transcript,
lands in the failure above.

The sharp part: **this bug is already documented, at one call site.**
`captureNoteFromTranscript` carries a nine-line comment explaining that
`frontmatterSources` also matches the singular, that every Plex/jimaku
transcript has `source: tv`, and that using it "refused the exact case this
command was added for" — and then hand-rolls a plural-only regex to dodge it.
`golden/capture-rung.mjs` pins the dodge. The shared function was left wrong,
and the five commands that actually run the pipeline (`run-recon-pipeline`,
`reconcile-notes-transcript`, `generate-recon-cards`,
`download-recon-audio-clips`, `ocr-reconcile-handwriting`) all still call it.

**Fix:** `frontmatterSources` requires the plural; add `frontmatterSourceMedium`
for the singular if anything needs it. Update the Notice text to the plural.
Half an hour, and it deletes the workaround plus its golden.

---

## 5. HIGH — `build-discourse-concordance` stamps every medium as YouTube

```ts
// main.ts, buildConcordance
source: { source: "yt", medium: "yt", file: f.path, videoId,
          sourceName: f.basename,
          ...(videoId ? { deepLink: `https://youtu.be/${videoId}` } : {}) }
```

It iterates **every markdown file in the vault** that matches `CAPTION_STAMP_RE`
— which includes Plex episodes, jimaku subtitles, whisper'd podcasts and
hand-pasted `.srt` — and hard-codes `medium: 'yt'` for all of them.

This is the command that produced the catalog's 17,891 suggested attestations
(「ですね」 alone: 3,565). So a large majority of the attestation corpus asserts
a medium it does not have. §28 S2's test — *"one tap from its source in that
source's own medium"* — fails for every non-YouTube transcript: `deepLink` is
correctly omitted (no videoId), so the row claims YouTube and offers no door.
The lexicon's source facet files them under YouTube too.

Related and structural: `Attestation.source` is typed `'yt'|'x'|'web'|'manual'`
while `Medium` has eleven values. There is no honest `source` for a TV episode,
which is *why* the code picks `'yt'`. `source` predates `medium` and is now a
lossy duplicate of it — the two-field design is the bug, and collapsing
`source` into `medium` (with a migration in `blob-migrations.ts`, which already
exists for exactly this kind of thing) is the real fix.

---

## 6. HIGH — the 6.4M-headword shelf answers only exact headwords

`BigDictStore.lookup` (`big-dict.ts:193`):

```ts
const k = normalizeLookupKey(expression);
const body = await this.shard(headPath(dir, hashKey(k) % meta.shards));
for (const l of decodeLines(body)) if (l.k === k) found.push(...)
```

The shard is chosen by hashing the exact key, and matched by `===`. There is no
deinflection, no prefix, no fuzzy — by construction, because you cannot probe a
hash bucket with a form you haven't computed.

`DictionaryStore.lookup` (the small imported-Yomitan store) **does** deinflect
(`deinflect.ts`, line 177). `BigDictStore` — the one holding all 35 converted
books and 6,376,236 headwords — does not, and neither does either caller:
`main.ts:603` and `main.ts:3310` both pass the raw query straight through.
`LexiconPanel`'s own header comment says "dictionary (deinflection-aware)" and
`unified-search.ts` says "deinflection lives there [the caller]". It doesn't.

Consequence: look up 食べた, 面白かった, 言われている, 持ってきて — every form
text actually arrives in — and the entire converted shelf returns nothing while
the small store answers. The plugin's largest asset is reachable only from the
citation form, which is the one form you already know.

**Fix:** `lookup()` already has the loop; run `deinflect(k)` and try each
candidate's shard, tagging hits with the trail exactly as `DictionaryStore` does
(`{...r, deinflection: d.trail}`) — the UI already renders that badge
(`LexiconPanel.ts:842`, `DictionaryView.ts:778`). Cost is one extra shard read
per candidate, inside a cache sized at 24MB/8MB. This is probably the single
highest value-per-line change in the document.

---

## 7. HIGH — the collision watcher, the point of 願い, is wired to the one command nobody runs

`reach.ts` is one of the best-argued files in the repo, and §27.0.2 calls the
collision — a want held open, an offer arriving, the flash — the most alive part
of the whole project. Three things break it, all outside `reach.ts`:

1. **`watchReaches` has exactly one caller: `sweepCatalog`** (`main.ts:4744`).
   The first audit established that the full sweep "costs minutes and never gets
   run" — that is *why* `autoSweepEntry` was built. And `autoSweepEntry` /
   `autoSweepAfterCapture`, the paths that fire on every capture, **never call
   `watchReaches`.** The watcher is attached to the dead road.
2. **`frame` offers can never fire.** `collide` requires `item.frameKey`; the
   only caller constructs `Incoming` objects with `surface`, `source` and `at`
   and no `frameKey`. One of three offer reasons is unreachable from production.
3. **`token` offers rarely fire.** The match is
   `surface.toLowerCase().includes(t)` where `t` comes from `wantTokens(want + gloss)`
   and `surface` is a Japanese attestation quote. A want written in English
   ("that feeling when you…"), which is the natural way to record a meaning you
   *can't yet say*, cannot be a substring of Japanese.

So in practice the feature offers `juxtapose` only, capped at 2, during a
command that isn't run. The `open-reach` command works, the modal works, the
tray renders reaches — and nothing ever arrives.

**Fix:** call `watchReaches` from `autoSweepAfterCapture` with the attestations
that run just wrote (not `attestations.slice(-2)` of every pattern, which is
"the last two ever", not "what just arrived"). Pass `frameKey` from
`frames.ts`'s `gapFrame` where the entry has one. Both are small; the second is
the one that turns 願い from a notepad into the mechanism §27.0.2 describes.

---

## 8. MEDIUM — three write-only stores

Each of these is collected carefully and read by nothing.

**`_componentGold`.** DiscourseModeView's component pills (§23 layer 2 — "the
parser's honest ceiling, and it's USEFUL") record accept/reject verdicts with
full turn context via `recordComponentVerdict` (`main.ts:4060`). Readers:
the write itself, and the "have I already judged this?" lookup at line 715.
`discourse-gold-export` writes `discourse-gold.jsonl` and `class-choices.jsonl`
and **does not export `_componentGold`.** The gold that layer 2 exists to
produce has no consumer and no exit.

**Layer 2 is still not under the calculus.** Audit item #7 was "wire
`components.ts` under the calculus". What was built is components-as-UI-pills.
`components.ts` is imported by `DiscourseModeView.ts` and nothing else;
`FollowAlongView` (which runs `scoreboard.mjs` / `moves.mjs` / `turns.mjs`)
does not import it. The calculus still goes 1 → 3 → 4 and skips 2, which is the
exact configuration §6.6 diagnosed as the reason REJECT fires zero times.
Half of the item landed — the half that collects gold nobody reads.

**`Export Data`.** `exportData()` serializes `this.store.exportAll()` — the
legacy `CollocationStore`, i.e. the 220 seed collocations — under the unqualified
name "Export Data". It does not include `_patternStore` (the catalog and its
18,000 attestations), `_srsDeck`, `_ratify`, `_reaches`, `_xCorpus`, `_inbox`,
`_discourseGold` or `_componentGold`. The corpus does survive, via the
`JP Lexicon/catalog.jsonl` mirror written on a 5s debounce — but a user
reaching for a button called "Export Data" before a reinstall gets the least
valuable store and no warning. Rename it `Export Legacy Collocations (JSON)`, or
make it export the blob.

(`importData`'s `catch` also reports 「Failed to parse JSON file」 for a
`bulkImport` failure that happened well after parsing succeeded.)

---

## 9. MEDIUM — `toggle-discourse-visualization` throws on every invocation

```ts
// main.ts:1576-1581
toggleDiscourseVisualization(cmView);
const active = cmView.state.field(
  // re-import avoided by checking directly
  cmView.state.field !== undefined      // ← this evaluates to `true`
);
new Notice('談話文法可視化：' + (active ? 'ON' : 'OFF'));
```

`EditorState.field(true)` reads `true.id` → `undefined` → `config.address[undefined]`
→ `undefined` → CM6 throws `RangeError: Field is not present in this state`.

The dispatch on the line above has already run, so the toggle *works*; the
command then throws and the Notice never appears. The user gets a silent state
change and a console exception. The comment "re-import avoided by checking
directly" is the tell — the correct call is
`cmView.state.field(visualizationActive)`, which is already exported from the
same module the command imports `toggleDiscourseVisualization` from.

Two related things in that extension:

- `buildDecorations` calls `editorContext.resolver(text, …)` over the **entire
  document** on `docChanged || viewportChanged`. With visualization on, that is
  a full discourse re-analysis per keystroke and per scroll.
- `accurate-patterns.ts` caches by full input string in a `Map` capped at 500
  entries. Fed whole documents on every keystroke, that retains up to 500
  document-sized strings plus their match arrays.

---

## 10. MEDIUM — the two-search-engines problem is unchanged, and the fuzzy path is still O(n·m) per keystroke

Audit item #6 (one shared `matchJapanese`) has not been started: `grep -r matchJapanese src/` returns nothing.

- `unified-search.ts:44` — `norm()` is still NFC + strip-space + lowercase, then
  exact / prefix / includes. No kana folding, no romaji, no wildcard, no fuzzy.
- `SearchEngine.ts:105-106` — still `normalizeJapanese(field)` and
  `toHiragana(fieldNorm)` **recomputed per field, per entry, per keystroke**, and
  lines 133-139 still run the sliding-window Levenshtein over every substring
  offset with no bigram prefilter.

Neither (a) prefilter nor (b) precompute-at-load was done. `kaze` still finds 風
in the `CollocationView` box and nothing in `LexiconPanel`, which is the more
prominent surface.

---

## 11. Standing items from the first audit, status

| # | item | status |
|---|---|---|
| 1 | mark/delete the 5 stale plugin copies | **not done** — `Desktop\Code\jp-collocations` is still a `src`-less July bundle |
| 2 | fix the drill | **done** — `drill.mjs` + `golden/drill.mjs`, `drillOptions()` takes no answer parameter |
| 3 | `capture-note-from-transcript` | **done** — well built; two nits below |
| 4 | rewrite `HyogenScraper.parseHtml` | **not done** — still `/<tr[^>]*>…/`, still `fullPhrase: headword + collocate` (line 146) |
| 5 | delete the TWC scraper | **not done** — 429 lines, still POSTs `accept=true`, both commands still registered |
| 6 | one shared `matchJapanese()` | **not done** (see §10) |
| 7 | wire `components.ts` under the calculus | **half** — wired to a UI surface, not to the calculus; its gold is write-only (see §8) |
| 8 | ratification as a byproduct of study | **done** — `ratify.ts` + `ReviewView` probe, 63 checks |
| 9 | diarization → layer 1 | not done (1 week, as estimated) |

`capture-note-from-transcript` nits: it writes `Capture {title}.md` at the
**vault root** (repeated use fills the root), and links `[[{basename}]]`, which
Obsidian resolves ambiguously when two transcripts share a basename across
folders — a real case here, since Plex and jimaku can both produce
「進撃の巨人 S1E01」.

---

## 12. Smaller things found while walking every command

- **CLAUDE.md is stale in a way that misleads agents.** It says "the discourse
  pattern matcher is largely naive substring matching (it over-fires)" and "the
  dictionary has no deinflection" and warns about duplicate `ChunkExtractor.ts` /
  `CardGenerator.ts` files. The matcher was replaced (§1), `DictionaryStore`
  deinflects (only `BigDictStore` doesn't, §6), and the duplicate-cased files no
  longer exist. It also says "~20 commands"; there are 68. An agent following
  this file will fix things that are already fixed and miss §1 entirely.
- **The tray has no jimaku door.** `trayDoors()` ships 7 入れる chips
  (YouTube history / YouTube URL / Plex / 字幕 .srt / Podcast / Kindle・note / 𝕏).
  `jimaku-subtitle-transcript` — §25.4b, "SHIPPED", the answer to *where the
  Japanese subtitle comes from when you have no Plex server* — is not one of
  them. Neither is 願い (`open-reach`), the one place the plugin holds a hole.
  Both are palette-only, and the ribbon now opens the tray.
- **`import-podcast` buffers the whole episode in memory.** `requestUrl(...).arrayBuffer`
  on a 60-minute mp3 is 50–100MB held at once, then handed to `createBinary`.
  Ungated on mobile. `vault.create` also throws on a name collision, so
  re-importing an episode fails with a raw exception rather than a Notice.
  `import-srt` and `import-written` have the same `vault.create` collision.
- **`debug-dump` uses `navigator.clipboard.writeText` unguarded**, which is not
  reliably available in Obsidian mobile; the command silently throws there. It
  is one of the few tools for diagnosing a phone.
- **`estimateRegister` returns the string `'neutral'` for zero patterns and
  Japanese labels otherwise** (`'普通体'`, `'カジュアル'`…). Consumers tag and
  render both, so the tag namespace has an English outlier.

---

## 13. Ranked

| # | action | effort | what it unblocks |
|---|---|---|---|
| 1 | **Join the 515 pattern defs to the engine ops** in `accurate-patterns.ts`; golden-pin that `register !== 'any'` | ½ day | register/position/frequency/co-occurrence across every consumer — currently all constant |
| 2 | **Put the quote in `attestationKey`** | 1 line | prose and long-tweet sweeping, which is currently capped at 1 per source |
| 3 | **Deinflect before `BigDictStore.lookup`** | ½ day | the 6.4M-headword shelf becomes reachable from running text |
| 4 | **`frontmatterSources` requires the plural**; fix the Notice text; delete the `captureNoteFromTranscript` workaround | 1 hr | ⚡ stops accepting transcripts and mis-resolving `tv`/`yt` |
| 5 | **Guard `after-noun` against verb te-forms** | ½ day | ~25% of the most-fired operator stops being wrong |
| 6 | **`buildConcordance` derives medium from the transcript's own frontmatter** | 1 hr | S2 provenance across the majority of the attestation corpus |
| 7 | **Call `watchReaches` from `autoSweepAfterCapture`; pass `frameKey`** | 2 hr | 願い starts colliding at all |
| 8 | **Export `_componentGold` from `discourse-gold-export`**; add the never-fired operator list to `recon-health-check` | 2 hr | layer-2 gold gets an exit; the lexicon's real range becomes visible |
| 9 | Fix `toggle-discourse-visualization`'s `state.field(true)` | 5 min | the command stops throwing |
| 10 | Rewrite CLAUDE.md §discourse and §architecture against the current tree | 1 hr | the next agent starts from what is true |
| 11 | Items 1, 4, 5, 6 from the first audit (stale copies, Hyogen, TWC, `matchJapanese`) | as estimated there | unchanged |

Items 2, 4, 6 and 9 are each under two hours and each removes a defect that is
currently invisible from every screen.

---

*Reproducing §1–2: import `src/discourse/engine/{lexicon,match,relations,structure}.mjs`
directly with node (they are plain ESM), replicate `splitRawSentences` from
`accurate-patterns.ts:211`, and run over
`golden/fixtures/{nenko-hGdbIzNsDw8,imiron-fe5kdBLS8wM}.md` with `[HH:MM:SS]`
stamps and `**speaker**` prefixes stripped. §3–8 are read from the shipped
source and are stated with file and line so each can be checked without running
anything.*

---

## 14. TWC — CORRECTION to AUDIT-2026-08-01 §2 (verified 2026-08-02)

**The prohibition I cited does not exist on the live site.** AUDIT §2 quoted
利用規約 §2(2)「NLTの検索結果の複製を禁じます」 and recommended deleting the
scraper on that basis. Fetched today, `https://tsukubawebcorpus.jp/`'s
「ご利用にあたって」 has five clauses and **none of them prohibit reproduction**:

1. browser requirements 2. cookies must be on 3. results are machine-processed
and contain errors 4. **if you publish a paper/article using NLT for 研究・教育,
cite it and notify jp-kyoten@un.tsukuba.ac.jp** 5. takedown requests for 用例 —
the corpus is 教育・研究目的 and every 用例 displays its source page title and URL.

The site also ships `/download_request/collocation` and `/collocation_download/`
— a sanctioned export path. The `agreed` cookie is clause 2's cookie
requirement, not a consent wall with a separate legal text behind it.

So the standing conclusion "delete, do not fix" was wrong, and the memory
recording it should be corrected. What the terms DO impose is an attribution
duty (clause 4) and an implicit provenance norm (clause 5) — which is §28 S2,
the plugin's own invariant, so it costs nothing to honour.

### The real data model (endpoints decoded from `LWP.headword.min.js`)

```
/headwordlist_all/    jqGrid JSON — headword, headword_id (N.00001), yomi, romaji, freq
/pattern/             文法パターン  — the "different ways it attaches"
/collocation/         collocates per pattern
/example/  /context/  用例 + KWIC
/basicinfo{b,ky,js,sj}/   the basic-info panels
/collocation_download/    the sanctioned export
```

Verified live: `GET /collocation/N.00002/` → HTTP 200, clean JSON,
`{"page":1,"total":437012,"rows":[{"collocation":"{こと}ができる","freq":896141,
"mi":7.4,"logdice":12.47}, …]}`.

**That is strictly richer than Hyogen**: Hyogen has direction + POS + sense +
raw items with no counts; TWC adds **frequency, mutual information and logDice**
per collocation — association strength, which is the one thing that separates
"attested once in 青空文庫" from "this is how the word actually behaves". The
plugin has no frequency signal today from any source (per
DICTIONARY-INFORMATION §, only 現代国語例解 carries counts, in 1 of 35 books).

### VERIFIED WORKING (2026-08-02)

Two of the three layers answer correctly, headword-scoped:

**1. Headword resolution** — `GET /headwordlist_all/` → jqGrid JSON:
`{headword, headword_id: "N.00002", yomi_display, romaji_display, freq}`.
~20k headwords over 1,006 pages of 20. Also published as an official xlsx
(`/static/xlsx/NLT1.40_freq_list.xlsx`, 研究・教育目的).

**2. THE GRAMMAR PATTERNS** — `GET /patternfreqorder/<headwordId>/` → 200,
headword-scoped, 50 rows. For `N.00002` (の):

| id | pattern | freq | % |
|---|---|---|---|
| J001 | の＋助詞 | 3,739,412 | 53.8 |
| K001 | の＋助動詞 | 3,211,167 | 46.2 |
| B001 | 動詞基本形＋の | 2,530,515 | 36.4 |
| B003 | 動詞過去＋の | 868,951 | 12.5 |
| B004 | 動詞連用形＋ている＋の | 457,647 | 6.6 |
| E001 | 形容詞基本形＋の | 409,051 | 5.9 |

**This is the view the whole feature is for** — every grammatical position the
word occupies, ranked by how much of its real usage each accounts for. Hyogen
gives direction (風～ / ～風) and nothing else; this gives the full paradigm
with shares. Nothing else in the plugin has it.

### RESOLVED 2026-08-03 — it was the HTTP method

The blocker was `/collocation/` returning こと's rows for every word. The devtools
capture settled it: the panel issues **POST**, and every earlier attempt had been
a GET. Holding all parameters constant and varying only the method:

| request | result |
|---|---|
| `GET /collocation/N.25644.J001/?headword_collocation_id=…&_search=true…` | 200 · rows tagged `N.00001.A001` — **こと** |
| `POST` same path, same body, **no cookie, no CSRF, no headers** | 200 · rows tagged `N.25644.J001` — **風** |

Everything I suspected was load-bearing was not. There is no session to
establish: `GET /` sets no cookie and no page carries a `csrfmiddlewaretoken`, so
the CSRF handshake I first wrote would have thrown on every lookup while
obtaining nothing. `X-Requested-With` and `Referer` are sent only because the
site's own jqGrid sends them; both were verified optional.

Two further measured facts: the site **403s on request bursts** ("temporarily
unavailable" — this masqueraded as a `Referer` rejection until the probes were
re-run 6s apart), and the collocation grid **sorts globally across pages**, so
`rows=100` returns the true top 100 by frequency rather than an arbitrary page.

Also corrected: `/patternfreqorder/` is the **complete** pattern enumeration. I
had assumed its `J001`/`B001` ids were a different namespace from the `C###` ids
seen in the capture; they are the same list, and every id keys `/collocation/`.

**Built.** `src/scraper/twc-parse.ts` (pure) + `TsukubaWebCorpusScraper.ts`
(transport, rewritten — it previously scraped `/search/?q=…`, a page that holds
no data, and so reported success having found nothing for every word since it was
written). Three requests plus one per pattern, spaced, capped at `MAX_PATTERNS`.
`golden/twc.mjs`, 53 checks against byte fixtures captured 2026-08-02.

The original warning stands and is now enforced in code rather than prose:

> A parser written against an unverified request is the Hyogen failure exactly:
> 200 OK, well-formed JSON, wrong word, no error.

`parseCollocates` re-checks `headword_collocation_id` on every row and drops
foreign ones, and `golden/twc.mjs` keeps the real こと response
(`fixtures/twc-colloc-LEAK.json`) as a fixture, so the guard cannot be removed
without a red suite.

### RESOLVED 2026-08-03 — the 用例 layer

`/example/` was 500ing on every parameter shape because I was sending
`collocation_id`. The field is **`headword_collocation_id`** — the same name the
collocation grid uses, despite the value being a collocation id.

Settled by properly deobfuscating `LWP.headword.min.js`. The earlier attempt
failed because obfuscator.io **rotates** its string table at load (a
self-modifying IIFE that shifts the array until a checksum passes), so no static
offset can be right; and I had grabbed the wrong helper. The structure is plain
once seen — `var _0x23c1=[…327 strings…]`, decoder `i - 0x94`, rotation 175 —
and brute-forcing the rotation against call sites where a literal forces a
neighbour's value (`$t['jqGrid'](_0x(0x9e), _0x(0x10f))` ⇒ `getGridParam`,
`postData`) verifies it before a byte is trusted. `loadExample` then reads
plainly.

What the layer gives is the best part of the whole integration: **attested
sentences that know where they came from** — document title, source URL,
`fileid`/`sentenceid`, and `bold_start`/`bold_end` marking the collocation's
exact span. §28 S2 says provenance is never dropped, and until now a 語法 example
was a bare string sourced to the literal word "corpus". `GohoProfile.sourced`
carries it through the freeze and `captureCorpus` files the real document.

Two things measurement corrected mid-build:

1. **Identity cannot be checked on the highlighted text.** The collocation list
   is lemmatised; the sentences are surface. 「子供の風」 is attested as
   「子どものかぜ」, 「風を」 as 「かぜを」. A string-equality guard (which I wrote
   first) would have thrown away correct data. The right check is
   **`records` == the collocate's `freq`** — exact for 風を (145), 子供の風 (2)
   and 走っている (16,760).
2. **`GET /example/` returns 500**, unlike `/collocation/` which returns someone
   else's rows. This endpoint fails loudly; the count guard is there because
   "loud today" is not "loud forever".

### Also fixed: homographs were being chosen away silently

`風` is two words in TWC — 形容動詞 フウ (80,779例) and 名詞 カゼ (322例) — and
`profile()` was taking the most frequent without saying so, quietly answering a
different question than the one asked. `resolve()` now returns every lemma and
`profile()` hands back `alternates`, which become facet buttons
(`風〈カゼ・名詞〉322例`). The Notice states the reading and POS profiled.

Deliberately NOT "fixed" by preferring 名詞: in this corpus 〜風 really is 250×
more frequent, and overriding a measured ranking with an intuition about which
sense "must" be meant is inventing data.
