import type { ContextChunk, DiscourseBit, DiscourseRelation } from "../types.ts";
import { CATEGORY_COLOURS } from "../types.ts";
import type { ContextStore } from "../data/ContextStore.ts";

/** Delay in ms between each bit during auto-reveal. */
const AUTO_REVEAL_DELAY_MS = 600;

/**
 * Fallback colour for connection groups when no category is assigned.
 * Cycles through a neutral palette.
 */
const GROUP_FALLBACK_COLOURS = [
  "#888", "#999", "#777", "#aaa", "#666", "#bbb",
];

/** Resolve a colour for a bit based on its category (preferred) or connection group (fallback). */
function colourForBit(bit: DiscourseBit): string {
  if (bit.category && CATEGORY_COLOURS[bit.category]) {
    return CATEGORY_COLOURS[bit.category];
  }
  return GROUP_FALLBACK_COLOURS[bit.connectionGroup % GROUP_FALLBACK_COLOURS.length];
}

/**
 * DiscourseCardView — renders 談話文法 cards with:
 * - Spoiler tags (tap to reveal each bit)
 * - Fade-in animations (one thought at a time)
 * - Per-category colour-coded underlines / connection indicators
 * - Function frequency stats panel
 * - Mobile-friendly touch targets (44px+)
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
    const storeSize = this.contextStore.size();
    toolbar.createSpan({
      text: `${chunks.length} chunk(s) · ${storeSize.bits} bits indexed`,
      cls: "jp-col-browser-label",
    });

    const autoRevealBtn = toolbar.createEl("button", {
      text: "▶ Auto-reveal",
      cls: "jp-col-sort-btn",
    });
    autoRevealBtn.addEventListener("click", () => this.autoRevealAll());

    // Category distribution stats panel
    this.renderCategoryStats(this.container);

    // Cards
    const list = this.container.createDiv("jp-col-discourse-list");
    for (const chunk of chunks) {
      this.renderChunkCard(list, chunk);
    }
  }

  /**
   * Render a small bar-chart of discourse category distribution.
   */
  private renderCategoryStats(parent: HTMLElement): void {
    const catDist = this.contextStore.getCategoryDistribution();
    const entries = Object.entries(catDist);
    if (entries.length === 0) return;

    const total = entries.reduce((s, [, n]) => s + n, 0);
    const statsEl = parent.createDiv("jp-col-discourse-stats");
    statsEl.createEl("small", { text: "Discourse function distribution:", cls: "jp-col-discourse-stats-label" });

    const barContainer = statsEl.createDiv("jp-col-discourse-stats-bars");
    for (const [cat, count] of entries.sort((a, b) => b[1] - a[1])) {
      const pct = Math.round((count / total) * 100);
      const row = barContainer.createDiv("jp-col-discourse-stats-row");

      const label = row.createSpan({ text: cat, cls: "jp-col-discourse-stats-cat" });
      const colour = CATEGORY_COLOURS[cat as keyof typeof CATEGORY_COLOURS] ?? "#888";
      label.style.setProperty("color", colour);

      const barOuter = row.createDiv("jp-col-discourse-stats-bar-outer");
      const barInner = barOuter.createDiv("jp-col-discourse-stats-bar-inner");
      barInner.style.setProperty("width", `${Math.max(pct, 4)}%`);
      barInner.style.setProperty("background", colour);

      row.createSpan({ text: `${count} (${pct}%)`, cls: "jp-col-discourse-stats-count" });
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

      const colour = colourForBit(bit);

      const bitWrapper = bitContainer.createDiv("jp-col-discourse-bit-wrapper");
      bitWrapper.setAttribute("data-bit-id", bit.id);
      bitWrapper.style.setProperty("--connection-color", colour);

      // Connection indicator underline
      bitWrapper.createDiv("jp-col-discourse-bit-underline");

      // Category badge (shows parent category)
      if (bit.category) {
        const catBadge = bitWrapper.createSpan({
          cls: "jp-col-discourse-cat-badge",
          text: bit.category,
        });
        catBadge.style.setProperty("--cat-color", colour);
      }

      // Function badges (all matched functions)
      if (bit.functions.length > 0) {
        for (const fn of bit.functions) {
          bitWrapper.createSpan({
            cls: "jp-col-discourse-label-badge",
            text: fn,
          });
        }
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

    // Actions
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
   * Uses per-category colours on relation badges.
   */
  private renderRelationIndicators(
    container: HTMLElement,
    bits: DiscourseBit[],
    relations: DiscourseRelation[]
  ): void {
    for (const rel of relations) {
      const toEl = container.querySelector(`[data-bit-id="${rel.toBitId}"]`);
      if (!toEl) continue;

      // Resolve colour from the target bit's category
      const toBit = bits.find(b => b.id === rel.toBitId);
      const colour = toBit ? colourForBit(toBit) : "#888";

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
      delay += AUTO_REVEAL_DELAY_MS;
    }
  }

  refresh(): void {
    this.render();
  }
}
