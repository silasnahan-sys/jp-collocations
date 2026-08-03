/**
 * PipelineView.ts — the ⚡ CAPTURE FLOW (DESIGN §16).
 *
 * The YT pipeline used to be real but DISJOINT: fetch history somewhere, make a
 * note somewhere else, remember the frontmatter contract, paste a photo, find
 * the ⚡ command, then hunt for the cards. This view is that whole path as ONE
 * designed surface — video → 手書き → ⚡ → 復習 — with the files managed for
 * you underneath (same notes, same pipeline, zero new formats).
 *
 * Mobile-first: the photo button opens the iOS camera roll, every stage is a
 * full-width touch target, and the desktop-only audio stage simply doesn't
 * appear on a phone (deep-link audio is the default there anyway).
 *
 * Deliberate behavior: a capture note is created ONLY at the moment you add
 * material to it (photo/phrase) — selecting a video never litters the vault.
 *
 * MANY VIDEOS, ONE MEMO. `runFullPipeline` has always reconciled a capture note
 * against SEVERAL transcripts at once — `reconcileMultiAsync` scores every note
 * phrase against every source and keeps the best match — but this view could
 * only ever express one. That made the flow strictly weaker than the engine
 * under it, and it fought the way a day actually goes: you watch four things
 * and write one page of notes. Selection is now a SET, and a multi-video
 * selection accumulates into a dated day-memo that you can keep adding to.
 */

import { ItemView, WorkspaceLeaf, TFile, Notice, setIcon, normalizePath } from "obsidian";

export const JP_PIPELINE_VIEW_TYPE = "jp-pipeline-view";

export interface FlowDeps {
  transcriptFolder: () => string;
  /** live watch-history fetch (cookie transport) — also auto-sweeps. */
  fetchLiveHistory: () => Promise<void>;
  /** fetch one transcript by pasted URL / video id; null on failure. */
  fetchByVideoUrl: (url: string) => Promise<TFile | null>;
  /** run ⚡ on this capture note (opens it, then the cards-first pipeline). */
  runPipelineOn: (captureNote: TFile) => Promise<void>;
  openReview: () => void;
  hasOcrKey: () => boolean;
}

interface VideoRow {
  transcript: TFile;
  /** the per-video memo, when one exists (a day-memo is found separately). */
  capture: TFile | null;
  cards: TFile | null;
}

const CAPTURE_FOLDER = "キャプチャ";

export class PipelineView extends ItemView {
  private deps: FlowDeps;
  /** Selection is a SET — see the header note on many-videos-one-memo. */
  private selected = new Set<string>();
  private busy = false;

  constructor(leaf: WorkspaceLeaf, deps: FlowDeps) {
    super(leaf);
    this.deps = deps;
  }

  getViewType(): string { return JP_PIPELINE_VIEW_TYPE; }
  getDisplayText(): string { return "⚡ キャプチャ"; }
  getIcon(): string { return "zap"; }

  async onOpen(): Promise<void> {
    // keep stage states live as the pipeline writes files around us
    const refresh = () => { if (!this.busy) this.render(); };
    this.registerEvent(this.app.vault.on("create", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.registerEvent(this.app.metadataCache.on("resolved", refresh));
    this.render();
  }

  async onClose(): Promise<void> { /* nothing owned */ }

  // ── model ──────────────────────────────────────────────────────────────────

  private videoRows(): VideoRow[] {
    const folder = normalizePath(this.deps.transcriptFolder() || "Transcripts");
    const transcripts = this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder + "/") && !f.basename.startsWith("_"))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 20);
    return transcripts.map((t) => {
      const capture = this.findCaptureNote(t);
      const cards = capture
        ? this.asFile(capture.path.replace(/\.md$/, "") + "-cards.md")
        : null;
      return { transcript: t, capture, cards };
    });
  }

  private selectedTranscripts(): TFile[] {
    const rows = this.videoRows();
    return [...this.selected]
      .map((p) => rows.find((r) => r.transcript.path === p)?.transcript)
      .filter((t): t is TFile => !!t);
  }

  /**
   * The capture note for this transcript, by TWO independent routes.
   *
   * The link route alone was not enough, and the way it failed was invisible:
   * `ensureCaptureNote` used to write `source: [[Name]]` UNQUOTED, and in YAML
   * `[[...]]` is a nested flow sequence, so that parses to `[["Name"]]` — a
   * nested array, not a wikilink string. Obsidian therefore recorded no link,
   * `resolvedLinks` stayed empty, and this method returned null for a note it
   * had just created. The view then said "add a photo or phrase" over an
   * existing memo and ⚡ refused to run on it. (Verified with js-yaml:
   * `source: [[X]]` → `{source:[["X"]]}`; `sources: - "[[X]]"` → `{sources:["[[X]]"]}`.)
   *
   * The quoting is fixed, but the NAME route is kept as the primary one because
   * it depends on nothing asynchronous: this view chooses the filename, so it
   * can always find it again — no metadata cache, no link resolution, no race
   * on a freshly created file. The link route still runs second so capture
   * notes written by the command palette (which live outside キャプチャ/ and are
   * named differently) are still found — and it is what finds a DAY-MEMO, whose
   * name says nothing about which videos are in it.
   */
  private findCaptureNote(t: TFile): TFile | null {
    const byName = this.asFile(this.soloNotePath(t));
    if (byName) return byName;

    const links = this.app.metadataCache.resolvedLinks;
    let best: TFile | null = null;
    for (const [fromPath, targets] of Object.entries(links)) {
      if (!targets[t.path] || fromPath === t.path || fromPath.endsWith("-cards.md")) continue;
      const f = this.asFile(fromPath);
      if (!f) continue;
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      // `sources` is the plugin-wide key; `source` is accepted so the notes
      // written before the frontmatter fix keep working without being rewritten.
      if (!fm || (fm.sources == null && fm.source == null)) continue;
      if (!best || f.stat.mtime > best.stat.mtime) best = f;
    }
    return best;
  }

  /** Where a ONE-video memo lives. Deterministic, so it is findable by name. */
  private soloNotePath(t: TFile): string {
    return normalizePath(`${CAPTURE_FOLDER}/${t.basename} — メモ.md`);
  }

  /** Where a MANY-video memo lives: one per day, so an evening's watching
   *  accumulates into a single page instead of one file per video. */
  private dayNotePath(): string {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return normalizePath(`${CAPTURE_FOLDER}/${day} — メモ.md`);
  }

  /** The memo the CURRENT selection writes to: the video's own when exactly one
   *  is selected (unchanged behaviour), today's when several are. */
  private targetNotePath(sel: TFile[]): string {
    return sel.length === 1 ? this.soloNotePath(sel[0]) : this.dayNotePath();
  }

  /** The memo backing the current selection, if it exists yet. */
  private currentCapture(sel: TFile[]): TFile | null {
    return sel.length ? this.asFile(this.targetNotePath(sel)) : null;
  }

  private asFile(path: string): TFile | null {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return f instanceof TFile ? f : null;
  }

  // ── frontmatter ────────────────────────────────────────────────────────────

  /** The `sources:` block for a set of transcripts — quoted, plural, one per
   *  line. The only shape YAML keeps as wikilink STRINGS. */
  private sourcesBlock(sel: TFile[]): string {
    return ["sources:", ...sel.map((t) => `  - "[[${t.basename}]]"`)].join("\n");
  }

  /** Wikilink targets already listed under `sources:`/`source:` in a memo. */
  private existingSources(md: string): string[] {
    const fm = md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) return [];
    return [...fm[1].matchAll(/\[\[([^\]\r\n]+)\]\]/g)].map((m) => m[1]);
  }

  /**
   * Repair the unquoted `source: [[X]]` line this view used to write, and merge
   * any newly selected transcripts into the memo's `sources:` list.
   *
   * The repair half rewrites one malformed line the plugin itself emitted — a
   * repair, not an edit of the user's writing. It fires only on the EXACT
   * single-line shape this view wrote; anything since touched is left alone.
   *
   * The merge half is what lets a day-memo grow: select another video, add a
   * phrase, and that transcript joins the memo's sources rather than starting a
   * second file.
   */
  private async syncFrontmatter(note: TFile, sel: TFile[] = []): Promise<void> {
    const md = await this.app.vault.read(note);
    const m = md.match(/^(﻿?---\r?\n)([\s\S]*?)(\r?\n---)/);
    if (!m) return;
    let block = m[2];

    // 1. legacy single-line `source: [[X]]` → canonical quoted plural list
    block = block.replace(
      /^([^\S\r\n]*)source:[^\S\r\n]*(\[\[[^\]\r\n]+\]\])[^\S\r\n]*$/m,
      (_all, indent: string, link: string) => `${indent}sources:\n${indent}  - "${link}"`,
    );

    // 2. merge in any selected transcript not already listed
    const have = new Set(this.existingSources(m[1] + block + m[3]));
    const missing = sel.filter((t) => !have.has(t.basename));
    if (missing.length) {
      const add = missing.map((t) => `  - "[[${t.basename}]]"`).join("\n");
      block = /^[^\S\r\n]*sources:/m.test(block)
        ? block.replace(/^([^\S\r\n]*sources:[^\n]*(?:\n[^\S\r\n]+-[^\n]*)*)/m, `$1\n${add}`)
        : `${this.sourcesBlock(missing)}\n${block}`.replace(/\n+$/, "");
    }

    if (block === m[2]) return;
    await this.app.vault.modify(note, md.replace(m[0], m[1] + block + m[3]));
  }

  // ── actions ────────────────────────────────────────────────────────────────

  /** Create-on-demand: the capture note exists only once material is added. */
  private async ensureCaptureNote(sel: TFile[]): Promise<TFile> {
    const path = this.targetNotePath(sel);
    const already = this.asFile(path);
    if (already) { await this.syncFrontmatter(already, sel); return already; }
    if (!this.app.vault.getAbstractFileByPath(CAPTURE_FOLDER)) {
      try { await this.app.vault.createFolder(CAPTURE_FOLDER); } catch { /* raced */ }
    }
    const again = this.asFile(path);
    if (again) { await this.syncFrontmatter(again, sel); return again; }
    return await this.app.vault.create(path, `---\n${this.sourcesBlock(sel)}\n---\n\n`);
  }

  private async addPhotos(sel: TFile[], files: FileList): Promise<void> {
    this.busy = true;
    try {
      const note = await this.ensureCaptureNote(sel);
      const embeds: string[] = [];
      for (const file of Array.from(files)) {
        const ext = (file.name.split(".").pop() || "png").toLowerCase();
        const base = file.name.replace(/\.[^.]+$/, "") || "手書き";
        const target = await this.app.fileManager.getAvailablePathForAttachment(`${base}.${ext}`, note.path);
        const created = await this.app.vault.createBinary(target, await file.arrayBuffer());
        embeds.push(`![[${created.name}]]`);
      }
      if (embeds.length) {
        const md = await this.app.vault.read(note);
        await this.app.vault.modify(note, md.replace(/\s*$/, "\n\n") + embeds.join("\n") + "\n");
        new Notice(`📷 ${embeds.length}枚を ${note.basename} に追加しました`);
      }
    } catch (e) {
      new Notice(`写真の追加に失敗しました: ${String(e)}`, 8000);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async addPhrase(sel: TFile[], phrase: string): Promise<void> {
    const text = phrase.trim();
    if (!text) return;
    this.busy = true;
    try {
      const note = await this.ensureCaptureNote(sel);
      const md = await this.app.vault.read(note);
      await this.app.vault.modify(note, md.replace(/\s*$/, "\n") + text + "\n");
      new Notice(`✍ 追加: ${text}`);
    } catch (e) {
      // Previously this had no catch, so a failure inside ensureCaptureNote
      // (an illegal filename, a vault error) rejected into `void addP()` and
      // vanished — the phrase silently never landed and the UI just sat there.
      new Notice(`フレーズの追加に失敗しました: ${String(e)}`, 8000);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async run(note: TFile, sel: TFile[]): Promise<void> {
    this.busy = true;
    try {
      // Sync here too, not only on add: a memo written before the frontmatter
      // fix runs fine (frontmatterSources reads raw text) but its link stays
      // invisible to Obsidian until the malformed line is rewritten.
      await this.syncFrontmatter(note, sel);
      await this.deps.runPipelineOn(note);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("jp-flow");

    const rows = this.videoRows();
    // drop selections whose transcript has since disappeared
    for (const p of [...this.selected]) {
      if (!rows.some((r) => r.transcript.path === p)) this.selected.delete(p);
    }
    const sel = this.selectedTranscripts();

    // ① 動画 — tap to toggle; several may be on at once.
    const s1 = this.stage(root, "1", "動画",
      sel.length === 0 ? "どの動画のページ？（複数選べます）"
        : sel.length === 1 ? this.cleanTitle(sel[0])
        : `${sel.length}本を選択中 — 今日のメモにまとめます`);
    const srcBtns = s1.createDiv("jp-flow-btnrow");
    this.bigBtn(srcBtns, "history", "視聴履歴から取得", async () => {
      this.busy = true;
      try { await this.deps.fetchLiveHistory(); } finally { this.busy = false; this.render(); }
    });
    const urlWrap = s1.createDiv("jp-flow-urlrow");
    const urlIn = urlWrap.createEl("input", {
      type: "text", cls: "jp-flow-url",
      attr: { placeholder: "YouTube URL を貼り付け…", enterkeyhint: "go", autocapitalize: "off" },
    });
    const urlGo = urlWrap.createEl("button", { text: "取得", cls: "jp-flow-urlgo" });
    const fetchUrl = async () => {
      const v = urlIn.value.trim();
      if (!v) return;
      this.busy = true;
      try {
        const t = await this.deps.fetchByVideoUrl(v);
        if (t) { this.selected.add(t.path); urlIn.value = ""; }
      } finally { this.busy = false; this.render(); }
    };
    urlGo.onclick = () => void fetchUrl();
    urlIn.addEventListener("keydown", (e) => { if (e.key === "Enter") void fetchUrl(); });

    if (!rows.length) {
      s1.createDiv({ cls: "jp-flow-empty", text: "まだ文字起こしがありません。履歴取得か URL 貼り付けから始めてください。" });
    }
    const list = s1.createDiv("jp-flow-videos");
    for (const r of rows) {
      const on = this.selected.has(r.transcript.path);
      const row = list.createDiv("jp-flow-video" + (on ? " jp-flow-video--sel" : ""));
      row.createSpan({ text: on ? "☑" : "☐", cls: "jp-flow-video-tick" });
      row.createSpan({ text: this.cleanTitle(r.transcript), cls: "jp-flow-video-title" });
      const marks = row.createSpan({ cls: "jp-flow-video-marks" });
      if (r.capture) marks.createSpan({ text: "📝", attr: { title: `メモ: ${r.capture.basename}` } });
      if (r.cards) marks.createSpan({ text: "🃏", attr: { title: `カード: ${r.cards.basename}` } });
      row.onclick = () => {
        if (on) this.selected.delete(r.transcript.path); else this.selected.add(r.transcript.path);
        this.render();
      };
    }
    if (sel.length > 1) {
      const clear = s1.createEl("button", { text: "選択を解除", cls: "jp-flow-mini-wide" });
      clear.onclick = () => { this.selected.clear(); this.render(); };
    }

    if (!sel.length) return;

    // ② 手書き — writes to the memo the selection targets.
    const capture = this.currentCapture(sel);
    const capCount = capture ? (this.app.metadataCache.getFileCache(capture)?.embeds?.length ?? 0) : 0;
    const listed = capture ? this.existingSourcesCached(capture) : 0;
    const s2 = this.stage(root, "2", "手書き",
      capture
        ? `📝 ${capture.basename}${capCount ? ` ・ 画像 ${capCount}枚` : ""}${listed > 1 ? ` ・ 動画 ${listed}本` : ""}`
        : sel.length > 1
          ? `写真かフレーズを追加すると「${this.baseOf(this.dayNotePath())}」にまとまります`
          : "写真かフレーズを追加するとメモが作られます");
    const photoRow = s2.createDiv("jp-flow-btnrow");
    const fileIn = photoRow.createEl("input", { type: "file", attr: { accept: "image/*", multiple: "", style: "display:none" } });
    fileIn.addEventListener("change", () => { if (fileIn.files?.length) void this.addPhotos(sel, fileIn.files); });
    this.bigBtn(photoRow, "camera", "写真を追加", () => fileIn.click());
    if (capture) {
      const open = photoRow.createEl("button", { cls: "jp-flow-mini", attr: { title: "メモを開く" } });
      setIcon(open, "pencil");
      open.onclick = () => { void this.app.workspace.getLeaf(false).openFile(capture); };
    }
    const phraseRow = s2.createDiv("jp-flow-urlrow");
    const phraseIn = phraseRow.createEl("input", {
      type: "text", cls: "jp-flow-url",
      attr: { placeholder: "✍ フレーズを直接追加…", enterkeyhint: "done" },
    });
    const phraseGo = phraseRow.createEl("button", { text: "追加", cls: "jp-flow-urlgo" });
    const addP = async () => { await this.addPhrase(sel, phraseIn.value); phraseIn.value = ""; };
    phraseGo.onclick = () => void addP();
    phraseIn.addEventListener("keydown", (e) => { if (e.key === "Enter") void addP(); });
    if (capCount > 0 && !this.deps.hasOcrKey()) {
      s2.createDiv({ cls: "jp-flow-warn", text: "⚠ OCR APIキー未設定 — 画像は読み取られません（設定 → 手書きOCR）" });
    }

    // ③ ⚡ — the button says WHY it cannot run, in place. It used to merely look
    // dimmed while staying clickable, so the only way to learn what was missing
    // was to press it and read a Notice that vanished.
    const ready = !!capture;
    const s3 = this.stage(root, "3", "カード生成",
      ready ? `OCR → 照合 → カード（約1分・音声は後から自動）${sel.length > 1 ? ` ・ ${sel.length}本と照合` : ""}`
        : "② で写真かフレーズを追加すると実行できます");
    const runBtn = s3.createEl("button", { cls: "jp-flow-run" + (ready ? "" : " jp-flow-run--off") });
    setIcon(runBtn.createSpan(), "zap");
    runBtn.createSpan({ text: this.busy ? " 実行中…" : " 実行" });
    runBtn.disabled = !ready || this.busy;
    runBtn.setAttr("title", ready ? "OCR → 照合 → カード" : "先に ② で写真かフレーズを追加してください");
    runBtn.onclick = () => { if (capture) void this.run(capture, sel); };

    // ④ 復習
    const cards = capture ? this.asFile(capture.path.replace(/\.md$/, "") + "-cards.md") : null;
    if (cards) {
      const s4 = this.stage(root, "4", "復習", `🃏 ${cards.basename}`);
      const btns = s4.createDiv("jp-flow-btnrow");
      this.bigBtn(btns, "layers", "復習を始める", () => this.deps.openReview());
      this.bigBtn(btns, "gallery-vertical-end", "カードを開く", () => {
        void this.app.workspace.getLeaf(false).openFile(cards);
      });
    }
  }

  /** How many transcripts a memo already lists — read from the metadata cache
   *  so render stays synchronous. */
  private existingSourcesCached(note: TFile): number {
    const fm = this.app.metadataCache.getFileCache(note)?.frontmatter;
    const v = fm?.sources ?? fm?.source;
    return Array.isArray(v) ? v.length : v == null ? 0 : 1;
  }

  private cleanTitle(t: TFile): string {
    return t.basename.replace(/\s*\([\w-]{11}\)\s*$/, "");
  }

  private baseOf(path: string): string {
    return path.split("/").pop()?.replace(/\.md$/, "") ?? path;
  }

  private stage(root: HTMLElement, num: string, title: string, sub: string): HTMLElement {
    const box = root.createDiv("jp-flow-stage");
    const head = box.createDiv("jp-flow-stage-head");
    head.createSpan({ text: num, cls: "jp-flow-stage-num" });
    head.createSpan({ text: title, cls: "jp-flow-stage-title" });
    box.createDiv({ text: sub, cls: "jp-flow-stage-sub" });
    return box;
  }

  private bigBtn(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = parent.createEl("button", { cls: "jp-flow-big" });
    setIcon(b.createSpan({ cls: "jp-flow-big-ic" }), icon);
    b.createSpan({ text: label });
    b.onclick = onClick;
    return b;
  }
}
