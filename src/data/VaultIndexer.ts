import type { App, TFile } from "obsidian";
import type { ContextChunk, ContextEntry, DiscourseBit, DiscourseRelation } from "../types.ts";
import type { ContextStore } from "./ContextStore.ts";
import { DiscourseAnalyzer } from "../discourse/DiscourseAnalyzer.ts";

/**
 * Indexes the entire vault (or a set of files) to find occurrences of a
 * phrase and create context chunks with discourse analysis.
 */
export class VaultIndexer {
  private app: App;
  private contextStore: ContextStore;
  private analyzer: DiscourseAnalyzer;
  private contextRadius: number;

  constructor(app: App, contextStore: ContextStore, contextRadius: number) {
    this.app = app;
    this.contextStore = contextStore;
    this.analyzer = new DiscourseAnalyzer();
    this.contextRadius = contextRadius;
  }

  /**
   * Search all markdown files in the vault for occurrences of `phrase`
   * and create context chunks + entries for each occurrence.
   *
   * @returns Number of new context entries created.
   */
  async indexPhrase(phrase: string, collocationId: string | null): Promise<number> {
    const files = this.app.vault.getMarkdownFiles();
    let count = 0;

    for (const file of files) {
      const hits = await this.indexFile(file, phrase, collocationId);
      count += hits;
    }

    return count;
  }

  /**
   * Index a single file for a phrase.
   */
  async indexFile(file: TFile, phrase: string, collocationId: string | null): Promise<number> {
    const content = await this.app.vault.cachedRead(file);
    if (!content.includes(phrase)) return 0;

    let count = 0;
    let searchFrom = 0;

    while (true) {
      const idx = content.indexOf(phrase, searchFrom);
      if (idx === -1) break;

      // Extract context chunk around the occurrence
      const chunkText = this.analyzer.extractChunk(content, phrase, this.contextRadius);
      const analysis = this.analyzer.analyse(chunkText);

      const chunk: ContextChunk = {
        id: this.contextStore.generateId("chunk"),
        rawText: chunkText,
        bits: analysis.bits,
        relations: analysis.relations,
        sourceFile: file.path,
        selectedPhrase: phrase,
        createdAt: Date.now(),
      };
      this.contextStore.addChunk(chunk);

      // Identify which bits overlap with the selected phrase
      const highlightedBitIds = this.findOverlappingBits(analysis.bits, chunkText, phrase);

      const formattedMarkdown = this.analyzer.formatChunkMarkdown(
        chunkText, phrase, analysis.bits
      );

      const entry: ContextEntry = {
        id: this.contextStore.generateId("ctx"),
        collocationId,
        chunkId: chunk.id,
        highlightedBitIds,
        formattedMarkdown,
        tags: [],
        createdAt: Date.now(),
      };
      this.contextStore.addEntry(entry);

      // Also create individual bit entries for each highlighted bit
      for (const bitId of highlightedBitIds) {
        const bit = analysis.bits.find(b => b.id === bitId);
        if (!bit) continue;

        const bitEntry: ContextEntry = {
          id: this.contextStore.generateId("bitctx"),
          collocationId,
          chunkId: chunk.id,
          highlightedBitIds: [bitId],
          formattedMarkdown: this.formatBitEntry(bit, analysis.bits, analysis.relations),
          tags: [
            ...(bit.category ? [bit.category] : []),
            ...bit.functions.map(f => String(f)),
          ],
          createdAt: Date.now(),
        };
        this.contextStore.addEntry(bitEntry);
      }

      count++;
      searchFrom = idx + phrase.length;
    }

    return count;
  }

  private findOverlappingBits(bits: DiscourseBit[], chunkText: string, phrase: string): string[] {
    const phraseIdx = chunkText.indexOf(phrase);
    if (phraseIdx === -1) return bits.length > 0 ? [bits[0].id] : [];

    const phraseEnd = phraseIdx + phrase.length;
    return bits
      .filter(b => b.startOffset < phraseEnd && b.endOffset > phraseIdx)
      .map(b => b.id);
  }

  /**
   * Format a single bit entry showing its connections within the chunk.
   */
  private formatBitEntry(
    bit: DiscourseBit,
    allBits: DiscourseBit[],
    relations: DiscourseRelation[]
  ): string {
    const lines: string[] = [];
    lines.push(`> **${bit.text}**`);
    if (bit.category) {
      lines.push(`> 分類: \`${bit.category}\``);
    }
    if (bit.functions.length > 0) {
      lines.push(`> 談話機能: ${bit.functions.map(f => `\`${f}\``).join(" ")}`);
    }
    lines.push(`> 話者: _${bit.speaker}_`);

    // Show connected bits
    const connected = relations.filter(r => r.fromBitId === bit.id || r.toBitId === bit.id);
    if (connected.length > 0) {
      lines.push(`>`);
      lines.push(`> **関連:**`);
      for (const rel of connected) {
        const otherId = rel.fromBitId === bit.id ? rel.toBitId : rel.fromBitId;
        const other = allBits.find(b => b.id === otherId);
        if (other) {
          const dir = rel.fromBitId === bit.id ? "→" : "←";
          lines.push(`> ${dir} ${other.text} (\`${rel.relationType}\`)`);
        }
      }
    }

    return lines.join("\n");
  }
}
