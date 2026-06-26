# PARSER AUDIT — discourse analysis (measured, not asserted)

Verdict: the discourse parser that **ships in the plugin is broken**; a much
better engine exists but is **untracked scratch not wired in**. Numbers below are
from actually running both over a real transcript (`testtranscript.md`), not from
anyone's "it's fine."

## Measured baseline

| | Parser A — `detectPatterns` (in `main.js`) | Parser B — `_tmp_pipeline/` (untracked) |
|---|---|---|
| Method | naive `indexOf` substring, **no word boundaries** | morphological tokens + lexicon + relations |
| Hits on the transcript | **2,633** | 604 over 78 sentences (~8/sentence) |
| **Provable false positives** | **≥351 (13%)** particles matched *inside* words (`の[な]い`, `招[と]し`, `す[さ]お`) — conservative count | ~0 substring FPs (has boundaries) |
| Structure | flat list, nothing else | voicing (53 hits: `S→先生`×28, `S+H`, `S→水野さん`), quote-frames, spans/pivots/moves, FLOW_STATE |
| Generalizes? | n/a | yes — voicing worked on a transcript it was **not** tuned on |

**A is architecturally unfixable**: boundary-free `indexOf` matches every
sentence-final particle (さ/な/わ/で/と…) wherever those kana appear inside content
words and verb conjugations (さ in 小**さ**い, わ in 問**わ**ない). No tuning fixes
this — it needs morphological tokenization.

**B is the right foundation** but is **overfit to its showcase** (Handel/Kant) and
has real, narrower defects (below). It is portable: no Node-only deps in the
analysis path; bundles for the Obsidian browser runtime at ~410 KB (trimmable).

## B's known defects (to fix in Phase 3, gated by the golden set)

- Inconsistent polysemy: もう→`TEMPORAL-NOW` (correct) vs `ADDITIVE-INCREMENT`
  (wrong, in もう二度と); を問わない→questionable `UNIVERSAL-CLAIM`;
  そうですね、はい→wrong `RIGHT-DISLOCATION`.
- `PARALLEL-FRAME-COUPLE` over-captures (spans whole sentence vs the two frames).
- Under-fires some grammar (のに, らしい); misses some fillers (なんか, まあ).
- Does **nothing** for the 🔵 rhetorical-collocation class (out of scope — that's
  DESIGN.md §7, a separate build).

## The plan (right steps)

**Phase 0 — baseline & decision. DONE (this doc).** A unfixable; port B; harden.

**Phase 1 — vendor B-core into the plugin behind a typed interface.**
Copy the essential analysis modules into `src/discourse/engine/` (tracked plugin
source — not the untracked scratch), expose `analyzeDiscourse(text)` with TS
types, `npm run build` green + a smoke test. *(Trim the 410 KB chain to the
modules the plugin actually needs as Phase 1.5, guarded by the smoke test.)*

**Phase 2 — replace the naive parser.** Adapt B's output to the existing
`PatternMatch`/pill shape; switch `detectPatterns` callers (X view pills,
reading-mode highlighter, card generator) to the engine; keep old `detectPatterns`
only as a clearly-marked fallback, then remove.

**Phase 3 — golden set + de-overfit + fix defects.** Build a golden set spanning
**many** transcripts (the anti-overfit guard); fix the polysemy/span/coverage bugs
above, each change gated by a green golden set + a non-regressing false-positive
rate vs the Phase-0 baseline.

**Phase 4 (later) — the 🔵 gesture catalog** (DESIGN.md §7; separate from the 🔴
parser).

## Regression metrics (locked targets)

- False-positive rate on `testtranscript.md` must stay **0% substring-embedded**
  (Phase 1 onward) vs A's 13%.
- Golden-set sentences (incl. the Handel showcase + ≥10 novel transcripts) must
  reproduce expected voicing / quote-frame / structure within tolerance.
