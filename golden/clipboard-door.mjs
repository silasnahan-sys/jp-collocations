/**
 * golden/clipboard-door.mjs — the way in from every other app.
 *
 * MEASURED 2026-08-08, camera recordings of the iPad. Manatan OCRs a manga
 * panel and reports 「Sentence copied to clipboard.」; a selection in the
 * reference-doc app offers exactly one verb, Copy; Apple Notes offers Cut /
 * Copy / Paste. The system clipboard is the only channel those apps share with
 * this plugin, and reaching it used to cost four moves — three of them
 * navigation — so the reading stayed in the other app.
 *
 * The rule under test: **the door has no verbs of its own.** It hands the
 * clipboard to `dropIntents` and takes the leading answer, so it inherits every
 * verb the drag road has and can never drift from it (§28 S5, one road in).
 *
 * What that buys, concretely: copy a YouTube link in Safari and the door
 * fetches a transcript; copy a sentence while standing on the 辞書 and it looks
 * it up; copy the same sentence on the tray and it becomes a card. The surface
 * you are standing on is context, never a different set of verbs.
 *
 * ## …which only holds if the door describes the clipboard honestly
 *
 * It did not. The door read `readText()` and hand-built its sample as
 * `{text, kinds: ['text/plain'], files: []}` — a claim that the clipboard held
 * plain text and nothing else, which the classifier then believed. So the two
 * things most worth sending were invisible: a PICTURE (reported as an empty
 * clipboard, on the one channel Manatan and Apple Notes share with this
 * plugin), and a picture THE VAULT ALREADY HOLDS, which arrives either as
 * `![[パネル.png]]` or as an `app://` / `capacitor://` / `http://localhost/…`
 * address and needs `uriList` + `inVault` to be recognised — neither of which
 * this door supplied.
 *
 * Everything below the first section is that: the same object, carried by the
 * three roads it can be carried by, has to get the same verb (§26.0 property 4).
 *
 * Run:  node golden/clipboard-door.mjs
 */
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// clipboard-door.ts imports `Notice`; the stub makes obsidian resolvable.
register(pathToFileURL(join(HERE, 'stub', 'loader.mjs')));
const C = await import(pathToFileURL(join(HERE, '..', 'src', 'ui', 'clipboard-door.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const act = (text, surface = 'tray', can = {}) =>
  C.clipboardIntent(text, { surface, can })?.action ?? null;

console.log('\nclipboard-door — what the other apps hand over\n');

// ── nothing is nothing ────────────────────────────────────────────────────
check('empty clipboard offers nothing', act('') === null);
check('whitespace only offers nothing', act('   \n\t ') === null);

// ── the surface is context, not a different verb set ──────────────────────
{
  // The sentence Manatan copied out of BLACK LAGOON, verbatim from v1≈352s.
  const sentence = '荒立つ時は台風みたいに荒立つものなよ。';
  const onTray = act(sentence, 'tray');
  const onDict = act(sentence, 'dict');
  check('a copied sentence is accepted on the tray', onTray !== null, String(onTray));
  check('…and on the 辞書', onDict !== null, String(onDict));
  check('…and the surface changes the answer, not whether there is one',
    onTray !== null && onDict !== null);
}

// ── a link keeps its identity wherever you are standing ───────────────────
{
  const yt = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const onDict = act(yt, 'dict');
  const onTray = act(yt, 'tray');
  check('a YouTube link is a YouTube link on the 辞書 too', onDict === onTray, `${onDict} vs ${onTray}`);
  check('…and it is not merely filed away', onDict !== null && onDict !== 'tray', String(onDict));
}

// ── the door inherits the drag road's verbs, it does not invent them ──────
{
  const D = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'drop-intent.ts')).href);
  const text = '経験を積む';
  const viaDoor = C.clipboardIntent(text, { surface: 'lexicon', can: {} })?.action ?? null;
  const viaDrop = D.dropIntents(
    { text, kinds: ['text/plain'], files: [] }, { surface: 'lexicon', can: {} },
  )[0]?.action ?? null;
  check('the door and a drop of the same text agree exactly',
    viaDoor === viaDrop && viaDoor !== null, `${viaDoor} vs ${viaDrop}`);
}

// ── freshness: a second tap on an unchanged clipboard is a mis-tap ────────
{
  C.resetClipboardDoor();
  check('anything non-empty is fresh to begin with', C.isFreshClipboard('荒立つ'));
  check('empty is never fresh', !C.isFreshClipboard(''));
  check('whitespace is never fresh', !C.isFreshClipboard('  \n '));
  // `receiveClipboard` is what marks a text taken, and it needs a real
  // navigator; the predicate's contract is what matters here.
  check('reset restores freshness', (C.resetClipboardDoor(), C.isFreshClipboard('荒立つ')));
}

// ── the entry surface still gets its own reading ──────────────────────────
{
  const onEntry = act('この表現がすること', 'entry');
  check('an open catalog entry accepts a copied phrase', onEntry !== null, String(onEntry));
}

// ─────────────────────────────────────────────────────────────────────────
//  what the door could not see
// ─────────────────────────────────────────────────────────────────────────

const D = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'drop-intent.ts')).href);

const PATH = 'manga/よつばと/panel.png';
const held = (p) => (p === PATH || p === 'panel.png' ? PATH : null);
const take = (text, ctx = {}) => C.clipboardIntent(text, { surface: 'tray', can: {}, ...ctx });

// ── a picture the vault holds, copied as its ADDRESS ──────────────────────
// Three platforms, three URL shapes, one vault file. The scheme is not the
// signal — Android's is literally `http://localhost/…`.
{
  const URLS = {
    'desktop': `app://a1b2/C:/Users/silas/Documents/Lenovo/${PATH}?17`,
    'iPadOS ': `capacitor://localhost/_capacitor_file_/var/mobile/Containers/Data/Application/8B2C/Documents/Lenovo/${PATH}`,
    'Android': `http://localhost/_capacitor_file_/storage/emulated/0/Lenovo/${PATH}`,
  };
  for (const [os, url] of Object.entries(URLS)) {
    const i = take(url, { inVault: held });
    check(`${os}: a copied image address is the picture the vault holds`,
      i?.action === 'image-tray', String(i?.action));
    check(`${os}: …carrying the vault path, which does not expire`,
      i?.payload?.imagePaths?.[0] === PATH, JSON.stringify(i?.payload));
    check(`${os}: …and the address is not read as a caption for itself`,
      !i?.payload?.text, JSON.stringify(i?.payload));
  }
  check('…and none of the three is filed as a web link',
    Object.values(URLS).every((u) => take(u, { inVault: held })?.action !== 'link'));
}

// ── a picture the vault holds, copied as its EMBED ────────────────────────
// Select the line under a panel in a note, tap Copy. This is the only way a
// vault picture reaches the clipboard on iPadOS, and it used to be refused.
{
  const i = take('![[panel.png]]', { inVault: held });
  check('a copied embed is the picture it draws', i?.action === 'image-tray', String(i?.action));
  check('…resolved from the shortest-form link the vault wrote, not from the string',
    i?.payload?.imagePaths?.[0] === PATH, JSON.stringify(i?.payload));
  check('…a display width does not hide it',
    take('![[panel.png|300]]', { inVault: held })?.action === 'image-tray');
  check('…nor does markdown embed syntax',
    take(`![](${PATH})`, { inVault: held })?.action === 'image-tray');
  check('…and it offers OCR, which is why a saved panel is worth copying at all',
    take('![[panel.png]]', { inVault: held, can: { ocr: true } })?.action === 'image-ocr');

  // The drops Obsidian owns stay Obsidian's.
  check('a BARE wikilink is still not stolen — that is its own file-explorer drag',
    take('[[panel.png]]', { inVault: held }) === null);
  check('an embedded NOTE is not a picture',
    take('![[週報]]', { inVault: (p) => (p === '週報' ? '週報.md' : null) }) === null);
  check('an embed the vault cannot confirm is refused, never guessed at',
    take('![[panel.png]]') === null);
}

// ── a picture ON the clipboard, which readText() could not see at all ─────
{
  const shot = [{ name: 'clipboard-1.png', type: 'image/png' }];
  check('a copied picture is received', take('', { files: shot })?.action === 'image-tray');
  check('…and a bare panel offers OCR when there is a key',
    take('', { files: shot, can: { ocr: true } })?.action === 'image-ocr');

  // Apple Notes hands over the strokes AND the text it recognised, in ONE
  // clipboard item — which is why the door has to read both halves of one
  // `read()` rather than asking twice.
  const said = '荒立つ時は台風みたいに荒立つものなよ。';
  const pair = take(said, { files: shot });
  check('a picture that came with its sentence lands as ONE pair',
    pair?.action === 'image-pair', String(pair?.action));
  check('…with both halves intact',
    pair?.payload?.text === said && pair?.payload?.fileIdx?.[0] === 0, JSON.stringify(pair?.payload));
}

// ── the transport must not change the answer (§26.0 property 4) ───────────
{
  const url = `app://a1b2/C:/Users/silas/Documents/Lenovo/${PATH}?17`;
  const pasted = take(url, { inVault: held })?.action;
  const dragged = D.dropIntents(
    { text: url, uriList: url, kinds: ['text/plain', 'text/uri-list'], files: [] },
    { surface: 'tray', inVault: held },
  )[0]?.action;
  check('the same picture pasted and dragged gets the same verb',
    pasted === dragged && !!pasted, `${pasted} vs ${dragged}`);

  const embed = take('![[panel.png]]', { inVault: held })?.action;
  check('…and so does the same picture referred to either way',
    embed === pasted, `${embed} vs ${pasted}`);
}

// ── the sample must DESCRIBE the clipboard, never assume it ───────────────
{
  const s = C.clipboardSample({ text: '荒立つ' });
  check('ordinary text puts no uri-list in kinds', !s.kinds.includes('text/uri-list'), s.kinds.join(','));
  const u = C.clipboardSample({ text: 'https://note.com/x' });
  check('a copied URL rides text/uri-list, where a dropped one would be',
    u.uriList === 'https://note.com/x' && u.kinds.includes('text/uri-list'), JSON.stringify(u));
  check('a sentence that merely contains a URL is not a URL',
    !C.clipboardSample({ text: 'これ https://note.com/x を見て' }).kinds.includes('text/uri-list'));
  check('an empty clipboard claims nothing at all',
    C.clipboardSample({}).kinds.length === 0, JSON.stringify(C.clipboardSample({})));
  check('a picture declares itself a file',
    C.clipboardSample({ files: [{ type: 'image/png' }] }).kinds.includes('Files'));
}

// ── freshness, once a clipboard is not only text ──────────────────────────
{
  const shot = [{ type: 'image/png', size: 40219 }];
  const bare = C.freshnessKey({ text: '', files: shot });
  const withWords = C.freshnessKey({ text: '荒立つ', files: shot });
  check('a picture alone and the same picture with a sentence are not one clipboard',
    bare !== withWords, `${bare} vs ${withWords}`);
  check('a picture with no words is still something, so it is fresh',
    (C.resetClipboardDoor(), C.isFreshClipboard(bare)));
  check('the same take read twice is the same key',
    C.freshnessKey({ text: '荒立つ', files: shot }) === withWords);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
