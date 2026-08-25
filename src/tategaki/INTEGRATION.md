# 縦書き Tategaki — integration guide

A mobile-first vertical Japanese reader for jp-collocations. Everything lives in
`src/tategaki/`; the rest of the plugin needs **one line** to switch it on.

This module was written while other agents were still working on the plugin, so
it is deliberately built to merge cleanly: it owns its own stylesheet, its own
settings storage, and it reaches the lexicon through duck typing rather than
imports.

---

## 1. Hooking it up

Already applied on this branch — re-apply these if a merge drops them.

**`src/main.ts`** — three additions:

```ts
import { registerTategaki } from "./tategaki/register.ts";
import type { TategakiHandle } from "./tategaki/register.ts";

export default class JPCollocationsPlugin extends Plugin {
  tategaki: TategakiHandle | null = null;

  async onload(): Promise<void> {
    // …after this.store and this.engine exist:
    this.tategaki = registerTategaki(this);
  }

  async onunload(): Promise<void> {
    this.tategaki?.unload();
  }
}
```

That single call registers the view, the commands, the ribbon icon, the
file-menu item, the ```` ```tategaki ```` code block and the stylesheet.

**`src/ui/SettingsTab.ts`** — one call at the end of `display()`:

```ts
this.tategaki?.buildSettings(containerEl);   // or, duck-typed, as on this branch
```

**Optional extras** (both already wired in `main.ts`):

```ts
// Let the reader open the plugin's own search modal for a term it cannot find.
registerTategaki(this, { openLexiconSearch: query => { /* open SearchModal */ } });

// After an import / scrape / bulk edit, rebuild the highlight matcher:
this.tategaki?.invalidateLexicon();
```

If the plugin stops exposing `store` / `engine` on the plugin instance, point the
bridge somewhere else instead of changing this module:

```ts
registerTategaki(this, { getLexiconHost: () => ({ store: this.data.store, engine: this.data.engine }) });
```

---

## 2. What it registers

| Kind | Id / value |
| --- | --- |
| View type | `jp-tategaki-view` |
| Command | `tategaki-open-reader` — Read in Tategaki (縦書きで読む) |
| Command | `tategaki-toggle-page-mode` |
| Command | `tategaki-toggle-furigana` |
| Command | `tategaki-toggle-editor-vertical` (experimental) |
| Command | `tategaki-wrap-selection` — wrap the selection in a vertical block |
| Code blocks | ```` ```tategaki ```` and ```` ```縦書き ```` |
| Ribbon | 縦書き Tategaki reader (pass `ribbon: false` to skip) |
| File menu | 縦書きで読む on markdown files |
| Settings key | `tategaki`, nested inside the plugin's existing settings object |

---

## 3. Files

| File | Role |
| --- | --- |
| `register.ts` | The one-call entry point. Start here. |
| `TategakiView.ts` | The reader: toolbar, canvas, progress, lookup + edit sheets. |
| `TategakiRenderer.ts` | Blocks → DOM, chunked across frames, with highlight spans. |
| `text.ts` | Markdown + Japanese parsing. Pure functions, no DOM. |
| `gestures.ts` | Scroll maths, pinch, tap/long-press, caret hit-testing. |
| `collocation-bridge.ts` | Duck-typed lexicon access + the phrase matcher. |
| `Sheet.ts`, `entry-card.ts` | Bottom sheet and lexicon cards. |
| `codeblock.ts` | The ```` ```tategaki ```` reading-view processor. |
| `editor-mode.ts` | Opt-in vertical mode for Obsidian's own editor. |
| `settings.ts`, `settings-ui.ts` | Settings model, persistence, settings section. |
| `styles.ts` | The stylesheet, injected at runtime. |
| `index.ts` | Public exports. |

---

## 4. Why these choices (mobile)

- **Vertical text scrolls horizontally and starts at the right edge.** Engines
  disagree on the sign and origin of `scrollLeft` in `vertical-rl`, so
  `ScrollController` probes the element for its real range once and works in
  relative deltas. Without this the reader opens on the *last* column — the
  single most common bug in vertical-text implementations.
- **Paging and smooth scrolling are driven from JS, not CSS.** CSS scroll-snap
  would pin the scroller to the sentinel elements, and CSS `scroll-behavior:
  smooth` would animate the probe above and return the wrong numbers.
- **`touch-action: pan-x` plus `overscroll-behavior: contain`.** The reader owns
  the horizontal gesture, so a page flick cannot pull Obsidian's sidebar open,
  and pinch resizes the *type* rather than zooming the webview.
- **A synthetic `click` follows every touch.** Taps are debounced against
  `touchend`, otherwise each tap looked a word up twice.
- **Editing happens in a horizontal textarea.** Mobile IMEs position the
  candidate window from a horizontal caret; in a vertical contenteditable it
  lands in the wrong place on both iOS and Android. The ✎ button opens a sheet,
  checks the file has not changed underneath, and writes back with
  `vault.modify`.
- **Bottom sheet rather than a modal.** It keeps the text visible above it, and
  a downward flick dismisses it.
- **44px controls, safe-area insets, chunked rendering** so a long note does not
  block the main thread on an old phone.

---

## 5. Integration points for later work

- `CollocationBridge.setFormExpander(fn)` — hand it `src/utils/grammar.ts`'s
  conjugation expander and the matcher will use real inflection tables instead
  of the built-in kana-tail heuristic.
- `TategakiRenderer` and `parseBlocks` are independent of the view — reuse them
  for a surf mode, flashcards, or a print view.
- `renderEntryCard` is the shared lexicon card.
- The lookup sheet shows collocation entries today. A Yomitan dictionary tab
  would slot into `TategakiView.showLookup` without touching anything else.

---

## 6. Known limitations

- Markdown tables render as plain lines.
- Callouts render as ordinary blockquotes.
- The vertical *editor* mode (`editor-mode.ts`) is experimental and off by
  default; CodeMirror keeps its caret in horizontal coordinates.
- Highlighting is capped (default 4000 entries, configurable) to keep long notes
  smooth.
- Ruby needs a font with vertical metrics; the module falls back to `(かんじ)`
  in parentheses where `<ruby>` is unsupported.

---

## 7. Verified

`npm run build` passes (`tsc --noEmit` + esbuild). The pure logic — ruby
syntaxes, 縦中横 detection, block parsing, the phrase matcher including
conjugated forms, tap-target extraction, settings normalisation — and the
renderer's DOM output were exercised against a JSDOM harness: 60 checks, all
passing. The touch and scroll behaviour needs a real device; the reasoning
behind each choice is in section 4 so it can be re-checked on hardware.
