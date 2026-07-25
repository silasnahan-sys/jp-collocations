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
  wallClock: number;
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
  /** mark: the §25.1 pointer. */
  mark?: MarkRef;
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

  if (/^https?:\/\/\S+$/.test(t)) {
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
}
