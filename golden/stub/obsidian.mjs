/**
 * golden/stub/obsidian.mjs — just enough `obsidian` for the UI modules to load.
 *
 * Deliberately tiny and deliberately DUMB. This is not a simulation of Obsidian;
 * it is the smallest thing that lets a module under test be imported, so the
 * test can exercise the module's OWN logic. Anything a suite actually asserts
 * about should be the plugin's code, never this file's.
 *
 * `Platform` is mutable because posture detection is one of the things worth
 * testing: a suite sets the flags for the device it is pretending to be.
 */

export const Platform = {
  isMobile: false,
  isPhone: false,
  isTablet: false,
  isDesktop: true,
};

/** Set the platform flags for one scenario. */
export function setPlatform(next) {
  Object.assign(Platform, { isMobile: false, isPhone: false, isTablet: false, isDesktop: false }, next);
}

export function setIcon(el, name) {
  el?.setAttribute?.('data-icon', name);
}

export class Notice {
  constructor(message, timeout) {
    this.message = message;
    this.timeout = timeout;
    Notice.log.push(message);
  }
  static log = [];
  hide() { /* nothing to hide */ }
}

export class Menu {
  constructor() { this.items = []; }
  addItem(cb) { const i = { setTitle: (t) => (i.title = t, i), onClick: (f) => (i.click = f, i) }; cb(i); this.items.push(i); return this; }
  addSeparator() { return this; }
  showAtMouseEvent() { return this; }
  showAtPosition() { return this; }
}

export class Component {
  onload() {}
  onunload() {}
  register() {}
  registerEvent() {}
}

export class ItemView extends Component {}
export class Modal extends Component {}
export class Plugin extends Component {}
export class SuggestModal extends Component {}
export class TFile {}
export class MarkdownView extends Component {}
export const requestUrl = async () => ({ status: 0, text: '' });
export const normalizePath = (p) => p;
export const debounce = (fn) => fn;
