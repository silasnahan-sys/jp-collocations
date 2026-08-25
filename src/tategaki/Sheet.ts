/**
 * A bottom sheet — the mobile-native way to show a lookup result without
 * losing the reader's place. Obsidian's `Modal` covers the screen and steals
 * focus; a sheet keeps the text visible above it and is dismissed with a
 * downward flick, which is what a thumb expects.
 */

export interface SheetHandle {
  /** The scrollable body — callers fill this in. */
  body: HTMLElement;
  /** The header slot, for a title and extra buttons. */
  header: HTMLElement;
}

export class BottomSheet {
  private root: HTMLElement;
  private grip: HTMLElement;
  private headerEl: HTMLElement;
  private titleEl: HTMLElement;
  private bodyEl: HTMLElement;
  private open = false;
  private disposers: Array<() => void> = [];
  private onCloseCallback: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    const doc = parent.ownerDocument;

    this.root = doc.createElement("div");
    this.root.className = "jp-tg-sheet";

    this.grip = doc.createElement("div");
    this.grip.className = "jp-tg-sheet-grip";
    this.grip.setAttribute("aria-label", "Drag down to close");

    this.headerEl = doc.createElement("div");
    this.headerEl.className = "jp-tg-sheet-header";

    this.titleEl = doc.createElement("div");
    this.titleEl.className = "jp-tg-sheet-term";
    this.headerEl.appendChild(this.titleEl);

    const closeBtn = doc.createElement("button");
    closeBtn.className = "jp-tg-btn";
    closeBtn.textContent = "✕";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", () => this.close());
    this.headerEl.appendChild(closeBtn);

    this.bodyEl = doc.createElement("div");
    this.bodyEl.className = "jp-tg-sheet-body";

    this.root.append(this.grip, this.headerEl, this.bodyEl);
    parent.appendChild(this.root);

    this.attachDragToDismiss();
  }

  /** Show the sheet, clearing whatever it held before. */
  show(title: string, onClose?: () => void): SheetHandle {
    this.titleEl.textContent = title;
    this.bodyEl.textContent = "";
    this.bodyEl.scrollTop = 0;
    this.onCloseCallback = onClose ?? null;
    this.root.classList.add("is-open");
    this.open = true;
    return { body: this.bodyEl, header: this.headerEl };
  }

  /** Swap the title without rebuilding the body. */
  setTitle(title: string): void {
    this.titleEl.textContent = title;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove("is-open");
    this.root.style.transform = "";
    const callback = this.onCloseCallback;
    this.onCloseCallback = null;
    callback?.();
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Add a button to the header, left of the close button. */
  addHeaderButton(label: string, onClick: () => void, ariaLabel?: string): HTMLElement {
    const button = this.root.ownerDocument.createElement("button");
    button.className = "jp-tg-btn";
    button.textContent = label;
    if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
    button.addEventListener("click", onClick);
    this.headerEl.insertBefore(button, this.headerEl.lastElementChild);
    return button;
  }

  destroy(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.root.remove();
  }

  /** Flick the grip downward to dismiss. */
  private attachDragToDismiss(): void {
    let startY = 0;
    let offset = 0;
    let dragging = false;

    const begin = (y: number): void => {
      startY = y;
      offset = 0;
      dragging = true;
      this.root.classList.add("is-dragging");
    };

    const move = (y: number): void => {
      if (!dragging) return;
      offset = Math.max(0, y - startY);
      this.root.style.transform = `translateY(${offset}px)`;
    };

    const end = (): void => {
      if (!dragging) return;
      dragging = false;
      this.root.classList.remove("is-dragging");
      this.root.style.transform = "";
      if (offset > 70) this.close();
    };

    const onTouchStart = (ev: TouchEvent): void => begin(ev.touches[0].clientY);
    const onTouchMove = (ev: TouchEvent): void => {
      move(ev.touches[0].clientY);
      if (dragging) ev.preventDefault();
    };

    const onMouseDown = (ev: MouseEvent): void => {
      begin(ev.clientY);
      const onMouseMove = (moveEv: MouseEvent): void => move(moveEv.clientY);
      const onMouseUp = (): void => {
        end();
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    };

    this.grip.addEventListener("touchstart", onTouchStart, { passive: true });
    this.grip.addEventListener("touchmove", onTouchMove, { passive: false });
    this.grip.addEventListener("touchend", end, { passive: true });
    this.grip.addEventListener("touchcancel", end, { passive: true });
    this.grip.addEventListener("mousedown", onMouseDown);

    this.disposers.push(() => {
      this.grip.removeEventListener("touchstart", onTouchStart);
      this.grip.removeEventListener("touchmove", onTouchMove);
      this.grip.removeEventListener("touchend", end);
      this.grip.removeEventListener("touchcancel", end);
      this.grip.removeEventListener("mousedown", onMouseDown);
    });
  }
}
