# The Discourse Calculus — Phase 0 Constitution

*Status: RATIFIED-BY-TEST 2026-07-22 (Opus), **AMENDED I–IV same day (Fable)**
after an executable audit falsified four load-bearing assumptions — see
§Amendments at the end for each amendment and the probe that forced it.
Green suite: `node golden/scoreboard.mjs` (47) + `node golden/calculus-turns.mjs`
(17) + `node golden/calculus-corpus.mjs` (12, full real transcripts incl. the
3-hour imiron file). Changing §2–§3 or the Amendments is a **constitutional
act** — do it loudly, in writing, with the falsification that forced it.*

---

## 0. The one law

> **An utterance's *discourse* meaning is what it does to the common ground.**

Not what it says (that is truth-conditional semantics — the imiron video's
subject, where 泉 stops: 「そっから先は語用論」). Discourse begins exactly there.
This is dynamic semantics: meaning = **context-change potential** (Heim, Kamp;
Stalnaker's common ground; Farkas & Bruce's *table*; Roberts' QUD; Lewis's
scoreboard). We make that scoreboard executable.

The discourse structure of a conversation **is the trajectory the scoreboard
traces** as recognized moves fire. It is not a bin of units. The 🔴 class in
`note-types.ts` was mis-filed as a sixth *unit* type next to five reach-for
units (serifu, collocation, rhet-collocation, phrase-schema, skeletal). It is
not a unit. It is a **logic of moves on a shared state**. You cannot bin your
way to a logic. This calculus is that logic.

## 1. The failure this fixes (why a calculus, not a corpus)

Three attempts to produce discourse data all failed the **same way**:

| attempt | output | why it failed |
|---|---|---|
| Opus 4.6 × 2000 transcripts | 2000 incompatible micro-taxonomies | *extraction into an unspecified target* — each run invented its own schema; nothing accumulates |
| Fable × 1 transcript | a beautiful essay | *a holistic read is prose, not operations* — non-reproducible, non-composable |
| any model × 1 transcript | a better essay | same failure, more polish |

Common root: **extraction into an open target.** The analyst (LLM or human)
re-decides what counts, from scratch, every time. The fix is a category shift:

> **Specify the target first, deductively. Then the machine's job stops being
> "invent structure" and becomes "recognize a known structure."**

Recognition against a *fixed* target is stable and accumulates. Extraction into
an *open* target is noise that compounds. This is the difference between a
**grammar** (finite, principled, tested by a treebank) and **clustering a
treebank to discover syntax** (overfits the analyst's confusion). We build the
grammar. The corpus is the regression suite, **never the training set.**

Consequence for correction: a mistake here corrects **a rule** (local,
permanent, fixes every future occurrence) — never a **weight** (global, noisy,
needs 10 000 more labels). "Mistake over mistake" is structurally impossible.

## 2. The state — the scoreboard

`makeBoard()` in `src/discourse/calculus/scoreboard.mjs` returns:

| register | what it holds | theory |
|---|---|---|
| **CG** | propositions mutually accepted (grounded) | Stalnaker |
| **Table** | proposed, not yet settled (top = current issue) | Farkas & Bruce |
| **DC**\[speaker] | each speaker's public commitments | discourse commitments |
| **QUD** | stack of open questions organizing relevance | Roberts |
| **Projected** | inferences *attributable to a speaker* but not yet grounded | projected set |

A `Prop` carries `{ owner, status: literal|heuristic, force: assert|low|tentative, flags }`.
These five registers are the **whole** of the state. The claim (§6, falsifiable):
they are *sufficient* to derive the discourse moves of ordinary argumentative
Japanese. Where they are not, that is a named failure, not a vibe (blind-spot #3).

## 3. The algebra — the closed operation set

`PRIMITIVES` in `scoreboard.mjs` is the **complete, closed** list of ways the
state may change. It is DEDUCED from the question *"what can you do to a common
ground?"* — not mined from data. Each primitive = **precondition → effect**.

**Placement** (how a proposition enters):
- `PROPOSE(p, force)` — push p to Table as speaker's commitment.
- `ASSERT_AS_DERIVED(p)` — push p claiming it *follows from CG* (わけ/から/ので/だから); adds a support edge from CG.
- `CONSCRIPT(p)` — push p *as if already shared*, demanding uptake (じゃん/でしょ/よね); p enters **Projected**.
- `PREFACE_CONTESTABLE(p)` — push p flagged "I expect resistance", low force (んですけど).

**Relations over existing props:**
- `RELATE_SUPPORT` / `RELATE_CONTRAST` — argument edges.
- `SUBSTITUTE(p→p′)` — replace speaker's own live prop with a re-description claimed ≈ (要は/つまり).
- `RETRACT_OWN(p)` — withdraw speaker's own prior prop (repair half of というか).
- `REJECT(q)` — remove the **other** speaker's live prop (いや/違う).
- `GRANT(q)` — concede a prop into CG (でも/けど concessive half).
- `RATIFY(q)` — hearer uptake: move a pending prop into CG (うん/なるほど/ですね).

**Stance / scope control:**
- `DENY_COMMITMENT(q)` — **block an inference attributed to the speaker** (そこまで言ってない). Precondition: q ∈ Projected. Effect: q leaves Projected and DC. *The lexicon has no operator for this. The scoreboard makes it derivable because it KNOWS what is projected.*
- `RE_TYPE(p, literal→heuristic)` — recharacterize own prior status (便宜的な話で). *Also invisible to the lexicon.*
- `ADJUST_FORCE(p, Δ)` — raise/lower assertoric force (と思う/みたいな).
- `PROJECT_CONSEQUENCE(p)` — place a downstream inference as attributable (だから…なってしまう). This is what `DENY_COMMITMENT` later fences.

**Question management (Roberts' QUD stack):**
- `RAISE_QUD` / `ANSWER_QUD` / `SHELVE_QUD` / `RESUME_QUD`.

That is the entire algebra. If a real move cannot be written as a composition of
these, the set is **not closed** — a falsification, not a footnote (blind-spot #1).

## 4. Recognition is the edge; the calculus is the core

`reduce(turns, recognize)` injects the recognizer. `moves.mjs#recognizeMoves`
is the **replaceable edge**: it maps surface Japanese → a move descriptor, using
(1) the existing operator engine (`engine/match.mjs` already fires じゃん→GROUND-CLAIM,
でしょ→CONJECTURE-APPEAL, だから→CAUSAL-DISCOURSE, というか→REFORMULATE-REPAIR…) and
(2) two temporary gap detectors for the moves the lexicon lacks. Swap in a better
recognizer and the core is untouched. **The core never depends on a per-transcript
model call.** Recognition can be improved forever; the calculus stays fixed.

## 5. Composition and scope — why micro = macro

The same primitives operate at **every scale on the same board**. A `SHELVE_QUD`
is `一旦置いておいて` at clause scale *and* the imiron episode's 94-minute
"question stack" (水野 [11:50] parks; 堀元 [01:42] `疑問戻っていいですか` = `RESUME_QUD`)
at conversation scale. Fable's essay could only *narrate* that macro-arc in prose;
here it is the **identical operation** the micro-joints perform, one stack deeper.
A theory that unifies the two scales you were reading separately is doing real
work — that is the evidence it is more than a nice frame.

## 6. What "true" means here (the oracle, and falsifiability)

Truth is not "an LLM agreed." Truth is: **the reducer produces the scoreboard a
human would defend, on data it was not tuned to.** The golden
(`golden/scoreboard.mjs`) is the oracle — a hand-marked trace of the real 堀元
arc — and the reducer must reproduce it deterministically. Each phase has its own
falsification point:

- **§2 registers** insufficient → find a move whose correct typing needs state not on the board.
- **§3 algebra** not closed → find a real move that is not a composition of the primitives.
- **Recognition** underdetermined → measure the ambiguity rate of surface→primitive.
- **Usability** (Phase 4) → if reading the live scoreboard does not help a learner *predict the next move*, the whole theory is wrong. This is the final, in-use falsification, and it is the point of the exercise.

## 7. Non-goals (what this deliberately does not model)

Affect, face-work, prosody, register, and relationship history are **not** on the
board (yet). This is a bet: that argumentative discourse structure is derivable
without them. Blind-spot #3 is exactly the wager that this bet is wrong somewhere.
When it is, the fix is to add a register **deductively** (what must the state
include for this move to be derivable?) — never to bolt on an LLM that guesses.

---

## Amendments (2026-07-22, Fable) — each forced by a named, executable falsification

The Phase-0 golden proved **expressibility** (the algebra can encode the hand-read
arc). An adversarial audit the same day showed it did NOT prove **recognition**:
its money test depended on hand-splitting the verbatim [07:50] line, it excluded
backchannels, its registers never settled, and its input contract (clean,
speaker-labeled, sentence-segmented turns) is one the real corpus cannot supply.
Four amendments follow, per the constitution's own procedure.

### Amendment I — the atom is the SPAN EVENT, not the utterance
*Falsified by:* the verbatim 年功序列 [07:50] line (projection + fence in ONE
utterance). The v1 bag-of-booleans descriptor + fixed schema order fired the
fence before the projection existed; it bound the わけでしょ conscription
(wrong antecedent) and the board ended with the denied inference still projected.
*Amendment:* recognition emits an **ordered sequence of span events** (offsets
from `match.mjs`, formerly discarded); the reducer folds them in surface order.
An utterance is a mini-trajectory — micro=macro extends one level *down*.
Position now disambiguates: an utterance-initial でも concedes the prior turn;
a medial けど contrasts within the speaker's own flow and moves nothing.
(The user's danwa bolding — ordered spans — was always this format.)

### Amendment II — grounding (the missing half: Clark/Traum)
*Falsified by:* three うん turns putting everything said into CG (v1 RATIFY'd
every backchannel). The corpus is ~half backchannels; the Phase-0 golden had zero.
*Amendment:* backchannels are **not turns** — the evidence chain lifts them out
as **graded grounding events** on the turn they ground: `ack` (continuer —
attention only, new primitive **ACKNOWLEDGE**, no CG change) vs `accept`
(なるほど/確かに/そうですね → RATIFY). One principled exception: a **conscripted**
prop (じゃん/でしょ demanded uptake) + assent-shaped signal → tacit RATIFY
(Stalnaker default acceptance, marked `tacit`).

### Amendment III — settlement (registers model attention, not archive)
*Falsified by:* folding the full transcripts — Table ended with 361/1330 live
props, QUD depth hit 22 and stayed (ANSWER_QUD never popped: a push-only
register), so "top = current issue" was meaningless within minutes.
*Amendment:* a substantive answer by a non-asker **pops** the QUD; unaddressed
proposals **lapse** out of the live Table after a window; an unchallenged
conscription slides into CG (tacit); unfenced projected consequences decay.
Windows are structural constants (`WINDOWS`), amended constitutionally, never
fitted per-transcript. Lapse/tacit are **board dynamics**, logged separately —
they are not speaker moves. Binding beyond a window is **UNRESOLVED** —
first-class, never a recency guess (`board.unresolved`).

### Amendment IV — the evidence chain is part of the theory
*Falsified by:* the corpus itself — vault transcripts have NO speaker labels,
imiron is unpunctuated ASR whose line-splits **bisect triggers** (the [1:37:38]
疑問戻っ|ていいですか RESUME), and the audit's own first probe silently dropped
2 of imiron's 3 hours to a timestamp-format difference. Until segmentation,
backchannel lifting, and speaker attribution are deterministic code, every
corpus "break" is ambiguous between broken axiom and corrupted input.
*Amendment:* `calculus/turns.mjs` — parse (both timestamp formats) → fragment
merge (repairs bisected triggers) → backchannel lifting (Amendment II's input)
→ two-party floor inference with per-turn rule provenance. Declared heuristics,
honestly marked (`speakerSource:'inferred'`, `speakerRule`). Corpus-as-adversary
is only now interpretable — proven by the corpus golden reconstructing the
SHELVE [12:02] → RESUME [1:37:38] arc across 85 minutes of the 3-hour file.

*IV.b — de-fusing (added same day, forced by a self-attack).* Line-level
lifting went blind on unpunctuated ASR: measured on imiron, 348 uptake tokens
sat EMBEDDED inside merged turn text (0.9% grounding recall) and ~27% of turns
carried the other speaker's interleaved voice. Fix: a mid-turn uptake run
anchored by an unambiguous listener token (なるほど/確かに/はいはい/うんうん…)
is excised as an embedded grounding event; a question before it or a
floor-take opener after it (じゃ/では…) splits the turn to the other party.
そうですね/ですよね are deliberately NOT anchors — they are also the speaker's
own floor-holder / conscription marker (よね), and excising them would blind
CONSCRIPT. Result on imiron: grounding events 3 → 252, structure coverage
19.7% → 38.0%. The un-anchored ambiguous class remains in text, by design.

*IV.c — the truth channel.* `calculus/handmarks.mjs` feeds 談話モード
hand-marks (`src/discourse/turns.ts` TurnRefs — tap-boundary, speaker-cycle,
(line,char) grain) straight into the reducer, reusing turns.ts's own slice
math so both surfaces show byte-identical text. Hand-marked pure-backchannel
turns lift into grounding with the speaker GIVEN (`given:true`), not inferred.
This completes the project's ratified pattern: **auto chain = recall,
hand marks = truth** — a human ✕ on a turn boundary or speaker corrects the
input at its source, and the reducer consumes either channel unchanged.

### Amendment V — responsivity anchors (2026-07-24, Fable)
*Falsified by:* the precision sampling protocol (`golden/precision/`,
2026-07-22 run): suggested-precision **REJECT 0/7, GRANT 7/24**. The ✕ rows
were systematic: bare いや is a filler / agreement-preface / exclamative
(いや、そう。僕もそう思う = agreement — the board *deleted* the prop the
speaker was agreeing with); bare initial でも/けど is adversative
continuation, a new counterpoint (あ、でも), or an ASR clause-split; しかし
matched inside もしかしたら. Every suggested-✓ GRANT had an **assent head**
before the adversative (ま、でも / まあでも / そうでも / とはいえ / 面白いけど)
— the ま、でも vs あ、でも minimal pair carries the whole distinction.
*Amendment (three parts):*
1. **Recognition** (`moves.mjs`): REJECT fires only on a correction anchor
   (そうじゃなくて/じゃなくて/predicative 違う — quoted 違うんかい, self-doubt
   違うのかな, lexical 違う+N are guarded out); いや alone never fires, and
   いや + agreement head is UPTAKE (its real function). GRANT fires only on
   assent-head + adversative or とはいえ. A bare initial adversative emits
   `contrast`.
2. **RELATE_CONTRAST realized** (`scoreboard.mjs`): the declared-but-never-
   fired relation now marks the other's live prop `contested` (keeps it on
   the Table, refreshes attention, writes nothing into CG/Projected) — and a
   contested conscription may NOT slide into CG tacitly (settle() lapses it
   instead): default acceptance holds only absent objection.
3. **GRANT own-prop fallback removed**: a speaker cannot unilaterally move
   their own proposal into CG (that is what conscription+uptake is for). The
   golden's [07:59] でもぶっちゃけ GRANT only "worked" through this fallback;
   it is now RELATE_CONTRAST, per this amendment, loudly.
*Verification:* replayed against the judged sample rows — all 21 ✕ rows and
all 7 REJECT rows stop firing, 5/7 ✓ GRANT rows keep firing (the two lost
are bare-でも concessives, now logged as contrast: a precision-first trade,
same policy as IV.b's anchor choice). Pinned in `golden/calculus-precision.mjs`.

### What the board is FOR (clarification, not amendment)
The board's product for a production tool is the **affordance set** —
`affordances(board, speaker)`: which primitives' preconditions are satisfiable
now, with why. That is the production-condition (〔ctx〕) for 🔴, the basis of
the next-move-prediction drill, and it is computable without content. Structure
coverage is a **recall** number (52% 年功序列 / 20% imiron — the latter is
mostly exposition, and a calculus of argument should be quiet there); per the
project's standing rule, no precision is claimed — ✓✕ remains the classifier.
