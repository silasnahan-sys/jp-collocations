/**
 * HistoryRangeModal — pick the watch-date range (and cap) for a live history
 * fetch. Presets cover the common asks ("last 7/30 days", "this month"); the two
 * date fields allow an exact window. Returns epoch-ms [since, until].
 */
import { App, Modal, Setting } from 'obsidian';

export interface HistoryRange { since: number; until: number; maxVideos: number; }

const DAY = 86_400_000;
const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const endOfDay = (ms: number) => { const d = new Date(ms); d.setHours(23, 59, 59, 999); return d.getTime(); };
const iso = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export class HistoryRangeModal extends Modal {
  private onSubmit: (r: HistoryRange) => void;
  private since: number;
  private until: number;
  private maxVideos: number;
  private sinceText!: HTMLInputElement;
  private untilText!: HTMLInputElement;

  constructor(app: App, defaults: { maxVideos: number }, onSubmit: (r: HistoryRange) => void) {
    super(app);
    this.onSubmit = onSubmit;
    const now = Date.now();
    this.until = endOfDay(now);
    this.since = startOfDay(now - 6 * DAY);   // default: last 7 days
    this.maxVideos = defaults.maxVideos;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: '視聴履歴の取得（期間指定）' });
    contentEl.createEl('p', {
      text: '見た日付の範囲を選んで、その期間に視聴した動画を取得します。',
      cls: 'setting-item-description',
    });

    const now = Date.now();
    const presets: [string, number, number][] = [
      ['過去7日', startOfDay(now - 6 * DAY), endOfDay(now)],
      ['過去14日', startOfDay(now - 13 * DAY), endOfDay(now)],
      ['過去30日', startOfDay(now - 29 * DAY), endOfDay(now)],
      ['過去90日', startOfDay(now - 89 * DAY), endOfDay(now)],
      ['今月', startOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()), endOfDay(now)],
    ];
    const presetRow = new Setting(contentEl).setName('プリセット');
    for (const [label, s, u] of presets) {
      presetRow.addButton((b) => b.setButtonText(label).onClick(() => {
        this.since = s; this.until = u;
        this.sinceText.value = iso(s); this.untilText.value = iso(u);
      }));
    }

    new Setting(contentEl)
      .setName('開始日 (since)')
      .setDesc('YYYY-MM-DD')
      .addText((t) => { this.sinceText = t.inputEl; t.setValue(iso(this.since)); t.inputEl.type = 'date'; });

    new Setting(contentEl)
      .setName('終了日 (until)')
      .addText((t) => { this.untilText = t.inputEl; t.setValue(iso(this.until)); t.inputEl.type = 'date'; });

    new Setting(contentEl)
      .setName('上限（本）')
      .setDesc('取得する最大動画数（安全弁）。')
      .addSlider((s) => s.setLimits(5, 300, 5).setValue(this.maxVideos).setDynamicTooltip()
        .onChange((v) => { this.maxVideos = v; }));

    new Setting(contentEl).addButton((b) =>
      b.setButtonText('取得').setCta().onClick(() => {
        const s = Date.parse(this.sinceText.value);
        const u = Date.parse(this.untilText.value);
        if (Number.isNaN(s) || Number.isNaN(u)) { this.since = this.since; }  // keep defaults if unparseable
        else { this.since = startOfDay(s); this.until = endOfDay(u); }
        if (this.since > this.until) { const t = this.since; this.since = startOfDay(this.until); this.until = endOfDay(t); }
        this.close();
        this.onSubmit({ since: this.since, until: this.until, maxVideos: this.maxVideos });
      }),
    );
  }

  onClose(): void { this.contentEl.empty(); }
}
