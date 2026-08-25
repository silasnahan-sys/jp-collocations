/**
 * Settings section for the tategaki module.
 *
 * Exposed as a plain builder so the host's `SettingsTab` only needs one line:
 *
 *   buildTategakiSettings(containerEl, { settings, save, onChange });
 *
 * Nothing here touches `SettingsTab.ts` itself, which several agents are
 * editing right now.
 */

import { Setting, Notice, Platform } from "obsidian";

import type { TategakiSettings } from "./settings.ts";
import { FONT_SIZE_MIN, FONT_SIZE_MAX, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX } from "./settings.ts";

export interface SettingsUIContext {
  settings: TategakiSettings;
  /** Persist the settings object. */
  save: (settings: TategakiSettings) => void | Promise<void>;
  /** Called after a change so open readers can re-render. */
  onChange?: () => void;
  /** Toggle the editor-wide vertical mode. */
  setEditorVerticalMode?: (enabled: boolean) => void;
}

export function buildTategakiSettings(containerEl: HTMLElement, ctx: SettingsUIContext): void {
  const { settings } = ctx;

  const commit = (): void => {
    void ctx.save(settings);
    ctx.onChange?.();
  };

  new Setting(containerEl).setName("縦書き Tategaki").setHeading();

  new Setting(containerEl)
    .setName("Vertical writing")
    .setDesc("Render the reader right-to-left in vertical columns. Off falls back to horizontal.")
    .addToggle(toggle =>
      toggle.setValue(settings.enabled).onChange(value => {
        settings.enabled = value;
        commit();
      })
    );

  // ── Typography ──────────────────────────────────────────────────────────
  new Setting(containerEl).setName("Typography").setHeading();

  new Setting(containerEl)
    .setName("Typeface")
    .setDesc("Mincho (明朝) is the conventional face for vertical Japanese prose.")
    .addDropdown(dropdown =>
      dropdown
        .addOption("mincho", "明朝 Mincho")
        .addOption("gothic", "ゴシック Gothic")
        .addOption("custom", "Custom")
        .setValue(settings.fontFamily)
        .onChange(value => {
          settings.fontFamily = value as TategakiSettings["fontFamily"];
          commit();
        })
    );

  new Setting(containerEl)
    .setName("Custom font stack")
    .setDesc('CSS font-family list, used when Typeface is set to Custom.')
    .addText(text =>
      text
        .setPlaceholder('"Yu Mincho", serif')
        .setValue(settings.customFontFamily)
        .onChange(value => {
          settings.customFontFamily = value;
          commit();
        })
    );

  new Setting(containerEl)
    .setName("Text size")
    .setDesc("Pinch inside the reader to change this on a phone.")
    .addSlider(slider =>
      slider
        .setLimits(FONT_SIZE_MIN, FONT_SIZE_MAX, 1)
        .setValue(settings.fontSize)
        .setDynamicTooltip()
        .onChange(value => {
          settings.fontSize = value;
          commit();
        })
    );

  new Setting(containerEl)
    .setName("Column spacing")
    .setDesc("Line height — the gap between columns in vertical mode.")
    .addSlider(slider =>
      slider
        .setLimits(LINE_HEIGHT_MIN, LINE_HEIGHT_MAX, 0.05)
        .setValue(settings.lineHeight)
        .setDynamicTooltip()
        .onChange(value => {
          settings.lineHeight = value;
          commit();
        })
    );

  new Setting(containerEl)
    .setName("Margin")
    .addSlider(slider =>
      slider
        .setLimits(0, 60, 2)
        .setValue(settings.padding)
        .setDynamicTooltip()
        .onChange(value => {
          settings.padding = value;
          commit();
        })
    );

  new Setting(containerEl)
    .setName("Paper tint")
    .setDesc("Warmer background behind the text.")
    .addToggle(toggle =>
      toggle.setValue(settings.paperTexture).onChange(value => {
        settings.paperTexture = value;
        commit();
      })
    );

  // ── Japanese typesetting ────────────────────────────────────────────────
  new Setting(containerEl).setName("Japanese typesetting").setHeading();

  new Setting(containerEl)
    .setName("Furigana")
    .setDesc("Render ruby from {漢字|かんじ}, [漢字]{かんじ}, ｜漢字《かんじ》 and 漢字《かんじ》.")
    .addToggle(toggle =>
      toggle.setValue(settings.showFurigana).onChange(value => {
        settings.showFurigana = value;
        commit();
      })
    );

  new Setting(containerEl)
    .setName("縦中横 (tate-chu-yoko)")
    .setDesc("Set two-digit numbers and !? upright inside the vertical line.")
    .addToggle(toggle =>
      toggle.setValue(settings.tateChuYoko).onChange(value => {
        settings.tateChuYoko = value;
        commit();
      })
    );

  new Setting(containerEl)
    .setName("Upright Latin")
    .setDesc("Stand Latin letters upright instead of rotating them 90°.")
    .addToggle(toggle =>
      toggle.setValue(settings.uprightLatin).onChange(value => {
        settings.uprightLatin = value;
        commit();
      })
    );

  new Setting(containerEl)
    .setName("圏点 for bold")
    .setDesc("Show **bold** as sesame dots beside the column, the vertical convention.")
    .addToggle(toggle =>
      toggle.setValue(settings.boutenForBold).onChange(value => {
        settings.boutenForBold = value;
        commit();
      })
    );

  // ── Reading on mobile ───────────────────────────────────────────────────
  new Setting(containerEl).setName("Reading").setHeading();

  new Setting(containerEl)
    .setName("Page turning")
    .setDesc("Paged snaps one screen at a time; scrolling flicks freely.")
    .addDropdown(dropdown =>
      dropdown
        .addOption("scroll", "巻 Scroll")
        .addOption("page", "頁 Paged")
        .setValue(settings.pageMode)
        .onChange(value => {
          settings.pageMode = value as TategakiSettings["pageMode"];
          commit();
        })
    );

  new Setting(containerEl)
    .setName("Edge tap zones")
    .setDesc("In paged mode, tap the right edge to go back and the left edge to go on.")
    .addToggle(toggle =>
      toggle.setValue(settings.tapZones).onChange(value => {
        settings.tapZones = value;
        commit();
      })
    );

  new Setting(containerEl)
    .setName("Pinch to resize")
    .addToggle(toggle =>
      toggle.setValue(settings.pinchZoom).onChange(value => {
        settings.pinchZoom = value;
        new Notice("Reopen the reader for this to take effect.");
        commit();
      })
    );

  new Setting(containerEl)
    .setName("Show toolbar")
    .addToggle(toggle =>
      toggle.setValue(settings.showToolbar).onChange(value => {
        settings.showToolbar = value;
        commit();
      })
    );

  new Setting(containerEl)
    .setName("Follow the active note")
    .addToggle(toggle =>
      toggle.setValue(settings.followActiveFile).onChange(value => {
        settings.followActiveFile = value;
        commit();
      })
    );

  new Setting(containerEl)
    .setName("Remember reading position")
    .addToggle(toggle =>
      toggle.setValue(settings.rememberPosition).onChange(value => {
        settings.rememberPosition = value;
        commit();
      })
    )
    .addButton(button =>
      button
        .setButtonText("Clear")
        .setTooltip("Forget every stored position")
        .onClick(() => {
          settings.positions = {};
          commit();
          new Notice("Reading positions cleared.");
        })
    );

  if (Platform.isMobile) {
    new Setting(containerEl)
      .setName("Haptic feedback")
      .setDesc("A short buzz on page turns and lookups.")
      .addToggle(toggle =>
        toggle.setValue(settings.hapticFeedback).onChange(value => {
          settings.hapticFeedback = value;
          commit();
        })
      );
  }

  // ── Lexicon ─────────────────────────────────────────────────────────────
  new Setting(containerEl).setName("Collocation lexicon").setHeading();

  new Setting(containerEl)
    .setName("Tap to look up")
    .setDesc("Tap a word to see the collocations it belongs to.")
    .addToggle(toggle =>
      toggle.setValue(settings.tapToLookup).onChange(value => {
        settings.tapToLookup = value;
        commit();
      })
    );

  new Setting(containerEl)
    .setName("Underline known collocations")
    .setDesc("Mark phrases from the lexicon where they occur in the text.")
    .addToggle(toggle =>
      toggle.setValue(settings.highlightCollocations).onChange(value => {
        settings.highlightCollocations = value;
        commit();
      })
    );

  new Setting(containerEl)
    .setName("Highlight budget")
    .setDesc("Lexicon entries scanned per render. Lower this if a long note feels slow.")
    .addSlider(slider =>
      slider
        .setLimits(200, 10000, 200)
        .setValue(settings.maxHighlightEntries)
        .setDynamicTooltip()
        .onChange(value => {
          settings.maxHighlightEntries = value;
          commit();
        })
    );

  // ── Advanced ────────────────────────────────────────────────────────────
  new Setting(containerEl).setName("Advanced").setHeading();

  new Setting(containerEl)
    .setName("Vertical markdown editor")
    .setDesc(
      Platform.isMobile
        ? "Experimental. Turns Obsidian's own editor and reading view vertical. On a phone the caret and IME candidate window stay horizontal — use the reader's ✎ edit sheet instead."
        : "Experimental. Turns Obsidian's own editor and reading view vertical."
    )
    .addToggle(toggle =>
      toggle.setValue(settings.editorVerticalMode).onChange(value => {
        settings.editorVerticalMode = value;
        ctx.setEditorVerticalMode?.(value);
        commit();
      })
    );

  new Setting(containerEl)
    .setName("Render chunk size")
    .setDesc("Characters painted per frame. Lower is smoother on old phones.")
    .addSlider(slider =>
      slider
        .setLimits(500, 12000, 500)
        .setValue(settings.chunkSize)
        .setDynamicTooltip()
        .onChange(value => {
          settings.chunkSize = value;
          commit();
        })
    );
}
