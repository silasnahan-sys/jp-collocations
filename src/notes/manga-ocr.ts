/**
 * manga-ocr.ts — the manga vision stage (DESIGN §22.2, manga medium). PURE —
 * golden-tested in golden/podcast.mjs (parse side; the live call needs the
 * user's key).
 *
 * Tuned against the user's real Manatan drops: full two-page SPREADS (a
 * pager like 14/202 at the bottom), clean white bubbles, vertical text,
 * RIGHT page first then left, bubbles right-to-left top-to-bottom within a
 * page. The prompt demands bounding boxes in 0–1000 normalized coordinates
 * so the tray can overlay the highlight on the stored image (SceneRef.bbox).
 */

import { OCR_MODEL_DEFAULT } from './claude-client.ts';

export const MANGA_MODEL = OCR_MODEL_DEFAULT;   // one pinned place, shared

export const MANGA_PROMPT = [
  'これはマンガのページ（見開きの場合もある）のスクリーンショットです。',
  '全ての吹き出し・ナレーション枠のテキストを日本語の読み順で抽出してください:',
  '見開きなら右ページから。ページ内では右上→左下（縦書きの読み順）。',
  'ルビは無視し、本文のみ。伸ばし棒・小書き文字は原文どおり。',
  '各テキストに枠の位置を bbox=[x,y,w,h]（画像全体を0〜1000とする正規化座標）で付けてください。',
  'ページ番号・UI要素・効果音（描き文字）は含めない。',
  'JSONのみで返答: {"bubbles":[{"text":"…","bbox":[x,y,w,h]}]}',
].join('\n');

export interface MangaBubble {
  text: string;
  /** 0–1000 normalized [x, y, w, h]. */
  bbox: [number, number, number, number];
}

export type MangaOcrResult = { ok: true; bubbles: MangaBubble[] } | { ok: false; error: string };

export function parseMangaOcr(status: number, body: string): MangaOcrResult {
  if (status !== 200) {
    let msg = `HTTP ${status}`;
    try { msg += `: ${(JSON.parse(body)?.error?.message ?? '').slice(0, 120)}`; } catch { /* raw */ }
    return { ok: false, error: msg };
  }
  let text = '';
  try {
    const j = JSON.parse(body) as { content?: Array<{ text?: string }> };
    text = (j.content ?? []).map((c) => c.text ?? '').join('');
  } catch { return { ok: false, error: 'unparseable API response' }; }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, error: 'no JSON in model output' };
  let bubbles: unknown;
  try { bubbles = (JSON.parse(m[0]) as { bubbles?: unknown }).bubbles; }
  catch { return { ok: false, error: 'malformed JSON in model output' }; }
  if (!Array.isArray(bubbles)) return { ok: false, error: 'missing bubbles[]' };
  const valid: MangaBubble[] = [];
  for (const b of bubbles as Array<{ text?: unknown; bbox?: unknown }>) {
    if (typeof b?.text !== 'string' || !b.text.trim()) continue;
    const box = Array.isArray(b.bbox) && b.bbox.length === 4 && b.bbox.every((n) => typeof n === 'number' && n >= 0 && n <= 1000)
      ? (b.bbox as [number, number, number, number])
      : null;
    if (!box) continue;                          // a bubble WITHOUT a locatable box is not usable as a scene
    valid.push({ text: b.text.trim(), bbox: box });
  }
  if (!valid.length) return { ok: false, error: '吹き出しを抽出できませんでした' };
  return { ok: true, bubbles: valid };
}
