/**
 * ocr-reconciler.ts — the handwriting stage (DESIGN §5, Architecture B).
 *
 * The LLM does ONE small job: read a photographed/exported Apple-Pencil page
 * and transcribe each handwritten phrase EXACTLY as written — errors included,
 * because fixing errors is the LOCAL matcher's job (reading-space corrections
 * against the frozen transcript). Transcripts never go to the API.
 *
 * Flow: image → Haiku (cheap, pinned) → schema-validate → if unparseable or
 * low-confidence, escalate ONCE to Opus → materialize the phrases INTO the
 * notes file under an idempotent `%% ocr:<imagehash> %%` marker. From then on
 * the phrases are ordinary text notes: the existing text path (extractNotePhrases
 * → reconcile → anchors/cards/clips) does everything else, and the user can
 * correct any misread line by just editing it (markdown-is-truth, invariant #1).
 *
 * Everything except `ocrImage` is pure — golden-tested without a key.
 */

import { callClaudeVision, OCR_MODEL_DEFAULT, OCR_MODEL_ESCALATION, type ClaudeHttp, type VisionImage, type VisionResult } from './claude-client.ts';

// ── prompt (one constant; schema-locked output) ────────────────────────────────

export const OCR_PROMPT = `この画像は、日本語学習者が動画を見ながら手書きでメモしたページです（Apple Pencil の手書き、またはそのスクリーンショット）。画像が複数ある場合は、1つの縦長ページを上から順に分割したタイルです — 上から下へ1ページとして読み、タイルの境目で重複して見える行は1回だけ書き起こしてください。

手書きの**物理的な行を1行ずつ**、上から順に、**書かれている通りに**書き起こしてください。行のまとめ・分割・並べ替えは一切しない — 統合はソフト側で行います。

各行について **bullet** を判定してください:
- その行が **○・●・レ点などの箇条書き記号で始まっている** → "bullet": true（新しい項目の先頭）
- 記号なしで始まる行（前の項目の**折り返し・続き**） → "bullet": false

その他の厳守事項:
- 書き間違い・変な漢字・省略も**そのまま**残す（訂正・正規化・補完は絶対にしない — 照合は後段が行う）
- 表現と表現をつなぐ**横線・波線・ダッシュ（ー・〜・-）**は、その位置に **〜** と書く（「間に話者の言葉が入る」印。語中の長音「ー」と混同しない）
- **「○○」（かぎ括弧の中の丸2つ）は伏せ字プレースホルダ** — そのまま 「○○」 と書く（数字の00や英字のOOにしない）
- 箇条書き記号そのものは語句に含めない — 「0」等として書き起こさない
- 囲み・下線などの装飾や、無意味な走り書きは無視する
- 読めない部分は読める範囲だけを書き、confidence を下げる

出力は次の JSON **のみ**（前置き・後置き・コードフェンス禁止）:
{"phrases":[{"text":"<その行の内容そのまま>","bullet":<true|false>,"confidence":<0から1>}]}
読み取れる行が1つもなければ {"phrases":[]} を返す。`;

// ── schema validation (PURE) ────────────────────────────────────────────────────

export interface OcrPhrase {
  text: string;
  confidence: number;
  /** Physical line begins at a bullet mark (new note) vs continues the
   *  previous one (wrap / hanging fragment). Default true. */
  bullet?: boolean;
}
export interface OcrPage { phrases: OcrPhrase[] }

/**
 * Deterministic bullet merge — the model only judges "does this physical line
 * start at a ○?" (a perceptual yes/no it is reliable at); joining the lines
 * into note units is OUR job, not the model's. A continuation line is folded
 * into the item above; when either side of the junction carries a connector 〜
 * the parts join as a gapped pattern, otherwise it is a plain line wrap.
 */
export function mergeBulletLines(page: OcrPage): OcrPage {
  const out: OcrPhrase[] = [];
  for (const p of page.phrases) {
    const prev = out[out.length - 1];
    if ((p.bullet ?? true) || !prev) {
      out.push({ text: p.text, confidence: p.confidence });
      continue;
    }
    const gapped = /〜\s*$/.test(prev.text) || /^\s*〜/.test(p.text);
    const left = prev.text.replace(/〜\s*$/, '').trim();
    const right = p.text.replace(/^\s*〜/, '').trim();
    prev.text = gapped ? `${left}〜${right}` : `${left}${right}`;
    prev.confidence = Math.min(prev.confidence, p.confidence);
  }
  return { phrases: out };
}

/** Parse + validate a model response into an OcrPage. Null when the response
 *  does not conform (→ escalation candidate). Tolerates code fences and stray
 *  prose around the JSON (models do that), but the JSON itself must conform. */
export function parseOcrResponse(text: string): OcrPage | null {
  // strip code fences / find the outermost JSON object
  const stripped = text.replace(/```(?:json)?/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let j: unknown;
  try { j = JSON.parse(stripped.slice(start, end + 1)); } catch { return null; }
  const arr = (j as { phrases?: unknown }).phrases;
  if (!Array.isArray(arr)) return null;
  const phrases: OcrPhrase[] = [];
  for (const pRaw of arr) {
    const p = pRaw as { text?: unknown; confidence?: unknown; bullet?: unknown };
    if (typeof p.text !== 'string') return null;             // malformed → reject page
    const t = p.text.trim();
    if (!t) continue;
    const c = typeof p.confidence === 'number' && p.confidence >= 0 && p.confidence <= 1 ? p.confidence : 0.7;
    phrases.push({ text: t, confidence: c, bullet: typeof p.bullet === 'boolean' ? p.bullet : true });
  }
  return { phrases };
}

/** Escalate when the cheap pass failed to parse, found nothing, or is shaky. */
export function shouldEscalate(page: OcrPage | null): boolean {
  if (!page) return true;
  if (!page.phrases.length) return true;
  const mean = page.phrases.reduce((s, p) => s + p.confidence, 0) / page.phrases.length;
  return mean < 0.6;
}

// ── tall-strip tiling (PURE plan; the caller crops) ─────────────────────────────

export interface TileRect { x: number; y: number; w: number; h: number }

/** Integer upscale factor for narrow handwriting strips. A 280px-wide Apple-
 *  Notes export puts glyphs at ~15px — below what vision models read reliably;
 *  2–3× magnification (with correspondingly smaller tiles so the upscaled long
 *  side still fits `maxDim`) is the difference between garbage and a clean
 *  read. 1 for ordinarily-sized pages. */
export function tileUpscale(shortSide: number, maxDim = 1400, cap = 3): number {
  if (shortSide <= 0) return 1;
  // ROUND, not floor: an 880px-wide scrawl at native res reads like garbage but
  // is fine at ×2 — round(1500/880)=2. Fast handwriting always wants the zoom.
  return Math.max(1, Math.min(cap, Math.round((maxDim + 100) / shortSide)));
}

/**
 * Plan how to cut an image into tiles along its LONG axis so every tile fits
 * the vision model's useful resolution (the API downsizes anything over
 * `maxDim` on its long side — a 280×3090 Apple-Notes strip sent whole comes
 * back 142px wide and illegible; three native-res tiles stay readable).
 * Adjacent tiles overlap by `overlap` px so a handwritten line on a boundary
 * appears whole in at least one tile. Assumes the SHORT axis already fits
 * (caller downscales first when it doesn't). Small images → one full tile.
 */
export function planTiles(width: number, height: number, opts: { maxDim?: number; overlap?: number; maxTiles?: number } = {}): TileRect[] {
  const maxDim = opts.maxDim ?? 1400;
  const overlap = opts.overlap ?? 80;
  const maxTiles = opts.maxTiles ?? 12;
  const long = Math.max(width, height);
  if (long <= maxDim) return [{ x: 0, y: 0, w: width, h: height }];
  const vertical = height >= width;
  // n tiles of size ≤ maxDim covering `long` with `overlap` shared between neighbours
  let n = Math.ceil((long - overlap) / (maxDim - overlap));
  if (n > maxTiles) n = maxTiles;                       // cap → tiles grow past maxDim (still better than 1 giant)
  const size = Math.ceil((long - overlap) / n) + overlap;
  const stride = size - overlap;
  const tiles: TileRect[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.min(i * stride, long - size);
    tiles.push(vertical
      ? { x: 0, y: Math.max(0, start), w: width, h: Math.min(size, height - Math.max(0, start)) }
      : { x: Math.max(0, start), y: 0, w: Math.min(size, width - Math.max(0, start)), h: height });
  }
  return tiles;
}

// ── orchestrator (Haiku → Opus, one escalation) ────────────────────────────────

export interface OcrConfig {
  apiKey: string;
  model?: string;             // '' → OCR_MODEL_DEFAULT
  escalationModel?: string;   // '' → OCR_MODEL_ESCALATION
}

export interface OcrResult {
  page: OcrPage | null;       // null = both tiers failed
  modelUsed: string;
  escalated: boolean;
  error?: string;             // set when page is null
}

export async function ocrImage(
  http: ClaudeHttp, cfg: OcrConfig,
  images: VisionImage[] | VisionImage,
): Promise<OcrResult> {
  const imgs = Array.isArray(images) ? images : [images];
  const primary = cfg.model || OCR_MODEL_DEFAULT;
  const secondary = cfg.escalationModel || OCR_MODEL_ESCALATION;
  const ask = (model: string): Promise<VisionResult> => callClaudeVision(http, {
    apiKey: cfg.apiKey, model, images: imgs, prompt: OCR_PROMPT,
  });

  const r1 = await ask(primary);
  const p1raw = r1.ok ? parseOcrResponse(r1.text) : null;
  const p1 = p1raw ? mergeBulletLines(p1raw) : null;
  if (!shouldEscalate(p1)) return { page: p1, modelUsed: primary, escalated: false };

  const r2 = await ask(secondary);
  const p2raw = r2.ok ? parseOcrResponse(r2.text) : null;
  const p2 = p2raw ? mergeBulletLines(p2raw) : null;
  if (p2 && p2.phrases.length) return { page: p2, modelUsed: secondary, escalated: true };

  // keep whichever side produced anything at all; report the reason honestly
  if (p1 && p1.phrases.length) return { page: p1, modelUsed: primary, escalated: true };
  const err = !r1.ok ? r1.error : !r2.ok ? r2.error : 'モデル出力がスキーマに合いません（フレーズ 0 件）。';
  return { page: p1 ?? p2, modelUsed: secondary, escalated: true, error: err };
}

// ── materialization into the notes file (PURE, idempotent) ─────────────────────

/** FNV-1a over bytes, base36 — the image's identity for the idempotency marker. */
export function imageHash(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export function ocrMarker(hash: string): string {
  return `%% ocr:${hash} %%`;
}

/**
 * Append an OCR'd page to the notes markdown, once. Re-running with the same
 * image is a no-op (marker match). Phrases become plain list items — exactly
 * what `extractNotePhrases` consumes — under a heading that the extractor
 * skips, so the file immediately works with the ordinary text reconcile path
 * and every line stays hand-editable.
 */
export function mergeOcrPhrases(
  notesMd: string, page: OcrPage, imageName: string, hash: string,
): { md: string; added: number } {
  if (notesMd.includes(ocrMarker(hash))) return { md: notesMd, added: 0 };
  const out: string[] = [];
  out.push(`## 手書きOCR: ${imageName} ${ocrMarker(hash)}`);
  const seen = new Set<string>();   // tile overlaps can echo a line — keep the first
  for (const p of page.phrases) {
    if (seen.has(p.text)) continue;
    seen.add(p.text);
    out.push(`- ${p.text}`);
  }
  const sep = notesMd.length === 0 ? '' : notesMd.endsWith('\n\n') ? '' : notesMd.endsWith('\n') ? '\n' : '\n\n';
  return { md: notesMd + sep + out.join('\n') + '\n', added: out.length - 1 };
}
