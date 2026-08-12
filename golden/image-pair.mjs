/**
 * golden/image-pair.mjs — a picture and the words that came with it.
 *
 * The bug: `drop-intent.ts` branched on `files.length`, built the image verbs,
 * and then `return out` — so a carry holding BOTH a picture and text was read
 * in full and half of it thrown away. The interesting carries are nearly all
 * of that shape: a Manatan panel arrives with the sentence it already OCR'd
 * (v1≈332s, 「Sentence copied to clipboard.」), an Apple Notes selection
 * arrives as strokes plus recognised text. Both halves had to be carried
 * separately and re-paired by hand, which is the moment a capture stops being
 * worth making.
 *
 * Two rules under test:
 *   1. When both arrive, KEEPING BOTH leads. Keeping both is never a worse
 *      answer than keeping half, and the halves stay available underneath.
 *   2. The pair is ONE card. `pairedCard` hashes both halves, so the same
 *      panel with a different sentence is a new capture and an identical
 *      re-drop is a duplicate.
 *
 * Run:  node golden/image-pair.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const D = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'drop-intent.ts')).href);
const I = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'inbox.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const PNG = { name: 'panel.png', type: 'image/png' };
const SAID = '荒立つ時は台風みたいに荒立つものなよ。';
const acts = (sample, ctx = { surface: 'tray' }) => D.dropIntents(sample, ctx).map((i) => i.action);

console.log('\nimage-pair — one carry, one card\n');

// ── rule 1: both arrived, so both are kept, and that leads ────────────────
{
  const a = acts({ files: [PNG], text: SAID, kinds: ['text/plain', 'Files'] });
  check('a panel dropped with its sentence leads with the pair', a[0] === 'image-pair', a.join(','));
  check('…and the image-only reading is still offered underneath',
    a.includes('image-tray'), a.join(','));
}

// ── the halves alone are unchanged ────────────────────────────────────────
{
  const imgOnly = acts({ files: [PNG], kinds: ['Files'] });
  check('a picture with no words never offers the pair', !imgOnly.includes('image-pair'), imgOnly.join(','));
  check('…and still leads with an image verb', imgOnly[0]?.startsWith('image-'), imgOnly.join(','));

  const textOnly = acts({ text: SAID, kinds: ['text/plain'] });
  check('words with no picture never offer the pair', !textOnly.includes('image-pair'), textOnly.join(','));
  check('…and are still captured', textOnly.length > 0);
}

// ── a mid-drag preview cannot promise a pair it has not read ──────────────
// `getData()` returns '' while a drag is in flight, so a preview that offered
// 「画像と文をまとめて」 would be naming text it has not seen.
{
  const p = acts({ preview: true, files: [{ type: 'image/png' }], kinds: ['text/plain', 'Files'] });
  check('the preview pass does not promise a pair', !p.includes('image-pair'), p.join(','));
}

// ── OCR capability does not displace the pair ─────────────────────────────
{
  const a = acts({ files: [PNG], text: SAID, kinds: ['text/plain', 'Files'] }, { surface: 'tray', can: { ocr: true } });
  check('the pair still leads when OCR is available', a[0] === 'image-pair', a.join(','));
  check('…and OCR remains reachable', a.includes('image-ocr'), a.join(','));
}

// ── the text travels with the intent, not just the files ──────────────────
{
  const i = D.dropIntents({ files: [PNG], text: SAID, kinds: ['text/plain', 'Files'] }, { surface: 'tray' })[0];
  check('the pair intent carries the words', i.payload.text === SAID);
  check('…and the picture', Array.isArray(i.payload.fileIdx) && i.payload.fileIdx.length === 1);
  check('…and names them both to the user', i.detail.includes('荒立つ'), i.detail);
}

// ── rule 2: one card, holding both ────────────────────────────────────────
{
  const c = I.pairedCard('attachments/inbox-1.png', SAID, 1000);
  check('the pair is one card, not two', c.kind === 'image' && c.content.endsWith('.png'));
  check('…that carries the words', c.said === SAID);

  const same = I.pairedCard('attachments/inbox-1.png', SAID, 1000);
  check('an identical re-drop is the same card', same.id === c.id);

  const other = I.pairedCard('attachments/inbox-1.png', '別の文', 1000);
  check('the same panel with different words is a new card', other.id !== c.id);

  const blank = I.pairedCard('attachments/inbox-2.png', '   ', 1000);
  check('whitespace-only words leave no empty caption', blank.said === undefined);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
