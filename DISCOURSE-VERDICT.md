# Verdict on the discourse calculus — independent re-measurement

*Opus, 2026-07-25. Every number below was re-derived from the code on disk,
not taken from either prior session's summary. Probes are reproducible; the
commands are given. Nothing in `src/` was modified to produce this.*

---

## 0. Bottom line

Three things are true at once, and the spinning comes from them being fused:

1. **The core idea is right and is the project's durable asset.** Fixing a
   deductive target so the machine *recognizes* rather than *extracts* is the
   one move that makes discourse work accumulate. It survives everything below.
2. **The flagship result is real.** The money test reproduces through the
   production evidence chain on verbatim ASR — verified here, not asserted.
3. **The conclusion "this cannot be a parser because skeleton underdetermines
   the move" is not supported by the evidence, because the recognizer is
   currently running at roughly **1/15th of its own rule ceiling** due to a
   plumbing defect at the turn↔sentence seam.** The wall Fable described has
   never been reached. §5 measures this.

The single highest-value action is not more theory, not a learned classifier,
and not more anchors. It is a segmentation fix worth a measured **1.7% → 27.2%**
lift in conscription recognition on the 3-hour file.

---

## 1. Claim ledger

| claim | source | re-measured | verdict |
|---|---|---|---|
| all calculus goldens green | Fable | 48+33+18+29 = **128 checks pass** | ✅ true |
| money test survives real ASR | implied | `[07:50]` → `ASSERT_AS_DERIVED · PROJECT_CONSEQUENCE · DENY_COMMITMENT` via `transcriptToTurns` | ✅ **true, and it is the best result in the project** |
| SHELVE[12:02]→RESUME[1:37:38] across 85 min | Fable | golden asserts it; corpus run reproduces | ✅ true |
| zero REJECTs across 3.5 h | Fable | REJECT = 0 on both files | ✅ true (self-reported honestly) |
| structure coverage **48%** on imiron | Fable summary + demo | **36.3%** under the golden's own definition | ❌ **inflated** — see §2 |
| GRANT precision 29% → **100%** | Fable | 7 GRANT firings exist *in total* across 3.5 h; sample = population; labels are the model's own | ⚠️ **technically true, materially empty** |
| "all 109 rows carry suggested labels; ratification is yours" | Fable | **0 / 109 ratified**, and 0 / 123 in the frozen set | ✅ true, and it means *every precision number in this project is the model grading itself* |
| the drill is the theory's falsification | Opus + Fable | **75.6% / 80.2% winnable without reading the board or the Japanese** | ❌ **the instrument is broken** — see §4 |
| "rules asymptote; skeleton can't carry it" | Fable, turn 1 | contradicted by measurement | ❌ **wrong wall** — see §5 |
| "I mis-located the wall; skeleton is position+composition" | Fable, turn 2 | correct, and it is also DESIGN §23, ratified five days earlier | ✅ true |

---

## 2. The coverage number

`golden/calculus-corpus.mjs` prints **36.3%** for imiron today. The demo and the
summary say **48%**. Both are computable — they differ by one term:

```
residue = {PROPOSE, ADJUST_FORCE, ANSWER_QUD} → coverage 36.3%   ← the golden's own definition
residue = {PROPOSE, ADJUST_FORCE}            → coverage 37.1%
residue = {PROPOSE}                          → coverage 48.1%   ← the demo's number
```

The 48% figure counts `ADJUST_FORCE` — i.e. *the utterance contained と思う or
みたいな* — as "discourse structure found." 174 of imiron's moves are
`ADJUST_FORCE`. Counting hedges as structure is the inflation, and it appeared
in the same message that promised the deflated version. (The demo's other
headline stats — 1042 turns, 1660 moves, 124 CG, 277 grounding — are all exactly
right.)

Decomposed honestly, imiron:

| | turns | of 1042 |
|---|---|---|
| golden's coverage | 378 | 36.3% |
| minus grounding (RATIFY/ACKNOWLEDGE) and support edges | 164 | **15.7%** |
| turns carrying a *hard* move (conscript/grant/reject/contrast/substitute/repair/fence/re-type/QUD-op) | 77 | **7.4%** |

nenko (33 min, punctuated): 49.3% → 32.1% → **14.2%**.

Also: `ANSWER_QUD` is logged **61% of the time without popping anything** (it
only pops when the asker isn't the speaker). It is correctly excluded from the
golden's coverage, but it inflates the move log.

---

## 3. The state of the truth channel

`golden/precision/samples.jsonl`, 109 rows, **0 ratified**. Suggested-label
census (the model's own reads, post-Amendment V):

| prim | ✓ | ✕ | ? |
|---|---|---|---|
| CONSCRIPT | 16 | 2 | 6 |
| RATIFY | 16 | 2 | 2 |
| SUBSTITUTE | 11 | 0 | 0 |
| **TACIT_CG** | 7 | **4** | **5** |
| GRANT | 7 | 0 | 0 |
| **RELATE_CONTRAST** | 4 | **3** | 2 |
| **PROJECT_CONSEQUENCE** | 4 | **3** | 1 |
| RETRACT_OWN | 5 | 0 | 2 |
| RE_TYPE | 2 | 1 | 0 |

The three bolded rows are the ones that *write to CG / Projected* — the registers
the whole board is for — and they are the least trusted, by the machine's own
account. And `TACIT_CG` fires through a chain (conscription → 6 turns
unchallenged → CG) whose "unchallenged" test depends on REJECT/GRANT/CONTRAST
detection, which fires 0 / 7 / 3 times respectively on a 3-hour file.

---

## 4. The drill cannot falsify anything as built

`FollowAlongView.makeDrill()` builds the option set as:

```js
const options = new Set([next.prim]);            // ← the ANSWER goes in first
for (const p of aff) { if (options.size >= 4) break; if (DRILLABLE.has(p)) options.add(p); }
```

`affordances()` returns a fixed-order list, so the distractors are drawn from an
almost-constant prefix (`CONSCRIPT, ASSERT_AS_DERIVED, GRANT, REJECT…`). The
answer therefore *displaces* the tail of that prefix, and **membership of the
option set leaks the answer** even though the options are sorted so position
doesn't.

Measured over every turn as a freeze point:

| | nenko | imiron |
|---|---|---|
| distinct option-sets in the whole file | 8 | 12 |
| accuracy reading **only the four options** | **75.6%** | **80.2%** |
| random guessing | 25% | 25% |

Deterministic tells include `[ASSERT_AS_DERIVED, CONSCRIPT, GRANT, RATIFY]` →
always RATIFY (71×, 93×) and `[CONSCRIPT, GRANT, RATIFY, REJECT]` → always
RATIFY (326×).

Second defect: the drill asks "what is *the next move*" but searches forward for
the next *drillable* move at any distance. On imiron the median distance is
**32 s**, p90 **97 s**, max **242 s**; **52%** of freeze points have their
"answer" more than 30 s in the future. That is not next-move prediction.

Third: the answer key is the recognizer's own output. Passing the drill measures
agreement with the machine, not with the discourse.

*Consequence:* the acceptance criterion the entire constitution rests on — "if
reading the board doesn't let a learner predict the next move, the theory is
wrong" — **cannot currently return a meaningful result in either direction.**
Fix (small): sample distractors independently of the answer, at fixed
cardinality, from the affordance set; bound the horizon to the next 1–2 turns;
report the option-only baseline alongside any score.

---

## 5. The wall is in the wrong place — this is the finding

### 5.1 Mechanism

`match.mjs` is, by its own header, a **sentence-level** matcher. A trigger with
`scope: 'sentence-final'` (which is *every* conscription and alignment trigger —
じゃん・でしょ・よね・ですよね・じゃないですか・んですね) only validates when
`classifyPosition` finds ≤6 trailing characters after it.

`turns.mjs` (Amendment IV) merges ASR fragments into turns up to 90 chars —
**3108 fragments merged into 1042 turns** on imiron, unpunctuated.

`moves.mjs` then calls `matchSentence(wholeTurnText)`.

⇒ **Only the final clause of each merged turn can ever fire a final-particle
operator.** Everything before it is invisible — not ambiguous, not
underdetermined, *not looked at*.

### 5.2 Measured

Turns that literally contain the marker, vs. turns where it fires:

| marker | imiron: present | fires now | with clause-split |
|---|---|---|---|
| よね | 184 | 8 (**4%**) | 167 (91%) |
| ですね | 205 | 14 (7%) | 188 (92%) |
| ですよね | 118 | 7 (6%) | 103 (87%) |
| じゃないですか | 58 | 9 (16%) | 55 (95%) |
| んですね | 47 | 4 (9%) | 47 (100%) |
| でしょ | 25 | 1 (4%) | 25 (100%) |
| じゃん | 11 | 0 (**0%**) | 11 (100%) |

**Turns with a recognized CONSCRIPT trigger: 18 → 283, i.e. 1.7% → 27.2% (×15.7).**
Total lexicon hits ×1.31. On nenko (punctuated, few merges): 13.6% → 21.9%.

The splitter used is 15 lines of pure skeleton — hard punctuation plus "a
final-particle-shaped cluster followed by more material." No content is read, no
model is called, no new theory. *Honest caveat:* that throwaway shim **regresses**
じゃないですか on nenko (86% → 29%) because it splits *inside* the trigger
(`じゃない` matches before `じゃないですか` clears its lookahead). A real
implementation must not split inside a known trigger span — `engine/sentencize.mjs`
already exists and is unused by the calculus. So the lift above is a **lower
bound** measured with a deliberately crude instrument.

### 5.3 What Amendment IV actually cost

Merging repaired the bisected `疑問戻っ|ていいですか` RESUME trigger — one event.
Measured against not merging, on imiron it also destroyed:

```
uptake        80 → 26   (−54)
place:derived 132 → 90  (−42)
place:preface  36 →  5  (−31)
place:conscript 41 → 15 (−26)
```

Net ≈ −150 events to buy 1. That trade was never measured. It is not an argument
against merging — it is an argument that merging **must** be paired with
re-segmentation before matching.

### 5.4 Therefore

> "Rule-based discourse parsing stalled at exactly this wall for the entire
> history of the field, and the fix was never more rules."

This is a true statement about a wall **this system has never touched.** It is
failing an order of magnitude below its own rule ceiling, for a reason that is
mechanical, local, and cheap to fix. Any measurement of "how far can skeleton
go" taken today — including the learned-classifier experiment Fable proposed —
would be measuring this bug.

---

## 6. The third dependency: speaker attribution

Every relational primitive binds via `mostRecentTable(board, speaker, 'other')`.
That makes all of GRANT / REJECT / RATIFY / RELATE_CONTRAST / ACKNOWLEDGE
downstream of two-party floor inference. Measured:

| | turns | speaker changes | longest single-speaker run |
|---|---|---|---|
| nenko | 302 | 59 (19.5%) | 26 |
| imiron | 1042 | **57 (5.5%)** | **134** |

On imiron, `R4:floor-continues` — the *default* — decides **984 of 1042** turns.
In a two-host dialogue podcast. So "the other speaker's most recent live prop"
is routinely dozens of turns and many minutes stale, and CG = 124 is bookkeeping
over a near-constant function.

DESIGN §23.2 layer 1 already answers this: *"for local-audio mediums this is a
DIARIZATION problem, not a text-inference problem… Stop guessing who's who from
text when the audio knows."* The calculus guesses from text.

---

## 7. The governance finding: the calculus jumped its own stack

DESIGN **§23** (ratified 2026-07-19, three days before Phase 0) already contains
the user's diagnosis — *"the discourse side is hardly a parser"* — and the
accepted fix: four layers, each asked only what it can answer.

| §23 layer | who does it | what the calculus does |
|---|---|---|
| 1. Turns (who/where) | diarization for audio; humble defaults + ✓✕ for text | text inference, default 94% of the time (§6) |
| 2. **Components** (echo / aizuchi / reaction / return / connective / quotative / fragment) — *"the parser's honest ceiling today — and it's USEFUL"* | machine, precision-first | **skipped entirely** — `src/discourse/components.ts` (25 golden checks, green) is imported nowhere in `calculus/` or `FollowAlongView` |
| 3. Relations (what points at what) | **drawn by hand** | machine, by linear recency |
| 4. Readings (move names, tone) | **HUMAN-ONLY, PLURAL** | machine, single-label |

The calculus does layers 3 and 4 by machine and skips layer 2. Precision then
collapsed exactly in layers 3–4 (REJECT 0/7, GRANT 7/24, binding = recency), and
recall collapsed exactly where layer 2 was missing. §23 predicted both, in
writing, before Phase 0 existed.

---

## 8. Adjudicating the last exchange

**On the user's framework** (a polysemous item's function is fixed by the
multivariate configuration of surrounding skeletal components, at several
levels): Fable's second answer is correct — this is Conversation Analysis's
*position + composition*, it matches the dialogue-act ML record, and Japanese
grammaticalizes interactional stance in closed-class morphology more than most
languages. It is also, word for word, the user's own DESIGN §23. It is not a new
idea needing validation; it is a ratified project principle that the calculus
bypassed.

But the current implementation's model of *position* is degenerate: **one binary**
— "within 6 chars of the turn head" vs. "medial, ignore." Japanese puts its
richest interactional skeleton **turn-finally**, and §5 shows that channel is
being dropped wholesale. So the framework hasn't been tested, and the one place
it *was* tested (Amendment V's ま、でも / あ、でも minimal pair) it worked, with
zero content read — which Fable correctly identified as evidence against its own
first answer.

**On the learned-classifier proposal:** right idea, wrong order. Training a
skeletal model on ✓✕ gold while conscription recall sits at 8% would fit the
segmentation bug, and the "content ceiling" gap it measures would be mostly the
bug's size. Fix §5, then measure.

**On serifu = thought + transport fused:** this is the strongest synthesis in
either transcript and I have nothing to add except that it is already the
project's architecture — 〔ctx〕 as a board state is exactly §26's
production-condition, and it means the tool never needs to read content *by
design*, not as an apology.

---

## 9. Order of work

1. **Re-segment before matching.** Clause-split merged turns (reuse
   `engine/sentencize.mjs`; never split inside a trigger span), rebase offsets,
   feed the parts to `matchSentence`. Purely skeletal. Expected: conscription
   recognition ×15 on ASR. Re-run `golden/calculus-corpus.mjs` and report the
   honest coverage under the *golden's* definition, not a looser one.
2. **Fix the drill** (§4): independent distractor sampling, bounded horizon,
   always print the option-only baseline. Until then the falsification criterion
   is inert.
3. **Wire layer 2** (`components.ts`) as the recognition substrate under the
   calculus, per §23.
4. **Then** the ✓✕ pass — and it must include *residue* rows, not only firings,
   or it measures precision on a shrinking claim forever.
5. **Then** the learned multivariate edge, with the anchors as baseline.

Steps 1–2 are days, not weeks, and they are prerequisites for every measurement
anyone would want to make afterwards.

---

## 10. Answering the question that was actually asked

> *"Will this be usable for any discourse transcript? … This isn't a parser, and
> I'm beginning to wonder if this could ever be one."*

- **Is it a parser today?** No — and not for the reason given. It is a
  precision-first detector running at a fraction of its own recall because of a
  segmentation seam.
- **Could it be one?** For *components and coarse moves*, plausibly — that is
  §23's own "honest ceiling," and it is where CA and the ML record both say the
  signal lives. For *argument structure with correctly bound antecedents*, no:
  binding runs on aboutness, and aboutness is content. A study instrument does
  not need binding to be automatic; §23 layer 3 already assigns it to the hand.
- **Was the doubt correct?** Yes — but it was aimed at the theory, and the
  theory is the part that is holding. The failures are all in the edge: one
  segmentation bug, one leaky drill, one text-guessed speaker channel. Those are
  the three things to fix, and each is falsifiable on its own.

---

---

## 11. PRE-REGISTRATION — written before the measurement, 2026-07-25

*Six rounds have each found something real, fixed it, declared progress, and
moved the goalposts. Nobody ever said in advance what would count as failure.
This section is written and committed **before** the seam fix is implemented, so
the criterion cannot be adjusted to fit the number that comes out.*

### The intervention being tested
Clause-split merged turns before handing them to `matchSentence` (see §5), so a
`scope:'sentence-final'` trigger can validate on any clause of a turn rather than
only the last. Purely skeletal: hard punctuation plus final-particle-shaped
clusters followed by more material. No content is read. **A split may never fall
inside a known trigger span** (the defect in the §5.2 shim).

### The measurements, defined now

**M1 — hard-move coverage on nenko.** Turns carrying ≥1 primitive from
`HARD = {CONSCRIPT, GRANT, REJECT, RELATE_CONTRAST, SUBSTITUTE, RETRACT_OWN,
DENY_COMMITMENT, RE_TYPE, PROJECT_CONSEQUENCE, SHELVE_QUD, RESUME_QUD}`,
over `transcriptToTurns(nenko).turns`. **Baseline: 43 / 302 = 14.2%.**

**M2 — precision of what the fix recovers.** The set of CONSCRIPT firings that
exist after the fix and did not exist before. Deterministic stride sample of 30,
stable ids, presented as a ✓✕ sheet. **Judged by the user, not by the model.**
Model-suggested labels are not admissible for this criterion.

### The thresholds

| | pass | fail |
|---|---|---|
| **M1** | ≥ 25% (≥ 76 / 302) | < 25% |
| **M2** | ≥ 24 / 30 ✓ | ≤ 23 / 30 ✓ |

### What each outcome means — decided in advance

- **Both pass** → hand-written skeletal rules have materially more room than the
  2026-07-24 "rules asymptote" conclusion allowed. The user's multivariate-
  skeleton thesis has its first genuine support. Continue the board; next step is
  the second-position typology (§8).
- **Either fails** → the rules road is finished as a route to a parser. Stop
  investing in the board as a state model. Build the **move concordance**: the
  timestamped, provenance-carrying index of high-precision marked moves, with
  CG/Table/Projected demoted to internal bookkeeping that is never quoted as a
  result. This is a real product and an honest one.
- **M1 passes, M2 fails** counts as *fail*. Recovering more firings that are
  wrong is the exact failure mode this project keeps repeating; volume is not
  evidence.
- **M1 fails, M2 passes** counts as *fail* for the parser question, but the fix
  is still kept — precise recall is worth having in the concordance.

Neither outcome licenses a further round of "but if we also…". If the criterion
fails, the conclusion is recorded here and the direction changes.

---

## 12. RESULT — measured 2026-07-25, after the fix, against §11 unchanged

### M1 — **FAIL**

| | | |
|---|---|---|
| baseline re-derived (HEAD matcher) | 43 / 302 | 14.2% — matches §11 exactly |
| **measured with clause-split** | **65 / 302** | **21.5%** |
| threshold | ≥ 76 / 302 | ≥ 25% |

Recorded but explicitly **not** grounds to relitigate: the same fix scores
**25.4% on imiron** (77 → 265 / 1042). It would have passed on the unpunctuated
file. §11 named nenko in advance; nenko is the measurement.

Where the lift went, per primitive on nenko:

```
CONSCRIPT            28 →  52   (+24)
SUBSTITUTE            3 →   4   (+1)
RETRACT_OWN           0 →   1   (+1)
GRANT                 6 →   6   (+0)
RELATE_CONTRAST       6 →   6   (+0)
PROJECT_CONSEQUENCE   3 →   3   (+0)
DENY_COMMITMENT / RE_TYPE / SHELVE_QUD    unchanged
```

One channel opened wide; every *relational* primitive stayed exactly as dark as
before. The seam was real and fixing it did not make this a parser.

### M2 — unratified; the model's pre-read is **20 ✓ / 10 ✕** (inadmissible)

§11 reserves this judgment for the user and that stands — the count above is a
pre-read, not the criterion. It is recorded only because the failure mode is
mechanical and singular: **all 10 ✕ have the trigger inside a quotative or
own-opinion frame** (っていう・みたいな・と思う) that the matcher does not shield
CONSCRIPT against, though it already detects those markers as `ADJUST_FORCE`.

Mechanical audit of the full recovered set (226 turns, no judgment involved):
って(いう) 42%, とか 29%, みたいな 19%, と思う 12% — **75% carry at least one.**

### The fix is kept, the label is demoted

The §5.2 bisection defect is genuinely gone: `有利じゃないですか` fires intact and
`じゃないですか` on nenko went **11 → 14** where the throwaway shim regressed it
86% → 29%. Residual: `んですね` 1 → 0 and `ですね` 18 → 16 on nenko.

M1 fails ⇒ **the rules road is finished as a route to a parser.** Per §11's fail
branch, the direction is now the **move concordance**, and CG / Table / Projected
become internal bookkeeping that is never quoted as a result. The move *label* is
part of that bookkeeping; the *marker instance* is the concordance's unit — which
is why the fix is kept rather than reverted. What it bought is a concordance
asset, not a state-model asset:

```
imiron, real instances made visible:
  じゃないですか   7 → 54       ですよね   3 → 66
  よね            0 → 60       じゃん     0 → 11
```

That is a decisive result for a production lexicon and a mediocre one for a
common-ground state model. The plugin needed the former.

### The finding §11 could not have pre-registered

The gate is not the recognizer. §11 requires the user to personally judge 30
rows; the truth channel stands at **0 / 109 ratified** (0 / 123 frozen) across
three days, and the session that ran this measurement opened with the labeling
being handed to the model. Ratification-as-homework has never once completed at
scale. It has to become a **byproduct of study** — each drill answer, board
review, and 談話モード boundary tap emitting a ✓✕ silently. That is the next
seam, and it is a human one.

---

### Reproducing this

```bash
node golden/scoreboard.mjs && node golden/calculus-turns.mjs \
  && node golden/calculus-corpus.mjs && node golden/calculus-precision.mjs
```
Probes for §2, §4, §5, §6 are in the session scratchpad
(`probe.mjs`, `probe2.mjs`, `probe3.mjs`, `probe4.mjs`, `probe5.mjs`); they
import from `src/` read-only and modify nothing.
