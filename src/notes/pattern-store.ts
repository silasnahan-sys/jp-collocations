/**
 * pattern-store.ts — the PATTERN LEXICON spine (the knowledge layer; core
 * diagnosis P1).
 *
 * A reconciled note is not an event, it is a sighting of a PATTERN. This store
 * keys entries on the pattern itself — the link components (🟠), the slot
 * frame (💠), or the surface — so noticing 「んだったら〜なきゃ」 in three
 * different videos grows ONE entry with three attestations (video + time +
 * anchor + clip), instead of three unrelated rows. The library's 台帳 view
 * renders this catalog; anchors in transcripts remain the per-file truth
 * underneath.
 *
 * Class is SUGGESTED from the notation itself (the user's handwriting DSL):
 *   parts joined by 〜  → 🟠 skeletal link       (key = parts joined)
 *   「○○」 slot marker  → 💠 phrase schema        (key = the frame)
 *   otherwise           → 🟡 serifu (surface)     (key = normalized surface)
 * and stays one click to ratify/override — suggestions are never authority.
 *
 * Persisted in the plugin-data blob under `_patternStore` (sibling-preserving
 * spread, like _surferBridge). All derivation/merge logic is PURE and
 * golden-tested.
 */

import { normalizeJapanese } from '../utils/japanese.ts';
import type { GohoProfile } from '../scraper/goho.ts';
import { splitPatternParts } from './pipeline.ts';
import type { NoteClass } from './note-types.ts';

export type PatternKeyKind = 'surface' | 'link' | 'frame';

/** §22: which world the sighting came from. Absent = legacy → the source.
 *  'manual' = typed by hand, a real (lived) medium of its own. */
export type Medium = 'yt' | 'podcast' | 'tv' | 'manga' | 'book' | 'note' | 'x' | 'web' | 'dict' | 'corpus' | 'manual';

/** §22.2 SceneRef — enough provenance to re-manifest the scene in its
 *  medium's native shape, plus the door back into the medium itself. */
export interface SceneRef {
  /** door back: youtube ts-link / kindle:// / note.com#anchor / plex:// /
   *  tweet URL. Absent for manga without a scheme — the image IS the door. */
  deepLink?: string;
  /** vault path: manga page/panel crop, TV still. */
  image?: string;
  /** highlight region within the image. */
  bbox?: [number, number, number, number];
  /** vault path: podcast mp3 / plex-cut clip. */
  audio?: string;
  /** kindle location / page / paragraph anchor. */
  loc?: string;
  /** book title / 番組名 / dictionary name / site. */
  sourceName?: string;
}

/** §22.3 stratum: lived exposure outranks curated language outranks 生成. */
export type Stratum = 'lived' | 'curated';
export function stratumOf(a: Pick<Attestation, 'medium' | 'source'>): Stratum {
  const m = a.medium ?? a.source;
  return m === 'dict' || m === 'corpus' ? 'curated' : 'lived';
}

export interface Attestation {
  source: 'yt' | 'x' | 'web' | 'manual';
  /** §22: the medium of the scene (yt/podcast/tv/manga/book/note/x/web/
   *  dict/corpus). Absent on legacy attestations → falls back to source. */
  medium?: Medium;
  /** §22.2: the scene pointer — the context renderer dispatches on this. */
  scene?: SceneRef;
  /** transcript path (yt) / corpus ref (x). */
  file?: string;
  videoId?: string | null;
  tStartSec?: number | null;
  blockId?: string;
  /** the block actually written in the transcript (cluster anchor). */
  anchorId?: string;
  /** the located span text — what was actually said. */
  quote: string;
  addedAt: number;
  /**
   * 'suggested' = a machine-found candidate (class-aware sweep) awaiting the
   * user's ratification — the class tests are semantic, so structural matches
   * are never authority. Absent = confirmed (hand-captured or near-verbatim).
   */
  status?: 'suggested';
  /** which matcher proposed it (surface-inflected/components/link/frame/halo). */
  matchKind?: string;
  /** the matcher's own confidence heuristic (0..1). */
  confidence?: number;
}

export interface PatternEntry {
  id: string;                    // stable: hash(keyKind|key)
  class: NoteClass;
  classRatified: boolean;        // false = still a suggestion
  /** what the machine suggested at capture time (training signal for the suggester). */
  classSuggested?: NoteClass;
  keyKind: PatternKeyKind;
  key: string;
  /** latest handwriting form of the note. */
  note: string;
  payload: {
    parts?: string[];            // 🟠 components
    frame?: string;              // 💠 frame with ○○ slots
    lemma?: string;              // 🟢 the evocative headword the gesture is keyed on
    halo?: string;               // 🟢 the surrounding rendering around the lemma
    gloss?: string;              // free-form: what the pattern DOES (any class)
    /** §7/§26.2 cross-lemma gesture FAMILY (漏れなく/一つ残らず/ことごとく) —
     *  entries sharing a family auto-compose the 似ている表現 box. */
    family?: string;
    /**
     * §22.7 語法プロフィール — corpus enrichment, fetched ONCE and frozen
     * (invariant §2.4). Collocates + real corpus examples; examples are
     * capturable as `corpus`-stratum attestations.
     */
    // ONE type, defined next to the normalizer that builds it. This used to be
    // an inline structural copy, so widening the profile with the grammatical
    // half (frames / facets / totals — §22.7) type-errored at every consumer
    // while the data was already there.
    goho?: GohoProfile;
    /**
     * 生成 scaffold (§20.3 Tier C): LLM-drafted example sentences for a
     * pattern with ZERO confirmed attestations, so it stays drillable until
     * reality provides. Always rendered with a 生成 badge, never enters the
     * context tree, and AUTO-RETIRED the moment a confirmed attestation
     * lands (see upsertEntry).
     */
    scaffold?: string[];
  };
  attestations: Attestation[];
  /**
   * attKeys the user REJECTED (✕ on a suggested sighting). Negative examples:
   * the sweep never re-proposes them, and together with ratifications they are
   * the training signal for a future learned matcher.
   */
  rejectedAtts?: string[];
  /**
   * §26.2 the ❗ personal box: the QUOTES of rejected sightings (last 5) —
   * the user's own demonstrated near-misses, rendered ×-marked in the entry
   * (「似ているが違う」). rejectedAtts blocks re-proposal; this remembers WHY.
   */
  rejectedExamples?: string[];
  createdAt: number;
  updatedAt: number;
}

// ── PURE derivation ─────────────────────────────────────────────────────────────

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export interface DerivedPattern {
  keyKind: PatternKeyKind;
  key: string;
  suggestedClass: NoteClass;
  payload: PatternEntry['payload'];
}

/** Read the note's own notation: 〜-joined parts = a link, 「○○」 = a frame. */
export function derivePattern(note: string): DerivedPattern {
  const clean = normalizeJapanese(note).trim();
  const parts = splitPatternParts(clean);
  if (parts.length >= 2) {
    return { keyKind: 'link', key: parts.join('〜'), suggestedClass: 'skeletal', payload: { parts } };
  }
  if (/[○〇]{2}/.test(clean)) {
    const frame = clean.replace(/\s+/g, '');
    return { keyKind: 'frame', key: frame, suggestedClass: 'phrase_schema', payload: { frame } };
  }
  return { keyKind: 'surface', key: clean.replace(/\s+/g, ''), suggestedClass: 'serifu', payload: {} };
}

export function patternIdFor(d: Pick<DerivedPattern, 'keyKind' | 'key'>): string {
  return `pat-${fnv(`${d.keyKind}|${d.key}`)}`;
}

/**
 * The substring probes a CORPUS JOIN searches for (X co-occurrence / transcript
 * sweep): a 🟠 link needs every component present, a 💠 frame needs its fixed
 * material around the ○○ slot, a surface is itself. Empty → not sweepable.
 */
export function sweepTerms(e: Pick<PatternEntry, 'keyKind' | 'key' | 'payload'>): string[] {
  if (e.keyKind === 'link') return (e.payload.parts ?? []).filter((p) => p.length >= 2);
  if (e.keyKind === 'frame') {
    return (e.payload.frame ?? e.key).split(/「?[○〇]{2,}」?/).map((s) => s.trim()).filter((s) => s.length >= 2);
  }
  return e.key.length >= 2 ? [e.key] : [];
}

/**
 * PURE derivation for an EXPLICITLY classified capture (DESIGN §13). The key
 * follows what the class says the stored unit IS: 🟠 the link (parts), 💠 the
 * frame, 🟢 the lemma (the gesture catalog is lemma-keyed), otherwise the
 * surface. Falls back to notation-derivation when the payload doesn't carry
 * the class-defining field.
 */
export function deriveClassified(
  note: string,
  cls: NoteClass,
  payload: PatternEntry['payload'],
): DerivedPattern {
  const clean = normalizeJapanese(note).trim();
  const parts = (payload.parts ?? []).map((p) => p.trim()).filter((p) => p.length > 0);
  if (cls === 'skeletal' && parts.length >= 2) {
    return { keyKind: 'link', key: parts.join('〜'), suggestedClass: cls, payload: { ...payload, parts } };
  }
  if (cls === 'phrase_schema' && payload.frame?.trim()) {
    const frame = payload.frame.replace(/\s+/g, '');
    return { keyKind: 'frame', key: frame, suggestedClass: cls, payload: { ...payload, frame } };
  }
  if (cls === 'rhet_collocation' && payload.lemma?.trim()) {
    return { keyKind: 'surface', key: payload.lemma.trim(), suggestedClass: cls, payload };
  }
  const d = derivePattern(clean);
  return { ...d, suggestedClass: cls, payload: { ...d.payload, ...payload } };
}

/**
 * Attestation identity.
 *
 * Was `file|tStartSec|source` — "one sighting per (file, second)", which is
 * right for captioned video and DEGENERATE for everything else. Prose and
 * tweets have no second: `medium-lines.ts` produces lines with no `tStartSec`,
 * so every sighting in one Kindle note or one long-form post collapsed to the
 * same key. `upsertEntry` has no branch for "same key, both suggested", so the
 * duplicates were silently discarded — a book with 40 sightings of 「気になる」
 * stored ONE, permanently, and re-found and re-dropped the other 39 on every
 * later sweep. That capped the whole medium-lines road at 1/40th of its
 * measured recall (AUDIT-PARTS §3).
 *
 * The quote is what distinguishes two sightings inside one untimed source, so
 * the quote is in the key — hashed, because these keys are persisted in
 * `rejectedAtts` and a raw quote would bloat the blob for no gain.
 *
 * Timestamped media are unaffected in practice: two sightings at the same
 * second in the same file with the SAME quote still collapse, which is the
 * dedupe the old key was actually there for.
 */
export const attestationKey = (a: Attestation): string =>
  `${a.file ?? ''}|${a.tStartSec ?? ''}|${a.source}|${fnv1a(a.quote ?? '')}`;

/**
 * The pre-2026-08-01 key. Kept ONLY to read `rejectedAtts` written before the
 * quote entered the key: a ✕ is the user's own negative-example gold, and
 * silently re-proposing everything they had already rejected would be a worse
 * bug than the one being fixed. Never written.
 */
export const legacyAttestationKey = (a: Attestation): string =>
  `${a.file ?? ''}|${a.tStartSec ?? ''}|${a.source}`;

/** True when this sighting has been ✕'d, in either key generation. */
export function isRejected(e: Pick<PatternEntry, 'rejectedAtts'>, a: Attestation): boolean {
  const list = e.rejectedAtts;
  if (!list?.length) return false;
  return list.includes(attestationKey(a)) || list.includes(legacyAttestationKey(a));
}

/** FNV-1a, base36 — the same recipe used for ids across the plugin. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

const attKey = attestationKey;

/** PURE upsert: returns the next entry state given a sighting. */
export function upsertEntry(
  existing: PatternEntry | undefined,
  note: string,
  att: Attestation | null,
  now: number,
): PatternEntry {
  const d = derivePattern(note);
  const e: PatternEntry = existing ?? {
    id: patternIdFor(d),
    class: d.suggestedClass,
    classRatified: false,
    keyKind: d.keyKind,
    key: d.key,
    note,
    payload: d.payload,
    attestations: [],
    createdAt: now,
    updatedAt: now,
  };
  e.note = note;
  e.updatedAt = now;
  if (att && !isRejected(e, att)) {
    const i = e.attestations.findIndex((x) => attKey(x) === attKey(att));
    if (i < 0) {
      e.attestations.push(att);
      e.attestations.sort((a, b) => (a.file ?? '').localeCompare(b.file ?? '') || (a.tStartSec ?? 0) - (b.tStartSec ?? 0));
    } else if (att.anchorId && !e.attestations[i].anchorId) {
      // A sweep-found sighting (no anchor) later gets hand-anchored: upgrade
      // in place so the jump link points at the real block.
      e.attestations[i] = att;
    } else if (e.attestations[i].status === 'suggested' && !att.status) {
      // confirmed sighting of a spot we only suspected — upgrade, keep anchor-less
      e.attestations[i] = att;
    }
    // a suggested sighting NEVER downgrades an existing confirmed one (i>=0, att.status set → no-op)

    // a CONFIRMED attestation retires the 生成 scaffold: reality has provided
    if (!att.status && e.payload.scaffold?.length) {
      e.payload = { ...e.payload };
      delete e.payload.scaffold;
    }
  }
  return e;
}

// ── the store (persistence via injected save, like SurferBridge) ────────────────

export interface PatternStoreData { entries: PatternEntry[] }

export class PatternStore {
  private entries = new Map<string, PatternEntry>();
  private saveFn: (data: PatternStoreData) => Promise<void>;

  constructor(saveFn: (data: PatternStoreData) => Promise<void>) {
    this.saveFn = saveFn;
  }

  load(data: PatternStoreData | undefined): void {
    this.entries.clear();
    for (const e of data?.entries ?? []) this.entries.set(e.id, e);
  }

  /** Disaster recovery: replace the whole catalog from the vault mirror
   *  (catalog.jsonl) and persist. Returns the restored count. */
  async importReplace(entries: PatternEntry[]): Promise<number> {
    this.entries.clear();
    for (const e of entries) this.entries.set(e.id, e);
    await this.persist();
    return this.entries.size;
  }

  private async persist(): Promise<void> {
    await this.saveFn({ entries: this.all() });
  }

  all(): PatternEntry[] {
    return [...this.entries.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  byId(id: string): PatternEntry | undefined { return this.entries.get(id); }
  size(): number { return this.entries.size; }

  /** Record a sighting (att = null → note exists but wasn't anchored). */
  async record(note: string, att: Attestation | null, now = Date.now()): Promise<PatternEntry> {
    const id = patternIdFor(derivePattern(normalizeJapanese(note).trim()));
    const next = upsertEntry(this.entries.get(id), note, att, now);
    this.entries.set(next.id, next);
    await this.persist();
    return next;
  }

  /** Batch form — one persist for a whole reconcile run. */
  async recordMany(items: { note: string; att: Attestation | null }[], now = Date.now()): Promise<void> {
    for (const it of items) {
      const id = patternIdFor(derivePattern(normalizeJapanese(it.note).trim()));
      const next = upsertEntry(this.entries.get(id), it.note, it.att, now);
      this.entries.set(next.id, next);
    }
    await this.persist();
  }

  /**
   * Record an EXPLICITLY classified capture (ClassifyModal). Unlike record(),
   * the class is the user's ratified choice, the payload is class-shaped, and
   * the PERSPECTIVAL principle holds: if this key already exists under a
   * different ratified class, a sibling entry is created (same span, another
   * lens) instead of overwriting the other lens.
   */
  async recordClassified(opts: {
    note: string;
    cls: NoteClass;
    /** what the machine suggested before the user chose (training signal). */
    suggested?: NoteClass;
    payload?: PatternEntry['payload'];
    att: Attestation | null;
  }, now = Date.now()): Promise<PatternEntry> {
    const d = deriveClassified(opts.note, opts.cls, opts.payload ?? {});
    let id = patternIdFor(d);
    const existing = this.entries.get(id);
    if (existing && existing.classRatified && existing.class !== opts.cls) {
      id = `pat-${fnv(`${d.keyKind}|${d.key}|${opts.cls}`)}`;
    }
    const prev = this.entries.get(id);
    const next = upsertEntry(prev, opts.note, opts.att, now);
    next.id = id;
    next.class = opts.cls;
    next.classRatified = true;
    if (opts.suggested) next.classSuggested = opts.suggested;
    next.keyKind = d.keyKind;
    next.key = d.key;
    next.payload = { ...next.payload, ...d.payload };
    this.entries.set(id, next);
    await this.persist();
    return next;
  }

  /**
   * Batch-attach sightings to entries BY ID (the class-aware sweep). Unlike
   * recordMany this never re-derives a key from the note — classified entries
   * (lemma-keyed 🟢, class-sibling ids) keep their identity. Returns how many
   * attestations were actually added/upgraded.
   */
  async addAttestations(items: { id: string; att: Attestation }[], now = Date.now()): Promise<number> {
    let changed = 0;
    for (const it of items) {
      const e = this.entries.get(it.id);
      if (!e) continue;
      const before = JSON.stringify(e.attestations.find((x) => attKey(x) === attKey(it.att)) ?? null);
      upsertEntry(e, e.note, it.att, now);
      const after = JSON.stringify(e.attestations.find((x) => attKey(x) === attKey(it.att)) ?? null);
      if (before !== after) changed++;
    }
    if (changed) await this.persist();
    return changed;
  }

  /** ✓ on a suggested sighting — it becomes a confirmed attestation. */
  async ratifyAttestation(id: string, key: string): Promise<void> {
    const e = this.entries.get(id);
    const a = e?.attestations.find((x) => attKey(x) === key);
    if (!e || !a) return;
    delete a.status;
    if (e.payload.scaffold?.length) {           // reality provided — retire 生成
      e.payload = { ...e.payload };
      delete e.payload.scaffold;
    }
    e.updatedAt = Date.now();
    await this.persist();
  }

  /** §22.7: cache the 語法プロフィール (fetch-once-and-freeze — only writes
   *  when absent, so a later site change can't alter a past entry). */
  async setGoho(id: string, goho: NonNullable<PatternEntry['payload']['goho']>): Promise<boolean> {
    const e = this.entries.get(id);
    if (!e || e.payload.goho) return false;
    e.payload = { ...e.payload, goho };
    e.updatedAt = Date.now();
    await this.persist();
    return true;
  }

  /** §20.3 Tier C: attach 生成 scaffold examples (only meaningful while the
   *  entry has no confirmed attestation — they auto-retire on the first one). */
  async setScaffold(id: string, examples: string[]): Promise<void> {
    const e = this.entries.get(id);
    if (!e) return;
    e.payload = { ...e.payload, scaffold: examples };
    e.updatedAt = Date.now();
    await this.persist();
  }

  /** ✕ on a suggested sighting — removed AND remembered so the sweep never re-proposes it. */
  async rejectAttestation(id: string, key: string): Promise<void> {
    const e = this.entries.get(id);
    if (!e) return;
    const i = e.attestations.findIndex((x) => attKey(x) === key);
    if (i < 0) return;
    const quote = e.attestations[i].quote;
    e.attestations.splice(i, 1);
    e.rejectedAtts = [...(e.rejectedAtts ?? []), key];
    if (quote) e.rejectedExamples = [...(e.rejectedExamples ?? []), quote].slice(-5);
    e.updatedAt = Date.now();
    await this.persist();
  }

  async setClass(id: string, cls: NoteClass): Promise<void> {
    const e = this.entries.get(id);
    if (!e) return;
    e.class = cls;
    e.classRatified = true;
    e.updatedAt = Date.now();
    await this.persist();
  }

  async remove(id: string): Promise<void> {
    this.entries.delete(id);
    await this.persist();
  }
}
