// ─── Dictionary Tab Bar ──────────────────────────────────────────────────────
// iOS Monokakido-style bottom tab bar.

export type TabId = "shelf" | "bookmarks" | "history" | "settings";

export type TabChangeCallback = (tab: TabId) => void;

interface TabDef {
  id: TabId;
  icon: string;
  label: string;
}

const TABS: TabDef[] = [
  { id: "shelf",     icon: "📚", label: "辞書棚" },
  { id: "bookmarks", icon: "🔖", label: "しおり" },
  { id: "history",   icon: "🕐", label: "履歴"  },
  { id: "settings",  icon: "⚙️", label: "その他" },
];

export class DictionaryTabBar {
  private container: HTMLElement;
  private current: TabId = "shelf";
  private buttons = new Map<TabId, HTMLElement>();

  constructor(parent: HTMLElement, private onChange: TabChangeCallback) {
    this.container = parent.createDiv({ cls: "mkd-tab-bar" });
    for (const tab of TABS) {
      const btn = this.container.createDiv({ cls: "mkd-tab-btn" });
      btn.createSpan({ cls: "mkd-tab-icon", text: tab.icon });
      btn.createSpan({ cls: "mkd-tab-label", text: tab.label });
      btn.dataset.tab = tab.id;
      btn.addEventListener("click", () => this.select(tab.id));
      this.buttons.set(tab.id, btn);
    }
    this.select("shelf");
  }

  select(id: TabId): void {
    this.current = id;
    this.buttons.forEach((btn, tabId) => {
      btn.toggleClass("mkd-tab-btn--active", tabId === id);
    });
    this.onChange(id);
  }

  get activeTab(): TabId {
    return this.current;
  }
}
