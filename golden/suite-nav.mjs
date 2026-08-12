/**
 * golden/suite-nav.mjs — going TO and FROM.
 *
 * The property that matters is not "back works". It is that WANDERING DOES NOT
 * ACCUMULATE: 辞書 → 𝕏 → 辞書 must leave you one step from the editor, not
 * three. Without that rule `back` replays a wander instead of undoing it, and
 * a history no one can predict is a history no one presses.
 *
 * Run:  node golden/suite-nav.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const N = await import(pathToFileURL(join(HERE, '..', 'src', 'ui', 'suite-nav.ts')).href);

let n = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  n++;
  if (cond) console.log(`  ✓ ${name}`);
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};
const S = (s) => ({ kind: 'surface', surface: s });
const E = (path, line = 0, ch = 0, scroll = 0) => ({ kind: 'editor', path, line, ch, scroll });
const shape = (stack) => stack.map((p) => (p.kind === 'surface' ? p.surface : `📄${p.path}`)).join(' → ');

console.log('══ the stack is a stack, not a log ══');
{
  let s = [E('note.md', 12, 4)];
  s = N.goTo(s, S('dict'));
  ok(shape(s) === '📄note.md → dict', 'going somewhere pushes', shape(s));

  s = N.goTo(s, S('x'));
  s = N.goTo(s, S('dict'));
  ok(shape(s) === '📄note.md → dict', 'REVISITING truncates — a loop does not grow the stack', shape(s));

  s = N.goTo(s, S('tray'));
  s = N.goTo(s, E('note.md'));
  ok(shape(s) === '📄note.md', 'returning to the editor collapses the whole excursion', shape(s));

  ok(N.samePlace(E('a.md', 1, 1), E('a.md', 99, 99)),
    'editor identity is the FILE, not the cursor (or you could never return to it)');
  ok(!N.samePlace(E('a.md'), E('b.md')), 'different files are different places');
  ok(!N.samePlace(S('dict'), E('dict')), 'a surface is never an editor');
  ok(!N.samePlace(null, null), 'nothing is not somewhere');
}

console.log('\n══ re-entering the place you are on REFRESHES it ══');
{
  // The editor place has to be re-recorded on the way out or you return to a
  // stale cursor — the bug that makes "go back" feel like "go roughly back".
  let s = [E('note.md', 3, 0, 100)];
  s = N.goTo(s, E('note.md', 40, 7, 900));
  ok(s.length === 1 && s[0].line === 40 && s[0].scroll === 900,
    'the cursor is updated in place, not pushed as a second entry', shape(s));
}

console.log('\n══ toggle: one binding, both directions ══');
{
  const start = [E('note.md', 12, 4, 300)];
  const a = N.toggle(start, 'dict');
  ok(a.action === 'go' && a.to.surface === 'dict', 'pressing 辞書 from the editor goes to 辞書');

  const b = N.toggle(a.stack, 'dict');
  ok(b.action === 'back' && b.to.kind === 'editor' && b.to.path === 'note.md',
    'pressing 辞書 again comes straight back');
  ok(b.to.line === 12 && b.to.ch === 4 && b.to.scroll === 300,
    'and it restores the CURSOR, not just the file', JSON.stringify(b.to));
  ok(shape(b.stack) === '📄note.md', 'the round trip leaves no residue', shape(b.stack));

  // pressing a DIFFERENT surface while on one is a move, not a return
  const c = N.toggle(a.stack, 'x');
  ok(c.action === 'go' && shape(c.stack) === '📄note.md → dict → x', 'a different surface moves', shape(c.stack));
  const d = N.toggle(c.stack, 'x');
  ok(d.action === 'back' && d.to.surface === 'dict', 'and toggling it returns to the previous surface');

  // replaceHere: the live cursor at the moment of the press wins
  const e = N.toggle([E('note.md', 1, 1, 0)], 'dict', E('note.md', 88, 2, 4000));
  const f = N.toggle(e.stack, 'dict');
  ok(f.to.line === 88 && f.to.scroll === 4000,
    'replaceHere records where you ACTUALLY were when you pressed it', JSON.stringify(f.to));
}

console.log('\n══ the edges ══');
{
  const r = N.back([S('dict')]);
  ok(r.to === null && r.stack.length === 1, 'back from the bottom is a no-op, not a blank workspace');

  const t = N.toggle([S('dict')], 'dict');
  ok(t.to === null && t.action === 'back' && t.stack.length === 1,
    'toggling the only place off does NOT strand you');
  ok(N.here([]) === null, 'an empty stack has no here');
  ok(N.back([]).to === null, 'and back on it is safe');

  let big = [E('note.md')];
  for (let i = 0; i < 60; i++) big = N.goTo(big, E(`f${i}.md`));
  ok(big.length === N.STACK_CAP, `the stack is capped at ${N.STACK_CAP}`, `got ${big.length}`);
  ok(big[big.length - 1].path === 'f59.md', 'the cap drops the OLDEST, never the newest');
}

// The "shrunk up on mobile" bug: Obsidian's right sidebar is a resizable panel
// on desktop and a FIXED NARROW DRAWER on mobile, and five of six surfaces
// mounted there unconditionally. A 1366px iPad was rendering the dictionary in
// a phone-width column.
console.log('\n══ sidebar or full pane — the "shrunk up" fix ══');
{
  ok(N.presentation('desk', 1600) === 'side', 'a wide desktop keeps the resizable sidebar');
  ok(N.presentation('desk', 700) === 'full', 'a narrow desktop window does not — the sidebar would squeeze it');
  ok(N.presentation('slate', 1366) === 'full',
    'a LANDSCAPE iPad goes full pane — width is not the point, the drawer is');
  ok(N.presentation('slate', 820) === 'full', 'and in portrait, obviously');
  ok(N.presentation('thumb', 2000) === 'full', 'a phone is never a sidebar, whatever it claims to measure');
  ok(N.presentation('desk', N.SIDE_MIN_WIDTH) === 'side'
    && N.presentation('desk', N.SIDE_MIN_WIDTH - 1) === 'full', 'the threshold is inclusive and exact');
}

console.log('\n══ Elecom / Logitech thumb buttons ══');
{
  ok(N.mouseIntent(3) === 'back' && N.mouseIntent(4) === 'forward', 'the thumb pair maps to the stack');
  ok(N.mouseIntent(0) === null && N.mouseIntent(1) === null && N.mouseIntent(2) === null,
    'left / middle / right are left alone — the plugin does not steal an ordinary click');
  ok(N.mouseIntent(5) === null && N.mouseIntent(9) === null,
    'buttons above 4 report null: they never reach a webview, so they must be driver-mapped to a KEY');
}

console.log(`\n${fail ? '✗' : '✓'} suite-nav: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
