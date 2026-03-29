// ─── Dictionary Search Bar ───────────────────────────────────────────────────
// iOS Monokakido-style search bar with language filter chips.

import type { SearchMode } from "../yomitan/types.ts";

export type SearchBarCallback = (query: string, mode: SearchMode) => void;

export class DictionarySearchBar {
  private container: HTMLElement;
  private input: HTMLInputElement;
  private mode: SearchMode = "all";
  private onSearch: SearchBarCallback;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement, onSearch: SearchBarCallback) {
    this.onSearch = onSearch;
    this.container = parent.createDiv({ cls: "mkd-search-bar" });
    this.input = this.buildInput();
    this.buildFilterChips();
  }

  private buildInput(): HTMLInputElement {
    const wrap = this.container.createDiv({ cls: "mkd-search-input-wrap" });
    // magnifier icon
    const icon = wrap.createSpan({ cls: "mkd-search-icon" });
    icon.textContent = "🔍";

    const input = wrap.createEl("input", {
      type: "text",
      cls: "mkd-search-input",
      attr: { placeholder: "辞書を検索 / Search dictionaries…" },
    });
    input.addEventListener("input", () => this.handleInput());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.fireSearch(input.value.trim());
      }
    });
    // Clear button
    const clear = wrap.createSpan({ cls: "mkd-search-clear", text: "✕" });
    clear.addEventListener("click", () => {
      input.value = "";
      this.fireSearch("");
      input.focus();
    });
    return input;
  }

  private buildFilterChips(): void {
    const row = this.container.createDiv({ cls: "mkd-filter-chips" });
    const chips: { label: string; value: SearchMode }[] = [
      { label: "全辞書", value: "all" },
      { label: "国語", value: "monolingual" },
      { label: "英和・和英", value: "bilingual" },
    ];
    for (const { label, value } of chips) {
      const chip = row.createSpan({
        cls: `mkd-chip${value === this.mode ? " mkd-chip--active" : ""}`,
        text: label,
      });
      chip.dataset.mode = value;
      chip.addEventListener("click", () => {
        this.mode = value;
        row.querySelectorAll(".mkd-chip").forEach(c => c.removeClass("mkd-chip--active"));
        chip.addClass("mkd-chip--active");
        this.fireSearch(this.input.value.trim());
      });
    }
  }

  private handleInput(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const q = this.input.value.trim();
      // Auto-detect English and switch to bilingual mode suggestion
      if (q.length > 0 && /^[a-zA-Z\s'-]+$/.test(q) && this.mode === "all") {
        // don't force mode change, but highlight bilingual chip
        this.container
          .querySelector<HTMLElement>('.mkd-chip[data-mode="bilingual"]')
          ?.addClass("mkd-chip--suggest");
      } else {
        this.container
          .querySelector<HTMLElement>('.mkd-chip[data-mode="bilingual"]')
          ?.removeClass("mkd-chip--suggest");
      }
      this.fireSearch(q);
    }, 250);
  }

  private fireSearch(q: string): void {
    this.onSearch(q, this.mode);
  }

  focus(): void {
    this.input.focus();
  }

  getValue(): string {
    return this.input.value;
  }

  setValue(v: string): void {
    this.input.value = v;
  }

  destroy(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
  }
}
