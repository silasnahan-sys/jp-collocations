/**
 * golden/tray-doors.mjs — the front door's rows actually go somewhere.
 *
 * AUDIT-2026-08-01 §6.7 item 2: the plugin had 64 commands and 9 views and no
 * entry point, so "where do I put this?" meant knowing which palette entry
 * matched the medium in your hand. The tray became the door and the roads
 * became rows on it (`main.ts#trayDoors`).
 *
 * Ingest rows are invoked by COMMAND ID so the large ImportModal callbacks stay
 * in one place — which means a renamed or deleted command turns a row into a
 * button that silently does nothing. Obsidian's `executeCommandById` returns
 * false rather than throwing, so nothing would surface it at runtime either.
 * This suite is the guard: every id a door references must be registered.
 *
 * It reads main.ts as TEXT on purpose. Importing it needs the Obsidian runtime,
 * and the property under test is structural — "these two lists agree" — which
 * source is the honest place to check.
 *
 * Run:  node golden/tray-doors.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '..', 'src', 'main.ts'), 'utf8');
const tray = readFileSync(join(HERE, '..', 'src', 'ui', 'TrayView.ts'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` (${detail})` : ''}`); }
};

const registered = new Set(
  [...src.matchAll(/addCommand\(\{[\s\S]{0,120}?id:\s*"([^"]+)"/g)].map((m) => m[1]));
const doorBlock = src.match(/private trayDoors\(\)[\s\S]*?\n  \}/)?.[0] ?? '';
const doorCmds = [...doorBlock.matchAll(/run:\s*cmd\("([^"]+)"\)/g)].map((m) => m[1]);
const doors = [...doorBlock.matchAll(/kind:\s*"(in|go)"/g)].map((m) => m[1]);

console.log('\n══ every ingest door reaches a real command ══');
check('trayDoors() was found in main.ts', doorBlock.length > 0);
check('commands are registered at all', registered.size > 20, `${registered.size} commands`);
check('doors exist', doorCmds.length > 0, `${doorCmds.length} command-backed`);
for (const id of doorCmds) {
  check(`\`${id}\` is registered`, registered.has(id));
}

console.log('\n══ the door answers both questions ══');
check('there are 入れる (in) rows', doors.includes('in'), `${doors.filter((d) => d === 'in').length}`);
check('there are 開く (go) rows', doors.includes('go'), `${doors.filter((d) => d === 'go').length}`);
check('every door declares a kind', doors.length >= doorCmds.length);

console.log('\n══ the tray is wired as the front door ══');
check('the ribbon opens the tray on click', /addRibbonIcon\([\s\S]{0,220}?openTray\(\)/.test(src));
// The window is generous on purpose: this asserts "the right-click still opens
// the whole-surface menu", and that menu grows every time a view is added.
check('the full surface menu survives on right-click',
  /contextmenu[\s\S]{0,2000}?showAtMouseEvent/.test(src));
check('the tray view is handed a doors provider', /doors:\s*\(\)\s*=>\s*this\.trayDoors\(\)/.test(src));
check('TrayView renders them', /renderDoors\(/.test(tray));

console.log('\n══ a door that cannot run says why ══');
{
  // §28 S6: refuse loudly. A hidden door is indistinguishable from a missing one.
  check('TrayDoor carries a `disabled` reason', /disabled\?:\s*string/.test(tray));
  check('the disabled reason is surfaced as a title, not swallowed',
    /setAttr\('title',\s*d\.disabled\)/.test(tray));
  check('at least one door is conditionally gated in main.ts',
    /disabled:\s*plexOff/.test(doorBlock));
  check('the gate names the fix, not just the fault', /設定 → Plex/.test(src));
}

console.log(`\n${fail ? '✗' : '✓'} tray-doors: ${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
