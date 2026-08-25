/**
 * Styles for the tategaki module.
 *
 * These are injected at runtime instead of living in the repo's `styles.css`.
 * Two reasons:
 *   1. Several agents are editing `styles.css` right now — a runtime stylesheet
 *      cannot produce a merge conflict.
 *   2. The module stays drop-in: copy `src/tategaki/`, call `registerTategaki()`,
 *      and the styling comes with it.
 * To fold it into `styles.css` later, paste TATEGAKI_CSS in and delete the
 * inject/remove calls in `register.ts`. Nothing else changes.
 */

export const TATEGAKI_STYLE_ID = "jp-tategaki-styles";

export const TATEGAKI_CSS = `
/* ── View shell (horizontal — only .jp-tg-canvas is vertical) ───────────── */
.jp-tategaki-view {
  --jp-tg-fs: 19px;
  --jp-tg-lh: 1.85;
  --jp-tg-pad: 18px;
  --jp-tg-ff: "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif JP",
              "Source Han Serif JP", "IPAmjMincho", serif;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
  background: var(--background-primary);
  -webkit-tap-highlight-color: transparent;
}

.jp-tategaki-view.jp-tg--gothic {
  --jp-tg-ff: "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP",
              "Source Han Sans JP", sans-serif;
}

.jp-tategaki-view.jp-tg--paper .jp-tg-canvas {
  background: var(--background-primary-alt);
}

/* ── Toolbar: every control is a 44px touch target ─────────────────────── */
.jp-tg-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  padding-top: max(6px, env(safe-area-inset-top));
  border-bottom: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
  flex: 0 0 auto;
  overflow-x: auto;
  scrollbar-width: none;
}

.jp-tg-toolbar::-webkit-scrollbar { display: none; }
.jp-tg-toolbar.is-hidden { display: none; }

.jp-tg-btn {
  min-width: 44px;
  min-height: 40px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s, 6px);
  background: var(--background-primary);
  color: var(--text-normal);
  font-size: var(--font-ui-small, 13px);
  font-family: var(--font-interface);
  line-height: 1;
  cursor: pointer;
  flex: 0 0 auto;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}

.jp-tg-btn:active { background: var(--background-modifier-hover); }
.jp-tg-btn.is-active {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  border-color: var(--interactive-accent);
}
.jp-tg-btn.is-disabled { opacity: 0.4; pointer-events: none; }

.jp-tg-title {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0 6px;
  font-size: var(--font-ui-smaller, 12px);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Stage + vertical canvas ────────────────────────────────────────────── */
.jp-tg-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.jp-tg-canvas {
  writing-mode: vertical-rl;
  -webkit-writing-mode: vertical-rl;
  text-orientation: mixed;
  -webkit-text-orientation: mixed;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  /* We handle pinch ourselves (it resizes the type, it does not zoom the page),
     so only horizontal panning is handed to the browser. */
  touch-action: pan-x;
  scrollbar-width: none;
  padding: var(--jp-tg-pad);
  padding-bottom: max(var(--jp-tg-pad), env(safe-area-inset-bottom));
  padding-top: max(var(--jp-tg-pad), env(safe-area-inset-top));
  font-family: var(--jp-tg-ff);
  font-size: var(--jp-tg-fs);
  line-height: var(--jp-tg-lh);
  color: var(--text-normal);
  font-feature-settings: "vert" 1, "vrt2" 1, "palt" 0;
  user-select: text;
  -webkit-user-select: text;
}

.jp-tg-canvas::-webkit-scrollbar { display: none; }

/* Paging is driven from JS (ScrollController): CSS scroll-snap would pin the
   scroller to the sentinels, and CSS smooth scrolling would animate the
   scrollLeft probes used to measure the scroll range. */
.jp-tg-canvas.jp-tg--paged { scroll-snap-stop: normal; }

/* Horizontal fallback when the vertical mode is switched off. */
.jp-tg-canvas.jp-tg--horizontal {
  writing-mode: horizontal-tb;
  -webkit-writing-mode: horizontal-tb;
  overflow-x: hidden;
  overflow-y: auto;
  touch-action: pan-y;
}

.jp-tg-content { height: 100%; }
.jp-tg-canvas.jp-tg--horizontal .jp-tg-content { height: auto; }

.jp-tg-sentinel {
  display: inline-block;
  inline-size: 0;
  block-size: 0;
}

/* ── Blocks (logical properties: they follow the writing mode) ──────────── */
.jp-tg-para {
  margin: 0;
  padding: 0;
}

.jp-tg-para.jp-tg--indent { text-indent: 1em; }

.jp-tg-h {
  margin-block: 0.4em;
  font-weight: 600;
  color: var(--text-normal);
  letter-spacing: 0.08em;
}

.jp-tg-h1 { font-size: 1.5em; }
.jp-tg-h2 { font-size: 1.32em; }
.jp-tg-h3 { font-size: 1.18em; }
.jp-tg-h4, .jp-tg-h5, .jp-tg-h6 { font-size: 1.06em; }

.jp-tg-quote {
  padding-inline-start: 1.2em;
  border-inline-start: 2px solid var(--background-modifier-border);
  color: var(--text-muted);
}

.jp-tg-li {
  padding-inline-start: 0.4em;
  margin: 0;
}

.jp-tg-li-marker { color: var(--text-muted); }

.jp-tg-rule {
  inline-size: 100%;
  block-size: 1px;
  margin-block: 1em;
  background: var(--background-modifier-border);
}

.jp-tg-spacer { block-size: 0.9em; }

/* Code and images become horizontal islands inside the vertical flow. */
.jp-tg-codeblock {
  writing-mode: horizontal-tb;
  -webkit-writing-mode: horizontal-tb;
  display: block;
  width: min(78vw, 30em);
  max-height: 100%;
  overflow: auto;
  margin-block: 0.6em;
  padding: 8px 10px;
  border-radius: var(--radius-s, 6px);
  background: var(--background-secondary);
  font-family: var(--font-monospace);
  font-size: 0.8em;
  line-height: 1.5;
  white-space: pre;
  -webkit-overflow-scrolling: touch;
}

.jp-tg-code {
  writing-mode: horizontal-tb;
  -webkit-writing-mode: horizontal-tb;
  display: inline-block;
  padding: 0 3px;
  border-radius: 3px;
  background: var(--background-secondary);
  font-family: var(--font-monospace);
  font-size: 0.82em;
  vertical-align: middle;
}

.jp-tg-img {
  display: block;
  max-height: 100%;
  max-width: 70vw;
  margin-block: 0.6em;
  border-radius: var(--radius-s, 6px);
}

.jp-tg-img-alt {
  display: inline-block;
  padding: 2px 6px;
  border: 1px dashed var(--background-modifier-border);
  border-radius: var(--radius-s, 6px);
  color: var(--text-muted);
  font-size: 0.8em;
}

/* ── Inline typography ──────────────────────────────────────────────────── */
.jp-tg-canvas ruby { ruby-position: over; -webkit-ruby-position: before; }

.jp-tg-canvas rt {
  font-size: 0.5em;
  line-height: 1.1;
  letter-spacing: 0;
  color: inherit;
  text-emphasis: none;
  -webkit-text-emphasis: none;
  font-weight: normal;
}

.jp-tategaki-view.jp-tg--no-ruby rt { display: none; }

.jp-tg-tcy {
  text-combine-upright: all;
  -webkit-text-combine: horizontal;
  letter-spacing: 0;
}

.jp-tategaki-view.jp-tg--upright .jp-tg-canvas {
  text-orientation: upright;
  -webkit-text-orientation: upright;
}

.jp-tg-bold { font-weight: 700; }

/* 圏点 — the tategaki convention for emphasis, drawn on the right of the column. */
.jp-tategaki-view.jp-tg--bouten .jp-tg-bold {
  font-weight: inherit;
  text-emphasis: filled sesame currentColor;
  -webkit-text-emphasis: filled sesame currentColor;
  text-emphasis-position: over right;
  -webkit-text-emphasis-position: over right;
}

.jp-tg-italic { font-style: italic; }
.jp-tg-strike { text-decoration: line-through; }

.jp-tg-mark {
  background: var(--text-highlight-bg, rgba(255, 208, 0, 0.35));
  border-radius: 2px;
}

.jp-tg-link {
  color: var(--text-accent);
  text-decoration: underline;
  text-underline-position: right;
  cursor: pointer;
}

/* ── Collocation hits from the lexicon ──────────────────────────────────── */
.jp-tg-colloc {
  text-decoration: underline dotted;
  text-decoration-color: var(--text-accent);
  text-underline-position: right;
  text-decoration-thickness: 1.5px;
  cursor: pointer;
}

.jp-tg-colloc.is-active {
  background: var(--text-selection, rgba(120, 170, 255, 0.28));
  border-radius: 3px;
}

.jp-tg-tap-flash {
  background: var(--text-selection, rgba(120, 170, 255, 0.28));
  border-radius: 3px;
}

/* ── Progress meter ─────────────────────────────────────────────────────── */
.jp-tg-progress {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  padding-bottom: max(4px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
  font-size: var(--font-ui-smaller, 12px);
  color: var(--text-muted);
}

.jp-tg-progress-track {
  flex: 1 1 auto;
  height: 4px;
  border-radius: 2px;
  background: var(--background-modifier-border);
  overflow: hidden;
}

.jp-tg-progress-fill {
  height: 100%;
  width: 0%;
  background: var(--interactive-accent);
  transition: width 0.12s linear;
}

.jp-tg-progress-label { flex: 0 0 auto; font-variant-numeric: tabular-nums; }

/* ── Bottom sheet (lookup / edit) ───────────────────────────────────────── */
.jp-tg-sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  max-height: 62%;
  background: var(--background-primary);
  border-top: 1px solid var(--background-modifier-border);
  border-radius: 12px 12px 0 0;
  box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.22);
  transform: translateY(102%);
  transition: transform 0.18s ease-out;
  padding-bottom: env(safe-area-inset-bottom);
}

.jp-tg-sheet.is-open { transform: translateY(0); }
.jp-tg-sheet.is-dragging { transition: none; }

.jp-tg-sheet-grip {
  flex: 0 0 auto;
  padding: 8px 0 4px;
  display: flex;
  justify-content: center;
  touch-action: none;
  cursor: grab;
}

.jp-tg-sheet-grip::after {
  content: "";
  width: 38px;
  height: 4px;
  border-radius: 2px;
  background: var(--background-modifier-border);
}

.jp-tg-sheet-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 8px;
  border-bottom: 1px solid var(--background-modifier-border);
}

.jp-tg-sheet-term {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--text-accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.jp-tg-sheet-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 8px 12px 12px;
}

.jp-tg-sheet-empty {
  padding: 18px 4px;
  color: var(--text-muted);
  text-align: center;
  font-size: var(--font-ui-small, 13px);
}

/* ── Lookup result cards ────────────────────────────────────────────────── */
.jp-tg-card {
  padding: 10px 12px;
  margin-bottom: 8px;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m, 8px);
  background: var(--background-secondary);
}

.jp-tg-card-phrase {
  font-size: 1.08rem;
  font-weight: 600;
  color: var(--text-normal);
  margin-bottom: 2px;
}

.jp-tg-card-reading {
  font-size: 0.82rem;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.jp-tg-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}

.jp-tg-tag {
  padding: 1px 7px;
  border-radius: 10px;
  background: var(--background-modifier-border);
  color: var(--text-muted);
  font-size: 0.72rem;
}

.jp-tg-card-example {
  font-size: 0.86rem;
  color: var(--text-muted);
  line-height: 1.6;
  margin-top: 2px;
}

.jp-tg-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

/* ── Edit sheet (horizontal writing — mobile IME behaves there) ─────────── */
.jp-tg-edit-area {
  width: 100%;
  min-height: 34vh;
  box-sizing: border-box;
  padding: 10px;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s, 6px);
  background: var(--background-primary);
  color: var(--text-normal);
  font-family: var(--font-text, inherit);
  font-size: 16px; /* keeps iOS from zooming the webview on focus */
  line-height: 1.7;
  resize: vertical;
}

/* ── Overlay hints ──────────────────────────────────────────────────────── */
.jp-tg-hint {
  position: absolute;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  z-index: 15;
  padding: 5px 12px;
  border-radius: 14px;
  background: var(--background-secondary-alt, var(--background-secondary));
  color: var(--text-muted);
  font-size: var(--font-ui-smaller, 12px);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.16s;
}

.jp-tg-hint.is-visible { opacity: 0.94; }

.jp-tg-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 24px;
  color: var(--text-muted);
  text-align: center;
  font-size: var(--font-ui-small, 13px);
}

/* ── Reading-view code block: \`\`\`tategaki ────────────────────────────────── */
.jp-tg-embed {
  writing-mode: vertical-rl;
  -webkit-writing-mode: vertical-rl;
  text-orientation: mixed;
  height: 60vh;
  max-height: 70vh;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-x: contain;
  touch-action: pan-x;
  padding: 12px;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m, 8px);
  background: var(--background-primary-alt);
  font-family: var(--jp-tg-ff, "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif);
  line-height: 1.85;
}

.jp-tg-embed::-webkit-scrollbar { display: none; }

.jp-tg-embed.jp-tg--horizontal {
  writing-mode: horizontal-tb;
  -webkit-writing-mode: horizontal-tb;
  height: auto;
  max-height: none;
  overflow-x: hidden;
  overflow-y: auto;
  touch-action: auto;
}

.jp-tg-embed.jp-tg--horizontal .jp-tg-content { height: auto; }

/* ── Optional: vertical mode for the markdown editor / reading view ─────── */
.jp-tg-editor-vertical .markdown-preview-section,
.jp-tg-editor-vertical .markdown-source-view.mod-cm6 .cm-contentContainer {
  writing-mode: vertical-rl;
  -webkit-writing-mode: vertical-rl;
  text-orientation: mixed;
  height: 100%;
}

.jp-tg-editor-vertical .markdown-preview-view,
.jp-tg-editor-vertical .markdown-source-view.mod-cm6 .cm-scroller {
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-x: contain;
}

/* ── Phone-sized screens ────────────────────────────────────────────────── */
@media (max-width: 620px) {
  .jp-tategaki-view { --jp-tg-pad: 14px; }
  .jp-tg-sheet { max-height: 70%; }
  .jp-tg-btn { min-height: 44px; }
  .jp-tg-codeblock { width: 84vw; }
}

@media (prefers-reduced-motion: reduce) {
  .jp-tg-sheet { transition: none; }
  .jp-tg-progress-fill { transition: none; }
}
`;

/** Add the stylesheet to the document (idempotent). */
export function injectTategakiStyles(doc: Document = document): void {
  if (doc.getElementById(TATEGAKI_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = TATEGAKI_STYLE_ID;
  style.textContent = TATEGAKI_CSS;
  doc.head.appendChild(style);
}

/** Remove the stylesheet again on plugin unload. */
export function removeTategakiStyles(doc: Document = document): void {
  doc.getElementById(TATEGAKI_STYLE_ID)?.remove();
}
