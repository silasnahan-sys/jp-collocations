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
import type { ClassEvidence, ClassSignal } from '../notes/class-suggester.ts';
import { classChips, CLASS_HINTS } from './class-grammar.ts';
import { derivePattern, type PatternEntry, type Attestation } from '../notes/pattern-store.ts';
import { TokenCanvas } from './TokenCanvas.ts';
import { bundleFromCanvas, bundleRecords } from '../notes/capture-bundle.ts';
import type { Bundle } from '../notes/analysis-bundle.ts';
import { splitPatternParts } from '../notes/pipeline.ts';
import { KNOWN_ACTS, EDGE_KINDS, type GoldExample, type GoldEdge, type GoldSource } from '../notes/discourse-gold.ts';
import { analyzeCrossTurn } from '../discourse/relational';


export interface CaptureContext {
  /** the selected span — becomes the catalog note/notation (editable). */
  text: string;
  /**
   * A class the CALLER already has shape evidence for — currently the curated
   * reach-for candidates, whose frame shape yields a hint (§27.3). Preselects
   * the chip and is recorded as `classSuggested`, exactly like the notation-
   * derived and calibrated guesses: a suggestion, never a verdict.
   */
  classHint?: NoteClass;
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
  /** Fired after the entry is in the catalog. Receives the entry so the host
   *  can act on THIS one — the auto-sweep (main.ts) needs it to go looking for
   *  where else this phrase has already been heard. */
  onSaved?: (entry: PatternEntry) => void;
  /** §21: the calibrated class-suggester (structural signals + the user's
   *  own suggested-vs-chosen record). Takes the full EVIDENCE — span, example,
   *  prior-turn presence, medium — because three of the six classes are
   *  defined relationally and the bare string cannot witness a relation.
   *  Ranked; [0] is preselected. Absent → notation-only derivePattern
   *  fallback. */
  suggestClass?: (ev: ClassEvidence) => ClassSignal[];
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

  // layered-bundle state (capture-bundle.ts): the canvas, read whole at save
  private canvas: TokenCanvas | null = null;
  private canvasText = '';
  private layersEl: HTMLElement | null = null;

  // The hand owns what the hand typed: once the user edits 見出し, canvas
  // derivations stop overwriting it (the five-clobber war, IMG_1082/1083).
  private noteEdited = false;
  // One tap = one entry. A second tap while a save is in flight is a REPEAT
  // (the feedback was missed), never a request for a duplicate.
  private saving = false;

  // the full ranking + the reason line shown under the chips — a suggestion
  // whose why is hidden costs a re-derivation on every capture (§21: every
  // offer carries its own skeletal reason).
  private ranking: ClassSignal[] = [];
  private suggestWhy = '';
  private whyEl: HTMLElement | null = null;

  constructor(app: App, private ctx: CaptureContext, private deps: CaptureDeps) {
    super(app);
    const d = derivePattern(ctx.text);
    // calibrated suggester when wired; notation-derivation as the floor.
    // Whatever is preselected is RECORDED as classSuggested — every override
    // is the next training example (the loop that improves this).
    this.ranking = deps.suggestClass?.({
      note: ctx.text,
      example: ctx.example,
      hasPriorTurns: (ctx.contextBefore?.length ?? 0) > 0,
      medium: ctx.source.medium,
    }) ?? [];
    const top = this.ranking[0];
    // An explicit caller hint (a curated candidate's frame shape) outranks bare
    // notation derivation, but the calibrated suggester still wins when it has
    // real confidence — it is the one that learns from the user's overrides.
    this.suggested = top && top.score > 0 ? top.cls : (ctx.classHint ?? d.suggestedClass);
    this.cls = this.suggested;
    if (top && top.score > 0) {
      this.suggestWhy = top.why.join('・');
      const alt = this.ranking[1];
      if (alt && alt.score > 0 && alt.why.length) {
        this.suggestWhy += ` ／ 次点 ${NOTE_TYPES[alt.cls].emoji} ${alt.why[0]}`;
      }
    } else if (ctx.classHint) {
      this.suggestWhy = '呼び出し元の型ヒント';
    } else {
      this.suggestWhy = d.keyKind === 'link' ? '〜記法（部品リンク）'
        : d.keyKind === 'frame' ? '○○スロット記法'
        : '記法・構造の手がかりなし — 手で選んでください';
    }
    const p = splitPatternParts(ctx.text);
    this.parts = p.length >= 2 ? p.join(' 〜 ') : '';
    this.frame = /[○〇]{2}/.test(ctx.text) ? ctx.text : '';

    // Run the current parser over the real context ONCE — its output is
    // frozen into the gold example whatever the user decides. Curated text
    // (medium 'dict') is nobody's utterance — running a discourse parser over
    // dictionary apparatus is how INFORM（パーサ提案） got filmed on a gloss.
    const utterance = ctx.source.medium === 'dict' ? '' : ctx.example ?? ctx.text;
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
    // typed by the hand ⇒ owned by the hand (see noteEdited)
    this.noteInput.addEventListener('input', () => { this.noteEdited = true; });

    // ── class chips + the suggestion's WHY, ABOVE the canvas ──
    // Two reasons for the placement, both filmed (IMG_1067): the class choice
    // is the decision the modal exists for, so it must sit in the top third
    // where the iPad keyboard + the Apple Intelligence bar cannot cover it;
    // and a suggestion without its reason cannot be trusted at a glance, so
    // the why line rides directly under the chips.
    // The control itself is the SHARED one (class-grammar.ts) — the same chips
    // the library, catalog and lexicon panel use. Only the placement differs.
    let chipHandle: { set: (c: NoteClass) => void } | null = null;
    const selectClass = (c: NoteClass): void => {
      this.cls = c;
      chipHandle?.set(c);
      this.hintEl.setText(CLASS_HINTS[c]);
      this.renderPayload();
    };
    chipHandle = classChips(contentEl, {
      value: this.cls,
      suggested: this.suggested,
      keys: true,
      onPick: (c) => selectClass(c),
    });
    this.whyEl = contentEl.createDiv('jp-capture-whyrow');
    this.whyEl.setText(this.suggestWhy ? `提案の根拠: ${this.suggestWhy}` : '');
    this.hintEl = contentEl.createDiv('jp-capture-hint');
    this.hintEl.setText(CLASS_HINTS[this.cls]);

    // ── the example, as a manipulable TokenCanvas (§22.4): tap=部品,
    // drag=範囲, 長押しドラッグ=取り消し線(スロット), ダブルタップ=◯ ──
    const exampleText = this.ctx.example ?? this.ctx.text;
    if (exampleText && exampleText.length >= 4) {
      const wrap = contentEl.createDiv('jp-capture-canvaswrap');
      wrap.createSpan({ text: '出典（マークで分類 — タップ=部品 / ドラッグ=範囲 / 長押しドラッグ=スロット / 2回タップ=軸）', cls: 'jp-capture-example-label' });
      this.canvasText = exampleText;
      this.canvas = new TokenCanvas({
        text: exampleText,
        probe: this.deps.canvasProbe,
        suggestions: this.deps.spanSuggestions?.(exampleText) ?? [],
        onChange: (d) => {
          // the canvas proposes; it never overwrites what the hand typed
          if (d.note && !this.noteEdited) this.noteInput.value = d.note;
          if (d.payload.parts) this.parts = d.payload.parts.join(' 〜 ');
          if (d.payload.frame) this.frame = d.payload.frame;
          if (d.payload.lemma) this.lemma = d.payload.lemma;
          if (d.payload.halo) this.halo = d.payload.halo;
          if (d.cls) selectClass(d.cls);
          else this.renderPayload();
          this.updateLayerStrip();
        },
      });
      this.canvas.render(wrap);
      // ⿻ the lattice the marks currently derive — visible, so multi-layer
      // capture is a fact on screen, never a surprise at save.
      this.layersEl = wrap.createDiv('jp-capture-layers');
      this.updateLayerStrip();
    }

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

  /** The bundle the canvas marks currently derive — null when no canvas. */
  private currentBundle(): Bundle | null {
    if (!this.canvas || !this.canvasText) return null;
    return bundleFromCanvas(this.canvasText, this.canvas.getTokens(), this.canvas.getMarks());
  }

  private static readonly ROLE_LABEL: Record<string, string> = {
    whole: 'セリフ', frame: '型', core: '核', chunk: '塊', link: 'リンク', lemma: 'レンマ',
  };

  private updateLayerStrip(): void {
    if (!this.layersEl) return;
    const b = this.currentBundle();
    const layers = b?.layers ?? [];
    if (layers.length <= 1) { this.layersEl.setText(''); return; }
    this.layersEl.setText(
      `⿻ 導出される層 (${layers.length}): ` +
      layers.map((l) => `${NOTE_TYPES[l.cls].emoji}${CaptureModal.ROLE_LABEL[l.role] ?? l.role}`).join(' / '),
    );
  }

  private renderButtons(): void {
    const row = this.saveRowEl;
    row.empty();
    row.createEl('button', { text: 'キャンセル', cls: 'jp-capture-btn' })
      .addEventListener('click', () => this.close());
    const again = row.createEl('button', { text: '保存して別分類も', cls: 'jp-capture-btn' });
    again.title = '同じスパンを別のレンズ（分類）でも保存できます（多重分類OK — perspectival）';
    again.addEventListener('click', () => void this.save(false));
    const layers = row.createEl('button', { text: '⿻ 全層保存', cls: 'jp-capture-btn' });
    layers.title = 'マークが導出する層（丸ごと・型・核・リンク…）を、ひとつの束としてまとめて台帳へ。層がひとつなら普通の保存と同じ。';
    layers.addEventListener('click', () => void this.saveBundle());
    const save = row.createEl('button', { text: '保存', cls: 'jp-capture-btn jp-capture-btn--cta' });
    save.addEventListener('click', () => void this.save(true));
  }

  /** One save at a time: the buttons go dead while one is in flight, so a
   *  second tap (the filmed take-2, IMG_1082) cannot mint a duplicate. */
  private setButtonsBusy(busy: boolean): void {
    this.saving = busy;
    for (const b of Array.from(this.saveRowEl.querySelectorAll('button'))) b.disabled = busy;
  }

  /**
   * Feedback WHERE THE HAND IS. The Notice lands top-right — off-screen of a
   * thumb that is hovering over the save row — which is exactly how the
   * double-save war started (the first save's toast was never seen). After a
   * stay-open save the row itself says what happened.
   */
  private markSavedInPlace(cls: NoteClass): void {
    const def = NOTE_TYPES[cls];
    this.hintEl.setText(`✓ ${def.emoji} ${def.label} として記録済み — 別のレンズ（分類）を選んで再保存できます`);
    this.hintEl.addClass('jp-capture-hint--saved');
    window.setTimeout(() => this.hintEl?.removeClass('jp-capture-hint--saved'), 1600);
    // per-class residue must not leak into the next lens: the gloss typed for
    // 🟢 is not a fact about the 🔵 reading of the same span (別分類も starts
    // clean — the 1082/1083 finding). Notation (parts/frame) survives: it is
    // derived from the marks, which are still on screen.
    this.gloss = '';
    this.goldNote = '';
    this.renderPayload();
  }

  /**
   * ⿻ one sighting, many layers: every derived layer lands as its own entry
   * (shared bundleId; edges ride the L0 record), each with the SAME
   * attestation — one encounter, cut several ways. Falls back to the plain
   * save when the marks derive nothing beyond the whole.
   */
  private async saveBundle(): Promise<void> {
    if (this.saving) return;
    const b = this.currentBundle();
    const recs = b ? bundleRecords(b) : [];
    if (recs.length <= 1) { await this.save(true); return; }
    this.setButtonsBusy(true);
    try {
      const keys: string[] = [];
      for (const r of recs) {
        const entry = await this.deps.recordClassified({
          note: r.note,
          cls: r.cls,
          // each layer's class was DERIVED from the marks — that derivation is
          // the machine's suggestion for THIS layer, so the calibration record
          // reads (suggested=derived, chosen=derived), a confirmation, not a
          // phantom correction from the modal's overall preselection.
          suggested: r.cls,
          payload: r.payload,
          att: this.buildAttestation(this.ctx.example ?? r.note),
        });
        keys.push(`${NOTE_TYPES[r.cls].emoji}${entry.key}`);
        this.deps.onSaved?.(entry);
      }
      const shown = keys.join(' / ');
      new Notice(`⿻ ${recs.length}層を台帳に記録: ${shown.length > 90 ? shown.slice(0, 90) + '…' : shown}`);
      this.close();
    } catch (e) {
      new Notice(`⿻ 保存に失敗: ${(e as Error).message}`, 6000);
    } finally {
      this.setButtonsBusy(false);
    }
  }

  private buildAttestation(quote: string): Attestation {
    const s = this.ctx.source;
    // §22 scene passthrough: medium + address ride on the attestation so the
    // context renderer can re-manifest the scene medium-natively.
    const scene = (s.sourceName || s.loc || s.image || s.audio || (s.url && s.medium))
      ? {
        ...(s.sourceName ? { sourceName: s.sourceName } : {}),
        ...(s.loc ? { loc: s.loc } : {}),
        ...(s.url ? { deepLink: s.url } : {}),
        ...(s.image ? { image: s.image } : {}),
        ...(s.bbox ? { bbox: s.bbox } : {}),
        ...(s.audio ? { audio: s.audio } : {}),
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
    if (this.saving) return;
    const note = this.noteInput.value.trim();
    if (!note) { new Notice('見出しを入力してください'); return; }
    this.setButtonsBusy(true);

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
      this.deps.onSaved?.(entry);
      if (closeAfter) this.close();
      else this.markSavedInPlace(this.cls);
    } catch (e) {
      new Notice(`保存に失敗: ${(e as Error).message}`, 6000);
    } finally {
      this.setButtonsBusy(false);
    }
  }

  onClose(): void { this.contentEl.empty(); }
}
