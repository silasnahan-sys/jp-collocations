/**
 * surface-bar.ts — §26.3 build-order step 5, finally built.
 *
 * The plugin is one chain (§28) presented as nine ItemViews, and until now the
 * only way between them was the command palette — 63 entries deep, keyboard-
 * shaped, and useless with a Pencil in your hand. That is not a missing
 * convenience, it is the seam: a phrase you are looking at in the 辞書 and want
 * to check on 𝕏 costs a palette round trip, so it doesn't happen, so the
 * surfaces stay strangers to each other.
 *
 * One bar, identical on every surface, current one marked. Footer on a phone
 * (ACE CROWN's law, §26.3: every actionable element in the thumb zone), header
 * rail with room for keyboard hints on desktop.
 *
 * The badges are the part that earns it a place rather than making it chrome:
 * §26.0 says a box must carry data, so 復習 shows what is actually due and
 * トレイ shows what is actually unresolved. A zero renders as nothing — an
 * empty badge would be a number that counts nothing as something.
 */

import { Platform, setIcon } from 'obsidian';

export type Surface = 'lexicon' | 'dict' | 'x' | 'tray' | 'review' | 'capture';

export interface SurfaceBarDeps {
  /** Which surface the bar is being rendered *inside*. */
  current: Surface;
  open: (s: Surface) => void;
  /** Live count for a surface, or undefined for none. Called on every render. */
  badge?: (s: Surface) => number | undefined;
}

interface Item { id: Surface; label: string; icon: string; }

const ITEMS: readonly Item[] = [
  { id: 'lexicon', label: '語彙', icon: 'library' },
  { id: 'dict', label: '辞書', icon: 'book-open' },
  { id: 'x', label: '𝕏', icon: 'search' },
  { id: 'tray', label: 'トレイ', icon: 'inbox' },
  { id: 'review', label: '復習', icon: 'layers' },
  { id: 'capture', label: '⚡', icon: 'zap' },
];

/**
 * Render the bar into `host`. Returns the bar element so a caller can move it
 * (FollowAlongView wants it above its transport, not below).
 */
export function renderSurfaceBar(host: HTMLElement, deps: SurfaceBarDeps): HTMLElement {
  const bar = host.createDiv(`jp-surfbar${Platform.isPhone ? ' jp-surfbar--foot' : ''}`);
  for (const it of ITEMS) {
    const btn = bar.createEl('button', {
      cls: `jp-surfbar-btn${it.id === deps.current ? ' jp-surfbar-btn--on' : ''}`,
      attr: { 'aria-label': it.label, title: it.label },
    });
    // 𝕏 and ⚡ ARE their glyphs; the rest read better as line icons with a
    // label under them at thumb size.
    const glyph = btn.createSpan('jp-surfbar-glyph');
    if (it.id === 'x' || it.id === 'capture') glyph.setText(it.label);
    else setIcon(glyph, it.icon);
    if (it.id !== 'x' && it.id !== 'capture') btn.createSpan({ cls: 'jp-surfbar-label', text: it.label });
    const n = deps.badge?.(it.id);
    if (n && n > 0) btn.createSpan({ cls: 'jp-surfbar-badge', text: n > 99 ? '99+' : String(n) });
    btn.onclick = () => { if (it.id !== deps.current) deps.open(it.id); };
  }
  return bar;
}
