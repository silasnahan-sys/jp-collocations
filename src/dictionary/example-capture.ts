/**
 * example-capture.ts — which dictionary lines are capturable examples, and
 * what part of them is the Japanese sentence (DESIGN §22.5). PURE —
 * golden-tested in golden/scene.mjs.
 *
 * Bilingual dictionaries (Kenkyūsha 新和英大 etc.) render examples as
 * "日本語の文。 English translation." — the capture wants the Japanese as
 * the attestation quote while the FULL line stays visible as the entry
 * context. Detection is conservative: a line must carry a real Japanese
 * run; a gloss-only or English-only line never grows a capture button.
 */

const JP_CHAR = /[぀-ヿ㐀-䶿一-鿿々ー]/;
const JP_RUN = /[぀-ヿ㐀-䶿一-鿿々ー][぀-ヿ㐀-䶿一-鿿々ー、。！？!?・「」『』（）　]*[぀-ヿ㐀-䶿一-鿿々ー。！？]/g;

/** Is this leaf line an example sentence worth a capture affordance? */
export function isExampleLine(text: string): boolean {
  const t = text.trim();
  if (t.length < 6 || t.length > 200) return false;
  const jp = exampleJapanese(t);
  // a real sentence-ish Japanese run: ≥6 chars, and not just the headword
  return jp.length >= 6 && (jp.length >= 10 || /[。！？をがはにで]/.test(jp));
}

/** The longest Japanese run in the line — the attestation quote. */
export function exampleJapanese(text: string): string {
  if (!JP_CHAR.test(text)) return '';
  let best = '';
  JP_RUN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JP_RUN.exec(text)) !== null) {
    if (m[0].length > best.length) best = m[0];
  }
  // fallback: single run without terminal punctuation
  if (!best) {
    const loose = text.match(/[぀-ヿ㐀-䶿一-鿿々ー][぀-ヿ㐀-䶿一-鿿々ー、・　]*/g) ?? [];
    for (const r of loose) if (r.length > best.length) best = r;
  }
  return best.trim();
}
