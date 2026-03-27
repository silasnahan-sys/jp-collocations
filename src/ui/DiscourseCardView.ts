import type { ContextChunk, DiscourseBit, DiscourseRelation } from "../types.ts";
import type { ContextStore } from "../data/ContextStore.ts";

/**
 * Colour palette for connection groups — cycles through these for
 * different discourse relationship clusters.
 */
const CONNECTION_COLOURS = [
  "#e06c75", // red
  "#4a90d9", // blue
  "#98c379", // green
  "#e5c07b", // amber
  "#c678dd", // purple
  "#56b6c2", // teal
  "#d19a66", // orange
  "#be5046", // brick
];

function colourForGroup(group: number): string {
  return CONNECTION_COLOURS[group % CONNECTION_COLOURS.length];
}

/**
 * DiscourseCardView — renders 談話文法 cards with:
 * - Spoiler tags (tap to reveal each bit)
 * - Fade-in animations (one thought at a time)
 * - Colour-coded underlines / connection indicators
 * - Mobile-friendly touch targets
 */
export class DiscourseCardView {
  private container: HTMLElement;
  private contextStore: ContextStore;

  constructor(parent: HTMLElement, contextStore: ContextStore) {
    this.contextStore = contextStore;
    this.container = parent.createDiv("jp-col-discourse-view");
    this.render();
  }

  private render(): void {
    this.container.empty();

    const chunks = this.contextStore.getAllChunks();
    if (chunks.length === 0) {
      this.container.createDiv({
        text: 'No discourse chunks yet. Select text in a note and use "Create Discourse Card" to start.',
        cls: "jp-col-empty",
      });
      return;
    }

    // Toolbar
    const toolbar = this.container.createDiv("jp-col-browser-toolbar");
    toolbar.createSpan({ text: `${chunks.length} chunk(s)`, cls: "jp-col-browser-label" });

    const autoRevealBtn = toolbar.createEl("button", {
      text: "▶ Auto-reveal",
      cls: "jp-col-sort-btn",
    });
    autoRevealBtn.addEventListener("click", () => this.autoRevealAll());

    // Cards
    const list = this.container.createDiv("jp-col-discourse-list");
    for (const chunk of chunks) {
      this.renderChunkCard(list, chunk);
    }
  }

  private renderChunkCard(parent: HTMLElement, chunk: ContextChunk): void {
    const card = parent.createDiv("jp-col-discourse-card");

    // Card header
    const header = card.createDiv("jp-col-discourse-card-header");
    header.createSpan({
      cls: "jp-col-discourse-phrase",
      text: chunk.selectedPhrase,
    });
    header.createSpan({
      cls: "jp-col-discourse-source",
      text: chunk.sourceFile,
    });

    // Bit container — each bit is a spoiler
    const bitContainer = card.createDiv("jp-col-discourse-bits");
    const bitEls: HTMLElement[] = [];

    let currentSpeaker = "";
    for (const bit of chunk.bits) {
      // Speaker label
      if (bit.speaker !== currentSpeaker) {
        currentSpeaker = bit.speaker;
        const speakerEl = bitContainer.createDiv("jp-col-discourse-speaker");
        speakerEl.createSpan({ text: currentSpeaker });
      }

      const bitWrapper = bitContainer.createDiv("jp-col-discourse-bit-wrapper");
      bitWrapper.setAttribute("data-bit-id", bit.id);
      bitWrapper.style.setProperty(
        "--connection-color",
        colourForGroup(bit.connectionGroup)
      );

      // Connection indicator underline
      bitWrapper.createDiv("jp-col-discourse-bit-underline");

      // Discourse label badge
      if (bit.discourseLabel) {
        bitWrapper.createSpan({
          cls: "jp-col-discourse-label-badge",
          text: bit.discourseLabel,
        });
      }

      // The spoiler element
      const spoiler = bitWrapper.createDiv("jp-col-discourse-spoiler");
      spoiler.createSpan({ text: bit.text });

      // Tap / click to reveal
      spoiler.addEventListener("click", () => {
        spoiler.addClass("jp-col-discourse-spoiler--revealed");
        bitWrapper.addClass("jp-col-discourse-bit-wrapper--revealed");
      });

      bitEls.push(bitWrapper);
    }

    // Render relation arrows between connected bits
    this.renderRelationIndicators(bitContainer, chunk.bits, chunk.relations);

    // Flip card — show all at once (collocation card mode)
    const actions = card.createDiv("jp-col-discourse-actions");

    const revealAllBtn = actions.createEl("button", {
      text: "Reveal All",
      cls: "jp-col-action-btn",
    });
    revealAllBtn.addEventListener("click", () => {
      for (const el of bitEls) {
        const sp = el.querySelector(".jp-col-discourse-spoiler");
        sp?.addClass("jp-col-discourse-spoiler--revealed");
        el.addClass("jp-col-discourse-bit-wrapper--revealed");
      }
    });

    const hideAllBtn = actions.createEl("button", {
      text: "Hide All",
      cls: "jp-col-action-btn",
    });
    hideAllBtn.addEventListener("click", () => {
      for (const el of bitEls) {
        const sp = el.querySelector(".jp-col-discourse-spoiler");
        sp?.removeClass("jp-col-discourse-spoiler--revealed");
        el.removeClass("jp-col-discourse-bit-wrapper--revealed");
      }
    });

    const stepBtn = actions.createEl("button", {
      text: "Step ▶",
      cls: "jp-col-action-btn",
    });
    let stepIdx = 0;
    stepBtn.addEventListener("click", () => {
      if (stepIdx < bitEls.length) {
        const el = bitEls[stepIdx];
        el.addClass("jp-col-discourse-bit-wrapper--revealed");
        el.addClass("jp-col-discourse-bit-wrapper--fadein");
        const sp = el.querySelector(".jp-col-discourse-spoiler");
        sp?.addClass("jp-col-discourse-spoiler--revealed");
        stepIdx++;
      }
      if (stepIdx >= bitEls.length) {
        stepBtn.textContent = "✓ Done";
        stepBtn.setAttribute("disabled", "true");
      }
    });

    const deleteBtn = actions.createEl("button", {
      text: "×",
      cls: "jp-col-action-btn jp-col-action-btn--danger",
    });
    deleteBtn.addEventListener("click", () => {
      this.contextStore.deleteChunk(chunk.id);
      card.remove();
    });
  }

  /**
   * Render visual connection indicators between related bits.
   * Uses colour-coded dots/lines next to the connected bits.
   */
  private renderRelationIndicators(
    container: HTMLElement,
    bits: DiscourseBit[],
    relations: DiscourseRelation[]
  ): void {
    for (const rel of relations) {
      const fromEl = container.querySelector(`[data-bit-id="${rel.fromBitId}"]`);
      const toEl = container.querySelector(`[data-bit-id="${rel.toBitId}"]`);
      if (!fromEl || !toEl) continue;

      const colour = colourForGroup(rel.connectionGroup);

      // Add relation type label to the target bit
      const badge = (toEl as HTMLElement).createSpan({
        cls: "jp-col-discourse-relation-badge",
        text: rel.relationType,
      });
      badge.style.setProperty("--rel-color", colour);
    }
  }

  /**
   * Auto-reveal bits one at a time with animation delays.
   */
  private autoRevealAll(): void {
    const allBits = this.container.querySelectorAll(".jp-col-discourse-bit-wrapper");
    let delay = 0;
    for (const el of Array.from(allBits)) {
      setTimeout(() => {
        (el as HTMLElement).addClass("jp-col-discourse-bit-wrapper--revealed");
        (el as HTMLElement).addClass("jp-col-discourse-bit-wrapper--fadein");
        const sp = el.querySelector(".jp-col-discourse-spoiler");
        sp?.addClass("jp-col-discourse-spoiler--revealed");
      }, delay);
      delay += 600;
    }
  }

  refresh(): void {
    this.render();
  }
}
