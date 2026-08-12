/**
 * golden/drag-out-files.mjs — the way OUT had no way to say "this is a file".
 *
 * The drop road learned to recognise a vault picture arriving as a resource URL
 * (`resource-url.mjs`). This is the mirror: `drag-out.ts` put only
 * `text/plain` + `text/html` + `application/x-jpc-drag` on the wire, so a
 * picture LEAVING the plugin had no way to say it was a picture. The tray
 * resolved that by excluding image cards from drag entirely — `c.kind !==
 * 'image'` — which meant the one card type that IS a file was the one type that
 * could not be carried anywhere.
 *
 * Worse, and invisible from a desktop: `drop-router.ts`'s synthetic carry —
 * the ONLY transport iOS touch ever uses, because WebKit never fires
 * `dragstart` from a finger or a Pencil — built its sample as
 * `{text, kinds, files: []}` and dropped the URL on the floor. So the platform
 * where the gesture matters most was the platform where it could not work.
 *
 * What is under test is the ROUND TRIP: a card that leaves and comes back is
 * the same card. This suite drives `dropIntents` with the exact sample the
 * synthetic carry builds, so the two halves are pinned against each other
 * rather than each against its own idea of the other.
 *
 * Run:  node golden/drag-out-files.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const D = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'drop-intent.ts')).href);

let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

console.log('\ndrag-out-files — a carried picture is still a picture\n');

const PATH = 'manga/よつばと/panel.png';
const URL = `app://a1b2/C:/Users/silas/Documents/Lenovo/${PATH}?17`;
const SAID = '荒立つ時は台風みたいに荒立つものなよ。';
const inVault = (p) => (p === PATH ? p : null);

/** Exactly what `drop-router.ts`'s `carried()` builds from a DragPayload. */
const carried = (p) => ({
  text: p.text,
  kinds: p.url
    ? ['text/plain', 'text/html', 'text/uri-list', 'application/x-jpc-drag']
    : ['text/plain', 'text/html', 'application/x-jpc-drag'],
  ...(p.url ? { uriList: p.url } : {}),
  files: [],
});

/** …and what `TrayView.carryOf` puts in it, for each kind of card. */
const carryOfImage = (said) => ({
  text: said || `![[${PATH}]]`,
  url: URL,
  path: PATH,
});

const acts = (sample, ctx = { surface: 'tray', inVault }) => D.dropIntents(sample, ctx).map((i) => i.action);

// ── a picture with no words ───────────────────────────────────────────────
{
  const a = acts(carried(carryOfImage(null)));
  check('a carried picture lands as a picture', a.includes('image-tray'), a.join(','));
  check('…not as a link', !a.includes('link'), a.join(','));
  check('…and not as the string of its own path', a[0] !== 'capture' && a[0] !== 'tray', a.join(','));

  const i = D.dropIntents(carried(carryOfImage(null)), { surface: 'tray', inVault })[0];
  check('…carrying the vault path, which does not expire',
    i.payload.imagePaths?.[0] === PATH, JSON.stringify(i.payload));
  check('the embed markup it travelled as is not mistaken for a caption',
    !acts(carried(carryOfImage(null))).includes('image-pair'));
}

// ── a picture that came with its sentence ─────────────────────────────────
{
  const a = acts(carried(carryOfImage(SAID)));
  check('a paired card leaves and returns as ONE pair', a[0] === 'image-pair', a.join(','));
  const i = D.dropIntents(carried(carryOfImage(SAID)), { surface: 'tray', inVault })[0];
  check('…with both halves intact',
    i.payload.imagePaths?.[0] === PATH && i.payload.text === SAID, JSON.stringify(i.payload));
}

// ── OCR, the reason a saved panel is worth carrying at all ────────────────
{
  const a = acts(carried(carryOfImage(null)), { surface: 'tray', inVault, can: { ocr: true } });
  check('a vault panel offers OCR — it needs no file, only the path',
    a.includes('image-ocr'), a.join(','));
  const off = acts(carried(carryOfImage(null)));
  check('…and never offers it when there is no key', !off.includes('image-ocr'), off.join(','));
}

// ── the transport must not change the answer (§26.0 property 4) ───────────
{
  const synthetic = acts(carried(carryOfImage(SAID)));
  const native = acts({
    text: SAID, uriList: URL,
    kinds: ['text/plain', 'text/html', 'text/uri-list', 'application/x-jpc-drag'], files: [],
  });
  check('finger, Pencil and mouse all get the same verbs',
    JSON.stringify(synthetic) === JSON.stringify(native), `${synthetic} vs ${native}`);
}

// ── a carry with no file is unchanged ─────────────────────────────────────
{
  const words = acts(carried({ text: SAID }));
  check('a text card still behaves exactly as it did',
    !words.some((a) => a.startsWith('image-')), words.join(','));
  check('…and is still capturable', words.length > 0);
  // An EMPTY uri-list would be worse than none: its presence in `kinds` alone
  // makes the preview pass paint link verbs over a carry that has no link.
  check('a payload with no url puts no uri-list in kinds',
    !carried({ text: SAID }).kinds.includes('text/uri-list'));
}

// ── a link card ───────────────────────────────────────────────────────────
{
  const link = acts(carried({ text: 'https://note.com/x', url: 'https://note.com/x' }));
  check('a link card is still a link', link.includes('link'), link.join(','));
  check('…and is not mistaken for a vault file',
    !link.some((a) => a.startsWith('image-')), link.join(','));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
