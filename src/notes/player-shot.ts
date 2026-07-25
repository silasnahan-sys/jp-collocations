/**
 * player-shot.ts — the podcast player-screenshot recognizer (DESIGN §25.3).
 * PURE parse + matching — golden/follow.mjs; the vision call is wired in
 * main.ts with the same pinned client as manga/handwriting.
 *
 * The screenshot IS the mark: the Apple Podcasts now-playing screen (lock
 * screen included) shows episode title + elapsed time on the scrub bar.
 * This module reads them out of the model's JSON and resolves the episode
 * against the vault's `source: podcast` transcript notes.
 */

import { OCR_MODEL_DEFAULT } from './claude-client.ts';

export const PLAYER_MODEL = OCR_MODEL_DEFAULT;   // one pinned place, shared

export const PLAYER_PROMPT = [
  'これは音声プレイヤー（Apple Podcasts等）の画面のスクリーンショットです。',
  '再生中のエピソードを読み取ってください:',
  '- episode: エピソードのタイトル（画面に見えるまま）',
  '- show: 番組名（見えれば）',
  '- elapsed: シークバー左側の経過時間（"MM:SS" または "H:MM:SS"、マイナス記号の付いた残り時間ではなく左側の経過時間）',
  '経過時間が画面に見えない場合は elapsed を null にしてください。',
  'JSONのみで返答: {"episode":"…","show":"…","elapsed":"12:34"}',
].join('\n');

export interface PlayerShot {
  episode: string;
  show?: string;
  /** null = the player chrome showed no elapsed time (mark stays coarse). */
  elapsedSec: number | null;
}

export type PlayerShotResult = { ok: true; shot: PlayerShot } | { ok: false; error: string };

/** "12:34" / "1:02:33" → seconds. Rejects remaining-time ("-12:34") and junk. */
export function parseElapsed(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!/^\d{1,2}(:\d{2}){1,2}$/.test(t)) return null;
  return t.split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0);
}

export function parsePlayerShot(status: number, body: string): PlayerShotResult {
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
  let raw: { episode?: unknown; show?: unknown; elapsed?: unknown };
  try { raw = JSON.parse(m[0]) as typeof raw; }
  catch { return { ok: false, error: 'malformed JSON in model output' }; }
  if (typeof raw.episode !== 'string' || !raw.episode.trim()) {
    return { ok: false, error: 'エピソード名を読み取れませんでした' };
  }
  return {
    ok: true,
    shot: {
      episode: raw.episode.trim(),
      show: typeof raw.show === 'string' && raw.show.trim() ? raw.show.trim() : undefined,
      elapsedSec: parseElapsed(raw.elapsed),
    },
  };
}

// ── episode → transcript-note matching ──────────────────────────────────────

const norm = (s: string): string =>
  s.normalize('NFKC').toLowerCase().replace(/[\s　]+/g, '')
    .replace(/[「」『』【】()（）\[\]。、・♯#＃!！?？…〜~\-—–]/g, '');

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/**
 * Best matching podcast note for a screenshotted episode title: exact →
 * containment → char-bigram Dice ≥ 0.5. Screenshots truncate titles with
 * 「…」, so containment carries most real cases. Returns null rather than a
 * confident wrong pick.
 */
export function matchEpisodeNote<T extends { title: string }>(episode: string, notes: T[]): T | null {
  const e = norm(episode.replace(/[…⋯]+$/, ''));
  if (!e) return null;
  let best: T | null = null;
  let bestScore = 0;
  for (const n of notes) {
    const t = norm(n.title);
    if (!t) continue;
    let score = 0;
    if (t === e) score = 1;
    else if (t.includes(e) || e.includes(t)) score = 0.9;
    else {
      const a = bigrams(e), b = bigrams(t);
      let inter = 0;
      for (const g of a) if (b.has(g)) inter++;
      score = a.size + b.size ? (2 * inter) / (a.size + b.size) : 0;
      if (score < 0.5) score = 0;
    }
    if (score > bestScore) { bestScore = score; best = n; }
  }
  return best;
}
