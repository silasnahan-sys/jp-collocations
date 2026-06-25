# DESIGN — Handwriting Reconciliation Pipeline

Status: **contract locked, pre-implementation.** This document is the agreed
design for the handwriting → transcript reconciliation feature. It is written
*before* code so the reliability boundaries are fixed up front. Code that
violates an invariant in §2 is a bug against this document, not a judgment call.

The one open input is the **5 note types** (§7) — everything else is decided.

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
`samplenotes.png`). That is the target output shape.

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
interface LocalMatcher {
  /** NFKC-normalize both sides, slide the phrase over transcript lines, score by
   *  token-overlap + edit-distance, return best span + alternatives + ±2 lines. */
  match(phrase: string, transcript: Transcript): {
    best: SpanCandidate | null;
    alternatives: SpanCandidate[];   // top-K for disambiguation
    contextBefore: string[];
    contextAfter: string[];
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

---

## 7. Note types (the one open input)

The 5 note types are a **pluggable config** in `src/notes/note-types.ts`:

```ts
interface NoteType {
  id: string;        // e.g. 'discourse'
  label: string;     // shown in the library filter
  color: string;     // Highlightr / CSS variable
  callout: string;   // Obsidian callout keyword
  formatting?: 'arrows' | 'underline' | 'plain';  // e.g. discourse uses red arrows
}
type NoteTypeConfig = NoteType[];   // exactly the 5 types, defined by the user
```

Annotation (`src/notes/annotate.ts`) and the library grouping read this config;
neither hard-codes a type. **This is the only thing blocking the durable-core
build** (§8 step 1, stages 6–7). Steps 1.1–1.4 do not depend on it.

---

## 8. Build sequence (back-to-front, lowest risk first)

**Step 1 — durable core, against data we already have** (`testtranscript.md` +
`samplenotes.png`; no YouTube, no Apple plumbing):

1. transcript → daily-note assembly under per-video headings (idempotent)
2. `LocalMatcher` (pure) + golden-set harness
3. `OcrReconciler` (Claude client, schema, Haiku→Opus tier) + reconciliation flow
4. write `ReconciledNote`s back as callouts with block IDs *(needs §7)*
5. `LibraryView` sidebar: block-embeds, type filter, context modal *(needs §7)*

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
  note-types.ts       # §7 pluggable config
  annotate.ts         # idempotent callout/Highlightr writer
  LibraryView.ts      # sidebar view (block-embeds + modal)
golden/               # §6 regression fixtures + runner
```

The X dictionary's lessons that this design inherits: isolate the silo, surface
errors verbatim, no silent caps, degrade gracefully, freeze what you've already
captured. See the project memory `x-search-dictionary` for the parallel.
