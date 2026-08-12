/**
 * golden/stub/dom.mjs — a DOM small enough to read, real enough to catch bugs.
 *
 * ## Why not jsdom
 *
 * The rules this exists to protect are not DOM rules, they are OUR rules:
 * "`draggable` goes on a grip, never on a body you would want to read", "a
 * stale lookup must not land in a live card", "a failed read is not a missing
 * word". Every one of those is decided by a handful of attribute writes and
 * listener registrations, and a full browser emulation would add a dependency,
 * a startup cost, and an enormous surface of behaviour nobody is asserting —
 * to answer questions this file answers in 150 lines.
 *
 * It also keeps the harness's one good property: `node golden/x.mjs`, no
 * install step, no flags, no network.
 *
 * ## What it does NOT do
 *
 * No layout, no CSS, no cascade. `offsetWidth` and `getBoundingClientRect` are
 * whatever a test sets them to. That is honest rather than limiting: a suite
 * that wants to check placement states the geometry it is placing against,
 * which is clearer than inheriting a fake browser's guesses. What it cannot
 * check — that a real WebKit honours `touch-action`, that a real selection
 * survives a re-render — is not checkable in Node at all, and pretending
 * otherwise with a heavier fake would be worse than saying so.
 */

class ClassList {
  constructor(el) { this.el = el; }
  add(...c) { for (const x of c) if (x) this.el._cls.add(x); }
  remove(...c) { for (const x of c) this.el._cls.delete(x); }
  contains(c) { return this.el._cls.has(c); }
  toggle(c, on) { const want = on ?? !this.el._cls.has(c); want ? this.el._cls.add(c) : this.el._cls.delete(c); return want; }
  get value() { return [...this.el._cls].join(' '); }
}

let uid = 0;

export class El {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this._id = ++uid;
    this._cls = new Set();
    this.classList = new ClassList(this);
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this._attrs = {};
    this._on = new Map();
    this._text = '';
    this.title = '';
    // Layout is stated by the test, never computed. See the header.
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this._rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  get className() { return [...this._cls].join(' '); }
  get isConnected() {
    let n = this;
    while (n.parentElement) n = n.parentElement;
    return n === document.body || n === document.documentElement;
  }

  // ── Obsidian's DOM extensions (the plugin uses these, not raw DOM) ──
  addClass(...c) { this.classList.add(...c); return this; }
  removeClass(...c) { this.classList.remove(...c); return this; }
  toggleClass(c, on) { this.classList.toggle(c, on); return this; }
  hasClass(c) { return this.classList.contains(c); }

  createEl(tag, o = {}) {
    const el = new El(tag);
    const opts = typeof o === 'string' ? { cls: o } : o;
    if (opts.cls) el.addClass(...String(opts.cls).split(/\s+/).filter(Boolean));
    if (opts.text != null) el.setText(String(opts.text));
    if (opts.type) el.setAttribute('type', opts.type);
    if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, String(v));
    this.appendChild(el);
    return el;
  }
  createDiv(o = {}) { return this.createEl('div', o); }
  createSpan(o = {}) { return this.createEl('span', o); }

  appendChild(el) { el.parentElement?.removeChild(el); el.parentElement = this; this.children.push(el); return el; }
  removeChild(el) {
    const i = this.children.indexOf(el);
    if (i >= 0) { this.children.splice(i, 1); el.parentElement = null; }
    return el;
  }
  remove() { this.parentElement?.removeChild(this); }
  empty() { for (const c of [...this.children]) this.removeChild(c); this._text = ''; return this; }

  setText(t) { this.empty(); this._text = String(t); return this; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(t) { this.setText(t); }

  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  hasAttribute(k) { return k in this._attrs; }
  removeAttribute(k) { delete this._attrs[k]; }
  setAttr(k, v) { this.setAttribute(k, v); }
  getAttr(k) { return this.getAttribute(k); }

  contains(n) { while (n) { if (n === this) return true; n = n.parentElement; } return false; }
  closest(sel) {
    const want = sel.replace(/^\./, '');
    let n = this;
    while (n) { if (n._cls?.has(want)) return n; n = n.parentElement; }
    return null;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) {
    const want = sel.replace(/^\./, '');
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (c._cls.has(want)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }

  addEventListener(type, fn) {
    if (!this._on.has(type)) this._on.set(type, new Set());
    this._on.get(type).add(fn);
  }
  removeEventListener(type, fn) { this._on.get(type)?.delete(fn); }
  /** Fire a listener directly. No bubbling — suites target the node they mean. */
  fire(type, ev = {}) {
    const e = {
      type, target: this, currentTarget: this,
      preventDefault() { e.defaultPrevented = true; },
      stopPropagation() { e.propagationStopped = true; },
      defaultPrevented: false, propagationStopped: false,
      ...ev,
    };
    for (const fn of [...(this._on.get(type) ?? [])]) fn(e);
    return e;
  }
  listenerCount(type) { return this._on.get(type)?.size ?? 0; }

  getBoundingClientRect() { return { ...this._rect }; }
  /** Tests state their own geometry — see the header. */
  setRect(r) {
    this._rect = { left: 0, top: 0, width: 0, height: 0, ...r };
    this._rect.right = this._rect.left + this._rect.width;
    this._rect.bottom = this._rect.top + this._rect.height;
    this.offsetWidth = this.offsetWidth || this._rect.width;
    this.offsetHeight = this.offsetHeight || this._rect.height;
    return this;
  }
}

/** A `window.getSelection()` a suite can drive. */
export class FakeSelection {
  constructor() { this.anchorNode = null; this.rangeCount = 0; this._text = ''; this._rect = null; this.cleared = 0; }
  select(node, text, rect = { left: 100, top: 200, width: 60, height: 20 }) {
    this.anchorNode = node; this._text = text; this.rangeCount = 1;
    this._rect = { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height };
    return this;
  }
  collapse() { this.rangeCount = 0; this._text = ''; }
  toString() { return this._text; }
  getRangeAt() { return { getBoundingClientRect: () => ({ ...this._rect }) }; }
  removeAllRanges() { this.cleared++; this.collapse(); }
}

/**
 * Install the globals the UI modules reach for. Returns the handles a suite
 * needs to drive them.
 */
export function installDom() {
  const body = new El('body');
  const html = new El('html');
  html.appendChild(body);

  const docListeners = new Map();
  const winListeners = new Map();
  const selection = new FakeSelection();

  const doc = {
    body, documentElement: html,
    nodeType: 9,
    createElement: (t) => new El(t),
    addEventListener: (t, fn) => { if (!docListeners.has(t)) docListeners.set(t, new Set()); docListeners.get(t).add(fn); },
    removeEventListener: (t, fn) => { docListeners.get(t)?.delete(fn); },
    elementFromPoint: () => null,
    hidden: false,
    fire: (t, ev = {}) => { for (const fn of [...(docListeners.get(t) ?? [])]) fn({ type: t, ...ev }); },
    listenerCount: (t) => docListeners.get(t)?.size ?? 0,
  };

  const win = {
    innerWidth: 1366, innerHeight: 1024,
    getSelection: () => selection,
    matchMedia: (q) => ({ matches: win._coarse && /coarse/.test(q), media: q, addEventListener() {}, removeEventListener() {} }),
    _coarse: false,
    setTimeout: (...a) => setTimeout(...a),
    clearTimeout: (...a) => clearTimeout(...a),
    requestAnimationFrame: (fn) => setTimeout(() => fn(0), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    addEventListener: (t, fn) => { if (!winListeners.has(t)) winListeners.set(t, new Set()); winListeners.get(t).add(fn); },
    removeEventListener: (t, fn) => { winListeners.get(t)?.delete(fn); },
    fire: (t, ev = {}) => { for (const fn of [...(winListeners.get(t) ?? [])]) fn({ type: t, ...ev }); },
    listenerCount: (t) => winListeners.get(t)?.size ?? 0,
  };

  globalThis.document = doc;
  globalThis.window = win;
  globalThis.HTMLElement = El;
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame;

  return { document: doc, window: win, body, selection, El };
}

/** Let a queued `setTimeout(0)` / rAF and a resolved promise chain run. */
export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
