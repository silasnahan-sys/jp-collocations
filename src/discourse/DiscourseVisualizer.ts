import type { DiscourseBit, DiscourseEdge, DiscourseGraph } from "./discourse-types.ts";
import { CATEGORY_COLOURS } from "../types.ts";
import type { DiscourseCategory } from "../types.ts";

/** Map seed relationship types to their closest DiscourseCategory. */
const TYPE_TO_CATEGORY: Record<string, DiscourseCategory> = {
  "hedge-stance-softening":         "hedging",
  "split-morpheme-co-construction": "referential",
  "perspective-framing":            "stance",
  "interactional-pivot":            "interactional",
  "epistemic-continuation-blend":   "epistemic",
  "discontinuous-parallel":         "enumerative",
  "causal-concessive-cascade":      "causal-logical",
  "assertion-deflation":            "hedging",
  "connector-compounding":          "structural",
  "fuzzy-reference-chain":          "referential",
  "extended-reasoning-stance-cap":  "stance",
  "epistemic-speculation-cascade":  "epistemic",
  "discourse-fade-trail-off":       "structural",
  "sequential-adjacency":           "structural",
  "unknown":                        "structural",
};

function categoryForType(type: string): DiscourseCategory {
  return TYPE_TO_CATEGORY[type] ?? "structural";
}

export class DiscourseVisualizer {
  /** Render a graph as a DOT language string for Graphviz. */
  toDot(graph: DiscourseGraph): string {
    const lines: string[] = ["digraph discourse {", "  rankdir=LR;", "  node [shape=box, style=filled, fontname=Helvetica];"];

    for (const bit of graph.bits) {
      const cat = categoryForType(bit.bitType as string);
      const colour = CATEGORY_COLOURS[cat] ?? "#cccccc";
      const label = bit.text.replace(/"/g, "'").slice(0, 30);
      lines.push(`  "${bit.id}" [label="${label}", fillcolor="${colour}", fontcolor="#ffffff"];`);
    }

    for (const edge of graph.edges) {
      const label = edge.relationshipType.slice(0, 20);
      lines.push(`  "${edge.sourceId}" -> "${edge.targetId}" [label="${label}", penwidth=${(edge.confidence * 2).toFixed(1)}];`);
    }

    lines.push("}");
    return lines.join("\n");
  }

  /** Render an adjacency list as plain text. */
  toAdjacencyList(graph: DiscourseGraph): string {
    const bitMap = new Map<string, DiscourseBit>(graph.bits.map(b => [b.id, b]));
    const lines: string[] = [];

    for (const bit of graph.bits) {
      const cat = categoryForType(bit.bitType as string);
      lines.push(`[${cat}] ${bit.text.trim()}`);
      const outEdges = graph.edges.filter(e => e.sourceId === bit.id);
      for (const e of outEdges) {
        const target = bitMap.get(e.targetId);
        if (target) {
          lines.push(`  --[${e.relationshipType} conf:${e.confidence.toFixed(2)}]--> ${target.text.trim().slice(0, 40)}`);
        }
      }
    }

    return lines.join("\n");
  }

  /** Render a summary table of bit types and counts. */
  toSummaryTable(graph: DiscourseGraph): Array<{ type: string; count: number; category: DiscourseCategory; colour: string }> {
    const counts = new Map<string, number>();
    for (const bit of graph.bits) {
      const t = bit.bitType as string;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([type, count]) => {
      const cat = categoryForType(type);
      return { type, count, category: cat, colour: CATEGORY_COLOURS[cat] ?? "#cccccc" };
    });
  }

  /** Return bits coloured by category as an array of {text, colour} tokens. */
  toColouredTokens(graph: DiscourseGraph): Array<{ text: string; colour: string; type: string }> {
    return graph.bits.map(bit => {
      const cat = categoryForType(bit.bitType as string);
      return { text: bit.text, colour: CATEGORY_COLOURS[cat] ?? "#cccccc", type: bit.bitType as string };
    });
  }
}
