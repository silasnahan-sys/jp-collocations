/**
 * ReviewView — the SRS review surface (Anki-shaped, plugin-native).
 *
 * A real spaced-repetition loop over the pattern catalog: the deck is built by
 * SrsStore's queue policy, each card is class-shaped (review-cards.ts), audio
 * plays from a detached <audio> that survives re-renders (like the library
 * player), and the four grade buttons show their real next-interval preview.
 * 🟡 serifu cards play the clip FIRST (dictation) before revealing text.
 *
 * The card unit is the PATTERN, so reviewing consolidates every sighting of a
 * construction at once — not one card per occurrence.
 */

import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import type { PatternEntry, Attestation } from '../notes/pattern-store.ts';
import type { GoldExample } from '../notes/discourse-gold.ts';
import { NOTE_TYPES, type NoteClass } from '../notes/note-types.ts';
import type { SrsStore } from '../srs/srs-store.ts';
import { previewIntervals, type Grade, type CardState } from '../srs/scheduler.ts';
import { buildReviewCard, isReviewable, type ReviewCard } from '../srs/review-cards.ts';

export const JP_REVIEW_VIEW_TYPE = 'jp-srs-review-view';

export interface ReviewDeps {
  srs: SrsStore;
  patterns: () => PatternEntry[];
  /** the discourse gold example for a pattern id, if any (upgrades 🔴 cards). */
  goldFor: (patternId: string) => GoldExample | null;
  /** resolve an attestation's audio clip to a playable src, or null. */
  resolveClip: (att: Attestation) => Promise<{ src: string; label: string } | null>;
  /** open the source of an attestation (transcript block / tweet / web). */
  openAttestation: (att: Attestation) => Promise<void>;
  newPerSession: () => number;
}

interface Session {
  queue: string[];
  pos: number;
  graded: number;
  again: number;
  startedFresh: number;
}

export class ReviewView extends ItemView {
  private session: Session | null = null;
  private revealed = false;
  private audio: HTMLAudioElement | null = null;

  constructor(leaf: WorkspaceLeaf, private deps: ReviewDeps) {
    super(leaf);
  }

  getViewType(): string { return JP_REVIEW_VIEW_TYPE; }
  getDisplayText(): string { return '復習 (SRS)'; }
  getIcon(): string { return 'layers'; }

  async onOpen(): Promise<void> { this.render(); }
  async onClose(): Promise<void> { this.stopAudio(); }

  /** the reviewable slice of the catalog. */
  private deck(): PatternEntry[] {
    return this.deps.patterns().filter(isReviewable);
  }

  private stopAudio(): void {
    if (this.audio) { this.audio.pause(); this.audio.src = ''; this.audio = null; }
  }

  refresh(): void { if (!this.session) this.render(); }

  /**
   * Start a session over exactly these pattern ids — the cards a pipeline run
   * just created — skipping the home screen. Non-reviewable ids are dropped.
   */
  reviewSpecific(ids: string[]): void {
    const set = new Set(ids);
    const queue = this.deck().filter((p) => set.has(p.id)).map((p) => p.id);
    this.stopAudio();
    if (!queue.length) {
      this.session = null;
      new Notice('この回に復習できるカードがありませんでした', 5000);
      this.render();
      return;
    }
    this.session = { queue, pos: 0, graded: 0, again: 0, startedFresh: 0 };
    this.revealed = false;
    this.render();
  }

  // ── top-level render router ──
  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('jp-srs-view');
    if (this.session) this.renderCard(root);
    else this.renderHome(root);
  }

  // ── home / deck overview ──
  private renderHome(root: HTMLElement): void {
    const deck = this.deck();
    const ids = deck.map((p) => p.id);
    const counts = this.deps.srs.counts(ids);

    const wrap = root.createDiv('jp-srs-home');
    wrap.createEl('h2', { text: '復習', cls: 'jp-srs-home-title' });

    // §23.5 keyboard hand on the home screen: l = revive leeches
    root.tabIndex = -1;
    root.focus();
    root.onkeydown = (e) => {
      if (e.key.toLowerCase() === 'l' && counts.leech > 0 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        void this.deps.srs.reviveLeeches(ids).then((n) => { if (n > 0) this.render(); });
      }
    };

    const c = wrap.createDiv('jp-srs-counts');
    const pill = (n: number, label: string, cls: string) => {
      const el = c.createDiv(`jp-srs-count ${cls}`);
      el.createDiv({ text: String(n), cls: 'jp-srs-count-n' });
      el.createDiv({ text: label, cls: 'jp-srs-count-label' });
    };
    pill(counts.learn, '学習中', 'jp-srs-count--learn');
    pill(counts.due, '復習', 'jp-srs-count--due');
    pill(counts.fresh, '新規', 'jp-srs-count--new');
    if (counts.leech > 0) {
      // leeches are suspended: the card needs a rewrite, not more failed reps.
      // 🏷️ reclassify / edit it in the 語彙 detail, then revive here.
      const el = c.createDiv('jp-srs-count jp-srs-count--leech');
      el.createDiv({ text: String(counts.leech), cls: 'jp-srs-count-n' });
      el.createDiv({ text: '🛑 リーチ', cls: 'jp-srs-count-label' });
      const kbd = el.createDiv({ cls: 'jp-srs-count-key' });
      kbd.createEl('kbd', { text: 'l' });
      kbd.createSpan({ text: ' 復帰' });
      el.setAttribute('aria-label', '何度も忘れるカード（休止中）。書き直してからタップ（キー: l）で復帰。');
      el.style.cursor = 'pointer';
      el.onclick = async () => {
        const ids = this.deck().map((p) => p.id);
        const n = await this.deps.srs.reviveLeeches(ids);
        if (n > 0) this.render();
      };
    }

    const total = counts.learn + counts.due + Math.min(counts.fresh, this.deps.newPerSession());
    if (deck.length === 0) {
      wrap.createEl('p', { text: 'まだ復習できるパターンがありません。台帳にパターンを貯めてください（⚡ 照合・🏷️ 分類キャプチャ・𝕏 保存）。', cls: 'jp-srs-empty' });
      return;
    }
    if (total === 0) {
      wrap.createEl('p', { text: '🎉 今日の分は完了しました。あとで新しいカードが期日を迎えます。', cls: 'jp-srs-empty' });
      // still allow an ad-hoc study-ahead
      const ahead = wrap.createEl('button', { text: '先取り学習（期日前も含める）', cls: 'jp-srs-btn' });
      ahead.onclick = () => this.startSession(true);
      this.renderClassBreakdown(wrap, deck);
      return;
    }

    const start = wrap.createEl('button', { text: `${total}枚を復習する`, cls: 'jp-srs-btn jp-srs-btn--cta' });
    start.onclick = () => this.startSession(false);
    this.renderClassBreakdown(wrap, deck);
  }

  private renderClassBreakdown(wrap: HTMLElement, deck: PatternEntry[]): void {
    const byClass = new Map<NoteClass, number>();
    for (const p of deck) byClass.set(p.class, (byClass.get(p.class) ?? 0) + 1);
    const row = wrap.createDiv('jp-srs-breakdown');
    row.createSpan({ text: `デッキ ${deck.length}枚 — `, cls: 'jp-srs-breakdown-label' });
    for (const [cls, n] of byClass) {
      const def = NOTE_TYPES[cls];
      const chip = row.createSpan({ text: `${def.emoji} ${n}`, cls: 'jp-srs-breakdown-chip' });
      chip.style.borderColor = def.color;
    }
  }

  private startSession(studyAhead: boolean): void {
    const deck = this.deck();
    const ids = deck.map((p) => p.id);
    let queue: string[];
    if (studyAhead) {
      // everything, soonest-due first, capped generously
      queue = [...ids].sort((a, b) => (this.deps.srs.stateOf(a)?.dueMs ?? 0) - (this.deps.srs.stateOf(b)?.dueMs ?? 0)).slice(0, 60);
    } else {
      queue = this.deps.srs.buildQueue(ids, Date.now(), this.deps.newPerSession());
    }
    if (queue.length === 0) { new Notice('復習するカードがありません'); return; }
    this.session = { queue, pos: 0, graded: 0, again: 0, startedFresh: 0 };
    this.revealed = false;
    this.render();
  }

  // ── the active card ──
  private currentPattern(): PatternEntry | null {
    if (!this.session) return null;
    const id = this.session.queue[this.session.pos];
    return this.deps.patterns().find((p) => p.id === id) ?? null;
  }

  private renderCard(root: HTMLElement): void {
    const sess = this.session!;
    const p = this.currentPattern();
    if (!p) {                       // pattern vanished mid-session (deleted) → skip
      this.advance(false);
      return;
    }
    const card = buildReviewCard(p, this.deps.goldFor(p.id));
    const def = NOTE_TYPES[p.class];

    // progress bar
    const bar = root.createDiv('jp-srs-progress');
    const done = sess.pos;
    bar.createDiv('jp-srs-progress-fill').style.width = `${(done / sess.queue.length) * 100}%`;

    const head = root.createDiv('jp-srs-card-head');
    const badge = head.createSpan({ text: `${def.emoji} ${card.drill}`, cls: 'jp-srs-drill' });
    badge.style.borderColor = def.color;
    head.createSpan({ text: `${done + 1} / ${sess.queue.length}`, cls: 'jp-srs-pos' });
    const end = head.createEl('button', { text: '✕ 終了', cls: 'jp-srs-end' });
    end.onclick = () => { this.endSession(); };

    const cardEl = root.createDiv('jp-srs-card');
    cardEl.style.borderTopColor = def.color;

    // ── FRONT ──
    const front = cardEl.createDiv('jp-srs-face jp-srs-front');
    for (const line of card.frontLines) {
      front.createDiv({ text: line, cls: 'jp-srs-line' });
    }

    // audio-first serifu: an autoplay attempt + a manual play button
    if (card.wantsAudio && card.att) {
      const audioRow = front.createDiv('jp-srs-audio-row');
      const playBtn = audioRow.createEl('button', { text: '🎧 再生', cls: 'jp-srs-audio-btn' });
      playBtn.onclick = (e) => { e.stopPropagation(); void this.playClip(card.att!, playBtn); };
      // try to auto-play on show (browsers may block until a gesture — the
      // button is the fallback, never a dead end)
      void this.playClip(card.att, playBtn, true);
    }

    if (!this.revealed) {
      const show = cardEl.createEl('button', { text: '答えを表示 (Space)', cls: 'jp-srs-btn jp-srs-reveal' });
      show.onclick = () => { this.revealed = true; this.render(); };
      // touch: the whole card is the reveal target (thumbs don't aim)
      cardEl.onclick = () => { if (!this.revealed) { this.revealed = true; this.render(); } };
      this.installKeys(cardEl, card);
      return;
    }

    // ── BACK ──
    const back = cardEl.createDiv('jp-srs-face jp-srs-back');
    back.createDiv({ text: card.answer, cls: 'jp-srs-answer' });
    for (let i = 0; i < card.backLines.length; i++) {
      const line = card.backLines[i];
      if (i === 0 && this.stripBold(line) === card.answer) continue; // don't repeat the answer
      back.createDiv({ text: line, cls: 'jp-srs-back-line' });
    }

    // source jump + audio on the back too
    if (card.att) {
      const srcRow = back.createDiv('jp-srs-source-row');
      const label = this.attLabel(card.att);
      const jump = srcRow.createEl('a', { text: `↪ ${label}`, cls: 'jp-srs-source-link' });
      jump.onclick = () => void this.deps.openAttestation(card.att!).catch((e) => new Notice(String(e)));
      if (card.att.source === 'yt' && card.att.tStartSec != null) {
        const play = srcRow.createEl('button', { text: '🎧', cls: 'jp-srs-audio-btn' });
        play.onclick = () => void this.playClip(card.att!, play);
      }
    }

    // ── grade buttons with interval previews ──
    const prev = this.deps.srs.stateOf(p.id);
    const state: CardState = prev ?? { state: 'new', dueMs: Date.now(), intervalDays: 0, ease: 2500, reps: 0, lapses: 0, stepIndex: 0 };
    const previews = previewIntervals(state, Date.now());
    const grades = cardEl.createDiv('jp-srs-grades');
    const gradeDefs: Array<{ g: Grade; label: string; cls: string }> = [
      { g: 1, label: 'もう一度', cls: 'jp-srs-grade--again' },
      { g: 2, label: '難しい', cls: 'jp-srs-grade--hard' },
      { g: 3, label: '普通', cls: 'jp-srs-grade--good' },
      { g: 4, label: '簡単', cls: 'jp-srs-grade--easy' },
    ];
    for (const gd of gradeDefs) {
      const b = grades.createEl('button', { cls: `jp-srs-grade ${gd.cls}` });
      b.createDiv({ text: gd.label, cls: 'jp-srs-grade-label' });
      b.createDiv({ text: previews[gd.g], cls: 'jp-srs-grade-ivl' });
      b.onclick = () => void this.grade(gd.g);
    }
    this.installKeys(cardEl, card);
  }

  /** keyboard: Space reveals, 1–4 grade. */
  private installKeys(el: HTMLElement, card: ReviewCard): void {
    el.tabIndex = -1;
    el.focus();
    el.onkeydown = (e) => {
      if (e.key === ' ') { e.preventDefault(); if (!this.revealed) { this.revealed = true; this.render(); } }
      else if (this.revealed && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        void this.grade(Number(e.key) as Grade);
      }
    };
  }

  private async grade(g: Grade): Promise<void> {
    const p = this.currentPattern();
    if (!p) { this.advance(false); return; }
    await this.deps.srs.review(p.id, g);
    this.session!.graded++;
    if (g === 1) this.session!.again++;
    this.advance(true);
  }

  private advance(_graded: boolean): void {
    this.stopAudio();
    const sess = this.session!;
    sess.pos++;
    this.revealed = false;
    if (sess.pos >= sess.queue.length) { this.endSession(true); return; }
    this.render();
  }

  private endSession(completed = false): void {
    const sess = this.session;
    this.session = null;
    this.stopAudio();
    this.render();
    if (sess && sess.graded > 0) {
      new Notice(completed
        ? `✅ セッション完了 — ${sess.graded}枚（もう一度 ${sess.again}）`
        : `中断 — ${sess.graded}枚を採点`, 5000);
    }
  }

  // ── audio ──
  private async playClip(att: Attestation, btn: HTMLButtonElement, silentFail = false): Promise<void> {
    const clip = await this.deps.resolveClip(att);
    if (!clip) {
      if (!silentFail) new Notice('音声クリップが未取得です（Download Audio Clips を実行）', 5000);
      return;
    }
    this.stopAudio();
    this.audio = new Audio(clip.src);
    btn.setText('⏸');
    this.audio.onended = () => btn.setText('🎧 再生');
    this.audio.play().catch(() => { if (!silentFail) new Notice('再生に失敗しました'); });
  }

  private stripBold(s: string): string { return s.replace(/\*\*/g, ''); }

  private attLabel(att: Attestation): string {
    if (att.source === 'x') return '𝕏 ツイート';
    if (att.source === 'web') return '🌐 ' + ((att.file ?? '').replace(/^https?:\/\//, '').split('/')[0] || 'ウェブ');
    const base = (att.file ?? '').split('/').pop()?.replace(/\.md$/, '') ?? att.source;
    const t = att.tStartSec != null ? ` ${Math.floor(att.tStartSec / 60)}:${String(att.tStartSec % 60).padStart(2, '0')}` : '';
    return base.slice(0, 28) + t;
  }
}
