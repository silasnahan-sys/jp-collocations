/**
 * DiscoveryModal — 💡 the collocations you never wrote down (§21).
 * A ranked list of recurring, uncataloged chunks from the user's OWN
 * exposure; each row is one tap into the normal classify-capture (with its
 * best real occurrence as the attestation) or one tap to dismiss forever.
 */

import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import type { Discovery } from '../notes/discovery.ts';

export interface DiscoveryModalDeps {
  items: Discovery[];
  onCapture: (d: Discovery) => void;
  onDismiss: (d: Discovery) => Promise<void>;
}

export class DiscoveryModal extends Modal {
  constructor(app: App, private deps: DiscoveryModalDeps) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('jp-discovery');
    contentEl.createEl('h3', { text: '💡 発見 — よく聞くのにまだ台帳にない' });
    contentEl.createEl('p', {
      cls: 'jp-discovery-sub',
      text: 'あなたのトランスクリプト＋𝕏コーパスで繰り返し出た連語。生成ではなく、実際に浴びた言葉の集計です。🏷️ で分類キャプチャ（実例つき）、✕ で今後提案しない。',
    });
    if (!this.deps.items.length) {
      contentEl.createEl('p', { text: '新しい発見はありません。視聴が増えるとまた出てきます。' });
      return;
    }
    for (const d of this.deps.items) {
      const row = contentEl.createDiv('jp-discovery-row');
      const main = row.createDiv('jp-discovery-main');
      const top = main.createDiv();
      top.createSpan({ text: d.surface, cls: 'jp-discovery-surface' });
      top.createSpan({ text: ` ${d.files}本 ×${d.count}`, cls: 'jp-discovery-count' });
      main.createDiv({ text: `「${d.example.line}」`, cls: 'jp-discovery-ex' });
      const actions = row.createDiv('jp-discovery-actions');
      const cap = actions.createEl('button', { text: '🏷️', attr: { title: '分類して台帳へ（実例つき）' } });
      cap.onclick = () => { this.close(); this.deps.onCapture(d); };
      const no = actions.createEl('button', { text: '✕', attr: { title: '今後提案しない' } });
      no.onclick = async () => {
        await this.deps.onDismiss(d).catch((e) => new Notice(String(e)));
        row.remove();
      };
    }
  }

  onClose(): void { this.contentEl.empty(); }
}
