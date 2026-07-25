/**
 * ContextWindow — render ANY attestation as its real transcript context
 * (DESIGN §20.2). Replaces raw `![[file#^anchor]]` embeds everywhere: the
 * same component serves LibraryView cards and LexiconPanel context leaves,
 * and that sameness is the "seamless" part.
 *
 * Behavior:
 *  - reads the transcript, builds a ±2-turn window via the PURE
 *    context-window core (ratified 談話モード turns/speakers when present)
 *  - highlights the pattern inflection-aware, dims context turns
 *  - ▶ audio in place: host-managed (clip if downloaded, deep-link tier
 *    otherwise — same plumbing the library already has)
 *  - degrades honestly: file missing or span unlocatable → the stored quote,
 *    marked as such. NEVER a wrong window, never a broken-embed box.
 */

import type { App } from 'obsidian';
import type { Attestation } from '../notes/pattern-store.ts';
import type { MatcherLine } from '../notes/local-matcher.ts';
import { buildContextWindow, buildProseWindow, type SegLike } from '../notes/context-window.ts';

export interface ContextWindowDeps {
  app: App;
  parseLines: (md: string) => MatcherLine[];
  loadSeg: (path: string) => SegLike | null;
  /** host-managed playback (detached <audio>, survives re-renders). */
  onAudio?: (att: Attestation, btn: HTMLElement) => void;
  /** jump to the source block/timestamp. */
  onOpen?: (att: Attestation) => void;
  /** §22.2 manga: the OCR'd bubbles of a stored panel image (reading order),
   *  while the tray card still knows them. null = only the captured bubble. */
  bubblesFor?: (imagePath: string) => Array<{ text: string; bbox: [number, number, number, number] }> | null;
}

const fmtTime = (sec: number): string => {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const norm = (s: string): string => s.replace(/\s+/g, '');

/** §22.2 manga renderer: panel image + bbox highlight; neighbor bubbles as
 *  tappable text (tapping one slides the highlight to ITS bbox — peeking at
 *  where each line lives in the panel). */
function renderMangaWindow(el: HTMLElement, att: Attestation, deps: ContextWindowDeps): void {
  const scene = att.scene!;
  const wrap = el.createDiv({ cls: 'jp-ctx-manga' });
  const frame = wrap.createDiv({ cls: 'jp-ctx-manga-frame' });
  const img = frame.createEl('img', { cls: 'jp-ctx-manga-img' });
  try { img.src = deps.app.vault.adapter.getResourcePath(scene.image!); } catch { /* broken path → alt box */ }
  img.setAttribute('alt', att.quote);
  const box = frame.createDiv({ cls: 'jp-ctx-manga-bbox' });
  const placeBox = (bbox?: [number, number, number, number]): void => {
    if (!bbox) { box.hide(); return; }
    box.show();
    box.style.left = `${bbox[0] / 10}%`;
    box.style.top = `${bbox[1] / 10}%`;
    box.style.width = `${bbox[2] / 10}%`;
    box.style.height = `${bbox[3] / 10}%`;
  };
  placeBox(scene.bbox);

  const cap = wrap.createDiv({ cls: 'jp-ctx-manga-cap' });
  cap.createSpan({ text: `「${att.quote}」`, cls: 'jp-ctx-quote-text' });
  if (scene.sourceName) cap.createSpan({ text: `🗨 ${scene.sourceName}`, cls: 'jp-ctx-quote-why' });

  // neighbor bubbles in reading order, while the OCR'd tray card remembers them
  const bubbles = deps.bubblesFor?.(scene.image!) ?? null;
  if (bubbles && bubbles.length > 1) {
    const nb = wrap.createDiv({ cls: 'jp-ctx-manga-bubbles' });
    for (const b of bubbles) {
      const isAnchor = norm(b.text) === norm(att.quote);
      const chip = nb.createEl('button', {
        text: b.text,
        cls: 'jp-ctx-manga-bubble' + (isAnchor ? ' jp-ctx-manga-bubble--anchor' : ''),
        attr: { title: 'タップでこの吹き出しの位置をハイライト' },
      });
      chip.onclick = (e) => { e.stopPropagation(); placeBox(b.bbox); };
    }
  }
}

/** Render the window into `el` (async: reads the vault). */
export async function renderContextWindow(
  el: HTMLElement,
  att: Attestation,
  highlightTerms: string[],
  deps: ContextWindowDeps,
): Promise<void> {
  el.addClass('jp-ctx');

  const fallback = (reason: 'no-file' | 'not-located'): void => {
    const q = el.createDiv({ cls: 'jp-ctx-quote-only' });
    q.createSpan({ text: `「${att.quote}」`, cls: 'jp-ctx-quote-text' });
    // curated attestations (dict/corpus) have no vault file BY DESIGN — the
    // entry is the scene; show its address, not an apology
    const m = att.medium ?? att.source;
    if ((m === 'dict' || m === 'corpus') && att.scene?.sourceName) {
      q.createSpan({
        text: `${m === 'dict' ? '📖' : '📊'} ${att.scene.sourceName}${att.scene.loc ? `「${att.scene.loc}」` : ''}`,
        cls: 'jp-ctx-quote-why',
      });
    } else {
      q.createSpan({
        text: reason === 'no-file' ? '（元ファイルなし — 保存済み引用）' : '（位置未特定 — 保存済み引用）',
        cls: 'jp-ctx-quote-why',
      });
    }
  };

  const medium = att.medium ?? att.source;

  // §22.2 manga: the PANEL is the context — the image with the captured
  // bubble highlighted, neighbor bubbles as tappable text below. Text-only
  // context is a lossy projection, never the primary rendering.
  if (medium === 'manga' && att.scene?.image) {
    renderMangaWindow(el, att, deps);
    return;
  }

  let md: string | null = null;
  if (att.file && !/^https?:\/\//.test(att.file)) {
    try {
      const f = deps.app.vault.getFileByPath(att.file);
      md = f ? await deps.app.vault.cachedRead(f) : null;
    } catch { md = null; }
  }
  if (md == null) { fallback('no-file'); return; }

  // §22.2 written mediums: the paragraph is the context — prose, not turns
  if (medium === 'book' || medium === 'note') {
    const pw = buildProseWindow({ body: md, att: { quote: att.quote }, highlightTerms });
    if (!pw.located) { fallback('not-located'); return; }
    const wrap = el.createDiv({ cls: 'jp-ctx-prose' });
    for (const para of pw.paras) {
      const p = wrap.createEl('p', { cls: `jp-ctx-para${para.isAnchor ? ' jp-ctx-para--anchor' : ''}` });
      for (const seg of para.segments) {
        if (seg.hit) p.createEl('mark', { text: seg.text, cls: 'jp-ctx-hit' });
        else p.appendText(seg.text);
      }
    }
    const src = wrap.createDiv({ cls: 'jp-ctx-prose-src' });
    src.createSpan({ text: `${medium === 'book' ? '📕' : '📝'} ${att.scene?.sourceName ?? ''}${att.scene?.loc ? `（${att.scene.loc}）` : ''}` });
    if (att.scene?.deepLink) {
      const door = src.createEl('a', { text: '↪ 開く', href: att.scene.deepLink, cls: 'jp-ctx-door' });
      door.setAttribute('aria-label', '元の場所へ戻る');
    }
    return;
  }

  const lines = deps.parseLines(md);
  const w = buildContextWindow({
    lines,
    att: { tStartSec: att.tStartSec, quote: att.quote },
    seg: att.file ? deps.loadSeg(att.file) : null,
    highlightTerms,
  });
  if (!w.located) { fallback('not-located'); return; }

  // §22.2: machine-heard transcripts are honestly marked — the ⚙ badge rides
  // every attestation whose scene is a generated (whisper/sherpa) transcript.
  const gen = md.match(/^generated:\s*(?!pending\s*$)(\S+)\s*$/m);
  if (gen) {
    el.createDiv({
      cls: 'jp-ctx-gen',
      text: `⚙ 機械聴取（${gen[1]}生成 — 誤聴あり得ます）`,
    });
  }

  for (const turn of w.turns) {
    const row = el.createDiv({ cls: `jp-ctx-turn${turn.isAnchor ? ' jp-ctx-turn--anchor' : ''}` });
    if (turn.speaker) row.createSpan({ text: turn.speaker, cls: 'jp-ctx-speaker' });
    const body = row.createSpan({ cls: 'jp-ctx-text' });
    for (const seg of turn.segments) {
      if (seg.hit) body.createEl('mark', { text: seg.text, cls: 'jp-ctx-hit' });
      else body.appendText(seg.text);
    }
    if (turn.isAnchor) {
      const meta = row.createSpan({ cls: 'jp-ctx-meta' });
      if (turn.tStartSec != null) meta.createSpan({ text: fmtTime(turn.tStartSec), cls: 'jp-ctx-time' });
      if (deps.onAudio && att.tStartSec != null) {
        const play = meta.createEl('button', { text: '▶', cls: 'jp-ctx-play' });
        play.setAttribute('aria-label', '音声を再生（クリップがあれば即時、なければディープリンク）');
        play.onclick = (e) => { e.stopPropagation(); deps.onAudio?.(att, play); };
      }
      if (deps.onOpen) {
        const open = meta.createEl('button', { text: '↪', cls: 'jp-ctx-open' });
        open.setAttribute('aria-label', '原文へジャンプ');
        open.onclick = (e) => { e.stopPropagation(); deps.onOpen?.(att); };
      }
    }
  }
}
