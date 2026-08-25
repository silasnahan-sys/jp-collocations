import { ItemView, Menu, Notice, Platform, TFile, MarkdownView } from "obsidian";
import type { WorkspaceLeaf, ViewStateResult } from "obsidian";

import type { TategakiSettings } from "./settings.ts";
import { FONT_SIZE_MIN, FONT_SIZE_MAX } from "./settings.ts";
import { parseBlocks, stripFrontmatter, countCharacters } from "./text.ts";
import type { Block } from "./text.ts";
import { TategakiRenderer } from "./TategakiRenderer.ts";
import { CollocationBridge, entryPhrase } from "./collocation-bridge.ts";
import type { LexEntry } from "./collocation-bridge.ts";
import { BottomSheet } from "./Sheet.ts";
import { renderEntryCard, renderEmptyState } from "./entry-card.ts";
import {
  ScrollController,
  attachPinchZoom,
  attachTapGestures,
  onScrollSettled,
  caretFromPoint,
  runAroundOffset,
  haptic,
} from "./gestures.ts";

export const TATEGAKI_VIEW_TYPE = "jp-tategaki-view";

export interface TategakiViewOptions {
  settings: TategakiSettings;
  /** Persist settings after a toolbar toggle or a pinch. */
  saveSettings: (settings: TategakiSettings) => void | Promise<void>;
  /** Lexicon access; stays usable when the lexicon is missing. */
  bridge: CollocationBridge;
  /** Optional hook into the plugin's own search modal. */
  openLexiconSearch?: (query: string) => void;
}

interface TategakiViewState {
  file?: string;
}

/**
 * The vertical reader.
 *
 * Designed phone-first: one scroll axis, 44px controls, pinch to resize, tap to
 * look a collocation up, and editing that happens in a horizontal sheet because
 * mobile IMEs misbehave inside a vertical text field.
 */
export class TategakiView extends ItemView {
  private options: TategakiViewOptions;
  private renderer = new TategakiRenderer();
  private scroller: ScrollController | null = null;
  private sheet: BottomSheet | null = null;

  private toolbarEl: HTMLElement | null = null;
  private canvasEl: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private hintEl: HTMLElement | null = null;
  private progressFillEl: HTMLElement | null = null;
  private progressLabelEl: HTMLElement | null = null;

  private file: TFile | null = null;
  private blocks: Block[] = [];
  private sourceSnapshot = "";
  private charCount = 0;

  private disposers: Array<() => void> = [];
  private resizeObserver: ResizeObserver | null = null;
  private hintTimer: number | null = null;
  private pinchBaseSize = 0;
  private restoreProgress: number | null = null;
  private activeHighlight: HTMLElement | null = null;
  private lastPositionWrite = 0;

  constructor(leaf: WorkspaceLeaf, options: TategakiViewOptions) {
    super(leaf);
    this.options = options;
  }

  getViewType(): string {
    return TATEGAKI_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file ? `縦書き — ${this.file.basename}` : "縦書き Tategaki";
  }

  getIcon(): string {
    return "book-open";
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async onOpen(): Promise<void> {
    this.buildUI();
    this.registerWorkspaceEvents();

    // `setState` can arrive before the DOM exists (workspace restore), in which
    // case the file is already set but nothing has been painted yet.
    if (this.file) {
      await this.setFile(this.file);
      return;
    }

    const active = this.app.workspace.getActiveFile();
    if (active) await this.setFile(active);
    else this.showEmptyState("Open a note, then run “Read in Tategaki”.");
  }

  async onClose(): Promise<void> {
    this.renderer.cancel();
    this.persistPosition(true);
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.sheet?.destroy();
    this.sheet = null;
    if (this.hintTimer !== null) window.clearTimeout(this.hintTimer);
  }

  getState(): Record<string, unknown> {
    return { file: this.file?.path };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const incoming = (state ?? {}) as TategakiViewState;
    if (incoming.file && incoming.file !== this.file?.path) {
      const file = this.app.vault.getAbstractFileByPath(incoming.file);
      if (file instanceof TFile) await this.setFile(file);
    }
    await super.setState(state, result);
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  private buildUI(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("jp-tategaki-view");

    this.toolbarEl = root.createDiv("jp-tg-toolbar");
    this.buildToolbar(this.toolbarEl);

    const stage = root.createDiv("jp-tg-stage");
    this.canvasEl = stage.createDiv("jp-tg-canvas");
    this.hintEl = stage.createDiv("jp-tg-hint");

    const progress = root.createDiv("jp-tg-progress");
    const track = progress.createDiv("jp-tg-progress-track");
    this.progressFillEl = track.createDiv("jp-tg-progress-fill");
    this.progressLabelEl = progress.createDiv("jp-tg-progress-label");
    this.progressLabelEl.setText("0%");

    this.sheet = new BottomSheet(stage);
    this.scroller = new ScrollController(this.canvasEl);

    this.attachCanvasInteractions(this.canvasEl);
    this.applySettingsToDom();
  }

  private buildToolbar(toolbar: HTMLElement): void {
    const button = (label: string, aria: string, onClick: () => void): HTMLElement => {
      const el = toolbar.createEl("button", { text: label, cls: "jp-tg-btn" });
      el.setAttribute("aria-label", aria);
      el.addEventListener("click", onClick);
      return el;
    };

    button("A−", "Smaller text", () => this.nudgeFontSize(-1));
    button("A＋", "Larger text", () => this.nudgeFontSize(1));

    const rubyBtn = button("ふ", "Toggle furigana", () => {
      this.updateSettings({ showFurigana: !this.options.settings.showFurigana });
      rubyBtn.toggleClass("is-active", this.options.settings.showFurigana);
      this.renderCurrent();
    });
    rubyBtn.toggleClass("is-active", this.options.settings.showFurigana);

    const pageBtn = button(this.pageModeLabel(), "Toggle paging mode", () => {
      const next = this.options.settings.pageMode === "page" ? "scroll" : "page";
      this.updateSettings({ pageMode: next });
      pageBtn.setText(this.pageModeLabel());
      pageBtn.toggleClass("is-active", next === "page");
      this.applySettingsToDom();
      this.showHint(next === "page" ? "ページ送り: tap the edges" : "スクロール");
    });
    pageBtn.toggleClass("is-active", this.options.settings.pageMode === "page");

    const lexBtn = button("辞", "Toggle collocation highlighting", () => {
      this.updateSettings({ highlightCollocations: !this.options.settings.highlightCollocations });
      lexBtn.toggleClass("is-active", this.options.settings.highlightCollocations);
      this.renderCurrent();
    });
    lexBtn.toggleClass("is-active", this.options.settings.highlightCollocations);

    const verticalBtn = button("縦", "Toggle vertical writing", () => {
      this.updateSettings({ enabled: !this.options.settings.enabled });
      verticalBtn.setText(this.options.settings.enabled ? "縦" : "横");
      this.applySettingsToDom();
      this.renderCurrent();
    });
    verticalBtn.setText(this.options.settings.enabled ? "縦" : "横");

    button("✎", "Edit this note", () => this.openEditSheet());
    button("⟳", "Reload from disk", () => void this.reload());

    this.titleEl = toolbar.createDiv("jp-tg-title");
    this.titleEl.setText("—");
  }

  private pageModeLabel(): string {
    return this.options.settings.pageMode === "page" ? "頁" : "巻";
  }

  // ── Interaction ───────────────────────────────────────────────────────────

  private attachCanvasInteractions(canvas: HTMLElement): void {
    if (this.options.settings.pinchZoom) {
      this.disposers.push(
        attachPinchZoom(canvas, {
          onScale: factor => this.applyPinch(factor),
          onEnd: () => {
            this.pinchBaseSize = 0;
            void this.options.saveSettings(this.options.settings);
          },
        })
      );
    }

    this.disposers.push(
      attachTapGestures(canvas, {
        onTap: (x, y, target) => this.handleTap(x, y, target),
        onLongPress: (x, y, target) => this.handleLongPress(x, y, target),
      })
    );

    this.disposers.push(
      onScrollSettled(canvas, 140, () => {
        this.updateProgress();
        this.persistPosition();
        if (this.options.settings.pageMode === "page") this.scroller?.snapToPage();
      })
    );

    const onScroll = (): void => this.updateProgress();
    canvas.addEventListener("scroll", onScroll, { passive: true });
    this.disposers.push(() => canvas.removeEventListener("scroll", onScroll));

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        const progress = this.scroller?.getProgress() ?? 0;
        this.scroller?.invalidate();
        // Re-anchor after the layout settles, or a rotation loses the reader's place.
        window.setTimeout(() => this.scroller?.setProgress(progress), 60);
      });
      this.resizeObserver.observe(canvas);
    }
  }

  private handleTap(x: number, y: number, target: EventTarget | null): void {
    const el = target instanceof HTMLElement ? target : null;

    const link = el?.closest<HTMLElement>(".jp-tg-link");
    if (link) {
      this.openLink(link);
      return;
    }

    if (this.options.settings.pageMode === "page" && this.options.settings.tapZones && this.canvasEl) {
      const rect = this.canvasEl.getBoundingClientRect();
      const zone = (x - rect.left) / rect.width;
      // Vertical text reads right to left, so the right edge goes back.
      if (zone > 0.72) { this.turnPage(-1); return; }
      if (zone < 0.28) { this.turnPage(1); return; }
    }

    if (!this.options.settings.tapToLookup) return;

    const highlight = el?.closest<HTMLElement>(".jp-tg-colloc");
    if (highlight) {
      const ids = (highlight.dataset.jpTgIds ?? "").split(",").filter(Boolean);
      const phrase = highlight.dataset.jpTgPhrase ?? highlight.textContent ?? "";
      this.setActiveHighlight(highlight);
      this.showLookup(phrase, this.options.bridge.entriesByIds(ids));
      return;
    }

    this.lookupAtPoint(x, y);
  }

  private handleLongPress(x: number, y: number, target: EventTarget | null): void {
    const el = target instanceof HTMLElement ? target : null;
    const highlight = el?.closest<HTMLElement>(".jp-tg-colloc");
    const term = highlight?.dataset.jpTgPhrase ?? this.termAtPoint(x, y) ?? "";

    const menu = new Menu();

    if (term) {
      menu.addItem(item =>
        item.setTitle(`「${term}」を調べる`).setIcon("search").onClick(() => {
          this.showLookup(term, this.options.bridge.lookup(term));
        })
      );
      menu.addItem(item =>
        item.setTitle("コピー Copy").setIcon("copy").onClick(() => {
          void navigator.clipboard?.writeText(term);
          new Notice(`Copied 「${term}」`);
        })
      );
      if (this.options.openLexiconSearch) {
        menu.addItem(item =>
          item.setTitle("Search the lexicon").setIcon("list").onClick(() => {
            this.options.openLexiconSearch?.(term);
          })
        );
      }
    }

    menu.addItem(item =>
      item.setTitle("編集 Edit note").setIcon("pencil").onClick(() => this.openEditSheet())
    );
    menu.addItem(item =>
      item.setTitle("先頭へ Back to start").setIcon("arrow-up").onClick(() => {
        this.scroller?.scrollToStart();
        this.updateProgress();
      })
    );

    haptic(12);
    menu.showAtPosition({ x, y });
  }

  /** Text under a point, expanded to a lookup-sized run. */
  private termAtPoint(x: number, y: number): string | null {
    const hit = caretFromPoint(this.containerEl.ownerDocument, x, y);
    if (!hit?.node.textContent) return null;
    const { run } = runAroundOffset(hit.node.textContent, hit.offset);
    return run || null;
  }

  /**
   * Dictionary-style lookup: take the longest lexicon phrase starting at the
   * tapped character, then fall back to progressively shorter prefixes.
   */
  private lookupAtPoint(x: number, y: number): void {
    const hit = caretFromPoint(this.containerEl.ownerDocument, x, y);
    if (!hit?.node.textContent) return;

    const { run, offsetInRun } = runAroundOffset(hit.node.textContent, hit.offset);
    if (!run) return;

    const forward = run.slice(offsetInRun);
    const bridge = this.options.bridge;

    const phraseHit = bridge.longestPhraseAt(forward, {
      maxEntries: this.options.settings.maxHighlightEntries,
    });
    if (phraseHit) {
      const entries = bridge.entriesByIds(phraseHit.entryIds);
      this.flashRange(hit.node, hit.offset, phraseHit.end - phraseHit.start);
      this.showLookup(phraseHit.phrase, entries.length ? entries : bridge.lookup(phraseHit.phrase));
      return;
    }

    for (let length = Math.min(forward.length, 10); length >= 1; length--) {
      const candidate = forward.slice(0, length);
      const entries = bridge.lookup(candidate, 12);
      if (entries.length) {
        this.flashRange(hit.node, hit.offset, length);
        this.showLookup(candidate, entries);
        return;
      }
    }

    // Nothing matched — still open the sheet so the tap has a visible result.
    this.showLookup(run, []);
  }

  /** Briefly tint the looked-up characters so the tap has feedback. */
  private flashRange(node: Text, offset: number, length: number): void {
    try {
      const range = node.ownerDocument.createRange();
      range.setStart(node, Math.min(offset, node.length));
      range.setEnd(node, Math.min(offset + length, node.length));
      const mark = node.ownerDocument.createElement("span");
      mark.className = "jp-tg-tap-flash";
      range.surroundContents(mark);
      window.setTimeout(() => {
        const parent = mark.parentNode;
        if (!parent) return;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
        parent.normalize();
      }, 900);
    } catch {
      // surroundContents throws across element boundaries — the lookup still works.
    }
  }

  private setActiveHighlight(el: HTMLElement | null): void {
    this.activeHighlight?.removeClass("is-active");
    this.activeHighlight = el;
    el?.addClass("is-active");
  }

  private openLink(link: HTMLElement): void {
    const href = link.dataset.jpTgHref;
    if (!href) return;
    if (link.dataset.jpTgInternal) {
      void this.app.workspace.openLinkText(href, this.file?.path ?? "", false);
    } else {
      window.open(href, "_blank");
    }
  }

  private turnPage(direction: 1 | -1): void {
    const moved = this.scroller?.turnPage(direction) ?? false;
    if (moved && this.options.settings.hapticFeedback) haptic(6);
    if (!moved) this.showHint(direction > 0 ? "終わり" : "先頭");
    this.updateProgress();
  }

  // ── Lookup sheet ──────────────────────────────────────────────────────────

  private showLookup(term: string, entries: LexEntry[]): void {
    if (!this.sheet) return;
    if (this.options.settings.hapticFeedback) haptic(6);

    const { body } = this.sheet.show(term, () => this.setActiveHighlight(null));

    if (entries.length === 0) {
      const known = this.options.bridge.isAvailable();
      renderEmptyState(
        body,
        known
          ? `「${term}」 is not in the lexicon yet. Long-press to copy it, or add it from the lexicon view.`
          : "The collocation lexicon is not loaded in this session."
      );
      if (this.options.openLexiconSearch) {
        const search = body.createEl("button", { text: "Search the lexicon", cls: "jp-tg-btn" });
        search.addEventListener("click", () => this.options.openLexiconSearch?.(term));
      }
      return;
    }

    for (const entry of entries) {
      renderEntryCard(body, entry, [
        {
          label: "コピー",
          ariaLabel: "Copy phrase",
          onClick: item => {
            void navigator.clipboard?.writeText(entryPhrase(item));
            new Notice(`Copied 「${entryPhrase(item)}」`);
          },
        },
        {
          label: "挿入",
          ariaLabel: "Insert into the open editor",
          onClick: item => this.insertIntoEditor(entryPhrase(item)),
        },
      ]);
    }
  }

  /** Drop a phrase at the cursor of whichever markdown editor is open. */
  private insertIntoEditor(text: string): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView) {
        view.editor.replaceSelection(text);
        new Notice(`Inserted 「${text}」`);
        return;
      }
    }
    void navigator.clipboard?.writeText(text);
    new Notice("No open editor — copied to the clipboard instead.");
  }

  // ── Edit sheet ────────────────────────────────────────────────────────────

  /**
   * Editing happens in a horizontal textarea on purpose: mobile IMEs place
   * their candidate window relative to a horizontal caret, and vertical
   * contenteditable regions put it in the wrong place on both iOS and Android.
   */
  private openEditSheet(): void {
    if (!this.sheet) return;
    if (!this.file) {
      new Notice("No note is open in the reader.");
      return;
    }

    const file = this.file;
    const snapshot = this.sourceSnapshot;
    const { body } = this.sheet.show(`編集 — ${file.basename}`);

    const textarea = body.createEl("textarea", { cls: "jp-tg-edit-area" });
    textarea.value = snapshot;
    textarea.spellcheck = false;

    const actions = body.createDiv("jp-tg-card-actions");
    const save = actions.createEl("button", { text: "保存 Save", cls: "jp-tg-btn is-active" });
    const cancel = actions.createEl("button", { text: "取消 Cancel", cls: "jp-tg-btn" });

    cancel.addEventListener("click", () => this.sheet?.close());
    save.addEventListener("click", () => {
      void (async () => {
        try {
          const current = await this.app.vault.read(file);
          if (current !== snapshot) {
            new Notice("This note changed elsewhere — reload (⟳) before saving.");
            return;
          }
          await this.app.vault.modify(file, textarea.value);
          this.sheet?.close();
          new Notice("保存しました");
        } catch (error) {
          new Notice(`Could not save: ${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    });
  }

  // ── Content ───────────────────────────────────────────────────────────────

  /** Point the reader at a file and render it. */
  async setFile(file: TFile | null): Promise<void> {
    this.persistPosition(true);
    this.file = file;
    this.setActiveHighlight(null);
    this.titleEl?.setText(file ? file.basename : "—");

    if (!file) {
      this.showEmptyState("Open a note, then run “Read in Tategaki”.");
      return;
    }

    try {
      this.sourceSnapshot = await this.app.vault.cachedRead(file);
    } catch {
      this.showEmptyState("Could not read this note.");
      return;
    }

    this.restoreProgress = this.options.settings.rememberPosition
      ? this.options.settings.positions[file.path] ?? 0
      : 0;

    this.parseAndRender();
    // Keep the tab title in step with the file (not in the public typings).
    (this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
  }

  /** Re-read from disk and re-render, keeping the reading position. */
  async reload(): Promise<void> {
    if (!this.file) return;
    const progress = this.scroller?.getProgress() ?? 0;
    this.sourceSnapshot = await this.app.vault.read(this.file);
    this.restoreProgress = progress;
    this.parseAndRender();
  }

  /** Re-render from the text already in memory (after a settings change). */
  renderCurrent(): void {
    if (!this.file) return;
    this.restoreProgress = this.scroller?.getProgress() ?? this.restoreProgress ?? 0;
    this.parseAndRender();
  }

  private parseAndRender(): void {
    if (!this.canvasEl) return;
    const settings = this.options.settings;
    const { body } = stripFrontmatter(this.sourceSnapshot);

    this.blocks = parseBlocks(body, {
      furigana: settings.showFurigana,
      tateChuYoko: settings.tateChuYoko,
    });
    this.charCount = countCharacters(this.blocks);

    const matcher = settings.highlightCollocations && this.options.bridge.isAvailable()
      ? this.options.bridge.getMatcher({ maxEntries: settings.maxHighlightEntries })
      : null;

    this.renderer.render(this.canvasEl, this.blocks, {
      highlight: Boolean(matcher),
      matcher,
      chunkSize: settings.chunkSize,
      resolveImage: src => this.resolveImage(src),
      onComplete: () => this.afterRender(),
    });
  }

  private afterRender(): void {
    this.scroller?.invalidate();
    // One frame for layout to settle before measuring the scroll range.
    window.requestAnimationFrame(() => {
      if (!this.scroller) return;
      this.scroller.calibrate();
      const progress = this.restoreProgress ?? 0;
      if (progress > 0.001) this.scroller.setProgress(progress);
      else this.scroller.scrollToStart();
      this.restoreProgress = null;
      this.updateProgress();
    });
  }

  private resolveImage(src: string): string | null {
    try {
      if (/^https?:\/\//.test(src)) return src;
      const target = this.app.metadataCache.getFirstLinkpathDest(src, this.file?.path ?? "");
      if (target instanceof TFile) return this.app.vault.getResourcePath(target);
    } catch {
      // Unresolvable embed — the renderer falls back to an alt-text chip.
    }
    return null;
  }

  private showEmptyState(message: string): void {
    this.renderer.cancel();
    if (!this.canvasEl) return;
    this.canvasEl.empty();
    this.canvasEl.createDiv({ cls: "jp-tg-empty", text: message });
    this.updateProgress();
  }

  // ── Settings plumbing ─────────────────────────────────────────────────────

  /** Merge a settings patch, persist it, and reflect it in the DOM. */
  private updateSettings(patch: Partial<TategakiSettings>): void {
    Object.assign(this.options.settings, patch);
    void this.options.saveSettings(this.options.settings);
  }

  /** Apply the current settings to an already-built view (no re-render). */
  applySettingsToDom(): void {
    const root = this.containerEl.children[1] as HTMLElement | undefined;
    if (!root || !this.canvasEl) return;
    const settings = this.options.settings;

    root.style.setProperty("--jp-tg-fs", `${settings.fontSize}px`);
    root.style.setProperty("--jp-tg-lh", `${settings.lineHeight}`);
    root.style.setProperty("--jp-tg-pad", `${settings.padding}px`);
    if (settings.fontFamily === "custom" && settings.customFontFamily) {
      root.style.setProperty("--jp-tg-ff", settings.customFontFamily);
    } else {
      root.style.removeProperty("--jp-tg-ff");
    }

    root.toggleClass("jp-tg--gothic", settings.fontFamily === "gothic");
    root.toggleClass("jp-tg--paper", settings.paperTexture);
    root.toggleClass("jp-tg--bouten", settings.boutenForBold);
    root.toggleClass("jp-tg--upright", settings.uprightLatin);
    root.toggleClass("jp-tg--no-ruby", !settings.showFurigana);

    this.canvasEl.toggleClass("jp-tg--horizontal", !settings.enabled);
    this.canvasEl.toggleClass("jp-tg--paged", settings.enabled && settings.pageMode === "page");
    this.toolbarEl?.toggleClass("is-hidden", !settings.showToolbar);

    this.scroller?.invalidate();
  }

  /** Called by the plugin when settings change outside the view. */
  refreshFromSettings(): void {
    this.applySettingsToDom();
    this.renderCurrent();
  }

  private nudgeFontSize(direction: 1 | -1): void {
    const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, this.options.settings.fontSize + direction));
    if (next === this.options.settings.fontSize) return;
    const progress = this.scroller?.getProgress() ?? 0;
    this.updateSettings({ fontSize: next });
    this.applySettingsToDom();
    this.showHint(`${next}px`);
    this.reanchor(progress);
  }

  private applyPinch(factor: number): void {
    if (!this.pinchBaseSize) this.pinchBaseSize = this.options.settings.fontSize;
    const next = Math.round(
      Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, this.pinchBaseSize * factor))
    );
    if (next === this.options.settings.fontSize) return;
    const progress = this.scroller?.getProgress() ?? 0;
    this.options.settings.fontSize = next;
    this.applySettingsToDom();
    this.showHint(`${next}px`);
    this.reanchor(progress);
  }

  /** Resizing the type reflows every column — put the reader back where they were. */
  private reanchor(progress: number): void {
    window.requestAnimationFrame(() => {
      this.scroller?.calibrate();
      this.scroller?.setProgress(progress);
      this.updateProgress();
    });
  }

  // ── Progress + hints ──────────────────────────────────────────────────────

  private updateProgress(): void {
    if (!this.progressFillEl || !this.progressLabelEl) return;
    const progress = this.scroller?.getProgress() ?? 0;
    this.progressFillEl.style.width = `${Math.round(progress * 100)}%`;
    const characters = this.charCount ? `${this.charCount.toLocaleString()}字` : "";
    this.progressLabelEl.setText(`${Math.round(progress * 100)}% ${characters}`.trim());
  }

  private persistPosition(force = false): void {
    if (!this.options.settings.rememberPosition || !this.file || !this.scroller) return;
    const progress = this.scroller.getProgress();
    const positions = this.options.settings.positions;
    const stored = positions[this.file.path];
    if (stored !== undefined && Math.abs(stored - progress) < 0.005) return;

    positions[this.file.path] = Number(progress.toFixed(4));

    // Scrolling settles often; writing to disk every time would be wasteful.
    const now = Date.now();
    if (!force && now - this.lastPositionWrite < 2000) return;
    this.lastPositionWrite = now;

    // Keep the map from growing without bound in a large vault.
    const paths = Object.keys(positions);
    if (paths.length > 200) {
      for (const path of paths.slice(0, paths.length - 200)) delete positions[path];
    }

    void this.options.saveSettings(this.options.settings);
  }

  private showHint(text: string): void {
    if (!this.hintEl) return;
    this.hintEl.setText(text);
    this.hintEl.addClass("is-visible");
    if (this.hintTimer !== null) window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hintEl?.removeClass("is-visible"), 900);
  }

  // ── Workspace wiring ──────────────────────────────────────────────────────

  private registerWorkspaceEvents(): void {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (!this.options.settings.followActiveFile) return;
        const active = this.app.workspace.getActiveFile();
        if (active && active.path !== this.file?.path) void this.setFile(active);
      })
    );

    this.registerEvent(
      this.app.vault.on("modify", file => {
        if (file instanceof TFile && file.path === this.file?.path) void this.reload();
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && oldPath === this.file?.path) {
          this.file = file;
          this.titleEl?.setText(file.basename);
        }
      })
    );

    if (Platform.isMobile) {
      // Phones start with the toolbar visible; the hint explains the gestures once.
      const introTimer = window.setTimeout(
        () => this.showHint("タップで辞書 ・ ピンチで文字サイズ"),
        600
      );
      this.disposers.push(() => window.clearTimeout(introTimer));
    }
  }
}
