/**
 * Japanese text + markdown handling for vertical (縦書き) rendering.
 *
 * Pure functions only — no DOM, no Obsidian imports — so this file is easy to
 * unit-test and safe to reuse from anywhere in the plugin.
 */

export type InlineNode =
  | { kind: "text"; text: string }
  /** 縦中横 — a short run (2-digit numbers, "!?") set upright inside vertical text. */
  | { kind: "tcy"; text: string }
  /** Ruby / furigana: base characters with a reading alongside. */
  | { kind: "ruby"; base: string; ruby: string }
  | { kind: "bold"; children: InlineNode[] }
  | { kind: "italic"; children: InlineNode[] }
  | { kind: "strike"; children: InlineNode[] }
  | { kind: "mark"; children: InlineNode[] }
  | { kind: "code"; text: string }
  | { kind: "link"; children: InlineNode[]; href: string; internal: boolean };

export interface ParagraphBlock {
  kind: "paragraph";
  inlines: InlineNode[];
  /** First line of a paragraph group — gets the traditional 1-character 字下げ. */
  indent: boolean;
}

export type Block =
  | ParagraphBlock
  | { kind: "heading"; level: number; inlines: InlineNode[] }
  | { kind: "quote"; inlines: InlineNode[]; depth: number }
  | { kind: "list-item"; marker: string; depth: number; inlines: InlineNode[] }
  | { kind: "code-block"; lang: string; text: string }
  | { kind: "image"; alt: string; src: string }
  | { kind: "rule" }
  | { kind: "spacer" };

export interface ParseOptions {
  /** Parse ruby syntaxes into ruby nodes (otherwise the markup is stripped). */
  furigana: boolean;
  /** Detect 縦中横 candidates. */
  tateChuYoko: boolean;
}

export const DEFAULT_PARSE_OPTIONS: ParseOptions = { furigana: true, tateChuYoko: true };

// ── Character classes ────────────────────────────────────────────────────────

const KANJI = /[一-鿿々〆ヶ]/;
const KANA = /[ぁ-ゟ゠-ヿ]/;

export function isKanji(ch: string): boolean {
  return KANJI.test(ch);
}

export function isKana(ch: string): boolean {
  return KANA.test(ch);
}

export function isJapanese(ch: string): boolean {
  return isKanji(ch) || isKana(ch);
}

/** True when the string contains at least one Japanese character. */
export function hasJapanese(text: string): boolean {
  for (const ch of text) {
    if (isJapanese(ch)) return true;
  }
  return false;
}

// ── Frontmatter ──────────────────────────────────────────────────────────────

export interface FrontmatterSplit {
  frontmatter: string;
  body: string;
}

/** Split a leading `---` YAML block off the note body. */
export function stripFrontmatter(source: string): FrontmatterSplit {
  if (!source.startsWith("---")) return { frontmatter: "", body: source };
  const lines = source.split("\n");
  if (lines[0].trim() !== "---") return { frontmatter: "", body: source };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return {
        frontmatter: lines.slice(1, i).join("\n"),
        body: lines.slice(i + 1).join("\n"),
      };
    }
  }
  return { frontmatter: "", body: source };
}

/** Cheap check for a `tategaki: true`-style flag in frontmatter. */
export function frontmatterWantsTategaki(frontmatter: string): boolean {
  return /^\s*(tategaki|縦書き|vertical)\s*:\s*(true|yes|on|はい)\s*$/im.test(frontmatter);
}

// ── Inline parsing ───────────────────────────────────────────────────────────

/** Runs that should be set upright rather than rotated. */
const TCY_PUNCT = new Set(["!!", "!?", "?!", "??", "‼", "⁉"]);

function pushText(out: InlineNode[], text: string, opts: ParseOptions): void {
  if (!text) return;
  if (!opts.tateChuYoko) {
    out.push({ kind: "text", text });
    return;
  }

  let buf = "";
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (TCY_PUNCT.has(two)) {
      if (buf) { out.push({ kind: "text", text: buf }); buf = ""; }
      out.push({ kind: "tcy", text: two });
      i += 2;
      continue;
    }
    if (text[i] >= "0" && text[i] <= "9") {
      let j = i;
      while (j < text.length && text[j] >= "0" && text[j] <= "9") j++;
      const run = text.slice(i, j);
      // Only 2-digit runs combine upright; longer numbers stay rotated so they
      // remain readable, which is what Japanese typesetting conventions expect.
      if (run.length === 2) {
        if (buf) { out.push({ kind: "text", text: buf }); buf = ""; }
        out.push({ kind: "tcy", text: run });
      } else {
        buf += run;
      }
      i = j;
      continue;
    }
    buf += text[i];
    i++;
  }
  if (buf) out.push({ kind: "text", text: buf });
}

/** Find `close` starting at `from`; returns -1 when unterminated on this line. */
function findClose(src: string, from: number, close: string): number {
  const idx = src.indexOf(close, from);
  if (idx === -1) return -1;
  const nl = src.indexOf("\n", from);
  if (nl !== -1 && nl < idx) return -1;
  return idx;
}

/** Pull the trailing base word off the buffer for implicit `漢字《かんじ》` ruby. */
function splitRubyBase(buf: string): { head: string; base: string } {
  let i = buf.length;
  const wantKanji = i > 0 && isKanji(buf[i - 1]);
  while (i > 0) {
    const ch = buf[i - 1];
    const ok = wantKanji ? isKanji(ch) : isJapanese(ch);
    if (!ok) break;
    i--;
    if (buf.length - i >= 12) break;
  }
  return { head: buf.slice(0, i), base: buf.slice(i) };
}

/**
 * Parse inline markup, including the four furigana syntaxes commonly used in
 * Japanese Obsidian vaults:
 *   `{漢字|かんじ}`  `[漢字]{かんじ}`  `｜漢字《かんじ》`  `漢字《かんじ》`
 */
export function parseInline(src: string, opts: ParseOptions = DEFAULT_PARSE_OPTIONS): InlineNode[] {
  const out: InlineNode[] = [];
  let buf = "";
  let i = 0;

  const flush = (): void => {
    if (buf) { pushText(out, buf, opts); buf = ""; }
  };

  while (i < src.length) {
    const ch = src[i];
    const rest = src.slice(i);

    // ── [漢字]{かんじ} ruby, [text](href) link, [[wikilink]] ──────────────
    if (ch === "[") {
      if (rest.startsWith("[[")) {
        const end = findClose(src, i + 2, "]]");
        if (end !== -1) {
          const inner = src.slice(i + 2, end);
          const [target, alias] = inner.split("|");
          flush();
          out.push({
            kind: "link",
            children: parseInline(alias ?? target, opts),
            href: target,
            internal: true,
          });
          i = end + 2;
          continue;
        }
      }
      const closeBracket = findClose(src, i + 1, "]");
      if (closeBracket !== -1) {
        const label = src.slice(i + 1, closeBracket);
        const after = src[closeBracket + 1];
        if (after === "{" && opts.furigana) {
          const closeBrace = findClose(src, closeBracket + 2, "}");
          if (closeBrace !== -1) {
            flush();
            out.push({ kind: "ruby", base: label, ruby: src.slice(closeBracket + 2, closeBrace) });
            i = closeBrace + 1;
            continue;
          }
        }
        if (after === "(") {
          const closeParen = findClose(src, closeBracket + 2, ")");
          if (closeParen !== -1) {
            flush();
            out.push({
              kind: "link",
              children: parseInline(label, opts),
              href: src.slice(closeBracket + 2, closeParen),
              internal: false,
            });
            i = closeParen + 1;
            continue;
          }
        }
      }
    }

    // ── {漢字|かんじ} ruby ────────────────────────────────────────────────
    if (ch === "{" && opts.furigana) {
      const end = findClose(src, i + 1, "}");
      if (end !== -1) {
        const inner = src.slice(i + 1, end);
        const bar = inner.indexOf("|");
        if (bar > 0 && bar < inner.length - 1) {
          flush();
          out.push({ kind: "ruby", base: inner.slice(0, bar), ruby: inner.slice(bar + 1) });
          i = end + 1;
          continue;
        }
      }
    }

    // ── ｜漢字《かんじ》 (explicit aozora base) ──────────────────────────
    if ((ch === "｜" || ch === "|") && opts.furigana) {
      const open = src.indexOf("《", i + 1);
      const nl = src.indexOf("\n", i + 1);
      if (open !== -1 && (nl === -1 || open < nl)) {
        const close = findClose(src, open + 1, "》");
        if (close !== -1) {
          flush();
          out.push({ kind: "ruby", base: src.slice(i + 1, open), ruby: src.slice(open + 1, close) });
          i = close + 1;
          continue;
        }
      }
    }

    // ── 漢字《かんじ》 (implicit base taken from the preceding run) ───────
    if (ch === "《" && opts.furigana) {
      const close = findClose(src, i + 1, "》");
      if (close !== -1) {
        const { head, base } = splitRubyBase(buf);
        if (base) {
          buf = head;
          flush();
          out.push({ kind: "ruby", base, ruby: src.slice(i + 1, close) });
          i = close + 1;
          continue;
        }
      }
    }

    // ── Emphasis, highlight, strike, code ────────────────────────────────
    const wrapped = (open: string, close: string, kind: "bold" | "italic" | "strike" | "mark"): boolean => {
      if (!rest.startsWith(open)) return false;
      const end = findClose(src, i + open.length, close);
      if (end === -1 || end === i + open.length) return false;
      flush();
      out.push({ kind, children: parseInline(src.slice(i + open.length, end), opts) } as InlineNode);
      i = end + close.length;
      return true;
    };

    if (wrapped("**", "**", "bold")) continue;
    if (wrapped("__", "__", "bold")) continue;
    if (wrapped("~~", "~~", "strike")) continue;
    if (wrapped("==", "==", "mark")) continue;
    if (ch === "*" && !rest.startsWith("**") && wrapped("*", "*", "italic")) continue;

    if (ch === "`") {
      const end = findClose(src, i + 1, "`");
      if (end !== -1) {
        flush();
        out.push({ kind: "code", text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    buf += ch;
    i++;
  }

  flush();
  return out;
}

// ── Block parsing ────────────────────────────────────────────────────────────

const RULE_RE = /^\s*([-*_])\s*(\1\s*){2,}$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const QUOTE_RE = /^\s*((?:>\s*)+)(.*)$/;
const UL_RE = /^(\s*)[-*+]\s+(.*)$/;
const OL_RE = /^(\s*)(\d+)[.)]\s+(.*)$/;
const IMAGE_RE = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const EMBED_RE = /^\s*!\[\[([^\]]+)\]\]\s*$/;

/** Turn markdown source into blocks laid out for vertical rendering. */
export function parseBlocks(source: string, opts: ParseOptions = DEFAULT_PARSE_OPTIONS): Block[] {
  const lines = source.split("\n");
  const blocks: Block[] = [];
  let previousWasText = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code — kept as one horizontal island inside the vertical flow.
    const fence = /^\s*(```|~~~)(.*)$/.exec(line);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2].trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) {
        body.push(lines[i]);
        i++;
      }
      blocks.push({ kind: "code-block", lang, text: body.join("\n") });
      previousWasText = false;
      continue;
    }

    if (!line.trim()) {
      if (previousWasText) blocks.push({ kind: "spacer" });
      previousWasText = false;
      continue;
    }

    if (RULE_RE.test(line)) {
      blocks.push({ kind: "rule" });
      previousWasText = false;
      continue;
    }

    const image = IMAGE_RE.exec(line);
    if (image) {
      blocks.push({ kind: "image", alt: image[1], src: image[2] });
      previousWasText = false;
      continue;
    }

    const embed = EMBED_RE.exec(line);
    if (embed) {
      blocks.push({ kind: "image", alt: embed[1], src: embed[1] });
      previousWasText = false;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, inlines: parseInline(heading[2], opts) });
      previousWasText = false;
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      const depth = (quote[1].match(/>/g) ?? []).length;
      blocks.push({ kind: "quote", depth, inlines: parseInline(quote[2], opts) });
      previousWasText = true;
      continue;
    }

    const ordered = OL_RE.exec(line);
    if (ordered) {
      blocks.push({
        kind: "list-item",
        marker: `${ordered[2]}.`,
        depth: Math.floor(ordered[1].length / 2),
        inlines: parseInline(ordered[3], opts),
      });
      previousWasText = true;
      continue;
    }

    const unordered = UL_RE.exec(line);
    if (unordered) {
      blocks.push({
        kind: "list-item",
        marker: "・",
        depth: Math.floor(unordered[1].length / 2),
        inlines: parseInline(unordered[2], opts),
      });
      previousWasText = true;
      continue;
    }

    const text = line.replace(/\s+$/, "");
    blocks.push({
      kind: "paragraph",
      inlines: parseInline(text, opts),
      // 字下げ: indent the first line of each paragraph group, unless the
      // author already opened it with an ideographic space.
      indent: !previousWasText && !text.startsWith("　"),
    });
    previousWasText = true;
  }

  return blocks;
}

/** Flatten blocks back to plain text (used for lookups and character counts). */
export function blocksToPlainText(blocks: Block[]): string {
  const parts: string[] = [];
  const walk = (nodes: InlineNode[]): void => {
    for (const node of nodes) {
      switch (node.kind) {
        case "text":
        case "tcy":
        case "code":
          parts.push(node.text);
          break;
        case "ruby":
          parts.push(node.base);
          break;
        default:
          walk(node.children);
      }
    }
  };
  for (const block of blocks) {
    switch (block.kind) {
      case "paragraph":
      case "heading":
      case "quote":
      case "list-item":
        walk(block.inlines);
        parts.push("\n");
        break;
      case "code-block":
        parts.push(block.text, "\n");
        break;
      default:
        break;
    }
  }
  return parts.join("");
}

/** Count the characters a reader actually sees — used for the progress meter. */
export function countCharacters(blocks: Block[]): number {
  return blocksToPlainText(blocks).replace(/\s/g, "").length;
}
