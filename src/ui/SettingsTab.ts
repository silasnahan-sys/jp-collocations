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
      .addToggle((t: { setValue: (v: boolean) => typeof t; onChange: (fn: (v: boolean) => Promise<void>) => typeof t }) =>
        t.setValue(this.settings.hyogenEnabled).onChange(async (v: boolean) => {
          this.settings.hyogenEnabled = v;
          await this.onSettingsChange();
        }));

    new Setting(containerEl)
      .setName("Rate limit (ms)")
      .setDesc("Minimum milliseconds between requests (default: 2000)")
      .addSlider((s: { setLimits: (min: number, max: number, step: number) => typeof s; setValue: (v: number) => typeof s; setDynamicTooltip: () => typeof s; onChange: (fn: (v: number) => Promise<void>) => typeof s }) =>
        s.setLimits(1000, 10000, 500).setValue(this.settings.hyogenRateLimit)
          .setDynamicTooltip().onChange(async (v: number) => {
            this.settings.hyogenRateLimit = v;
            await this.onSettingsChange();
          }));

    new Setting(containerEl)
      .setName("Word list to scrape")
      .setDesc("Comma-separated list of Japanese words to fetch from Hyogen")
      .addTextArea((t: { setValue: (v: string) => typeof t; onChange: (fn: (v: string) => Promise<void>) => typeof t; inputEl: HTMLTextAreaElement }) => {
        t.setValue(this.settings.hyogenWordList.join(", ")).onChange(async (v: string) => {
          this.settings.hyogenWordList = v.split(",").map((w: string) => w.trim()).filter(Boolean);
          await this.onSettingsChange();
        });
        t.inputEl.rows = 3;
      });

    // ── Tsukuba Web Corpus Scraper ─────────────────────────────────
    containerEl.createEl("h3", { text: "Tsukuba Web Corpus Scraper" });

    new Setting(containerEl)
      .setName("Enable Tsukuba scraping")
      .setDesc("Allow fetching from tsukubawebcorpus.jp (real-world corpus data with MI scores)")
      .addToggle((t: { setValue: (v: boolean) => typeof t; onChange: (fn: (v: boolean) => Promise<void>) => typeof t }) =>
        t.setValue(this.settings.tsukubaEnabled).onChange(async (v: boolean) => {
          this.settings.tsukubaEnabled = v;
          await this.onSettingsChange();
        }));

    new Setting(containerEl)
      .setName("Tsukuba rate limit (ms)")
      .setDesc("Minimum milliseconds between requests (default: 2000)")
      .addSlider((s: { setLimits: (min: number, max: number, step: number) => typeof s; setValue: (v: number) => typeof s; setDynamicTooltip: () => typeof s; onChange: (fn: (v: number) => Promise<void>) => typeof s }) =>
        s.setLimits(1000, 10000, 500).setValue(this.settings.tsukubaRateLimit)
          .setDynamicTooltip().onChange(async (v: number) => {
            this.settings.tsukubaRateLimit = v;
            await this.onSettingsChange();
          }));

    new Setting(containerEl)
      .setName("Tsukuba word list")
      .setDesc("Comma-separated list of Japanese words to fetch from Tsukuba Web Corpus")
      .addTextArea((t: { setValue: (v: string) => typeof t; onChange: (fn: (v: string) => Promise<void>) => typeof t; inputEl: HTMLTextAreaElement }) => {
        t.setValue(this.settings.tsukubaWordList.join(", ")).onChange(async (v: string) => {
          this.settings.tsukubaWordList = v.split(",").map((w: string) => w.trim()).filter(Boolean);
          await this.onSettingsChange();
        });
        t.inputEl.rows = 3;
      });

    // ── Display ────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Display" });

    new Setting(containerEl)
      .setName("Default sort order")
      .addDropdown((d: { addOption: (v: string, label: string) => typeof d; setValue: (v: string) => typeof d; onChange: (fn: (v: string) => Promise<void>) => typeof d }) => {
        d.addOption("frequency", "Frequency");
        d.addOption("headword", "Headword (あいうえお)");
        d.addOption("createdAt", "Date added");
        d.addOption("updatedAt", "Last updated");
        d.setValue(this.settings.defaultSortOrder).onChange(async (v: string) => {
          this.settings.defaultSortOrder = v as PluginSettings["defaultSortOrder"];
          await this.onSettingsChange();
        });
      });

    new Setting(containerEl)
      .setName("Entries per page")
      .addSlider((s: { setLimits: (min: number, max: number, step: number) => typeof s; setValue: (v: number) => typeof s; setDynamicTooltip: () => typeof s; onChange: (fn: (v: number) => Promise<void>) => typeof s }) =>
        s.setLimits(10, 200, 10).setValue(this.settings.entriesPerPage)
          .setDynamicTooltip().onChange(async (v: number) => {
            this.settings.entriesPerPage = v;
            await this.onSettingsChange();
          }));

    new Setting(containerEl)
      .setName("Show readings")
      .addToggle((t: { setValue: (v: boolean) => typeof t; onChange: (fn: (v: boolean) => Promise<void>) => typeof t }) =>
        t.setValue(this.settings.showReadings).onChange(async (v: boolean) => {
          this.settings.showReadings = v;
          await this.onSettingsChange();
        }));

    new Setting(containerEl)
      .setName("Show register badges")
      .setDesc("Display spoken/written/formal/casual labels on entries")
      .addToggle((t: { setValue: (v: boolean) => typeof t; onChange: (fn: (v: boolean) => Promise<void>) => typeof t }) =>
        t.setValue(this.settings.showRegisterBadges).onChange(async (v: boolean) => {
          this.settings.showRegisterBadges = v;
          await this.onSettingsChange();
        }));

    new Setting(containerEl)
      .setName("Show JLPT badges")
      .setDesc("Display N5-N1 level badges on entries")
      .addToggle((t: { setValue: (v: boolean) => typeof t; onChange: (fn: (v: boolean) => Promise<void>) => typeof t }) =>
        t.setValue(this.settings.showJLPTBadges).onChange(async (v: boolean) => {
          this.settings.showJLPTBadges = v;
          await this.onSettingsChange();
        }));

    new Setting(containerEl)
      .setName("Show strength meter")
      .setDesc("Display weak/moderate/strong/fixed collocation strength bar")
      .addToggle((t: { setValue: (v: boolean) => typeof t; onChange: (fn: (v: boolean) => Promise<void>) => typeof t }) =>
        t.setValue(this.settings.showStrengthMeter).onChange(async (v: boolean) => {
          this.settings.showStrengthMeter = v;
          await this.onSettingsChange();
        }));

    new Setting(containerEl)
      .setName("Show negative examples")
      .setDesc("Show what NOT to say alongside correct collocations")
      .addToggle((t: { setValue: (v: boolean) => typeof t; onChange: (fn: (v: boolean) => Promise<void>) => typeof t }) =>
        t.setValue(this.settings.showNegativeExamples).onChange(async (v: boolean) => {
          this.settings.showNegativeExamples = v;
          await this.onSettingsChange();
        }));

    new Setting(containerEl)
      .setName("Show idiomaticity layer")
      .setDesc("Display free / preferred / collocation / semi-idiom / full-idiom layer badge")
      .addToggle((t: { setValue: (v: boolean) => typeof t; onChange: (fn: (v: boolean) => Promise<void>) => typeof t }) =>
        t.setValue(this.settings.showIdiomaticityLayer).onChange(async (v: boolean) => {
          this.settings.showIdiomaticityLayer = v;
          await this.onSettingsChange();
        }));

    new Setting(containerEl)
      .setName("Show collocation rationale")
      .setDesc("Show linguistic explanation of why this specific pairing is preferred over alternatives")
      .addToggle((t: { setValue: (v: boolean) => typeof t; onChange: (fn: (v: boolean) => Promise<void>) => typeof t }) =>
        t.setValue(this.settings.showCollocationRationale).onChange(async (v: boolean) => {
          this.settings.showCollocationRationale = v;
          await this.onSettingsChange();
        }));

    // ── Surfer Bridge ──────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Surfer Bridge (jp-sentence-surfer integration)" });

    new Setting(containerEl)
      .setName("Enable Surfer Bridge")
      .setDesc("Allow jp-sentence-surfer to call jp-collocations for collocation span detection")
      .addToggle((t: { setValue: (v: boolean) => typeof t; onChange: (fn: (v: boolean) => Promise<void>) => typeof t }) =>
        t.setValue(this.settings.enableSurferBridge).onChange(async (v: boolean) => {
          this.settings.enableSurferBridge = v;
          await this.onSettingsChange();
        }));

    new Setting(containerEl)
      .setName("Scan cache size")
      .setDesc("Max number of document scans to cache (higher = more memory, faster re-scanning)")
      .addSlider((s: { setLimits: (min: number, max: number, step: number) => typeof s; setValue: (v: number) => typeof s; setDynamicTooltip: () => typeof s; onChange: (fn: (v: number) => Promise<void>) => typeof s }) =>
        s.setLimits(5, 200, 5).setValue(this.settings.collocationScanCacheSize)
          .setDynamicTooltip().onChange(async (v: number) => {
            this.settings.collocationScanCacheSize = v;
            await this.onSettingsChange();
          }));

    // ── Search ─────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Search" });

    new Setting(containerEl)
      .setName("Max results")
      .addSlider((s: { setLimits: (min: number, max: number, step: number) => typeof s; setValue: (v: number) => typeof s; setDynamicTooltip: () => typeof s; onChange: (fn: (v: number) => Promise<void>) => typeof s }) =>
        s.setLimits(10, 500, 10).setValue(this.settings.maxResults)
          .setDynamicTooltip().onChange(async (v: number) => {
            this.settings.maxResults = v;
            await this.onSettingsChange();
          }));

    // ── Data Management ────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Data Management" });

    new Setting(containerEl)
      .setName("Export data")
      .setDesc("Export all collocations as a JSON file")
      .addButton((b: { setButtonText: (t: string) => typeof b; onClick: (fn: () => void) => typeof b }) =>
        b.setButtonText("Export JSON").onClick(() => {
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
      .addButton((b: { setButtonText: (t: string) => typeof b; onClick: (fn: () => void) => typeof b }) =>
        b.setButtonText("Import JSON").onClick(() => {
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
      .addButton((b: { setButtonText: (t: string) => typeof b; setWarning: () => typeof b; onClick: (fn: () => Promise<void>) => typeof b }) =>
        b.setButtonText("Reset").setWarning().onClick(async () => {
          await this.store.resetToSeed();
          new Notice("Reset to seed data.");
        }));

    new Setting(containerEl)
      .setName("Clear all data")
      .setDesc("Delete all collocation entries permanently")
      .addButton((b: { setButtonText: (t: string) => typeof b; setWarning: () => typeof b; onClick: (fn: () => Promise<void>) => typeof b }) =>
        b.setButtonText("Clear All").setWarning().onClick(async () => {
          await this.store.clearAll();
          new Notice("All data cleared.");
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
