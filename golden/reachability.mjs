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
  // 'D:default-hotkeys' DELETED 2026-08-19: the hold commands (hold-selection,
  // hold-toss-newest) ship the plugin's first default hotkeys — the ratchet's
  // own rule: a fixed hole may not sit in the allow-list pretending to be
  // permission. The wider substrate (a default on every surface command) is
  // Move 1½ work, tracked there, not here.
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
ratchet('D:default-hotkeys', `at least one default hotkey among ${commands} commands`, withHotkey > 0);
console.log(`    commands: ${commands}   with a default hotkey: ${withHotkey}`);

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
