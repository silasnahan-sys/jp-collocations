/**
 * CaptureModal — the universal capture surface (DESIGN §13).
 *
 * One modal, reachable from every text surface (tweet card, dictionary entry,
 * editor selection, transcript line): takes a span + its real context, lets
 * the user file it under one of the six classes (suggestion pre-selected,
 * never auto-committed), shapes the payload per class, and writes ONE
 * destination — the PatternStore catalog. Supersedes the old
 * ClassifyModal/TextClassifier flow, which routed to the legacy store with
 * guessed POS fields.
 *
 * For 🔴 discourse the modal grows the SKELETON section: the surrounding
 * turns, the current parser's suggested act/edge (frozen), and the user's
 * ratified act/edge — saved as a GoldExample. Every ratification is a labeled
 * training datum; every override is a parser bug report. This is the loop by
 * which use of the plugin builds the plugin.
 */

import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import { NOTE_TYPES, NOTE_CLASSES, type NoteClass } from '../notes/note-types.ts';
import { classChips, CLASS_HINTS } from './class-grammar.ts';
import { derivePattern, type PatternEntry, type Attestation } from '../notes/pattern-store.ts';
import { TokenCanvas } from './TokenCanvas.ts';
import { splitPatternParts } from '../notes/pipeline.ts';
import { KNOWN_ACTS, EDGE_KINDS, type GoldExample, type GoldEdge, type GoldSource } from '../notes/discourse-gold.ts';
import { analyzeCrossTurn } from '../discourse/relational';


export interface CaptureContext {
  /** the selected span — becomes the catalog note/notation (editable). */
  text: string;
  /** the full sentence/tweet/turn the span came from. */
  example?: string;
  /** prior turns, oldest → nearest (transcript-rich captures). */
  contextBefore?: string[];
  contextAfter?: string[];
  /** aligned with [...contextBefore, utterance, ...contextAfter]. */
  speakers?: (string | null)[];
  source: GoldSource;
}

export interface CaptureDeps {
  recordClassified: (opts: {
    note: string;
    cls: NoteClass;
    suggested?: NoteClass;
    payload?: PatternEntry['payload'];
    att: Attestation | null;
  }) => Promise<PatternEntry>;
  addGold?: (g: Omit<GoldExample, 'id'>) => Promise<GoldExample>;
  onSaved?: () => void;
  /** §21: the calibrated class-suggester (structural signals + the user's
   *  own suggested-vs-chosen record). Ranked; [0] is preselected. Absent →
   *  notation-only derivePattern fallback. */
  suggestClass?: (note: string) => Array<{ cls: NoteClass; score: number; why: string[] }>;
  /** §22.4 TokenCanvas: dictionary probe for token validation. */
  canvasProbe?: (s: string) => boolean;
  /** §22.4 pentimento: faint span suggestions over the example text. */
  spanSuggestions?: (text: string) => Array<{ start: number; end: number; label: string }>;
}

export class CaptureModal extends Modal {
  private cls: NoteClass;
  private readonly suggested: NoteClass;
  private noteInput!: HTMLInputElement;
  private payloadEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private saveRowEl!: HTMLElement;

  // payload state (kept across class switches so exploring lenses is cheap)
  private parts: string;
  private frame: string;
  private lemma = '';
  private halo = '';
  private gloss = '';

  // discourse skeleton state
  private act = 'INFORM';
  private edgeKind = '';               // '' = no edge
  private edgeTarget = 1;              // turns back
  private goldNote = '';
  private suggestedAct?: string;
  private suggestedEdge: GoldEdge | null = null;

  constructor(app: App, private ctx: CaptureContext, private deps: CaptureDeps) {
    super(app);
    const d = derivePattern(ctx.text);
    // calibrated suggester when wired; notation-derivation as the floor.
    // Whatever is preselected is RECORDED as classSuggested — every override
    // is the next training example (the loop that improves this).
    const top = deps.suggestClass?.(ctx.text)?.[0];
    this.suggested = top && top.score > 0 ? top.cls : d.suggestedClass;
    this.cls = this.suggested;
    const p = splitPatternParts(ctx.text);
    this.parts = p.length >= 2 ? p.join(' 〜 ') : '';
    this.frame = /[○〇]{2}/.test(ctx.text) ? ctx.text : '';

    // Run the current parser over the real context ONCE — its output is
    // frozen into the gold example whatever the user decides.
    const utterance = ctx.example ?? ctx.text;
    if (utterance) {
      const turnsIn = [
        ...(ctx.contextBefore ?? []),
        utterance,
        ...(ctx.contextAfter ?? []),
      ].map((text, i) => ({ text, speaker: ctx.speakers?.[i] ?? null }));
      try {
        const turns = analyzeCrossTurn(turnsIn);
        const me = turns[ctx.contextBefore?.length ?? 0];
        if (me) {
          this.suggestedAct = me.act;
          this.act = me.act;
          const e = me.edges[0];
          this.suggestedEdge = e ? { kind: e.kind, toOffset: me.idx - e.to } : null;
          if (e) { this.edgeKind = e.kind; this.edgeTarget = me.idx - e.to; }
        }
      } catch { /* parser failure must never block capture */ }
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('jp-capture-modal');
    contentEl.createEl('h2', { text: '🏷️ 分類して台帳へ' });

    // ── the span (editable notation) ──
    const noteRow = contentEl.createDiv('jp-capture-field');
    noteRow.createSpan({ text: '見出し・記法', cls: 'jp-capture-label' });
    this.noteInput = noteRow.createEl('input', {
      type: 'text', cls: 'jp-capture-input',
      attr: { autocapitalize: 'off', spellcheck: 'false' },
    });
    this.noteInput.value = this.ctx.text;

    // ── class chips (built before the canvas so it can drive selection) ──
    // The control itself is the SHARED one (class-grammar.ts) — the same chips
    // the library, catalog and lexicon panel use. Only the placement differs.
    let chipHandle: { set: (c: NoteClass) => void } | null = null;
    const selectClass = (c: NoteClass): void => {
      this.cls = c;
      chipHandle?.set(c);
      this.hintEl.setText(CLASS_HINTS[c]);
      this.renderPayload();
    };

    // ── the example, as a manipulable TokenCanvas (§22.4): tap=部品,
    // drag=範囲, 長押しドラッグ=取り消し線(スロット), ダブルタップ=◯ ──
    const exampleText = this.ctx.example ?? this.ctx.text;
    if (exampleText && exampleText.length >= 4) {
      const wrap = contentEl.createDiv('jp-capture-canvaswrap');
      wrap.createSpan({ text: '出典（マークで分類 — タップ=部品 / ドラッグ=範囲 / 長押しドラッグ=スロット / 2回タップ=軸）', cls: 'jp-capture-example-label' });
      new TokenCanvas({
        text: exampleText,
        probe: this.deps.canvasProbe,
        suggestions: this.deps.spanSuggestions?.(exampleText) ?? [],
        onChange: (d) => {
          if (d.note) this.noteInput.value = d.note;
          if (d.payload.parts) this.parts = d.payload.parts.join(' 〜 ');
          if (d.payload.frame) this.frame = d.payload.frame;
          if (d.payload.lemma) this.lemma = d.payload.lemma;
          if (d.payload.halo) this.halo = d.payload.halo;
          if (d.cls) selectClass(d.cls);
          else this.renderPayload();
        },
      }).render(wrap);
    }

    chipHandle = classChips(contentEl, {
      value: this.cls,
      suggested: this.suggested,
      keys: true,
      onPick: (c) => selectClass(c),
    });
    this.hintEl = contentEl.createDiv('jp-capture-hint');
    this.hintEl.setText(CLASS_HINTS[this.cls]);

    // §23.5 ergonomics: the capture modal is the hot path from EVERY medium.
    // 1–6 = class (matching chip order), Ctrl/Cmd+Enter = save, Esc closes
    // as always. Digits are ignored while typing in a field.
    contentEl.addEventListener('keydown', (e) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void this.save(true);
        return;
      }
      if (typing) return;
      const n = Number(e.key);
      if (n >= 1 && n <= NOTE_CLASSES.length) {
        e.preventDefault();
        selectClass(NOTE_CLASSES[n - 1]);
      }
    });

    // ── per-class payload ──
    this.payloadEl = contentEl.createDiv('jp-capture-payload');
    this.renderPayload();

    // ── buttons ──
    this.saveRowEl = contentEl.createDiv('jp-capture-btnrow');
    this.renderButtons();
  }

  private field(parent: HTMLElement, label: string, value: string, placeholder: string, onInput: (v: string) => void): HTMLInputElement {
    const row = parent.createDiv('jp-capture-field');
    row.createSpan({ text: label, cls: 'jp-capture-label' });
    const input = row.createEl('input', {
      type: 'text', cls: 'jp-capture-input',
      attr: { placeholder, autocapitalize: 'off', spellcheck: 'false' },
    });
    input.value = value;
    input.addEventListener('input', () => onInput(input.value));
    return input;
  }

  private renderPayload(): void {
    const el = this.payloadEl;
    el.empty();
    switch (this.cls) {
      case 'skeletal':
        this.field(el, '成分リンク', this.parts, '例: んだったら 〜 なきゃ', (v) => { this.parts = v; });
        break;
      case 'phrase_schema':
        if (!this.frame) this.frame = this.ctx.text;
        this.field(el, '型（○○=スロット）', this.frame, '例: 「○○」というところで納得している', (v) => { this.frame = v; });
        break;
      case 'rhet_collocation':
        this.field(el, 'レンマ（喚起語）', this.lemma, '例: 破綻', (v) => { this.lemma = v; });
        this.field(el, 'ハロー（周辺の言い回し）', this.halo, '例: 〜として破綻している', (v) => { this.halo = v; });
        break;
      case 'collocation':
        this.field(el, '成分（任意）', this.parts, '例: 材質 〜 違う', (v) => { this.parts = v; });
        break;
      case 'discourse':
        this.renderSkeleton(el);
        break;
      // serifu: the surface IS the payload
    }
    if (this.cls !== 'discourse') {
      this.field(el, 'この表現がすること（任意）', this.gloss, '例: 反実仮想へ視点を移す', (v) => { this.gloss = v; });
    }
  }

  /** 🔴: the responsivity skeleton — turns, act, edge — pre-filled by the parser. */
  private renderSkeleton(el: HTMLElement): void {
    const before = this.ctx.contextBefore ?? [];
    const after = this.ctx.contextAfter ?? [];
    const utterance = this.ctx.example ?? this.ctx.text;

    const turnsEl = el.createDiv('jp-capture-turns');
    const mkTurn = (text: string, offsetBack: number | null, cls: string) => {
      const row = turnsEl.createDiv(`jp-capture-turn ${cls}`);
      if (offsetBack != null) {
        row.createSpan({ text: `−${offsetBack} `, cls: 'jp-capture-turn-idx' });
        row.style.cursor = 'pointer';
        row.title = 'クリックで「この発話に応じている」に設定';
        row.addEventListener('click', () => {
          this.edgeTarget = offsetBack;
          if (!this.edgeKind) this.edgeKind = 'answers';
          this.renderPayload();
        });
        if (this.edgeKind && this.edgeTarget === offsetBack) row.addClass('jp-capture-turn--target');
      }
      row.createSpan({ text: text.length > 90 ? text.slice(0, 90) + '…' : text });
    };
    before.forEach((t, i) => mkTurn(t, before.length - i, 'jp-capture-turn--prior'));
    mkTurn(`▶ ${utterance}`, null, 'jp-capture-turn--me');
    after.forEach((t) => mkTurn(t, null, 'jp-capture-turn--after'));
    if (!before.length && !after.length) {
      turnsEl.createDiv({ text: '（前後の発話なし — 単独発話として記録されます）', cls: 'jp-capture-turn--none' });
    }

    // act picker (parser suggestion marked, free input allowed)
    const actRow = el.createDiv('jp-capture-field');
    actRow.createSpan({ text: '談話ムーブ', cls: 'jp-capture-label' });
    const actSel = actRow.createEl('select', { cls: 'jp-capture-select' });
    const acts: string[] = [...KNOWN_ACTS];
    if (this.act && !acts.includes(this.act)) acts.push(this.act);
    for (const a of acts) {
      const opt = actSel.createEl('option', {
        text: a === this.suggestedAct ? `${a}（パーサ提案）` : a,
        value: a,
      });
      if (a === this.act) opt.selected = true;
    }
    actSel.createEl('option', { text: 'その他（自由入力）…', value: '__other__' });
    const freeInput = actRow.createEl('input', {
      type: 'text', cls: 'jp-capture-input',
      attr: { placeholder: '新しいムーブ名', autocapitalize: 'off', spellcheck: 'false' },
    });
    freeInput.style.display = 'none';
    actSel.addEventListener('change', () => {
      if (actSel.value === '__other__') {
        freeInput.style.display = '';
        freeInput.focus();
      } else {
        freeInput.style.display = 'none';
        this.act = actSel.value;
      }
    });
    freeInput.addEventListener('input', () => { this.act = freeInput.value.trim() || 'INFORM'; });

    // edge picker (only meaningful with prior turns)
    if (before.length > 0) {
      const edgeRow = el.createDiv('jp-capture-field');
      edgeRow.createSpan({ text: '関係', cls: 'jp-capture-label' });
      const edgeSel = edgeRow.createEl('select', { cls: 'jp-capture-select' });
      const none = edgeSel.createEl('option', { text: '（なし）', value: '' });
      if (!this.edgeKind) none.selected = true;
      for (const k of EDGE_KINDS) {
        const label = this.suggestedEdge?.kind === k ? `${k}（パーサ提案）` : k;
        const opt = edgeSel.createEl('option', { text: label, value: k });
        if (k === this.edgeKind) opt.selected = true;
      }
      edgeSel.addEventListener('change', () => { this.edgeKind = edgeSel.value; });
      edgeRow.createSpan({
        text: `対象: ${this.edgeKind ? `−${this.edgeTarget}` : '—'}（上の発話をクリックで変更）`,
        cls: 'jp-capture-edge-target',
      });
    }

    // the user's observation
    const noteRow = el.createDiv('jp-capture-field');
    noteRow.createSpan({ text: '気づき（任意）', cls: 'jp-capture-label' });
    const ta = noteRow.createEl('textarea', { cls: 'jp-capture-textarea', attr: { rows: '2' } });
    ta.value = this.goldNote;
    ta.addEventListener('input', () => { this.goldNote = ta.value; });
  }

  private renderButtons(): void {
    const row = this.saveRowEl;
    row.empty();
    row.createEl('button', { text: 'キャンセル', cls: 'jp-capture-btn' })
      .addEventListener('click', () => this.close());
    const again = row.createEl('button', { text: '保存して別分類も', cls: 'jp-capture-btn' });
    again.title = '同じスパンを別のレンズ（分類）でも保存できます（多重分類OK — perspectival）';
    again.addEventListener('click', () => void this.save(false));
    const save = row.createEl('button', { text: '保存', cls: 'jp-capture-btn jp-capture-btn--cta' });
    save.addEventListener('click', () => void this.save(true));
  }

  private buildAttestation(quote: string): Attestation {
    const s = this.ctx.source;
    // §22 scene passthrough: medium + address ride on the attestation so the
    // context renderer can re-manifest the scene medium-natively.
    const scene = (s.sourceName || s.loc || s.image || (s.url && s.medium))
      ? {
        ...(s.sourceName ? { sourceName: s.sourceName } : {}),
        ...(s.loc ? { loc: s.loc } : {}),
        ...(s.url ? { deepLink: s.url } : {}),
        ...(s.image ? { image: s.image } : {}),
        ...(s.bbox ? { bbox: s.bbox } : {}),
      }
      : undefined;
    const base = {
      quote, addedAt: Date.now(), tStartSec: s.tStartSec ?? null,
      ...(s.medium ? { medium: s.medium } : {}),
      ...(scene ? { scene } : {}),
    };
    if (s.kind === 'yt' && s.file) return { source: 'yt', file: s.file, ...base };
    if (s.kind === 'x' && (s.url || s.file)) return { source: 'x', file: s.url ?? s.file, ...base };
    if (s.kind === 'web' && (s.url || s.file)) return { source: 'web', file: s.url ?? s.file, ...base };
    return { source: 'manual', file: s.file ?? s.url, ...base };
  }

  private async save(closeAfter: boolean): Promise<void> {
    const note = this.noteInput.value.trim();
    if (!note) { new Notice('見出しを入力してください'); return; }

    const payload: PatternEntry['payload'] = {};
    const parts = this.parts.split(/\s*[〜~,、]\s*/).map((p) => p.trim()).filter((p) => p.length > 0);
    if ((this.cls === 'skeletal' || this.cls === 'collocation') && parts.length >= 2) payload.parts = parts;
    if (this.cls === 'phrase_schema' && this.frame.trim()) payload.frame = this.frame.trim();
    if (this.cls === 'rhet_collocation') {
      if (this.lemma.trim()) payload.lemma = this.lemma.trim();
      if (this.halo.trim()) payload.halo = this.halo.trim();
    }
    if (this.gloss.trim()) payload.gloss = this.gloss.trim();

    try {
      const entry = await this.deps.recordClassified({
        note,
        cls: this.cls,
        suggested: this.suggested,
        payload,
        att: this.buildAttestation(this.ctx.example ?? note),
      });

      if (this.cls === 'discourse' && this.deps.addGold) {
        const edge: GoldEdge | null = this.edgeKind
          ? { kind: this.edgeKind as GoldEdge['kind'], toOffset: this.edgeTarget }
          : null;
        await this.deps.addGold({
          utterance: this.ctx.example ?? note,
          contextBefore: this.ctx.contextBefore ?? [],
          contextAfter: this.ctx.contextAfter ?? [],
          speakers: this.ctx.speakers,
          suggestedAct: this.suggestedAct,
          suggestedEdge: this.suggestedEdge,
          act: this.act,
          edge,
          note: this.goldNote.trim() || undefined,
          patternId: entry.id,
          source: this.ctx.source,
          addedAt: Date.now(),
        });
      }

      const def = NOTE_TYPES[this.cls];
      new Notice(`${def.emoji} ${def.label} として台帳に記録: ${entry.key}`);
      this.deps.onSaved?.();
      if (closeAfter) this.close();
    } catch (e) {
      new Notice(`保存に失敗: ${(e as Error).message}`, 6000);
    }
  }

  onClose(): void { this.contentEl.empty(); }
}
