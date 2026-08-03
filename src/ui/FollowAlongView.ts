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
import { fmtStamp, fmtDur } from '../notes/srt.ts';
import { syncClock, pauseClock, resumeClock, clockPosition, currentLineIndex, type FollowClock } from '../notes/follow.ts';
import { pickPlexSession, type PlexSessionsResult, type PlexSession, type PlexCommand } from '../notes/plex.ts';

/** Stable identity for a mark across re-renders (the objects are rebuilt). */
const markKey = (m: SessionMark): string => `${m.kind}:${m.tSec ?? ''}:${m.lineIndex ?? ''}`;
import {
  SPEAK_MODES, newSession, newMark, sessionPoints, speakMarks,
  type SpeakStore, type SpeakSession, type SpeakMode, type SpeakConstraint, type SessionMark,
} from '../notes/speak-session.ts';
import type { MarkRef } from '../notes/inbox.ts';
import type { CaptureContext } from './CaptureModal.ts';
import { armDrops, armSelectionEcho, type ViewChrome } from './view-chrome.ts';
// The discourse calculus (DISCOURSE-CALCULUS.md): pure fold → live board.
// 🔴 study = next-move prediction on the affordance set (FABLE-BRIEF §4.3).
import { reduce, affordances } from '../discourse/calculus/scoreboard.mjs';
import { recognizeEvents } from '../discourse/calculus/moves.mjs';
import { transcriptToTurns } from '../discourse/calculus/turns.mjs';
import { buildDrillCases, drillBaseline, caseAtOrAfter } from '../discourse/drill.mjs';
import type { DrillCase as PureDrillCase } from '../discourse/drill.mjs';

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
interface BoardSnap { tSec: number | null; cg: number; table: number; projected: string[]; qud: string[]; shelved: number; prims: string[] }
interface BoardMove { tSec: number | null; speaker: string; prim: string; ref: string }

/** A case from `discourse/drill.mjs` plus the learner's answer. The case shape
 *  itself is NOT redeclared here — it is imported, so the view cannot drift
 *  from the module that guarantees the option set is answer-blind. */
type DrillCase = PureDrillCase & { picked?: string; revealed?: boolean };
/** The floors, so a score is never shown without what it must beat. */
interface DrillFloors { n: number; chance: number; marginal: number; optionOnly: number; topPrim: string | null }

/** §25.1 — one mark made during this watch. `cardId` is the tray card it became,
 *  so a clip cut here can be written back onto it. */
export interface WatchMark {
  cardId: string | null;
  tSec: number | null;
  lineIndex: number | null;
  lineText: string;
  seed: string | null;
  at: number;
  clip?: { audio?: string; still?: string };
}

export interface FollowDeps {
  parse: (md: string) => MatcherLine[];
  /** §25.1: a 📍 lands in the tray for harvest. Returns the tray card's id so a
   *  clip cut against the mark can be written back onto that very card. */
  addTrayMark: (m: MarkRef) => Promise<string>;
  /** Marks already dropped against this note, so reopening resumes rather than
   *  presenting an empty panel and implying they were lost. */
  marksForFile?: (path: string | null) => WatchMark[];
  /** Persist a clip onto the tray card a mark became. */
  attachMarkClip?: (cardId: string, clip: { audio?: string; still?: string }) => Promise<void>;
  /** Persist an edited note onto the tray card a mark became. */
  setMarkNote?: (cardId: string, text: string) => Promise<void>;
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
  /** §25.4: which Plex item this note was cut from, off its own frontmatter. */
  plexIdentity?: (file: TFile) => { partKey: string | null; ratingKey: string | null };
  /** §25.4c: relay a transport command to the client playing the session. */
  plexCommand?: (
    targetId: string,
    command: PlexCommand,
    params?: Record<string, string | number | undefined>,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** §25.4b: `sub_offset_sec` — seconds to add to this note's stamps to reach
   *  the video's clock. Nonzero when the subtitle came from jimaku, not the file. */
  subOffset?: (file: TFile) => number;
  /** persist a recalibrated offset back into the note's frontmatter. */
  saveSubOffset?: (path: string, sec: number) => Promise<void>;
  /** §29 the drag road (see ui/view-chrome.ts). */
  onDrop?: ViewChrome['onDrop'];
  dropCan?: ViewChrome['dropCan'];
  /**
   * AUDIT §6.5 — record one 予測 answer against the calculus's own.
   *
   * The drill has always produced exactly this datum and always thrown it away
   * the moment the panel closed: options built from board state alone, a human
   * pick, and the primitive the calculus says fires next. It is not parser gold
   * — at a freeze point a disagreement is usually the learner — but a claim the
   * learner refuses the SAME WAY repeatedly is a place worth going to look, and
   * that pattern cannot appear if the answers are never written down.
   */
  recordDrill?: (scope: string, caseId: string, claim: string, picked: string) => void;
}

const LONG_PRESS_MS = 550;
const SCROLL_HOLD_MS = 8000;
// §25.4c Plex poll cadence. Playing is tight so a seek lands in about a second;
// paused and idle back right off, because nothing is moving.
const PLEX_POLL_PLAYING_MS = 2500;
const PLEX_POLL_PAUSED_MS = 8000;
const PLEX_POLL_IDLE_MS = 15000;
/** How far the server may disagree with the local clock before we re-anchor.
 *  Below this the difference is Plex's reporting granularity, not a seek. */
const PLEX_RESYNC_SLOP_SEC = 2.5;

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

  /**
   * Clips cut at a mark, so the capture made from that mark can carry them.
   * Keyed by the mark's own coordinates rather than object identity, because
   * the mark objects are rebuilt from the session store on every render.
   */
  private clipAt = new Map<string, { audio?: string; still?: string }>();
  // §25.4 Plex clock (b): when on, the transcript follows the server's playback.
  private plexSyncOn = false;
  private plexPollId: number | null = null;
  /** Current poll interval, so armPlexPoll can avoid churning timers. */
  private plexPollMs: number | null = null;
  /** Part key of the session we're following — the door for clip cutting. */
  private plexPartKey: string | null = null;
  /** Plex item id off the note's frontmatter — how a session is recognised as
   *  "the one this note is about" without guessing from titles. */
  private plexRatingKey: string | null = null;
  /**
   * §25.4c — the transport strip's numbers. `plexDuration` comes off the
   * session (or the note's own metadata) so the progress bar has a scale;
   * `plexPaused` mirrors the server so the bar can stop lying while the
   * interpolating clock is frozen.
   */
  private plexDuration: number | null = null;
  private plexPaused = false;
  /**
   * Last viewOffset the server reported, and when. A seek shows up as a
   * viewOffset that disagrees with what a steadily-playing clock predicts;
   * without this, a scrub-back sits wrong for as long as the interpolation
   * takes to be overwritten, which reads as "the sync is broken".
   */
  private plexLastOffset: number | null = null;
  private plexLastOffsetAt = 0;
  /** Sessions from the last poll, and the one the user pinned by hand. */
  private plexSessions: PlexSession[] = [];
  private plexBoundKey: string | null = null;
  private pickingSession = false;
  /** The session currently followed — kept for the transport's player name. */
  private plexSession: PlexSession | null = null;
  /** Transport DOM, repainted in place by the tick rather than re-rendered. */
  private transportEl: HTMLElement | null = null;
  private transportTimeEl: HTMLElement | null = null;
  /** Which player the transport was BUILT for, so it can notice a new one and
   *  grow its ⏯ buttons without waiting for an unrelated re-render. */
  private transportPlayerId: string | null = null;
  private transportPaused: boolean | null = null;
  /**
   * §25.1 — marks made during THIS watch, held in view order so the panel can
   * show them, cut their clips and hand them to capture. The tray is still the
   * durable home (dropMark writes there first); this is the working set,
   * re-seeded from the tray on load so closing the view loses nothing.
   */
  private marks: WatchMark[] = [];
  private marksOn = false;
  /**
   * §25.4b — seconds to add to this transcript's stamps to reach the video's
   * clock. A jimaku subtitle is timed to the release its uploader had; the
   * file on the Plex server can carry a different intro, a distributor logo,
   * or ad breaks. Ten seconds out is enough to make 鑑賞モード useless while
   * looking like it works, so it is correctable — and correctable BY HAND,
   * from the one thing the user always knows: which line is being said now.
   */
  private subOffsetSec = 0;
  /** true while the next line tap means "this is playing right now". */
  private aligning = false;

  // 🔴 談話ボード: computed lazily from the raw md on first toggle.
  private rawMd = '';
  private boardOn = false;
  private snaps: BoardSnap[] = [];       // per-turn board snapshots (surface order)
  private moves: BoardMove[] = [];       // full move log
  private afford: Map<number, string[]> = new Map();  // turn idx → afforded prims for NEXT mover
  private turnTexts: Array<{ tSec: number | null; speaker: string | null; text: string }> = [];
  private drill: DrillCase | null = null;
  /** Every legitimate freeze point, precomputed with the board (drill.mjs). */
  private drillCases: DrillCase[] = [];
  /** What a score has to beat to mean anything — shown next to it, always. */
  private drillFloors: DrillFloors | null = null;
  /** This session's running tally, so the floors have something to sit beside. */
  private drillScore = { asked: 0, right: 0 };
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
      void this.maybeAutoBind();
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
    this.plexRatingKey = null;
    this.plexSession = null;
    this.plexDuration = null;
    this.plexPaused = false;
    this.plexLastOffset = null;
    this.plexLastOffsetAt = 0;
    this.plexSessions = [];
    this.plexBoundKey = null;
    this.pickingSession = false;
    this.clipAt = new Map();
    this.marks = [];
    this.marksOn = false;
    this.aligning = false;
    this.subOffsetSec = 0;
    const f = this.filePath ? this.app.vault.getFileByPath(this.filePath) : null;
    if (!f) return;
    this.subOffsetSec = this.deps.subOffset?.(f) ?? 0;
    const md = await this.app.vault.cachedRead(f);
    this.lines = this.deps.parse(md);
    this.rawMd = md;
    this.boardOn = false;
    this.snaps = [];
    this.moves = [];
    this.afford = new Map();
    this.turnTexts = [];
    this.drill = null;
    this.drillCases = [];
    this.drillFloors = null;
    this.drillScore = { asked: 0, right: 0 };
    this.boardSnapIdx = -1;
    const src = this.deps.mediumOf(f);
    this.medium = src.medium;
    this.sourceName = src.sourceName;
    /**
     * §25.4 — the note already records which Plex Part it was cut from, so the
     * 🎬 cutter has its door open from the moment the file loads. Before this,
     * partKey only arrived via a successful poll, which meant clips silently
     * did not exist unless you happened to be syncing at that moment — the
     * single most confusing thing about the whole clip path.
     */
    const ident = this.deps.plexIdentity?.(f);
    if (ident?.partKey) this.plexPartKey = ident.partKey;
    this.plexRatingKey = ident?.ratingKey ?? null;
    /**
     * Marks already dropped against this note. The tray is the durable home, so
     * reopening 鑑賞モード picks up where you left off rather than presenting an
     * empty panel and implying the marks were lost. The tray only keeps the
     * timestamp, so the line it belongs to is re-derived here — the same lookup
     * `resolveMarkContext` does, done once instead of per row.
     */
    this.marks = this.deps.marksForFile?.(this.filePath) ?? [];
    for (const m of this.marks) {
      if (m.tSec != null) {
        const idx = currentLineIndex(this.lines, m.tSec);
        if (idx >= 0) { m.lineIndex = idx; m.lineText = this.lines[idx].text; }
      }
      if (m.clip) this.clipAt.set(this.markRowKey(m), m.clip);
    }
  }

  /**
   * One silent poll on open: if the episode this note belongs to is already
   * playing, follow it without being asked. The gate is deliberately narrow —
   * an identified session, or exactly one thing playing that matches by name —
   * because auto-following the WRONG session is worse than not auto-following.
   */
  private async maybeAutoBind(): Promise<void> {
    if (this.plexSyncOn || !this.deps.plexPoll || !this.deps.plexEnabled?.()) return;
    if (!this.plexRatingKey && !this.plexPartKey) return;
    const res = await this.deps.plexPoll().catch(() => null);
    if (!res?.ok || !res.sessions.length || this.plexSyncOn) return;
    const mine = res.sessions.filter((s) =>
      (this.plexRatingKey && s.ratingKey === this.plexRatingKey) ||
      (this.plexPartKey && s.partKey === this.plexPartKey));
    const s = mine.length === 1
      ? mine[0]
      : pickPlexSession(res.sessions, { title: this.sourceName, show: this.sourceName });
    if (!s) return;
    this.plexBoundKey = s.ratingKey ?? s.partKey ?? null;
    this.togglePlexSync();
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
      // Freeze points and their floors are properties of the fold, so they are
      // computed once here rather than per question — and the floors exist at
      // all only so the UI can never show a score without them (§4 defect 3).
      const built = buildDrillCases({ turns, snaps: board.turns, afford });
      this.drillCases = built.cases as DrillCase[];
      const b = drillBaseline(this.drillCases);
      this.drillFloors = { n: b.n, chance: b.chance, marginal: b.marginal, optionOnly: b.optionOnly, topPrim: b.topPrim };
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

  /**
   * Freeze here → which move does the speaker make next?
   *
   * The cases and their option sets come from `discourse/drill.mjs`, which
   * builds them from board state ALONE. This method deliberately does no option
   * assembly of its own: the previous version built the set here by inserting
   * the answer first and topping up from a fixed-order list, which leaked the
   * answer through set membership and left the constitution's acceptance
   * criterion unable to return a result (DISCOURSE-VERDICT §4).
   */
  private makeDrill(): void {
    const pos = clockPosition(this.clock, Date.now())
      ?? (this.focusIdx >= 0 ? this.lines[this.focusIdx]?.tStartSec ?? 0 : 0);
    const next = caseAtOrAfter(this.drillCases, pos);
    if (!next) { new Notice('この先にドリル対象の手がありません'); return; }
    this.drill = { ...next };
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
      text: `次の一手 — ${fmtStamp(d.atSec ?? 0)} で凍結。${d.speaker || '話者'} の次の手は？`,
      cls: 'jp-follow-drill-q',
    });
    const row = box.createDiv('jp-follow-drill-opts');
    for (const p of d.options) {
      const b = row.createEl('button', {
        text: `${PRIM_JA[p] ?? p}`,
        cls: 'jp-follow-chipbtn' +
          (d.revealed ? (p === d.answerPrim ? ' is-on' : (p === d.picked ? ' is-bad' : '')) : ''),
      });
      b.title = p;
      b.onclick = () => {
        if (d.revealed) return;
        d.picked = p; d.revealed = true;
        this.drillScore.asked++;
        if (p === d.answerPrim) this.drillScore.right++;
        // §6.5 — the answer goes into the ledger before the panel can forget it.
        // The freeze index keys the case: it is stable across re-openings of the
        // same file, so answering the same question twice overwrites rather than
        // counting twice.
        this.deps.recordDrill?.(this.filePath ?? 'drill', `t${d.freezeIdx}`, d.answerPrim, p);
        this.render();
      };
    }
    if (d.revealed) {
      const ok = d.picked === d.answerPrim;
      const r = box.createDiv('jp-follow-drill-reveal');
      r.createSpan({ text: ok ? '○ ' : '× ', cls: ok ? 'jp-follow-drill-ok' : 'jp-follow-drill-ng' });
      r.createSpan({
        text: `${d.answerSec != null ? fmtStamp(d.answerSec) : ''} ${PRIM_JA[d.answerPrim] ?? d.answerPrim}（${d.answerPrim}）`,
      });
      box.createDiv({ text: d.text.slice(0, 120), cls: 'jp-follow-drill-line' });
      this.renderDrillFloors(box);
      const acts = box.createDiv('jp-follow-drill-acts');
      const again = acts.createEl('button', { text: 'もう一問', cls: 'jp-follow-btn' });
      again.onclick = () => {
        // continue from just past this case so the next question advances
        const from = d.answerSec ?? d.atSec;
        this.clock = this.clock ?? (from != null ? syncClock(from, Date.now()) : null);
        this.drill = null;
        const save = clockPosition(this.clock, Date.now());
        if (from != null && (save == null || save <= from)) this.clock = syncClock(from + 1, Date.now());
        this.makeDrill();
      };
      const close = acts.createEl('button', { text: '閉じる', cls: 'jp-follow-btn' });
      close.onclick = () => { this.drill = null; this.render(); };
    }
  }

  /**
   * The score is never shown alone. §4's third defect was that a drill result
   * was presented with nothing to read it against, so 70%-by-guessing looked
   * like understanding. `marginal` is the honest bar — what you score by always
   * answering the commonest move and reading nothing at all.
   */
  private renderDrillFloors(host: HTMLElement): void {
    const f = this.drillFloors;
    if (!f || !f.n) return;
    const pct = (x: number) => `${Math.round(100 * x)}%`;
    const line = host.createDiv('jp-follow-drill-floor');
    const { asked, right } = this.drillScore;
    if (asked) {
      const beating = right / asked >= f.marginal;
      line.createSpan({
        text: `あなた ${right}/${asked}（${pct(right / asked)}）`,
        cls: beating ? 'jp-follow-drill-ok' : 'jp-follow-drill-ng',
      });
      line.createSpan({ text: ' · ' });
    }
    line.createSpan({
      text: `基準線: でたらめ ${pct(f.chance)} → 「${PRIM_JA[f.topPrim ?? ''] ?? f.topPrim}」と答え続ける ${pct(f.marginal)}`
        + ` → 選択肢だけ読む ${pct(f.optionOnly)}（${f.n}問）`,
    });
    line.title = 'この基準線を超えて初めて、盤面を読めていると言えます。'
      + '「〜と答え続ける」は日本語も盤面も一切読まずに取れる点数です。';
  }

  private hasStamps(): boolean {
    return this.lines.some((l) => l.tStartSec != null);
  }

  // ── the clock ─────────────────────────────────────────────────────────────

  private tick(): void {
    const pos = clockPosition(this.clock, Date.now());
    if (pos == null) return;
    this.updateTransport();
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
    void this.pollPlex();                                    // sync at once, then on cadence
    this.armPlexPoll(PLEX_POLL_PLAYING_MS);
    this.render();
  }

  /**
   * §25.4c — the poll cadence follows what the server is doing. Playing needs a
   * tight leash (a seek should land in about a second, not five); paused needs
   * almost none. One interval at a time, re-armed when the state changes, so
   * following a two-hour episode costs a fraction of what a fixed 5s costs.
   */
  private armPlexPoll(everyMs: number): void {
    if (this.plexPollMs === everyMs && this.plexPollId != null) return;
    if (this.plexPollId != null) window.clearInterval(this.plexPollId);
    this.plexPollMs = everyMs;
    const id = window.setInterval(() => void this.pollPlex(), everyMs);
    this.plexPollId = id;
    this.registerInterval(id);
  }

  private stopPlexPoll(): void {
    if (this.plexPollId != null) { window.clearInterval(this.plexPollId); this.plexPollId = null; }
    this.plexPollMs = null;
    this.plexSyncOn = false;
  }

  /** The session this note follows: the one the user pinned, else the one whose
   *  Plex identity matches the note's frontmatter, else a title match. */
  private pickSession(sessions: PlexSession[]): PlexSession | null {
    if (this.plexBoundKey) {
      const pinned = sessions.find((s) => (s.ratingKey ?? s.partKey) === this.plexBoundKey);
      if (pinned) return pinned;
    }
    if (this.plexRatingKey || this.plexPartKey) {
      const byId = sessions.find((s) =>
        (this.plexRatingKey && s.ratingKey === this.plexRatingKey) ||
        (this.plexPartKey && s.partKey === this.plexPartKey));
      if (byId) return byId;
    }
    return pickPlexSession(sessions, { title: this.sourceName, show: this.sourceName }) ?? null;
  }

  /** Pin a live session by hand — the answer to "several things are playing and
   *  none of them looks like this note". */
  private bindSession(s: PlexSession): void {
    this.plexBoundKey = s.ratingKey ?? s.partKey ?? null;
    this.plexPartKey = s.partKey ?? this.plexPartKey;
    this.pickingSession = false;
    this.clock = null;
    if (!this.plexSyncOn) this.togglePlexSync();
    else { void this.pollPlex(); this.render(); }
  }

  /** One poll: pick the session this note follows, re-anchor the clock to its
   *  viewOffset (pause-aware). Any error degrades soft — clock (c) still works. */
  private async pollPlex(): Promise<void> {
    if (!this.plexSyncOn || !this.deps.plexPoll) return;
    // A leaf nobody is looking at does not need the network. The interpolating
    // clock covers the gap and the next visible poll re-anchors it.
    if (typeof this.contentEl.isShown === 'function' && !this.contentEl.isShown()) return;
    const res = await this.deps.plexPoll();
    if (!this.plexSyncOn) return;
    if (!res.ok) { this.plexSessions = []; this.setPlexChip(`⚠ ${res.error}`, true); return; }
    this.plexSessions = res.sessions;
    if (!res.sessions.length) {
      this.setPlexChip('Plex — 再生中なし', true);
      this.armPlexPoll(PLEX_POLL_IDLE_MS);
      return;
    }
    const s = this.pickSession(res.sessions);
    if (!s) {
      this.setPlexChip(`再生中${res.sessions.length}件 — タップして選ぶ`, true);
      this.armPlexPoll(PLEX_POLL_IDLE_MS);
      return;
    }
    const now = Date.now();
    this.plexPartKey = s.partKey ?? this.plexPartKey ?? null;
    this.plexBoundKey = s.ratingKey ?? s.partKey ?? this.plexBoundKey;
    if (s.durationSec) this.plexDuration = s.durationSec;
    // The server reports where the VIDEO is; the transcript's stamps are the
    // SUBTITLE's clock. Subtract the offset to move between them.
    const serverPos = s.viewOffsetSec - this.subOffsetSec;
    const localPos = clockPosition(this.clock, now);
    const pausedChanged = s.paused !== this.plexPaused;
    /**
     * Plex reports viewOffset coarsely — a client can sit on the same number for
     * several seconds. Re-anchoring on EVERY poll therefore dragged the
     * highlighted line a second or two backwards and forwards, which looks
     * exactly like a broken sync. Trust the local clock between polls; re-anchor
     * only when the server genuinely disagrees — a seek, a pause, a first sync.
     */
    if (localPos == null || pausedChanged || Math.abs(localPos - serverPos) > PLEX_RESYNC_SLOP_SEC) {
      this.clock = syncClock(serverPos, now);
      if (s.paused) this.clock = pauseClock(this.clock, now);
    }
    this.plexPaused = s.paused;
    this.plexSession = s;
    this.plexLastOffset = s.viewOffsetSec;
    this.plexLastOffsetAt = now;
    this.setPlexChip(`${s.paused ? '⏸' : '▶'} ${s.title}`, false);
    this.armPlexPoll(s.paused ? PLEX_POLL_PAUSED_MS : PLEX_POLL_PLAYING_MS);
    this.updateClockChip();
    this.syncTransportShape();
    this.updateTransport();
    this.tick();
  }

  /**
   * §25.4b ズレ合わせ — the tapped line is what is being said RIGHT NOW, so
   * the gap between the video's position and that line's stamp IS the offset.
   * One tap, one number, written into the note; the next poll uses it.
   *
   * Deliberately a separate mode rather than an overloaded tap: a tap already
   * means 📍マーク, and a gesture that silently means two things depending on
   * hidden state is how you get marks scattered at the wrong timestamps.
   */
  private async alignTo(line: MatcherLine): Promise<void> {
    this.aligning = false;
    const pos = clockPosition(this.clock, Date.now());
    if (line.tStartSec == null || pos == null) {
      new Notice('この行には時刻がありません', 3000);
      this.render();
      return;
    }
    // pos is already offset-corrected, so the correction is cumulative.
    const delta = pos - line.tStartSec;
    this.subOffsetSec = Math.round((this.subOffsetSec + delta) * 10) / 10;
    this.clock = syncClock(line.tStartSec, Date.now());
    if (this.filePath) await this.deps.saveSubOffset?.(this.filePath, this.subOffsetSec);
    new Notice(
      `⌖ ズレを ${this.subOffsetSec > 0 ? '+' : ''}${this.subOffsetSec}s に設定しました`
      + '（ノートの sub_offset_sec に保存）', 5000,
    );
    this.render();
  }

  private setPlexChip(text: string, warn: boolean): void {
    const chip = this.contentEl.querySelector<HTMLElement>('.jp-follow-plexchip');
    if (!chip) return;
    chip.setText(text);
    chip.toggleClass('is-on', this.plexSyncOn && !warn);
    chip.toggleClass('is-warn', warn);
  }

  // ── §25.4c the transport ──────────────────────────────────────────────────

  /**
   * Where the clock is, drawn to scale. The point is not decoration: 鑑賞モード
   * had no way to say "you are 12 minutes into a 24 minute episode", so there
   * was no way to tell a sync that is 8 seconds out from one that is following a
   * completely different episode. A bar makes the second case obvious instantly.
   */
  private renderTransport(root: HTMLElement): HTMLElement {
    const wrap = root.createDiv('jp-follow-transport');
    const time = wrap.createDiv({ cls: 'jp-follow-tp-time' });
    const bar = wrap.createDiv('jp-follow-tp-bar');
    bar.createDiv('jp-follow-tp-fill');
    bar.title = 'タップでこの位置へ（同期中ならプレイヤーも動かします）';
    bar.onclick = (e) => {
      if (!this.plexDuration) return;
      const box = bar.getBoundingClientRect();
      if (box.width <= 0) return;
      const frac = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
      void this.seekTo(frac * this.plexDuration);
    };
    // Remote control only exists if a client claimed the session and said who it
    // is. Absent that, the bar still moves the transcript — degrade soft.
    const pid = this.plexSession?.playerId;
    if (this.plexSyncOn && pid && this.deps.plexCommand) {
      const acts = wrap.createDiv('jp-follow-tp-acts');
      const btn = (label: string, title: string, fn: () => void): HTMLButtonElement => {
        const b = acts.createEl('button', { text: label, cls: 'jp-follow-tp-btn', attr: { title } });
        b.onclick = fn;
        return b;
      };
      btn('⏪', '10秒戻す', () => void this.nudgePlayback(-10));
      btn(this.plexPaused ? '▶' : '⏸', this.plexPaused ? '再生' : '一時停止',
        () => void this.sendPlex(this.plexPaused ? 'play' : 'pause'));
      btn('⏩', '10秒進める', () => void this.nudgePlayback(10));
      acts.createSpan({
        text: this.plexSession?.playerName ?? this.plexSession?.playerProduct ?? '',
        cls: 'jp-follow-tp-player',
      });
    }
    this.transportEl = wrap;
    this.transportTimeEl = time;
    this.transportPlayerId = pid ?? null;
    this.transportPaused = this.plexPaused;
    this.updateTransport();
    return wrap;
  }

  /**
   * The transport is built from the session, but polls only repaint it. So when a
   * poll first learns which client is playing — or that it just paused — the
   * strip has to be rebuilt in place, or the ⏯ buttons never appear until some
   * unrelated thing happens to re-render the whole view.
   */
  private syncTransportShape(): void {
    const wrap = this.transportEl;
    if (!wrap || !wrap.isConnected) return;
    const pid = this.plexSession?.playerId ?? null;
    if (pid === this.transportPlayerId && this.plexPaused === this.transportPaused) return;
    const host = createDiv();
    const fresh = this.renderTransport(host as HTMLElement);
    if (fresh) {
      wrap.replaceWith(fresh);
      // renderTransport painted while still detached, so paint again now that
      // the strip is in the document — otherwise it shows blank for one tick.
      this.updateTransport();
    }
  }

  /** Repaint the bar in place — called from the 500ms tick, so no DOM churn. */
  private updateTransport(): void {
    const wrap = this.transportEl;
    if (!wrap || !wrap.isConnected) return;
    const pos = clockPosition(this.clock, Date.now());
    const dur = this.plexDuration;
    const fill = wrap.querySelector<HTMLElement>('.jp-follow-tp-fill');
    if (fill) {
      const frac = pos != null && dur ? Math.max(0, Math.min(1, pos / dur)) : 0;
      fill.style.width = `${(frac * 100).toFixed(2)}%`;
    }
    this.transportTimeEl?.setText(
      pos == null ? '未同期' : dur ? `${fmtDur(pos)} / ${fmtDur(dur)}` : fmtDur(pos),
    );
    wrap.toggleClass('is-paused', !!this.clock && this.clock.pausedAtTSec != null);
    wrap.toggleClass('is-live', this.plexSyncOn && !this.plexSession?.paused);
  }

  /** Move to a transcript position; take the player with us when we can. */
  private async seekTo(posSec: number): Promise<void> {
    const at = Math.max(0, posSec);
    this.clock = syncClock(at, Date.now());
    this.updateClockChip();
    this.updateTransport();
    this.tick();
    if (this.plexSyncOn && this.deps.plexCommand) {
      await this.sendPlex('seekTo', { offset: Math.round((at + this.subOffsetSec) * 1000) });
    }
  }

  private async nudgePlayback(deltaSec: number): Promise<void> {
    const pos = clockPosition(this.clock, Date.now());
    if (pos == null) return;
    await this.seekTo(Math.max(0, pos + deltaSec));
  }

  /** Fire one Companion command. Optimistic locally, honest when it fails. */
  private async sendPlex(
    command: PlexCommand,
    params?: Record<string, string | number | undefined>,
  ): Promise<void> {
    const pid = this.plexSession?.playerId;
    if (!pid || !this.deps.plexCommand) return;
    if (command === 'pause' || command === 'play') {
      const paused = command === 'pause';
      this.clock = this.clock
        ? (paused ? pauseClock(this.clock, Date.now()) : resumeClock(this.clock, Date.now()))
        : this.clock;
      this.plexPaused = paused;
      this.updateClockChip();
      this.updateTransport();
    }
    const r = await this.deps.plexCommand(pid, command, params)
      .catch((e: { message?: string }) => ({ ok: false as const, error: String(e?.message ?? e) }));
    if (!r?.ok) {
      new Notice(
        `プレイヤーを操作できませんでした（${(r as { error?: string })?.error ?? '不明'}）。\n` +
        `このクライアントはリモート操作に応じない設定かもしれません — 字幕側の位置だけ動かしました。`,
        7000,
      );
      return;
    }
    // The server accepted it; ask what actually happened rather than assuming.
    window.setTimeout(() => void this.pollPlex(), 700);
  }

  /**
   * §25.4b — small, known drift without the tap-align dance. Aligning by tapping
   * a line is exact but needs you to catch a line as it is spoken; when you
   * already know it is "about a second late", saying so directly is faster.
   */
  private async nudgeOffset(deltaSec: number): Promise<void> {
    const pos = clockPosition(this.clock, Date.now());
    this.subOffsetSec = Math.round((this.subOffsetSec + deltaSec) * 10) / 10;
    if (pos != null) this.clock = syncClock(pos - deltaSec, Date.now());
    if (this.filePath) await this.deps.saveSubOffset?.(this.filePath, this.subOffsetSec);
    const chip = this.contentEl.querySelector<HTMLElement>('.jp-follow-alignchip');
    chip?.setText(`⌖ ズレ${this.subOffsetSec ? ` ${this.subOffsetSec > 0 ? '+' : ''}${this.subOffsetSec}s` : ''}`);
    this.updateClockChip();
    this.updateTransport();
    this.tick();
  }

  /** Several things are playing and none of them is obviously this note: say so
   *  as a list of choices instead of as a dead end. */
  private renderSessionPicker(root: HTMLElement): void {
    const box = root.createDiv('jp-follow-picker');
    box.createDiv({ text: 'どれを追いますか', cls: 'jp-follow-picker-title' });
    if (!this.plexSessions.length) {
      box.createDiv({ text: '再生中のセッションがありません。', cls: 'jp-follow-picker-empty' });
    }
    for (const s of this.plexSessions) {
      const row = box.createDiv('jp-follow-picker-row');
      const main = row.createDiv('jp-follow-picker-main');
      main.createDiv({ text: s.title, cls: 'jp-follow-picker-name' });
      const bits: string[] = [];
      if (s.show) bits.push(s.show);
      if (s.seasonIndex != null && s.episodeIndex != null) {
        bits.push(`S${String(s.seasonIndex).padStart(2, '0')}E${String(s.episodeIndex).padStart(2, '0')}`);
      }
      bits.push(`${s.paused ? '⏸' : '▶'} ${fmtDur(s.viewOffsetSec)}`);
      if (s.playerName) bits.push(s.playerName);
      main.createDiv({ text: bits.join(' · '), cls: 'jp-follow-picker-sub' });
      const pick = row.createEl('button', { text: 'これ', cls: 'jp-follow-btn' });
      pick.onclick = () => this.bindSession(s);
    }
    const close = box.createEl('button', { text: '閉じる', cls: 'jp-follow-btn' });
    close.onclick = () => { this.pickingSession = false; this.render(); };
  }

  // ── §25.1 the marks made while watching ───────────────────────────────────

  private markRowKey(m: WatchMark): string {
    return `note:${m.tSec ?? ''}:${m.lineIndex ?? ''}`;
  }

  private updateMarksChip(): void {
    const chip = this.contentEl.querySelector<HTMLElement>('.jp-follow-markschip');
    chip?.setText(`📝 マーク${this.marks.length ? ` ${this.marks.length}` : ''}`);
  }

  private repaintMarks(): void {
    const panel = this.contentEl.querySelector<HTMLElement>('.jp-follow-marks');
    if (!panel) return;
    const fresh = createDiv();
    this.renderMarksPanel(fresh as HTMLElement);
    const next = fresh.firstChild as HTMLElement | null;
    if (next) panel.replaceWith(next);
    this.updateMarksChip();
  }

  /**
   * The working set of this watch: what you noticed, in the order you noticed
   * it, each row one tap from its clip and one tap from a card.
   *
   * This is the piece 鑑賞モード was missing. A 📍 used to vanish into the tray
   * with no trace on the surface that made it, so the clip cutter — the whole
   * reason the Part key is tracked — was reachable only from a 発話セッション
   * debrief. Marks are the unit of "capture while watching", so they get a
   * first-class home next to the transcript that produced them.
   */
  private renderMarksPanel(root: HTMLElement): void {
    const box = root.createDiv('jp-follow-marks');
    const head = box.createDiv('jp-follow-marks-head');
    head.createSpan({ text: `📝 今回のマーク ${this.marks.length}`, cls: 'jp-follow-marks-title' });
    const canClip = !!(this.deps.plexClip && this.plexPartKey);
    if (canClip && this.marks.some((m) => m.tSec != null && !this.clipAt.get(this.markRowKey(m)))) {
      const all = head.createEl('button', { text: '🎬 全部切り出す', cls: 'jp-follow-btn' });
      all.title = 'まだ切り出していないマークの音声＋静止画を順番に切り出します（ffmpeg）。';
      all.onclick = async () => {
        all.disabled = true;
        const todo = this.marks.filter((m) => m.tSec != null && !this.clipAt.get(this.markRowKey(m)));
        let done = 0;
        for (const m of todo) {
          all.setText(`🎬 ${done + 1}/${todo.length}…`);
          if (await this.clipMark(m, true)) done++;
        }
        new Notice(`🎬 ${done}/${todo.length} 件を切り出しました`, 6000);
        this.repaintMarks();
      };
    }
    if (this.marks.length) {
      const clear = head.createEl('button', { text: '✕', cls: 'jp-follow-btn' });
      clear.title = 'この一覧を空にします（収集トレイのマークは消えません）。';
      clear.onclick = () => { this.marks = []; this.repaintMarks(); };
    }
    if (!this.marks.length) {
      box.createDiv({
        text: '行をタップすると 📍 が落ちます。長押し（または n キー）で気づきを書き添えられます。',
        cls: 'jp-follow-marks-empty',
      });
      return;
    }
    for (const m of [...this.marks].reverse()) this.renderMarkRow(box, m);
  }

  private renderMarkRow(box: HTMLElement, m: WatchMark): void {
    const key = this.markRowKey(m);
    const clip = this.clipAt.get(key);
    const row = box.createDiv('jp-follow-mark');
    const top = row.createDiv('jp-follow-mark-top');
    if (m.tSec != null) {
      const at = m.tSec;
      const jump = top.createEl('button', { text: fmtStamp(at), cls: 'jp-follow-mark-stamp' });
      jump.title = 'この時刻へ';
      jump.onclick = () => void this.seekTo(at);
    }
    if (m.seed) top.createSpan({ text: m.seed, cls: 'jp-follow-mark-seed' });
    if (clip) {
      top.createSpan({
        text: [clip.still && '🖼', clip.audio && '🎧'].filter(Boolean).join(''),
        cls: 'jp-follow-mark-has',
      });
    }
    if (m.lineText?.trim()) row.createDiv({ text: m.lineText, cls: 'jp-follow-mark-line' });
    const acts = row.createDiv('jp-follow-mark-acts');
    // The note is editable after the fact: watching is a bad time to write, and
    // a seed you cannot fix later is a seed you do not write at all.
    const edit = acts.createEl('button', { text: m.seed ? '✎' : '✎ 書く', cls: 'jp-follow-btn' });
    edit.title = '気づきを書く／直す';
    edit.onclick = () => this.editMarkNote(row, m);
    if (this.deps.plexClip && this.plexPartKey && m.tSec != null) {
      const cut = acts.createEl('button', { text: clip ? '🎬 再切り出し' : '🎬 クリップ', cls: 'jp-follow-btn' });
      cut.onclick = async () => {
        cut.disabled = true;
        cut.setText('🎬 …');
        const ok = await this.clipMark(m, false);
        cut.setText(ok ? '✓' : '✗');
        this.repaintMarks();
      };
    }
    const cap = acts.createEl('button', { text: clip ? '🏷️ 分類 🎬' : '🏷️ 分類', cls: 'jp-follow-btn' });
    cap.title = clip ? '切り出した場面を添えて台帳へ' : 'この気づきを台帳へ';
    cap.onclick = () => this.captureAt(m.lineIndex ?? this.nowIdx, m.lineText || '', clip, m.seed || undefined);
    const del = acts.createEl('button', { text: '✕', cls: 'jp-follow-btn' });
    del.title = 'この一覧から外す（収集トレイのマークは残ります）';
    del.onclick = () => { this.marks = this.marks.filter((x) => x !== m); this.repaintMarks(); };
  }

  /** Cut one mark's clip and remember it against the mark's coordinates. When
   *  the mark also lives in the tray, the tray card learns about it too, so
   *  classifying it there later still carries the scene. */
  private async clipMark(m: WatchMark, quiet: boolean): Promise<boolean> {
    if (!this.deps.plexClip || !this.plexPartKey || m.tSec == null) return false;
    const label = m.seed || m.lineText || 'mark';
    const r = await this.deps.plexClip(this.plexPartKey, m.tSec, label).catch(() => null);
    if (!(r?.audio || r?.still)) {
      if (!quiet) new Notice('クリップの切り出しに失敗しました（ffmpeg / サーバー接続を確認）。', 8000);
      return false;
    }
    this.clipAt.set(this.markRowKey(m), r);
    if (m.cardId) await this.deps.attachMarkClip?.(m.cardId, r).catch(() => { /* tray is best-effort */ });
    if (this.session) {
      const sm = this.session.marks.find((x) => x.tSec === m.tSec && x.lineIndex === m.lineIndex);
      if (sm) this.clipAt.set(markKey(sm), r);
    }
    if (!quiet) new Notice(`🎬 ${r.audio ?? r.still}`, 4000);
    return true;
  }

  /** Inline note editor on a mark row — same textarea the line long-press uses. */
  private editMarkNote(row: HTMLElement, m: WatchMark): void {
    if (row.querySelector('.jp-follow-seed')) return;
    this.noteEditor(row, m.seed ?? '', async (text) => {
      m.seed = text || null;
      if (m.cardId) await this.deps.setMarkNote?.(m.cardId, text).catch(() => { /* tray is best-effort */ });
      this.repaintMarks();
    });
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
      const cardId = await this.deps.addTrayMark({
        medium: this.medium, sourceName: this.sourceName,
        file: this.filePath ?? undefined, tSec: line.tStartSec,
        seed, wallClock: now,
      });
      /**
       * §25.1 — the mark also joins THIS watch's working set, so the 📝 panel
       * can show it, cut its clip and hand it to capture. Before this it went
       * straight to the tray and left no trace on the surface that made it,
       * which is why the clip cutter was reachable only from a 発話セッション
       * debrief. `cardId` is the tray card it became, so a clip cut here can be
       * written back onto it and survive being classified later from the tray.
       */
      this.marks.push({
        cardId: typeof cardId === 'string' ? cardId : null,
        tSec: line.tStartSec ?? null,
        lineIndex: line.index,
        lineText: line.text,
        seed: seed ?? null,
        at: now,
      });
      new Notice(seed ? `📍 ${seed}` : '📍', 900);
      if (this.marksOn) this.repaintMarks();
      else this.updateMarksChip();
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
        // While following a real player, ⏯ should stop the video, not just the
        // transcript's idea of it — otherwise the two disagree the moment you
        // use it, which is the whole failure the transport exists to fix.
        if (this.plexSyncOn && this.plexSession?.playerId && this.deps.plexCommand) {
          void this.sendPlex(this.plexPaused ? 'play' : 'pause');
          return;
        }
        this.clock = this.clock!.pausedAtTSec != null
          ? resumeClock(this.clock!, Date.now())
          : pauseClock(this.clock!, Date.now());
        this.updateClockChip();
        this.updateTransport();
      });
    }
    if (k === 'g') return go(() => this.jumpToNow());
    // §25.1 — write a note on the line in play without hunting for a long-press.
    if (k === 'n') {
      const l = this.lineForButtons();
      const row = l ? this.contentEl.querySelector<HTMLElement>(`.jp-follow-line[data-idx="${l.index}"]`) : null;
      if (l && row) return go(() => this.seedPrompt(row, l));
    }
    // §25.4 — cut the clip at the line in play, straight from the keyboard.
    if (k === 'c' && this.deps.plexClip && this.plexPartKey) {
      const l = this.lineForButtons();
      if (l && l.tStartSec != null) {
        return go(async () => {
          new Notice('🎬 切り出し中…', 1500);
          const existing = this.marks.find((m) => m.lineIndex === l.index);
          const m: WatchMark = existing ?? {
            cardId: null, tSec: l.tStartSec ?? null, lineIndex: l.index, lineText: l.text, seed: null, at: Date.now(),
          };
          if (!existing) this.marks.push(m);
          await this.clipMark(m, false);
          if (this.marksOn) this.repaintMarks();
          else this.updateMarksChip();
        });
      }
    }
    if (k === '[') return go(() => this.nudgeOffset(-0.5));
    if (k === ']') return go(() => this.nudgeOffset(0.5));
    // §25.4c — seek the player (and the transcript with it) by ten seconds.
    if (k === ',' || k === '.') {
      if (this.clock) return go(() => this.nudgePlayback(k === ',' ? -10 : 10));
    }
    // Shift+M, not `m` (which drops a mark) and not `b` (which reads as ボード).
    if (k === 'M') {
      this.marksOn = !this.marksOn;
      return go(() => this.render());
    }
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
    // §29 — the watching surface accepts the thing you are about to watch.
    // Drop a .srt from jimaku or the Files app and it becomes a transcript;
    // drop a YouTube link and it is fetched. This closes the last stretch of
    // the §25.4 road that still required leaving the view you are watching in.
    armDrops(root, this.deps, 'follow');
    // §26.3 step 4 — select a phrase out of a line you are watching and act on
    // it in place. The whole point of 鑑賞モード is that you do not stop.
    armSelectionEcho(root, this.deps, 'follow');

    if (!this.filePath || !this.lines.length) {
      root.createDiv({ cls: 'jp-follow-empty', text: 'トランスクリプトのノートから「鑑賞モード」コマンドで開いてください。' });
      root.createDiv({
        cls: 'jp-follow-empty-hint',
        text: '字幕ファイル (.srt / .vtt) や YouTube のリンクをこの画面にドロップしても取り込めます。',
      });
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
      // Right-click / long-press the chip to choose among live sessions — the
      // way out of "several things are playing and none matches this note".
      plexChip.onclick = () => this.togglePlexSync();
      plexChip.oncontextmenu = (ev) => {
        ev.preventDefault();
        this.pickingSession = !this.pickingSession;
        this.render();
      };
      if (this.plexSessions.length > 1 || this.pickingSession) {
        const pickChip = chips.createEl('button', {
          cls: 'jp-follow-btn' + (this.pickingSession ? ' is-on' : ''),
          text: `🔍 ${this.plexSessions.length}`,
        });
        pickChip.title = '再生中のセッションから追うものを選びます';
        pickChip.onclick = () => { this.pickingSession = !this.pickingSession; this.render(); };
      }

      // §25.4b ズレ: only while the server owns the clock, because the
      // calibration IS "the video is here, this line is what I hear". Shows
      // the current correction so a note that is already aligned says so.
      if (this.plexSyncOn) {
        const off = chips.createEl('button', {
          cls: 'jp-follow-alignchip jp-follow-btn' + (this.aligning ? ' is-on' : ''),
          text: this.aligning ? '⌖ 今の行をタップ' : `⌖ ズレ${this.subOffsetSec ? ` ${this.subOffsetSec > 0 ? '+' : ''}${this.subOffsetSec}s` : ''}`,
        });
        off.title = '字幕と映像のズレを合わせる（jimaku の字幕は別リリース基準のことがあります）';
        off.onclick = () => {
          this.aligning = !this.aligning;
          if (this.aligning) new Notice('いま聞こえているセリフの行をタップしてください', 4000);
          this.render();
        };
        // Known small drift does not need the tap-align dance — say the number.
        const nudge = chips.createDiv('jp-follow-nudge');
        for (const d of [-1, -0.5, 0.5, 1]) {
          const b = nudge.createEl('button', { text: `${d > 0 ? '+' : ''}${d}`, cls: 'jp-follow-nudgebtn' });
          b.title = `字幕のズレを ${d > 0 ? '+' : ''}${d}秒 ずらす`;
          b.onclick = () => void this.nudgeOffset(d);
        }
      }
    }
    // 📝 the marks made while watching — the working set, always reachable.
    const marksChip = chips.createEl('button', {
      cls: 'jp-follow-markschip jp-follow-btn' + (this.marksOn ? ' is-on' : ''),
      text: `📝 マーク${this.marks.length ? ` ${this.marks.length}` : ''}`,
    });
    marksChip.title = '今回落としたマークを一覧し、クリップ切り出しと分類をここから行います';
    marksChip.onclick = () => { this.marksOn = !this.marksOn; this.render(); };
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

    if (this.plexSyncOn || this.plexDuration) this.renderTransport(root);
    if (this.pickingSession) this.renderSessionPicker(root);

    // §23.5 keyboard hints
    const keys = root.createDiv('jp-dm-keys');
    const hints: Array<[string, string]> = [
      ['j/k', '移動'], ['⏎', '📍'], ['n', '気づき'], ['s', '同期'], ['p', '⏯'], ['g', '今へ'], ['⇧M', '📝'],
    ];
    if (this.deps.plexClip && this.plexPartKey) hints.push(['c', '🎬']);
    if (this.plexSyncOn) { hints.push(['[ ]', 'ズレ']); hints.push([', .', '±10s']); }
    if (this.session) hints.push(['y', '🎤']);
    for (const [key, label] of hints) {
      const chip = keys.createSpan('jp-dm-key');
      chip.createEl('kbd', { text: key });
      chip.createSpan({ text: label });
    }

    if (this.marksOn) this.renderMarksPanel(root);
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
      // ⌖ align mode consumes the tap: it is a measurement, not a mark.
      if (this.aligning) { void this.alignTo(line); return; }
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

  /** long-press: the §25.1 seed. */
  private seedPrompt(row: HTMLElement, line: MatcherLine): void {
    if (row.querySelector('.jp-follow-seed')) return;
    this.noteEditor(row, '', (text) => this.dropMark('note', line, text || undefined));
  }

  /**
   * §25.1 — the note you write while watching.
   *
   * This was a one-word, single-line input that threw its own contents away on
   * blur. One word is often all you want, but "why this line matters" rarely
   * fits in one, and losing what you typed because you glanced back at the
   * screen is the kind of small betrayal that stops you writing anything at
   * all. So: a textarea, ⏎ saves, ⇧⏎ adds a line, Esc abandons on purpose,
   * and blurring keeps what is there instead of discarding it.
   */
  private noteEditor(
    host: HTMLElement,
    initial: string,
    onSave: (text: string) => void | Promise<void>,
  ): HTMLTextAreaElement {
    const wrap = host.createDiv('jp-follow-seed');
    const ta = wrap.createEl('textarea', {
      cls: 'jp-follow-seed-input',
      attr: { rows: '2', placeholder: '気づき…（⏎ 保存 / ⇧⏎ 改行 / Esc 取消）' },
    });
    ta.value = initial ?? '';
    let settled = false;
    const finish = (save: boolean): void => {
      if (settled) return;
      settled = true;
      const text = ta.value.trim();
      wrap.remove();
      if (save) void onSave(text);
    };
    ta.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    ta.onblur = () => finish(ta.value.trim().length > 0);
    ta.focus();
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch { /* not focusable yet */ }
    return ta;
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
      const key = markKey(mark);
      const cap = act.createEl('button', { cls: 'jp-follow-btn' });
      const paintCap = (): void => {
        const c = this.clipAt.get(key);
        cap.setText(c ? '🏷️ 分類 🎬' : '🏷️ 分類');
        cap.title = c
          ? `切り出した場面をこの気づきに添付します（${[c.still && '静止画', c.audio && '音声'].filter(Boolean).join('・')}）`
          : '';
      };
      paintCap();
      cap.onclick = () => this.captureAt(
        idx >= 0 ? idx : this.nowIdx, mark.lineText ?? '', this.clipAt.get(key), mark.seed || undefined);
      // §25.4: cut the 📺 scene at this mark from the still-synced Plex session.
      if (this.deps.plexClip && this.plexPartKey && mark.tSec != null) {
        const clip = act.createEl('button', { text: '🎬 クリップ', cls: 'jp-follow-btn' });
        clip.onclick = async () => {
          clip.disabled = true; clip.setText('…');
          const r = await this.deps.plexClip!(this.plexPartKey!, mark.tSec!, mark.seed || mark.lineText || 'mark').catch(() => null);
          // REMEMBER the cut. Previously these paths were dropped on the floor:
          // the clip landed in the vault and the noticing it was cut for never
          // learned it existed, so the scene was unreachable from the capture
          // that caused it. SceneRef.audio/image have always had a slot for it.
          if (r?.audio || r?.still) this.clipAt.set(key, r);
          clip.setText(r?.audio || r?.still ? '✓ 切り出し' : '✗ 失敗');
          paintCap();
        };
      }
    }
  }

  private captureAt(
    idx: number, fallbackText: string, clip?: { audio?: string; still?: string }, seedText?: string,
  ): void {
    const line = idx >= 0 && idx < this.lines.length ? this.lines[idx] : null;
    const before = line ? this.lines.slice(Math.max(0, idx - 3), idx) : [];
    const after = line ? this.lines.slice(idx + 1, idx + 4) : [];
    this.deps.openCapture({
      // The note written while watching is the headword you were reaching for;
      // handing it over saves retyping it in front of the capture form.
      text: seedText ?? '',
      example: line?.text ?? fallbackText,
      contextBefore: before.map((l) => l.text),
      contextAfter: after.map((l) => l.text),
      speakers: line ? [...before, line, ...after].map((l) => l.speaker ?? null) : undefined,
      source: {
        // `kind` is the COARSE bucket and 'yt' here means "backed by a
        // timestamped transcript", not YouTube — context-tree.ts reads it to
        // decide clipEligible/swept. The real medium (tv, podcast…) rides on
        // `medium` and is what the scene renderer dispatches on. Do not
        // "correct" this to 'tv': there is no such bucket, and changing it
        // silently disables clips for every TV capture.
        kind: 'yt', file: this.filePath ?? undefined, tStartSec: line?.tStartSec ?? null,
        medium: this.medium, sourceName: this.sourceName,
        ...(clip?.still ? { image: clip.still } : {}),
        ...(clip?.audio ? { audio: clip.audio } : {}),
      },
    });
  }
}
