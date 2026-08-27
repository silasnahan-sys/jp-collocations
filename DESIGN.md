# DESIGN — Handwriting Reconciliation Pipeline

Status: **contract locked, pre-implementation.** This document is the agreed
design for the handwriting → transcript reconciliation feature. It is written
*before* code so the reliability boundaries are fixed up front. Code that
violates an invariant in §2 is a bug against this document, not a judgment call.

The **5 note types are now defined** (§7, resolved from the user's design chats).
What remains open is per-type payload detail, called out inline in §7.

---

## 1. What it does

While watching a Japanese YouTube video the user jots phrases by Apple Pencil
in Apple Notes — phrases they *think* they heard, which may be misspelled,
abbreviated, cut off, or simply wrong. The pipeline:

1. ingests the handwriting image and the user's recent YouTube history,
2. fetches the full transcript of each watched video,
3. writes those transcripts into the daily note under per-video headings,
4. OCRs the handwriting and **reconciles each phrase against the transcript**
   (the transcript is ground truth — it corrects both the user's shorthand and
   the transcript's own ASR errors),
5. wraps the matched transcript span in a typed, colored callout with ±2 lines
   of context and a confidence score,
6. surfaces those callouts in a sidebar **library** as block-embeds — no new
   notes; the daily note remains the single source of truth.

A worked example of the reconciliation output already exists at
`samplenotes-reconciled.md` (built by hand from `testtranscript.md` +
`samplenotes.png`). That is the target *callout* shape.

> **Implemented 2026-07 (in-transcript anchoring).** Callouts are written INTO
> the transcript file itself (`src/notes/transcript-anchor.ts`), wrapping the
> real timestamped lines — no separate `-reconciled.md` report. The context
> window grows per side to char/second minimums, extends while the boundary
> clause is unfinished (continuative particles — captions have no 。), and is
> hard-capped; the SAME window drives the audio clip range. `stripAnchors` is
> the exact inverse of `applyAnchors` (golden-proven roundtrip), so re-runs are
> idempotent, and other notes-files' anchors on the same transcript are
> re-planned from their persisted library entries (`entryToResult`).
> Overlapping windows merge into one callout block (one `^recon-id` per block —
> an Obsidian constraint); embeds/cards target the cluster anchor while card
> and library ids stay per-note. See `golden/anchor.mjs`.

---

## 2. Reliability invariants (the locked contract)

These are non-negotiable. Every module is built to satisfy them.

1. **Markdown is the source of truth.** All real content lives as plain
   Markdown in the daily note: full transcripts under headings, reconciled
   phrases as callouts with stable block IDs. The library holds *references*
   (`![[daily#^id]]`), never copies. Uninstalling the plugin leaves every note
   readable. No database, no lock-in.
2. **One adapter per external silo.** Each thing that reaches into someone
   else's system (YouTube history, YouTube transcripts, the Claude API) lives
   behind a single file implementing a stable interface (§4). When the silo
   changes, exactly one file changes. Errors are surfaced verbatim. This is the
   `XClient` isolation rule applied throughout.
3. **Every stage degrades soft.** No stage may all-or-nothing the run:
   - history scrape fails → fall back to manual paste of video IDs/URLs;
   - a video has no captions → skip it with a logged note, keep going;
   - no Claude API key / model error → local matching still reconciles; only
     the hard-case disambiguation is lost.
4. **Transcripts are fetched once and frozen.** Once a transcript is written
   into the daily note it is never re-fetched. A future YouTube change cannot
   retroactively alter or break past notes; only *new* videos hit the network.
5. **Idempotent, re-runnable.** Stable identifiers everywhere — videos keyed by
   video ID, callout block IDs derived from a content hash. Re-running the
   pipeline merges/updates; it never duplicates.
6. **LLM output is schema-validated and model-pinned.** The Claude response is
   validated against a JSON schema (structured outputs). The model ID lives in
   **one** constant; refusal/fallback is handled. A model swap is a config edit.
7. **Confidence on every note; nothing wrong ships silently.** Each reconciled
   note carries a confidence score. Anything below threshold is flagged in the
   note for human review. Every run logs what it skipped (no silent caps).
8. **A golden-set regression gates model/endpoint changes** (§6). Quality is
   *proven* to hold after a change, not assumed.
9. **The note-type taxonomy is data, not code** (§7). Defining or changing the
   5 types is a config edit, never a rearchitecture.

---

## 3. Data model

Lives in `src/notes/types.ts`. All times are epoch ms unless named `Sec`.

```ts
interface DateRange { since: number; until: number; }

interface WatchedVideo {
  id: string;          // YouTube video id (stable key)
  title: string;
  url: string;
  watchedAt: number;   // best-effort; from history grouping
}

interface TranscriptLine {
  index: number;       // 0-based position in the transcript
  tStartSec: number;   // caption start time
  text: string;
}

interface Transcript {
  videoId: string;
  title: string;
  url: string;
  lang: string;        // e.g. "ja"
  source: 'timedtext' | 'innertube' | 'manual';
  fetchedAt: number;
  lines: TranscriptLine[];
}

interface OcrCandidate {
  rawOcr: string;          // what the strokes literally say
  reconciledGuess: string; // model's best guess at the intended phrase
  confidence: number;      // 0..1, model self-reported
}

interface SpanCandidate {
  lineIndex: number;
  score: number;           // matcher score 0..1
  text: string;            // the candidate line(s)
}

interface ReconciledNote {
  blockId: string;         // ^id in the daily note; = hash(videoId+lineIndex+reconciled)
  rawOcr: string;
  reconciled: string;
  videoId: string;
  lineIndex: number;       // matched transcript line
  timestampSec: number;
  contextBefore: string[]; // ±2 lines
  contextAfter: string[];
  speaker?: string;        // inferred; may be absent
  confidence: number;      // combined OCR × match confidence
  noteType?: string;       // one of the 5 (§7); assigned in annotation
  status: 'auto' | 'needs-review';
}
```

---

## 4. Adapter interfaces (isolation boundaries)

Everything downstream depends only on these signatures, never on a silo's
internals. Fragile adapters are marked ⚠.

```ts
// ⚠ src/notes/yt-history.ts — the only file that knows YouTube's history DOM/API.
interface YtHistoryAdapter {
  /** Videos watched in range. Throws YtHistoryError (message surfaced verbatim).
   *  Caller degrades to manual ID entry on throw or empty. */
  listWatched(range: DateRange): Promise<WatchedVideo[]>;
  isAvailable(): boolean;            // for the health check
}

// ⚠ src/notes/transcript.ts — the only file that knows YouTube's caption endpoints.
interface TranscriptAdapter {
  /** Fetch once; caller freezes the result in the note.
   *  Returns null when the video has no captions (skip, do not fail). */
  fetch(videoId: string): Promise<Transcript | null>;
  isAvailable(): boolean;
}

// src/notes/local-matcher.ts — PURE. No network, no API. The durable backbone.
// IMPLEMENTED (2026-07-03). Validated on the 6 samplenotes-reconciled cases:
// 5/6 span-located correctly (one case the matcher beat the hand-annotated
// approximate timestamp), the ASR error 述→術 flagged, and the one heavy
// paraphrase correctly returned low-confidence → needs-review.
//
// Reading-space amendment (the Japanese-specific move): span LOCATION is fuzzy
// on SURFACE (char-bigram Dice ⊔ edit-ratio, sliding window) — robust to a few
// kanji swaps because most chars still match. Correction detection then aligns
// the note against the winning span in READING space via an injected resolver,
// so 効く / 利く / 聞く (all きく) are recognised as the same word and a kanji
// error becomes a *confident homophone correction* instead of an unexplained
// mismatch. YouTube's dominant error is homophone/kanji-choice, so this is what
// makes reconciliation accurate rather than surface-brittle.
type ReadingResolver = (surface: string) => string | null;  // DictionaryStore + deinflection in prod; word-level
interface LocalMatcher {
  match(phrase: string, lines: MatcherLine[], readingOf?: ReadingResolver): {
    best: MatchSpan | null;          // {startLine,endLine,tStartSec,text,score}
    alternatives: MatchSpan[];       // top-K for disambiguation
    contextBefore: string[];
    contextAfter: string[];
    corrections: Correction[];       // homophone (0.9) | kanji-swap (0.5) | edit (0.4)
    confidence: number;              // span score, penalised while corrections stay unresolved
  };
}

// ⚠ src/notes/ocr-reconciler.ts — the only file that calls the Claude API.
interface OcrReconciler {
  /** Vision OCR of a page → candidates. Schema-validated. Model id from one
   *  constant; refusal/fallback handled; falls back Haiku→Opus on low confidence. */
  readPage(image: ImageRef): Promise<OcrCandidate[]>;
  /** Disambiguate ONE low-confidence phrase among local candidates. Cheap call. */
  disambiguate(phrase: string, candidates: SpanCandidate[]): Promise<{ lineIndex: number; confidence: number }>;
}
```

The Claude client (`src/notes/claude-client.ts`) uses Obsidian `requestUrl`
(mobile-safe, same as `XClient`), sends the page image as base64, and reads the
API key from settings (a secret, stored like the X cookies). One model-ID
constant; structured-output schema enforced at the call boundary.

---

## 5. Reconciliation flow (Architecture B — transcripts never go to the API)

> **Implemented 2026-07-10 (handwriting stage):** `src/notes/claude-client.ts`
> (the only Anthropic-aware file; models pinned `claude-haiku-4-5-20251001` →
> escalation `claude-opus-4-8`; key in `settings.notes.ocrApiKey`, stored like
> the X cookies; `requestUrl` transport = mobile-safe) +
> `src/notes/ocr-reconciler.ts` (schema-locked JSON prompt that transcribes
> phrases EXACTLY as written — correction is the local matcher's job; parse →
> validate → escalate once; `mergeOcrPhrases` materializes phrases INTO the
> notes file under an idempotent `%% ocr:<imagehash> %%` marker as plain list
> items, so from that moment the text path owns everything and every line is
> hand-editable). Command **`ocr-reconcile-handwriting`**: OCRs every image
> embedded in the active notes file (wiki + md embeds, canvas-downscaled to
> ≤1568px ≈ 1,600 image tokens/page), materializes, then runs the standard
> reconcile flow (anchors → library → cards → clips unchanged). Golden:
> `golden/ocr.mjs` (27 pure checks + a LIVE call gated on env
> `ANTHROPIC_API_KEY` + `golden/fixtures/handwriting.png`).

Cost and reliability both come from keeping the transcript out of the model.

```
page image ──▶ OcrReconciler.readPage()         [Haiku 4.5, schema-validated]
                       │  OcrCandidate[]  (rawOcr, reconciledGuess, confidence)
                       ▼
            for each candidate:
              LocalMatcher.match(reconciledGuess, transcript)   [pure, free]
                       │
            ┌──────────┴───────────┐
   high score                 low score
        │                          │
   accept span        OcrReconciler.disambiguate(phrase, top-K)
        │                  [tiny call; Haiku, escalate page→Opus 4.8 if needed]
        └──────────┬───────────────┘
                   ▼
        ReconciledNote { confidence, status }
        status = confidence < THRESHOLD ? 'needs-review' : 'auto'
```

- The **local matcher is the backbone** — deterministic, no network, no model,
  the same matching family already shipped in `XCorpusStore`. If the API is
  down or the key is missing, the pipeline still produces matches from the OCR
  guesses; it just can't disambiguate the ambiguous ones (those become
  `needs-review`).
- The LLM **never reasons over the transcript**, so a model deprecation is a
  one-line swap re-validated by the golden set — not a redesign.
- Cost (per the pricing analysis): ~$0.01/day on Haiku, Opus only on the
  occasional low-confidence page. See the cost section of the project notes.

---

## 6. Golden-set regression (the long-term reliability tripwire)

Directory `golden/` (committed):

```
golden/
  001.page.png         # handwriting scan
  001.transcript.md    # the frozen transcript it maps to
  001.expected.json    # expected ReconciledNote[] minus volatile fields
  002.*                # more cases as they accumulate
  run.mjs              # node runner: reconcile each case, diff vs expected
```

`run.mjs` executes the full reconciliation on each case and diffs against
`*.expected.json`. **Match criteria** (tolerant of noise, strict on substance):

- `reconciled` text matches exactly (after NFKC),
- matched `lineIndex` within ±1 of expected,
- `confidence` is *not* asserted (it is allowed to drift),
- `status` (`auto` vs `needs-review`) must match.

Run it after **any** change to the model ID, the OCR prompt, the matcher
scoring, or a silo endpoint. A green golden set is the definition of "still
works." Seed case `001` is the page we already reconciled by hand in
`samplenotes-reconciled.md`.

**Text-note path — IMPLEMENTED (2026-07-03).** For digital notes (§10) the golden
case is `NNN.cases.json` (note text + expected span/status/corrections) over a
frozen `NNN.transcript.md`, plus a `readings.fixture.json` standing in for
`DictionaryStore` so homophone detection is testable offline. `golden/run.mjs`
(`node --experimental-strip-types golden/run.mjs`) reconciles each case and diffs
— tolerant on timestamp (±tol) and confidence, strict on located line, `auto` vs
`needs-review`, and each expected correction. **Seed `001` = the 6 real
samplenotes cases + one synthetic homophone probe (`レバレッジが効く`→`聞く`); 7/7
green.** Reading source in production is `makeDictionaryReadingResolver(store)`
(`src/notes/reading-resolver.ts`).

---

## 7. Note types — the six classes (v2, 2026-07-10)

Defined across the user's design chats (see project memories `five-note-types`
and `phraseological-schema-sixth-region`; v2 supersedes the v1 "Big 5" colors
and adds a sixth class). A note type is **not** just a callout color — each is a
distinct analytic object with its own payload and its own index key. Annotation
is therefore a **router** into typed stores, not a highlighter.

The v2 classification criterion is the **speaker's processing unit** (how the
utterance is mentally assembled in production), and each class has an
operational test:

| # | Class | Color (FINAL v2) | Identity / index key | Test | Store |
|---|---|---|---|---|---|
| 1 | **serifu** セリフ | 🟡 yellow | surface form | citational | surface list |
| 2 | **collocation** 連語 | 🔵 blue | pattern id (lexical⟷lexical bond) | swap → ungrammatical | `CollocationStore` (exists) |
| 3 | **rhetorical collocation** 修辞連語 | 🟢 green | **evocative lemma** | remove lemma → gesture not performed; lemma must pass the **evocation test** | gesture catalog (new) |
| 4 | **phrase schema** 慣用構文 | 💠 mint `#03FFB1` | the frame itself | said WHOLE; **rearrangement kills it** (slots open, frame fixed) | schema store (new) |
| 5 | **skeletal construction** 骨格構文 | 🟠 orange | the component-LINK | **link survives rearrangement** (以前の→以前に…); fillers are context, not construction | link store (new) |
| 6 | **discourse pattern** 談話 | 🔴 red | discourse role | requires **responsivity** (function references what it is in discourse WITH) | discourse engine (port, §7.1) |

> v2 colors set by the user 2026-07-10 (supersede the v1 set — collocation was
> green, rhet-collocation blue, and "rhetorical construction" 🩵 aqua). Do not
> revert. The v1 callout keyword `rhet-constr` is kept as a legacy alias for
> `skeletal` in `CALLOUT_TO_CLASS`.

```ts
type NoteClass = 'serifu' | 'collocation' | 'rhet_collocation'
               | 'phrase_schema' | 'skeletal' | 'discourse';

// The per-class payloads — what each annotation actually carries:
type Payload =
  | { class: 'serifu';        spans: Span[] }
  | { class: 'collocation';   spans: Span[]; patternId: string }
  | { class: 'rhet_collocation';                       // 🟢 the subtle one
      lemma: string;                                   // citation form = the index KEY (must EVOKE)
      haloSpans: Span[];                               // bracketed residue (evidence)
      gestureName: string;                             // 3–8 words: the move performed
      gestureFamily?: string }                         // cross-lemma cluster, optional
  | { class: 'phrase_schema';                          // 💠 holistic frame + slots
      frame: string;                                   // e.g. "[X]というところで納得している"
      slots: { span: Span; fillers?: string[] }[];     // paradigm substitutions live here
      stance: string }                                 // what deploying the whole phrase does
  | { class: 'skeletal';                               // 🟠 the component-link
      components: string[];                            // e.g. ['以前', 'ば'] — the LINK is the entry
      constructedMeaning: string;                      // e.g. "counterfactual displacement to a former state"
      crystallizations: { form: string; spans: Span[] }[];  // 以前の[N]であれば, 以前に[V]ていれば…
      fillers?: { text: string; context: string }[] }  // 私 etc. — context leaves, NOT construction parts
  | { class: 'discourse';                              // 🔴
      role: string; operatorChainRef?: string };       // → §7.1 engine
```

**🟢 rhetorical collocation is a *gesture catalog keyed by lemma*, not a "meaning
of a word,"** with an **admission condition (v2): the lemma must be evocative** —
it must hold an inherent impression/image/conceptualization that thinking of the
word summons by itself (onomatopoeia is the prototype; 生々しい, 顧みる, 破綻 =
破 tear + 綻 seam-unravel all pass). The condition is constitutive, not a
filter: green is keyed on the lemma because the speaker *reaches for* it, and
only an image affords a grip. Bland classificatory labels (難点, 点, 問題) evoke
nothing → strings hung on them (`〜のが難点ですけど`) are 💠 phrase schemas, not
green. One lemma licenses several gestures (生々しい → impulse-trigger /
authenticity-attribution / rejection-threshold), each a separate entry under the
same key; gestures cluster across lemmas into **families** — and family members
differ precisely in their *image* (漏れなく = no leakage / 一つ残らず = none left
behind / ことごとく = itemized sweep), which is why you'd pick one over another =
the production insight itself. The annotator supplies **lemma + bracketed halo
span(s) + a short gesture name**; core can be any POS, **re-rootable**; key on
the citation form. This is a **production** index, orthogonal to the Yomitan
comprehension dictionary.

**Classes are perspectival projections, not string properties.** The class is
determined by (a) what the note gives insight INTO (green = about the lemma;
mint = about the phrase) and (b) how the annotator actually produces the span
(assembled through the image vs retrieved whole — can differ per speaker and
drift over time). The same span may therefore carry entries in **more than one
class** (`{概念}として破綻している` = 🟢 insight into 破綻 AND/OR 💠 a phrase said
whole — "it depends"). Overlapping spans are allowed and expected; the save flow
offers projections and never forces one. Corpus signatures can *suggest* a class
(🟠 high arrangement-entropy + pair attraction; 💠 one dominant frame + high slot
entropy; 🟢 one lemma + variable halo) but never decide it.

**🟠 includes the correlatives (呼応表現).** どんな⟷ても, ても⟷からには,
決して⟷ない are component-links whose constructed meaning happens to be pure
logic — the zero-pragmatic-cargo end of the same class as 以前⟷ば.
Compositionality varies *within* orange; it is not a class boundary. Orange is
**not** discourse: 🔴 requires responsivity, and a component-link composes the
same meaning in a vacuum.

### 7.1 The 🔴 discourse type ports an existing engine

A working discourse-grammar engine already exists at **`_tmp_pipeline/`** (repo
root, untracked scratch — see project memory `discourse-engine-tmp-pipeline`).
**Verified functional: 196/196 tests pass; CLI loads 126 operators / 575
triggers; produces analysis for real YouTube transcripts.** It is *not* wired
into the plugin. The 🔴 type is a **port** of this engine, not a fresh build. Its
model (adopt verbatim):

- **Two layers, context-gated.** Operators tagged `g` (grammar, surface) or `d`
  (discourse, inferred). **Discourse labels never fire from a single morpheme** —
  they require a constellation (grammar + stance + topic state + neighbours).
  *This gating is the fix for the current subsystem's "over-fires" defect.*
- **Relational machinery:** spans / bundles / pivots (ranked, ≤1/sentence) /
  named moves; "the arrows ARE the discourse" (micro-jumps = operators) — which
  is literally the user's Apple-Notes red arrows.
- **5-stage parse:** morphemes → voicing channels → speech-act type →
  `FLOW_STATE` (carried turn-to-turn) → cross-thought reference graph.
- Bonus asset: `morphology.mjs` provides the **deinflection** the plugin's
  dictionary currently lacks, and the lemma extraction 🔵 needs for its key.

**Caveat:** `_tmp_pipeline/` is its own taxonomy (126 ops) built under heavy
iteration; audit the operator inventory against the user's notes before adopting
wholesale, and confirm none of it overlaps the dead-code set before porting.

### 7.2 What's port vs build

| Type | Status |
|---|---|
| 🔴 discourse | **port** `_tmp_pipeline` (mature, tested) |
| 🔵 collocation | reuse `CollocationStore` |
| 🟡 serifu | trivial surface store |
| 🟢 rhet-collocation | **build** the lemma-keyed gesture catalog; `_tmp_pipeline/envelope.mjs` is an *early-form* starting point (pre-"gesture" framing) |
| 🟠 skeletal construction | **build** the component-link store (link → crystallizations → filler/context leaves); `_tmp_pipeline/structure.mjs` anchors/bundles are partial scaffolding |
| 💠 phrase schema | **build** the frame+slots schema store |

Stages 1.4–1.5 are now **unblocked**.

---

## 8. Build sequence (back-to-front, lowest risk first)

**Step 1 — durable core, against data we already have** (`testtranscript.md` +
`samplenotes.png`; no YouTube, no Apple plumbing):

1. transcript → daily-note assembly under per-video headings (idempotent)
2. `LocalMatcher` (pure) + golden-set harness
3. `OcrReconciler` (Claude client, schema, Haiku→Opus tier) + reconciliation flow
4. write `ReconciledNote`s back as typed callouts with block IDs +
   route each into its per-class store (§7); colors v2 yellow/blue/green/mint/orange/red
5. `LibraryView` sidebar: block-embeds, **filter by class**, context modal

Note: the 🔴 discourse store is a separate, larger workstream — the
`_tmp_pipeline` port (§7.1). Step 1 can land with 🔴 stubbed (role label only)
and the engine ported in a follow-up phase; the other five do not depend on it.

**Step 2 — bolt on the fragile adapters**, each behind its isolation boundary
with the paste fallback:

6. `TranscriptAdapter` (fetch-once-freeze)
7. `YtHistoryAdapter` (scrape, with manual-ID fallback)
8. Apple Notes inbox convention (share-as-image → `inbox/`)

**Cross-cutting** (built alongside): health-check command pinging each adapter;
structured run log of everything skipped.

---

## 9. Module layout

```
src/notes/
  types.ts            # §3 data model
  local-matcher.ts    # pure backbone
  ocr-reconciler.ts   # ⚠ Claude API adapter
  claude-client.ts    # requestUrl + key + model constant + schema
  transcript.ts       # ⚠ YouTube captions adapter
  yt-history.ts       # ⚠ YouTube history adapter
  pipeline.ts         # orchestrator; graceful degradation per stage
  note-types.ts       # §7 Big-5 config + payload types
  annotate.ts         # idempotent callout writer + Big-5 router → stores
  stores/             # §7 per-class stores:
    serifu.ts         #   🟡 surface list
    gesture-catalog.ts#   🔵 lemma-keyed gesture catalog (new; production index)
    construction.ts   #   🩵 anchor-lattice store (new)
    # 🟢 reuses data/CollocationStore; 🔴 = the _tmp_pipeline port (§7.1)
  LibraryView.ts      # sidebar view (block-embeds + Big-5 filter + modal)
golden/               # §6 regression fixtures + runner
```

The 🔴 engine port lands under `src/discourse/` (replacing the current naive
matcher) or a fresh `src/discourse2/`, sourced from `_tmp_pipeline/` — its own
phase, gated by the §7.1 audit.

The X dictionary's lessons that this design inherits: isolate the silo, surface
errors verbatim, no silent caps, degrade gracefully, freeze what you've already
captured. See the project memory `x-search-dictionary` for the parallel.

---

## 10. Digital text notes (the easier ingestion path)

The §1 flow assumes handwriting (Apple Pencil → image → **Vision OCR**). When the
user's notes are already **digital text** (Apple Notes text, or any typed notes),
the entire OCR stage is deleted:

- `OcrReconciler.readPage()` (the ⚠ Claude Vision adapter) is **skipped** — the
  note text goes straight into `LocalMatcher.match()`.
- The only remaining LLM use is `disambiguate()` on the residue the matcher flags
  `needs-review` (heavy paraphrase, ambiguous homophone) — a tiny call over
  readings/candidates, never the transcript.
- Everything downstream (typed callouts, block IDs, library, stores) is identical.

So the text path is a **strict subset** of the locked flow, with the most
fragile/expensive stage removed. Ingestion convention: one note per line/paragraph
in an `inbox/` markdown file (or pasted into a command); the pipeline reconciles
each against the frozen transcript exactly as in §5, entering at the
`LocalMatcher` step.

## 11. Cards & timestamp anchoring (extends the existing SRS generator)

`src/srs/card-generator.ts` already ships the target card shape: the
**graduated fade-in cloze** (each bit in a `%%spoiler%%`, revealed one at a time),
the phrase-in-context card, and an `includeTimestamps` option with a per-bit
`timestamp`. A card is authored **from a `ReconciledNote`**, so it inherits the
note's `videoId`, `lineIndex`, `timestampSec`, and `blockId` for free.

The one addition: make the timestamp a **live anchor**, not a label. Each card bit
carries `{ videoId, tStartSec, blockId }` and renders it as:

- a link **into the transcript block** — `[[<daily>#^<blockId>]]` — so the card is
  traceable to the exact source span (invariant #1; no copied content), and
- a **YouTube deep-link** — `https://youtu.be/<videoId>?t=<tStartSec>` — that opens
  the moment.

A card is therefore a *view over an anchored transcript span*, not a new content
note — same anti-explosion rule as the library (invariant # 1, #5). Cards render as
Markdown and route through the same idempotent writer.

## 12. Audio provider (decoupled; the timestamp is the durable primitive)

Audio is resolved through one adapter so the card never depends on audio existing
(invariant #2 isolation, #3 degrade-soft):

```ts
// src/notes/audio-provider.ts
interface AudioClip { kind: 'deeplink' | 'local'; href: string; }  // href = URL or vault path
interface AudioProvider {
  /** Resolve a clip for a span. Local mp3 if present, else the deep-link. Never throws. */
  resolve(videoId: string, startSec: number, endSec: number): AudioClip;
}
```

- **Tier 0 — deep-link (always; mobile + desktop; no ToS issue).** `youtu.be/ID?t=sec`.
  ~90% of Anki-audio's value (hear it in context) with zero fragility. Ships first.
- **Tier 1 — local MP3 clip (desktop opt-in).** `yt-dlp --download-sections
  "*start-end" -x --audio-format mp3` fetches **only the clip range** as audio
  (~1–2 MB, selective — the "impossible" clipping is a supported yt-dlp flag). The
  plugin cannot run this on mobile (no `child_process`) and must not bundle a
  binary, so it either (a) **emits the exact yt-dlp commands / a batch script** for
  the reconciled timestamps, or (b) on desktop with yt-dlp present, invokes it
  behind a `Platform.isDesktopApp` guard, writing `clip_<id>_<startSec>.mp3` into
  the vault. The card then embeds `![[clip_….mp3]]` (native Obsidian playback).
  **Caveats, stated not hidden:** desktop-only; requires yt-dlp + ffmpeg installed;
  downloading YouTube audio is against YouTube ToS (personal-use gray area — the
  plugin provides the path, gated behind an explicit opt-in setting, and does not
  ship or auto-install any downloader).
- **Tier 2 — in-plugin mobile download / yt2mp3 sites: not feasible** (no
  `child_process` on mobile; third-party sites are CORS-blocked, unstable, worse on
  ToS). Explicitly out of scope.

`resolve()` returns local-if-present else deep-link, so the whole feature is
complete with zero audio and gets richer if the desktop extractor is run — no
redesign either way.

## 13. The capture spine — universal classification + the discourse gold loop (2026-07-12)

**Problem this section solves.** The plugin has four capture surfaces (transcript
reconciliation, X tweets, dictionary entries, plain vault text) but only ONE of
them (handwriting recon) feeds the pattern catalog, and none of them collects the
structured data the 🔴 discourse parser needs to get better. Saving from X goes to
the legacy `CollocationStore` only; saving from the dictionary goes to the legacy
store only; there is no way to say "this span, in THIS context, is a 談話 move of
kind X responding to turn Y" from anywhere. The plugin cannot bootstrap its own
parsing logic from its own use — the user's stated goal ("emergence by being used
to build on itself").

**The contract:**

1. **One destination.** Every classified capture, from every surface, lands in the
   `PatternStore` catalog as a `PatternEntry` + `Attestation`. The legacy
   `CollocationStore` keeps receiving what it already receives (external contract,
   CollocationView) but is no longer the primary home. `Attestation.source` gains
   `'web'` (note.com posts, arbitrary URLs, vault notes that aren't transcripts).

2. **One modal.** `ClassifyModal` (src/ui/ClassifyModal.ts) takes a
   `CaptureContext { text, example?, contextBefore[], contextAfter[], speakers?,
   source }` and renders: the six class chips (operational-test hint per class,
   suggestion pre-selected from `derivePattern` + heuristics, NEVER auto-committed
   — perspectival principle: user can save the same span under several classes in
   sequence), per-class payload fields (🟠 parts / 💠 frame / 🟢 lemma+halo /
   🔵 headword+collocate), and — for 🔴 only — the **skeleton section** (§13.3).

3. **Suggestion vs ratification is ALWAYS recorded.** `PatternEntry` gains
   `classSuggested?: NoteClass`. Every capture where the user overrides the
   suggestion is a labeled training example for the class-suggester; every
   discourse capture where the user overrides the detector's move/edge is a labeled
   example for the parser. The delta IS the dataset.

### 13.1 Capture surfaces (all call the same modal)

- **X tweet card** — 🏷️ action next to 💾. Selection inside the card body wins as
  the target span; the tweet text is the example; `source = {kind:'x', url}`.
- **Dictionary entry card** — 🏷️ action; expression is the span; first extracted
  example sentence is the example.
- **Editor selection** — command `classify-selection` (+ context-menu). The
  surrounding lines are read from the active file. If the file is a transcript
  (`CAPTION_STAMP_RE` gate), the surrounding STAMPED LINES become
  contextBefore/After with speakers + `tStartSec` — this is the discourse-rich
  path; attestation is `source:'yt'` with file+time. Otherwise `source:'web'` if
  the note's frontmatter has `url:`/`source:` (note.com exports), else `'manual'`.
- **Library/catalog** — existing class dropdowns stay (one-click ratify);
  catalog rows open the modal for payload editing.

### 13.2 Discourse gold store (`_discourseGold` in the plugin-data blob)

```ts
interface GoldExample {
  id: string;                       // gold-<fnv36(source|utterance)>
  utterance: string;                // the classified turn/span
  contextBefore: string[];          // prior turns, oldest→nearest (≤5)
  contextAfter: string[];           // following turns (≤3)
  speakers?: (string|null)[];       // aligned with contextBefore+[utterance]+contextAfter
  // what the CURRENT parser said at capture time (frozen — evaluation datum):
  suggestedAct?: string;            // analyzeCrossTurn act for the utterance
  suggestedEdge?: { kind: string; toOffset: number } | null;
  // what the USER ratified (the label):
  act: string;                      // from the act inventory + free text allowed
  edge?: { kind: '→'|'↳'|'↧'|'answers'|'restates'|'responds-expands'|'contrasts'|'receipts'; toOffset: number } | null;
  note?: string;                    // free-form observation (the user's insight)
  patternId?: string;               // catalog entry this capture also created
  source: { kind:'yt'|'x'|'web'|'manual'; file?: string; url?: string; tStartSec?: number|null };
  addedAt: number;
}
```

- `toOffset` is turns-back-from-utterance (1 = immediately prior) so examples are
  self-contained — no external indices to resolve.
- **Export**: command `discourse-gold-export` writes
  `discourse-gold.jsonl` (one example per line) + a summary header note with
  per-act counts and the **agreement rate** (suggested == ratified) — the live
  scoreboard for the parser. This file is the input for building/evaluating the
  next parser iteration (the adjudication-workbench lineage).
- Non-discourse classes contribute to the same loop more cheaply: the
  `classSuggested` field on PatternEntry (13.3 above) exports in the same run as
  `class-choices.jsonl`.

### 13.3 Skeleton section of the modal (🔴 only)

Pre-filled, never auto-committed: on open, `analyzeCrossTurn` runs over
contextBefore+utterance+contextAfter; the utterance's detected `act` pre-selects
the act picker, the detected edge pre-selects the relation + target-turn picker
(turns listed as tappable rows). The user ratifies or corrects. Saving writes BOTH
the gold example and a normal catalog attestation (class 🔴, keyed on the
utterance's skeleton-relevant surface).

### 13.4 Legacy accuracy fixes riding this change

- `ContextEngine.getCoPatterns` recomputed the full KWIC search once per indexed
  file (O(files×search)) — hoisted.
- **Dictionary deinflection** (`src/dictionary/deinflect.ts`): rule-based iterative
  suffix rewriting (Yomitan's algorithm shape: ~30 rules, て/た/ない/ます/れる/
  られる/させる/ば/たら/たり/ちゃう/じゃう/とく/てる + polite/negative chains,
  max 4 hops). `lookup()` falls back to deinflected candidates when exact+reading
  match fails, and labels results with the inflection trail (「食べた → 食べる
  〈past〉」). Pure + golden-tested.
- X 💾 also records into the PatternStore (class-unratified 🔵 by default) so
  tweets stop bypassing the catalog.


## 14. Unified lexicon + real SRS (monokakido feel; 2026-07-12)

Two surfaces built on the pattern catalog as the single source of truth.

### 14.1 The 語彙 tab — one search, clean context tree

`src/lexicon/unified-search.ts` (PURE) ranks the six-class catalog above the
legacy collocation lexicon above the dictionary (deinflection-aware), exact →
prefix → substring, with a catalog stratum bonus + attestation weight so the
user's own noticings and well-attested items win. `autocomplete()` is the same
ranking filtered to surface-initial matches.

`src/lexicon/context-tree.ts` (PURE) is the fix for the old lexicon's junk: it
builds the context view from PatternStore ATTESTATIONS (already-located,
provenanced real quotes) instead of raw-vault `indexOf ±80`. Leaves are grouped
by source (▶ video / 𝕏 tweets / 🌐 web / ✍ manual), deduped by normalized
quote, dropped if <3 non-punctuation chars, capped at 12/group with an overflow
count, anchored-before-swept, timestamp-sorted. The constellation is real
co-occurrence — patterns sharing an attestation FILE with the focus — not a
substring guess. **Verified: 0 junk leaves across the top-30 patterns of the
real vault.**

`src/ui/LexiconPanel.ts` renders it: instant search + autocomplete dropdown,
class×source facet chips, compact rows (color dot + headword + gloss + source
badges + count), and a drill-down detail with the class-shaped payload, a
collapsible context tree (per-leaf 🎧 clip playback via the shared
`resolveAttestationClip`, ↪ source jump), constellation chips, and a
🏷️ reclassify / 📖 dict / 🗑 action row. Mounted by CollocationView's 語彙 tab
(legacy chrome hidden while active); audio uses a detached `<audio>`.

### 14.2 Real SRS — scheduler, deck, review view

- `src/srs/scheduler.ts` (PURE) — Anki/SM-2 lineage: new→learning(1,10min)→
  review(day intervals), ease 1300–∞, lapse→relearning at ½ interval, four
  grades with real next-interval previews. `MAX_INTERVAL 365d`.
- `src/srs/srs-store.ts` — `_srsDeck` blob; the card unit is the PATTERN id
  (three sightings = one card). Queue policy: due learning → due review → up to
  `srsNewPerSession` fresh, learning-first by dueMs. `prune()` drops dead ids.
- `src/srs/review-cards.ts` (PURE) — class-shaped fronts (P4 drill semantics on
  the pattern): 🟡 audio-first dictation, 🟠 first-component→produce-mate, 🔴
  prior-turn→produce-response (upgraded by the discourse gold example), 💠 型
  産出, 🟢 表現産出, softHint = first-char+length (never the answer).
- `src/ui/ReviewView.ts` (view `jp-srs-review-view`, ribbon `layers`, command
  `open-srs-review`) — home shows learn/due/new counts + class breakdown;
  session shows progress, class-shaped card, Space-to-reveal, 1–4 grade keys,
  interval previews, 🎧 clip on the card, ↪ source jump, session summary.
  Prunes the deck to live catalog ids on open.

Golden: `srs.mjs` (51) + `lexicon.mjs` (28). 17 suites total.

## 15. Class-aware sweep — the candidate machine (2026-07-17)

The transcript sweep previously matched only near-verbatim surfaces. But the
six classes are DEFINED by semantic tests (evocation / rearrangement /
responsivity) that no surface matcher can run — so the sweep architecture is:

- **Tier 1 — confirmed**: near-verbatim reconcile (auto + ≥0.9). The only tier
  allowed to assert truth, because there the unit IS the surface.
- **Tier 2 — suggested** (`src/notes/sweep-match.ts`, PURE, golden/sweep.mjs):
  the class-appropriate structural parse, deinflection-validated
  (`findTermAll`: stem occurrence + the surface slice must deinflect BACK to
  the term):
  - 🔵 collocation — components in order, gap ≤10, final component may inflect;
    bare surface keys also match under inflection (気になる attests 気になって)
  - 🟠 skeletal — link parts in order, clause-scale gap ≤30
  - 💠 schema — frame fixed material in order, slots BOUNDED and actually
    filled (no clause break inside a slot)
  - 🟢 rhet-coll — the captured HALO near-verbatim; a bare lemma hit is NOT a
    sighting (the evocation test is human-only) → not sweepable without a halo
  - 🔴 discourse — never swept (parser work explicitly halted)

**Tier-2 precision is known-bad — treat it as a recall machine, full stop.**
"Class-appropriate structural parse" describes the *shape* of each matcher, not
its accuracy: adversarially probed (2026-07-17), every class matcher fired on
spans that are not instances of the class. The class-defining semantic tests
are human-only, so misfires are irreducible at this tier: the sweep proposes,
the human classifies. Confidence numbers are ranking weights, not
probabilities.

Hardenings shipped from that probe (golden: "precision hardening" section):

- **Compound-prefix guard** — a kanji-initial match preceded by exactly ONE
  kanji is the tail of a compound, a different lexeme (本|気になる no longer
  attests 気になる; 口|約束 no longer fires 約束). A 2+-kanji run before the
  match stays legal (毎日食べる — particle-dropped speech is normal captions).
- **🔵 gaps admit no punctuation** — a collocation is one phrase
  (「約束はさ、守るとか」 no longer fires 約束を守る).
- **🟠 gaps stop at 。！？** — clause-scale, but never across a sentence
  boundary; 、 still links.
- **💠 single-seg frames need ≥4 chars of fixed material** — 「○○として」
  fires on every compositional として (結果として, 一つとして), holisticity is
  invisible to a surface matcher → not sweepable, same abstention as the 🟢
  bare lemma. 「○○というわけだ」-shaped frames stay sweepable.
- **Deinflection needs a real stem** — a 1-char kana stem matches inside
  unrelated okurigana (いる's い found 書いた's いた, which deinflects back to
  いる); now ≥2 chars, or 1 kanji (見る→見た).

Residual, irreducible-without-morphology failure modes (measured, accepted):
ordered co-occurrence with a clean gap (「面倒だから見るのをやめた」 fires
面倒を見る) and fixed material hidden at a kana junction (例えば's ば fires
ば〜ほど). These are what the ✓✕ loop is for:

- **Auto-mute** (`sweepMuted`): a pattern with ≥3 rejected candidates and no
  ratified sweep hit stops being swept — the user's ✕s prove that ENTRY is
  structurally coincidence-prone. Each ratified sweep hit (matchKind set,
  status cleared) buys back 5 strikes; purely derived, so a later ✓ un-mutes.
  Short single-seg frames and kana-heavy links mute themselves within days of
  honest use; good patterns are never throttled.
- The full ✓✕ record stays exportable for a future learned reranker — that
  needs hundreds of labels, so it is a later phase, not a promise. Porting the
  CLI's morphological true-hit filter (`_tmp_pipeline`, needs a tokenizer)
  would fix the residual class structurally but is heavy for mobile; decide
  when the mute data shows it's needed.

Tier-2 finds land as `status:'suggested'` attestations: quarantined out of the
context tree (own collapsed 候補 bucket), out of constellation, out of SRS
cards, out of search ranking. One-tap ✓ ratifies (clears status), ✕ rejects —
removed AND remembered in `rejectedAtts` so the sweep never re-proposes it.
Ratifications + rejections are the training signal for a future learned
matcher (same suggested-vs-ratified principle as the 🔴 gold store). Suggested
never downgrades confirmed; all sweep adds go BY ENTRY ID (`addAttestations`),
never re-deriving keys (lemma-keyed 🟢 and class-siblings keep identity).

**Auto-sweep**: every freshly fetched transcript (history batch or single URL)
is swept immediately — the lexicon grows passively from watching. Real-vault
calibration at ship time: 8 candidates across 79 transcripts (incl. genuine
cross-video 🟠 firings like 「逃げるんだったらさ、急がなきゃじゃん」).

Also: catalog ⇔ legacy merge (`linkLegacy` in unified-search) — a catalog
pattern and legacy collocation with the same normalized surface render as ONE
row (catalog identity + legacy reading/grammar notes/examples in the detail's
📚 block), and every row carries ONE embedded just-enough example
(`bestExample`: best confirmed attestation, anchored-yt first — never a
suggested candidate).

## 16. ⚡ Capture flow — the pipeline as one surface (2026-07-17)

`src/ui/PipelineView.ts` (`jp-pipeline-view`, ribbon ⚡): the whole YT path as
one designed stepper — ① 動画 (recent transcripts + live-history fetch + paste
a URL) → ② 手書き (photo picker → vault attachment → embed; direct phrase
input; capture note CREATED ONLY when material is added — selecting never
litters) → ③ ⚡ (runs the same cards-first pipeline on the managed note) →
④ 復習 (cards + one-tap SRS). File conventions unchanged underneath
(`source:` frontmatter, `-cards.md`), so everything stays inspectable.

Mobile: the same view is the phone/tablet entry point — the photo button opens
the iOS camera roll, stages are 44px+ touch targets, safe-area padded, and the
audio stage simply doesn't exist off-desktop (deep-link tier is the default).
Supporting mobile pass: 📱 デバイス診断 command (capability report per device,
no binary probes), ReviewView tap-anywhere-to-reveal + sticky thumb-height
grade bar on phones.

## 17. 談話モード — the manipulable discourse surface (2026-07-17)

`src/ui/DiscourseModeView.ts` (`jp-discourse-mode-view`, ribbon 💬): a MODE
for working a transcript as discourse, built so annotating IS building the
parser's training corpus. One gesture vocabulary (finger/Pencil-sized, no
precision aiming):

- tap a line → toggle the turn boundary before it (mid-turn = split; the
  split starts on the NEXT speaker letter, since a new break usually means a
  new voice; turn-initial = merge up)
- tap the speaker chip → cycle A→B→C→D
- tap a pattern pill (detectPatterns suggestions) or ✍ → CaptureModal with
  parser-grade context: ±3 turns + aligned speakers + timestamp → catalog +
  🔴 gold via the normal spine

Initial segmentation is a HUMBLE time-gap merge (≤6s join, ≤4 lines) — a
starting point, never an assertion. Every correction persists per file as
`_discourseSeg` in the plugin-data blob: the human-ratified record of where
turns break and who speaks — exactly the corpus the over-segmenting speaker
detection lacks. The discourse parser itself is deliberately untouched
(halted per user); this mode exists so its training data accumulates from use.

## 18. The data layer that cannot lose the corpus (2026-07-18, AUDIT §1–2)

AUDIT.md items 1–5, shipped as one block:

- **`DataManager`** (`src/data/data-manager.ts`, PURE, golden/storage.mjs) is
  the ONE owner of the plugin-data blob. Loaded once at startup; canonical in
  memory thereafter; every store persists via `dm.setKey('_key', data)` —
  debounced, coalesced, and **serialized** (writes never overlap, killing the
  read-modify-write lost-update race). `loadData`/`saveData` are never called
  after onload.
- **The §1.1 clobber is dead by construction**: `loadSettings` builds
  `this.settings` from `settingsSlice()` (underscore keys excluded), and
  `saveSettings` goes through `setSettings()`, which CANNOT touch `_` keys —
  the protection is the shape of the operation, not caller discipline.
- **Derived indexes left the blob** (99.5% of the historical 62MB):
  `SurferBridge` no longer serializes `discourseIndex`/`kwicIndex`; they are
  memory-only and rebuild idle-batched each session (`needsReindex` always
  true at load). A one-time migration strips them from existing blobs —
  data.json drops to ~600KB and every save/load gets ~100× cheaper.
- **Secrets are device-local** (`app.saveLocalStorage`, never synced):
  X `authToken`/`csrfToken`, the YT history cookie, and `ocrApiKey` migrate
  out of the blob on load and are scrubbed from every settings save
  (`blob-migrations.ts`); the settings UI's 「端末内にのみ保存」 claim is now
  actually true. The yt-dlp cookie jar moved out of the vault to
  `~/.jp-collocations/yt_cookies.txt`; the old in-vault `_yt_cookies.txt` is
  deleted on load.
- **Crash safety**: every write first saves the previous good serialization
  to `data.json.bak`; a corrupt `data.json` restores from `.bak` at load
  (with a Notice). The first post-migration write banks the original 62MB
  state as the backup.
- **CI**: `.github/workflows/ci.yml` runs build + golden (now 20 suites,
  including the storage suite that would have caught §1.1) + lint on push.

## 19. Files-over-app + the product gets a front door (2026-07-18, AUDIT #6–8, 10–11)

- **Vault-native mirror** (`src/notes/catalog-mirror.ts`, PURE,
  golden/mirror.mjs): every pattern-store or gold-store persist regenerates
  `JP Lexicon/catalog.jsonl` (one entry per line, id-sorted for stable diffs
  — the disaster-recovery source), `catalog.md` (human-readable index by
  class, deliberately timestamp-free so unchanged catalogs write nothing),
  and `discourse-gold.jsonl`. Debounced 5s; idempotent writes; flushed on
  unload. `台帳: Restore Catalog from Vault Mirror` reads catalog.jsonl back
  (`importReplace`) — the corpus now survives the blob AND the plugin.
- **One ribbon** (AUDIT §4): the 8 ribbon icons collapsed into a single
  torii-gate hub menu (⚡ flow / 語彙 / 復習 / 辞書 / 𝕏 / 談話 / ライブラリ /
  pipeline run). All commands unchanged.
- **Leeches** (`LEECH_LAPSES = 5` in scheduler.ts): a review card lapsing 5×
  is flagged and leaves the queue — it needs a REWRITE, not more failed reps.
  ReviewView home shows a 🛑 リーチ pill; tapping revives all (due now);
  grading 簡単 after a revive clears the flag for good. Golden-tested.
- **Dead code → `_attic/`**: the citation L1–L5 pipeline, rhetorical-*,
  program-builder, schema-driven-l4, TextClassifier, and the upper-cased SRS
  duplicates (15 files) moved out of src/. NOTE: `surfer-types.ts` looked
  dead in the esbuild metafile but is `import type`-referenced by live files
  (type imports are erased at bundle time) — it stays. Check both signals
  before declaring a file dead.
- **🩺 debug-dump command**: blob key sizes, session write count, store
  counts, engine state, secret presence — one clipboard dump that turns
  "mysteriously empty" into a diagnosis.

## 20. The lexicon as the product surface (ratified + SHIPPED 2026-07-18)

User feedback: the catalog is not monokakido enough; not seamlessly
integrated; sidebar embeds show the bare anchored line without its context;
and the 用例 story doesn't exist. Ratified with the condition: accurate,
philosophy-true, useful. Shipped implementation notes at the end of each
subsection contract below.


Shipped shape (all golden-tested):
- `src/notes/context-window.ts` (PURE, golden/context.mjs — 20 checks incl.
  the accuracy contract: quote-first anchor location, distant-timestamp
  refusal, no invented speakers, compound-guard holds in highlighting) +
  `src/ui/ContextWindow.ts` renderer → wired into LibraryView cards
  (replacing raw `![[…]]` embeds; commentary/needs-review keep their special
  renderings) and LexiconPanel leaves (chevron-expandable inline context).
- Monokakido pass: rail-colored dense index rows, 前方/含む/用例 search-mode
  chips (`SearchMode` in unified-search, golden-tested incl. "suggested
  quotes are not searchable"), あかさたな scrubber in browse mode (kanji
  under 漢), 用例 tree moved to be the entry BODY, 飛び込み tap-lookup on
  quotes via caretRangeFromPoint + longest-match deinflected dictLookup
  (no tokenizer guessing — dictionary-validated or nothing), back preserves
  list scroll.
- 用例 cascade: 「🔎 用例を探す」 = per-entry vault sweep (explicit ask
  bypasses sweepMuted, everything else identical — suggested only, rejected
  never return) + `xJoinPattern`; dry run → 🎯 assignment box (𝕏 live search
  prefilled with quoted sweep terms); ⚗ scaffold via
  `src/notes/scaffold.ts` (PURE, golden/scaffold.mjs — pinned model shared
  with OCR, and every generated line must pass the SWEEP MATCHER's
  deinflect-validated check or it is discarded: the validator, not the
  generator, decides). `payload.scaffold` renders 生成-badged, never in the
  tree, auto-retired by pattern-store on any confirmed attestation
  (upsertEntry AND ratifyAttestation paths, both golden-tested).

### 20.1 Monokakido pass (how it should LOOK and FEEL)

The current LexiconPanel is functionally right (unified search, context tree,
zero junk) and typographically wrong (inline-styled 10px buttons, generic
list). The monokakido qualities to adopt, concretely:

- **Index list = dense headword rows**: headword 17px bold leading, one-line
  muted gloss 12px under it, class color as a 3px left rail (not an emoji
  chip), 44px rows, no borders — separation by whitespace. Tap anywhere.
- **Instant incremental search** stays, plus **search-mode chips**:
  前方一致 (default) / 含む / 用例全文 (searches attestation quotes).
- **Index scrubber**: あかさたな… rail on the right edge of the list (mobile
  especially); tap = jump, drag = scrub.
- **Entry anatomy** (detail view): headword 26px, reading under it, class
  accent bar; then senses/gloss; then 用例 (the context tree) as the BODY of
  the entry, not an appendix — monokakido entries ARE their examples. Every
  Japanese word in the detail is tappable → jumps to its own lookup
  (dictionary fallback), monokakido's 飛び込み.
- **No chrome**: buttons become quiet inline glyphs; the panel owns the full
  height; one back gesture from detail to list preserving scroll position.

### 20.2 One ContextWindow renderer (the embed answer)

Kill raw `![[file#^anchor]]` embeds everywhere. One shared component renders
ANY attestation as a context window, used by the LibraryView cards, the
LexiconPanel context-tree leaves, and the dictionary context panel — that
sameness IS the seamless integration:

- **Resolve**: read the transcript file, locate the anchor block (or nearest
  timestamp to `tStartSec`), take ±2 turns. If `_discourseSeg` has ratified
  turns/speakers for the file, use THOSE boundaries and speaker letters —
  the 談話モード corpus finally pays rent in the reading UI.
- **Highlight dynamically**: locate the pattern inside the window with the
  class-appropriate matcher (`findTermAll` — inflection-aware, so 気になって
  lights up for 気になる); highlight the span, dim the context turns.
- **Audio in place**: local clip → inline player; else timestamped deep-link
  ▶; resolved lazily as the card scrolls into view. One detached <audio>
  per view (survives re-render, sidebar-safe).
- **Degrade honestly**: file gone → render the stored quote (never blank,
  never a broken-embed box).

### 20.3 用例 — a FINDER cascade, not a writer (the design answer)

The plugin's identity is the attested lexicon: examples are heard/seen,
never fabricated. So the 用例 "generator" is a cascade ordered by evidential
strength, all landing in the ONE suggested→ratified spine:

- **Tier A — find in what you already have** (one 「用例を探す」 action per
  entry): run the class-aware sweep against all transcripts NOW for this one
  entry; substring/co-occurrence search of the X corpus; example sentences
  from imported dictionaries; the TWC collocation profile (scraper exists).
  Unified candidate list, source-badged, each ✓ becomes a real attestation
  with provenance, each ✕ trains `rejectedAtts`. No new machinery — this is
  the existing finders finally surfaced as one button.
- **Tier B — assignments, not sentences**: when Tier A comes up dry, the
  honest output is WHERE to hear it: a prefilled live 𝕏 search, a history
  sweep. A missing 用例 becomes a capture task — the gap grows the corpus
  instead of getting papered over.
- **Tier C — synthetic scaffold, quarantined**: LLM-generated examples
  (pinned model, schema-validated) ONLY for zero-attestation patterns, ONLY
  as SRS card material, always marked 生成, never entering the context tree,
  and RETIRED automatically the first time a real attestation lands. The
  scaffold's job is to keep a pattern drillable until reality provides.

Build order when ratified: 20.2 (one component, pays off in three places) →
20.1 (CSS + panel restructure) → 20.3 Tier A (wiring existing finders) →
Tier B → Tier C.
## 21. The hivemind ports — suggester, discovery, and the app integrations (2026-07-18)

### 21.1 SHIPPED — the two engines the ports feed

- **Class-suggester, made real** (`src/notes/class-suggester.ts`, PURE,
  golden/suggester.mjs): structural signals (the user's own notation first —
  〜 → 🟠, ○○ → 💠; responsivity markers → 🔴; utterance shape → 🟡; tight
  N+助詞+V → 🔵; bare lemma hint → 🟢) CALIBRATED by the user's record —
  priors from what they actually choose (≥5 captures before priors bite) and
  correction transfers ("machine said X, user chose Y" ×2+ lifts Y whenever
  X wins structurally). Every score carries WHY. Wired as
  `CaptureDeps.suggestClass`: every capture surface preselects the top
  suggestion and records it as `classSuggested`, so every override is the
  next training example. Never authority — the tap is the classifier.
- **💡 Discovery** (`src/notes/discovery.ts`, PURE, golden/discovery.mjs +
  `DiscoveryModal`, command `discover-collocations`): the collocations never
  written down — an EXPOSURE COUNTER, not a language generator. Its own
  precision-first chunker (the legacy regex extractor mis-segments —
  電話をかける came out 話をかける — so discovery does one shape RIGHT:
  kanji-run noun + case particle + deinflect-VALIDATED verb, canonicalized
  to the lemma so かけて/かける count as one; 2-kanji+する; mid-compound
  nouns rejected; rejected matches don't consume text). Recurrence must span
  ≥2 sources (breadth beats frequency — many videos ≈ the language, one
  video ≈ a speaker's tic); catalog keys and dismissals (`_discoveryDismissed`)
  never resurface; 𝕏 corpus counts as exposure too. Each row: 🏷️ one tap →
  CaptureModal prefilled with its best REAL occurrence as the attestation.
- **The universal capture port**: `obsidian://jpc-capture?text=…&example=…`
  `&source=yt|x|web|manual&url=…` — protocol handler → CaptureModal
  prefilled, suggester preselected, source-tagged. Every outside app reaches
  the hivemind through this one URL; on iPad, share-sheet → Shortcut →
  this URL is the whole integration.

### 21.2 PROPOSED — per-app pipelines (each suited to what the app IS)

Common spine for ALL of them: content in the app → (app-specific text
acquisition) → `jpc-capture` URL or a transcript-shaped note in the vault →
the EXISTING machinery (reconcile / sweep / 用例 / SRS) takes over. Study
happens where the capture happened: the capture modal → catalog → the same
⚡ cards-first path. Stage Manager is the design constraint everywhere: the
plugin's surfaces already work as a narrow column next to the content app —
capture must never need more than the narrow window.

- **Manga (Manatan)** — manga is IMAGES + short speech-bubble utterances =
  serifu-shaped exposure. Path A (zero-setup): copy the bubble text in the
  reader (if it exposes text) → share/Shortcut → `jpc-capture` with
  `source=manual`, page screenshot attached to the capture note by hand.
  Path B (when text isn't selectable): screenshot → the EXISTING handwriting
  OCR pipeline with a manga-tuned prompt (vertical text, bubble order) — the
  §4 pipeline already does image→candidates→classify; manga is a prompt
  variant, not a new system. Needs: which reader build you use and whether
  its text is selectable — confirm before building the OCR prompt variant.
- **Kindle** — books are the LONG-FORM attestation source. The iPad app
  exports highlights (share → export notebook). Pipeline: a paste-import
  command that parses the Kindle notebook export (highlight + book title +
  location) into a book-transcript note (`source: book frontmatter`), then
  the sweep runs over it like any transcript (no timestamps → no audio tier,
  everything else identical). Requires ONE schema addition, proposed here:
  Attestation `source` gains `'book'` (context-tree group = 📕 the book
  title). Confirm before the schema moves.
- **Apple Podcasts** — no transcripts, no links → the plugin's first
  GENERATED transcript source. Desktop tier: the speech tooling already
  probed by `voice-lab`/デバイス診断 (whisper-class) transcribes an audio
  file into a timestamped transcript note tagged `source: podcast` +
  `generated: whisper` — honesty rule: generated transcripts are marked in
  frontmatter and their attestations render with a ⚙ badge (they are real
  AUDIO exposure but machine-heard text). Then everything downstream is the
  YT path (reconcile, sweep, clips from the local audio file — the audio
  tier actually works BETTER than YT since the mp3 is local). Capture of the
  episode audio itself is the open question (Podcasts has no export; the
  honest paths are RSS-feed download of the same episode — most JP podcasts
  are open RSS — or desktop screen-record; RSS is the right one). Needs: a
  podcast-RSS fetch command (search feed, download episode mp3 to vault).
- **TV / Plex** — the show is on the external TV; the iPad is the companion
  surface. Pipeline: fetch JP subtitles for the episode (jimaku/OpenSubtitles
  or the sub file already on the Plex server) → convert .srt → the standard
  timestamped transcript note → open it in 談話モード or the ⚡ flow ON the
  iPad while watching; tap-capture at the line you just heard. No player
  integration needed or wanted — the transcript IS the companion. Needs: an
  .srt→transcript import command (tiny, pure) + your subtitle source of
  choice.
- **Stage Manager** — not an integration, the LAYOUT CONTRACT: every capture
  surface (CaptureModal, ⚡ flow, 談話モード, 語彙) must be fully usable at
  ~1/3-screen width, touch-first, no hover-only affordances. The mobile pass
  (§16) covers ⚡; the §20 monokakido pass covers 語彙; audit the remaining
  two at narrow width when the first real integration lands.

Build order on ratification: `.srt` import (smallest, unlocks TV tonight) →
Kindle notebook import + `'book'` source → podcast RSS + whisper tier →
manga OCR prompt variant.



## 22. Context is meaning — the scene contract (RATIFIED 2026-07-18 with user edits — the hivemind's constitution)

User ratifications folded in: vault = `Documents/Lenovo`; manga app =
Manatan (TestFlight); subs = jimaku (+ Plex server reachable from the other
computer — clips ARE in scope); written sources = Kindle AND note.com;
podcasts = ゆる言語学ラジオ + branches, のうラジオ, misc (open RSS).

### 22.1 The principle

An attestation is not a quote. It is a POINTER INTO A SCENE, and the scene —
who spoke, what came before, what the panel looked like, what the paragraph
was arguing — is where the meaning lives. Therefore the hivemind's unit of
storage is not "text + timestamp" but **enough provenance to re-manifest the
scene in the shape native to its medium, plus a door back into the medium
itself**. Every embed anywhere in the system is that door. Study happens by
walking back through doors.

### 22.2 SceneRef — one schema addition carries every medium

```ts
// on Attestation (all fields optional; today's yt/x fields keep working)
medium?: 'yt'|'podcast'|'tv'|'manga'|'book'|'note'|'x'|'web'|'dict'|'corpus';
scene?: {
  deepLink?: string;   // door back: youtube ts-link / kindle://…&location= /
                       // note.com#anchor / plex://… / tweet URL / Manatan (if
                       // it exposes a scheme; else absent and the stored
                       // image IS the return destination)
  image?: string;      // vault path: manga page/panel crop, TV still
  bbox?: [number, number, number, number]; // highlight region in the image
  audio?: string;      // vault path: podcast mp3 / plex-cut clip
  loc?: string;        // kindle location / page / paragraph anchor
  sourceName?: string; // book title / 番組名 / dictionary name / site
};
```

ContextWindow becomes medium-dispatched behind its ONE interface (adapter
rule §2.2): each medium gets a renderer that shows context THE WAY THAT
MEDIUM MEANS —

- **yt / podcast / tv (dialogue)**: the exchange — ±2 turns, ratified
  speakers, audio in place (already shipped for yt). Podcast: local mp3 →
  the clip tier works BETTER than YT; transcripts are whisper-generated and
  carry a ⚙ badge + `generated:` frontmatter (machine-heard, honestly
  marked). TV: jimaku `.srt` → standard transcript; when the Plex server is
  reachable, an adapter cuts audio clips (and a still frame) at sub
  timestamps — same clip machinery as YT, media from the server instead.
- **manga**: the PANEL IS the context. Store the page/panel crop in the
  vault; OCR (existing §4 vision pipeline, manga-tuned prompt, bounding
  boxes requested) gives bubble text + bbox; the context window renders the
  IMAGE with the captured bubble highlighted (bbox overlay) and neighbor
  bubbles as tappable text below. Text-only context for manga is a lossy
  projection — never the primary rendering.
- **book / note.com (written)**: the PARAGRAPH is the context. ±1 paragraph
  rendered as prose (indented, justified, book-shaped — NOT chat rows),
  source line pinned (title + location / URL), door = kindle deep link or
  note.com anchor. No audio tier, no speakers — written context is flow,
  and the renderer must read like a page.
- **x**: the tweet + its thread parent when captured. Door = tweet URL.
- **dict / corpus (curated — see 22.3)**: the ENTRY is the context — the
  example rendered inside its sense structure, door = the entry itself.

**出会いの履歴 (meeting timeline)**: the entry detail gains a horizontal
timeline of attestations across mediums by `addedAt` — first heard in video
X, then read in book Y, then a tweet — the visual manifestation of "my study
with the material" derived from data we already store. 

### 22.3 The three strata — lived / curated / 生成

Dictionary examples and corpus hits are REAL language but not YOUR exposure.
The hierarchy, enforced everywhere (tree order, ranking, badges, SRS):

1. **lived** — yt, podcast, tv, manga, book, note, x: things you actually
   met. The context tree's body; drives ranking; the only stratum that
   counts as exposure.
2. **curated** — dict, corpus: 📖-badged, grouped after lived attestations,
   capturable from dictionary entries and corpus profiles (22.5/22.7),
   valid SRS material, better than 生成 and never confused with lived.
3. **生成** — scaffold (§20.3): last resort, auto-retiring. Unchanged.

### 22.4 TokenCanvas — the taxonomy embodied in gesture (pencil-first)

ONE component renders any sentence/tweet/bubble/passage as token pills and
accepts marks. Each class's DEFINING TEST becomes its gesture — the
manipulation IS the semantics:

- **drag across tokens** → span bounds → 🟡 serifu / 🔵 collocation (the
  unit is the surface; you draw its edges)
- **tap multiple non-adjacent tokens** → the parts of a link → 🟠 skeletal
  (you literally pick the bones)
- **strike through middle tokens** → struck tokens become ○○ slots, kept
  tokens the fixed frame → 💠 (the REARRANGEMENT TEST as a gesture: what
  you can cross out and refill is the slot)
- **circle one token** → the evocative pivot → 🟢, then drag the halo
  handles outward to set how much rendering travels with the lemma (the
  EVOCATION TEST: you circle what does the evoking)
- **draw an arrow from the utterance to a prior turn** → 🔴 discourse edge
  with target (the RESPONSIVITY TEST as ink — the →/↳/↧ notation drawn by
  hand, landing in the gold store as edge + target). this needs to work really well and actually feel nice to use and be fast, there might be room for the apple pages psuedo-inspiration thing i talked about
  -Caveat: it must be stated that the tokens themselves must be accurate, dynamic and respond to variation in every sense, and each note type must be suited to the kinds of suggestions. Or as accurate as possible. 

**Suggestions are pentimento**: machine proposals render as FAINT pre-drawn
marks (a faint span, faint strikes, a faint arrow) from the suggester +
detectors + discovery chunker. Tracing/tapping a faint mark accepts it —
one stroke = classified + payload-filled; drawing your own overrides it —
and every accept/override is recorded suggested-vs-chosen. Finger works
everywhere Pencil does (44px+ targets, tolerant recognition — paperlike
screens favor drawn strokes over precise taps). TokenCanvas replaces the
part-picking fields in CaptureModal, powers the X span picker (22.6), and
runs on manga bubble text and book passages.

Tokenization for the pills: dictionary-validated longest-match (the same
deinflect machinery, per §20 飛び込み) with kana-run fallback — accurate or
coarse, never confidently wrong.

**The Pages reference, resolved (user: a loose inspiration to deduce from).**
Three gleanings adopted: (1) marks anchor to TEXT, not position — token
indexes, never pixels (Smart-Annotation behavior); (2) reuse the SYSTEM ink
vocabulary — scratch-out and circle are Scribble muscle memory, so strike
and circle ride habits the iPad already taught (a zigzag scratch counts as a
strike, v2); (3) draw-then-snap — rough input is accepted and visibly snaps
to token boundaries.

**v1 SHIPPED 2026-07-18** (`src/notes/token-canvas.ts` PURE +
`src/ui/TokenCanvas.ts`, golden/canvas.mjs 14 checks): tokenizer with
deinflection-validated okurigana splitting (昨日書いた → 昨日|書いた,
勉強した whole via the し-heuristic; probe = dictionary lookup when dicts
exist); marks model + deriveFromMarks (priority circle > strike > parts >
span — the most deliberate mark wins); tap=部品 / drag=範囲 /
長押しドラッグ=スロット / ダブルタップ=◯軸 + halo-drag; pentimento chips
from the discovery chunker (inflection-located); wired INTO CaptureModal —
marks live-drive the note field, payload fields, and class chips. 🔴 arrow
gesture + zigzag-scratch recognition + machine strike/circle suggestions
are v2.

### 22.5 Dictionaries — recursive, capturable, monokakido to the bone

- **Structured entries**: render Yomitan structured content faithfully
  (senses, sub-senses, EXAMPLE SENTENCES as first-class rows — the
  Kenkyūsha 新和英大 examples are the crown, and other dictionary entries and their structures as well). Every Japanese string in an
  entry is 飛び込み-tappable (recursion); cross-references inside entries
  resolve in-panel; multiple dictionaries = tabs per headword.
- **Every example sentence is capturable**: a quiet 🏷️ per example opens
  TokenCanvas over it → catalog entry with a `dict`-stratum attestation
  ({sourceName: 辞書名, entry: headword}) whose door leads back INTO the
  entry. The dictionary stops being a lookup and becomes a mine.
- **External dictionary pages** (goo辞書 etc.): selection → `jpc-capture`
  (share sheet). No per-site scrapers — the fragility rule stands.
  -There should be various ways to capture. Capturing all collocations, entries and parts of entries, all the ways a word is used in say example sentences and those sentences and translations if that dict has them, all ways that also work with the schema. Everything is supposed to amount to my input and what is encountered, alongside ways to, say, capture stuff from transcripts in obsidian even if not directly touched note wise to have in the lexicon. This must be readable, useable, nice, its like the Pokedex of JP input, i am the subject but it is an emergent product of me, my input, external sources and corpus etc. 

### 22.6 X — the span picker

Tapping a tweet opens TokenCanvas over the full tweet text: faint suggested
spans (detectPatterns + discovery chunker + suggester), pencil/finger marks
choose what is actually selectable and saved — multi-span for 🟠 parts,
strikes for 💠, circles for 🟢 — then the class suggestion runs ON THE
MARKED MATERIAL (not the whole tweet: the current classifier is lackluster
precisely because it classifies the tweet instead of the selection). Save →
catalog with the tweet as a lived-x attestation, exactly today's spine.

### 22.7 Hyogen / TWC — from bulk scrapers to enrichment adapters

The word-list bulk scrape into the legacy store dies. Corpus access becomes
**on-demand enrichment of ONE catalog entry**: a 語法 action in the entry
detail queries the corpus adapters for THIS key and renders a 語法プロフィール
block — common collocates, particle frames, register notes — with each
corpus example capturable as a `corpus`-stratum attestation. Results are
cached in the entry (fetched once, frozen — invariant §2.4), adapters stay
one-file isolated (§2.2), everything degrades soft. The corpus serves the
catalog; the catalog never serves the corpus. the twc way ied.n which entries are fomratting is interesting to think about  as it is further encourporated. 

### 22.8 収集トレイ (the collection tray) — drag-and-drop inbox

A drop-target view (narrow, Stage-Manager-shaped) that accepts edrops from
any app: images (manga panels → OCR affordance), text (dictionary examples,
passages, tweets → TokenCanvas), URLs (→ fetch/capture). Every drop lands
as an UNPROCESSED card in `_inbox` — quarantine, exactly like sweep
candidates: nothing enters the catalog without classification, but nothing
you flick into the tray is ever lost. Cards carry their drop provenance so
the eventual capture is scene-complete. The tray is where "reading with the
Pencil in hand" physically happens. Real time nice formatting applied depending on content and part of thing captured, say images or example sentences or dialogue or some combo of anything.

### 22.9 Build order on ratification

1. SceneRef schema + strata (everything else hangs on it) + medium-
   dispatched ContextWindow shells (book/prose renderer first — cheapest).
2. `.srt` import (jimaku) + book/note.com import → the first non-yt lived
   mediums prove the schema.
3. TokenCanvas v1 (drag-span + tap-parts + strike-slots on text) wired into
   CaptureModal and the X span picker; circle/arrow gestures v2.
4. Dictionary structured rendering + example capture (Kenkyūsha first).
5. 収集トレイ + manga OCR (bbox) + podcast RSS/whisper tier.
6. Corpus enrichment adapters (Hyogen/TWC rebuilt).
7. Then — and only then — JP Sentence Surfer integration (§23, unwritten).

## 23. The discourse stack — asking each layer only what it can know (2026-07-19)

User diagnosis, accepted in full: the discourse side "is hardly a parser" —
segmentation can't see quick speaker jumps (「うん。そこまで言う。」 is the
listener; 「急に…」 is the floor returning), can't name what the second
「感謝。」 in 「感謝した方がいい。感謝。日頃の感謝が…」 is doing, and
single-label classification is wrong-SHAPED for lines that are blurry under
meta/macro/thought-level lenses simultaneously. The fix is not a better
classifier. It is a STACK where every layer is only asked questions it can
actually answer, and the blur is stored as blur instead of being forced.

### 23.1 The two examples, analyzed (and now golden-locked)

- 「…感謝した方がいい。**感謝。**日頃の感謝が…」 — the second 感謝 is an
  **echo**: a bare predicate-less fragment re-uttering a word from the
  immediately preceding clause, re-anchoring the discourse on that lexeme
  before elaborating (a lexical retake/pivot). WHAT the echo does (savoring,
  distilling, comedic beat) is human, layer-4. THAT it echoes — fragment ⊆
  previous clause — is pure shape, machine-detectable at high precision.
- 「うん。そこまで言う。急に…」 — an **aizuchi + reaction cluster** followed
  by a **floor return**. Conversation-analysis adjacency logic as a prior:
  reaction-shaped fragments belong to the LISTENER by definition; when
  exposition resumes after a reaction cluster, the floor returns to the
  pre-reaction speaker. The turn grain is the SENTENCE, not the caption line
  — a single line can hold the flip and the return.

Both are implemented in `src/discourse/components.ts` (PURE, 13 golden
checks against these sentences verbatim) and surfaced as suggestion pills in
談話モード. Precision-first: plain exposition yields zero marks.

### 23.2 The four layers

1. **Turns (who / where)** — for local-audio mediums (podcast, TV via Plex,
   clips) this is a DIARIZATION problem, not a text-inference problem: the
   sherpa pipeline voice-lab already probes (diarBin/segModel/embModel) can
   speaker-tag the whisper segments → `[HH:MM:SS] A: …` lines. Stop guessing
   who's who from text when the audio knows. Text-only transcripts (YT
   captions) keep the humble time-gap default + the 23.1 flip/return
   suggestions + tap-corrections (`_discourseSeg` stays the ratified truth).
2. **Components (what shapes are present)** — echo, aizuchi, reaction,
   return, connective, quotative, fragment. Machine-suggested, ✓✕-ratified,
   each with evidence (the echoed word, the flip direction). This layer is
   the parser's honest ceiling today — and it's USEFUL: it is exactly what
   the 23.1 failures needed.
3. **Relations (what points at what)** — the →/↳/↧ notation (skeleton
   principle): responds-to, extends, undercuts, with explicit targets. Drawn
   by hand — the TokenCanvas arrow gesture lands HERE, on the 談話モード
   turn canvas where arrows between real turns mean something.
4. **Readings (what it's doing)** — move names, tone, meta-discourse, the
   macro/thought lenses. HUMAN-ONLY, PERSPECTIVAL, PLURAL: a span holds
   multiple readings under different lenses without contradiction (taxonomy
   v2's perspectival principle applied to discourse). Blur is data: 「うん。
   そこまで言う。」 can carry {aizuchi-component, tsukkomi-reading@micro,
   framing-shift-reading@meta} simultaneously — never one forced label.

### 23.3 Gold v2 — layered, so parsing data generation stops being flawed

The current gold example (utterance + act + one edge) forces layer-4 answers
at capture time — that's why generating parsing data feels fundamentally
flawed. Gold v2 records per-layer: turn corrections (already `_discourseSeg`),
component ✓✕ (new — every ratified/rejected pill), drawn relations, and
readings-as-a-set. Each layer trains its own successor model when volume
arrives; layer-2 data accumulates from ordinary 談話モード use starting NOW.

### 23.4 Build order

1. ✅ components.ts + 談話モード pills.
2. ✅ (2026-07-19) Sentence-grain turn splitting: `_discourseSeg` boundaries
   are now (line,char) pairs (backward compatible — old segs are the char:0
   case; `src/discourse/turns.ts` PURE, golden/turns.mjs). Tapping a
   flip/return pill splits at that sentence boundary with the CA-suggested
   speakers — the うん。そこまで言う。 case is one tap.
3. ✅ (2026-07-19) Diarization tier: podcast-transcribe runs the sherpa pass
   when the tools are installed → `[HH:MM:SS] A:` speaker-lettered lines
   (IoU segment attribution, `generated: whisper+sherpa`);
   parseTranscriptLines strips the letter into `MatcherLine.speaker` and
   談話モード's initial seg follows the letters as layer-1 truth.
4. ✅ (2026-07-19) Component ✓✕ persistence (`_componentGold`, keyed
   file|kind|unit|turn-head) + connective/quotative detectors (ratify-only
   pills — no structural change; precision-first: pause/fragment-gated
   connectives, bracket-or-quote-verb quotatives, bare という never fires).
5. ✅ (2026-07-19) The layer-3 arrow on 談話モード: ⤳ grip drag / tap-tap /
   keyboard r (j/k target, ⏎ commit, Esc cancel), chips cycle →/↳/↧ (key t),
   persisted per file in `_discourseRel` (relations model in turns.ts,
   golden-locked: retype-not-duplicate, self-refusal, merge-sanitize).
6. ✅ (2026-07-19, same session — the "after habits" sequencing was caution,
   not a dependency) Readings layer: 👓 / key y opens an inline editor on the
   turn — lens chips (微視/巨視/メタ/思考) + free label, PLURAL by design
   (same label under different lenses coexists; same-lens duplicates refused;
   machine never suggests here). Stored `_readingsGold` per file per turnKey;
   readings of merged-away turns drop with their turn. golden/turns.mjs.

Pencil/integration hardening (same session): TokenCanvas gained pointer
capture (drags survive leaving the row) and TRUE pentimento — the best
suggestion pre-drawn as a faint span on the tokens; tapping inside it before
any mark accepts it whole, drawing your own overrides. Diarized speaker
letters now ride into ContextWindow rows even without a ratified seg
(heard truth ≠ invented). Canvas pills raised to 34px+ touch targets.

§22 leftovers ✅ (2026-07-19): manga ContextWindow renderer (panel image +
bbox highlight + tappable neighbor bubbles from the tray card), ⚙ badge on
generated-transcript attestations (reads `generated:` frontmatter), TWC as a
second 語法 adapter (profileWord, merged with hyogen), dictionary example
sentences as first-class rows (`data content=example` → styled block).
§24 = Sentence Surfer, next.

### 23.5 The ergonomics contract (2026-07-19) — every surface, three hands

User mandate: moving things freely via Pencil, gestures, and keyboard must
have PERFECT coverage on every surface, every medium — enjoyable and fast.
The contract: every interactive surface supports all three input hands —
**Pencil/touch** (gesture, 44px+, drag-and-drop), **keyboard** (single-key
verbs on the hot paths, hints visible in the UI), **mouse** (everything
tappable is clickable). No action may exist in only one hand.

Shipped now (the hottest path first): CaptureModal — keys 1–6 select the
class (chip order, hinted with key badges on the chips), Ctrl/Cmd+Enter
saves, digits ignored while typing; TokenCanvas already covers the Pencil
hand (drag/tap/scratch/circle) and mouse. Existing: ReviewView Space + 1–4.

Coverage matrix — CLOSED 2026-07-19 (hints visible in place on every surface):
- ✅ 談話モード: j/k walk · a–d speaker · s split · ⏎ accept · x reject ·
  e capture · m merge · r arrow · t arrow-type; Pencil: tap-pill split +
  the ⤳ arrow drag.
- ✅ LexiconPanel: / search focus, j/k row walk (list rows AND detail
  leaves), ⏎ open (=✓ on candidate rows), x ✕; Pencil: swipe a candidate
  right=✓ left=✕ (horizontal-claim only, list still scrolls).
- ✅ TrayView: j/k walk, ⏎/e classify, x/Delete remove; Pencil: drag a text
  card ONTO the 語彙 view → capture with tray provenance (card stays —
  quarantine until classified). Long-press reorder deferred: reorder isn't
  an action in ANY hand yet, so the no-single-hand rule isn't violated.
- ✅ ReviewView: l revives leeches (hint on the 🛑 pill); Space + 1–4 existing.
- ✅ DictionaryView: / search focus, j/k walk capturable example rows,
  t/⏎ = that row's 🏷️ capture.

## 24. JP Sentence Surfer integration — reserved (explicitly deferred by user)

Unwritten. Note: §25.5's production-gold store is designed to be the data
Sentence Surfer will eventually want — the two sections meet there.

## 25. How input sits — the per-medium engagement contract (2026-07-19, PROPOSED)

§22 answered *what a scene is* (storage). This section answers the half the
user says is still being missed: **what the body is doing** when each medium
is being lived — which hand is free, where the eyes are, who else is in the
room, whether the medium can be paused — and molds capture to that posture
instead of asking the posture to bend. The §21.2/§22 pipelines moved the
*data* for every medium; several of them still assume an attention budget the
actual experience doesn't have.

### 25.1 The doctrine: posture → marks → harvest

Every medium has an **engagement posture**:

| medium | device / hand | eyes | pausable | social | live attention for the plugin |
|---|---|---|---|---|---|
| YouTube (study) | iPad + Pencil | screen | yes | alone | high — the current pipelines are right |
| YouTube (なりきり) | iPad, *mouth busy* | screen | yes | alone | **near zero while speaking** |
| Apple Podcasts | iPhone, one thumb | **elsewhere** (walking etc.) | yes | alone | near zero, screen often locked |
| Plex / TV | iPad on lap, TV elsewhere | mostly TV | **socially no** | **with dad** | glances only; silence; no scrolling |
| Manga (Manatan) | iPad, immersed reading | page | yes | alone | zero mid-page — leaving the reader breaks the read |
| Kindle / note.com | iPad/iPhone reading | page | yes | alone | low — highlighting is the native gesture |
| X | either, scrolling | screen | n/a | alone | medium — the app IS text |

The law that falls out, generalizing what the tray and the cards-first
pipeline already believe:

> **Live phases emit MARKS. Harvest phases do the thinking.**
> A mark is the cheapest gesture the medium natively affords (tap a line,
> screenshot, share-sheet ping, one big button) and carries only *where/when*
> — never a classification, never typed text. Nothing marked is ever lost
> (tray quarantine doctrine); nothing mid-experience ever asks a question.
> All marks converge on ONE harvest surface afterwards, where the full spine
> (context, TokenCanvas, CaptureModal, catalog, SRS) engages at leisure.

Concretely: the tray gains a card kind **`mark`** — `{ medium, sourceName,
file?, tSec? | loc?, wallClock, note? }` — enough provenance to re-manifest
the moment at harvest (transcript window at `tSec`, book location, spread
image). The harvest surface is the tray itself, with mark cards rendering
their re-manifested moment inline (ContextWindow does this already for
anchored attestations; marks reuse it pre-anchor).

Two hardenings found by stress-testing the law against real behavior:

- **The law is a floor, not a ceiling.** It exists for attention-poor
  postures. Where the posture affords rich capture (YouTube study with the
  Pencil — the whole §1 handwriting practice — dictionary reading, X
  hunting), the existing immediate paths stay primary. Marks never replace
  a capture the body was already happy to make.
- **A mark recovers the MEDIUM's content, never YOURS.** The transcript can
  reconstruct what the speaker said at `tSec`; it cannot reconstruct the
  thought *you* had there — and "I know when stuff needs to go down" is
  often that thought. So a mark accepts an optional **seed**: a one-word
  Scribble field / quick jot (`note?`), Pencil-or-thumb, ≤2 seconds,
  skippable. The seed is not the note — it is the retrieval cue that makes
  the thought recoverable at harvest. For anything longer, the paper-path
  (jot on the handwriting page, reconcile later) remains exactly right and
  is not deprecated by this section.

### 25.2 今ここ — one follow-along engine, four clocks

The single biggest missing piece across podcasts / Plex / なりきり is that
the transcript in the vault doesn't know **where in it "now" is**. One
component fixes all three:

`FollowAlong(transcriptFile, clock)`: binary-search the `[HH:MM:SS]` stamps
for the clock's position → the current line renders large and highlighted,
auto-scrolled (auto-scroll suspends the moment the user scrolls, resumes on
tap of a 「今へ」 pill — never fight the finger); ±2 lines visible dimmed;
**tapping any line = drop a mark on it** (one gesture, no modal). Clocks:

- **(a) local audio** — the plugin plays the imported mp3 itself (podcasts;
  `<audio>.currentTime`, works on mobile). Exact, zero setup.
- **(b) Plex session poll** — the server (`/status/sessions`, X-Plex-Token)
  reports the playing episode's `viewOffset`; poll ~5s + interpolate between
  polls; pause state respected. Adapter-isolated (§2.2), one file.
- **(c) manual sync + wall clock** — tap the line you just heard once; from
  then on the transcript advances on the device clock (pause/resync = one
  tap). Works for ANY screen — YouTube on the TV, broadcast, a friend's
  setup — no integration at all. Drift over a 25-min episode is seconds;
  resync is one tap. This is the universal fallback and ships first.
- **(d) none** — plain reading; FollowAlong degrades to today's transcript.

**The Plex glance dividend (the hard-to-hear fix):** with clock (b) or (c),
「今なんて言った？」 is answered by *glancing at the iPad* — the line just
spoken is already on screen in big type. No rewinding the shared TV, no
subtitles forced onto dad's viewing, no interaction at all. This alone makes
the companion transcript worth opening every episode, which in turn makes
marks free — the surface is already up.

### 25.3 Apple Podcasts (iPhone, one thumb, eyes elsewhere)

**Ratified constraints (2026-07-19, user):** Apple Podcasts stays the
player — moving playback into the vault is not the behavior. And Shortcuts
are out ("ehh and have been ehh") — no Shortcut may sit on any hot path.
The first draft of this section (Shortcut ping / in-vault study-listen as
the primary) is therefore superseded by:

- **The screenshot IS the mark — the manga doctrine generalizes to audio.**
  When something lands mid-listen, the zero-friction iOS act that needs no
  app switch, no unlock ceremony, and no Shortcut is a **screenshot of the
  player** — and the Apple Podcasts now-playing screen (lock screen
  included) shows exactly what a mark needs: **episode title + elapsed
  time on the scrub bar**. So: hear it → screenshot → keep walking. At
  harvest, the tray's screenshot recognizer (the same pinned vision client
  as manga/handwriting, one prompt variant) reads show/episode/elapsed off
  the player chrome → resolves against the episode's whisper transcript →
  a precise mark with full context, clips cuttable from the local mp3.
  One gesture, learned once, working from the lock screen. This makes the
  iOS mark story ONE doctrine across manga and podcasts: **the screenshot
  is the universal mark; the tray recognizes what it's a screenshot OF.**
- **In-vault listening survives only as an optional replay tier**: the
  episode note already embeds the mp3, so *harvest-time* relistening around
  each mark happens in the vault with exact audio — that's where FollowAlong
  clock (a) actually earns its keep for podcasts, not during the walk.

### 25.4 Plex / TV — the co-viewing contract

Postures: the show is shared; the iPad must be **silent, glanceable,
non-absorbing**. Scrolling, modals, and typing during the episode are design
failures even if technically available.

- **Before the show** (or once per series): jimaku `.srt` → `import-srt`
  (shipped) → the episode transcript note exists.
- **During**: FollowAlong with clock (b) if the server answers, else (c).
  The screen shows the current exchange only. Interactions permitted: glance
  (zero-touch), tap-line-to-mark, tap 今へ. Nothing else exists in this mode
  — a deliberate 鑑賞モード chrome-reduction, not a limitation.
- **After**: harvest walks the episode's marks with ±turns of context; where
  the Plex server is reachable, the adapter cuts the audio clip (and a still
  frame) at each mark's timestamp — the §22.2 TV scene promise, landed at
  the exact moments that mattered. Captures get real 📺 scenes; the episode
  note joins 談話モード for discourse work like any transcript.
- Needs from you: Plex server URL + an X-Plex-Token (Settings → adapter,
  secret-stored like the other tokens), confirmation the iPad can reach the
  server on LAN.

### 25.4b Where the Japanese subtitle comes from (jimaku) — SHIPPED 2026-07-28

The bullet above says "jimaku `.srt` → `import-srt` (shipped) → the episode
transcript note exists", and 25.4's first shipped increment made Plex read out
its own muxed track so that step could be skipped. **Both were conditional on a
premise that is false for a real library: that a Japanese subtitle exists
inside the file.** For live-action drama, older anime, and anything ripped from
a stream that shipped English-only, Plex has nothing to offer, and the pipeline
answered 「この作品には字幕トラックがありません」 — a correct, useless refusal.
Everything downstream (照合・走査・談話モード・⚡) already worked; the chain
simply had no way to start.

**The seam is the SOURCE of the text, and it is now behind one road.** Two
sources, one `writeTranscriptNote`, one note shape:

1. **Plex's muxed track** — first by default, because it is guaranteed to be
   in sync with the video it came out of.
2. **jimaku.cc** — when Plex has no usable Japanese text track (or always, per
   setting, for files whose muxed track is partial/English-only).

The transcript that results is the same object either way; nothing downstream
knows or asks which source it came from. What changes is only its provenance
line: `sub_source`, `jimaku_entry`, `jimaku_file`.

**Auto only where auto is honest.** A wrong entry or a signs-only file yields a
complete, plausible, WRONG transcript — the §12 failure mode that reads as
success. So the machine proceeds unasked only when there is nothing else it
could reasonably be: one clearly-matching work AND one file naming the wanted
episode with no non-signs rival. Everything else — sibling season entries, two
uploaders' releases of episode 4, a season known only to the filename — goes to
the picker, which shows the same ranking the auto path would have used, with
the top row labelled 推定 rather than chosen. Refusals name what exists and
why none of it was usable (archives cannot be unpacked here; these are the
episodes this entry actually has).

**Provenance survives the source change (§28).** A jimaku-sourced note still
carries `plex_rating_key` / `plex_part_key`, so 📺Plex同期 and the 🎬 clip
cutter keep working on a transcript whose text never touched the server. This
is also what closed three quieter losses in the same path: the library-browse
door was discarding `partKey` (no clips for any episode not currently playing),
the episode NUMBER was never read off `index`/`parentIndex` (the one thing an
external source must be asked for), and a second import of the same episode
silently forked the note, orphaning every mark made against the first.

**⌖ ズレ — the offset is a hand gesture, not a guess.** A subtitle that did not
come out of the video file can be timed to a different release: a distributor
logo, a different intro, ad breaks. Ten seconds out makes 鑑賞モード useless
while still looking like it works, and no amount of cleverness can detect it
from the text. So `sub_offset_sec` lives in the note's frontmatter (present at
zero for fetched subs — a field you can see is a field you can fix), the Plex
clock subtracts it, and 鑑賞モード grows a ⌖ chip *only while the server owns
the clock*: arm it, tap the line you hear, and the gap between the video's
position and that line's stamp IS the offset. One tap, one number, written back
to the note. Deliberately its own mode rather than an overloaded tap — a tap
already means 📍マーク, and a gesture meaning two things depending on hidden
state scatters marks at wrong timestamps.

Needs from you: a jimaku.cc API key (Settings → jimaku; secret-stored
device-local like the Plex token, never in the synced blob).

### 25.5 YouTube なりきりスピーキング — the practice becomes a first-class mode

The 本質, extracted from your description: **responsive production under
authentic time pressure, inside a real conversation's flow.** The value
lives in (1) taking a *turn-position* (kikite's slot, or yourself barging
in), (2) producing under a constraint (timer, lightning, counter), (3)
comparing your production against what the real speaker then said, (4)
honest self-assessment. The disorganization you apologize for is mostly the
tool-shaped hole: your head is currently holding the structure (whose turn,
what mode, how many points, what I wanted to write down) *while also
producing Japanese*. The plugin's job is to hold the structure so your head
holds only the language — and to make note-taking stop competing with
speaking, which is exactly the §25.1 law: **while speaking you never write;
you mark.**

**Ratified specifics (2026-07-19, user):** the practice is natively
**two-device** — the video plays on the **iPhone 17** (better screen), the
**iPad mini 7** holds Apple Notes + Pencil. So the companion never fights
the player for screen space: the plugin's session surface lives on the iPad
beside Apple Notes (or replaces it when marks suffice), and nothing about
the design assumes split-screen with YouTube. Rating happens **per-bout, in
the pause** (confirmed) — but the user flagged honest doubt that
qualitative 0–4 is even the right instrument ("I want to improve myself").
The design's response: the aspects and the 0–4 scale are STORED as raw
per-bout records but the *method* is deliberately swappable data — if the
practice later moves to binary checks, or comparison-anchored judgments
("closer to the speaker's actual turn than my last attempt?"), or anything
else, the session store schema (aspect-id + value + bout context) already
holds it. The tool must never entrench a rubric the user himself doubts.

**Seed aspects (the user's own, 2026-07-19 — editable data, not code):**
一貫性 (coherence) · 文脈適合 (context relevance) · 独自の寄与 (uniquely
adding value — e.g. the foreigner's perspective) · 簡潔さ (concision —
*topic-dependent*: philosophical topics legitimately run longer, so the
aspect is "appropriately concise for the topic", not "short") · 正確さ
(no major grammar/pronunciation/word-choice errors — baseline, but still a
factor) · 一発で言えたか (said in one go within reasonable/allotted time —
the hardest one against ゆる言語学ラジオ-speed conversation).

**発話セッション (a mode over any transcript note):**

- **Setup (10 seconds):** pick a mode — なりきり (role-response: you take a
  speaker letter, usually the kikite), 乱入 (as-yourself: react/join as you),
  自由 (open response), 瞬発 (lightning) — pick the constraint — ⏱ timer /
  🔢 counter-to-goal (your MultiTimer 30-points practice, native) / none —
  and, for なりきり, the role letter (from `_discourseSeg` speakers when
  present). Modes and constraints are **config data, not code** (§2.9 spirit)
  — your practice will keep mutating and the tool must not ossify it.
- **During:** FollowAlong (clock (c) manual-sync against the playing video,
  or (a) over local clips). TWO big buttons, bottom-anchored:
  **📍** (plain mark — "something here for later", the note-taking hand) and
  **🎤発話** (production mark — "I spoke at this turn"). Both are one tap,
  no text, no pause required. Corrections from re-reading the actual
  practice: the **points come from the RATINGS, not from speaking** (you
  rate 0–4 on aspects after a bout and those points make their way to the
  goal) — so when the counter constraint is active, a thumb-sized 0–4
  rating row may appear right after a 🎤 bout, *during the pause you were
  already in* (that IS your current practice; deferring all rating to the
  debrief is an option, not the default). And since なりきり pauses the
  video constantly, a wall-clock sync is useless here — **the marks
  themselves are the sync**: each tap on a line says "we're here now."
  Nothing else is on screen. If MediaRecorder proves usable
  in Obsidian mobile (probe first, degrade to nothing), 🎤 hold-to-record
  attaches your actual attempt audio to the mark — but the design does not
  depend on it.
- **After — the debrief (where the practice becomes data):** the session
  walks the 🎤 marks in order. Each shows: the context turns before your
  slot, **the actual next turn** (what the speaker really said — the
  comparison you currently do by intuition, made structural), your recorded
  attempt if any, and the rating row: your aspects, each 0–4. Aspects are a
  user-editable list (seeded from nothing — you name them; the tool must
  not invent your rubric). Points accumulate toward the session goal.
  Any mark (📍 or 🎤) opens normal capture with full context. Ten quiet
  seconds per mark, after the flow-state ends — never during.
- **What persists:** `_speakSessions` — session config + marks + ratings +
  totals (your practice's memory: trends per aspect, per channel, per mode —
  renderable later, stored now). And each debriefed 🎤 mark is a
  **production-gold** record: `{contextTurns, role, constraint, actualTurn,
  attemptAudio?, ratings}` — a NEW gold stratum. Comprehension gold (§13,
  §23.3) records how you *read* discourse; this records how you *produce
  into* it. It is precisely the data a future Sentence Surfer (§24) or
  production-side drill generator is starving for, and no tool on earth
  collects it — it falls out of practice you already do.
- **Explicitly NOT:** the plugin does not drive the video, does not auto-
  pause, does not enforce the timer (MultiTimer can stay — the plugin is
  scorekeeper and memory, not metronome), and never grades you. The 0–4 is
  yours; suggested-vs-chosen has no meaning here because there is no
  machine opinion. When you "know when stuff needs to go down" — that's 📍,
  one tap, and the thought is safe without leaving the conversation.

### 25.6 Kindle / note.com — input that sits as a document (the artifact answer)

Your requirement, taken as the contract: a captured passage must not be
「locked away」 in a store or reduced to a flashcard — it must remain a
**standing artifact of your engagement with that book/topic**, where
idea-level annotation and linguistic extraction both live and both work.

- **One note per book/article — the artifact.** `import-written` (shipped)
  grows: imports merge idempotently **by location** into a single
  `source: book` note per book, highlights in location order. Between and
  around the highlights, TWO registers interleave, visually distinct:
  - **typed linguistic captures** — the six-class callouts, rail-colored,
    each also in the catalog (a *reference*, per invariant §2.1 — the note
    remains the truth);
  - **💭 thoughts** — plain prose blocks with `[[wiki-links]]` into your
    topic notes. NOT in the catalog, NOT a class — ideas are not language
    data, but they belong to the same encounter. Every capture surface
    gains a quiet 💭 route (a seventh chip that is explicitly not a class):
    it writes to the source artifact instead of the catalog. This is
    cross-medium — a thought about a podcast exchange lands in the episode
    note the same way.
  Read top-to-bottom, the note is *your passage through the book* — the
  Pokédex principle (§22.5) applied longitudinally: you are the subject,
  the artifact is the emergent product.
- **The export path must be taught, not assumed** (user 2026-07-19: "I use
  the app" — the notebook-export flow isn't known practice). The import
  surface therefore *guides*: the ImportModal's Kindle mode shows the
  actual in-app path (book → notebook icon ▤ → share → 引用をエクスポート
  → 送る先はObsidianでもファイルでも → paste/pick here) and the parser
  accepts BOTH the app's export-citations format (with its 位置No. lines
  and publisher boilerplate, stripped) and a raw paste from
  read.amazon.com/notebook (the web notebook — every highlight for a book,
  copy-paste-able, no per-book export ceremony). Lock the parser against a
  real export from the user's app the first time they run it — the format
  is the truth, the doc is the guess.
- **The Kindle context problem, honestly.** Kindle exports give the
  highlight text only. The design refuses fake continuity: (1) the
  practice-side fix is stated in the UI — *highlight generously*; the
  paragraph you highlight IS the scene, and TokenCanvas picks the span
  within it at harvest (capture the sentence, keep the paragraph); (2) the
  location becomes the door (`kindle://` deep link with book ASIN +
  location — probe the scheme on your device; else the artifact's location
  line is the address); (3) neighbor highlights render as context with a
  visible 「…」 gap marker — never pretending adjacency. No scraping of
  book content beyond your highlights: your input is what you marked.
- **note.com**: same artifact shape per article (`source: note`, URL door,
  paragraphs as prose — renderer shipped in §22). Share-sheet selection →
  `jpc-capture` is already the capture path; the addition is only that
  captures append to the article artifact when one exists.

### 25.7 Manga — the screenshot IS the mark

The reading experience must never be exited mid-page — and it never needs
to be, because iOS screenshots are the perfect mark gesture: instantaneous,
no app switch, muscle-memory, and they capture the *scene itself*. The §22
pieces (tray image cards, OCR, bbox capture) are right; what's missing is
the **session shape** around them:

- **Live phase = just read.** Screenshot anything that lands. Zero plugin
  interaction. (This is already your behavior — the design's job is to stop
  punishing it with per-image drag-and-drop afterwards.)
- **Ingest without friction:** a 📷 button on the tray opens the system
  photo picker with **multi-select** — one visit, grab the evening's
  screenshots, done. (The first draft's Shortcut-based auto-ingest is
  demoted to "never build unless asked": Shortcuts are out per the user's
  2026-07-19 ratification, and the picker is one tap worse but zero setup
  and zero fragility.)
- **Session grouping:** time-clustered screenshots (same evening, gaps
  <30min) render as ONE 読書セッション group in the tray, in shot order —
  your reading, reassembled. One 「🔎 全ページOCR」 runs the batch (cost
  visible up front); then harvest pages *in order*, bubble by bubble.
- **The page-chain invention:** consecutive spreads' bubbles, concatenated
  in reading order, form a **pseudo-transcript of the scene's dialogue** —
  which means the dialogue machinery (談話モード turn work, 🔴 capture with
  real prior turns, echo/reaction pills) works on manga conversation.
  Manga is dialogue; until now only its images knew that. Scene stays
  image+bbox (the panel remains the primary rendering, §22.2 — the
  pseudo-transcript is for *discourse context*, not for display).
- Needs from you: whether Manatan exposes a URL scheme (deep-link door);
  else the stored spread stays the return destination (already true).

### 25.8 X — the scene is the thread

X's posture splits: **hunting** (deliberate in-plugin search — shipped, span
picker and all) and **serendipity** (scrolling the real app, where a tweet
ambushes you). Serendipity's mark is the share-sheet (→ `jpc-capture` /
tray URL card → syndication fetch). The miss: a lone tweet is very often a
*response*, and capturing it alone amputates the responsivity its 🔴 reading
needs — so the syndication fetch gains **thread-parent retrieval**: when the
tweet has a parent, fetch it too, store it as `contextBefore` + render it in
the scene (the §22.2 "thread parent when captured" promise, made automatic).
The quoted tweet counts as a parent. Depth 1 is enough — the scene is the
exchange, not the whole thread.

### 25.9 What this section buys, structurally

One new tray card kind (`mark`), one new component (FollowAlong + its three
real clocks), one session store (`_speakSessions` + production gold), one
register (💭 → source artifact), and a Shortcut or two. Everything lands in
the EXISTING spine — tray → TokenCanvas → CaptureModal → catalog → scenes →
SRS. No new stores of language data, no new formats, no parser work.

**Build order on ratification:**

1. `mark` card kind + FollowAlong with clock (c) manual-sync (universal, no
   integration) → Plex/TV co-viewing works *tonight* with jimaku alone, and
   なりきり marking works over any transcript.
2. Podcast study-listen: clock (a) + thumb transport + resume (the mp3s and
   whisper transcripts already exist).
3. 発話セッション: modes/constraints config + 📍/🎤 + debrief + ratings +
   `_speakSessions` + production gold. (MediaRecorder probe rides along,
   optional.)
4. Book artifact merge-by-location + 💭 register (+ note.com append).
5. Manga session ingest (folder watch + grouping + batch OCR) + page-chain.
6. Plex clock (b) + clip/still cutting at marks (needs server token).
7. X thread-parent fetch.

**Needs from you before the relevant step** (updated 2026-07-19 after
ratification — aspects ✓ answered, podcasts ✓ answered, devices ✓
answered): Plex URL + token (6); a real Kindle export from your app the
first time you run the guided import (4); Manatan URL-scheme check (5).
Ratified same day: manga session ingest = **build now**; Shortcuts banned
from hot paths everywhere; Apple Podcasts stays the player (screenshot-mark
doctrine replaces both prior podcast tiers).

> **SHIPPED 2026-07-19 (steps 1–3 + 5 + podcast recognizer; golden/follow.mjs
> 37 checks, all 31 suites green):**
> - **Marks** (§25.1): inbox gains `mark` cards (`MarkRef` medium/file/tSec/
>   loc/sourceName/seed/wallClock, `markCard`); TrayView renders them
>   (stamp + seed) and 🏷️ re-manifests the moment via
>   `resolveMarkContext` (main reads the transcript at tSec → ±3 turns +
>   speakers into CaptureModal). Marks never enter 読書セッション groups.
> - **鑑賞モード** (`src/ui/FollowAlongView.ts`, view `jp-follow-view`,
>   command `open-follow-along`, hub-menu 👁): clock (c) in
>   `src/notes/follow.ts` (PURE — sync/pause/resume wall-clock arithmetic +
>   binary-search `currentLineIndex`, untimed lines never win). First tap =
>   sync only; after that tap = resync + 📍 tray mark; long-press = one-word
>   seed input; auto-scroll suspends 8s on user scroll with a 「⌄今へ」pill;
>   current line renders 20px against dimmed context (the Plex glance).
>   Keys: j/k ⏎ s(sync-no-mark) m p g (+ y in session). Timestampless files
>   get a warning banner, not a refusal.
> - **発話セッション** (`src/notes/speak-session.ts` PURE + store
>   `_speakSessions`): modes なりきり/乱入/自由/瞬発 + constraint
>   counter-to-goal/timer/none + role letter (from diarized speakers) as
>   config data; during = 📍/🎤 big buttons only; 🎤 opens the per-bout
>   rating row (aspects 0–4, live points update, skippable); points = sum
>   of RATINGS (golden-locked: speaking alone earns nothing, 📍 never
>   earns); debrief walks marks with the ACTUAL next turns + re-ratable
>   rows + 🏷️ capture; past sessions reopenable (過去n回 chip). Aspects +
>   goal live in settings (発話セッション section) seeded with the user's
>   six; sessions freeze their aspect list (rubric may evolve).
> - **Podcast screenshot-mark** (`src/notes/player-shot.ts` PURE):
>   PLAYER_PROMPT reads episode/show/elapsed off player chrome (elapsed =
>   left of the scrub bar; missing elapsed → coarse mark, not failure);
>   `matchEpisodeNote` exact→containment→bigram-Dice≥0.5, null over
>   confident-wrong; TrayView image cards gain 🎧 プレイヤー認識 →
>   `recognizePlayerShot` (same pinned vision client) converts the
>   screenshot into a precise podcast mark card and removes the image.
> Remaining from this section: Plex clock (b) + clip cutting (needs token),
> book-artifact merge + 💭 register, manga page-chain, X thread-parent.

## 26. The Monokakido realization (2026-07-19 — from the user's own recording, not from memory of the brand)

Source of truth: the user's 55s screen recording of ACE CROWN 4 in
Monokakido Dictionaries on the iPhone 17
(`videos/ScreenRecording_07-15-2026 18-17-42_1.mp4`), frame-analyzed this
session; six reference stills are committed at **`_ref_monokakido/`**
(f01 minimal entry + chrome, f12 entry anatomy, f18/f32 selection-echo,
f25 なぜ？ box, f40 似ている単語 box + neighbor pills). **Any implementer
MUST view those frames before writing code.** Previous attempts failed by
carbon-copying surface features; this section extracts the grammar and
applies it to OUR objects.

### 26.0 Seamless integration, defined (the gate everything must pass)

Theoretical definition — seamlessness is the absence of cognitive cost at
the boundary between tool and content, decomposed into five properties:

1. **No remembered modes.** All state is visible in place; nothing behaves
   differently because of something you did on another screen.
2. **No translation step.** The verb is performed ON the content in the
   content's own representation (marks on tokens, taps on lines, selection
   on sentences) — never on a proxy (form fields describing the content).
3. **No place-change to complete a thought.** Actions finish where
   attention already is; content never leaves the visual field to be acted
   on. (The capture modal is the tolerated exception — and TokenCanvas
   inside it exists to honor rule 2.)
4. **One grammar everywhere.** The same color, box shape, badge, or key
   means the same thing on every surface. Knowledge transfers with zero
   relearning; the product feels like ONE typeset system, not screens.
5. **Continuity of identity.** An entry seen in search, in the context
   tree, in SRS, in a sidebar is the SAME object re-rendered — never a
   copy with different affordances.

Operational tests — a feature ships ONLY if all five hold:

- (a) it **removes a step** from an existing workflow (count the taps/
  glances between intention and result — the number must go DOWN);
- (b) it is **discoverable by doing what you already do** — no tutorial;
- (c) it works in **all three hands** (§23.5) or degrades honestly;
- (d) **removing it would make a real workflow longer** — not just uglier;
- (e) every visual element **encodes semantics** — color, box, weight,
  and motion that carry no information are banned.

**The gimmick test (hard rejection):** if a feature demos well but does
not change the step/glance count between intention and result, it is a
gimmick. No parallax, no decorative animation, no novelty gestures.
Motion is permitted only when it encodes information (e.g. the neighbor-
walk transition encodes "you moved through the index, not to a random
result" — and even that ships last and dies first if it janks).

### 26.1 What the recording actually shows (the grammar, frame by frame)

- **The entry is a typeset ARTICLE, not a UI** (f12, f40). Inside the
  content area there is zero chrome: no cards, no dividers except
  semantic boxes; hierarchy is typography alone. The information design
  IS the interface.
- **A small, fixed semantic color grammar, learned once** (f12, f40):
  red = headword/JP-gloss/section-labels/warnings; blue = example
  sentences with the target word bold; green = idioms/set-phrases
  (`the coast is clear`); black = translation prose. Badges are
  shape-coded (A1 filled square, 文型 outlined, 名/動 boxed, ❗ inline).
  Color is never decoration.
- **Knowledge boxes are typed objects** (f25 なぜ？, f40 似ている単語,
  f12 ⇒フォーカス chips): red-banner boxes with a NAMED pedagogical role,
  inline in the article at the point of relevance. Crucially, 似ている単語
  discriminates near-synonyms **by their image** (beach = 砂浜の行楽地 /
  coast = 広い沿岸地方 / shore = 岸辺一般) — which is EXACTLY this
  plugin's 🟢 gesture-family theory (§7: family members differ precisely
  in their image), shipped by a commercial dictionary.
- **The dictionary is a SPACE you walk, not a query you fire** (f01,
  f40): persistent prev/next headword pills in the bottom corners
  (二月|苦み, be|béach bàll), a ghost of the previous headword during the
  walk, an in-entry index (≡), and a ▾ chevron that switches DICTIONARY
  while holding the same headword. Position and locality persist.
- **Selection is a verb** (f18, f32): selecting text pink-highlights it
  and echoes it enlarged in a banner — selection immediately offers
  jump/search. Text is never inert.
- **Density with hierarchy, and honesty in it** (f40): pronunciation row
  carries audio AND the anti-reading (×コースト — "not this"); inflection
  micro-tables sit inline; nothing is hidden behind disclosure for
  tidiness. Density never reads as noise because the grammar is strict.
- **A persistent identity bar** (all frames): Search/Bookmarks/History/
  Appendices/More — the app's few global places, always one tap, never
  nested.

### 26.2 Applied to OUR objects (innovation, not carbon copy)

The plugin's content is what no commercial dictionary has: lived
attestations with scenes, six classes, strata, the user's own error and
ratification record. The realization = monokakido's grammar rendering
THAT:

1. **Semantic grammar tokens** — one CSS block defines the system-wide
   grammar: class rail colors (already §7-fixed) + example-blue +
   idiom-green + warn-red + box-banner style + boxed-badge style. Every
   surface (LexiconPanel, DictionaryView, ContextWindow, ReviewView,
   TrayView) consumes the SAME tokens. This is property 4 made physical.
2. **Entry-article pass** on the LexiconPanel detail: headword block
   (reading under, boxed class badge, strata badges, attestation count),
   then gloss, then the 用例 tree AS the body (already §20) restyled to
   the grammar — quotes example-blue with the matched span bold
   (findTermAll already locates it), translations/notes black.
3. **Typed knowledge boxes** (one renderer, named roles):
   - 語法プロフィール (§22.7) renders as a 似ている単語-class box;
   - a 🟢 entry whose gestureFamily has siblings AUTO-COMPOSES a real
     似ている単語 box from the family members and their gesture names —
     the user's own image-discrimination theory, self-assembling from
     their captures. **This is the flagship innovation of the section.**
   - scaffold examples render in a 生成-banner box (existing rule, new
     dress); discourse readings (§23 layer 4) render as a なぜ？-class
     box on 🔴 entries.
   - **The personal ❗ box**: reconciliation corrections (効く→聞く
     homophone record) and sweep rejections for THIS entry render as
     ×-marked anti-readings — the dictionary warns about the user's OWN
     demonstrated confusions, from data already stored. No commercial
     dictionary can do this.
4. **Space-walking**: prev/next pills (bottom corners, thumb-reachable)
   on LexiconPanel detail (catalog neighbors in the current sort/index)
   and DictionaryView entries (dictionary order); ≡ floating in-entry
   section index (senses/用例/語法/家族); ▾ on the headword switches the
   RENDERING of the same surface form across stores (catalog ⇄ dictionary
   ⇄ corpus) — same key, different authority, one gesture.
5. **Selection-echo**: selecting text inside any plugin view raises the
   echo banner (enlarged selection + 検索 / 🏷️ / 💭). Plugin views only —
   never fight the Obsidian editor's own selection UI.

### 26.3 Per-platform native existence (each platform gets its OWN verbs)

One grammar (26.2) everywhere; different native verbs per hand. Nothing
below is "the same feature on three screens" — each item is the thing
that platform is uniquely best at, and each must pass 26.0.

- **iPhone 17 — the one-thumb walker.** Reading zone on top, EVERY
  actionable element in the thumb zone (corner pills, bottom bars —
  ACE CROWN's own layout law). Swipe left/right on the entry header =
  neighbor walk. Persistent mini identity bar (語彙・辞書・復習・トレイ・⚡)
  as a footer inside plugin views on `Platform.isMobile`. Selection-echo
  actions sit at the thumb, not at the selection. The screenshot-mark
  doctrine (§25.3/25.7) is this device's capture verb. The phone is for
  WALKING and MARKING, not for annotating.
- **iPad mini 7 + Pencil (paperlike, Stage Manager) — the ink surface.**
  Ink is the verb: TokenCanvas gestures + pentimento (shipped) are the
  center of gravity. Additions that are natively Pencil: (1) **hover
  peek** — iPad mini 7 supports Pencil hover; hovering a Japanese word in
  any plugin view peeks its entry in a floating preview BEFORE committing
  (feature-detect `pointerType === 'pen'` hover events; silently absent
  otherwise); (2) Scribble-safe inputs everywhere (real `<input>`
  elements, no fake fields — Scribble then works for free); (3)
  cross-pane drag as the standing verb (tray⇄語彙 shipped; extend to
  dragging a 用例 quote onto the SRS view = card, onto a book artifact =
  💭). The iPad is for READING WITH A PEN IN HAND.
- **Desktop (mouse + keyboard, Windows) — the composition engine.**
  Keyboard is a LANGUAGE, not shortcuts: the §23.5 verb set (j/k ⏎ x /
  s m p g y t e) is already standardized — hold that line for every new
  surface. Mouse hover = instant preview on every entry link and 飛び込み
  word (the mouse's superpower; zero-cost on desktop, absent on touch).
  Multi-pane composition: entry + ContextWindow + tray tiled side by
  side; bulk ratification runs at keyboard speed. The desktop is for
  PROCESSING VOLUME.

### 26.4 Build order (each step independently shippable, gimmick-gated)

1. Semantic grammar tokens (CSS custom properties) + entry-article pass
   on LexiconPanel detail. (Foundation — properties 4/5.)
2. Typed knowledge-box renderer + wiring: 語法 box, 生成 box, なぜ？
   readings box, **❗ personal anti-error box**, **🟢 family
   discrimination box** (flagship).
3. Space-walking: neighbor pills + ≡ section index + ▾ store switcher.
4. Selection-echo verb (plugin views only).
5. Platform verbs: phone footer bar + header swipe; Pencil hover peek;
   desktop hover previews. (Feature-detected, degrade silently.)
6. LAST and only if it never janks: the neighbor-walk ghost transition.

> **SHIPPED 2026-07-19 (catalog + dictionary realization; build green, all
> 31 golden suites + patternstore 25):** Frames watched, six committed to
> `_ref_monokakido/`.
> - **Grammar tokens** (styles.css §26 block): `--jpc-sem-example/idiom/warn`,
>   `--jpc-box-banner`, and per-role box hues (`family`/`naze`/`goho`/
>   `warn`/`gen`) resolved through Obsidian's palette (theme-aware). The
>   dictionary's example rows (`.jp-dict-sc--example`) now consume
>   `--jpc-sem-example` — an example reads the same blue on catalog AND
>   dictionary (property 4 made physical).
> - **`src/ui/knowledge-box.ts`** — one `knowledgeBox(host, title, tone)`
>   renderer (banner + body + role rail). Empty boxes never render.
> - **LexiconPanel entry-article** (§26.2): headword block gains reading-
>   under-headword, boxed badges (class/用例count/family), and the context
>   tree stays the body. 語法 + 生成 scaffold refitted into knowledge boxes.
> - **Flagship boxes**: 似ている表現 auto-composes from the user's OWN
>   captures — cross-lemma `payload.family` members, or (no family) the same
>   🟢 lemma's other gestures — each row = member + its image/gesture desc,
>   tappable to walk there, self-row pinned. The **personal ❗ box** renders
>   the entry's `rejectedExamples` (new pattern-store field: the QUOTES of
>   ✕'d sightings, capped 5, populated in `rejectAttestation`) as ×-marked
>   strike-through anti-readings — the dictionary warning about the user's
>   own demonstrated confusions. Golden-locked (patternstore 25).
> - **Space-walking** (§26.3): neighbor pills in the detail's thumb corners
>   (prev/next in the CURRENT list order — `neighborsOf`), `h`/`l` keys, and
>   header touch-swipe all walk to the adjacent entry (`walkTo`).
> - **Hover peek** (§26.3): `src/ui/hover-peek.ts` — ONE shared `HoverPeek`
>   component (dwell-gated, mouse/Pencil only via `pointerType`, never touch,
>   viewport-clamped, pointer-transparent). Used by BOTH LexiconPanel (over
>   `.jp-lex-tappable`, longest-match `wordAt`) and DictionaryView (over
>   `.jp-dict-clickable-word`, in-place preview that keeps your place in the
>   current entry). The shared component IS the seamless integration.
> Remaining §26: selection-echo verb, phone footer bar, and the ghost
> transition (build order steps 4–6) — deferred, none blocking.

## 27. The production lexicon — a dictionary that inverts look-up into reach-for (2026-07-20, PROPOSED)

Correcting my own first pass (the user pushed back twice: the plugin's
philosophy is the core, and Eijiro's genuine uniqueness must inform it — not
be flattened into "feedstock"). This section is written from the plugin's
actual philosophy, grounded in §7 and the taxonomy-v2 memories.

### 27.0 What this plugin IS (so the dictionary can be built from it)

This is not a comprehension dictionary with capture bolted on. It is a
**production lexicon**: the governing question everywhere is *how is an
utterance mentally ASSEMBLED in production* — what you REACH FOR. The six
classes are processing units on a grid of unit-shape × stratum; the unit is
never "the word." 🟢 is the heart: you reach for an evocative lemma because
it holds an **image** that affords a grip, and a gesture-family's members
differ precisely by their image (漏れなく=no leakage / 一つ残らず=none left /
ことごとく=itemized sweep) — *the image difference is why you pick one, which
is the production insight itself.* Class is perspectival (what it gives
insight INTO × how you produce it), attested (encountered, never fabricated;
lived > curated > 生成), and human-classified (machines suggest as
pentimento; the evocation/rearrangement/responsivity tests decide).

A normal dictionary answers **"I met X — what does it mean?"** (comprehension,
headword-alphabetical). This plugin answers **"I want to express THIS — what
reaches for it, and why this over its siblings?"** (production, organized by
gesture/image/frame/situation). Every dictionary the user owns is
comprehension-organized. The design act of §27 is to **invert access**: use
the dictionaries as the substrate of one production index, entered from
meaning-you-want-to-produce, unified with the lived catalog (which is already
a production index — the 🟢 gesture catalog keyed by evocative lemma, the
似ている表現 family box §26.2). The dictionary becomes the *curated stratum of
the same production index the catalog is the lived stratum of.*

### 27.0.1 The real purpose (the donor email is the spec) + the two directions

Governing source: `Documents/Bridging foundation email.md` (the user's
scholarship essay). Its thesis is the plugin's north star: **"language mastery
is reconstructing yourself in the language… not by translating, but seeing the
connections between your native and target language that are not
translatable."** "The combination of words and grammar is greater than the sum
of its parts" (→ the note types). "Despite Japanese and English being
completely different, I noticed glimpses of myself… something that underlies
both languages" (→ the 普遍文法 the user names). The essay's worked example —
wanting **"at some point"**, finding it in no dictionary, then *hearing* a
podcaster say **どっかのタイミングで** and recognizing it as the exact
reconstruction — IS the governing use case. The dictionary is not a reference;
it is a **self-reconstruction instrument**, and it must serve two distinct
directions the user actually uses:

- **JP search = the paradigmatic map of a word's productive life.** The user
  wants to see *how many usage PATTERNS a word lives in, what it associates
  with, what contexts it occurs in* — because that range is how a word lets a
  speaker "display their whole existence." **This is why the note types
  exist**: a JP word page answers with the word's participations across the
  six classes — every collocation (🔵), skeletal frame (🟠), phrase schema
  (💠), gesture it performs (🟢), fixed use (🟡), and discourse role (🔴) it
  enters — each with its real contexts (lived attestations first, curated
  senses under). The note types ARE the schema of "a word's usage patterns."
  This confirms and is the reason for the taxonomy expansion.

- **EN↔JP is not translation — it is one meaning EXTERNALIZED twice.** The
  user's frame, made explicit via Chomsky: English and Japanese are not
  "languages" in the deep sense; language is the internal system within us
  (I-language / the faculty), and English and Japanese are E-language
  *externalizations* of it. So the object the plugin tracks is the internal
  MEANING-UNIT, and Japanese 逆に and English "actually" are two
  externalizations of ONE such unit — never a surface-pair to be aligned.
  **Meaning is the node; every surface (JP or EN) is a projection of it.** The
  user's example, read CORRECTLY (my earlier "逆に ≈ actually @context" was too
  simplistic — still translation-thinking): the context — a pivot right before
  a question — PINS one meaning-node among 逆に's many; at that node "actually"
  is a co-externalization, a different node than the one 実は (revelation) or
  実際に (factuality) externalizes. **Context is meaning** because context is
  what selects WHICH internal node a surface is projecting. Seeing 逆に and
  "actually" meet there is a *glimpse of the universal (普遍文法)* — the
  internal reality only a bilingual catches after years. So EN↔JP search does
  not map surface→surface-with-a-tag; it **resolves any surface — an English
  intention, a Japanese word, a heard phrase, an image — TOWARD the meaning-
  node**, and returns that node's full externalization-spread across both
  surface systems, its contexts, and its note-classes.

**Not a new note, not a translation field — ONE meaning-graph.** "Meaning is
meaning… it's not a new note" (user): the English rendering is never a field
bolted onto a note, nor a seventh class. **A note is ALREADY a meaning-node** —
keyed by production-meaning (a 🟢 gesture, a 🟠 link, a 💠 frame), not by
string; this is exactly why class is perspectival and not a property of the
surface (§7). Its externalizations *accrete as representations of it*: Japanese
phrases heard/read (lived attestations), Eijiro's English glosses, the kokugo's
Japanese definitions, its contexts — **every dictionary source is an
externalization-FEEDER into the same node-graph, not a separate store**.
"Everything fits together in some odd way" (user) because it IS one graph: the
catalog (lived externalizations), the dictionaries (curated externalizations),
the families/constellations (§14/§26.2), and the cross-surface links are all
edges on it; entering from any surface reaches the node and everything else
hanging on it. The decisive externalizations are still LIVED — どっかのタイミングで
and 逆に-as-actually were caught by HEARING, not found in a dictionary — so the
corpus is the crown evidence and Eijiro's context-annotated 〔…〕 renderings are
the richest curated feeder (its real uniqueness, §27.1). What the user
"captures" is never a translation pair; it is one more externalization attached
to a meaning-node — a glimpse of the language-within, kept. Over time the graph
becomes the user's own map of the 普遍文法: *reconstructing yourself in the
language*, operationalized as one growing web rather than two dictionaries and
a catalog.

### 27.0.2 Why "one meaning-graph" is too tidy (the correction, found not given)

The node-graph of §27.0.1 is still a database wearing philosophy, and it
betrays the plugin's own deepest instincts. The messier truth, from the user's
actual experience:

- **A glimpse is an EVENT, not a stored edge.** 逆に-as-"actually" was an
  instinctive flash ("I knew in that moment INSTINCTly") that fades. The
  artifact can keep a *trace* of a glimpse; it can never hold the glimpse.
  Success is therefore not coverage — it is how often the artifact makes
  another flash HAPPEN.
- **The node is a HORIZON, not an object.** You never see the meaning-unit;
  you catch a partial, contextual sliver. It is internal (I-language) and
  stays out of reach; every sighting is incomplete and the unit always exceeds
  them. "Glimpses of such a reality" — glimpses, never the reality.
- **Context is CONSTITUTIVE, not a selector.** No two 逆に are identical; the
  boundary where it stops being "actually" shades continuously. You cannot
  enumerate the nodes — context is unbounded, so a "node" is only a soft cloud
  over never-identical instances. This is exactly why the plugin stores whole
  SCENES (§22): context is not an index into meaning, it IS the meaning, and
  abstracting it away destroys the thing.
- **The subject is irreducibly in it.** These are glimpses of YOURSELF — your
  being, your personality, the people you have known ("emergent product of
  me"). A different self carves different clouds. The graph pretends
  objectivity; the reality is subject-saturated — the whole donor-email point.
- **Relations are RESONANCES, not typed edges.** "Everything fits together in
  some ODD way." 破綻 = 破 tear + 綻 seam-unravel bridges by felt IMAGE, not
  logic (onomatopoeia, metaphor, family-resemblance). The relations resist
  formalization BY NATURE — not a gap to close, it is what they are.
- **The HOLES are as real as the nodes, and more alive.** どっかのタイミングで:
  the WANT came first (a meaning felt but un-externalized — "no phrase I found
  captured that"), the finding came later by HEARING, and the magic was the
  *collision*. The plugin today holds only what you have caught; it does not
  hold what you are REACHING FOR. That negative space — the yearning — is the
  most human, most alive part, and it is missing.

**So the plugin is NOT the graph. The graph lives in YOU; the plugin is the
trellis that grows it.** Its job: accumulate partial personal traces AND the
holes; REFUSE to consolidate them into asserted facts (the plugin's
suggested-not-ratified / scene-not-quote / recall-not-truth / pentimento
instincts are ALL already this — my graph regressed from them); and JUXTAPOSE
externalizations so the user's intuition catches the resonance rather than
being told it (the 似ている box §26.2 is this; the cross-lingual case is the
same move — never print "逆に = actually", set the scenes side by side and let
the flash happen). The one genuinely NEW demand: **hold the reaching.** A
first-class place for a felt want (a paraphrase, an English gloss, a gesture,
"that feeling when…"), and a collision-watcher over the incoming attested
stream that OFFERS — never asserts — a possible fill, confirmed only by the
user's felt recognition. That turns the instrument from a record of the met
into a companion for the reaching-toward — the production lexicon finally
honest about being unfinished. Everything in §27.1+ (Eijiro, per-dict, storage,
feel) still holds, but as feeders of traces into this trellis, never as a
graph to complete.

### 27.1 Why Eijiro specifically informs this plugin (its real uniqueness)

Eijiro is not just "big." It is uniquely a **production/expression
dictionary** — Japanese learners use 英辞郎 to answer *"how do I SAY this,"*
not *"what does this word mean."* Four of its properties are the plugin's own
notation, prefigured, and must be preserved (not flattened):

1. **The unit is the expression-in-use, not the word.** 85% of entries are
   phrases (measured). Eijiro already believes what the plugin believes — the
   meaningful unit is the collocation/frame, not the dictionary headword.
   This is why its philosophy seeded the note types.
2. **The 〔context〕 bracket is a production-condition, not a definition.**
   `〔銀行口座の残高が〕マイナス＿ドルである` says *"when you want to express
   THIS situation, reach for THIS phrase."* That is a production-index entry
   and a 💠 phrase-schema signal (the situation is the frame's condition of
   use) — the plugin's "context is meaning" (§22) written into the source.
3. **The frame labels (`be ～` / `a ～` / `$__ `) are the plugin's
   skeleton notation, pre-drawn.** Eijiro already annotates whether a phrase
   lives as a predicate frame, a nominal frame, or a numeric-slot frame —
   exactly the 🟠 skeletal / 💠 schema distinction. The `～` and `__` ARE the
   plugin's slot markers.
4. **It is descriptive/attested in spirit** — colloquial, domain, slang,
   "living English," with a 225/126 category-subcategory register system.
   Encountered usage, not idealized definition: the plugin's stratum ethic.

So Eijiro's uniqueness is that it is *already half-built toward a production
index* — it marks skeletons and situations. The realization finishes the
inversion the source started, rather than importing it as flat rows.

### 27.2 The inversion, concretely — production entry points

The dictionary-for-this-plugin is queryable along the plugin's production
axes, not only by headword:

- **By gesture / image (🟢).** Enter an image or a lemma; get the evocative
  words that perform it and the 似ている表現 discrimination (why THIS image vs
  that) — fed by the thesaurus dict (類語例解), onomatopoeia dicts (the
  evocation prototype), the kanji dict (破 tear + 綻 unravel = the image of
  破綻), AND the user's own family captures. One box, both strata.
- **By frame / skeleton (🟠/💠).** Enter a frame; get its crystallizations.
  Eijiro's `be ～`/`〔ctx〕` entries populate this directly — the frame IS the
  index key, the fillers are leaves (§7 orange data model).
- **By situation (💠).** Eijiro's 〔context〕 brackets become searchable
  situations — "how do I express 'when a balance goes negative'."
- **By headword (the ordinary axis)** — still there, but a headword page is
  a PRODUCTION page: senses (curated backbone), then the pre-classified
  reach-for candidates (collocations/frames/situations, class-hinted), then
  YOUR lived attestations. Look-up and reach-for on one page.

### 27.3 The plugin-native model (shaped by production, not by Yomitan tuples)

One normalized model every dictionary parses INTO; PURE per-dict adapters
(the §2.2 isolation rule) produce it; generic structured-content is the
fallback. The bridge object is the class-hinted reach-for candidate:

```
DictHeadword { expression, reading?, pron?, kana?, pos?, svl?,   // SVL = production priority
  senses: DictSense[], reachFor: ReachCandidate[], family?: {word, image?}[] }
DictSense { pos?, gloss, register?, situation?/*〔〕*/, note?/*◆*/, xrefs?, examples? }
ReachCandidate {            // the production unit — Eijiro's phrases become these
  surface, gloss, frame?/*be ～*/, situation?/*〔〕*/, slots?/*～ __ positions*/,
  classHint: NoteClass,     // shape → 🔵/🟠/💠/🟡, or 🟢 when the head is evocative
                            // NEVER 🔴 (responsivity is dialogic, not in a dict); suggestion only
  svl?, register? }
```

`classHint` is pure/shape-only/pentimento (never a verdict): grammatical
frame → 🟠; 〔situation〕-framed whole with a slot → 💠; bare lexical bond →
🔵; fixed quotable/proverb → 🟡; evocative head → 🟢 offered. The human tests
still decide, exactly as everywhere else (§13.3/§15).

### 27.4 Per-dictionary mapping — each to its production facet

The 36 dicts are NOT one flat store; each feeds a specific production facet by
what it uniquely is (adapter registry keyed on title):

- **英辞郎 v144** — the reach-for engine: frames→🟠, 〔situation〕→💠, bonds→🔵,
  SVL→priority. The largest single candidate source. (The one the user most
  wants realized.)
- **研究社 新和英大 / 用例.jp / WISDOM** — the crown examples → curated
  example attestations (§22.3).
- **類語例解辞典** — the 似ている表現 / 🟢-family discriminator (curated side of
  §26.2's box).
- **擬音語・擬態語辞典 / Onomatoproject** — the 🟢 evocation PROTOTYPE: entries
  are evocative-lemma candidates; the described image IS the halo.
- **ことわざ・慣用句 / 四字熟語 / 絵でわかる慣用句** — 💠/🟡 whole-phrase
  candidates.
- **旺文社漢字典** — kanji breakdown → the IMAGE-of-kanji feeding 🟢 (破/綻).
- **大辞泉 / 大辞林 / 新明解 / 三省堂国語 / 明鏡 / 新選 / 現代国語例解** — the
  JP-side sense backbone (priority-ordered; user picks the lead kokugo).
- **NHK発音アクセント / アクセント辞典** — pitch overlay (not senses).
- **日本語俗語 / ネット用語 / 新語時事 / 実用日本語表現** — register/currency
  labels on a headword.
- **JMnedict / Wikipedia proper nouns** — deprioritized names, never study
  noise (the phrase-drowning fix applied to names).
- **SVL (in Eijiro tags) / BCCWJ** — production-priority/difficulty signal →
  SRS ordering + capture-worth nudge, not display content.

### 27.5 Storage (the big dicts never touch the blob — AUDIT §18 governs)

英辞郎 (2.36M) and the large dicts import as **vault sidecar stores**
(`JP Dictionaries/<title>/` sharded JSONL + an in-memory headword→shard
offset index), NOT blob keys; lookup reads one shard on demand (mobile-safe).
A `convert-yomitan-export` command (desktop, stream-parses the 12.7GB Dexie
dump into per-dict sidecars) + a blob-exodus migration for anything already
imported. Files-over-app (§19) honored; sidecars sync like any vault file.

### 27.6 Feel = §26 (they meet here)

The production page IS a §26 monokakido entry-article (headword block →
senses → the reach-for candidate list → 似ている表現 box → your lived context
tree), with hover-peek to graze the collocation-dense field instead of
drowning, space-walk between headwords, and capture-in-place (🏷️ per
candidate, class-hint pre-selected) landing in the same six-class spine —
because the candidate IS a catalog object at the curated stratum. Three hands
throughout (§23.5).

### 27.7 Build order (on ratification)

1. Plugin-native model + PURE 英辞郎 adapter (structured-content →
   DictHeadword/ReachCandidate with class-hints + frame/situation/SVL parse)
   + goldens on real Eijiro fixtures. Highest value, offline-testable.
2. Lookup partitioning + reach-for candidate list in DictionaryView (§26
   grammar) + one-tap class-hinted capture.
3. Sidecar storage + convert-yomitan-export + blob-exodus migration.
4. Per-dict adapter registry (kokugo backbone, 類語→family, onomatopoeia→🟢,
   idioms→💠/🟡, SVL/pitch/register overlays; generic fallback preserved).
5. Production entry points (by gesture/frame/situation) + names deprioritize
   + SVL→SRS.

**Needs from user before the relevant step:** lead kokugo choice; convert
whole 12.7GB export or a curated subset first; confirm `JP Dictionaries/` as
the sidecar home; and — the open question — whether the production entry
points (§27.2) match how they actually reach for language, since that axis is
the whole design and only they can confirm it.

---

## 28. Seamless integration, whole-system (2026-07-25 — GOVERNING)

§26.0 defines seamlessness as a property of a *screen*. That is only its surface,
and reading it alone has repeatedly led to work that polished views while the
chain underneath stayed broken. This section states the whole-system version.

**The plugin is one chain, not a set of features:**

```
encounter → mark → reconcile → classify → attest → index → retrieve → drill → produce
 (media)   (capture) (vs source) (6 classes) (accumulate) (catalog)  (search)  (SRS)  (reach-for)
```

The product is the *last* box. Everything before it exists so that a thing you
met once, in the wild, becomes a thing you can reach for. **A seam is any point
where a noticing loses identity, provenance, provisionality, or reachability as
it crosses a subsystem boundary.** Seams are invisible on any single screen —
they only show up when you follow one phrase all the way through.

### The six invariants (each falsifiable, each with its test)

**S1 — One object, re-rendered; never copied.**
A noticing is a `PatternEntry` with a stable id. The 台帳, the lexicon detail,
the tray, the SRS card, the X view and the context tree are *views of the same
row*. Text is embedded (`![[file#^id]]`), never duplicated.
→ *Test:* retype a pattern on one surface; every other surface showing it is
already correct. A surface that renders a classed object **without its class
mark has silently created a different object** — the defect that had six views
(collocations, dictionary, X, tray, pipeline, 談話モード) showing classed
objects with no class at all.

**S2 — Provenance is never dropped.**
Every attestation carries where it came from and the door back: `source` /
`medium`, `SceneRef` (`deepLink` / `image`+`bbox` / `audio` / `loc` /
`sourceName`), `file`, `videoId`, `tStartSec`, `anchorId`. A stage that emits an
attestation without a door back has made an orphan — a phrase you can no longer
verify or re-experience.
→ *Test:* every attestation, on every surface, is one tap from its source **in
that source's own medium** — the video at the second, the tweet, the panel crop,
the dictionary entry.

**S3 — Suggested is never truth, and must look it.**
The machine is a **recall machine**. Sweep hits, class suggestions, discourse
moves, 生成 scaffolds are all `status:'suggested'` and must *render as
provisional* wherever they appear (hollow dot, dashed border, 提案), with ✓✕
available in place. The hand is the classifier.
→ *Test:* no machine output is displayed with the weight of a ratified fact, and
ratifying never requires going somewhere else. **Corollary (learned 2026-07-25):
ratification must be a byproduct of study, never homework.** A design that
requires the user to sit down and label N rows will stall at 0 — it has, twice.

**S4 — Every object is actionable where it sits.**
See it → act on it: jump to source, play the clip, retype, capture, attach as a
用例. A dead end is a seam even when it looks clean.
→ *Test:* count taps from "I notice this" to "it is in the lexicon with its
context." The number may only go down. (This is §26.0(a), applied to the chain
rather than the screen.)

**S5 — One road in, one road out.**
Every medium — YT, X, web, manga, Kindle, podcast, Plex, dictionary, corpus —
funnels into the *same* capture → `PatternStore` path, and back out through the
same `ContextEngine` join. A source-specific side-channel with its own store is
a seam by construction, however good it looks alone.
→ *Test:* adding a medium requires a new `Medium` value and a `SceneRef` shape.
If it requires a new store or a new view, the design is wrong.

**S6 — Degrade honestly, in place.**
Missing audio, unimported dictionary, expired X cookies, a 404 scrape: say so
*where the thing would have been*, with the recovery action attached. Never an
empty box, never a silent zero, never a number that counts failures as results.

### The gimmick test, restated for pipelines

§26.0 rejects a *view* that demos well without changing the step count. The
pipeline form: **a stage earns its place only if it removes a step from the
chain.** A stage that produces more rows without producing more *reachable,
ratifiable, provenance-carrying* rows is the pipeline equivalent of parallax.
Volume is not evidence — this is the same rule §11/§12 applied to the discourse
recognizer, and it applies to ingestion identically.

### Why this section exists

The five §26.0 properties are readable as styling advice by anyone who has not
followed a phrase end-to-end. They are not. They are the visible half of a data
contract that `pattern-store.ts` already encodes (`Attestation`, `SceneRef`,
`stratumOf`, `status:'suggested'`) and that the ingestion pipelines only
partially honor. When the two disagree, **the contract in `pattern-store.ts`
wins and the pipeline is the bug.**

## 29. The 𝕏検索辞書 as an interrogated corpus — one build from three angles (2026-08-25, RUNGS 0-1-3 SHIPPED)

**Status 2026-08-25:** rung 0 is built, wired and deployed — `src/x/relevance.ts`,
`golden/x-relevance.mjs` (30 checks across both rungs), the oracle seam cut in `makeXDeps`, the
demoted tail rendering in `XSearchView.renderLocal`. Verified against the live
corpus, not only fixtures: 足して → 23 raw occurrences → **0 true hits, 23
demoted**, labelled 「部分一致 23件（満足する×15・不足する×7・補足する×1）」.
Rung 1 followed the same day: one comparator per class in `rankByClass`, each
returning a score AND its stated reason, rendered on the row — a ranked list
that cannot explain its order is a verdict, and the machine does not issue
verdicts. The sort chips survive as the TIEBREAK they always honestly were.
No catalog entry for the query means no class to rank by and the list is left
alone.

Rung 3 shipped 2026-08-26: `src/x/probe.ts` (the ladder, six verdicts, three
stop rules), `golden/x-probe.mjs` (30 checks), rendered in place of the empty
state whenever a single-term search is silent. Pieces come from
`tokenizeForCanvas` with the dictionary probe — no new segmenter. Verified on the
live corpus: 僕は印象として持っている → 0 → 印象として持っている 0 → 印象として 1 →
印象 70/47/46, verdict 沈黙・有意, and the why names 僕は・持っている as the
over-specification. Every attested rung is a DOOR: tapping it re-asks the
corpus that question, so the ladder is a way to move, not a report to read.

Two refinements the build added. The result exposes BOTH `nearest` (the
smallest edit the corpus can answer — the actionable finding) and `surviving`
(the best-attested rung — where the distribution lives); reporting only the
latter would have answered a question nobody asked. And the 逸 rule needs a
core: it is the token with the highest KANJI DENSITY, ties to the longer,
because a pure-kanji token is content while kana-heavy tokens are grammar.
Longest-token would have made 持っている the core of 僕は印象として持っている and
blocked the one drop that pays. Stated as the heuristic and knob it is —
rung 4 supersedes it for constructions, where the fixed material can be kana.

Rungs 2, 4, 5 and 6 remain as specified below.

**Status 2026-08-26 (merge):** rung 6's catalog-side substrate exists — built
the same night on a parallel branch neither session could see, merged here.
問い: File a Standing Question files a PatternEntry born with
`attestations: []` and `standing: true`; `sweepMuted` never retires it (a
wondering's rejections are normal fishing, §27 rule 4); no fabricated
self-sighting; the 問 mark is provenance and never leaves (goldens: sweep
54/54, patternstore 37/37). Still open from rung 6's own spec: filing in ONE
GESTURE from a silent probe in the 𝕏 pane (today it is a command, not a hand
act on the silence itself), and verdicts accreting as a HISTORY.

This is the DESIGN section `claude/PHYSICS-2026-08-19.md §5` adjudicated and
every prior pass promised without writing. It consolidates the Aug-19 governing
directive (Axis 2: X relevance per note-type), the 印象として brief, the
fourth-pass probe design (rescued into PHYSICS §5), and two use cases measured
2026-08-25 (the study-label paradigm; the 言えば slot). Doctrine first:

**The X view is not a search box over tweets; it is a corpus you interrogate
from the production direction.** You arrive with a draft thought (言えるか),
not a string you have — the same inversion as §27 (reach-for) and the HOLE
(§27.0.2): entered by what you don't have. Relevance is class-conditional (§7
is the schema of "relevant HOW"); silence is an interpretable answer, never a
failure; every answer re-anchors the next probe; and a probe the corpus cannot
answer becomes a **standing 台帳 entry** (`attestations: []`,
`status:'wondered'`) that the growing corpus answers over time. PHYSICS §5:
*X relevance + probe + 産出 = ONE build from three angles.* This section is
that build's contract.

**Current state — the entire gap in one line:** `XCorpusStore.search()` ends in
`out.sort((a, b) => b.createdAt - a.createdAt)`; recency IS the ranking, sort
modes are latest/likes/RT, and `makeXDeps` passes the X view no dictionary
access at all. Zero lines of any rung below exist.

**The corpus, measured 2026-08-25 on the live vault** (`part_xCorpus.json`):
2,480 tweets, 2,337 authors, 1,183,143 chars. Two measured facts govern the
whole design. At this size **silence is the modal answer** (印象=47 but
印象として=1, 印象として持っ=0; 今まで×勘案=0), so the descent ladder is the
machine's first duty (§5 law ②). And **substring matching lies**: 足して=23
occurrences, all 23 false friends (満足して×15, 不足して×7, 補足して×1 — zero
true 足す), so the true-hit layer is the floor under everything.

### 29.1 One test at three scales (the spine)

Greedy matching fails at three different boundaries, and the SAME move — extend
the context, ask whether the extension produces a swallower, type what remains
— is the fix at each. This is the HOLE's "same shape at three scales" table,
for matching:

| scale | the question | the test | fixture |
|---|---|---|---|
| word | is this substring this word? | boundary test: extend the span; if the extension deinflects to a covering dictionary word, false friend | A: 足して vs 満足して |
| construction | is this filler filling this slot? | left-context cue + morphological typing + family distribution | C: 悪く言えば vs 蒼き狼と言えば |
| register/use | is this string used AS this? | positional label-ness + paradigm at the slot + authority reach | B: ゆる勉 vs アウトプット |

Rung 0's word test and rung 4's construction test are one idea at two scales,
and §5 already stated the third: *the descent ladder IS the generalized
deinflector.*

### 29.2 The rungs (bottom = cheapest; each earns the next)

- **Rung 0 — true hits (word boundary). SHIPPED 2026-08-25.** Pure. `deinflect()` is pure+sync and
  `DictionaryStore.lookup` is sync in-memory, so this runs at render time with
  no async plumbing. For each raw hit, extend the matched span; if a dictionary
  word covers the original match (満足する ⊃ 足す), the hit is a **false
  friend** — demoted to a collapsed 部分一致 tail that NAMES its swallower,
  never deleted (S6: degrade honestly, in place). True hits carry their
  deinflection trail for the 〈…〉 badge (same convention as `BigDictStore`,
  invariant 3).
  **The rule the build had to add:** a swallower must be a DIFFERENT word.
  足してみた deinflects straight back to 足す, so an extension-is-a-word test
  alone demoted the very hits it exists to protect — the query’s own word
  wearing more inflection, reported as its own false friend. The match’s own
  lemma set is computed first and excluded (`ownWords`). Pinned by golden.
  Known and stated rather than hidden: with deinflect+lookup and no parser,
  the test cannot separate a swallower that KILLS the reading (満足 ⊅ 足す)
  from a compound that CONTAINS it (第一印象 ⊃ 印象). Both are demoted, both
  are named, and the tail is a tail precisely so the hand can overrule it.
  `reach` is a knob (default 4), not a guess.
- **Rung 1 — class-conditional ranking. SHIPPED 2026-08-25.** The comparator is a function of the
  probing entry's class: 🟡 verbatim echo first; 🔵 collocate adjacency; 🟢 the
  gesture's halo context, not the string; 🟠 parts-in-order with the intervener
  profile (介在プロフィール — the material between anchors is a RESULT,
  computable on the existing bigram index); 💠 slot-typed; 🔴 position in
  discourse. **Recency and likes become tiebreaks only** — the current sort's
  single surviving role.
- **Rung 2 — environment promotion.** `buildXUsage` already computes KWIC
  neighbours with count + author-spread thresholds — display-only today.
  Promoted into ranking: hits sharing a recurring environment rank as a GROUP
  (the environment is the answer; the tweets are its evidence). Plus position
  entropy pre-shading (骨/穴/偏/灰) and the measure fixture B forced:
  **label-ness** — the fraction of a string's occurrences that are
  line-initial / standalone / hashtag vs mid-clause. "がっつり is real but
  reads as commentary, not a calendar entry" has a computable correlate.
- **Rung 3 — the descent ladder + verdicts. SHIPPED 2026-08-26.** On silence, attack the query's
  own 過剰指定: leave-one-out over the probe's pieces, reporting what the
  corpus DOES hold at every rung (印象として持っている → 印象として=1 →
  印象=47 with environments). Every probe returns one of six verdicts —
  顕在 / 偏在 / 競合 / 沈黙・有意 / 沈黙・無力 / 圏外 — so silence is labeled
  by KIND, never hidden. Stop rules 床/逸/平 bound the descent.
- **Rung 4 — construction boundary + the 転 table (operators get a hand).**
  The nine operators (開 軸 膠 溶 括 転 距 替 典) are GESTURES offered on
  result rows, never a query language — §5's "operators have no hand" is cured
  at the row, where the re-anchoring actually happens. Slot membership (the
  smart-not-greedy requirement) is three cheap tests, no parser: ①
  morphological typing via deinflect+lookup (冷たく → 冷たい ADJ く-form;
  思って → 思う V て-form); ② one-character left-context cues (preceding と →
  quotative/topic, か → rhetorical, そう → lexicalized そういえば) — the
  boundary test one scale up; ③ distribution across the frame family (real
  fillers recur across 言えば/言うと/言ったら; chained clauses don't). Rows
  that stay ambiguous are typed 灰 and juxtaposed in their own group — the
  machine offers, never adjudicates (HOLE rule 1).
- **Rung 5 — the horizontal step (authority-cycle ▾).** A silent rung is HELD,
  not abandoned: cycle the same probe across 台帳 ⇄ 辞書 ⇄ corpus ⇄ live 𝕏 ⇄
  TWC. 距's three dials pick the authority (線 linear → corpus; 係 relational →
  TWC word-sketch; 談 discourse → transcripts). 1.18M chars cannot answer
  multi-anchor questions, so the cycle is load-bearing, not a convenience.
  Live-𝕏 reliability keeps its tiers: syndication add-by-URL = floor, signed
  GraphQL = best-effort, Scriptable = iOS.
- **Rung 6 — standing questions.** §5's deepest move: **a question is a
  capture with `attestations: []`** — a `PatternEntry`, not a new store (S5).
  Filing is one gesture from ANY rung (the recursion-vs-immersion rule: every
  rung droppable into the tray; return free; the sweep works it while you
  read). The existing sweep-fan/願い machinery answers on arrival — the
  dedup-key blocker fell 2026-08-20. `sweepMuted` gets the exemption the
  review flagged: 3 rejections retire a catalog entry, but a wondering's
  rejections are normal fishing. Verdicts accrete as a HISTORY — 沈黙・有意
  becoming 偏在 over months IS the corpus answering.

### 29.3 The three golden fixtures (measured 2026-08-25; these ARE the film scripts)

**Fixture A — 足して / 印象として (word boundary + descent).**
`golden/x-relevance.mjs`.
- 足して → today: 23 hits ranked by recency, 23/23 false friends. Required:
  0 true hits; a collapsed 部分一致 tail of 23 naming 満足する/不足する/補足する;
  verdict 沈黙 — labeled, not an empty list, and never a confident 23.
- 印象として持っている → ladder: full span 0 → 印象として=1 (shown) →
  印象=47 with environments; verdict 沈黙・有意 at full span; the surviving
  rung offers 替/典.
- Pins: no true hit for any 満/不/補-preceded span; deinflection trail present
  on true hits; the demoted tail is never dropped.

**Fixture B — ゆる勉 (paradigm + position + authority).** `golden/x-probe.mjs`.
- ゆる勉 (a label being invented) → 0; まったり×勉強 co=0; がっつり=1,
  mid-clause. Required: verdict 圏外/沈黙・無力 **with** the 替 paradigm of
  what IS locally attested at the study-label slot (アウトプット=12,
  インプット=6, ながら勉強=1, 多聴=1), each with its label-ness; がっつり shown
  but shaded low label-ness; the unanswerable remainder offered as (a) a
  live-𝕏 reach seeded by the ladder's surviving pieces and (b) a standing
  question filed in one gesture.
- Pins: silence yields paradigm + verdict, never an empty box (S6); label-ness
  computed from position; the filed row carries `attestations: []` and
  survives `sweepMuted`.

**Fixture C — 悪く言えば…に近い (construction boundary + 転 + 距).**
`golden/x-slot.mjs`.
- The two-anchor frame generalizes to [MANNER 言えば] … [Yに近い] (💠/🟠
  grammar; 距 between the anchors). Measured: family 言えば/言うと/言ったら =
  113 occurrences. True fillers typed く/に/で/て **plus the corpus-taught
  から and を** (一言で×8, 逆に×4, 結論から×4, 簡単に×3, 正直に, 厳密に,
  大まかに, 分かりやすく, かなり冷たく, 極論を, 無理を承知で…). Impostors
  excluded by cue: 27/113 are と-preceded (蒼き狼と言えば, 大阪と言えば),
  plus かと言えば and そういえば. Second anchor locally attested: 10
  co-occurrences with に近い.
- Pins: と/か/そう-preceded hits never enter the manner table; every row
  carries its morphological type; ambiguous rows land in a 灰 group — never
  silently dropped, never asserted; family-distribution counts present.

Certification per PHYSICS §6 items 2–3: a hand performs each fixture
end-to-end on glass, on camera.

### 29.4 Modules + wiring (pure cores, thin apertures)

- `src/x/relevance.ts` — PURE, rungs 0–2: `trueHits(hits, oracle)`, per-class
  comparators, environment grouping, label-ness. `oracle` is `{deinflect,
  lookup}` injected; the golden stands in for `DictionaryStore` offline (the
  `readings.fixture.json` convention, §6).
- `src/x/probe.ts` — PURE, rungs 3+6: ladder, verdicts, verdict history, the
  standing-question shape.
- `src/x/slot.ts` — PURE, rung 4: left-context cues, filler typing, family
  distribution, the 転 table.
- **The one seam to cut:** `makeXDeps` gains the oracle (the X view currently
  has no dictionary access). `XCorpusStore.search()` keeps returning raw
  matches; ranking moves into the pure comparator. Knobs (window, thresholds,
  ladder depth) exposed in settings — ship crude with knobs, tune on glass.
- Explicitly NOT built: a segmenter or parser (typing is deinflect+lookup
  only — the plugin's standing bet); auto-fill of any probe (HOLE rule 1); any
  "N% of questions answered" metric (HOLE rule 4). X result rows are classed
  objects — everything class-colored routes through `ui/class-grammar.ts` (S1).

### 29.5 Build order (value ÷ effort)

1. **Rung 0** — cheapest, and the floor: fixture A says today's canonical
   query is 100% garbage.
2. **Rung 2 + rung 1** — `buildXUsage` already computes the environments;
   promotion and the class comparator are mostly plumbing.
3. **Rung 3** — highest value at this corpus size: converts the modal outcome
   (silence) into the dialogue.
4. **Rung 6** — nearly free since 2026-08-20; the `sweepMuted` exemption is
   the only new rule.
5. **Rungs 4–5** — the 転/slot layer and the authority-cycle: the research
   tail plus the horizontal step; fixture C is ready when it lands.

Each step ships as staged diffs with its film script (PHYSICS §6). The streak
is the metric.

## 30. コマ送り — the measured hand, six repairs (2026-08-25, SHIPPED)

The 30fps film corpus now has two readers and one verdict. The コマ送り
report read Calendar (1082/1144/1159) and Monokakido (1175/1184) frame-by-frame
into ten laws; `claude/CALENDAR-PHYSICS-2026-08-24.md` read three further
Calendar reels (1212–1214) into nine; and IMG_1197 — the first reel of the
PLUGIN ITSELF failing on glass — turned laws into defects with timestamps.
Six repairs shipped 2026-08-25, each citing its filmed moment:

1. **辞書 speaks the X pane's grammar — space = AND.** Filmed: 「ものの　そうで
   なげ」 → 見つかりませんでした for 20s while 𝕏検索's own help advertised
   space-AND one tab away. Whole-string lookup runs first (英辞郎 phrasals keep
   working); on a miss, term 1 finds entries, every further term must appear IN
   them, and the empty state names the failing term (the げ/け typo becomes
   visible). `DictionaryView` `queryTerms`/`missMessage`.
2. **A mid-word selection grows back through its sentence.** Filmed: まない
   selected out of 気が進まない; ない→る validated まる; the echo answered a
   word never touched. `lookUpPhrase(text, sentence)` restores 1–4 preceding
   characters, longest-first, candidates validated as real entries — 進まない
   → 進む〈negative〉. Guess-only result sets say 直接一致なし in the stats.
3. **One selection, one airspace.** Filmed: echo + native Copy/Writing-Tools
   stacked three layers on one selection. On a slate with a touch/pen
   selection the echo yields ABOVE to the system menu and takes BELOW.
4. **The drop road never executes a guess.** 「落としたものは別物でした」
   (filmed landing as bafflement) is gone: an unsupportable aim repaints the
   rack as a chooser (`--confirm`), and nothing runs until the hand picks.
5. **The pane yields to the keyboard** (`ui/keyboard-aware.ts`, armed via
   `mountSurfaceBar`): docked/split keyboard inset shortens the pane; the
   floating 10-key is a system window nothing can see — the focused input is
   scrolled into view and that is the honest ceiling.
6. **Carry commits on MOTION, never on time.** The measured constant: the tip
   PARKS on every target 0.47–1.33s while reading. `pointer-drag` no longer
   arms at 350ms or carries at the deadline — the hold matures into a silent
   `--held` lift; move = carry from the nib, release-in-place = the row's own
   tap; the scroll-lock installs only mid-carry. This is CALENDAR-PHYSICS
   §2.4's 両利き requirement met from the reading direction.

**Reconciliation with §2 of CALENDAR-PHYSICS (open items are debts, not
disagreements):** §2.4 covered by repair 6; §2.7's squeeze-palette contract is
the echo card (repairs 2–3; its ~400ms budget holds — 160ms settle + sync
local lookup). Still open, in value order: §2.2 宛名札 (address chip riding
every carry/flick, edge readout when the destination is off-screen — would
also PREVENT repair 4's mismatch case), §2.3 鋳造 (long-press mint, lane
landing), §2.5 現在線, §2.1/2.6 stored-vs-candidate registers in the Move 2
inspector. §29 is a separate build with its own rungs; it shares repair 2's
oracle (`deinflect` + sync `lookup`) and nothing else — do not entangle them.

Two 答え合わせ items shipped NOWHERE and had fallen off every ledger until
the 2026-08-26 audit found them: **in-entry Find** (the 31-second refusal
was the user trying to re-find a passage INSIDE an entry already open —
space-AND fixed the list, not the entry) and **the descend/flip tempo**.
Both shipped the same day, in the §30.1 nav build below.

### 30.1 The 辞書 navigation grammar (2026-08-26, SHIPPED)

The gap list's every-session items (7 land-lit · 8 neighbour chips · 16
History) plus the recovered pair, built as one grammar. Pure model in
`src/dictionary/dict-nav.ts` (golden/dict-nav.mjs, 25 checks); apertures
pinned in reachability D4; every gesture has its command twin
(`dict-neighbor-next/prev`, `dict-history`, `dict-outline`, `dict-find`).

- **Arrival grammar (land-lit, item 7).** `lookupWord(word, {light, tempo})`
  — every road says what carried it: the hold chip's sentence, a history
  row's word. The cause lands in a tan band (`.jp-dict-arrive-band`),
  applied after BOTH render halves — the async sidecar half too, which is
  where the aperture-bug class would have eaten it.
- **Tempo (law 3, the recovered item — CORRECTED 2026-08-26 evening).** The
  first build shipped descend as a vertical 8px fade; on glass it told the
  hand nothing (「not really felt」— the correction's own film review, live).
  Now DESCEND is the iOS PUSH the films breathe: the new entry arrives from
  the RIGHT (180ms, landing lit), BACK pops in from the LEFT, FLIP by chip
  is a hard cut. The old per-keystroke stagger stays dead and reachability
  D4 pins all three: push not fade, no re-filter motion, pan not flick.
- **Neighbours (item 8).** The dictionary as a walkable order: reading-sorted
  unique headwords (the filmed 病人→病毒→廟堂 walk is the golden), chips at
  the BOTTOM CORNERS (law 5: controls where the hand rests; new content
  where it isn't), instant swap. `DictionaryStore.neighbors()` — index built
  lazily, keyed on the enabled set, milliseconds at the blob cap. Arming
  reaches THROUGH inflection (食べていた arms on 食べる's place —
  `currentNeighbors`, cached per query). Named limit: the order covers the
  IMPORTED store only; sidecar-only words (the 6.1M) have no place yet —
  the shard-level walkable order is its own queued build, and until it
  lands the chips hiding on a sidecar word is honest, not broken.
- **Kindle-quick paging + the axis grammar (CORRECTED 2026-08-26 evening).**
  The first build was a release-time flick — a discrete swap, the precise
  mistake the Aug-25 review warned about (a "scrolly" correction answered
  with a more discrete model), and on glass it was not felt. Now the page
  RIDES THE FINGER: `touch-action: pan-y` on the results hands horizontal
  touch travel to `armEntryPan`; axis-lock engages at 14px of horizontal
  dominance; the stack follows the finger (compositor transform), rubber-
  bands ×0.35 toward a page that does not exist; release asks `panVerdict`
  (past 28% of the pane, or thrown ≥0.5px/ms over ≥48px → the turn
  completes from the hand's own direction; else snap back, 130ms). PEN
  never pans — a Pencil drag across text IS selection on iPadOS, and law 2
  says the Pencil points while the finger turns — the pen keeps the
  release-time fast flick, which a non-collapsed selection always beats.
  True at-END vertical overscroll remains a refusal (scroller physics).
- **Pinch-in = collapse to outline.** The splayed-finger reflex Monokakido
  left unanswered (1184 f4602) now opens the ≡ — this screen's own table of
  contents, one row per entry card, tap → scroll with the header tinted.
- **In-screen Find (the recovered item).** 検索 in the nav bar: highlights
  every match in what is already rendered, ↑↓/Enter walk them, re-applies
  itself across re-renders. This is Monokakido's Find…, scoped to the
  plugin's own screen shape (a result stack, not a single entry).
- **The dated History (item 16).** `DictHistoryStore` under `_dictHistory`:
  persistent, capped 500, typing coalesced (の→のば→のばあ is ONE row — rule
  1), grouped 今日/昨日/M月D日, rows are doors that land lit. Recent-8 on
  the home screen.

Still open from the Monokakido list after this build: 12–13 (grain-named
menus carrying 「もう台帳にある」 state), Ends match mode, Example scope,
homophone paging — none of them navigation; they queue with §30's capture
items.

Perf, same date (the "no hiccups" pass): the 𝕏 pane's 300-card synchronous
rebuild per settled keystroke now paints 60 cards per frame under a
generation guard (compute was already memoized; the DOM was not); 語彙's
search was the one live search left with NO debounce (now 90ms, like 辞書
80 / 𝕏 110 / パネル 90); §29's oracle asked `lookup()` thousands of times
per keystroke and paid the deinflection FALLBACK on every miss — 
`hasExactSurface()` answers the same question without it.

### 30.2 The Calendar laws land + the menu carries state (2026-08-26, SHIPPED)

CALENDAR-PHYSICS §2's three unbuilt laws, plus the gap list's items 12–13
and match modes. Apertures pinned in reachability D5 + D4 additions.

- **宛名札 (§2.2).** Every synthetic carry renders an address chip
  above-left of the nib naming what a release RIGHT NOW does — 「→ 辞書 ・
  🔍 辞書で引く」, 「（既定）」 when nothing is aimed, 「着地なし — 離すと
  戻る」 over nothing. `PointerDropZone.address()` reads the SAME rack and
  aim as `drop()`, so the line and the act cannot disagree (pure half:
  `atenaFor`, drop-intent.ts, golden-pinned). The hold chip names its toss
  (「→ 収集トレイ ・ scene乗車」) the moment the travel would commit — the
  tray need not be on screen for the world to say where the thing lands.
- **鋳造 (§2.3).** `HoldStore.mint` / `InboxStore.duplicate`: one gesture
  at the object (the ⧉ verb on hold chips; ⧉ on every tray card; `d` on the
  focused card; command `hold-mint`), the twin seats BESIDE its sibling
  (same createdAt + insertion order in the tray; i+1 in the dock), no
  dialog, deep-cloned so twins never alias. The cap still evicts to
  gravity. This is Move 3 並べ替える's substrate. Deviation, stated: the
  Calendar gesture was long-press → menu; on TEXT objects long-press
  belongs to the OS selection, so the object's action row plays the menu.
- **現在線 (§2.5).** The tray's present is its READING POSITION: a thin
  minute-exact rail between what arrived since you last stood here and
  everything already triaged, frozen for the sitting (the eye arranges
  against a landmark, not a ticker), moved only between visits
  (`_trayVisit`). Opening the tray lands AT the rail — the back-stroke
  returns to the reading position, not the top. Pure half `nowlineIndex`/
  `nowlineLabel`, golden-pinned.
- **もう台帳にある (items 12–13).** The echo carries STATE on every armed
  surface: a selection the 台帳 already holds shows its class dot and
  「もう台帳にある」/「台帳に ×N」, and the chip is a door to the entry it
  already is (`patternsIn`/`openPattern` ride peekChrome — one wiring, six
  surfaces). The verbs stay: deliberate re-classification is legal;
  accidental twinning because the menu never said is what this removes.
- **The tilde search grammar (Ends/Starts).** 〜X = 後方一致, X〜 = 前方一致
  — Monokakido's match modes in the alphabet every notation field already
  speaks, taught by the search box's own placeholder (the two-languages
  lesson). `endsWithSearch` scans expression AND reading keys, which is
  also the reading-substring row (びを → 口火を切る shape: すり → 薬 is the
  golden). Local indexes only, and the stats line says so.
- **Homophone paging.** 決行 beside 血行: `homophones()` fans the query's
  readings through the readingIndex; chips over the results flip instantly,
  breadcrumbs untouched (聞く → 効く・利く golden-pinned).
- **Deliberately NOT built — Example scope.** The space-AND narrowing
  already reaches example text (`entryText` includes definitions), which
  covers the "find the entry whose example says X" need; a dedicated scope
  should come from shape-index's typed 用例 nodes, not from a fourth ad-hoc
  scan. Queued, not faked.

Perf, same date: the 𝕏 pane ran `detectPatterns` (the 126-operator engine) on
up to 100 frozen tweets per keystroke and re-walked the whole 1.18M-char
corpus for single-term KWIC. Both memoized (`patternCache` by tweet id;
`usageCache` by term+size) — the felt typing lag in that pane was this.

### 30.3 The axis correction — the walk has three axes, and both edges (2026-08-27, SHIPPED)

The user's second glass report, decoded and owned: §30.1's "axis grammar"
(↕ within an entry, ↔ between entries) was HALF an answer wearing the
costume of a whole one. The ask was always Monokakido's full walk — the
films show vertical nav and quick nav, heavy selection-and-drag, and smooth
back-and-forth that is never just a back button — and the previous build
(a) recorded at-end vertical continuation as a refusal ("scroller
physics"), (b) shipped back as a breadcrumb button plus a label-tab edge
drag that never moved the page, (c) had no forward at all, (d) had no way
to move fast through the order, and (e) left the 𝕏検索辞書 out of the
grammar entirely. Every one of those is now built:

- **The vertical walk (Kindle-continuous).** The results scroller keeps its
  native ↕ scroll; standing at an END when the touch begins, further travel
  is the neighbouring entry being pulled in — the stack rides the finger
  (`armVerticalWalk`), the incoming headword shows in a peek band at that
  end, no neighbour rubber-bands ×0.35, and release asks the same
  `panVerdict` as the sideways pan (distance against pane HEIGHT, or a
  throw). Downward continuation lands at the END of the previous entry —
  the page above, read from where it left off. And the walk is visible
  before it is ever performed: `renderContinue` sets the next headword's
  slim つづく row after the last card (tappable), so the dictionary READS
  as one continuous book, which is what makes the at-end tug discoverable
  by doing what you already do (§26.0 test b). A drag that starts
  mid-entry and reaches the end stays a scroll — the walk needs a fresh
  tug, a book's own rhythm, and the shape iOS's gesture claim allows.
- **The trail, both directions, riding the page.** `dict-nav.Trail` is the
  back/forward spine (pure, golden-pinned: a new descend burns the future;
  back files the present onto it). The suite edge gesture (`touch-nav`)
  gained the other side (`attachEdgeForward`, right edge) and a `page`
  dep: the drag now moves the RESULTS PANE 1:1 to the commit point and
  resists past it — iOS's interactive pop done to the content, with the
  tab as its label — instead of moving only the tab. view-chrome arms both
  edges from the same two lines every view already calls. The 辞書 and 𝕏
  feed it trail-first: the drag pops their own trail while it has
  somewhere to go, and only an empty trail exits the view. Forward also
  shows as a chip after the current crumb; command twins `dict-back`,
  `dict-forward`, `x-back`, `x-forward` (invariant 9).
- **Quick nav — the riffle.** Holding a neighbour chip riffles the
  dictionary: `riffleDelay`'s accelerating schedule (300→…→90ms floor,
  golden-pinned monotone), hard-cut flips (the filmed chip flip), stop on
  release. Finger, Pencil and mouse alike.
- **The selection is carryable.** The echo bar's ⠿運ぶ grip
  (`makeDraggable`, invariant 12) lifts the selection itself — scene
  riding as `sub` — into any drop surface; native drag on the desk, the
  long-press carry on glass. Select-then-drag, the films' heaviest habit.
- **𝕏 speaks the same grammar (§29 meets §30).** Committed queries ride a
  `Trail` (doors file, keystrokes never — rule 1's refinement lesson);
  ladder rungs descend through `goTo` and land lit (「◀ 〜の梯子から」);
  the edge drags walk the query trail with the same page ride; and rung
  6's missing hand-act shipped: a 沈黙 verdict offers 「問いとして残す」
  in place, opening the capture pre-filled with the probed shape.
  Honestly still open in §29: rungs 2 (environment promotion into
  ranking), 4 (construction boundary + 転 table), 5 (authority cycle ▾).

Films: the egress policy of this container blocks every Drive host, so the
07-15 recording STILL has no frame grid — see FILM-LEDGER for the pull
route that would work (a GitHub release asset). This pass was built from
the six committed stills, the three film-reading docs, and the user's own
description of what the films show; the side-by-side walk (PHYSICS §6)
remains the acceptance test, now with three axes to film.

### 30.4 The film lands in the container — built to the frames (2026-08-27 evening, SHIPPED)

The user put IMG_1184 itself into the session — the first reel any
container has actually held — and it was re-gridded per FILM-LEDGER §1
(the window list and readings are §2.4 there). What the frames showed,
each now built:

- **The selection menu names its object** (t60/t88/t120/t200 — Add IDIOM /
  Add HEADWORD / Add MEANINGS to Bookmarks; the reel's most-used device).
  On glass the echo now renders as a vertical menu of readable rows, each
  verb carrying 「its object」 (`jp-echo--menu`/`jp-echo-obj`); the GRAB
  itself echoes first, enlarged and selection-pink (f18/f32,
  `jp-echo-grab`); and 文をコピー copies the containing sentence — the one
  scope the native menu cannot name because only the plugin knows the
  scene. The desk keeps the compact bar.
- **A word tap PEEKS; descent is a choice** (t125–170: the floating card
  with Show Full Entry / category / Find). `openPeekCard`: summary through
  the ONE shared lookup road, the 台帳 state chip, 「全文を表示」 (the
  descend push) and 「画面内を検索」 (Find scoped to the word, no travel).
  Tap-away dismisses with the place untouched. Explicit → cross-links
  still jump — an arrow is stated intent.
- **The walk ghost** (f40; §26.4 step 6, deferred since July): the
  headword you LEFT drifts out in the direction the page moved — one
  element, opacity+transform, 360ms, dead under reduced-motion.
- **縦の関連** (t130–175: the vertical 類語 columns): on wide panes a
  vertical-rl column beside the entry holds what this vault knows about
  the word — homophones, walkable neighbours, class-dotted 台帳 patterns —
  each row a PEEK, not an exit.
- **The scopes on the bar** (t177–186: Word|Example tabs + Ends chip):
  すべて / 見出し / 本文 chips on the search row; 本文 never silently
  widens back through the sidecars.
- **The article dress** (§26.1: "a typeset ARTICLE, not a UI"): the
  bordered hover-glow card chrome is gone from the 辞書's entries —
  typography and a hairline separate them; the semantic boxes stay.

**§29 status update:** rung 2 SHIPPED (`environmentGroups`/`labelNess` in
`x/usage.ts` — environments promoted from decoration into structure, each
group a DOOR through the space-AND grammar; label-ness as a positional
fact) and rung 4's slot layer SHIPPED (`x/slot.ts` — fixture C's cues,
tail-walk く-typing, family recurrence, named impostors, the 灰 group;
`golden/x-slot.mjs` 18 checks). Still open in §29, said plainly: rung 4's
nine operators as row gestures beyond this table, and rung 5's authority
cycle ▾.
