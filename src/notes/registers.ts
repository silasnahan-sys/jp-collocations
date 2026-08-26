/**
 * registers.ts — 二重写し, the Move-2 inspector's two registers.
 *
 * ## What the film actually showed
 *
 * CALENDAR-PHYSICS §2 law 1, and specifically the sharpening the 30fps read
 * added to it: during the long carry in IMG_1213 the Edit panel's header kept
 * reading the event's **stored** address (Tuesday, Aug 25, 2:45–3:45PM) while
 * the :15/:30 chips riding the block showed the **candidate** — and only on
 * release did the header visibly rewrite to Mon, Aug 24, 5–6PM.
 *
 * Two truths on screen at once. One commit, at release. No intermediate
 * half-state ever written.
 *
 * ## What the plugin did instead
 *
 * One register, silently replaced. Every TokenCanvas gesture overwrote
 * `parts` / `frame` / `lemma` / `halo` on the modal, and whatever the catalog
 * already held for that span was gone from view with no trace. That is most
 * costly on exactly the move the doctrine calls primary — 保存して別分類も,
 * the perspectival re-cut — where you re-mark a span you have ALREADY filed
 * and the one thing you need to see is what the last filing recorded.
 *
 * ## The rule this module encodes
 *
 * Two registers exist only when there are genuinely two. A first capture has
 * a candidate and nothing else, so `diffRegisters(null, …)` returns an empty
 * list and the panel shows no register strip at all — inventing a "stored:
 * (none)" column for a brand-new capture would be chrome pretending to be
 * information. The strip appears when the catalog already holds this span,
 * and it names only what would CHANGE (§28 S6: say the difference, not the
 * inventory).
 *
 * Pure, so the contract is pinned by golden/registers.mjs rather than living
 * inside a Modal where nothing can reach it — the gradient this project keeps
 * paying for is goldens accreting on cores while apertures ship untested.
 */

/** How the candidate stands against what is stored. */
export type RegisterKind = 'same' | 'added' | 'changed' | 'removed';

export interface RegisterField {
  /** the payload key, or 'note' / 'class'. */
  field: string;
  /** the short label the strip prints. */
  label: string;
  stored?: string;
  candidate?: string;
  kind: RegisterKind;
}

/**
 * One projection of a capture — the shape both registers are read into, so
 * stored and candidate are literally comparable rather than compared by eye.
 */
export interface RegisterSnapshot {
  note?: string;
  cls?: string;
  parts?: string[];
  frame?: string;
  lemma?: string;
  halo?: string;
  gloss?: string;
}

/** The catalog's own shape, accepted structurally so this core imports nothing. */
export interface StoredLike {
  /** the latest handwriting form — what the hand actually wrote. */
  note?: string;
  /** the derived match key; the fallback when no note was kept. */
  key?: string;
  class?: string;
  payload?: {
    parts?: string[];
    frame?: string;
    lemma?: string;
    halo?: string;
    gloss?: string;
  };
}

/** Read a catalog entry into the comparable shape. */
export function snapshotOf(e: StoredLike | null | undefined): RegisterSnapshot | null {
  if (!e) return null;
  const p = e.payload ?? {};
  return {
    // The NOTE, not the key: the key is derived (a 🟠 key is its parts
    // joined), so comparing a typed headword against it would report a
    // change on every capture that never edited anything.
    note: e.note ?? e.key,
    cls: e.class,
    parts: p.parts,
    frame: p.frame,
    lemma: p.lemma,
    halo: p.halo,
    gloss: p.gloss,
  };
}

/** The strip's labels. Short on purpose — it sits under the fields, not instead. */
const LABELS: Record<string, string> = {
  note: '見出し',
  cls: '分類',
  parts: '成分リンク',
  frame: '型',
  lemma: 'レンマ',
  halo: 'ハロー',
  gloss: '語釈',
};

/** Field order matches the panel's own reading order. */
const ORDER = ['note', 'cls', 'parts', 'frame', 'lemma', 'halo', 'gloss'] as const;

const show = (v: string[] | string | undefined): string => {
  if (v == null) return '';
  const s = Array.isArray(v) ? v.filter(Boolean).join(' 〜 ') : v;
  return s.trim();
};

/**
 * Compare the two registers, field by field.
 *
 * Returns [] when nothing is stored: a first capture has one truth, and a
 * register strip that shows a column of blanks is noise wearing the costume
 * of rigour.
 */
export function diffRegisters(
  stored: RegisterSnapshot | null,
  candidate: RegisterSnapshot,
): RegisterField[] {
  if (!stored) return [];
  const out: RegisterField[] = [];
  for (const field of ORDER) {
    const a = show(stored[field]);
    const b = show(candidate[field]);
    let kind: RegisterKind;
    if (a === b) kind = 'same';
    else if (!a) kind = 'added';
    else if (!b) kind = 'removed';
    else kind = 'changed';
    out.push({ field, label: LABELS[field], stored: a || undefined, candidate: b || undefined, kind });
  }
  return out;
}

/** Only what would move. The strip never prints the unchanged inventory. */
export function changedOnly(fields: RegisterField[]): RegisterField[] {
  return fields.filter((f) => f.kind !== 'same');
}

/** Would saving change anything the catalog already holds? */
export function isDirty(fields: RegisterField[]): boolean {
  return fields.some((f) => f.kind !== 'same');
}

/**
 * One field as the strip prints it. The arrow is the whole point: the left is
 * what the catalog holds RIGHT NOW and still holds, the right is what this
 * gesture would make it, and neither is written until the hand commits.
 */
export function registerLine(f: RegisterField): string {
  switch (f.kind) {
    case 'added': return `${f.label}: — → ${f.candidate}`;
    case 'removed': return `${f.label}: ${f.stored} → —`;
    case 'changed': return `${f.label}: ${f.stored} → ${f.candidate}`;
    default: return `${f.label}: ${f.stored ?? '—'}`;
  }
}

/**
 * The strip's own heading. Names the count so the eye knows the size of the
 * change before it reads any of it.
 */
export function registerSummary(fields: RegisterField[]): string {
  const moved = changedOnly(fields);
  if (!moved.length) return '台帳の記録と同じ';
  return `台帳の記録から ${moved.length}点が変わります`;
}
