/**
 * golden/resource-url.mjs — "on the web" vs "on this device", one rule.
 *
 * Four call sites asked that question with `/^https?:/` and got it wrong,
 * because the URL Obsidian hands out for a vault file changes shape by
 * platform:
 *
 *   desktop   app://<hash>/C:/Users/silas/Documents/Lenovo/manga/panel.png?17
 *   iPadOS    capacitor://localhost/_capacitor_file_/var/mobile/…/panel.png
 *   Android   http://localhost/_capacitor_file_/storage/emulated/0/…/panel.png
 *
 * The Android one is `http://` and points at a file six centimetres away, so
 * the scheme was never the question. `_capacitor_file_` is.
 *
 * The larger half is not platform-specific: dragging a picture ALREADY in the
 * vault carries no `File` at all, only that URL on `text/uri-list` — so on
 * every platform the most natural way to move a picture you already have
 * produced a URL card pointing at `app://…?<mtime>`, which stops resolving the
 * moment the file is touched. It looked right and was dead.
 *
 * Run:  node golden/resource-url.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const R = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'resource-url.ts')).href);
const D = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'drop-intent.ts')).href);
const I = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'inbox.ts')).href);

let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

console.log('\nresource-url — the web, and this device\n');

const DESKTOP = 'app://a1b2/C:/Users/silas/Documents/Lenovo/manga/よつばと/panel.png?17';
const IPAD = 'capacitor://localhost/_capacitor_file_/var/mobile/Containers/Data/Application/U/Documents/Lenovo/manga/よつばと/panel.png?17';
const ANDROID = 'http://localhost/_capacitor_file_/storage/emulated/0/Lenovo/manga/よつばと/panel.png?17';
const WEB = 'https://note.com/silas/n/abc123';
const DEVSERVER = 'http://localhost:8080/index.html';

// ── which URLs point at this device ───────────────────────────────────────
check('a desktop app:// resource url is local', R.isDeviceUrl(DESKTOP));
check('an iPad capacitor:// resource url is local', R.isDeviceUrl(IPAD));
check('an Android http://localhost/_capacitor_file_ url is local', R.isDeviceUrl(ANDROID));
check('a file:// url is local', R.isDeviceUrl('file:///C:/v/x.png'));
check('a real web page is not', !R.isDeviceUrl(WEB));
check('a dev server on localhost IS remote — it serves pages, not files',
  !R.isDeviceUrl(DEVSERVER) && R.isRemoteUrl(DEVSERVER));

// ── and which are genuinely remote ────────────────────────────────────────
check('a web page is remote', R.isRemoteUrl(WEB));
check('the Android bridge is NOT remote, despite the scheme', !R.isRemoteUrl(ANDROID));
check('app:// is neither remote nor a bare string', !R.isRemoteUrl(DESKTOP) && R.isDeviceUrl(DESKTOP));
check('plain text is not a url', !R.isRemoteUrl('荒立つ時は台風みたいに'));

// ── a web url is not a path, on any platform ──────────────────────────────
check('a web url offers no path tails', R.pathTails(WEB).length === 0, R.pathTails(WEB).join(','));
check('…but every device url does',
  R.pathTails(DESKTOP).length > 0 && R.pathTails(IPAD).length > 0 && R.pathTails(ANDROID).length > 0);
check('all three platforms recover the SAME vault path', (() => {
  const v = (p) => (p === 'manga/よつばと/panel.png' ? p : null);
  const a = R.vaultPathOf(DESKTOP, v), b = R.vaultPathOf(IPAD, v), c = R.vaultPathOf(ANDROID, v);
  return a === b && b === c && a === 'manga/よつばと/panel.png';
})());

// ── the drag: a picture you already have ──────────────────────────────────
const VAULT = new Set(['manga/よつばと/panel.png', '資料/論文.pdf']);
const inVault = (p) => (VAULT.has(p) ? p : null);
const acts = (sample, ctx = { surface: 'tray', inVault }) => D.dropIntents(sample, ctx).map((i) => i.action);

for (const [name, url] of [['desktop', DESKTOP], ['iPad', IPAD], ['Android', ANDROID]]) {
  const a = acts({ uriList: url, kinds: ['text/uri-list'] });
  check(`a vault picture dragged on ${name} is a picture, not a link`,
    a.includes('image-tray') && !a.includes('link'), a.join(','));
}

{
  const i = D.dropIntents({ uriList: DESKTOP, kinds: ['text/uri-list'] }, { surface: 'tray', inVault })[0];
  check('…and it carries the vault PATH, not the expiring url',
    i.payload.imagePaths?.[0] === 'manga/よつばと/panel.png', JSON.stringify(i.payload));
  check('…named by its filename, not its hash', i.detail === 'panel.png', i.detail);
}

// ── the words that came with it ───────────────────────────────────────────
{
  const withText = acts({ uriList: DESKTOP, text: '荒立つ時は台風みたいに荒立つ', kinds: ['text/uri-list', 'text/plain'] });
  check('a dragged panel plus a real sentence still leads with the pair',
    withText[0] === 'image-pair', withText.join(','));

  // An internal image drag puts the embed's own markup on text/plain.
  // Captioning a picture with the syntax that draws it is noise.
  const embedOnly = acts({ uriList: DESKTOP, text: '![[panel.png]]', kinds: ['text/uri-list', 'text/plain'] });
  check('…but its own embed markup is not a caption',
    !embedOnly.includes('image-pair'), embedOnly.join(','));
  const mdEmbed = acts({ uriList: DESKTOP, text: '![](manga/panel.png)', kinds: ['text/uri-list', 'text/plain'] });
  check('…in either embed syntax', !mdEmbed.includes('image-pair'), mdEmbed.join(','));
}

// ── things that are not pictures ──────────────────────────────────────────
{
  const pdf = acts({ uriList: 'app://h/C:/v/資料/論文.pdf', kinds: ['text/uri-list'] });
  check('a vault PDF is not offered as an image', !pdf.some((a) => a.startsWith('image-')), pdf.join(','));
  check('…but the tray still takes it', pdf.includes('tray'), pdf.join(','));

  const stray = acts({ uriList: 'app://h/C:/elsewhere/stray.png', kinds: ['text/uri-list'] });
  check('a device url the vault does not know is never called a link',
    !stray.includes('link'), stray.join(','));
}

// ── and no regression for actual links ────────────────────────────────────
{
  const web = acts({ uriList: WEB, kinds: ['text/uri-list'] });
  check('a real web url is still a link', web.includes('link'), web.join(','));
  const yt = acts({ uriList: 'https://youtu.be/0z91Gp-V8fE?t=65', kinds: ['text/uri-list'] });
  check('…and YouTube still routes to its own verbs',
    yt.includes('yt-mark') || yt.includes('yt-transcript'), yt.join(','));
}

// ── the card shaper ───────────────────────────────────────────────────────
check('shapeDrop still calls a web address a url', I.shapeDrop(WEB, 1).kind === 'url');
check('shapeDrop does not call the Android bridge a url', I.shapeDrop(ANDROID, 1).kind !== 'url',
  I.shapeDrop(ANDROID, 1).kind);
check('…nor invent a host for it', !I.shapeDrop(ANDROID, 1).origin, String(I.shapeDrop(ANDROID, 1).origin));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
