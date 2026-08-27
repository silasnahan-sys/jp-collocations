# FILM-LEDGER — the corpus of recordings, and what a frame citation means (2026-08-26)

The 2026-08-25 audit's standing complaint: analyses cite `1175 f0406–0413`
and no future session can check the claim — the films live on the user's
devices, the contact sheets die with each container, and the fps/offset
conventions were never written anywhere. This ledger fixes the checkable
half: the conventions, the corpus, and which citations are verifiable
against repo documents vs. recoverable only from chat transcripts.

**It does not contain the films.** They remain on the user's iPad / Drive.
Rule for future sessions: a frame citation from the CHAT-ONLY section is a
lead, not evidence — re-grid before building on it.

## 1. The conventions (how every citation was produced)

- All footage is 30 fps. `fNNNN` = the 30fps frame index; seconds =
  f / 30. `tSS.S` = seconds directly.
- Contact sheets: ffmpeg `fps=` + `tile=` filters with `drawtext` burning
  the OUTPUT frame counter into each tile. At `fps=1`, the burned number IS
  elapsed seconds. **Offset trap:** with `-ss START -i …` the counter
  restarts at 0 — the true frame is `burned + START×30`. Sessions that
  forgot this produced citations off by their window start.
- The `select=` filter does NOT trim when followed by `fps=` (the fps
  filter refills gaps) — windows must be cut with `trim=` or `-ss/-t`.
- What video cannot show, ever: Pencil hover vs. contact (no pointerdown on
  film), gaze, off-frame hands. ±33 ms floor before handheld shake and
  rolling shutter. Timings are ARRIVAL-TO-RESPONSE intervals.
- Sampling bias, named: windows were cut where stumbles were expected;
  frictionless stretches were never sampled, and no denominator was
  recorded. A film-derived "always/never" claim needs the 1fps full map,
  not the windows.

## 2. The corpus

### Verified by documents IN this repo

| film | content | where its reading lives |
|---|---|---|
| IMG_1212 (18s) | Apple Calendar, Day view, now-line 5:35 — the carry, cradle grip, resize | claude/CALENDAR-PHYSICS-2026-08-24.md |
| IMG_1213 (30s) | same session, 5:37 — long carry, stored-vs-candidate registers, edge address readout | same |
| IMG_1214 (54s) | same session, 5:38 — resize micro-commits, duplicate-mint, squeeze palette | same |
| (July session) | Monokakido §26 realization — screen properties, the two questions | DESIGN §26 |

### Cited by DESIGN §30 / the shipped repairs (films on user devices; readings in chat + artifacts)

| film | content | key cited moments |
|---|---|---|
| IMG_1175 (419s) | Monokakido, iPad on stand, landscape Split View beside the plugin tray; hand + Pencil visible | typing A(~133s); list tap B(12.4–14.8s); tap-land D(16.0–18.4s); 縦書き selection C(22–25.6s) and C2(70.6s, finger long-press on 大きい); word tap E(29.2s); menu-row F(105.4s, hand sweeps 170ms to read own menu); History row O(344.6s); neighbour chips G2(~389–392s: 病人→病毒→廟堂 — the PREV direction in gojūon, pinned in golden/dict-nav.mjs) |
| IMG_1184 (307s) | Monokakido, iPad held in left hand, portrait, dark room | finger scroll with palmed Pencil (f0900–0959, re-grip 170–370ms); dart grip M(43s); grain popover I(~86s); ≡ outline H(137.4s); unanswered pinch J(153.4s — now answered by dict pinch-in→outline); AssistiveTouch paste K(268.6s); cigarette grip L(274s) |
| IMG_1197 (~213s+) | THE PLUGIN on glass — source of the 答え合わせ six | まない→まる (34–36s / f01041–01076); three menus on one selection (f01542–01715); the 31s search refusal (120–151s); 「落としたものは別物でした」 (f06390); keyboard over results (~¼ of film) |
| IMG_1144 | the 願い system visibly working — "the one moment on film where the machine walks toward you" | chat (Aug 19 pass) |
| IMG_1159 | ⚠ CONFLICTING RECORDS: DESIGN §30 lists it among コマ送り's Calendar reels; the Aug-25 盤面 audit describes an Aug-19 Calendar hold-menu/resize reel. Probably the same Calendar footage; treat the label as unconfirmed until re-gridded | chat |
| IMG_1067 / IMG_1082 / IMG_1083 | the Aug-14 pass (1082 described as an X capture in one audit, as Calendar in §30's summary — ⚠ same caveat) | claude__video-pass-2026-08-14.md (project knowledge, NOT in repo) |
| IMG_1186 | 30fps sheets existed on a dead container's disk; content never written down | ⚠ unknown |
| IMG_1231 (317s) | THE CRITIQUE FILM: the plugin failing acts Monokakido then does quietly — plugin dark t0–148, Monokakido light t153–316 | four-layer menu stack (t31–38, t97–107); selection→sentence-search hijack (t26.8–31.3); standing Copy/Insert/Save panel on a quiet entry (t139); palette hunt (t126–136); echo on modal chrome (t146.5); Monokakido scope-menus (t168–202), 縦書き selection (t214–260) — reading in claude/GLASS-1231-2026-08-27.md, repairs pinned in reachability D9 |
| 07-15 Monokakido ScreenRecording (Drive) | the recording §26 was built FROM — named as the benchmark to grid before any nav build; still never gridded | PHYSICS-2026-08-19.md names the debt |

## 2.4 IMG_1184 re-gridded IN-CONTAINER (2026-08-27 — first checkable grid)

The user uploaded the compressed reel (378×672, 30fps, 306.9s) directly
into the session — the first film any container session has actually held.
Window list per §1's conventions: full 1fps map, 11 sheets of 5×6, burned
counter = seconds, no offset. Readings (now verifiable against this grid):

- **t60–89 / t120 / t200–204 — the selection menu, the film's most-used
  device.** Long-press/selection raises Monokakido's OWN vertical popover:
  Copy / Copy Paragraph / Copy Highlighted Text / Copy All / Add ___ to
  Bookmarks / Search Selection / Cancel — and the blank NAMES the pressed
  object: Idiom (t60), headword (t88), Meanings (t120, t200). The verbs
  carry their scope; the menu reads as sentences about THIS press.
- **t125–170 — the peek card.** Pressing a word raises a floating card
  OVER the page: summary + 「Show Full Entry」 + the 類語 category line +
  Find… + Share Context. The page never moves; descent is a choice on the
  card, not a consequence of the tap.
- **t130–175 — 縦書き related columns.** The 類語 panel renders related
  words as vertical columns (オイスターソース・醤油・香辛料…), pressed
  rows highlighted tan; the 噌 kanji card sits top-right.
- **t153–154 — the splay-pinch, unanswered** (matches the ledger's J).
- **t177–186 — the search bar carries mode chips**: Word | Example tabs
  and an Ends match-mode chip; results live per keystroke over the flick
  keyboard's candidate row.
- **t190–199 — the Pencil parks on example lines while reading** (the
  0.47–1.33s parks; invariant 18's evidence, re-confirmed on this grid).
- **t173–176 — descend into 調味料 from the 類語 line, then back to a
  fresh search** — the walk is search → entry → peek → descend → back.

## 2.5 Container access to the films (measured 2026-08-27)

The 2026-08-27 session ATTEMPTED the pull and hit a wall worth recording:
the remote container's egress proxy denies every Drive host
(`drive.google.com`, `drive.usercontent.google.com` — CONNECT 403), and
the Drive connector's download call dies on video-sized binaries. The
07-15 recording is link-shared and STILL unreachable from a container, so
its frame grid remains debt. The route that would work: attach the films
(or their 1fps contact sheets) to a GitHub release on this repo —
github.com is reachable from every session. Until one exists, a container
session's ground truth is: `_ref_monokakido/` (six stills, committed),
DESIGN §26.1/§30, CALENDAR-PHYSICS, and this ledger.

## 2.6 IMG_1231 window list (2026-08-27 — gridded on the user's machine)

Source file, checkable: `C:/Users/silas/OneDrive/Desktop/thevids/IMG_1231.MOV`
(a byte-identical copy sits at `C:/Users/silas/OneDrive/IMG_1231.MOV`).
1920×1080, 29.97fps, 317.39s, 9514 frames. This machine has the films —
the thevids folder also holds 1067, 1082(+trim), 1083(+trim), 1144, 1159,
and two ScreenRecordings (08-08, 08-19) — so the ⚠ rows above are now
re-griddable without any upload route.

| window | span | fps | what it holds |
|---|---|---|---|
| map | 0–317 | 1 | full storyline, 11 sheets 6×5, burned counter = seconds |
| w1 | 24–42 | 6 | selection round 1: はまも cut → 4-layer stack → native bar → Save |
| w2 | 68–92 | 6 | native return; plane word-tap → reverse list → 滑空する save |
| w3 | 94–116 | 6 | ガッツリ wrestle: native ×3, keyboard pop-ins t111.5/t113.3 |
| w4 | 118–150 | 2 | tray, palette hunt, tab-tree crawl, Podcast modal echo |
| w5 | 158–188 | 4 | Monokakido: selection → ONE scope-naming menu → Cancel = instant return |
| w6 | 208–232 | 4 | Monokakido: 縦書き tan-band selection, MEIKYO switch |
| stills | 31.3 / 33.5 / 139 / 146.5 | — | full-res: the stack, the hijacked page, the standing panel, the chrome echo |

Offset convention as §1: burned n in window wN → t = START + n/fps.

## 3. What the standing acceptance test still needs

1. **The side-by-side walk** (PHYSICS §6): the same lookup walk filmed in
   Monokakido and in the plugin, cut together. Everything §30.1/§30.2 built
   to the films' numbers — the flick gate (0.45px/ms), the hold beat, the
   chip reach, the 宛名札, the 現在線 — is unfilmed being used.
2. **pen-probe** (command palette → pen-probe): settles hover-vs-contact
   and the real dragCommit feel in thirty seconds, on glass, no camera.
3. When any film above is re-analyzed: write the window list (film, start,
   end, fps, crop) into THIS file in the same table format, so the next
   citation is checkable.
