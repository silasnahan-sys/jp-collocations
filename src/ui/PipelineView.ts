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
  capture: TFile | null;
  cards: TFile | null;
}

const CAPTURE_FOLDER = "キャプチャ";

export class PipelineView extends ItemView {
  private deps: FlowDeps;
  private selectedPath: string | null = null;
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

  /** The newest md note whose frontmatter `source` links this transcript. */
  private findCaptureNote(t: TFile): TFile | null {
    const links = this.app.metadataCache.resolvedLinks;
    let best: TFile | null = null;
    for (const [fromPath, targets] of Object.entries(links)) {
      if (!targets[t.path] || fromPath === t.path || fromPath.endsWith("-cards.md")) continue;
      const f = this.asFile(fromPath);
      if (!f) continue;
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (!fm || fm.source == null) continue;
      if (!best || f.stat.mtime > best.stat.mtime) best = f;
    }
    return best;
  }

  private asFile(path: string): TFile | null {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return f instanceof TFile ? f : null;
  }

  private selectedRow(): VideoRow | null {
    if (!this.selectedPath) return null;
    return this.videoRows().find((r) => r.transcript.path === this.selectedPath) ?? null;
  }

  /** Create-on-demand: the capture note exists only once material is added. */
  private async ensureCaptureNote(t: TFile): Promise<TFile> {
    const existing = this.findCaptureNote(t);
    if (existing) return existing;
    if (!this.app.vault.getAbstractFileByPath(CAPTURE_FOLDER)) {
      try { await this.app.vault.createFolder(CAPTURE_FOLDER); } catch { /* raced */ }
    }
    const path = normalizePath(`${CAPTURE_FOLDER}/${t.basename} — メモ.md`);
    const already = this.asFile(path);
    if (already) return already;
    return await this.app.vault.create(path, `---\nsource: [[${t.basename}]]\n---\n\n`);
  }

  // ── actions ────────────────────────────────────────────────────────────────

  private async addPhotos(t: TFile, files: FileList): Promise<void> {
    this.busy = true;
    try {
      const note = await this.ensureCaptureNote(t);
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

  private async addPhrase(t: TFile, phrase: string): Promise<void> {
    const text = phrase.trim();
    if (!text) return;
    this.busy = true;
    try {
      const note = await this.ensureCaptureNote(t);
      const md = await this.app.vault.read(note);
      await this.app.vault.modify(note, md.replace(/\s*$/, "\n") + text + "\n");
      new Notice(`✍ 追加: ${text}`);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async run(row: VideoRow): Promise<void> {
    if (!row.capture) { new Notice("先に写真かフレーズを追加してください"); return; }
    this.busy = true;
    try {
      await this.deps.runPipelineOn(row.capture);
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
    const sel = this.selectedRow();

    // ① 動画
    const s1 = this.stage(root, "1", "動画", sel ? sel.transcript.basename.replace(/\s*\([\w-]{11}\)\s*$/, "") : "どの動画のページ？");
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
        if (t) { this.selectedPath = t.path; urlIn.value = ""; }
      } finally { this.busy = false; this.render(); }
    };
    urlGo.onclick = () => void fetchUrl();
    urlIn.addEventListener("keydown", (e) => { if (e.key === "Enter") void fetchUrl(); });

    if (!rows.length) {
      s1.createDiv({ cls: "jp-flow-empty", text: "まだ文字起こしがありません。履歴取得か URL 貼り付けから始めてください。" });
    }
    const list = s1.createDiv("jp-flow-videos");
    for (const r of rows) {
      const row = list.createDiv("jp-flow-video" + (r.transcript.path === this.selectedPath ? " jp-flow-video--sel" : ""));
      const title = r.transcript.basename.replace(/\s*\([\w-]{11}\)\s*$/, "");
      row.createSpan({ text: title, cls: "jp-flow-video-title" });
      const marks = row.createSpan({ cls: "jp-flow-video-marks" });
      if (r.capture) marks.createSpan({ text: "📝", attr: { title: `メモ: ${r.capture.basename}` } });
      if (r.cards) marks.createSpan({ text: "🃏", attr: { title: `カード: ${r.cards.basename}` } });
      row.onclick = () => { this.selectedPath = r.transcript.path; this.render(); };
    }

    if (!sel) return;

    // ② 手書き
    const capCount = sel.capture ? (this.app.metadataCache.getFileCache(sel.capture)?.embeds?.length ?? 0) : 0;
    const s2 = this.stage(root, "2", "手書き",
      sel.capture ? `📝 ${sel.capture.basename}${capCount ? ` ・ 画像 ${capCount}枚` : ""}` : "写真かフレーズを追加するとメモが作られます");
    const photoRow = s2.createDiv("jp-flow-btnrow");
    const fileIn = photoRow.createEl("input", { type: "file", attr: { accept: "image/*", multiple: "", style: "display:none" } });
    fileIn.addEventListener("change", () => { if (fileIn.files?.length) void this.addPhotos(sel.transcript, fileIn.files); });
    this.bigBtn(photoRow, "camera", "写真を追加", () => fileIn.click());
    if (sel.capture) {
      const open = photoRow.createEl("button", { cls: "jp-flow-mini", attr: { title: "メモを開く" } });
      setIcon(open, "pencil");
      open.onclick = () => { void this.app.workspace.getLeaf(false).openFile(sel.capture as TFile); };
    }
    const phraseRow = s2.createDiv("jp-flow-urlrow");
    const phraseIn = phraseRow.createEl("input", {
      type: "text", cls: "jp-flow-url",
      attr: { placeholder: "✍ フレーズを直接追加…", enterkeyhint: "done" },
    });
    const phraseGo = phraseRow.createEl("button", { text: "追加", cls: "jp-flow-urlgo" });
    const addP = async () => { await this.addPhrase(sel.transcript, phraseIn.value); phraseIn.value = ""; };
    phraseGo.onclick = () => void addP();
    phraseIn.addEventListener("keydown", (e) => { if (e.key === "Enter") void addP(); });
    if (capCount > 0 && !this.deps.hasOcrKey()) {
      s2.createDiv({ cls: "jp-flow-warn", text: "⚠ OCR APIキー未設定 — 画像は読み取られません（設定 → 手書きOCR）" });
    }

    // ③ ⚡
    const s3 = this.stage(root, "3", "カード生成", "OCR → 照合 → カード（約1分・音声は後から自動）");
    const runBtn = s3.createEl("button", { cls: "jp-flow-run" + (sel.capture ? "" : " jp-flow-run--off") });
    setIcon(runBtn.createSpan(), "zap");
    runBtn.createSpan({ text: this.busy ? " 実行中…" : " 実行" });
    runBtn.onclick = () => void this.run(sel);

    // ④ 復習
    if (sel.cards) {
      const s4 = this.stage(root, "4", "復習", `🃏 ${sel.cards.basename}`);
      const btns = s4.createDiv("jp-flow-btnrow");
      this.bigBtn(btns, "layers", "復習を始める", () => this.deps.openReview());
      this.bigBtn(btns, "gallery-vertical-end", "カードを開く", () => {
        void this.app.workspace.getLeaf(false).openFile(sel.cards as TFile);
      });
    }
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
