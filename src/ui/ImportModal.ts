/**
 * ImportModal — one paste-shaped importer for §22 source mediums
 * (.srt subtitles, Kindle notebook exports, note.com articles). Fields +
 * a big paste area; the caller turns the paste into a source note.
 */

import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';

export interface ImportField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

export interface ImportModalOpts {
  title: string;
  hint?: string;
  fields: ImportField[];
  pasteLabel: string;
  /** true = the paste area may stay empty (URL-driven imports). */
  pasteOptional?: boolean;
  submitLabel: string;
  onSubmit: (values: Record<string, string>, paste: string) => Promise<string>;
}

export class ImportModal extends Modal {
  constructor(app: App, private opts: ImportModalOpts) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('jp-import');
    // Chrome, not reading text: a pen sweep across this title armed the
    // selection echo on a UI label (IMG_1231 t146.5). The marker is read by
    // selection-echo's guard.
    contentEl.setAttr('data-jp-no-echo', '');
    contentEl.createEl('h3', { text: this.opts.title });
    if (this.opts.hint) contentEl.createEl('p', { text: this.opts.hint, cls: 'jp-import-hint' });

    const inputs = new Map<string, HTMLInputElement>();
    for (const f of this.opts.fields) {
      const row = contentEl.createDiv('jp-import-row');
      row.createEl('label', { text: f.label });
      const input = row.createEl('input', { type: 'text', attr: { placeholder: f.placeholder ?? '' } });
      inputs.set(f.key, input);
    }
    const ta = contentEl.createEl('textarea', {
      cls: 'jp-import-paste',
      attr: { placeholder: this.opts.pasteLabel, rows: '12' },
    });

    const submit = contentEl.createEl('button', { text: this.opts.submitLabel, cls: 'mod-cta' });
    submit.onclick = async () => {
      const values: Record<string, string> = {};
      for (const f of this.opts.fields) {
        const v = inputs.get(f.key)!.value.trim();
        if (f.required && !v) { new Notice(`${f.label} を入力してください`); return; }
        values[f.key] = v;
      }
      if (!ta.value.trim() && !this.opts.pasteOptional) { new Notice('本文を貼り付けてください'); return; }
      submit.disabled = true;
      try {
        const msg = await this.opts.onSubmit(values, ta.value);
        new Notice(msg);
        this.close();
      } catch (e) {
        new Notice(String(e));
        submit.disabled = false;
      }
    };
  }

  onClose(): void { this.contentEl.empty(); }
}
