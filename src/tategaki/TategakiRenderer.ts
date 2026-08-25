/**
 * Turns parsed blocks into DOM laid out for vertical writing.
 *
 * Plain DOM APIs only (no Obsidian helpers) so the renderer can be exercised
 * outside Obsidian, and rendering is chunked across animation frames so a long
 * note does not lock up a phone.
 */

import type { Block, InlineNode } from "./text.ts";
import type { PhraseMatcher } from "./collocation-bridge.ts";

export interface RenderOptions {
  /** Highlight lexicon phrases found in the text. */
  highlight: boolean;
  /** Matcher supplying those phrases; null disables highlighting. */
  matcher: PhraseMatcher | null;
  /** Characters to render per frame before yielding. */
  chunkSize: number;
  /** Resolve a vault image path to a displayable URL; null renders an alt chip. */
  resolveImage?: (src: string) => string | null;
  /** Called once the last chunk has been painted. */
  onComplete?: () => void;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  highlight: false,
  matcher: null,
  chunkSize: 4000,
};

export const SENTINEL_START = "start";
export const SENTINEL_END = "end";

export class TategakiRenderer {
  /** Bumped on every render so a superseded chunk loop stops on its next frame. */
  private generation = 0;
  private frameHandle: number | null = null;

  /** Abandon an in-flight chunked render. */
  cancel(): void {
    this.generation++;
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  /**
   * Render `blocks` into `container`, replacing its contents.
   * Returns the content element that holds the rendered blocks.
   */
  render(container: HTMLElement, blocks: Block[], options: Partial<RenderOptions> = {}): HTMLElement {
    const opts: RenderOptions = { ...DEFAULT_RENDER_OPTIONS, ...options };
    this.cancel();
    const generation = this.generation;

    container.textContent = "";
    const doc = container.ownerDocument;

    const content = doc.createElement("div");
    content.className = "jp-tg-content";
    content.appendChild(this.makeSentinel(doc, SENTINEL_START));
    container.appendChild(content);

    const endSentinel = this.makeSentinel(doc, SENTINEL_END);

    let index = 0;
    const renderChunk = (): void => {
      if (generation !== this.generation) return;
      let budget = opts.chunkSize;

      while (index < blocks.length && budget > 0) {
        const block = blocks[index++];
        const el = this.renderBlock(doc, block, opts);
        if (el) content.appendChild(el);
        budget -= blockWeight(block);
      }

      if (index < blocks.length) {
        this.frameHandle = requestAnimationFrame(renderChunk);
        return;
      }

      this.frameHandle = null;
      content.appendChild(endSentinel);
      opts.onComplete?.();
    };

    renderChunk();
    return content;
  }

  private makeSentinel(doc: Document, which: string): HTMLElement {
    const el = doc.createElement("span");
    el.className = "jp-tg-sentinel";
    el.dataset.jpTgSentinel = which;
    return el;
  }

  private renderBlock(doc: Document, block: Block, opts: RenderOptions): HTMLElement | null {
    switch (block.kind) {
      case "paragraph": {
        const el = doc.createElement("p");
        el.className = block.indent ? "jp-tg-para jp-tg--indent" : "jp-tg-para";
        this.renderInlines(doc, el, block.inlines, opts);
        return el;
      }
      case "heading": {
        const el = doc.createElement("div");
        el.className = `jp-tg-h jp-tg-h${block.level}`;
        this.renderInlines(doc, el, block.inlines, opts);
        return el;
      }
      case "quote": {
        const el = doc.createElement("div");
        el.className = "jp-tg-quote";
        if (block.depth > 1) el.style.paddingInlineStart = `${block.depth * 1.2}em`;
        this.renderInlines(doc, el, block.inlines, opts);
        return el;
      }
      case "list-item": {
        const el = doc.createElement("div");
        el.className = "jp-tg-li";
        if (block.depth > 0) el.style.paddingInlineStart = `${0.4 + block.depth * 1.1}em`;
        const marker = doc.createElement("span");
        marker.className = "jp-tg-li-marker";
        marker.textContent = block.marker;
        el.appendChild(marker);
        this.renderInlines(doc, el, block.inlines, opts);
        return el;
      }
      case "code-block": {
        const el = doc.createElement("pre");
        el.className = "jp-tg-codeblock";
        el.textContent = block.text;
        if (block.lang) el.dataset.lang = block.lang;
        return el;
      }
      case "image": {
        const url = opts.resolveImage?.(block.src) ?? null;
        if (url) {
          const img = doc.createElement("img");
          img.className = "jp-tg-img";
          img.src = url;
          img.alt = block.alt;
          img.loading = "lazy";
          return img;
        }
        const chip = doc.createElement("div");
        chip.className = "jp-tg-img-alt";
        chip.textContent = block.alt || block.src;
        return chip;
      }
      case "rule": {
        const el = doc.createElement("div");
        el.className = "jp-tg-rule";
        return el;
      }
      case "spacer": {
        const el = doc.createElement("div");
        el.className = "jp-tg-spacer";
        return el;
      }
      default:
        return null;
    }
  }

  private renderInlines(doc: Document, parent: HTMLElement, nodes: InlineNode[], opts: RenderOptions): void {
    for (const node of nodes) {
      switch (node.kind) {
        case "text":
          this.renderText(doc, parent, node.text, opts);
          break;

        case "tcy": {
          const el = doc.createElement("span");
          el.className = "jp-tg-tcy";
          el.textContent = node.text;
          parent.appendChild(el);
          break;
        }

        case "ruby": {
          const ruby = doc.createElement("ruby");
          this.renderText(doc, ruby, node.base, opts);
          // rp keeps the reading legible if the platform drops ruby support.
          const rpOpen = doc.createElement("rp");
          rpOpen.textContent = "(";
          const rt = doc.createElement("rt");
          rt.textContent = node.ruby;
          const rpClose = doc.createElement("rp");
          rpClose.textContent = ")";
          ruby.append(rpOpen, rt, rpClose);
          parent.appendChild(ruby);
          break;
        }

        case "code": {
          const el = doc.createElement("code");
          el.className = "jp-tg-code";
          el.textContent = node.text;
          parent.appendChild(el);
          break;
        }

        case "link": {
          const el = doc.createElement("span");
          el.className = "jp-tg-link";
          el.dataset.jpTgHref = node.href;
          if (node.internal) el.dataset.jpTgInternal = "1";
          this.renderInlines(doc, el, node.children, opts);
          parent.appendChild(el);
          break;
        }

        case "bold":
        case "italic":
        case "strike":
        case "mark": {
          const el = doc.createElement("span");
          el.className = `jp-tg-${node.kind}`;
          this.renderInlines(doc, el, node.children, opts);
          parent.appendChild(el);
          break;
        }
      }
    }
  }

  /** Plain text, split into highlight spans where lexicon phrases occur. */
  private renderText(doc: Document, parent: HTMLElement, text: string, opts: RenderOptions): void {
    if (!text) return;

    if (!opts.highlight || !opts.matcher || opts.matcher.isEmpty()) {
      parent.appendChild(doc.createTextNode(text));
      return;
    }

    const hits = opts.matcher.match(text);
    if (hits.length === 0) {
      parent.appendChild(doc.createTextNode(text));
      return;
    }

    let cursor = 0;
    for (const hit of hits) {
      if (hit.start > cursor) {
        parent.appendChild(doc.createTextNode(text.slice(cursor, hit.start)));
      }
      const span = doc.createElement("span");
      span.className = "jp-tg-colloc";
      span.dataset.jpTgPhrase = hit.phrase;
      if (hit.entryIds.length) span.dataset.jpTgIds = hit.entryIds.join(",");
      span.textContent = text.slice(hit.start, hit.end);
      parent.appendChild(span);
      cursor = hit.end;
    }
    if (cursor < text.length) {
      parent.appendChild(doc.createTextNode(text.slice(cursor)));
    }
  }
}

/** Rough character cost of a block, used to size render chunks. */
function blockWeight(block: Block): number {
  switch (block.kind) {
    case "paragraph":
    case "heading":
    case "quote":
    case "list-item":
      return Math.max(8, inlineWeight(block.inlines));
    case "code-block":
      return Math.max(8, block.text.length);
    default:
      return 4;
  }
}

function inlineWeight(nodes: InlineNode[]): number {
  let total = 0;
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
      case "tcy":
      case "code":
        total += node.text.length;
        break;
      case "ruby":
        total += node.base.length + node.ruby.length;
        break;
      default:
        total += inlineWeight(node.children);
    }
  }
  return total;
}
