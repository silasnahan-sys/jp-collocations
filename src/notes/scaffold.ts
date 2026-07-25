/**
 * scaffold.ts — 生成 scaffold examples for zero-attestation patterns
 * (DESIGN §20.3 Tier C). PURE — golden-tested in golden/scaffold.mjs.
 *
 * Philosophy guards, in code:
 *  - the model is the ONE pinned constant shared with OCR (a swap is a
 *    config edit, §2)
 *  - the response is schema-shaped and every candidate line is VALIDATED by
 *    the same deinflect-validated matcher the sweep uses: a generated
 *    sentence that does not demonstrably contain the pattern is rejected,
 *    whatever the model claims
 *  - callers store survivors in `payload.scaffold` — 生成-badged, SRS-only,
 *    never the context tree, auto-retired on the first real attestation
 *    (pattern-store owns that rule)
 */

import { OCR_MODEL_DEFAULT } from './claude-client.ts';
import { findTermAll } from './sweep-match.ts';
import { sweepTerms, type PatternEntry } from './pattern-store.ts';
import { normalizeJapanese } from '../utils/japanese.ts';

export const SCAFFOLD_MODEL = OCR_MODEL_DEFAULT;
export const SCAFFOLD_MAX = 3;

type ScaffoldPattern = Pick<PatternEntry, 'class' | 'key' | 'keyKind' | 'payload' | 'note'>;

const CLASS_HINT: Record<string, string> = {
  serifu: 'この決まり文句をそのまま自然な会話の一部として使う',
  collocation: 'この連語を（動詞は自然に活用させて）話し言葉の文で使う',
  rhet_collocation: 'このレンマの比喩的・修辞的な用法（ハローの言い回し）を使う',
  phrase_schema: 'この構文型の○○スロットに自然な語句を入れて使う',
  skeletal: 'この骨格リンクの両方の成分を一つの発話の中で使う',
  discourse: 'この談話の型が現れる短いやり取りを書く',
};

export function buildScaffoldPrompt(p: ScaffoldPattern): string {
  const bits: string[] = [
    `対象パターン: ${p.key}`,
    p.payload.gloss ? `意味・機能: ${p.payload.gloss}` : '',
    p.payload.parts?.length ? `成分: ${p.payload.parts.join(' 〜 ')}` : '',
    p.payload.frame ? `型: ${p.payload.frame}` : '',
    p.payload.halo ? `言い回し: ${p.payload.halo}` : '',
    `指示: ${CLASS_HINT[p.class] ?? CLASS_HINT.serifu}。`,
    `くだけた自然な日本語の話し言葉で、${SCAFFOLD_MAX}つの独立した例文を作ってください。`,
    '各例文は15〜45文字。翻訳・ローマ字・説明は不要。',
    'JSONのみで返答: {"examples":["…","…","…"]}',
  ].filter(Boolean);
  return bits.join('\n');
}

export function buildScaffoldBody(p: ScaffoldPattern): string {
  return JSON.stringify({
    model: SCAFFOLD_MODEL,
    max_tokens: 500,
    messages: [{ role: 'user', content: buildScaffoldPrompt(p) }],
  });
}

/**
 * Does this line demonstrably contain the pattern? Same contract as the
 * sweep: every sweep term must occur (exact or deinflect-validated). This is
 * what keeps 生成 honest — the validator, not the generator, decides.
 */
export function scaffoldLineValid(p: ScaffoldPattern, line: string): boolean {
  const text = normalizeJapanese(line).replace(/\s+/g, '');
  const terms = sweepTerms(p);
  if (!terms.length) return false;
  return terms.every((t) => findTermAll(text, normalizeJapanese(t).replace(/\s+/g, '')).length > 0);
}

export type ScaffoldResult = { ok: true; examples: string[] } | { ok: false; error: string };

/** Parse + validate the API response; only pattern-containing lines survive. */
export function parseScaffoldResponse(p: ScaffoldPattern, status: number, body: string): ScaffoldResult {
  if (status !== 200) {
    let msg = `HTTP ${status}`;
    try { msg += `: ${(JSON.parse(body)?.error?.message ?? '').slice(0, 120)}`; } catch { /* raw */ }
    return { ok: false, error: msg };
  }
  let text = '';
  try {
    const j = JSON.parse(body) as { content?: Array<{ type?: string; text?: string }> };
    text = (j.content ?? []).map((c) => c.text ?? '').join('');
  } catch { return { ok: false, error: 'unparseable API response' }; }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, error: 'no JSON in model output' };
  let examples: unknown;
  try { examples = (JSON.parse(m[0]) as { examples?: unknown }).examples; }
  catch { return { ok: false, error: 'malformed JSON in model output' }; }
  if (!Array.isArray(examples)) return { ok: false, error: 'missing examples[]' };
  const valid = examples
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length >= 6 && x.length <= 60)
    .filter((x) => scaffoldLineValid(p, x))
    .slice(0, SCAFFOLD_MAX);
  if (!valid.length) return { ok: false, error: '生成文がパターンを含んでいません（検証で全滅）' };
  return { ok: true, examples: valid };
}
