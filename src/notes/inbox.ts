/**
 * inbox.ts — the 収集トレイ store + content shaping (DESIGN §22.8). PURE —
 * golden-tested in golden/inbox.mjs.
 *
 * Everything flicked into the tray lands here UNPROCESSED — quarantine,
 * exactly like sweep candidates: nothing enters the catalog without
 * classification, but nothing dropped is ever lost. Cards carry their drop
 * provenance so the eventual capture is scene-complete, and each drop is
 * SHAPED on arrival (user edit, §22.8: real-time formatting depending on
 * what the content is — dialogue, example sentence, word, URL, image).
 */

import { isRemoteUrl } from './resource-url.ts';

export type InboxKind = 'image' | 'url' | 'dialogue' | 'sentence' | 'word' | 'text' | 'mark';

/** §25.1: a MARK — the cheapest live-phase gesture's residue. Carries only
 *  where/when (+ an optional one-word seed); harvest re-manifests the moment. */
export interface MarkRef {
  medium: 'yt' | 'podcast' | 'tv' | 'manga' | 'book' | 'note' | 'x' | 'web';
  /** transcript note the mark points into (when known). */
  file?: string;
  tSec?: number;
  loc?: string;
  sourceName?: string;
  /** the retrieval cue for YOUR thought (never the note itself). */
  seed?: string;
  /**
   * WHAT WAS SAID at `tSec` — resolved once, then kept.
   *
   * A mark used to be a pointer with no payload: `medium` + `file` + `tSec` and
   * nothing else, with `content` empty. Measured on the live vault 2026-08-08:
   * 98 of 106 tray cards were marks, and every one of them rendered as
   * 「（メモなし）」 with a timestamp. Ninety-eight indistinguishable rows.
   *
   * That is why they were never harvested. Not because classifying is hard —
   * because you could not SEE which mark was which without opening the capture
   * modal on it, one at a time, to find out what you had flagged. Triage was
   * impossible, so the whole downstream funnel (catalog → ratify → predict) ran
   * on four entries while 98 noticings sat here.
   *
   * The line was always recoverable — `resolveMarkContext` reads the transcript
   * note and finds it — so this is a cache, not new evidence. `''` means
   * RESOLVED AND ABSENT (the transcript had no line at that second), which is a
   * different fact from `undefined` = not looked up yet, and the difference is
   * what stops an unresolvable mark being retried on every render forever.
   */
  lineText?: string;
  wallClock: number;
}

/** §25.4 — a cut scene, as vault-relative paths. Either half may be missing:
 *  a still with no audio is still worth showing. */
export interface MarkClip {
  audio?: string;
  still?: string;
}

export interface InboxCard {
  id: string;
  kind: InboxKind;
  /** text content, URL, vault path of a saved image, or a mark's seed. */
  content: string;
  /** dialogue: the parsed lines (speaker stripped to its own field). */
  lines?: Array<{ speaker?: string; text: string }>;
  /** image: OCR'd manga bubbles in reading order, bbox 0–1000 normalized. */
  bubbles?: Array<{ text: string; bbox: [number, number, number, number] }>;
  /**
   * image: the words that arrived WITH the picture, in the same carry.
   *
   * A manga panel dragged out of Manatan comes with the sentence it already
   * OCR'd; an Apple Notes selection comes with strokes and the recognised text
   * together. Before this field the classifier saw both, kept the file and
   * dropped the text on the floor (`drop-intent.ts` returned early on
   * `files.length`), so the pair had to be carried twice and re-paired by hand
   * — which is the moment a capture stops being worth making.
   *
   * Distinct from `bubbles`, which is what OCR found INSIDE the image and
   * carries geometry. This is what the sending app said the image means.
   */
  said?: string;
  /** mark: the §25.1 pointer. */
  mark?: MarkRef;
  /** mark: §25.4 the scene cut at it — vault paths, not blobs. */
  clip?: MarkClip;
  createdAt: number;
  /** where it came from, best-effort (drop metadata / URL host). */
  origin?: string;
}

const JP_RE = /[぀-ヿ㐀-䶿一-鿿]/;
const SPEAKER_LINE = /^\s*([A-Za-z一-鿿ぁ-ヶ]{1,8})[:：]\s*(.+)$/;

/** FNV-1a for stable ids (same recipe as the rest of the plugin). */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/**
 * Shape a drop into a card (§22.8 content-aware formatting):
 *  - URL → url card (origin = host)
 *  - multi-line with speaker marks → dialogue (lines + speakers parsed)
 *  - one Japanese sentence-ish → sentence
 *  - short Japanese, no particles-of-predication → word
 *  - anything else → text (never rejected — the tray loses nothing)
 */
export function shapeDrop(raw: string, now: number, origin?: string): InboxCard {
  const t = raw.trim();
  const id = `inb-${fnv(`${t}|${now}`)}`;

  // `isRemoteUrl`, not `/^https?:/` — on Android Obsidian serves the vault over
  // `http://localhost/_capacitor_file_/…`, and a card that calls that a URL is
  // claiming a web address for a file on the device. Such a thing falls through
  // to `text`, which is the truth: it is a string we could not place.
  if (isRemoteUrl(t)) {
    let host = '';
    try { host = new URL(t).host; } catch { /* keep '' */ }
    return { id, kind: 'url', content: t, createdAt: now, origin: origin ?? host };
  }

  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const parsed = lines.map((l) => {
      const m = l.match(SPEAKER_LINE);
      return m && JP_RE.test(m[2]) ? { speaker: m[1], text: m[2] } : { text: l };
    });
    const speakers = parsed.filter((l) => l.speaker).length;
    if (speakers >= 2) {
      return { id, kind: 'dialogue', content: t, lines: parsed, createdAt: now, origin };
    }
  }

  if (JP_RE.test(t)) {
    const oneLine = t.replace(/\n/g, '');
    if (oneLine.length <= 6 && !/[。！？をがはにで]/.test(oneLine)) {
      return { id, kind: 'word', content: oneLine, createdAt: now, origin };
    }
    if (lines.length === 1) {
      return { id, kind: 'sentence', content: oneLine, createdAt: now, origin };
    }
  }

  return { id, kind: 'text', content: t, createdAt: now, origin };
}

export function imageCard(vaultPath: string, now: number, origin?: string): InboxCard {
  return { id: `inb-${fnv(`${vaultPath}|${now}`)}`, kind: 'image', content: vaultPath, createdAt: now, origin };
}

/**
 * One card for a picture and the words that came with it — a single thing that
 * arrived, not two things that happen to share a timestamp.
 *
 * The id hashes both halves, so re-dropping the same panel with a different
 * sentence is a new card while re-dropping the identical pair is a duplicate.
 */
export function pairedCard(vaultPath: string, said: string, now: number, origin?: string): InboxCard {
  const t = said.trim();
  return {
    id: `inb-${fnv(`${vaultPath}|${t}|${now}`)}`,
    kind: 'image',
    content: vaultPath,
    said: t || undefined,
    createdAt: now,
    origin,
  };
}

export function markCard(mark: MarkRef, now: number): InboxCard {
  const at = mark.tSec != null ? String(mark.tSec) : mark.loc ?? '';
  return {
    id: `inb-${fnv(`${mark.file ?? mark.sourceName ?? mark.medium}|${at}|${now}`)}`,
    kind: 'mark',
    content: mark.seed ?? '',
    mark,
    createdAt: now,
    origin: mark.sourceName,
  };
}

// ── 読書セッション grouping (§25.7) ───────────────────────────────────────

export interface ReadingSession {
  start: number;
  end: number;
  cards: InboxCard[];   // SHOT order (oldest first = reading order)
}

/**
 * Time-cluster IMAGE cards into 読書セッション groups: screenshots taken
 * within `gapMs` of each other are one reading session (same evening, same
 * chapter). Groups come back newest-session-first; cards within a group in
 * shot order, because shot order IS the manga's reading order.
 */
export function sessionGroups(cards: InboxCard[], gapMs = 30 * 60 * 1000): ReadingSession[] {
  const imgs = cards.filter((c) => c.kind === 'image').sort((a, b) => a.createdAt - b.createdAt);
  const groups: ReadingSession[] = [];
  for (const c of imgs) {
    const g = groups[groups.length - 1];
    if (g && c.createdAt - g.end < gapMs) {
      g.cards.push(c);
      g.end = c.createdAt;
    } else {
      groups.push({ start: c.createdAt, end: c.createdAt, cards: [c] });
    }
  }
  return groups.reverse();
}

// ── the store (persistence via injected save, same shape as PatternStore) ──

export interface InboxData { cards: InboxCard[] }

export class InboxStore {
  private cards = new Map<string, InboxCard>();
  private saveFn: (data: InboxData) => Promise<void>;

  constructor(saveFn: (data: InboxData) => Promise<void>) {
    this.saveFn = saveFn;
  }

  load(data: InboxData | undefined): void {
    this.cards.clear();
    for (const c of data?.cards ?? []) this.cards.set(c.id, c);
  }

  private persist(): Promise<void> {
    return this.saveFn({ cards: this.all() });
  }

  all(): InboxCard[] {
    return [...this.cards.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  size(): number { return this.cards.size; }

  async add(card: InboxCard): Promise<boolean> {
    if (this.cards.has(card.id)) return false;   // identical re-drop = no dupe
    this.cards.set(card.id, card);
    await this.persist();
    return true;
  }

  async remove(id: string): Promise<void> {
    this.cards.delete(id);
    await this.persist();
  }

  /** attach OCR'd bubbles to an image card (once — OCR results are frozen). */
  async setBubbles(id: string, bubbles: NonNullable<InboxCard['bubbles']>): Promise<boolean> {
    const c = this.cards.get(id);
    if (!c || c.kind !== 'image' || c.bubbles) return false;
    c.bubbles = bubbles;
    await this.persist();
    return true;
  }

  /**
   * §25.4 — remember the clip cut at a mark, so classifying it later still has
   * the scene. Deliberately re-writable, unlike bubbles: a clip can be cut again
   * with different padding, and the newest cut is the one you meant.
   */
  async setMarkClip(id: string, clip: MarkClip): Promise<boolean> {
    const c = this.cards.get(id);
    if (!c || c.kind !== 'mark') return false;
    c.clip = { ...clip };
    await this.persist();
    return true;
  }

  /** §25.1 — edit the note on a mark after the fact. Watching is a bad time to
   *  write, so what you wrote then must not be frozen. */
  async setMarkNote(id: string, text: string): Promise<boolean> {
    const c = this.cards.get(id);
    if (!c || c.kind !== 'mark') return false;
    c.content = text;
    if (c.mark) c.mark = { ...c.mark, seed: text || undefined };
    await this.persist();
    return true;
  }

  /** Marks that point at a transcript line nobody has resolved yet. */
  marksNeedingLine(): InboxCard[] {
    return [...this.cards.values()].filter(
      (c) => c.kind === 'mark' && !!c.mark?.file && c.mark.tSec != null && c.mark.lineText === undefined,
    );
  }

  /**
   * Record resolved lines — in ONE batch, one write.
   *
   * Deliberately plural. The backfill resolves ~100 marks in a run, and a
   * per-card setter would persist the whole blob ~100 times; this vault has
   * already been down that road once (30MB of IO for a single checkbox).
   */
  async setMarkLines(pairs: ReadonlyArray<{ id: string; line: string }>): Promise<number> {
    let n = 0;
    for (const { id, line } of pairs) {
      const c = this.cards.get(id);
      if (!c || c.kind !== 'mark' || !c.mark) continue;
      c.mark = { ...c.mark, lineText: line };
      n++;
    }
    if (n) await this.persist();
    return n;
  }

  /** Mark cards standing against one transcript note, oldest first. */
  marksForFile(path: string | undefined): InboxCard[] {
    if (!path) return [];
    return [...this.cards.values()]
      .filter((c) => c.kind === 'mark' && c.mark?.file === path)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
}
