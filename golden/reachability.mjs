/**
 * golden/reachability.mjs — a verb that exists is not a verb you can reach.
 *
 * ## Why this suite exists, and why it is different from all the others
 *
 * Every other golden in this repo asks whether a mechanism is CORRECT.
 * `suite-nav.mjs` proves the back-stack algebra: wandering does not accumulate,
 * 辞書 → 𝕏 → 辞書 leaves you one step from the editor. It has been green since
 * the day it was written.
 *
 * It was green for the entire period during which navigation did not work on
 * the user's primary device.
 *
 * `input-map.ts` listened to `wheel`. An iPad has no wheel. So every nav verb
 * existed, was pure, was tested, and was reachable only through a button on a
 * floating rail the user does not use — 「sometimes u literally just get
 * STUCK」. The suite could not see it, because the suite tested the algebra and
 * the defect was in the APERTURE.
 *
 * That is the shape of nearly every complaint this project has ever received:
 *
 *   `Platform.isPhone` gating every mobile ergonomic  → false on iPad
 *   44px tap targets under `@media (max-width: 600px)` → never matches a pane
 *   18 width media queries reading the WINDOW           → never the pane
 *   `user-select: none` inherited from the app shell    → selection disarmed
 *   `MarkRef` with no `lineText`                        → 98 cards read 「（メモなし）」
 *   the destinations living on a floating rail          → never pressed
 *   74 commands, zero default hotkeys                   → on a Magic Keyboard rig
 *
 * Not one of those is a wrong answer. Every one is a right answer nobody could
 * get to. Ten of them were found by the user, on camera, holding a phone over
 * an iPad — because a golden that tests mechanisms cannot fail on an aperture.
 *
 * So this suite tests the aperture. Its question is never "does the verb work",
 * it is **"from where the user actually is, is there a gesture that reaches
 * it"** — which is the executable form of the one sentence the brief keeps
 * returning to: *never make a wrong selection or tap*.
 *
 * ## It is a RATCHET, not a rubber stamp
 *
 * Run today, the honest answer to several of its questions is "no". A suite
 * that simply goes red is a suite someone disables in a week, and it would take
 * the other 85 down with it. A suite that quietly passes is a lie.
 *
 * So: every known hole is written into `LEDGER` below, dated, with what it
 * costs. The suite fails on any violation that is NOT in the ledger — that is
 * the ratchet, and it is what stops the next aperture bug needing a camera to
 * find. And it fails on any ledger entry that is no longer a real violation, so
 * a fixed hole cannot sit in the allow-list pretending to be permission. The
 * debt is printed as a number, and the number may only go down.
 *
 * Run:  node golden/reachability.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const read = (...p) => readFileSync(join(SRC, ...p), 'utf8');

// suite-nav.ts imports nothing but types, so it loads with no stub and no flags.
const NAV = await import(pathToFileURL(join(SRC, 'ui', 'suite-nav.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('\nreachability — can the hand get to the verb\n');

// ── the ledger ────────────────────────────────────────────────────────────────
/**
 * Known holes, 2026-08-10. Each key is `<block>:<subject>`.
 *
 * Adding a line here is a deliberate act that says "this is broken, we know,
 * and it is not this change's job". Removing one is the fix landing. Nothing
 * else may be added without the same sentence being true.
 */
const LEDGER = {
  // Block A — the back-stack cannot record a place it has no name for, and
  // `main.ts:1075` makes the thumb-mouse button return early on these views.
  'A:JP_FOLLOW_VIEW_TYPE': '鑑賞モード is not in SURFACE_BY_VIEW_TYPE: leaving it records nothing, so back cannot return to it',
  'A:JP_RECON_LIBRARY_VIEW_TYPE': '照合 is not in SURFACE_BY_VIEW_TYPE: same, plus mouse button 3 declines it',
  'A:JP_DISCOURSE_MODE_VIEW_TYPE': '談話 is not in SURFACE_BY_VIEW_TYPE: same',
  // Block B — a room with no door. This is the FollowAlongView bug of 08-08,
  // which was fixed on FollowAlongView alone and never swept across the class.
  // `review` and `capture` are the sharp ones: the surface bar ADVERTISES them
  // as destinations, so the navigator points at two rooms with no way out.
  'B:ReviewView': '復習 is a bar destination with no surface bar and no edge-back',
  'B:PipelineView': '⚡取り込み is a bar destination with no surface bar and no edge-back',
  'B:LibraryView': '照合 has no exit affordance of any kind',
  'B:DiscourseModeView': '談話 has no exit affordance of any kind',
  // Block D — suite-nav.ts:145-155 states the mice ride the hotkey layer,
  // because buttons above 4 never reach a webview and must be driver-mapped to
  // a keystroke. Zero default hotkeys means that layer is a plan, not a road.
  // 'D:default-hotkeys' (any hotkey at all) was closed 2026-08-19 by the hold
  // commands — and its deletion let the debt print 7 while the mice still
  // reached no destination, because the assertion was loose enough to satisfy
  // from a side door. Restored 2026-08-20 in the narrowed, true form:
  'D:surface-hotkeys': 'no SURFACE_COMMAND ships a default hotkey — the mice can grab and toss but still cannot GO anywhere',
};
const used = new Set();
/** True when the violation is already on the books; marks the entry live. */
const known = (key) => { if (key in LEDGER) { used.add(key); return true; } return false; };
/** A check that is allowed to be red today, but only from the ledger. */
const ratchet = (key, name, ok) => {
  if (ok) { check(name, true); return; }
  if (known(key)) { console.log(`  · ${name} — KNOWN: ${LEDGER[key]}`); return; }
  check(name, false, 'new reachability hole; fix it, or add it to LEDGER with a reason');
};

// ── the ground truth, read out of main.ts ─────────────────────────────────────
const main = read('main.ts');

/** Every view the plugin registers, with the class that backs it. */
const REGISTERED = [...main.matchAll(/registerView\(\s*([A-Z_0-9]+)\s*,[\s\S]{0,160}?new\s+([A-Za-z]+View)\b/g)]
  .map((m) => ({ type: m[1], cls: m[2] }));

/** The inverse map — the only view types the suite navigator can name. */
const MAPPED = new Set(
  [...(main.match(/const SURFACE_BY_VIEW_TYPE[^}]*}/) ?? [''])[0]
    .matchAll(/\[\s*([A-Z_0-9]+)\s*\]\s*:/g)].map((m) => m[1]),
);

check('main.ts registers the nine views this suite knows about', REGISTERED.length === 9,
  `found ${REGISTERED.length}: ${REGISTERED.map((r) => r.cls).join(', ')}`);
check('SURFACE_BY_VIEW_TYPE names six', MAPPED.size === 6, `found ${MAPPED.size}`);

// ── A. the navigator's map is TOTAL over what the plugin registers ────────────
//
// A view the map does not name is a place `currentPlace()` returns null for
// (main.ts:3163), so stepping away from it records nothing and `back` can never
// bring you home to it. It is also the test `main.ts:1075` uses to decide
// whether the mouse's back button is ours, so on an unmapped view the thumb
// button silently does nothing at all. One missing key, two dead verbs.
console.log('\n A. every registered view is a place the navigator can name');
for (const { type, cls } of REGISTERED) {
  ratchet(`A:${type}`, `${cls} (${type}) is nameable`, MAPPED.has(type));
}

// ── B. no room without a door ─────────────────────────────────────────────────
//
// The exit is `mountSurfaceBar` (which mounts the bar, the dismiss button and
// the edge-back together) or, for a view that builds its own chrome,
// `armEdgeBack` directly. A view with neither can be entered and not left,
// except through Obsidian's own tab drawer — which is two-handed, at the top of
// the screen, and on a phone is not on screen at all.
//
// This is the check that would have made FollowAlongView's 08-08 defect
// impossible to ship. It is in the ledger four more times because that fix was
// applied to the one view it was reported on and never swept across the class.
console.log('\n B. every surface has a way out');
const EXIT = /mountSurfaceBar\s*\(|armEdgeBack\s*\(/;
for (const { cls } of REGISTERED) {
  ratchet(`B:${cls}`, `${cls} mounts an exit`, EXIT.test(read('ui', `${cls}.ts`)));
}

// The sharpest form of it: a destination the bar POINTS AT must have a bar.
// Arriving somewhere the navigator advertised and finding no navigator is worse
// than the destination not being offered — it is the one case where the
// plugin's own chrome creates the trap.
console.log('\n B2. a destination the bar advertises is a destination that can be left');
const CLS_FOR_SURFACE = { lexicon: 'CollocationView', dict: 'DictionaryView', x: 'XSearchView', tray: 'TrayView', review: 'ReviewView', capture: 'PipelineView' };
const barItems = [...read('ui', 'surface-bar.ts').matchAll(/\{\s*id:\s*'(\w+)'/g)].map((m) => m[1]);
check('the bar offers exactly the six surfaces', barItems.length === 6, barItems.join(','));
for (const s of barItems) {
  const cls = CLS_FOR_SURFACE[s];
  ratchet(`B:${cls}`, `bar destination '${s}' can be left`, cls ? EXIT.test(read('ui', `${cls}.ts`)) : false);
}

// ── C. the posture × verb matrix ──────────────────────────────────────────────
//
// The channels, each with the line that gates it. This table is the thing the
// project has never written down: not what the verbs are, but which HAND can
// reach each one. A verb with no row in a posture is a verb that does not exist
// on that device, however well it is tested.
const CHANNELS = [
  // id            back  goto   desk   thumb  slate  gate
  ['surface-bar',  false, true,  true,  true,  true,  'view-chrome.ts mountSurfaceBar — docks resolve to the header on desk'],
  ['dismiss-btn',  true,  false, false, true,  true,  'view-chrome.ts mountDismiss — `if (!isTouchy()) return`'],
  ['edge-drag',    true,  false, false, true,  true,  'touch-nav.ts attachEdgeBack — pointer/touch, left edge'],
  ['mouse-btn-3',  true,  false, true,  false, false, 'main.ts:1073 mousedown + suite-nav.ts MOUSE_BACK'],
  ['wheel-pan',    false, true,  true,  false, false, 'input-map.ts feedWheel — a tablet has no wheel'],
  ['bar-toggle',   true,  true,  true,  true,  true,  'suite-nav.ts toggle() — pressing the surface you are on goes back'],
];
const POSTURES = ['desk', 'thumb', 'slate'];
const col = { desk: 3, thumb: 4, slate: 5 };
const reaches = (verb, p) => CHANNELS.filter((c) => c[verb === 'back' ? 1 : 2] && c[col[p]]);

console.log('\n C. every verb has a hand that reaches it, in every posture');
for (const p of POSTURES) {
  for (const verb of ['back', 'goto']) {
    const ch = reaches(verb, p);
    check(`${p}: '${verb}' has a channel`, ch.length > 0, 'no gesture reaches this verb in this posture');
    // Redundancy is not a luxury here. `mouse-btn-3` needs a five-button mouse;
    // `edge-drag` needs the pointer to start in the edge zone. A posture whose
    // only road to `back` is one conditional gesture is one bad assumption from
    // being STUCK again, which is how this project got here.
    if (ch.length === 1) console.log(`    ⚠ single channel for '${verb}' on ${p}: ${ch[0][0]} (${ch[0][6]})`);
  }
}

// The toggle IS the exit, and that is the property that lets B2 be satisfied by
// a bar alone. If this ever stops holding, every "the bar is the way out"
// argument in the codebase becomes false at once.
console.log('\n C2. pressing the surface you are on is the way back');
{
  const from = { kind: 'editor', path: 'note.md' };
  const s1 = NAV.goTo([from], { kind: 'surface', surface: 'dict' });
  const t = NAV.toggle(s1, 'dict');
  check('toggle on the current surface goes back', t.action === 'back');
  check('and lands on the editor you summoned it from', t.to?.kind === 'editor' && t.to.path === 'note.md');
  const t2 = NAV.toggle([{ kind: 'surface', surface: 'dict' }], 'dict');
  check('with nowhere behind it stays put rather than blanking', t2.to === null);
}

// Presentation is a reachability fact too: five surfaces used to open in the
// mobile right sidebar, which is a fixed-width drawer that covers the editor.
console.log('\n C3. a touch posture never mounts a surface in the drawer');
for (const p of POSTURES) {
  const wide = NAV.presentation(p, 1400);
  check(`${p} at 1400px → ${wide}`, p === 'desk' ? wide === 'side' : wide === 'full');
}
check('a narrow desk window goes full too', NAV.presentation('desk', 700) === 'full');

// ── D. the substrate the mice ride ────────────────────────────────────────────
//
// suite-nav.ts:145-155 is explicit: buttons above 4 never reach a webview, so
// an Elecom or Logi side button has to be mapped to a KEYSTROKE in the vendor
// driver, and the keystroke lands on an Obsidian command. That makes the hotkey
// layer the substrate for the mice, the Magic Keyboard, and the touchpad alike
// — one road, three vehicles. It is currently a road with no surface.
console.log('\n D. the hotkey layer the mice, the keyboard and the touchpad all ride');
const commands = (main.match(/addCommand\(/g) ?? []).length;
const withHotkey = [...main.matchAll(/hotkeys\s*:\s*\[([^\]]*)\]/g)].filter((m) => m[1].trim().length > 0).length;
check('every surface has a command a keystroke can land on', /SURFACE_COMMANDS/.test(main) && /SURFACE_COMMANDS\.(forEach|map)|for \(const .* of SURFACE_COMMANDS/.test(main),
  'SURFACE_COMMANDS exists but nothing registers it');
// The first form of this ratchet was `withHotkey > 0`, and on 2026-08-19 two
// hotkeys on two brand-new hold commands flipped it green while no
// SURFACE_COMMAND had a default — the mice still reached no DESTINATION, but
// the ledger line was deleted per block E and the debt printed one lower with
// nothing closed. An assertion loose enough to be satisfied by a side door is
// how an unfixed hole leaves the allow-list pretending to be fixed
// (2026-08-20 review). The assertion is now the claim that matters: the
// surface-navigation commands themselves carry defaults.
check(`some command carries a default hotkey (currently ${withHotkey}/${commands})`, withHotkey > 0);
const surfaceCmdBlock = main.match(/SURFACE_COMMANDS[\s\S]{0,2400}/)?.[0] ?? '';
const surfaceHotkeys = [...surfaceCmdBlock.matchAll(/hotkeys\s*:\s*\[([^\]]*)\]/g)].filter((m) => m[1].trim().length > 0).length;
ratchet('D:surface-hotkeys', 'every surface-navigation command ships a default hotkey', surfaceHotkeys > 0);
console.log(`    commands: ${commands}   with a default hotkey: ${withHotkey}   on surface commands: ${surfaceHotkeys}`);

// ── D2. arming is not assignment ─────────────────────────────────────────────
//
// The dead-戻る lesson (fixed 2026-08-19, guard added 2026-08-20): armEdgeBack
// RETURNS EARLY unless chrome.dismiss AND chrome.backPeek are assigned, and the
// rendered 閉じて戻る button runs `chrome.dismiss?.()` — an optional-call that
// swallows absence. So a suite that only asks "was the arming function called"
// certifies a door that does not open. These checks ask the sharper question:
// does each chrome BUILDER actually assign the pair.
console.log('\n D2. every chrome builder assigns the dismiss/backPeek pair');
{
  // The window bounds the FUNCTION, not a guess at its size — it broke once
  // (2026-08-26) when three added lines pushed `return v;` past a 1200-char
  // cap and both checks silently tested an empty string.
  const catalogHits = main.match(/withCatalogHits[\s\S]{0,4000}?return v;/)?.[0] ?? '';
  check('withCatalogHits (辞書) assigns dismiss', /v\.dismiss\s*=/.test(catalogHits));
  check('withCatalogHits (辞書) gets backPeek (peekChrome)', /peekChrome\(\)/.test(catalogHits));
  const withChrome = main.match(/private withChrome[\s\S]{0,1200}?return v;/)?.[0] ?? '';
  check('withChrome (語彙) assigns dismiss', /dismiss\s*:/.test(withChrome));
  check('withChrome (語彙) assigns the drop road (echo can arm)', /onDrop\s*:/.test(withChrome));
}

// ── D3. the selection layer is armed where the goldens say it is ────────────
//
// Move 0's echo fixes shipped with zero aperture checks (the review's gradient
// finding: 24 checks on pure functions, 0 on the three aperture bugs). This is
// the missing third: the surfaces that must answer a selection actually call
// the arming function in their own source.
console.log('\n D3. armSelectionEcho present on every answering surface');
for (const [file, label] of [
  ['ui/XSearchView.ts', 'x'], ['ui/CollocationView.ts', 'lexicon'],
  ['ui/DictionaryView.ts', 'dict'], ['ui/TrayView.ts', 'tray'], ['ui/FollowAlongView.ts', 'follow'],
]) {
  check(`${label} arms the echo`, /armSelectionEcho\(/.test(read(...file.split('/'))));
}

// ── D4. the 辞書 nav grammar ships with its apertures open ──────────────────
//
// §30's nav build (neighbour chips, flick, pinch→outline, dated history,
// in-screen find, arrival light). Same discipline as D2/D3: not "does the
// pure model pass" (golden/dict-nav.mjs answers that) but "is each gesture
// armed in source, does each have its command twin, and does the light reach
// BOTH render halves" — the sidecar half answers asynchronously, and an
// arrival light wired only to the sync half misses exactly the words that
// come from the big dictionaries.
console.log('\n D4. the 辞書 nav grammar: armed, twinned, and lit on both halves');
{
  const dict = read('ui', 'DictionaryView.ts');
  check('the page RIDES THE FINGER (pan armed, not a release-time flick)',
    /this\.armEntryPan\(/.test(dict) && /panVerdict\(/.test(dict));
  // Without pan-y the vertical scroller eats every horizontal touch and the
  // whole page-turn is structurally unfeelable — the exact "not really felt"
  // report of 2026-08-26. The style is the aperture.
  check('touch-action: pan-y hands horizontal touch to the pan',
    /jp-dict-results \{[^}]*touch-action: pan-y/s.test(readFileSync(join(HERE, '..', 'styles.css'), 'utf8')));
  check('descend is a horizontal PUSH, not a vertical fade',
    /jp-dict-descend \{[\s\S]{0,200}?translateX/.test(readFileSync(join(HERE, '..', 'styles.css'), 'utf8')));
  check('neighbours arm THROUGH inflection (deinflect fallback)',
    /currentNeighbors\(/.test(dict) && /lookup\(q\)\[0\]/.test(dict));
  check('the pinch→outline reflex is armed', /this\.armPinchOutline\(/.test(dict));
  const afterCalls = (dict.match(/this\.afterRender\(\)/g) ?? []).length;
  check('afterRender covers live + committed + sidecar renders',
    afterCalls >= 3, `${afterCalls} call sites, need 3`);
  check('history rows persist through a store, not a session array',
    /historyStore/.test(dict) && /\.record\(/.test(dict));
  for (const id of ['dict-neighbor-next', 'dict-neighbor-prev', 'dict-history', 'dict-outline', 'dict-find']) {
    check(`command twin '${id}' is registered`, new RegExp(`id: "${id}"`).test(main));
  }
  check('withCatalogHits wires the dated history', /v\.historyStore\s*=/.test(main));
  // コマ送り item 5: re-filter has NO motion. The old always-on stagger
  // animated every keystroke's re-render; it must stay dead.
  const css = readFileSync(join(HERE, '..', 'styles.css'), 'utf8');
  check('no unconditional animation on .jp-dict-card (re-filter must not move)',
    !/\.jp-dict-card\s*\{[^}]*animation\s*:/s.test(css));
  // The two-languages lesson (IMG_1197): a search grammar nobody is taught
  // is a refusal waiting to be filmed. The box teaches its own modes.
  check('the search box teaches the tilde grammar in place',
    /後方一致/.test(dict) && /searchNotation/.test(dict));
  // Items 12–13: the echo carries 台帳 state on every armed surface.
  const echo = read('ui', 'selection-echo.ts');
  check('the echo says もう台帳にある and opens the entry',
    /もう台帳にある/.test(echo) && /openPattern/.test(echo));
  check('peekChrome wires the state once for every surface',
    /patternsIn: \(text\) => this\.patternsIn\(text\)/.test(main));

  // ── 2026-08-27: the user's correction — the walk is not horizontal-only ──
  // The previous build recorded at-end vertical continuation as a refusal and
  // shipped back as a button; these pins hold the corrected grammar open.
  check('the VERTICAL walk is armed (at-end tug pulls the neighbour in)',
    /this\.armVerticalWalk\(/.test(dict) && /jp-dict-vpeek/.test(dict));
  check('the next entry visibly begins at the end of this one (つづく)',
    /this\.renderContinue\(\)/.test(dict) && /jp-dict-continue/.test(dict));
  check('the trail has BOTH directions (forward exists, not only back)',
    /goForward\(\)/.test(dict) && /trailPeekForward/.test(dict));
  check('the edge drags ride the PAGE, not only a label tab',
    /page\?\.\(\)|deps\.page\?\.\(\)/.test(read('ui', 'touch-nav.ts'))
    && /pageEl/.test(read('ui', 'view-chrome.ts')));
  check('the right edge arms forward through view-chrome',
    /attachEdgeForward\(/.test(read('ui', 'view-chrome.ts')));
  check('辞書 chrome walks its own trail before exiting the view',
    /if \(!v\.goBack\(\)\) void this\.navBack\(\)/.test(main));
  check('quick nav: holding a chip riffles (both chips armed)',
    (dict.match(/this\.armRiffle\(/g) ?? []).length >= 2);
  check('the selection itself is carryable (echo grip armed)',
    /jp-echo-grip/.test(echo) && /makeDraggable\(grip/.test(echo));
  for (const id of ['dict-back', 'dict-forward', 'x-back', 'x-forward']) {
    check(`command twin '${id}' is registered`, new RegExp(`id: "${id}"`).test(main));
  }
  // …and the grammar is ONE grammar: the 𝕏 pane walks the same way.
  const xview = read('ui', 'XSearchView.ts');
  check('𝕏 doors ride the trail and land lit',
    /this\.goTo\(rung\.span/.test(xview) && /jp-x-arrive-band/.test(xview));
  check('𝕏 chrome walks its own trail before exiting the view',
    /this\.activeXView\(\)\?\.goBack\(\)/.test(main));
  check('a silent probe files a standing 問い in one gesture (rung 6)',
    /fileStanding/.test(xview) && /fileStanding:/.test(main));

  // ── 2026-08-27 evening: the IMG_1184 re-grid, built to the frames ──
  // The film was finally IN a container (FILM-LEDGER §2.4); these pin the
  // four behaviors it showed that no earlier build had.
  check('a word tap PEEKS over the page; descent is a choice on the card',
    /openPeekCard\(part/.test(dict) && /全文を表示/.test(dict));
  check('the peek card closes from every path (instance-owned away listener)',
    /closePeekCard\(\)/.test(dict) && /peekAway/.test(dict));
  check('the echo echoes the GRAB first, enlarged (f18/f32)',
    /jp-echo-grab/.test(echo));
  check('on glass the echo verbs read as a menu naming their object',
    /jp-echo--menu/.test(echo) && /jp-echo-obj/.test(echo) && /snipOf/.test(echo));
  check('the sentence is a copyable object of its own (文をコピー)',
    /文をコピー/.test(echo));
  check('the walk ghost drifts out in the direction the page went (f40)',
    /jp-dict-walkghost/.test(dict));
  check('the 縦書き related column exists and PEEKS, never jumps',
    /jp-dict-vrel/.test(dict) && /renderVrel/.test(dict));
  check('the search scopes are worn on the bar (すべて/見出し/本文)',
    /jp-dict-scope/.test(dict) && /searchScope/.test(dict));
  check('本文 scope never silently widens back through the sidecars',
    /searchScope !== 'body'\) void this\.appendBigResults/.test(dict));
  // §29 rungs 2+4, on screen — the specificity the fixtures demand.
  check('rung 2: environments render as GROUPS that are doors',
    /environmentGroups\(/.test(xview) && /jp-x-env\b/.test(readFileSync(join(HERE, '..', 'styles.css'), 'utf8')));
  check('rung 2: label-ness rendered as a positional fact',
    /labelNess\(/.test(xview) && /行頭\/タグ位置/.test(xview));
  check('rung 4: the slot table renders with typed fillers as doors',
    /renderSlotTable\(/.test(xview) && /slotTable\(/.test(xview));
  check('rung 4: impostors are excluded BY NAME, 灰 juxtaposed',
    /除外/.test(xview) && /判定保留・提示のみ/.test(xview));
}

// ── D5. the carried thing is always addressed (宛名札, §2.2) ────────────────
//
// The address must be WIRED at all three stations, or a carry goes back to
// being "somewhere": the pill renders it, the router answers it from the
// same rack drop() reads, and the hold chip names its toss.
console.log('\n D5. 宛名札 — pill renders, router answers, toss is named');
{
  const pdrag = read('ui', 'pointer-drag.ts');
  check('the carry renders the address chip', /jp-atena/.test(pdrag) && /setAtena\(/.test(pdrag));
  check('the address updates at the hit-test beat', /zone\?\.address\?\.\(/.test(pdrag));
  const router = read('ui', 'drop-router.ts');
  check('the router answers address() from the SAME rack as drop()', /address: \(x, y\)/.test(router) && /atenaFor\(/.test(router));
  const dock = read('ui', 'hold-dock.ts');
  check('the hold toss names its landing', /収集トレイ/.test(dock) && /jp-atena--hold/.test(dock));
}

// ── the ledger must not rot ───────────────────────────────────────────────────
//
// An allow-list nobody prunes becomes permission. Every entry above is asserted
// to still describe a real violation; the moment one is fixed, this fails until
// the line is deleted — so the debt count cannot drift away from the truth.
console.log('\n E. the ledger still describes reality');
for (const key of Object.keys(LEDGER)) {
  check(`ledger entry '${key}' is still a real hole`, used.has(key),
    'this is FIXED — delete the line from LEDGER (the debt just went down)');
}

const debt = Object.keys(LEDGER).length;
console.log(`\n  reachability debt: ${debt} known holes. This number may only go down.`);
console.log(`\n${fail ? '✗' : '✓'} reachability — ${pass} passed, ${fail} failed, ${debt} on the ledger\n`);
process.exit(fail ? 1 : 0);
