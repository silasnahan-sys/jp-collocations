import { PluginSettingTab, Setting, Notice } from "obsidian";
import type { App } from "obsidian";
import type { Plugin } from "obsidian";
import type { PluginSettings } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";
import type { HyogenScraper } from "../scraper/HyogenScraper.ts";

export class SettingsTab extends PluginSettingTab {
  private settings: PluginSettings;
  private store: CollocationStore;
  private getScraper: () => HyogenScraper | null;
  private onSettingsChange: () => Promise<void>;

  constructor(
    app: App,
    plugin: Plugin,
    settings: PluginSettings,
    store: CollocationStore,
    getScraper: () => HyogenScraper | null,
    onSettingsChange: () => Promise<void>
  ) {
    super(app, plugin);
    this.settings = settings;
    this.store = store;
    this.getScraper = getScraper;
    this.onSettingsChange = onSettingsChange;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "JP Collocations Settings" });

    // ── Hyogen Scraper ─────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Hyogen Scraper" });

    new Setting(containerEl)
      .setName("Enable Hyogen scraping")
      .setDesc("Allow fetching from collocation.hyogen.info")
      .addToggle(t => t.setValue(this.settings.hyogenEnabled).onChange(async v => {
        this.settings.hyogenEnabled = v;
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("Rate limit (ms)")
      .setDesc("Minimum milliseconds between requests (default: 2000)")
      .addSlider(s => s.setLimits(1000, 10000, 500).setValue(this.settings.hyogenRateLimit)
        .setDynamicTooltip().onChange(async v => {
          this.settings.hyogenRateLimit = v;
          await this.onSettingsChange();
        }));

    new Setting(containerEl)
      .setName("Word list to scrape")
      .setDesc("Comma-separated list of Japanese words to fetch from Hyogen")
      .addTextArea(t => {
        t.setValue(this.settings.hyogenWordList.join(", ")).onChange(async v => {
          this.settings.hyogenWordList = v.split(",").map(w => w.trim()).filter(Boolean);
          await this.onSettingsChange();
        });
        t.inputEl.rows = 3;
      });

    // ── Display ────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Display" });

    new Setting(containerEl)
      .setName("Default sort order")
      .addDropdown(d => {
        d.addOption("frequency", "Frequency");
        d.addOption("headword", "Headword (あいうえお)");
        d.addOption("createdAt", "Date added");
        d.addOption("updatedAt", "Last updated");
        d.setValue(this.settings.defaultSortOrder).onChange(async v => {
          this.settings.defaultSortOrder = v as PluginSettings["defaultSortOrder"];
          await this.onSettingsChange();
        });
      });

    new Setting(containerEl)
      .setName("Entries per page")
      .addSlider(s => s.setLimits(10, 200, 10).setValue(this.settings.entriesPerPage)
        .setDynamicTooltip().onChange(async v => {
          this.settings.entriesPerPage = v;
          await this.onSettingsChange();
        }));

    new Setting(containerEl)
      .setName("Show readings")
      .addToggle(t => t.setValue(this.settings.showReadings).onChange(async v => {
        this.settings.showReadings = v;
        await this.onSettingsChange();
      }));

    // ── Search ─────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Search" });

    new Setting(containerEl)
      .setName("Max results")
      .addSlider(s => s.setLimits(10, 500, 10).setValue(this.settings.maxResults)
        .setDynamicTooltip().onChange(async v => {
          this.settings.maxResults = v;
          await this.onSettingsChange();
        }));

    // ── Data Management ────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Data Management" });

    new Setting(containerEl)
      .setName("Export data")
      .setDesc("Export all collocations as a JSON file")
      .addButton(b => b.setButtonText("Export JSON").onClick(() => {
        const data = JSON.stringify(this.store.exportAll(), null, 2);
        const blob = new Blob([data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "jp-collocations-export.json";
        a.click();
        URL.revokeObjectURL(url);
        new Notice("Exported collocations.");
      }));

    new Setting(containerEl)
      .setName("Import data")
      .setDesc("Import collocations from a JSON file")
      .addButton(b => b.setButtonText("Import JSON").onClick(() => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          const text = await file.text();
          try {
            const parsed = JSON.parse(text);
            const count = this.store.bulkImport(parsed);
            new Notice(`Imported ${count} entries.`);
          } catch {
            new Notice("Failed to parse JSON file.");
          }
        };
        input.click();
      }));

    new Setting(containerEl)
      .setName("Reset to seed data")
      .setDesc("Clear all data and restore the built-in collocations")
      .addButton(b => b.setButtonText("Reset").setWarning().onClick(async () => {
        await this.store.resetToSeed();
        new Notice("Reset to seed data.");
      }));

    new Setting(containerEl)
      .setName("Clear all data")
      .setDesc("Delete all collocation entries permanently")
      .addButton(b => b.setButtonText("Clear All").setWarning().onClick(async () => {
        await this.store.clearAll();
        new Notice("All data cleared.");
      }));

    // ── Discourse Grammar ──────────────────────────────────────────
    containerEl.createEl("h3", { text: "Discourse Grammar (談話文法)" });

    new Setting(containerEl)
      .setName("Show discourse contexts")
      .setDesc("Display captured discourse chunks in entry detail view")
      .addToggle(t => t.setValue(this.settings.showDiscourseContexts).onChange(async v => {
        this.settings.showDiscourseContexts = v;
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("Discourse index file")
      .setDesc("File name for the discourse index (stored alongside collocation data)")
      .addText(t => t.setValue(this.settings.discourseIndexPath).onChange(async v => {
        this.settings.discourseIndexPath = v.trim() || "discourse-index.json";
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("Max contexts per collocation")
      .setDesc("Maximum number of discourse contexts stored per collocation entry (default: 50)")
      .addSlider(s => s.setLimits(5, 200, 5).setValue(this.settings.maxContextsPerCollocation)
        .setDynamicTooltip().onChange(async v => {
          this.settings.maxContextsPerCollocation = v;
          await this.onSettingsChange();
        }));

    new Setting(containerEl)
      .setName("Auto-clean old contexts")
      .setDesc("Automatically remove oldest contexts when the per-collocation limit is reached")
      .addToggle(t => t.setValue(this.settings.autoCleanOldContexts).onChange(async v => {
        this.settings.autoCleanOldContexts = v;
        await this.onSettingsChange();
      }));

    // ── Stats ──────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Statistics" });
    const stats = this.store.getStats();
    containerEl.createEl("p", { text: `Total entries: ${stats.total}` });

    const posList = containerEl.createEl("ul");
    for (const [pos, count] of Object.entries(stats.byPOS)) {
      posList.createEl("li", { text: `${pos}: ${count}` });
    }

    const srcList = containerEl.createEl("ul");
    for (const [src, count] of Object.entries(stats.bySource)) {
      srcList.createEl("li", { text: `${src}: ${count}` });
    }
  }
}
