/**
 * knowledge-box.ts — the typed pedagogical box (DESIGN §26.2, from the
 * ACE CROWN frames in _ref_monokakido/: なぜ？ f25, 似ている単語 f40).
 *
 * A knowledge box is a NAMED inline object with a banner title — never a
 * generic card. Tones map to roles, not colors-for-variety (§26.0 test e):
 *   family — 似ている表現 discrimination (image-based, the 🟢 theory)
 *   naze   — why/readings pedagogy
 *   goho   — corpus 語法 profile
 *   warn   — the personal ❗ anti-error record
 *   gen    — 生成 scaffold quarantine
 * An empty box must never render — callers gate on real data.
 */

export type BoxTone = 'family' | 'naze' | 'goho' | 'warn' | 'gen';

export function knowledgeBox(host: HTMLElement, title: string, tone: BoxTone): HTMLElement {
  const box = host.createDiv(`jp-kbox jp-kbox--${tone}`);
  box.createDiv({ text: title, cls: 'jp-kbox-title' });
  return box.createDiv('jp-kbox-body');
}
