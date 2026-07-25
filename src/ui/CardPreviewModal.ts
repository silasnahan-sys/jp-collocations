/**
 * CardPreviewModal.ts — SRS card preview + generation modal
 *
 * Shows a live preview of generated cards with progressive spoiler
 * reveal. On mobile iOS: 44px touch targets, momentum scroll,
 * tap-to-reveal spoilers, swipe between cards.
 *
 * Two modes:
 *   1. Preview from selection (selected text → chunks → cards)
 *   2. Preview from collocation entries
 *
 * Actions:
 *   - Write cards to a note (creates/appends to SR-compatible file)
 *   - Copy card markdown
 *   - Cycle through cards
 */

import { Modal, Notice, Setting } from 'obsidian';
import type { App, TFile } from 'obsidian';
import { extractChunks, type DiscourseChunk } from '../srs/chunk-extractor';
import {
  generateCardsFromChunks,
  generateCollocationCards,
  generateContextChunkCards,
  generateRelationChunkCards,
  buildCardFileContent,
  DEFAULT_CARD_OPTIONS,
  type SRSCard,
  type CardGenerationOptions,
  type PhraseInContextData,
  type RelationChunkData,
  type RelationSection,
  type SectionRelation,
} from '../srs/card-generator';
import type { ChunkRenderSegment } from '../srs/grammar-set-engine';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../discourse/discourse-grammar';
import { PATTERN_BY_ID, type PatternCategory } from '../discourse/discourse-patterns';
import type { CollocationEntry } from '../types';

export class CardPreviewModal extends Modal {
  private cards: SRSCard[] = [];
  private currentIndex = 0;
  private revealedBits = 0;
  private options: CardGenerationOptions;
  private sourceText: string;
  private sourceFile?: string;
  private collocations: CollocationEntry[];
  private cardContainer: HTMLElement | null = null;
  private navContainer: HTMLElement | null = null;

  /** When set, generateCards() is skipped and these are used directly */
  private injectedCards: SRSCard[] | null = null;

  constructor(
    app: App,
    sourceText: string,
    collocations: CollocationEntry[],
    sourceFile?: string,
    options?: Partial<CardGenerationOptions>,
    injectedCards?: SRSCard[],
  ) {
    super(app);
    this.sourceText = sourceText;
    this.collocations = collocations;
    this.sourceFile = sourceFile;
    this.options = { ...DEFAULT_CARD_OPTIONS, ...options };
    if (injectedCards && injectedCards.length > 0) {
      this.injectedCards = injectedCards;
    }
  }

  onOpen(): void {
    this.generateCards();
    this.buildUI();
    this.renderCurrentCard();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private generateCards(): void {
    // If cards were injected (e.g. from surfer bridge), use them directly
    if (this.injectedCards) {
      this.cards = [...this.injectedCards];
      return;
    }

    this.cards = [];

    // Context-chunk cards (new hivemind system) — always generated when text is present
    if (this.sourceText.trim()) {
      this.cards.push(...generateContextChunkCards(this.sourceText, this.sourceFile, this.options));

      // Relation-chunk cards (Card Type 2: sectioned with relation visualization)
      this.cards.push(...generateRelationChunkCards(this.sourceText, this.sourceFile, this.options));

      // Also generate legacy discourse chunk cards
      const chunks = extractChunks(this.sourceText, this.sourceFile);
      this.cards.push(...generateCardsFromChunks(chunks, this.options));
    }

    // Collocation cards
    if (this.collocations.length > 0) {
      this.cards.push(...generateCollocationCards(this.collocations, this.options));
    }
  }

  private buildUI(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('jp-srs-modal');

    // Header
    const header = contentEl.createDiv('jp-srs-header');
    header.createEl('h3', { text: 'SRS カードプレビュー', cls: 'jp-srs-title' });

    const statsRow = header.createDiv('jp-srs-stats');
    const contextCount = this.cards.filter(c => c.type === 'context-chunk').length;
    const discourseCount = this.cards.filter(c => c.type === 'discourse-chunk').length;
    const collocCount = this.cards.filter(c => c.type === 'collocation').length;
    const phraseCount = this.cards.filter(c => c.type === 'phrase-in-context').length;
    const relationCount = this.cards.filter(c => c.type === 'relation-chunk').length;
    const statParts: string[] = [];
    if (contextCount) statParts.push(`${contextCount} 文脈`);
    if (discourseCount) statParts.push(`${discourseCount} 談話`);
    if (phraseCount) statParts.push(`${phraseCount} 穴埋め`);
    if (relationCount) statParts.push(`${relationCount} 関係`);
    if (collocCount) statParts.push(`${collocCount} コロケ`);
    statsRow.createSpan({
      text: `📊 ${statParts.join(' · ') || `${this.cards.length} カード`}`,
      cls: 'jp-srs-stat',
    });

    // Card display area
    this.cardContainer = contentEl.createDiv('jp-srs-card-container');

    // Navigation
    this.navContainer = contentEl.createDiv('jp-srs-nav');

    const prevBtn = this.navContainer.createEl('button', {
      text: '◀ 前',
      cls: 'jp-srs-nav-btn',
    });
    prevBtn.addEventListener('click', () => this.prevCard());

    const counterEl = this.navContainer.createSpan({
      cls: 'jp-srs-counter',
    });

    const nextBtn = this.navContainer.createEl('button', {
      text: '次 ▶',
      cls: 'jp-srs-nav-btn',
    });
    nextBtn.addEventListener('click', () => this.nextCard());

    // Reveal button (for progressive reveal)
    const revealBtn = contentEl.createEl('button', {
      text: '👆 次のチャンクを表示',
      cls: 'jp-srs-reveal-btn',
    });
    revealBtn.addEventListener('click', () => this.revealNext());

    // Action buttons
    const actions = contentEl.createDiv('jp-srs-actions');

    const writeBtn = actions.createEl('button', {
      text: '📝 ノートに書き出す',
      cls: 'jp-srs-action-btn jp-srs-action-btn--primary',
    });
    writeBtn.addEventListener('click', () => this.writeToNote());

    const copyBtn = actions.createEl('button', {
      text: '📋 コピー',
      cls: 'jp-srs-action-btn',
    });
    copyBtn.addEventListener('click', () => this.copyCards());

    const copyCurrentBtn = actions.createEl('button', {
      text: '📋 このカードをコピー',
      cls: 'jp-srs-action-btn',
    });
    copyCurrentBtn.addEventListener('click', () => this.copyCurrentCard());

    // Options toggles
    const optSection = contentEl.createDiv('jp-srs-options');
    optSection.createEl('h4', { text: '⚙️ オプション', cls: 'jp-srs-opt-title' });

    new Setting(optSection)
      .setName('レジスター表示')
      .addToggle(t => t.setValue(this.options.includeRegister).onChange(v => {
        this.options.includeRegister = v;
        this.regenerate();
      }));

    new Setting(optSection)
      .setName('関係矢印')
      .addToggle(t => t.setValue(this.options.includeRelations).onChange(v => {
        this.options.includeRelations = v;
        this.regenerate();
      }));

    new Setting(optSection)
      .setName('英語グロス')
      .addToggle(t => t.setValue(this.options.includeEnglish).onChange(v => {
        this.options.includeEnglish = v;
        this.regenerate();
      }));

    new Setting(optSection)
      .setName('タイムスタンプ')
      .addToggle(t => t.setValue(this.options.includeTimestamps).onChange(v => {
        this.options.includeTimestamps = v;
        this.regenerate();
      }));
  }

  private renderCurrentCard(): void {
    if (!this.cardContainer || !this.navContainer) return;
    this.cardContainer.empty();

    if (this.cards.length === 0) {
      this.cardContainer.createDiv({
        text: 'カードが生成されませんでした。テキストを選択してください。',
        cls: 'jp-srs-empty',
      });
      return;
    }

    const card = this.cards[this.currentIndex];

    // Update counter
    const counter = this.navContainer.querySelector('.jp-srs-counter');
    if (counter) {
      counter.textContent = `${this.currentIndex + 1} / ${this.cards.length}`;
    }

    // Type badge
    const typeBadge = this.cardContainer.createDiv('jp-srs-type-badge');
    typeBadge.textContent = card.type === 'context-chunk' ? '🧠 文脈'
      : card.type === 'discourse-chunk' ? '🎭 談話'
      : card.type === 'phrase-in-context' ? '🎯 穴埋め'
      : card.type === 'relation-chunk' ? '🔗 関係'
      : '📚 コロケーション';
    typeBadge.addClass(
      card.type === 'context-chunk' ? 'jp-srs-badge--context'
      : card.type === 'discourse-chunk' ? 'jp-srs-badge--discourse'
      : card.type === 'phrase-in-context' ? 'jp-srs-badge--phrase'
      : card.type === 'relation-chunk' ? 'jp-srs-badge--relation'
      : 'jp-srs-badge--collocation'
    );

    // Difficulty dots
    const diffRow = this.cardContainer.createDiv('jp-srs-difficulty');
    for (let i = 0; i < 5; i++) {
      const dot = diffRow.createSpan({ cls: 'jp-srs-diff-dot' });
      if (i < card.difficulty) dot.addClass('jp-srs-diff-dot--filled');
    }

    // Card front
    const frontEl = this.cardContainer.createDiv('jp-srs-card-front');
    frontEl.createEl('h5', { text: '表 (Front)', cls: 'jp-srs-card-label' });

    // Use the new context-chunk renderer if available
    if (card.type === 'context-chunk' && card.chunkAnalysis && card.renderSegments) {
      this.renderContextChunkFront(frontEl, card);
    } else if (card.type === 'phrase-in-context' && card.phraseData) {
      this.renderPhraseInContextFront(frontEl, card);
    } else if (card.type === 'relation-chunk' && card.relationData) {
      this.renderRelationChunkFront(frontEl, card);
    } else {
      // Parse the front for spoilers and render them
      this.renderProgressiveFront(frontEl, card);
    }

    // Card back (hidden initially, tappable to reveal)
    const backToggle = this.cardContainer.createEl('button', {
      text: '📖 裏を見る (Flip)',
      cls: 'jp-srs-flip-btn',
    });

    const backEl = this.cardContainer.createDiv('jp-srs-card-back');
    backEl.style.display = 'none';
    backEl.createEl('h5', { text: '裏 (Back)', cls: 'jp-srs-card-label' });
    this.renderMarkdownContent(backEl, card.back);

    backToggle.addEventListener('click', () => {
      const isHidden = backEl.style.display === 'none';
      backEl.style.display = isHidden ? 'block' : 'none';
      backToggle.textContent = isHidden ? '🙈 裏を隠す' : '📖 裏を見る (Flip)';
    });

    // Tags
    const tagsEl = this.cardContainer.createDiv('jp-srs-tags');
    for (const tag of card.tags) {
      tagsEl.createSpan({ text: `#${tag}`, cls: 'jp-srs-tag' });
    }
  }

  /**
   * Render the front with progressive spoiler reveal.
   * %%hidden text%% → clickable spoiler blocks that fade in.
   */
  private renderProgressiveFront(container: HTMLElement, card: SRSCard): void {
    const frontText = card.front;
    // Split on %%spoiler%% markers
    const parts = frontText.split(/%%/g);

    let spoilerIndex = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;

      if (i % 2 === 1) {
        // This is a spoiler block
        const spoilerEl = container.createDiv('jp-srs-spoiler');
        spoilerEl.dataset.index = String(spoilerIndex);

        if (spoilerIndex < this.revealedBits) {
          // Already revealed
          spoilerEl.addClass('jp-srs-spoiler--revealed');
          this.renderMarkdownContent(spoilerEl, part);
        } else {
          // Hidden
          spoilerEl.addClass('jp-srs-spoiler--hidden');
          spoilerEl.textContent = '████████████';
          spoilerEl.addEventListener('click', () => {
            this.revealedBits = spoilerIndex + 1;
            this.renderCurrentCard();
          });
        }
        spoilerIndex++;
      } else {
        // Regular (visible) content — relation arrows, headers, etc.
        if (part.startsWith('<small>')) {
          const arrowEl = container.createDiv('jp-srs-relation');
          arrowEl.innerHTML = part.replace(/<\/?small>/g, '');
        } else if (part.startsWith('>')) {
          const quoteEl = container.createDiv('jp-srs-quote');
          quoteEl.textContent = part.replace(/^>\s*/, '');
        } else {
          const textEl = container.createDiv('jp-srs-text');
          this.renderMarkdownContent(textEl, part);
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // CONTEXT-CHUNK CARD RENDERER — the "I know the words but
  //   not the script" fade-in reveal system
  // ══════════════════════════════════════════════════════════

  /**
   * Render a context-chunk card front with grammar-set-based reveal.
   *
   * The full chunk text is displayed as a single block.
   * Each text segment belongs to a "grammar set" (reveal step).
   * Initially all segments are hidden (blurred/blocked).
   * As the learner taps "reveal next", each grammar set fades in
   * WITH ITS SURROUNDING BRIDGE TEXT — so meaning emerges idea by idea.
   *
   * Discourse pattern spans get colored underlines when revealed.
   * Bridge text fades in plain.
   */
  private renderContextChunkFront(container: HTMLElement, card: SRSCard): void {
    const analysis = card.chunkAnalysis!;
    const segments = card.renderSegments!;
    const totalSteps = analysis.totalSets;

    // Header: show chunk metadata
    const metaRow = container.createDiv('jp-ctx-card-meta');
    metaRow.createSpan({
      text: `🧠 ${totalSteps} sets · ${analysis.register}`,
      cls: 'jp-ctx-card-meta-text',
    });

    // Honest provenance badge — sidecar means pipeline-validated typed
    // relations; heuristic means TS regex-on-connector fallback (unvalidated).
    const isSidecar = analysis.relationSource === 'sidecar';
    metaRow.createSpan({
      text: isSidecar ? '✓ sidecar' : '~ heuristic',
      cls: isSidecar
        ? 'jp-ctx-card-source-badge jp-ctx-card-source-badge--sidecar'
        : 'jp-ctx-card-source-badge jp-ctx-card-source-badge--heuristic',
      attr: {
        title: isSidecar
          ? 'Relations validated by the Python analysis pipeline (top-down + bottom-up reconciled).'
          : 'Relations come from the TypeScript regex-on-connector heuristic. Not validated — best-guess only.',
      },
    });

    // Step indicator pills
    const stepBar = container.createDiv('jp-ctx-step-bar');
    for (let i = 0; i < totalSteps; i++) {
      const set = analysis.grammarSets[i];
      const pill = stepBar.createDiv('jp-ctx-step-pill');
      pill.style.backgroundColor = i < this.revealedBits ? set.color : 'var(--background-modifier-border)';
      pill.title = `${set.label} (${set.labelEn})`;
      if (i < this.revealedBits) {
        pill.addClass('jp-ctx-step-pill--revealed');
      }
    }

    // The text body: all segments rendered inline
    const textBody = container.createDiv('jp-ctx-card-text-body');

    for (const seg of segments) {
      const isRevealed = seg.revealStep < this.revealedBits;

      if (isRevealed) {
        // ── REVEALED SEGMENT ──
        const span = textBody.createSpan({
          text: seg.text,
          cls: 'jp-ctx-seg jp-ctx-seg--revealed',
        });

        // If this is a discourse pattern, add styled annotation
        if (seg.isPattern && seg.patternId) {
          const pDef = PATTERN_BY_ID.get(seg.patternId);
          if (pDef) {
            span.addClass('jp-ctx-seg--pattern');
            span.style.borderBottom = `2px solid ${seg.color ?? CATEGORY_COLORS[pDef.category] ?? '#95a5a6'}`;
            span.title = `${pDef.category}: ${pDef.gloss} — ${pDef.glossEn}`;
          }
        }

        // Fade-in animation: if this was JUST revealed (revealedBits - 1 === seg.revealStep)
        if (seg.revealStep === this.revealedBits - 1) {
          span.addClass('jp-ctx-seg--fade-in');
        }
      } else {
        // ── HIDDEN SEGMENT ──
        // Show a blurred/blocked placeholder
        const span = textBody.createSpan({
          cls: 'jp-ctx-seg jp-ctx-seg--hidden',
        });
        // Use Unicode full-block characters to obscure, but match length
        // To give a sense of the text's shape
        const blockText = seg.text.replace(/[^\s\n]/g, '█');
        span.textContent = blockText;
        span.title = 'Tap "reveal" to show this grammar set';
      }
    }

    // Set label for the NEXT reveal
    if (this.revealedBits < totalSteps) {
      const nextSet = analysis.grammarSets[this.revealedBits];
      const nextLabel = container.createDiv('jp-ctx-next-label');
      nextLabel.createSpan({
        text: `次: ${nextSet.label} (${nextSet.labelEn})`,
        cls: 'jp-ctx-next-label-text',
      });
      const reason = nextSet.groupingReason === 'relation-pair' ? '関係ペア'
        : nextSet.groupingReason === 'flow-chain' ? '論理フロー'
        : nextSet.groupingReason === 'clause-pair' ? '節接続'
        : nextSet.groupingReason === 'functional-unit' ? '機能ユニット'
        : '単独';
      nextLabel.createSpan({
        text: reason,
        cls: 'jp-ctx-next-reason',
      });
    } else {
      const doneLabel = container.createDiv('jp-ctx-done-label');
      doneLabel.textContent = '✅ すべてのセットが表示されました — スクリプト完成!';
    }

    // Show already-revealed set labels below
    if (this.revealedBits > 0) {
      const revealedSets = container.createDiv('jp-ctx-revealed-sets');
      for (let i = 0; i < this.revealedBits && i < totalSteps; i++) {
        const set = analysis.grammarSets[i];
        const chip = revealedSets.createSpan({ cls: 'jp-ctx-revealed-chip' });
        chip.style.borderLeft = `3px solid ${set.color}`;
        chip.textContent = `${i + 1}. ${set.label}`;
        chip.title = set.patterns.map(p => p.matchedText).join(' · ');
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // CARD TYPE 1: PHRASE-IN-CONTEXT cloze renderer
  // ══════════════════════════════════════════════════════════

  private renderPhraseInContextFront(container: HTMLElement, card: SRSCard): void {
    const data = card.phraseData!;

    // Hint badge
    const hintRow = container.createDiv('jp-pic-hint');
    hintRow.createSpan({ text: `🎯 ${data.hint}`, cls: 'jp-pic-hint-text' });
    if (data.collocation && data.collocation.confidence > 0.7) {
      const confBadge = hintRow.createSpan({ cls: 'jp-pic-conf-badge' });
      confBadge.textContent = `${(data.collocation.confidence * 100).toFixed(0)}%`;
    }

    // Context text with blank
    const textBody = container.createDiv('jp-pic-text-body');

    // Before the blank
    if (data.phraseStart > 0) {
      textBody.createSpan({
        text: data.contextText.slice(0, data.phraseStart),
        cls: 'jp-pic-context',
      });
    }

    // The blank itself — tappable to reveal
    const blankEl = textBody.createSpan({ cls: 'jp-pic-blank' });
    if (this.revealedBits > 0) {
      blankEl.textContent = data.phrase;
      blankEl.addClass('jp-pic-blank--revealed');
    } else {
      blankEl.textContent = '＿＿＿＿＿';
      blankEl.addClass('jp-pic-blank--hidden');
      blankEl.addEventListener('click', () => {
        this.revealedBits = 1;
        this.renderCurrentCard();
      });
    }

    // After the blank
    if (data.phraseEnd < data.contextText.length) {
      textBody.createSpan({
        text: data.contextText.slice(data.phraseEnd),
        cls: 'jp-pic-context',
      });
    }

    // Collocation type tag
    if (data.collocation) {
      const colTag = container.createDiv('jp-pic-colloc-tag');
      colTag.createSpan({
        text: `${data.collocation.patternLabel}: ${data.collocation.surface}`,
        cls: 'jp-pic-colloc-text',
      });
    }
  }

  // ══════════════════════════════════════════════════════════
  // CARD TYPE 2: RELATION-CHUNK sectioned fade-in + viz
  // ══════════════════════════════════════════════════════════

  private renderRelationChunkFront(container: HTMLElement, card: SRSCard): void {
    const data = card.relationData!;
    const totalSections = data.sections.length;

    // Meta row
    const metaRow = container.createDiv('jp-rel-card-meta');
    metaRow.createSpan({
      text: `🔗 ${totalSections} sections · ${data.relations.length} relations · ${data.register}`,
      cls: 'jp-rel-meta-text',
    });

    // Step indicator
    const stepBar = container.createDiv('jp-rel-step-bar');
    for (let i = 0; i < totalSections; i++) {
      const sec = data.sections[i];
      const pill = stepBar.createDiv('jp-rel-step-pill');
      pill.style.backgroundColor = i < this.revealedBits ? sec.color : 'var(--background-modifier-border)';
      pill.title = `${sec.label} (${sec.labelEn})`;
      if (i < this.revealedBits) pill.addClass('jp-rel-step-pill--revealed');
    }

    // Sections container
    const sectionsEl = container.createDiv('jp-rel-sections');

    for (let si = 0; si < totalSections; si++) {
      const sec = data.sections[si];
      const isRevealed = si < this.revealedBits;

      const secEl = sectionsEl.createDiv('jp-rel-section');
      secEl.style.borderLeft = `3px solid ${sec.color}`;

      if (isRevealed) {
        secEl.addClass('jp-rel-section--revealed');
        if (si === this.revealedBits - 1) secEl.addClass('jp-rel-section--fade-in');

        // Section label
        const labelEl = secEl.createDiv('jp-rel-section-label');
        labelEl.createSpan({ text: `§${si + 1} ${sec.label}`, cls: 'jp-rel-section-label-text' });

        // Render bits within the section
        const bitsEl = secEl.createDiv('jp-rel-section-bits');
        for (const bit of sec.bits) {
          const bitSpan = bitsEl.createSpan({
            text: bit.text,
            cls: 'jp-rel-bit',
          });
          if (bit.patternId) {
            bitSpan.addClass('jp-rel-bit--pattern');
            bitSpan.style.borderBottom = `2px solid ${bit.color ?? '#95a5a6'}`;
            if (bit.patternLabel) bitSpan.title = bit.patternLabel;
          }
        }

        // Draw relation arrows FROM this section
        const outRels = data.relations.filter(r => r.fromSection === si);
        if (outRels.length > 0) {
          const arrowsEl = secEl.createDiv('jp-rel-arrows');
          for (const rel of outRels) {
            const arrowEl = arrowsEl.createDiv('jp-rel-arrow');
            arrowEl.addClass(rel.color);
            const targetRevealed = rel.toSection < this.revealedBits;
            arrowEl.createSpan({
              text: `${rel.label} → §${rel.toSection + 1}`,
              cls: targetRevealed ? 'jp-rel-arrow-text' : 'jp-rel-arrow-text jp-rel-arrow-text--target-hidden',
            });
          }
        }
      } else {
        // Hidden section
        secEl.addClass('jp-rel-section--hidden');
        const blockText = sec.text.replace(/[^\s\n]/g, '█');
        secEl.createSpan({ text: blockText, cls: 'jp-rel-section-blocked' });
      }
    }

    // Next section label
    if (this.revealedBits < totalSections) {
      const nextSec = data.sections[this.revealedBits];
      const nextLabel = container.createDiv('jp-rel-next-label');
      nextLabel.createSpan({
        text: `次: §${this.revealedBits + 1} ${nextSec.label}`,
        cls: 'jp-rel-next-label-text',
      });
    } else {
      const doneLabel = container.createDiv('jp-rel-done-label');
      doneLabel.textContent = '✅ すべてのセクション表示 — 関係マップ完成!';
    }
  }

  /**
   * Simple markdown renderer for card content.
   * Handles: **bold**, ==highlight==, <u>underline</u>, <small>small</small>
   */
  private renderMarkdownContent(container: HTMLElement, markdown: string): void {
    const lines = markdown.split('\n');
    for (const line of lines) {
      if (!line.trim()) {
        container.createEl('br');
        continue;
      }

      const p = container.createDiv('jp-srs-line');

      // Process inline formatting
      let html = line
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/==(.*?)==/g, '<mark>$1</mark>')
        .replace(/<u>(.*?)<\/u>/g, '<u>$1</u>')
        .replace(/<small>(.*?)<\/small>/g, '<small>$1</small>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/\[\[(.*?)\]\]/g, '<em>📄 $1</em>');

      // Sanitize — only allow the specific tags we use
      const safeHtml = html
        .replace(/<(?!\/?(?:strong|mark|u|small|code|em|br)\b)[^>]*>/gi, '');

      p.innerHTML = safeHtml;
    }
  }

  // ── Navigation ─────────────────────────────────────────────

  private prevCard(): void {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.revealedBits = 0;
      this.renderCurrentCard();
    }
  }

  private nextCard(): void {
    if (this.currentIndex < this.cards.length - 1) {
      this.currentIndex++;
      this.revealedBits = 0;
      this.renderCurrentCard();
    }
  }

  private revealNext(): void {
    const card = this.cards[this.currentIndex];
    if (!card) return;

    if (card.type === 'phrase-in-context') {
      if (this.revealedBits < 1) {
        this.revealedBits = 1;
        this.renderCurrentCard();
      }
    } else if (card.type === 'relation-chunk' && card.relationData) {
      if (this.revealedBits < card.relationData.sections.length) {
        this.revealedBits++;
        this.renderCurrentCard();
      }
    } else if (card.type === 'context-chunk' && card.chunkAnalysis) {
      if (this.revealedBits < card.chunkAnalysis.totalSets) {
        this.revealedBits++;
        this.renderCurrentCard();
      }
    } else {
      const spoilerCount = (card.front.match(/%%/g) ?? []).length / 2;
      if (this.revealedBits < spoilerCount) {
        this.revealedBits++;
        this.renderCurrentCard();
      }
    }
  }

  // ── Actions ────────────────────────────────────────────────

  private async writeToNote(): Promise<void> {
    const content = buildCardFileContent(this.cards);
    const fileName = `JP SRS Cards ${new Date().toISOString().slice(0, 10)}.md`;
    const folder = this.app.vault.getAbstractFileByPath('JP SRS Cards');

    let targetPath: string;
    if (folder) {
      targetPath = `JP SRS Cards/${fileName}`;
    } else {
      targetPath = fileName;
    }

    // Check if file exists → append
    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing && 'path' in existing) {
      const file = existing as TFile;
      const currentContent = await this.app.vault.read(file);
      await this.app.vault.modify(file, currentContent + '\n\n' + content);
      new Notice(`📝 ${this.cards.length} cards appended to ${targetPath}`);
    } else {
      await this.app.vault.create(targetPath, content);
      new Notice(`📝 ${this.cards.length} cards written to ${targetPath}`);
    }
    this.close();
  }

  private async copyCards(): Promise<void> {
    const content = buildCardFileContent(this.cards);
    await navigator.clipboard.writeText(content);
    new Notice(`📋 ${this.cards.length} cards copied to clipboard`);
  }

  private async copyCurrentCard(): Promise<void> {
    const card = this.cards[this.currentIndex];
    if (card) {
      await navigator.clipboard.writeText(card.markdown);
      new Notice('📋 Card copied to clipboard');
    }
  }

  private regenerate(): void {
    // Only clear injected cards if we have a source to regenerate from;
    // otherwise keep them (option toggles are irrelevant for pre-built cards).
    if (this.sourceText.trim() || this.collocations.length > 0) {
      this.injectedCards = null;
    }
    this.generateCards();
    this.currentIndex = Math.min(this.currentIndex, Math.max(0, this.cards.length - 1));
    this.revealedBits = 0;
    // Full UI rebuild to update stats row
    this.buildUI();
    this.renderCurrentCard();
  }
}
