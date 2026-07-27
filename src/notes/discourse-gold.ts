/**
 * discourse-gold.ts — the 🔴 training-data store (DESIGN §13.2).
 *
 * Every discourse capture is a LABELED EXAMPLE: the utterance with its real
 * conversational context, what the current parser (relational.ts) suggested at
 * capture time (frozen), and what the user ratified. The suggested/ratified
 * delta is the dataset the next parser iteration is built from and graded
 * against — the plugin bootstrapping its own parsing logic from use.
 *
 * Examples are self-contained (edge targets are turns-back offsets, not
 * external ids) so the JSONL export needs no store to interpret. Persisted in
 * the plugin-data blob under `_discourseGold` (sibling-preserving spread).
 */

export type GoldEdgeKind =
  | '→' | '↳' | '↧'                                   // the user's relation notation
  | 'answers' | 'restates' | 'responds-expands'        // cross-turn detector kinds
  | 'contrasts' | 'receipts';

export interface GoldEdge {
  kind: GoldEdgeKind;
  /** turns back from the utterance (1 = immediately prior turn). */
  toOffset: number;
}

export interface GoldSource {
  kind: 'yt' | 'x' | 'web' | 'manual';
  file?: string;
  url?: string;
  tStartSec?: number | null;
  /** §22: scene passthrough — the medium of the capture surface and its
   *  address, carried onto the attestation (kind stays the coarse bucket). */
  medium?: 'yt' | 'podcast' | 'tv' | 'manga' | 'book' | 'note' | 'x' | 'web' | 'dict' | 'corpus';
  sourceName?: string;
  loc?: string;
  /** manga: the panel image (vault path) + bubble bbox (0–1000 normalized).
   *  TV: the still frame cut at the mark. */
  image?: string;
  bbox?: [number, number, number, number];
  /** vault path of an audio clip cut at this moment (podcast mp3, Plex cut).
   *  Without this the cutter writes a clip into the vault and the noticing it
   *  was cut FOR never learns it exists — the scene is unreachable from the
   *  capture that caused it. `SceneRef.audio` has always had a slot for it. */
  audio?: string;
}

export interface GoldExample {
  id: string;
  utterance: string;
  /** prior turns, oldest → nearest. */
  contextBefore: string[];
  contextAfter: string[];
  /** aligned with [...contextBefore, utterance, ...contextAfter]; null = unknown. */
  speakers?: (string | null)[];
  /** frozen parser output at capture time — the evaluation datum. */
  suggestedAct?: string;
  suggestedEdge?: GoldEdge | null;
  /** the ratified label. */
  act: string;
  edge?: GoldEdge | null;
  /** the user's free-form insight, if any. */
  note?: string;
  /** catalog PatternEntry this capture also fed, if any. */
  patternId?: string;
  source: GoldSource;
  addedAt: number;
}

/** The cross-turn act inventory (relational.ts) + an open slot for new labels. */
export const KNOWN_ACTS = [
  'INFORM', 'PROBE-QUESTION', 'ANSWER', 'RESTATE-ACK', 'EXPAND-REAFFIRM',
  'CONTRASTIVE-REVEAL', 'NEWS-RECEIPT', 'BACKCHANNEL',
] as const;

export const EDGE_KINDS: GoldEdgeKind[] = [
  'answers', 'restates', 'responds-expands', 'contrasts', 'receipts', '→', '↳', '↧',
];

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** Identity: one gold example per (source location, utterance). Re-capturing updates the label. */
export function goldIdFor(source: GoldSource, utterance: string): string {
  const loc = `${source.kind}|${source.file ?? source.url ?? ''}|${source.tStartSec ?? ''}`;
  return `gold-${fnv(`${loc}|${utterance.trim()}`)}`;
}

export interface GoldStats {
  total: number;
  byAct: Record<string, number>;
  /** captures where the parser's suggestion was available AND matched the label. */
  actAgreement: { agreed: number; graded: number };
  edgeAgreement: { agreed: number; graded: number };
}

export function goldStats(examples: GoldExample[]): GoldStats {
  const byAct: Record<string, number> = {};
  let actAgreed = 0, actGraded = 0, edgeAgreed = 0, edgeGraded = 0;
  for (const g of examples) {
    byAct[g.act] = (byAct[g.act] ?? 0) + 1;
    if (g.suggestedAct != null) {
      actGraded++;
      if (g.suggestedAct === g.act) actAgreed++;
    }
    if (g.suggestedEdge !== undefined) {
      edgeGraded++;
      const a = g.suggestedEdge, b = g.edge ?? null;
      if ((a === null && b === null) || (a && b && a.kind === b.kind && a.toOffset === b.toOffset)) edgeAgreed++;
    }
  }
  return {
    total: examples.length,
    byAct,
    actAgreement: { agreed: actAgreed, graded: actGraded },
    edgeAgreement: { agreed: edgeAgreed, graded: edgeGraded },
  };
}

/** One example per line, stable field order — the parser-building input. */
export function toJsonl(examples: GoldExample[]): string {
  return examples.map((g) => JSON.stringify(g)).join('\n');
}

export interface DiscourseGoldData { examples: GoldExample[] }

export class DiscourseGoldStore {
  private byId = new Map<string, GoldExample>();
  private saveFn: (data: DiscourseGoldData) => Promise<void>;

  constructor(saveFn: (data: DiscourseGoldData) => Promise<void>) {
    this.saveFn = saveFn;
  }

  load(data: DiscourseGoldData | undefined): void {
    this.byId.clear();
    for (const g of data?.examples ?? []) this.byId.set(g.id, g);
  }

  all(): GoldExample[] {
    return [...this.byId.values()].sort((a, b) => b.addedAt - a.addedAt);
  }

  size(): number { return this.byId.size; }
  stats(): GoldStats { return goldStats(this.all()); }

  /** Upsert by identity — re-capturing the same span updates the label, never duplicates. */
  async add(g: Omit<GoldExample, 'id'>): Promise<GoldExample> {
    const id = goldIdFor(g.source, g.utterance);
    const next: GoldExample = { ...g, id };
    this.byId.set(id, next);
    await this.saveFn({ examples: this.all() });
    return next;
  }

  async remove(id: string): Promise<void> {
    this.byId.delete(id);
    await this.saveFn({ examples: this.all() });
  }
}
