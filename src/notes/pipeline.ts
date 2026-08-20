/**
 * pipeline.ts — reconciliation orchestrator (DESIGN §5, text-note path §10).
 *
 * Pure and Obsidian-free so it runs in the golden harness. Takes note phrases +
 * a transcript, runs the LocalMatcher, and produces reconciled results + a
 * Markdown report shaped like `samplenotes-reconciled.md`. The Obsidian command
 * (main.ts) reads/writes vault files and injects the DictionaryStore resolver.
 */

import { match, matchGapped, type MatcherLine, type ReadingResolver, type Correction, type MatchSpan } from './local-matcher.ts';

/** Below this combined confidence a result is flagged for human review (DESIGN §5/#7). */
export const RECONCILE_THRESHOLD = 0.7;

export interface ReconciledResult {
  note: string;                 // the user's raw phrase
  best: MatchSpan | null;
  tStartSec: number | null;
  reconciled: string;           // the located transcript span (the anchor / "校正")
  confidence: number;
  status: 'auto' | 'needs-review';
  corrections: Correction[];
  contextBefore: string[];
  contextAfter: string[];
  alternatives: MatchSpan[];
}

/** Caption stamp, optionally a markdown LINK stamp as produced by copy-transcript
 *  browser tools: `[MM:SS]` / `[H:MM:SS]` / `[MM:SS](https://youtu.be/…?t=N)`.
 *  Groups: 1=h?, 2=m, 3=s, 4=rest-of-line. Shared with transcript-anchor.ts —
 *  the two files MUST agree on what counts as a transcript line. */
export const CAPTION_STAMP_RE = /\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\](?:\((?:https?|obsidian):[^)\s]*\))?\s*(.*)/;

/** Strip non-speech noise and inline markup from a caption line so the MATCHER
 *  sees only spoken text. Real vault transcripts carry `[音楽]`-style cue tags,
 *  user highlights (`<mark …>…</mark>`, `==…==`), strikethroughs, wikilinks and
 *  HTML entities — none of that is speech. Raw lines are never modified; this
 *  cleaning exists only in matching space. */
export function cleanCaptionText(s: string): string {
  return s
    .replace(/\[(?:音楽|拍手|笑い?|Music|Applause|Laughter)\]/gi, '')
    .replace(/<[^>\n]*>/g, '')                        // html tags (mark/br/span…)
    .replace(/\[\[([^\]|\n]*)\|([^\]\n]*)\]\]/g, '$2') // [[target|alias]] → alias
    .replace(/\[\[([^\]\n]*)\]\]/g, '$1')             // [[target]] → target
    .replace(/\[([^\]\n]*)\]\((?:https?|obsidian):[^)\s]*\)/g, '$1') // md links → text
    .replace(/~~|==|\*\*|%%/g, '')                    // marker pairs
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
}

/** Diarized speaker prefix on a stamped line: `A: 続きの発話…` (§23.4-3 — the
 *  sherpa tier writes single letters A–H; anything longer is content, and 全角
 *  ：is accepted since IMEs produce it). The prefix is data, not speech. */
const SPEAKER_PREFIX_RE = /^([A-H])[:：]\s*/;

/** Parse a transcript markdown into timestamped lines. Handles inline caption
 *  stamps `[HH:MM:SS]` / `[MM:SS]` (bare or link-wrapped) and the diarized
 *  `[HH:MM:SS] A: …` speaker-letter form; falls back to untimed lines. */
export function parseTranscriptLines(md: string): MatcherLine[] {
  const lines: MatcherLine[] = [];
  let idx = 0;
  let sawStamp = false;
  for (const rawLn of md.split('\n')) {
    const m = rawLn.match(CAPTION_STAMP_RE);
    if (m) {
      sawStamp = true;
      const h = m[1] ? +m[1] : 0;
      let text = cleanCaptionText(m[4] || '');
      let speaker: string | undefined;
      const sp = text.match(SPEAKER_PREFIX_RE);
      if (sp) { speaker = sp[1]; text = text.slice(sp[0].length); }
      if (text) lines.push({ index: idx++, tStartSec: h * 3600 + +m[2] * 60 + +m[3], text, ...(speaker ? { speaker } : {}) });
    }
  }
  if (sawStamp) return lines;
  // no timestamps: treat each non-empty, non-heading line as an untimed line
  for (const rawLn of md.split('\n')) {
    const t = rawLn.trim();
    if (!t || t.startsWith('#') || t.startsWith('---')) continue;
    lines.push({ index: idx++, text: cleanCaptionText(t) || t });
  }
  return lines;
}

/** First YouTube video id found in a document BODY (linked timestamps, bare
 *  URLs). Fallback for transcripts that carry no frontmatter at all. */
export function bodyVideoId(md: string): string | null {
  const m = md.match(/https?:\/\/(?:www\.)?(?:youtu\.be\/|youtube\.com\/(?:watch\?[^)\s]*?v=|shorts\/|live\/|embed\/))([\w-]{11})/);
  return m ? m[1] : null;
}

/** Pull the `source:` transcript reference out of YAML frontmatter, if present. */
export function frontmatterSource(md: string): string | null {
  return frontmatterSources(md)[0] ?? null;
}

/**
 * ALL transcript references in the frontmatter — one handwritten page often
 * spans several videos. Accepted shapes:
 *   sources: [[A]]
 *   sources: [[A]], [[B]]
 *   sources:
 *     - [[A]]
 *     - [[B]]
 *   source: [[A]]            ← LEGACY, and only when the value is a wikilink
 *
 * ## Why the singular key is conditional
 *
 * The key regex used to be `sources?(_transcript)?:`, which matched the
 * SINGULAR `source:` unconditionally. That was deliberate — `ensureSourceFrontmatter`
 * writes `source: [[basename]]`, and golden/capture-frontmatter.mjs pins that
 * those notes must keep resolving. But the same key is ALSO the medium tag that
 * every transcript this plugin writes carries: `source: yt` / `tv` (Plex,
 * jimaku) / `podcast` / `book` / `note`.
 *
 * So the ⚡ gate accepted every transcript in the vault as a capture note and
 * then failed downstream at `getFirstLinkpathDest('tv')` — or, in a vault
 * holding a note actually named `tv`/`yt`/`book`, resolved it and reconciled a
 * transcript against something unrelated. `captureNoteFromTranscript` had to
 * hand-roll a plural-only regex to dodge it rather than fix this function.
 *
 * The two cases are distinguishable by SHAPE, not by key: a note reference is a
 * `[[wikilink]]`; a medium tag is a bare word. So the singular is accepted only
 * when it carries a wikilink. Legacy capture notes keep working, transcripts
 * stop being mistaken for them, and `frontmatterMedium` reads the other case.
 */
export function frontmatterSources(md: string): string[] {
  const fm = md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return [];
  const out: string[] = [];
  // Obsidian's Properties panel wraps values in quotes ('"[[X]]"'), users add
  // their own, and whitespace hides between the layers — strip ITERATIVELY
  // until stable, or mixed nesting like `' "[[X]]"'` survives one pass mangled.
  const push = (raw: string) => {
    let v = raw;
    for (let prev = ''; v !== prev;) {
      prev = v;
      v = v.trim().replace(/^["'\[]+|["'\]]+$/g, '');
    }
    if (v) out.push(v);
  };
  const collect = (key: RegExp, linkOnly: boolean) => {
    // horizontal whitespace ONLY after the colon — `\s*` would swallow the
    // newline and make an empty `sources:` (list form) capture the next line
    const inline = fm[1].match(new RegExp(`^\\s*${key.source}:[^\\S\\r\\n]*(\\S.*?)\\s*$`, 'm'));
    if (inline && (!linkOnly || inline[1].includes('[['))) {
      for (const part of inline[1].split(',')) push(part);
    }
    const list = fm[1].match(new RegExp(`^\\s*${key.source}:\\s*$\\r?\\n((?:\\s*-\\s*.+\\r?\\n?)+)`, 'm'));
    // A list under either key is a reference list by construction — a medium tag
    // is never written as a one-item YAML sequence.
    if (list) for (const ln of list[1].split('\n')) push(ln.replace(/^\s*-\s*/, ''));
  };
  collect(/sources(?:_transcript)?/, false);
  collect(/source(?:_transcript)?/, true);
  return [...new Set(out)];
}

/**
 * The SINGULAR `source:` read as what it is on a transcript — the MEDIUM tag
 * (`yt` / `tv` / `podcast` / `book` / `note` / `x` / `web`). Returns null when
 * the value is a wikilink, because that is the legacy capture-note shape and
 * belongs to `frontmatterSources`, not here.
 */
export function frontmatterMedium(md: string): string | null {
  const fm = md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const m = fm[1].match(/^\s*source:[^\S\r\n]*(\S.*?)\s*$/m);
  if (!m) return null;
  const v = m[1].replace(/^["']|["']$/g, '').trim();
  return !v || v.includes('[[') ? null : v;
}

/** True when this note is a CAPTURE note — it names other notes as sources.
 *  The one test `captureNoteFromTranscript` needs, so it no longer has to
 *  re-implement the frontmatter parse to avoid the singular-key bug. */
export function isCaptureNote(md: string): boolean {
  return frontmatterSources(md).length > 0;
}

/** Read a single scalar `key: value` from the leading YAML frontmatter block.
 *  Parses the raw text (not Obsidian's metadataCache), so it works even when the
 *  cache is stale right after an edit. Returns the unquoted value or null. */
export function frontmatterField(md: string, key: string): string | null {
  const fm = md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const safeKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = fm[1].match(new RegExp(`^\\s*${safeKey}:\\s*(.+?)\\s*$`, 'm'));
  if (!m) return null;
  return m[1].replace(/^["'[]+|["'\]]+$/g, '').trim() || null;
}

/** First non-null frontmatter value among several candidate keys. */
export function frontmatterAny(md: string, keys: string[]): string | null {
  for (const k of keys) {
    const v = frontmatterField(md, k);
    if (v) return v;
  }
  return null;
}

/**
 * Beyond this a line is a paragraph, not a phrase you reach for.
 *
 * Measured against the real catalog rather than guessed: 95% of genuine
 * noticings are ≤25 characters and the longest defensible one is 136. The
 * ceiling sits well clear of that so it only ever catches pathological input —
 * a 343-character ASR run-on that had been stored as a single headword, and was
 * wide enough on screen to paint over four rows beneath it.
 */
const MAX_PHRASE_LEN = 160;

/**
 * Lines this plugin wrote itself, which must never come back in as noticings.
 *
 * `⚡ 照合` scans a notes file for phrases; nothing stopped it scanning a file
 * the plugin GENERATED. So the anchors, correction marks and cloze fronts that
 * `cards.ts` and this module emit were read back as things the user had
 * noticed, and 11.5% of the catalog became furniture: `⏱原文:![[Transcripts/…]]`
 * standing as a headword, `▶YouTube(156:11):https://…` as another.
 *
 * Every pattern here matches a string THIS CODEBASE emits, so it is a closed
 * set rather than a guess about Japanese. Each one is anchored and specific: a
 * bare `▶` or `📄` is left alone, because a person may well write one.
 */
const GENERATED_LINE: RegExp[] = [
  /^⏱\s*原文\s*[:：]/u,                                   // cards.ts renderAnchor
  /^▶\s*YouTube\s*[（(]/u,                                 // cards.ts deep link
  /^メモ\(raw\)\s*[:：]/u,                                  // cards.ts / this module
  /^⚠️?\s*(?:同音校正|漢字違い|相違)\s*[:：]/u,              // correction marks
  /^続き\s*[:：]/u,                                         // discourse card back
  /【_+】/u,                                                // a cloze card's blank
  /^\?$/u,                                                  // the cloze separator
  /^(?:成分|型|レンマ|ハロー)\s*[:：]/u,                     // payload lines (scaffold.ts)
];

/**
 * Is this line the plugin's own output, or otherwise structurally incapable of
 * being a noticing? Exported because the ingest gate and the retroactive
 * cleanup MUST agree — a rule that only runs on new data leaves the old junk
 * sitting in the index forever, and two copies of the rule drift apart.
 */
export function looksGenerated(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (t.length > MAX_PHRASE_LEN) return true;
  if (GENERATED_LINE.some((re) => re.test(t))) return true;
  // An embed or a URL ANYWHERE, not merely as the whole line: the junk keys all
  // carried a prefix (`⏱原文:![[…]]`), which is exactly how they slipped past
  // the old whole-line test.
  if (/!?\[\[[^\]]*\]\]/.test(t) || /https?:\/\//.test(t)) return true;
  // A tweet body, pasted whole. The X join stores the post as its own card; the
  // first line of one is not a pattern.
  if (/^@[A-Za-z0-9_]{2,15}[「（\s]/u.test(t)) return true;
  // OCR'd English with its spaces eaten ("Asheadofthesalessection…"). Latin,
  // unbroken, and far past any real word — a scan artefact, not a phrase.
  if (t.length > 40 && /^[\x20-\x7E]+$/.test(t) && !/\s/.test(t)) return true;
  return false;
}

/** Extract candidate note phrases from a notes file: plain text lines, list
 *  items, and callout bodies — skipping frontmatter, headings, and blockquotes. */
export function extractNotePhrases(md: string): string[] {
  const body = md.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const out: string[] = [];
  for (const rawLn of body.split('\n')) {
    let t = rawLn.trim();
    if (!t || t.startsWith('#') || t.startsWith('>') || t.startsWith('---') || t.startsWith('```')) continue;
    t = t.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '').replace(/^\[[ x]\]\s+/, '');
    t = t.replace(/[*_`~]/g, '').trim();
    // Not notes: image/file embeds, bare links, %%comments%%, and — the reason
    // this gate exists — anything the plugin printed itself.
    if (/^%%.*%%$/.test(t) || looksGenerated(t)) continue;
    if (t.length >= 2) out.push(t);
  }
  return out;
}

/** Reconcile note phrases against a transcript. */
export function reconcile(notes: string[], lines: MatcherLine[], readingOf?: ReadingResolver): ReconciledResult[] {
  return notes.map((note) => reconcileOne(note, lines, readingOf));
}

/** Like `reconcile`, but yields to the event loop between notes so a long run
 *  (real transcripts are 100k+ chars) never freezes the Obsidian UI thread.
 *  `onProgress` lets the caller update a Notice. */
export async function reconcileAsync(
  notes: string[], lines: MatcherLine[], readingOf?: ReadingResolver,
  onProgress?: (done: number, total: number) => void,
): Promise<ReconciledResult[]> {
  const out: ReconciledResult[] = [];
  for (let i = 0; i < notes.length; i++) {
    out.push(reconcileOne(notes[i], lines, readingOf));
    onProgress?.(i + 1, notes.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

/**
 * Multi-source reconcile: each phrase is matched against EVERY transcript and
 * assigned to the one where it scores best (a handwritten page can span
 * multiple videos). Yields between notes like `reconcileAsync`. Returns the
 * results grouped per source, index-aligned with `sources`.
 */
export async function reconcileMultiAsync(
  notes: string[], sources: MatcherLine[][], readingOf?: ReadingResolver,
  onProgress?: (done: number, total: number) => void,
): Promise<ReconciledResult[][]> {
  const grouped: ReconciledResult[][] = sources.map(() => []);
  for (let i = 0; i < notes.length; i++) {
    let best: ReconciledResult | null = null;
    let bestIdx = 0;
    for (let s = 0; s < sources.length; s++) {
      const r = reconcileOne(notes[i], sources[s], readingOf);
      // strictly-better keeps ties on the FIRST source (stable, deterministic)
      if (!best || r.confidence > best.confidence) { best = r; bestIdx = s; }
    }
    if (best) grouped[bestIdx].push(best);
    onProgress?.(i + 1, notes.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return grouped;
}

/**
 * Split a handwritten note into pattern PARTS. In this notation a dash/wave
 * between expressions means "…the speaker's words here…" — the note is one
 * correlative pattern whose parts appear near each other in the transcript
 * (`んだったら〜なきゃ`). Interior whitespace acts the same way in
 * Japanese-only notes (`が違えば　と思う一方で`). Returns [note] when the
 * note is a single contiguous quote.
 */
export function splitPatternParts(note: string): string[] {
  let parts = note.split(/\s*[〜~→⇒]+\s*|\s*(?:…|⋯|・・・)\s*/).filter((p) => p.trim().length > 0);
  // whitespace as connector — but never inside English text
  if (parts.length === 1 && !/[a-zA-Z]/.test(note)) {
    parts = note.split(/[\s　]+/).filter((p) => p.length > 0);
  }
  parts = parts.map((p) => p.trim()).filter((p) => p.length >= 2);
  return parts.length >= 2 && parts.length <= 4 ? parts : [note.trim()];
}

/**
 * ONE alphabet for splitting a NOTATION FIELD (成分リンク / 型) into parts.
 *
 * Derive (`splitPatternParts`, above) and save used to split on two different
 * alphabets: derive knew 〜 ~ → ⇒ … but not 、。; save knew 〜 ~ , 、 but not
 * → ⇒ — so a headword built with → was understood on the way in and silently
 * glued into one part on the way out (filmed, IMG_1082/1083). This is the one
 * splitter for anything the user writes AS notation. It differs from
 * `splitPatternParts` on purpose in one way only: 、 and 。 count as joins
 * here, because in a notation field the user writes them to SAY how the parts
 * meet — while in free text (derive's input) a comma is just a comma, and
 * treating it as a join would turn every ordinary sentence into a 🟠 link.
 *
 * The parenthesized boundary forms (。)/（。） are the user's own invention
 * (IMG_1082, typed keystroke by keystroke): "the join crosses a sentence end."
 * They are joins too — never part material — and `notationCrossesSentence`
 * reports that they were present so the entry can carry the fact.
 */
const NOTATION_JOIN_RE = /\s*(?:（。）|\(。\)|（、）|\(、\)|[〜~→⇒,、。]|…|⋯|・・・)+\s*/;
const NOTATION_CROSS_RE = /（。）|\(。\)|。/;

export function splitNotationParts(s: string): string[] {
  return s.split(NOTATION_JOIN_RE).map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Did the notation declare a sentence-boundary join ((。), （。） or a bare 。)? */
export function notationCrossesSentence(s: string): boolean {
  return NOTATION_CROSS_RE.test(s);
}

export function reconcileOne(note: string, lines: MatcherLine[], readingOf?: ReadingResolver): ReconciledResult {
  const contiguous = match(note, lines, readingOf);
  // AMBIGUITY: a short/generic fragment (また、なきゃ…) scores "perfectly" at
  // dozens of positions — the top hit is then an arbitrary pick, not a located
  // quote. When the runner-up is essentially as good as the winner, the match
  // is ambiguous and must NOT count as auto, whatever its raw score.
  const ambiguous = !!contiguous.best && contiguous.alternatives.length > 0 &&
    contiguous.alternatives[0].score >= Math.max(0.9, contiguous.best.score - 0.02);
  let r = contiguous;
  let auto = !!r.best && r.confidence >= RECONCILE_THRESHOLD && !ambiguous;

  // Connected-pattern path: the parts are located together (each pinning the
  // others), so the ambiguity veto does not apply — co-occurrence IS the
  // disambiguation.
  const parts = splitPatternParts(note);
  if (parts.length >= 2) {
    const gapped = matchGapped(parts, lines, readingOf);
    const gappedAuto = !!gapped.best && gapped.confidence >= RECONCILE_THRESHOLD;
    if (gapped.best && (gappedAuto && !auto || gapped.confidence > r.confidence)) {
      r = gapped;
      auto = gappedAuto;
    }
  }
  const status: 'auto' | 'needs-review' = auto ? 'auto' : 'needs-review';
  return {
    note,
    best: r.best,
    tStartSec: r.best?.tStartSec ?? null,
    reconciled: r.best?.text ?? '',
    confidence: r.confidence,
    status,
    corrections: r.corrections,
    contextBefore: r.contextBefore,
    contextAfter: r.contextAfter,
    alternatives: r.alternatives,
  };
}

const fmtTime = (s: number | null): string =>
  s == null ? '??:??' : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** Render results as a Markdown report (shape of samplenotes-reconciled.md). */
export function renderReport(results: ReconciledResult[], opts: { sourceLabel?: string; transcriptRef?: string } = {}): string {
  const auto = results.filter((r) => r.status === 'auto').length;
  const review = results.length - auto;
  const out: string[] = [];
  out.push('---');
  if (opts.transcriptRef) out.push(`source: ${opts.transcriptRef}`);
  if (opts.sourceLabel) out.push(`source_media: ${opts.sourceLabel}`);
  out.push(`reconciled: ${results.length} notes — ${auto} auto, ${review} needs-review`);
  out.push('generated: jp-collocations reconciliation pipeline');
  out.push('---');
  out.push('');
  out.push('# 照合ノート（自動生成）');
  out.push('');
  out.push('> 各ノート = あなたのメモを文字起こし（＝実際に言われたこと）で位置づけ・校正したもの。');
  out.push('> ⚠️ = 校正候補（要確認）。確信度が低いものは needs-review。');
  out.push('');

  results.forEach((r, i) => {
    const flag = r.status === 'needs-review' ? ' 🔶 要確認' : '';
    out.push(`## ${i + 1}. ${r.note}${flag}`);
    out.push(`- **メモ(raw):** ${r.note}`);
    if (r.best) {
      out.push(`- **校正(located):** ${r.reconciled}`);
      out.push(`- **時刻:** ~${fmtTime(r.tStartSec)} ｜ 確信度: ${(r.confidence * 100).toFixed(0)}% ｜ ${r.status}`);
      if (r.contextBefore.length || r.contextAfter.length) {
        const ctx = [...r.contextBefore.map((c) => `…${c}`), `**${r.reconciled}**`, ...r.contextAfter.map((c) => `${c}…`)].join(' / ');
        out.push(`- **文脈:** ${ctx}`);
      }
      for (const c of r.corrections) {
        const mark = c.kind === 'homophone' ? '⚠️ 同音校正' : c.kind === 'kanji-swap' ? '⚠️ 漢字違い' : '⚠️ 相違';
        out.push(`- ${mark}: 「${c.noteText}」→「${c.transcriptText}」（${c.reason}）`);
      }
    } else {
      out.push('- **校正:** （対応が見つかりません — 要確認）');
    }
    out.push('');
  });
  return out.join('\n');
}
