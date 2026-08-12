# What this plugin is FOR, and where it stops short of it (2026-08-05)

Third pass. `AUDIT-2026-08-01.md` audited five surfaces and the parser question.
`AUDIT-PARTS-2026-08-01.md` went part by part asking "what is this doing?".
Neither asked the question this document asks: **given what DESIGN says the
plugin is for, what is structurally absent?**

Method: read DESIGN §1–28, CLAUDE.md, both audits, and the tree at HEAD `70552d0`.
Then measured the **live vault blob**
(`Documents/Lenovo/.obsidian/plugins/jp-collocations/data.json`, 9.9 MB) and the
**converted dictionary shelf on disk** (`Documents/Lenovo/JP Dictionaries/`,
35 books). All 68 golden suites pass; nothing in the tree was modified.

Most of what the two August audits ranked is now done — verified in code, not
assumed: `attestationKey` carries the quote (`pattern-store.ts:239`),
`frontmatterSources` is plural-only, `matchJapanese` is shared by both search
surfaces (`search/match-japanese.ts`), `BigDictStore.lookup` deinflects,
`annotate()` inherits register/position/tier from the firing surface
(`accurate-patterns.ts:252`), Hyogen parses `col_midasi1`/`font8`, TWC is built
and POST-only, `watchReaches` fires from the capture path, `_componentGold`
exports, `state.field(true)` is fixed, selection-echo shipped. Still open from
those lists: `after-noun` is still `isAfterKanjiOrKatakana` (`match.mjs:71`), and
`components.ts` is still imported by `DiscourseModeView` alone — layer 2 is not
under the calculus.

What follows is not those lists. It is what the *live data* says.

---

## 1. The funnel, measured — the picture that explains everything else

| chain stage (§28) | what exists today |
|---|---|
| encounter → **mark** | **98 marks** in the tray (67 yt / 31 tv), 2026-07-20 → 08-02, **1** carries a seed |
| reconcile | works; 112 transcript files reached |
| **classify** | **50 of 305** entries are class-ratified. 🔵 collocation: **0 entries**. 🟡 serifu: 183 entries, **0 ratified** |
| **attest** | 18,143 attestations — **17,891 suggested (98.6%)**; 28 entries hold **99.6%** of them; 273 entries hold none |
| index → retrieve | works |
| **drill** | **4 cards** in the SRS deck (167 entries are eligible) |
| **produce** | 2 発話 sessions, 1 🎤 mark, 0 ratings; production gold has no exporter |
| the hole (§27.0.2) | **1 reach** ("undergo"), **0 offers ever made** |
| measurement (§6.5) | **2 ratification rows, both `skip`** → `report()` cannot state a number |

The product is the last box. **The mass is in the fourth.** Everything from
`classify` rightward is running at roughly 1% of what `attest` produces, and the
one instrument built to tell you whether any of it works has two rows in it.

This is not a motivation problem and it is not a parser problem. Six structural
facts produce it, and they are the rest of this document.

---

## 2. There is no meaning-side index — so the governing use case cannot be served

> **BUILT 2026-08-06.** A third shard family, `intent-NNN.jsonl`, keyed on the
> normalized English through the SAME `normalizeFrame` the Japanese side uses
> (`intentionKeyOf`), so a want and the row filed under it cannot drift apart.
> `lookupIntent` / `BigDictStore.intention()` are the §27.2 query; `reach.ts`
> gains an `intention` offer reason, checked BEFORE the token test because an
> English want cannot token-match a Japanese surface and has no slots to make it
> a frame — there was previously no branch it could reach, which is why the one
> open reach on this vault had zero offers.
>
> **No re-import was needed.** The claim below — that the material is discarded
> — was half right: the *key* was discarded, but `StoredCandidate.i` holds the
> English text on every frame row already. `buildIntentIndex` re-keys what the
> vault holds; `passes` bounds peak memory (one grouping pass over 英辞郎 would
> hold ~1.8M rows). Built over the live shelf: **35/35 dictionaries, 4,741,384
> intention keys, 5,515,333 candidates, 131 seconds.** Deep verification of all
> three families afterwards: 35/35 clean. `golden/intent-index.mjs` (41 checks)
> pins the key space, the derivation, the pass-invariance and the offer.
>
> Live result — the reach `"undergo"`, open with 0 offers since it was created:
>
> ```
> 経験する、被る…      [intention]  辞書が「undergo」の項に入れています
> 受ける…              [intention]  （誰かの分類であって、意味の同一ではありません）
> 耐える、我慢する      [intention]
> ```
>
> **One defect this surfaced, NOT introduced by it and not fixed here.** 英辞郎
> appends its example sentence to the gloss with no markup at all, so the
> example lands inside the frame KEY and inside the reach surface:
> `経験する、被るThe Japanese economy underwent a big change. 日本経済は…`.
> `DictSense.example` exists (added by `0cf29df`) but `eijiro.ts` never
> populates it — that fix landed in the other adapter. Measured on a 32-shard
> sample: **1,072 of 125,307 candidates (0.9%)**. It is the frame index's shape
> too, so correcting it changes the key space for 2.36M rows on a textual
> heuristic (the boundary is "Japanese char immediately followed by a
> capitalized Latin word in a sentence ending in `.`/`?`/`!`") — a data decision,
> left open deliberately.

This is the deepest one, and it unifies three things that have been treated as
separate: the production entry points (§27.2), the EN↔JP direction (§27.0.1),
and the collision watcher (§27.0.2).

**The donor essay's worked example is a query.** You wanted to say *"at some
point"*; no dictionary had it; you later *heard* どっかのタイミングで and
recognized it. §27.0.1 calls that the governing use case. As a query it is:
*given a meaning I can only name in English, what Japanese reaches for it?*

**The plugin can be entered by two keys, and neither is meaning.**
`sidecar.ts` writes exactly two shard families — `head-*.jsonl` keyed on the
headword (`headPath`, line 100) and `frame-*.jsonl` keyed on the normalized
Japanese frame (`framePath`, line 101). That is the whole index.

The meaning side **is parsed, is keyed, and is then discarded at the last hop**:

- `eijiro.ts:91` — `intentionKey: string; // normalized key of the ENGLISH side — the intention index`
- `eijiro.ts:257` and `generic-yomitan.ts:1282` compute it for every candidate;
- `packCandidate` (`sidecar.ts:126`) stores `s/i/h/p/t` — surface, intention
  *text*, hint, shape, situation — and **no key for the intention**;
- `unpackCandidate` (`sidecar.ts:131`) and `big-dict.ts:316` both hand back
  `intentionKey: ''`.

So 2,360,787 English intentions are sitting in the shelf as payload strings with
no way in. §27.2's four production entry points score: **by headword ✓, by frame
✓, by situation ✗, by gesture/image ✗, by intention ✗.** Eijiro's 〔situation〕
brackets — which §27.1 calls the production-condition and the reason Eijiro is
"already half-built toward a production index" — are stored as `t` and indexed by
nothing.

**And the headword page is missing its production half too.** `HeadLine` is
`{k, e: Omit<DictHeadword,'reachFor'>}` (`sidecar.ts:113`) — the head shard
deliberately holds "the LOOK-UP half only". That was a sound size decision, but
nothing rejoins them: `lookup()` returns entries without `reachFor`, and
`LexiconPanel.ts:858` calls `big.lookup(query)` and `big.frame(query)` with the
*same string*, so the candidates only appear when what you typed was already a
Japanese frame shape. §27.2's "a headword page is a PRODUCTION page: senses, then
the pre-classified reach-for candidates, then YOUR lived attestations" is, in the
code, senses only.

**The same absence is why the hole has never collided once.** `collide()`
(`reach.ts:167`) has three offer reasons and the live reach — want `"undergo"` —
can trigger none of them:

- `token`: `surface.toLowerCase().includes(t)` where `surface` is a Japanese
  attestation quote. An English want cannot be a substring of Japanese. (The
  first audit named this; it is unchanged, and it is not a bug in `reach.ts` —
  there is simply nothing else to match against.)
- `frame`: requires `frameOfWant()` to find a slot in the want. "undergo" has none.
- `juxtapose`: `juxtaposeLimit ?? 0` — off unless a caller opts in, and
  `golden/reach.mjs` pins that default ("silence over noise").

So the mechanism §27.0.2 calls *"the most alive part"* is wired correctly, fires
correctly, and has produced zero offers in two weeks — because **every offer test
is a string test, and a want is a meaning.** A want written the natural way (in
English, or as a felt paraphrase) is unmatchable by construction.

**These are one deficiency, not three.** The plugin holds meanings on the
Japanese-surface side only. The material to fix it is already parsed and already
in the vault; it is dropped by two lines in `sidecar.ts` and one in `big-dict.ts`.
An intention index (`intent-*.jsonl`, same shard machinery, keyed on
`normalizeLookupKey(intentionKey)`) would at once give: English/paraphrase entry
into 2.36M production candidates, a fourth offer reason for `collide()` that
works in the space wants are actually written in, and the situation axis.

That is the difference between a dictionary that answers *"I met X, what is it?"*
and one that answers *"I want to say THIS"* — which §27.0 says is the entire
design act.

---

## 3. The six classes are a colour and a key, not analytic objects

DESIGN §7 is explicit: *"A note type is **not** just a callout color — each is a
distinct analytic object with its own payload and its own index key."* It then
specifies each payload. The implementation has **one flat payload for all six**
(`pattern-store.ts:99-126`): `parts, frame, lemma, halo, gloss, family, goho,
scaffold`.

What §7 specified and the store cannot hold:

| class | §7 payload | in `PatternEntry.payload` |
|---|---|---|
| 💠 phrase_schema | frame, **slots[{span, fillers[]}]**, stance | `frame` only |
| 🟠 skeletal | components, constructedMeaning, **crystallizations[]**, fillers[] | `parts` only |
| 🟢 rhet_collocation | lemma, haloSpans, **gestureName**, gestureFamily | `lemma`, `halo`, `family` |
| 🔵 collocation | spans, **patternId** | — |
| 🟡 serifu | spans | — |
| 🔴 discourse | **role**, operatorChainRef | — |

`grep -rn "crystallizations\|constructedMeaning\|gestureName\|stance" src/` returns
nothing. `CaptureModal` collects exactly five fields (`CaptureModal.ts:388-394`):
parts, frame, lemma, halo, gloss.

Two consequences are visible in the live data, and both are worse than they look:

**(a) `payload.gloss` is empty on all 305 entries.** Gloss is where 🟢's
*gestureName* was folded — "3–8 words: the move performed", the thing §7 says
the gesture catalog is a catalog OF. So the gesture catalog has 6 entries and
**zero gestures**. It is currently a list of six lemmas with five halos.

**(b) `payload.family` has no writer anywhere in `src/`.** `LexiconPanel`
*reads* it in two places (the `…族` badge at :963, the 似ている表現 box at
:1074) and nothing ever sets it — not `CaptureModal`, not any command. The live
count is 0. So the box §26.2 calls **"the flagship innovation of the section"** —
the user's own image-discrimination theory self-assembling from their captures —
can only ever render its fallback branch (other gestures of the *same* lemma).
The cross-lemma case (漏れなく / 一つ残らず / ことごとく) is unreachable because
**there is no surface anywhere that can put two lemmas in one family.**

And the deeper cost: `crystallizations` and slot `fillers` are where *what varies*
lives. Without them the catalog records that a frame exists but never what fills
it, so the plugin cannot answer "what else goes in this slot?" **from your own
captures** — only from dictionaries. For a production lexicon that is the wrong
way round: §22.3 says lived outranks curated everywhere else.

---

## 4. The catalog admits the pipeline's own failures as noticings

`main.ts:5100-5112`, the live reconcile path, with its own comment:

```ts
// anchored results attach an attestation (video+time+anchor), unanchored
// ones still create/touch their entry so the pattern accumulates
const att = anchorId && r.best ? {...} : null;
return { note: r.note, att };
```

Every OCR result becomes a `PatternEntry`, located or not. (The one-time
migration at `main.ts:356` did the same for the whole recon library.) Measured
consequence: **162 of 305 entries (53%) have zero attestations** — 107 🟡, 53 🟠,
2 💠. Reading them is the fastest way to see the problem:

- **OCR noise as first-class entries**: `sあ` · `ssa` · `ありに言きゃくしり` ·
  `キーぎーぢゃウウスの行為` · `暴が×ゅ〜ソレラ` · `7/12` · `には`
- **The same noticing stored twice**, differing only by a misread —
  `肩に力を入れた` / `腸に力を入れた`, `耳目を開く` / `耳目を関く`,
  `しゅうれんしてきまってる` / `しゅうれんしてきてまってる`,
  `意図してない...` / `意図としない...`. That is **S1 broken at the source**:
  one object has become two, and no surface can ever reconcile them.
- **The plugin's own rendered output, re-ingested**:
  `▶YouTube(156:11):https://youtu.be/…` · `⏱原文:![[Transcripts/…#^recon-2k5xyw]]` ·
  `📄[[…]]` · `🟡〜セリフ〜160:38` · `⚠️ 相違: 「取」〜「と」` ·
  `⚠️ 漢字違い: 「知」〜「地」` · SRS card bodies complete with `【_____】`.

The last group has a second failure inside it. `derivePattern` reads the
handwriting DSL — *"parts joined by 〜 → 🟠 skeletal"* (`pattern-store.ts:14`) —
and applies it to text that was never written in that DSL. So
`⚠️ 相違: 「取」〜「と」` (a correction record) and `🟡〜セリフ〜160:38` (a card
label) are stored as **skeletal component-links**. Five of the 53 zero-attestation
🟠 entries are correction records; five more are card labels.

None of this is recoverable by ratifying harder. The catalog needs an **admission
rule**: an entry that never located is a *failed reconcile*, not a noticing.
It belongs in the same quarantine the tray already implements for drops and the
sweep already implements for candidates (`status:'suggested'`) — visible,
un-lost, and out of the catalog's counts, ranking and SRS until a human says
otherwise. The doctrine exists three times in this codebase; the reconcile path
is the one road that skips it.

---

## 5. Marks are emitted and never harvested — the back half has no fuel

§25.1 is a two-clause law: *"Live phases emit MARKS. Harvest phases do the
thinking."* Clause one is built and used: **98 marks, over 14 days, from two
mediums** (67 yt, 31 tv). 鑑賞モード works; the gesture works.

Clause two has never run. Evidence, all from the live blob:

- **0 attestations exist with `medium:'tv'`** — while 31 TV marks sit in the tray.
  The whole Plex/jimaku road ends in the inbox.
- **1 of 98 marks carries a seed.** §25.1's own hardening says a mark recovers
  the medium's content, never yours, and the seed is the retrieval cue. Without
  it, a two-week-old mark is a timestamp whose thought is gone.
- Nothing anywhere says "you have 98 marks". They render as cards among 103 in a
  tray whose other job is drop-quarantine.

This is why the funnel in §1 looks the way it does. The back half of the chain
(classify → drill → produce → measure) is starved of exactly the material the
front half is successfully collecting, and the two are separated by a step that
has no trigger, no surface of its own, and no count.

The corollary bites the measurement problem directly. §28 S3's hardening —
**"ratification must be a byproduct of study, never homework"** — was built
(`study/ratify.ts`, 63 checks) and is correct. But **study itself was never made
a byproduct of anything.** The deck has 4 cards because a card requires a
confirmed attestation, which requires ratification, which is a byproduct of
study. That is a closed loop with one external entrance (hand capture), and the
98 marks are the obvious fuel sitting outside it.

The harvest is the missing stage, and it is one surface: walk today's marks,
each re-manifested in its own medium (`resolveMarkContext` already does this),
each one tap from capture. Everything downstream already exists.

---

## 6. 英辞郎's reach-for index is 64% absent on disk, and nothing can see it

> **RESOLVED 2026-08-05.** Cause confirmed (not inferred): `dropSidecar`
> deleted `listFiles` order sequentially, where `frame-*` sorts before `head-*`
> before `meta.json`, so an interrupted drop takes a contiguous run of frame
> shards and leaves the meta that vouches for them. Fixed three ways:
> `dropSidecar` now removes meta FIRST, so an interrupt leaves a folder repair
> can see; `verifySidecar`/`verifyAllSidecars` check disk against meta and are
> run by the repair command, which previously reported this dictionary as 正常;
> `golden/sidecar-verify.mjs` (29 checks) pins the gap. The index was rebuilt
> from `Documents/vibecode/eijiro-yomitan.zip` — **frame shards only, heads
> untouched** — and is now 512/512 with `meta.frames` corrected to the true
> **1,753,486**. Deep verification of the whole shelf: 35/35 clean.
>
> Two things the rebuild turned up that the section below did not know:
>
> 1. **The surviving 186 shards were the stale half, not the good half.** The
>    conversion ran 2026-07-26; commit `0cf29df` (2026-08-03) fixed the
>    duplicated `label`/`register` token that produced surfaces like
>    「英希望退職に応じる」 and 「話ほぼ恋人の男性」. A control shard replayed
>    through today's adapter did not match disk — 816 leaked surfaces in a
>    4-shard sample, now 0. **The head shards are the same 2026-07-26 vintage
>    and still carry that bug in their glosses.** They were left alone
>    deliberately; re-converting them is a separate decision.
> 2. **Neither Yomitan backup can rebuild this dictionary.** Both 12.7GB files
>    register 36 dictionaries and 英辞郎 is in neither — it was converted from a
>    zip and was never in Yomitan, which is exactly why `convertDexieBackup`
>    protects it. The only source is the zip above.

Measured on the shelf, not inferred.

`JP Dictionaries/英辞郎 v144/meta.json` declares `shards: 512`,
`headwords: 2360787`, `frames: 1759832`.

On disk:

| | declared | present |
|---|---|---|
| head shards | 512 | **512** |
| head lines | 2,360,787 | **2,360,787** (exact) |
| frame shards | 512 | **186** — indices **326–511 only**; 0–325 absent |
| frame lines | 1,759,832 | **639,539 (36.3%)** |

Density confirms the arithmetic: 639,539 ÷ 186 = 3,438 lines/shard; × 512 =
1,760,256 ≈ the declared 1,759,832 (0.02% off). **~1.12M reach-for candidates are
simply not there.**

It is specific to Eijiro. Every one of the other 34 books has a complete frame
index (checked all 35: `frame` shard count equals `shards`, or equals what a
book that small can fill).

**And the failure is perfectly silent.** `frame()` computes
`framePath(dir, hash % 512)`; `sidecar-io.ts:28` returns `null` for a missing
file; `decodeLines(null)` returns `[]`. A reach-for query whose key lands in the
missing 63.7% of the key space returns **no candidates, no error, no empty
state** — indistinguishable from "the language has no answer for this shape."
This is the Hyogen shape (AUDIT §1) and the TWC GET shape (CLAUDE.md), a third
time, in the single asset §27.4 calls *"the reach-for engine… the one the user
most wants realized."*

Nothing checks. `repair-big-dictionaries` reconstructs a *missing* meta and
explicitly skips any folder that has one — `if (hasMeta && await readMeta(...))
{ alreadyOk.push(name); continue; }` (`sidecar.ts:318`). A meta that is present
and **lying about its own counts** is exactly the case it cannot reach.
`sidecar-coverage` (`main.ts:1525`) reports the *discourse* sidecar; nothing
reports on dictionaries.

Likely mechanism, worth confirming before fixing: `dropSidecar` prefers
`io.listFiles(dir)` and deletes what it finds, and `frame-*` sorts before
`head-*`. An interrupted drop therefore eats low-numbered frame shards first and
leaves the heads and the high frame shards — which is precisely the pattern on
disk. If so the fix is two things: make the drop tolerant/resumable, and give
`repairSidecarMeta` a **verify** mode that compares declared counts against the
shards actually present, for every folder, meta or no meta.

---

## 7. Three kinds of knowledge the entry cannot hold

From `DICTIONARY-INFORMATION-2026-08-01.md`, restated as a data-model claim:
`PatternEntry` has **no field for register, no field for negative evidence, and
no field for frequency/priority**.

- **Negative evidence.** WISDOM ships ~2,900 `╳…は不可` marks. For 🔵 that is the
  **swap test already run** — the operational test §7 uses to *define* the class,
  pre-computed by a professional lexicographer. There is nowhere to put it. The
  ❗ personal box (§26.2) renders `rejectedExamples` — your own ✕'d sightings —
  and is the right shape for this; today the live corpus has **1** rejection, so
  the box is empty everywhere while 2,900 authoritative "you cannot say this"
  facts sit unindexed on disk.
- **Conversational function.** 新明解's 運用 field (~700 entries,
  e.g. 「それはむずかしい」＝婉曲に断わる) is 🔴's own evidence — a curated
  statement of what an utterance *does* in discourse, which is exactly the layer
  the machine cannot infer and the human has to supply.
- **Frequency / priority.** TWC now delivers freq, MI and logDice per collocate
  and it lands in `payload.goho` — for display only. `grep -rn "svl\|logDice"
  src/srs/ src/lexicon/` returns nothing. §27.4 promised SVL → SRS ordering and
  capture-worth; the signal now exists and reaches neither.

`register` deserves its own line. It is, per AUDIT-PARTS §1, *"the field that
decides whether a phrase is sayable in a given situation"* — the most
product-relevant annotation there is. It was restored **for detected discourse
patterns** (`annotate()` inherits it now). It still does not exist **on a catalog
entry**: the plugin cannot record that a phrase you captured is casual, and only
1 of 35 books carries the field to fill it from. For a production lexicon whose
whole question is "can I say this, here?", that is the gap that most deserves a
schema field.

---

## 8. Two standing items, unchanged, that this data re-prices

- **`after-noun` is still "the previous character is Japanese"** (`match.mjs:71`).
  Measured cost was 25.2% false positives on TOPIC-PRESENT, itself 21.6% of all
  hits. The re-pricing: the 17,891 suggested attestations in the live catalog are
  **99.6% concentrated in 28 discourse markers** — ですね (3,565), かな (2,008),
  んですけど (1,641)… So this operator's precision is not a corner of the system;
  it is most of what the catalog currently contains.
- **Layer 2 is still not under the calculus.** `components.ts` is imported by
  `DiscourseModeView.ts` only; `calculus/moves.mjs` mentions it in a comment
  (line 198). AUDIT §6.6 named this as the mechanical reason REJECT fires zero
  times in 1,042 turns. Unchanged since Jul 19.

Also worth recording: **provenance is still wrong in the stored corpus even
though the code is now right.** 112 files claim `medium:'yt'`; 10 of them have no
YouTube id in the filename, including `ガリレオ第5話…md` and `Galileo S1E05.md`
(TV) — **2,162 attestations** claiming a medium they do not have, plus 333
attestations with no door back at all. `buildConcordance` was fixed; the rows it
already wrote were never migrated. `blob-migrations.ts` is where that belongs.

---

## 9. What follows, ordered by principle served ÷ effort

| # | action | effort | the principle it restores |
|---|---|---|---|
| 1 | **Verify mode for dictionary sidecars** (declared vs on-disk counts, every folder); re-convert 英辞郎 | ½ day | S6 — the largest asset stops failing silently |
| 2 | **Harvest surface**: walk today's marks, re-manifested, one tap to capture | 1–2 days | §25.1 clause two; it is the only fuel the back half has |
| 3 | **Admission rule for the catalog**: an unlocated reconcile is quarantined, not an entry; purge the 162 | ½ day | S1 + the attested-lexicon identity |
| 4 | **Intention index** (`intent-*.jsonl`, reusing the shard machinery) + a fourth offer reason for `collide()` | 2–3 days | §27.2 by-intention/by-situation; the donor essay's own query; the hole finally collides |
| 5 | **Per-class payload fields** (💠 slots+fillers, 🟠 crystallizations, 🟢 gestureName) + a family picker | 2 days | §7's "distinct analytic object"; unblocks the 似ている表現 flagship |
| 6 | `register` on `PatternEntry` + WISDOM ╳ into the ❗ box + 新明解 運用 onto 🔴 | 2 days | the swap test pre-run; 🔴's own curated evidence |
| 7 | Migrate the 2,162 mis-mediumed attestations | 1 hr | S2, retroactively |
| 8 | `after-noun` te-form guard; wire layer 2 under the calculus | ½ day + 2 days | as priced in AUDIT-PARTS |

Items 1–3 are each under two days and together move the funnel in §1 more than
any parser work can: 1 makes the shelf answer, 2 gives the back half material,
3 stops the catalog counting its own failures as noticings.

Item 4 is the one that changes what the plugin *is*. Everything else on this list
makes the existing chain work. Item 4 is the missing half of §27's inversion —
and the material for it is already parsed, already keyed, and already in the
vault.

---

*Reproducing §1: parse the plugin blob and count `_patternStore.entries`,
their `attestations` by `status` and `medium ?? source`, `_inbox.cards` by
`kind`, `_ratifications.rows`, `_srsDeck.cards`, `_reaches.reaches`.
Reproducing §6: `ls` the shard files under each `JP Dictionaries/<title>/` and
compare the counts to that folder's `meta.json`. §2–5 and §7–8 are read from the
shipped source and are cited by file and line.*
