/**
 * ```tategaki fences — vertical text inside an ordinary note.
 *
 * This is the cheapest way to get tategaki on mobile: it renders in reading
 * view, so it works in Obsidian's own scroll container with no extra chrome,
 * and it is the natural place to show a Japanese passage in a note that is
 * otherwise horizontal.
 */

import type { MarkdownPostProcessorContext } from "obsidian";

import type { TategakiSettings } from "./settings.ts";
import { parseBlocks } from "./text.ts";
import { TategakiRenderer } from "./TategakiRenderer.ts";
import type { CollocationBridge } from "./collocation-bridge.ts";
import { ScrollController } from "./gestures.ts";

export const TATEGAKI_CODE_BLOCK_LANGS = ["tategaki", "縦書き"];

export type CodeBlockProcessor = (
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext
) => void;

/**
 * Build the processor.
 *
 * `getSettings` is a getter rather than a value so a settings change takes
 * effect on the next re-render without re-registering the processor.
 */
export function createTategakiCodeBlockProcessor(
  getSettings: () => TategakiSettings,
  bridge: CollocationBridge | null
): CodeBlockProcessor {
  return (source, el) => {
    const settings = getSettings();
    const renderer = new TategakiRenderer();

    const host = el.ownerDocument.createElement("div");
    host.className = "jp-tg-embed";
    host.style.fontSize = `${settings.fontSize}px`;
    host.style.lineHeight = `${settings.lineHeight}`;
    host.style.setProperty(
      "--jp-tg-measure",
      settings.maxCharsPerLine > 0 ? `${settings.maxCharsPerLine}em` : "none"
    );
    if (!settings.enabled) host.classList.add("jp-tg--horizontal");
    if (settings.fontFamily === "gothic") {
      host.style.fontFamily = '"Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif';
    } else if (settings.fontFamily === "custom" && settings.customFontFamily) {
      host.style.fontFamily = settings.customFontFamily;
    }
    el.appendChild(host);

    const blocks = parseBlocks(source, {
      furigana: settings.showFurigana,
      tateChuYoko: settings.tateChuYoko,
    });

    const matcher = settings.highlightCollocations && bridge?.isAvailable()
      ? bridge.getMatcher({ maxEntries: settings.maxHighlightEntries })
      : null;

    renderer.render(host, blocks, {
      highlight: Boolean(matcher),
      matcher,
      chunkSize: settings.chunkSize,
      onComplete: () => {
        // Vertical flows start at the right edge; without this the reader
        // opens on the *last* column of the passage.
        const scroller = new ScrollController(host);
        window.requestAnimationFrame(() => {
          scroller.calibrate();
          scroller.scrollToStart();
        });
      },
    });
  };
}
