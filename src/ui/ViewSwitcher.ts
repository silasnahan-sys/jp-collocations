import type { ViewMode } from "../types.ts";

export const VIEW_LABELS: Record<ViewMode, string> = {
  search: "Search",
  grammar: "Grammar",
  connections: "Connections",
  forms: "Forms",
  sources: "Sources",
  discourse: "談話文法",
  contexts: "Contexts",
};

export const VIEW_ORDER: ViewMode[] = ["search", "grammar", "connections", "forms", "sources", "discourse", "contexts"];

export class ViewSwitcher {
  private container: HTMLElement;
  private currentMode: ViewMode;
  private onSwitch: (mode: ViewMode) => void;
  private tabEls: Map<ViewMode, HTMLElement> = new Map();

  constructor(parent: HTMLElement, initial: ViewMode, onSwitch: (mode: ViewMode) => void) {
    this.currentMode = initial;
    this.onSwitch = onSwitch;
    this.container = parent.createDiv("jp-col-view-switcher");
    this.build();
  }

  private build(): void {
    for (const mode of VIEW_ORDER) {
      const tab = this.container.createEl("button", {
        text: VIEW_LABELS[mode],
        cls: "jp-col-view-tab",
      });
      if (mode === this.currentMode) tab.addClass("jp-col-view-tab--active");
      tab.addEventListener("click", () => this.select(mode));
      this.tabEls.set(mode, tab);
    }
  }

  select(mode: ViewMode): void {
    if (mode === this.currentMode) return;
    this.tabEls.get(this.currentMode)?.removeClass("jp-col-view-tab--active");
    this.currentMode = mode;
    this.tabEls.get(mode)?.addClass("jp-col-view-tab--active");
    this.onSwitch(mode);
  }

  getMode(): ViewMode {
    return this.currentMode;
  }
}
