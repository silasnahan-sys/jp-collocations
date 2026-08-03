/**
 * JimakuPickModal — choose the work, then the file (DESIGN §25.4b).
 *
 * The auto path handles the case where there is exactly one thing it could
 * be. This is the other case, and it is the common one: jimaku has 「相棒」
 * as one entry with 21 seasons of files in it, three uploaders' releases of
 * the same episode, and a signs-only track sitting next to the dialogue. A
 * machine pick there is a complete, plausible, WRONG transcript — the failure
 * mode the sweep-precision rule exists to prevent — so the ranking is shown
 * and the hand chooses.
 *
 * All jimaku knowledge stays in `notes/jimaku.ts`; all transport stays in
 * main.ts. The modal is handed two fetchers and an action.
 *
 * Visually it is the same drill-down as PlexBrowseModal and deliberately
 * reuses its classes: two doors onto "pick an episode" that looked different
 * would be two things to learn (§28 S5, one road).
 */

import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import {
  describeJimakuEntry, episodeNumberFrom, extOf, fmtBytes, isArchiveFile,
  jimakuFileRefusal, pickJimakuEntry, pickJimakuFile,
  type JimakuEntriesResult, type JimakuEntry, type JimakuFile, type JimakuFilesResult,
} from '../notes/jimaku.ts';

export interface JimakuPickDeps {
  /** search both anime and live-action, merged (transport in main.ts). */
  search: (query: string) => Promise<JimakuEntriesResult>;
  /** an entry's files; `episode` is jimaku's best-effort server filter. */
  files: (entryId: number, episode?: number) => Promise<JimakuFilesResult>;
  /** download + write the transcript note. Returns the user-facing message. */
  choose: (entry: JimakuEntry, file: JimakuFile) => Promise<string>;
  /** what to search for on open (the show), and which episode is wanted. */
  seed?: { query?: string; episode?: number; season?: number };
}

export class JimakuPickModal extends Modal {
  private listEl!: HTMLElement;
  private crumbEl!: HTMLElement;
  private searchEl!: HTMLInputElement;
  private epEl!: HTMLInputElement;
  private entry: JimakuEntry | null = null;
  private token = 0;

  constructor(app: App, private deps: JimakuPickDeps) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('jp-plexbrowse');
    contentEl.createEl('h3', { text: '📺 jimaku.cc から字幕を選ぶ' });

    const searchRow = contentEl.createDiv('jp-plexbrowse-search');
    this.searchEl = searchRow.createEl('input', {
      type: 'text',
      attr: { placeholder: '作品名（日本語・英語・ローマ字）', enterkeyhint: 'search' },
    });
    this.searchEl.value = this.deps.seed?.query ?? '';

    const epRow = contentEl.createDiv('jp-jimaku-eprow');
    epRow.createSpan({ text: '話数', cls: 'jp-jimaku-eplabel' });
    this.epEl = epRow.createEl('input', {
      type: 'number',
      attr: { placeholder: '例: 4', inputmode: 'numeric', min: '1' },
      cls: 'jp-jimaku-epinput',
    });
    if (this.deps.seed?.episode != null) this.epEl.value = String(this.deps.seed.episode);
    epRow.createSpan({
      text: '空欄なら全ファイルを表示',
      cls: 'jp-plexbrowse-sub',
    });

    let debounce: number | null = null;
    const rerun = (): void => {
      if (debounce != null) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => { this.entry = null; void this.paint(); }, 350);
    };
    this.searchEl.addEventListener('input', rerun);
    this.epEl.addEventListener('input', () => { if (this.entry) void this.paint(); });

    this.crumbEl = contentEl.createDiv('jp-plexbrowse-crumb');
    this.listEl = contentEl.createDiv('jp-plexbrowse-list');
    void this.paint();
    window.setTimeout(() => {
      // A seeded query is already the answer to "what am I watching" — the
      // episode box is the field still worth a cursor.
      (this.searchEl.value ? this.epEl : this.searchEl).focus();
    }, 0);
  }

  onClose(): void { this.contentEl.empty(); }

  private episode(): number | undefined {
    const n = Number(this.epEl.value.trim());
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  private async paint(): Promise<void> {
    const mine = ++this.token;
    this.crumbEl.empty();
    const root = this.crumbEl.createSpan({
      text: '作品',
      cls: 'jp-plexbrowse-crumb-item' + (this.entry ? '' : ' is-current'),
    });
    if (this.entry) {
      root.onclick = () => { this.entry = null; void this.paint(); };
      this.crumbEl.createSpan({ text: ' › ', cls: 'jp-plexbrowse-sep' });
      this.crumbEl.createSpan({ text: this.entry.name, cls: 'jp-plexbrowse-crumb-item is-current' });
    }

    this.listEl.empty();
    this.listEl.createDiv({ text: '読み込み中…', cls: 'jp-plexbrowse-empty' });

    if (!this.entry) {
      const q = this.searchEl.value.trim();
      if (!q) {
        this.listEl.empty();
        this.listEl.createDiv({ text: '作品名を入力してください。', cls: 'jp-plexbrowse-empty' });
        return;
      }
      const res = await this.deps.search(q);
      if (mine !== this.token) return;
      this.listEl.empty();
      if (!res.ok) { this.listEl.createDiv({ text: res.error, cls: 'jp-plexbrowse-error' }); return; }
      if (!res.entries.length) {
        this.listEl.createDiv({
          text: `「${q}」は jimaku に見つかりません。別の表記（英題・ローマ字）で試してください。`,
          cls: 'jp-plexbrowse-empty',
        });
        return;
      }
      // Same ranking the auto path uses — so what it would have chosen is
      // visible at the top rather than hidden inside a decision.
      const ranked = pickJimakuEntry(res.entries, q, this.deps.seed?.season).ranked;
      for (const { entry, score } of ranked) this.renderEntryRow(entry, score);
      return;
    }

    const ep = this.episode();
    const res = await this.deps.files(this.entry.id, ep);
    if (mine !== this.token) return;
    this.listEl.empty();
    if (!res.ok) { this.listEl.createDiv({ text: res.error, cls: 'jp-plexbrowse-error' }); return; }

    const pick = pickJimakuFile(res.files, { episode: ep });
    if (!pick.ranked.length) {
      const why = jimakuFileRefusal(res.files, ep) ?? '読み取れるファイルがありません。';
      this.listEl.createDiv({ text: why, cls: 'jp-plexbrowse-error' });
      // Archives still deserve to be visible — the user can fetch one by hand.
      for (const f of res.files.filter((x) => isArchiveFile(x.name))) this.renderFileRow(f, false, true);
      return;
    }
    for (const { file } of pick.ranked) {
      this.renderFileRow(file, pick.file === file && pick.score > 0, false);
    }
  }

  private renderEntryRow(entry: JimakuEntry, score: number): void {
    const row = this.listEl.createDiv('jp-plexbrowse-row');
    const main = row.createDiv('jp-plexbrowse-main');
    main.createDiv({ text: describeJimakuEntry(entry), cls: 'jp-plexbrowse-title' });
    const bits: string[] = [];
    if (entry.flags?.anime) bits.push('アニメ');
    if (entry.flags?.movie) bits.push('映画');
    if (entry.flags?.unverified) bits.push('未検証');
    if (entry.lastModified) bits.push(`更新 ${entry.lastModified.slice(0, 10)}`);
    bits.push(`一致 ${Math.round(score * 100)}%`);
    main.createDiv({ text: bits.join(' · '), cls: 'jp-plexbrowse-sub' });
    row.onclick = () => { this.entry = entry; void this.paint(); };
  }

  private renderFileRow(file: JimakuFile, isTop: boolean, disabled: boolean): void {
    const row = this.listEl.createDiv('jp-plexbrowse-row is-leaf' + (disabled ? ' is-busy' : ''));
    const main = row.createDiv('jp-plexbrowse-main');
    main.createDiv({ text: file.name, cls: 'jp-plexbrowse-title' });
    const ep = episodeNumberFrom(file.name).episode;
    const bits = [
      ...(ep != null ? [`第${ep}話`] : []),
      extOf(file.name) || '?',
      ...(file.size != null ? [fmtBytes(file.size)] : []),
      ...(file.lastModified ? [file.lastModified.slice(0, 10)] : []),
      // The recommendation is labelled as a recommendation, never as truth.
      ...(isTop ? ['← 推定'] : []),
    ];
    main.createDiv({ text: bits.join(' · '), cls: 'jp-plexbrowse-sub' });
    if (disabled) return;

    row.onclick = async () => {
      if (!this.entry) return;
      row.addClass('is-busy');
      const label = row.createSpan({ text: ' 取得中…', cls: 'jp-plexbrowse-busy' });
      try {
        const msg = await this.deps.choose(this.entry, file);
        if (msg.startsWith('📺')) this.close();
        else label.setText('');
      } catch (e) {
        new Notice(String(e instanceof Error ? e.message : e), 10000);
        label.setText('');
      } finally {
        row.removeClass('is-busy');
      }
    };
  }
}
