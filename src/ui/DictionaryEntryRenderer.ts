// ─── Dictionary Entry Renderer ───────────────────────────────────────────────
// Renders a single Yomitan term entry in the Monokakido style.
// Handles both monolingual Japanese and bilingual (English-Japanese) entries.

import type { YomitanSearchResult } from "../yomitan/types.ts";
import type { TermDefinitionContent } from "../yomitan/types.ts";

/** Circled number sequences ①②③… */
const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩",
                 "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"];

function circled(n: number): string {
  return CIRCLED[n - 1] ?? `(${n})`;
}

export class DictionaryEntryRenderer {
  /**
   * Render a list of search results into `container`.
   * Results are grouped by dictionary, monolingual results first.
   */
  renderResults(container: HTMLElement, results: YomitanSearchResult[]): void {
    container.empty();

    if (results.length === 0) {
      container.createDiv({ cls: "mkd-results-empty", text: "見つかりませんでした" });
      return;
    }

    // Group results by dictionary
    const groups = new Map<string, YomitanSearchResult[]>();
    for (const r of results) {
      const key = r.entry.dictionary;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    // Render each group
    for (const [dictTitle, groupResults] of groups) {
      const meta = groupResults[0].meta;
      const isBilingual = meta?.language === "en-ja" || meta?.language === "ja-en";

      const section = container.createDiv({
        cls: `mkd-result-section${isBilingual ? " mkd-result-section--bilingual" : ""}`,
      });

      // Dictionary name badge header
      const dictHeader = section.createDiv({ cls: "mkd-dict-header" });
      const badge = dictHeader.createSpan({ cls: "mkd-dict-badge" });
      badge.style.setProperty("--mkd-badge-color", meta?.color ?? "#6B7280");
      badge.setText(meta?.abbreviation ?? dictTitle);
      dictHeader.createSpan({
        cls: "mkd-dict-name",
        text: meta?.jaTitle ?? dictTitle,
      });

      // Entries within this group
      for (const result of groupResults) {
        this.renderEntry(section, result, isBilingual);
      }
    }
  }

  private renderEntry(
    container: HTMLElement,
    result: YomitanSearchResult,
    isBilingual: boolean,
  ): void {
    const { entry } = result;
    const card = container.createDiv({
      cls: `mkd-entry${isBilingual ? " mkd-entry--bilingual" : ""}`,
    });

    // ── Headword row ────────────────────────────────────────────────────────
    const headRow = card.createDiv({ cls: "mkd-entry-head" });

    if (isBilingual) {
      // English headword in serif-like font
      headRow.createSpan({ cls: "mkd-english-headword", text: entry.term });
      // Reading as IPA or pronunciation hint
      if (entry.reading && entry.reading !== entry.term) {
        headRow.createSpan({ cls: "mkd-pronunciation", text: entry.reading });
      }
    } else {
      // Japanese headword
      headRow.createSpan({ cls: "mkd-headword", text: entry.term });
      if (entry.reading && entry.reading !== entry.term) {
        headRow.createSpan({ cls: "mkd-reading", text: `【${entry.reading}】` });
      }
    }

    // ── Definitions ─────────────────────────────────────────────────────────
    const defContainer = card.createDiv({ cls: "mkd-definitions" });
    let senseIndex = 0;

    for (const def of entry.definitions) {
      // POS / tag chips
      if (def.tags.length > 0) {
        const tagRow = defContainer.createDiv({ cls: "mkd-tag-row" });
        for (const tag of def.tags.slice(0, 4)) {
          tagRow.createSpan({ cls: "mkd-tag", text: tag });
        }
      }

      // Definition items
      for (const item of def.content) {
        senseIndex++;
        this.renderDefinitionItem(defContainer, item, senseIndex, isBilingual);
      }
    }
  }

  private renderDefinitionItem(
    container: HTMLElement,
    item: TermDefinitionContent,
    index: number,
    isBilingual: boolean,
  ): void {
    if (item.type === "image") return; // skip images for now

    if (item.type === "text" && item.text) {
      const row = container.createDiv({ cls: "mkd-sense-row" });
      row.createSpan({ cls: "mkd-sense-num", text: circled(index) });
      const body = row.createSpan({
        cls: isBilingual ? "mkd-translation" : "mkd-sense-text",
        text: item.text,
      });
      // Detect and style example sentences (lines starting with ▶ or e.g.)
      if (item.text.includes("▶") || item.text.includes("e.g.") || item.text.includes("例:")) {
        body.addClass("mkd-example-sentence");
      }
      return;
    }

    if (item.type === "structured-content" && item.content) {
      const row = container.createDiv({ cls: "mkd-sense-row" });
      row.createSpan({ cls: "mkd-sense-num", text: circled(index) });
      const body = row.createDiv({ cls: "mkd-sense-structured" });
      this.renderStructuredContent(body, item.content as Record<string, unknown>, isBilingual);
    }
  }

  private renderStructuredContent(
    el: HTMLElement,
    content: Record<string, unknown>,
    isBilingual: boolean,
  ): void {
    if (content.type === "structured-content" && Array.isArray(content.content)) {
      for (const child of content.content as unknown[]) {
        this.renderStructuredContent(el, child as Record<string, unknown>, isBilingual);
      }
      return;
    }
    if (typeof content === "string") {
      el.appendText(content);
      return;
    }
    if (content.tag) {
      const tag = content.tag as string;
      const child = el.createEl(tag as keyof HTMLElementTagNameMap, {
        cls: content.class as string | undefined,
      });
      if (content.content) {
        if (Array.isArray(content.content)) {
          for (const c of content.content as unknown[]) {
            this.renderStructuredContent(child, c as Record<string, unknown>, isBilingual);
          }
        } else if (typeof content.content === "string") {
          child.appendText(content.content);
        }
      }
      if (content.text) child.appendText(content.text as string);
      return;
    }
    // Fallback: stringify
    if (typeof content === "object") {
      const text = (content as Record<string, unknown>).text ?? (content as Record<string, unknown>).data;
      if (typeof text === "string") el.appendText(text);
    }
  }
}
