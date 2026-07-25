/**
 * claude-client.ts — ⚠ the ONLY file that knows the Anthropic API (DESIGN §5,
 * isolation invariant #2 — the `XClient` rule).
 *
 * One job: send a vision message (image + prompt) and return the model's text.
 * The API key lives in plugin settings (like the X cookies — a SECRET, never
 * logged). Transport is the injected HTTP seam (Obsidian `requestUrl` in the
 * plugin — works on mobile; node fetch in the golden harness). Models are
 * PINNED here in one constant each (invariant: model changes are one-line,
 * golden-gated). Errors are surfaced verbatim — never swallowed, never faked.
 */

export interface ClaudeHttp {
  post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; text: string }>;
}

/** Cheap tier for page OCR (DESIGN §5: ~1,600 image tokens/page). */
export const OCR_MODEL_DEFAULT = 'claude-haiku-4-5-20251001';
/** Escalation tier when the cheap pass comes back unparseable/low-confidence. */
export const OCR_MODEL_ESCALATION = 'claude-opus-4-8';

export const API_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2023-06-01';

export type VisionMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
export interface VisionImage { base64: string; mediaType: VisionMediaType }

export interface VisionRequest {
  apiKey: string;
  model: string;
  /** One page = one or more image blocks IN READING ORDER. Tall Apple-Notes
   *  strips are tiled (the API downsizes any image to ≤1568px on its long
   *  side, which would crush a 280×3090 strip to illegibility — native-res
   *  tiles keep the handwriting readable). */
  images: VisionImage[];
  prompt: string;
  maxTokens?: number;
}

/** The exact request body (PURE — golden-tested shape). */
export function buildVisionBody(req: VisionRequest): string {
  return JSON.stringify({
    model: req.model,
    // Dense pages easily exceed 2k output tokens (50 phrases of JSON) — a
    // truncated array is unparseable and silently wastes the whole call.
    max_tokens: req.maxTokens ?? 8192,
    messages: [{
      role: 'user',
      content: [
        ...req.images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.base64 } })),
        { type: 'text', text: req.prompt },
      ],
    }],
  });
}

export type VisionResult = { ok: true; text: string } | { ok: false; error: string };

/** Pull the assistant text out of a /v1/messages response (PURE). */
export function parseVisionResponse(status: number, body: string): VisionResult {
  if (status !== 200) {
    let detail = body.slice(0, 300);
    try {
      const j = JSON.parse(body) as { error?: { type?: string; message?: string } };
      if (j.error?.message) detail = `${j.error.type ?? 'error'}: ${j.error.message}`;
    } catch { /* keep raw slice */ }
    return { ok: false, error: `Anthropic API HTTP ${status} — ${detail}` };
  }
  try {
    const j = JSON.parse(body) as { content?: { type?: string; text?: string }[] };
    const text = (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    if (!text.trim()) return { ok: false, error: 'Anthropic API returned an empty message.' };
    return { ok: true, text };
  } catch {
    return { ok: false, error: 'Anthropic API returned unparseable JSON.' };
  }
}

/** Send one vision message. Never throws; reports via the result. */
export async function callClaudeVision(http: ClaudeHttp, req: VisionRequest): Promise<VisionResult> {
  if (!req.apiKey) return { ok: false, error: 'No Anthropic API key configured (settings → 手書きOCR).' };
  let resp: { status: number; text: string };
  try {
    resp = await http.post(API_URL, buildVisionBody(req), {
      'x-api-key': req.apiKey,
      'anthropic-version': API_VERSION,
      'content-type': 'application/json',
    });
  } catch (e) {
    return { ok: false, error: `Network error contacting the Anthropic API: ${(e as Error).message}` };
  }
  return parseVisionResponse(resp.status, resp.text);
}
