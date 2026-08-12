/**
 * golden/selection-images.mjs — a selection is not always words.
 *
 * `selection-echo.ts` read `sel.toString()` and nothing else, so dragging the
 * Pencil across a manga panel AND the sentence under it captured the sentence
 * and silently lost the picture — the same half-a-carry bug the drop road had,
 * arriving from the other side.
 *
 * `vaultPathOf` is the recovery half: a rendered image's `src` → the vault path
 * the tray can point at.
 *
 * That recovery was first written to slice at `attachments/`, this plugin's own
 * folder — which meant a panel filed ANYWHERE ELSE recovered as the absolute
 * filesystem path it came from, and `getResourcePath` on an absolute path
 * yields a broken image with no explanation. The rule now under test: a
 * resource URL carries an absolute path with the vault root at an unknowable
 * depth, so the only correct answer is to try every tail and let the VAULT say
 * which one it holds.
 *
 * Run:  node golden/selection-images.mjs
 */
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(HERE, 'stub', 'loader.mjs')));
const S = await import(pathToFileURL(join(HERE, '..', 'src', 'ui', 'selection-echo.ts')).href);

let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

console.log('\nselection-images — the picture inside the highlight\n');

check('an app:// resource url yields the vault path',
  S.vaultPathOf('app://a1b2c3/C:/vault/attachments/inbox-1.png?1699') === 'attachments/inbox-1.png',
  String(S.vaultPathOf('app://a1b2c3/C:/vault/attachments/inbox-1.png?1699')));
check('percent-encoding is decoded',
  S.vaultPathOf('app://x/C:/v/attachments/%E6%BC%A2%E5%AD%97.png') === 'attachments/漢字.png',
  String(S.vaultPathOf('app://x/C:/v/attachments/%E6%BC%A2%E5%AD%97.png')));
check('the cache-busting query is dropped',
  !String(S.vaultPathOf('app://x/C:/v/attachments/a.png?9999')).includes('?'));
check('a data: url is not a vault path', S.vaultPathOf('data:image/png;base64,iVBOR') === null);
check('a remote image is not a vault path', S.vaultPathOf('https://example.com/a.png') === null);
check('an empty src is nothing', S.vaultPathOf('') === null);
check('a plain relative path survives', S.vaultPathOf('attachments/b.png') === 'attachments/b.png');

// ── anywhere in the vault ─────────────────────────────────────────────────
// A vault that holds a manga folder and nothing named `attachments`. The old
// rule had no marker to slice at and handed back `/Users/silas/Vaults/…`,
// which resolves to nothing.
const VAULT = new Set([
  'manga/よつばと/01/panel-14.png',
  '読書メモ/図/図1.png',
  'panel-14.png',
]);
const inVault = (p) => (VAULT.has(p) ? p : null);

check('a picture outside attachments/ is found by asking the vault',
  S.vaultPathOf('app://h/Users/silas/Vaults/Lenovo/manga/よつばと/01/panel-14.png?17', inVault)
    === 'manga/よつばと/01/panel-14.png',
  String(S.vaultPathOf('app://h/Users/silas/Vaults/Lenovo/manga/よつばと/01/panel-14.png?17', inVault)));

check('…and the same picture without a vault to ask is NOT guessed at',
  S.vaultPathOf('app://h/Users/silas/Vaults/Lenovo/manga/よつばと/01/panel-14.png?17')
    !== 'manga/よつばと/01/panel-14.png');

check('the deepest match wins, not the shortest',
  S.vaultPathOf('app://h/x/manga/よつばと/01/panel-14.png', inVault) === 'manga/よつばと/01/panel-14.png',
  String(S.vaultPathOf('app://h/x/manga/よつばと/01/panel-14.png', inVault)));

check('a Japanese folder name survives the walk',
  S.vaultPathOf('app://h/C:/v/%E8%AA%AD%E6%9B%B8%E3%83%A1%E3%83%A2/%E5%9B%B3/%E5%9B%B31.png', inVault)
    === '読書メモ/図/図1.png',
  String(S.vaultPathOf('app://h/C:/v/%E8%AA%AD%E6%9B%B8%E3%83%A1%E3%83%A2/%E5%9B%B3/%E5%9B%B31.png', inVault)));

check('a picture the vault does not hold is dropped, not guessed',
  S.vaultPathOf('app://h/C:/elsewhere/stray.png', inVault) === null,
  String(S.vaultPathOf('app://h/C:/elsewhere/stray.png', inVault)));

// ── the platforms he actually runs on ─────────────────────────────────────
// iPadOS serves the vault over Capacitor; Android over a localhost http
// bridge. Rejecting the whole http(s) scheme — as this once did — dropped
// every vault image on Android.
check('an iPad capacitor:// resource url resolves',
  S.vaultPathOf(
    'capacitor://localhost/_capacitor_file_/var/mobile/Containers/Data/Application/UUID/Documents/Lenovo/manga/よつばと/01/panel-14.png?9',
    inVault) === 'manga/よつばと/01/panel-14.png');

check('Android’s localhost file bridge is not mistaken for the internet',
  S.vaultPathOf('http://localhost/_capacitor_file_/storage/emulated/0/Lenovo/manga/よつばと/01/panel-14.png', inVault)
    === 'manga/よつばと/01/panel-14.png');

check('…while a genuine http image still is',
  S.vaultPathOf('http://example.com/manga/よつばと/01/panel-14.png', inVault) === null);

// ── the tails themselves ──────────────────────────────────────────────────
{
  const t = S.pathTails('app://h/C:/v/a/b.png');
  check('tails run longest to shortest', t[0].length > t[t.length - 1].length && t[t.length - 1] === 'b.png',
    t.join(' | '));
  check('every tail is relative — none starts with a separator', t.every((x) => !x.startsWith('/')),
    t.join(' | '));
  check('a data: url has no tails', S.pathTails('data:image/png;base64,iVBOR').length === 0);
}

// ── the second road: the note said what the picture is ────────────────────
// `![[panel-14.png]]` renders inside an .internal-embed carrying the LINK
// TEXT, which only the vault can expand. The DOM stub is hand-written, so
// this also proves imagesIn survives a Range with no intersectsNode.
{
  const img = { getAttribute: (k) => (k === 'src' ? 'app://h/weird/path/not-in-vault.png' : null), parentElement: null };
  const embed = { className: 'internal-embed image-embed', getAttribute: (k) => (k === 'src' ? 'panel-14.png' : null), parentElement: null };
  img.parentElement = embed;
  const scope = { nodeType: 1, querySelectorAll: () => [img] };
  const got = S.imagesIn({ commonAncestorContainer: scope }, inVault);
  check('an embed’s link text is the second road home', got.length === 1 && got[0] === 'panel-14.png', got.join(','));

  const noOne = S.imagesIn({ commonAncestorContainer: scope }, () => null);
  check('…and an image no road reaches is left out, not faked', noOne.length === 0, noOne.join(','));
  check('a range with nothing to read yields no images and no throw',
    S.imagesIn(undefined, inVault).length === 0);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
