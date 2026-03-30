import type { DiscourseCategory, DiscourseFunction } from "../types.ts";
import type { DiscourseBit, DiscourseGraph } from "../discourse/discourse-types.ts";
import { categoryForType } from "../discourse/discourse-types.ts";

export interface ContextBitRecord {
  bit: DiscourseBit;
  category: DiscourseCategory;
  functions: DiscourseFunction[];
  speaker?: string;
  connectionGroup?: string;
  graphId: string;
  source: string;
}

export interface DiscourseBitIndex {
  byCategory: Map<DiscourseCategory, ContextBitRecord[]>;
  byFunction: Map<DiscourseFunction, ContextBitRecord[]>;
  bySpeaker: Map<string, ContextBitRecord[]>;
  byConnectionGroup: Map<string, ContextBitRecord[]>;
}

export class ContextStore {
  private records: Map<string, ContextBitRecord> = new Map();
  readonly index: DiscourseBitIndex = {
    byCategory: new Map(),
    byFunction: new Map(),
    bySpeaker: new Map(),
    byConnectionGroup: new Map(),
  };

  /** Ingest a full graph, assigning categories and indexing all bits. */
  ingestGraph(graph: DiscourseGraph, source: string, speaker?: string, connectionGroup?: string): void {
    for (const bit of graph.bits) {
      const category = categoryForType(bit.bitType as string);
      const record: ContextBitRecord = {
        bit,
        category,
        functions: [],
        speaker,
        connectionGroup,
        graphId: graph.id,
        source,
      };
      this.records.set(bit.id, record);
      this.indexRecord(record);
    }
  }

  private indexRecord(rec: ContextBitRecord): void {
    this.addToMap(this.index.byCategory, rec.category, rec);
    for (const fn of rec.functions) {
      this.addToMap(this.index.byFunction, fn, rec);
    }
    if (rec.speaker) this.addToMap(this.index.bySpeaker, rec.speaker, rec);
    if (rec.connectionGroup) this.addToMap(this.index.byConnectionGroup, rec.connectionGroup, rec);
  }

  private addToMap<K>(map: Map<K, ContextBitRecord[]>, key: K, rec: ContextBitRecord): void {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(rec);
  }

  getByCategory(cat: DiscourseCategory): ContextBitRecord[] {
    return this.index.byCategory.get(cat) ?? [];
  }

  getByFunction(fn: DiscourseFunction): ContextBitRecord[] {
    return this.index.byFunction.get(fn) ?? [];
  }

  getBySpeaker(speaker: string): ContextBitRecord[] {
    return this.index.bySpeaker.get(speaker) ?? [];
  }

  getByConnectionGroup(group: string): ContextBitRecord[] {
    return this.index.byConnectionGroup.get(group) ?? [];
  }

  size(): number {
    return this.records.size;
  }

  clear(): void {
    this.records.clear();
    this.index.byCategory.clear();
    this.index.byFunction.clear();
    this.index.bySpeaker.clear();
    this.index.byConnectionGroup.clear();
  }
}
