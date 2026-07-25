/**
 * ReachModal — recording a want you cannot yet say (DESIGN §27.0.2).
 *
 * §26.0 rule 3 forbids a place-change to complete a thought, and names the
 * capture modal as the tolerated exception. This is the same exception for the
 * same reason: a reach arrives mid-sentence, from anywhere, and there is no
 * content on screen to act ON — the whole point is that the phrase does not
 * exist yet. Two fields, ⌘⏎ to keep, Esc to drop.
 */

import { Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';

export class ReachModal extends Modal {
  private want = '';
  private gloss = '';

  constructor(app: App, private onKeep: (want: string, gloss?: string) => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('jp-reach-modal');
    contentEl.createEl('h3', { text: '願いを保持する' });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: '言いたいのに言えないもの。まだ日本語の形がなくて構いません — ' +
        'それが要点です。届いた発話が、後で横に並べられます。',
    });

    new Setting(contentEl)
      .setName('言いたいこと')
      .setDesc('例: "at some point" — いつか、ほどは遠くない何か')
      .addText((t) => {
        t.setPlaceholder('その感じ…').onChange((v) => { this.want = v; });
        window.setTimeout(() => t.inputEl.focus(), 0);
      });

    new Setting(contentEl)
      .setName('手がかり（任意）')
      .setDesc('言い換え・英語・仕草・「〜な時の感じ」など')
      .addText((t) => t.onChange((v) => { this.gloss = v; }));

    const btns = contentEl.createDiv({ cls: 'jp-reach-btns' });
    const keep = btns.createEl('button', { text: '保持する', cls: 'mod-cta' });
    keep.onclick = () => void this.keep();

    contentEl.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void this.keep(); }
    });
  }

  private async keep(): Promise<void> {
    const want = this.want.trim();
    if (!want) return;                       // an empty want is not a reach
    await this.onKeep(want, this.gloss.trim() || undefined);
    this.close();
  }

  onClose(): void { this.contentEl.empty(); }
}
