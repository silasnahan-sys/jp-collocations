/**
 * golden/pane-size.mjs — layout answers the pane, not the window.
 *
 * `styles.css` has known the rule since line 6940 — "a width query describes
 * the WINDOW; the thing that actually needs sizing is a pane" — and carried
 * eighteen width media queries anyway, six at `max-width: 600px`, while
 * `posture()` branched on `window.innerWidth >= 700`.
 *
 * MEASURED 2026-08-08, two camera recordings: the plugin is essentially never
 * run at window width. Floating window over Manatan, split column beside Apple
 * Notes, Slide Over strip, or a leaf in a window that has a sidebar open. In
 * each the window number and the pane number disagree, and by different
 * amounts — so the same pane produced different layouts and different panes
 * produced the same one. That is why placement felt arbitrary.
 *
 * The load-bearing breakpoint is `xs` at 380px, and it is chosen by what fits:
 * five 44px destinations plus gaps is ~230px, so with captions off they all
 * stay on screen even in a 320px Slide Over strip. Above it there is room for
 * captions and a labelled button is the better target.
 *
 * Run:  node golden/pane-size.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const P = await import(pathToFileURL(join(HERE, '..', 'src', 'ui', 'pane-size.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('\npane-size — the box the content is actually in\n');

// ── the real panes off the recordings ─────────────────────────────────────
check('a 320px Slide Over strip is xs', P.paneSize(320) === 'xs');
check('the ~390px floating window over Manatan is xs', P.paneSize(390) === 'xs');
check('a 500px split column is sm', P.paneSize(500) === 'sm');
check('half a 1024pt iPad is md', P.paneSize(700) === 'md');
check('a maximised desktop leaf is lg', P.paneSize(1100) === 'lg');

// The reason `xs` is 440 and not "where the row stops fitting": five captioned
// buttons fit to ~300px, so a fit-based threshold would have left the floating
// window — the worst-measured pane in the recordings — on the roomy branch.
check('the fit-based threshold would have been wrong here', P.paneSize(390) !== P.paneSize(500));

// ── boundaries, stated so a refactor cannot drift them ────────────────────
check('439 is xs', P.paneSize(439) === 'xs');
check('440 is sm', P.paneSize(440) === 'sm');
check('619 is sm', P.paneSize(619) === 'sm');
check('620 is md', P.paneSize(620) === 'md');
check('899 is md', P.paneSize(899) === 'md');
check('900 is lg', P.paneSize(900) === 'lg');

// ── an unmeasured pane must not collapse to the tightest layout ───────────
// A view asked before layout reports 0. Answering `xs` there would strip the
// captions off a desktop leaf for one frame on every open.
check('width 0 falls back to the roomy middle', P.paneSize(0) === 'md');
check('a negative width does too', P.paneSize(-1) === 'md');
check('NaN does too', P.paneSize(Number.NaN) === 'md');

// ── the predicates the stylesheet and the bar both read ───────────────────
check('only xs is tight', P.paneSize(320) === 'xs' && P.isTightPane('xs') && !P.isTightPane('sm'));
check('xs and sm are narrow', P.isNarrowPane('xs') && P.isNarrowPane('sm'));
check('md and lg are not narrow', !P.isNarrowPane('md') && !P.isNarrowPane('lg'));

// ── class bookkeeping: exactly one pane class, ever ───────────────────────
{
  const el = {
    _c: new Set(),
    classList: {
      add(c) { el._c.add(c); },
      remove(c) { el._c.delete(c); },
    },
    style: { _p: {}, setProperty(k, v) { el.style._p[k] = v; }, removeProperty(k) { delete el.style._p[k]; } },
  };
  P.applyPaneSize(el, 'lg', 1100);
  P.applyPaneSize(el, 'xs', 320);
  const panes = [...el._c].filter((c) => c.startsWith('jp-pane-'));
  check('switching size leaves exactly one pane class', panes.length === 1 && panes[0] === 'jp-pane-xs', panes.join(','));
  check('the measured width is published for rules that want a number',
    el.style._p['--jp-pane-w'] === '320px', String(el.style._p['--jp-pane-w']));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
