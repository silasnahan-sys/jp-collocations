import type { YomitanEntry, StructuredContent } from "../yomitan/types.ts";

export function renderEntry(
  entry: YomitanEntry,
  container: HTMLElement,
  onJump: (term: string) => void
): void {
  // Headword row
  const headRow = container.createDiv("mkd-headword-row");
  if (entry.reading && entry.reading !== entry.expression) {
    headRow.createEl("ruby", {}, (ruby) => {
      ruby.createEl("span", { text: entry.expression, cls: "mkd-rb" });
      ruby.createEl("rt", { text: entry.reading });
    });
  } else {
    headRow.createEl("span", { text: entry.expression, cls: "mkd-headword" });
  }

  // Tags
  if (entry.termTags || entry.definitionTags) {
    const tagsRow = container.createDiv("mkd-tags-row");
    for (const tag of [...entry.termTags.split(" "), ...entry.definitionTags.split(" ")].filter(Boolean)) {
      tagsRow.createEl("span", { text: tag, cls: "mkd-tag-chip" });
    }
  }

  // Definitions
  const defsEl = container.createDiv("mkd-definitions");
  if (entry.definitions.length === 1) {
    renderDefinition(entry.definitions[0], defsEl, onJump, false);
  } else {
    entry.definitions.forEach((def, i) => {
      const senseEl = defsEl.createDiv("mkd-sense");
      const num = circledNumber(i + 1);
      senseEl.createEl("span", { text: num, cls: "mkd-sense-num" });
      renderDefinition(def, senseEl, onJump, true);
    });
  }
}

function renderDefinition(
  def: string | StructuredContent,
  container: HTMLElement,
  onJump: (term: string) => void,
  inline: boolean
): void {
  if (typeof def === "string") {
    const p = container.createEl(inline ? "span" : "p", { cls: "mkd-def-text" });
    p.textContent = def;
    // Detect cross-references like 「→ word」
    renderInlineRefs(p, def, onJump);
    return;
  }
  renderStructuredContent(def, container, onJump);
}

function renderInlineRefs(el: HTMLElement, text: string, onJump: (term: string) => void): void {
  const refPattern = /[→⇒▷]([^\s。、]+)/g;
  const matches = [...text.matchAll(refPattern)];
  if (!matches.length) return;
  el.textContent = "";
  let last = 0;
  for (const m of matches) {
    if (m.index! > last) {
      el.appendText(text.slice(last, m.index!));
    }
    const link = el.createEl("a", { text: m[0], cls: "mkd-xref" });
    link.addEventListener("click", () => onJump(m[1]));
    last = m.index! + m[0].length;
  }
  if (last < text.length) el.appendText(text.slice(last));
}

function renderStructuredContent(
  node: StructuredContent,
  container: HTMLElement,
  onJump: (term: string) => void
): void {
  if (!node || typeof node !== "object") return;
  const tag = (node.tag as string) || "span";
  const el = container.createEl(tag as keyof HTMLElementTagNameMap);

  // Apply data classes
  if (node.data) {
    for (const [k, v] of Object.entries(node.data)) {
      if (k === "content") el.addClass(`mkd-sc-${v}`);
    }
  }
  if (node.style) {
    for (const [k, v] of Object.entries(node.style)) {
      (el.style as unknown as Record<string, string>)[k] = v;
    }
  }

  // Handle cross-reference links
  if (tag === "a" && node.href) {
    el.addClass("mkd-xref");
    const term = String(node.href).replace(/^.*\//, "");
    el.addEventListener("click", () => onJump(term));
  }

  if (typeof node.content === "string") {
    el.textContent = node.content;
  } else if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (typeof child === "string") {
        el.appendText(child);
      } else {
        renderStructuredContent(child, el, onJump);
      }
    }
  } else if (node.content && typeof node.content === "object") {
    renderStructuredContent(node.content as StructuredContent, el, onJump);
  }
}

function circledNumber(n: number): string {
  const circles = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
  return n <= 20 ? circles[n - 1] : `(${n})`;
}
