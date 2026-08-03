# 辞書 — what is actually in the 35 books, and what the Lexicon should do with it

*2026-08-01. Companion to AUDIT-2026-08-01 §6.7. Every number here was measured
off the user's own `JP Dictionaries/` sidecars (6,376,236 headwords, 3,749,268
frame rows, 2.6 GB), not read off a publisher's blurb. Sample sizes are stated
per measurement; anything I did not measure is marked as unmeasured.*

---

## 0. The question this answers

The previous turn ended with "a dictionary hit isn't a reconcile target, and I'd
want your view on whether a dictionary hit should count as an attestation at
all." That framing was too coarse, and the reply that came back was the right
correction: **a dictionary is not a source of hits. It is a bundle of several
different kinds of information, each with a different evidential status, and the
bundle differs per book.** 用例.jp citing 『南回帰線』 and 英辞郎 inventing a phrase
are not the same act, and no single yes/no about "dictionary hits" can be right
for both.

So: what kinds of information are on this shelf, what does each answer, and what
should the Lexicon and Catalog structurally hold?

---

## 1. What the plugin already gets right, and where it stops

`dictionary/entry-parts.ts` is further along than any other part of this
codebase. It already refuses the two obvious mistakes — one renderer per book
(drift) and one lowest-common-denominator "definition" (the 2,967-character
paragraph) — with two closed vocabularies:

- **`PART_KINDS`** (13): `pron pos level inflect sense context frame register
  gloss alt example note xref`. Answers *"what is this token"*.
- **`ENTRY_SHAPES`** (10): `section senses pos-group members derived comparison
  distinctions examples attestations image prose`. Answers *"what is the
  relation between these things"*.

Both are right. The gap is that **neither answers the question a production
lexicon actually asks: *what question does this information answer for a person
trying to say something?*** `context` and `frame` were split apart on exactly
that reasoning ("they ANSWER different questions") and then the reasoning stopped
after one pair. Carried through, it reorganizes the whole shelf.

The second gap is coverage. **11 of 35 books have a profile.** The other 24 fall
through to `GENERIC`, which recognizes only unambiguous brackets — correct as a
degrade, and expensive: measured below, that is where most of the shelf's
apparatus is currently sitting inside gloss strings.

---

## 2. Per-book: what survived conversion

Stored-field population, sampled 4 shards/book (≥2,500 entries where available):

| book | headwords | what it is | example | situation | register | nodes | shapes present |
|---|--:|---|--:|--:|--:|--:|---|
| 英辞郎 v144 | 2,360,787 | production EN→JA | 0% | 4.5% | 0% | 0% | — |
| JMnedict | 741,439 | names | 0% | 0 | 0 | 0% | — |
| 大辞泉 第二版 | 636,269 | 国語 | 26.7% | 0 | 0 | 9.6% | `members`(類語) |
| Jitendex | 424,715 | JA→EN | 0% | 0 | 0 | **67.6%** | `pos-group senses examples prose` |
| 大辞林 第四版 | 334,748 | 国語 | 21.4% | 0 | 0 | 0% | — |
| 研究社 新和英大 | 248,568 | JA→EN | 0% | 0 | 0 | 0% | — |
| 新英和大辞典 | 234,770 | EN→JA | 25.1% | **15.8%** | **20.5%** | 16.4% | `senses image` |
| Babylon JA-EN | 212,882 | JA→EN | 0% | 0 | 0 | 0% | — |
| 新選国語 第十版 | 118,326 | 国語 | 0% | 0 | 0 | 7.7% | `derived` |
| 旺文社漢字典 | 111,852 | 漢字 | 0% | 0 | 0 | 35.8% | `image`(1,623) |
| 明鏡国語 第三版 | 108,388 | 国語 | **83.4%** | 0 | 0 | 0% | — |
| 新明解 第八版 | 102,135 | 国語 | 0% | 0 | 0 | 5.6% | `derived` |
| プログレッシブ英和 | 97,439 | EN→JA | 0% | 0 | 0 | 11.1% | `examples` |
| 三省堂国語 第八版 | 93,086 | 国語 | 49.8% | 0 | 0 | 0% | — |
| WISDOM (en-ja/ja-en) | 92,527 | 双方向 + 使い分け | 0% | 0 | 0 | 5.8% | `derived senses examples` |
| 現代国語例解 第五版 | 86,213 | 国語 + 使い分け | 0% | 0 | 0 | 3.7% | `comparison derived` |
| NHK発音アクセント | 75,988 | **韻律** | 0% | 0 | 0 | 0% | — |
| 実用日本語表現辞典 | 55,378 | 現代語 | 0% | 0 | 0 | 0% | — |
| ライトハウス 第7版 | 51,290 | EN→JA | 6.6% | 0 | 0 | 27.7% | `examples members image` |
| NEW斎藤和英 | 47,501 | JA→EN | 0% | 0 | 0 | 0% | — |
| エースクラウン | 23,643 | EN→JA | 0% | 0 | 0 | 13.8% | `pos-group senses examples` |
| **用例.jp** | 20,931 | **corpus citations** | 0% | 0 | 0 | **99.6%** | `attestations`(264/265) |
| Oxford 類語 | 20,027 | thesaurus | 32.1% | 0 | 0 | 1.8% | `section comparison` |
| 新語時事用語辞典 | 18,294 | neologism | 0% | 0 | 0 | 0% | — |
| **類語例解辞典** | 17,350 | **使い分け** | 0% | 0 | 0 | **99.5%** | `section members distinctions comparison prose` |
| ことわざ・慣用句 | 7,135 | 慣用句 | 0% | 0 | 0 | 0% | — |
| ネット用語辞典 | 5,792 | slang | 0% | 0 | 0 | 0% | — |
| 四字熟語 | 5,451 | 四字熟語 | 0% | 0 | 0 | 0% | — |
| 語彙力・二字熟語 | 5,120 | 熟語 | 0% | 0 | 0 | 0% | — |
| 日本語俗語辞書 | 4,353 | slang | 0% | 0 | 0 | 0% | — |
| 擬音語・擬態語辞典 | 1,966 | **オノマトペ** | 0% | 0 | 0 | 0% | — |
| 絵でわかる慣用句 | 935 | 慣用句 + 絵 | 0% | 0 | 0 | 0% | — |
| Living Japanese Slang | 636 | slang | 0% | 0 | 0 | 0% | — |
| Onomatoproject | 266 | オノマトペ | 0% | 0 | 0 | 66.7% | `section prose distinctions` |

Four things stand out.

**`register` is populated in exactly one book (新英和, 20.5%).** Every other
book's 位相 marks — 〔俗〕, 《口語》, 話, 〘医〙 — are still inside gloss strings.
For a learner deciding whether to say a thing out loud, this is the single most
consequential field on the shelf, and 34 of 35 books do not have it.

**`situation` — the production condition, §27.1's whole thesis — exists in two
books (英辞郎 4.5%, 新英和 15.8%).** WISDOM's 〖…〗 is declared in its profile and
lands at 0%: the profile recognizes it at read time, but nothing was stored, so
anything reading the field sees nothing.

**用例.jp and 類語例解辞典 are structurally unlike everything else** — 99.6% and
99.5% of their entries are relation trees, and their `senses[]` are a flattened
shadow of the tree. They are not dictionaries that happen to have extra parts;
they are a corpus and a contrast-manual wearing dictionary clothes.

**NHK発音アクセント is misfiled at the type level.** 75,988 entries, `pos` 100%,
99.6% "multi-sense" — but those senses are `・［4］ムズカシ＼イ` / `・［4］ムズカし
＼カッタ`: a *pitch paradigm across inflected forms*. It is not a sense list at
all, and there is no `PART_KIND` for prosody.

---

## 3. What is buried inside gloss strings

The same sample, asking a different question: how often does a stored gloss
still *contain* a mark that a profile could lift out? Each column is the share of
entries whose gloss carries that mark.

| book | 「用例」 | ⇔対義 | 〔語誌〕 | 《位相》 | 〘文法〙 | 派生 | ラベル | ╳不可 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| 擬音語・擬態語辞典 | **100%** | 0 | 0 | 0 | 0 | 0 | 22% | 0 |
| ネット用語辞典 | **95%** | 0 | **100%** | 0 | 0 | 0 | 7% | 0 |
| 類語例解辞典 | 80% | 6% | 0 | 0 | 0 | **92%** | 5% | 0 |
| 現代国語例解 | **58%** | 6% | 8% | 1% | 15% | 4% | 1% | 1% |
| 日本語俗語辞書 | 55% | 0 | 0 | **100%** | 0 | 12% | 9% | 6% |
| 新明解 | **52%** | 5% | **38%** | 0 | 0 | 2% | 10% | 0 |
| 実用日本語表現辞典 | 40% | 0 | 0 | 0 | 0 | 1% | 9% | 1% |
| 新選国語 | 34% | 7% | 8% | 2% | 9% | 0 | 4% | 0 |
| 新語時事用語辞典 | 29% | 0 | 0 | 0 | 0 | 1% | 4% | 3% |
| 旺文社漢字典 | 27% | 5% | 14% | 0 | 10% | 1% | 6% | 0 |
| 大辞泉 | 16% | 1% | 23% | 2% | 6% | 1% | 1% | 0 |
| WISDOM | 9% | 4% | 27% | 0 | **51%** | **43%** | 4% | **4%** |
| ライトハウス | 3% | 2% | 3% | 0 | **35%** | 1% | 3% | 0 |
| 新英和 | 1% | 0 | **42%** | **20%** | 0 | 0 | 0 | 0 |
| 英辞郎 / Jitendex / JMnedict / NHK | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Read across the two tables: **擬音語・擬態語辞典 is 1,966 entries of onomatopoeia
where 100% of examples are unlifted** — that is the prototype 🟢 source, and
none of it is reachable as an example. **日本語俗語辞書 carries a register mark on
100% of entries** and the field is empty. **新明解 has 52% examples buried behind
a `quotedExample` heuristic that fires only on a trailing 「…」 run.**

Precise counts on the named labels (8 shards/book):

- **新明解 運用: 0.7%** (~700 entries at full scale). Small, and it is the only
  explicit *pragmatic-function* field on the shelf — see §5.
- **新明解 表記: 9.9%**, **かぞえ方: 4.7%** (counter words — nothing holds these).
- **現代国語例解 △ contrast notes: 10.0%** (~8,600 at scale).
- **WISDOM `(!…)` production notes: 19.1%** (~17,700), **〘…〙 frames: 30.9%**
  (~28,600), **╳ negative evidence: 3.1%** (~2,900).
- **三省堂 〘分野〙 labels: 17.0%**.
- **明鏡 語法/使い方 boxes: 0.1% — effectively absent.** Its examples lifted
  cleanly (83.4%, the best on the shelf) and the apparatus it is *famous for*
  did not survive conversion at all.

---

## 4. The typology: twelve questions, not thirty-five books

Every distinct thing on this shelf answers one of twelve questions. This is the
axis `PART_KINDS` is missing — it names tokens, and `ENTRY_SHAPES` names
relations, but neither says *what a reader wanted to know*.

| # | question | called, in the books | where it lives now |
|---|---|---|---|
| 1 | **What does it mean?** | 語釈 / gloss | `sense.gloss` — universal, solved |
| 2 | **How is it pronounced?** | 読み, アクセント, 발음 | `reading`; **pitch has no home** |
| 3 | **What shape does it take?** | 活用, 派生, 子見出し | `inflect`, `derived` |
| 4 | **What does it combine with?** | 文型, コロケーション, 〘…〙, V＋for＋名 | `frame` — 2 books |
| 5 | **When would I reach for it?** | 〔…〕, 〖…〗, sense headers 【困難な】 | `context` — 2 books |
| 6 | **Who says it, and where?** | 位相: 《諺》〔俗〕話 〘医〙 関西では | `register` — **1 book** |
| 7 | **How does it differ from its neighbours?** | 使い分け, 類語対比表, △, 使い方 | `distinctions`, `comparison` |
| 8 | **What can I NOT say?** | ╳…は不可, とは言わない | **nothing** |
| 9 | **What does it DO in a conversation?** | 運用, 婉曲に断わる | **nothing** |
| 10 | **Who else has said it?** | 用例, 出典『南回帰線』 | `attestations` — 1 book |
| 11 | **How common is it?** | 用例は1万件を超え…, priority tags | **nothing** |
| 12 | **What does it look like?** | 図版, 絵 | `image` — 3 books |

Six of the twelve have a home. **Three have none at all** — and those three are
the ones this plugin's whole thesis rests on.

### The three with no home

**#8, negative evidence.** WISDOM ships ~2,900 explicit prohibitions
(`╳It is difficult that she solves the problem. は不可`). 🔵 collocation is
*defined* by a negative test — "swap → ungrammatical" — and the only book that
states the negative directly is being read for its positives.

**#9, conversational function.** 新明解's 運用 for 難しい reads: 相手の依頼、申し出
などに対して「それはむずかしい」などの形で、婉曲に断わる言い方になることがある.
That is a 🔴 discourse claim, in a dictionary, about a word the learner will meet
as a refusal long before they meet it as "difficult". ~700 such notes exist and
the plugin has 2 gold examples and 1 component verdict of its own. The dictionary
knows more about discourse function today than the parser does.

**#11, frequency.** 現代国語例解 ships an actual corpus observation inside the
entry — 「難しい」の用例は1万件を超え… なかなか が最多 — a modifier-frequency
finding. Nothing reads it. This matters because *the entire ratification design
built this turn depends on knowing which forms are high-frequency*: 「ですね」 is
a distribution and 「〜道理はない」 is a noticing, and the plugin currently learns
that only by counting its own sweep output.

---

## 5. The second axis: evidential status

The typology above says what a piece of information *answers*. It says nothing
about *how much it should be believed*, and the plugin already has the beginning
of that: `stratumOf()` returns `'lived' | 'curated'` and files `dict`/`corpus`
as curated. That is right and too coarse — it puts all four of these in one
bucket:

| what it is | example | status |
|---|---|---|
| **attested** — someone really said/wrote it | 用例.jp: 『南回帰線(下)』, 『夜ごと死の匂いが』 | a record |
| **authored** — a lexicographer wrote it to illustrate | 研究社's ►, WISDOM's ▸, 大辞泉's 「説明が―・い」 | a claim about what is sayable |
| **judged** — the editors' verdict about contrast | 類語例解's 使い分け, 現代国語例解's △ | a claim about difference |
| **prohibited** — the editors' verdict about what fails | WISDOM's ╳ | a claim about ungrammaticality |

`TreeProfile.corpus` already exists as a per-book declaration for exactly the
first row and is set only for 用例.jp, with the right reasoning written down
("Guessing promoted authored examples to attestations, which misstates
provenance"). The machinery is half built. What is missing is that the same
declaration is not extended to the other three, so `judged` and `prohibited`
arrive as ordinary prose.

**This is the answer to "should a dictionary hit be an attestation."** No — and
the question dissolves once the four rows are distinguished:

- an **attested** citation from 用例.jp *is* an attestation, at the `curated`
  stratum, with a real `cite`. It belongs in the catalog exactly as a tweet does,
  and it should say 『南回帰線』 the way a tweet says @handle.
- an **authored** example is not an attestation and never becomes one. It is
  *scaffold* — and the plugin already has that concept
  (`payload.scaffold`, "auto-retire on the first real attestation"). Authored
  dictionary examples are the best possible scaffold and should populate it.
- a **judged** contrast is not evidence about occurrence at all. It is evidence
  about **class**: 「難しい」は…気軽に接しにくい意 is a sense boundary, and
  類語例解's 使い分け is a 🟢 halo description written by a professional.
- a **prohibited** form is the 🔵 test, pre-run.

---

## 6. What each class's test needs, and which book answers it

The six classes are defined by operational tests. Cross the tests against the
twelve questions and the shelf sorts itself:

| class | its test | question that answers it | the book that has it |
|---|---|---|---|
| 🟡 serifu | citation | #10 attested | **用例.jp** (20,931 × ~10 citations) |
| 🔵 collocation | swap → ungrammatical | #8 prohibited + #4 frame | **WISDOM** (╳ 3.1%, 〘…〙 30.9%) |
| 🟢 rhet-coll | lemma holds an image | #12 image + #7 judged | **擬音語・擬態語辞典**, 絵でわかる慣用句, 類語例解 |
| 💠 phrase-schema | said whole; slots open | #4 frame with slot | **類語例解** (columns written 「私には…むずかしい」 — the plugin's own slot notation), WISDOM 難しい～ |
| 🟠 skeletal | link survives rearrangement | #4 frame + #3 derivation | ライトハウス `V＋for＋名`, WISDOM 43% derivation |
| 🔴 discourse | responsivity | #9 conversational function | **新明解 運用** (~700) |

Each class has a book. **None of those six couplings is wired.** A 🟢 entry
cannot reach 擬音語・擬態語辞典's illustration of its own lemma; a 🔵 entry cannot
reach WISDOM's ╳; a 🔴 entry cannot reach 新明解's 運用.

That, and not "should a dict hit count", is the shape of the opportunity.

---

## 7. What the Lexicon and Catalog should structurally hold

Three additions, each a closed vocabulary, each per-book declarable data — the
same discipline `entry-parts.ts` already enforces.

**1. `answers: Question` on every part.** The twelve above, closed. It is what
lets the Lexicon show a 🔵 entry the *frames and prohibitions* from six books
and a 🔴 entry the *運用 notes*, instead of six differently-worded definitions
stacked up. `context` and `frame` already prove the principle; this generalizes
it and the two existing kinds fold into it as #5 and #4.

**2. `evidence: 'attested' | 'authored' | 'judged' | 'prohibited'` on every
example-shaped part.** Declared per book, never inferred — the rule
`TreeProfile.corpus` already states. This is what makes the answer to "is a
dictionary hit an attestation" mechanical rather than a matter of opinion.

**3. A `prosody` part kind and a `frequency` part kind.** NHK's 75,988 pitch
paradigms and 現代国語例解's corpus notes have nowhere to go, and both are
first-class for a speaker: pitch decides whether the reach-for is usable out
loud, and frequency decides whether an entry is a noticing or a distribution —
which is precisely the line `lexicon/context-tree.ts` draws by counting the
plugin's own sweep because nothing else was available.

Ranked by value ÷ effort:

| # | action | effort | why |
|---|---|---|---|
| 1 | Lift `register` for the 34 books that have it in prose | 1 day | the field that decides whether a phrase is sayable; currently 1 book of 35 |
| 2 | Profile 擬音語・擬態語辞典 + 絵でわかる慣用句 + Onomatoproject | ½ day | 100% of the 🟢 prototype's examples are buried; 3 small books |
| 3 | `evidence` on example parts; wire `attested` → attestation, `authored` → `payload.scaffold` | 1 day | closes the "is a dict hit an attestation" question mechanically |
| 4 | Read 新明解 運用 into 🔴 entries | ½ day | ~700 pragmatic-function notes vs the parser's 2 gold examples |
| 5 | Read WISDOM ╳ into 🔵 entries as the negative half of the swap test | 1 day | ~2,900 explicit prohibitions; nothing else on the shelf states a negative |
| 6 | `answers: Question` across `PART_KINDS` | 2 days | the reorganization the other items make obvious |
| 7 | `prosody` kind; read NHK | 1 day | 75,988 paradigms currently stored as fake senses |
| 8 | Re-convert 明鏡 with its 語法 boxes | unmeasured | the book's whole distinguishing apparatus is absent |

Items 1–5 are each ≤1 day and each unlocks a coupling that already has both ends
built.

---

## 8. One caveat, stated plainly

Everything in §2 and §3 is measured off the **converted sidecars**, which is what
the plugin can actually read. Where a book's apparatus is missing I can tell you
it is not in the shards; I cannot always tell you whether the *source export*
carried it and the converter dropped it, or whether the export never had it.
That distinction decides whether an item above is "write a profile" or
"re-convert", and 明鏡 (#8) is flagged unmeasured for exactly that reason. The
one case where the answer is known is 類語例解's 類語対比表: `entry-parts.ts`
records it as dropped at conversion, and the shards confirm — 59 comparison
tables survive in 197 sampled entries, so it is partial, not absent.
