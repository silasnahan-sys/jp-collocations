# JP Collocations

An Obsidian community plugin — a searchable, dynamic Japanese collocation lexicon for writing, searching, and indexing phrase combinations.

Inspired by and seeded with data from [collocation.hyogen.info](https://collocation.hyogen.info/) (日本語コロケーション辞典 — built from ~12,000 Aozora Bunko literary works).

---

## Features

- **220+ seed collocations** across all major POS categories (名詞+動詞, 名詞+形容詞, 副詞+動詞, な形容詞+名詞, etc.)
- **Full-text search** with Japanese-aware fuzzy matching (hiragana/katakana/kanji/romaji input)
- **Grammar-aware search** — automatically expands conjugated forms (verb forms, い-adjective forms, etc.)
- **Wildcard search** — use `*` and `?` for pattern matching
- **POS filtering** — filter by part of speech (名詞, 動詞, い形容詞, な形容詞, 副詞, ...)
- **Tag filtering** — user-defined tags
- **Sidebar view** — live search, entry cards with readings, patterns, example sentences
- **Search modal** — quick fuzzy search with direct insertion into the editor
- **Add / Edit entries** — modal form with auto-detection of POS and phrase generation
- **Hyogen scraper** — optionally fetch more collocations from collocation.hyogen.info
- **Import / Export** — JSON import/export for sharing or backup
- **Light & dark theme** compatible
- **縦書き Tategaki reader** — mobile-first vertical Japanese reading with tap-to-look-up ([details](#-縦書き-tategaki--vertical-reading-on-mobile))

---

## Installation

### Manual Install

1. Download or build the plugin (see [Building](#building))
2. Copy `main.js`, `manifest.json`, and `styles.css` into:
   ```
   <your vault>/.obsidian/plugins/jp-collocations/
   ```
3. Reload Obsidian
4. Enable the plugin in **Settings → Community Plugins**

### 📱 iOS / Mobile Install (No Build Required)

1. Download these 3 files from the [`dist/` folder](https://github.com/silasnahan-sys/jp-collocations/tree/main/dist):
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. On your device, navigate to your Obsidian vault folder
3. Go to `.obsidian/plugins/` (create it if it doesn't exist)
4. Create a new folder called `jp-collocations`
5. Place the 3 downloaded files inside `jp-collocations/`
6. Open Obsidian → Settings → Community Plugins → Enable "JP Collocations"

---

## Usage

### Open the Lexicon

- Click the **languages** ribbon icon, or
- Use the command palette: **JP Collocations: Open Lexicon**

### Search

- Type in the search bar in the sidebar — searches headwords, collocates, full phrases, readings, and example sentences
- Supports Japanese (kanji/kana), romaji (auto-converted to hiragana), and wildcards (`*`, `?`)
- Click POS chips to filter by part of speech

### Quick Search Modal

- Command palette: **JP Collocations: Search** (bindable to hotkey)
- Select a result to **insert it directly** into the active editor

### Add an Entry

- Click the **+** button in the sidebar, or use **JP Collocations: Add Entry**
- Fill in headword, reading, collocate, POS, pattern, examples, tags
- Auto-generates fullPhrase from headword + collocate

### Fetch from Hyogen

1. Go to **Settings → JP Collocations → Hyogen Scraper**
2. Enable scraping and add words to the word list
3. Use **JP Collocations: Fetch from Hyogen** command
4. Respects a configurable rate limit (default 2s between requests)

### Import / Export

- **JP Collocations: Export Data** — saves all entries as JSON
- **JP Collocations: Import Data** — imports entries from a JSON file
- Also available in **Settings → Data Management**

---

## Data Model

```typescript
interface CollocationEntry {
  id: string;
  headword: string;           // e.g. "風"
  headwordReading: string;    // e.g. "かぜ"
  collocate: string;          // e.g. "が吹く"
  fullPhrase: string;         // e.g. "風が吹く"
  headwordPOS: PartOfSpeech;
  collocatePOS: PartOfSpeech;
  pattern: string;            // e.g. "N+が+V"
  exampleSentences: string[];
  source: CollocationSource;  // "hyogen.info" | "manual" | "import"
  tags: string[];
  notes: string;
  frequency: number;          // 1-100 importance score
  createdAt: number;
  updatedAt: number;
}
```

---

## Building

```bash
npm install
npm run build   # produces main.js
npm run dev     # watch mode
```

---

## File Structure

```
/
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── styles.css
├── src/
│   ├── main.ts
│   ├── types.ts
│   ├── data/
│   │   ├── CollocationStore.ts
│   │   └── seed-data.ts
│   ├── scraper/
│   │   └── HyogenScraper.ts
│   ├── search/
│   │   └── SearchEngine.ts
│   ├── ui/
│   │   ├── CollocationView.ts
│   │   ├── SearchModal.ts
│   │   ├── AddEntryModal.ts
│   │   └── SettingsTab.ts
│   └── utils/
│       ├── japanese.ts
│       └── grammar.ts
```

---

## 📖 縦書き Tategaki — vertical reading on mobile

Read your notes the way Japanese prose is actually set: top-to-bottom, right-to-left,
on a phone. Tap a word to see the collocations it belongs to.

### Open it

- Ribbon icon **縦書き Tategaki reader**, or
- Command palette: **Read in Tategaki (縦書きで読む)**, or
- Long-press a note in the file list → **縦書きで読む**

### Gestures

| Gesture | What happens |
| --- | --- |
| Tap a word | Looks it up in the lexicon and opens a bottom sheet |
| Tap the screen edges | Turns the page (paged mode — right edge goes back) |
| Pinch | Resizes the text; your place is kept |
| Long-press | Copy, look up, edit, or jump back to the start |
| Flick down on the sheet | Dismisses it |
| ✎ in the toolbar | Edits the note in a horizontal sheet (mobile IMEs behave there) |

The toolbar carries text size, furigana, paged/scrolling, collocation
highlighting, vertical/horizontal and reload. Reading position is remembered per
note, and the bar along the bottom shows how far through you are.

### Japanese typesetting

- **Furigana** from `{漢字|かんじ}`, `[漢字]{かんじ}`, `｜漢字《かんじ》` and `漢字《かんじ》`
- **縦中横** — two-digit numbers stand upright inside the vertical line
- **圏点** — `**bold**` renders as sesame dots beside the column
- Code blocks and images become horizontal islands inside the vertical flow

### Vertical text inside an ordinary note

````markdown
```tategaki
　風が吹く日は、いつも{海《うみ》}のことを思い出す。
```
````

Renders vertically in reading view, on desktop and mobile alike.

### Collocation integration

With the lexicon loaded, phrases it knows are underlined where they occur —
including conjugated forms, so 風が吹く is found in 風が吹いた. Tapping one opens
the entry with its pattern, readings and examples, plus **コピー** and **挿入**
(insert at the cursor of the open editor).

Settings live under **Settings → JP Collocations → 縦書き Tategaki**.
Implementation notes and the integration checklist are in
[`src/tategaki/INTEGRATION.md`](src/tategaki/INTEGRATION.md).

---

## Contributing

Contributions welcome! Some ideas:
- Add more seed collocations
- Improve the Hyogen HTML parser
- Add furigana display using ruby elements
- Add Anki export
- Add stroke-order or pitch accent display

Please open an issue or PR on [GitHub](https://github.com/silasnahan-sys/jp-collocations).
