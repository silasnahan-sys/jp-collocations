/**
 * Opt-in vertical writing for Obsidian's own editor and reading view.
 *
 * This is the classic desktop-tategaki behaviour: a body class flips the
 * markdown surfaces into `vertical-rl`. It is off by default because CodeMirror
 * on mobile keeps its caret and IME candidate window in horizontal coordinates,
 * so typing into a vertical editor on a phone is awkward — the reader view plus
 * the edit sheet is the mobile-friendly path. Reading view behaves well
 * everywhere.
 */

const BODY_CLASS = "jp-tg-editor-vertical";

export class EditorVerticalMode {
  private doc: Document;
  private active = false;

  constructor(doc: Document = document) {
    this.doc = doc;
  }

  isActive(): boolean {
    return this.active;
  }

  /** Turn the editor-wide vertical mode on or off. */
  set(enabled: boolean): void {
    this.active = enabled;
    this.doc.body.classList.toggle(BODY_CLASS, enabled);
  }

  toggle(): boolean {
    this.set(!this.active);
    return this.active;
  }

  /** Always call on unload — the class outlives the plugin otherwise. */
  dispose(): void {
    this.doc.body.classList.remove(BODY_CLASS);
    this.active = false;
  }
}
