/**
 * Lexicon entry cards for the lookup sheet.
 *
 * Kept separate from the view so the same card can be reused by whatever the
 * other agents build next (a surf mode, a dictionary panel, …).
 */

import type { LexEntry } from "./collocation-bridge.ts";
import { entryPhrase } from "./collocation-bridge.ts";

export interface CardAction {
  label: string;
  onClick: (entry: LexEntry) => void;
  ariaLabel?: string;
}

/** Render one entry as a touch-sized card. */
export function renderEntryCard(parent: HTMLElement, entry: LexEntry, actions: CardAction[] = []): HTMLElement {
  const doc = parent.ownerDocument;
  const card = doc.createElement("div");
  card.className = "jp-tg-card";

  const phrase = doc.createElement("div");
  phrase.className = "jp-tg-card-phrase";
  phrase.textContent = entryPhrase(entry);
  card.appendChild(phrase);

  if (entry.headwordReading) {
    const reading = doc.createElement("div");
    reading.className = "jp-tg-card-reading";
    reading.textContent = entry.headwordReading;
    card.appendChild(reading);
  }

  const meta: string[] = [];
  if (entry.pattern) meta.push(entry.pattern);
  if (entry.headwordPOS) meta.push(entry.headwordPOS);
  if (entry.collocatePOS && entry.collocatePOS !== entry.headwordPOS) meta.push(entry.collocatePOS);
  for (const tag of entry.tags ?? []) meta.push(`#${tag}`);

  if (meta.length) {
    const metaRow = doc.createElement("div");
    metaRow.className = "jp-tg-card-meta";
    for (const item of meta) {
      const chip = doc.createElement("span");
      chip.className = "jp-tg-tag";
      chip.textContent = item;
      metaRow.appendChild(chip);
    }
    card.appendChild(metaRow);
  }

  for (const example of (entry.exampleSentences ?? []).slice(0, 3)) {
    const line = doc.createElement("div");
    line.className = "jp-tg-card-example";
    line.textContent = example;
    card.appendChild(line);
  }

  if (entry.notes) {
    const notes = doc.createElement("div");
    notes.className = "jp-tg-card-example";
    notes.textContent = entry.notes;
    card.appendChild(notes);
  }

  if (actions.length) {
    const row = doc.createElement("div");
    row.className = "jp-tg-card-actions";
    for (const action of actions) {
      const button = doc.createElement("button");
      button.className = "jp-tg-btn";
      button.textContent = action.label;
      if (action.ariaLabel) button.setAttribute("aria-label", action.ariaLabel);
      button.addEventListener("click", () => action.onClick(entry));
      row.appendChild(button);
    }
    card.appendChild(row);
  }

  parent.appendChild(card);
  return card;
}

/** Empty-state copy for the lookup sheet. */
export function renderEmptyState(parent: HTMLElement, message: string): HTMLElement {
  const el = parent.ownerDocument.createElement("div");
  el.className = "jp-tg-sheet-empty";
  el.textContent = message;
  parent.appendChild(el);
  return el;
}
