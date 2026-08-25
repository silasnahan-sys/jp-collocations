/**
 * 縦書き (tategaki) — mobile-first vertical Japanese reading for jp-collocations.
 *
 * Start here: `registerTategaki(plugin)` wires everything up in one call.
 * See INTEGRATION.md in this folder for the post-merge checklist.
 */

export { registerTategaki } from "./register.ts";
export type { RegisterTategakiOptions, TategakiHandle } from "./register.ts";

export { TategakiView, TATEGAKI_VIEW_TYPE } from "./TategakiView.ts";
export type { TategakiViewOptions } from "./TategakiView.ts";

export { TategakiRenderer } from "./TategakiRenderer.ts";
export type { RenderOptions } from "./TategakiRenderer.ts";

export { CollocationBridge, PhraseMatcher, entryPhrase } from "./collocation-bridge.ts";
export type { LexEntry, LexiconHost, PhraseHit, BridgeOptions } from "./collocation-bridge.ts";

export {
  parseBlocks,
  parseInline,
  stripFrontmatter,
  frontmatterWantsTategaki,
  blocksToPlainText,
  countCharacters,
  isKanji,
  isKana,
  isJapanese,
  hasJapanese,
} from "./text.ts";
export type { Block, InlineNode, ParseOptions } from "./text.ts";

export {
  DEFAULT_TATEGAKI_SETTINGS,
  loadTategakiSettings,
  saveTategakiSettings,
  normaliseSettings,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  LINE_HEIGHT_MIN,
  LINE_HEIGHT_MAX,
} from "./settings.ts";
export type { TategakiSettings } from "./settings.ts";

export { buildTategakiSettings } from "./settings-ui.ts";
export type { SettingsUIContext } from "./settings-ui.ts";

export { createTategakiCodeBlockProcessor, TATEGAKI_CODE_BLOCK_LANGS } from "./codeblock.ts";
export { EditorVerticalMode } from "./editor-mode.ts";
export { BottomSheet } from "./Sheet.ts";
export { renderEntryCard, renderEmptyState } from "./entry-card.ts";
export type { CardAction } from "./entry-card.ts";
export {
  ScrollController,
  attachPinchZoom,
  attachTapGestures,
  onScrollSettled,
  caretFromPoint,
  runAroundOffset,
  haptic,
} from "./gestures.ts";
export { injectTategakiStyles, removeTategakiStyles, TATEGAKI_CSS } from "./styles.ts";
