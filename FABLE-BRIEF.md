# Brief for Fable — realize, stress, and try to break the discourse calculus

*You are reading a handoff from Opus. The division of labor is the user's:
**Opus builds the deductive trellis; you tend the open whole with lived data.**
Opus says interesting things; you do interesting things. This brief exists so
you can do three jobs at once — **realize** the theory as a usable plugin,
**scale** it over the corpus, and **adversarially break it where Opus could not
see its own mistakes.** All three matter. The third most.*

---

## 0. Read these first (the whole artifact)

| file | what it is |
|---|---|
| `DISCOURSE-CALCULUS.md` | the frozen core: the one law, the 5-register scoreboard, the closed algebra. Theory. |
| `src/discourse/calculus/scoreboard.mjs` | the calculus made executable — pure reducer, no LLM, no Obsidian. **The core.** |
| `src/discourse/calculus/moves.mjs` | recognition→algebra bridge. **The replaceable edge.** Contains 2 temporary gap detectors. |
| `golden/scoreboard.mjs` | the falsification test — real recognizer on real 年功序列 lines. **The anchor. Run it: `node golden/scoreboard.mjs`.** |
| `src/discourse/engine/{lexicon,match,relations}.mjs` | the existing operator engine (~100 operators, real recognition, no scoreboard). |
| `src/notes/note-types.ts` | the six-class taxonomy. The 🔴 class is the mis-filed relation-type this calculus replaces. |

## 1. The one invariant that means "you have not strayed"

> **A change realizes discourse iff it changes the scoreboard trajectory.**

- If a change does **not** alter what the reducer does to `⟨CG, Table, DC, QUD, Projected⟩`, it is decoration — reject it.
- If a change **breaks the golden**, you have either found a real bug (fix it) or altered the core (a *constitutional act* — do it loudly, in writing, with the falsification that forced it; never silently).
- **The golden is the teeth.** Keep it green and you cannot drift. You have full freedom to add operators, lexicon entries, UI, and corpus tooling *as long as `node golden/scoreboard.mjs` stays green* — or you consciously amend the constitution and say so.

This is how "without straying from the core, with room to expand" is enforced
mechanically instead of by trust.

## 2. Opus's blind-spot ledger — attack these, ranked by how load-bearing they are

Opus wrote the theory, so Opus cannot see where it is wrong. Your highest-value
work is here. Each item names the assumption, why it might be false, and the
**concrete falsification test**. Treat a failed test as a finding, not a defeat.

1. **The algebra is closed (≈18 primitives cover all moves).** *Likely wrong.*
   Test: run the reducer over N held-out transcripts; log every utterance whose
   descriptor is `placement:'PROPOSE'` with **no** relation/stance move — the
   "structureless" residue. Sample it. If a recurring move lives there that is
   *not* a composition of existing primitives (e.g. rhetorical question,
   irony/echo, analogy-frame, floor-grab, topic-nomination), the set is not
   closed → propose a new primitive **with precondition→effect**, not a label.

2. **Surface→primitive recognition is determinate.** *Partly wrong — this is the
   hard part.* けど/から/と/でしょ are massively polysemous. Test: for the
   ambiguous forms, measure how often `match.mjs` scope/position rules pick the
   contextually-correct primitive vs. need board state to disambiguate. Where
   board state is needed (e.g. でしょ = CONSCRIPT vs. genuine conjecture), move
   the decision **into the reducer** (it has the state) rather than the matcher.

3. **The 5 registers are sufficient.** *Wager, may fail.* Test: find a move whose
   correct typing requires state the board lacks — affect, face, register,
   who-holds-the-floor, relationship history. If `DENY_COMMITMENT`'s antecedent,
   or a politeness-driven downgrade, can't be bound from `⟨CG,Table,DC,QUD,Proj⟩`,
   the state is short a register. Add it **deductively** (§7 of the constitution).

4. **Antecedent binding by "most-recent-live" is right.** *Crude heuristic.*
   `GRANT`/`REJECT`/`DENY_COMMITMENT` bind to the most recent matching item.
   Test: in multi-thread argument, does the fence bind the *intended* inference
   or an accidental nearer one? If wrong, binding needs QUD-scoping (bind within
   the active question), not linear recency.

5. **Micro = macro (QUD ops scale to 94-minute arcs).** *Beautiful, maybe
   over-reach.* Test: parse the imiron transcript
   (`意味論 375 (fe5kdBLS8wM)`); does the QUD stack actually reconstruct
   水野's `一旦置いておいて` [11:50] → 堀元's `疑問戻っていいですか` [01:42] as
   SHELVE→RESUME, and does the stack depth stay sane over 94 minutes? If it
   drifts unboundedly, macro-structure has emergent properties the clause-level
   ops don't capture.

6. **Tuning to the user's one hand-reading generalizes.** *Circularity risk.*
   The golden encodes Opus's reading of one arc. Test: build 2–3 more goldens
   from *different* transcripts and speakers **before** adding features. If the
   reducer only reproduces the arc it was written against, it overfits one
   reading — exactly the failure mode this whole design claims to avoid.

7. **The two gap detectors in `moves.mjs` are correct.** *Regex, provisional.*
   `DENY_RE` / `RETYPE_RE` are stopgaps. Test them for precision/recall on the
   corpus, then **promote them into `lexicon.mjs` as real operators** (with
   scope/`not_after` guards like every other entry) and delete the regexes. This
   is the cleanest first PR.

## 3. The corpus is your adversary, never your teacher

Re-run of the 2000-transcript idea — but inverted. **Do not extract data from the
corpus.** Run the *fixed* reducer over it to find **where it breaks**:

```
for each transcript: reduce(turns, recognizeMoves)
  → coverage report:
     • % of utterances that got a non-PROPOSE placement (structure found)
     • the PROPOSE-only residue (blind-spot #1 material)
     • surface forms that fired NO operator (missing lexicon entries)
     • boards that went incoherent (negative registers, runaway QUD depth)
```

Every break is either **a missing lexicon entry** (local fix, one typed line) or
**a broken axiom** (constitutional — escalate in writing). Log what you sample
and what you skip; never let a silent top-N cap read as "covered everything."
The output is a *coverage number that goes up as the fixed theory meets more
data* — the thing the 2000-run could never produce because it had no fixed target.

## 4. The runway to a usable plugin (scale + real study use)

The theory predicts a specific, usable product. Build it in this order; each step
keeps the golden green:

1. **Promote the gap operators** (blind-spot #7) → the lexicon sees fences and
   re-types like every other move. Wire the reducer output through
   `relations.mjs`' place in the pipeline (it currently emits local annotations;
   the reducer gives it the global state it always lacked).
2. **Live scoreboard under a transcript.** In `FollowAlongView` (already the
   media-sync surface, `src/ui/FollowAlongView.ts`), render the board state that
   is current at the playhead: CG / Table / Projected / QUD, updating as moves
   fire. Reading argument *as state* is the payoff.
3. **🔴 study = next-move prediction.** This is what "responsivity-defined"
   operationally **is**: stimulus = a frozen scoreboard state; response = the
   primitive that makes the intended move. Freeze the board mid-arc, learner
   predicts the operator (CONSCRIPT? FENCE? CONCEDE?), reveal. A real drill —
   not the graduated-cloze card that `cards.ts` gives every class today.
   `PatternEntry` keys on `surface|link|frame` (all unit keys); a move needs a
   new payload shape — `{ boardStateBefore, primitive, surfaceRealization }`.
4. **Accumulation.** Because every transcript folds through *one* fixed algebra,
   boards are comparable across the corpus. Now "how does 堀元 typically FENCE?"
   or "what surface forms realize CONSCRIPT?" are answerable queries over
   accumulated traces — the coordinate system was fixed a priori.

## 5. The final test (the user's falsification of Opus)

> *"if ur theory is right, would it not be a productively usable plugin in
> practice, no? if not ud be wrong, so what do?"*

The acceptance criterion is **step 4.3 in use**: a learner watching the 年功序列
debate with the scoreboard running should be able to *anticipate the next move*
and check themselves. If they can — the theory holds and this is a real study
tool. If they cannot — the theory is wrong, and you will know **at a named
point** (which register, which primitive, which binding), because the whole thing
is small, explicit, and green-tested. That is the difference from an essay: it can
be wrong *on purpose, locally, and fixably.* Find where Opus was wrong.
