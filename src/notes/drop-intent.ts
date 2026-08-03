/**
 * drop-intent.ts — what a dropped thing IS, and therefore where it goes.
 *
 * The plugin has 63 commands. Every one of them is a road into the same chain
 * (§28: encounter → mark → reconcile → classify → attest → index → retrieve),
 * and on an iPad with a Pencil in your hand the command palette is the wrong
 * door for all of them. Dragging is the right door: you already have the thing
 * selected in the other Stage Manager pane, and the gesture that carries it
 * over is the same gesture in every app on the device.
 *
 * So this module answers one question — *given what was dropped, and where,
 * what could that possibly mean?* — and answers it as a RANKED LIST rather than
 * a guess, because the honest answer is usually "two or three things, and you
 * know which." The UI (`ui/drop-router.ts`) turns the list into targets; the
 * executor (main.ts `runDropIntent`) is the single road in that §28 S5 demands.
 *
 * Pure by construction: no DOM, no App, no fetch. `golden/drop-intent.mjs`
 * pins it against real URLs, real .srt text and real transcript lines.
 *
 * ## The preview asymmetry (the constraint that shapes everything here)
 *
 * While a drag is in flight the browser will NOT let you read the payload —
 * `DataTransfer.getData()` returns `''` until `drop` fires. All you get is
 * `types` and, for files, `items[].type`. So the same function has to answer
 * twice: once vaguely (`preview: true` — "a link, a picture, some text") to
 * paint the targets, and once concretely on drop. Intents are therefore keyed
 * by ACTION, not by content, so the target you aimed at during the vague pass
 * is still findable in the concrete one.
 */

import { parseYouTubeId } from './audio-provider.ts';

/** Where the drop landed. Surfaces offer different verbs for the same object. */
export type DropSurface =
  | 'lexicon'     // the 語彙 list — a phrase becomes a catalog entry
  | 'entry'       // ONE open catalog entry — a phrase becomes its 用例
  | 'tray'        // 収集トレイ — the holding pen, accepts literally anything
  | 'dict'        // 辞書 — a word becomes a lookup
  | 'x'           // 𝕏 — a phrase becomes a live corpus query
  | 'follow';     // 鑑賞モード — a link becomes the thing being watched

export type DropAction =
  | 'yt-transcript'   // YouTube link → fetch + freeze the transcript
  | 'yt-mark'         // YouTube link WITH ?t= → a mark at that second
  | 'x-post'          // x.com/…/status/… → pull the post into the corpus
  | 'subtitle'        // .srt/.vtt text or file → a transcript note
  | 'history'         // Takeout watch-history → batch transcripts
  | 'link'            // any other URL → the tray, with its host as origin
  | 'image-tray'      // image files → tray cards
  | 'image-ocr'       // image files → OCR'd tray cards (吹き出し extracted)
  | 'attest'          // Japanese text onto an open entry → a 用例
  | 'capture'         // Japanese text → ⚡ 分類キャプチャ
  | 'tray'            // anything → the tray
  | 'lookup'          // a word → the dictionary
  | 'x-search'        // a phrase → live X search
  | 'reach';          // non-Japanese → 願い (a meaning you can't yet say)

/** The parsed content an action needs. Only the fields its action reads. */
export interface DropPayload {
  /** the raw text as dropped, always present for text intents. */
  text?: string;
  url?: string;
  videoId?: string;
  /** seconds, from `?t=` / `&start=` / `#t=`. */
  tSec?: number;
  tweetId?: string;
  /** the .srt/.vtt body, when the drop WAS a subtitle file/paste. */
  srt?: string;
  /** file indices into the drop's own FileList — the executor re-reads them. */
  fileIdx?: number[];
  /** a suggested note title (episode name from the filename, video id, …). */
  title?: string;
}

export interface DropIntent {
  action: DropAction;
  /** the target's Japanese label — what the card says. */
  label: string;
  /** one line naming the concrete thing, or the kind of thing while previewing. */
  detail: string;
  icon: string;
  payload: DropPayload;
}

/** What we can see of the drop. During a drag only `kinds`/`fileTypes` exist. */
export interface DropSample {
  /** true while the drag is still in flight — payload unreadable by spec. */
  preview?: boolean;
  text?: string;
  uriList?: string;
  /** `DataTransfer.types`, always readable, even while previewing. */
  kinds?: readonly string[];
  /** name+MIME per dragged file. MIME is readable while previewing; name is not. */
  files?: ReadonlyArray<{ name?: string; type?: string }>;
}

export interface DropContext {
  surface: DropSurface;
  /** headword of the entry currently open — enables 用例 attachment. */
  entryKey?: string;
  /**
   * Capabilities. An action is never offered when it cannot possibly run —
   * §28 S6: no button that does nothing. `ocr` = a vision key is configured,
   * `x` = X cookies are set.
   */
  can?: { ocr?: boolean; x?: boolean };
}

const JP = /[぀-ゟ゠-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;
const URL_ONLY = /^https?:\/\/\S+$/;
/** A cue clock: `00:00:12,340 --> 00:00:14,120` (srt) or `.` (vtt). */
const CUE = /\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}/;
const X_STATUS = /(?:^|\/\/)(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/;

/** `?t=90` / `?t=1m30s` / `&start=90` / `#t=90` → seconds. Null if absent. */
export function parseTimeParam(url: string): number | null {
  const m = url.match(/[?&#](?:t|start|time_continue)=([0-9hms]+)/i);
  if (!m) return null;
  const raw = m[1];
  if (/^\d+$/.test(raw)) return Number(raw);
  const hms = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!hms || (!hms[1] && !hms[2] && !hms[3])) return null;
  return Number(hms[1] ?? 0) * 3600 + Number(hms[2] ?? 0) * 60 + Number(hms[3] ?? 0);
}

/** `{handle, id}` for an x.com/twitter.com status URL, else null. */
export function parseXStatus(url: string): { handle: string; id: string } | null {
  const m = url.match(X_STATUS);
  return m ? { handle: m[1], id: m[2] } : null;
}

/**
 * Does this text carry subtitle cues? Two is the floor: one `-->` can appear in
 * ordinary prose (an arrow in a note), two on separate lines cannot.
 */
export function looksLikeSubtitle(text: string): boolean {
  const hits = text.split('\n').filter((l) => CUE.test(l)).length;
  return hits >= 2;
}

/** A Google Takeout watch-history export (JSON array or the HTML page). */
export function looksLikeHistory(text: string): boolean {
  if (/"titleUrl"\s*:\s*"https?:\/\/www\.youtube\.com\/watch/.test(text)) return true;
  return /content-cell/.test(text) && /youtube\.com\/watch\?v=/.test(text) &&
    (text.match(/youtube\.com\/watch\?v=/g) ?? []).length >= 3;
}

/** Japanese present anywhere in the string. The gate for every catalog verb. */
export function hasJapanese(s: string): boolean { return JP.test(s); }

/** The first URL in a `text/uri-list` blob (`#` lines are comments, per RFC). */
export function firstUri(uriList: string | undefined): string | null {
  if (!uriList) return null;
  for (const raw of uriList.split(/\r?\n/)) {
    const l = raw.trim();
    if (l && !l.startsWith('#')) return l;
  }
  return null;
}

const IMG_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/i;
const SUB_EXT = /\.(srt|vtt)$/i;

function isImageFile(f: { name?: string; type?: string }): boolean {
  return (f.type ?? '').startsWith('image/') || IMG_EXT.test(f.name ?? '');
}
function isSubFile(f: { name?: string; type?: string }): boolean {
  return SUB_EXT.test(f.name ?? '');
}

/** A quotable one-liner for a card's `detail`, ellipsised at the grapheme level. */
function snip(s: string, n = 28): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return [...one].length <= n ? one : [...one].slice(0, n).join('') + '…';
}

/** The .srt/.vtt filename minus extension and the usual `.ja` language tag. */
export function titleFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/\.(ja|jpn|japanese)$/i, '').trim();
}

/**
 * Every action this drop could reasonably mean, best first.
 *
 * "Best" is decided by SPECIFICITY, never by surface preference: a YouTube link
 * dropped on the dictionary is still a YouTube link. The surface only decides
 * which *general* verbs are on offer (用例 needs an open entry; 辞書 wants a
 * word, not a paragraph) and it can add one, never reorder the specific ones.
 * That is what keeps the gesture predictable across five views.
 */
export function dropIntents(sample: DropSample, ctx: DropContext): DropIntent[] {
  const out: DropIntent[] = [];
  const seen = new Set<DropAction>();
  const push = (i: DropIntent): void => { if (!seen.has(i.action)) { seen.add(i.action); out.push(i); } };

  const files = sample.files ?? [];
  const preview = !!sample.preview;
  const text = (sample.text ?? '').trim();
  const uri = firstUri(sample.uriList);
  const kinds = sample.kinds ?? [];

  // ── files ────────────────────────────────────────────────────────────────
  // MIME survives the preview pass; names do not, so a preview can only say
  // "pictures" or "files", never "3 pages of ヒカルの碁".
  if (files.length) {
    const imgs = files.map((f, i) => ({ f, i })).filter((x) => isImageFile(x.f));
    const subs = files.map((f, i) => ({ f, i })).filter((x) => isSubFile(x.f));
    if (subs.length) {
      const first = subs[0].f.name ?? '';
      push({
        action: 'subtitle', icon: '📺', label: '字幕を取り込む',
        detail: first ? titleFromFilename(first) : `${subs.length}件の字幕ファイル`,
        payload: { fileIdx: subs.map((x) => x.i), title: first ? titleFromFilename(first) : undefined },
      });
    }
    if (imgs.length) {
      const n = imgs.length;
      if (ctx.can?.ocr) {
        push({
          action: 'image-ocr', icon: '🔎', label: 'OCRして取り込む',
          detail: n > 1 ? `${n}枚の吹き出しを抽出` : '吹き出しを抽出してトレイへ',
          payload: { fileIdx: imgs.map((x) => x.i) },
        });
      }
      push({
        action: 'image-tray', icon: '📷', label: 'トレイへ',
        detail: n > 1 ? `${n}枚をそのまま保管` : '画像をそのまま保管',
        payload: { fileIdx: imgs.map((x) => x.i) },
      });
    }
    // A file we have no verb for is still a thing that arrived: the tray takes
    // it rather than the drop silently doing nothing (§28 S6).
    if (!imgs.length && !subs.length) {
      push({
        action: 'tray', icon: '⤵', label: 'トレイへ',
        detail: preview ? 'ファイル' : files.map((f) => f.name ?? '?').join(', '),
        payload: { fileIdx: files.map((_, i) => i) },
      });
    }
    if (out.length) return out;
  }

  // ── links ────────────────────────────────────────────────────────────────
  // `uriList` is readable in neither pass, but its PRESENCE in `types` is — so
  // a preview over a dragged link can still show link verbs, generically.
  const linkish = uri ?? (URL_ONLY.test(text) ? text : null);
  if (preview && !linkish && kinds.includes('text/uri-list')) {
    push({
      action: 'link', icon: '🔗', label: 'リンクを取り込む',
      detail: 'YouTube・X・字幕は自動で振り分け',
      payload: {},
    });
    push({ action: 'tray', icon: '⤵', label: 'トレイへ', detail: 'あとで見る', payload: {} });
    return out;
  }

  if (linkish) {
    const url = linkish;
    const videoId = parseYouTubeId(url);
    const isYouTubeHost = /(?:^|\/\/|\.)(?:youtube\.com|youtu\.be)\//.test(url);
    if (videoId && isYouTubeHost) {
      const tSec = parseTimeParam(url) ?? undefined;
      if (tSec != null) {
        push({
          action: 'yt-mark', icon: '📍', label: 'この瞬間をマーク',
          detail: `${fmtClock(tSec)} — 文字起こしがあればその行へ`,
          payload: { url, videoId, tSec },
        });
      }
      push({
        action: 'yt-transcript', icon: '⏱', label: '文字起こしを取り込む',
        detail: `youtu.be/${videoId}`,
        payload: { url, videoId, ...(tSec != null ? { tSec } : {}) },
      });
    }
    const x = parseXStatus(url);
    if (x) {
      push({
        action: 'x-post', icon: '𝕏', label: '投稿を取り込む',
        detail: `@${x.handle} · ${x.id}`,
        payload: { url, tweetId: x.id },
      });
    }
    push({
      action: 'link', icon: '🔗', label: 'リンクを保管',
      detail: hostOf(url) ?? url,
      payload: { url, text: url },
    });
    return out;
  }

  // ── text ─────────────────────────────────────────────────────────────────
  if (preview) {
    // The vague pass. Offer the surface's own verbs plus the two universals,
    // so the target you aim at exists in the concrete pass as well.
    if (ctx.surface === 'entry' && ctx.entryKey) {
      push({
        action: 'attest', icon: '📎', label: '用例として添付',
        detail: `「${snip(ctx.entryKey, 14)}」の実例にする`,
        payload: {},
      });
    }
    push({ action: 'capture', icon: '⚡', label: '分類して台帳へ', detail: '6分類のキャプチャを開く', payload: {} });
    if (ctx.surface === 'dict') push({ action: 'lookup', icon: '🔍', label: '辞書で引く', detail: '見出しを探す', payload: {} });
    if (ctx.surface === 'x' && ctx.can?.x) push({ action: 'x-search', icon: '𝕏', label: 'X で検索', detail: '実際の使われ方を見る', payload: {} });
    push({ action: 'tray', icon: '⤵', label: 'トレイへ', detail: 'あとで分類する', payload: {} });
    return out;
  }

  if (!text) return out;

  // An Obsidian-internal drag (a note out of the file explorer) arrives as a
  // bare wikilink. We have no verb for it that beats Obsidian's own — and
  // returning nothing is what keeps the router from stealing that drop.
  if (/^!?\[\[[^\]]+\]\]$/.test(text)) return out;

  // A pasted subtitle body is a transcript, not a phrase — check before shape.
  if (looksLikeSubtitle(text)) {
    push({
      action: 'subtitle', icon: '📺', label: '字幕を取り込む',
      detail: `${text.split('\n').filter((l) => CUE.test(l)).length}行のキュー`,
      payload: { srt: text },
    });
    push({ action: 'tray', icon: '⤵', label: 'トレイへ', detail: '生のまま保管', payload: { text } });
    return out;
  }
  if (looksLikeHistory(text)) {
    push({
      action: 'history', icon: '📜', label: '視聴履歴を取り込む',
      detail: '見た動画の文字起こしをまとめて取得',
      payload: { text },
    });
    push({ action: 'tray', icon: '⤵', label: 'トレイへ', detail: '生のまま保管', payload: { text } });
    return out;
  }

  const jp = hasJapanese(text);
  const oneLine = text.replace(/\s+/g, '');
  const wordish = jp && [...oneLine].length <= 8 && !/[。！？、]/.test(oneLine);

  if (!jp) {
    // No Japanese at all. The honest reading of an English phrase the user
    // carried in is 願い — "here is a meaning I want and cannot yet say"
    // (§27.0.2) — not a catalog entry in a language it isn't written in.
    push({
      action: 'reach', icon: '🕯', label: '願いとして持つ',
      detail: `「${snip(text)}」— まだ言えない意味`,
      payload: { text },
    });
    push({ action: 'tray', icon: '⤵', label: 'トレイへ', detail: snip(text), payload: { text } });
    return out;
  }

  if (ctx.surface === 'entry' && ctx.entryKey) {
    push({
      action: 'attest', icon: '📎', label: '用例として添付',
      detail: `「${snip(ctx.entryKey, 14)}」の実例に — 確定済みとして入ります`,
      payload: { text },
    });
  }
  push({
    action: 'capture', icon: '⚡', label: '分類して台帳へ',
    detail: `「${snip(text)}」`,
    payload: { text },
  });
  if (wordish) {
    push({ action: 'lookup', icon: '🔍', label: '辞書で引く', detail: `「${oneLine}」を引く`, payload: { text: oneLine } });
  }
  if (ctx.can?.x) {
    push({ action: 'x-search', icon: '𝕏', label: 'X で検索', detail: '実際の使われ方を見る', payload: { text } });
  }
  push({ action: 'tray', icon: '⤵', label: 'トレイへ', detail: 'あとで分類する', payload: { text } });
  return out;
}

/** `M:SS` / `H:MM:SS` — the same clock the transcript prints. */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${m}:${String(ss).padStart(2, '0')}`;
}

function hostOf(url: string): string | null {
  const m = url.match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].replace(/^www\./, '') : null;
}
