/**
 * One-call integration point for the tategaki module.
 *
 * The rest of jp-collocations is being worked on by several agents at once, so
 * this module deliberately keeps its footprint to a single call:
 *
 *   import { registerTategaki } from "./tategaki/register.ts";
 *   // inside onload(), after the store and engine exist:
 *   this.tategaki = registerTategaki(this);
 *
 * Everything else — the view, the commands, the ribbon icon, the code-block
 * processor, the stylesheet — is set up in here and torn down through the
 * plugin's own `register()` hooks. See INTEGRATION.md for the full checklist.
 */

import { Notice, TFile } from "obsidian";
import type { Plugin, WorkspaceLeaf, Editor } from "obsidian";

import type { TategakiSettings } from "./settings.ts";
import { loadTategakiSettings, saveTategakiSettings, DEFAULT_TATEGAKI_SETTINGS } from "./settings.ts";
import { injectTategakiStyles, removeTategakiStyles } from "./styles.ts";
import { CollocationBridge } from "./collocation-bridge.ts";
import type { LexiconHost } from "./collocation-bridge.ts";
import { TategakiView, TATEGAKI_VIEW_TYPE } from "./TategakiView.ts";
import { createTategakiCodeBlockProcessor, TATEGAKI_CODE_BLOCK_LANGS } from "./codeblock.ts";
import { EditorVerticalMode } from "./editor-mode.ts";
import { buildTategakiSettings } from "./settings-ui.ts";
import type { SettingsUIContext } from "./settings-ui.ts";

export interface RegisterTategakiOptions {
  /**
   * Where the lexicon lives. Defaults to the plugin itself, which is right as
   * long as it exposes `store` / `engine` — if those move, pass a getter.
   */
  getLexiconHost?: () => LexiconHost | null;
  /** Hook the reader's "search the lexicon" action into the plugin's own modal. */
  openLexiconSearch?: (query: string) => void;
  /** Add a ribbon icon for the reader. Defaults to true. */
  ribbon?: boolean;
}

export interface TategakiHandle {
  /** Live settings object — mutate through `updateSettings` to persist. */
  settings: TategakiSettings;
  bridge: CollocationBridge;
  /** Drop this into the plugin's settings tab: `handle.buildSettings(containerEl)`. */
  buildSettings: (containerEl: HTMLElement) => void;
  /** Open (or reveal) the reader, optionally on a specific file. */
  openReader: (file?: TFile | null) => Promise<void>;
  /** Re-render every open reader — call after importing entries, for instance. */
  refreshViews: () => void;
  /** Tell the reader the lexicon changed. */
  invalidateLexicon: () => void;
  /** Explicit teardown. Optional: the plugin's own unload already covers it. */
  unload: () => void;
}

/** Wire the tategaki reader into a plugin. Safe to call once in `onload()`. */
export function registerTategaki(plugin: Plugin, options: RegisterTategakiOptions = {}): TategakiHandle {
  const settings: TategakiSettings = { ...DEFAULT_TATEGAKI_SETTINGS };
  const doc = plugin.app.workspace.containerEl?.ownerDocument ?? document;
  const editorMode = new EditorVerticalMode(doc);

  injectTategakiStyles(doc);
  plugin.register(() => removeTategakiStyles(doc));
  plugin.register(() => editorMode.dispose());

  // Popout windows get their own document, and so need their own stylesheet.
  plugin.registerEvent(
    plugin.app.workspace.on("window-open", win => injectTategakiStyles(win.doc))
  );

  const bridge = new CollocationBridge(
    options.getLexiconHost ?? (() => plugin as unknown as LexiconHost)
  );

  const save = (next: TategakiSettings): void => {
    void saveTategakiSettings(plugin, next);
  };

  const views = (): TategakiView[] =>
    plugin.app.workspace
      .getLeavesOfType(TATEGAKI_VIEW_TYPE)
      .map(leaf => leaf.view)
      .filter((view): view is TategakiView => view instanceof TategakiView);

  const refreshViews = (): void => {
    for (const view of views()) view.refreshFromSettings();
  };

  // Settings arrive asynchronously; the defaults render fine until they land.
  void loadTategakiSettings(plugin).then(loaded => {
    Object.assign(settings, loaded);
    if (settings.editorVerticalMode) editorMode.set(true);
    for (const view of views()) view.refreshFromSettings();
  });

  plugin.registerView(
    TATEGAKI_VIEW_TYPE,
    (leaf: WorkspaceLeaf) =>
      new TategakiView(leaf, {
        settings,
        saveSettings: save,
        bridge,
        openLexiconSearch: options.openLexiconSearch,
      })
  );

  for (const language of TATEGAKI_CODE_BLOCK_LANGS) {
    plugin.registerMarkdownCodeBlockProcessor(
      language,
      createTategakiCodeBlockProcessor(() => settings, bridge)
    );
  }

  const openReader = async (file?: TFile | null): Promise<void> => {
    const workspace = plugin.app.workspace;
    const target = file ?? workspace.getActiveFile();

    const existing = workspace.getLeavesOfType(TATEGAKI_VIEW_TYPE)[0];
    if (existing) {
      await workspace.revealLeaf(existing);
      const view = existing.view;
      if (view instanceof TategakiView && target) await view.setFile(target);
      return;
    }

    // A tab in the main area, not the sidebar: the reader wants full height,
    // and on a phone the sidebar is too narrow for vertical columns.
    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({
      type: TATEGAKI_VIEW_TYPE,
      active: true,
      state: target ? { file: target.path } : {},
    });
    await workspace.revealLeaf(leaf);
  };

  plugin.addCommand({
    id: "tategaki-open-reader",
    name: "Read in Tategaki (縦書きで読む)",
    callback: () => void openReader(),
  });

  plugin.addCommand({
    id: "tategaki-toggle-page-mode",
    name: "Tategaki: toggle paged / scrolling",
    callback: () => {
      settings.pageMode = settings.pageMode === "page" ? "scroll" : "page";
      save(settings);
      for (const view of views()) view.applySettingsToDom();
      new Notice(settings.pageMode === "page" ? "頁 Paged" : "巻 Scrolling");
    },
  });

  plugin.addCommand({
    id: "tategaki-toggle-furigana",
    name: "Tategaki: toggle furigana",
    callback: () => {
      settings.showFurigana = !settings.showFurigana;
      save(settings);
      refreshViews();
      new Notice(settings.showFurigana ? "ふりがな on" : "ふりがな off");
    },
  });

  plugin.addCommand({
    id: "tategaki-toggle-editor-vertical",
    name: "Tategaki: toggle vertical markdown editor (experimental)",
    callback: () => {
      const active = editorMode.toggle();
      settings.editorVerticalMode = active;
      save(settings);
      new Notice(active ? "縦書きエディタ on" : "縦書きエディタ off");
    },
  });

  plugin.addCommand({
    id: "tategaki-wrap-selection",
    name: "Tategaki: wrap selection in a vertical block",
    editorCallback: (editor: Editor) => {
      const selection = editor.getSelection() || editor.getLine(editor.getCursor().line);
      editor.replaceSelection(`\`\`\`tategaki\n${selection}\n\`\`\`\n`);
    },
  });

  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      menu.addItem(item =>
        item
          .setTitle("縦書きで読む Read in Tategaki")
          .setIcon("book-open")
          .onClick(() => void openReader(file))
      );
    })
  );

  if (options.ribbon !== false) {
    plugin.addRibbonIcon("book-open", "縦書き Tategaki reader", () => void openReader());
  }

  const settingsContext: SettingsUIContext = {
    settings,
    save,
    onChange: refreshViews,
    setEditorVerticalMode: enabled => editorMode.set(enabled),
  };

  return {
    settings,
    bridge,
    buildSettings: containerEl => buildTategakiSettings(containerEl, settingsContext),
    openReader,
    refreshViews,
    invalidateLexicon: () => {
      bridge.invalidate();
      refreshViews();
    },
    unload: () => {
      editorMode.dispose();
      removeTategakiStyles(doc);
      plugin.app.workspace.detachLeavesOfType(TATEGAKI_VIEW_TYPE);
    },
  };
}
