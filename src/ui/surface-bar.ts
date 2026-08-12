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

import { setIcon } from 'obsidian';
import { isSlate, isThumb } from './posture.ts';

export type Surface = 'lexicon' | 'dict' | 'x' | 'tray' | 'review' | 'capture';

export type SurfaceLayout = 'foot' | 'rail' | 'inline';

export interface SurfaceBarDeps {
  /** Which surface the bar is being rendered *inside*. */
  current: Surface;
  open: (s: Surface) => void;
  /** Live count for a surface, or undefined for none. Called on every render. */
  badge?: (s: Surface) => number | undefined;
  /** Draw only these. Defaults to all six — what shipped before the split. */
  only?: readonly Surface[];
  /** Override the posture's own answer, when the caller knows the container. */
  layout?: SurfaceLayout;
}

/**
 * `label` names the destination anywhere the plugin has to SAY where it is
 * going. `caption` is what rides under the glyph in the bar.
 *
 * They differ for exactly two entries, and the reason is a mis-tap I could see
 * in the 2026-08-08 recordings: 𝕏 and ⚡ were drawn as bare glyphs while all
 * four of their neighbours carried a text label — so at bar size, sitting
 * between 辞書 and トレイ, **𝕏 reads as a close button**. Every other control
 * in that row navigates; one of them appeared to destroy. A caption costs a
 * line of code and removes the only ambiguous target in the navigator.
 */
interface Item { id: Surface; label: string; icon: string; caption?: string }

const ITEMS: readonly Item[] = [
  { id: 'lexicon', label: '語彙', icon: 'library' },
  { id: 'dict', label: '辞書', icon: 'book-open' },
  { id: 'x', label: '𝕏', icon: 'search', caption: '𝕏検索' },
  { id: 'tray', label: 'トレイ', icon: 'inbox' },
  { id: 'review', label: '復習', icon: 'layers' },
  { id: 'capture', label: '⚡', icon: 'zap', caption: '分類' },
];

/**
 * ## Places and verbs are not the same kind of thing
 *
 * All six used to render into one bar, and on a tablet that bar was the
 * FLOATING rail — so five destinations lived in an overlay sitting on top of
 * the reading column. That is a category error, and it is why no position for
 * the rail was ever right: moving it right→left just changed which column of
 * Japanese it covered.
 *
 * Apple Notes is the reference he named himself, and the distinction is in it:
 * the palette that floats holds TOOLS THAT ACT ON THE CANVAS. Destinations
 * there live in a fixed bar, in flow, because you must always be able to leave
 * and leaving must never be something you first have to move out of the way.
 *
 * So: `PLACES` go in the foot bar (`wideDock`), `TOOLS` stay on the rail with
 * the dismiss verb. Same six buttons, same handlers — only which container
 * each is born into changes, and on a phone both names resolve to the one dock
 * so nothing there moves at all.
 */
export const PLACES: readonly Surface[] = ['lexicon', 'dict', 'x', 'tray', 'review'];
export const TOOLS: readonly Surface[] = ['capture'];

/**
 * ## Where you are decides what is LIT, never what is WHERE
 *
 * 「the placement of stuff should be ergonomic and dynamic and depend on where
 * i am … never make a wrong selection or tap while feeling in full control」
 *
 * Those two clauses pull against each other, and the resolution is the whole
 * point of this map. A bar that re-ordered itself, or resized its buttons, to
 * suit the current surface would be "dynamic" — and it would reintroduce
 * exactly the defect `pane-size.ts` was written to remove, because a target
 * whose position depends on context is a target you have to look at before you
 * can hit it.
 *
 * So geometry is frozen: same six buttons, same order, same width, at every
 * pane size and on every surface. What changes is only EMPHASIS — the one or
 * two destinations that are actually the next move from here come up to full
 * contrast and the rest sit back. The eye is guided; the hand is not asked to
 * re-learn anything.
 *
 * The pairs are the moves visible in the 2026-08-08 recordings: he looks a word
 * up and then classifies it, he reads 𝕏 results and sends one to the tray, he
 * works the tray and reaches for ⚡. A surface's own entry is never listed —
 * it is already marked as current.
 */
const NEXT: Record<Surface, readonly Surface[]> = {
  lexicon: ['dict', 'tray'],
  dict: ['lexicon', 'capture'],
  x: ['tray', 'capture'],
  tray: ['capture', 'lexicon'],
  review: ['dict', 'lexicon'],
  capture: ['tray', 'lexicon'],
};

/**
 * One name per surface, for anything that has to SAY where it is going —
 * the edge-back affordance names its destination before you commit to it.
 * Derived from `ITEMS` rather than written twice, because two lists of the
 * same six labels is one rename away from a gesture that lies.
 */
export const SURFACE_LABEL: Record<Surface, string> =
  Object.fromEntries(ITEMS.map((i) => [i.id, i.label])) as Record<Surface, string>;

/**
 * Render the bar into `host`. Returns the bar element so a caller can move it
 * (FollowAlongView wants it above its transport, not below).
 */
export function renderSurfaceBar(host: HTMLElement, deps: SurfaceBarDeps): HTMLElement {
  // Footed on a phone, railed on a tablet, inline on the desktop. All three are
  // "put the navigator where the hand already is"; only the answer differs.
  // A caller that already knows which container it picked says so instead.
  const layout: SurfaceLayout = deps.layout ?? (isThumb() ? 'foot' : isSlate() ? 'rail' : 'inline');
  const dock = layout === 'foot' ? ' jp-surfbar--foot' : layout === 'rail' ? ' jp-surfbar--rail' : '';
  const bar = host.createDiv(`jp-surfbar${dock}`);
  const next = NEXT[deps.current] ?? [];
  for (const it of ITEMS) {
    if (deps.only && !deps.only.includes(it.id)) continue;
    // `--next` changes contrast only. See NEXT: nothing about it may move a
    // button, because a target that moves with context cannot be hit blind.
    const lit = it.id !== deps.current && next.includes(it.id) ? ' jp-surfbar-btn--next' : '';
    const btn = bar.createEl('button', {
      cls: `jp-surfbar-btn${it.id === deps.current ? ' jp-surfbar-btn--on' : ''}${lit}`,
      attr: { 'aria-label': it.label, title: it.label },
    });
    // 𝕏 and ⚡ ARE their glyphs; the rest read better as line icons. But EVERY
    // button gets a caption — see `Item`. The stylesheet hides captions in a
    // tight pane (`.jp-pane-xs`), which is the one place the row would
    // otherwise have to scroll, and there the buttons are uniform glyphs, so
    // nothing looks like the odd one out.
    const glyph = btn.createSpan('jp-surfbar-glyph');
    if (it.id === 'x' || it.id === 'capture') glyph.setText(it.label);
    else setIcon(glyph, it.icon);
    btn.createSpan({ cls: 'jp-surfbar-label', text: it.caption ?? it.label });
    const n = deps.badge?.(it.id);
    if (n && n > 0) btn.createSpan({ cls: 'jp-surfbar-badge', text: n > 99 ? '99+' : String(n) });
    btn.onclick = () => { if (it.id !== deps.current) deps.open(it.id); };
  }
  return bar;
}
