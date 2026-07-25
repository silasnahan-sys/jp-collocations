/**
 * DiscourseModeView.ts — 談話モード (DESIGN §17, §23).
 *
 * A dedicated MODE for working a transcript as DISCOURSE: turns, speakers,
 * breaks, and pattern captures — manipulable like moving text on a page, not
 * like editing a file. Three hands, per the §23.5 ergonomics contract:
 *
 *   Pencil/touch:
 *   · tap a LINE         → toggle a turn boundary right before it
 *   · tap a SPEAKER chip → cycle A→B→C→D
 *   · tap a component pill (相槌/反応/戻り) → the §23.4-2 one-tap fix: the
 *     turn SPLITS at that sentence boundary with the CA-suggested speakers
 *   · tap 🔁 echo pill / ✍ → CaptureModal with full turn context
 *   Keyboard (hints in the header row):
 *   · j/k walk turns · a–d set speaker · s split at the suggested flip
 *   · ⏎ accept first suggestion · x reject it · e capture · m merge up
 *
 * Every manipulation is TRAINING DATA: the corrected segmentation persists
 * per file (`_discourseSeg`, now sentence-grain: boundaries are (line,char)),
 * and every component pill accept/reject lands in the layer-2 gold store
 * (§23.3) via onComponentVerdict. The discourse PARSER stays untouched; this
 * mode is how its training corpus gets built by simply using it.
 */

import { ItemView, WorkspaceLeaf, TFile, Notice, normalizePath } from "obsidian";
import type { MatcherLine } from "../notes/local-matcher.ts";
import type { CaptureContext } from "./CaptureModal";
import {
  analyzeUnits, sentenceUnitSpans, type ComponentKind,
} from "../discourse/components.ts";
import {
  type TurnRef, sanitizeTurns, sortTurns, turnLineSlices, turnTextOf,
  applyComponentSplit, flipOf, turnKey,
  type TurnRelation, type RelationType, RELATION_LABEL,
  addRelation, removeRelation, relationKey, cycleRelationType, sanitizeRelations,
  type TurnReading, type ReadingLens, READING_LENSES, LENS_LABEL,
  addReading, removeReading, sanitizeReadings,
} from "../discourse/turns.ts";

export const JP_DISCOURSE_MODE_VIEW_TYPE = "jp-discourse-mode-view";

export type TurnSeg = TurnRef;

export interface FileSeg { turns: TurnSeg[]; updatedAt: number }

/** Layer-3 gold for one file: the drawn arrows (§23.4-5). */
export interface FileRel { relations: TurnRelation[]; updatedAt: number }

/** Layer-4 gold for one file: plural lens-tagged readings per turn (§23.4-6). */
export interface FileReadings { readings: Record<string, TurnReading[]>; updatedAt: number }

/** One ratified/rejected component suggestion — layer-2 gold (§23.3). */
export interface ComponentVerdict {
  file: string;
  /** stable location: the turn's start line + char at verdict time. */
  line: number;
  char: number;
  tStartSec?: number;
  kind: ComponentKind;
  unitText: string;
  echoed?: string;
  /** connective/quotative: the detector's evidence string. */
  evidence?: string;
  verdict: "accept" | "reject";
  /** the evidence context the detector saw. */
  prevText: string;
  turnText: string;
}

export interface DiscourseModeDeps {
  transcriptFolder: () => string;
  parseLines: (md: string) => MatcherLine[];
  loadSeg: (path: string) => FileSeg | null;
  saveSeg: (path: string, seg: FileSeg) => Promise<void>;
  /** §23.4-5 layer-3 gold: the drawn arrows between turns. */
  loadRel?: (path: string) => FileRel | null;
  saveRel?: (path: string, rel: FileRel) => Promise<void>;
  /** §23.4-6 layer-4 gold: readings (human-only, plural). */
  loadReadings?: (path: string) => FileReadings | null;
  saveReadings?: (path: string, r: FileReadings) => Promise<void>;
  /** suggestion pills for one turn's text (the accurate detector — still only suggestions). */
  suggestPatterns: (text: string) => Array<{ label: string; text: string }>;
  /** open the capture modal (catalog + 🔴 gold via the normal spine). */
  openCapture: (ctx: CaptureContext) => void;
  /** §23.3 layer-2 gold: record a component pill accept/reject. */
  onComponentVerdict?: (v: ComponentVerdict) => void;
  /** previously recorded verdict for (file, key) — rejected pills stay down. */
  componentVerdictFor?: (file: string, key: string) => "accept" | "reject" | null;
}

const SPEAKERS = ["A", "B", "C", "D"];
const MERGE_GAP_SEC = 6;
const MERGE_MAX_LINES = 4;
const KIND_LABEL: Record<ComponentKind, string> = { echo: "🔁", aizuchi: "相槌", reaction: "反応", return: "戻り", connective: "接続", quotative: "引用" };
/** kinds whose accept changes turn STRUCTURE (split/relabel); the rest are ratify-only annotations. */
const SPLIT_KINDS = new Set<ComponentKind>(["aizuchi", "reaction", "return"]);

/** stable identity of one suggestion on one turn (for verdict persistence). */
export function componentKeyOf(m: { kind: ComponentKind; unitText: string }, turnStartText: string): string {
  return `${m.kind}|${m.unitText}|${turnStartText.slice(0, 12)}`;
}

interface TurnSuggestion {
  kind: ComponentKind;
  unitText: string;
  unitStart: number;
  echoed?: string;
  evidence?: string;
  key: string;
}

export class DiscourseModeView extends ItemView {
  private deps: DiscourseModeDeps;
  private file: TFile | null = null;
  private lines: MatcherLine[] = [];
  private turns: TurnRef[] = [];
  private focusTi = 0;
  /** session-rejected pill keys (persisted layer beneath via deps). */
  private rejected = new Set<string>();
  /** layer-3: the drawn arrows for the open file. */
  private relations: TurnRelation[] = [];
  /** arrow being drawn from this turn index (keyboard r / grip click); null = idle. */
  private pendingRelFrom: number | null = null;
  /** layer-4: readings per turnKey for the open file. */
  private readings: Record<string, TurnReading[]> = {};
  /** the turn whose inline reading editor is open (null = none). */
  private readingEditTi: number | null = null;
  private readingLens: ReadingLens = 'micro';

  constructor(leaf: WorkspaceLeaf, deps: DiscourseModeDeps) {
    super(leaf);
    this.deps = deps;
  }

  getViewType(): string { return JP_DISCOURSE_MODE_VIEW_TYPE; }
  getDisplayText(): string { return "談話モード"; }
  getIcon(): string { return "messages-square"; }

  async onOpen(): Promise<void> {
    this.contentEl.setAttr("tabindex", "0");
    this.registerDomEvent(this.contentEl, "keydown", (e) => this.onKey(e));
    this.render();
  }
  async onClose(): Promise<void> { /* seg saved on every change */ }

  /** Entry point: open a transcript in the mode (from command or picker). */
  async setFile(f: TFile): Promise<void> {
    const md = await this.app.vault.cachedRead(f);
    const lines = this.deps.parseLines(md).filter((l) => l.tStartSec != null);
    if (lines.length < 5) { new Notice("この文字起こしには時刻付きの行が足りません"); return; }
    this.file = f;
    this.lines = lines;
    const saved = this.deps.loadSeg(f.path);
    this.turns = saved?.turns?.length ? sanitizeTurns(saved.turns, lines) : this.initialSeg(lines);
    this.relations = sanitizeRelations(this.deps.loadRel?.(f.path)?.relations ?? [], this.turns);
    this.readings = sanitizeReadings(this.deps.loadReadings?.(f.path)?.readings ?? {}, this.turns);
    this.pendingRelFrom = null;
    this.readingEditTi = null;
    this.focusTi = 0;
    this.render();
  }

  /** Starting segmentation. Diarized transcripts (§23.4-3: `[HH:MM:SS] A: …`
   *  lines from the sherpa tier) are layer-1 TRUTH — turns follow the speaker
   *  letters exactly. Text-only transcripts keep the humble time-gap default.
   *  Either way the user's corrections are what persists. */
  private initialSeg(lines: MatcherLine[]): TurnRef[] {
    const diarized = lines.filter((l) => l.speaker).length;
    if (diarized >= Math.max(3, lines.length / 2)) {
      const turns: TurnRef[] = [];
      let cur: string | null = null;
      for (let i = 0; i < lines.length; i++) {
        const spk = lines[i].speaker ?? cur;   // unattributed lines ride the current voice
        if (i === 0 || (spk !== null && spk !== cur)) {
          turns.push({ start: i, speaker: spk ?? SPEAKERS[0] });
          cur = spk;
        }
      }
      return turns;
    }
    const turns: TurnRef[] = [];
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      const gap = i === 0 ? Infinity : (lines[i].tStartSec ?? 0) - (lines[i - 1].tStartSec ?? 0);
      if (i === 0 || gap > MERGE_GAP_SEC || count >= MERGE_MAX_LINES) {
        turns.push({ start: i, speaker: SPEAKERS[turns.length % 2] });
        count = 1;
      } else count++;
    }
    return turns;
  }

  private async persist(): Promise<void> {
    if (!this.file) return;
    await this.deps.saveSeg(this.file.path, { turns: this.turns, updatedAt: Date.now() });
  }

  private async setTurns(turns: TurnRef[]): Promise<void> {
    this.turns = sortTurns(turns);
    await this.persist();
    // arrows/readings whose endpoint turns vanished (merge) go with them
    const alive = sanitizeRelations(this.relations, this.turns);
    if (alive.length !== this.relations.length) await this.setRelations(alive);
    const aliveR = sanitizeReadings(this.readings, this.turns);
    if (Object.keys(aliveR).length !== Object.keys(this.readings).length) await this.setReadings(aliveR);
    this.render();
  }

  private async setRelations(rels: TurnRelation[]): Promise<void> {
    this.relations = rels;
    if (this.file) await this.deps.saveRel?.(this.file.path, { relations: rels, updatedAt: Date.now() });
  }

  private async setReadings(map: Record<string, TurnReading[]>): Promise<void> {
    this.readings = map;
    if (this.file) await this.deps.saveReadings?.(this.file.path, { readings: map, updatedAt: Date.now() });
  }

  // ── §23.4-5 layer-3: the arrow gesture ─────────────────────────────────────

  /** Commit an arrow fromTi → toTi (drag drop, grip click-click, or keyboard r). */
  private async commitRelation(fromTi: number, toTi: number): Promise<void> {
    this.pendingRelFrom = null;
    const from = this.turns[fromTi], to = this.turns[toTi];
    if (!from || !to) { this.render(); return; }
    const next = addRelation(this.relations, from, to, "→", Date.now());
    if (!next) { new Notice("同じターンへは引けません"); this.render(); return; }
    await this.setRelations(next);
    this.render();
  }

  private startRelation(fromTi: number): void {
    this.pendingRelFrom = fromTi;
    new Notice("矢印の相手ターンをタップ（キー: j/k で移動 → r/⏎ で確定、Esc 取消）");
    this.render();
  }

  /** The grip's Pencil/touch/mouse hand: drag onto another card commits the
   *  arrow; a plain tap arms click-click mode (tap the target card next).
   *  One pointer pipeline so a drag never double-fires as a tap. */
  private bindRelGrip(grip: HTMLElement, fromTi: number, list: HTMLElement): void {
    grip.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const pid = e.pointerId;
      const x0 = e.clientX, y0 = e.clientY;
      let dragging = false;
      try { grip.setPointerCapture(pid); } catch { /* older webview */ }
      const cardAt = (ev: PointerEvent): HTMLElement | null =>
        (document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.(".jp-dm-turn") as HTMLElement) ?? null;
      const clearOver = () => list.querySelectorAll(".jp-dm-turn--rel-over").forEach((el) => el.removeClass("jp-dm-turn--rel-over"));
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        dragging = true;
        clearOver();
        const c = cardAt(ev);
        if (c && c.getAttr("data-ti") !== String(fromTi)) c.addClass("jp-dm-turn--rel-over");
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        grip.removeEventListener("pointermove", onMove);
        grip.removeEventListener("pointerup", onUp);
        grip.removeEventListener("pointercancel", onUp);
        clearOver();
        if (!dragging) {
          // plain tap: arm (or disarm) click-click mode
          if (this.pendingRelFrom === fromTi) { this.pendingRelFrom = null; this.render(); }
          else this.startRelation(fromTi);
          return;
        }
        const c = cardAt(ev);
        const ti = c ? Number(c.getAttr("data-ti")) : NaN;
        if (Number.isFinite(ti) && ti !== fromTi) void this.commitRelation(fromTi, ti);
      };
      grip.addEventListener("pointermove", onMove);
      grip.addEventListener("pointerup", onUp);
      grip.addEventListener("pointercancel", onUp);
    });
  }

  /** Cycle the type (→/↳/↧) of the focused turn's newest outgoing arrow. */
  private async cycleFocusedRelation(): Promise<void> {
    const t = this.turns[this.focusTi];
    if (!t) return;
    const mine = this.relations.filter((r) => relationKey(r).startsWith(turnKey(t) + ">"));
    const last = mine[mine.length - 1];
    if (!last) { new Notice("このターンから出る矢印がありません（r で描画）"); return; }
    last.type = cycleRelationType(last.type);
    await this.setRelations([...this.relations]);
    this.render();
  }

  // ── gestures ───────────────────────────────────────────────────────────────

  private async toggleBoundary(lineIdx: number): Promise<void> {
    const at = this.turns.findIndex((t) => t.start === lineIdx && !(t.char ?? 0));
    if (at > 0) {
      this.turns.splice(at, 1);                       // turn-initial → merge up
    } else if (at < 0) {
      const prevTurn = [...this.turns].reverse().find((t) => t.start <= lineIdx);
      // a new break usually means a new voice — start on the other one
      this.turns.push({ start: lineIdx, speaker: flipOf(prevTurn?.speaker ?? "A") });
    } else return;                                    // line 0 — nothing above to merge into
    await this.setTurns(this.turns);
  }

  private async mergeTurn(ti: number): Promise<void> {
    if (ti <= 0 || ti >= this.turns.length) return;
    this.turns.splice(ti, 1);
    this.focusTi = Math.max(0, ti - 1);
    await this.setTurns(this.turns);
  }

  private async cycleSpeaker(turn: TurnRef): Promise<void> {
    turn.speaker = SPEAKERS[(SPEAKERS.indexOf(turn.speaker) + 1) % SPEAKERS.length];
    await this.persist();
    this.render();
  }

  private async setSpeaker(ti: number, speaker: string): Promise<void> {
    if (!this.turns[ti]) return;
    this.turns[ti].speaker = speaker;
    await this.persist();
    this.render();
  }

  // ── §23.4-2: component suggestions + the one-tap split ─────────────────────

  private turnText(ti: number): string { return turnTextOf(this.lines, this.turns, ti); }

  private suggestionsFor(ti: number): TurnSuggestion[] {
    if (!this.file) return [];
    const text = this.turnText(ti);
    const prevText = ti > 0 ? this.turnText(ti - 1) : "";
    const spans = sentenceUnitSpans(text);
    const out: TurnSuggestion[] = [];
    for (const m of analyzeUnits(prevText, text)) {
      const span = spans[m.unit];
      if (!span) continue;
      const s: TurnSuggestion = {
        kind: m.kind, unitText: span.unit, unitStart: span.start, echoed: m.echoed, evidence: m.evidence,
        key: componentKeyOf({ kind: m.kind, unitText: span.unit }, text),
      };
      const stored = this.deps.componentVerdictFor?.(this.file.path, s.key) ?? null;
      if (stored === "reject" || this.rejected.has(this.file.path + "|" + s.key)) continue;
      // an accepted flip/return whose boundary already exists needs no pill
      if (stored === "accept" && m.kind !== "echo") continue;
      out.push(s);
    }
    return out;
  }

  private recordVerdict(ti: number, s: TurnSuggestion, verdict: "accept" | "reject"): void {
    if (!this.file) return;
    const t = this.turns[ti];
    this.deps.onComponentVerdict?.({
      file: this.file.path,
      line: t.start, char: t.char ?? 0,
      tStartSec: this.lines[t.start]?.tStartSec,
      kind: s.kind, unitText: s.unitText, echoed: s.echoed, evidence: s.evidence, verdict,
      prevText: ti > 0 ? this.turnText(ti - 1) : "",
      turnText: this.turnText(ti),
    });
  }

  /** Accept a suggestion: flip/return → split with suggested speakers;
   *  echo → capture the echoed unit with full context;
   *  connective/quotative → ratify-only (gold record, no structural change). */
  private async acceptSuggestion(ti: number, s: TurnSuggestion): Promise<void> {
    this.recordVerdict(ti, s, "accept");
    if (s.kind === "echo") { this.capture(ti, s.unitText); return; }
    if (!SPLIT_KINDS.has(s.kind)) { this.render(); return; }
    const next = applyComponentSplit(this.lines, this.turns, ti, s.unitStart, s.kind as "aizuchi" | "reaction" | "return");
    if (!next) {
      // nothing structural to change (e.g. head unit already the listener's)
      new Notice("この提案は既に反映されています");
      this.render();
      return;
    }
    if (next.length > this.turns.length) this.focusTi = ti + 1;
    await this.setTurns(next);
  }

  private rejectSuggestion(ti: number, s: TurnSuggestion): void {
    if (!this.file) return;
    this.recordVerdict(ti, s, "reject");
    this.rejected.add(this.file.path + "|" + s.key);
    this.render();
  }

  // ── keyboard hand (§23.5) ──────────────────────────────────────────────────

  private onKey(e: KeyboardEvent): void {
    if (!this.file) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const go = (fn: () => unknown) => { e.preventDefault(); void fn(); };
    if (k === "escape" && this.pendingRelFrom !== null) {
      return go(() => { this.pendingRelFrom = null; this.render(); });
    }
    if (k === "escape" && this.readingEditTi !== null) {
      return go(() => { this.readingEditTi = null; this.render(); });
    }
    if (k === "y") {
      return go(() => {
        this.readingEditTi = this.readingEditTi === this.focusTi ? null : this.focusTi;
        this.render();
        this.contentEl.querySelector<HTMLInputElement>(".jp-dm-reading-input")?.focus();
      });
    }
    if (k === "j") return go(() => this.moveFocus(1));
    if (k === "k") return go(() => this.moveFocus(-1));
    if (k === "r") return go(() => {
      if (this.pendingRelFrom !== null && this.pendingRelFrom !== this.focusTi) return this.commitRelation(this.pendingRelFrom, this.focusTi);
      this.startRelation(this.focusTi);
    });
    if (k === "t") return go(() => this.cycleFocusedRelation());
    if (k === "enter" && this.pendingRelFrom !== null) {
      const from = this.pendingRelFrom;
      if (from !== this.focusTi) return go(() => this.commitRelation(from, this.focusTi));
      return go(() => { this.pendingRelFrom = null; this.render(); });
    }
    if (["a", "b", "c", "d"].includes(k)) return go(() => this.setSpeaker(this.focusTi, k.toUpperCase()));
    if (k === "s") return go(() => {
      const split = this.suggestionsFor(this.focusTi).find((x) => SPLIT_KINDS.has(x.kind) && x.unitStart > 0);
      if (split) return this.acceptSuggestion(this.focusTi, split);
      new Notice("分割できる文の提案がありません（行タップで区切りを切替）");
    });
    if (k === "enter") return go(() => {
      const first = this.suggestionsFor(this.focusTi)[0];
      if (first) return this.acceptSuggestion(this.focusTi, first);
      new Notice("このターンに提案はありません");
    });
    if (k === "x") return go(() => {
      const first = this.suggestionsFor(this.focusTi)[0];
      if (first) return this.rejectSuggestion(this.focusTi, first);
    });
    if (k === "e") return go(() => this.capture(this.focusTi));
    if (k === "m") return go(() => this.mergeTurn(this.focusTi));
  }

  private moveFocus(delta: number): void {
    this.focusTi = Math.max(0, Math.min(this.turns.length - 1, this.focusTi + delta));
    this.render();
    this.contentEl.querySelector(".jp-dm-turn--focus")?.scrollIntoView({ block: "nearest" });
  }

  // ── capture: full turn context through the normal spine ───────────────────

  private capture(ti: number, spanText?: string): void {
    if (!this.file) return;
    const before = [Math.max(0, ti - 3), ti] as const;
    const after = [ti + 1, Math.min(this.turns.length, ti + 4)] as const;
    const beforeTexts: string[] = [];
    const speakers: (string | null)[] = [];
    for (let i = before[0]; i < before[1]; i++) { beforeTexts.push(this.turnText(i)); speakers.push(this.turns[i].speaker); }
    speakers.push(this.turns[ti].speaker);
    const afterTexts: string[] = [];
    for (let i = after[0]; i < after[1]; i++) { afterTexts.push(this.turnText(i)); speakers.push(this.turns[i].speaker); }
    this.deps.openCapture({
      text: spanText ?? this.turnText(ti),
      example: this.turnText(ti),
      contextBefore: beforeTexts,
      contextAfter: afterTexts,
      speakers,
      source: { kind: "yt", file: this.file.path, tStartSec: this.lines[this.turns[ti].start].tStartSec },
    });
  }

  // ── render ─────────────────────────────────────────────────────────────────

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("jp-dm");

    if (!this.file) { this.renderPicker(root); return; }

    const head = root.createDiv("jp-dm-head");
    const back = head.createEl("button", { text: "←", cls: "jp-dm-back", attr: { title: "別の文字起こしを選ぶ" } });
    back.onclick = () => { this.file = null; this.render(); };
    head.createSpan({ text: this.file.basename.replace(/\s*\([\w-]{11}\)\s*$/, ""), cls: "jp-dm-title" });
    head.createSpan({ text: `${this.turns.length}ターン`, cls: "jp-dm-count" });

    const hint = root.createDiv("jp-dm-hint");
    hint.setText("行タップ＝区切り ・ チップ＝話者 ・ 相槌/反応/戻りピル＝一発分割 ・ ✍＝キャプチャ");
    const keys = root.createDiv("jp-dm-keys");
    for (const [key, label] of [["j/k", "移動"], ["a–d", "話者"], ["s", "分割"], ["⏎", "採用"], ["x", "却下"], ["e", "✍"], ["m", "結合"], ["r", "矢印"], ["t", "種別"], ["y", "読み"]] as const) {
      const chip = keys.createSpan("jp-dm-key");
      chip.createEl("kbd", { text: key });
      chip.createSpan({ text: label });
    }

    const list = root.createDiv("jp-dm-turns");
    for (let ti = 0; ti < this.turns.length; ti++) {
      const turn = this.turns[ti];
      const slices = turnLineSlices(this.lines, this.turns, ti);
      const card = list.createDiv(`jp-dm-turn jp-dm-turn--${turn.speaker}`
        + (ti === this.focusTi ? " jp-dm-turn--focus" : "")
        + (ti === this.pendingRelFrom ? " jp-dm-turn--rel-from" : ""));
      card.setAttr("data-ti", String(ti));
      card.addEventListener("pointerdown", () => {
        if (this.focusTi === ti) return;
        this.focusTi = ti;
        list.querySelectorAll(".jp-dm-turn--focus").forEach((el) => el.removeClass("jp-dm-turn--focus"));
        card.addClass("jp-dm-turn--focus");
      }, { capture: true });
      // pending arrow (grip click / keyboard r): tapping another card commits —
      // capture-phase + stopPropagation so no inner control also fires
      card.addEventListener("click", (e) => {
        if (this.pendingRelFrom === null || this.pendingRelFrom === ti) return;
        e.stopPropagation();
        e.preventDefault();
        void this.commitRelation(this.pendingRelFrom, ti);
      }, { capture: true });

      const th = card.createDiv("jp-dm-turn-head");
      const chip = th.createEl("button", { text: turn.speaker, cls: `jp-dm-speaker jp-dm-speaker--${turn.speaker}`, attr: { title: "タップで話者交代（キー: a–d）" } });
      chip.onclick = () => void this.cycleSpeaker(turn);
      const t0 = this.lines[turn.start].tStartSec ?? 0;
      th.createSpan({ text: `${Math.floor(t0 / 60)}:${String(Math.floor(t0 % 60)).padStart(2, "0")}`, cls: "jp-dm-time" });
      const cap = th.createEl("button", { text: "✍", cls: "jp-dm-cap", attr: { title: "このターンをキャプチャ（キー: e）" } });
      cap.onclick = () => this.capture(ti);
      const grip = th.createEl("button", { text: "⤳", cls: "jp-dm-relgrip", attr: { title: "矢印を引く：ドラッグで相手ターンへ／タップして相手をタップ（キー: r）" } });
      this.bindRelGrip(grip, ti, list);
      const eye = th.createEl("button", { text: "👓", cls: "jp-dm-eye", attr: { title: "読みを付ける — 複数レンズ可、機械は提案しません（キー: y）" } });
      eye.onclick = (e) => {
        e.stopPropagation();
        this.readingEditTi = this.readingEditTi === ti ? null : ti;
        this.focusTi = ti;
        this.render();
        this.contentEl.querySelector<HTMLInputElement>(".jp-dm-reading-input")?.focus();
      };

      const body = card.createDiv("jp-dm-lines");
      for (let si = 0; si < slices.length; si++) {
        const s = slices[si];
        const lineEl = body.createDiv("jp-dm-line" + (si === 0 ? " jp-dm-line--first" : ""));
        if (s.partialStart) lineEl.createSpan({ text: "…", cls: "jp-dm-line-cont" });
        lineEl.createSpan({ text: s.text, cls: "jp-dm-line-text" });
        if (si === 0) {
          lineEl.onclick = () => void this.mergeTurn(ti);
          if (ti > 0) lineEl.setAttr("title", "タップで上のターンと結合");
        } else {
          lineEl.onclick = () => void this.toggleBoundary(s.line);
          lineEl.setAttr("title", "タップでここから新しいターン");
        }
      }

      const suggestions = this.suggestionsFor(ti);
      const patternPills = this.deps.suggestPatterns(this.turnText(ti)).slice(0, 3);
      if (suggestions.length || patternPills.length) {
        const pr = card.createDiv("jp-dm-pills");
        for (const s of suggestions) {
          const wrap = pr.createSpan(`jp-dm-comp jp-dm-comp--${s.kind}`);
          const main = wrap.createEl("button", {
            text: `${KIND_LABEL[s.kind]} ${s.unitText.length > 14 ? s.unitText.slice(0, 13) + "…" : s.unitText}`,
            cls: "jp-dm-pill jp-dm-pill--comp",
            attr: {
              title: s.kind === "echo" ? `「${s.unitText}」（←${s.echoed}）をキャプチャ`
                : SPLIT_KINDS.has(s.kind) ? "タップでここから話者を分割（提案どおり）"
                : `${KIND_LABEL[s.kind]}成分（${s.evidence ?? ""}）を承認 — 構造は変わりません`,
            },
          });
          main.onclick = (e) => { e.stopPropagation(); void this.acceptSuggestion(ti, s); };
          const no = wrap.createEl("button", { text: "✕", cls: "jp-dm-pill-x", attr: { title: "この提案を却下（記録されます）" } });
          no.onclick = (e) => { e.stopPropagation(); this.rejectSuggestion(ti, s); };
        }
        for (const p of patternPills) {
          const b = pr.createEl("button", { text: p.label, cls: "jp-dm-pill", attr: { title: `「${p.text}」をキャプチャ` } });
          b.onclick = (e) => { e.stopPropagation(); this.capture(ti, p.text); };
        }
      }

      // layer-3: this turn's outgoing arrows (tap = cycle →/↳/↧, ✕ = remove)
      const myKey = turnKey(turn) + ">";
      const mine = this.relations.filter((r) => relationKey(r).startsWith(myKey));
      if (mine.length) {
        const rr = card.createDiv("jp-dm-rels");
        for (const r of mine) {
          const toTi = this.turns.findIndex((t) => turnKey(t) === `${r.to.start}:${r.to.char ?? 0}`);
          const to = this.turns[toTi];
          const t0 = to ? (this.lines[to.start]?.tStartSec ?? 0) : 0;
          const wrap = rr.createSpan("jp-dm-rel");
          const chip = wrap.createEl("button", {
            text: `${r.type} ${to?.speaker ?? "?"} ${Math.floor(t0 / 60)}:${String(Math.floor(t0 % 60)).padStart(2, "0")}`,
            cls: "jp-dm-pill jp-dm-pill--rel",
            attr: { title: `${RELATION_LABEL[r.type]} — タップで種別を循環（キー: t）` },
          });
          chip.onclick = async (e) => {
            e.stopPropagation();
            r.type = cycleRelationType(r.type);
            await this.setRelations([...this.relations]);
            this.render();
          };
          const no = wrap.createEl("button", { text: "✕", cls: "jp-dm-pill-x", attr: { title: "この矢印を削除" } });
          no.onclick = async (e) => {
            e.stopPropagation();
            await this.setRelations(removeRelation(this.relations, relationKey(r)));
            this.render();
          };
        }
      }

      // layer-4: readings — plural lens-tagged chips, human-only
      const tKey = turnKey(turn);
      const myReadings = this.readings[tKey] ?? [];
      if (myReadings.length || this.readingEditTi === ti) {
        const rr = card.createDiv("jp-dm-readings");
        for (const rd of myReadings) {
          const chip = rr.createSpan(`jp-dm-reading jp-dm-reading--${rd.lens}`);
          chip.createSpan({ text: LENS_LABEL[rd.lens], cls: "jp-dm-reading-lens" });
          chip.createSpan({ text: rd.label, cls: "jp-dm-reading-label" });
          const del = chip.createEl("button", { text: "✕", cls: "jp-dm-reading-x", attr: { title: "この読みを外す" } });
          del.onclick = async (e) => {
            e.stopPropagation();
            await this.setReadings(removeReading(this.readings, tKey, rd.lens, rd.label));
            this.render();
          };
        }
        if (this.readingEditTi === ti) {
          const ed = card.createDiv("jp-dm-reading-editor");
          for (const lens of READING_LENSES) {
            const b = ed.createEl("button", {
              text: LENS_LABEL[lens],
              cls: "jp-dm-reading-lensbtn" + (this.readingLens === lens ? " jp-dm-reading-lensbtn--on" : ""),
              attr: { title: "この読みのレンズ（同じターンに複数の読みが共存できます）" },
            });
            b.onclick = (e) => { e.stopPropagation(); this.readingLens = lens; this.render(); this.contentEl.querySelector<HTMLInputElement>(".jp-dm-reading-input")?.focus(); };
          }
          const input = ed.createEl("input", {
            cls: "jp-dm-reading-input",
            attr: { type: "text", placeholder: "ツッコミ・枠替え・味わい…（⏎で追加）", enterkeyhint: "done" },
          });
          input.addEventListener("keydown", async (e) => {
            e.stopPropagation();
            if (e.key === "Escape") { this.readingEditTi = null; this.render(); return; }
            if (e.key !== "Enter") return;
            const next = addReading(this.readings, tKey, this.readingLens, input.value, Date.now());
            if (!next) { new Notice("空か、同じレンズの同じ読みが既にあります"); return; }
            await this.setReadings(next);
            this.render();
            this.contentEl.querySelector<HTMLInputElement>(".jp-dm-reading-input")?.focus();
          });
        }
      }
    }
  }

  private renderPicker(root: HTMLElement): void {
    root.createDiv({ cls: "jp-dm-hint", text: "談話として作業する文字起こしを選んでください。区切り・話者の修正はそのまま保存され、パーサの学習データになります。" });
    const folder = normalizePath(this.deps.transcriptFolder() || "Transcripts");
    const files = this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder + "/") && !f.basename.startsWith("_"))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 25);
    if (!files.length) { root.createDiv({ cls: "jp-dm-hint", text: "文字起こしがまだありません（⚡ キャプチャフローで取得）。" }); return; }
    const list = root.createDiv("jp-dm-picker");
    for (const f of files) {
      const row = list.createDiv("jp-dm-pick");
      const hasSeg = !!this.deps.loadSeg(f.path);
      row.createSpan({ text: f.basename.replace(/\s*\([\w-]{11}\)\s*$/, ""), cls: "jp-dm-pick-title" });
      if (hasSeg) row.createSpan({ text: "✅ 作業済み", cls: "jp-dm-pick-mark" });
      row.onclick = () => void this.setFile(f);
    }
  }
}
