/**
 * FollowAlongView — 鑑賞モード / 発話セッション (DESIGN §25.2/§25.4/§25.5).
 *
 * The transcript learns where "now" is. Clock (c) manual-sync: tap the line
 * you just heard once = synced; from then on the current line renders large
 * and follows the wall clock. Glance answers 聞き取れなかった; taps are
 * MARKS (§25.1 — cheapest gesture, no modal, optional long-press seed);
 * harvest happens in the tray afterwards.
 *
 * 発話セッション rides on top: the tool holds the structure (mode /
 * constraint / role) so the head holds only the language. During: 📍 and 🎤
 * only. Ratings (user's own aspects, 0–4) happen per-bout in the pause —
 * their existing practice — or at the debrief; points = sum of ratings,
 * toward the goal. Every rated 🎤 bout is production gold by construction.
 *
 * Co-viewing contract (§25.4): during playback this surface is glanceable
 * and silent — no modals, no typing, tap targets only.
 */

import { ItemView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import type { ViewStateResult } from 'obsidian';
import type { MatcherLine } from '../notes/local-matcher.ts';
import { fmtStamp } from '../notes/srt.ts';
import { syncClock, pauseClock, resumeClock, clockPosition, currentLineIndex, type FollowClock } from '../notes/follow.ts';
import { pickPlexSession, type PlexSessionsResult } from '../notes/plex.ts';
import {
  SPEAK_MODES, newSession, newMark, sessionPoints, speakMarks,
  type SpeakStore, type SpeakSession, type SpeakMode, type SpeakConstraint, type SessionMark,
} from '../notes/speak-session.ts';
import type { MarkRef } from '../notes/inbox.ts';
import type { CaptureContext } from './CaptureModal.ts';
// The discourse calculus (DISCOURSE-CALCULUS.md): pure fold → live board.
// 🔴 study = next-move prediction on the affordance set (FABLE-BRIEF §4.3).
import { reduce, affordances } from '../discourse/calculus/scoreboard.mjs';
import { recognizeEvents } from '../discourse/calculus/moves.mjs';
import { transcriptToTurns } from '../discourse/calculus/turns.mjs';

export const JP_FOLLOW_VIEW_TYPE = 'jp-follow-view';

// ── 🔴 談話ボード (the live scoreboard under the transcript) ────────────────

const PRIM_JA: Record<string, string> = {
  PROPOSE: '提案', ASSERT_AS_DERIVED: '導出主張', CONSCRIPT: '同意徴発',
  PREFACE_CONTESTABLE: '異論前置き', RELATE_SUPPORT: '支持', RELATE_CONTRAST: '対抗',
  SUBSTITUTE: '言い換え', RETRACT_OWN: '撤回', REJECT: '拒否', GRANT: '譲歩',
  RATIFY: '受諾', ACKNOWLEDGE: '相槌', DENY_COMMITMENT: '線引き', RE_TYPE: '再類型化',
  ADJUST_FORCE: '強度調整', PROJECT_CONSEQUENCE: '帰結投影', RAISE_QUD: '問い提起',
  ANSWER_QUD: '応答', SHELVE_QUD: '棚上げ', RESUME_QUD: '再開',
};
/** Moves worth drilling — they change CG/Projected/QUD (not PROPOSE noise). */
const DRILLABLE = new Set([
  'CONSCRIPT', 'GRANT', 'REJECT', 'RATIFY', 'RELATE_CONTRAST', 'SUBSTITUTE',
  'RETRACT_OWN', 'DENY_COMMITMENT', 'RE_TYPE', 'PROJECT_CONSEQUENCE',
  'ASSERT_AS_DERIVED', 'SHELVE_QUD', 'RESUME_QUD',
]);

interface BoardSnap { tSec: number | null; cg: number; table: number; projected: string[]; qud: string[]; shelved: number; prims: string[] }
interface BoardMove { tSec: number | null; speaker: string; prim: string; ref: string }
interface DrillCase {
  atSec: number; move: BoardMove; text: string; options: string[];
  picked?: string; revealed?: boolean;
}

export interface FollowDeps {
  parse: (md: string) => MatcherLine[];
  /** §25.1: a 📍 lands in the tray for harvest. */
  addTrayMark: (m: MarkRef) => Promise<void>;
  speak: SpeakStore;
  aspects: () => string[];
  goalPoints: () => number;
  openCapture: (ctx: CaptureContext) => void;
  /** medium + 番組名 from the transcript's frontmatter. */
  mediumOf: (file: TFile) => { medium: MarkRef['medium']; sourceName?: string };
  /** §25.4 Plex clock (b): true once baseUrl + token are set (gates the chip). */
  plexEnabled?: () => boolean;
  /** poll the Plex server for live sessions (transport is in main.ts). */
  plexPoll?: () => Promise<PlexSessionsResult>;
  /** cut a clip (+still) at a mark from the Plex Part; desktop-only, → vault paths. */
  plexClip?: (partKey: string, atSec: number, label: string) => Promise<{ audio?: string; still?: string } | null>;
}

const LONG_PRESS_MS = 550;
const SCROLL_HOLD_MS = 8000;

export class FollowAlongView extends ItemView {
  private filePath: string | null = null;
  private lines: MatcherLine[] = [];
  private medium: MarkRef['medium'] = 'yt';
  private sourceName?: string;

  private clock: FollowClock | null = null;
  private nowIdx = -1;
  private focusIdx = -1;
  private scrollHoldUntil = 0;
  private tickId: number | null = null;

  private session: SpeakSession | null = null;
  private showConfig = false;
  private ratingMarkId: string | null = null;
  private debrief: SpeakSession | null = null;

  private listEl: HTMLElement | null = null;

  // §25.4 Plex clock (b): when on, the transcript follows the server's playback.
  private plexSyncOn = false;
  private plexPollId: number | null = null;
  /** Part key of the session we're following — the door for clip cutting. */
  private plexPartKey: string | null = null;

  // 🔴 談話ボード: computed lazily from the raw md on first toggle.
  private rawMd = '';
  private boardOn = false;
  private snaps: BoardSnap[] = [];       // per-turn board snapshots (surface order)
  private moves: BoardMove[] = [];       // full move log
  private afford: Map<number, string[]> = new Map();  // turn idx → afforded prims for NEXT mover
  private turnTexts: Array<{ tSec: number | null; speaker: string | null; text: string }> = [];
  private drill: DrillCase | null = null;
  private boardSnapIdx = -1;

  constructor(leaf: WorkspaceLeaf, private deps: FollowDeps) {
    super(leaf);
  }

  getViewType(): string { return JP_FOLLOW_VIEW_TYPE; }
  getDisplayText(): string { return '鑑賞モード'; }
  getIcon(): string { return 'eye'; }

  getState(): Record<string, unknown> { return { file: this.filePath }; }

  async setState(state: { file?: string }, result: ViewStateResult): Promise<void> {
    if (state?.file && state.file !== this.filePath) {
      this.filePath = state.file;
      await this.loadFile();
      this.render();
    }
    return super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.contentEl.setAttr('tabindex', '0');
    this.registerDomEvent(this.contentEl, 'keydown', (e) => this.onKey(e));
    this.tickId = window.setInterval(() => this.tick(), 500);
    this.registerInterval(this.tickId);
    this.render();
  }

  async onClose(): Promise<void> {
    if (this.tickId != null) window.clearInterval(this.tickId);
    this.stopPlexPoll();
  }

  private async loadFile(): Promise<void> {
    this.lines = [];
    this.clock = null;
    this.nowIdx = -1;
    this.session = null;
    this.debrief = null;
    this.stopPlexPoll();
    this.plexSyncOn = false;
    this.plexPartKey = null;
    const f = this.filePath ? this.app.vault.getFileByPath(this.filePath) : null;
    if (!f) return;
    const md = await this.app.vault.cachedRead(f);
    this.lines = this.deps.parse(md);
    this.rawMd = md;
    this.boardOn = false;
    this.snaps = [];
    this.moves = [];
    this.afford = new Map();
    this.turnTexts = [];
    this.drill = null;
    this.boardSnapIdx = -1;
    const src = this.deps.mediumOf(f);
    this.medium = src.medium;
    this.sourceName = src.sourceName;
  }

  // ── 🔴 談話ボード ──────────────────────────────────────────────────────────

  /** One pure fold of the whole transcript (evidence chain → reducer).
   *  Deterministic, no LLM; ~O(file) once, then the playhead just indexes. */
  private computeBoard(): void {
    if (this.snaps.length || !this.rawMd) return;
    try {
      const { turns } = transcriptToTurns(this.rawMd);
      this.turnTexts = turns.map((t) =>
        ({ tSec: t.tSec ?? null, speaker: t.speaker, text: t.text }));
      const afford = this.afford;
      const board = reduce(turns, recognizeEvents, (b: unknown, _t: unknown, i: number) => {
        // state AFTER turn i = what the mover of turn i+1 faces
        const next = turns[i + 1];
        if (next) afford.set(i + 1, affordances(b, next.speaker).map((a: { prim: string }) => a.prim));
      });
      this.snaps = board.turns.map((s: BoardSnap & { prims: string[] }) => ({
        tSec: s.tSec ?? null, cg: s.cg, table: s.table,
        projected: [...s.projected], qud: [...s.qud],
        shelved: 0, prims: [...s.prims],
      }));
      // shelved count is not in snapshots; derive a running count from the log
      let shelf = 0; let si = 0;
      const log: BoardMove[] = board.log.map((l: BoardMove) => ({ tSec: l.tSec ?? null, speaker: l.speaker, prim: l.prim, ref: l.ref }));
      for (const m of log) {
        if (m.prim === 'SHELVE_QUD') shelf++;
        if (m.prim === 'RESUME_QUD') shelf = Math.max(0, shelf - 1);
        while (si < this.snaps.length && (this.snaps[si].tSec ?? -1) <= (m.tSec ?? -1)) { this.snaps[si].shelved = shelf; si++; }
      }
      for (; si < this.snaps.length; si++) this.snaps[si].shelved = shelf;
      this.moves = log;
    } catch (e) {
      console.error('[jp-collocations] board fold failed', e);
      new Notice('談話ボードの構築に失敗しました');
    }
  }

  /** Last snapshot at/before the playhead (linear scan cached by index). */
  private snapAt(pos: number): number {
    if (!this.snaps.length) return -1;
    let i = Math.max(0, this.boardSnapIdx);
    if ((this.snaps[i]?.tSec ?? Infinity) > pos) i = 0;
    while (i + 1 < this.snaps.length && (this.snaps[i + 1].tSec ?? Infinity) <= pos) i++;
    return (this.snaps[i].tSec ?? Infinity) <= pos ? i : -1;
  }

  private toggleBoard(): void {
    this.boardOn = !this.boardOn;
    if (this.boardOn) this.computeBoard();
    this.render();
  }

  /** Freeze here → the next drillable move is the answer; afforded prims are
   *  the distractors. This IS 🔴 responsivity, operationally: stimulus =
   *  board state, response = the primitive (FABLE-BRIEF §4.3). */
  private makeDrill(): void {
    const pos = clockPosition(this.clock, Date.now()) ?? (this.focusIdx >= 0 ? this.lines[this.focusIdx]?.tStartSec ?? 0 : 0);
    const next = this.moves.find((m) => (m.tSec ?? -1) > pos && DRILLABLE.has(m.prim));
    if (!next) { new Notice('この先にドリル対象の手がありません'); return; }
    const ti = this.turnTexts.findIndex((t) => t.tSec === next.tSec && t.speaker === next.speaker);
    const aff = (ti >= 0 ? this.afford.get(ti) : null) ?? [];
    const options = new Set<string>([next.prim]);
    for (const p of aff) { if (options.size >= 4) break; if (DRILLABLE.has(p)) options.add(p); }
    for (const p of DRILLABLE) { if (options.size >= 4) break; options.add(p); }
    this.drill = {
      atSec: pos, move: next,
      text: ti >= 0 ? this.turnTexts[ti].text : next.ref,
      options: [...options].sort(),      // canonical order — position leaks nothing
    };
    this.render();
  }

  private renderBoardPanel(root: HTMLElement): void {
    const box = root.createDiv('jp-follow-board');
    const head = box.createDiv('jp-follow-board-head');
    head.createSpan({ text: '🔴 談話ボード', cls: 'jp-follow-board-title' });
    const drillBtn = head.createEl('button', { text: '予測', cls: 'jp-follow-btn' });
    drillBtn.onclick = () => this.makeDrill();

    const pos = clockPosition(this.clock, Date.now());
    const si = pos != null ? this.snapAt(pos) : this.snaps.length - 1;
    const state = box.createDiv('jp-follow-board-state');
    if (si < 0) {
      state.setText(this.snaps.length ? '同期すると盤面が動きます' : '盤面なし');
    } else {
      const s = this.snaps[si];
      const bits = [`CG ${s.cg}`, `議題 ${s.table}`, `帰結 ${s.projected.length}`];
      if (s.shelved) bits.push(`保留 ${s.shelved}`);
      state.createSpan({ text: bits.join(' · '), cls: 'jp-follow-board-counts' });
      if (s.qud.length) state.createDiv({ text: `Q: ${s.qud[s.qud.length - 1]}`, cls: 'jp-follow-board-qud' });
      const recent = this.moves.filter((m) => (m.tSec ?? -1) <= (pos ?? Infinity) && m.prim !== 'PROPOSE' && m.prim !== 'ACKNOWLEDGE').slice(-3);
      if (recent.length) {
        state.createDiv({
          cls: 'jp-follow-board-recent',
          text: '直近: ' + recent.map((m) => `${PRIM_JA[m.prim] ?? m.prim}`).join(' → '),
        });
      }
    }

    if (this.drill) this.renderDrill(box, this.drill);
  }

  private renderDrill(host: HTMLElement, d: DrillCase): void {
    const box = host.createDiv('jp-follow-drill');
    box.createDiv({
      text: `次の一手 — ${fmtStamp(d.atSec)} で凍結。${d.move.speaker || '話者'} の次の手は？`,
      cls: 'jp-follow-drill-q',
    });
    const row = box.createDiv('jp-follow-drill-opts');
    for (const p of d.options) {
      const b = row.createEl('button', {
        text: `${PRIM_JA[p] ?? p}`,
        cls: 'jp-follow-chipbtn' +
          (d.revealed ? (p === d.move.prim ? ' is-on' : (p === d.picked ? ' is-bad' : '')) : ''),
      });
      b.title = p;
      b.onclick = () => {
        if (d.revealed) return;
        d.picked = p; d.revealed = true;
        this.render();
      };
    }
    if (d.revealed) {
      const ok = d.picked === d.move.prim;
      const r = box.createDiv('jp-follow-drill-reveal');
      r.createSpan({ text: ok ? '○ ' : '× ', cls: ok ? 'jp-follow-drill-ok' : 'jp-follow-drill-ng' });
      r.createSpan({
        text: `${d.move.tSec != null ? fmtStamp(d.move.tSec) : ''} ${PRIM_JA[d.move.prim] ?? d.move.prim}（${d.move.prim}）`,
      });
      box.createDiv({ text: d.text.slice(0, 120), cls: 'jp-follow-drill-line' });
      const acts = box.createDiv('jp-follow-drill-acts');
      const again = acts.createEl('button', { text: 'もう一問', cls: 'jp-follow-btn' });
      again.onclick = () => {
        // continue from just past this move so the next case advances
        this.clock = this.clock ?? (d.move.tSec != null ? syncClock(d.move.tSec, Date.now()) : null);
        this.drill = null;
        const save = clockPosition(this.clock, Date.now());
        if (d.move.tSec != null && (save == null || save <= d.move.tSec)) this.clock = syncClock(d.move.tSec + 1, Date.now());
        this.makeDrill();
      };
      const close = acts.createEl('button', { text: '閉じる', cls: 'jp-follow-btn' });
      close.onclick = () => { this.drill = null; this.render(); };
    }
  }

  private hasStamps(): boolean {
    return this.lines.some((l) => l.tStartSec != null);
  }

  // ── the clock ─────────────────────────────────────────────────────────────

  private tick(): void {
    const pos = clockPosition(this.clock, Date.now());
    if (pos == null) return;
    // 🔴 board follows the playhead (cheap: index into precomputed snaps);
    // frozen while a drill is open so the question can't shift underfoot.
    if (this.boardOn && this.snaps.length && !this.drill) {
      const si = this.snapAt(pos);
      if (si !== this.boardSnapIdx) {
        this.boardSnapIdx = si;
        const panel = this.contentEl.querySelector<HTMLElement>('.jp-follow-board');
        if (panel) {
          const fresh = createDiv();
          this.renderBoardPanel(fresh as HTMLElement);
          panel.replaceWith(fresh.firstChild as HTMLElement);
        }
      }
    }
    const idx = currentLineIndex(this.lines, pos);
    if (idx === this.nowIdx) return;
    const prev = this.contentEl.querySelector('.jp-follow-line--now');
    prev?.removeClass('jp-follow-line--now');
    this.nowIdx = idx;
    if (idx < 0) return;
    const row = this.contentEl.querySelector<HTMLElement>(`.jp-follow-line[data-idx="${idx}"]`);
    if (!row) return;
    row.addClass('jp-follow-line--now');
    if (Date.now() > this.scrollHoldUntil) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else {
      this.contentEl.querySelector('.jp-follow-nowpill')?.addClass('jp-follow-nowpill--show');
    }
  }

  private syncTo(line: MatcherLine): void {
    if (line.tStartSec == null) return;
    this.clock = syncClock(line.tStartSec, Date.now());
    this.updateClockChip();
  }

  // ── §25.4 Plex clock (b) ───────────────────────────────────────────────────

  private togglePlexSync(): void {
    if (this.plexSyncOn) { this.stopPlexPoll(); new Notice('Plex同期を停止しました'); this.render(); return; }
    this.plexSyncOn = true;
    void this.pollPlex();                                    // sync at once, then every 5s
    const id = window.setInterval(() => void this.pollPlex(), 5000);
    this.plexPollId = id;
    this.registerInterval(id);
    this.render();
  }

  private stopPlexPoll(): void {
    if (this.plexPollId != null) { window.clearInterval(this.plexPollId); this.plexPollId = null; }
    this.plexSyncOn = false;
  }

  /** One poll: pick the session this note follows, re-anchor the clock to its
   *  viewOffset (pause-aware). Any error degrades soft — clock (c) still works. */
  private async pollPlex(): Promise<void> {
    if (!this.plexSyncOn || !this.deps.plexPoll) return;
    const res = await this.deps.plexPoll();
    if (!res.ok) { this.setPlexChip(`⚠ ${res.error}`, true); return; }
    if (!res.sessions.length) { this.setPlexChip('Plex — 再生中なし', true); return; }
    const s = pickPlexSession(res.sessions, { title: this.sourceName, show: this.sourceName });
    if (!s) { this.setPlexChip(`Plex — 複数再生中、ノートに一致なし（${res.sessions.length}）`, true); return; }
    this.plexPartKey = s.partKey ?? null;
    this.clock = syncClock(s.viewOffsetSec, Date.now());
    if (s.paused) this.clock = pauseClock(this.clock, Date.now());
    this.setPlexChip(`${s.paused ? '⏸' : '▶'} ${s.title}`, false);
    this.updateClockChip();
    this.tick();
  }

  private setPlexChip(text: string, warn: boolean): void {
    const chip = this.contentEl.querySelector<HTMLElement>('.jp-follow-plexchip');
    if (!chip) return;
    chip.setText(text);
    chip.toggleClass('is-on', this.plexSyncOn && !warn);
    chip.toggleClass('is-warn', warn);
  }

  // ── marks ─────────────────────────────────────────────────────────────────

  private async dropMark(kind: 'note' | 'speak', line: MatcherLine, seed?: string): Promise<void> {
    const now = Date.now();
    const mark = newMark({
      kind, tSec: line.tStartSec, lineIndex: line.index,
      lineText: line.text, seed, now,
    });
    if (this.session) {
      await this.deps.speak.addMark(this.session.id, mark);
    }
    if (kind === 'note') {
      // capture intents go to the tray whether or not a session runs
      await this.deps.addTrayMark({
        medium: this.medium, sourceName: this.sourceName,
        file: this.filePath ?? undefined, tSec: line.tStartSec,
        seed, wallClock: now,
      });
      new Notice(seed ? `📍 ${seed}` : '📍', 900);
    } else {
      this.ratingMarkId = mark.id;
      this.render();
    }
  }

  private lineForButtons(): MatcherLine | null {
    if (this.nowIdx >= 0) return this.lines[this.nowIdx];
    if (this.focusIdx >= 0) return this.lines[this.focusIdx];
    return null;
  }

  // ── keyboard (§23.5 three hands) ──────────────────────────────────────────

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!this.lines.length) return;
    const k = e.key;
    const go = (fn: () => unknown) => { e.preventDefault(); void fn(); };
    if (k === 'j' || k === 'k') {
      return go(() => {
        const base = this.focusIdx >= 0 ? this.focusIdx : Math.max(0, this.nowIdx);
        this.setFocus(Math.max(0, Math.min(this.lines.length - 1, base + (k === 'j' ? 1 : -1))));
      });
    }
    const focused = this.focusIdx >= 0 ? this.lines[this.focusIdx] : null;
    if (k === 'Enter' && focused) return go(() => this.dropMark('note', focused));
    if (k === 's' && focused) return go(() => { this.syncTo(focused); new Notice('⌖ 同期', 800); });
    if (k === 'm') { const l = this.lineForButtons(); if (l) return go(() => this.dropMark('note', l)); }
    if (k === 'y' && this.session) { const l = this.lineForButtons(); if (l) return go(() => this.dropMark('speak', l)); }
    if (k === 'p' && this.clock) {
      return go(() => {
        this.clock = this.clock!.pausedAtTSec != null
          ? resumeClock(this.clock!, Date.now())
          : pauseClock(this.clock!, Date.now());
        this.updateClockChip();
      });
    }
    if (k === 'g') return go(() => this.jumpToNow());
  }

  private setFocus(idx: number): void {
    this.contentEl.querySelector('.jp-follow-line--focus')?.removeClass('jp-follow-line--focus');
    this.focusIdx = idx;
    const row = this.contentEl.querySelector<HTMLElement>(`.jp-follow-line[data-idx="${idx}"]`);
    row?.addClass('jp-follow-line--focus');
    this.scrollHoldUntil = Date.now() + SCROLL_HOLD_MS;
    row?.scrollIntoView({ block: 'nearest' });
  }

  private jumpToNow(): void {
    this.scrollHoldUntil = 0;
    this.contentEl.querySelector('.jp-follow-nowpill')?.removeClass('jp-follow-nowpill--show');
    this.contentEl.querySelector<HTMLElement>(`.jp-follow-line[data-idx="${this.nowIdx}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  private updateClockChip(): void {
    const chip = this.contentEl.querySelector<HTMLElement>('.jp-follow-clock');
    if (!chip) return;
    const pos = clockPosition(this.clock, Date.now());
    if (pos == null) { chip.setText('未同期 — 今聞こえた行をタップ'); return; }
    const paused = this.clock!.pausedAtTSec != null;
    chip.setText(`${paused ? '⏸' : '▶'} ${fmtStamp(Math.max(0, pos))}`);
  }

  // ── render ────────────────────────────────────────────────────────────────

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('jp-follow');

    if (!this.filePath || !this.lines.length) {
      root.createDiv({ cls: 'jp-follow-empty', text: 'トランスクリプトのノートから「鑑賞モード」コマンドで開いてください。' });
      return;
    }

    // ── header ──
    const head = root.createDiv('jp-follow-head');
    head.createDiv({ text: this.sourceName ?? this.filePath.split('/').pop()?.replace(/\.md$/, '') ?? '', cls: 'jp-follow-title' });
    const chips = head.createDiv('jp-follow-chips');
    const clockChip = chips.createSpan('jp-follow-clock');
    clockChip.onclick = () => {
      if (!this.clock) return;
      this.clock = this.clock.pausedAtTSec != null ? resumeClock(this.clock, Date.now()) : pauseClock(this.clock, Date.now());
      this.updateClockChip();
    };
    // 🔴 談話ボード: the live common-ground scoreboard under the transcript.
    if (this.hasStamps()) {
      const boardChip = chips.createEl('button', {
        cls: 'jp-follow-btn' + (this.boardOn ? ' is-on' : ''),
        text: this.boardOn ? '🔴 ボード中' : '🔴 ボード',
      });
      boardChip.onclick = () => this.toggleBoard();
    }
    // §25.4 Plex clock (b): follow the server instead of a manual tap.
    if (this.deps.plexEnabled?.()) {
      const plexChip = chips.createEl('button', {
        cls: 'jp-follow-plexchip jp-follow-btn' + (this.plexSyncOn ? ' is-on' : ''),
        text: this.plexSyncOn ? '⟲ Plex同期中' : '📺 Plex同期',
      });
      plexChip.onclick = () => this.togglePlexSync();
    }
    const past = this.deps.speak.forFile(this.filePath).filter((s) => s.endedAt);
    if (past.length && !this.session) {
      const p = chips.createSpan({ text: `過去${past.length}回`, cls: 'jp-follow-past' });
      p.onclick = () => { this.debrief = past[0]; this.render(); };
    }
    if (!this.session) {
      const start = chips.createEl('button', { text: '🎤 セッション', cls: 'jp-follow-btn' });
      start.onclick = () => { this.showConfig = !this.showConfig; this.render(); };
    }

    if (!this.hasStamps()) {
      root.createDiv({ cls: 'jp-follow-warn', text: '⚠ タイムスタンプが見つかりません — 今ここ追従は無効です（マークは可能）。' });
    }

    // §23.5 keyboard hints
    const keys = root.createDiv('jp-dm-keys');
    const hints: Array<[string, string]> = [
      ['j/k', '移動'], ['⏎', '📍'], ['s', '同期'], ['p', '⏯'], ['g', '今へ'],
    ];
    if (this.session) hints.push(['y', '🎤']);
    for (const [key, label] of hints) {
      const chip = keys.createSpan('jp-dm-key');
      chip.createEl('kbd', { text: key });
      chip.createSpan({ text: label });
    }

    if (this.boardOn) this.renderBoardPanel(root);
    if (this.showConfig && !this.session) this.renderConfig(root);
    if (this.debrief) this.renderDebrief(root, this.debrief);

    // ── the transcript ──
    const list = root.createDiv('jp-follow-list');
    this.listEl = list;
    list.addEventListener('scroll', () => { this.scrollHoldUntil = Date.now() + SCROLL_HOLD_MS; }, { passive: true });
    for (const line of this.lines) this.renderLine(list, line);

    const nowPill = root.createDiv({ text: '⌄ 今へ', cls: 'jp-follow-nowpill' });
    nowPill.onclick = () => this.jumpToNow();

    // ── bottom bar ──
    const bar = root.createDiv('jp-follow-bar');
    if (this.session) {
      const s = this.session;
      const info = bar.createDiv('jp-follow-bar-info');
      const modeLabel = SPEAK_MODES.find((m) => m.id === s.mode)?.label ?? s.mode;
      info.createSpan({ text: `${modeLabel}${s.role ? `・${s.role}役` : ''}`, cls: 'jp-follow-bar-mode' });
      if (s.constraint.kind === 'counter') {
        info.createSpan({ text: `${sessionPoints(s)} / ${s.constraint.goalPoints ?? this.deps.goalPoints()}点`, cls: 'jp-follow-bar-pts' });
      } else if (s.constraint.kind === 'timer') {
        info.createSpan({ text: `⏱ ${s.constraint.seconds}秒`, cls: 'jp-follow-bar-pts' });
      }
      const note = bar.createEl('button', { text: '📍', cls: 'jp-follow-big' });
      note.onclick = () => { const l = this.lineForButtons(); if (l) void this.dropMark('note', l); else new Notice('先に行をタップして同期'); };
      const speak = bar.createEl('button', { text: '🎤', cls: 'jp-follow-big jp-follow-big--speak' });
      speak.onclick = () => { const l = this.lineForButtons(); if (l) void this.dropMark('speak', l); else new Notice('先に行をタップして同期'); };
      const end = bar.createEl('button', { text: '終了', cls: 'jp-follow-btn' });
      end.onclick = async () => {
        await this.deps.speak.end(s.id, Date.now());
        this.debrief = s;
        this.session = null;
        this.ratingMarkId = null;
        this.render();
      };
      if (this.ratingMarkId) {
        const mark = s.marks.find((m) => m.id === this.ratingMarkId);
        if (mark) this.renderRatingRow(bar, s, mark, () => { this.ratingMarkId = null; this.render(); });
      }
    } else {
      bar.createDiv({ cls: 'jp-follow-bar-hint', text: this.clock ? '行をタップ＝📍マーク（長押しで一語シード）' : '今聞こえた行をタップ＝同期' });
    }

    this.updateClockChip();
    this.tick();
  }

  private renderLine(list: HTMLElement, line: MatcherLine): void {
    const row = list.createDiv('jp-follow-line');
    row.dataset.idx = String(line.index);
    if (line.index === this.nowIdx) row.addClass('jp-follow-line--now');
    if (line.index === this.focusIdx) row.addClass('jp-follow-line--focus');
    if (line.tStartSec != null) row.createSpan({ text: fmtStamp(line.tStartSec), cls: 'jp-follow-stamp' });
    if (line.speaker) row.createSpan({ text: line.speaker, cls: 'jp-follow-speaker' });
    row.createSpan({ text: line.text, cls: 'jp-follow-text' });

    // tap: first tap (unsynced) = sync only; synced = resync + 📍 mark
    let pressTimer: number | null = null;
    let longFired = false;
    row.addEventListener('pointerdown', () => {
      longFired = false;
      pressTimer = window.setTimeout(() => { longFired = true; this.seedPrompt(row, line); }, LONG_PRESS_MS);
    });
    const cancel = () => { if (pressTimer != null) { window.clearTimeout(pressTimer); pressTimer = null; } };
    row.addEventListener('pointerleave', cancel);
    row.addEventListener('pointercancel', cancel);
    row.addEventListener('pointerup', () => {
      cancel();
      if (longFired) return;
      if (!this.clock && line.tStartSec != null) {
        this.syncTo(line);
        new Notice('⌖ 同期しました — 以後のタップは📍マーク', 1500);
        return;
      }
      // during Plex sync the server owns the clock — a tap is a mark, not a resync.
      if (!this.plexSyncOn) this.syncTo(line);
      void this.dropMark('note', line);
    });
  }

  /** long-press: the §25.1 seed — one word, ≤2s, skippable (Esc/blur). */
  private seedPrompt(row: HTMLElement, line: MatcherLine): void {
    if (row.querySelector('.jp-follow-seed')) return;
    const wrap = row.createDiv('jp-follow-seed');
    const input = wrap.createEl('input', { type: 'text', placeholder: 'シード一語…', cls: 'jp-follow-seed-input' });
    const close = () => wrap.remove();
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        const seed = input.value.trim();
        close();
        void this.dropMark('note', line, seed || undefined);
      } else if (e.key === 'Escape') close();
      e.stopPropagation();
    };
    input.onblur = close;
    input.focus();
  }

  // ── 発話セッション config / rating / debrief ──────────────────────────────

  private renderConfig(root: HTMLElement): void {
    const box = root.createDiv('jp-follow-config');
    box.createDiv({ text: '発話セッション', cls: 'jp-follow-config-title' });

    let mode: SpeakMode = 'narikiri';
    let constraint: SpeakConstraint = { kind: 'counter', goalPoints: this.deps.goalPoints() };
    let role = '';

    const modeRow = box.createDiv('jp-follow-config-row');
    const modeBtns: HTMLElement[] = [];
    for (const m of SPEAK_MODES) {
      const b = modeRow.createEl('button', { text: m.label, cls: 'jp-follow-chipbtn' + (m.id === mode ? ' is-on' : '') });
      b.title = m.hint;
      b.onclick = () => { mode = m.id; modeBtns.forEach((x) => x.removeClass('is-on')); b.addClass('is-on'); };
      modeBtns.push(b);
    }

    const conRow = box.createDiv('jp-follow-config-row');
    const conDefs: Array<{ label: string; make: () => SpeakConstraint }> = [
      { label: `🔢 ${this.deps.goalPoints()}点`, make: () => ({ kind: 'counter', goalPoints: this.deps.goalPoints() }) },
      { label: '⏱ 30秒', make: () => ({ kind: 'timer', seconds: 30 }) },
      { label: 'なし', make: () => ({ kind: 'none' }) },
    ];
    const conBtns: HTMLElement[] = [];
    conDefs.forEach((d, i) => {
      const b = conRow.createEl('button', { text: d.label, cls: 'jp-follow-chipbtn' + (i === 0 ? ' is-on' : '') });
      b.onclick = () => { constraint = d.make(); conBtns.forEach((x) => x.removeClass('is-on')); b.addClass('is-on'); };
      conBtns.push(b);
    });

    const letters = [...new Set(this.lines.map((l) => l.speaker).filter(Boolean))] as string[];
    if (letters.length) {
      const roleRow = box.createDiv('jp-follow-config-row');
      roleRow.createSpan({ text: '役:', cls: 'jp-follow-config-label' });
      const roleBtns: HTMLElement[] = [];
      for (const sp of letters) {
        const b = roleRow.createEl('button', { text: sp, cls: 'jp-follow-chipbtn' });
        b.onclick = () => {
          const on = b.hasClass('is-on');
          roleBtns.forEach((x) => x.removeClass('is-on'));
          role = on ? '' : sp;
          if (!on) b.addClass('is-on');
        };
        roleBtns.push(b);
      }
    }

    const go = box.createEl('button', { text: '開始', cls: 'jp-follow-btn jp-follow-btn--go' });
    go.onclick = async () => {
      const s = newSession({
        file: this.filePath!, mode, constraint, role: role || undefined,
        aspects: this.deps.aspects(), now: Date.now(),
      });
      await this.deps.speak.upsert(s);
      this.session = s;
      this.showConfig = false;
      this.debrief = null;
      this.render();
    };
  }

  private renderRatingRow(host: HTMLElement, s: SpeakSession, mark: SessionMark, onDone: () => void): void {
    const box = host.createDiv('jp-follow-rating');
    box.createDiv({ text: '自己評価（0–4）— 後ででも可', cls: 'jp-follow-rating-title' });
    const current: Record<string, number> = { ...(mark.ratings ?? {}) };
    for (const aspect of s.aspects) {
      const row = box.createDiv('jp-follow-rating-row');
      row.createSpan({ text: aspect, cls: 'jp-follow-rating-aspect' });
      const btns: HTMLElement[] = [];
      for (let v = 0; v <= 4; v++) {
        const b = row.createEl('button', { text: String(v), cls: 'jp-follow-rate' + (current[aspect] === v ? ' is-on' : '') });
        b.onclick = async () => {
          current[aspect] = v;
          btns.forEach((x) => x.removeClass('is-on'));
          b.addClass('is-on');
          await this.deps.speak.rateMark(s.id, mark.id, current);
          const pts = this.contentEl.querySelector<HTMLElement>('.jp-follow-bar-pts');
          if (pts && s.constraint.kind === 'counter') {
            pts.setText(`${sessionPoints(s)} / ${s.constraint.goalPoints ?? this.deps.goalPoints()}点`);
          }
        };
        btns.push(b);
      }
    }
    const done = box.createEl('button', { text: '完了', cls: 'jp-follow-btn' });
    done.onclick = onDone;
  }

  private renderDebrief(root: HTMLElement, s: SpeakSession): void {
    const box = root.createDiv('jp-follow-debrief');
    const head = box.createDiv('jp-follow-debrief-head');
    const modeLabel = SPEAK_MODES.find((m) => m.id === s.mode)?.label ?? s.mode;
    const spoken = speakMarks(s);
    head.createSpan({
      text: `振り返り — ${modeLabel}${s.role ? `・${s.role}役` : ''} · 🎤${spoken.length}回 · ${sessionPoints(s)}点` +
        (s.constraint.kind === 'counter' ? ` / ${s.constraint.goalPoints ?? this.deps.goalPoints()}点` : ''),
      cls: 'jp-follow-debrief-title',
    });
    const close = head.createEl('button', { text: '閉じる', cls: 'jp-follow-btn' });
    close.onclick = () => { this.debrief = null; this.render(); };

    for (const mark of s.marks) {
      const card = box.createDiv('jp-follow-debrief-card');
      const mhead = card.createDiv('jp-follow-debrief-mhead');
      mhead.createSpan({ text: mark.kind === 'speak' ? '🎤' : '📍', cls: 'jp-follow-debrief-kind' });
      if (mark.tSec != null) mhead.createSpan({ text: fmtStamp(mark.tSec), cls: 'jp-follow-stamp' });
      if (mark.seed) mhead.createSpan({ text: mark.seed, cls: 'jp-follow-debrief-seed' });

      const idx = mark.lineIndex ?? -1;
      const line = idx >= 0 && idx < this.lines.length && this.lines[idx].text === mark.lineText
        ? this.lines[idx]
        : null;
      card.createDiv({ text: mark.lineText ?? '', cls: 'jp-follow-debrief-line' });
      if (mark.kind === 'speak' && line) {
        // the ACTUAL response — what the speaker really said next (§25.5)
        const actual = this.lines.slice(idx + 1, idx + 3);
        if (actual.length) {
          const a = card.createDiv('jp-follow-debrief-actual');
          a.createDiv({ text: '実際の続き:', cls: 'jp-follow-debrief-label' });
          for (const l of actual) {
            const r = a.createDiv('jp-follow-debrief-actualline');
            if (l.speaker) r.createSpan({ text: l.speaker, cls: 'jp-follow-speaker' });
            r.createSpan({ text: l.text });
          }
        }
      }
      if (mark.kind === 'speak') {
        this.renderRatingRow(card, s, mark, () => { /* stays open in debrief */ });
      }
      const act = card.createDiv('jp-follow-debrief-actions');
      const cap = act.createEl('button', { text: '🏷️ 分類', cls: 'jp-follow-btn' });
      cap.onclick = () => this.captureAt(idx >= 0 ? idx : this.nowIdx, mark.lineText ?? '');
      // §25.4: cut the 📺 scene at this mark from the still-synced Plex session.
      if (this.deps.plexClip && this.plexPartKey && mark.tSec != null) {
        const clip = act.createEl('button', { text: '🎬 クリップ', cls: 'jp-follow-btn' });
        clip.onclick = async () => {
          clip.disabled = true; clip.setText('…');
          const r = await this.deps.plexClip!(this.plexPartKey!, mark.tSec!, mark.seed || mark.lineText || 'mark').catch(() => null);
          clip.setText(r?.audio || r?.still ? '✓ 切り出し' : '✗ 失敗');
        };
      }
    }
  }

  private captureAt(idx: number, fallbackText: string): void {
    const line = idx >= 0 && idx < this.lines.length ? this.lines[idx] : null;
    const before = line ? this.lines.slice(Math.max(0, idx - 3), idx) : [];
    const after = line ? this.lines.slice(idx + 1, idx + 4) : [];
    this.deps.openCapture({
      text: '',
      example: line?.text ?? fallbackText,
      contextBefore: before.map((l) => l.text),
      contextAfter: after.map((l) => l.text),
      speakers: line ? [...before, line, ...after].map((l) => l.speaker ?? null) : undefined,
      source: {
        kind: 'yt', file: this.filePath ?? undefined, tStartSec: line?.tStartSec ?? null,
        medium: this.medium, sourceName: this.sourceName,
      },
    });
  }
}
